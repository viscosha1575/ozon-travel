import dotenv from "dotenv";
import pg from "pg";

import { seedPrizes } from "./seedPrizes.js";

dotenv.config();

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || undefined,
  host: process.env.PGHOST || "postgres",
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
  database: process.env.PGDATABASE || "ozon_travel",
});

export async function query(text, params = []) {
  return pool.query(text, params);
}

export async function withTransaction(run) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function ensureSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS prize_positions (
      id BIGINT PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      promo_code_type TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL,
      has_prize_limit BOOLEAN NOT NULL DEFAULT TRUE,
      promo_codes_file_name TEXT NOT NULL DEFAULT '',
      promo_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
      promo_code_value TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      total_count INTEGER NOT NULL DEFAULT 0,
      remaining_count INTEGER NOT NULL DEFAULT 0,
      chance_value TEXT NOT NULL DEFAULT '1x',
      has_user_limit BOOLEAN NOT NULL DEFAULT TRUE,
      user_limit_count INTEGER NOT NULL DEFAULT 0,
      is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      active_from DATE NULL,
      active_to DATE NULL,
      roulette_image JSONB NULL,
      my_prize_text TEXT NOT NULL DEFAULT '',
      roulette_description TEXT NOT NULL DEFAULT '',
      roulette_descriptions JSONB NOT NULL DEFAULT '[]'::jsonb,
      roulette_description_2 TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    ALTER TABLE prize_positions
    ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0
  `);

  await query(`
    WITH ordered AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY sort_order ASC, id ASC) AS next_sort_order
      FROM prize_positions
    )
    UPDATE prize_positions
    SET sort_order = ordered.next_sort_order
    FROM ordered
    WHERE ordered.id = prize_positions.id
      AND (prize_positions.sort_order IS NULL OR prize_positions.sort_order <= 0)
  `);

  await query(`
    ALTER TABLE prize_positions
    ADD COLUMN IF NOT EXISTS roulette_descriptions JSONB NOT NULL DEFAULT '[]'::jsonb
  `);

  await query(`
    ALTER TABLE prize_positions
    ADD COLUMN IF NOT EXISTS roulette_description_2 TEXT NOT NULL DEFAULT ''
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id BIGSERIAL PRIMARY KEY,
      platform TEXT NOT NULL DEFAULT 'telegram',
      platform_user_id TEXT NOT NULL DEFAULT '',
      external_id TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL DEFAULT '',
      first_name TEXT NOT NULL DEFAULT '',
      last_name TEXT NOT NULL DEFAULT '',
      language_code TEXT NOT NULL DEFAULT '',
      start_param TEXT NOT NULL DEFAULT '',
      referred_by_user_id BIGINT NULL REFERENCES app_users(id) ON DELETE SET NULL,
      referral_code TEXT NOT NULL DEFAULT '',
      subscribed_to_channel BOOLEAN NOT NULL DEFAULT FALSE,
      subscribed_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'telegram'
  `);

  await query(`
    ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS platform_user_id TEXT NOT NULL DEFAULT ''
  `);

  await query(`
    ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS language_code TEXT NOT NULL DEFAULT ''
  `);

  await query(`
    ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS start_param TEXT NOT NULL DEFAULT ''
  `);

  await query(`
    ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS referred_by_user_id BIGINT NULL REFERENCES app_users(id) ON DELETE SET NULL
  `);

  await query(`
    ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS subscribed_to_channel BOOLEAN NOT NULL DEFAULT FALSE
  `);

  await query(`
    ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS subscribed_at TIMESTAMPTZ NULL
  `);

  await query(`
    ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS has_seen_game_controls_guide BOOLEAN NOT NULL DEFAULT TRUE
  `);

  await query(`
    ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS utm_slug TEXT NOT NULL DEFAULT ''
  `);

  await query(`
    UPDATE app_users
    SET
      platform = CASE
        WHEN external_id LIKE 'max:%' THEN 'max'
        ELSE 'telegram'
      END,
      platform_user_id = CASE
        WHEN external_id LIKE 'max:%' THEN SUBSTRING(external_id FROM 5)
        ELSE external_id
      END
    WHERE COALESCE(TRIM(platform_user_id), '') = ''
       OR COALESCE(TRIM(platform), '') = ''
       OR (
         external_id LIKE 'max:%'
         AND (
           platform <> 'max'
           OR platform_user_id <> SUBSTRING(external_id FROM 5)
         )
       )
       OR (
         external_id NOT LIKE 'max:%'
         AND (
           platform <> 'telegram'
           OR platform_user_id <> external_id
         )
       )
  `);

  await query(`
    UPDATE app_users
    SET subscribed_at = COALESCE(subscribed_at, updated_at)
    WHERE subscribed_to_channel = TRUE
      AND subscribed_at IS NULL
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS app_users_platform_user_id_unique_idx
    ON app_users (platform, platform_user_id)
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS awarded_prizes (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      prize_id BIGINT REFERENCES prize_positions(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      promo_code TEXT NOT NULL DEFAULT '',
      image JSONB NULL,
      expires_at TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS prize_promo_codes (
      id BIGSERIAL PRIMARY KEY,
      prize_id BIGINT NOT NULL REFERENCES prize_positions(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      available_from TIMESTAMPTZ NULL,
      awarded_prize_id BIGINT NULL REFERENCES awarded_prizes(id) ON DELETE SET NULL,
      claimed_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS prize_promo_codes_prize_id_code_unique_idx
    ON prize_promo_codes (prize_id, code)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS prize_promo_codes_prize_id_available_idx
    ON prize_promo_codes (prize_id, available_from, claimed_at)
  `);

  await query(`
    ALTER TABLE prize_positions
    ADD COLUMN IF NOT EXISTS code_release_start TIMESTAMPTZ NULL
  `);

  await query(`
    ALTER TABLE prize_positions
    ADD COLUMN IF NOT EXISTS code_release_end TIMESTAMPTZ NULL
  `);

  await query(`
    ALTER TABLE prize_positions
    ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT TRUE
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS game_event_logs (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL DEFAULT '',
      event_name TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'frontend',
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS game_event_logs_user_id_idx
    ON game_event_logs (user_id, created_at DESC)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS game_event_logs_session_id_idx
    ON game_event_logs (session_id, created_at DESC)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS game_event_logs_event_name_idx
    ON game_event_logs (event_name, created_at DESC)
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS user_events (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      source TEXT NOT NULL,
      action TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS user_events_created_at_idx
    ON user_events (created_at DESC)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS user_events_action_created_at_idx
    ON user_events (action, created_at DESC)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS user_events_user_id_created_at_idx
    ON user_events (user_id, created_at DESC)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS user_events_source_created_at_idx
    ON user_events (source, created_at DESC)
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS analytics_daily (
      date DATE NOT NULL,
      metric TEXT NOT NULL,
      value BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (date, metric)
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS analytics_daily_metric_date_idx
    ON analytics_daily (metric, date DESC)
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS analytics_hourly (
      date DATE NOT NULL,
      hour SMALLINT NOT NULL,
      metric TEXT NOT NULL,
      value BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (date, hour, metric)
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS analytics_hourly_metric_date_hour_idx
    ON analytics_hourly (metric, date DESC, hour DESC)
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS analytics_metric_users (
      date DATE NOT NULL,
      metric TEXT NOT NULL,
      user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (date, metric, user_id)
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS analytics_metric_users_metric_date_idx
    ON analytics_metric_users (metric, date DESC)
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS analytics_daily_user_metrics (
      date DATE NOT NULL,
      user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      metric TEXT NOT NULL,
      value BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (date, user_id, metric)
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS analytics_daily_user_metrics_metric_date_idx
    ON analytics_daily_user_metrics (metric, date DESC)
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS daily_active_users (
      date DATE NOT NULL,
      user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (date, user_id)
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS daily_active_users_date_idx
    ON daily_active_users (date DESC)
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS game_sessions (
      user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL,
      finished_at TIMESTAMPTZ NULL,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      start_date DATE NOT NULL,
      start_hour SMALLINT NOT NULL,
      finish_date DATE NULL,
      finish_hour SMALLINT NULL,
      PRIMARY KEY (user_id, session_id)
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS game_sessions_start_date_idx
    ON game_sessions (start_date DESC, started_at DESC)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS game_sessions_finish_date_idx
    ON game_sessions (finish_date DESC, finished_at DESC)
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS analytics_runtime_state (
      state_key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS user_attempt_transactions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      delta INTEGER NOT NULL,
      reason TEXT NOT NULL,
      attempt_date DATE NULL,
      related_user_id BIGINT NULL REFERENCES app_users(id) ON DELETE SET NULL,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS user_attempt_transactions_user_id_idx
    ON user_attempt_transactions (user_id, created_at DESC)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS user_attempt_transactions_reason_idx
    ON user_attempt_transactions (reason, created_at DESC)
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS user_attempt_transactions_daily_unique_idx
    ON user_attempt_transactions (user_id, reason, attempt_date)
    WHERE attempt_date IS NOT NULL
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS user_attempt_transactions_referral_unique_idx
    ON user_attempt_transactions (user_id, reason, related_user_id)
    WHERE related_user_id IS NOT NULL
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS notification_deliveries (
      id BIGSERIAL PRIMARY KEY,
      notification_key TEXT NOT NULL,
      reminder_date DATE NOT NULL,
      user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'queued',
      message_id TEXT NOT NULL DEFAULT '',
      attempts INTEGER NOT NULL DEFAULT 0,
      error_message TEXT NOT NULL DEFAULT '',
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      sent_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(notification_key, reminder_date, user_id)
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS notification_deliveries_status_idx
    ON notification_deliveries (notification_key, reminder_date, status, created_at DESC)
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS utm_visits (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      utm_slug TEXT NOT NULL,
      session_id TEXT NOT NULL DEFAULT '',
      raw_start_param TEXT NOT NULL DEFAULT '',
      referral_code TEXT NOT NULL DEFAULT '',
      was_existing_player BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS utm_visits_utm_slug_idx
    ON utm_visits (utm_slug, created_at DESC)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS utm_visits_user_id_idx
    ON utm_visits (user_id, created_at DESC)
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS utm_visits_user_session_slug_unique_idx
    ON utm_visits (user_id, session_id, utm_slug)
    WHERE session_id <> ''
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS push_campaigns (
      id BIGSERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      html TEXT NOT NULL DEFAULT '',
      audience_key TEXT NOT NULL DEFAULT 'all_users',
      audience_label TEXT NOT NULL DEFAULT 'Все пользователи',
      selected_users JSONB NOT NULL DEFAULT '[]'::jsonb,
      image JSONB NULL,
      status TEXT NOT NULL DEFAULT 'template',
      recipients_count INTEGER NOT NULL DEFAULT 0,
      delivered_count INTEGER NOT NULL DEFAULT 0,
      opened_count INTEGER NOT NULL DEFAULT 0,
      clicked_count INTEGER NOT NULL DEFAULT 0,
      test_sent_at TIMESTAMPTZ NULL,
      scheduled_at TIMESTAMPTZ NULL,
      sent_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS push_campaigns_status_idx
    ON push_campaigns (status, created_at DESC)
  `);

  await query(`
    ALTER TABLE push_campaigns
    ADD COLUMN IF NOT EXISTS disable_link_preview BOOLEAN NOT NULL DEFAULT FALSE
  `);

  await query(`
    ALTER TABLE push_campaigns
    ADD COLUMN IF NOT EXISTS button_text TEXT NOT NULL DEFAULT ''
  `);

  await query(`
    ALTER TABLE push_campaigns
    ADD COLUMN IF NOT EXISTS button_url TEXT NOT NULL DEFAULT ''
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS push_deliveries (
      id BIGSERIAL PRIMARY KEY,
      campaign_id BIGINT NOT NULL REFERENCES push_campaigns(id) ON DELETE CASCADE,
      user_external_id TEXT NOT NULL DEFAULT '',
      max_user_id TEXT NOT NULL DEFAULT '',
      message_id BIGINT NULL,
      delivery_status TEXT NOT NULL DEFAULT 'sent',
      error_message TEXT NOT NULL DEFAULT '',
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS push_deliveries_campaign_id_idx
    ON push_deliveries (campaign_id, sent_at DESC)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS push_deliveries_message_id_idx
    ON push_deliveries (message_id)
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS app_runtime_settings (
      settings_key TEXT PRIMARY KEY,
      project_finished BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(
    `
      INSERT INTO app_runtime_settings (
        settings_key,
        project_finished
      )
      VALUES ('global', FALSE)
      ON CONFLICT (settings_key) DO NOTHING
    `,
  );
}

async function seedPrizesIfEmpty() {
  const existing = await query("SELECT COUNT(*)::int AS count FROM prize_positions");

  if (Number(existing.rows[0]?.count || 0) > 0) {
    return;
  }

  for (const item of seedPrizes) {
    await query(
      `
        INSERT INTO prize_positions (
          id,
          title,
          category,
          promo_code_type,
          type,
          has_prize_limit,
          promo_codes_file_name,
          promo_codes,
          promo_code_value,
          total_count,
          remaining_count,
          chance_value,
          has_user_limit,
          user_limit_count,
          active_from,
          active_to,
          code_release_start,
          code_release_end,
          roulette_image,
          my_prize_text,
          roulette_description,
          roulette_descriptions
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb, $20, $21, $22::jsonb
        )
      `,
      [
        item.id,
        item.title,
        item.category,
        item.promoCodeType,
        item.type,
        item.hasPrizeLimit,
        item.promoCodesFileName,
        JSON.stringify(item.promoCodes || []),
        item.promoCodeValue,
        item.totalCount,
        item.remainingCount,
        item.chanceValue,
        item.hasUserLimit,
        item.userLimitCount,
        item.activeFrom || null,
        item.activeTo || null,
        item.codeReleaseStart || null,
        item.codeReleaseEnd || null,
        item.rouletteImage ? JSON.stringify(item.rouletteImage) : null,
        item.myPrizeText,
        item.rouletteDescription,
        JSON.stringify(item.rouletteDescriptions || []),
      ],
    );
  }
}

async function seedPromoCodePoolFromExistingPrizes() {
  const prizesResult = await query(`
    SELECT
      id,
      promo_codes,
      code_release_start
    FROM prize_positions
    WHERE jsonb_array_length(promo_codes) > 0
  `);

  for (const row of prizesResult.rows) {
    const prizeId = Number(row.id);
    const existingPoolResult = await query(
      "SELECT COUNT(*)::int AS count FROM prize_promo_codes WHERE prize_id = $1",
      [prizeId],
    );

    if (Number(existingPoolResult.rows[0]?.count || 0) > 0) {
      continue;
    }

    const promoCodes = Array.isArray(row.promo_codes)
      ? row.promo_codes.map((item) => String(item || "").trim()).filter(Boolean)
      : [];

    if (!promoCodes.length) {
      continue;
    }

    const releaseAt = row.code_release_start || new Date().toISOString();

    await query(
      `
        INSERT INTO prize_promo_codes (
          prize_id,
          code,
          available_from
        )
        SELECT
          $1,
          item.code,
          $3::timestamptz
        FROM UNNEST($2::text[]) AS item(code)
        ON CONFLICT (prize_id, code) DO NOTHING
      `,
      [prizeId, promoCodes, releaseAt],
    );
  }
}

export async function initDatabase() {
  await ensureSchema();
  await seedPrizesIfEmpty();
  await seedPromoCodePoolFromExistingPrizes();
}
