function parseInitDataString(initData = "") {
  const params = new URLSearchParams(String(initData || ""));
  const rawUser = params.get("user");

  if (!rawUser) {
    return null;
  }

  try {
    const user = JSON.parse(rawUser);

    return {
      externalId: String(user.id || "").trim(),
      username: String(user.username || "").trim(),
      firstName: String(user.first_name || "").trim(),
      lastName: String(user.last_name || "").trim(),
      languageCode: String(user.language_code || "").trim(),
      startParam: String(params.get("start_param") || "").trim(),
    };
  } catch {
    return null;
  }
}

export function resolveTelegramUser(req) {
  const headerValue = req.headers["x-telegram-init-data"];
  const parsed = parseInitDataString(headerValue);

  if (parsed?.externalId) {
    return {
      ...parsed,
      sessionId: String(req.headers["x-client-session-id"] || "").trim(),
    };
  }

  return {
    externalId: "local-demo-user",
    username: "local_player",
    firstName: "Local",
    lastName: "Player",
    languageCode: "ru",
    startParam: "",
    sessionId: String(req.headers["x-client-session-id"] || "").trim(),
  };
}
