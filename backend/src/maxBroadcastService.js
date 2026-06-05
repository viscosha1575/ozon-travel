const DEFAULT_BACKEND_PUBLIC_URL = `http://localhost:${Number(process.env.PORT || 3001)}`;
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
const BACKEND_PUBLIC_URL = String(
  process.env.BACKEND_PUBLIC_URL || DEFAULT_BACKEND_PUBLIC_URL,
).trim().replace(/\/+$/g, "");

async function parseJsonSafely(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function normalizeMediaUrl(value) {
  const normalizedValue = String(value || "").trim();

  if (!normalizedValue) {
    return "";
  }

  if (/^https?:\/\//i.test(normalizedValue)) {
    return normalizedValue;
  }

  if (normalizedValue.startsWith("/")) {
    return `${BACKEND_PUBLIC_URL}${normalizedValue}`;
  }

  return `${BACKEND_PUBLIC_URL}/${normalizedValue.replace(/^\/+/g, "")}`;
}

export async function sendMaxUserTextNotification({ maxUserId, text, mediaUrls = [] }) {
  const normalizedUserId = String(maxUserId || "").trim();
  const normalizedText = String(text || "").trim();
  const normalizedMediaUrls = Array.isArray(mediaUrls)
    ? mediaUrls.map((item) => normalizeMediaUrl(item)).filter(Boolean)
    : [];

  if (!normalizedUserId || (!normalizedText && normalizedMediaUrls.length === 0)) {
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
      mediaUrls: normalizedMediaUrls,
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
