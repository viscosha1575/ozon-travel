export const WORKER_QUEUE_NAMES = {
  scheduler: "worker:scheduler",
  notificationSend: "worker:notification-send",
  pushControl: "worker:push-control",
};

export const WORKER_JOB_NAMES = {
  dailyAttemptGrant: "daily-attempt-grant",
  dailyAttemptReminder: "send-daily-attempt-reminder",
  pushSend: "push-send",
  pushRevoke: "push-revoke",
};
