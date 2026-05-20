import crypto from "node:crypto";

function base64ToBuffer(value) {
  return Buffer.from(String(value || ""), "base64");
}

export function decodeRequestBody(body = {}, secret = "") {
  const normalizedSecret = String(secret || "").trim();

  if (!normalizedSecret) {
    return body ?? {};
  }

  if (!body?.payload || !body?.iv || !body?.authTag) {
    return body ?? {};
  }

  const key = crypto.createHash("sha256").update(normalizedSecret).digest();
  const iv = base64ToBuffer(body.iv);
  const authTag = base64ToBuffer(body.authTag);
  const encrypted = base64ToBuffer(body.payload);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);

  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString("utf8");

  return JSON.parse(decrypted || "{}");
}
