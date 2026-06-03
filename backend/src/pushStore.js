import { deleteManagedImage, normalizeStoredImage, storeManagedImage } from "./imageStorage.js";
import { query, withTransaction } from "./db.js";
import { enqueuePushRevokeJob, enqueuePushSendJob } from "./workerQueue.js";

const PUSH_STATUS_VALUES = new Set(["template", "scheduled", "sent", "revoked"]);
const MAX_PUSH_TEST_USER_ID = String(process.env.MAX_PUSH_TEST_USER_ID || "169639251").trim();
const MAX_TEXT_LIMIT = 4000;

function normalizeSearch(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeAudienceKey(value) {
  return String(value || "").trim() === "selected_users" ? "selected_users" : "all_users";
}

function normalizeActionUrl(value) {
  const trimmedValue = String(value || "").trim();

  if (!trimmedValue) {
    return "";
  }

  try {
    const url = new URL(trimmedValue);

    if (!/^https?:$/i.test(url.protocol)) {
      return "";
    }

    return url.toString();
  } catch {
    return "";
  }
}

function isMiniAppUrl(value) {
  const normalizedUrl = normalizeActionUrl(value);

  if (!normalizedUrl) {
    return false;
  }

  try {
    const url = new URL(normalizedUrl);

    return url.hostname === "max.ru" && url.pathname.replace(/^\/+/, "").length > 0 && url.searchParams.has("startapp");
  } catch {
    return false;
  }
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
    .replace(/[^\S\n]+/g, " ")
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

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ");
}

function sanitizeInlineHtml(value) {
  return String(value || "")
    .replace(/<\s*strong\b[^>]*>/gi, "<b>")
    .replace(/<\s*\/\s*strong\s*>/gi, "</b>")
    .replace(/<\s*em\b[^>]*>/gi, "<i>")
    .replace(/<\s*\/\s*em\s*>/gi, "</i>")
    .replace(/<\s*ins\b[^>]*>/gi, "<u>")
    .replace(/<\s*\/\s*ins\s*>/gi, "</u>")
    .replace(/<\s*del\b[^>]*>/gi, "<s>")
    .replace(/<\s*\/\s*del\s*>/gi, "</s>")
    .replace(/<\s*a\b[^>]*href=(['"])(.*?)\1[^>]*>/gi, (_match, _quote, href) => `<a href="${href}">`)
    .replace(/<\s*\/\s*a\s*>/gi, "</a>")
    .replace(/<(?!\/?(a|b|i|u|s|code|pre|blockquote|br)\b)[^>]+>/gi, "");
}

function convertNewlinesToMaxBreaks(value) {
  return String(value || "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatInlineForMax(value) {
  return sanitizeInlineHtml(
    normalizeWhitespace(value)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/?(p|div)\b[^>]*>/gi, "\n")
      .replace(/\n{3,}/g, "\n\n"),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}

function replaceListBlocks(html, tagName, markerBuilder) {
  const listRegex = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "gi");

  return html.replace(listRegex, (_match, listContent) => {
    const items = [];
    const itemRegex = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
    let itemMatch;
    let index = 0;

    while ((itemMatch = itemRegex.exec(listContent)) !== null) {
      const itemText = formatInlineForMax(itemMatch[1]);

      if (!itemText) {
        continue;
      }

      items.push(`${markerBuilder(index)} ${itemText}`.trim());
      index += 1;
    }

    if (items.length === 0) {
      return "";
    }

    return `\n\n${items.join("\n")}\n\n`;
  });
}

function formatHtmlForMax(rawHtml) {
  const normalizedHtml = normalizeWhitespace(rawHtml)
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "");

  const withLists = replaceListBlocks(
    replaceListBlocks(normalizedHtml, "ul", () => "•"),
    "ol",
    (index) => `${index + 1}.`,
  );

  const normalizedText = sanitizeInlineHtml(
    withLists
      .replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_match, quoteText) => {
        const normalizedQuote = formatInlineForMax(quoteText);

        if (!normalizedQuote) {
          return "";
        }

        return `\n\n<blockquote>${normalizedQuote}</blockquote>\n\n`;
      })
      .replace(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi, (_match, _tag, headingText) => {
        const normalizedHeading = formatInlineForMax(headingText);

        if (!normalizedHeading) {
          return "";
        }

        return `\n\n<b>${normalizedHeading}</b>\n\n`;
      })
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div)>/gi, "\n\n")
      .replace(/<(p|div)\b[^>]*>/gi, "")
      .replace(/\n{3,}/g, "\n\n"),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return convertNewlinesToMaxBreaks(normalizedText);
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
      platform: String(rawUser?.platform || "").trim(),
      platformUserId: String(rawUser?.platformUserId || rawUser?.telegramUserId || "").trim(),
      username: String(rawUser?.username || "").trim(),
      telegramUserId: String(rawUser?.platformUserId || rawUser?.telegramUserId || "").trim(),
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

function normalizePushButton(payload = {}) {
  const text = String(payload?.button?.text || payload?.buttonText || "").trim();
  const url = normalizeActionUrl(payload?.button?.url || payload?.buttonUrl || "");
  const type = String(payload?.button?.type || "").trim().toLowerCase() === "open_app" || isMiniAppUrl(url)
    ? "open_app"
    : "link";

  if (!text && !url) {
    return null;
  }

  return {
    text,
    url,
    type,
  };
}

function normalizePushRow(row) {
  const image = normalizeStoredImage(row?.image);
  const selectedUsers = sanitizeSelectedUsers(row?.selected_users);
  const recipientsCount = Number(row?.recipients_count || 0);
  const deliveredCount = Number(row?.delivered_count || 0);
  const openedCount = Number(row?.opened_count || 0);
  const clickedCount = Number(row?.clicked_count || 0);
  const status = PUSH_STATUS_VALUES.has(row?.status) ? row.status : "template";
  const totalDeliveries = Number(row?.total_deliveries || 0);
  const deliveriesWithMessageIds = Number(row?.deliveries_with_message_ids || 0);
  const revokedDeliveriesCount = Number(row?.revoked_deliveries_count || 0);
  const pendingRevokeCount = Number(row?.pending_revoke_count || 0);
  const button = normalizePushButton({
    buttonText: row?.button_text,
    buttonUrl: row?.button_url,
  });

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
    button: button?.text && button?.url ? button : null,
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
    totalDeliveries,
    deliveriesWithMessageIds,
    revokedDeliveriesCount,
    pendingRevokeCount,
    canRevoke: (status === "sent" || status === "revoked") && pendingRevokeCount > 0,
  };
}

