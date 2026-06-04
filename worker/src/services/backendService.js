import { post } from "./apiClient.js";

export async function claimDailyAttemptReminderRecipients({ reminderDate, limit }) {
  const response = await post("/api/internal/notifications/daily-attempt-reminder/claim", {
    reminderDate,
    limit,
    source: "worker",
  });

  return response.data;
}

export async function prepareDailyAttemptReminderBroadcastTest() {
  const response = await post("/api/internal/notifications/daily-attempt-reminder/test-broadcast/prepare", {
    source: "worker",
  });

  return response.data;
}

export async function markDeliverySent({ deliveryId, messageId }) {
  const response = await post("/api/internal/notifications/deliveries/sent", {
    deliveryId,
    messageId,
  });

  return response.data;
}

export async function markDeliveryFailed({ deliveryId, errorMessage }) {
  const response = await post("/api/internal/notifications/deliveries/failed", {
    deliveryId,
    errorMessage,
  });

  return response.data;
}

export async function preparePushSend({ pushId, mode }) {
  const response = await post("/api/internal/pushes/send/prepare", {
    pushId,
    mode,
    source: "worker",
  });

  return response.data;
}

export async function finalizePushSend({ pushId, mode, results }) {
  const response = await post("/api/internal/pushes/send/finalize", {
    pushId,
    mode,
    results,
    source: "worker",
  });

  return response.data;
}

export async function preparePushRevoke({ pushId }) {
  const response = await post("/api/internal/pushes/revoke/prepare", {
    pushId,
    source: "worker",
  });

  return response.data;
}

export async function finalizePushRevoke({ pushId, results }) {
  const response = await post("/api/internal/pushes/revoke/finalize", {
    pushId,
    results,
    source: "worker",
  });

  return response.data;
}
