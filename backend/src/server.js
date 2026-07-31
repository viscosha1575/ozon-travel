import "dotenv/config";

import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import morgan from "morgan";

import { resolveMockAdminResponse } from "./adminMockBridge.js";
import { getProjectState, toggleProjectFinished } from "./appStateStore.js";
import { decodeRequestBody } from "./adminCipher.js";
import { initDatabase } from "./db.js";
import { getUploadsDir, initImageStorage } from "./imageStorage.js";
import { refreshMiniAppSubscriptionStatus } from "./maxSubscriptionService.js";
import { syncAnalyticsAggregates, trackSubscriptionRequiredAnalytics } from "./analyticsAggregateStore.js";
import {
  deletePlayerAnalytics,
  getAnalyticsUtm,
  getAnalyticsOverview,
  getPlayerAnalyticsDetails,
  getPlayerLogs,
  listPlayersAnalytics,
  logGameEvent,
} from "./analyticsStore.js";
import {
  createPrize,
  deleteManyPrizes,
  deletePrize,
  appendPrizePromoCodes,
  clearPrizePromoCodes,
  getPrizePromoCodeSchedule,
  reorderPrizes,
  getGameBootstrap,
  getSpinResult,
  listChances,
  listPrizes,
  spinPrize,
  updatePrizePromoCodeAvailability,
  updatePrizeEnabled,
  updateChance,
  updatePrize,
} from "./prizeStore.js";
import {
  createPush,
  deletePush,
  finalizePushRevoke,
  finalizePushSend,
  listPushes,
  preparePushRevoke,
  preparePushSend,
  revokePush,
  sendPush,
} from "./pushStore.js";
import {
  claimDailyAttemptReminderRecipients,
  getDailyAttemptReminderBroadcastRecipients,
  grantDailyAttemptsForAllUsers,
  markNotificationDeliveryFailed,
  markNotificationDeliverySent,
  sendDailyAttemptReminderBroadcastTest,
  validateDailyAttemptReminderDelivery,
} from "./notificationStore.js";
import { resolveMiniAppUser, resolveTelegramInitDataUser } from "./miniAppUser.js";
import {
  createUserFromPlatform,
  ensureDailyAttemptGrant,
  getOrCreateUser,
  getReferralData,
  grantOzonBankSubscriptionBonus,
  markGameControlsGuideSeen,
  setUserSubscriptionStatus,
} from "./userStore.js";
import {
  applySecurityHeaders,
  createCorsMiddleware,
  createRateLimitMiddleware,
  getTrustProxyHops,
  requireInternalApiToken,
} from "./security.js";

const app = express();
const PORT = Number(process.env.PORT || 3001);
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
const REQUEST_BODY_SECRET = String(process.env.REQUEST_BODY_SECRET || "").trim();
const ADMIN_TELEGRAM_IDS = new Set(
  String(process.env.ADMIN_TELEGRAM_IDS || "")
    .split(",")
    .map((value) => String(value || "").trim())
    .filter(Boolean),
);

function buildSubscriptionRequiredError() {
  const error = new Error("Требуется подписка на канал");
  error.statusCode = 403;
  error.code = "SUBSCRIPTION_REQUIRED";
  return error;
}

function buildMaxUserRequiredError() {
  const error = new Error("Не удалось определить пользователя MAX");
  error.statusCode = 403;
  error.code = "MAX_USER_REQUIRED";
  return error;
}

function buildAdminAccessDeniedError() {
  const error = new Error("У вас нет доступа к админке");
  error.statusCode = 403;
  error.code = "ADMIN_ACCESS_DENIED";
  return error;
}

function buildAdminInitDataRequiredError() {
  const error = new Error("Админка доступна только для разрешенных пользователей Telegram");
  error.statusCode = 403;
  error.code = "ADMIN_INIT_DATA_REQUIRED";
  return error;
}

