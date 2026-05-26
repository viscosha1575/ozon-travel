import dotenv from 'dotenv';

dotenv.config({ path: '../.env' });

export const MAX_BOT_TOKEN = process.env.MAX_BOT_TOKEN || '';
export const MAX_CHANNEL_URL = process.env.MAX_CHANNEL_URL || 'https://max.ru/ozontravel_officia';
export const MAX_CHANNEL_CHAT_ID = process.env.MAX_CHANNEL_CHAT_ID || '';
export const GAME_WEBAPP_URL = process.env.GAME_WEBAPP_URL || 'https://ozon-travel-max.ru';
export const SUPPORT_CONTACT = process.env.SUPPORT_CONTACT || '@ozon_travel_max_support';
