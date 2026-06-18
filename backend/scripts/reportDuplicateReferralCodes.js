import { pool, query } from "../src/db.js"

function parseArgs(argv = []) {
  const options = {
    format: "text",
    classification: "all",
    limit: 50,
  }

  for (const arg of argv) {
    if (arg === "--json") {
      options.format = "json"
      continue
    }

    if (arg.startsWith("--classification=")) {
      options.classification = String(arg.split("=")[1] || "all").trim() || "all"
      continue
    }

    if (arg.startsWith("--limit=")) {
      const value = Number.parseInt(arg.split("=")[1] || "", 10)

      if (Number.isFinite(value) && value > 0) {
        options.limit = value
      }
    }
  }

  return options
}

function formatOwner(row) {
  return {
    userId: Number(row.owner_id),
    platform: row.platform || "",
    platformUserId: row.platform_user_id || "",
    createdAt: row.created_at,
    linkedReferralsCount: Number(row.linked_referrals_count || 0),
    referralBonusCount: Number(row.referral_bonus_count || 0),
  }
}

function classifyGroup(owners = []) {
  const ownersWithTraffic = owners.filter((owner) => (
    owner.linkedReferralsCount > 0 || owner.referralBonusCount > 0
  )).length

  if (ownersWithTraffic <= 0) {
    return "no_traffic"
  }

  if (ownersWithTraffic === 1) {
    return "single_owner_traffic"
  }

  return "multi_owner_traffic"
}

function buildRecommendedAction(classification) {
  if (classification === "no_traffic") {
    return "Safe to auto-recode all non-canonical owners"
  }

  if (classification === "single_owner_traffic") {
    return "Keep code on the traffic owner, recode the others"
  }

  return "Manual review required before any reassignment"
}

async function loadSummary() {
  const summaryResult = await query(`
    WITH duplicate_codes AS (
      SELECT referral_code, COUNT(*)::int AS owners_count
      FROM app_users
      WHERE referral_code <> ''
      GROUP BY referral_code
      HAVING COUNT(*) > 1
    ),
    owner_metrics AS (
      SELECT
        dc.referral_code,
        u.id AS owner_id,
        COUNT(DISTINCT child.id)::int AS linked_referrals_count,
        COUNT(DISTINCT t.id) FILTER (WHERE t.reason = 'referral_bonus')::int AS referral_bonus_count
      FROM duplicate_codes dc
      JOIN app_users u
        ON u.referral_code = dc.referral_code
      LEFT JOIN app_users child
        ON child.referred_by_user_id = u.id
      LEFT JOIN user_attempt_transactions t
        ON t.user_id = u.id
       AND t.reason = 'referral_bonus'
      GROUP BY dc.referral_code, u.id
    ),
    grouped AS (
      SELECT
        referral_code,
        COUNT(*) FILTER (
          WHERE linked_referrals_count > 0 OR referral_bonus_count > 0
        )::int AS owners_with_any_traffic
      FROM owner_metrics
      GROUP BY referral_code
    )
    SELECT
      (SELECT COUNT(*)::int FROM duplicate_codes) AS duplicate_code_groups,
      (SELECT COALESCE(SUM(owners_count), 0)::int FROM duplicate_codes) AS users_in_duplicate_groups,
      (SELECT COUNT(*)::int FROM duplicate_codes WHERE owners_count = 2) AS pair_groups,
      (SELECT COUNT(*)::int FROM duplicate_codes WHERE owners_count = 3) AS triple_groups,
      (SELECT COUNT(*)::int FROM duplicate_codes WHERE referral_code ~ '^OZONTRAVEL-[A-Z0-9]{6}$') AS legacy_format_groups,
      (SELECT COUNT(*)::int FROM duplicate_codes WHERE referral_code !~ '^OZONTRAVEL-[A-Z0-9]{6}$') AS non_legacy_format_groups,
      (SELECT COUNT(*)::int
       FROM duplicate_codes dc
       WHERE EXISTS (
         SELECT 1
         FROM user_attempt_transactions t
         WHERE t.reason = 'referral_bonus'
           AND t.details->>'referralCode' = dc.referral_code
       )) AS groups_with_referral_bonus_traffic,
      (SELECT COUNT(*)::int FROM grouped WHERE owners_with_any_traffic = 0) AS no_traffic_groups,
      (SELECT COUNT(*)::int FROM grouped WHERE owners_with_any_traffic = 1) AS single_owner_traffic_groups,
      (SELECT COUNT(*)::int FROM grouped WHERE owners_with_any_traffic > 1) AS multi_owner_traffic_groups
  `)

  return summaryResult.rows[0] || null
}