function buildPushSelectQuery(whereClause = "") {
  return `
    SELECT
      pc.*,
      COALESCE(delivery_stats.total_deliveries, 0)::int AS total_deliveries,
      COALESCE(delivery_stats.deliveries_with_message_ids, 0)::int AS deliveries_with_message_ids,
      COALESCE(delivery_stats.revoked_deliveries_count, 0)::int AS revoked_deliveries_count,
      COALESCE(delivery_stats.pending_revoke_count, 0)::int AS pending_revoke_count
    FROM push_campaigns pc
    LEFT JOIN (
      SELECT
        campaign_id,
        COUNT(*)::int AS total_deliveries,
        COUNT(*) FILTER (WHERE message_id IS NOT NULL)::int AS deliveries_with_message_ids,
        COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS revoked_deliveries_count,
        COUNT(*) FILTER (WHERE message_id IS NOT NULL AND deleted_at IS NULL)::int AS pending_revoke_count
      FROM push_deliveries
      GROUP BY campaign_id
    ) AS delivery_stats
      ON delivery_stats.campaign_id = pc.id
    ${whereClause}
  `;
}

async function fetchPushById(executor, pushId) {
  const result = await executor.query(
    `${buildPushSelectQuery("WHERE pc.id = $1")} LIMIT 1`,
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
          AND platform = 'max'
      `,
      [ids],
    );

    return Number(result.rows[0]?.count || 0);
  }

  const result = await executor.query(
    `
      SELECT COUNT(*)::int AS count
      FROM app_users
      WHERE platform = 'max'
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
        SELECT platform_user_id
        FROM app_users
        WHERE id = ANY($1::bigint[])
          AND platform = 'max'
        ORDER BY id ASC
      `,
      [ids],
    );

    return result.rows
      .map((row) => String(row.platform_user_id || "").trim())
      .filter(Boolean);
  }

  const result = await executor.query(
    `
      SELECT platform_user_id
      FROM app_users
      WHERE platform = 'max'
      ORDER BY id ASC
    `,
  );

  return result.rows
    .map((row) => String(row.platform_user_id || "").trim())
    .filter(Boolean);
}

function buildBroadcastHtml(push) {
  const html = String(push.html || "").trim();

  if (html) {
    return formatHtmlForMax(html);
  }

  return formatHtmlForMax(messageToHtml(push.message || ""));
}

function resolveMaxLinkPreviewFlag(push) {
  return push.disableLinkPreview ? false : true;
}

function buildBroadcastPayloadForPush(push) {
  return {
    html: buildBroadcastHtml(push),
    mediaUrls: push.image?.previewUrl ? [push.image.previewUrl] : [],
    button: push.button,
    disablePreview: resolveMaxLinkPreviewFlag(push),
  };
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
  const button = normalizePushButton(payload);

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

  if (button) {
    if (!button.text) {
      throw new Error("Название кнопки обязательно");
    }

    if (!button.url) {
      throw new Error("Укажите корректную ссылку для кнопки");
    }

    if (button.url.length > 2048) {
      throw new Error("Ссылка в кнопке превышает лимит MAX: 2048 символов");
    }
  }

  return {
    title,
    message,
    html: normalizedHtml,
    audienceKey,
    audienceLabel: buildAudienceLabel(audienceKey, selectedUsers, payload?.audienceLabel),
    selectedUsers,
    image: normalizePushImage(payload),
    button,
    disableLinkPreview: Boolean(payload?.disableLinkPreview),
  };
}

export async function listPushes(payload = {}) {
  const search = normalizeSearch(payload?.search);
  const status = String(payload?.status || "all").trim();
  const result = await query(`${buildPushSelectQuery()} ORDER BY COALESCE(pc.sent_at, pc.scheduled_at, pc.created_at) DESC, pc.id DESC`);
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
        item.button?.text,
        item.button?.url,
        ...item.selectedUsers.map((user) => [user.displayName, user.username, user.platform, user.platformUserId, user.telegramUserId].join(" ")),
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
            button_text,
            button_url,
            disable_link_preview,
            status,
            recipients_count,
            delivered_count,
            opened_count,
            clicked_count,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, 'template', $11, 0, 0, 0, NOW())
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
          nextPush.button?.text || "",
          nextPush.button?.url || "",
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

export async function deletePush(payload = {}) {
  const pushId = Number(payload?.pushId) || 0;
  const row = await fetchPushById({ query }, pushId);

  if (!row) {
    throw new Error("Push not found");
  }

  const push = normalizePushRow(row);

  if (push.status !== "template") {
    throw new Error("Нельзя удалить рассылку вне статуса шаблона. Сначала дождитесь отправки или используйте отзыв у получателей.");
  }

  await query("DELETE FROM push_campaigns WHERE id = $1", [push.id]);

  if (push.image) {
    await deleteManagedImage(push.image).catch(() => {});
  }

  return {
    ok: true,
    pushId: push.id,
    title: push.title,
  };
}

export async function preparePushSend(payload = {}) {
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

    if (push.status !== "template") {
      throw new Error("Тестовую отправку можно сделать только для шаблона.");
    }

    return {
      pushId: push.id,
      title: push.title,
      mode,
      recipients: [MAX_PUSH_TEST_USER_ID],
      ...buildBroadcastPayloadForPush(push),
    };
  }

  if (push.status === "scheduled") {
    throw new Error("Эта рассылка уже поставлена в очередь.");
  }

  if (push.status !== "template") {
    throw new Error("Отправить можно только рассылку в статусе шаблона.");
  }

  if (push.status === "template" && !push.testSentAt) {
    throw new Error("Test send is required before live send");
  }

  const recipientIds = await resolveMaxRecipientIds({ query }, push);

  if (recipientIds.length === 0) {
    throw new Error("Нет MAX-пользователей для этой рассылки");
  }

  return {
    pushId: push.id,
    title: push.title,
    mode,
    recipients: recipientIds,
    ...buildBroadcastPayloadForPush(push),
  };
}

export async function finalizePushSend(payload = {}) {
  const pushId = Number(payload?.pushId) || 0;
  const mode = String(payload?.mode || "live").trim().toLowerCase() === "test" ? "test" : "live";
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const row = await fetchPushById({ query }, pushId);

  if (!row) {
    throw new Error("Push not found");
  }

  const push = normalizePushRow(row);

  if (mode === "test") {
    const successfulResult = results.find((item) => item?.ok);

    if (!successfulResult) {
      const firstErrorMessage = results.find((item) => !item?.ok && String(item?.error || "").trim())?.error;
      throw new Error(String(firstErrorMessage || "Тестовая рассылка не была доставлена"));
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
      stats: {
        recipientsCount: 1,
        deliveredCount: 1,
        failedCount: 0,
      },
    };
  }

  const deliveredCount = results.filter((item) => item?.ok).length;
  const failedCount = results.length - deliveredCount;

  if (results.length > 0) {
    const values = [];
    const placeholders = [];

    results.forEach((resultItem, index) => {
      const base = index * 6;
      placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, NOW())`);
      values.push(
        push.id,
        resultItem?.recipientId ? `max:${resultItem.recipientId}` : "",
        String(resultItem?.recipientId || ""),
        Number.isFinite(Number(resultItem?.messageId)) ? Number(resultItem.messageId) : null,
        resultItem?.ok ? "sent" : "send_failed",
        String(resultItem?.error || ""),
      );
    });

    await query(
      `
        INSERT INTO push_deliveries (
          campaign_id,
          user_external_id,
          max_user_id,
          message_id,
          delivery_status,
          error_message,
          updated_at
        )
        VALUES ${placeholders.join(", ")}
      `,
      values,
    );
  }

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
    [push.id, results.length, deliveredCount],
  );

  return {
    push: normalizePushRow(updateResult.rows[0]),
    mode,
    stats: {
      recipientsCount: results.length,
      deliveredCount,
      failedCount,
    },
  };
}

