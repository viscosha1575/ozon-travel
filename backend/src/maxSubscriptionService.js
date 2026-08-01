import { setUserSubscriptionStatus } from "./userStore.js";

const MAX_SUBSCRIPTION_CHECK_MODE = String(process.env.MAX_SUBSCRIPTION_CHECK_MODE || "api")
  .trim()
  .toLowerCase();
const MAX_INTERNAL_SUBSCRIPTION_CHECK_URL = String(
  process.env.MAX_INTERNAL_SUBSCRIPTION_CHECK_URL || "http://max-bot:3011/internal/subscription/check",
).trim();
const MAX_INTERNAL_TEST_SUBSCRIPTION_CHECK_URL = String(
  process.env.MAX_INTERNAL_TEST_SUBSCRIPTION_CHECK_URL || "http://max-bot-test:3011/internal/subscription/check",
).trim();
const MAX_INTERNAL_SUBSCRIPTION_PROMPT_URL = String(
  process.env.MAX_INTERNAL_SUBSCRIPTION_PROMPT_URL || "http://max-bot:3011/internal/subscription/prompt",
).trim();
const MAX_INTERNAL_TEST_SUBSCRIPTION_PROMPT_URL = String(
  process.env.MAX_INTERNAL_TEST_SUBSCRIPTION_PROMPT_URL || "http://max-bot-test:3011/internal/subscription/prompt",
).trim();
const MAX_INTERNAL_SUBSCRIPTION_CHECK_TOKEN = String(
  process.env.BROADCAST_INTERNAL_TOKEN || process.env.REQUEST_BODY_SECRET || "",
).trim();
const MAX_INTERNAL_SUBSCRIPTION_CHECK_TIMEOUT_MS = Math.max(
  1000,
  Math.round(Number(process.env.MAX_INTERNAL_SUBSCRIPTION_CHECK_TIMEOUT_MS || 15000) || 15000),
);
const ALLOW_LOCAL_DEMO_USER = (
  process.env.ALLOW_LOCAL_DEMO_USER == null || process.env.ALLOW_LOCAL_DEMO_USER === ""
)
  ? process.env.NODE_ENV !== "production"
  : String(process.env.ALLOW_LOCAL_DEMO_USER).trim().toLowerCase() === "true";

async function parseJsonSafely(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function checkMaxChannelSubscription(platformUserId, checkUrl = MAX_INTERNAL_SUBSCRIPTION_CHECK_URL) {
  if (MAX_SUBSCRIPTION_CHECK_MODE === "mock") {
    return true;
  }

  if (!checkUrl) {
    return null;
  }

  if (!MAX_INTERNAL_SUBSCRIPTION_CHECK_TOKEN) {
    return null;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, MAX_INTERNAL_SUBSCRIPTION_CHECK_TIMEOUT_MS);

  const response = await fetch(checkUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-broadcast-token": MAX_INTERNAL_SUBSCRIPTION_CHECK_TOKEN,
    },
    body: JSON.stringify({
      userId: String(platformUserId || "").trim(),
    }),
    signal: controller.signal,
  }).finally(() => {
    clearTimeout(timeoutId);
  });
  const data = await parseJsonSafely(response);

  if (!response.ok) {
    throw new Error(data?.message || `Internal subscription check failed with ${response.status}`);
  }

  if (typeof data?.subscribed !== "boolean") {
    return null;
  }

  return data.subscribed;
}

export async function sendMiniAppSubscriptionPrompt(platformUserId, {
  useTestBot = false,
} = {}) {
  const userId = String(platformUserId || "").trim();
  const promptUrl = useTestBot
    ? MAX_INTERNAL_TEST_SUBSCRIPTION_PROMPT_URL
    : MAX_INTERNAL_SUBSCRIPTION_PROMPT_URL;

  if (!userId || !promptUrl || !MAX_INTERNAL_SUBSCRIPTION_CHECK_TOKEN) {
    throw new Error("MAX subscription prompt is not configured");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), MAX_INTERNAL_SUBSCRIPTION_CHECK_TIMEOUT_MS);
  const response = await fetch(promptUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-broadcast-token": MAX_INTERNAL_SUBSCRIPTION_CHECK_TOKEN,
    },
    body: JSON.stringify({ userId }),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeoutId));
  const data = await parseJsonSafely(response);

  if (!response.ok) {
    throw new Error(data?.message || `Internal subscription prompt failed with ${response.status}`);
  }

  return data;
}

export async function refreshMiniAppSubscriptionStatus(userInfo = {}, fallbackValue = false, {
  useTestSubscriptionCheck = false,
} = {}) {
  const platform = String(userInfo?.platform || "").trim().toLowerCase();
  const platformUserId = String(userInfo?.platformUserId || "").trim();
  const externalId = String(userInfo?.externalId || "").trim();

  if (platform === "telegram") {
    return true;
  }

  if (
    ALLOW_LOCAL_DEMO_USER
    && (platformUserId === "local-demo-user" || externalId === "local-demo-user")
    && platform !== "max"
  ) {
    return true;
  }

  if (platform === "max" && !platformUserId) {
    return false;
  }

  if (platform !== "max" || platformUserId === "local-demo-user") {
    return Boolean(fallbackValue);
  }

  try {
    const checkUrl = useTestSubscriptionCheck
      ? MAX_INTERNAL_TEST_SUBSCRIPTION_CHECK_URL
      : MAX_INTERNAL_SUBSCRIPTION_CHECK_URL;
    const isSubscribed = await checkMaxChannelSubscription(platformUserId, checkUrl);

    if (typeof isSubscribed !== "boolean") {
      return Boolean(fallbackValue);
    }

    await setUserSubscriptionStatus({
      platform: "max",
      platformUserId,
      platformNickname: String(userInfo?.username || "").trim(),
      firstName: String(userInfo?.firstName || "").trim(),
      lastName: String(userInfo?.lastName || "").trim(),
      languageCode: String(userInfo?.languageCode || "").trim(),
      isSubscribed,
    });

    return isSubscribed;
  } catch (error) {
    console.warn("MAX subscription refresh failed", {
      platformUserId,
      error: error?.response?.data || error?.message || String(error),
    });
    return Boolean(fallbackValue);
  }
}
