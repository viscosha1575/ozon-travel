import { Bot, Keyboard, ImageAttachment, VideoAttachment, AudioAttachment, FileAttachment } from '@maxhub/max-bot-api';
import { MAX_BOT_TOKEN } from './config.js';
import { isChatDeniedError } from './utils/maxErrors.js';
import logger from './utils/logger.js';

if (!MAX_BOT_TOKEN) {
  throw new Error('MAX_BOT_TOKEN is not set');
}

export const bot = new Bot(MAX_BOT_TOKEN);
export { Keyboard };
export { ImageAttachment, VideoAttachment, AudioAttachment, FileAttachment };

let started = false;
const POLLING_RESTART_DELAY_MS = Number(process.env.MAX_POLLING_RESTART_DELAY_MS || 3000);

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function runPollingLoop() {
  while (started) {
    try {
      await Promise.resolve(bot.start());

      if (started) {
        logger.warn('MAX polling loop stopped unexpectedly, restarting');
      }
    } catch (error) {
      logger.error('MAX polling loop failed', {
        error: error?.response?.data || error?.message || String(error),
        stack: error?.stack,
      });
    }

    if (!started) {
      break;
    }

    if (typeof bot.stop === 'function') {
      bot.stop();
    }

    await sleep(POLLING_RESTART_DELAY_MS);
  }
}

if (typeof bot.catch === 'function') {
  bot.catch((error) => {
    const level = isChatDeniedError(error) ? 'warn' : 'error';
    logger[level]('Unhandled MAX bot error', {
      error: error?.response?.data || error?.message || String(error),
      stack: error?.stack,
    });
  });
}

export async function startBot() {
  const mode = String(process.env.MAX_BOT_MODE || 'webhook').trim().toLowerCase();

  if (started) {
    return bot;
  }

  started = true;

  try {
    await bot.api.setMyCommands([
      { name: 'start', description: 'Начать игру' },
      { name: 'menu', description: 'Открыть меню' },
      { name: 'rules', description: 'Правила игры' },
      { name: 'support', description: 'Поддержка' },
    ]);
  } catch (error) {
    logger.warn('Failed to set MAX bot commands', {
      error: error?.message || String(error),
    });
  }

  if (mode === 'polling') {
    void runPollingLoop();
    logger.info('MAX bot started in polling mode');
    return bot;
  }

  logger.info('MAX bot started in webhook mode');

  return bot;
}

export async function processWebhookUpdate(update) {
  if (!update || typeof update !== 'object') {
    throw new Error('MAX webhook payload must be a JSON object');
  }

  if (typeof bot.handleUpdate === 'function') {
    await bot.handleUpdate(update);
    return;
  }

  throw new Error('MAX bot library does not expose handleUpdate');
}

export function stopBot() {
  started = false;

  if (typeof bot.stop === 'function') {
    bot.stop();
  }

  return bot;
}
