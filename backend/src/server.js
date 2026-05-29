import "dotenv/config";

import cors from "cors";
import express from "express";
import morgan from "morgan";

import { resolveMockAdminResponse } from "./adminMockBridge.js";
import { getProjectState, toggleProjectFinished } from "./appStateStore.js";
import { decodeRequestBody } from "./adminCipher.js";
import { initDatabase } from "./db.js";
import { getUploadsDir, initImageStorage } from "./imageStorage.js";
import { refreshMiniAppSubscriptionStatus } from "./maxSubscriptionService.js";
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
  getGameBootstrap,
  listChances,
  listPrizes,
  spinPrize,
  updateChance,
  updatePrize,
} from "./prizeStore.js";
import {
  createPush,
  deletePush,
  listPushes,
  revokePush,
  sendPush,
} from "./pushStore.js";
import { resolveMiniAppUser } from "./miniAppUser.js";
import {
  createUserFromPlatform,
  deleteUserById,
  ensureDailyAttemptGrant,
  getOrCreateUser,
  getReferralData,
  grantUserAttempts,
  setUserSubscriptionStatus,
} from "./userStore.js";

const app = express();
const PORT = Number(process.env.PORT || 3001);
const REQUEST_BODY_SECRET = String(process.env.REQUEST_BODY_SECRET || "").trim();

app.use(cors({
  origin: true,
  credentials: false,
}));
app.use(express.json({ limit: "25mb" }));
app.use(morgan("dev"));
app.use("/uploads", express.static(getUploadsDir()));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/game/bootstrap", async (req, res, next) => {
  try {
    const response = await getGameBootstrap(resolveMiniAppUser(req));
    res.json(response);
  } catch (error) {
    next(error);
  }
});

app.get("/api/game/subscription-status", async (req, res, next) => {
  try {
    const userInfo = resolveMiniAppUser(req);
    const user = await getOrCreateUser(userInfo);
    const subscribedToChannel = await refreshMiniAppSubscriptionStatus(
      userInfo,
      Boolean(user.subscribed_to_channel),
    );

    res.json({
      ok: true,
      user: {
        id: Number(user.id),
        externalId: user.external_id,
        subscribedToChannel,
      },
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

    const response = await spinPrize(resolveMiniAppUser(req));
    res.json(response);
  } catch (error) {
    next(error);
  }
});

app.post("/api/game/open", async (req, res, next) => {
  try {
    const userInfo = resolveMiniAppUser(req);
    const user = await getOrCreateUser(userInfo);
    const subscribedToChannel = await refreshMiniAppSubscriptionStatus(
      userInfo,
      Boolean(user.subscribed_to_channel),
    );
    const attempts = await ensureDailyAttemptGrant(user.id);
    const referral = await getReferralData(user.id);
    const projectState = await getProjectState();

    if (req.body?.trackOpen !== false) {
      await logGameEvent(userInfo, "app_open", {
        source: "frontend",
        sessionId: userInfo.sessionId,
        details: {
          entryScreen: String(req.body?.entryScreen || "").trim() || "game",
          availableAttempts: attempts.availableAttempts,
        },
      });
    }

    res.json({
      ok: true,
      projectFinished: projectState.projectFinished,
      user: {
        id: Number(user.id),
        externalId: user.external_id,
        subscribedToChannel,
      },
      attempts,
      referral,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/game/event", async (req, res, next) => {
  try {
    const userInfo = resolveMiniAppUser(req);
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

    const externalId = platform === "telegram"
      ? platformUserId
      : `${platform}:${platformUserId}`;
    const response = await logGameEvent({
      externalId,
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

app.post(/^\/api\/admin\/.*$/, async (req, res, next) => {
  const path = req.path.replace(/^\/api\/admin/, "/api");
  const body = decodeRequestBody(req.body, REQUEST_BODY_SECRET);

  try {
    if (path === "/api/auth/me") {
      res.json({
        admin: {
          id: "local-admin",
          username: "local_admin",
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

    if (path === "/api/prizes/promo-codes/clear") {
      res.json(await clearPrizePromoCodes(body));
      return;
    }

    if (path === "/api/prizes/promo-codes/append") {
      res.json(await appendPrizePromoCodes(body));
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
  await initImageStorage();

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Backend listening on http://0.0.0.0:${PORT}`);
  });
}

start().catch((error) => {
  console.error("Failed to start backend", error);
  process.exit(1);
});
