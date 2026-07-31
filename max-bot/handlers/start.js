import path from 'path';
import { fileURLToPath } from 'url';

import { bot, Keyboard } from '../maxInstance.js';
import {
  addUser,
  grantOzonBankSubscriptionBonus,
} from '../services/userService.js';
import { createMaxLog } from '../services/logService.js';
import {
  MAX_CHANNEL_URL,
  MAX_BANK_CHANNEL_URL,
  GAME_WEBAPP_URL,
  SUPPORT_CONTACT,
} from '../config.js';
import { refreshSubscriptionStatus } from '../services/subscriptionService.js';
import { isChatDeniedError } from '../utils/maxErrors.js';
import logger from '../utils/logger.js';
import { parseStartParam } from '../utils/startParam.js';

const newUserSubscriptionKeyboard = Keyboard.inlineKeyboard([
  [Keyboard.button.link('Ozon Travel', MAX_CHANNEL_URL)],
  [Keyboard.button.link('Ozon Банк', MAX_BANK_CHANNEL_URL)],
  [Keyboard.button.callback('Проверить подписку', 'check_subscription')],
]);

const bankSubscriptionKeyboard = Keyboard.inlineKeyboard([
  [Keyboard.button.link('Ozon Банк', MAX_BANK_CHANNEL_URL)],
  [Keyboard.button.callback('Проверить подписку', 'check_subscription')],
]);

const travelSubscriptionKeyboard = Keyboard.inlineKeyboard([
  [Keyboard.button.link('Ozon Travel', MAX_CHANNEL_URL)],
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
      text: 'Крутить Ленту',
      web_app: fallbackWebApp,
    };
  }

  try {
    const parsedUrl = new URL(normalizedUrl);
    const webApp = parsedUrl.pathname.replace(/^\/+/, '').split('/')[0] || fallbackWebApp;
    const payload = String(parsedUrl.searchParams.get('startapp') || '').trim();
    const button = {
      type: 'open_app',
      text: 'Крутить Ленту',
      web_app: webApp,
    };

    if (payload) {
      button.payload = payload;
    }

    return button;
  } catch {
    return {
      type: 'open_app',
      text: 'Крутить Ленту',
      web_app: normalizedUrl.replace(/^@/, '') || fallbackWebApp,
    };
  }
}

const gameMenuKeyboard = Keyboard.inlineKeyboard([
  [buildOpenAppButton(GAME_WEBAPP_URL)],
  [Keyboard.button.callback('Поддержка', 'show_support')],
]);

const welcomeMessage = [
  'Для старта подпишитесь на каналы Ozon Travel и Ozon Банк и получите +3 попытки крутить Ленту призов',
].join('\n');

const subscriptionMessage = [
  'Проверьте подписку на каналы Ozon Travel и Ozon Банк, а сразу после получите +3 попытки крутить Ленту призов',
].join('\n');

const bankSubscriptionMessage =
  'Подпишитесь на канал Ozon Банк и получите +3 попытки крутить Ленту призов';
const travelSubscriptionMessage =
  'Подпишитесь на канал Ozon Travel, чтобы продолжить';

const subscriptionRetryMessage =
  'Подписки пока не найдены. Подпишитесь на каналы Ozon Travel и Ozon Банк и нажмите\n«Проверить подписку» ещё раз';
const bankSubscriptionRetryMessage =
  'Подписка пока не найдена. Подпишитесь на канал Ozon Банк и нажмите\n«Проверить подписку» ещё раз';
const travelSubscriptionRetryMessage =
  'Подписка пока не найдена. Подпишитесь на канал Ozon Travel и нажмите\n«Проверить подписку» ещё раз';
const MAX_SUBSCRIPTION_RETRY_DELAY_MS = 3000;
const MAX_START_SUBSCRIPTION_RETRY_ATTEMPTS = 5;
const MAX_MANUAL_SUBSCRIPTION_RETRY_ATTEMPTS = 1;
const START_DEDUP_WINDOW_MS = 15_000;
const recentStartByUserId = new Map();
const pendingSubscriptionFlowByUserId = new Map();
const subscriptionCheckInFlight = new Set();

const menuMessage = [
  'Всё готово для участия!',
  '',
  'Ловите до 100 000 баллов Ozon и промокоды на путешествия!',
].join('\n');

