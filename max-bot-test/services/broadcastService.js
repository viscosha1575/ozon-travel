import fs from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import crypto from 'crypto';
import { bot } from '../maxInstance.js';
import {
  FileAttachment,
  ImageAttachment,
  Keyboard,
  VideoAttachment,
} from '@maxhub/max-bot-api';
import {
  MAX_API_REQUESTS_PER_SECOND,
  MAX_ATTACHMENT_CACHE_TTL_MS,
  MAX_ATTACHMENT_READY_DELAY_MS,
} from '../config.js';

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i;
const VIDEO_EXT_RE = /\.(mp4|mov|m4v|webm|ogg)(\?.*)?$/i;
const attachmentCache = new Map();
let maxApiQueue = Promise.resolve();
let nextApiSlotAt = 0;
const ATTACHMENT_READY_RETRY_DELAYS_MS = [1500, 3000, 5000];

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function scheduleMaxApiCall(run) {
  const minIntervalMs = Math.max(1, Math.ceil(1000 / MAX_API_REQUESTS_PER_SECOND));
  const scheduledRun = maxApiQueue.then(async () => {
    const now = Date.now();
    const waitMs = Math.max(0, nextApiSlotAt - now);

    if (waitMs > 0) {
      await sleep(waitMs);
    }

    nextApiSlotAt = Math.max(now, nextApiSlotAt) + minIntervalMs;
    return run();
  });

  maxApiQueue = scheduledRun.catch(() => {});
  return scheduledRun;
}

function buildAttachmentFromToken(kind, token) {
  if (!token) {
    return null;
  }

  if (kind === 'image') {
    return new ImageAttachment({ token }).toJson();
  }

  if (kind === 'video') {
    return new VideoAttachment({ token }).toJson();
  }

  return new FileAttachment({ token }).toJson();
}

function getCachedAttachment(cacheKey) {
  const cachedItem = attachmentCache.get(cacheKey);

  if (!cachedItem) {
    return null;
  }

  if (cachedItem.expiresAt <= Date.now()) {
    attachmentCache.delete(cacheKey);
    return null;
  }

  return cachedItem.attachment;
}

function setCachedAttachment(cacheKey, kind, token) {
  const attachment = buildAttachmentFromToken(kind, token);

  if (!attachment) {
    return null;
  }

  attachmentCache.set(cacheKey, {
    attachment,
    expiresAt: Date.now() + MAX_ATTACHMENT_CACHE_TTL_MS,
  });

  return attachment;
}

function isAttachmentNotReadyError(error) {
  const message = String(
    error?.response?.data?.code
    || error?.response?.data?.message
    || error?.message
    || "",
  ).trim();

  return message.includes("attachment.not.ready");
}

function isImageUrl(url) {
  return IMAGE_EXT_RE.test(String(url || ""));
}

function isVideoUrl(url) {
  return VIDEO_EXT_RE.test(String(url || ""));
}

function buildMiniAppButton(url, text) {
  const fallbackWebApp = 'ozontravel_lenta_bot';

  try {
    const parsedUrl = new URL(String(url || "").trim());
    const webApp = parsedUrl.pathname.replace(/^\/+/, '').split('/')[0] || fallbackWebApp;
    const payload = String(parsedUrl.searchParams.get('startapp') || '').trim();
    const button = {
      type: 'open_app',
      text,
      web_app: webApp,
    };

    if (payload) {
      button.payload = payload;
    }

    return button;
  } catch {
    return {
      type: 'open_app',
      text,
      web_app: fallbackWebApp,
    };
  }
}

function buildReplyAttachment(button) {
  const text = String(button?.text || "").trim();
  const url = String(button?.url || "").trim();
  const type = String(button?.type || "").trim().toLowerCase();

  if (!text || !url) {
    return null;
  }

  if (type === 'open_app') {
    return Keyboard.inlineKeyboard([
      [buildMiniAppButton(url, text)],
    ]);
  }

  return Keyboard.inlineKeyboard([
    [Keyboard.button.link(text, url)],
  ]);
}

