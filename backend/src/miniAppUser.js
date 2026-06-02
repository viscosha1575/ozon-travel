import crypto from "crypto";

const MAX_BOT_TOKEN = String(process.env.MAX_BOT_TOKEN || "").trim();
const MAX_INIT_DATA_MAX_AGE_SECONDS = Math.max(
  1,
  Math.round(Number(process.env.MAX_INIT_DATA_MAX_AGE_SECONDS || 60 * 60) || 60 * 60),
);

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
    };
  } catch {
    return null;
  }
}

function parseUniqueEntries(rawValue = "") {
  const source = String(rawValue || "").trim();

  if (!source) {
    return {
      entries: [],
      counts: new Map(),
    };
  }

  const entries = source
    .split("&")
    .filter(Boolean)
    .map((chunk) => {
      const separatorIndex = chunk.indexOf("=");

      if (separatorIndex === -1) {
        return [chunk, ""];
      }

      return [
        chunk.slice(0, separatorIndex),
        chunk.slice(separatorIndex + 1),
      ];
    });
  const counts = new Map();

  for (const [key] of entries) {
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return {
    entries,
    counts,
  };
}

function decodeEntryValue(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
}

function validateMaxInitData(initData = "") {
  const normalizedInitData = String(initData || "").trim();

  if (!normalizedInitData) {
    return {
      valid: false,
      errorCode: "MAX_INIT_DATA_MISSING",
    };
  }

  if (!MAX_BOT_TOKEN) {
    return {
      valid: false,
      errorCode: "MAX_BOT_TOKEN_MISSING",
    };
  }

  const { entries, counts } = parseUniqueEntries(normalizedInitData);
  const hashCount = counts.get("hash") || 0;

  if (hashCount !== 1) {
    return {
      valid: false,
      errorCode: "MAX_INIT_DATA_INVALID_HASH_COUNT",
    };
  }

  if ([...counts.values()].some((count) => count !== 1)) {
    return {
      valid: false,
      errorCode: "MAX_INIT_DATA_DUPLICATE_FIELDS",
    };
  }

  const decodedEntries = entries.map(([key, value]) => [key, decodeEntryValue(value)]);
  const originalHash = decodedEntries.find(([key]) => key === "hash")?.[1] || "";

  if (!originalHash) {
    return {
      valid: false,
      errorCode: "MAX_INIT_DATA_HASH_MISSING",
    };
  }

  const launchParams = decodedEntries
    .filter(([key]) => key !== "hash")
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(MAX_BOT_TOKEN)
    .digest();
  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(launchParams)
    .digest("hex");

  if (calculatedHash.length !== originalHash.length) {
    return {
      valid: false,
      errorCode: "MAX_INIT_DATA_INVALID_SIGNATURE",
    };
  }

  const signaturesMatch = crypto.timingSafeEqual(
    Buffer.from(calculatedHash, "utf8"),
    Buffer.from(originalHash, "utf8"),
  );

  if (!signaturesMatch) {
    return {
      valid: false,
      errorCode: "MAX_INIT_DATA_INVALID_SIGNATURE",
    };
  }

  const parsedParams = new Map(decodedEntries);
  const authDate = Number(parsedParams.get("auth_date") || 0);
  const nowTimestamp = Math.floor(Date.now() / 1000);

  if (!authDate || Number.isNaN(authDate) || nowTimestamp - authDate > MAX_INIT_DATA_MAX_AGE_SECONDS) {
    return {
      valid: false,
      errorCode: "MAX_INIT_DATA_EXPIRED",
    };
  }

  try {
    const user = JSON.parse(parsedParams.get("user") || "null");
    const chat = JSON.parse(parsedParams.get("chat") || "null");

    return {
      valid: true,
      data: {
        user,
        chat,
        authDate,
        startParam: String(parsedParams.get("start_param") || "").trim(),
        queryId: String(parsedParams.get("query_id") || "").trim(),
      },
    };
  } catch {
    return {
      valid: false,
      errorCode: "MAX_INIT_DATA_INVALID_PAYLOAD",
    };
  }
}

function parseUserHeaders(req) {
  const platformUserId = String(req.headers["x-mini-app-user-id"] || "").trim();

  if (!platformUserId) {
    return null;
  }

  return {
    platformUserId,
    username: String(req.headers["x-mini-app-username"] || "").trim(),
    firstName: String(req.headers["x-mini-app-first-name"] || "").trim(),
    lastName: String(req.headers["x-mini-app-last-name"] || "").trim(),
    languageCode: String(req.headers["x-mini-app-language-code"] || "").trim(),
  };
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
  const sessionId = String(req.headers["x-client-session-id"] || "").trim();

  if (platform === "max") {
    const validationResult = validateMaxInitData(headerValue);
    const maxUser = validationResult.valid ? validationResult.data?.user : null;
    const headerUser = parseUserHeaders(req);

    if (maxUser?.id) {
      return {
        externalId: buildPlatformExternalId(platform, maxUser.id),
        platform,
        platformUserId: String(maxUser.id).trim(),
        username: String(maxUser.username || "").trim(),
        firstName: String(maxUser.first_name || "").trim(),
        lastName: String(maxUser.last_name || "").trim(),
        languageCode: String(maxUser.language_code || "").trim(),
        startParam: String(validationResult.data?.startParam || "").trim(),
        sessionId,
        isResolved: true,
      };
    }

    if (headerUser?.platformUserId) {
      return {
        externalId: buildPlatformExternalId(platform, headerUser.platformUserId),
        platform,
        platformUserId: headerUser.platformUserId,
        username: headerUser.username,
        firstName: headerUser.firstName,
        lastName: headerUser.lastName,
        languageCode: headerUser.languageCode,
        startParam: "",
        sessionId,
        isResolved: true,
        usedHeaderFallback: true,
        errorCode: validationResult.errorCode || "MAX_INIT_DATA_INVALID",
      };
    }

    return {
      externalId: "",
      platform: "max",
      platformUserId: "",
      username: "",
      firstName: "",
      lastName: "",
      languageCode: "",
      startParam: "",
      sessionId,
      isResolved: false,
      errorCode: validationResult.errorCode || "MAX_INIT_DATA_INVALID",
    };
  }

  const parsed = parseInitDataString(headerValue) || parseUserHeaders(req);

  if (parsed?.platformUserId) {
    return {
      externalId: buildPlatformExternalId(platform, parsed.platformUserId),
      platform,
      platformUserId: parsed.platformUserId,
      username: parsed.username,
      firstName: parsed.firstName,
      lastName: parsed.lastName,
      languageCode: parsed.languageCode,
      // Referral binding must happen only in the bot start flow.
      startParam: "",
      sessionId,
      isResolved: true,
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
    sessionId,
    isResolved: true,
  };
}
