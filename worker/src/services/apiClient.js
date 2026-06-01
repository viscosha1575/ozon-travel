import axios from "axios";
import crypto from "crypto";
import { GAME_API_URL, REQUEST_BODY_SECRET, REQUIRE_ENCRYPTED_REQUESTS } from "../config.js";

function encryptBody(body) {
  if (!REQUEST_BODY_SECRET) {
    throw new Error("REQUEST_BODY_SECRET is not set");
  }

  const iv = crypto.randomBytes(12);
  const key = crypto.createHash("sha256").update(REQUEST_BODY_SECRET).digest();
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(body), "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    payload: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

export async function post(path, body = {}) {
  const normalizedPath = String(path || "").trim();
  const payload = REQUIRE_ENCRYPTED_REQUESTS ? encryptBody(body) : body;

  return axios.post(`${GAME_API_URL}${normalizedPath}`, payload, {
    headers: {
      "Content-Type": "application/json",
    },
    timeout: 60000,
  });
}
