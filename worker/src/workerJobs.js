export const WORKER_QUEUE_NAMES = {
  scheduler: "worker_scheduler",
  notificationSend: "worker_notification_send",
  pushControl: "worker_push_control",
};

export const WORKER_JOB_NAMES = {
  dailyAttemptGrant: "daily-attempt-grant",
  dailyAttemptReminder: "send-daily-attempt-reminder",
  dailyAttemptReminderBroadcastTest: "send-daily-attempt-reminder-broadcast-test",
  pushSend: "push-send",
  pushRevoke: "push-revoke",
};
