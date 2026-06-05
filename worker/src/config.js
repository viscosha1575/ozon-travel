import dotenv from "dotenv";

dotenv.config({ path: "../.env" });

function normalizeBaseUrl(value, fallbackValue) {
  return String(value || fallbackValue || "").trim().replace(/\/$/, "");
}

function parseBoolean(value, fallbackValue = false) {
  if (value == null || value === "") {
    return fallbackValue;
  }

  return String(value).trim().toLowerCase() === "true";
}

export const REDIS_URL = String(process.env.REDIS_URL || "redis://redis:6379").trim();
export const GAME_API_URL = normalizeBaseUrl(process.env.GAME_API_URL, "http://backend:3001");
export const REQUEST_BODY_SECRET = String(process.env.REQUEST_BODY_SECRET || "").trim();
export const REQUIRE_ENCRYPTED_REQUESTS = parseBoolean(process.env.REQUIRE_ENCRYPTED_REQUESTS, false);
export const MAX_INTERNAL_BROADCAST_URL = normalizeBaseUrl(
  process.env.MAX_INTERNAL_BROADCAST_URL,
  "http://max-bot:3011/internal/broadcast/send",
);
export const MAX_INTERNAL_BROADCAST_DELETE_URL = normalizeBaseUrl(
  process.env.MAX_INTERNAL_BROADCAST_DELETE_URL,
  "http://max-bot:3011/internal/broadcast/delete",
);
export const BROADCAST_INTERNAL_TOKEN = String(
  process.env.BROADCAST_INTERNAL_TOKEN || process.env.REQUEST_BODY_SECRET || "",
).trim();
export const GAME_WEBAPP_URL = String(
  process.env.GAME_WEBAPP_URL || "https://max.ru/ozontravel_lenta_bot?startapp",
).trim();
export const DAILY_ATTEMPT_REMINDER_ENABLED = parseBoolean(process.env.DAILY_ATTEMPT_REMINDER_ENABLED, true);
export const DAILY_ATTEMPT_GRANT_ENABLED = parseBoolean(process.env.DAILY_ATTEMPT_GRANT_ENABLED, true);
export const DAILY_ATTEMPT_GRANT_CRON = String(process.env.DAILY_ATTEMPT_GRANT_CRON || "0 0 0 * * *").trim();
export const DAILY_ATTEMPT_REMINDER_CRON = String(process.env.DAILY_ATTEMPT_REMINDER_CRON || "0 0 12 * * *").trim();
export const DAILY_ATTEMPT_TIMEZONE = String(process.env.DAILY_ATTEMPT_TIMEZONE || "Europe/Moscow").trim();
export const DAILY_ATTEMPT_REMINDER_BATCH_SIZE = Math.min(
  5000,
  Math.max(10, Number(process.env.DAILY_ATTEMPT_REMINDER_BATCH_SIZE || 500) || 500),
);
export const NOTIFICATION_SEND_CONCURRENCY = Math.min(
  200,
  Math.max(1, Number(process.env.NOTIFICATION_SEND_CONCURRENCY || 20) || 20),
);
export const NOTIFICATION_SEND_LIMIT_MAX = Math.min(
  1000,
  Math.max(1, Number(process.env.NOTIFICATION_SEND_LIMIT_MAX || 20) || 20),
);
export const NOTIFICATION_SEND_LIMIT_DURATION_MS = Math.max(
  1000,
  Number(process.env.NOTIFICATION_SEND_LIMIT_DURATION_MS || 1000) || 1000,
);
export const NOTIFICATION_SEND_ATTEMPTS = Math.min(
  20,
  Math.max(1, Number(process.env.NOTIFICATION_SEND_ATTEMPTS || 5) || 5),
);
export const NOTIFICATION_SEND_BACKOFF_MS = Math.max(
  1000,
  Number(process.env.NOTIFICATION_SEND_BACKOFF_MS || 30000) || 30000,
);
export const MANUAL_PUSH_JOB_CONCURRENCY = Math.min(
  10,
  Math.max(1, Number(process.env.MANUAL_PUSH_JOB_CONCURRENCY || 1) || 1),
);
export const MANUAL_PUSH_SEND_CONCURRENCY = Math.min(
  200,
  Math.max(1, Number(process.env.MANUAL_PUSH_SEND_CONCURRENCY || 20) || 20),
);
export const MANUAL_PUSH_REVOKE_CONCURRENCY = Math.min(
  200,
  Math.max(1, Number(process.env.MANUAL_PUSH_REVOKE_CONCURRENCY || 20) || 20),
);
export const DAILY_ATTEMPT_REMINDER_BANNER_PATH = String(
  process.env.DAILY_ATTEMPT_REMINDER_BANNER_PATH || "public/banner.mp4",
).trim();
