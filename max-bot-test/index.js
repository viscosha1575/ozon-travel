import axios from 'axios';
import express from 'express';
import { sendSubscriptionPromptToUser } from './handlers/start.js';
import { startBot, processWebhookUpdate } from './maxInstance.js';
import { MAX_BOT_TOKEN } from './config.js';
import { checkChannelSubscription } from './services/subscriptionService.js';
import logger from './utils/logger.js';
import { sendBroadcast, deleteBroadcastMessage } from './services/broadcastService.js';

const MAX_BOT_PORT = Number(process.env.MAX_BOT_PORT || 3011);
const MAX_BOT_MODE = String(process.env.MAX_BOT_MODE || 'webhook').trim().toLowerCase() === 'polling'
  ? 'polling'
  : 'webhook';
const MAX_WEBHOOK_BASE_URL = String(process.env.MAX_WEBHOOK_BASE_URL || '').trim().replace(/\/$/, '');
const MAX_WEBHOOK_PATH = `/${String(process.env.MAX_WEBHOOK_PATH || '').trim().replace(/^\/+/, '')}`;
const MAX_WEBHOOK_SECRET = String(process.env.MAX_WEBHOOK_SECRET || '').trim();
const MAX_AUTO_REGISTER_WEBHOOK = String(process.env.MAX_AUTO_REGISTER_WEBHOOK || 'false').toLowerCase() === 'true';
const MAX_WEBHOOK_RETRY_MS = Math.max(Number(process.env.MAX_WEBHOOK_RETRY_MS || 60000), 1000);
const MAX_SUBSCRIPTIONS_API_URL = String(
  process.env.MAX_SUBSCRIPTIONS_API_URL || 'https://platform-api2.max.ru/subscriptions'
).trim();
const MAX_WEBHOOK_UPDATE_TYPES = String(process.env.MAX_WEBHOOK_UPDATE_TYPES || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const MAX_WEBHOOK_URL = MAX_WEBHOOK_BASE_URL && MAX_WEBHOOK_PATH !== '/'
  ? `${MAX_WEBHOOK_BASE_URL}${MAX_WEBHOOK_PATH}`
  : '';
const INTERNAL_BROADCAST_TOKEN = String(
  process.env.BROADCAST_INTERNAL_TOKEN || process.env.REQUEST_BODY_SECRET || ''
).trim();
let webhookRegistered = false;
let webhookRetryTimer = null;

function assertRequiredEnv() {
  const missing = [];

  if (!MAX_BOT_TOKEN) {
    missing.push('MAX_BOT_TOKEN');
  }

  if (MAX_BOT_MODE === 'webhook') {
    if (!MAX_WEBHOOK_BASE_URL) {
      missing.push('MAX_WEBHOOK_BASE_URL');
    }

    if (MAX_WEBHOOK_PATH === '/') {
      missing.push('MAX_WEBHOOK_PATH');
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required max-bot env: ${missing.join(', ')}`);
  }
}

function summarizeUpdate(update = {}) {
  const message = update?.message || null;
  const callback = update?.callback || null;
  const sender =
    callback?.user
    || update?.user
    || message?.sender
    || null;

  return {
    updateType: update?.update_type || null,
    timestamp: update?.timestamp || null,
    chatId: update?.chat_id || message?.recipient?.chat_id || message?.chat_id || null,
    userId: sender?.user_id || sender?.id || null,
    hasMessage: Boolean(message),
    hasCallback: Boolean(callback),
    payload: update?.payload || callback?.payload || null,
  };
}

function stringifyPayload(payload) {
  if (typeof payload === 'string') {
    return payload;
  }

  try {
    return JSON.stringify(payload);
  } catch (error) {
    return String(payload);
  }
}

async function callSubscriptionsApi({ method, body }) {
  const response = await axios({
    method,
    url: MAX_SUBSCRIPTIONS_API_URL,
    data: body,
    timeout: 30000,
    validateStatus: () => true,
    headers: {
      Authorization: MAX_BOT_TOKEN,
      'Content-Type': 'application/json',
    },
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `MAX subscriptions API ${method.toUpperCase()} failed with ${response.status}: ${stringifyPayload(response.data)}`
    );
  }

  return response.data;
}

async function registerWebhook() {
  assertRequiredEnv();

  const body = {
    url: MAX_WEBHOOK_URL,
  };

  if (MAX_WEBHOOK_UPDATE_TYPES.length > 0) {
    body.update_types = MAX_WEBHOOK_UPDATE_TYPES;
  }

  if (MAX_WEBHOOK_SECRET) {
    body.secret = MAX_WEBHOOK_SECRET;
  }

  const createResult = await callSubscriptionsApi({
    method: 'post',
    body,
  });

  if (createResult?.success === false) {
    throw new Error(createResult?.message || 'MAX API rejected webhook subscription');
  }

  const listResult = await callSubscriptionsApi({ method: 'get' });
  const subscriptions = Array.isArray(listResult)
    ? listResult
    : Array.isArray(listResult?.subscriptions)
      ? listResult.subscriptions
      : [];
  const normalizedWebhookUrl = MAX_WEBHOOK_URL.replace(/\/$/, '');
  const matchedSubscription = subscriptions.find((subscription) => {
    const subscriptionUrl = String(subscription?.url || '').replace(/\/$/, '');
    return subscriptionUrl === normalizedWebhookUrl;
  });

  if (!matchedSubscription) {
    const actualUrls = subscriptions
      .map((subscription) => subscription?.url)
      .filter(Boolean)
      .join(', ');
    throw new Error(
      `MAX webhook mismatch: expected ${MAX_WEBHOOK_URL}, got ${actualUrls || '<empty>'}`
    );
  }

  webhookRegistered = true;

  logger.info('MAX webhook registered', {
    webhookUrl: MAX_WEBHOOK_URL,
    hasSecret: Boolean(MAX_WEBHOOK_SECRET),
    updateTypes: MAX_WEBHOOK_UPDATE_TYPES.length > 0 ? MAX_WEBHOOK_UPDATE_TYPES : null,
  });
}

function scheduleWebhookRetry() {
  if (webhookRegistered || webhookRetryTimer) {
    return;
  }

  webhookRetryTimer = setTimeout(async () => {
    webhookRetryTimer = null;

    try {
      await registerWebhook();
    } catch (error) {
      logger.error('MAX webhook re-registration failed', {
        error: error?.message || String(error),
        webhookUrl: MAX_WEBHOOK_URL,
        nextRetryInMs: MAX_WEBHOOK_RETRY_MS,
      });
      scheduleWebhookRetry();
    }
  }, MAX_WEBHOOK_RETRY_MS);
}

const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

app.get('/health', (req, res) => {
  res.status(200).json({
    ok: true,
    mode: MAX_BOT_MODE,
    webhookPath: MAX_BOT_MODE === 'webhook' ? MAX_WEBHOOK_PATH : null,
  });
});

if (MAX_BOT_MODE === 'webhook') {
  app.post(MAX_WEBHOOK_PATH, (req, res) => {
    logger.info('MAX webhook update received', summarizeUpdate(req.body));

    if (MAX_WEBHOOK_SECRET) {
      const providedSecret = req.get('x-max-bot-api-secret');

      if (providedSecret !== MAX_WEBHOOK_SECRET) {
        logger.warn('MAX webhook request rejected because of invalid secret', {
          ip: req.ip,
        });
        return res.status(401).json({ ok: false });
      }
    }

    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ ok: false, error: 'Invalid webhook payload' });
    }

    res.sendStatus(200);

    Promise.resolve(processWebhookUpdate(req.body)).catch((error) => {
      logger.error('MAX webhook update processing failed', {
        error: error?.message || String(error),
        update: summarizeUpdate(req.body),
      });
    });
  });
}

app.post('/internal/broadcast/send', async (req, res) => {
  try {
    if (!INTERNAL_BROADCAST_TOKEN) {
      return res.status(500).json({ message: 'Broadcast token is not configured' });
    }

    if (req.get('x-broadcast-token') !== INTERNAL_BROADCAST_TOKEN) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const response = await sendBroadcast({
      userId: req.body?.userId || req.body?.recipientId,
      text: req.body?.text,
      html: req.body?.html,
      mediaUrls: Array.isArray(req.body?.mediaUrls) ? req.body.mediaUrls : [],
      mediaPaths: Array.isArray(req.body?.mediaPaths) ? req.body.mediaPaths : [],
      button: req.body?.button,
      disablePreview: Boolean(req.body?.disablePreview),
    });

    return res.json(response);
  } catch (error) {
    logger.error('Broadcast send failed', {
      error: error.message,
    });
    return res.status(500).json({ message: error.message || 'Failed to send broadcast' });
  }
});

app.post('/internal/broadcast/delete', async (req, res) => {
  try {
    if (!INTERNAL_BROADCAST_TOKEN) {
      return res.status(500).json({ message: 'Broadcast token is not configured' });
    }

    if (req.get('x-broadcast-token') !== INTERNAL_BROADCAST_TOKEN) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    await deleteBroadcastMessage({
      userId: req.body?.userId || req.body?.recipientId,
      messageId: req.body?.messageId,
    });

    return res.json({ ok: true });
  } catch (error) {
    logger.error('Broadcast delete failed', {
      error: error.message,
    });
    return res.status(500).json({ message: error.message || 'Failed to delete message' });
  }
});

app.post('/internal/subscription/check', async (req, res) => {
  try {
    if (!INTERNAL_BROADCAST_TOKEN) {
      return res.status(500).json({ message: 'Internal token is not configured' });
    }

    if (req.get('x-broadcast-token') !== INTERNAL_BROADCAST_TOKEN) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const userId = String(req.body?.userId || req.body?.platformUserId || '').trim();

    if (!userId) {
      return res.status(400).json({ message: 'userId is required' });
    }

    const subscribed = await checkChannelSubscription(userId);

    return res.json({
      ok: true,
      subscribed,
    });
  } catch (error) {
    logger.error('Subscription check failed', {
      error: error?.response?.data || error?.message || String(error),
    });
    return res.status(500).json({ message: error?.message || 'Failed to check subscription' });
  }
});

app.post('/internal/subscription/prompt', async (req, res) => {
  try {
    if (!INTERNAL_BROADCAST_TOKEN) {
      return res.status(500).json({ message: 'Internal token is not configured' });
    }

    if (req.get('x-broadcast-token') !== INTERNAL_BROADCAST_TOKEN) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const userId = String(req.body?.userId || req.body?.platformUserId || '').trim();

    if (!userId) {
      return res.status(400).json({ message: 'userId is required' });
    }

    return res.json({ ok: true, ...await sendSubscriptionPromptToUser(userId) });
  } catch (error) {
    logger.error('Subscription prompt failed', {
      error: error?.response?.data || error?.message || String(error),
    });
    return res.status(500).json({ message: error?.message || 'Failed to send subscription prompt' });
  }
});

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: 'Not found',
  });
});

app.listen(MAX_BOT_PORT, async () => {
  try {
    assertRequiredEnv();
    await startBot();
  } catch (error) {
    logger.error('MAX bot failed to start', {
      error: error?.message || String(error),
    });
    process.exit(1);
  }

  logger.info('MAX bot server started', {
    port: MAX_BOT_PORT,
    mode: MAX_BOT_MODE,
    webhookUrl: MAX_BOT_MODE === 'webhook' ? MAX_WEBHOOK_URL : null,
    autoRegisterWebhook: MAX_BOT_MODE === 'webhook' ? MAX_AUTO_REGISTER_WEBHOOK : null,
  });

  if (MAX_BOT_MODE !== 'webhook') {
    return;
  }

  if (!MAX_WEBHOOK_SECRET) {
    logger.warn('MAX_WEBHOOK_SECRET is empty. Webhook requests are not protected by shared secret.');
  }

  if (!MAX_AUTO_REGISTER_WEBHOOK) {
    logger.info('MAX webhook auto-registration is disabled', {
      webhookUrl: MAX_WEBHOOK_URL,
    });
    return;
  }

  try {
    await registerWebhook();
  } catch (error) {
    logger.error('MAX webhook registration failed', {
      error: error?.message || String(error),
      webhookUrl: MAX_WEBHOOK_URL,
      nextRetryInMs: MAX_WEBHOOK_RETRY_MS,
    });
    scheduleWebhookRetry();
  }
});
