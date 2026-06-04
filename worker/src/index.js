import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { WORKER_JOB_NAMES, WORKER_QUEUE_NAMES } from "./workerJobs.js";
import {
  DAILY_ATTEMPT_GRANT_CRON,
  DAILY_ATTEMPT_GRANT_ENABLED,
  DAILY_ATTEMPT_REMINDER_BATCH_SIZE,
  DAILY_ATTEMPT_REMINDER_CRON,
  DAILY_ATTEMPT_REMINDER_ENABLED,
  DAILY_ATTEMPT_TIMEZONE,
  MANUAL_PUSH_JOB_CONCURRENCY,
  NOTIFICATION_SEND_ATTEMPTS,
  NOTIFICATION_SEND_BACKOFF_MS,
  NOTIFICATION_SEND_CONCURRENCY,
  NOTIFICATION_SEND_LIMIT_DURATION_MS,
  NOTIFICATION_SEND_LIMIT_MAX,
  REDIS_URL,
} from "./config.js";
import logger from "./logger.js";
import {
  claimDailyAttemptReminderRecipients,
  prepareDailyAttemptReminderBroadcastTest,
  finalizePushRevoke,
  finalizePushSend,
  grantDailyAttempts,
  markDeliveryFailed,
  markDeliverySent,
  preparePushRevoke,
  preparePushSend,
} from "./services/backendService.js";
import {
  revokePushCampaign,
  sendDailyAttemptReminder,
  sendDailyAttemptReminderCampaign,
  sendPushCampaign,
} from "./services/broadcastService.js";

const SCHEDULER_QUEUE_NAME = WORKER_QUEUE_NAMES.scheduler;
const SEND_QUEUE_NAME = WORKER_QUEUE_NAMES.notificationSend;
const PUSH_QUEUE_NAME = WORKER_QUEUE_NAMES.pushControl;
const JOB_GRANT_DAILY_ATTEMPTS = WORKER_JOB_NAMES.grantDailyAttempts;
const JOB_DAILY_ATTEMPT_REMINDER = WORKER_JOB_NAMES.dailyAttemptReminder;
const JOB_DAILY_ATTEMPT_REMINDER_BROADCAST_TEST = WORKER_JOB_NAMES.dailyAttemptReminderBroadcastTest;
const JOB_PUSH_SEND = WORKER_JOB_NAMES.pushSend;
const JOB_PUSH_REVOKE = WORKER_JOB_NAMES.pushRevoke;

