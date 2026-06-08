import { query, withTransaction } from "./db.js";

const ANALYTICS_TIMEZONE = String(process.env.APP_TIMEZONE || "Europe/Moscow").trim() || "Europe/Moscow";
const ANALYTICS_VERSION = "2026-06-08-v3";
const APP_OPEN_EVENT_NAMES = new Set(["app_open", "bootstrap_loaded", "game_bootstrap_loaded"]);
const PROMO_CODE_APPLY_EVENT_NAME = "promo_code_apply_clicked";
const SESSION_FINISH_EVENT_NAME = "spin_result";

export const ANALYTICS_METRICS = {
  activeUsers: "active_users",
  newPlayers: "new_players",
  newSubscribers: "new_subscribers",
  referralsCreated: "referrals_created",
  appOpenEvents: "app_open_events",
  appOpenUniqueUsers: "app_open_unique_users",
  promoCodeApplyClicks: "promo_code_apply_clicks",
  promoCodeApplyUniqueUsers: "promo_code_apply_unique_users",
  sessionsStarted: "sessions_started",
  sessionsStartedUniqueUsers: "sessions_started_unique_users",
  sessionsFinished: "sessions_finished",
  sessionsFinishedUniqueUsers: "sessions_finished_unique_users",
  completionDurationSecondsTotal: "completion_duration_seconds_total",
  completionSessionsCount: "completion_sessions_count",
};

export const ANALYTICS_USER_METRICS = {
  spinConsumed: "spin_consumed",
  referralsInvited: "referrals_invited",
};

export const ANALYTICS_USER_PRESENCE_METRICS = {
  appOpen: "app_open",
  subscriptionConfirmed: "subscription_confirmed",
  promoCodeApply: "promo_code_apply",
  sessionStarted: "session_started",
  sessionFinished: "session_finished",
};

function pad2(value) {
  return String(value).padStart(2, "0");
}

function getZonedParts(value) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ANALYTICS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const partMap = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return {
    year: Number(partMap.year || 0),
    month: Number(partMap.month || 0),
    day: Number(partMap.day || 0),
    hour: Number(partMap.hour || 0),
  };
}

