import { MAX_CHANNEL_CHAT_ID, MAX_CHANNEL_URL } from '../config.js';
import { bot } from '../maxInstance.js';
import { setSubscriptionStatus } from './userService.js';
import logger from '../utils/logger.js';

const MAX_SUBSCRIPTION_CHECK_MODE = String(process.env.MAX_SUBSCRIPTION_CHECK_MODE || 'api')
  .trim()
  .toLowerCase();

let cachedChannelChatId = Number(MAX_CHANNEL_CHAT_ID) || null;

function normalizeMaxChatLink(value) {
  const normalizedValue = String(value || '').trim();

  if (!normalizedValue) {
    return '';
  }

  try {
    const parsedUrl = new URL(normalizedValue);

    if (parsedUrl.hostname !== 'max.ru') {
      return normalizedValue;
    }

    return parsedUrl.pathname.replace(/^\/+/, '').split('/')[0] || '';
  } catch {
    return normalizedValue
      .replace(/^https?:\/\/max\.ru\/?/i, '')
      .replace(/^\/+/, '')
      .split('/')[0]
      .trim();
  }
}

async function resolveChannelChatId() {
  if (cachedChannelChatId) {
    return cachedChannelChatId;
  }

  const channelLink = normalizeMaxChatLink(MAX_CHANNEL_URL);

  if (!channelLink) {
    throw new Error(`MAX channel link is empty: ${MAX_CHANNEL_URL}`);
  }

  const chat = await bot.api.getChatByLink(channelLink);
  cachedChannelChatId = Number(chat?.chat_id) || null;

  if (!cachedChannelChatId) {
    throw new Error(`Failed to resolve MAX channel chat id for ${MAX_CHANNEL_URL}`);
  }

  return cachedChannelChatId;
}

export async function checkChannelSubscription(userId) {
  if (MAX_SUBSCRIPTION_CHECK_MODE === 'mock') {
    logger.info('MAX subscription check is mocked', {
      userId,
    });
    return true;
  }

  const channelChatId = await resolveChannelChatId();
  const response = await bot.api.getChatMembers(channelChatId, {
    user_ids: [Number(userId)],
    count: 1,
  });
  const members = Array.isArray(response?.members) ? response.members : [];

  return members.some((member) => String(member.user_id) === String(userId));
}

export async function refreshSubscriptionStatus(userId, { source = 'unknown' } = {}) {
  if (!userId) {
    return false;
  }

  const isSubscribed = await checkChannelSubscription(userId);

  await setSubscriptionStatus({
    maxUserId: userId,
    isSubscribed,
  });

  logger.info('MAX subscription status refreshed', {
    userId,
    isSubscribed,
    source,
  });

  return isSubscribed;
}
