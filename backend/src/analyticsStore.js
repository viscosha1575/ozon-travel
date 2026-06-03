import { query, withTransaction } from "./db.js";
import {
  ANALYTICS_METRICS,
  ANALYTICS_USER_METRICS,
  ANALYTICS_USER_PRESENCE_METRICS,
  buildAnalyticsRangeWhere,
  toAnalyticsDateValue,
  trackGameEventAnalytics,
} from "./analyticsAggregateStore.js";
import { parseStartParam } from "./startParam.js";
import {
  deleteUserById,
  getOrCreateUser,
  getReferralData,
  getUserAttemptSummary,
} from "./userStore.js";

const ANALYTICS_TIMEZONE = String(process.env.APP_TIMEZONE || "Europe/Moscow").trim() || "Europe/Moscow";

function normalizeSearch(value) {
  return String(value || "").trim().toLowerCase();
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function getZonedParts(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ANALYTICS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
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
    minute: Number(partMap.minute || 0),
  };
}

function toDateToken(value) {
  return toAnalyticsDateValue(value);
}

function toHourToken(value) {
  const parts = getZonedParts(value);

  if (!parts) {
    return "";
  }

  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}-${pad2(parts.hour)}`;
}

function toMonthToken(value) {
  const parts = getZonedParts(value);

  if (!parts) {
    return "";
  }

  return `${parts.year}-${pad2(parts.month)}`;
}

function getTodayToken() {
  return toDateToken(new Date());
}

function parseDateToken(value) {
  const normalized = String(value || "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return "";
  }

  return normalized;
}

function addDaysToDateToken(dateToken, delta) {
  const [year, month, day] = String(dateToken).split("-").map(Number);

  if (!year || !month || !day) {
    return "";
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + Number(delta || 0));

  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function addMonthsToMonthToken(monthToken, delta) {
  const [year, month] = String(monthToken).split("-").map(Number);

  if (!year || !month) {
    return "";
  }

  const date = new Date(Date.UTC(year, month - 1, 1));
  date.setUTCMonth(date.getUTCMonth() + Number(delta || 0));

  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}`;
}

function getCurrentMonthToken() {
  const todayToken = getTodayToken();
  return todayToken ? todayToken.slice(0, 7) : "";
}

function getPresetRangeStartToken(range) {
  const todayToken = getTodayToken();

  if (!todayToken) {
    return "";
  }

  if (range === "7d") {
    return addDaysToDateToken(todayToken, -6);
  }

  if (range === "30d") {
    return addDaysToDateToken(todayToken, -29);
  }

  if (range === "today") {
    return todayToken;
  }

  return "";
}

function getRangeContext(payload = {}) {
  const requestedRange = ["today", "7d", "30d", "all"].includes(payload?.range) ? payload.range : "today";
  const customStartToken = parseDateToken(payload?.dateFrom);
  const customEndToken = parseDateToken(payload?.dateTo);
  const hasCustomRange = Boolean(customStartToken || customEndToken);
  const effectiveRange = hasCustomRange ? "custom" : requestedRange;
  const todayToken = getTodayToken();
  const rangeStartToken = hasCustomRange
    ? (customStartToken || customEndToken || todayToken)
    : getPresetRangeStartToken(requestedRange);
  const rangeEndToken = hasCustomRange
    ? (customEndToken || customStartToken || todayToken)
    : (requestedRange === "all" ? "" : todayToken);
  const chartStartToken = effectiveRange === "custom" && rangeStartToken
    ? addDaysToDateToken(rangeStartToken, -1)
    : rangeStartToken;

  return {
    requestedRange,
    effectiveRange,
    rangeStartToken,
    rangeEndToken,
    chartStartToken,
    chartEndToken: rangeEndToken,
  };
}

function isTokenInRange(token, startToken, endToken) {
  if (!token) {
    return false;
  }

  if (startToken && token < startToken) {
    return false;
  }

  if (endToken && token > endToken) {
    return false;
  }

  return true;
}

function buildDateTokenSequence(startToken, endToken) {
  const safeStartToken = startToken || endToken || getTodayToken();
  const safeEndToken = endToken || startToken || getTodayToken();
  const tokens = [];

  if (!safeStartToken || !safeEndToken) {
    return tokens;
  }

  let cursor = safeStartToken;

  while (cursor <= safeEndToken) {
    tokens.push(cursor);
    cursor = addDaysToDateToken(cursor, 1);
  }

  return tokens;
}

function buildMonthTokenSequence(totalMonths = 12) {
  const currentMonthToken = getCurrentMonthToken();
  const tokens = [];

  if (!currentMonthToken) {
    return tokens;
  }

  for (let offset = totalMonths - 1; offset >= 0; offset -= 1) {
    tokens.push(addMonthsToMonthToken(currentMonthToken, -offset));
  }

  return tokens;
}

