const TELEGRAM_BRAND_COLOR = '#e2e7ec'
const BROWSER_HOST = 'browser'
const TELEGRAM_HOST = 'telegram'
const MAX_HOST = 'max'
const TELEGRAM_SDK_URL = 'https://telegram.org/js/telegram-web-app.js'
const TELEGRAM_SDK_SCRIPT_ID = 'telegram-web-app-sdk'
const MAX_SDK_URL = 'https://st.max.ru/js/max-web-app.js'
const MAX_SDK_SCRIPT_ID = 'max-web-app-sdk'

let bootstrapPromise
let telegramSdkPromise
let maxSdkPromise

function hasValue(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isLocalBrowserHost() {
  if (typeof window === 'undefined') {
    return false
  }

  const { hostname } = window.location

  return (
    hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '0.0.0.0'
  )
}

function getTelegramWebApp() {
  return window.Telegram?.WebApp ?? null
}

function getMaxWebApp() {
  return window.WebApp ?? null
}

function normalizeMiniAppUser(user = {}) {
  const platformUserId = String(user?.id || '').trim()

  if (!platformUserId) {
    return null
  }

  return {
    platformUserId,
    username: String(user?.username || '').trim(),
    firstName: String(user?.first_name || user?.firstName || '').trim(),
    lastName: String(user?.last_name || user?.lastName || '').trim(),
    languageCode: String(user?.language_code || user?.languageCode || '').trim(),
  }
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

function extractMaxLaunchParamsFromLocation() {
  if (typeof window === 'undefined' || !window.location.hash.startsWith('#')) {
    return {
      initData: '',
      platform: '',
      version: '',
    }
  }

  const params = new URLSearchParams(window.location.hash.slice(1))

  return {
    initData: String(params.get('WebAppData') || ''),
    platform: String(params.get('WebAppPlatform') || '').trim().toLowerCase(),
    version: String(params.get('WebAppVersion') || '').trim(),
  }
}

function extractMaxInitDataFromLocation() {
  return extractMaxLaunchParamsFromLocation().initData
}

function loadExternalScript({ id, src, resolveValue, errorMessage, cacheKey }) {
  if (resolveValue()) {
    return Promise.resolve(resolveValue())
  }

  if (!cacheKey.current) {
    cacheKey.current = new Promise((resolve, reject) => {
      const existingScript = document.getElementById(id)

      if (existingScript) {
        existingScript.addEventListener('load', () => resolve(resolveValue()), { once: true })
        existingScript.addEventListener('error', () => reject(new Error(errorMessage)), { once: true })
        return
      }

      const script = document.createElement('script')
      script.id = id
      script.src = src
      script.async = true
      script.onload = () => resolve(resolveValue())
      script.onerror = () => reject(new Error(errorMessage))
      document.body.appendChild(script)
    })
  }

  return cacheKey.current
}

function loadTelegramSdk() {
  return loadExternalScript({
    id: TELEGRAM_SDK_SCRIPT_ID,
    src: TELEGRAM_SDK_URL,
    resolveValue: () => getTelegramWebApp(),
    errorMessage: 'Не удалось загрузить Telegram SDK',
    cacheKey: {
      get current() {
        return telegramSdkPromise
      },
      set current(value) {
        telegramSdkPromise = value
      },
    },
  })
}

function loadMaxSdk() {
  return loadExternalScript({
    id: MAX_SDK_SCRIPT_ID,
    src: MAX_SDK_URL,
    resolveValue: () => getMaxWebApp(),
    errorMessage: 'Не удалось загрузить MAX SDK',
    cacheKey: {
      get current() {
        return maxSdkPromise
      },
      set current(value) {
        maxSdkPromise = value
      },
    },
  })
}

function shouldAttemptTelegramSdkLoad() {
  if (typeof window === 'undefined') {
    return false
  }

  return hasValue(extractTelegramInitDataFromLocation()) || Boolean(getTelegramWebApp())
}

function shouldAttemptMaxSdkLoad() {
  if (typeof window === 'undefined') {
    return false
  }

  if (getMaxWebApp() || hasValue(extractMaxInitDataFromLocation())) {
    return true
  }

  const referrer = String(document.referrer || '').toLowerCase()

  return referrer.includes('max.ru') || window.self !== window.top
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
    || hasValue(extractMaxInitDataFromLocation())
    || hasValue(extractMaxLaunchParamsFromLocation().platform)
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

export function openExternalLink(url) {
  const normalizedUrl = String(url || '').trim()

  if (!normalizedUrl || typeof window === 'undefined') {
    return
  }

  const miniApp = getMiniApp()

  if (typeof miniApp?.openLink === 'function') {
    try {
      miniApp.openLink(normalizedUrl)
      return
    } catch (error) {
      console.warn('Failed to open external link with mini app SDK', error)
    }
  }

  window.location.assign(normalizedUrl)
}

export function getMiniAppInitData() {
  if (isTelegramMiniApp()) {
    return String(getTelegramWebApp()?.initData || extractTelegramInitDataFromLocation() || '')
  }

  if (isMaxMiniApp()) {
    return String(getMaxWebApp()?.initData || extractMaxInitDataFromLocation() || '')
  }

  return ''
}

export function getMiniAppUser() {
  if (isTelegramMiniApp()) {
    return normalizeMiniAppUser(getTelegramWebApp()?.initDataUnsafe?.user)
  }

  if (isMaxMiniApp()) {
    return normalizeMiniAppUser(getMaxWebApp()?.initDataUnsafe?.user)
  }

  return null
}

export function getMiniAppPlatform() {
  if (isMaxMiniApp()) {
    return String(getMaxWebApp()?.platform || extractMaxLaunchParamsFromLocation().platform || '').trim().toLowerCase()
  }

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
    const sdkLoaders = []

    if (shouldAttemptTelegramSdkLoad()) {
      sdkLoaders.push(loadTelegramSdk())
    }

    if (shouldAttemptMaxSdkLoad()) {
      sdkLoaders.push(loadMaxSdk())
    }

    if (sdkLoaders.length) {
      await Promise.allSettled(sdkLoaders)
    }

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
