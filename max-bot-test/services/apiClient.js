import axios from 'axios';
import crypto from 'crypto';

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

const API_BASE_URL = normalizeBaseUrl(process.env.GAME_API_URL || 'http://localhost:3000');
const REQUEST_BODY_SECRET = process.env.REQUEST_BODY_SECRET || '';
const REQUIRE_ENCRYPTED_REQUESTS = process.env.REQUIRE_ENCRYPTED_REQUESTS === 'true';
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN || process.env.BROADCAST_INTERNAL_TOKEN || REQUEST_BODY_SECRET || '';
const SHOULD_ENCRYPT_REQUESTS = REQUIRE_ENCRYPTED_REQUESTS;

function encryptBody(body) {
  if (!REQUEST_BODY_SECRET) {
    throw new Error('REQUEST_BODY_SECRET is not set');
  }

  const iv = crypto.randomBytes(12);
  const key = crypto.createHash('sha256').update(REQUEST_BODY_SECRET).digest();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(body), 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return {
    payload: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

async function post(path, body = {}, options = {}) {
  const targetBaseUrl = normalizeBaseUrl(options.apiBaseUrl) || API_BASE_URL;
  const payload = SHOULD_ENCRYPT_REQUESTS ? encryptBody(body) : body;
  const headers = {
    'Content-Type': 'application/json',
  };

  if (INTERNAL_API_TOKEN) {
    headers['x-internal-token'] = INTERNAL_API_TOKEN;
  }

  return axios.post(`${targetBaseUrl}${path}`, payload, {
    headers,
  });
}

export {
  API_BASE_URL,
  post,
};
