const REQUEST_BODY_SECRET = String(
  import.meta.env.REQUEST_BODY_SECRET || import.meta.env.VITE_REQUEST_BODY_SECRET || ""
).trim();

function bytesToBase64(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

export async function prepareRequestBody(body) {
  if (!REQUEST_BODY_SECRET) {
    return body ?? {};
  }

  const encoder = new TextEncoder();
  const secretBytes = encoder.encode(REQUEST_BODY_SECRET);
  const secretHash = await crypto.subtle.digest("SHA-256", secretBytes);
  const key = await crypto.subtle.importKey(
    "raw",
    secretHash,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(JSON.stringify(body ?? {}))
  );

  const encryptedBytes = new Uint8Array(encrypted);
  const authTag = encryptedBytes.slice(encryptedBytes.length - 16);
  const payload = encryptedBytes.slice(0, encryptedBytes.length - 16);

  return {
    payload: bytesToBase64(payload),
    iv: bytesToBase64(iv),
    authTag: bytesToBase64(authTag),
  };
}
