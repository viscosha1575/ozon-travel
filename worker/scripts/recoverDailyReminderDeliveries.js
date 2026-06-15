import { Queue } from "bullmq";
import IORedis from "ioredis";
import { REDIS_URL } from "../src/config.js";
import { markDeliverySent } from "../src/services/backendService.js";
import { WORKER_JOB_NAMES, WORKER_QUEUE_NAMES } from "../src/workerJobs.js";

function getMoscowDateValue(date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function classifyReminderFailure(job) {
  const stacktraceTop = String(job?.stacktrace?.[0] || "");

  if (stacktraceTop.includes("validateDailyAttemptReminderDelivery")) {
    return "validate";
  }

  if (stacktraceTop.includes("markDeliverySent")) {
    return "sent";
  }

  if (stacktraceTop.includes("sendBroadcast")) {
    return "send";
  }

  return "other";
}

async function main() {
  const reminderDate = String(process.argv[2] || getMoscowDateValue()).trim();
  const isDryRun = process.argv.includes("--dry-run");
  const connection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  const queue = new Queue(WORKER_QUEUE_NAMES.notificationSend, {
    connection,
  });
  const totalFailedJobs = Number((await queue.getJobCounts("failed")).failed || 0);
  const summary = {
    reminderDate,
    dryRun: isDryRun,
    retriedValidateJobs: 0,
    acknowledgedSentJobs: 0,
    sendFailuresLeftUntouched: 0,
    otherFailuresLeftUntouched: 0,
  };
  const operations = [];

  for (let start = 0; start < totalFailedJobs; start += 1000) {
    const jobs = await queue.getJobs(["failed"], start, Math.min(totalFailedJobs - 1, start + 999), false);

    for (const job of jobs) {
      if (job.name !== WORKER_JOB_NAMES.dailyAttemptReminder) {
        continue;
      }

      if (String(job.data?.reminderDate || "").trim() !== reminderDate) {
        continue;
      }

      operations.push({
        deliveryId: Number(job.data?.deliveryId || 0),
        failureType: classifyReminderFailure(job),
        jobId: String(job.id || ""),
      });
    }
  }

  for (const operation of operations) {
    const job = operation.jobId ? await queue.getJob(operation.jobId) : null;

    if (!job) {
      continue;
    }

    if (operation.failureType === "validate") {
      summary.retriedValidateJobs += 1;

      if (!isDryRun) {
        await job.retry();
      }

      continue;
    }

    if (operation.failureType === "sent" && operation.deliveryId > 0) {
      summary.acknowledgedSentJobs += 1;

      if (!isDryRun) {
        await markDeliverySent({
          deliveryId: operation.deliveryId,
          messageId: "",
        });
        await job.remove();
      }

      continue;
    }

    if (operation.failureType === "send") {
      summary.sendFailuresLeftUntouched += 1;
      continue;
    }

    summary.otherFailuresLeftUntouched += 1;
  }

  console.log(JSON.stringify(summary, null, 2));

  await queue.close();
  await connection.quit();
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
