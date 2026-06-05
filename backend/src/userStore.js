import { query, withTransaction } from "./db.js";
import { sendMaxUserTextNotification } from "./maxBroadcastService.js";
import { buildStartParam, parseStartParam } from "./startParam.js";
import {
  trackNewUserAnalytics,
  trackReferralLinkedAnalytics,
  trackSpinConsumedAnalytics,
} from "./analyticsAggregateStore.js";

const MAX_BOT_PUBLIC_URL = String(
  process.env.MAX_BOT_PUBLIC_URL || "https://max.ru/ozontravel_lenta_bot",
).trim().replace(/\/$/, "");
const MSK_TIMEZONE = "Europe/Moscow";
const DAILY_ATTEMPT_REASON = "daily_login_attempt";
const REFERRAL_BONUS_NOTIFICATION_TEXT = "Рефералл присоединился, вам +1 попытка!";

function normalizePlatform(value) {
  const platform = String(value || "").trim().toLowerCase();
  return platform || "telegram";
}

function parseExternalId(value) {
  const externalId = String(value || "").trim();

  if (!externalId) {
    return {
      platform: "telegram",
      platformUserId: "",
      externalId: "",
    };
  }

  const separatorIndex = externalId.indexOf(":");

  if (separatorIndex <= 0) {
    return {
      platform: "telegram",
      platformUserId: externalId,
      externalId,
    };
  }

  const platform = normalizePlatform(externalId.slice(0, separatorIndex));
  const platformUserId = externalId.slice(separatorIndex + 1).trim();

  return {
    platform,
    platformUserId,
    externalId: buildPlatformExternalId(platform, platformUserId),
  };
}

function buildPlatformExternalId(platform, platformUserId) {
  const normalizedPlatform = normalizePlatform(platform);
  const normalizedPlatformUserId = String(platformUserId || "").trim();

  if (!normalizedPlatformUserId) {
    return "";
  }

  if (normalizedPlatform === "telegram") {
    return normalizedPlatformUserId;
  }

  return `${normalizedPlatform}:${normalizedPlatformUserId}`;
}

function resolveUserIdentity(userInfo = {}) {
  const explicitPlatformUserId = String(userInfo.platformUserId || userInfo.userId || "").trim();

  if (explicitPlatformUserId) {
    const platform = normalizePlatform(userInfo.platform);

    return {
      platform,
      platformUserId: explicitPlatformUserId,
      externalId: buildPlatformExternalId(platform, explicitPlatformUserId),
    };
  }

  return parseExternalId(userInfo.externalId);
}

function buildReferralCode(value) {
  return `OZONTRAVEL-${String(value || "")
    .replace(/\W+/g, "")
    .slice(-6)
    .padStart(6, "0")}`;
}

function getMoscowDateValue() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: MSK_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function buildReferralLink(referralCode) {
  const payload = buildStartParam({ referralCode });

  if (!payload || !MAX_BOT_PUBLIC_URL) {
    return "";
  }

  const separator = MAX_BOT_PUBLIC_URL.includes("?") ? "&" : "?";
  return `${MAX_BOT_PUBLIC_URL}${separator}startapp=${encodeURIComponent(payload)}`;
}