export async function sendPush(payload = {}) {
  const mode = String(payload?.mode || "live").trim().toLowerCase() === "test" ? "test" : "live";
  const prepared = await preparePushSend(payload);

  if (mode === "test") {
    try {
      return await enqueuePushSendJob({
        pushId: prepared.pushId,
        mode,
        waitUntilFinished: true,
      });
    } catch (error) {
      throw decorateTestSendError(error);
    }
  }

  const updateResult = await query(
    `
      UPDATE push_campaigns
      SET status = 'scheduled', scheduled_at = COALESCE(scheduled_at, NOW()), updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [prepared.pushId],
  );

  try {
    await enqueuePushSendJob({
      pushId: prepared.pushId,
      mode,
    });
  } catch (error) {
    await query(
      `
        UPDATE push_campaigns
        SET status = 'template', updated_at = NOW()
        WHERE id = $1
      `,
      [prepared.pushId],
    ).catch(() => {});
    throw error;
  }

  return {
    push: normalizePushRow(updateResult.rows[0]),
    mode,
    queued: true,
  };
}

export async function preparePushRevoke(payload = {}) {
  const pushId = Number(payload?.pushId) || 0;
  const row = await fetchPushById({ query }, pushId);

  if (!row) {
    throw new Error("Push not found");
  }

  const push = normalizePushRow(row);

  if (!push.sentAt) {
    throw new Error("Отзывать можно только уже отправленную рассылку.");
  }

  if (push.deliveriesWithMessageIds <= 0) {
    throw new Error("Для этой рассылки не сохранены messageId, поэтому отозвать её уже нельзя.");
  }

  const deliveriesResult = await query(
    `
      SELECT id, max_user_id, message_id
      FROM push_deliveries
      WHERE campaign_id = $1
        AND message_id IS NOT NULL
        AND deleted_at IS NULL
      ORDER BY id ASC
    `,
    [push.id],
  );
  const deliveries = deliveriesResult.rows;

  if (deliveries.length === 0) {
    throw new Error("У этой рассылки больше нет сообщений, доступных для отзыва.");
  }

  return {
    pushId: push.id,
    title: push.title,
    deliveries: deliveries.map((delivery) => ({
      deliveryId: Number(delivery.id),
      maxUserId: String(delivery.max_user_id || ""),
      messageId: Number(delivery.message_id) || 0,
    })),
  };
}

export async function finalizePushRevoke(payload = {}) {
  const pushId = Number(payload?.pushId) || 0;
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const row = await fetchPushById({ query }, pushId);

  if (!row) {
    throw new Error("Push not found");
  }

  const push = normalizePushRow(row);

  if (!push.sentAt) {
    throw new Error("Отзывать можно только уже отправленную рассылку.");
  }

  for (const item of results) {
    const deliveryId = Number(item?.deliveryId) || 0;

    if (!deliveryId) {
      continue;
    }

    if (item?.ok) {
      await query(
        `
          UPDATE push_deliveries
          SET delivery_status = 'deleted', deleted_at = NOW(), error_message = '', updated_at = NOW()
          WHERE id = $1
        `,
        [deliveryId],
      );
      continue;
    }

    await query(
      `
        UPDATE push_deliveries
        SET delivery_status = 'delete_failed', error_message = $2, updated_at = NOW()
        WHERE id = $1
      `,
      [deliveryId, String(item?.error || "")],
    );
  }

  const revokedCount = results.filter((item) => item?.ok).length;
  const failedCount = results.length - revokedCount;
  const refreshedRow = await fetchPushById({ query }, push.id);
  const refreshedPush = normalizePushRow(refreshedRow);
  const nextStatus = refreshedPush.pendingRevokeCount <= 0 ? "revoked" : "sent";
  const updatedPushResult = await query(
    `
      UPDATE push_campaigns
      SET status = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [push.id, nextStatus],
  );
  const finalRow = await fetchPushById({ query }, Number(updatedPushResult.rows[0].id));

  return {
    ok: true,
    push: normalizePushRow(finalRow),
    stats: {
      revokedCount,
      failedCount,
    },
  };
}

export async function revokePush(payload = {}) {
  const prepared = await preparePushRevoke(payload);
  await enqueuePushRevokeJob({
    pushId: prepared.pushId,
  });

  return {
    ok: true,
    pushId: prepared.pushId,
    title: prepared.title,
    queued: true,
  };
}
