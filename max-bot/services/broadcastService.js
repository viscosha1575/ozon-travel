import fs from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import crypto from 'crypto';
import { bot } from '../maxInstance.js';

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i;
const VIDEO_EXT_RE = /\.(mp4|mov|m4v|webm|ogg)(\?.*)?$/i;

function isImageUrl(url) {
  return IMAGE_EXT_RE.test(String(url || ""));
}

function isVideoUrl(url) {
  return VIDEO_EXT_RE.test(String(url || ""));
}

function buildReplyAttachment(button) {
  if (!button || !button.text) {
    return null;
  }

  return null;
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

async function buildAttachments(mediaUrls = []) {
  const attachments = [];

  for (const mediaUrl of mediaUrls) {
    const normalizedUrl = String(mediaUrl || "").trim();

    if (!normalizedUrl) {
      continue;
    }

    if (isImageUrl(normalizedUrl)) {
      const attachment = await bot.api.uploadImage({ url: normalizedUrl });
      attachments.push(attachment.toJson());
      continue;
    }

    if (isVideoUrl(normalizedUrl)) {
      const tempFile = await downloadToTempFile(normalizedUrl);
      try {
        const attachment = await bot.api.uploadVideo({ source: tempFile });
        attachments.push(attachment.toJson());
      } finally {
        await fs.unlink(tempFile).catch(() => {});
      }
      continue;
    }

    const tempFile = await downloadToTempFile(normalizedUrl);
    try {
      const attachment = await bot.api.uploadFile({ source: tempFile });
      attachments.push(attachment.toJson());
    } finally {
      await fs.unlink(tempFile).catch(() => {});
    }
  }

  return attachments;
}

async function sendBroadcast({ userId, text, html, mediaUrls = [], button, disablePreview }) {
  const numericUserId = Number(userId);
  const normalizedUserId = Number.isFinite(numericUserId) ? numericUserId : null;
  const normalizedText = String(html || text || "").trim();
  const attachments = [];

  if (!normalizedUserId) {
    throw new Error("userId is required");
  }

  if (mediaUrls.length > 0) {
    const mediaAttachments = await buildAttachments(mediaUrls);
    attachments.push(...mediaAttachments);
  }

  const replyAttachment = buildReplyAttachment(button);
  if (replyAttachment) {
    attachments.push(replyAttachment);
  }

  const message = await bot.api.sendMessageToUser(normalizedUserId, normalizedText, {
    format: normalizedText ? 'html' : undefined,
    disable_link_preview: Boolean(disablePreview),
    attachments,
  });

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

  await bot.api.deleteMessage(normalizedMessageId);

  return { ok: true };
}

export {
  sendBroadcast,
  deleteBroadcastMessage,
};
