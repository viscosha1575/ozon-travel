import { Queue, QueueEvents } from "bullmq";
import IORedis from "ioredis";

import { WORKER_JOB_NAMES, WORKER_QUEUE_NAMES } from "../../shared/workerJobs.js";

const REDIS_URL = String(process.env.REDIS_URL || "redis://redis:6379").trim();
const TEST_PUSH_WAIT_TIMEOUT_MS = Math.max(
  10000,
  Number(process.env.TEST_PUSH_WAIT_TIMEOUT_MS || 120000) || 120000,
);

let redisConnection = null;
let pushQueue = null;
let pushQueueEvents = null;

function getRedisConnection() {
  if (!redisConnection) {
    redisConnection = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }

  return redisConnection;
}

function getPushQueue() {
  if (!pushQueue) {
    pushQueue = new Queue(WORKER_QUEUE_NAMES.pushControl, {
      connection: getRedisConnection(),
    });
  }

  return pushQueue;
}

function getPushQueueEvents() {
  if (!pushQueueEvents) {
    pushQueueEvents = new QueueEvents(WORKER_QUEUE_NAMES.pushControl, {
      connection: getRedisConnection(),
    });
  }

  return pushQueueEvents;
}

export async function enqueuePushSendJob({ pushId, mode, waitUntilFinished = false }) {
  const normalizedMode = String(mode || "live").trim().toLowerCase() === "test" ? "test" : "live";
  const queue = getPushQueue();
  const job = await queue.add(
    WORKER_JOB_NAMES.pushSend,
    {
      pushId: Number(pushId) || 0,
      mode: normalizedMode,
    },
    {
      jobId: `push-send:${normalizedMode}:${Number(pushId) || 0}`,
      removeOnComplete: normalizedMode === "test" ? 10 : true,
      removeOnFail: 100,
      attempts: 1,
    },
  );

  if (!waitUntilFinished) {
    return { jobId: job.id };
  }

  const queueEvents = getPushQueueEvents();
  await queueEvents.waitUntilReady();
  return job.waitUntilFinished(queueEvents, TEST_PUSH_WAIT_TIMEOUT_MS);
}

export async function enqueuePushRevokeJob({ pushId }) {
  const queue = getPushQueue();
  const job = await queue.add(
    WORKER_JOB_NAMES.pushRevoke,
    {
      pushId: Number(pushId) || 0,
    },
    {
      jobId: `push-revoke:${Number(pushId) || 0}`,
      removeOnComplete: true,
      removeOnFail: 100,
      attempts: 1,
    },
  );

  return { jobId: job.id };
}