const supportMessage = [
  'Поддержка проекта',
  '',
  'При возникновении вопросов обращайтесь в наш чат поддержки в МАКС:',
  '@ozon_travel_support_bot',
].join('\n');

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

function getRawStartParam(ctx) {
  const payloadValue = getStringValue(
    ctx?.payload,
    ctx?.update?.payload,
    ctx?.message?.payload,
    ctx?.update?.message?.payload,
    ctx?.message?.body?.payload,
    ctx?.update?.message?.body?.payload,
    ctx?.callback?.payload,
    ctx?.update?.callback?.payload,
  ).trim();

  if (payloadValue) {
    return payloadValue;
  }

  return getMessageText(ctx).trim().split(/\s+/)[1] || '';
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

function splitDisplayName(displayName) {
  const normalizedValue = String(displayName || '').trim();

  if (!normalizedValue) {
    return {
      firstName: '',
      lastName: '',
    };
  }

  const parts = normalizedValue.split(/\s+/).filter(Boolean);

  if (parts.length === 1) {
    return {
      firstName: parts[0],
      lastName: '',
    };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
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
  const explicitUsername = getStringValue(
    sender.username,
    sender.login,
  );
  const explicitFirstName = getStringValue(
    sender.first_name,
    sender.firstName,
  );
  const explicitLastName = getStringValue(
    sender.last_name,
    sender.lastName,
  );
  const displayName = getStringValue(
    sender.display_name,
    sender.name,
  );
  const fallbackName = (!explicitFirstName && !explicitLastName)
    ? splitDisplayName(displayName)
    : { firstName: '', lastName: '' };
  const username = explicitUsername || displayName;
  const firstName = explicitFirstName || fallbackName.firstName;
  const lastName = explicitLastName || fallbackName.lastName;

  return {
    userId,
    username,
    firstName,
    lastName,
  };
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function checkSubscriptionWithRetry(userId, {
  source = 'unknown',
  attempts = 1,
  delayMs = MAX_SUBSCRIPTION_RETRY_DELAY_MS,
  requiredChannels = ['travel', 'bank'],
} = {}) {
  const totalAttempts = Math.max(1, Number(attempts) || 1);
  let subscriptions = { travel: false, bank: false };

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    subscriptions = await refreshSubscriptionStatus(userId, { source, requiredChannels });
    const isSubscribed = requiredChannels.every((channel) => subscriptions[channel]);

    if (isSubscribed || attempt >= totalAttempts) {
      return {
        isSubscribed,
        subscriptions,
      };
    }

    logger.info('MAX subscription not visible yet, retrying', {
      userId,
      source,
      attempt,
      totalAttempts,
      delayMs,
    });
    await wait(delayMs);
  }

  return {
    isSubscribed: false,
    subscriptions,
  };
}

async function registerUser(ctx, { logEntry = true } = {}) {
  const { userId, username, firstName, lastName } = extractUser(ctx);
  const rawStartParam = getRawStartParam(ctx);
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
  const { userId } = extractUser(ctx);
  const now = Date.now();
  const lastStartAt = recentStartByUserId.get(userId) || 0;

  if (userId && now - lastStartAt < START_DEDUP_WINDOW_MS) {
    logger.info('Skipping duplicate MAX start event', { userId });
    return;
  }

  if (userId) {
    recentStartByUserId.set(userId, now);
  }

  const registrationResult = await registerUser(ctx);

  if (!registrationResult?.ok) {
    await safeReply(ctx, welcomeMessage, {
      attachments: [newUserSubscriptionKeyboard],
    }, 'sendStartStep:registration-missing');
    return;
  }

  const isNewUser = Boolean(registrationResult.user?.wasCreated);
  let flow = isNewUser ? 'new' : 'bank';

  try {
    if (isNewUser) {
      await grantOzonBankSubscriptionBonus({
        maxUserId: userId,
        markClaimedOnly: true,
      });
    }

    const subscriptionResult = await checkSubscriptionWithRetry(userId, {
      source: 'start',
      attempts: 1,
      requiredChannels: ['travel', 'bank'],
    });

    if (subscriptionResult.isSubscribed) {
      pendingSubscriptionFlowByUserId.delete(userId);
      await sendGameMenu(ctx);
      return;
    }

    if (subscriptionResult.subscriptions.travel) {
      flow = 'bank';
    } else if (subscriptionResult.subscriptions.bank) {
      flow = 'travel';
    } else {
      flow = 'new';
    }
  } catch (error) {
    logger.error('MAX start subscription refresh failed', {
      userId,
      error: error.response?.data || error.message,
    });
  }

  pendingSubscriptionFlowByUserId.set(userId, flow);
  await safeReply(
    ctx,
    flow === 'new'
      ? welcomeMessage
      : flow === 'travel'
        ? travelSubscriptionMessage
        : bankSubscriptionMessage,
    {
      attachments: [flow === 'new'
        ? newUserSubscriptionKeyboard
        : flow === 'travel'
          ? travelSubscriptionKeyboard
          : bankSubscriptionKeyboard],
    },
    'sendStartStep',
  );
}

async function sendSubscriptionStep(ctx) {
  await safeReply(ctx, subscriptionMessage, {
    attachments: [newUserSubscriptionKeyboard],
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
bot.command('id', async (ctx) => {
  const { userId } = extractUser(ctx);

  if (userId) {
    await createMaxLog({
      maxUserId: userId,
      eventType: 'command',
      eventName: 'id',
    });
  }

  await safeReply(ctx, userId ? `Ваш MAX ID: ${userId}` : 'Не удалось определить ваш MAX ID.', undefined, 'command:id');
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
  let callbackAcknowledged = false;
  let flow = pendingSubscriptionFlowByUserId.get(userId) || 'bank';

  if (subscriptionCheckInFlight.has(userId)) {
    await ctx.answerOnCallback({
      notification: 'Проверка уже идёт',
    });
    return;
  }

  subscriptionCheckInFlight.add(userId);

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

    await ctx.answerOnCallback({
      notification: 'Проверяем, подождите пару секунд',
    });
    callbackAcknowledged = true;

    flow = pendingSubscriptionFlowByUserId.get(userId)
      || (registered.user?.subscribedToChannel ? 'bank' : 'new');
    const subscriptionResult = await checkSubscriptionWithRetry(userId, {
      source: 'callback',
      attempts: MAX_MANUAL_SUBSCRIPTION_RETRY_ATTEMPTS,
      requiredChannels: ['travel', 'bank'],
    });

    if (subscriptionResult.isSubscribed) {
      const bonusResult = await grantOzonBankSubscriptionBonus({ maxUserId: userId });
      pendingSubscriptionFlowByUserId.delete(userId);
      await createMaxLog({
        maxUserId: userId,
        eventType: 'system',
        eventName: 'subscription_confirmed',
      });
      logger.info('MAX Ozon Bank subscription bonus processed', {
        userId,
        granted: Boolean(bonusResult?.granted),
        flow,
      });
      await sendGameMenu(ctx);
    } else {
      flow = subscriptionResult.subscriptions.travel
        ? 'bank'
        : subscriptionResult.subscriptions.bank
          ? 'travel'
          : 'new';
      pendingSubscriptionFlowByUserId.set(userId, flow);
      await createMaxLog({
        maxUserId: userId,
        eventType: 'system',
        eventName: 'subscription_missing',
      });
      const retryMessage = flow === 'new'
        ? subscriptionRetryMessage
        : flow === 'travel'
          ? travelSubscriptionRetryMessage
          : bankSubscriptionRetryMessage;
      const retryKeyboard = flow === 'new'
        ? newUserSubscriptionKeyboard
        : flow === 'travel'
          ? travelSubscriptionKeyboard
          : bankSubscriptionKeyboard;
      await safeReply(ctx, retryMessage, {
        attachments: [retryKeyboard],
      }, 'check_subscription:missing');
    }
  } catch (error) {
    logger.error('MAX subscription check failed', {
      userId,
      error: error.response?.data || error.message,
    });

    if (!callbackAcknowledged) {
      await ctx.answerOnCallback({
        notification: 'Не удалось проверить подписку',
      });
      return;
    }

    await safeReply(ctx, 'Не удалось проверить подписку. Попробуйте ещё раз через пару секунд.', {
      attachments: [flow === 'new'
        ? newUserSubscriptionKeyboard
        : flow === 'travel'
          ? travelSubscriptionKeyboard
          : bankSubscriptionKeyboard],
    }, 'check_subscription:error');
  } finally {
    subscriptionCheckInFlight.delete(userId);
  }
});
