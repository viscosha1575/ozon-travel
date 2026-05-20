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
      total_count INTEGER NOT NULL DEFAULT 0,
      remaining_count INTEGER NOT NULL DEFAULT 0,
      chance_value TEXT NOT NULL DEFAULT '1x',
      has_user_limit BOOLEAN NOT NULL DEFAULT TRUE,
      user_limit_count INTEGER NOT NULL DEFAULT 0,
      active_from DATE NULL,
      active_to DATE NULL,
      roulette_image JSONB NULL,
      my_prize_text TEXT NOT NULL DEFAULT '',
      roulette_description TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id BIGSERIAL PRIMARY KEY,
      external_id TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL DEFAULT '',
      first_name TEXT NOT NULL DEFAULT '',
      last_name TEXT NOT NULL DEFAULT '',
      language_code TEXT NOT NULL DEFAULT '',
      start_param TEXT NOT NULL DEFAULT '',
      referred_by_user_id BIGINT NULL REFERENCES app_users(id) ON DELETE SET NULL,
      referral_code TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
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
          roulette_image,
          my_prize_text,
          roulette_description
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18, $19
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
        item.rouletteImage ? JSON.stringify(item.rouletteImage) : null,
        item.myPrizeText,
        item.rouletteDescription,
      ],
    );
  }
}

export async function initDatabase() {
  await ensureSchema();
  await seedPrizesIfEmpty();
}
