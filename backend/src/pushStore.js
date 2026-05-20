import { deleteManagedImage, normalizeStoredImage, storeManagedImage } from "./imageStorage.js";
import { query, withTransaction } from "./db.js";

const PUSH_STATUS_VALUES = new Set(["template", "scheduled", "sent"]);
const INTERNAL_BROADCAST_URL = String(
  process.env.MAX_INTERNAL_BROADCAST_URL || "http://max-bot:3011/internal/broadcast/send"
).trim();
const INTERNAL_BROADCAST_TOKEN = String(
  process.env.BROADCAST_INTERNAL_TOKEN || process.env.REQUEST_BODY_SECRET || ""
).trim();
const MAX_PUSH_TEST_USER_ID = String(process.env.MAX_PUSH_TEST_USER_ID || "185076365").trim();
const MAX_TEXT_LIMIT = 4000;
const MAX_BROADCAST_CONCURRENCY = Math.min(10, Math.max(1, Number(process.env.MAX_BROADCAST_CONCURRENCY || 2) || 2));

function normalizeSearch(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeAudienceKey(value) {
  return String(value || "").trim() === "selected_users" ? "selected_users" : "all_users";
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|blockquote|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function messageToHtml(value) {
  return escapeHtml(value).replace(/\r?\n/g, "<br />");
}

function computeRate(numerator, denominator) {
  const safeDenominator = Number(denominator) || 0;

  if (safeDenominator <= 0) {
    return 0;
  }

  return (Number(numerator) || 0) / safeDenominator * 100;
}

function sanitizeSelectedUsers(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  const items = [];

  for (const rawUser of value) {
    const id = Number(rawUser?.id) || 0;

    if (id <= 0 || seen.has(id)) {
      continue;
    }

    seen.add(id);
    items.push({
      id,
      displayName: String(rawUser?.displayName || "").trim(),
      username: String(rawUser?.username || "").trim(),
      telegramUserId: String(rawUser?.telegramUserId || "").trim(),
    });
  }

  return items;
}

function buildAudienceLabel(audienceKey, selectedUsers, fallbackLabel) {
  const providedLabel = String(fallbackLabel || "").trim();

  if (providedLabel) {
    return providedLabel;
  }

  if (audienceKey === "selected_users") {
    const count = selectedUsers.length;
    return `${count} ${count === 1 ? "пользователь" : count >= 2 && count <= 4 ? "пользователя" : "пользователей"}`;
  }

  return "Все пользователи";
}

function normalizePushImage(payload = {}) {
  if (payload?.image && typeof payload.image === "object" && !Array.isArray(payload.image)) {
    return {
      name: String(payload.image.name || "push-image").trim() || "push-image",
      previewUrl: String(payload.image.previewUrl || "").trim(),
    };
  }

  if (payload?.imageUrl) {
    return {
      name: String(payload.imageName || "push-image").trim() || "push-image",
      previewUrl: String(payload.imageUrl || "").trim(),
    };
  }

  return null;
}

function normalizePushRow(row) {
  const image = normalizeStoredImage(row?.image);
  const selectedUsers = sanitizeSelectedUsers(row?.selected_users);
  const recipientsCount = Number(row?.recipients_count || 0);
  const deliveredCount = Number(row?.delivered_count || 0);
  const openedCount = Number(row?.opened_count || 0);
  const clickedCount = Number(row?.clicked_count || 0);
  const status = PUSH_STATUS_VALUES.has(row?.status) ? row.status : "template";

  return {
    id: Number(row.id),
    title: String(row.title || "").trim(),
    message: String(row.message || "").trim(),
    html: String(row.html || "").trim(),
    audienceKey: normalizeAudienceKey(row.audience_key),
    audienceLabel: String(row.audience_label || "").trim() || "Все пользователи",
    selectedUsers,
    image,
    imageUrl: image?.previewUrl || null,
    disableLinkPreview: Boolean(row?.disable_link_preview),
    status,
    recipientsCount,
    deliveredCount,
    openedCount,
    clickedCount,
    openRate: computeRate(openedCount, deliveredCount),
    ctr: computeRate(clickedCount, openedCount),
    testSentAt: row.test_sent_at,
    scheduledAt: row.scheduled_at,
    sentAt: row.sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    canSendLive: status === "template" && Boolean(row.test_sent_at),
  };
}

async function fetchPushById(executor, pushId) {
  const result = await executor.query(
    `
      SELECT *
      FROM push_campaigns
      WHERE id = $1
      LIMIT 1
    `,
    [Number(pushId) || 0],
  );

  return result.rows[0] || null;
}

async function countMaxRecipients(executor, audienceKey, selectedUsers) {
  if (audienceKey === "selected_users") {
    const ids = selectedUsers.map((item) => Number(item.id)).filter((item) => item > 0);

    if (ids.length === 0) {
      return 0;
    }

    const result = await executor.query(
      `
        SELECT COUNT(*)::int AS count
        FROM app_users
        WHERE id = ANY($1::bigint[])
          AND external_id LIKE 'max:%'
      `,
      [ids],
    );

    return Number(result.rows[0]?.count || 0);
  }

  const result = await executor.query(
    `
      SELECT COUNT(*)::int AS count
      FROM app_users
      WHERE external_id LIKE 'max:%'
    `,
  );

  return Number(result.rows[0]?.count || 0);
}

async function resolveMaxRecipientIds(executor, push) {
  if (push.audienceKey === "selected_users") {
    const ids = sanitizeSelectedUsers(push.selectedUsers).map((item) => Number(item.id)).filter((item) => item > 0);

    if (ids.length === 0) {
      return [];
    }

    const result = await executor.query(
      `
        SELECT external_id
        FROM app_users
        WHERE id = ANY($1::bigint[])
          AND external_id LIKE 'max:%'
        ORDER BY id ASC
      `,
      [ids],
    );

    return result.rows
      .map((row) => String(row.external_id || "").trim())
      .map((externalId) => externalId.replace(/^max:/, ""))
      .filter(Boolean);
  }

  const result = await executor.query(
    `
      SELECT external_id
      FROM app_users
      WHERE external_id LIKE 'max:%'
      ORDER BY id ASC
    `,
  );

  return result.rows
    .map((row) => String(row.external_id || "").trim())
    .map((externalId) => externalId.replace(/^max:/, ""))
    .filter(Boolean);
}

async function callMaxBroadcast(payload) {
  if (!INTERNAL_BROADCAST_URL) {
    throw new Error("MAX internal broadcast URL is not configured");
  }

  if (!INTERNAL_BROADCAST_TOKEN) {
    throw new Error("MAX internal broadcast token is not configured");
  }

  const response = await fetch(INTERNAL_BROADCAST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-broadcast-token": INTERNAL_BROADCAST_TOKEN,
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.message || `MAX broadcast failed with ${response.status}`);
  }

  return data;
}

async function runWithConcurrency(items, run) {
  let cursor = 0;
  const results = new Array(items.length);

  async function worker() {
    while (cursor < items.length) {
      const nextIndex = cursor;
      cursor += 1;
      results[nextIndex] = await run(items[nextIndex], nextIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(MAX_BROADCAST_CONCURRENCY, items.length || 1) }, () => worker()),
  );

  return results;
}

function buildBroadcastHtml(push) {
  const html = String(push.html || "").trim();

  if (html) {
    return html;
  }

  return messageToHtml(push.message || "");
}

function decorateTestSendError(error) {
  const message = String(error?.message || "").trim();

  if (message.includes(`Chat with user ${MAX_PUSH_TEST_USER_ID} not found`)) {
    return new Error(`Тестовый MAX-пользователь ${MAX_PUSH_TEST_USER_ID} ещё не открыл чат с ботом или остановил его.`);
  }

  return error;
}

function validatePushPayload(payload = {}) {
  const title = String(payload?.title || "").trim();
  const html = String(payload?.html || "").trim();
  const message = String(payload?.message || stripHtml(html)).trim();
  const normalizedHtml = html || messageToHtml(message);
  const audienceKey = normalizeAudienceKey(payload?.audienceKey);
  const selectedUsers = sanitizeSelectedUsers(payload?.selectedUsers);

  if (!title) {
    throw new Error("Push title is required");
  }

  if (!message) {
    throw new Error("Push message is required");
  }

  if (normalizedHtml.length > MAX_TEXT_LIMIT) {
    throw new Error(`Текст рассылки превышает лимит MAX: ${MAX_TEXT_LIMIT} символов`);
  }

  if (audienceKey === "selected_users" && selectedUsers.length === 0) {
    throw new Error("Select at least one user");
  }

  return {
    title,
    message,
    html: normalizedHtml,
    audienceKey,
    audienceLabel: buildAudienceLabel(audienceKey, selectedUsers, payload?.audienceLabel),
    selectedUsers,
    image: normalizePushImage(payload),
    disableLinkPreview: Boolean(payload?.disableLinkPreview),
  };
}

export async function listPushes(payload = {}) {
  const search = normalizeSearch(payload?.search);
  const status = String(payload?.status || "all").trim();
  const result = await query("SELECT * FROM push_campaigns ORDER BY COALESCE(sent_at, scheduled_at, created_at) DESC, id DESC");
  let items = result.rows.map(normalizePushRow);

  if (status !== "all") {
    items = items.filter((item) => item.status === status);
  }

  if (search) {
    items = items.filter((item) => {
      const haystack = [
        item.title,
        item.message,
        item.audienceLabel,
        ...item.selectedUsers.map((user) => [user.displayName, user.username, user.telegramUserId].join(" ")),
      ].join(" ").toLowerCase();

      return haystack.includes(search);
    });
  }

  return {
    items,
    summary: {
      totalCampaignsCount: items.length,
      sentCampaignsCount: items.filter((item) => item.status === "sent" || item.sentAt).length,
      totalRecipientsCount: items.reduce((sum, item) => sum + Number(item.recipientsCount || 0), 0),
      deliveredRecipientsCount: items.reduce((sum, item) => sum + Number(item.deliveredCount || 0), 0),
    },
  };
}

export async function createPush(payload = {}) {
  const nextPush = validatePushPayload(payload);
  let uploadedImage = null;

  try {
    return await withTransaction(async (client) => {
      if (nextPush.image?.previewUrl) {
        const imageResult = await storeManagedImage(nextPush.image, null);
        nextPush.image = imageResult.image;
        uploadedImage = imageResult.uploadedImage;
      } else {
        nextPush.image = null;
      }

      const recipientsCount = await countMaxRecipients(client, nextPush.audienceKey, nextPush.selectedUsers);
      const result = await client.query(
        `
          INSERT INTO push_campaigns (
            title,
            message,
            html,
            audience_key,
            audience_label,
            selected_users,
            image,
            disable_link_preview,
            status,
            recipients_count,
            delivered_count,
            opened_count,
            clicked_count,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, 'template', $9, 0, 0, 0, NOW())
          RETURNING *
        `,
        [
          nextPush.title,
          nextPush.message,
          nextPush.html,
          nextPush.audienceKey,
          nextPush.audienceLabel,
          JSON.stringify(nextPush.selectedUsers),
          nextPush.image ? JSON.stringify(nextPush.image) : null,
          nextPush.disableLinkPreview,
          recipientsCount,
        ],
      );

      return {
        push: normalizePushRow(result.rows[0]),
      };
    });
  } catch (error) {
    if (uploadedImage) {
      await deleteManagedImage(uploadedImage).catch(() => {});
    }

    throw error;
  }
}

export async function sendPush(payload = {}) {
  const pushId = Number(payload?.pushId) || 0;
  const mode = String(payload?.mode || "live").trim().toLowerCase() === "test" ? "test" : "live";
  const row = await fetchPushById({ query }, pushId);

  if (!row) {
    throw new Error("Push not found");
  }

  const push = normalizePushRow(row);

  if (mode === "test") {
    if (!MAX_PUSH_TEST_USER_ID) {
      throw new Error("MAX test recipient is not configured");
    }

    try {
      await callMaxBroadcast({
        userId: MAX_PUSH_TEST_USER_ID,
        html: buildBroadcastHtml(push),
        mediaUrls: push.image?.previewUrl ? [push.image.previewUrl] : [],
        disablePreview: Boolean(push.disableLinkPreview),
      });
    } catch (error) {
      throw decorateTestSendError(error);
    }

    const result = await query(
      `
        UPDATE push_campaigns
        SET test_sent_at = NOW(), updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [push.id],
    );

    return {
      push: normalizePushRow(result.rows[0]),
      mode,
    };
  }

  if (push.status === "template" && !push.testSentAt) {
    throw new Error("Test send is required before live send");
  }

  const recipientIds = await resolveMaxRecipientIds({ query }, push);

  if (recipientIds.length === 0) {
    throw new Error("Нет MAX-пользователей для этой рассылки");
  }

  const results = await runWithConcurrency(recipientIds, async (recipientId) => {
    try {
      await callMaxBroadcast({
        userId: recipientId,
        html: buildBroadcastHtml(push),
        mediaUrls: push.image?.previewUrl ? [push.image.previewUrl] : [],
        disablePreview: Boolean(push.disableLinkPreview),
      });

      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error?.message || String(error),
      };
    }
  });

  const deliveredCount = results.filter((item) => item?.ok).length;
  const failedCount = recipientIds.length - deliveredCount;
  const updateResult = await query(
    `
      UPDATE push_campaigns
      SET
        status = 'sent',
        recipients_count = $2,
        delivered_count = $3,
        opened_count = 0,
        clicked_count = 0,
        scheduled_at = COALESCE(scheduled_at, NOW()),
        sent_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [push.id, recipientIds.length, deliveredCount],
  );

  return {
    push: normalizePushRow(updateResult.rows[0]),
    mode,
    stats: {
      recipientsCount: recipientIds.length,
      deliveredCount,
      failedCount,
    },
  };
}
