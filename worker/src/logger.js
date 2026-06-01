function log(level, message, meta = {}) {
  const entry = {
    level,
    message,
    ...meta,
    timestamp: new Date().toISOString(),
  };

  const serialized = JSON.stringify(entry);

  if (level === "error") {
    console.error(serialized);
    return;
  }

  console.log(serialized);
}

export default {
  info(message, meta) {
    log("info", message, meta);
  },
  warn(message, meta) {
    log("warn", message, meta);
  },
  error(message, meta) {
    log("error", message, meta);
  },
};
