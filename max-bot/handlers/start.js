import path from 'path';
import { fileURLToPath } from 'url';

import { bot, Keyboard } from '../maxInstance.js';
import {
  addUser,
  setSubscriptionStatus,
} from '../services/userService.js';
import { createMaxLog } from '../services/logService.js';
import {
  MAX_CHANNEL_URL,
  MAX_CHANNEL_CHAT_ID,
  GAME_WEBAPP_URL,
  SUPPORT_CONTACT,
} from '../config.js';
import { isChatDeniedError } from '../utils/maxErrors.js';
import logger from '../utils/logger.js';
import { parseStartParam } from '../utils/startParam.js';

const subscriptionKeyboard = Keyboard.inlineKeyboard([
  [Keyboard.button.link('Подписаться', MAX_CHANNEL_URL)],
  [Keyboard.button.callback('Проверить подписку', 'check_subscription')],
]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const START_BANNER_PATH = path.resolve(__dirname, '../public/banner1.png');
let startBannerAttachmentPromise = null;

function buildOpenAppButton(url) {
  const normalizedUrl = String(url || '').trim();
  const fallbackWebApp = 'ozontravel_lenta_bot';

  if (!normalizedUrl) {
    return {
      type: 'open_app',
      text: 'КРУТИТЬ ЛЕНТУ',
      web_app: fallbackWebApp,
    };
  }

  try {
    const parsedUrl = new URL(normalizedUrl);
    const webApp = parsedUrl.pathname.replace(/^\/+/, '').split('/')[0] || fallbackWebApp;
    const payload = String(parsedUrl.searchParams.get('startapp') || '').trim();
    const button = {
      type: 'open_app',
      text: 'КРУТИТЬ ЛЕНТУ',
      web_app: webApp,
    };

    if (payload) {
      button.payload = payload;
    }

    return button;
  } catch {
    return {
      type: 'open_app',
      text: 'КРУТИТЬ ЛЕНТУ',
      web_app: normalizedUrl.replace(/^@/, '') || fallbackWebApp,
    };
  }
}

const gameMenuKeyboard = Keyboard.inlineKeyboard([
  [buildOpenAppButton(GAME_WEBAPP_URL)],
  [Keyboard.button.callback('ПОДДЕРЖКА', 'show_support')],
]);

const welcomeMessage = [
  'Перед стартом подпишитесь на канал Ozon Travel.',
].join('\n');

const subscriptionMessage = [
  'Перед стартом подпишитесь на канал Ozon Travel.',
].join('\n');

const subscriptionRetryMessage =
  'Подписка пока не найдена. Подпишитесь на канал Ozon Travel и нажмите «Проверить подписку» еще раз.';

const menuMessage = [
  'Пора ловить призы!',
].join('\n');

const supportMessage = [
  'Поддержка проекта',
  '',
  'При возникновении вопросов обращайтесь в наш чат поддержки в МАКС:',
  '@ozon_travel_support_bot',
].join('\n');

let cachedChannelChatId = Number(MAX_CHANNEL_CHAT_ID) || null;
const MAX_SUBSCRIPTION_CHECK_MODE = String(process.env.MAX_SUBSCRIPTION_CHECK_MODE || 'api')
  .trim()
  .toLowerCase();

async function getStartBannerAttachment() {
  if (!startBannerAttachmentPromise) {
    startBannerAttachmentPromise = bot.api.uploadImage({
      source: START_BANNER_PATH,
    });
  }

  return startBannerAttachmentPromise;
}

async function safeReply(ctx, message, options, context) {
  try {
    return await ctx.reply(message, options);
  } catch (error) {
    if (isChatDeniedError(error)) {
      const { userId } = extractUser(ctx);
      logger.warn('Skipping reply to suspended MAX dialog', {
        context,
        userId,
        error: error.response?.data || error.message,
      });
      return null;
    }

    throw error;
  }
}

function getMessageText(ctx) {
  return (
    ctx?.message?.body?.text ||
    ctx?.update?.message?.body?.text ||
    ''
  );
}

function getSender(ctx) {
  return (
    ctx?.callback?.user ||
    ctx?.update?.callback?.user ||
    ctx?.message?.sender ||
    ctx?.update?.message?.sender ||
    ctx?.sender ||
    ctx?.user ||
    {}
  );
}

function getStringValue(...values) {
  const value = values.find((item) => item !== undefined && item !== null && item !== '');
  return value === undefined || value === null ? '' : String(value);
}

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

function extractUser(ctx) {
  const sender = getSender(ctx);
  const userId = getStringValue(
    sender.user_id,
    sender.userId,
    sender.id,
    sender.uid,
    ctx?.user?.user_id,
  );
  const username = getStringValue(
    sender.username,
    sender.name,
    sender.login,
  );
  const firstName = getStringValue(
    sender.first_name,
    sender.firstName,
    sender.display_name,
  );
  const lastName = getStringValue(
    sender.last_name,
    sender.lastName,
  );

  return {
    userId,
    username,
    firstName,
    lastName,
  };
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

async function checkChannelSubscription(userId) {
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

async function refreshSubscriptionStatus(userId, { source = 'unknown' } = {}) {
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

async function registerUser(ctx, { logEntry = true } = {}) {
  const { userId, username, firstName, lastName } = extractUser(ctx);
  const rawStartParam = getMessageText(ctx).trim().split(/\s+/)[1] || '';
  const parsedStartParam = parseStartParam(rawStartParam);

  if (logEntry) {
    logger.info('MAX user entered start flow', {
      userId,
      username,
      referralCode: parsedStartParam.referralCode,
      utmSlug: parsedStartParam.utmSlug,
      startParam: parsedStartParam.raw,
    });
  }

  if (!userId) {
    logger.warn('MAX sender id was not found in update');
    return { ok: false, user: null };
  }

  try {
    const addUserResult = await addUser({
      maxUserId: userId,
      username,
      firstName,
      lastName,
      startParam: parsedStartParam.raw,
    });
    await createMaxLog({
      maxUserId: userId,
      eventType: 'command',
      eventName: 'start',
      metadata: {
        username,
        referralCode: parsedStartParam.referralCode,
        utmSlug: parsedStartParam.utmSlug,
        startParam: parsedStartParam.raw,
      },
    });
    return {
      ok: true,
      user: addUserResult?.user || null,
    };
  } catch (error) {
    logger.error('MAX addUser failed', {
      userId,
      error: error.response?.data || error.message,
    });
    return { ok: false, user: null };
  }
}

async function sendStartStep(ctx) {
  const registrationResult = await registerUser(ctx);
  const { userId } = extractUser(ctx);

  if (!registrationResult?.ok) {
    await safeReply(ctx, welcomeMessage, {
      attachments: [subscriptionKeyboard],
    }, 'sendStartStep:registration-missing');
    return;
  }

  try {
    const isSubscribed = await refreshSubscriptionStatus(userId, {
      source: 'start',
    });

    if (isSubscribed) {
      await sendGameMenu(ctx);
      return;
    }
  } catch (error) {
    logger.error('MAX start subscription refresh failed', {
      userId,
      error: error.response?.data || error.message,
    });
  }

  if (registrationResult?.user?.subscribedToChannel && MAX_SUBSCRIPTION_CHECK_MODE === 'mock') {
    await sendGameMenu(ctx);
    return;
  }

  await safeReply(ctx, welcomeMessage, {
    attachments: [subscriptionKeyboard],
  }, 'sendStartStep');
}

async function sendSubscriptionStep(ctx) {
  await safeReply(ctx, subscriptionMessage, {
    attachments: [subscriptionKeyboard],
  }, 'sendSubscriptionStep');
}

async function sendGameMenu(ctx) {
  const attachments = [];

  try {
    const bannerAttachment = await getStartBannerAttachment();

    if (bannerAttachment) {
      attachments.push(bannerAttachment.toJson());
    }
  } catch (error) {
    logger.warn('Failed to upload MAX start banner', {
      error: error?.response?.data || error?.message || String(error),
      bannerPath: START_BANNER_PATH,
    });
  }

  attachments.push(gameMenuKeyboard);

  await safeReply(ctx, menuMessage, {
    attachments,
  }, 'sendGameMenu');
}

bot.on('bot_started', sendStartStep);
bot.command('start', sendStartStep);
bot.command('menu', async (ctx) => {
  await sendGameMenu(ctx);
});
bot.command('support', async (ctx) => {
  await safeReply(ctx, supportMessage, undefined, 'command:support');
});

bot.action('show_support', async (ctx) => {
  const { userId } = extractUser(ctx);

  await createMaxLog({
    maxUserId: userId,
    eventType: 'click',
    eventName: 'show_support',
  });

  await ctx.answerOnCallback({
    notification: 'Отправили контакты поддержки',
  });
  await safeReply(ctx, supportMessage, undefined, 'action:show_support');
});

bot.action('check_subscription', async (ctx) => {
  const { userId } = extractUser(ctx);

  try {
    const registered = await registerUser(ctx, { logEntry: false });

    if (!registered?.ok) {
      await ctx.answerOnCallback({
        notification: 'Не удалось проверить профиль. Нажми /start и попробуй снова.',
      });
      return;
    }

    await createMaxLog({
      maxUserId: userId,
      eventType: 'click',
      eventName: 'check_subscription',
    });

    const isSubscribed = await refreshSubscriptionStatus(userId, {
      source: 'callback',
    });

    await ctx.answerOnCallback({
      notification: isSubscribed
        ? 'Подписка подтверждена'
        : 'Пока у тебя нет подписки на канал',
    });

    if (isSubscribed) {
      await createMaxLog({
        maxUserId: userId,
        eventType: 'system',
        eventName: 'subscription_confirmed',
      });
      await sendGameMenu(ctx);
    } else {
      await createMaxLog({
        maxUserId: userId,
        eventType: 'system',
        eventName: 'subscription_missing',
      });
      await safeReply(ctx, subscriptionRetryMessage, {
        attachments: [subscriptionKeyboard],
      }, 'check_subscription:missing');
    }
  } catch (error) {
    logger.error('MAX subscription check failed', {
      userId,
      error: error.response?.data || error.message,
    });

    await ctx.answerOnCallback({
      notification: 'Не удалось проверить подписку',
    });
  }
});