function buildPublicMiniAppUserPayload(user, {
  subscribedToChannel = false,
  isResolved = true,
  userInfo = null,
} = {}) {
  const payload = {
    id: user ? Number(user.id) : null,
    externalId: user?.external_id || "",
    subscribedToChannel,
  };

  if (userInfo?.platform) {
    payload.platform = String(userInfo.platform || "").trim().toLowerCase();
  }

  if (payload.platform === "max") {
    payload.isResolved = Boolean(isResolved);

    if (!isResolved) {
      payload.errorCode = String(userInfo?.errorCode || "MAX_INIT_DATA_INVALID").trim();
    }
  }

  return payload;
}

function logUnresolvedMaxMiniAppRequest(req, userInfo, source) {
  const path = String(req.originalUrl || req.path || "").trim() || "/";
  const userAgent = String(req.get("user-agent") || "").trim();
  const hasInitDataHeader = Boolean(
    req.headers["x-mini-app-init-data"]
    || req.headers["x-max-init-data"],
  );
  const hasUserHeader = Boolean(req.headers["x-mini-app-user-id"]);

  console.warn("MAX mini app user resolution failed", {
    source,
    path,
    errorCode: String(userInfo?.errorCode || "MAX_INIT_DATA_INVALID").trim(),
    sessionId: String(userInfo?.sessionId || "").trim(),
    hasInitDataHeader,
    hasUserHeader,
    userAgent,
  });
}

function requireAdminTelegramUser(req) {
  const telegramUser = resolveTelegramInitDataUser(req);
  const telegramUserId = String(telegramUser?.platformUserId || "").trim();

  if (!telegramUserId) {
    throw buildAdminInitDataRequiredError();
  }

  if (!ADMIN_TELEGRAM_IDS.has(telegramUserId)) {
    throw buildAdminAccessDeniedError();
  }

  return {
    id: telegramUserId,
    username: telegramUser?.username || "",
    firstName: telegramUser?.firstName || "",
    lastName: telegramUser?.lastName || "",
  };
}

async function resolveSubscriptionContext(req) {
  const userInfo = resolveMiniAppUser(req);
  const isResolved = userInfo?.isResolved !== false;
  const requestHostname = String(req.hostname || "").trim().toLowerCase();
  const useTestSubscriptionCheck = requestHostname === "test.ozon-travel-max.ru";

  if (!isResolved && userInfo.platform === "max") {
    logUnresolvedMaxMiniAppRequest(req, userInfo, "subscription_context");

    return {
      userInfo,
      user: null,
      subscribedToChannel: false,
      isResolved: false,
    };
  }

  const user = await getOrCreateUser(userInfo);
  const subscribedToChannel = await refreshMiniAppSubscriptionStatus(
    userInfo,
    Boolean(user.subscribed_to_channel),
    { useTestSubscriptionCheck },
  );

  return {
    userInfo,
    user,
    subscribedToChannel,
    isResolved: true,
  };
}

async function requireSubscribedGameUser(req) {
  const context = await resolveSubscriptionContext(req);

  if (!context.isResolved && context.userInfo.platform === "max") {
    throw buildMaxUserRequiredError();
  }

  if (!context.subscribedToChannel) {
    throw buildSubscriptionRequiredError();
  }

  return context;
}

app.disable("x-powered-by");
app.set("trust proxy", getTrustProxyHops());

app.use(createCorsMiddleware());
app.use(applySecurityHeaders);
app.use(express.json({ limit: "25mb" }));
app.use(morgan("dev", {
  skip: (req) => req.path === "/api/health",
}));
app.use(express.static(publicDir));
app.use("/uploads", express.static(getUploadsDir()));

