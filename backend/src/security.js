import crypto from "node:crypto";

import cors from "cors";
import IORedis from "ioredis";

const REDIS_URL = String(process.env.REDIS_URL || "redis://redis:6379").trim();
const INTERNAL_API_TOKEN = String(
  process.env.INTERNAL_API_TOKEN
    || process.env.BROADCAST_INTERNAL_TOKEN
    || process.env.REQUEST_BODY_SECRET
    || "",
).trim();
const RATE_LIMIT_REDIS_PREFIX = String(
  process.env.RATE_LIMIT_REDIS_PREFIX || "ozon-travel:rate-limit",
).trim();
const TRUST_PROXY_HOPS = Math.max(
  1,
  Math.round(Number(process.env.TRUST_PROXY_HOPS || 1) || 1),
);
const RATE_LIMIT_HEADERS = [
  "RateLimit-Limit",
  "RateLimit-Remaining",
  "RateLimit-Reset",
  "RateLimit-Policy",
  "Retry-After",
];
const localRateLimitStore = new Map();
let localRateLimitCleanupCounter = 0;
let redisConnection = null;
let redisFailureLogged = false;

function normalizeOrigin(value) {
  try {
    return new URL(String(value || "").trim()).origin.toLowerCase();
  } catch {
    return "";
  }
}

function buildOriginVariants(origin) {
  const normalizedOrigin = normalizeOrigin(origin);

  if (!normalizedOrigin) {
    return [];
  }

  const url = new URL(normalizedOrigin);
  const hostname = String(url.hostname || "").toLowerCase();
  const bareHostname = hostname.replace(/^(www|admin)\./, "");
  const variants = new Set([url.origin]);

  if (bareHostname && bareHostname !== hostname) {
    variants.add(`${url.protocol}//${bareHostname}${url.port ? `:${url.port}` : ""}`);
  }

  if (bareHostname && !/^localhost$|^127\.0\.0\.1$/.test(bareHostname)) {
    variants.add(`${url.protocol}//www.${bareHostname}${url.port ? `:${url.port}` : ""}`);
    variants.add(`${url.protocol}//admin.${bareHostname}${url.port ? `:${url.port}` : ""}`);
  }

  return [...variants];
}

function getAllowedCorsOrigins() {
  const configuredOrigins = [
    process.env.FRONTEND_PUBLIC_URL,
    process.env.BACKEND_PUBLIC_URL,
    ...(String(process.env.CORS_ALLOWED_ORIGINS || "")
      .split(",")
      .map((value) => String(value || "").trim())
      .filter(Boolean)),
    "http://localhost:3001",
    "http://localhost:4173",
    "http://127.0.0.1:3001",
    "http://127.0.0.1:4173",
    "http://0.0.0.0:3001",
    "http://0.0.0.0:4173",
  ];

  return new Set(
    configuredOrigins
      .flatMap((origin) => buildOriginVariants(origin))
      .filter(Boolean),
  );
}

function normalizeRateLimitSubject(req) {
  const platformUserId = String(req.get("x-mini-app-user-id") || "").trim();

  if (platformUserId) {
    return `user:${platformUserId.slice(0, 128)}`;
  }

  const sessionId = String(req.get("x-client-session-id") || "").trim();

  if (sessionId) {
    return `session:${sessionId.slice(0, 128)}`;
  }

  const ip = String(req.ip || req.socket?.remoteAddress || "unknown")
    .trim()
    .replace(/^::ffff:/, "");

  return `ip:${ip || "unknown"}`;
}

function createRateLimitError() {
  const error = new Error("Too many requests");
  error.statusCode = 429;
  error.code = "RATE_LIMITED";
  return error;
}

function createUnauthorizedInternalError() {
  const error = new Error("Unauthorized internal request");
  error.statusCode = 401;
  error.code = "INTERNAL_AUTH_REQUIRED";
  return error;
}

function setRateLimitHeaders(res, { maxRequests, count, windowMs, remainingMs }) {
  const remainingRequests = Math.max(0, maxRequests - count);
  const resetSeconds = Math.max(1, Math.ceil(Math.max(remainingMs, 0) / 1000));
  const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));

  res.set("RateLimit-Limit", String(maxRequests));
  res.set("RateLimit-Remaining", String(remainingRequests));
  res.set("RateLimit-Reset", String(resetSeconds));
  res.set("RateLimit-Policy", `${maxRequests};w=${windowSeconds}`);

  if (count > maxRequests) {
    res.set("Retry-After", String(resetSeconds));
  }
}

function cleanupLocalRateLimitStore(now = Date.now()) {
  localRateLimitCleanupCounter += 1;

  if (localRateLimitCleanupCounter % 200 !== 0) {
    return;
  }

  for (const [key, entry] of localRateLimitStore.entries()) {
    if (!entry || entry.resetAt <= now) {
      localRateLimitStore.delete(key);
    }
  }
}

function incrementLocalRateLimitCounter(key, windowMs) {
  const now = Date.now();
  const existingEntry = localRateLimitStore.get(key);
  const nextEntry = existingEntry && existingEntry.resetAt > now
    ? existingEntry
    : {
      count: 0,
      resetAt: now + windowMs,
    };

  nextEntry.count += 1;
  localRateLimitStore.set(key, nextEntry);
  cleanupLocalRateLimitStore(now);

  return {
    count: nextEntry.count,
    remainingMs: Math.max(0, nextEntry.resetAt - now),
  };
}

