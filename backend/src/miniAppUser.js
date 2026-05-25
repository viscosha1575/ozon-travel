function parseInitDataString(initData = "") {
  const params = new URLSearchParams(String(initData || ""));
  const rawUser = params.get("user");

  if (!rawUser) {
    return null;
  }

  try {
    const user = JSON.parse(rawUser);

    return {
      platformUserId: String(user.id || "").trim(),
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

function normalizePlatform(value) {
  const platform = String(value || "").trim().toLowerCase();

  if (platform === "max") {
    return "max";
  }

  return "telegram";
}

function buildPlatformExternalId(platform, platformUserId) {
  const normalizedPlatform = normalizePlatform(platform);
  const normalizedPlatformUserId = String(platformUserId || "").trim();

  if (!normalizedPlatformUserId) {
    return "";
  }

  if (normalizedPlatform === "telegram") {
    return normalizedPlatformUserId;
  }

  return `${normalizedPlatform}:${normalizedPlatformUserId}`;
}

function resolveInitDataHeader(req) {
  return String(
    req.headers["x-mini-app-init-data"]
      || req.headers["x-telegram-init-data"]
      || req.headers["x-max-init-data"]
      || "",
  ).trim();
}

function resolvePlatform(req) {
  const explicitPlatform = normalizePlatform(req.headers["x-mini-app-platform"]);

  if (explicitPlatform === "max") {
    return "max";
  }

  if (req.headers["x-max-init-data"]) {
    return "max";
  }

  return "telegram";
}

export function resolveMiniAppUser(req) {
  const platform = resolvePlatform(req);
  const headerValue = resolveInitDataHeader(req);
  const parsed = parseInitDataString(headerValue);

  if (parsed?.platformUserId) {
    return {
      externalId: buildPlatformExternalId(platform, parsed.platformUserId),
      platform,
      platformUserId: parsed.platformUserId,
      username: parsed.username,
      firstName: parsed.firstName,
      lastName: parsed.lastName,
      languageCode: parsed.languageCode,
      startParam: parsed.startParam,
      sessionId: String(req.headers["x-client-session-id"] || "").trim(),
    };
  }

  return {
    externalId: "local-demo-user",
    platform: "telegram",
    platformUserId: "local-demo-user",
    username: "local_player",
    firstName: "Local",
    lastName: "Player",
    languageCode: "ru",
    startParam: "",
    sessionId: String(req.headers["x-client-session-id"] || "").trim(),
  };
}
