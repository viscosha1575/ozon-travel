const TELEGRAM_BRAND_COLOR = '#e2e7ec'
const BROWSER_HOST = 'browser'
const TELEGRAM_HOST = 'telegram'
const MAX_HOST = 'max'

let bootstrapPromise

function hasValue(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function getTelegramWebApp() {
  return window.Telegram?.WebApp ?? null
}

function getMaxWebApp() {
  return window.WebApp ?? null
}

function extractTelegramInitDataFromLocation() {
  if (typeof window === 'undefined') {
    return ''
  }

  const candidates = []

  if (window.location.hash.startsWith('#')) {
    candidates.push(window.location.hash.slice(1))
  }

  if (window.location.search.startsWith('?')) {
    candidates.push(window.location.search.slice(1))
  }

  for (const candidate of candidates) {
    const params = new URLSearchParams(candidate)
    const initData = params.get('tgWebAppData')

    if (hasValue(initData)) {
      return initData
    }
  }

  return ''
}

function resolveMiniAppHost() {
  if (typeof window === 'undefined') {
    return BROWSER_HOST
  }

  if (hasValue(getTelegramWebApp()?.initData) || hasValue(extractTelegramInitDataFromLocation())) {
    return TELEGRAM_HOST
  }

  if (
    hasValue(getMaxWebApp()?.initData)
    || hasValue(String(getMaxWebApp()?.initDataUnsafe?.user?.id || ''))
  ) {
    return MAX_HOST
  }

  return BROWSER_HOST
}

export function getMiniAppHost() {
  return resolveMiniAppHost()
}

export function isTelegramMiniApp() {
  return getMiniAppHost() === TELEGRAM_HOST
}

export function isMaxMiniApp() {
  return getMiniAppHost() === MAX_HOST
}

export function getMiniApp() {
  if (isTelegramMiniApp()) {
    return getTelegramWebApp()
  }

  if (isMaxMiniApp()) {
    return getMaxWebApp()
  }

  return null
}

export function getMiniAppInitData() {
  if (isTelegramMiniApp()) {
    return String(getTelegramWebApp()?.initData || extractTelegramInitDataFromLocation() || '')
  }

  if (isMaxMiniApp()) {
    return String(getMaxWebApp()?.initData || '')
  }

  return ''
}

export function getMiniAppPlatform() {
  return String(getMiniApp()?.platform || '').trim().toLowerCase()
}

export function getMiniAppViewportWidth() {
  if (typeof window === 'undefined') {
    return 0
  }

  const webApp = getMiniApp()

  return Math.max(
    Number(webApp?.viewportStableWidth) || 0,
    Number(webApp?.viewportWidth) || 0,
    Number(window.innerWidth) || 0,
  )
}

export function getMiniAppViewportHeight() {
  if (typeof window === 'undefined') {
    return 0
  }

  const webApp = getMiniApp()

  return Math.max(
    Number(webApp?.viewportStableHeight) || 0,
    Number(webApp?.viewportHeight) || 0,
    Number(window.innerHeight) || 0,
  )
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
  const host = getMiniAppHost()
  const platform = String(webApp?.platform || '').toLowerCase()

  root.dataset.miniAppHost = host
  root.dataset.miniAppPlatform = platform
  root.dataset.miniAppActive = host === BROWSER_HOST ? 'false' : 'true'
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

function bindBrowserCssVars() {
  syncTelegramUiState({})
}

export function bootstrapMiniApp() {
  if (bootstrapPromise) {
    return bootstrapPromise
  }

  bootstrapPromise = (async () => {
    const host = getMiniAppHost()

    if (host === BROWSER_HOST) {
      bindBrowserCssVars()
      window.addEventListener('resize', bindBrowserCssVars)
      return
    }

    try {
      const webApp = getMiniApp()

      if (!webApp) {
        return
      }

      syncTelegramUiState(webApp)

      const syncState = () => {
        syncTelegramUiState(webApp)
      }

      webApp.onEvent?.('viewportChanged', syncState)
      webApp.onEvent?.('safeAreaChanged', syncState)
      webApp.onEvent?.('contentSafeAreaChanged', syncState)
      window.addEventListener('resize', syncState)

      if (host === TELEGRAM_HOST) {
        expandTelegramApp(webApp)
      }

      syncTelegramUiState(webApp)
    } catch (error) {
      console.warn('Mini App bootstrap failed', error)
    }
  })()

  return bootstrapPromise
}

export function bootstrapTelegram() {
  return bootstrapMiniApp()
}
