import { query } from "./db.js";
import {
  deleteUserById,
  getOrCreateUser,
  getReferralData,
  getUserAttemptSummary,
} from "./userStore.js";

function normalizeSearch(value) {
  return String(value || "").trim().toLowerCase();
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