async function upsertUser(executor, userInfo = {}) {
  const {
    platform,
    platformUserId,
    externalId: resolvedExternalId,
  } = resolveUserIdentity(userInfo);

  if (platform === "max" && !platformUserId) {
    const error = new Error("Не удалось определить пользователя MAX");
    error.statusCode = 403;
    error.code = "MAX_USER_REQUIRED";
    throw error;
  }

  const externalId = resolvedExternalId || "local-demo-user";
  const resolvedPlatformUserId = platformUserId || "local-demo-user";
  const username = String(userInfo.username || "").trim();
  const firstName = String(userInfo.firstName || "").trim();
  const lastName = String(userInfo.lastName || "").trim();
  const languageCode = String(userInfo.languageCode || "").trim();
  const startParam = String(userInfo.startParam || "").trim();
  const parsedStartParam = parseStartParam(startParam);
  const referralCode = buildReferralCode(resolvedPlatformUserId);
  const result = await executor.query(
    `
      INSERT INTO app_users (
        platform,
        platform_user_id,
        external_id,
        username,
        first_name,
        last_name,
        language_code,
        start_param,
        referral_code,
        has_seen_game_controls_guide,
        utm_slug,
        updated_at,
        last_seen_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE, $10, NOW(), NOW())
      ON CONFLICT (platform, platform_user_id)
      DO UPDATE SET
        external_id = EXCLUDED.external_id,
        username = EXCLUDED.username,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        language_code = EXCLUDED.language_code,
        start_param = CASE
          WHEN EXCLUDED.start_param <> '' THEN EXCLUDED.start_param
          ELSE app_users.start_param
        END,
        utm_slug = CASE
          WHEN EXCLUDED.utm_slug <> '' THEN EXCLUDED.utm_slug
          ELSE app_users.utm_slug
        END,
        updated_at = NOW(),
        last_seen_at = NOW()
      RETURNING *, (xmax = 0) AS was_inserted
    `,
    [
      platform,
      resolvedPlatformUserId,
      externalId,
      username,
      firstName,
      lastName,
      languageCode,
      startParam,
      referralCode,
      parsedStartParam.utmSlug,
    ],
  );

  return result.rows[0];
}

async function grantReferralBonusIfEligible(executor, userRow) {
  const userId = Number(userRow?.id) || 0;
  const referrerId = Number(userRow?.referred_by_user_id) || 0;

  if (!userId || !referrerId || referrerId === userId || !Boolean(userRow?.subscribed_to_channel)) {
    return null;
  }

  const referrerResult = await executor.query(
    `
      SELECT id, referral_code, platform, platform_user_id
      FROM app_users
      WHERE id = $1
      LIMIT 1
    `,
    [referrerId],
  );
  const referrer = referrerResult.rows[0];

  if (!referrer || Number(referrer.id) === userId) {
    return null;
  }

  const parsedStartParam = parseStartParam(userRow.start_param || "");
  const referralCode = parsedStartParam.referralCode || String(referrer.referral_code || "").trim();
  const referralBonusResult = await executor.query(
    `
      INSERT INTO user_attempt_transactions (
        user_id,
        delta,
        reason,
        related_user_id,
        details
      )
      VALUES ($1, 1, 'referral_bonus', $2, $3::jsonb)
      ON CONFLICT DO NOTHING
      RETURNING created_at
    `,
    [
      referrer.id,
      userId,
      JSON.stringify({
        invitedUserId: userId,
        invitedExternalId: userRow.external_id,
        invitedPlatform: String(userRow.platform || "").trim(),
        invitedPlatformUserId: String(userRow.platform_user_id || "").trim(),
        referralCode,
      }),
    ],
  );

  if (!referralBonusResult.rowCount) {
    return null;
  }

  await trackReferralLinkedAnalytics(
    executor,
    Number(referrer.id),
    userId,
    referralBonusResult.rows[0]?.created_at || userRow.updated_at || new Date().toISOString(),
  );

  return {
    referrerId: Number(referrer.id),
    invitedUserId: userId,
    notification: String(referrer.platform || "").trim() === "max" && String(referrer.platform_user_id || "").trim()
      ? {
        maxUserId: String(referrer.platform_user_id || "").trim(),
        text: REFERRAL_BONUS_NOTIFICATION_TEXT,
      }
      : null,
  };
}

async function attachReferrer(executor, userRow) {
  const startParam = String(userRow.start_param || "").trim();
  const parsedStartParam = parseStartParam(startParam);
  const referralCodeFromStartParam = parsedStartParam.referralCode;
  const ownReferralCode = String(userRow.referral_code || "").trim();

  if (userRow.referred_by_user_id) {
    await grantReferralBonusIfEligible(executor, userRow);
    return userRow;
  }

  if (!referralCodeFromStartParam || referralCodeFromStartParam === ownReferralCode) {
    return userRow;
  }

  const referrerResult = await executor.query(
    `
      SELECT id, referral_code
      FROM app_users
      WHERE referral_code = $1
      LIMIT 1
    `,
    [referralCodeFromStartParam],
  );
  const referrer = referrerResult.rows[0];

  if (!referrer || Number(referrer.id) === Number(userRow.id)) {
    return userRow;
  }

  const updatedResult = await executor.query(
    `
      UPDATE app_users
      SET referred_by_user_id = $2, updated_at = NOW()
      WHERE id = $1 AND referred_by_user_id IS NULL
      RETURNING *
    `,
    [userRow.id, referrer.id],
  );
  const linkedUser = updatedResult.rows[0] || userRow;

  if (!updatedResult.rowCount) {
    return linkedUser;
  }

  await grantReferralBonusIfEligible(executor, linkedUser);

  return linkedUser;
}