function getMoscowDateValue(date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: DAILY_ATTEMPT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function buildRedisConnection() {
  return new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

async function registerRepeatableJobs(queue) {
  if (DAILY_ATTEMPT_GRANT_ENABLED) {
    await queue.add(
      JOB_GRANT_DAILY_ATTEMPTS,
      { type: JOB_GRANT_DAILY_ATTEMPTS },
      {
        jobId: JOB_GRANT_DAILY_ATTEMPTS,
        repeat: {
          pattern: DAILY_ATTEMPT_GRANT_CRON,
          tz: DAILY_ATTEMPT_TIMEZONE,
        },
        removeOnComplete: true,
        removeOnFail: 1000,
      },
    );
  }

  if (DAILY_ATTEMPT_REMINDER_ENABLED) {
    await queue.add(
      JOB_DAILY_ATTEMPT_REMINDER,
      { type: JOB_DAILY_ATTEMPT_REMINDER },
      {
        jobId: JOB_DAILY_ATTEMPT_REMINDER,
        repeat: {
          pattern: DAILY_ATTEMPT_REMINDER_CRON,
          tz: DAILY_ATTEMPT_TIMEZONE,
        },
        removeOnComplete: true,
        removeOnFail: 1000,
      },
    );
  }
}

async function enqueueDailyReminderRecipients(sendQueue, reminderDate) {
  let claimedCount = 0;

  while (true) {
    const response = await claimDailyAttemptReminderRecipients({
      reminderDate,
      limit: DAILY_ATTEMPT_REMINDER_BATCH_SIZE,
    });
    const recipients = Array.isArray(response?.recipients) ? response.recipients : [];

    if (!recipients.length) {
      break;
    }

    await Promise.all(
      recipients.map((recipient) =>
        sendQueue.add(
          JOB_DAILY_ATTEMPT_REMINDER,
          {
            deliveryId: recipient.deliveryId,
            userId: recipient.userId,
            maxUserId: recipient.maxUserId,
            reminderDate,
          },
          {
            jobId: `daily-attempt-reminder-${recipient.deliveryId}`,
            attempts: NOTIFICATION_SEND_ATTEMPTS,
            backoff: {
              type: "exponential",
              delay: NOTIFICATION_SEND_BACKOFF_MS,
            },
            removeOnComplete: true,
            removeOnFail: false,
          },
        ),
      ),
    );

    claimedCount += recipients.length;

    logger.info("Daily attempt reminder batch enqueued", {
      reminderDate,
      batchSize: recipients.length,
      totalClaimed: claimedCount,
    });
  }

  return claimedCount;
}

async function start() {
  const schedulerConnection = buildRedisConnection();
  const sendConnection = buildRedisConnection();
  const producerConnection = buildRedisConnection();

  const schedulerQueue = new Queue(SCHEDULER_QUEUE_NAME, {
    connection: producerConnection,
  });
  const sendQueue = new Queue(SEND_QUEUE_NAME, {
    connection: producerConnection,
  });

  await registerRepeatableJobs(schedulerQueue);

  const schedulerWorker = new Worker(
    SCHEDULER_QUEUE_NAME,
    async (job) => {
      const reminderDate = getMoscowDateValue();

      if (job.name === JOB_GRANT_DAILY_ATTEMPTS) {
        const result = await grantDailyAttempts(reminderDate);

        logger.info("Daily attempts granted", {
          reminderDate,
          grantedCount: result?.grantedCount || 0,
        });
        return result;
      }

      if (job.name === JOB_DAILY_ATTEMPT_REMINDER) {
        await grantDailyAttempts(reminderDate);
        const queuedCount = await enqueueDailyReminderRecipients(sendQueue, reminderDate);

        logger.info("Daily attempt reminder queued", {
          reminderDate,
          queuedCount,
        });

        return {
          reminderDate,
          queuedCount,
        };
      }

      logger.warn("Unknown scheduler job skipped", {
        jobName: job.name,
      });

      return null;
    },
    {
      connection: schedulerConnection,
      concurrency: 1,
    },
  );

  const sendWorker = new Worker(
    SEND_QUEUE_NAME,
    async (job) => {
      const deliveryId = Number(job.data?.deliveryId) || 0;
      const maxUserId = String(job.data?.maxUserId || "").trim();

      if (!deliveryId || !maxUserId) {
        throw new Error("deliveryId and maxUserId are required");
      }

      const response = await sendDailyAttemptReminder({ maxUserId });
      const messageId = response?.messageId ?? response?.messageIds?.[0] ?? "";

      await markDeliverySent({
        deliveryId,
        messageId,
      });

      logger.info("Daily attempt reminder sent", {
        deliveryId,
        maxUserId,
        messageId,
      });

      return {
        deliveryId,
        messageId,
      };
    },
    {
      connection: sendConnection,
      concurrency: NOTIFICATION_SEND_CONCURRENCY,
      limiter: {
        max: NOTIFICATION_SEND_LIMIT_MAX,
        duration: NOTIFICATION_SEND_LIMIT_DURATION_MS,
      },
    },
  );

  const pushWorker = new Worker(
    PUSH_QUEUE_NAME,
    async (job) => {
      if (job.name === JOB_PUSH_SEND) {
        const pushId = Number(job.data?.pushId) || 0;
        const mode = String(job.data?.mode || "live").trim().toLowerCase() === "test" ? "test" : "live";
        const prepared = await preparePushSend({ pushId, mode });
        const results = await sendPushCampaign({
          recipientIds: prepared.recipients,
          html: prepared.html,
          mediaUrls: prepared.mediaUrls,
          button: prepared.button,
          disablePreview: prepared.disablePreview,
        });
        const finalResult = await finalizePushSend({
          pushId,
          mode,
          results,
        });

        logger.info("Push send completed", {
          pushId,
          mode,
          recipientsCount: results.length,
          deliveredCount: finalResult?.stats?.deliveredCount || 0,
          failedCount: finalResult?.stats?.failedCount || 0,
        });

        return finalResult;
      }

      if (job.name === JOB_PUSH_REVOKE) {
        const pushId = Number(job.data?.pushId) || 0;
        const prepared = await preparePushRevoke({ pushId });
        const results = await revokePushCampaign(prepared.deliveries);
        const finalResult = await finalizePushRevoke({
          pushId,
          results,
        });

        logger.info("Push revoke completed", {
          pushId,
          deliveriesCount: results.length,
          revokedCount: finalResult?.stats?.revokedCount || 0,
          failedCount: finalResult?.stats?.failedCount || 0,
        });

        return finalResult;
      }

      if (job.name === JOB_DAILY_ATTEMPT_REMINDER_BROADCAST_TEST) {
        const prepared = await prepareDailyAttemptReminderBroadcastTest();
        const recipients = Array.isArray(prepared?.recipients) ? prepared.recipients : [];

        if (recipients.length === 0) {
          throw new Error("Нет MAX-пользователей для тестовой reminder-рассылки");
        }

        const results = await sendDailyAttemptReminderCampaign({
          recipientIds: recipients,
        });
        const deliveredCount = results.filter((item) => item?.ok).length;
        const failedCount = results.length - deliveredCount;

        logger.info("Daily attempt reminder broadcast test completed", {
          recipientsCount: results.length,
          deliveredCount,
          failedCount,
        });

        return {
          recipientsCount: results.length,
          deliveredCount,
          failedCount,
        };
      }

      logger.warn("Unknown push job skipped", {
        jobName: job.name,
      });

      return null;
    },
    {
      connection: buildRedisConnection(),
      concurrency: MANUAL_PUSH_JOB_CONCURRENCY,
    },
  );

  sendWorker.on("failed", async (job, error) => {
    const deliveryId = Number(job?.data?.deliveryId) || 0;

    if (deliveryId) {
      await markDeliveryFailed({
        deliveryId,
        errorMessage: error?.message || String(error),
      }).catch((markError) => {
        logger.error("Failed to mark notification delivery failed", {
          deliveryId,
          error: markError?.message || String(markError),
        });
      });
    }

    logger.error("Notification send job failed", {
      jobId: job?.id || null,
      deliveryId,
      attemptsMade: job?.attemptsMade || 0,
      error: error?.message || String(error),
    });
  });

  schedulerWorker.on("failed", (job, error) => {
    logger.error("Scheduler job failed", {
      jobId: job?.id || null,
      jobName: job?.name || null,
      error: error?.message || String(error),
    });
  });

  pushWorker.on("failed", (job, error) => {
    logger.error("Push worker job failed", {
      jobId: job?.id || null,
      jobName: job?.name || null,
      pushId: Number(job?.data?.pushId) || 0,
      error: error?.message || String(error),
    });
  });

  logger.info("Worker started", {
    redisUrl: REDIS_URL,
    schedulerQueue: SCHEDULER_QUEUE_NAME,
    sendQueue: SEND_QUEUE_NAME,
    pushQueue: PUSH_QUEUE_NAME,
    timezone: DAILY_ATTEMPT_TIMEZONE,
    grantCron: DAILY_ATTEMPT_GRANT_CRON,
    reminderCron: DAILY_ATTEMPT_REMINDER_CRON,
  });
}

start().catch((error) => {
  logger.error("Worker failed to start", {
    error: error?.message || String(error),
  });
  process.exit(1);
});
