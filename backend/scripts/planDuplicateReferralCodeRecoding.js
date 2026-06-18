import { pool, query } from "../src/db.js"

const SUPPORTED_CLASSIFICATIONS = new Set([
  "no_traffic",
  "single_owner_traffic",
])

function parseArgs(argv = []) {
  const options = {
    format: "text",
    classification: "no_traffic",
    limit: 100,
  }

  for (const arg of argv) {
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

function selectCanonicalOwner(group, classification) {
  const owners = [...group.owners]

  if (classification === "single_owner_traffic") {
    return owners.sort(compareByTrafficPriority)[0] || null
  }

  return owners.sort(compareByCreatedAt)[0] || null
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

async function loadExistingReferralCodes() {
  const result = await query(`
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

  return [...grouped.values()].map((group) => ({
    ...group,
    classification: classifyGroup(group.owners),
  }))
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

function buildCanonicalReason(group, canonicalOwner, classification) {
  if (classification === "single_owner_traffic") {
    return [
      "kept because this owner already has referral traffic",
      `linked=${canonicalOwner.linkedReferralsCount}`,
      `bonus=${canonicalOwner.referralBonusCount}`,
    ].join(", ")
  }

  return [
    "kept because this is the earliest owner in a no-traffic group",
    `createdAt=${canonicalOwner.createdAt}`,
  ].join(", ")
}

function buildPlan(groups, existingCodes, classification) {
  return groups
    .filter((group) => group.classification === classification)
    .map((group) => {
      const canonicalOwner = selectCanonicalOwner(group, classification)
      const recodes = group.owners
        .filter((owner) => owner.userId !== canonicalOwner?.userId)
        .sort(compareByCreatedAt)
        .map((owner) => ({
          userId: owner.userId,
          platform: owner.platform,
          platformUserId: owner.platformUserId,
          currentReferralCode: group.referralCode,
          proposedReferralCode: allocateUniqueReferralCode(owner, existingCodes),
          linkedReferralsCount: owner.linkedReferralsCount,
          referralBonusCount: owner.referralBonusCount,
          createdAt: owner.createdAt,
        }))

      return {
        referralCode: group.referralCode,
        classification,
        ownersCount: group.ownersCount,
        canonicalOwner: canonicalOwner
          ? {
            ...canonicalOwner,
            currentReferralCode: group.referralCode,
            keepReason: buildCanonicalReason(group, canonicalOwner, classification),
          }
          : null,
        recodes,
      }
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

function formatPlanLine(group) {
  const canonical = group.canonicalOwner
    ? `keep ${group.canonicalOwner.userId}:${group.canonicalOwner.platform}:${group.canonicalOwner.platformUserId}`
    : "keep none"
  const recodes = group.recodes.map((item) => (
    `${item.userId}:${item.platform}:${item.platformUserId} -> ${item.proposedReferralCode}`
  )).join(" | ")

  return [
    group.referralCode,
    `owners=${group.ownersCount}`,
    canonical,
    recodes || "no recodes",
  ].join(" | ")
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const [groups, existingCodes] = await Promise.all([
    loadDuplicateGroups(),
    loadExistingReferralCodes(),
  ])
  const plan = buildPlan(groups, existingCodes, options.classification)
  const summary = summarizePlan(plan)
  const preview = plan.slice(0, options.limit)

  if (options.format === "json") {
    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      classification: options.classification,
      summary,
      totalMatchingGroups: plan.length,
      groups: preview,
    }, null, 2))
    return
  }

  console.log("Duplicate referral recoding plan")
  console.log(`Generated at: ${new Date().toISOString()}`)
  console.log(`Classification: ${options.classification}`)
  console.log(`Matching groups: ${summary.groups}`)
  console.log(`Users to recode: ${summary.recodes}`)
  console.log("")
  console.log(`Showing ${preview.length} of ${plan.length} planned groups`)
  console.log("")

  for (const group of preview) {
    console.log(formatPlanLine(group))
  }
}

main()
  .catch((error) => {
    console.error("Duplicate referral recoding plan failed")
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end().catch(() => {})
  })