function getRedisConnection() {
  if (!REDIS_URL) {
    return null;
  }

  if (!redisConnection) {
    redisConnection = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
      lazyConnect: true,
    });

    redisConnection.on("error", (error) => {
      if (redisFailureLogged) {
        return;
      }

      redisFailureLogged = true;
      console.warn("Rate limit Redis connection error, falling back to local memory store", {
        error: error?.message || String(error),
      });
    });
  }

  return redisConnection;
}

async function incrementRedisRateLimitCounter(key, windowMs) {
  const connection = getRedisConnection();

  if (!connection) {
    throw new Error("Rate limit Redis is not configured");
  }

  if (connection.status === "wait") {
    await connection.connect();
  }

  const results = await connection.multi()
    .incr(key)
    .pttl(key)
    .exec();
  const count = Number(results?.[0]?.[1] || 0);
  let remainingMs = Number(results?.[1]?.[1] || 0);

  if (remainingMs <= 0) {
    await connection.pexpire(key, windowMs);
    remainingMs = windowMs;
  }

  redisFailureLogged = false;

  return {
    count,
    remainingMs,
  };
}

function timingSafeEquals(left, right) {
  const normalizedLeft = String(left || "");
  const normalizedRight = String(right || "");

  if (!normalizedLeft || !normalizedRight || normalizedLeft.length !== normalizedRight.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(normalizedLeft, "utf8"),
    Buffer.from(normalizedRight, "utf8"),
  );
}

export function getTrustProxyHops() {
  return TRUST_PROXY_HOPS;
}

export function createCorsMiddleware() {
  const allowedOrigins = getAllowedCorsOrigins();

  return cors((req, callback) => {
    const requestOrigin = normalizeOrigin(req.header("origin"));
    const isAllowedOrigin = !requestOrigin || allowedOrigins.has(requestOrigin);

    callback(null, {
      origin: isAllowedOrigin,
      credentials: false,
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "X-Client-Session-Id",
        "X-Mini-App-Init-Data",
        "X-Mini-App-Platform",
        "X-Mini-App-User-Id",
        "X-Mini-App-Username",
        "X-Mini-App-First-Name",
        "X-Mini-App-Last-Name",
        "X-Mini-App-Language-Code",
        "X-Telegram-Init-Data",
        "X-Max-Init-Data",
        "X-Broadcast-Token",
        "X-Internal-Token",
      ],
      exposedHeaders: RATE_LIMIT_HEADERS,
      maxAge: 86400,
      optionsSuccessStatus: 204,
    });
  });
}

export function applySecurityHeaders(req, res, next) {
  res.set("Referrer-Policy", "no-referrer");
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "DENY");
  res.set("Permissions-Policy", [
    "accelerometer=()",
    "camera=()",
    "geolocation=()",
    "gyroscope=()",
    "magnetometer=()",
    "microphone=()",
    "payment=()",
    "usb=()",
  ].join(", "));
  res.set(
    "Cross-Origin-Resource-Policy",
    req.path.startsWith("/uploads/") ? "same-site" : "same-origin",
  );

  if (req.secure || String(req.get("x-forwarded-proto") || "").toLowerCase() === "https") {
    res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }

  next();
}

export function createRateLimitMiddleware({
  bucket,
  windowMs,
  maxRequests,
  keyResolver = normalizeRateLimitSubject,
  skip = null,
} = {}) {
  const normalizedBucket = String(bucket || "").trim() || "default";
  const normalizedWindowMs = Math.max(1000, Number(windowMs) || 60000);
  const normalizedMaxRequests = Math.max(1, Number(maxRequests) || 60);

  return async (req, res, next) => {
    if (req.method === "OPTIONS" || skip?.(req) === true) {
      return next();
    }

    const keySuffix = String(keyResolver(req) || "anonymous").slice(0, 256);
    const key = `${RATE_LIMIT_REDIS_PREFIX}:${normalizedBucket}:${keySuffix}`;
    let state;

    try {
      state = await incrementRedisRateLimitCounter(key, normalizedWindowMs);
    } catch {
      state = incrementLocalRateLimitCounter(key, normalizedWindowMs);
    }

    setRateLimitHeaders(res, {
      maxRequests: normalizedMaxRequests,
      count: state.count,
      windowMs: normalizedWindowMs,
      remainingMs: state.remainingMs,
    });

    if (state.count > normalizedMaxRequests) {
      return next(createRateLimitError());
    }

    return next();
  };
}

export function requireInternalApiToken(req, _res, next) {
  if (!INTERNAL_API_TOKEN) {
    const error = createUnauthorizedInternalError();
    error.statusCode = 503;
    error.code = "INTERNAL_AUTH_NOT_CONFIGURED";
    error.message = "Internal API token is not configured";
    next(error);
    return;
  }

  const providedToken = String(req.get("x-internal-token") || "").trim();

  if (!timingSafeEquals(providedToken, INTERNAL_API_TOKEN)) {
    next(createUnauthorizedInternalError());
    return;
  }

  next();
}
