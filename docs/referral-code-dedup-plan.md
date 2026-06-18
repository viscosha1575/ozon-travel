# Referral Code Dedup Plan

## Goal

Safely remove historical duplicate `app_users.referral_code` values without breaking:

- existing `referred_by_user_id` links
- already recorded `referral_bonus` transactions
- current user balances

## Current production shape

- Duplicate groups: `678`
- Users in duplicate groups: `1364`
- Pair groups: `670`
- Triple groups: `8`
- Groups with any referral bonus traffic: `108`
- No-traffic groups: `558`
- Single-owner-traffic groups: `115`
- Multi-owner-traffic groups: `5`

All currently known duplicates are legacy-format codes: `OZONTRAVEL-XXXXXX`.

## Dry-run audit

Run from `backend/`:

```bash
npm run referrals:audit-dupes
```

Useful filters:

```bash
npm run referrals:audit-dupes -- --classification=no_traffic --limit=20
npm run referrals:audit-dupes -- --classification=single_owner_traffic --limit=50
npm run referrals:audit-dupes -- --classification=multi_owner_traffic --json
```

Build a dry-run recoding plan:

```bash
npm run referrals:plan-recodes
npm run referrals:plan-recodes -- --classification=no_traffic --limit=100
npm run referrals:plan-recodes -- --classification=single_owner_traffic --json
```

By default the planner targets `no_traffic` groups only.

Prepare or apply the safe write migration:

```bash
npm run referrals:apply-no-traffic-recodes
npm run referrals:apply-no-traffic-recodes -- --json
npm run referrals:apply-no-traffic-recodes -- --apply
npm run referrals:apply-no-traffic-recodes -- --classification=single_owner_traffic
```

Important:

- this script supports only `no_traffic` and `single_owner_traffic`
- default mode is dry-run
- real DB writes happen only with `--apply`

Check readiness for the final DB-level uniqueness guarantee:

```bash
npm run referrals:finalize-uniqueness
npm run referrals:finalize-uniqueness -- --json
npm run referrals:finalize-uniqueness -- --apply
```

This finalizer:

- refuses to create the index while any duplicate group still exists
- creates a partial unique index only after cleanup is complete

## Recommended migration phases

### Phase 1. Freeze future collisions

Already done in code:

- new users receive unique referral codes with a random suffix

Still missing at DB level:

- add a unique index on `app_users(referral_code)` after data cleanup

### Phase 2. Auto-fix safe duplicate groups

Target:

- `no_traffic`

Rule:

- keep the duplicate code on the canonical owner
- generate fresh unique codes for all other owners in the group

Canonical owner suggestion:

- earliest `created_at`

This phase should not move any referrals or transactions.

Dry-run planner:

```bash
npm run referrals:plan-recodes -- --classification=no_traffic
```

Write migration:

```bash
npm run referrals:apply-no-traffic-recodes
npm run referrals:apply-no-traffic-recodes -- --apply
```

### Phase 3. Auto-fix low-risk groups with traffic on exactly one owner

Target:

- `single_owner_traffic`

Rule:

- keep the duplicate code on the owner that already has linked referrals or referral bonuses
- generate fresh unique codes for all other owners

This phase should usually avoid moving historical data.

Dry-run planner:

```bash
npm run referrals:plan-recodes -- --classification=single_owner_traffic
```

Write migration:

```bash
npm run referrals:apply-no-traffic-recodes -- --classification=single_owner_traffic
npm run referrals:apply-no-traffic-recodes -- --classification=single_owner_traffic --apply
```

### Phase 4. Manual review for contested groups

Target:

- `multi_owner_traffic`

These groups already have traffic on multiple owners, so they need case-by-case handling.

Manual review checklist:

1. Compare owners by `created_at`
2. Compare `linked_referrals_count`
3. Compare `referral_bonus_count`
4. Inspect invited users and `details->>'referralCode'`
5. Decide whether to:
   - leave history as-is and only reissue future codes
   - or move specific `referred_by_user_id` links and `referral_bonus` rows

## Before applying DB writes

For every migration batch:

1. dump affected owners
2. dump affected invited users
3. dump affected `referral_bonus` rows
4. write results to a timestamped audit file

## After cleanup

Required follow-up:

1. verify zero duplicate groups remain
2. add unique index on `app_users(referral_code)` using the finalizer
3. rerun the dry-run report
4. spot-check users from previously affected high-traffic groups

Current blocker before the final unique index:

- `OZONTRAVEL-083256`
