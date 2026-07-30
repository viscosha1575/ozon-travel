import {
  MAX_BANK_CHANNEL_CHAT_ID,
  MAX_BANK_CHANNEL_URL,
  MAX_CHANNEL_CHAT_ID,
  MAX_CHANNEL_URL,
} from '../config.js';
import { bot } from '../maxInstance.js';
import { setSubscriptionStatus } from './userService.js';
import logger from '../utils/logger.js';

const MAX_SUBSCRIPTION_CHECK_MODE = String(process.env.MAX_SUBSCRIPTION_CHECK_MODE || 'api')
  .trim()
  .toLowerCase();

const channels = [
  {
    name: 'Ozon Travel',
    url: MAX_CHANNEL_URL,
    chatId: Number(MAX_CHANNEL_CHAT_ID) || null,
  },
  {
    name: 'Ozon Банк',
    url: MAX_BANK_CHANNEL_URL,
    chatId: Number(MAX_BANK_CHANNEL_CHAT_ID) || null,
  },
];

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

async function resolveChannelChatId(channel) {
  if (channel.chatId) {
    return channel.chatId;
  }

  const channelLink = normalizeMaxChatLink(channel.url);

  if (!channelLink) {
    throw new Error(`MAX channel link is empty: ${channel.url}`);
  }

  const chat = await bot.api.getChatByLink(channelLink);
  channel.chatId = Number(chat?.chat_id) || null;

  if (!channel.chatId) {
    throw new Error(`Failed to resolve MAX channel chat id for ${channel.url}`);
  }

  return channel.chatId;
}

export async function checkChannelSubscription(userId) {
  if (MAX_SUBSCRIPTION_CHECK_MODE === 'mock') {
    logger.info('MAX subscription check is mocked', {
      userId,
    });
    return true;
  }

  const subscriptionChecks = await Promise.all(channels.map(async (channel) => {
    const channelChatId = await resolveChannelChatId(channel);
    const response = await bot.api.getChatMembers(channelChatId, {
      user_ids: [Number(userId)],
      count: 1,
    });
    const members = Array.isArray(response?.members) ? response.members : [];
    const isSubscribed = members.some((member) => String(member.user_id) === String(userId));

    logger.info('MAX channel subscription checked', {
      userId,
      channel: channel.name,
      isSubscribed,
    });

    return isSubscribed;
  }));

  return subscriptionChecks.every(Boolean);
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