async function registerUtmVisitInternal(executor, userId, userInfo = {}, options = {}) {
  const parsedStartParam = parseStartParam(userInfo.startParam);
  const utmSlug = parsedStartParam.utmSlug;
  const sessionId = String(userInfo.sessionId || "").trim();

  if (!utmSlug) {
    return null;
  }

  const result = await executor.query(
    `
      INSERT INTO utm_visits (
        user_id,
        utm_slug,
        session_id,
        raw_start_param,
        referral_code,
        was_existing_player
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT DO NOTHING
      RETURNING id, created_at
    `,
    [
      userId,
      utmSlug,
      sessionId,
      parsedStartParam.raw,
      parsedStartParam.referralCode,
      Boolean(options.wasExistingPlayer),
    ],
  );

  if (!result.rowCount) {
    return null;
  }

  return {
    id: Number(result.rows[0].id),
    utmSlug,
    createdAt: result.rows[0].created_at,
  };
}

async function ensureDailyAttemptGrantInternal(executor, userId) {
  const todayValue = getMoscowDateValue();
  const balanceResult = await executor.query(
    `
      SELECT COALESCE(SUM(delta), 0)::int AS available_attempts
      FROM user_attempt_transactions
      WHERE user_id = $1
    `,
    [userId],
  );
  const availableAttempts = Number(balanceResult.rows[0]?.available_attempts || 0);

  if (availableAttempts > 0) {
    return {
      granted: false,
      availableAttempts,
    };
  }

  await executor.query(
    `
      INSERT INTO user_attempt_transactions (
        user_id,
        delta,
        reason,
        attempt_date,
        details
      )
      VALUES ($1, 1, $2, $3, $4::jsonb)
      ON CONFLICT DO NOTHING
    `,
    [
      userId,
      DAILY_ATTEMPT_REASON,
      todayValue,
      JSON.stringify({
        timezone: MSK_TIMEZONE,
        grantedAtDate: todayValue,
        source: "open_fallback",
      }),
    ],
  );

  return {
    granted: true,
    availableAttempts: availableAttempts + 1,
  };
}

