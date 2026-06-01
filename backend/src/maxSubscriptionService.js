import { setUserSubscriptionStatus } from "./userStore.js";

const MAX_CHANNEL_URL = String(process.env.MAX_CHANNEL_URL || "https://max.ru/ozontravel_official")
  .trim();
const MAX_CHANNEL_CHAT_ID = Number(process.env.MAX_CHANNEL_CHAT_ID) || null;
const MAX_SUBSCRIPTION_CHECK_MODE = String(process.env.MAX_SUBSCRIPTION_CHECK_MODE || "api")
  .trim()
  .toLowerCase();

let cachedChannelChatId = MAX_CHANNEL_CHAT_ID;
let cachedBotApiPromise = null;

function normalizeMaxChatLink(value) {
  const normalizedValue = String(value || "").trim();

  if (!normalizedValue) {
    return "";
  }

  try {
    const parsedUrl = new URL(normalizedValue);

    if (parsedUrl.hostname !== "max.ru") {
      return normalizedValue;
    }

    return parsedUrl.pathname.replace(/^\/+/, "").split("/")[0] || "";
  } catch {
    return normalizedValue
      .replace(/^https?:\/\/max\.ru\/?/i, "")
      .replace(/^\/+/, "")
      .split("/")[0]
      .trim();
  }
}

async function getMaxBotApi() {
  if (!String(process.env.MAX_BOT_TOKEN || "").trim()) {
    return null;
  }

  if (!cachedBotApiPromise) {
    cachedBotApiPromise = import("../../max-bot/maxInstance.js")
      .then((module) => module?.bot?.api || null)
      .catch((error) => {
        console.warn("MAX bot API import failed", error);
        return null;
      });
  }

  return cachedBotApiPromise;
}

async function resolveChannelChatId(api) {
  if (cachedChannelChatId) {
    return cachedChannelChatId;
  }

  const channelLink = normalizeMaxChatLink(MAX_CHANNEL_URL);

  if (!channelLink) {
    throw new Error(`MAX channel link is empty: ${MAX_CHANNEL_URL}`);
  }

  const chat = await api.getChatByLink(channelLink);
  cachedChannelChatId = Number(chat?.chat_id) || null;

  if (!cachedChannelChatId) {
    throw new Error(`Failed to resolve MAX channel chat id for ${MAX_CHANNEL_URL}`);
  }

  return cachedChannelChatId;
}

async function checkMaxChannelSubscription(platformUserId) {
  if (MAX_SUBSCRIPTION_CHECK_MODE === "mock") {
    return true;
  }

  const api = await getMaxBotApi();

  if (!api) {
    return null;
  }

  const channelChatId = await resolveChannelChatId(api);
  const response = await api.getChatMembers(channelChatId, {
    user_ids: [Number(platformUserId)],
    count: 1,
  });
  const members = Array.isArray(response?.members) ? response.members : [];

  return members.some((member) => String(member.user_id) === String(platformUserId));
}

export async function refreshMiniAppSubscriptionStatus(userInfo = {}, fallbackValue = false) {
  const platform = String(userInfo?.platform || "").trim().toLowerCase();
  const platformUserId = String(userInfo?.platformUserId || "").trim();
  const externalId = String(userInfo?.externalId || "").trim();

  if (platformUserId === "local-demo-user" || externalId === "local-demo-user") {
    return true;
  }

  if (platform !== "max" || !platformUserId || platformUserId === "local-demo-user") {
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
