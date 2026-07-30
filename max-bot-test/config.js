import dotenv from 'dotenv';

dotenv.config({ path: '../.env' });

function parsePositiveInt(value, fallbackValue) {
  const normalizedValue = Number(value);

  if (!Number.isFinite(normalizedValue) || normalizedValue <= 0) {
    return fallbackValue;
  }

  return Math.round(normalizedValue);
}

export const MAX_BOT_TOKEN = process.env.MAX_BOT_TOKEN || '';
export const MAX_CHANNEL_URL = process.env.MAX_CHANNEL_URL || 'https://max.ru/ozontravel_official';
export const MAX_CHANNEL_CHAT_ID = process.env.MAX_CHANNEL_CHAT_ID || '';
export const MAX_BANK_CHANNEL_URL = process.env.MAX_BANK_CHANNEL_URL || 'https://max.ru/ozonbank';
export const MAX_BANK_CHANNEL_CHAT_ID = process.env.MAX_BANK_CHANNEL_CHAT_ID || '';
export const GAME_WEBAPP_URL = process.env.GAME_WEBAPP_URL || 'https://max.ru/ozontravel_lenta_bot?startapp';
export const SUPPORT_CONTACT = process.env.SUPPORT_CONTACT || '@ozon_travel_max_support';
export const MAX_API_REQUESTS_PER_SECOND = Math.min(
  25,
  Math.max(1, parsePositiveInt(process.env.MAX_API_REQUESTS_PER_SECOND, 25)),
);
export const MAX_ATTACHMENT_CACHE_TTL_MS = Math.max(
  60_000,
  parsePositiveInt(process.env.MAX_ATTACHMENT_CACHE_TTL_MS, 24 * 60 * 60 * 1000),
);
export const MAX_ATTACHMENT_READY_DELAY_MS = Math.max(
  0,
  parsePositiveInt(process.env.MAX_ATTACHMENT_READY_DELAY_MS, 2_000),
);
