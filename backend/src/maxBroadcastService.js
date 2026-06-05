const MAX_INTERNAL_BROADCAST_URL = String(
  process.env.MAX_INTERNAL_BROADCAST_URL || "http://max-bot:3011/internal/broadcast/send",
).trim();
const MAX_INTERNAL_BROADCAST_TOKEN = String(
  process.env.BROADCAST_INTERNAL_TOKEN || process.env.REQUEST_BODY_SECRET || "",
).trim();
const MAX_INTERNAL_BROADCAST_TIMEOUT_MS = Math.max(
  1000,
  Math.round(Number(process.env.MAX_INTERNAL_BROADCAST_TIMEOUT_MS || 15000) || 15000),
);

async function parseJsonSafely(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export async function sendMaxUserTextNotification({ maxUserId, text }) {
  const normalizedUserId = String(maxUserId || "").trim();
  const normalizedText = String(text || "").trim();

  if (!normalizedUserId || !normalizedText) {
    return {
      ok: false,
      skipped: true,
    };
  }

  if (!MAX_INTERNAL_BROADCAST_URL || !MAX_INTERNAL_BROADCAST_TOKEN) {
    return {
      ok: false,
      skipped: true,
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, MAX_INTERNAL_BROADCAST_TIMEOUT_MS);

  const response = await fetch(MAX_INTERNAL_BROADCAST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-broadcast-token": MAX_INTERNAL_BROADCAST_TOKEN,
    },
    body: JSON.stringify({
      userId: normalizedUserId,
      text: normalizedText,
      disablePreview: true,
    }),
    signal: controller.signal,
  }).finally(() => {
    clearTimeout(timeoutId);
  });
  const data = await parseJsonSafely(response);

  if (!response.ok) {
    throw new Error(data?.message || `Internal broadcast failed with ${response.status}`);
  }

  return {
    ok: true,
    messageId: data?.messageId ?? data?.messageIds?.[0] ?? "",
  };
}
