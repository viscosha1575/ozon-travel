const API_URL = String(
  import.meta.env.VITE_API_URL || "http://localhost:3001/api",
).replace(/\/$/, "");
const SESSION_STORAGE_KEY = "ozon-travel-client-session-id";
let cachedClientSessionId = "";

function buildApiUrl(path) {
  return `${API_URL}${String(path || "").startsWith("/") ? path : `/${path}`}`;
}

function createSessionId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getClientSessionId() {
  if (cachedClientSessionId) {
    return cachedClientSessionId;
  }

  if (typeof window === "undefined") {
    cachedClientSessionId = createSessionId();
    return cachedClientSessionId;
  }

  const storedValue = window.sessionStorage.getItem(SESSION_STORAGE_KEY);

  if (storedValue) {
    cachedClientSessionId = storedValue;
    return cachedClientSessionId;
  }

  cachedClientSessionId = createSessionId();
  window.sessionStorage.setItem(SESSION_STORAGE_KEY, cachedClientSessionId);
  return cachedClientSessionId;
}

function buildHeaders(headers = {}) {
  const nextHeaders = {
    ...headers,
  };
  const initData = window.Telegram?.WebApp?.initData;

  if (initData) {
    nextHeaders["X-Telegram-Init-Data"] = initData;
  }

  nextHeaders["X-Client-Session-Id"] = getClientSessionId();

  return nextHeaders;
}

function buildRequestError(data = {}) {
  const error = new Error(data.message || "Request failed");

  if (data?.code) {
    error.code = String(data.code);
  }

  return error;
}

export async function getJson(path) {
  const response = await fetch(buildApiUrl(path), {
    method: "GET",
    headers: buildHeaders(),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw buildRequestError(data);
  }

  return data;
}

export async function postJson(path, body = {}) {
  const response = await fetch(buildApiUrl(path), {
    method: "POST",
    headers: buildHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw buildRequestError(data);
  }

  return data;
}

export function trackGameEvent(eventName, details = {}) {
  const normalizedEventName = String(eventName || "").trim();

  if (!normalizedEventName) {
    return Promise.resolve(null);
  }

  return fetch(buildApiUrl("/game/event"), {
    method: "POST",
    headers: buildHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      eventName: normalizedEventName,
      details,
    }),
    keepalive: true,
  }).catch(() => null);
}