async function getAttemptSummaryInternal(executor, userId) {
  const todayValue = getMoscowDateValue();
  const balanceResult = await executor.query(
    `
      SELECT COALESCE(SUM(delta), 0)::int AS available_attempts
      FROM user_attempt_transactions
      WHERE user_id = $1
    `,
    [userId],
  );
  const referralResult = await executor.query(
    `
      SELECT COUNT(*)::int AS invited_referrals_count
      FROM user_attempt_transactions
      WHERE user_id = $1
        AND reason = 'referral_bonus'
        AND related_user_id IS NOT NULL
    `,
    [userId],
  );
  const todayGrantResult = await executor.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM user_attempt_transactions
        WHERE user_id = $1
          AND reason = $2
          AND attempt_date = $3
      ) AS granted_today
    `,
    [userId, DAILY_ATTEMPT_REASON, todayValue],
  );

  return {
    availableAttempts: Number(balanceResult.rows[0]?.available_attempts || 0),
    invitedReferralsCount: Number(referralResult.rows[0]?.invited_referrals_count || 0),
    dailyAttemptGrantedToday: Boolean(todayGrantResult.rows[0]?.granted_today),
  };
}

async function getInvitedReferralIdsInternal(executor, userId) {
  const result = await executor.query(
    `
      SELECT related_user_id AS id
      FROM user_attempt_transactions
      WHERE user_id = $1
        AND reason = 'referral_bonus'
        AND related_user_id IS NOT NULL
      ORDER BY created_at ASC, user_attempt_transactions.id ASC
    `,
    [userId],
  );

  return result.rows.map((row) => Number(row.id));
}

async function runGetOrCreate(executor, userInfo = {}) {
  const upsertedUser = await upsertUser(executor, userInfo);
  const linkedUser = await attachReferrer(executor, upsertedUser);

  if (upsertedUser.was_inserted) {
    await trackNewUserAnalytics(executor, linkedUser, "system");
  }

  return {
    ...linkedUser,
    was_inserted: Boolean(upsertedUser.was_inserted),
  };
}

export async function getOrCreateUser(userInfo = {}, client = null) {
  if (client) {
    return runGetOrCreate(client, userInfo);
  }

  return withTransaction(async (transactionClient) => runGetOrCreate(transactionClient, userInfo));
}

export async function ensureDailyAttemptGrant(userId, client = null) {
  if (client) {
    await ensureDailyAttemptGrantInternal(client, userId);
    return getAttemptSummaryInternal(client, userId);
  }

  return withTransaction(async (transactionClient) => {
    await ensureDailyAttemptGrantInternal(transactionClient, userId);
    return getAttemptSummaryInternal(transactionClient, userId);
  });
}

export async function getUserAttemptSummary(userId, client = null) {
  const executor = client || { query };
  return getAttemptSummaryInternal(executor, userId);
}

export async function consumeUserAttempt(userId, details = {}, client = null) {
  const runConsume = async (executor) => {
    const summary = await getAttemptSummaryInternal(executor, userId);

    if (summary.availableAttempts <= 0) {
      const error = new Error("Нет доступных попыток");
      error.statusCode = 400;
      throw error;
    }

    await executor.query(
      `
        INSERT INTO user_attempt_transactions (user_id, delta, reason, details)
        VALUES ($1, -1, 'spin_consumed', $2::jsonb)
      `,
      [userId, JSON.stringify(details && typeof details === "object" ? details : {})],
    );
    await trackSpinConsumedAnalytics(executor, userId);

    return getAttemptSummaryInternal(executor, userId);
  };

  if (client) {
    return runConsume(client);
  }

  return withTransaction(async (transactionClient) => runConsume(transactionClient));
}

export async function getReferralData(userId, client = null) {
  const executor = client || { query };
  const userResult = await executor.query(
    `
      SELECT id, referral_code
      FROM app_users
      WHERE id = $1
      LIMIT 1
    `,
    [userId],
  );
  const user = userResult.rows[0];

  if (!user) {
    throw new Error("Player not found");
  }

  const invitedReferralIds = await getInvitedReferralIdsInternal(executor, userId);

  return {
    referralCode: user.referral_code || "",
    referralLink: buildReferralLink(user.referral_code || ""),
    invitedReferralIds,
  };
}

export async function markGameControlsGuideSeen(userId, client = null) {
  const executor = client || { query };
  const result = await executor.query(
    `
      UPDATE app_users
      SET has_seen_game_controls_guide = TRUE,
          updated_at = NOW()
      WHERE id = $1
      RETURNING has_seen_game_controls_guide
    `,
    [userId],
  );

  return Boolean(result.rows[0]?.has_seen_game_controls_guide);
}

export async function registerUtmVisit(userId, userInfo = {}, options = {}, client = null) {
  if (client) {
    return registerUtmVisitInternal(client, userId, userInfo, options);
  }

  return withTransaction(async (transactionClient) =>
    registerUtmVisitInternal(transactionClient, userId, userInfo, options)
  );
}

export async function grantUserAttempts(userId, count = 10, client = null) {
  const safeCount = Math.max(1, Math.round(Number(count) || 0));
  const executor = client || { query };

  await executor.query(
    `
      INSERT INTO user_attempt_transactions (user_id, delta, reason, details)
      VALUES ($1, $2, 'dev_manual_grant', $3::jsonb)
    `,
    [
      userId,
      safeCount,
      JSON.stringify({
        grantedAttempts: safeCount,
        source: "dev_widget",
      }),
    ],
  );

  return getAttemptSummaryInternal(executor, userId);
}

export async function deleteUserById(userId, client = null) {
  const executor = client || { query };
  const result = await executor.query(
    "DELETE FROM app_users WHERE id = $1 RETURNING id",
    [Number(userId) || 0],
  );

  if (!result.rowCount) {
    throw new Error("Player not found");
  }

  return {
    deleted: true,
    playerId: Number(result.rows[0].id),
  };
}

export async function createUserFromPlatform(payload = {}, client = null) {
  const platform = normalizePlatform(payload.platform);
  const platformUserId = String(payload.platformUserId || "").trim();

  if (!platformUserId) {
    const error = new Error("platformUserId is required");
    error.statusCode = 400;
    throw error;
  }

  const startParam = String(payload.startParam || payload.invitedByReferralCode || "").trim();
  const user = await getOrCreateUser({
    platform,
    platformUserId,
    username: String(payload.platformNickname || payload.username || "").trim(),
    firstName: String(payload.firstName || "").trim(),
    lastName: String(payload.lastName || "").trim(),
    languageCode: String(payload.languageCode || "").trim(),
    startParam,
  }, client);

  await registerUtmVisit(user.id, {
    startParam,
    sessionId: String(payload.sessionId || "").trim(),
  }, {
    wasExistingPlayer: !user.was_inserted,
  }, client);

  return {
    ok: true,
    user: {
      id: Number(user.id),
      platform: String(user.platform || platform).trim(),
      platformUserId: String(user.platform_user_id || platformUserId).trim(),
      externalId: user.external_id,
      username: user.username || "",
      firstName: user.first_name || "",
      lastName: user.last_name || "",
      referralCode: user.referral_code || "",
      subscribedToChannel: Boolean(user.subscribed_to_channel),
    },
  };
}

async function runSetUserSubscriptionStatus(executor, payload = {}) {
  const platform = normalizePlatform(payload.platform);
  const platformUserId = String(payload.platformUserId || "").trim();

  if (!platformUserId) {
    const error = new Error("platformUserId is required");
    error.statusCode = 400;
    throw error;
  }

  const user = await getOrCreateUser({
    platform,
    platformUserId,
    username: String(payload.platformNickname || payload.username || "").trim(),
    firstName: String(payload.firstName || "").trim(),
    lastName: String(payload.lastName || "").trim(),
    languageCode: String(payload.languageCode || "").trim(),
    startParam: String(payload.startParam || payload.invitedByReferralCode || "").trim(),
  }, executor);
  const wasSubscribed = Boolean(user.subscribed_to_channel);

  const result = await executor.query(
    `
      UPDATE app_users
      SET subscribed_to_channel = $2, updated_at = NOW(), last_seen_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [Number(user.id), Boolean(payload.isSubscribed)],
  );
  const updatedUser = result.rows[0];
  let referralBonus = null;

  if (!wasSubscribed && Boolean(updatedUser?.subscribed_to_channel)) {
    referralBonus = await grantReferralBonusIfEligible(executor, updatedUser);
  }

  return {
    ok: true,
    user: {
      id: Number(updatedUser.id),
      platform: String(updatedUser.platform || platform).trim(),
      platformUserId: String(updatedUser.platform_user_id || platformUserId).trim(),
      externalId: updatedUser.external_id,
      subscribedToChannel: Boolean(updatedUser.subscribed_to_channel),
    },
    referralBonusNotification: referralBonus?.notification || null,
  };
}

export async function setUserSubscriptionStatus(payload = {}, client = null) {
  if (client) {
    return runSetUserSubscriptionStatus(client, payload);
  }

  const response = await withTransaction(async (transactionClient) =>
    runSetUserSubscriptionStatus(transactionClient, payload)
  );

  if (response?.referralBonusNotification?.maxUserId && response?.referralBonusNotification?.text) {
    try {
      await sendMaxUserTextNotification(response.referralBonusNotification);
    } catch (error) {
      console.warn("Referral bonus notification send failed", {
        maxUserId: response.referralBonusNotification.maxUserId,
        error: error?.message || String(error),
      });
    }
  }

  return {
    ok: Boolean(response?.ok),
    user: response?.user || null,
  };
}
