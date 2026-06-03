import { query } from "./db.js";
import { enqueueDailyAttemptReminderBroadcastTestJob } from "./workerQueue.js";

const MSK_TIMEZONE = "Europe/Moscow";
const DAILY_ATTEMPT_REMINDER_KEY = "daily_attempt_reminder";

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

export async function grantDailyAttemptsForAllUsers(payload = {}) {
  const reminderDate = parseDateValue(payload.reminderDate);
  const details = JSON.stringify({
    timezone: MSK_TIMEZONE,
    grantedAtDate: reminderDate,
    source: String(payload.source || "worker").trim() || "worker",
  });
  const result = await query(
    `
      INSERT INTO user_attempt_transactions (
        user_id,
        delta,
        reason,
        attempt_date,
        details
      )
      SELECT
        app_users.id,
        1,
        'daily_login_attempt',
        $1::date,
        $2::jsonb
      FROM app_users
      ON CONFLICT DO NOTHING
      RETURNING id
    `,
    [reminderDate, details],
  );

  return {
    ok: true,
    reminderDate,
    grantedCount: result.rowCount,
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
          AND EXISTS (
            SELECT 1
            FROM user_attempt_transactions daily_grants
            WHERE daily_grants.user_id = app_users.id
              AND daily_grants.reason = 'daily_login_attempt'
              AND daily_grants.attempt_date = $2::date
          )
          AND NOT EXISTS (
            SELECT 1
            FROM user_attempt_transactions spins
            WHERE spins.user_id = app_users.id
              AND spins.reason = 'spin_consumed'
              AND ((spins.created_at AT TIME ZONE $4)::date = $2::date)
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
          $1,
          $2::date,
          eligible.id,
          'queued',
          jsonb_build_object(
            'source', $5,
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
      MSK_TIMEZONE,
      source,
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
