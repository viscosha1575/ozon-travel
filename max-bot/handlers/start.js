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

const gameMenuKeyboard = Keyboard.inlineKeyboard([
  [Keyboard.button.link('Открыть игру', GAME_WEBAPP_URL)],
  [Keyboard.button.callback('Поддержка', 'show_support')],
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
  'Подписка подтверждена.',
  '',
  'Это мокап главного меню бота.',
  'Доступные действия:',
  '• открыть игру',
  '• открыть поддержку',
].join('\n');

const supportMessage = [
  'Поддержка проекта',
  '',
  `По всем вопросам пока используем моковый контакт: ${SUPPORT_CONTACT}.`,
].join('\n');

let cachedChannelChatId = Number(MAX_CHANNEL_CHAT_ID) || null;
const MAX_SUBSCRIPTION_CHECK_MODE = String(process.env.MAX_SUBSCRIPTION_CHECK_MODE || 'api')
  .trim()
  .toLowerCase();

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

function extractUser(ctx) {
  const sender = getSender(ctx);
  const userId = getStringValue(
    ctx?.user?.user_id,
    sender.user_id,
    sender.userId,
    sender.id,
    sender.uid,
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

  const chat = await bot.api.getChatByLink(MAX_CHANNEL_URL);
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
    return false;
  }

  try {
    await addUser({
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
    return true;
  } catch (error) {
    logger.error('MAX addUser failed', {
      userId,
      error: error.response?.data || error.message,
    });
    return false;
  }
}

async function sendStartStep(ctx) {
  await registerUser(ctx);
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
  await safeReply(ctx, menuMessage, {
    attachments: [gameMenuKeyboard],
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

    if (!registered) {
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

    const isSubscribed = userId
      ? await checkChannelSubscription(userId)
      : false;

    if (userId) {
      await setSubscriptionStatus({
        maxUserId: userId,
        isSubscribed,
      });
    }

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