async function downloadToTempFile(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') || '';
  const extension = contentType.includes('video/')
    ? '.mp4'
    : contentType.includes('image/png')
      ? '.png'
      : contentType.includes('image/gif')
        ? '.gif'
        : contentType.includes('image/webp')
          ? '.webp'
          : '.bin';
  const filePath = path.join(tmpdir(), `max-broadcast-${crypto.randomUUID()}${extension}`);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

function resolveLocalPath(filePath) {
  const normalizedValue = String(filePath || "").trim();

  if (!normalizedValue) {
    return "";
  }

  if (path.isAbsolute(normalizedValue)) {
    return normalizedValue;
  }

  return path.resolve(process.cwd(), normalizedValue);
}

async function uploadLocalAttachment(localPath) {
  const normalizedPath = resolveLocalPath(localPath);

  if (!normalizedPath) {
    return null;
  }

  await fs.access(normalizedPath);

  const cacheKey = `local:${normalizedPath}`;
  const cachedAttachment = getCachedAttachment(cacheKey);

  if (cachedAttachment) {
    return cachedAttachment;
  }

  if (isImageUrl(normalizedPath)) {
    const attachment = await scheduleMaxApiCall(() => bot.api.uploadImage({ source: normalizedPath }));

    if (MAX_ATTACHMENT_READY_DELAY_MS > 0) {
      await sleep(MAX_ATTACHMENT_READY_DELAY_MS);
    }

    return setCachedAttachment(cacheKey, 'image', attachment?.token) || attachment.toJson();
  }

  if (isVideoUrl(normalizedPath)) {
    const attachment = await scheduleMaxApiCall(() => bot.api.uploadVideo({ source: normalizedPath }));

    if (MAX_ATTACHMENT_READY_DELAY_MS > 0) {
      await sleep(MAX_ATTACHMENT_READY_DELAY_MS);
    }

    return setCachedAttachment(cacheKey, 'video', attachment?.token) || attachment.toJson();
  }

  const attachment = await scheduleMaxApiCall(() => bot.api.uploadFile({ source: normalizedPath }));

  if (MAX_ATTACHMENT_READY_DELAY_MS > 0) {
    await sleep(MAX_ATTACHMENT_READY_DELAY_MS);
  }

  return setCachedAttachment(cacheKey, 'file', attachment?.token) || attachment.toJson();
}

async function buildAttachments(mediaUrls = [], mediaPaths = []) {
  const attachments = [];

  for (const mediaUrl of mediaUrls) {
    const normalizedUrl = String(mediaUrl || "").trim();

    if (!normalizedUrl) {
      continue;
    }

    const cacheKey = `url:${normalizedUrl}`;
    const cachedAttachment = getCachedAttachment(cacheKey);

    if (cachedAttachment) {
      attachments.push(cachedAttachment);
      continue;
    }

    if (isImageUrl(normalizedUrl)) {
      const attachment = await scheduleMaxApiCall(() => bot.api.uploadImage({ url: normalizedUrl }));

      if (MAX_ATTACHMENT_READY_DELAY_MS > 0) {
        await sleep(MAX_ATTACHMENT_READY_DELAY_MS);
      }

      attachments.push(setCachedAttachment(cacheKey, 'image', attachment?.token) || attachment.toJson());
      continue;
    }

    if (isVideoUrl(normalizedUrl)) {
      const tempFile = await downloadToTempFile(normalizedUrl);
      try {
        const attachment = await scheduleMaxApiCall(() => bot.api.uploadVideo({ source: tempFile }));

        if (MAX_ATTACHMENT_READY_DELAY_MS > 0) {
          await sleep(MAX_ATTACHMENT_READY_DELAY_MS);
        }

        attachments.push(setCachedAttachment(cacheKey, 'video', attachment?.token) || attachment.toJson());
      } finally {
        await fs.unlink(tempFile).catch(() => {});
      }
      continue;
    }

    const tempFile = await downloadToTempFile(normalizedUrl);
    try {
      const attachment = await scheduleMaxApiCall(() => bot.api.uploadFile({ source: tempFile }));

      if (MAX_ATTACHMENT_READY_DELAY_MS > 0) {
        await sleep(MAX_ATTACHMENT_READY_DELAY_MS);
      }

      attachments.push(setCachedAttachment(cacheKey, 'file', attachment?.token) || attachment.toJson());
    } finally {
      await fs.unlink(tempFile).catch(() => {});
    }
  }

  for (const mediaPath of mediaPaths) {
    const attachment = await uploadLocalAttachment(mediaPath);

    if (attachment) {
      attachments.push(attachment);
    }
  }

  return attachments;
}

async function sendBroadcast({ userId, text, html, mediaUrls = [], mediaPaths = [], button, disablePreview }) {
  const numericUserId = Number(userId);
  const normalizedUserId = Number.isFinite(numericUserId) ? numericUserId : null;
  const normalizedText = String(html || text || "").trim();
  const attachments = [];

  if (!normalizedUserId) {
    throw new Error("userId is required");
  }

  if (mediaUrls.length > 0 || mediaPaths.length > 0) {
    const mediaAttachments = await buildAttachments(mediaUrls, mediaPaths);
    attachments.push(...mediaAttachments);
  }

  const replyAttachment = buildReplyAttachment(button);
  if (replyAttachment) {
    attachments.push(replyAttachment);
  }

  let message = null;

  for (let attemptIndex = 0; attemptIndex <= ATTACHMENT_READY_RETRY_DELAYS_MS.length; attemptIndex += 1) {
    try {
      message = await scheduleMaxApiCall(() => bot.api.sendMessageToUser(normalizedUserId, normalizedText, {
        format: normalizedText ? 'html' : undefined,
        disable_link_preview: Boolean(disablePreview),
        attachments,
      }));
      break;
    } catch (error) {
      const retryDelayMs = ATTACHMENT_READY_RETRY_DELAYS_MS[attemptIndex];

      if (!attachments.length || !isAttachmentNotReadyError(error) || !retryDelayMs) {
        throw error;
      }

      await sleep(retryDelayMs);
    }
  }

  return {
    messageId: message?.message_id || null,
    messageIds: message?.message_id !== undefined && message?.message_id !== null
      ? [message.message_id]
      : [],
  };
}

async function deleteBroadcastMessage({ userId, messageId }) {
  const normalizedMessageId = Number(messageId);

  if (!Number.isFinite(normalizedMessageId)) {
    throw new Error("messageId is required");
  }

  await scheduleMaxApiCall(() => bot.api.deleteMessage(normalizedMessageId));

  return { ok: true };
}

export {
  sendBroadcast,
  deleteBroadcastMessage,
};
