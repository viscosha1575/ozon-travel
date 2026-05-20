import { query, withTransaction } from "./db.js";

const FRONTEND_PUBLIC_URL = String(process.env.FRONTEND_PUBLIC_URL || "http://localhost:4173").replace(/\/$/, "");
const TELEGRAM_BOT_USERNAME = String(process.env.TELEGRAM_BOT_USERNAME || "").trim().replace(/^@/, "");
const MSK_TIMEZONE = "Europe/Moscow";

function buildReferralCode(externalId) {
  return `OZONTRAVEL-${String(externalId || "")
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
  if (!referralCode) {
    return "";
  }

  if (TELEGRAM_BOT_USERNAME) {
    return `https://t.me/${TELEGRAM_BOT_USERNAME}?startapp=${encodeURIComponent(referralCode)}`;
  }

  return `${FRONTEND_PUBLIC_URL}?startapp=${encodeURIComponent(referralCode)}`;
}

async function upsertUser(executor, userInfo = {}) {
  const externalId = String(userInfo.externalId || "local-demo-user").trim() || "local-demo-user";
  const username = String(userInfo.username || "").trim();
  const firstName = String(userInfo.firstName || "").trim();
  const lastName = String(userInfo.lastName || "").trim();
  const languageCode = String(userInfo.languageCode || "").trim();
  const startParam = String(userInfo.startParam || "").trim();
  const referralCode = buildReferralCode(externalId);
  const result = await executor.query(
    `
      INSERT INTO app_users (
        external_id,
        username,
        first_name,
        last_name,
        language_code,
        start_param,
        referral_code,
        updated_at,
        last_seen_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      ON CONFLICT (external_id)
      DO UPDATE SET
        username = EXCLUDED.username,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        language_code = EXCLUDED.language_code,
        start_param = CASE
          WHEN EXCLUDED.start_param <> '' THEN EXCLUDED.start_param
          ELSE app_users.start_param
        END,
        updated_at = NOW(),
        last_seen_at = NOW()
      RETURNING *
    `,
    [externalId, username, firstName, lastName, languageCode, startParam, referralCode],
  );

  return result.rows[0];
}

async function attachReferrer(executor, userRow) {
  const startParam = String(userRow.start_param || "").trim();
  const ownReferralCode = String(userRow.referral_code || "").trim();

  if (!startParam || startParam === ownReferralCode || userRow.referred_by_user_id) {
    return userRow;
  }

  const referrerResult = await executor.query(
    `
      SELECT id, referral_code
      FROM app_users
      WHERE referral_code = $1
      LIMIT 1
    `,
    [startParam],
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

  const bonusExistsResult = await executor.query(
    `
      SELECT 1
      FROM user_attempt_transactions
      WHERE user_id = $1
        AND reason = 'referral_bonus'
        AND related_user_id = $2
      LIMIT 1
    `,
    [referrer.id, linkedUser.id],
  );

  if (!bonusExistsResult.rowCount) {
    await executor.query(
      `
        INSERT INTO user_attempt_transactions (
          user_id,
          delta,
          reason,
          related_user_id,
          details
        )
        VALUES ($1, 1, 'referral_bonus', $2, $3::jsonb)
      `,
      [
        referrer.id,
        linkedUser.id,
        JSON.stringify({
          invitedUserId: Number(linkedUser.id),
          invitedExternalId: linkedUser.external_id,
          referralCode: startParam,
        }),
      ],
    );
  }

  return linkedUser;
}

async function ensureDailyAttemptGrantInternal(executor, userId) {
  const todayValue = getMoscowDateValue();
  const existingGrantResult = await executor.query(
    `
      SELECT 1
      FROM user_attempt_transactions
      WHERE user_id = $1
        AND reason = 'daily_login_attempt'
        AND attempt_date = $2
      LIMIT 1
    `,
    [userId, todayValue],
  );

  if (!existingGrantResult.rowCount) {
    await executor.query(
      `
        INSERT INTO user_attempt_transactions (
          user_id,
          delta,
          reason,
          attempt_date,
          details
        )
        VALUES ($1, 1, 'daily_login_attempt', $2, $3::jsonb)
      `,
      [
        userId,
        todayValue,
        JSON.stringify({
          timezone: MSK_TIMEZONE,
          grantedAtDate: todayValue,
        }),
      ],
    );
  }
}

async function getAttemptSummaryInternal(executor, userId) {
  const todayValue = getMoscowDateValue();
  const [balanceResult, referralResult, todayGrantResult] = await Promise.all([
    executor.query(
      `
        SELECT COALESCE(SUM(delta), 0)::int AS available_attempts
        FROM user_attempt_transactions
        WHERE user_id = $1
      `,
      [userId],
    ),
    executor.query(
      `
        SELECT COUNT(*)::int AS invited_referrals_count
        FROM app_users
        WHERE referred_by_user_id = $1
      `,
      [userId],
    ),
    executor.query(
      `
        SELECT EXISTS (
          SELECT 1
          FROM user_attempt_transactions
          WHERE user_id = $1
            AND reason = 'daily_login_attempt'
            AND attempt_date = $2
        ) AS granted_today
      `,
      [userId, todayValue],
    ),
  ]);

  return {
    availableAttempts: Number(balanceResult.rows[0]?.available_attempts || 0),
    invitedReferralsCount: Number(referralResult.rows[0]?.invited_referrals_count || 0),
    dailyAttemptGrantedToday: Boolean(todayGrantResult.rows[0]?.granted_today),
  };
}

async function getInvitedReferralIdsInternal(executor, userId) {
  const result = await executor.query(
    `
      SELECT id
      FROM app_users
      WHERE referred_by_user_id = $1
      ORDER BY created_at ASC, id ASC
    `,
    [userId],
  );

  return result.rows.map((row) => Number(row.id));
}

async function runGetOrCreate(executor, userInfo = {}) {
  const upsertedUser = await upsertUser(executor, userInfo);
  const linkedUser = await attachReferrer(executor, upsertedUser);
  return linkedUser;
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
