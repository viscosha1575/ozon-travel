const TELEGRAM_BRAND_COLOR = '#e2e7ec'

let bootstrapPromise

function isTelegramWebApp() {
  return typeof window !== 'undefined' && Boolean(window.Telegram?.WebApp)
}

function getTelegramWebApp() {
  return window.Telegram?.WebApp ?? null
}

function toCssDimension(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `${value}px`
  }

  return fallback
}

function bindTelegramCssVars(webApp) {
  const root = document.documentElement
  const safeArea = webApp.safeAreaInset || {}
  const contentSafeArea = webApp.contentSafeAreaInset || safeArea

  root.style.setProperty(
    '--tg-viewport-width',
    toCssDimension(webApp.viewportWidth, `${window.innerWidth}px`),
  )
  root.style.setProperty(
    '--tg-viewport-height',
    toCssDimension(webApp.viewportHeight, `${window.innerHeight}px`),
  )
  root.style.setProperty(
    '--tg-viewport-stable-height',
    toCssDimension(webApp.viewportStableHeight, `${window.innerHeight}px`),
  )
  root.style.setProperty('--tg-safe-area-inset-top', toCssDimension(safeArea.top, '0px'))
  root.style.setProperty(
    '--tg-safe-area-inset-bottom',
    toCssDimension(safeArea.bottom, '0px'),
  )
  root.style.setProperty('--tg-safe-area-inset-left', toCssDimension(safeArea.left, '0px'))
  root.style.setProperty(
    '--tg-safe-area-inset-right',
    toCssDimension(safeArea.right, '0px'),
  )
  root.style.setProperty(
    '--tg-content-safe-area-inset-top',
    toCssDimension(contentSafeArea.top, '0px'),
  )
  root.style.setProperty(
    '--tg-content-safe-area-inset-bottom',
    toCssDimension(contentSafeArea.bottom, '0px'),
  )
  root.style.setProperty(
    '--tg-content-safe-area-inset-left',
    toCssDimension(contentSafeArea.left, '0px'),
  )
  root.style.setProperty(
    '--tg-content-safe-area-inset-right',
    toCssDimension(contentSafeArea.right, '0px'),
  )
}

function syncTelegramUiState(webApp) {
  const root = document.documentElement
  const platform = String(webApp?.platform || '').toLowerCase()

  root.dataset.tgPlatform = platform
  root.dataset.tgExpanded = webApp?.isExpanded ? 'true' : 'false'
  root.dataset.tgFullscreen = webApp?.isFullscreen ? 'true' : 'false'

  bindTelegramCssVars(webApp)
}

function expandTelegramApp(webApp) {
  if (!webApp) {
    return
  }

  try {
    webApp.ready?.()
    webApp.setBackgroundColor?.(TELEGRAM_BRAND_COLOR)
    webApp.setHeaderColor?.(TELEGRAM_BRAND_COLOR)
    webApp.setBottomBarColor?.(TELEGRAM_BRAND_COLOR)
    webApp.expand?.()
    webApp.disableVerticalSwipes?.()
  } catch (error) {
    console.warn('Telegram Mini App initialization failed', error)
  }
}

export function bootstrapTelegram() {
  if (bootstrapPromise) {
    return bootstrapPromise
  }

  bootstrapPromise = (async () => {
    if (!isTelegramWebApp()) {
      return
    }

    try {
      const webApp = getTelegramWebApp()

      if (!webApp) {
        return
      }

      syncTelegramUiState(webApp)

      webApp.onEvent?.('viewportChanged', () => {
        syncTelegramUiState(webApp)
      })
      webApp.onEvent?.('safeAreaChanged', () => {
        syncTelegramUiState(webApp)
      })
      webApp.onEvent?.('contentSafeAreaChanged', () => {
        syncTelegramUiState(webApp)
      })

      expandTelegramApp(webApp)
      syncTelegramUiState(webApp)
    } catch (error) {
      console.warn('Telegram Mini App bootstrap failed', error)
    }
  })()

  return bootstrapPromise
}
