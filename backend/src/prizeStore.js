import { query, withTransaction } from "./db.js";
import { logGameEvent } from "./analyticsStore.js";
import {
  deleteManagedImage,
  normalizeStoredImage,
  storeRouletteImage,
} from "./imageStorage.js";
import {
  consumeUserAttempt,
  ensureDailyAttemptGrant,
  getOrCreateUser,
  getReferralData,
  getUserAttemptSummary,
  grantPrizeAttempts,
} from "./userStore.js";
import { getProjectState } from "./appStateStore.js";

const APP_TIMEZONE = String(process.env.APP_TIMEZONE || "Europe/Belgrade").trim() || "Europe/Belgrade";
const PRIZE_CATEGORIES = new Set([
  "Отели",
  "Авиа",
  "Баллы Ozon",
  "Мили",
  "Тур",
  "Доп. попытки",
]);
const EXTRA_ATTEMPTS_PRIZE_CATEGORY = "Доп. попытки";
const EXTRA_ATTEMPTS_PRIZE_COUNT = 3;
const PROMO_CODE_FREE_PRIZE_CATEGORIES = new Set(["Тур", EXTRA_ATTEMPTS_PRIZE_CATEGORY]);
const ALWAYS_LIMITED_PRIZE_CATEGORIES = new Set(["Тур"]);

