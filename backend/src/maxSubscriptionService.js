import { setUserSubscriptionStatus } from "./userStore.js";

const MAX_SUBSCRIPTION_CHECK_MODE = String(process.env.MAX_SUBSCRIPTION_CHECK_MODE || "api")
  .trim()
  .toLowerCase();
const MAX_BOT_INTERNAL_URL = String(process.env.MAX_BOT_INTERNAL_URL || "http://max-bot:3011")
  .trim()
  .replace(/\/$/, "");
const INTERNAL_MAX_BOT_TOKEN = String(
  process.env.BROADCAST_INTERNAL_TOKEN || process.env.REQUEST_BODY_SECRET || "",
).trim();
const MAX_SUBSCRIPTION_TIMEOUT_MS = Math.max(
  1000,
  Math.round(Number(process.env.MAX_SUBSCRIPTION_TIMEOUT_MS || 10000) || 10000),
);

async function checkMaxChannelSubscription(platformUserId) {
  if (MAX_SUBSCRIPTION_CHECK_MODE === "mock") {
    return true;
  }

  if (!INTERNAL_MAX_BOT_TOKEN) {
    throw new Error("Missing internal MAX bot token");
  }

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    abortController.abort();
  }, MAX_SUBSCRIPTION_TIMEOUT_MS);

  try {
    const response = await fetch(`${MAX_BOT_INTERNAL_URL}/internal/subscription/check`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Broadcast-Token": INTERNAL_MAX_BOT_TOKEN,
      },
      body: JSON.stringify({
        userId: String(platformUserId),
      }),
      signal: abortController.signal,
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload?.message || `MAX bot internal check failed with ${response.status}`);
    }

    return Boolean(payload?.subscribed);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function refreshMiniAppSubscriptionStatus(userInfo = {}, fallbackValue = false) {
  const platform = String(userInfo?.platform || "").trim().toLowerCase();
  const platformUserId = String(userInfo?.platformUserId || "").trim();
  const externalId = String(userInfo?.externalId || "").trim();

  if (platform === "telegram") {
    return true;
  }

  if ((platformUserId === "local-demo-user" || externalId === "local-demo-user") && platform !== "max") {
    return true;
  }

  if (platform === "max" && !platformUserId) {
    return false;
  }

  if (platform !== "max" || platformUserId === "local-demo-user") {
    return Boolean(fallbackValue);
  }

  try {
    const isSubscribed = await checkMaxChannelSubscription(platformUserId);

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
