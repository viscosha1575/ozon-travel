import { query } from "./db.js";
import {
  deleteUserById,
  getOrCreateUser,
  getReferralData,
  getUserAttemptSummary,
} from "./userStore.js";

const ANALYTICS_TIMEZONE = String(process.env.APP_TIMEZONE || "Europe/Moscow").trim() || "Europe/Moscow";
const APP_OPEN_EVENT_NAMES = new Set(["app_open", "bootstrap_loaded", "game_bootstrap_loaded"]);

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
  const parts = getZonedParts(value);

  if (!parts) {
    return "";
  }

  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
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

  return {
    id: Number(player.id),
    telegramUserId: player.external_id,
    username: player.username || "",
    firstName: player.first_name || "",
    lastName: player.last_name || "",
    languageCode: player.language_code || "",
    referralCode: player.referral_code || "",
    referredByCode: player.start_param || "",
    hasReferral: Boolean(player.start_param),
    referredByUserId: player.referred_by_user_id ? Number(player.referred_by_user_id) : null,
    subscribedToChannel: false,
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

async function getPlayerBaseMaps() {
  const [usersResult, sessionStatsResult, logStatsResult, latestPrizeResult, attemptsResult] = await Promise.all([
    query(`
      SELECT
        id,
        external_id,
        username,
        first_name,
        last_name,
        language_code,
        start_param,
        referral_code,
        created_at,
        updated_at,
        last_seen_at
      FROM app_users
    `),
    query(`
      WITH session_events AS (
        SELECT
          user_id,
          session_id,
          MIN(created_at) AS started_at,
          MAX(created_at) AS finished_at,
          BOOL_OR(event_name = 'spin_result') AS has_finished
        FROM game_event_logs
        WHERE session_id <> ''
        GROUP BY user_id, session_id
      )
      SELECT
        user_id,
        COUNT(*)::int AS total_sessions,
        (COUNT(*) FILTER (WHERE has_finished))::int AS finished_sessions,
        COALESCE(SUM(EXTRACT(EPOCH FROM finished_at - started_at)) FILTER (WHERE has_finished), 0)::int AS total_duration_seconds,
        COALESCE(MIN(EXTRACT(EPOCH FROM finished_at - started_at)) FILTER (WHERE has_finished), 0)::int AS best_duration_seconds,
        COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM finished_at - started_at)) FILTER (WHERE has_finished)), 0)::int AS average_duration_seconds,
        MAX(started_at) AS last_session_at
      FROM session_events
      GROUP BY user_id
    `),
    query(`
      SELECT
        user_id,
        COUNT(*)::int AS total_activity_logs,
        MAX(created_at) AS last_activity_at
      FROM game_event_logs
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
  const user = await getOrCreateUser(userInfo, options.client || null);

  const result = await (options.client || { query }).query(
    `
      INSERT INTO game_event_logs (user_id, session_id, event_name, source, details)
      VALUES ($1, $2, $3, $4, $5::jsonb)
      RETURNING id, created_at
    `,
    [user.id, sessionId, normalizedEventName, source, JSON.stringify(details)],
  );

  return {
    id: Number(result.rows[0].id),
    createdAt: result.rows[0].created_at,
    user,
  };
}

export async function getAnalyticsOverview(payload = {}) {
  const rangeContext = getRangeContext(payload);
  const emptyOverview = createEmptyAnalyticsOverview(payload, rangeContext);
  const [usersResult, logsResult, attemptsResult] = await Promise.all([
    query(`
      SELECT
        id,
        created_at,
        last_seen_at,
        referred_by_user_id
      FROM app_users
    `),
    query(`
      SELECT
        id,
        user_id,
        session_id,
        event_name,
        created_at
      FROM game_event_logs
    `),
    query(`
      SELECT
        user_id,
        delta,
        reason,
        created_at
      FROM user_attempt_transactions
    `),
  ]);

  const users = usersResult.rows.map((row) => ({
    id: Number(row.id),
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    referredByUserId: row.referred_by_user_id ? Number(row.referred_by_user_id) : null,
    dateToken: toDateToken(row.created_at),
  }));
  const logs = logsResult.rows.map((row) => ({
    id: Number(row.id),
    userId: Number(row.user_id),
    sessionId: row.session_id || "",
    eventName: row.event_name || "",
    createdAt: row.created_at,
    dateToken: toDateToken(row.created_at),
    hourToken: toHourToken(row.created_at),
    monthToken: toMonthToken(row.created_at),
  }));
  const attemptTransactions = attemptsResult.rows.map((row) => ({
    userId: Number(row.user_id),
    delta: Number(row.delta || 0),
    reason: row.reason || "",
    createdAt: row.created_at,
    dateToken: toDateToken(row.created_at),
  }));

  const inRangeUsers = users.filter((user) =>
    isTokenInRange(user.dateToken, rangeContext.rangeStartToken, rangeContext.rangeEndToken),
  );
  const openEventsInRange = logs.filter((log) =>
    APP_OPEN_EVENT_NAMES.has(log.eventName)
    && isTokenInRange(log.dateToken, rangeContext.rangeStartToken, rangeContext.rangeEndToken),
  );

  const sessionsMap = new Map();

  for (const log of logs) {
    if (!log.sessionId) {
      continue;
    }

    const sessionKey = `${log.userId}:${log.sessionId}`;
    const currentSession = sessionsMap.get(sessionKey);

    if (!currentSession) {
      sessionsMap.set(sessionKey, {
        userId: log.userId,
        sessionId: log.sessionId,
        startedAt: log.createdAt,
        finishedAt: log.eventName === "spin_result" ? log.createdAt : null,
        hasFinished: log.eventName === "spin_result",
      });
      continue;
    }

    if (new Date(log.createdAt).getTime() < new Date(currentSession.startedAt).getTime()) {
      currentSession.startedAt = log.createdAt;
    }

    if (log.eventName === "spin_result") {
      currentSession.hasFinished = true;

      if (
        !currentSession.finishedAt
        || new Date(log.createdAt).getTime() > new Date(currentSession.finishedAt).getTime()
      ) {
        currentSession.finishedAt = log.createdAt;
      }
    }
  }

  const allSessions = [...sessionsMap.values()].map((session) => ({
    ...session,
    startedDateToken: toDateToken(session.startedAt),
    finishedDateToken: session.finishedAt ? toDateToken(session.finishedAt) : "",
    startedHourToken: toHourToken(session.startedAt),
    finishedHourToken: session.finishedAt ? toHourToken(session.finishedAt) : "",
    startedMonthToken: toMonthToken(session.startedAt),
    finishedMonthToken: session.finishedAt ? toMonthToken(session.finishedAt) : "",
    durationSeconds: session.hasFinished && session.finishedAt
      ? Math.max(0, Math.round((new Date(session.finishedAt).getTime() - new Date(session.startedAt).getTime()) / 1000))
      : 0,
  }));

  const inRangeStartedSessions = allSessions.filter((session) =>
    isTokenInRange(session.startedDateToken, rangeContext.rangeStartToken, rangeContext.rangeEndToken),
  );
  const finishedSessionsFromStartedRange = inRangeStartedSessions.filter((session) => session.hasFinished);
  const chartStartedSessions = allSessions.filter((session) =>
    isTokenInRange(session.startedDateToken, rangeContext.chartStartToken, rangeContext.chartEndToken),
  );
  const chartFinishedSessions = allSessions.filter((session) =>
    session.hasFinished
    && isTokenInRange(session.finishedDateToken, rangeContext.chartStartToken, rangeContext.chartEndToken),
  );

  const inRangeSpinTransactions = attemptTransactions.filter((item) =>
    item.reason === "spin_consumed"
    && isTokenInRange(item.dateToken, rangeContext.rangeStartToken, rangeContext.rangeEndToken),
  );
  const attemptsByUser = new Map();

  for (const transaction of inRangeSpinTransactions) {
    attemptsByUser.set(transaction.userId, (attemptsByUser.get(transaction.userId) || 0) + Math.abs(transaction.delta || 0));
  }

  const inRangeReferralUsers = users.filter((user) =>
    Boolean(user.referredByUserId)
    && isTokenInRange(user.dateToken, rangeContext.rangeStartToken, rangeContext.rangeEndToken),
  );
  const referralsByUser = new Map();

  for (const user of inRangeReferralUsers) {
    referralsByUser.set(user.referredByUserId, (referralsByUser.get(user.referredByUserId) || 0) + 1);
  }

  const uniqueOpenUsersByDay = new Map();

  for (const log of openEventsInRange) {
    if (!uniqueOpenUsersByDay.has(log.dateToken)) {
      uniqueOpenUsersByDay.set(log.dateToken, new Set());
    }

    uniqueOpenUsersByDay.get(log.dateToken).add(log.userId);
  }

  const dailyUniqueVisitCounts = [...uniqueOpenUsersByDay.values()].map((item) => item.size);
  const totalUniqueDailyVisitsCount = dailyUniqueVisitCounts.reduce((sum, count) => sum + count, 0);
  const averageDauCount = dailyUniqueVisitCounts.length > 0
    ? Math.round(totalUniqueDailyVisitsCount / dailyUniqueVisitCounts.length)
    : 0;

  const newPlayersSeries = buildSeries(
    users.filter((user) => isTokenInRange(user.dateToken, rangeContext.chartStartToken, rangeContext.chartEndToken)),
    rangeContext.effectiveRange,
    (item) => {
      if (rangeContext.effectiveRange === "today") {
        return toHourToken(item.createdAt);
      }

      if (rangeContext.effectiveRange === "all") {
        return toMonthToken(item.createdAt);
      }

      return item.dateToken;
    },
    rangeContext.chartStartToken,
    rangeContext.chartEndToken,
  );
  const playersBeforeChartStartCount = users.filter((user) =>
    rangeContext.chartStartToken && user.dateToken && user.dateToken < rangeContext.chartStartToken,
  ).length;
  let runningPlayersCount = playersBeforeChartStartCount;
  const totalPlayersSeries = newPlayersSeries.map((point) => {
    runningPlayersCount += Number(point.value || 0);

    return {
      ...point,
      value: runningPlayersCount,
    };
  });
  const sessionsStartedSeries = buildSeries(
    chartStartedSessions,
    rangeContext.effectiveRange,
    (item) => {
      if (rangeContext.effectiveRange === "today") {
        return item.startedHourToken;
      }

      if (rangeContext.effectiveRange === "all") {
        return item.startedMonthToken;
      }

      return item.startedDateToken;
    },
    rangeContext.chartStartToken,
    rangeContext.chartEndToken,
  );
  const sessionsFinishedSeries = buildSeries(
    chartFinishedSessions,
    rangeContext.effectiveRange,
    (item) => {
      if (rangeContext.effectiveRange === "today") {
        return item.finishedHourToken;
      }

      if (rangeContext.effectiveRange === "all") {
        return item.finishedMonthToken;
      }

      return item.finishedDateToken;
    },
    rangeContext.chartStartToken,
    rangeContext.chartEndToken,
  );

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
      totalPlayersCount: users.length,
      newPlayersCount: inRangeUsers.length,
      appOpenedCount: new Set(openEventsInRange.map((item) => item.userId)).size,
      subscribedPlayersCount: 0,
      totalUniqueDailyVisitsCount,
      averageDauCount,
      sessionsStartedCount: inRangeStartedSessions.length,
      finishedSessionsCount: finishedSessionsFromStartedRange.length,
      playersWithFinishedGameCount: new Set(finishedSessionsFromStartedRange.map((item) => item.userId)).size,
      currentlyOnlinePlayersCount: users.filter((user) => isOnline(user.lastSeenAt)).length,
      averageCompletionSeconds: finishedSessionsFromStartedRange.length > 0
        ? Math.round(
          finishedSessionsFromStartedRange.reduce((sum, item) => sum + Number(item.durationSeconds || 0), 0)
          / finishedSessionsFromStartedRange.length,
        )
        : 0,
      referralsInPeriodCount: inRangeReferralUsers.length,
      totalReferredPlayersCount: users.filter((user) => Boolean(user.referredByUserId)).length,
      passedSubscriptionStageCount: 0,
      notSubscribedBeforeCount: 0,
      subscribedAfterNotSubscribedCount: 0,
      enteredGameCount: new Set(inRangeStartedSessions.map((item) => item.userId)).size,
      attemptedOneTimePlayersCount: [...attemptsByUser.values()].filter((count) => count >= 1).length,
      attemptedThreeTimesPlayersCount: [...attemptsByUser.values()].filter((count) => count >= 3).length,
      attemptedFiveTimesPlayersCount: [...attemptsByUser.values()].filter((count) => count >= 5).length,
      attemptedTenTimesPlayersCount: [...attemptsByUser.values()].filter((count) => count >= 10).length,
      referredOneFriendPlayersCount: [...referralsByUser.values()].filter((count) => count >= 1).length,
      referredThreeFriendsPlayersCount: [...referralsByUser.values()].filter((count) => count >= 3).length,
      referredFiveFriendsPlayersCount: [...referralsByUser.values()].filter((count) => count >= 5).length,
      referredTenFriendsPlayersCount: [...referralsByUser.values()].filter((count) => count >= 10).length,
    },
    series: {
      newPlayers: newPlayersSeries,
      totalPlayers: totalPlayersSeries,
      sessionsStarted: sessionsStartedSeries,
      sessionsFinished: sessionsFinishedSeries,
    },
    recentSessions: inRangeStartedSessions
      .slice()
      .sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime())
      .slice(0, 20)
      .map((session) => ({
        id: session.sessionId,
        playerId: session.userId,
        startedAt: session.startedAt,
        finishedAt: session.finishedAt,
        durationSeconds: session.durationSeconds,
        status: session.hasFinished ? "finished" : "active",
      })),
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
        player.telegramUserId,
        player.username,
        player.firstName,
        player.lastName,
        player.referralCode,
        player.referredByCode,
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
      WITH session_events AS (
        SELECT
          user_id,
          session_id,
          MIN(created_at) AS started_at,
          MAX(created_at) AS finished_at,
          BOOL_OR(event_name = 'spin_result') AS has_finished
        FROM game_event_logs
        WHERE user_id = $1 AND session_id <> ''
        GROUP BY user_id, session_id
      )
      SELECT
        session_id,
        started_at,
        finished_at,
        has_finished,
        COALESCE(EXTRACT(EPOCH FROM finished_at - started_at), 0)::int AS duration_seconds
      FROM session_events
      ORDER BY started_at DESC
      LIMIT 20
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
      status: row.has_finished ? "finished" : "active",
      foundSneakersCount: 0,
      remainingSeconds: 0,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      durationSeconds: Number(row.duration_seconds || 0),
    })),
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
        session_id,
        event_name,
        source,
        details,
        created_at
      FROM game_event_logs
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
      gameSessionId: row.session_id || "",
      action: row.event_name,
      source: row.source,
      details: row.details && typeof row.details === "object" ? row.details : {},
      createdAt: row.created_at,
    })),
  };
}

export async function deletePlayerAnalytics(payload = {}) {
  return deleteUserById(payload?.playerId);
}
