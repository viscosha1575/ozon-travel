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
} from "./userStore.js";

const APP_TIMEZONE = String(process.env.APP_TIMEZONE || "Europe/Belgrade").trim() || "Europe/Belgrade";

function normalizeSearch(value) {
  return String(value || "").trim().toLowerCase();
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

function getTodayValue() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function mapPrizeRow(row) {
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
    totalCount: Number(row.total_count || 0),
    remainingCount: Number(row.remaining_count || 0),
    chanceValue: row.chance_value,
    hasUserLimit: row.has_user_limit,
    userLimitCount: Number(row.user_limit_count || 0),
    activeFrom: row.active_from
      ? new Date(row.active_from).toISOString().slice(0, 10)
      : "",
    activeTo: row.active_to
      ? new Date(row.active_to).toISOString().slice(0, 10)
      : "",
    rouletteImage: normalizeStoredImage(row.roulette_image),
    myPrizeText: row.my_prize_text,
    rouletteDescription: row.roulette_description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
      total_count,
      remaining_count,
      chance_value,
      has_user_limit,
      user_limit_count,
      active_from,
      active_to,
      roulette_image,
      my_prize_text,
      roulette_description,
      created_at,
      updated_at
    FROM prize_positions
  `);

  return result.rows.map(mapPrizeRow);
}

export async function listPrizes(payload = {}) {
  const search = normalizeSearch(payload.search);
  let items = await getAllPrizes();

  if (search) {
    items = items.filter((item) => {
      const haystack = [
        item.title,
        item.type,
        item.category,
        item.promoCodeType,
        item.promoCodeValue,
        item.myPrizeText,
        item.rouletteDescription,
      ].join(" ").toLowerCase();

      return haystack.includes(search);
    });
  }

  items.sort((left, right) => left.title.localeCompare(right.title, "ru"));

  return {
    items,
    summary: {
      totalPrizesCount: items.length,
      totalUnitsCount: items.reduce((sum, item) => sum + Number(item.totalCount || 0), 0),
      totalRemainingCount: items.reduce((sum, item) => sum + Number(item.remainingCount || 0), 0),
    },
  };
}

function validatePrizePayload(payload = {}) {
  const title = String(payload.title || "").trim();
  const type = String(payload.type || "").trim();
  const category = String(payload.category || "").trim();
  const promoCodeType = String(payload.promoCodeType || "").trim();
  const hasPrizeLimit = Boolean(payload.hasPrizeLimit);
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
  const rouletteImage = payload.rouletteImage ?? null;
  const myPrizeText = String(payload.myPrizeText || "").trim();
  const rouletteDescription = String(payload.rouletteDescription || "").trim();

  if (!title) {
    throw new Error("Prize title is required");
  }

  if (!type) {
    throw new Error("Prize type is required");
  }

  if (type !== "Не приз" && !category) {
    throw new Error("Prize category is required");
  }

  if (hasPrizeLimit && !totalCount) {
    throw new Error("Prize total count is required");
  }

  if (hasUserLimit && !userLimitCount) {
    throw new Error("Prize user limit count is required");
  }

  return {
    title,
    category: type === "Не приз" ? "" : category,
    promoCodeType: type === "Не приз" ? "" : promoCodeType,
    type,
    hasPrizeLimit: type === "Не приз" ? false : hasPrizeLimit,
    promoCodesFileName: type === "Не приз" ? "" : promoCodesFileName,
    promoCodes: type === "Не приз" ? [] : promoCodes,
    promoCodeValue: type === "Не приз" ? "" : promoCodeValue,
    totalCount: type === "Не приз" ? 0 : totalCount,
    chanceValue,
    hasUserLimit: type === "Не приз" ? false : hasUserLimit,
    userLimitCount: type === "Не приз" ? 0 : userLimitCount,
    activeFrom,
    activeTo,
    rouletteImage,
    myPrizeText: type === "Не приз" ? title : myPrizeText,
    rouletteDescription,
  };
}

export async function createPrize(payload = {}) {
  const nextPrize = validatePrizePayload(payload);
  const nextIdResult = await query("SELECT COALESCE(MAX(id), 0) + 1 AS id FROM prize_positions");
  const id = Number(nextIdResult.rows[0]?.id || 1);
  let uploadedImage = null;

  try {
    const imageResult = await storeRouletteImage(nextPrize.rouletteImage);
    nextPrize.rouletteImage = imageResult.image;
    uploadedImage = imageResult.uploadedImage;

    await query(
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
          total_count,
          remaining_count,
          chance_value,
          has_user_limit,
          user_limit_count,
          active_from,
          active_to,
          roulette_image,
          my_prize_text,
          roulette_description,
          updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18, $19, NOW()
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
        nextPrize.totalCount,
        nextPrize.hasPrizeLimit ? nextPrize.totalCount : 0,
        nextPrize.chanceValue,
        nextPrize.hasUserLimit,
        nextPrize.userLimitCount,
        nextPrize.activeFrom,
        nextPrize.activeTo,
        nextPrize.rouletteImage ? JSON.stringify(nextPrize.rouletteImage) : null,
        nextPrize.myPrizeText,
        nextPrize.rouletteDescription,
      ],
    );

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
      const remainingCount = nextPrize.hasPrizeLimit
        ? Math.max(0, nextPrize.totalCount - usedCount)
        : 0;
      const imageResult = await storeRouletteImage(nextPrize.rouletteImage, currentPrize.roulette_image || null);

      nextPrize.rouletteImage = imageResult.image;
      uploadedImage = imageResult.uploadedImage;
      previousImageToCleanup = imageResult.cleanupImage;

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
            roulette_image = $17::jsonb,
            my_prize_text = $18,
            roulette_description = $19,
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
          nextPrize.totalCount,
          remainingCount,
          nextPrize.chanceValue,
          nextPrize.hasUserLimit,
          nextPrize.userLimitCount,
          nextPrize.activeFrom,
          nextPrize.activeTo,
          nextPrize.rouletteImage ? JSON.stringify(nextPrize.rouletteImage) : null,
          nextPrize.myPrizeText,
          nextPrize.rouletteDescription,
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

export async function listChances(payload = {}) {
  const search = normalizeSearch(payload.search);
  const allItems = await getAllPrizes();
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

async function listAwardedPrizesForUser(userId) {
  const result = await query(
    `
      SELECT
        awarded_prizes.id,
        awarded_prizes.title AS my_prize_title,
        awarded_prizes.promo_code,
        awarded_prizes.image,
        awarded_prizes.expires_at,
        awarded_prizes.created_at,
        prize_positions.type AS prize_type,
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

  return result.rows.map((row) => ({
    id: Number(row.id),
    title: row.prize_title || row.my_prize_title,
    myPrizeText: row.my_prize_title || row.prize_title || "",
    promoCode: row.promo_code,
    image: normalizeStoredImage(row.image),
    expiresAt: row.expires_at,
    type: row.prize_type || "Приз",
    description: row.prize_description || "",
    createdAt: row.created_at,
  }));
}

function buildFrontendPrize(prize) {
  return {
    id: prize.id,
    title: prize.title,
    type: prize.type,
    chanceValue: prize.chanceValue,
    image: prize.rouletteImage?.previewUrl || "",
    description: prize.rouletteDescription || "",
    myPrizeText: prize.myPrizeText || prize.title,
    expiresAt: formatDateLabel(prize.activeTo),
  };
}

function buildFallbackPromoCode(prize, usedCount = 0) {
  const base = String(prize.category || prize.type || "PRIZE")
    .toUpperCase()
    .replace(/[^A-ZA-Я0-9]+/g, "")
    .slice(0, 8);

  return `${base || "PRIZE"}-${String(prize.id).padStart(4, "0")}-${String(usedCount + 1).padStart(4, "0")}`;
}

export async function getGameBootstrap(userInfo = {}) {
  const user = await getOrCreateUser(userInfo);
  const attempts = await ensureDailyAttemptGrant(user.id);
  const prizes = await getAllPrizes();
  const todayValue = getTodayValue();
  const activePrizes = prizes.filter((item) => isPrizeActive(item, todayValue));
  const myPrizes = await listAwardedPrizesForUser(user.id);
  const referral = await getReferralData(user.id);

  await logGameEvent(userInfo, "game_bootstrap_loaded", {
    source: "backend",
    sessionId: userInfo.sessionId,
    details: {
      rouletteItemsCount: (activePrizes.length ? activePrizes : prizes).length,
      myPrizesCount: myPrizes.length,
      availableAttempts: attempts.availableAttempts,
    },
  });

  return {
    rouletteItems: (activePrizes.length ? activePrizes : prizes).map(buildFrontendPrize),
    myPrizes: myPrizes.map((item) => ({
      id: item.id,
      image: item.image?.previewUrl || "",
      title: item.title,
      myPrizeText: item.myPrizeText,
      description: item.description,
      expiresAt: item.expiresAt,
      promoCode: item.promoCode,
      type: item.type,
    })),
    attempts,
    referral,
  };
}

export async function spinPrize(userInfo = {}) {
  return withTransaction(async (client) => {
    const rawUser = await getOrCreateUser(userInfo, client);
    await ensureDailyAttemptGrant(rawUser.id, client);
    const prizes = await getAllPrizes(client);
    const todayValue = getTodayValue();
    const activePrizes = prizes.filter((item) => isPrizeActive(item, todayValue));
    const prizePool = activePrizes.length ? activePrizes : prizes;
    const awardedPrizeCountsByPrizeId = await getAwardedPrizeCountsByPrizeId(client, rawUser.id);
    const eligiblePrizes = prizePool.filter((item) => isPrizeEligibleForUser(item, awardedPrizeCountsByPrizeId));
    const eligibleRewardPrizes = eligiblePrizes.filter((item) => item.type === "Приз");

    if (!eligibleRewardPrizes.length) {
      const error = new Error("Упс, все доступные промокоды закончились");
      error.statusCode = 409;
      error.code = "PROMO_CODES_EXHAUSTED";
      throw error;
    }

    const attemptsAfterConsume = await consumeUserAttempt(rawUser.id, {
      sessionId: userInfo.sessionId || "",
    }, client);
    const selectedPrize = chooseWeightedPrize(eligiblePrizes);

    if (!selectedPrize) {
      throw new Error("No prize positions available");
    }

    let promoCode = "";

    if (selectedPrize.type === "Приз") {
      if (selectedPrize.hasPrizeLimit) {
        const usedCount = Math.max(0, selectedPrize.totalCount - selectedPrize.remainingCount);
        promoCode =
          selectedPrize.promoCodes[usedCount]
          || selectedPrize.promoCodes[selectedPrize.promoCodes.length ? usedCount % selectedPrize.promoCodes.length : 0]
          || buildFallbackPromoCode(selectedPrize, usedCount);

        await client.query(
          `
            UPDATE prize_positions
            SET remaining_count = GREATEST(0, remaining_count - 1), updated_at = NOW()
            WHERE id = $1
          `,
          [selectedPrize.id],
        );
      } else {
        promoCode = selectedPrize.promoCodeValue || "";
      }

      await client.query(
        `
          INSERT INTO awarded_prizes (user_id, prize_id, title, promo_code, image, expires_at)
          VALUES ($1, $2, $3, $4, $5::jsonb, $6)
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
    }

    const myPrizesResult = await client.query(
      `
        SELECT
          awarded_prizes.id,
          awarded_prizes.title AS my_prize_title,
          awarded_prizes.promo_code,
          awarded_prizes.image,
          awarded_prizes.expires_at,
          awarded_prizes.created_at,
          prize_positions.type AS prize_type,
          prize_positions.title AS prize_title,
          prize_positions.roulette_description AS prize_description
        FROM awarded_prizes
        LEFT JOIN prize_positions ON prize_positions.id = awarded_prizes.prize_id
        WHERE awarded_prizes.user_id = $1
          AND COALESCE(prize_positions.type, 'Приз') = 'Приз'
        ORDER BY awarded_prizes.created_at DESC, awarded_prizes.id DESC
      `,
      [rawUser.id],
    );
    const myPrizes = myPrizesResult.rows.map((row) => ({
      id: Number(row.id),
      image: normalizeStoredImage(row.image)?.previewUrl || "",
      title: row.prize_title || row.my_prize_title,
      myPrizeText: row.my_prize_title || row.prize_title || "",
      expiresAt: row.expires_at,
      promoCode: row.promo_code,
      type: row.prize_type || "Приз",
      description: row.prize_description || "",
    }));

    await logGameEvent(userInfo, "spin_result", {
      source: "backend",
      sessionId: userInfo.sessionId,
      client,
      details: {
        userId: Number(rawUser.id),
        positionId: selectedPrize.id,
        type: selectedPrize.type,
        title: selectedPrize.myPrizeText || selectedPrize.title,
        fullTitle: selectedPrize.title,
        promoCodeIssued: Boolean(promoCode),
        myPrizesCount: myPrizes.length,
        availableAttempts: attemptsAfterConsume.availableAttempts,
      },
    });

    return {
      result: {
        positionId: selectedPrize.id,
        type: selectedPrize.type,
        title: selectedPrize.title,
        myPrizeText: selectedPrize.myPrizeText || selectedPrize.title,
        fullTitle: selectedPrize.title,
        description: selectedPrize.rouletteDescription || "",
        image: selectedPrize.rouletteImage?.previewUrl || "",
        promoCode,
        expiresAt: formatDateLabel(selectedPrize.activeTo),
      },
      myPrizes,
      attempts: attemptsAfterConsume,
    };
  });
}