export function toAnalyticsDateValue(value = new Date()) {
  const parts = getZonedParts(value);

  if (!parts) {
    return "";
  }

  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

export function toAnalyticsHourParts(value = new Date()) {
  const parts = getZonedParts(value);

  if (!parts) {
    return {
      dateValue: "",
      hourValue: 0,
    };
  }

  return {
    dateValue: `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`,
    hourValue: Number(parts.hour || 0),
  };
}

async function incrementDailyMetric(executor, metric, value, dateValue) {
  const safeMetric = String(metric || "").trim();
  const safeDateValue = String(dateValue || "").trim();
  const safeValue = Number(value || 0);

  if (!safeMetric || !safeDateValue || !safeValue) {
    return;
  }

  await executor.query(
    `
      INSERT INTO analytics_daily (date, metric, value)
      VALUES ($1::date, $2, $3)
      ON CONFLICT (date, metric)
      DO UPDATE SET
        value = analytics_daily.value + EXCLUDED.value,
        updated_at = NOW()
    `,
    [safeDateValue, safeMetric, safeValue],
  );
}

async function incrementHourlyMetric(executor, metric, value, dateValue, hourValue) {
  const safeMetric = String(metric || "").trim();
  const safeDateValue = String(dateValue || "").trim();
  const safeHourValue = Number(hourValue);
  const safeValue = Number(value || 0);

  if (!safeMetric || !safeDateValue || !Number.isFinite(safeHourValue) || !safeValue) {
    return;
  }

  await executor.query(
    `
      INSERT INTO analytics_hourly (date, hour, metric, value)
      VALUES ($1::date, $2, $3, $4)
      ON CONFLICT (date, hour, metric)
      DO UPDATE SET
        value = analytics_hourly.value + EXCLUDED.value,
        updated_at = NOW()
    `,
    [safeDateValue, safeHourValue, safeMetric, safeValue],
  );
}

async function markDailyActiveUser(executor, userId, dateValue) {
  const result = await executor.query(
    `
      INSERT INTO daily_active_users (date, user_id)
      VALUES ($1::date, $2)
      ON CONFLICT DO NOTHING
      RETURNING 1
    `,
    [dateValue, userId],
  );

  if (result.rowCount) {
    await incrementDailyMetric(executor, ANALYTICS_METRICS.activeUsers, 1, dateValue);
  }
}

async function incrementUserDailyMetric(executor, userId, metric, value, dateValue) {
  const safeMetric = String(metric || "").trim();
  const safeDateValue = String(dateValue || "").trim();
  const safeValue = Number(value || 0);

  if (!safeMetric || !safeDateValue || !safeValue) {
    return;
  }

  await executor.query(
    `
      INSERT INTO analytics_daily_user_metrics (date, user_id, metric, value)
      VALUES ($1::date, $2, $3, $4)
      ON CONFLICT (date, user_id, metric)
      DO UPDATE SET
        value = analytics_daily_user_metrics.value + EXCLUDED.value,
        updated_at = NOW()
    `,
    [safeDateValue, userId, safeMetric, safeValue],
  );
}

async function markMetricUserPresence(executor, userId, metric, dateValue, dailyUniqueMetric) {
  const safeMetric = String(metric || "").trim();
  const safeDateValue = String(dateValue || "").trim();

  if (!safeMetric || !safeDateValue) {
    return;
  }

  const result = await executor.query(
    `
      INSERT INTO analytics_metric_users (date, metric, user_id)
      VALUES ($1::date, $2, $3)
      ON CONFLICT DO NOTHING
      RETURNING 1
    `,
    [safeDateValue, safeMetric, userId],
  );

  if (result.rowCount && dailyUniqueMetric) {
    await incrementDailyMetric(executor, dailyUniqueMetric, 1, safeDateValue);
  }
}

async function insertUserEvent(executor, userId, source, action, payload, createdAt) {
  await executor.query(
    `
      INSERT INTO user_events (
        user_id,
        source,
        action,
        payload,
        created_at
      )
      VALUES ($1, $2, $3, $4::jsonb, COALESCE($5::timestamptz, NOW()))
    `,
    [
      userId,
      String(source || "system").trim() || "system",
      String(action || "").trim(),
      JSON.stringify(payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {}),
      createdAt || null,
    ],
  );
}

async function trackSessionEvent(executor, userId, sessionId, eventName, createdAt) {
  const normalizedSessionId = String(sessionId || "").trim();

  if (!normalizedSessionId) {
    return;
  }

  const startedAt = createdAt || new Date().toISOString();
  const startHourParts = toAnalyticsHourParts(startedAt);
  const insertedSessionResult = await executor.query(
    `
      INSERT INTO game_sessions (
        user_id,
        session_id,
        started_at,
        start_date,
        start_hour
      )
      VALUES ($1, $2, $3::timestamptz, $4::date, $5)
      ON CONFLICT DO NOTHING
      RETURNING user_id
    `,
    [userId, normalizedSessionId, startedAt, startHourParts.dateValue, startHourParts.hourValue],
  );

  if (insertedSessionResult.rowCount) {
    await incrementDailyMetric(executor, ANALYTICS_METRICS.sessionsStarted, 1, startHourParts.dateValue);
    await incrementHourlyMetric(
      executor,
      ANALYTICS_METRICS.sessionsStarted,
      1,
      startHourParts.dateValue,
      startHourParts.hourValue,
    );
    await markMetricUserPresence(
      executor,
      userId,
      ANALYTICS_USER_PRESENCE_METRICS.sessionStarted,
      startHourParts.dateValue,
      ANALYTICS_METRICS.sessionsStartedUniqueUsers,
    );
  }

  if (eventName !== SESSION_FINISH_EVENT_NAME) {
    return;
  }

  const finishHourParts = toAnalyticsHourParts(createdAt || new Date());
  const finishedSessionResult = await executor.query(
    `
      UPDATE game_sessions
      SET
        finished_at = $3::timestamptz,
        finish_date = $4::date,
        finish_hour = $5,
        duration_seconds = GREATEST(0, ROUND(EXTRACT(EPOCH FROM ($3::timestamptz - started_at)))::int)
      WHERE user_id = $1
        AND session_id = $2
        AND finished_at IS NULL
      RETURNING duration_seconds
    `,
    [userId, normalizedSessionId, createdAt || new Date().toISOString(), finishHourParts.dateValue, finishHourParts.hourValue],
  );

  if (!finishedSessionResult.rowCount) {
    return;
  }

  const durationSeconds = Number(finishedSessionResult.rows[0]?.duration_seconds || 0);
  await incrementDailyMetric(executor, ANALYTICS_METRICS.sessionsFinished, 1, finishHourParts.dateValue);
  await incrementHourlyMetric(
    executor,
    ANALYTICS_METRICS.sessionsFinished,
    1,
    finishHourParts.dateValue,
    finishHourParts.hourValue,
  );
  await incrementDailyMetric(
    executor,
    ANALYTICS_METRICS.completionDurationSecondsTotal,
    durationSeconds,
    finishHourParts.dateValue,
  );
  await incrementDailyMetric(
    executor,
    ANALYTICS_METRICS.completionSessionsCount,
    1,
    finishHourParts.dateValue,
  );
  await markMetricUserPresence(
    executor,
    userId,
    ANALYTICS_USER_PRESENCE_METRICS.sessionFinished,
    finishHourParts.dateValue,
    ANALYTICS_METRICS.sessionsFinishedUniqueUsers,
  );
}

export async function trackNewUserAnalytics(executor, userRow, source = "system") {
  const createdAt = userRow?.created_at || new Date().toISOString();
  const { dateValue, hourValue } = toAnalyticsHourParts(createdAt);

  if (!dateValue) {
    return;
  }

  await insertUserEvent(
    executor,
    Number(userRow.id),
    source,
    "user_created",
    {
      platform: String(userRow.platform || "").trim(),
      platformUserId: String(userRow.platform_user_id || "").trim(),
      externalId: String(userRow.external_id || "").trim(),
      utmSlug: String(userRow.utm_slug || "").trim(),
      referredByUserId: userRow.referred_by_user_id ? Number(userRow.referred_by_user_id) : null,
    },
    createdAt,
  );
  await incrementDailyMetric(executor, ANALYTICS_METRICS.newPlayers, 1, dateValue);
  await incrementHourlyMetric(executor, ANALYTICS_METRICS.newPlayers, 1, dateValue, hourValue);
  await markDailyActiveUser(executor, Number(userRow.id), dateValue);
}

export async function trackReferralLinkedAnalytics(executor, referrerId, invitedUserId, createdAt = new Date().toISOString()) {
  const dateValue = toAnalyticsDateValue(createdAt);

  if (!dateValue) {
    return;
  }

  await incrementDailyMetric(executor, ANALYTICS_METRICS.referralsCreated, 1, dateValue);
  await incrementUserDailyMetric(executor, referrerId, ANALYTICS_USER_METRICS.referralsInvited, 1, dateValue);
  await insertUserEvent(
    executor,
    Number(referrerId),
    "system",
    "referral_linked",
    {
      invitedUserId: Number(invitedUserId) || null,
    },
    createdAt,
  );
}

export async function trackSubscriptionConfirmedAnalytics(
  executor,
  userId,
  payload = {},
  createdAt = new Date().toISOString(),
) {
  const safeUserId = Number(userId) || 0;
  const { dateValue, hourValue } = toAnalyticsHourParts(createdAt);

  if (!safeUserId || !dateValue) {
    return;
  }

  await insertUserEvent(
    executor,
    safeUserId,
    "system",
    "subscription_confirmed",
    payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {},
    createdAt,
  );
  await markDailyActiveUser(executor, safeUserId, dateValue);
  await incrementDailyMetric(executor, ANALYTICS_METRICS.newSubscribers, 1, dateValue);
  await incrementHourlyMetric(executor, ANALYTICS_METRICS.newSubscribers, 1, dateValue, hourValue);
  await markMetricUserPresence(
    executor,
    safeUserId,
    ANALYTICS_USER_PRESENCE_METRICS.subscriptionConfirmed,
    dateValue,
    null,
  );
}

export async function trackSpinConsumedAnalytics(executor, userId, createdAt = new Date().toISOString(), count = 1) {
  const dateValue = toAnalyticsDateValue(createdAt);

  if (!dateValue) {
    return;
  }

  await incrementUserDailyMetric(executor, userId, ANALYTICS_USER_METRICS.spinConsumed, count, dateValue);
}

export async function trackGameEventAnalytics(executor, payload = {}) {
  const userId = Number(payload?.userId) || 0;
  const eventName = String(payload?.eventName || "").trim();
  const source = String(payload?.source || "frontend").trim() || "frontend";
  const sessionId = String(payload?.sessionId || "").trim();
  const createdAt = payload?.createdAt || new Date().toISOString();
  const details = payload?.details && typeof payload.details === "object" && !Array.isArray(payload.details)
    ? payload.details
    : {};
  const { dateValue } = toAnalyticsHourParts(createdAt);

  if (!userId || !eventName || !dateValue) {
    return;
  }

  await insertUserEvent(executor, userId, source, eventName, {
    ...details,
    sessionId: sessionId || "",
  }, createdAt);
  await markDailyActiveUser(executor, userId, dateValue);

  if (APP_OPEN_EVENT_NAMES.has(eventName)) {
    await incrementDailyMetric(executor, ANALYTICS_METRICS.appOpenEvents, 1, dateValue);
    await markMetricUserPresence(
      executor,
      userId,
      ANALYTICS_USER_PRESENCE_METRICS.appOpen,
      dateValue,
      ANALYTICS_METRICS.appOpenUniqueUsers,
    );
  }

  if (eventName === PROMO_CODE_APPLY_EVENT_NAME) {
    await incrementDailyMetric(executor, ANALYTICS_METRICS.promoCodeApplyClicks, 1, dateValue);
    await markMetricUserPresence(
      executor,
      userId,
      ANALYTICS_USER_PRESENCE_METRICS.promoCodeApply,
      dateValue,
      ANALYTICS_METRICS.promoCodeApplyUniqueUsers,
    );
  }

  if (sessionId) {
    await trackSessionEvent(executor, userId, sessionId, eventName, createdAt);
  }
}

function buildWhereClause(startToken, endToken, fieldName = "date") {
  const params = [];
  const conditions = [];

  if (startToken) {
    params.push(startToken);
    conditions.push(`${fieldName} >= $${params.length}::date`);
  }

  if (endToken) {
    params.push(endToken);
    conditions.push(`${fieldName} <= $${params.length}::date`);
  }

  return {
    whereClause: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

async function rebuildAnalyticsAggregatesInternal(executor) {
  await executor.query(`
    TRUNCATE TABLE
      user_events,
      analytics_daily,
      analytics_hourly,
      analytics_metric_users,
      analytics_daily_user_metrics,
      daily_active_users,
      game_sessions
    RESTART IDENTITY
  `);

  await executor.query(`
    INSERT INTO user_events (user_id, source, action, payload, created_at)
    SELECT
      id,
      'system',
      'user_created',
      jsonb_build_object(
        'platform', platform,
        'platformUserId', platform_user_id,
        'externalId', external_id,
        'utmSlug', utm_slug,
        'referredByUserId', referred_by_user_id
      ),
      created_at
    FROM app_users
    ORDER BY id ASC
  `);

  await executor.query(`
    INSERT INTO user_events (user_id, source, action, payload, created_at)
    SELECT
      id,
      'system',
      'subscription_confirmed',
      jsonb_build_object(
        'platform', platform,
        'platformUserId', platform_user_id,
        'externalId', external_id,
        'backfilled', true
      ),
      subscribed_at
    FROM app_users
    WHERE subscribed_to_channel = TRUE
      AND subscribed_at IS NOT NULL
    ORDER BY id ASC
  `);

  await executor.query(`
    INSERT INTO user_events (user_id, source, action, payload, created_at)
    SELECT
      user_id,
      'system',
      'referral_linked',
      jsonb_build_object(
        'invitedUserId', related_user_id
      ),
      created_at
    FROM user_attempt_transactions
    WHERE reason = 'referral_bonus'
      AND related_user_id IS NOT NULL
    ORDER BY id ASC
  `);

  await executor.query(`
    INSERT INTO user_events (user_id, source, action, payload, created_at)
    SELECT
      user_id,
      source,
      event_name,
      COALESCE(details, '{}'::jsonb) || jsonb_build_object('sessionId', session_id),
      created_at
    FROM game_event_logs
    ORDER BY id ASC
  `);

  await executor.query(
    `
      INSERT INTO daily_active_users (date, user_id)
      SELECT DISTINCT
        (created_at AT TIME ZONE $1)::date AS date,
        user_id
      FROM user_events
    `,
    [ANALYTICS_TIMEZONE],
  );

  await executor.query(`
    INSERT INTO analytics_daily (date, metric, value)
    SELECT
      date,
      '${ANALYTICS_METRICS.activeUsers}',
      COUNT(*)::bigint
    FROM daily_active_users
    GROUP BY date
    ON CONFLICT (date, metric)
    DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `);

  await executor.query(
    `
      INSERT INTO analytics_daily (date, metric, value)
      SELECT
        (created_at AT TIME ZONE $1)::date AS date,
        '${ANALYTICS_METRICS.newPlayers}',
        COUNT(*)::bigint
      FROM app_users
      GROUP BY 1
      ON CONFLICT (date, metric)
      DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `,
    [ANALYTICS_TIMEZONE],
  );

  await executor.query(
    `
      INSERT INTO analytics_hourly (date, hour, metric, value)
      SELECT
        (created_at AT TIME ZONE $1)::date AS date,
        EXTRACT(HOUR FROM (created_at AT TIME ZONE $1))::int AS hour,
        '${ANALYTICS_METRICS.newPlayers}',
        COUNT(*)::bigint
      FROM app_users
      GROUP BY 1, 2
      ON CONFLICT (date, hour, metric)
      DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `,
    [ANALYTICS_TIMEZONE],
  );

  await executor.query(
    `
      INSERT INTO analytics_daily (date, metric, value)
      SELECT
        (created_at AT TIME ZONE $1)::date AS date,
        '${ANALYTICS_METRICS.referralsCreated}',
        COUNT(*)::bigint
      FROM user_attempt_transactions
      WHERE reason = 'referral_bonus'
        AND related_user_id IS NOT NULL
      GROUP BY 1
      ON CONFLICT (date, metric)
      DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `,
    [ANALYTICS_TIMEZONE],
  );

  await executor.query(
    `
      INSERT INTO analytics_daily_user_metrics (date, user_id, metric, value)
      SELECT
        (created_at AT TIME ZONE $1)::date AS date,
        user_id,
        '${ANALYTICS_USER_METRICS.referralsInvited}',
        COUNT(*)::bigint AS value
      FROM user_attempt_transactions
      WHERE reason = 'referral_bonus'
        AND related_user_id IS NOT NULL
      GROUP BY 1, 2
      ON CONFLICT (date, user_id, metric)
      DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `,
    [ANALYTICS_TIMEZONE],
  );

  await executor.query(
    `
      INSERT INTO analytics_daily_user_metrics (date, user_id, metric, value)
      SELECT
        (created_at AT TIME ZONE $1)::date AS date,
        user_id,
        '${ANALYTICS_USER_METRICS.spinConsumed}',
        COUNT(*)::bigint AS value
      FROM user_attempt_transactions
      WHERE reason = 'spin_consumed'
      GROUP BY 1, 2
      ON CONFLICT (date, user_id, metric)
      DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `,
    [ANALYTICS_TIMEZONE],
  );

  await executor.query(
    `
      INSERT INTO analytics_metric_users (date, metric, user_id)
      SELECT DISTINCT
        (created_at AT TIME ZONE $1)::date AS date,
        '${ANALYTICS_USER_PRESENCE_METRICS.appOpen}' AS metric,
        user_id
      FROM game_event_logs
      WHERE event_name = ANY($2::text[])
      ON CONFLICT DO NOTHING
    `,
    [ANALYTICS_TIMEZONE, [...APP_OPEN_EVENT_NAMES]],
  );

  await executor.query(
    `
      INSERT INTO analytics_metric_users (date, metric, user_id)
      SELECT DISTINCT
        (created_at AT TIME ZONE $1)::date AS date,
        '${ANALYTICS_USER_PRESENCE_METRICS.promoCodeApply}' AS metric,
        user_id
      FROM game_event_logs
      WHERE event_name = $2
      ON CONFLICT DO NOTHING
    `,
    [ANALYTICS_TIMEZONE, PROMO_CODE_APPLY_EVENT_NAME],
  );

  await executor.query(
    `
      INSERT INTO analytics_metric_users (date, metric, user_id)
      SELECT DISTINCT
        (created_at AT TIME ZONE $1)::date AS date,
        '${ANALYTICS_USER_PRESENCE_METRICS.subscriptionConfirmed}' AS metric,
        user_id
      FROM user_events
      WHERE action = 'subscription_confirmed'
      ON CONFLICT DO NOTHING
    `,
    [ANALYTICS_TIMEZONE],
  );

  await executor.query(
    `
      INSERT INTO analytics_daily (date, metric, value)
      SELECT
        (created_at AT TIME ZONE $1)::date AS date,
        '${ANALYTICS_METRICS.appOpenEvents}',
        COUNT(*)::bigint
      FROM game_event_logs
      WHERE event_name = ANY($2::text[])
      GROUP BY 1
      ON CONFLICT (date, metric)
      DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `,
    [ANALYTICS_TIMEZONE, [...APP_OPEN_EVENT_NAMES]],
  );

  await executor.query(`
    INSERT INTO analytics_daily (date, metric, value)
    SELECT
      date,
      '${ANALYTICS_METRICS.appOpenUniqueUsers}',
      COUNT(*)::bigint
    FROM analytics_metric_users
    WHERE metric = '${ANALYTICS_USER_PRESENCE_METRICS.appOpen}'
    GROUP BY date
    ON CONFLICT (date, metric)
    DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `);

  await executor.query(
    `
      INSERT INTO analytics_daily (date, metric, value)
      SELECT
        (created_at AT TIME ZONE $1)::date AS date,
        '${ANALYTICS_METRICS.newSubscribers}',
        COUNT(*)::bigint
      FROM user_events
      WHERE action = 'subscription_confirmed'
      GROUP BY 1
      ON CONFLICT (date, metric)
      DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `,
    [ANALYTICS_TIMEZONE],
  );

  await executor.query(
    `
      INSERT INTO analytics_hourly (date, hour, metric, value)
      SELECT
        (created_at AT TIME ZONE $1)::date AS date,
        EXTRACT(HOUR FROM (created_at AT TIME ZONE $1))::int AS hour,
        '${ANALYTICS_METRICS.newSubscribers}',
        COUNT(*)::bigint
      FROM user_events
      WHERE action = 'subscription_confirmed'
      GROUP BY 1, 2
      ON CONFLICT (date, hour, metric)
      DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `,
    [ANALYTICS_TIMEZONE],
  );

  await executor.query(
    `
      INSERT INTO analytics_daily (date, metric, value)
      SELECT
        (created_at AT TIME ZONE $1)::date AS date,
        '${ANALYTICS_METRICS.promoCodeApplyClicks}',
        COUNT(*)::bigint
      FROM game_event_logs
      WHERE event_name = $2
      GROUP BY 1
      ON CONFLICT (date, metric)
      DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `,
    [ANALYTICS_TIMEZONE, PROMO_CODE_APPLY_EVENT_NAME],
  );

  await executor.query(`
    INSERT INTO analytics_daily (date, metric, value)
    SELECT
      date,
      '${ANALYTICS_METRICS.promoCodeApplyUniqueUsers}',
      COUNT(*)::bigint
    FROM analytics_metric_users
    WHERE metric = '${ANALYTICS_USER_PRESENCE_METRICS.promoCodeApply}'
    GROUP BY date
    ON CONFLICT (date, metric)
    DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `);

  await executor.query(
    `
      INSERT INTO game_sessions (
        user_id,
        session_id,
        started_at,
        finished_at,
        duration_seconds,
        start_date,
        start_hour,
        finish_date,
        finish_hour
      )
      WITH session_events AS (
        SELECT
          user_id,
          session_id,
          MIN(created_at) AS started_at,
          MAX(created_at) FILTER (WHERE event_name = '${SESSION_FINISH_EVENT_NAME}') AS finished_at
        FROM game_event_logs
        WHERE session_id <> ''
        GROUP BY user_id, session_id
      )
      SELECT
        user_id,
        session_id,
        started_at,
        finished_at,
        CASE
          WHEN finished_at IS NOT NULL
            THEN GREATEST(0, ROUND(EXTRACT(EPOCH FROM (finished_at - started_at)))::int)
          ELSE 0
        END AS duration_seconds,
        (started_at AT TIME ZONE $1)::date AS start_date,
        EXTRACT(HOUR FROM (started_at AT TIME ZONE $1))::int AS start_hour,
        CASE
          WHEN finished_at IS NOT NULL THEN (finished_at AT TIME ZONE $1)::date
          ELSE NULL
        END AS finish_date,
        CASE
          WHEN finished_at IS NOT NULL THEN EXTRACT(HOUR FROM (finished_at AT TIME ZONE $1))::int
          ELSE NULL
        END AS finish_hour
      FROM session_events
    `,
    [ANALYTICS_TIMEZONE],
  );

  await executor.query(`
    INSERT INTO analytics_metric_users (date, metric, user_id)
    SELECT DISTINCT
      start_date AS date,
      '${ANALYTICS_USER_PRESENCE_METRICS.sessionStarted}' AS metric,
      user_id
    FROM game_sessions
    WHERE start_date IS NOT NULL
    ON CONFLICT DO NOTHING
  `);

  await executor.query(`
    INSERT INTO analytics_metric_users (date, metric, user_id)
    SELECT DISTINCT
      finish_date AS date,
      '${ANALYTICS_USER_PRESENCE_METRICS.sessionFinished}' AS metric,
      user_id
    FROM game_sessions
    WHERE finish_date IS NOT NULL
    ON CONFLICT DO NOTHING
  `);

  await executor.query(`
    INSERT INTO analytics_daily (date, metric, value)
    SELECT
      start_date AS date,
      '${ANALYTICS_METRICS.sessionsStarted}',
      COUNT(*)::bigint
    FROM game_sessions
    WHERE start_date IS NOT NULL
    GROUP BY start_date
    ON CONFLICT (date, metric)
    DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `);

  await executor.query(`
    INSERT INTO analytics_hourly (date, hour, metric, value)
    SELECT
      start_date AS date,
      start_hour AS hour,
      '${ANALYTICS_METRICS.sessionsStarted}',
      COUNT(*)::bigint
    FROM game_sessions
    WHERE start_date IS NOT NULL
    GROUP BY start_date, start_hour
    ON CONFLICT (date, hour, metric)
    DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `);

  await executor.query(`
    INSERT INTO analytics_daily (date, metric, value)
    SELECT
      date,
      '${ANALYTICS_METRICS.sessionsStartedUniqueUsers}',
      COUNT(*)::bigint
    FROM analytics_metric_users
    WHERE metric = '${ANALYTICS_USER_PRESENCE_METRICS.sessionStarted}'
    GROUP BY date
    ON CONFLICT (date, metric)
    DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `);

  await executor.query(`
    INSERT INTO analytics_daily (date, metric, value)
    SELECT
      finish_date AS date,
      '${ANALYTICS_METRICS.sessionsFinished}',
      COUNT(*)::bigint
    FROM game_sessions
    WHERE finish_date IS NOT NULL
    GROUP BY finish_date
    ON CONFLICT (date, metric)
    DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `);

  await executor.query(`
    INSERT INTO analytics_hourly (date, hour, metric, value)
    SELECT
      finish_date AS date,
      finish_hour AS hour,
      '${ANALYTICS_METRICS.sessionsFinished}',
      COUNT(*)::bigint
    FROM game_sessions
    WHERE finish_date IS NOT NULL
    GROUP BY finish_date, finish_hour
    ON CONFLICT (date, hour, metric)
    DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `);

  await executor.query(`
    INSERT INTO analytics_daily (date, metric, value)
    SELECT
      date,
      '${ANALYTICS_METRICS.sessionsFinishedUniqueUsers}',
      COUNT(*)::bigint
    FROM analytics_metric_users
    WHERE metric = '${ANALYTICS_USER_PRESENCE_METRICS.sessionFinished}'
    GROUP BY date
    ON CONFLICT (date, metric)
    DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `);

  await executor.query(`
    INSERT INTO analytics_daily (date, metric, value)
    SELECT
      finish_date AS date,
      '${ANALYTICS_METRICS.completionDurationSecondsTotal}',
      COALESCE(SUM(duration_seconds), 0)::bigint
    FROM game_sessions
    WHERE finish_date IS NOT NULL
    GROUP BY finish_date
    ON CONFLICT (date, metric)
    DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `);

  await executor.query(`
    INSERT INTO analytics_daily (date, metric, value)
    SELECT
      finish_date AS date,
      '${ANALYTICS_METRICS.completionSessionsCount}',
      COUNT(*)::bigint
    FROM game_sessions
    WHERE finish_date IS NOT NULL
    GROUP BY finish_date
    ON CONFLICT (date, metric)
    DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `);
}

export async function syncAnalyticsAggregates() {
  const stateResult = await query(
    `
      SELECT value
      FROM analytics_runtime_state
      WHERE state_key = 'analytics_version'
      LIMIT 1
    `,
  );

  if (String(stateResult.rows[0]?.value || "").trim() === ANALYTICS_VERSION) {
    return {
      ok: true,
      rebuilt: false,
      version: ANALYTICS_VERSION,
    };
  }

  return withTransaction(async (client) => {
    await rebuildAnalyticsAggregatesInternal(client);
    await client.query(
      `
        INSERT INTO analytics_runtime_state (state_key, value)
        VALUES ('analytics_version', $1)
        ON CONFLICT (state_key)
        DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      `,
      [ANALYTICS_VERSION],
    );

    return {
      ok: true,
      rebuilt: true,
      version: ANALYTICS_VERSION,
    };
  });
}

export function buildAnalyticsRangeWhere(startToken, endToken, fieldName = "date") {
  return buildWhereClause(startToken, endToken, fieldName);
}
