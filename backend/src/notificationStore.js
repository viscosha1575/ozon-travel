import { query } from "./db.js";
import { enqueueDailyAttemptReminderBroadcastTestJob } from "./workerQueue.js";

const MSK_TIMEZONE = "Europe/Moscow";
const DAILY_ATTEMPT_REMINDER_KEY = "daily_attempt_reminder";
const DAILY_ATTEMPT_REASON = "daily_login_attempt";
const APP_OPEN_PRESENCE_METRIC = "app_open";

function getMoscowDateValue(date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: MSK_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function parseDateValue(value, fallbackValue = getMoscowDateValue()) {
  const normalizedValue = String(value || "").trim();

  if (!normalizedValue) {
    return fallbackValue;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
    throw new Error("Invalid reminder date");
  }

  return normalizedValue;
}

function addDaysToDateValue(dateValue, delta) {
  const [year, month, day] = String(dateValue).split("-").map(Number);

  if (!year || !month || !day) {
    throw new Error("Invalid reminder date");
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + Number(delta || 0));

  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export async function grantDailyAttemptsForAllUsers(payload = {}) {
  const reminderDate = parseDateValue(payload.reminderDate);
  const activityDate = addDaysToDateValue(reminderDate, -1);
  const result = await query(
    `
      WITH eligible AS (
        SELECT analytics_metric_users.user_id
        FROM analytics_metric_users
        WHERE analytics_metric_users.date = $2::date
          AND analytics_metric_users.metric = $6
          AND NOT EXISTS (
            SELECT 1
            FROM user_attempt_transactions transactions
            WHERE transactions.user_id = analytics_metric_users.user_id
              AND transactions.reason = $1
              AND transactions.attempt_date = $4::date
          )
      ),
      inserted AS (
        INSERT INTO user_attempt_transactions (
          user_id,
          delta,
          reason,
          attempt_date,
          details
        )
        SELECT
          eligible.user_id,
          1,
          $1,
          $4::date,
          jsonb_build_object(
            'timezone', $3::text,
            'activityDate', $2::text,
            'grantedAtDate', $4::text,
            'source', $5::text
          )
        FROM eligible
        ON CONFLICT DO NOTHING
        RETURNING user_id
      )
      SELECT COUNT(*)::int AS granted_count
      FROM inserted
    `,
    [
      DAILY_ATTEMPT_REASON,
      activityDate,
      MSK_TIMEZONE,
      reminderDate,
      String(payload.source || "worker").trim() || "worker",
      APP_OPEN_PRESENCE_METRIC,
    ],
  );
  const grantedCount = Number(result.rows[0]?.granted_count || 0);

  return {
    ok: true,
    reminderDate,
    activityDate,
    grantedCount,
    mode: "grant_for_previous_day_visit",
  };
}

export async function claimDailyAttemptReminderRecipients(payload = {}) {
  const reminderDate = parseDateValue(payload.reminderDate);
  const batchSize = Math.min(5000, Math.max(1, Number(payload.limit) || 500));
  const source = String(payload.source || "worker").trim() || "worker";
  const result = await query(
    `
      WITH eligible AS (
        SELECT
          app_users.id,
          app_users.external_id,
          app_users.platform_user_id
        FROM app_users
        WHERE app_users.platform = 'max'
          AND (
            SELECT COALESCE(SUM(transactions.delta), 0)::int
            FROM user_attempt_transactions transactions
            WHERE transactions.user_id = app_users.id
          ) >= 1
          AND (
            app_users.last_seen_at IS NULL
            OR (app_users.last_seen_at AT TIME ZONE $5)::date <> $2::date
          )
          AND NOT EXISTS (
            SELECT 1
            FROM notification_deliveries deliveries
            WHERE deliveries.notification_key = $1
              AND deliveries.reminder_date = $2::date
              AND deliveries.user_id = app_users.id
          )
        ORDER BY app_users.id ASC
        LIMIT $3
      ),
      inserted AS (
        INSERT INTO notification_deliveries (
          notification_key,
          reminder_date,
          user_id,
          status,
          details,
          updated_at
        )
        SELECT
          $1::text,
          $2::date,
          eligible.id,
          'queued',
          jsonb_build_object(
            'source', $4::text,
            'externalId', eligible.external_id
          ),
          NOW()
        FROM eligible
        ON CONFLICT (notification_key, reminder_date, user_id) DO NOTHING
        RETURNING id, user_id
      )
      SELECT
        inserted.id AS delivery_id,
        app_users.id AS user_id,
        app_users.external_id,
        app_users.platform_user_id
      FROM inserted
      JOIN app_users ON app_users.id = inserted.user_id
      ORDER BY inserted.id ASC
    `,
    [
      DAILY_ATTEMPT_REMINDER_KEY,
      reminderDate,
      batchSize,
      source,
      MSK_TIMEZONE,
    ],
  );

  return {
    ok: true,
    notificationKey: DAILY_ATTEMPT_REMINDER_KEY,
    reminderDate,
    recipients: result.rows.map((row) => ({
      deliveryId: Number(row.delivery_id),
      userId: Number(row.user_id),
      externalId: String(row.external_id || "").trim(),
      maxUserId: String(row.platform_user_id || "").trim(),
    })).filter((item) => item.maxUserId),
  };
}

export async function validateDailyAttemptReminderDelivery(payload = {}) {
  const deliveryId = Number(payload.deliveryId) || 0;

  if (!deliveryId) {
    throw new Error("deliveryId is required");
  }

  const result = await query(
    `
      SELECT
        deliveries.id AS delivery_id,
        deliveries.status,
        deliveries.reminder_date,
        app_users.id AS user_id,
        app_users.platform_user_id,
        (app_users.last_seen_at AT TIME ZONE $2) AS last_seen_at_msk,
        (
          SELECT COALESCE(SUM(transactions.delta), 0)::int
          FROM user_attempt_transactions transactions
          WHERE transactions.user_id = app_users.id
        ) AS attempts_balance,
        (
          (app_users.last_seen_at AT TIME ZONE $2)::date = deliveries.reminder_date
        ) AS visited_today
      FROM notification_deliveries deliveries
      JOIN app_users ON app_users.id = deliveries.user_id
      WHERE deliveries.id = $1
        AND deliveries.notification_key = $3
      LIMIT 1
    `,
    [deliveryId, MSK_TIMEZONE, DAILY_ATTEMPT_REMINDER_KEY],
  );

  const row = result.rows[0];

  if (!row) {
    throw new Error("Notification delivery not found");
  }

  const status = String(row.status || "").trim();
  const attemptsBalance = Number(row.attempts_balance || 0);
  const visitedToday = Boolean(row.visited_today);

  let eligible = true;
  let reason = "";

  if (status !== "queued") {
    eligible = false;
    reason = `delivery_status_${status || "unknown"}`;
  } else if (visitedToday) {
    eligible = false;
    reason = "user_visited_today";
  } else if (attemptsBalance < 1) {
    eligible = false;
    reason = "no_attempts_available";
  }

  return {
    ok: true,
    deliveryId,
    userId: Number(row.user_id),
    maxUserId: String(row.platform_user_id || "").trim(),
    reminderDate: String(row.reminder_date || ""),
    status,
    attemptsBalance,
    visitedToday,
    lastSeenAtMsk: row.last_seen_at_msk || null,
    eligible,
    reason,
  };
}

export async function getDailyAttemptReminderBroadcastRecipients() {
  const result = await query(
    `
      SELECT platform_user_id
      FROM app_users
      WHERE platform = 'max'
        AND COALESCE(platform_user_id, '') <> ''
      ORDER BY id ASC
    `,
  );

  const recipients = result.rows
    .map((row) => String(row.platform_user_id || "").trim())
    .filter(Boolean);

  return {
    ok: true,
    recipients,
    recipientsCount: recipients.length,
  };
}

export async function sendDailyAttemptReminderBroadcastTest() {
  const countResult = await query(
    `
      SELECT COUNT(*)::int AS count
      FROM app_users
      WHERE platform = 'max'
        AND COALESCE(platform_user_id, '') <> ''
    `,
  );
  const recipientsCount = Number(countResult.rows[0]?.count || 0);

  if (recipientsCount <= 0) {
    throw new Error("Нет MAX-пользователей для тестовой reminder-рассылки");
  }

  const queueResult = await enqueueDailyAttemptReminderBroadcastTestJob();

  return {
    ok: true,
    queued: true,
    recipientsCount,
    jobId: queueResult.jobId,
  };
}

export async function markNotificationDeliverySent(payload = {}) {
  const deliveryId = Number(payload.deliveryId) || 0;
  const messageId = String(payload.messageId || "").trim();

  if (!deliveryId) {
    throw new Error("deliveryId is required");
  }

  const result = await query(
    `
      UPDATE notification_deliveries
      SET
        status = 'sent',
        message_id = $2,
        attempts = attempts + 1,
        error_message = '',
        sent_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
      RETURNING id
    `,
    [deliveryId, messageId],
  );

  if (!result.rowCount) {
    throw new Error("Notification delivery not found");
  }

  return {
    ok: true,
    deliveryId,
  };
}

export async function markNotificationDeliveryFailed(payload = {}) {
  const deliveryId = Number(payload.deliveryId) || 0;
  const errorMessage = String(payload.errorMessage || payload.error || "").trim().slice(0, 1000);

  if (!deliveryId) {
    throw new Error("deliveryId is required");
  }

  const result = await query(
    `
      UPDATE notification_deliveries
      SET
        status = 'failed',
        attempts = attempts + 1,
        error_message = $2,
        updated_at = NOW()
      WHERE id = $1
      RETURNING id
    `,
    [deliveryId, errorMessage],
  );

  if (!result.rowCount) {
    throw new Error("Notification delivery not found");
  }

  return {
    ok: true,
    deliveryId,
  };
}

export {
  DAILY_ATTEMPT_REMINDER_KEY,
  getMoscowDateValue,
};
