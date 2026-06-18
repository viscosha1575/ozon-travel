import { pool, query } from "../src/db.js"

const INDEX_NAME = "app_users_referral_code_unique_idx"

function parseArgs(argv = []) {
  return {
    apply: argv.includes("--apply"),
    format: argv.includes("--json") ? "json" : "text",
  }
}

async function loadDuplicateGroups() {
  const result = await query(`
    SELECT
      referral_code,
      COUNT(*)::int AS owners_count,
      STRING_AGG(
        CONCAT(id, ':', platform, ':', platform_user_id),
        ' | '
        ORDER BY created_at ASC, id ASC
      ) AS owners
    FROM app_users
    WHERE referral_code <> ''
    GROUP BY referral_code
    HAVING COUNT(*) > 1
    ORDER BY referral_code ASC
  `)

  return result.rows.map((row) => ({
    referralCode: String(row.referral_code || ""),
    ownersCount: Number(row.owners_count || 0),
    owners: String(row.owners || ""),
  }))
}

async function loadIndexStatus() {
  const result = await query(`
    SELECT
      indexname,
      indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = $1
    LIMIT 1
  `, [INDEX_NAME])

  const row = result.rows[0]

  return {
    exists: Boolean(row),
    name: row?.indexname || INDEX_NAME,
    definition: row?.indexdef || "",
  }
}

async function createUniqueIndex() {
  await pool.query(`
    CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ${INDEX_NAME}
    ON app_users (referral_code)
    WHERE referral_code <> ''
  `)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const [duplicateGroups, indexStatusBefore] = await Promise.all([
    loadDuplicateGroups(),
    loadIndexStatus(),
  ])
  const isReady = duplicateGroups.length === 0

  if (options.apply && !isReady) {
    const error = new Error("Cannot create unique index while duplicate referral codes still exist")
    error.code = "REFERRAL_CODE_DUPLICATES_REMAIN"
    error.duplicateGroups = duplicateGroups
    throw error
  }

  if (options.apply && !indexStatusBefore.exists) {
    await createUniqueIndex()
  }

  const indexStatusAfter = options.apply
    ? await loadIndexStatus()
    : indexStatusBefore
  const payload = {
    generatedAt: new Date().toISOString(),
    mode: options.apply ? "apply" : "dry-run",
    readyForUniqueIndex: isReady,
    duplicateGroupsCount: duplicateGroups.length,
    duplicateGroups,
    index: indexStatusAfter,
  }

  if (options.format === "json") {
    console.log(JSON.stringify(payload, null, 2))
    return
  }

  console.log("Referral code uniqueness finalizer")
  console.log(`Generated at: ${payload.generatedAt}`)
  console.log(`Mode: ${payload.mode}`)
  console.log(`Ready for unique index: ${payload.readyForUniqueIndex ? "yes" : "no"}`)
  console.log(`Duplicate groups remaining: ${payload.duplicateGroupsCount}`)
  console.log(`Index exists: ${payload.index.exists ? "yes" : "no"}`)

  if (payload.index.definition) {
    console.log(`Index definition: ${payload.index.definition}`)
  }

  if (duplicateGroups.length > 0) {
    console.log("")
    console.log("Remaining duplicate groups:")

    for (const group of duplicateGroups) {
      console.log(`${group.referralCode} | owners=${group.ownersCount} | ${group.owners}`)
    }
  }
}

main()
  .catch((error) => {
    console.error("Referral code uniqueness finalization failed")
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end().catch(() => {})
  })