async function loadDuplicateGroups() {
  const result = await query(`
    WITH duplicate_codes AS (
      SELECT referral_code, COUNT(*)::int AS owners_count
      FROM app_users
      WHERE referral_code <> ''
      GROUP BY referral_code
      HAVING COUNT(*) > 1
    )
    SELECT
      dc.referral_code,
      dc.owners_count,
      u.id AS owner_id,
      u.platform,
      u.platform_user_id,
      u.created_at,
      COUNT(DISTINCT child.id)::int AS linked_referrals_count,
      COUNT(DISTINCT t.id) FILTER (WHERE t.reason = 'referral_bonus')::int AS referral_bonus_count
    FROM duplicate_codes dc
    JOIN app_users u
      ON u.referral_code = dc.referral_code
    LEFT JOIN app_users child
      ON child.referred_by_user_id = u.id
    LEFT JOIN user_attempt_transactions t
      ON t.user_id = u.id
     AND t.reason = 'referral_bonus'
    GROUP BY
      dc.referral_code,
      dc.owners_count,
      u.id,
      u.platform,
      u.platform_user_id,
      u.created_at
    ORDER BY
      dc.referral_code ASC,
      u.created_at ASC,
      u.id ASC
  `)

  const grouped = new Map()

  for (const row of result.rows) {
    const referralCode = row.referral_code || ""
    const owner = formatOwner(row)
    const existing = grouped.get(referralCode)

    if (existing) {
      existing.owners.push(owner)
      continue
    }

    grouped.set(referralCode, {
      referralCode,
      ownersCount: Number(row.owners_count || 0),
      owners: [owner],
    })
  }

  return [...grouped.values()].map((group) => {
    const classification = classifyGroup(group.owners)
    const linkedReferralsCount = group.owners.reduce((sum, owner) => sum + owner.linkedReferralsCount, 0)
    const referralBonusCount = group.owners.reduce((sum, owner) => sum + owner.referralBonusCount, 0)

    return {
      ...group,
      classification,
      linkedReferralsCount,
      referralBonusCount,
      recommendedAction: buildRecommendedAction(classification),
    }
  })
}

function formatGroupLine(group) {
  const owners = group.owners
    .map((owner) => (
      `${owner.userId}:${owner.platform}:${owner.platformUserId}`
      + ` linked=${owner.linkedReferralsCount}`
      + ` bonus=${owner.referralBonusCount}`
      + ` created=${owner.createdAt}`
    ))
    .join(" | ")

  return [
    group.referralCode,
    `owners=${group.ownersCount}`,
    `class=${group.classification}`,
    `linked=${group.linkedReferralsCount}`,
    `bonus=${group.referralBonusCount}`,
    owners,
  ].join(" | ")
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const summary = await loadSummary()
  const groups = await loadDuplicateGroups()
  const filteredGroups = groups
    .filter((group) => options.classification === "all" || group.classification === options.classification)
    .sort((left, right) => {
      if (right.linkedReferralsCount !== left.linkedReferralsCount) {
        return right.linkedReferralsCount - left.linkedReferralsCount
      }

      if (right.referralBonusCount !== left.referralBonusCount) {
        return right.referralBonusCount - left.referralBonusCount
      }

      if (right.ownersCount !== left.ownersCount) {
        return right.ownersCount - left.ownersCount
      }

      return left.referralCode.localeCompare(right.referralCode)
    })

  const preview = filteredGroups.slice(0, options.limit)

  if (options.format === "json") {
    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      summary,
      filters: {
        classification: options.classification,
        limit: options.limit,
      },
      totalMatchingGroups: filteredGroups.length,
      groups: preview,
    }, null, 2))
    return
  }

  console.log("Duplicate referral code audit")
  console.log(`Generated at: ${new Date().toISOString()}`)
  console.log("")
  console.log(`Duplicate groups: ${summary?.duplicate_code_groups || 0}`)
  console.log(`Users in duplicate groups: ${summary?.users_in_duplicate_groups || 0}`)
  console.log(`Pair groups: ${summary?.pair_groups || 0}`)
  console.log(`Triple groups: ${summary?.triple_groups || 0}`)
  console.log(`Legacy-format groups: ${summary?.legacy_format_groups || 0}`)
  console.log(`Non-legacy-format groups: ${summary?.non_legacy_format_groups || 0}`)
  console.log(`Groups with referral bonus traffic: ${summary?.groups_with_referral_bonus_traffic || 0}`)
  console.log(`No-traffic groups: ${summary?.no_traffic_groups || 0}`)
  console.log(`Single-owner-traffic groups: ${summary?.single_owner_traffic_groups || 0}`)
  console.log(`Multi-owner-traffic groups: ${summary?.multi_owner_traffic_groups || 0}`)
  console.log("")
  console.log(`Showing ${preview.length} of ${filteredGroups.length} matching groups`)
  console.log(`Classification filter: ${options.classification}`)
  console.log("")

  for (const group of preview) {
    console.log(formatGroupLine(group))
  }
}

main()
  .catch((error) => {
    console.error("Duplicate referral audit failed")
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end().catch(() => {})
  })
