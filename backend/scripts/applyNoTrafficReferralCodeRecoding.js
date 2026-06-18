import { pool, withTransaction } from "../src/db.js"

const SUPPORTED_CLASSIFICATIONS = new Set([
  "no_traffic",
  "single_owner_traffic",
])

function parseArgs(argv = []) {
  const options = {
    apply: false,
    format: "text",
    limit: 100,
    classification: "no_traffic",
  }

  for (const arg of argv) {
    if (arg === "--apply") {
      options.apply = true
      continue
    }

    if (arg === "--json") {
      options.format = "json"
      continue
    }

    if (arg.startsWith("--classification=")) {
      const value = String(arg.split("=")[1] || "").trim()

      if (SUPPORTED_CLASSIFICATIONS.has(value)) {
        options.classification = value
      }

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

function buildReferralCodeBase(value) {
  return String(value || "")
    .replace(/\W+/g, "")
    .slice(-6)
    .padStart(6, "0")
}

function compareByCreatedAt(left, right) {
  const leftTimestamp = new Date(left.createdAt).getTime()
  const rightTimestamp = new Date(right.createdAt).getTime()

  if (leftTimestamp !== rightTimestamp) {
    return leftTimestamp - rightTimestamp
  }

  return left.userId - right.userId
}

function compareByTrafficPriority(left, right) {
  if (right.linkedReferralsCount !== left.linkedReferralsCount) {
    return right.linkedReferralsCount - left.linkedReferralsCount
  }

  if (right.referralBonusCount !== left.referralBonusCount) {
    return right.referralBonusCount - left.referralBonusCount
  }

  return compareByCreatedAt(left, right)
}

function buildBaseCandidate(owner) {
  return `OZONTRAVEL-${buildReferralCodeBase(owner.platformUserId)}-${owner.userId}`
}

function allocateUniqueReferralCode(owner, existingCodes) {
  const baseCandidate = buildBaseCandidate(owner)
  let candidate = baseCandidate
  let sequence = 2

  while (existingCodes.has(candidate)) {
    candidate = `${baseCandidate}-X${sequence}`
    sequence += 1
  }

  existingCodes.add(candidate)
  return candidate
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

async function loadExistingReferralCodes(client) {
  const result = await client.query(`
    SELECT referral_code
    FROM app_users
    WHERE referral_code <> ''
  `)

  return new Set(
    result.rows
      .map((row) => String(row.referral_code || "").trim())
      .filter(Boolean),
  )
}

async function loadTargetDuplicateGroups(client, classification) {
  const result = await client.query(`
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
      om.referral_code,
      om.owners_count,
      om.owner_id,
      om.platform,
      om.platform_user_id,
      om.created_at,
      om.linked_referrals_count,
      om.referral_bonus_count
    FROM owner_metrics om
    JOIN grouped g
      ON g.referral_code = om.referral_code
    WHERE (
      $1 = 'no_traffic'
      AND g.owners_with_any_traffic = 0
    ) OR (
      $1 = 'single_owner_traffic'
      AND g.owners_with_any_traffic = 1
    )
    ORDER BY
      om.referral_code ASC,
      om.created_at ASC,
      om.owner_id ASC
    FOR UPDATE
  `, [classification])

  const grouped = new Map()

  for (const row of result.rows) {
    const referralCode = String(row.referral_code || "").trim()
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

  return [...grouped.values()]
}

function selectCanonicalOwner(group, classification) {
  const owners = [...group.owners]

  if (classification === "single_owner_traffic") {
    return owners.sort(compareByTrafficPriority)[0] || null
  }

  return owners.sort(compareByCreatedAt)[0] || null
}

function buildPlan(groups, existingCodes, classification) {
  return groups
    .map((group) => {
      const canonicalOwner = selectCanonicalOwner(group, classification)
      const recodes = group.owners
        .filter((owner) => owner.userId !== canonicalOwner?.userId)
        .sort(compareByCreatedAt)
        .map((owner) => ({
          userId: owner.userId,
          platform: owner.platform,
          platformUserId: owner.platformUserId,
          createdAt: owner.createdAt,
          linkedReferralsCount: owner.linkedReferralsCount,
          referralBonusCount: owner.referralBonusCount,
          currentReferralCode: group.referralCode,
          proposedReferralCode: allocateUniqueReferralCode(owner, existingCodes),
        }))

      return {
        referralCode: group.referralCode,
        classification,
        ownersCount: group.ownersCount,
        canonicalOwner,
        recodes,
      }
    })
    .sort((left, right) => {
      if (right.recodes.length !== left.recodes.length) {
        return right.recodes.length - left.recodes.length
      }

      return left.referralCode.localeCompare(right.referralCode)
    })
}

function summarizePlan(plan) {
  return plan.reduce((summary, group) => {
    summary.groups += 1
    summary.recodes += group.recodes.length
    return summary
  }, {
    groups: 0,
    recodes: 0,
  })
}

async function applyPlan(client, plan) {
  const applied = []

  for (const group of plan) {
    for (const recode of group.recodes) {
      const updateResult = await client.query(
        `
          UPDATE app_users
          SET referral_code = $1,
              updated_at = NOW()
          WHERE id = $2
            AND referral_code = $3
          RETURNING id, referral_code
        `,
        [
          recode.proposedReferralCode,
          recode.userId,
          recode.currentReferralCode,
        ],
      )

      if (updateResult.rowCount !== 1) {
        throw new Error(
          `Failed to recode user ${recode.userId} from ${recode.currentReferralCode} to ${recode.proposedReferralCode}`,
        )
      }

      applied.push({
        ...recode,
        persistedReferralCode: String(updateResult.rows[0]?.referral_code || ""),
      })
    }
  }

  return applied
}

function formatPlanLine(group) {
  const canonical = group.canonicalOwner
    ? `keep ${group.canonicalOwner.userId}:${group.canonicalOwner.platform}:${group.canonicalOwner.platformUserId}`
    : "keep none"
  const recodes = group.recodes.map((item) => (
    `${item.userId}:${item.platform}:${item.platformUserId} -> ${item.proposedReferralCode}`
  )).join(" | ")

  return [
    group.referralCode,
    `class=${group.classification}`,
    `owners=${group.ownersCount}`,
    canonical,
    recodes || "no recodes",
  ].join(" | ")
}

async function main() {
  const options = parseArgs(process.argv.slice(2))

  const result = await withTransaction(async (client) => {
    const [groups, existingCodes] = await Promise.all([
      loadTargetDuplicateGroups(client, options.classification),
      loadExistingReferralCodes(client),
    ])
    const plan = buildPlan(groups, existingCodes, options.classification)
    const summary = summarizePlan(plan)

    if (!options.apply) {
      return {
        mode: "dry-run",
        classification: options.classification,
        summary,
        appliedCount: 0,
        plan,
      }
    }

    const applied = await applyPlan(client, plan)

    return {
      mode: "apply",
      classification: options.classification,
      summary,
      appliedCount: applied.length,
      applied,
      plan,
    }
  })

  const preview = result.plan.slice(0, options.limit)

  if (options.format === "json") {
    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      mode: result.mode,
      classification: result.classification,
      summary: result.summary,
      appliedCount: result.appliedCount,
      groups: preview,
    }, null, 2))
    return
  }

  console.log("Duplicate referral recoding")
  console.log(`Generated at: ${new Date().toISOString()}`)
  console.log(`Mode: ${result.mode}`)
  console.log(`Classification: ${result.classification}`)
  console.log(`Matching groups: ${result.summary.groups}`)
  console.log(`Users to recode: ${result.summary.recodes}`)
  console.log(`Applied updates: ${result.appliedCount}`)
  console.log("")
  console.log(`Showing ${preview.length} of ${result.plan.length} groups`)
  console.log("")

  for (const group of preview) {
    console.log(formatPlanLine(group))
  }
}

main()
  .catch((error) => {
    console.error("Duplicate referral recoding failed")
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end().catch(() => {})
  })