const publicGameReadRateLimit = createRateLimitMiddleware({
  bucket: "game-read",
  windowMs: 60 * 1000,
  maxRequests: 90,
});
const spinRateLimit = createRateLimitMiddleware({
  bucket: "game-spin",
  windowMs: 60 * 1000,
  maxRequests: 20,
});
const eventRateLimit = createRateLimitMiddleware({
  bucket: "game-event",
  windowMs: 60 * 1000,
  maxRequests: 240,
});
const controlsGuideRateLimit = createRateLimitMiddleware({
  bucket: "controls-guide",
  windowMs: 60 * 1000,
  maxRequests: 30,
});
const internalNotificationRateLimit = createRateLimitMiddleware({
  bucket: "internal-notifications",
  windowMs: 60 * 1000,
  maxRequests: 6000,
});
const internalWriteRateLimit = createRateLimitMiddleware({
  bucket: "internal-write",
  windowMs: 60 * 1000,
  maxRequests: 240,
  skip: (req) => {
    const requestPath = String(req.originalUrl || req.path || "");
    return requestPath.startsWith("/api/internal/notifications")
      || requestPath.startsWith("/notifications");
  },
});
const adminRateLimit = createRateLimitMiddleware({
  bucket: "admin-api",
  windowMs: 60 * 1000,
  maxRequests: 180,
});

app.use("/api/game/bootstrap", publicGameReadRateLimit);
app.use("/api/game/subscription-status", publicGameReadRateLimit);
app.use("/api/game/open", publicGameReadRateLimit);
app.use("/api/game/spin/result", publicGameReadRateLimit);
app.use("/api/game/spin", (req, res, next) => {
  if (req.path === "/" || req.path === "") {
    spinRateLimit(req, res, next);
    return;
  }

  next();
});
app.use("/api/game/controls-guide/seen", controlsGuideRateLimit);
app.use("/api/game/event", eventRateLimit);
app.use("/api/users/create", requireInternalApiToken, internalWriteRateLimit);
app.use("/api/users/set-subscription-status", requireInternalApiToken, internalWriteRateLimit);
app.use("/api/users/grant-ozon-bank-bonus", requireInternalApiToken, internalWriteRateLimit);
app.use("/api/logs/create", requireInternalApiToken, internalWriteRateLimit);
app.use("/api/internal/notifications", requireInternalApiToken, internalNotificationRateLimit);
app.use("/api/internal", requireInternalApiToken, internalWriteRateLimit);
app.use(/^\/api\/admin\/.*$/, adminRateLimit);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/game/bootstrap", async (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    const { userInfo } = await requireSubscribedGameUser(req);
    const response = await getGameBootstrap(userInfo);
    res.json(response);
  } catch (error) {
    next(error);
  }
});