function normalizeSearch(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeMultilineText(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function normalizeRouletteDescriptions(value) {
  return Array.from(
    new Set(
      Array.isArray(value)
        ? value.map((item) => normalizeMultilineText(item)).filter(Boolean)
        : [],
    ),
  );
}

function collectPrizeDescriptionOptions(prize = {}) {
  const variants = normalizeRouletteDescriptions(prize.rouletteDescriptions);
  const fallbackDescription = normalizeMultilineText(prize.rouletteDescription);

  if (fallbackDescription && !variants.includes(fallbackDescription)) {
    variants.unshift(fallbackDescription);
  }

  return variants;
}

function collectEffectivePrizeDescriptions(prize = {}) {
  const variants = normalizeRouletteDescriptions(prize.rouletteDescriptions);

  if (variants.length) {
    return variants;
  }

  const fallbackDescription = normalizeMultilineText(prize.rouletteDescription);

  return fallbackDescription ? [fallbackDescription] : [];
}

function pickRandomItem(items = []) {
  if (!Array.isArray(items) || !items.length) {
    return "";
  }

  const index = Math.floor(Math.random() * items.length);

  return items[index] || items[0] || "";
}

function parseChanceWeight(value) {
  const normalized = String(value || "").trim().replace(",", ".").replace(/x$/i, "");
  const parsed = Number(normalized);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  return parsed;
}

function formatDateLabel(value) {
  if (!value) {
    return "";
  }

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return `до ${date.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  })}`;
}

function formatChanceValue(weight) {
  const parsedWeight = Number(weight);

  if (!Number.isFinite(parsedWeight) || parsedWeight <= 0) {
    return "1x";
  }

  const normalizedWeight = Number.isInteger(parsedWeight)
    ? String(parsedWeight)
    : String(Number(parsedWeight.toFixed(3)));

  return `${normalizedWeight}x`;
}

function getTodayValue() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function formatDateTimeInputValue(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function parseOptionalDateTime(value, fieldName) {
  const normalizedValue = String(value || "").trim();

  if (!normalizedValue) {
    return null;
  }

  const parsedDate = new Date(normalizedValue);

  if (Number.isNaN(parsedDate.getTime())) {
    throw new Error(`${fieldName} has invalid datetime value`);
  }

  return parsedDate.toISOString();
}

function formatDateTimeLabel(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildPromoCodeSchedule(codes, releaseStart, releaseEnd) {
  const normalizedCodes = Array.from(
    new Set(
      Array.isArray(codes)
        ? codes.map((item) => String(item || "").trim()).filter(Boolean)
        : [],
    ),
  );

  if (!normalizedCodes.length) {
    return [];
  }

  const now = new Date();
  const startDate = releaseStart ? new Date(releaseStart) : now;
  const safeStartDate = Number.isNaN(startDate.getTime()) ? now : startDate;
  const endCandidate = releaseEnd ? new Date(releaseEnd) : safeStartDate;
  const safeEndDate = Number.isNaN(endCandidate.getTime()) || endCandidate.getTime() < safeStartDate.getTime()
    ? safeStartDate
    : endCandidate;

  if (normalizedCodes.length === 1 || safeStartDate.getTime() === safeEndDate.getTime()) {
    return normalizedCodes.map((code) => ({
      code,
      availableFrom: safeStartDate.toISOString(),
    }));
  }

  const stepMs = (safeEndDate.getTime() - safeStartDate.getTime()) / (normalizedCodes.length - 1);

  return normalizedCodes.map((code, index) => ({
    code,
    availableFrom: new Date(safeStartDate.getTime() + stepMs * index).toISOString(),
  }));
}

function requiresPromoCodePool(prize) {
  return prize.type === "Приз" && prize.hasPrizeLimit && Array.isArray(prize.promoCodes) && prize.promoCodes.length > 0;
}

function mapPrizeRow(row) {
  const rouletteDescriptions = normalizeRouletteDescriptions(row.roulette_descriptions);

  return {
    id: Number(row.id),
    title: row.title,
    category: row.category,
    promoCodeType: row.promo_code_type,
    type: row.type,
    hasPrizeLimit: row.has_prize_limit,
    promoCodesFileName: row.promo_codes_file_name,
    promoCodes: Array.isArray(row.promo_codes) ? row.promo_codes : [],
    promoCodeValue: row.promo_code_value,
    sortOrder: Number(row.sort_order || 0),
    totalCount: Number(row.total_count || 0),
    remainingCount: Number(row.remaining_count || 0),
    chanceValue: row.chance_value,
    hasUserLimit: row.has_user_limit,
    userLimitCount: Number(row.user_limit_count || 0),
    isEnabled: Boolean(row.is_enabled),
    activeFrom: row.active_from
      ? new Date(row.active_from).toISOString().slice(0, 10)
      : "",
    activeTo: row.active_to
      ? new Date(row.active_to).toISOString().slice(0, 10)
      : "",
    codeReleaseStart: formatDateTimeInputValue(row.code_release_start),
    codeReleaseEnd: formatDateTimeInputValue(row.code_release_end),
    rouletteImage: normalizeStoredImage(row.roulette_image),
    myPrizeText: row.my_prize_text,
    rouletteDescription: row.roulette_description,
    rouletteDescriptions,
    availablePromoCodesCount: Number(row.available_promo_codes_count || 0),
    unavailablePromoCodesCount: Number(row.unavailable_promo_codes_count || 0),
    claimedPromoCodesCount: Number(row.claimed_promo_codes_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getPrizeDropCountByPrizeId(executor = { query }) {
  const [dropCountResult, awardedPrizeCountResult] = await Promise.all([
    executor.query(
      `
        SELECT
          (details ->> 'positionId')::bigint AS prize_id,
          COUNT(*)::int AS drop_count
        FROM game_event_logs
        WHERE event_name = 'spin_result'
          AND COALESCE(details ->> 'positionId', '') ~ '^[0-9]+$'
        GROUP BY 1
      `,
    ),
    executor.query(
      `
        SELECT prize_id, COUNT(*)::int AS awarded_count
        FROM awarded_prizes
        WHERE prize_id IS NOT NULL
        GROUP BY prize_id
      `,
    ),
  ]);

  const dropCountByPrizeId = new Map(
    dropCountResult.rows.map((row) => [Number(row.prize_id), Number(row.drop_count || 0)]),
  );
  const awardedPrizeCountByPrizeId = new Map(
    awardedPrizeCountResult.rows.map((row) => [Number(row.prize_id), Number(row.awarded_count || 0)]),
  );

  return {
    get(prizeId, prize = null) {
      const fallbackCount = prize?.hasPrizeLimit
        ? Math.max(0, Number(prize.totalCount || 0) - Number(prize.remainingCount || 0))
        : 0;

      return Math.max(
        Number(dropCountByPrizeId.get(Number(prizeId)) || 0),
        Number(awardedPrizeCountByPrizeId.get(Number(prizeId)) || 0),
        fallbackCount,
      );
    },
  };
}

async function getAllPrizes(client = null) {
  const executor = client || { query };
  const result = await executor.query(`
    SELECT
      id,
      title,
      category,
      promo_code_type,
      type,
      has_prize_limit,
      promo_codes_file_name,
      promo_codes,
      promo_code_value,
      sort_order,
      total_count,
      remaining_count,
      chance_value,
      has_user_limit,
      user_limit_count,
      is_enabled,
      active_from,
      active_to,
      code_release_start,
      code_release_end,
      roulette_image,
      my_prize_text,
      roulette_description,
      roulette_descriptions,
      COALESCE(pool.available_promo_codes_count, 0) AS available_promo_codes_count,
      COALESCE(pool.unavailable_promo_codes_count, 0) AS unavailable_promo_codes_count,
      COALESCE(pool.claimed_promo_codes_count, 0) AS claimed_promo_codes_count,
      created_at,
      updated_at
    FROM prize_positions
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (
          WHERE claimed_at IS NULL
            AND COALESCE(available_from, NOW()) <= NOW()
        )::int AS available_promo_codes_count,
        COUNT(*) FILTER (
          WHERE claimed_at IS NULL
            AND COALESCE(available_from, NOW()) > NOW()
        )::int AS unavailable_promo_codes_count,
        COUNT(*) FILTER (
          WHERE claimed_at IS NOT NULL
        )::int AS claimed_promo_codes_count
      FROM prize_promo_codes
      WHERE prize_id = prize_positions.id
    ) AS pool ON TRUE
  `);

  return result.rows.map(mapPrizeRow);
}

export async function listPrizes(payload = {}) {
  const search = normalizeSearch(payload.search);
  const categoryFilter = String(payload.category || "").trim();
  const promoCodeTypeFilter = String(payload.promoCodeType || "").trim();
  const allItems = await getAllPrizes();
  const prizeDropCountByPrizeId = await getPrizeDropCountByPrizeId({ query });
  let items = allItems;
  const projectState = await getProjectState();
  const nonPrizeDescriptionOptions = Array.from(
    new Set(
      allItems
        .filter((item) => item.type === "Не приз")
        .flatMap((item) => collectPrizeDescriptionOptions(item)),
    ),
  );

  if (search) {
    items = items.filter((item) => {
      const haystack = [
        item.title,
        item.type,
        item.category,
        item.promoCodeType,
        item.promoCodeValue,
        item.myPrizeText,
        ...collectPrizeDescriptionOptions(item),
      ].join(" ").toLowerCase();

      return haystack.includes(search);
    });
  }

  if (categoryFilter) {
    items = items.filter((item) => String(item.category || "").trim() === categoryFilter);
  }

  if (promoCodeTypeFilter) {
    items = items.filter((item) => String(item.promoCodeType || "").trim() === promoCodeTypeFilter);
  }

  items.sort((left, right) => {
    const orderDelta = Number(left.sortOrder || 0) - Number(right.sortOrder || 0);

    if (orderDelta !== 0) {
      return orderDelta;
    }

    const titleDelta = String(left.title || "").localeCompare(String(right.title || ""), "ru");

    if (titleDelta !== 0) {
      return titleDelta;
    }

    return Number(left.id || 0) - Number(right.id || 0);
  });

  const awardedPrizeStats = allItems
    .map((item) => ({
      prizeId: Number(item.id),
      title: String(item.myPrizeText || item.title || "").trim() || `Приз #${item.id}`,
      type: String(item.type || "").trim(),
      sortOrder: Number(item.sortOrder || 0),
      awardedCount: prizeDropCountByPrizeId.get(item.id, item),
    }))
    .filter((item) => item.awardedCount > 0);
  awardedPrizeStats.sort((left, right) => {
    const countDelta = Number(right.awardedCount || 0) - Number(left.awardedCount || 0);

    if (countDelta !== 0) {
      return countDelta;
    }

    const orderDelta = Number(left.sortOrder || 0) - Number(right.sortOrder || 0);

    if (orderDelta !== 0) {
      return orderDelta;
    }

    return Number(left.prizeId || 0) - Number(right.prizeId || 0);
  });

  return {
    items,
    nonPrizeDescriptionOptions,
    projectFinished: projectState.projectFinished,
    awardedPrizeStats,
    summary: {
      totalPrizesCount: items.length,
      totalUnitsCount: items.reduce((sum, item) => sum + Number(item.totalCount || 0), 0),
      totalRemainingCount: items.reduce((sum, item) => sum + Number(item.remainingCount || 0), 0),
      totalAwardedCount: awardedPrizeStats.reduce((sum, item) => sum + Number(item.awardedCount || 0), 0),
    },
  };
}

function validatePrizePayload(payload = {}) {
  const title = String(payload.title || "").trim();
  const type = String(payload.type || "").trim();
  const category = String(payload.category || "").trim();
  const isPromoCodeFreePrize = type !== "Не приз" && PROMO_CODE_FREE_PRIZE_CATEGORIES.has(category);
  const promoCodeType = String(payload.promoCodeType || "").trim();
  const hasPrizeLimit = ALWAYS_LIMITED_PRIZE_CATEGORIES.has(category) || Boolean(payload.hasPrizeLimit);
  const promoCodesFileName = String(payload.promoCodesFileName || "").trim();
  const promoCodes = Array.isArray(payload.promoCodes)
    ? payload.promoCodes.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const promoCodeValue = String(payload.promoCodeValue || "").trim();
  const totalCount = hasPrizeLimit ? Math.max(0, Number(payload.totalCount) || 0) : 0;
  const chanceValue = String(payload.chanceValue || "1x").trim() || "1x";
  const hasUserLimit = Boolean(payload.hasUserLimit);
  const userLimitCount = hasUserLimit ? Math.max(0, Number(payload.userLimitCount) || 0) : 0;
  const activeFrom = String(payload.activeFrom || "").trim() || null;
  const activeTo = String(payload.activeTo || "").trim() || null;
  const codeReleaseStart = isPromoCodeFreePrize
    ? null
    : parseOptionalDateTime(payload.codeReleaseStart, "codeReleaseStart");
  const codeReleaseEnd = isPromoCodeFreePrize
    ? null
    : parseOptionalDateTime(payload.codeReleaseEnd, "codeReleaseEnd");
  const rouletteImage = payload.rouletteImage ?? null;
  const myPrizeText = normalizeMultilineText(payload.myPrizeText);
  const incomingRouletteDescription = normalizeMultilineText(payload.rouletteDescription);
  const rouletteDescriptions = normalizeRouletteDescriptions(payload.rouletteDescriptions);
  const rouletteDescription = incomingRouletteDescription || rouletteDescriptions[0] || "";

  if (!title) {
    throw new Error("Prize title is required");
  }

  if (!type) {
    throw new Error("Prize type is required");
  }

  if (type !== "Не приз" && !category) {
    throw new Error("Prize category is required");
  }

  if (type !== "Не приз" && !PRIZE_CATEGORIES.has(category)) {
    const error = new Error("Unsupported prize category");
    error.statusCode = 400;
    throw error;
  }

  if (hasPrizeLimit && !totalCount) {
    throw new Error("Prize total count is required");
  }

  if (hasUserLimit && !userLimitCount) {
    throw new Error("Prize user limit count is required");
  }

  if (!rouletteDescription && !rouletteDescriptions.length) {
    throw new Error("Prize roulette description is required");
  }

  return {
    title,
    category: type === "Не приз" ? "" : category,
    promoCodeType: type === "Не приз" || isPromoCodeFreePrize ? "" : promoCodeType,
    type,
    hasPrizeLimit: type === "Не приз" ? false : hasPrizeLimit,
    promoCodesFileName: type === "Не приз" || isPromoCodeFreePrize ? "" : promoCodesFileName,
    promoCodes: type === "Не приз" || isPromoCodeFreePrize ? [] : promoCodes,
    promoCodeValue: type === "Не приз" || isPromoCodeFreePrize ? "" : promoCodeValue,
    totalCount: type === "Не приз" ? 0 : totalCount,
    chanceValue,
    hasUserLimit: type === "Не приз" ? false : hasUserLimit,
    userLimitCount: type === "Не приз" ? 0 : userLimitCount,
    activeFrom,
    activeTo,
    codeReleaseStart: type === "Не приз" || isPromoCodeFreePrize ? null : codeReleaseStart,
    codeReleaseEnd: type === "Не приз" || isPromoCodeFreePrize ? null : codeReleaseEnd,
    rouletteImage,
    myPrizeText: type === "Не приз" ? title : myPrizeText,
    rouletteDescription,
    rouletteDescriptions: type === "Не приз" ? rouletteDescriptions : [],
  };
}

async function syncPrizePromoCodePool(client, prizeId, prize) {
  const claimedResult = await client.query(
    `
      SELECT code
      FROM prize_promo_codes
      WHERE prize_id = $1
        AND claimed_at IS NOT NULL
    `,
    [prizeId],
  );
  const claimedCodes = new Set(
    claimedResult.rows.map((row) => String(row.code || "").trim()).filter(Boolean),
  );

  await client.query(
    `
      DELETE FROM prize_promo_codes
      WHERE prize_id = $1
        AND claimed_at IS NULL
    `,
    [prizeId],
  );

  const scheduledPromoCodes = buildPromoCodeSchedule(
    (prize.promoCodes || []).filter((code) => !claimedCodes.has(String(code || "").trim())),
    prize.codeReleaseStart,
    prize.codeReleaseEnd,
  );

  if (scheduledPromoCodes.length) {
    await client.query(
      `
        INSERT INTO prize_promo_codes (
          prize_id,
          code,
          available_from
        )
        SELECT
          $1,
          item.code,
          item.available_from::timestamptz
        FROM UNNEST($2::text[], $3::text[]) AS item(code, available_from)
        ON CONFLICT (prize_id, code) DO NOTHING
      `,
      [
        prizeId,
        scheduledPromoCodes.map((item) => item.code),
        scheduledPromoCodes.map((item) => item.availableFrom),
      ],
    );
  }

  return {
    totalCount: claimedCodes.size + scheduledPromoCodes.length,
    remainingCount: scheduledPromoCodes.length,
  };
}

async function recalculatePromoPoolCounts(client, prizeId) {
  const countResult = await client.query(
    `
      SELECT
        COUNT(*)::int AS total_count,
        COUNT(*) FILTER (WHERE claimed_at IS NULL)::int AS remaining_count
      FROM prize_promo_codes
      WHERE prize_id = $1
    `,
    [prizeId],
  );

  return {
    totalCount: Number(countResult.rows[0]?.total_count || 0),
    remainingCount: Number(countResult.rows[0]?.remaining_count || 0),
  };
}

export async function createPrize(payload = {}) {
  const nextPrize = validatePrizePayload(payload);
  const nextIdResult = await query("SELECT COALESCE(MAX(id), 0) + 1 AS id FROM prize_positions");
  const id = Number(nextIdResult.rows[0]?.id || 1);
  const nextSortOrderResult = await query("SELECT COALESCE(MAX(sort_order), 0) + 1 AS sort_order FROM prize_positions");
  const sortOrder = Number(nextSortOrderResult.rows[0]?.sort_order || 1);
  let uploadedImage = null;

  try {
    const imageResult = await storeRouletteImage(nextPrize.rouletteImage);
    nextPrize.rouletteImage = imageResult.image;
    uploadedImage = imageResult.uploadedImage;

    await withTransaction(async (client) => {
      await client.query(
        `
          INSERT INTO prize_positions (
            id,
            title,
            category,
            promo_code_type,
            type,
            has_prize_limit,
            promo_codes_file_name,
            promo_codes,
            promo_code_value,
            sort_order,
            total_count,
            remaining_count,
            chance_value,
            has_user_limit,
            user_limit_count,
            is_enabled,
            active_from,
            active_to,
            code_release_start,
            code_release_end,
            roulette_image,
            my_prize_text,
            roulette_description,
            roulette_descriptions,
            updated_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21::jsonb, $22, $23, $24::jsonb, NOW()
          )
        `,
        [
          id,
          nextPrize.title,
          nextPrize.category,
          nextPrize.promoCodeType,
          nextPrize.type,
          nextPrize.hasPrizeLimit,
          nextPrize.promoCodesFileName,
          JSON.stringify(nextPrize.promoCodes),
          nextPrize.promoCodeValue,
          sortOrder,
          0,
          0,
          nextPrize.chanceValue,
          nextPrize.hasUserLimit,
          nextPrize.userLimitCount,
          true,
          nextPrize.activeFrom,
          nextPrize.activeTo,
          nextPrize.codeReleaseStart,
          nextPrize.codeReleaseEnd,
          nextPrize.rouletteImage ? JSON.stringify(nextPrize.rouletteImage) : null,
          nextPrize.myPrizeText,
          nextPrize.rouletteDescription,
          JSON.stringify(nextPrize.rouletteDescriptions),
        ],
      );

      const syncedPromoPool = requiresPromoCodePool(nextPrize)
        ? await syncPrizePromoCodePool(client, id, nextPrize)
        : { totalCount: nextPrize.totalCount, remainingCount: nextPrize.hasPrizeLimit ? nextPrize.totalCount : 0 };

      await client.query(
        `
          UPDATE prize_positions
          SET
            total_count = $2,
            remaining_count = $3,
            updated_at = NOW()
          WHERE id = $1
        `,
        [id, syncedPromoPool.totalCount, syncedPromoPool.remainingCount],
      );
    });

    const items = await getAllPrizes();
    const prize = items.find((item) => item.id === id);

    return {
      created: true,
      prize,
    };
  } catch (error) {
    if (uploadedImage) {
      await deleteManagedImage(uploadedImage).catch(() => {});
    }

    throw error;
  }
}

export async function updatePrize(payload = {}) {
  const id = Number(payload.id);

  if (!id) {
    throw new Error("Prize id is required");
  }

  const nextPrize = validatePrizePayload(payload);
  let uploadedImage = null;
  let previousImageToCleanup = null;

  try {
    await withTransaction(async (client) => {
      const currentRows = await client.query(
        "SELECT total_count, remaining_count, roulette_image FROM prize_positions WHERE id = $1 FOR UPDATE",
        [id],
      );

      if (!currentRows.rows.length) {
        throw new Error("Prize not found");
      }

      const currentPrize = currentRows.rows[0];
      const usedCount = Math.max(0, Number(currentPrize.total_count || 0) - Number(currentPrize.remaining_count || 0));
      const imageResult = await storeRouletteImage(nextPrize.rouletteImage, currentPrize.roulette_image || null);

      nextPrize.rouletteImage = imageResult.image;
      uploadedImage = imageResult.uploadedImage;
      previousImageToCleanup = imageResult.cleanupImage;

      const syncedPromoPool = requiresPromoCodePool(nextPrize)
        ? await syncPrizePromoCodePool(client, id, nextPrize)
        : {
          totalCount: nextPrize.totalCount,
          remainingCount: nextPrize.hasPrizeLimit
            ? Math.max(0, nextPrize.totalCount - usedCount)
            : 0,
        };

      await client.query(
        `
          UPDATE prize_positions
          SET
            title = $2,
            category = $3,
            promo_code_type = $4,
            type = $5,
            has_prize_limit = $6,
            promo_codes_file_name = $7,
            promo_codes = $8::jsonb,
            promo_code_value = $9,
            total_count = $10,
            remaining_count = $11,
            chance_value = $12,
            has_user_limit = $13,
            user_limit_count = $14,
            active_from = $15,
            active_to = $16,
            code_release_start = $17,
            code_release_end = $18,
            roulette_image = $19::jsonb,
            my_prize_text = $20,
            roulette_description = $21,
            roulette_descriptions = $22::jsonb,
            updated_at = NOW()
          WHERE id = $1
        `,
        [
          id,
          nextPrize.title,
          nextPrize.category,
          nextPrize.promoCodeType,
          nextPrize.type,
          nextPrize.hasPrizeLimit,
          nextPrize.promoCodesFileName,
          JSON.stringify(nextPrize.promoCodes),
          nextPrize.promoCodeValue,
          syncedPromoPool.totalCount,
          syncedPromoPool.remainingCount,
          nextPrize.chanceValue,
          nextPrize.hasUserLimit,
          nextPrize.userLimitCount,
          nextPrize.activeFrom,
          nextPrize.activeTo,
          nextPrize.codeReleaseStart,
          nextPrize.codeReleaseEnd,
          nextPrize.rouletteImage ? JSON.stringify(nextPrize.rouletteImage) : null,
          nextPrize.myPrizeText,
          nextPrize.rouletteDescription,
          JSON.stringify(nextPrize.rouletteDescriptions),
        ],
      );
    });
  } catch (error) {
    if (uploadedImage) {
      await deleteManagedImage(uploadedImage).catch(() => {});
    }

    throw error;
  }

  if (previousImageToCleanup) {
    await deleteManagedImage(previousImageToCleanup).catch((error) => {
      console.error("Failed to delete stale image", error);
    });
  }

  const items = await getAllPrizes();
  const prize = items.find((item) => item.id === id);

  return {
    updated: true,
    prize,
  };
}

export async function reorderPrizes(payload = {}) {
  const ids = Array.isArray(payload.ids)
    ? payload.ids.map((item) => Number(item) || 0).filter((item) => item > 0)
    : [];

  if (!ids.length) {
    throw new Error("Prize ids are required");
  }

  await withTransaction(async (client) => {
    const existingRows = await client.query(
      `
        SELECT id
        FROM prize_positions
        ORDER BY sort_order ASC, id ASC
      `,
    );
    const existingIds = existingRows.rows.map((row) => Number(row.id)).filter((item) => item > 0);
    const missingIds = existingIds.filter((id) => !ids.includes(id));
    const nextOrderedIds = ids.concat(missingIds);

    if (nextOrderedIds.length !== existingIds.length) {
      throw new Error("Prize order payload is invalid");
    }

    for (let index = 0; index < nextOrderedIds.length; index += 1) {
      await client.query(
        `
          UPDATE prize_positions
          SET sort_order = $2, updated_at = NOW()
          WHERE id = $1
        `,
        [nextOrderedIds[index], index + 1],
      );
    }
  });

  const response = await listPrizes({});

  return {
    updated: true,
    items: response.items,
  };
}

export async function clearPrizePromoCodes(payload = {}) {
  const id = Number(payload.id);

  if (!id) {
    throw new Error("Prize id is required");
  }

  await withTransaction(async (client) => {
    const prizeResult = await client.query(
      "SELECT id FROM prize_positions WHERE id = $1 FOR UPDATE",
      [id],
    );

    if (!prizeResult.rowCount) {
      throw new Error("Prize not found");
    }

    await client.query(
      "DELETE FROM prize_promo_codes WHERE prize_id = $1",
      [id],
    );

    await client.query(
      `
        UPDATE prize_positions
        SET
          promo_codes_file_name = '',
          promo_codes = '[]'::jsonb,
          total_count = 0,
          remaining_count = 0,
          code_release_start = NULL,
          code_release_end = NULL,
          updated_at = NOW()
        WHERE id = $1
      `,
      [id],
    );
  });

  const items = await getAllPrizes();
  const prize = items.find((item) => item.id === id);

  return {
    updated: true,
    prize,
  };
}

export async function appendPrizePromoCodes(payload = {}) {
  const id = Number(payload.id);
  const promoCodesFileName = String(payload.promoCodesFileName || "").trim();
  const incomingPromoCodes = Array.isArray(payload.promoCodes)
    ? payload.promoCodes.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const codeReleaseStart = parseOptionalDateTime(payload.codeReleaseStart, "codeReleaseStart");
  const codeReleaseEnd = parseOptionalDateTime(payload.codeReleaseEnd, "codeReleaseEnd");

  if (!id) {
    throw new Error("Prize id is required");
  }

  if (!incomingPromoCodes.length) {
    throw new Error("Promo codes are required");
  }

  await withTransaction(async (client) => {
    const prizeResult = await client.query(
      `
        SELECT
          id,
          type,
          has_prize_limit,
          promo_codes,
          promo_codes_file_name
        FROM prize_positions
        WHERE id = $1
        FOR UPDATE
      `,
      [id],
    );
    const prizeRow = prizeResult.rows[0];

    if (!prizeRow) {
      throw new Error("Prize not found");
    }

    if (String(prizeRow.type || "").trim() !== "Приз" || !Boolean(prizeRow.has_prize_limit)) {
      throw new Error("Promo code pool is available only for limited prize positions");
    }

    const poolRowsResult = await client.query(
      `
        SELECT id, code, available_from, claimed_at
        FROM prize_promo_codes
        WHERE prize_id = $1
        ORDER BY available_from ASC NULLS FIRST, id ASC
      `,
      [id],
    );

    const now = Date.now();
    const claimedRows = [];
    const availableRows = [];
    const futureRows = [];

    for (const row of poolRowsResult.rows) {
      const code = String(row.code || "").trim();

      if (!code) {
        continue;
      }

      if (row.claimed_at) {
        claimedRows.push(code);
        continue;
      }

      const availableFromMs = row.available_from ? new Date(row.available_from).getTime() : now;

      if (!Number.isNaN(availableFromMs) && availableFromMs <= now) {
        availableRows.push(code);
      } else {
        futureRows.push({
          id: Number(row.id),
          code,
        });
      }
    }

    const blockedCodes = new Set([...claimedRows, ...availableRows]);
    const nextFutureCodes = [];

    for (const code of futureRows.map((item) => item.code).concat(incomingPromoCodes)) {
      if (!code || blockedCodes.has(code) || nextFutureCodes.includes(code)) {
        continue;
      }

      nextFutureCodes.push(code);
    }

    if (futureRows.length) {
      await client.query(
        "DELETE FROM prize_promo_codes WHERE id = ANY($1::bigint[])",
        [futureRows.map((item) => item.id)],
      );
    }

    const scheduledPromoCodes = buildPromoCodeSchedule(
      nextFutureCodes,
      codeReleaseStart,
      codeReleaseEnd,
    );

    if (scheduledPromoCodes.length) {
      await client.query(
        `
          INSERT INTO prize_promo_codes (
            prize_id,
            code,
            available_from
          )
          SELECT
            $1,
            item.code,
            item.available_from::timestamptz
          FROM UNNEST($2::text[], $3::text[]) AS item(code, available_from)
          ON CONFLICT (prize_id, code) DO NOTHING
        `,
        [
          id,
          scheduledPromoCodes.map((item) => item.code),
          scheduledPromoCodes.map((item) => item.availableFrom),
        ],
      );
    }

    const allPromoCodes = [...claimedRows, ...availableRows, ...scheduledPromoCodes.map((item) => item.code)];
    const poolCounts = await recalculatePromoPoolCounts(client, id);

    await client.query(
      `
        UPDATE prize_positions
        SET
          promo_codes_file_name = $2,
          promo_codes = $3::jsonb,
          total_count = $4,
          remaining_count = $5,
          code_release_start = $6,
          code_release_end = $7,
          updated_at = NOW()
        WHERE id = $1
      `,
      [
        id,
        promoCodesFileName || String(prizeRow.promo_codes_file_name || "").trim(),
        JSON.stringify(allPromoCodes),
        poolCounts.totalCount,
        poolCounts.remainingCount,
        codeReleaseStart,
        codeReleaseEnd,
      ],
    );
  });

  const items = await getAllPrizes();
  const prize = items.find((item) => item.id === id);

  return {
    updated: true,
    prize,
  };
}

export async function getPrizePromoCodeSchedule(payload = {}) {
  const id = Number(payload.id);

  if (!id) {
    throw new Error("Prize id is required");
  }

  const prizeResult = await query(
    `
      SELECT
        id,
        title,
        has_prize_limit,
        promo_codes_file_name
      FROM prize_positions
      WHERE id = $1
      LIMIT 1
    `,
    [id],
  );
  const prizeRow = prizeResult.rows[0];

  if (!prizeRow) {
    throw new Error("Prize not found");
  }

  const scheduleResult = await query(
    `
      SELECT
        prize_promo_codes.id,
        prize_promo_codes.code,
        prize_promo_codes.available_from,
        prize_promo_codes.claimed_at,
        awarded_prizes.created_at AS awarded_at
      FROM prize_promo_codes
      LEFT JOIN awarded_prizes
        ON awarded_prizes.id = prize_promo_codes.awarded_prize_id
      WHERE prize_promo_codes.prize_id = $1
      ORDER BY prize_promo_codes.available_from ASC NULLS FIRST, prize_promo_codes.id ASC
    `,
    [id],
  );

  const now = Date.now();
  const availableItems = [];
  const waitingItems = [];
  const claimedItems = [];

  for (const row of scheduleResult.rows) {
    const item = {
      id: Number(row.id),
      code: String(row.code || "").trim(),
      availableFrom: row.available_from ? new Date(row.available_from).toISOString() : null,
      claimedAt: row.claimed_at ? new Date(row.claimed_at).toISOString() : null,
      awardedAt: row.awarded_at ? new Date(row.awarded_at).toISOString() : null,
      availableFromLabel: row.available_from ? formatDateTimeLabel(row.available_from) : "",
    };

    if (item.claimedAt) {
      claimedItems.push(item);
      continue;
    }

    const availableFromMs = item.availableFrom ? new Date(item.availableFrom).getTime() : now;

    if (!Number.isNaN(availableFromMs) && availableFromMs > now) {
      waitingItems.push(item);
      continue;
    }

    availableItems.push(item);
  }

  return {
    prize: {
      id: Number(prizeRow.id),
      title: String(prizeRow.title || "").trim(),
      hasPrizeLimit: Boolean(prizeRow.has_prize_limit),
      promoCodesFileName: String(prizeRow.promo_codes_file_name || "").trim(),
    },
    summary: {
      availableCount: availableItems.length,
      waitingCount: waitingItems.length,
      claimedCount: claimedItems.length,
      totalCount: scheduleResult.rows.length,
    },
    availableItems,
    waitingItems,
    claimedItems,
  };
}

export async function updatePrizePromoCodeAvailability(payload = {}) {
  const prizeId = Number(payload.id);
  const promoCodeId = Number(payload.promoCodeId);
  const availableFrom = parseOptionalDateTime(payload.availableFrom, "availableFrom");

  if (!prizeId) {
    throw new Error("Prize id is required");
  }

  if (!promoCodeId) {
    throw new Error("Promo code id is required");
  }

  await withTransaction(async (client) => {
    const rowResult = await client.query(
      `
        SELECT id, claimed_at
        FROM prize_promo_codes
        WHERE id = $1
          AND prize_id = $2
        FOR UPDATE
      `,
      [promoCodeId, prizeId],
    );
    const promoCodeRow = rowResult.rows[0];

    if (!promoCodeRow) {
      throw new Error("Promo code not found");
    }

    if (promoCodeRow.claimed_at) {
      throw new Error("Issued promo code availability cannot be changed");
    }

    await client.query(
      `
        UPDATE prize_promo_codes
        SET available_from = $3::timestamptz,
            updated_at = NOW()
        WHERE id = $1
          AND prize_id = $2
      `,
      [promoCodeId, prizeId, availableFrom],
    );
  });

  return getPrizePromoCodeSchedule({ id: prizeId });
}

export async function deletePrize(payload = {}) {
  const id = Number(payload.id);

  if (!id) {
    throw new Error("Prize id is required");
  }

  const result = await query(
    `
      DELETE FROM prize_positions
      WHERE id = $1
      RETURNING id, title, roulette_image
    `,
    [id],
  );

  if (!result.rowCount) {
    throw new Error("Prize not found");
  }

  const deletedPrize = result.rows[0];
  const rouletteImage = normalizeStoredImage(deletedPrize.roulette_image);

  if (rouletteImage) {
    await deleteManagedImage(rouletteImage).catch((error) => {
      console.error("Failed to delete prize image", error);
    });
  }

  return {
    deleted: true,
    id: Number(deletedPrize.id),
    title: deletedPrize.title,
  };
}

export async function deleteManyPrizes(payload = {}) {
  const ids = Array.isArray(payload.ids)
    ? payload.ids.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0)
    : [];
  const uniqueIds = Array.from(new Set(ids));

  if (!uniqueIds.length) {
    throw new Error("Prize ids are required");
  }

  const result = await query(
    `
      DELETE FROM prize_positions
      WHERE id = ANY($1::bigint[])
      RETURNING id, title, roulette_image
    `,
    [uniqueIds],
  );

  if (!result.rowCount) {
    throw new Error("Prizes not found");
  }

  for (const row of result.rows) {
    const rouletteImage = normalizeStoredImage(row.roulette_image);

    if (!rouletteImage) {
      continue;
    }

    await deleteManagedImage(rouletteImage).catch((error) => {
      console.error("Failed to delete prize image", error);
    });
  }

  return {
    deleted: true,
    deletedCount: result.rowCount,
    ids: result.rows.map((row) => Number(row.id)),
    titles: result.rows.map((row) => row.title),
  };
}

export async function updatePrizeEnabled(payload = {}) {
  const id = Number(payload.id);
  const isEnabled = Boolean(payload.isEnabled);

  if (!id) {
    throw new Error("Prize id is required");
  }

  const result = await query(
    `
      UPDATE prize_positions
      SET is_enabled = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING id
    `,
    [id, isEnabled],
  );

  if (!result.rowCount) {
    throw new Error("Prize not found");
  }

  const items = await getAllPrizes();
  const prize = items.find((item) => item.id === id);

  return {
    updated: true,
    prize,
  };
}

export async function listChances(payload = {}) {
  const search = normalizeSearch(payload.search);
  const allItems = await getAllPrizes();
  const prizeDropCountByPrizeId = await getPrizeDropCountByPrizeId({ query });
  const totalWeight = allItems.reduce((sum, item) => sum + parseChanceWeight(item.chanceValue), 0);
  let items = allItems;

  if (search) {
    items = items.filter((item) => {
      const haystack = [
        item.title,
        item.type,
        item.category,
        item.promoCodeType,
        item.chanceValue,
      ].join(" ").toLowerCase();

      return haystack.includes(search);
    });
  }

  items = items
    .map((item) => ({
      ...item,
      awardedCount: prizeDropCountByPrizeId.get(item.id, item),
      chanceWeight: parseChanceWeight(item.chanceValue),
      probabilityPercent: totalWeight > 0
        ? (parseChanceWeight(item.chanceValue) / totalWeight) * 100
        : 0,
    }))
    .sort((left, right) => {
      const categoryCompare = String(left.category || "Без категории").localeCompare(
        String(right.category || "Без категории"),
        "ru",
      );

      if (categoryCompare !== 0) {
        return categoryCompare;
      }

      return left.title.localeCompare(right.title, "ru");
    });

  return {
    items,
    summary: {
      totalPositionsCount: allItems.length,
      totalWeight,
    },
  };
}

export async function updateChance(payload = {}) {
  const id = Number(payload.id);
  const chanceValue = String(payload.chanceValue || "").trim();

  if (!id) {
    throw new Error("Prize id is required");
  }

  if (!chanceValue) {
    throw new Error("Chance value is required");
  }

  const result = await query(
    "UPDATE prize_positions SET chance_value = $2, updated_at = NOW() WHERE id = $1 RETURNING id",
    [id, chanceValue],
  );

  if (!result.rowCount) {
    throw new Error("Prize not found");
  }

  return {
    updated: true,
  };
}

function isPrizeActive(prize, todayValue) {
  if (!prize.isEnabled) {
    return false;
  }

  if (prize.activeFrom && prize.activeFrom > todayValue) {
    return false;
  }

  if (prize.activeTo && prize.activeTo < todayValue) {
    return false;
  }

  if (prize.hasPrizeLimit && prize.remainingCount <= 0) {
    return false;
  }

  return true;
}

function chooseWeightedPrize(prizes) {
  const weightedItems = prizes
    .map((item) => ({
      ...item,
      chanceWeight: parseChanceWeight(item.chanceValue),
    }))
    .filter((item) => item.chanceWeight > 0);

  const totalWeight = weightedItems.reduce((sum, item) => sum + item.chanceWeight, 0);

  if (!weightedItems.length || totalWeight <= 0) {
    return prizes[0] || null;
  }

  let cursor = Math.random() * totalWeight;

  for (const item of weightedItems) {
    cursor -= item.chanceWeight;

    if (cursor <= 0) {
      return item;
    }
  }

  return weightedItems[weightedItems.length - 1];
}

async function getUserSpinHistoryState(client, userId) {
  const [lastSpinResult, nonPrizeCountResult] = await Promise.all([
    client.query(
      `
        SELECT details
        FROM game_event_logs
        WHERE user_id = $1
          AND event_name = 'spin_result'
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `,
      [userId],
    ),
    client.query(
      `
        SELECT COUNT(*)::int AS non_prize_results_count
        FROM game_event_logs
        WHERE user_id = $1
          AND event_name = 'spin_result'
          AND COALESCE(details->>'type', '') = 'Не приз'
      `,
      [userId],
    ),
  ]);

  return {
    lastSpinType: String(lastSpinResult.rows[0]?.details?.type || "").trim(),
    nonPrizeResultsCount: Number(nonPrizeCountResult.rows[0]?.non_prize_results_count || 0),
  };
}

async function getAwardedPrizeCountsByPrizeId(client, userId) {
  const result = await client.query(
    `
      SELECT prize_id, COUNT(*)::int AS awarded_count
      FROM awarded_prizes
      WHERE user_id = $1
        AND prize_id IS NOT NULL
      GROUP BY prize_id
    `,
    [userId],
  );

  return new Map(
    result.rows.map((row) => [Number(row.prize_id), Number(row.awarded_count || 0)]),
  );
}

function isPrizeEligibleForUser(prize, awardedPrizeCountsByPrizeId) {
  if (prize.type !== "Приз") {
    return true;
  }

  if (!prize.hasUserLimit || prize.userLimitCount <= 0) {
    return true;
  }

  return (awardedPrizeCountsByPrizeId.get(Number(prize.id)) || 0) < prize.userLimitCount;
}

function isPrizeAvailableByPromoPool(prize) {
  if (!requiresPromoCodePool(prize)) {
    return true;
  }

  return Number(prize.availablePromoCodesCount || 0) > 0;
}

function preventConsecutiveNonPrizePrizes(prizes = [], lastSpinType = "") {
  if (!Array.isArray(prizes) || !prizes.length) {
    return [];
  }

  if (String(lastSpinType || "").trim() !== "Не приз") {
    return prizes;
  }

  const prizeItems = prizes.filter((item) => item.type === "Приз");

  return prizeItems.length ? prizeItems : prizes;
}

function applySequentialNonPrizeDescription(prize, nonPrizeResultsCount = 0) {
  if (!prize || prize.type !== "Не приз") {
    return prize;
  }

  const facts = collectEffectivePrizeDescriptions(prize);

  if (!facts.length) {
    return prize;
  }

  const nextFactIndex = Math.max(0, Number(nonPrizeResultsCount) || 0) % facts.length;

  return {
    ...prize,
    rouletteDescription: facts[nextFactIndex] || prize.rouletteDescription || "",
  };
}

async function claimAvailablePromoCode(client, prizeId) {
  const promoCodeResult = await client.query(
    `
      SELECT id, code
      FROM prize_promo_codes
      WHERE prize_id = $1
        AND claimed_at IS NULL
        AND COALESCE(available_from, NOW()) <= NOW()
      ORDER BY available_from ASC NULLS FIRST, id ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `,
    [prizeId],
  );

  const promoCodeRow = promoCodeResult.rows[0];

  if (!promoCodeRow) {
    return null;
  }

  await client.query(
    `
      UPDATE prize_promo_codes
      SET claimed_at = NOW(), updated_at = NOW()
      WHERE id = $1
    `,
    [Number(promoCodeRow.id)],
  );

  return {
    id: Number(promoCodeRow.id),
    code: String(promoCodeRow.code || "").trim(),
  };
}

function mapAwardedPrizeForMyPrizesRow(row) {
  return {
    id: Number(row.id),
    positionId: row.prize_id != null ? Number(row.prize_id) : null,
    title: row.prize_title || row.my_prize_title,
    myPrizeText: row.my_prize_title || row.prize_title || "",
    promoCode: row.promo_code,
    image: normalizeStoredImage(row.image),
    expiresAt: row.expires_at,
    type: row.prize_type || "Приз",
    category: row.prize_category || "",
    promoCodeType: row.prize_promo_code_type || "",
    hasPrizeLimit: Boolean(row.has_prize_limit),
    description: row.prize_description || "",
    createdAt: row.created_at,
  };
}

function dedupeUnlimitedPromoCodePrizes(prizes = []) {
  if (!Array.isArray(prizes) || !prizes.length) {
    return [];
  }

  const seenPromoCodes = new Set();

  return prizes.filter((prize) => {
    const promoCodeKey = normalizeSearch(prize?.promoCode);

    if (!promoCodeKey || prize?.type !== "Приз" || prize?.hasPrizeLimit) {
      return true;
    }

    if (seenPromoCodes.has(promoCodeKey)) {
      return false;
    }

    seenPromoCodes.add(promoCodeKey);
    return true;
  });
}

function serializeMyPrizesForFrontend(prizes = []) {
  return prizes.map((item) => ({
    id: item.id,
    positionId: item.positionId,
    image: item.image?.previewUrl || "",
    title: item.title,
    myPrizeText: item.myPrizeText,
    description: item.description,
    expiresAt: item.expiresAt,
    promoCode: item.promoCode,
    type: item.type,
    category: item.category,
    promoCodeType: item.promoCodeType,
  }));
}

async function listAwardedPrizesForUser(userId, client = null) {
  const executor = client || { query };
  const result = await executor.query(
    `
      SELECT
        awarded_prizes.id,
        awarded_prizes.prize_id,
        awarded_prizes.title AS my_prize_title,
        awarded_prizes.promo_code,
        awarded_prizes.image,
        awarded_prizes.expires_at,
        awarded_prizes.created_at,
        prize_positions.type AS prize_type,
        prize_positions.category AS prize_category,
        prize_positions.promo_code_type AS prize_promo_code_type,
        prize_positions.has_prize_limit,
        prize_positions.title AS prize_title,
        prize_positions.roulette_description AS prize_description
      FROM awarded_prizes
      LEFT JOIN prize_positions ON prize_positions.id = awarded_prizes.prize_id
      WHERE awarded_prizes.user_id = $1
        AND COALESCE(prize_positions.type, 'Приз') = 'Приз'
      ORDER BY awarded_prizes.created_at DESC, awarded_prizes.id DESC
    `,
    [userId],
  );

  return dedupeUnlimitedPromoCodePrizes(result.rows.map(mapAwardedPrizeForMyPrizesRow));
}

function buildFrontendPrize(prize) {
  return {
    id: prize.id,
    title: prize.title,
    type: prize.type,
    category: prize.category,
    promoCodeType: prize.promoCodeType,
    chanceValue: prize.chanceValue,
    image: prize.rouletteImage?.previewUrl || "",
    description: prize.rouletteDescription || "",
    myPrizeText: prize.myPrizeText || prize.title,
    expiresAt: formatDateLabel(prize.activeTo),
  };
}

function buildMergedNonPrize(prizes = [], { randomizeDescription = false } = {}) {
  const nonPrizes = prizes.filter((item) => item.type === "Не приз");

  if (!nonPrizes.length) {
    return null;
  }

  const basePrize = nonPrizes[0];
  const rouletteDescriptions = Array.from(
    new Set(nonPrizes.flatMap((item) => collectEffectivePrizeDescriptions(item))),
  );
  const fallbackDescription = String(basePrize.rouletteDescription || "").trim();
  const totalChanceWeight = nonPrizes.reduce((sum, item) => sum + parseChanceWeight(item.chanceValue), 0);
  const description = randomizeDescription
    ? pickRandomItem(rouletteDescriptions) || fallbackDescription
    : fallbackDescription || rouletteDescriptions[0] || "";

  return {
    ...basePrize,
    chanceValue: totalChanceWeight > 0 ? formatChanceValue(totalChanceWeight) : basePrize.chanceValue,
    rouletteDescription: description,
    rouletteDescriptions,
  };
}

function mergeNonPrizePositions(prizes = [], options = {}) {
  if (!Array.isArray(prizes) || !prizes.length) {
    return [];
  }

  const mergedNonPrize = buildMergedNonPrize(prizes, options);

  if (!mergedNonPrize) {
    return prizes.slice();
  }

  const result = [];
  let insertedNonPrize = false;

  prizes.forEach((item) => {
    if (item.type === "Не приз") {
      if (!insertedNonPrize) {
        result.push(mergedNonPrize);
        insertedNonPrize = true;
      }

      return;
    }

    result.push(item);
  });

  return result;
}

function getRouletteTypeKey(prize) {
  return [
    String(prize?.type || "").trim(),
    String(prize?.category || "").trim(),
    String(prize?.promoCodeType || "").trim(),
  ].join("::");
}

function arrangeRoulettePrizes(prizes = []) {
  if (!Array.isArray(prizes) || prizes.length <= 2) {
    return Array.isArray(prizes) ? prizes.slice() : [];
  }

  const groups = new Map();

  prizes.forEach((prize, index) => {
    const key = getRouletteTypeKey(prize);
    const currentGroup = groups.get(key) || {
      key,
      items: [],
      originalIndex: index,
    };

    currentGroup.items.push(prize);
    groups.set(key, currentGroup);
  });

  const result = [];
  let previousKey = "";

  while (result.length < prizes.length) {
    const candidates = [...groups.values()]
      .filter((group) => group.items.length > 0)
      .sort((left, right) => {
        if (right.items.length !== left.items.length) {
          return right.items.length - left.items.length;
        }

        return left.originalIndex - right.originalIndex;
      });

    if (!candidates.length) {
      break;
    }

    const nextGroup = candidates.find((group) => group.key !== previousKey) || candidates[0];
    const nextPrize = nextGroup.items.shift();

    if (!nextPrize) {
      break;
    }

    result.push(nextPrize);
    previousKey = nextGroup.key;
  }

  return result.length === prizes.length ? result : prizes.slice();
}

function buildFallbackPromoCode(prize, usedCount = 0) {
  const base = String(prize.category || prize.type || "PRIZE")
    .toUpperCase()
    .replace(/[^A-ZA-Я0-9]+/g, "")
    .slice(0, 8);

  return `${base || "PRIZE"}-${String(prize.id).padStart(4, "0")}-${String(usedCount + 1).padStart(4, "0")}`;
}

function buildSpinResultPayload(prize, promoCode = "", awardedPrizeId = null) {
  return {
    positionId: prize?.id ?? null,
    type: prize?.type || "Приз",
    category: prize?.category || "",
    promoCodeType: prize?.promoCodeType || "",
    title: prize?.title || "",
    myPrizeText: prize?.myPrizeText || prize?.title || "",
    fullTitle: prize?.title || "",
    description: prize?.rouletteDescription || "",
    image: prize?.rouletteImage?.previewUrl || "",
    promoCode: String(promoCode || "").trim(),
    promoCodeIssued: Boolean(promoCode),
    awardedPrizeId: Number(awardedPrizeId) || null,
    expiresAt: formatDateLabel(prize?.activeTo),
  };
}

async function buildSpinResponseFromEventRow(client, rawUser, spinEventRow) {
  const details = spinEventRow?.details && typeof spinEventRow.details === "object" && !Array.isArray(spinEventRow.details)
    ? spinEventRow.details
    : {};
  const awardedPrizeId = Number(details.awardedPrizeId || 0) || null;
  const positionId = Number(details.positionId || 0) || null;
  let awardedPrizeRow = null;
  let prizeRow = null;

  if (awardedPrizeId) {
    const awardedPrizeResult = await client.query(
      `
        SELECT id, prize_id, title, promo_code, image, expires_at
        FROM awarded_prizes
        WHERE id = $1
          AND user_id = $2
        LIMIT 1
      `,
      [awardedPrizeId, rawUser.id],
    );
    awardedPrizeRow = awardedPrizeResult.rows[0] || null;
  }

  if (positionId) {
    const prizeResult = await client.query(
      `
        SELECT id, title, type, my_prize_text, roulette_description, roulette_image, active_to
        FROM prize_positions
        WHERE id = $1
        LIMIT 1
      `,
      [positionId],
    );
    prizeRow = prizeResult.rows[0] || null;
  }

  const result = {
    positionId: positionId || Number(awardedPrizeRow?.prize_id || 0) || Number(prizeRow?.id || 0) || null,
    type: String(details.type || prizeRow?.type || "Приз").trim() || "Приз",
    title: String(details.title || prizeRow?.title || awardedPrizeRow?.title || "").trim(),
    myPrizeText: String(details.myPrizeText || prizeRow?.my_prize_text || awardedPrizeRow?.title || "").trim(),
    fullTitle: String(details.fullTitle || prizeRow?.title || awardedPrizeRow?.title || "").trim(),
    description: String(details.description || prizeRow?.roulette_description || "").trim(),
    image: String(details.image || normalizeStoredImage(awardedPrizeRow?.image || prizeRow?.roulette_image)?.previewUrl || "").trim(),
    promoCode: String(awardedPrizeRow?.promo_code || "").trim(),
    promoCodeIssued: Boolean(details.promoCodeIssued || awardedPrizeRow?.promo_code),
    awardedPrizeId,
    expiresAt: String(details.expiresAt || awardedPrizeRow?.expires_at || formatDateLabel(prizeRow?.active_to)).trim(),
  };
  const myPrizes = await listAwardedPrizesForUser(rawUser.id, client);
  await ensureDailyAttemptGrant(rawUser.id, client);
  const attempts = await getUserAttemptSummary(rawUser.id, client);

  return {
    spin: {
      id: Number(spinEventRow.id),
      awardedPrizeId,
    },
    result,
    myPrizes: serializeMyPrizesForFrontend(myPrizes),
    attempts,
  };
}

async function getLatestPendingSpinResultForUser(client, rawUser) {
  const pendingSpinResult = await client.query(
    `
      WITH latest_backend_spin AS (
        SELECT backend.id, backend.details, backend.user_id, backend.session_id, backend.created_at
        FROM game_event_logs backend
        WHERE backend.user_id = $1
          AND backend.event_name = 'spin_result'
          AND backend.source = 'backend'
        ORDER BY backend.created_at DESC, backend.id DESC
        LIMIT 1
      )
      SELECT latest_backend_spin.id, latest_backend_spin.details
      FROM latest_backend_spin
      WHERE NOT EXISTS (
        SELECT 1
        FROM game_event_logs shown
        WHERE shown.user_id = latest_backend_spin.user_id
          AND shown.event_name = 'spin_result_shown'
          AND shown.source = 'frontend'
          AND (
            (
              COALESCE(shown.details ->> 'spinId', '') ~ '^[0-9]+$'
              AND (shown.details ->> 'spinId')::bigint = latest_backend_spin.id
            )
            OR (
              COALESCE(latest_backend_spin.session_id, '') <> ''
              AND shown.session_id = latest_backend_spin.session_id
              AND shown.created_at >= latest_backend_spin.created_at
            )
          )
      )
    `,
    [rawUser.id],
  );
  const pendingSpinRow = pendingSpinResult.rows[0] || null;

  if (!pendingSpinRow) {
    return null;
  }

  return buildSpinResponseFromEventRow(client, rawUser, pendingSpinRow);
}

export async function getGameBootstrap(userInfo = {}) {
  return withTransaction(async (client) => {
    const user = await getOrCreateUser(userInfo, client);
    const attempts = await ensureDailyAttemptGrant(user.id, client);
    const prizes = await getAllPrizes(client);
    const projectState = await getProjectState(client);
    const todayValue = getTodayValue();
    const enabledPrizes = prizes.filter((item) => item.isEnabled);
    const activePrizes = enabledPrizes.filter((item) => isPrizeActive(item, todayValue));
    const prizePool = activePrizes.length ? activePrizes : enabledPrizes;
    const mergedPrizePool = mergeNonPrizePositions(prizePool, { randomizeDescription: true });
    const orderedRoulettePrizes = arrangeRoulettePrizes(mergedPrizePool);
    const myPrizes = await listAwardedPrizesForUser(user.id, client);
    const referral = await getReferralData(user.id, client);
    const pendingSpin = await getLatestPendingSpinResultForUser(client, user);

    await logGameEvent(userInfo, "game_bootstrap_loaded", {
      source: "backend",
      sessionId: userInfo.sessionId,
      client,
      details: {
        rouletteItemsCount: mergedPrizePool.length,
        myPrizesCount: myPrizes.length,
        availableAttempts: attempts.availableAttempts,
        hasPendingSpinResult: Boolean(pendingSpin),
      },
    });

    return {
      projectFinished: projectState.projectFinished,
      rouletteItems: orderedRoulettePrizes.map(buildFrontendPrize),
      myPrizes: serializeMyPrizesForFrontend(myPrizes),
      attempts,
      referral,
      pendingSpin,
    };
  });
}

export async function spinPrize(userInfo = {}) {
  return withTransaction(async (client) => {
    const rawUser = await getOrCreateUser(userInfo, client);
    await ensureDailyAttemptGrant(rawUser.id, client);
    const prizes = await getAllPrizes(client);
    const todayValue = getTodayValue();
    const enabledPrizes = prizes.filter((item) => item.isEnabled);
    const activePrizes = enabledPrizes.filter((item) => isPrizeActive(item, todayValue));
    const prizePool = mergeNonPrizePositions(activePrizes.length ? activePrizes : enabledPrizes, {
      randomizeDescription: true,
    });
    const awardedPrizeCountsByPrizeId = await getAwardedPrizeCountsByPrizeId(client, rawUser.id);
    const userSpinHistoryState = await getUserSpinHistoryState(client, rawUser.id);
    const eligiblePrizes = prizePool.filter((item) =>
      isPrizeEligibleForUser(item, awardedPrizeCountsByPrizeId) && isPrizeAvailableByPromoPool(item)
    );
    const selectablePrizePool = preventConsecutiveNonPrizePrizes(
      eligiblePrizes,
      userSpinHistoryState.lastSpinType,
    );

    if (!selectablePrizePool.length) {
      const error = new Error("Упс, все доступные промокоды закончились");
      error.statusCode = 409;
      error.code = "PROMO_CODES_EXHAUSTED";
      throw error;
    }

    let attemptsAfterConsume = await consumeUserAttempt(rawUser.id, {
      sessionId: userInfo.sessionId || "",
    }, client);
    const selectablePrizes = [...selectablePrizePool];
    let selectedPrize = null;
    let claimedPromoCodeEntry = null;

    while (selectablePrizes.length > 0) {
      const nextPrize = chooseWeightedPrize(selectablePrizes);

      if (!nextPrize) {
        break;
      }

      if (requiresPromoCodePool(nextPrize)) {
        const claimedEntry = await claimAvailablePromoCode(client, nextPrize.id);

        if (!claimedEntry) {
          const staleIndex = selectablePrizes.findIndex((item) => Number(item.id) === Number(nextPrize.id));

          if (staleIndex >= 0) {
            selectablePrizes.splice(staleIndex, 1);
          }

          continue;
        }

        claimedPromoCodeEntry = claimedEntry;
      }

      selectedPrize = nextPrize;
      break;
    }

    if (!selectedPrize) {
      const error = new Error("No prize positions available");
      error.statusCode = 409;
      error.code = "PROMO_CODES_EXHAUSTED";
      throw error;
    }

    selectedPrize = applySequentialNonPrizeDescription(
      selectedPrize,
      userSpinHistoryState.nonPrizeResultsCount,
    );

    let promoCode = "";
    let awardedPrizeId = null;

    if (selectedPrize.type === "Приз") {
      if (requiresPromoCodePool(selectedPrize)) {
        promoCode = claimedPromoCodeEntry?.code || "";
        await client.query(
          `
            UPDATE prize_positions
            SET remaining_count = GREATEST(0, remaining_count - 1), updated_at = NOW()
            WHERE id = $1
          `,
          [selectedPrize.id],
        );
      } else if (selectedPrize.hasPrizeLimit) {
        const usedCount = Math.max(0, selectedPrize.totalCount - selectedPrize.remainingCount);
        if (!PROMO_CODE_FREE_PRIZE_CATEGORIES.has(selectedPrize.category)) {
          promoCode =
            selectedPrize.promoCodes[usedCount]
            || selectedPrize.promoCodes[selectedPrize.promoCodes.length ? usedCount % selectedPrize.promoCodes.length : 0]
            || buildFallbackPromoCode(selectedPrize, usedCount);
        }

        await client.query(
          `
            UPDATE prize_positions
            SET remaining_count = GREATEST(0, remaining_count - 1), updated_at = NOW()
            WHERE id = $1
          `,
          [selectedPrize.id],
        );
      } else if (!PROMO_CODE_FREE_PRIZE_CATEGORIES.has(selectedPrize.category)) {
        promoCode = selectedPrize.promoCodeValue || "";
      }

      const awardedPrizeResult = await client.query(
        `
          INSERT INTO awarded_prizes (user_id, prize_id, title, promo_code, image, expires_at)
          VALUES ($1, $2, $3, $4, $5::jsonb, $6)
          RETURNING id
        `,
        [
          rawUser.id,
          selectedPrize.id,
          selectedPrize.myPrizeText || selectedPrize.title,
          promoCode,
          selectedPrize.rouletteImage ? JSON.stringify(selectedPrize.rouletteImage) : null,
          formatDateLabel(selectedPrize.activeTo),
        ],
      );
      awardedPrizeId = Number(awardedPrizeResult.rows[0]?.id || 0) || null;

      if (selectedPrize.category === EXTRA_ATTEMPTS_PRIZE_CATEGORY) {
        attemptsAfterConsume = await grantPrizeAttempts(rawUser.id, EXTRA_ATTEMPTS_PRIZE_COUNT, {
          prizeId: selectedPrize.id,
          awardedPrizeId,
          sessionId: userInfo.sessionId || "",
        }, client);
      }

      if (claimedPromoCodeEntry?.id && awardedPrizeId) {
        await client.query(
          `
            UPDATE prize_promo_codes
            SET awarded_prize_id = $2, updated_at = NOW()
            WHERE id = $1
          `,
          [claimedPromoCodeEntry.id, awardedPrizeId],
        );
      }
    }

    const myPrizes = await listAwardedPrizesForUser(rawUser.id, client);

    const resultPayload = buildSpinResultPayload(selectedPrize, promoCode, awardedPrizeId);
    const spinEvent = await logGameEvent(userInfo, "spin_result", {
      source: "backend",
      sessionId: userInfo.sessionId,
      client,
      details: {
        userId: Number(rawUser.id),
        positionId: resultPayload.positionId,
        type: resultPayload.type,
        title: resultPayload.myPrizeText,
        myPrizeText: resultPayload.myPrizeText,
        fullTitle: resultPayload.fullTitle,
        description: resultPayload.description,
        image: resultPayload.image,
        expiresAt: resultPayload.expiresAt,
        awardedPrizeId: resultPayload.awardedPrizeId,
        promoCodeIssued: resultPayload.promoCodeIssued,
        myPrizesCount: myPrizes.length,
        availableAttempts: attemptsAfterConsume.availableAttempts,
      },
    });

    return {
      spin: {
        id: Number(spinEvent.id),
        awardedPrizeId,
      },
      result: resultPayload,
      myPrizes: serializeMyPrizesForFrontend(myPrizes),
      attempts: attemptsAfterConsume,
    };
  });
}

export async function getSpinResult(userInfo = {}, payload = {}) {
  return withTransaction(async (client) => {
    const rawUser = await getOrCreateUser(userInfo, client);
    const spinId = Number(payload?.spinId) || 0;

    if (!spinId) {
      const error = new Error("spinId is required");
      error.statusCode = 400;
      error.code = "SPIN_ID_REQUIRED";
      throw error;
    }

    const spinEventResult = await client.query(
      `
        SELECT id, details
        FROM game_event_logs
        WHERE id = $1
          AND user_id = $2
          AND event_name = 'spin_result'
        LIMIT 1
      `,
      [spinId, rawUser.id],
    );
    const spinEventRow = spinEventResult.rows[0];

    if (!spinEventRow) {
      const error = new Error("Spin result not found");
      error.statusCode = 404;
      error.code = "SPIN_RESULT_NOT_FOUND";
      throw error;
    }

    return buildSpinResponseFromEventRow(client, rawUser, spinEventRow);
  });
}