function getBucketTokens(range, startToken, endToken) {
  if (range === "custom") {
    return buildDateTokenSequence(startToken, endToken);
  }

  if (range === "today") {
    const safeDayToken = startToken || endToken || getTodayToken();

    if (!safeDayToken) {
      return [];
    }

    return Array.from({ length: 24 }, (_, hour) => `${safeDayToken}-${pad2(hour)}`);
  }

  if (range === "7d" || range === "30d") {
    return buildDateTokenSequence(startToken, endToken);
  }

  return buildMonthTokenSequence(12);
}

function formatDateLabel(dateToken) {
  const [year, month, day] = String(dateToken).split("-").map(Number);

  if (!year || !month || !day) {
    return "";
  }

  return `${pad2(day)}.${pad2(month)}`;
}

function bucketLabel(token, range) {
  if (!token) {
    return "";
  }

  if (range === "today") {
    const hour = String(token).split("-")[3] || "00";
    return `${hour}:00`;
  }

  if (range === "custom" || range === "7d" || range === "30d") {
    return formatDateLabel(token);
  }

  const [year, month] = String(token).split("-").map(Number);

  if (!year || !month) {
    return "";
  }

  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("ru-RU", {
    month: "short",
    year: "2-digit",
  });
}

function buildSeries(items, range, tokenGetter, startToken, endToken) {
  const bucketMap = new Map();

  for (const item of items) {
    const key = tokenGetter(item);

    if (!key) {
      continue;
    }

    bucketMap.set(key, (bucketMap.get(key) || 0) + 1);
  }

  return getBucketTokens(range, startToken, endToken).map((token) => ({
    key: token,
    label: bucketLabel(token, range),
    value: Number(bucketMap.get(token) || 0),
  }));
}

function monthTokenFromDateToken(dateToken) {
  return String(dateToken || "").slice(0, 7);
}

function buildSeriesFromAggregateRows(rows, range, startToken, endToken, valueGetter = (item) => Number(item.value || 0)) {
  const bucketMap = new Map();

  for (const row of rows) {
    const rawToken = String(row.key || "").trim();

    if (!rawToken) {
      continue;
    }

    const token = range === "all" ? monthTokenFromDateToken(rawToken) : rawToken;
    bucketMap.set(token, (bucketMap.get(token) || 0) + Number(valueGetter(row) || 0));
  }

  return getBucketTokens(range, startToken, endToken).map((token) => ({
    key: token,
    label: bucketLabel(token, range),
    value: Number(bucketMap.get(token) || 0),
  }));
}

function createEmptyAnalyticsOverview(payload = {}, rangeContext = getRangeContext(payload)) {
  return {
    meta: {
      range: rangeContext.requestedRange,
      cachedAt: new Date().toISOString(),
      dateFrom: String(payload?.dateFrom || ""),
      dateTo: String(payload?.dateTo || ""),
    },
    summary: {
      totalPlayersCount: 0,
      newPlayersCount: 0,
      appOpenedCount: 0,
      subscribedPlayersCount: 0,
      totalUniqueDailyVisitsCount: 0,
      averageDauCount: 0,
      sessionsStartedCount: 0,
      finishedSessionsCount: 0,
      playersWithFinishedGameCount: 0,
      currentlyOnlinePlayersCount: 0,
      averageCompletionSeconds: 0,
      averageFoundSneakersCount: 0,
      referralsInPeriodCount: 0,
      totalReferredPlayersCount: 0,
      passedSubscriptionStageCount: 0,
      notSubscribedBeforeCount: 0,
      subscribedAfterNotSubscribedCount: 0,
      enteredGameCount: 0,
      foundThreePairsCount: 0,
      foundAllPairsPlayersCount: 0,
      averagePairsPerUserCount: 0,
      foundTenPairsCount: 0,
      foundTenPairsInTimeCount: 0,
      attemptedOneTimePlayersCount: 0,
      attemptedThreeTimesPlayersCount: 0,
      attemptedFiveTimesPlayersCount: 0,
      attemptedTenTimesPlayersCount: 0,
      referredOneFriendPlayersCount: 0,
      referredThreeFriendsPlayersCount: 0,
      referredFiveFriendsPlayersCount: 0,
      referredTenFriendsPlayersCount: 0,
      promoCodeApplyClicksCount: 0,
      promoCodeApplyUsersCount: 0,
      ozonTravelTransitionsCount: 0,
    },
    series: {
      newPlayers: [],
      totalPlayers: [],
      sessionsStarted: [],
      sessionsFinished: [],
    },
    recentSessions: [],
  };
}

function compareValues(left, right, direction) {
  if (left === right) {
    return 0;
  }

  if (left == null) {
    return direction === "asc" ? -1 : 1;
  }

  if (right == null) {
    return direction === "asc" ? 1 : -1;
  }

  if (left > right) {
    return direction === "asc" ? 1 : -1;
  }

  return direction === "asc" ? -1 : 1;
}

