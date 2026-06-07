import {
  GT_EESTI_MEDIUM_DATA_URL,
  GT_EESTI_REGULAR_DATA_URL,
} from "./embeddedFontData.js"
import { logDevWarn } from "./devLogger.js"

const EMBEDDED_PAGE_CACHE = new Map()
const EMBEDDED_PAGE_CLOSE_EVENT = "ozon-travel-embedded-page-close"

function getEmbeddedSafeBottomValue() {
  if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") {
    return "env(safe-area-inset-bottom, 0px)"
  }

  const value = window.getComputedStyle(document.documentElement).getPropertyValue("--app-safe-bottom").trim()
  return value || "env(safe-area-inset-bottom, 0px)"
}

function escapeAttribute(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

function buildHeadInjection(url, title) {
  const regularFontUrl = escapeAttribute(GT_EESTI_REGULAR_DATA_URL)
  const mediumFontUrl = escapeAttribute(GT_EESTI_MEDIUM_DATA_URL)
  const safeBottomValue = escapeAttribute(getEmbeddedSafeBottomValue())

  return [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`,
    `<base href="${escapeAttribute(url)}">`,
    title ? `<title>${escapeHtml(title)}</title>` : "",
    `<style>
      @font-face {
        font-family: "GT Eesti Pro Display";
        src: url("${regularFontUrl}") format("woff2");
        font-weight: 400;
        font-style: normal;
        font-display: swap;
      }

      @font-face {
        font-family: "GT Eesti Pro Display";
        src: url("${mediumFontUrl}") format("opentype");
        font-weight: 500;
        font-style: normal;
        font-display: swap;
      }

      html {
        background: #fff;
        -webkit-text-size-adjust: 100%;
        text-size-adjust: 100%;
        --embedded-safe-bottom: ${safeBottomValue};
        --app-button-font-size: clamp(16px, 4.3vw, 17px);
        --font-weight-semibold: 500;
        font-family: "GT Eesti Pro Display", "Segoe UI", sans-serif;
      }

      body {
        margin: 0;
        background: #fff;
        color: #070707;
        padding-bottom: calc(83px + var(--embedded-safe-bottom));
        font-family: "GT Eesti Pro Display", "Segoe UI", sans-serif;
      }

      body > h1 {
        margin: 0;
        padding: 18px 16px 24px;
        font-size: 0.9425rem;
        line-height: 1.12;
      }

      #Content {
        box-sizing: border-box;
        width: 100%;
        padding: 0 16px calc(24px + var(--embedded-safe-bottom)) !important;
      }

      .embedded-page-close {
        position: fixed;
        left: 50%;
        bottom: calc(23px + var(--embedded-safe-bottom));
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        width: min(272px, calc(100vw - 40px));
        height: 60px;
        padding: 8px 18px;
        border: 0;
        border-radius: 14px;
        background: linear-gradient(180deg, #1d69f8 0%, #155cf0 100%);
        color: #fff;
        font-family: "GT Eesti Pro Display", "Segoe UI", sans-serif;
        font-size: var(--app-button-font-size);
        font-weight: var(--font-weight-semibold);
        line-height: 1;
        letter-spacing: 0.17px;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        transform: translateX(-50%);
        box-shadow:
          0 14px 28px rgba(21, 92, 240, 0.24),
          inset 0 1px 0 rgba(255, 255, 255, 0.16);
      }

      img,
      svg,
      table {
        max-width: 100%;
      }
    </style>`,
  ].filter(Boolean).join("")
}

function injectHead(html, injection) {
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${injection}`)
  }

  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${injection}</head>`)
  }

  return `<!doctype html><html><head>${injection}</head><body>${html}</body></html>`
}

function injectCloseButton(html) {
  const closeButtonHtml = `
<button type="button" class="embedded-page-close" onclick="window.parent.postMessage({ type: '${EMBEDDED_PAGE_CLOSE_EVENT}' }, '*')">
  Закрыть
</button>`

  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${closeButtonHtml}</body>`)
  }

  return `${html}${closeButtonHtml}`
}

function ensureDocumentTitle(html, title) {
  if (!title || /<title>.*<\/title>/i.test(html)) {
    return html
  }

  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1><title>${escapeHtml(title)}</title>`)
  }

  return html
}

function buildErrorDocument(title, message) {
  const safeTitle = escapeHtml(title || "Условия акции")
  const safeMessage = escapeHtml(message || "Не удалось загрузить страницу.")

  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>${safeTitle}</title>
    <style>
      html {
        background: #fff;
        color: #070707;
        font-family: "GT Eesti Pro Display", "Segoe UI", sans-serif;
      }

      body {
        margin: 0;
        min-height: 100vh;
        padding: 24px 16px;
        box-sizing: border-box;
      }

      h1 {
        margin: 0 0 12px;
        font-size: 24px;
        line-height: 1.15;
      }

      p {
        margin: 0;
        font-size: 16px;
        line-height: 1.45;
      }
    </style>
  </head>
  <body>
    <h1>${safeTitle}</h1>
    <p>${safeMessage}</p>
  </body>
</html>`
}

export function createLoadingDocument(title) {
  const safeTitle = escapeHtml(title || "Условия акции")

  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>${safeTitle}</title>
    <style>
      html {
        background: #fff;
        color: #070707;
        font-family: "GT Eesti Pro Display", "Segoe UI", sans-serif;
      }

      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px 16px;
        box-sizing: border-box;
      }

      p {
        margin: 0;
        font-size: 16px;
        line-height: 1.45;
      }
    </style>
  </head>
  <body>
    <p>Загружаем страницу…</p>
  </body>
</html>`
}

export async function loadEmbeddedPageDocument(url, title) {
  const normalizedUrl = String(url || "").trim()

  if (!normalizedUrl) {
    return buildErrorDocument(title, "Не удалось подготовить ссылку.")
  }

  if (EMBEDDED_PAGE_CACHE.has(normalizedUrl)) {
    return EMBEDDED_PAGE_CACHE.get(normalizedUrl)
  }

  try {
    const response = await fetch(normalizedUrl, {
      credentials: "omit",
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const rawHtml = await response.text()
    const injectedHtml = injectCloseButton(
      injectHead(
        ensureDocumentTitle(rawHtml, title),
        buildHeadInjection(normalizedUrl, title),
      ),
    )

    EMBEDDED_PAGE_CACHE.set(normalizedUrl, injectedHtml)
    return injectedHtml
  } catch (error) {
    logDevWarn("Failed to load embedded page document", error)
    return buildErrorDocument(title, "Не удалось загрузить страницу. Попробуйте позже.")
  }
}

export { EMBEDDED_PAGE_CLOSE_EVENT }
