import axios from "axios";
import {
  BROADCAST_INTERNAL_TOKEN,
  DAILY_ATTEMPT_REMINDER_BANNER_PATH,
  GAME_WEBAPP_URL,
  MANUAL_PUSH_REVOKE_CONCURRENCY,
  MANUAL_PUSH_SEND_CONCURRENCY,
  MAX_INTERNAL_BROADCAST_DELETE_URL,
  MAX_INTERNAL_BROADCAST_URL,
} from "../config.js";

const DAILY_ATTEMPT_REMINDER_TEXT = "Доступна новая попытка крутить Ленту призов!";
const DAILY_ATTEMPT_REMINDER_BUTTON_TEXT = "Крутить Ленту";

async function runWithConcurrency(items, concurrency, run) {
  let cursor = 0;
  const results = new Array(items.length);

  async function worker() {
    while (cursor < items.length) {
      const nextIndex = cursor;
      cursor += 1;
      results[nextIndex] = await run(items[nextIndex], nextIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency || 1), items.length || 1) }, () => worker()),
  );

  return results;
}

async function sendBroadcast(payload) {
  const response = await axios.post(MAX_INTERNAL_BROADCAST_URL, payload, {
    headers: {
      "Content-Type": "application/json",
      "x-broadcast-token": BROADCAST_INTERNAL_TOKEN,
    },
    timeout: 60000,
  });

  return response.data;
}

async function deleteBroadcast(payload) {
  const response = await axios.post(MAX_INTERNAL_BROADCAST_DELETE_URL, payload, {
    headers: {
      "Content-Type": "application/json",
      "x-broadcast-token": BROADCAST_INTERNAL_TOKEN,
    },
    timeout: 60000,
  });

  return response.data;
}

export async function sendDailyAttemptReminder({ maxUserId }) {
  const normalizedUserId = String(maxUserId || "").trim();

  if (!normalizedUserId) {
    throw new Error("maxUserId is required");
  }

  return sendBroadcast({
    userId: normalizedUserId,
    text: DAILY_ATTEMPT_REMINDER_TEXT,
    mediaPaths: DAILY_ATTEMPT_REMINDER_BANNER_PATH ? [DAILY_ATTEMPT_REMINDER_BANNER_PATH] : [],
    button: {
      type: "open_app",
      text: DAILY_ATTEMPT_REMINDER_BUTTON_TEXT,
      url: GAME_WEBAPP_URL,
    },
    disablePreview: true,
  });
}

export async function sendDailyAttemptReminderCampaign({ recipientIds = [] }) {
  const recipients = Array.isArray(recipientIds)
    ? recipientIds.map((item) => String(item || "").trim()).filter(Boolean)
    : [];

  return runWithConcurrency(recipients, MANUAL_PUSH_SEND_CONCURRENCY, async (recipientId) => {
    try {
      const response = await sendDailyAttemptReminder({ maxUserId: recipientId });

      return {
        ok: true,
        recipientId,
        messageId: Number(response?.messageId) || null,
      };
    } catch (error) {
      return {
        ok: false,
        recipientId,
        error: error?.response?.data?.message || error?.message || String(error),
      };
    }
  });
}

export async function sendPushCampaign({
  recipientIds,
  html,
  mediaUrls = [],
  button = null,
  disablePreview = true,
}) {
  const recipients = Array.isArray(recipientIds)
    ? recipientIds.map((item) => String(item || "").trim()).filter(Boolean)
    : [];

  return runWithConcurrency(recipients, MANUAL_PUSH_SEND_CONCURRENCY, async (recipientId) => {
    try {
      const response = await sendBroadcast({
        userId: recipientId,
        html,
        mediaUrls,
        button,
        disablePreview,
      });

      return {
        ok: true,
        recipientId,
        messageId: Number(response?.messageId) || null,
      };
    } catch (error) {
      return {
        ok: false,
        recipientId,
        error: error?.response?.data?.message || error?.message || String(error),
      };
    }
  });
}

export async function revokePushCampaign(deliveries) {
  const items = Array.isArray(deliveries)
    ? deliveries.filter((item) => Number(item?.deliveryId) > 0 && Number(item?.messageId) > 0 && String(item?.maxUserId || "").trim())
    : [];

  return runWithConcurrency(items, MANUAL_PUSH_REVOKE_CONCURRENCY, async (delivery) => {
    try {
      await deleteBroadcast({
        userId: String(delivery.maxUserId || "").trim(),
        messageId: Number(delivery.messageId),
      });

      return {
        ok: true,
        deliveryId: Number(delivery.deliveryId),
      };
    } catch (error) {
      return {
        ok: false,
        deliveryId: Number(delivery.deliveryId),
        error: error?.response?.data?.message || error?.message || String(error),
      };
    }
  });
}