function toSafeDetails(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function buildDisplayName(player) {
  const fullName = [player.firstName, player.lastName].filter(Boolean).join(" ").trim();

  if (fullName) {
    return fullName;
  }

  if (player.username) {
    return player.username;
  }

  return `Игрок #${player.id}`;
}

function isOnline(lastSeenAt) {
  if (!lastSeenAt) {
    return false;
  }

  return Date.now() - new Date(lastSeenAt).getTime() <= 15 * 60 * 1000;
}

function mapPlayerRow(player, sessionStats = {}, logStats = {}, latestPrize = {}, attemptStats = {}) {
  const totalSessions = Number(sessionStats.total_sessions || 0);
  const finishedSessions = Number(sessionStats.finished_sessions || 0);
  const bestDurationSeconds = Number(sessionStats.best_duration_seconds || 0);
  const averageDurationSeconds = Number(sessionStats.average_duration_seconds || 0);
  const totalActivityLogs = Number(logStats.total_activity_logs || 0);
  const displayName = buildDisplayName({
    id: Number(player.id),
    username: player.username,
    firstName: player.first_name,
    lastName: player.last_name,
  });

  const parsedStartParam = parseStartParam(player.start_param || "");

  return {
    id: Number(player.id),
    platform: String(player.platform || "telegram").trim() || "telegram",
    platformUserId: String(player.platform_user_id || player.external_id || "").trim(),
    telegramUserId: String(player.platform_user_id || player.external_id || "").trim(),
    externalId: String(player.external_id || "").trim(),
    username: player.username || "",
    firstName: player.first_name || "",
    lastName: player.last_name || "",
    languageCode: player.language_code || "",
    referralCode: player.referral_code || "",
    referredByCode: String(player.referred_by_code || "").trim(),
    hasReferral: Boolean(player.referred_by_user_id),
    utmSlug: player.utm_slug || parsedStartParam.utmSlug || "",
    referredByUserId: player.referred_by_user_id ? Number(player.referred_by_user_id) : null,
    subscribedToChannel: Boolean(player.subscribed_to_channel),
    completedGame: finishedSessions > 0 || Boolean(latestPrize.promo_code),
    timeExpired: false,
    promoCode: latestPrize.promo_code || "",
    displayName,
    isOnline: isOnline(player.last_seen_at),
    availableAttempts: Number(attemptStats.available_attempts || 0),
    totalSessions,
    finishedSessions,
    bestDurationSeconds,
    averageDurationSeconds,
    totalActivityLogs,
    createdAt: player.created_at,
    lastSeenAt: player.last_seen_at,
  };
}

function mapAwardedPrizeRow(row = {}) {
  return {
    id: Number(row.id || 0),
    prizeId: Number(row.prize_id || 0),
    title: String(row.awarded_title || row.position_title || "").trim(),
    image: row.image && typeof row.image === "object" ? row.image : null,
    promoCode: String(row.promo_code || "").trim(),
    availableFrom: row.available_from || null,
    awardedAt: row.created_at || null,
  };
}

async function getPlayerBaseMaps() {
  const [usersResult, sessionStatsResult, logStatsResult, latestPrizeResult, attemptsResult] = await Promise.all([
    query(`
      SELECT
        app_users.id,
        app_users.platform,
        app_users.platform_user_id,
        app_users.external_id,
        app_users.username,
        app_users.first_name,
        app_users.last_name,
        app_users.language_code,
        app_users.start_param,
        app_users.utm_slug,
        app_users.referral_code,
        app_users.referred_by_user_id,
        referrer.referral_code AS referred_by_code,
        app_users.subscribed_to_channel,
        app_users.created_at,
        app_users.updated_at,
        app_users.last_seen_at
      FROM app_users
      LEFT JOIN app_users AS referrer
        ON referrer.id = app_users.referred_by_user_id
    `),
    query(`
      SELECT
        user_id,
        COUNT(*)::int AS total_sessions,
        (COUNT(*) FILTER (WHERE finished_at IS NOT NULL))::int AS finished_sessions,
        COALESCE(SUM(duration_seconds) FILTER (WHERE finished_at IS NOT NULL), 0)::int AS total_duration_seconds,
        COALESCE(MIN(duration_seconds) FILTER (WHERE finished_at IS NOT NULL), 0)::int AS best_duration_seconds,
        COALESCE(ROUND(AVG(duration_seconds) FILTER (WHERE finished_at IS NOT NULL)), 0)::int AS average_duration_seconds,
        MAX(started_at) AS last_session_at
      FROM game_sessions
      GROUP BY user_id
    `),
    query(`
      SELECT
        user_id,
        COUNT(*)::int AS total_activity_logs,
        MAX(created_at) AS last_activity_at
      FROM user_events
      GROUP BY user_id
    `),
    query(`
      SELECT DISTINCT ON (user_id)
        user_id,
        promo_code,
        created_at
      FROM awarded_prizes
      ORDER BY user_id, created_at DESC, id DESC
    `),
    query(`
      SELECT
        user_id,
        COALESCE(SUM(delta), 0)::int AS available_attempts
      FROM user_attempt_transactions
      GROUP BY user_id
    `),
  ]);

  return {
    users: usersResult.rows,
    sessionStatsMap: new Map(sessionStatsResult.rows.map((row) => [Number(row.user_id), row])),
    logStatsMap: new Map(logStatsResult.rows.map((row) => [Number(row.user_id), row])),
    latestPrizeMap: new Map(latestPrizeResult.rows.map((row) => [Number(row.user_id), row])),
    attemptsMap: new Map(attemptsResult.rows.map((row) => [Number(row.user_id), row])),
  };
}

export async function logGameEvent(userInfo = {}, eventName = "", options = {}) {
  const normalizedEventName = String(eventName || "").trim();

  if (!normalizedEventName) {
    throw new Error("Event name is required");
  }

  const source = String(options.source || "frontend").trim() || "frontend";
  const sessionId = String(options.sessionId || "").trim();
  const details = toSafeDetails(options.details);
  const run = async (executor) => {
    const user = await getOrCreateUser(userInfo, executor);
    const result = await executor.query(
      `
        INSERT INTO game_event_logs (user_id, session_id, event_name, source, details)
        VALUES ($1, $2, $3, $4, $5::jsonb)
        RETURNING id, created_at
      `,
      [user.id, sessionId, normalizedEventName, source, JSON.stringify(details)],
    );
    const createdAt = result.rows[0].created_at;

    await trackGameEventAnalytics(executor, {
      userId: Number(user.id),
      eventName: normalizedEventName,
      source,
      sessionId,
      details,
      createdAt,
    });

    return {
      id: Number(result.rows[0].id),
      createdAt,
      user,
    };
  };

  if (options.client) {
    return run(options.client);
  }

  return withTransaction(run);
}

export async function getAnalyticsOverview(payload = {}) {
  const rangeContext = getRangeContext(payload);
  const emptyOverview = createEmptyAnalyticsOverview(payload, rangeContext);
  const chartStartToken = rangeContext.chartStartToken;
  const chartEndToken = rangeContext.chartEndToken;
  const metricNames = [
    ANALYTICS_METRICS.newPlayers,
    ANALYTICS_METRICS.referralsCreated,
    ANALYTICS_METRICS.promoCodeApplyClicks,
    ANALYTICS_METRICS.sessionsStarted,
    ANALYTICS_METRICS.sessionsFinished,
  ];
  const rangeWhere = buildAnalyticsRangeWhere(rangeContext.rangeStartToken, rangeContext.rangeEndToken, "date");
  const chartWhere = buildAnalyticsRangeWhere(chartStartToken, chartEndToken, "date");
  const uniquePresenceRangeWhere = buildAnalyticsRangeWhere(rangeContext.rangeStartToken, rangeContext.rangeEndToken, "date");
  const sessionStartWhere = buildAnalyticsRangeWhere(rangeContext.rangeStartToken, rangeContext.rangeEndToken, "start_date");
  const recentSessionsWhere = buildAnalyticsRangeWhere(rangeContext.rangeStartToken, rangeContext.rangeEndToken, "start_date");
  const hourlyDateToken = rangeContext.effectiveRange === "today"
    ? (chartStartToken || rangeContext.rangeStartToken || getTodayToken())
    : "";
  const chartParamsWithMetrics = [...chartWhere.params, metricNames];
  const playerSeriesStartToken = rangeContext.effectiveRange === "all"
    ? `${buildMonthTokenSequence(12)[0] || getCurrentMonthToken()}-01`
    : chartStartToken;

  const [usersResult, dailyMetricsResult, hourlyMetricsResult, appOpenUsersResult, promoCodeApplyUsersResult, dailyOpenUsersResult, sessionSummaryResult, recentSessionsResult, attemptsByUserResult, referralsByUserResult, totalReferredPlayersResult, playersBeforeChartResult, prizesSummaryResult, awardedPrizeStatsResult] = await Promise.all([
    query(`
      SELECT
        COUNT(*)::int AS total_players_count,
        COUNT(*) FILTER (WHERE last_seen_at >= NOW() - INTERVAL '15 minutes')::int AS currently_online_players_count
      FROM app_users
    `),
    query(
      `
        SELECT
          date::text AS key,
          metric,
          value::bigint
        FROM analytics_daily
        ${chartWhere.whereClause}
          ${chartWhere.whereClause ? "AND" : "WHERE"} metric = ANY($${chartParamsWithMetrics.length}::text[])
        ORDER BY date ASC
      `,
      chartParamsWithMetrics,
    ),
    hourlyDateToken
      ? query(
        `
          SELECT
            CONCAT(date::text, '-', LPAD(hour::text, 2, '0')) AS key,
            metric,
            value::bigint
          FROM analytics_hourly
          WHERE date = $1::date
            AND metric = ANY($2::text[])
          ORDER BY hour ASC
        `,
        [hourlyDateToken, metricNames],
      )
      : Promise.resolve({ rows: [] }),
    query(
      `
        SELECT COUNT(DISTINCT user_id)::int AS count
        FROM analytics_metric_users
        ${uniquePresenceRangeWhere.whereClause}
          ${uniquePresenceRangeWhere.whereClause ? "AND" : "WHERE"} metric = $${uniquePresenceRangeWhere.params.length + 1}
      `,
      [...uniquePresenceRangeWhere.params, ANALYTICS_USER_PRESENCE_METRICS.appOpen],
    ),
    query(
      `
        SELECT COUNT(DISTINCT user_id)::int AS count
        FROM analytics_metric_users
        ${uniquePresenceRangeWhere.whereClause}
          ${uniquePresenceRangeWhere.whereClause ? "AND" : "WHERE"} metric = $${uniquePresenceRangeWhere.params.length + 1}
      `,
      [...uniquePresenceRangeWhere.params, ANALYTICS_USER_PRESENCE_METRICS.promoCodeApply],
    ),
    query(
      `
        SELECT
          date::text AS date_token,
          COUNT(*)::int AS value
        FROM analytics_metric_users
        ${rangeWhere.whereClause}
          ${rangeWhere.whereClause ? "AND" : "WHERE"} metric = $${rangeWhere.params.length + 1}
        GROUP BY date
        ORDER BY date ASC
      `,
      [...rangeWhere.params, ANALYTICS_USER_PRESENCE_METRICS.appOpen],
    ),
    query(
      `
        SELECT
          COUNT(*)::int AS sessions_started_count,
          COUNT(*) FILTER (WHERE finished_at IS NOT NULL)::int AS finished_sessions_count,
          COUNT(DISTINCT user_id)::int AS entered_game_count,
          COUNT(DISTINCT user_id) FILTER (WHERE finished_at IS NOT NULL)::int AS finished_players_count,
          COALESCE(ROUND(AVG(duration_seconds) FILTER (WHERE finished_at IS NOT NULL)), 0)::int AS average_completion_seconds
        FROM game_sessions
        ${sessionStartWhere.whereClause}
      `,
      sessionStartWhere.params,
    ),
    query(
      `
        SELECT
          session_id,
          user_id,
          started_at,
          finished_at,
          duration_seconds
        FROM game_sessions
        ${recentSessionsWhere.whereClause}
        ORDER BY started_at DESC
        LIMIT 20
      `,
      recentSessionsWhere.params,
    ),
    query(
      `
        SELECT
          user_id,
          COALESCE(SUM(value), 0)::int AS total
        FROM analytics_daily_user_metrics
        ${rangeWhere.whereClause}
          ${rangeWhere.whereClause ? "AND" : "WHERE"} metric = $${rangeWhere.params.length + 1}
        GROUP BY user_id
      `,
      [...rangeWhere.params, ANALYTICS_USER_METRICS.spinConsumed],
    ),
    query(
      `
        SELECT
          user_id,
          COALESCE(SUM(value), 0)::int AS total
        FROM analytics_daily_user_metrics
        ${rangeWhere.whereClause}
          ${rangeWhere.whereClause ? "AND" : "WHERE"} metric = $${rangeWhere.params.length + 1}
        GROUP BY user_id
      `,
      [...rangeWhere.params, ANALYTICS_USER_METRICS.referralsInvited],
    ),
    query(`
      SELECT COUNT(*)::int AS total_referred_players_count
      FROM user_attempt_transactions
      WHERE reason = 'referral_bonus'
        AND related_user_id IS NOT NULL
    `),
    playerSeriesStartToken
      ? query(
        `
          SELECT COUNT(*)::int AS count
          FROM app_users
          WHERE (created_at AT TIME ZONE $2)::date < $1::date
        `,
        [playerSeriesStartToken, ANALYTICS_TIMEZONE],
      )
      : Promise.resolve({ rows: [{ count: 0 }] }),
    query(`
      SELECT
        COUNT(*)::int AS total_prizes_count,
        COALESCE(SUM(total_count), 0)::int AS total_units_count,
        COALESCE(SUM(remaining_count), 0)::int AS total_remaining_count
      FROM prize_positions
    `),
    query(
      `
        SELECT
          prize_positions.id,
          prize_positions.title,
          prize_positions.my_prize_text,
          prize_positions.type,
          prize_positions.sort_order,
          COUNT(awarded_prizes.id)::int AS awarded_count
        FROM prize_positions
        LEFT JOIN awarded_prizes
          ON awarded_prizes.prize_id = prize_positions.id
        GROUP BY prize_positions.id
        ORDER BY awarded_count DESC, prize_positions.sort_order ASC, prize_positions.id ASC
      `,
    ),
  ]);

  const dailyMetricRows = dailyMetricsResult.rows.map((row) => ({
    key: String(row.key || "").trim(),
    metric: String(row.metric || "").trim(),
    value: Number(row.value || 0),
  }));
  const hourlyMetricRows = hourlyMetricsResult.rows.map((row) => ({
    key: String(row.key || "").trim(),
    metric: String(row.metric || "").trim(),
    value: Number(row.value || 0),
  }));
  const seriesSourceRows = rangeContext.effectiveRange === "today" ? hourlyMetricRows : dailyMetricRows;
  const newPlayersSeries = buildSeriesFromAggregateRows(
    seriesSourceRows.filter((row) => row.metric === ANALYTICS_METRICS.newPlayers),
    rangeContext.effectiveRange,
    chartStartToken,
    chartEndToken,
  );
  const sessionsStartedSeries = buildSeriesFromAggregateRows(
    seriesSourceRows.filter((row) => row.metric === ANALYTICS_METRICS.sessionsStarted),
    rangeContext.effectiveRange,
    chartStartToken,
    chartEndToken,
  );
  const sessionsFinishedSeries = buildSeriesFromAggregateRows(
    seriesSourceRows.filter((row) => row.metric === ANALYTICS_METRICS.sessionsFinished),
    rangeContext.effectiveRange,
    chartStartToken,
    chartEndToken,
  );
  let runningPlayersCount = Number(playersBeforeChartResult.rows[0]?.count || 0);
  const totalPlayersSeries = newPlayersSeries.map((point) => {
    runningPlayersCount += Number(point.value || 0);

    return {
      ...point,
      value: runningPlayersCount,
    };
  });
  const attemptsByUser = attemptsByUserResult.rows.map((row) => Number(row.total || 0));
  const referralsByUser = referralsByUserResult.rows.map((row) => Number(row.total || 0));
  const dailyUniqueVisitCounts = dailyOpenUsersResult.rows.map((row) => Number(row.value || 0));
  const totalUniqueDailyVisitsCount = dailyUniqueVisitCounts.reduce((sum, count) => sum + count, 0);
  const averageDauCount = dailyUniqueVisitCounts.length > 0
    ? Math.round(totalUniqueDailyVisitsCount / dailyUniqueVisitCounts.length)
    : 0;
  const summaryRow = sessionSummaryResult.rows[0] || {};
  const prizesSummaryRow = prizesSummaryResult.rows[0] || {};
  const awardedPrizeStats = awardedPrizeStatsResult.rows
    .map((row) => ({
      prizeId: Number(row.id),
      title: String(row.my_prize_text || row.title || "").trim() || `Приз #${row.id}`,
      type: String(row.type || "").trim(),
      awardedCount: Number(row.awarded_count || 0),
    }))
    .filter((item) => item.awardedCount > 0);
  const totalAwardedCount = awardedPrizeStats.reduce((sum, item) => sum + Number(item.awardedCount || 0), 0);
  const dailyMetricSum = (metricName) =>
    dailyMetricRows
      .filter((row) => row.metric === metricName && isTokenInRange(row.key, rangeContext.rangeStartToken, rangeContext.rangeEndToken))
      .reduce((sum, row) => sum + Number(row.value || 0), 0);

  return {
    ...emptyOverview,
    meta: {
      range: rangeContext.requestedRange,
      cachedAt: new Date().toISOString(),
      dateFrom: String(payload?.dateFrom || ""),
      dateTo: String(payload?.dateTo || ""),
    },
    summary: {
      ...emptyOverview.summary,
      totalPlayersCount: Number(usersResult.rows[0]?.total_players_count || 0),
      newPlayersCount: dailyMetricSum(ANALYTICS_METRICS.newPlayers),
      appOpenedCount: Number(appOpenUsersResult.rows[0]?.count || 0),
      subscribedPlayersCount: 0,
      totalUniqueDailyVisitsCount,
      averageDauCount,
      sessionsStartedCount: Number(summaryRow.sessions_started_count || 0),
      finishedSessionsCount: Number(summaryRow.finished_sessions_count || 0),
      playersWithFinishedGameCount: Number(summaryRow.finished_players_count || 0),
      currentlyOnlinePlayersCount: Number(usersResult.rows[0]?.currently_online_players_count || 0),
      averageCompletionSeconds: Number(summaryRow.average_completion_seconds || 0),
      referralsInPeriodCount: dailyMetricSum(ANALYTICS_METRICS.referralsCreated),
      totalReferredPlayersCount: Number(totalReferredPlayersResult.rows[0]?.total_referred_players_count || 0),
      passedSubscriptionStageCount: 0,
      notSubscribedBeforeCount: 0,
      subscribedAfterNotSubscribedCount: 0,
      enteredGameCount: Number(summaryRow.entered_game_count || 0),
      attemptedOneTimePlayersCount: attemptsByUser.filter((count) => count >= 1).length,
      attemptedThreeTimesPlayersCount: attemptsByUser.filter((count) => count >= 3).length,
      attemptedFiveTimesPlayersCount: attemptsByUser.filter((count) => count >= 5).length,
      attemptedTenTimesPlayersCount: attemptsByUser.filter((count) => count >= 10).length,
      referredOneFriendPlayersCount: referralsByUser.filter((count) => count >= 1).length,
      referredThreeFriendsPlayersCount: referralsByUser.filter((count) => count >= 3).length,
      referredFiveFriendsPlayersCount: referralsByUser.filter((count) => count >= 5).length,
      referredTenFriendsPlayersCount: referralsByUser.filter((count) => count >= 10).length,
      promoCodeApplyClicksCount: dailyMetricSum(ANALYTICS_METRICS.promoCodeApplyClicks),
      promoCodeApplyUsersCount: Number(promoCodeApplyUsersResult.rows[0]?.count || 0),
      totalPrizesCount: Number(prizesSummaryRow.total_prizes_count || 0),
      totalUnitsCount: Number(prizesSummaryRow.total_units_count || 0),
      totalRemainingCount: Number(prizesSummaryRow.total_remaining_count || 0),
      totalAwardedCount,
    },
    awardedPrizeStats,
    series: {
      newPlayers: newPlayersSeries,
      totalPlayers: totalPlayersSeries,
      sessionsStarted: sessionsStartedSeries,
      sessionsFinished: sessionsFinishedSeries,
    },
    recentSessions: recentSessionsResult.rows.map((session) => ({
      id: session.session_id,
      playerId: Number(session.user_id),
      startedAt: session.started_at,
      finishedAt: session.finished_at,
      durationSeconds: Number(session.duration_seconds || 0),
      status: session.finished_at ? "finished" : "active",
      })),
  };
}

export async function getAnalyticsUtm(payload = {}) {
  const search = normalizeSearch(payload?.search);
  const result = await query(
    `
      SELECT
        utm_slug,
        COUNT(*)::int AS total_clicks_count,
        COUNT(*) FILTER (WHERE was_existing_player = FALSE)::int AS new_users_count,
        COUNT(*) FILTER (WHERE was_existing_player = TRUE)::int AS returning_users_count,
        MAX(created_at) AS last_click_at
      FROM utm_visits
      GROUP BY utm_slug
      ORDER BY COUNT(*) DESC, utm_slug ASC
    `,
  );

  let items = result.rows.map((row) => ({
    utmSlug: row.utm_slug || "",
    newUsersCount: Number(row.new_users_count || 0),
    returningUsersCount: Number(row.returning_users_count || 0),
    totalClicksCount: Number(row.total_clicks_count || 0),
    lastClickAt: row.last_click_at || null,
  }));

  if (search) {
    items = items.filter((item) => item.utmSlug.toLowerCase().includes(search));
  }

  return {
    items,
    summary: {
      totalUtmsCount: items.length,
      totalClicksCount: items.reduce((sum, item) => sum + Number(item.totalClicksCount || 0), 0),
      totalNewUsersCount: items.reduce((sum, item) => sum + Number(item.newUsersCount || 0), 0),
    },
  };
}

export async function listPlayersAnalytics(payload = {}) {
  const page = Math.max(1, Number(payload?.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(payload?.pageSize) || 25));
  const sortKey = String(payload?.sortKey || "createdAt");
  const sortDirection = String(payload?.sortDirection || "desc").toLowerCase() === "asc" ? "asc" : "desc";
  const search = normalizeSearch(payload?.search);
  const { users, sessionStatsMap, logStatsMap, latestPrizeMap, attemptsMap } = await getPlayerBaseMaps();

  let items = users.map((player) =>
    mapPlayerRow(
      player,
      sessionStatsMap.get(Number(player.id)),
      logStatsMap.get(Number(player.id)),
      latestPrizeMap.get(Number(player.id)),
      attemptsMap.get(Number(player.id)),
    ));

  if (search) {
    items = items.filter((player) => {
      const haystack = [
        player.id,
        player.platform,
        player.platformUserId,
        player.telegramUserId,
        player.externalId,
        player.username,
        player.firstName,
        player.lastName,
        player.referralCode,
        player.referredByCode,
        player.utmSlug,
        player.displayName,
      ].join(" ").toLowerCase();

      return haystack.includes(search);
    });
  }

  items.sort((left, right) => {
    if (sortKey === "lastSeenAt") {
      return compareValues(new Date(left.lastSeenAt).getTime(), new Date(right.lastSeenAt).getTime(), sortDirection);
    }

    if (sortKey === "displayName") {
      return compareValues(left.displayName, right.displayName, sortDirection);
    }

    if (sortKey === "bestDurationSeconds") {
      return compareValues(left.bestDurationSeconds, right.bestDurationSeconds, sortDirection);
    }

    if (sortKey === "totalSessions") {
      return compareValues(left.totalSessions, right.totalSessions, sortDirection);
    }

    return compareValues(new Date(left.createdAt).getTime(), new Date(right.createdAt).getTime(), sortDirection);
  });

  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const offset = (page - 1) * pageSize;

  return {
    items: items.slice(offset, offset + pageSize),
    pagination: {
      page,
      pageSize,
      totalItems,
      totalPages,
    },
  };
}

export async function getPlayerAnalyticsDetails(payload = {}) {
  const playerId = Number(payload?.playerId) || 0;
  const { users, sessionStatsMap, logStatsMap, latestPrizeMap, attemptsMap } = await getPlayerBaseMaps();
  const player = users.find((item) => Number(item.id) === playerId);

  if (!player) {
    throw new Error("Player not found");
  }

  const sessionStats = sessionStatsMap.get(playerId);
  const logStats = logStatsMap.get(playerId);
  const latestPrize = latestPrizeMap.get(playerId);
  const attemptStats = attemptsMap.get(playerId);
  const [referralData, liveAttemptSummary] = await Promise.all([
    getReferralData(playerId),
    getUserAttemptSummary(playerId),
  ]);
  const recentSessionsResult = await query(
    `
      SELECT
        session_id,
        started_at,
        finished_at,
        duration_seconds
      FROM game_sessions
      WHERE user_id = $1
      ORDER BY started_at DESC
      LIMIT 20
    `,
    [playerId],
  );
  const awardedPrizesResult = await query(
    `
      SELECT
        awarded_prizes.id,
        awarded_prizes.prize_id,
        awarded_prizes.title AS awarded_title,
        awarded_prizes.promo_code,
        awarded_prizes.image,
        awarded_prizes.created_at,
        prize_positions.title AS position_title,
        prize_promo_codes.available_from
      FROM awarded_prizes
      LEFT JOIN prize_positions
        ON prize_positions.id = awarded_prizes.prize_id
      LEFT JOIN prize_promo_codes
        ON prize_promo_codes.awarded_prize_id = awarded_prizes.id
      WHERE awarded_prizes.user_id = $1
      ORDER BY awarded_prizes.created_at DESC, awarded_prizes.id DESC
    `,
    [playerId],
  );

  return {
    player: {
      ...mapPlayerRow(player, sessionStats, logStats, latestPrize, attemptStats),
      referralLink: referralData.referralLink,
      invitedReferralIds: referralData.invitedReferralIds,
    },
    stats: {
      totalSessions: Number(sessionStats?.total_sessions || 0),
      finishedSessions: Number(sessionStats?.finished_sessions || 0),
      totalDurationSeconds: Number(sessionStats?.total_duration_seconds || 0),
      bestDurationSeconds: Number(sessionStats?.best_duration_seconds || 0),
      averageDurationSeconds: Number(sessionStats?.average_duration_seconds || 0),
      totalActivityLogs: Number(logStats?.total_activity_logs || 0),
      lastSessionAt: sessionStats?.last_session_at || null,
      availableAttempts: liveAttemptSummary.availableAttempts,
      invitedReferralsCount: liveAttemptSummary.invitedReferralsCount,
    },
    recentSessions: recentSessionsResult.rows.map((row) => ({
      id: row.session_id,
      status: row.finished_at ? "finished" : "active",
      foundSneakersCount: 0,
      remainingSeconds: 0,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      durationSeconds: Number(row.duration_seconds || 0),
    })),
    awardedPrizes: awardedPrizesResult.rows.map(mapAwardedPrizeRow),
  };
}

export async function getPlayerLogs(payload = {}) {
  const playerId = Number(payload?.playerId) || 0;
  const limit = Math.min(200, Math.max(1, Number(payload?.limit) || 50));
  const result = await query(
    `
      SELECT
        id,
        user_id,
        action,
        source,
        payload,
        created_at
      FROM user_events
      WHERE user_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2
    `,
    [playerId, limit],
  );

  return {
    logs: result.rows.map((row) => ({
      id: Number(row.id),
      playerId: Number(row.user_id),
      gameSessionId: String(row.payload?.sessionId || row.payload?.session_id || ""),
      action: row.action,
      source: row.source,
      details: row.payload && typeof row.payload === "object" ? row.payload : {},
      createdAt: row.created_at,
    })),
  };
}

export async function deletePlayerAnalytics(payload = {}) {
  return deleteUserById(payload?.playerId);
}