app.get("/api/game/subscription-status", async (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    const { user, userInfo, subscribedToChannel, isResolved } = await resolveSubscriptionContext(req);

    if (user && !subscribedToChannel) {
      await trackSubscriptionRequiredAnalytics(
        null,
        Number(user.id),
        {
          source: "subscription_status",
          endpoint: "/api/game/subscription-status",
        },
      );
    }

    res.json({
      ok: true,
      user: buildPublicMiniAppUserPayload(user, {
        subscribedToChannel,
        isResolved,
        userInfo,
      }),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/game/spin", async (req, res, next) => {
  try {
    const projectState = await getProjectState();

    if (projectState.projectFinished) {
      const error = new Error("Проект завершен");
      error.statusCode = 409;
      error.code = "PROJECT_FINISHED";
      throw error;
    }

    const { userInfo } = await requireSubscribedGameUser(req);
    const response = await spinPrize(userInfo);
    res.json(response);
  } catch (error) {
    next(error);
  }
});

app.post("/api/game/spin/result", async (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    const { userInfo } = await requireSubscribedGameUser(req);
    const response = await getSpinResult(userInfo, req.body || {});
    res.json(response);
  } catch (error) {
    next(error);
  }
});

app.post("/api/game/open", async (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    const { userInfo, user, subscribedToChannel, isResolved } = await resolveSubscriptionContext(req);
    const projectState = await getProjectState();
    const attempts = user ? await ensureDailyAttemptGrant(user.id) : null;
    const referral = user ? await getReferralData(user.id) : null;

    if (user && req.body?.trackOpen !== false) {
      await logGameEvent(userInfo, "app_open", {
        source: "frontend",
        sessionId: userInfo.sessionId,
        details: {
          entryScreen: String(req.body?.entryScreen || "").trim() || "game",
          availableAttempts: attempts?.availableAttempts ?? 0,
          subscribedToChannel: Boolean(subscribedToChannel),
        },
      });
    }

    if (user && !subscribedToChannel) {
      await trackSubscriptionRequiredAnalytics(
        null,
        Number(user.id),
        {
          source: "game_open",
          endpoint: "/api/game/open",
          entryScreen: String(req.body?.entryScreen || "").trim() || "game",
        },
      );
    }

    res.json({
      ok: true,
      projectFinished: projectState.projectFinished,
      shouldShowControlsGuide: Boolean(user) && !Boolean(user.has_seen_game_controls_guide),
      user: buildPublicMiniAppUserPayload(user, {
        subscribedToChannel: isResolved ? subscribedToChannel : false,
        isResolved,
        userInfo,
      }),
      attempts,
      referral,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/game/controls-guide/seen", async (req, res, next) => {
  try {
    const { user } = await requireSubscribedGameUser(req);
    await markGameControlsGuideSeen(user.id);

    res.json({
      ok: true,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/game/event", async (req, res, next) => {
  try {
    const userInfo = resolveMiniAppUser(req);

    if (userInfo.platform === "max" && userInfo.isResolved === false) {
      res.json({
        ok: true,
        eventId: null,
      });
      return;
    }

    const eventName = String(req.body?.eventName || "").trim();
    const details = req.body?.details && typeof req.body.details === "object" && !Array.isArray(req.body.details)
      ? req.body.details
      : {};
    const event = await logGameEvent(userInfo, eventName, {
      source: "frontend",
      sessionId: userInfo.sessionId,
      details,
    });

    res.json({
      ok: true,
      eventId: event.id,
    });
  } catch (error) {
    next(error);
  }
});

/*
app.post("/api/game/dev/grant-attempts", async (req, res, next) => {
  try {
    const userInfo = resolveMiniAppUser(req);
    const user = await getOrCreateUser(userInfo);
    const attempts = await grantUserAttempts(user.id, req.body?.count || 10);

    await logGameEvent(userInfo, "dev_attempts_granted", {
      source: "frontend",
      sessionId: userInfo.sessionId,
      details: {
        grantedAttempts: Math.max(1, Math.round(Number(req.body?.count) || 10)),
        availableAttempts: attempts.availableAttempts,
      },
    });

    res.json({
      ok: true,
      attempts,
    });
  } catch (error) {
    next(error);
  }
});
*/

/*
app.post("/api/game/dev/delete-user", async (req, res, next) => {
  try {
    const userInfo = resolveMiniAppUser(req);
    const user = await getOrCreateUser(userInfo);
    const deleted = await deleteUserById(user.id);

    res.json({
      ok: true,
      ...deleted,
    });
  } catch (error) {
    next(error);
  }
});
*/

app.post("/api/users/create", async (req, res, next) => {
  const body = decodeRequestBody(req.body, REQUEST_BODY_SECRET);

  try {
    const response = await createUserFromPlatform(body);
    res.json(response);
  } catch (error) {
    next(error);
  }
});

app.post("/api/users/set-subscription-status", async (req, res, next) => {
  const body = decodeRequestBody(req.body, REQUEST_BODY_SECRET);

  try {
    const response = await setUserSubscriptionStatus(body);
    res.json(response);
  } catch (error) {
    next(error);
  }
});

app.post("/api/users/grant-ozon-bank-bonus", async (req, res, next) => {
  const body = decodeRequestBody(req.body, REQUEST_BODY_SECRET);

  try {
    const response = await grantOzonBankSubscriptionBonus(body);
    res.json(response);
  } catch (error) {
    next(error);
  }
});

app.post("/api/logs/create", async (req, res, next) => {
  const body = decodeRequestBody(req.body, REQUEST_BODY_SECRET);

  try {
    const platform = String(body?.platform || "").trim().toLowerCase() || "telegram";
    const platformUserId = String(body?.platformUserId || "").trim();

    if (!platformUserId) {
      const error = new Error("platformUserId is required");
      error.statusCode = 400;
      throw error;
    }

    const response = await logGameEvent({
      platform,
      platformUserId,
      username: String(body?.platformNickname || body?.username || "").trim(),
      firstName: String(body?.firstName || "").trim(),
      lastName: String(body?.lastName || "").trim(),
      languageCode: String(body?.languageCode || "").trim(),
    }, body?.eventName, {
      source: String(body?.source || "max_bot").trim() || "max_bot",
      details:
        body?.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
          ? body.metadata
          : {},
    });

    res.json({
      ok: true,
      logId: Number(response.id),
      createdAt: response.createdAt,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/internal/notifications/daily-attempts/grant", async (req, res, next) => {
  const body = decodeRequestBody(req.body, REQUEST_BODY_SECRET);

  try {
    res.json(await grantDailyAttemptsForAllUsers(body));
  } catch (error) {
    next(error);
  }
});

app.post("/api/internal/notifications/daily-attempt-reminder/claim", async (req, res, next) => {
  const body = decodeRequestBody(req.body, REQUEST_BODY_SECRET);

  try {
    res.json(await claimDailyAttemptReminderRecipients(body));
  } catch (error) {
    next(error);
  }
});

app.post("/api/internal/notifications/daily-attempt-reminder/validate", async (req, res, next) => {
  const body = decodeRequestBody(req.body, REQUEST_BODY_SECRET);

  try {
    res.json(await validateDailyAttemptReminderDelivery(body));
  } catch (error) {
    next(error);
  }
});

app.post("/api/internal/notifications/daily-attempt-reminder/test-broadcast/prepare", async (req, res, next) => {
  try {
    res.json(await getDailyAttemptReminderBroadcastRecipients());
  } catch (error) {
    next(error);
  }
});

app.post("/api/internal/notifications/deliveries/sent", async (req, res, next) => {
  const body = decodeRequestBody(req.body, REQUEST_BODY_SECRET);

  try {
    res.json(await markNotificationDeliverySent(body));
  } catch (error) {
    next(error);
  }
});

app.post("/api/internal/notifications/deliveries/failed", async (req, res, next) => {
  const body = decodeRequestBody(req.body, REQUEST_BODY_SECRET);

  try {
    res.json(await markNotificationDeliveryFailed(body));
  } catch (error) {
    next(error);
  }
});

app.post("/api/internal/pushes/send/prepare", async (req, res, next) => {
  const body = decodeRequestBody(req.body, REQUEST_BODY_SECRET);

  try {
    res.json(await preparePushSend(body));
  } catch (error) {
    next(error);
  }
});

app.post("/api/internal/pushes/send/finalize", async (req, res, next) => {
  const body = decodeRequestBody(req.body, REQUEST_BODY_SECRET);

  try {
    res.json(await finalizePushSend(body));
  } catch (error) {
    next(error);
  }
});

app.post("/api/internal/pushes/revoke/prepare", async (req, res, next) => {
  const body = decodeRequestBody(req.body, REQUEST_BODY_SECRET);

  try {
    res.json(await preparePushRevoke(body));
  } catch (error) {
    next(error);
  }
});

app.post("/api/internal/pushes/revoke/finalize", async (req, res, next) => {
  const body = decodeRequestBody(req.body, REQUEST_BODY_SECRET);

  try {
    res.json(await finalizePushRevoke(body));
  } catch (error) {
    next(error);
  }
});

app.post(/^\/api\/admin\/.*$/, async (req, res, next) => {
  const path = req.path.replace(/^\/api\/admin/, "/api");
  const body = decodeRequestBody(req.body, REQUEST_BODY_SECRET);

  try {
    const adminUser = requireAdminTelegramUser(req);

    if (path === "/api/auth/me") {
      res.json({
        admin: {
          id: adminUser.id,
          username: adminUser.username || `telegram_${adminUser.id}`,
          firstName: adminUser.firstName,
          lastName: adminUser.lastName,
          authProvider: "telegram",
        },
      });
      return;
    }

    if (path === "/api/prizes/list") {
      res.json(await listPrizes(body));
      return;
    }

    if (path === "/api/prizes/create") {
      res.json(await createPrize(body));
      return;
    }

    if (path === "/api/prizes/update") {
      res.json(await updatePrize(body));
      return;
    }

    if (path === "/api/prizes/toggle-enabled") {
      res.json(await updatePrizeEnabled(body));
      return;
    }

    if (path === "/api/prizes/promo-codes/clear") {
      res.json(await clearPrizePromoCodes(body));
      return;
    }

    if (path === "/api/prizes/promo-codes/schedule") {
      res.json(await getPrizePromoCodeSchedule(body));
      return;
    }

    if (path === "/api/prizes/promo-codes/append") {
      res.json(await appendPrizePromoCodes(body));
      return;
    }

    if (path === "/api/prizes/promo-codes/update-availability") {
      res.json(await updatePrizePromoCodeAvailability(body));
      return;
    }

    if (path === "/api/prizes/reorder") {
      res.json(await reorderPrizes(body));
      return;
    }

    if (path === "/api/prizes/delete") {
      res.json(await deletePrize(body));
      return;
    }

    if (path === "/api/prizes/delete-many") {
      res.json(await deleteManyPrizes(body));
      return;
    }

    if (path === "/api/project/toggle") {
      res.json(await toggleProjectFinished());
      return;
    }

    if (path === "/api/chances/list") {
      res.json(await listChances(body));
      return;
    }

    if (path === "/api/chances/update") {
      res.json(await updateChance(body));
      return;
    }

    if (path === "/api/analytics/overview") {
      res.json(await getAnalyticsOverview(body));
      return;
    }

    if (path === "/api/analytics/utm") {
      res.json(await getAnalyticsUtm(body));
      return;
    }

    if (path === "/api/analytics/players") {
      res.json(await listPlayersAnalytics(body));
      return;
    }

    if (path === "/api/analytics/player") {
      res.json(await getPlayerAnalyticsDetails(body));
      return;
    }

    if (path === "/api/pushes/list") {
      res.json(await listPushes(body));
      return;
    }

    if (path === "/api/pushes/create") {
      res.json(await createPush(body));
      return;
    }

    if (path === "/api/pushes/send") {
      res.json(await sendPush(body));
      return;
    }

    if (path === "/api/pushes/reminder-test/send") {
      res.json(await sendDailyAttemptReminderBroadcastTest());
      return;
    }

    if (path === "/api/pushes/revoke") {
      res.json(await revokePush(body));
      return;
    }

    if (path === "/api/pushes/delete") {
      res.json(await deletePush(body));
      return;
    }

    if (path === "/api/logs/user") {
      res.json(await getPlayerLogs(body));
      return;
    }

    if (path === "/api/users/delete") {
      res.json(await deletePlayerAnalytics(body));
      return;
    }

    res.json(resolveMockAdminResponse(path, body));
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  const statusCode = error?.statusCode || 500;
  const message = error?.message || "Internal server error";
  const code = error?.code ? String(error.code) : "";
  res.status(statusCode).json(code ? { message, code } : { message });
});

async function start() {
  await initDatabase();
  await syncAnalyticsAggregates();
  await initImageStorage();

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Backend listening on http://0.0.0.0:${PORT}`);
  });
}

start().catch((error) => {
  console.error("Failed to start backend", error);
  process.exit(1);
});
