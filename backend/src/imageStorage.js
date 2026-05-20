import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const DEFAULT_BACKEND_PUBLIC_URL = `http://localhost:${Number(process.env.PORT || 3001)}`;
const DEFAULT_FRONTEND_PUBLIC_URL = "http://localhost:4173";
const uploadsDir = path.resolve(process.env.UPLOADS_DIR || path.join(process.cwd(), "uploads"));
const backendPublicUrl = normalizeBaseUrl(process.env.BACKEND_PUBLIC_URL || DEFAULT_BACKEND_PUBLIC_URL);
const frontendPublicUrl = normalizeBaseUrl(process.env.FRONTEND_PUBLIC_URL || DEFAULT_FRONTEND_PUBLIC_URL);

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/g, "");
}

function isDataUrl(value) {
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(String(value || ""));
}

function getSourceExtension(mimeType) {
  switch (mimeType) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "bin";
  }
}

function sanitizeDisplayName(name) {
  const baseName = path.basename(String(name || "image")).replace(/\.[^.]+$/u, "");
  const safeBaseName = baseName
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "");

  return `${safeBaseName || "image"}.webp`;
}

function buildBackendImageUrl(fileName) {
  return `${backendPublicUrl}/uploads/${encodeURIComponent(fileName)}`;
}

function absolutizeImageUrl(url) {
  const value = String(url || "").trim();

  if (!value) {
    return "";
  }

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  if (value.startsWith("/uploads/")) {
    return `${backendPublicUrl}${value}`;
  }

  if (value.startsWith("/")) {
    return `${frontendPublicUrl}${value}`;
  }

  return value;
}

function decodeDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/i);

  if (!match) {
    throw new Error("Unsupported image payload");
  }

  return {
    mimeType: match[1].toLowerCase(),
    buffer: Buffer.from(match[2], "base64"),
  };
}

function resolveManagedFileName(image) {
  const previewUrl = String(image?.previewUrl || "").trim();

  if (!previewUrl) {
    return null;
  }

  try {
    const parsedUrl = new URL(absolutizeImageUrl(previewUrl));
    const backendOrigin = new URL(`${backendPublicUrl}/`).origin;

    if (parsedUrl.origin !== backendOrigin || !parsedUrl.pathname.startsWith("/uploads/")) {
      return null;
    }

    return decodeURIComponent(path.basename(parsedUrl.pathname));
  } catch {
    if (!previewUrl.startsWith("/uploads/")) {
      return null;
    }

    return decodeURIComponent(path.basename(previewUrl));
  }
}

function resolveManagedFilePath(fileName) {
  const safeName = path.basename(String(fileName || ""));
  const filePath = path.resolve(uploadsDir, safeName);

  if (filePath !== path.join(uploadsDir, safeName)) {
    throw new Error("Invalid image path");
  }

  return filePath;
}

async function removeFileIfExists(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

async function writeWebpFromDataUrl(nextImage) {
  const { mimeType, buffer } = decodeDataUrl(nextImage.previewUrl);
  const fileId = crypto.randomUUID();
  const sourcePath = resolveManagedFilePath(`${fileId}.${getSourceExtension(mimeType)}`);
  const targetFileName = `${fileId}.webp`;
  const targetPath = resolveManagedFilePath(targetFileName);

  await fs.writeFile(sourcePath, buffer);

  try {
    await sharp(sourcePath)
      .rotate()
      .webp({ quality: 90, effort: 4 })
      .toFile(targetPath);
  } finally {
    await removeFileIfExists(sourcePath);
  }

  return {
    name: sanitizeDisplayName(nextImage.name),
    previewUrl: buildBackendImageUrl(targetFileName),
  };
}

export async function initImageStorage() {
  await fs.mkdir(uploadsDir, { recursive: true });
}

export function getUploadsDir() {
  return uploadsDir;
}

export function normalizeStoredImage(image) {
  if (!image?.previewUrl) {
    return null;
  }

  return {
    name: String(image.name || path.basename(String(image.previewUrl || "")) || "image.webp").trim(),
    previewUrl: absolutizeImageUrl(image.previewUrl),
  };
}

export async function deleteManagedImage(image) {
  const fileName = resolveManagedFileName(image);

  if (!fileName) {
    return;
  }

  await removeFileIfExists(resolveManagedFilePath(fileName));
}

export async function storeRouletteImage(nextImage, currentImage = null) {
  const normalizedCurrentImage = normalizeStoredImage(currentImage);

  if (!nextImage?.previewUrl) {
    return {
      image: null,
      cleanupImage: normalizedCurrentImage,
      uploadedImage: null,
    };
  }

  if (!isDataUrl(nextImage.previewUrl)) {
    const normalizedImage = normalizeStoredImage(nextImage);
    const shouldCleanupCurrentImage =
      normalizedCurrentImage?.previewUrl
      && normalizedCurrentImage.previewUrl !== normalizedImage?.previewUrl;

    return {
      image: normalizedImage,
      cleanupImage: shouldCleanupCurrentImage ? normalizedCurrentImage : null,
      uploadedImage: null,
    };
  }

  await initImageStorage();

  const uploadedImage = await writeWebpFromDataUrl(nextImage);

  return {
    image: uploadedImage,
    cleanupImage: normalizedCurrentImage,
    uploadedImage,
  };
}
