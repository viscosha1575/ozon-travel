import { startTransition, useCallback, useEffect, useRef, useState } from "react"

import { postJson, trackGameEvent } from "../api.js"
import { buildBootstrapAssetVersion } from "../bootstrapAssets.js"
import { logDevWarn } from "../devLogger.js"
import { fetchGameBootstrap, getBootstrapAssetVersion } from "../gameBootstrap.js"
import { resolveCachedImageSource, useCachedImageSources } from "../imageCache.js"
import {
  getMiniApp,
  openExternalLink,
  getMiniAppViewportHeight,
  getMiniAppViewportWidth,
} from "../telegram.js"

const LEFT_TRIANGLE_PATH = "/game/left-triangle.svg"
const RIGHT_TRIANGLE_PATH = "/game/rigth-triangle.svg"
const CENTER_PATTERN_PATH = "/game/center.webp"
const SURFACE_ANIMATION_DURATION = 420
const SPIN_MIN_FULL_LOOPS = 3
const SPIN_MAX_FULL_LOOPS = 4
const SPIN_MIN_DURATION = 8400
const SPIN_MAX_DURATION = 12800
const SPIN_SCREENFULS_PER_SECOND = 0.58
const SPIN_DISTANCE_SLOWDOWN_RATIO = 0.7
const MOBILE_SPIN_DISTANCE_MULTIPLIER = 0.5
const MOBILE_SPIN_DURATION_MULTIPLIER = 0.82
const SLOT_GAP = 24
const TRACK_CENTER_OFFSET = 9
const TRACK_VISIBLE_START_OFFSET = TRACK_CENTER_OFFSET - 1
const TRACK_TAIL_BUFFER = 3
const RESULT_REVEAL_DELAY = 72
const RESULT_BAG_ANIMATION_DURATION = 980
const RESULT_BAG_ANIMATION_EASING = "cubic-bezier(0.18, 0.82, 0.22, 1)"
const RESULT_COPY_TOAST_EXIT_DURATION = 460
const RESULT_COPY_TOAST_VISIBLE_DURATION = 3000
const RESULT_BAG_FINAL_SCALE_MULTIPLIER = 1.3
const NON_PRIZE_RESULT_FINAL_SCALE_MULTIPLIER = 1.24
const SPIN_TRANSITION_EASING = "cubic-bezier(0.22, 0.72, 0.3, 1)"
const IDLE_SPIN_CYCLE_DURATION = 36000
const BOOTSTRAP_CACHE_KEY = "ozon-travel-bootstrap-cache"
const BOOTSTRAP_CACHE_SCHEMA_VERSION = 3
const PENDING_SPIN_RECOVERY_KEY = "ozon-travel-pending-spin"
const PENDING_SPIN_RECOVERY_SCHEMA_VERSION = 1
const PENDING_SPIN_RECOVERY_MAX_AGE_MS = 30 * 60 * 1000
const NON_PRIZE_COPY = "А ваш багаж прилетит следующим рейсом.\nВозвращайтесь за ним позже!"
const REFERRAL_SHARE_MESSAGE = [
  "100 000 баллов Ozon и выгодные промокоды на путешествия ждут на Ленте призов!",
  "",
  "Скорее летим забирать!",
].join("\n")
const IMPORTANT_INFO_URL = "https://cdn1.ozone.ru/s3/promo-sync-api/1077004356.html?v=20260608-5"
const IMPORTANT_INFO_TITLE = "Условия акции"
const OZON_TRAVEL_APP_URL = "https://www.ozon.ru/travel/?utm_source=telegram&utm_medium=special_project&utm_campaign=oztravel_06_26_lenta_prizov_promo_activation"
const DEFAULT_ROULETTE_IMAGE_PATH = "/game/bags/case.webp"
const SUPPORT_CONTACT = String(import.meta.env.VITE_SUPPORT_CONTACT || "@ozon_travel_support_bot").trim()
const DEFAULT_ERROR_MESSAGE = "Что-то пошло не так. Попробуйте еще раз."
const RESULT_PREVIEW_TARGET_WIDTH_PX = 326.4
const NON_PRIZE_RESULT_PREVIEW_SCALE_FACTOR = 0.94
const EMBEDDED_PAGE_CLOSE_EVENT = "ozon-travel-embedded-page-close"
const TOP_BANNER_ACTIONS = [
  { id: "question", icon: "/game/icons/question.svg", label: "Вопрос" },
  { id: "exclamation", icon: "/game/icons/exclamation.svg", label: "Важно" },
  { id: "gift", icon: "/game/icons/gift.svg", label: "Подарки" },
]
const EMPTY_ITEMS = []
let embeddedPageModulePromise = null
const getLoopedIndex = (value, length) => ((value % length) + length) % length
const normalizeEntityId = (value) => String(value ?? "").trim()

function loadEmbeddedPageModule() {
  if (!embeddedPageModulePromise) {
    embeddedPageModulePromise = import("../embeddedPage.js")
  }

  return embeddedPageModulePromise
}

function roundToDevicePixel(value) {
  const ratio = typeof window !== "undefined" && Number(window.devicePixelRatio) > 0
    ? Number(window.devicePixelRatio)
    : 1

  return Math.round(Number(value || 0) * ratio) / ratio
}

function isMobileSpinViewport() {
  if (typeof window === "undefined") {
    return false
  }

  const viewportWidth = getMiniAppViewportWidth()

  return viewportWidth > 0 && viewportWidth <= 768
}

function getSpinDistanceMultiplier() {
  return isMobileSpinViewport()
    ? MOBILE_SPIN_DISTANCE_MULTIPLIER
    : 1
}

function getSpinDurationMs(totalSteps, step) {
  const safeTotalSteps = Math.max(0, Number(totalSteps) || 0)
  const safeStep = Math.max(0, Number(step) || 0)
  const viewportHeight = typeof window !== "undefined"
    ? Math.max(getMiniAppViewportHeight(), 1)
    : 1
  const distancePx = safeTotalSteps * safeStep
  const durationByViewport = distancePx > 0
    ? (distancePx / (viewportHeight * SPIN_SCREENFULS_PER_SECOND)) * 1000
    : SPIN_MIN_DURATION
  const normalizedDuration = durationByViewport * (
    isMobileSpinViewport()
      ? MOBILE_SPIN_DURATION_MULTIPLIER
      : 1
  )

  return Math.round(Math.min(SPIN_MAX_DURATION, Math.max(SPIN_MIN_DURATION, normalizedDuration)))
}

function formatAttemptsLabel(value) {
  const count = Math.max(0, Number(value) || 0)
  const remainder10 = count % 10
  const remainder100 = count % 100

  if (remainder10 === 1 && remainder100 !== 11) {
    return `${count} попытка`
  }

  if (remainder10 >= 2 && remainder10 <= 4 && (remainder100 < 12 || remainder100 > 14)) {
    return `${count} попытки`
  }

  return `${count} попыток`
}

function withAssetVersion(url, assetVersion) {
  const value = String(url || "").trim()
  const normalizedAssetVersion = getBootstrapAssetVersion(assetVersion)

  if (!value || !normalizedAssetVersion) {
    return value
  }

  try {
    const nextUrl = new URL(value, "http://localhost")
    nextUrl.searchParams.set("v", normalizedAssetVersion)

    if (/^https?:\/\//i.test(value)) {
      return nextUrl.toString()
    }

    return `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`
  } catch {
    return value
  }
}

function getReadableErrorMessage(error, fallback = DEFAULT_ERROR_MESSAGE) {
  const rawMessage = String(error?.message || error || "").trim()

  if (!rawMessage) {
    return fallback
  }

  const normalizedMessage = rawMessage.toLowerCase()

  if (
    normalizedMessage === "request failed"
    || normalizedMessage === "failed to fetch"
    || normalizedMessage.includes("networkerror")
  ) {
    return "Не удалось выполнить запрос. Попробуйте еще раз."
  }

  if (/^[\n\r\t -~]+$/.test(rawMessage)) {
    return fallback
  }

  return rawMessage
}

function readBootstrapCache() {
  if (typeof window === "undefined") {
    return null
  }

  try {
    const rawValue = window.sessionStorage.getItem(BOOTSTRAP_CACHE_KEY)

    if (!rawValue) {
      return null
    }

    const parsedValue = JSON.parse(rawValue)

    if (Number(parsedValue?.schemaVersion || 0) !== BOOTSTRAP_CACHE_SCHEMA_VERSION) {
      window.sessionStorage.removeItem(BOOTSTRAP_CACHE_KEY)
      return null
    }

    return parsedValue
  } catch {
    try {
      window.sessionStorage.removeItem(BOOTSTRAP_CACHE_KEY)
    } catch {
      // Ignore sessionStorage failures.
    }
  }

  return null
}

function getPersistentStorage() {
  if (typeof window === "undefined") {
    return null
  }

  try {
    return window.localStorage
  } catch {
    try {
      return window.sessionStorage
    } catch {
      return null
    }
  }
}

function writeBootstrapCache(payload) {
  if (typeof window === "undefined") {
    return
  }

  try {
    if (!payload || typeof payload !== "object") {
      window.sessionStorage.removeItem(BOOTSTRAP_CACHE_KEY)
      return
    }

    window.sessionStorage.setItem(BOOTSTRAP_CACHE_KEY, JSON.stringify(payload))
  } catch {
    // Ignore sessionStorage failures.
  }
}

function readPendingSpinRecovery() {
  const storage = getPersistentStorage()

  if (!storage) {
    return null
  }

  try {
    const rawValue = storage.getItem(PENDING_SPIN_RECOVERY_KEY)

    if (!rawValue) {
      return null
    }

    const parsedValue = JSON.parse(rawValue)
    const schemaVersion = Number(parsedValue?.schemaVersion || 0)
    const createdAt = Number(parsedValue?.createdAt || 0)

    if (schemaVersion !== PENDING_SPIN_RECOVERY_SCHEMA_VERSION) {
      storage.removeItem(PENDING_SPIN_RECOVERY_KEY)
      return null
    }

    if (!createdAt || (Date.now() - createdAt) > PENDING_SPIN_RECOVERY_MAX_AGE_MS) {
      storage.removeItem(PENDING_SPIN_RECOVERY_KEY)
      return null
    }

    return parsedValue
  } catch {
    try {
      storage.removeItem(PENDING_SPIN_RECOVERY_KEY)
    } catch {
      // Ignore storage failures.
    }
  }

  return null
}

function writePendingSpinRecovery(payload) {
  const storage = getPersistentStorage()

  if (!storage) {
    return
  }

  try {
    if (!payload || typeof payload !== "object") {
      storage.removeItem(PENDING_SPIN_RECOVERY_KEY)
      return
    }

    storage.setItem(PENDING_SPIN_RECOVERY_KEY, JSON.stringify({
      schemaVersion: PENDING_SPIN_RECOVERY_SCHEMA_VERSION,
      createdAt: Date.now(),
      ...payload,
    }))
  } catch {
    // Ignore storage failures.
  }
}

function clearPendingSpinRecovery() {
  const storage = getPersistentStorage()

  if (!storage) {
    return
  }

  try {
    storage.removeItem(PENDING_SPIN_RECOVERY_KEY)
  } catch {
    // Ignore storage failures.
  }
}

function buildReferralShareText(referralLink) {
  const normalizedReferralLink = String(referralLink || "").trim()

  return [REFERRAL_SHARE_MESSAGE, normalizedReferralLink].filter(Boolean).join("\n\n")
}

function buildMaxShareLink(text) {
  return `https://max.ru/:share?text=${encodeURIComponent(String(text || "").trim())}`
}

function buildSupportLink(contact) {
  const value = String(contact || "").trim()

  if (!value) {
    return ""
  }

  if (/^https?:\/\//i.test(value)) {
    return value
  }

  return `https://max.ru/${value.replace(/^@+/, "")}`
}

function normalizeRouletteItems(items, assetVersion) {
  if (!Array.isArray(items) || !items.length) {
    return []
  }

  return items.map((item, index) => ({
    id: item.id ?? index,
    key: `roulette-item-${item.id ?? index}-${assetVersion}`,
    assetVersion,
    slotPath: withAssetVersion(item.image, assetVersion),
    path: withAssetVersion(item.image, assetVersion),
    label: item.title || `item-${index}`,
    title: item.title || "",
    description: item.description || "",
    myPrizeText: item.myPrizeText || item.title || "",
    expiresAt: item.expiresAt || "",
    chanceValue: item.chanceValue || "1x",
    type: item.type || "Приз",
  }))
}

function normalizeMyPrizes(items, assetVersion) {
  if (!Array.isArray(items) || !items.length) {
    return []
  }

  return items.map((item) => ({
    ...item,
    myPrizeText: item.myPrizeText || item.title || "",
    assetVersion,
    image: withAssetVersion(item.image, assetVersion),
  }))
}

function normalizeSpinId(value) {
  const normalizedValue = Number(value)

  if (!Number.isInteger(normalizedValue) || normalizedValue <= 0) {
    return null
  }

  return normalizedValue
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isValidSpinResultPayload(result) {
  if (!isPlainObject(result)) {
    return false
  }

  const positionId = normalizeEntityId(result.positionId)
  const type = String(result.type || "").trim()
  const title = String(result.myPrizeText || result.title || "").trim()

  return Boolean(positionId && type && title)
}

function isValidSpinResponsePayload(response) {
  if (!isPlainObject(response)) {
    return false
  }

  return Boolean(
    normalizeSpinId(response?.spin?.id)
    && isValidSpinResultPayload(response?.result)
    && Array.isArray(response?.myPrizes)
    && isPlainObject(response?.attempts)
  )
}

async function fetchSpinResultById(spinId) {
  const normalizedSpinId = normalizeSpinId(spinId)

  if (!normalizedSpinId) {
    throw new Error("spinId is required")
  }

  return postJson("/game/spin/result", {
    spinId: normalizedSpinId,
  })
}

function renderResultDescription(description, isNonPrize, toneClassName = "") {
  const text = String(description || "").trim()
  const className = `game-result-description ${toneClassName}`.trim()

  if (!text) {
    return <p className={className}>Описание позиции появится после настройки в админке.</p>
  }

  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)

  return (
    <div className="game-result-description-stack">
      {paragraphs.map((paragraph) => {
        const explicitLines = paragraph
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
        const lines = explicitLines.length ? explicitLines : [paragraph]

        return (
        <p
          key={paragraph}
          className={`${className} game-result-description--paragraph`.trim()}
        >
          {lines.map((line) => (
            <span key={line} className="game-result-description-line">{line}</span>
          ))}
        </p>
        )
      })}
    </div>
  )
}

function buildResultBag(result, rouletteItems) {
  if (!result) {
    return null
  }

  const normalizedPositionId = normalizeEntityId(result.positionId)
  const matchedItem = Array.isArray(rouletteItems)
    ? rouletteItems.find((item) => normalizeEntityId(item.id) === normalizedPositionId)
    : null
  const visualPath = matchedItem?.path || matchedItem?.slotPath || result.image || ""

  return {
    id: result.positionId ?? matchedItem?.id ?? null,
    key: matchedItem?.key || `result-${result.positionId ?? "item"}`,
    assetVersion: matchedItem?.assetVersion || 0,
    path: visualPath,
    slotPath: visualPath,
    label: result.fullTitle || result.title || matchedItem?.label || `result-${result.positionId ?? "item"}`,
    title: result.fullTitle || result.title || matchedItem?.title || "",
    description: result.description || matchedItem?.description || "",
    myPrizeText: result.myPrizeText || matchedItem?.myPrizeText || result.title || "",
    expiresAt: result.expiresAt || matchedItem?.expiresAt || "",
    chanceValue: matchedItem?.chanceValue || "1x",
    type: result.type || matchedItem?.type || "Приз",
  }
}

function buildResultPrize(result, fallbackBag) {
  if (!result && !fallbackBag) {
    return null
  }

  return {
    positionId: result?.positionId ?? fallbackBag?.id ?? null,
    type: result?.type || fallbackBag?.type || "Приз",
    title: result?.title || fallbackBag?.title || "",
    myPrizeText: result?.myPrizeText || fallbackBag?.myPrizeText || result?.title || fallbackBag?.title || "",
    description: result?.description || fallbackBag?.description || "",
    image: result?.image || fallbackBag?.path || "",
    promoCode: result?.promoCode || "",
    expiresAt: result?.expiresAt || fallbackBag?.expiresAt || "",
  }
}

function createTrackItems(rouletteItems, centerBagIndex, totalSteps) {
  if (!rouletteItems.length) {
    return []
  }

  const length = TRACK_CENTER_OFFSET + totalSteps + TRACK_TAIL_BUFFER

  return Array.from({ length }, (_, index) => {
    const bagIndex = getLoopedIndex(centerBagIndex + index - TRACK_CENTER_OFFSET, rouletteItems.length)
    return rouletteItems[bagIndex]
  })
}

function getTrackWindowSteps(rouletteItemsLength) {
  return Math.max(rouletteItemsLength + TRACK_TAIL_BUFFER, TRACK_CENTER_OFFSET + TRACK_TAIL_BUFFER + 6)
}

function collectUniqueImagePaths(...groups) {
  const uniquePaths = new Set()

  groups.flat().forEach((value) => {
    const normalizedValue = String(value || "").trim()

    if (normalizedValue) {
      uniquePaths.add(normalizedValue)
    }
  })

  return Array.from(uniquePaths)
}

function getAssetVersion(payload) {
  return getBootstrapAssetVersion(payload?.assetVersion || buildBootstrapAssetVersion(payload))
}

function getRandomLoopCount(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1))
}

function measureRectSnapshot(node) {
  if (!node) {
    return null
  }

  const rect = node.getBoundingClientRect()

  if (!rect.width || !rect.height) {
    return null
  }

  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    right: rect.right,
    bottom: rect.bottom,
  }
}

function getRectCenterPoint(rect) {
  if (!rect) {
    return null
  }

  return {
    x: rect.left + (rect.width / 2),
    y: rect.top + (rect.height / 2),
  }
}

function measureContainedImageRect(node) {
  if (!node) {
    return null
  }

  const rect = measureRectSnapshot(node)

  if (!rect) {
    return null
  }

  const naturalWidth = Number(node.naturalWidth || 0)
  const naturalHeight = Number(node.naturalHeight || 0)

  if (!naturalWidth || !naturalHeight) {
    return rect
  }

  const imageRatio = naturalWidth / naturalHeight
  const rectRatio = rect.width / rect.height

  if (!Number.isFinite(imageRatio) || imageRatio <= 0 || !Number.isFinite(rectRatio) || rectRatio <= 0) {
    return rect
  }

  if (imageRatio > rectRatio) {
    const containedHeight = rect.width / imageRatio
    const offsetY = (rect.height - containedHeight) / 2

    return {
      ...rect,
      top: rect.top + offsetY,
      height: containedHeight,
      bottom: rect.top + offsetY + containedHeight,
    }
  }

  const containedWidth = rect.height * imageRatio
  const offsetX = (rect.width - containedWidth) / 2

  return {
    ...rect,
    left: rect.left + offsetX,
    width: containedWidth,
    right: rect.left + offsetX + containedWidth,
  }
}

function readTranslateY(node) {
  if (!node || typeof window === "undefined") {
    return 0
  }

  const transformValue = window.getComputedStyle(node).transform

  if (!transformValue || transformValue === "none") {
    return 0
  }

  try {
    return Number(new window.DOMMatrixReadOnly(transformValue).m42 || 0)
  } catch {
    const matrixValues = transformValue.match(/matrix(3d)?\(([^)]+)\)/i)?.[2]

    if (!matrixValues) {
      return 0
    }

    const values = matrixValues
      .split(",")
      .map((value) => Number.parseFloat(value.trim()))
      .filter((value) => Number.isFinite(value))

    if (transformValue.startsWith("matrix3d(")) {
      return values[13] || 0
    }

    return values[5] || 0
  }
}

function normalizeLoopProgress(value, length) {
  if (!length) {
    return 0
  }

  const progress = Number(value) || 0

  return ((progress % length) + length) % length
}

export default function GameScreen({
  bootstrapSeed = null,
  bootstrapAssetVersion = 0,
  deferBootstrap = false,
  allowBootstrapFetch = false,
  isVisible = true,
}) {
  const cachedBootstrap = isVisible ? readBootstrapCache() : null
  const cachedBootstrapAssetVersion = getBootstrapAssetVersion(cachedBootstrap?.assetVersion)
  const initialRouletteItems = normalizeRouletteItems(
    cachedBootstrap?.rouletteItems,
    cachedBootstrapAssetVersion,
  )
  const initialTrackItems = createTrackItems(
    initialRouletteItems,
    0,
    getTrackWindowSteps(initialRouletteItems.length),
  )
  const slotRef = useRef(null)
  const centerSlotMediaRef = useRef(null)
  const centerSlotImageRef = useRef(null)
  const trackSlotImageRefs = useRef([])
  const trackSlotMediaRefs = useRef([])
  const patternUnderlayRef = useRef(null)
  const patternMotionRef = useRef(null)
  const carouselMotionRef = useRef(null)
  const trackRef = useRef(null)
  const resultBagImageRef = useRef(null)
  const resultBagFlightRef = useRef(null)
  const appliedBootstrapSeedRef = useRef("")
  const stepRef = useRef(0)
  const animationFrameRef = useRef(0)
  const idleAnimationFrameRef = useRef(0)
  const idleStartRetryFrameRef = useRef(0)
  const transitionResetFrameRef = useRef(0)
  const spinCompletionTimeoutRef = useRef(0)
  const idleSpinTimeoutRef = useRef(0)
  const overlayTimeoutRef = useRef(0)
  const resultRevealTimeoutRef = useRef(0)
  const resultAnimationFrameRef = useRef(0)
  const resultAnimationTimeoutRef = useRef(0)
  const resultCopyToastTimeoutRef = useRef(0)
  const embeddedPageRequestRef = useRef(0)
  const virtualTranslateRef = useRef(0)
  const pendingSpinRef = useRef(null)
  const centerBagIndexRef = useRef(0)
  const isSpinActiveRef = useRef(false)
  const isIdleSpinActiveRef = useRef(false)
  const isMountedRef = useRef(true)
  const [rouletteItems, setRouletteItems] = useState(initialRouletteItems)
  const [myPrizes, setMyPrizes] = useState(() => normalizeMyPrizes(
    cachedBootstrap?.myPrizes,
    cachedBootstrapAssetVersion,
  ))
  const [availableAttempts, setAvailableAttempts] = useState(() => Number(cachedBootstrap?.attempts?.availableAttempts || 0))
  const [referralLink, setReferralLink] = useState(() => String(cachedBootstrap?.referral?.referralLink || "").trim())
  const [isSpinActive, setIsSpinActive] = useState(false)
  const [activeOverlay, setActiveOverlay] = useState(null)
  const [renderedOverlay, setRenderedOverlay] = useState(null)
  const [isOverlayClosing, setIsOverlayClosing] = useState(false)
  const [embeddedPage, setEmbeddedPage] = useState(null)
  const [resultBag, setResultBag] = useState(null)
  const [resultPrize, setResultPrize] = useState(null)
  const [isResultCopied, setIsResultCopied] = useState(false)
  const [isResultCopyToastVisible, setIsResultCopyToastVisible] = useState(false)
  const [isResultCopyToastClosing, setIsResultCopyToastClosing] = useState(false)
  const [resultRevealPhase, setResultRevealPhase] = useState("idle")
  const [resultEntrySource, setResultEntrySource] = useState("spin")
  const [resultBagFlight, setResultBagFlight] = useState(null)
  const [resultBagPreviewScale, setResultBagPreviewScale] = useState(1.2)
  const [centerBagIndex, setCenterBagIndex] = useState(0)
  const [trackItems, setTrackItems] = useState(initialTrackItems)
  const [trackTranslate, setTrackTranslate] = useState(0)
  const [spinError, setSpinError] = useState("")

  const measureStep = () => {
    const nextStep = roundToDevicePixel((slotRef.current?.getBoundingClientRect().height ?? 0) + SLOT_GAP)

    if (nextStep > SLOT_GAP) {
      stepRef.current = nextStep
    }

    return stepRef.current
  }

  const activeRouletteItems = isVisible ? rouletteItems : EMPTY_ITEMS
  const visibleMyPrizes = isVisible ? myPrizes : EMPTY_ITEMS
  const visibleTrackItems = isVisible ? trackItems : EMPTY_ITEMS
  const activeRouletteItemsKey = activeRouletteItems.map((item) => item.key).join("|")
  const carouselImagePaths = collectUniqueImagePaths(
    activeRouletteItems.map((item) => item.slotPath || item.path || ""),
  )
  const hasAvailableAttempts = availableAttempts > 0
  const isResultBagAnimating = resultRevealPhase === "bag-enter"
  const isResultSheetVisible = Boolean(resultBag)
  const isGiftOverlayVisible = activeOverlay === "gift" || renderedOverlay === "gift"
  const isPrizeMediaVisible = isGiftOverlayVisible || isResultSheetVisible
  const prizeImagePaths = collectUniqueImagePaths(
    visibleMyPrizes.map((item) => item.image || ""),
    resultBag?.path || "",
    resultPrize?.image || "",
  )
  const cachedCarouselImageSources = useCachedImageSources(carouselImagePaths, { prune: true })
  const cachedPrizeImageSources = useCachedImageSources(
    isPrizeMediaVisible ? prizeImagePaths : [],
  )
  const resolvedImageSources = {
    ...cachedCarouselImageSources,
    ...cachedPrizeImageSources,
  }
  const isNonPrizeResult = (resultPrize?.type || resultBag?.type || "") === "Не приз"
  const resultBagFinalScaleMultiplier = isNonPrizeResult
    ? NON_PRIZE_RESULT_FINAL_SCALE_MULTIPLIER
    : RESULT_BAG_FINAL_SCALE_MULTIPLIER
  const effectiveResultBagPreviewScale = (
    resultEntrySource === "collection"
      ? resultBagPreviewScale * resultBagFinalScaleMultiplier
      : resultBagPreviewScale
  ) * (
    isNonPrizeResult
      ? NON_PRIZE_RESULT_PREVIEW_SCALE_FACTOR
      : 1
  )

  const resetResultState = useCallback(() => {
    cancelAnimationFrame(resultAnimationFrameRef.current)
    clearTimeout(resultAnimationTimeoutRef.current)
    clearTimeout(resultCopyToastTimeoutRef.current)
    if (resultBagFlightRef.current) {
      resultBagFlightRef.current.style.transition = ""
      resultBagFlightRef.current.style.transform = ""
    }
    setIsResultCopyToastVisible(false)
    setIsResultCopyToastClosing(false)
    setResultBagFlight(null)
    setResultRevealPhase("idle")
  }, [])

  const showResultCopyToast = useCallback(() => {
    clearTimeout(resultCopyToastTimeoutRef.current)
    setIsResultCopyToastClosing(false)
    setIsResultCopyToastVisible(true)
    resultCopyToastTimeoutRef.current = window.setTimeout(() => {
      setIsResultCopyToastClosing(true)
      resultCopyToastTimeoutRef.current = window.setTimeout(() => {
        setIsResultCopyToastVisible(false)
        setIsResultCopyToastClosing(false)
      }, RESULT_COPY_TOAST_EXIT_DURATION)
    }, RESULT_COPY_TOAST_VISIBLE_DURATION)
  }, [])

  const applyBootstrapResponse = useCallback((response, assetVersion, source = "game_screen") => {
    if (!isMountedRef.current) {
      return
    }

    const nextRouletteItems = normalizeRouletteItems(response?.rouletteItems, assetVersion)
    const nextMyPrizes = normalizeMyPrizes(response?.myPrizes, assetVersion)
    const nextTrackItems = createTrackItems(
      nextRouletteItems,
      0,
      getTrackWindowSteps(nextRouletteItems.length),
    )

    centerBagIndexRef.current = 0
    setRouletteItems(nextRouletteItems)
    setMyPrizes(nextMyPrizes)
    setAvailableAttempts(Number(response?.attempts?.availableAttempts || 0))
    setReferralLink(String(response?.referral?.referralLink || "").trim())
    setCenterBagIndex(0)
    setTrackItems(nextTrackItems)
    setTrackTranslate(0)

    if (nextRouletteItems.length) {
      setSpinError("")
    } else {
      setSpinError("Сервер не вернул позиции для карусели")
      clearTimeout(overlayTimeoutRef.current)
      setIsOverlayClosing(false)
      setActiveOverlay("error")
      setRenderedOverlay("error")
    }

    writeBootstrapCache({
      schemaVersion: BOOTSTRAP_CACHE_SCHEMA_VERSION,
      assetVersion,
      rouletteItems: Array.isArray(response?.rouletteItems) ? response.rouletteItems : [],
      myPrizes: Array.isArray(response?.myPrizes) ? response.myPrizes : [],
      attempts: response?.attempts || {},
      referral: response?.referral || {},
    })

    void trackGameEvent("bootstrap_loaded", {
      rouletteItemsCount: nextRouletteItems.length,
      myPrizesCount: nextMyPrizes.length,
      availableAttempts: Number(response?.attempts?.availableAttempts || 0),
      source,
    })
  }, [])

  const openOverlay = (overlayId) => {
    clearTimeout(overlayTimeoutRef.current)
    setIsOverlayClosing(false)
    setActiveOverlay(overlayId)
    setRenderedOverlay(overlayId)
  }

  const openErrorOverlay = (error, fallback = DEFAULT_ERROR_MESSAGE) => {
    setSpinError(getReadableErrorMessage(error, fallback))
    openOverlay("error")
  }

  const resolveSpinResponse = useCallback(async (response) => {
    if (isValidSpinResponsePayload(response)) {
      return response
    }

    const spinId = normalizeSpinId(response?.spin?.id)

    if (!spinId) {
      return null
    }

    try {
      const recoveredResponse = await fetchSpinResultById(spinId)

      if (isValidSpinResponsePayload(recoveredResponse)) {
        return recoveredResponse
      }
    } catch (error) {
      logDevWarn("Spin recovery request failed", error)
    }

    return null
  }, [])

  const applyTrackStyles = (translateY) => {
    const normalizedTranslateY = Number(translateY || 0)

    if (patternMotionRef.current) {
      patternMotionRef.current.style.transform = `translate3d(0, ${normalizedTranslateY}px, 0)`
    }

    if (carouselMotionRef.current) {
      carouselMotionRef.current.style.transform = `translate3d(0, ${normalizedTranslateY}px, 0)`
    }

    if (trackRef.current) {
      trackRef.current.style.transform = "translate3d(0, 0, 0)"
    }
  }

  const setCarouselMotionTransition = (transitionValue) => {
    const normalizedTransitionValue = transitionValue || ""

    if (patternMotionRef.current) {
      patternMotionRef.current.style.transition = normalizedTransitionValue
    }

    if (carouselMotionRef.current) {
      carouselMotionRef.current.style.transition = normalizedTransitionValue
    }
  }

  const clearIdleSpin = () => {
    cancelAnimationFrame(idleAnimationFrameRef.current)
    cancelAnimationFrame(idleStartRetryFrameRef.current)
    cancelAnimationFrame(transitionResetFrameRef.current)
    clearTimeout(idleSpinTimeoutRef.current)
    idleStartRetryFrameRef.current = 0
    idleSpinTimeoutRef.current = 0
    isIdleSpinActiveRef.current = false
  }

  const stopIdleSpin = (preserveCurrentPosition = false) => {
    clearIdleSpin()

    const currentTranslate = preserveCurrentPosition && carouselMotionRef.current
      ? readTranslateY(carouselMotionRef.current)
      : virtualTranslateRef.current

    setCarouselMotionTransition("none")

    applyTrackStyles(currentTranslate)
    virtualTranslateRef.current = currentTranslate
    setTrackTranslate(currentTranslate)

    return currentTranslate
  }

  const scheduleIdleSpinRetry = () => {
    cancelAnimationFrame(idleStartRetryFrameRef.current)
    idleStartRetryFrameRef.current = requestAnimationFrame(() => {
      idleStartRetryFrameRef.current = 0

      if (!isMountedRef.current || isSpinActiveRef.current || resultBag || !activeRouletteItems.length) {
        return
      }

      startIdleSpin()
    })
  }

  const startIdleSpin = () => {
    if (isSpinActiveRef.current || resultBag || !activeRouletteItems.length) {
      return
    }

    const step = measureStep()

    if (!step || !carouselMotionRef.current || !patternMotionRef.current || !slotRef.current) {
      scheduleIdleSpinRetry()
      return
    }

    const idleSteps = activeRouletteItems.length
    const baseTranslate = roundToDevicePixel(-TRACK_VISIBLE_START_OFFSET * step)
    const finalTranslate = roundToDevicePixel(-(TRACK_VISIBLE_START_OFFSET + idleSteps) * step)

    clearIdleSpin()
    isIdleSpinActiveRef.current = true
    setTrackTranslate(baseTranslate)
    virtualTranslateRef.current = baseTranslate

    const runIdleCycle = () => {
      idleAnimationFrameRef.current = requestAnimationFrame(() => {
        if (!carouselMotionRef.current || isSpinActiveRef.current || resultBag || !isIdleSpinActiveRef.current) {
          if (!isSpinActiveRef.current && !resultBag && activeRouletteItems.length) {
            scheduleIdleSpinRetry()
          }
          return
        }

        setCarouselMotionTransition("none")
        applyTrackStyles(baseTranslate)
        void carouselMotionRef.current.offsetWidth

        idleAnimationFrameRef.current = requestAnimationFrame(() => {
          if (!carouselMotionRef.current || isSpinActiveRef.current || resultBag || !isIdleSpinActiveRef.current) {
            if (!isSpinActiveRef.current && !resultBag && activeRouletteItems.length) {
              scheduleIdleSpinRetry()
            }
            return
          }

          setCarouselMotionTransition(`transform ${IDLE_SPIN_CYCLE_DURATION}ms linear`)
          applyTrackStyles(finalTranslate)
          virtualTranslateRef.current = finalTranslate

          idleSpinTimeoutRef.current = window.setTimeout(() => {
            if (!carouselMotionRef.current || isSpinActiveRef.current || resultBag || !isIdleSpinActiveRef.current) {
              if (!isSpinActiveRef.current && !resultBag && activeRouletteItems.length) {
                scheduleIdleSpinRetry()
              }
              return
            }

            setCarouselMotionTransition("none")
            applyTrackStyles(baseTranslate)
            virtualTranslateRef.current = baseTranslate
            runIdleCycle()
          }, IDLE_SPIN_CYCLE_DURATION)
        })
      })
    }

    runIdleCycle()
  }

  const resetCarousel = (nextCenterBagIndex = centerBagIndexRef.current) => {
    if (!activeRouletteItems.length) {
      setTrackItems([])
      return
    }

    const step = measureStep()
    const normalizedCenterBagIndex = getLoopedIndex(nextCenterBagIndex, activeRouletteItems.length)
    const baseTranslate = roundToDevicePixel(-TRACK_VISIBLE_START_OFFSET * step)

    setTrackItems(createTrackItems(
      activeRouletteItems,
      normalizedCenterBagIndex,
      getTrackWindowSteps(activeRouletteItems.length),
    ))

    if (step > 0) {
      setTrackTranslate(baseTranslate)
      virtualTranslateRef.current = baseTranslate
      setCarouselMotionTransition("none")
      applyTrackStyles(baseTranslate)

      cancelAnimationFrame(transitionResetFrameRef.current)
      transitionResetFrameRef.current = requestAnimationFrame(() => {
        setCarouselMotionTransition("")
      })
    }
  }

  const handleSpin = async () => {
    if (isSpinActive || resultBag || !activeRouletteItems.length || availableAttempts <= 0) {
      return
    }

    const step = measureStep()
    const currentCenterBagIndex = centerBagIndexRef.current

    if (!step) {
      return
    }

    const currentTranslate = stopIdleSpin(true)

    isSpinActiveRef.current = true
    setIsSpinActive(true)

    let spinResponse
    void trackGameEvent("spin_clicked", {
      activeItemsCount: activeRouletteItems.length,
    })

    try {
      spinResponse = await postJson("/game/spin", {})
    } catch (error) {
      logDevWarn("Spin request failed", error)

      isSpinActiveRef.current = false
      setIsSpinActive(false)
      resetCarousel(currentCenterBagIndex)

      if (error?.code === "PROMO_CODES_EXHAUSTED") {
        setSpinError("")
        openOverlay("promo-exhausted")
        return
      }

      openErrorOverlay(error, "Не удалось выполнить попытку")
      return
    }

    const canonicalSpinResponse = await resolveSpinResponse(spinResponse)

    if (!isValidSpinResponsePayload(canonicalSpinResponse)) {
      logDevWarn("Spin response validation failed", spinResponse)

      isSpinActiveRef.current = false
      setIsSpinActive(false)
      resetCarousel(currentCenterBagIndex)
      await loadGameBootstrap()
      openErrorOverlay("Не удалось восстановить результат попытки. Состояние игры обновлено.")
      return
    }

    const targetPositionId = canonicalSpinResponse.result.positionId
    const normalizedTargetPositionId = normalizeEntityId(targetPositionId)
    const targetBagIndex = activeRouletteItems.findIndex(
      (item) => normalizeEntityId(item.id) === normalizedTargetPositionId
    )
    const matchedRouletteItem = activeRouletteItems[targetBagIndex] || null
    const assetVersion = matchedRouletteItem?.assetVersion
      || getBootstrapAssetVersion(readBootstrapCache()?.assetVersion)
      || getAssetVersion(canonicalSpinResponse)
    const nextResult = canonicalSpinResponse?.result
      ? {
        ...canonicalSpinResponse.result,
        // Reuse the already rendered carousel asset so the result popup
        // does not force a second network fetch right at reveal time.
        image: matchedRouletteItem?.path || canonicalSpinResponse.result.image || "",
      }
      : null
    const nextMyPrizes = canonicalSpinResponse.myPrizes.map((item) => ({
      ...item,
      image: withAssetVersion(item.image, assetVersion),
    }))
    const cachedBootstrap = readBootstrapCache()
    const spinId = normalizeSpinId(canonicalSpinResponse.spin?.id)

    writePendingSpinRecovery({
      spinId,
      assetVersion,
      result: nextResult,
      myPrizes: canonicalSpinResponse.myPrizes,
      attempts: canonicalSpinResponse.attempts || {},
    })

    writeBootstrapCache({
      schemaVersion: BOOTSTRAP_CACHE_SCHEMA_VERSION,
      assetVersion: assetVersion || cachedBootstrap?.assetVersion || 0,
      rouletteItems: Array.isArray(cachedBootstrap?.rouletteItems) ? cachedBootstrap.rouletteItems : [],
      myPrizes: canonicalSpinResponse.myPrizes,
      attempts: canonicalSpinResponse.attempts || {},
      referral: cachedBootstrap?.referral || {},
    })

    if (targetBagIndex < 0) {
      clearTimeout(overlayTimeoutRef.current)
      clearTimeout(resultRevealTimeoutRef.current)
      resetResultState()
      setSpinError("")
      setActiveOverlay(null)
      setRenderedOverlay(null)
      setIsOverlayClosing(false)
      setIsResultCopied(false)
      resetCarousel(currentCenterBagIndex)

      startTransition(() => {
        const nextResultBag = buildResultBag(nextResult, activeRouletteItems)
        const nextResultPrize = buildResultPrize(nextResult, nextResultBag)

        setResultBag(nextResultBag)
        setResultPrize(nextResultPrize)
        setMyPrizes(nextMyPrizes)
        setAvailableAttempts(Number(canonicalSpinResponse.attempts?.availableAttempts || 0))
        setResultEntrySource("spin")
        setResultRevealPhase("sheet-enter")
        setResultBagFlight(null)
        isSpinActiveRef.current = false
        setIsSpinActive(false)
      })

      clearPendingSpinRecovery()
      void trackGameEvent("spin_result_shown", {
        positionId: canonicalSpinResponse.result?.positionId ?? null,
        type: canonicalSpinResponse.result?.type || "",
        hasPromoCode: Boolean(canonicalSpinResponse.result?.promoCode),
      })
      return
    }

    const baseTranslate = roundToDevicePixel(-TRACK_VISIBLE_START_OFFSET * step)
    const currentProgressSteps = normalizeLoopProgress(
      step > 0 ? (baseTranslate - currentTranslate) / step : 0,
      activeRouletteItems.length,
    )
    const normalizedCurrentTranslate = roundToDevicePixel(baseTranslate - currentProgressSteps * step)
    const targetProgressSteps = getLoopedIndex(
      targetBagIndex - currentCenterBagIndex,
      activeRouletteItems.length
    )
    const fullLoops = getRandomLoopCount(SPIN_MIN_FULL_LOOPS, SPIN_MAX_FULL_LOOPS)
    const baseLoopCycles = fullLoops + 1
    const baselineLoopCycles = Math.max(
      1,
      Math.round(baseLoopCycles * getSpinDistanceMultiplier()),
    )
    const baselineLoopSteps = baselineLoopCycles * activeRouletteItems.length
    let baselineTotalSteps = baselineLoopSteps + targetProgressSteps

    while (baselineTotalSteps <= currentProgressSteps) {
      baselineTotalSteps += activeRouletteItems.length
    }

    const loopCycles = Math.max(
      1,
      Math.round(baselineLoopCycles * SPIN_DISTANCE_SLOWDOWN_RATIO),
    )
    const loopSteps = loopCycles * activeRouletteItems.length
    let totalSteps = loopSteps + targetProgressSteps

    while (totalSteps <= currentProgressSteps) {
      totalSteps += activeRouletteItems.length
    }

    const baselineAdditionalSteps = baselineTotalSteps - currentProgressSteps
    const durationMs = getSpinDurationMs(baselineAdditionalSteps, step)

    const nextTrackItems = createTrackItems(
      activeRouletteItems,
      currentCenterBagIndex,
      totalSteps,
    )

    pendingSpinRef.current = {
      currentCenterBagIndex,
      targetBagIndex,
      result: nextResult,
      myPrizes: nextMyPrizes,
      attempts: canonicalSpinResponse.attempts || null,
      step,
      totalSteps,
      durationMs,
      startedAt: 0,
    }

    clearTimeout(overlayTimeoutRef.current)
    clearTimeout(resultRevealTimeoutRef.current)
    resetResultState()
    setSpinError("")
    setActiveOverlay(null)
    setRenderedOverlay(null)
    setIsOverlayClosing(false)
    setResultBag(null)
    setResultPrize(null)
    setIsResultCopied(false)
    setTrackItems(nextTrackItems)
    const finalTranslate = roundToDevicePixel(-(TRACK_VISIBLE_START_OFFSET + totalSteps) * step)
    setTrackTranslate(normalizedCurrentTranslate)
    virtualTranslateRef.current = normalizedCurrentTranslate

    cancelAnimationFrame(animationFrameRef.current)
    cancelAnimationFrame(transitionResetFrameRef.current)
    clearTimeout(spinCompletionTimeoutRef.current)
    animationFrameRef.current = requestAnimationFrame(() => {
      const spinState = pendingSpinRef.current

      if (!spinState || !carouselMotionRef.current) {
        return
      }

      setCarouselMotionTransition("none")
      applyTrackStyles(normalizedCurrentTranslate)
      void carouselMotionRef.current.offsetWidth

      animationFrameRef.current = requestAnimationFrame(() => {
        if (!carouselMotionRef.current) {
          return
        }

        setCarouselMotionTransition(`transform ${durationMs}ms ${SPIN_TRANSITION_EASING}`)
        applyTrackStyles(finalTranslate)

        spinCompletionTimeoutRef.current = window.setTimeout(() => {
          const settledCenterTrackIndex = TRACK_CENTER_OFFSET + spinState.totalSteps

          setCarouselMotionTransition("")

          virtualTranslateRef.current = finalTranslate
          setTrackTranslate(finalTranslate)
          pendingSpinRef.current = null
          centerBagIndexRef.current = spinState.targetBagIndex

          clearTimeout(resultRevealTimeoutRef.current)
          resultRevealTimeoutRef.current = window.setTimeout(() => {
            const resultOriginRect = measureContainedImageRect(trackSlotImageRefs.current[settledCenterTrackIndex])
              || measureRectSnapshot(trackSlotMediaRefs.current[settledCenterTrackIndex])
              || measureContainedImageRect(centerSlotImageRef.current)
              || measureRectSnapshot(centerSlotMediaRef.current)

            startTransition(() => {
              const nextResultBag = buildResultBag(spinState.result, activeRouletteItems)
              const nextResultPrize = buildResultPrize(spinState.result, nextResultBag)
              setCenterBagIndex(spinState.targetBagIndex)
              setResultBag(nextResultBag)
              setResultPrize(nextResultPrize)
              setMyPrizes(spinState.myPrizes)
              setAvailableAttempts(Number(spinState.attempts?.availableAttempts || 0))
              setResultEntrySource("spin")
              setResultRevealPhase(resultOriginRect ? "bag-enter" : "sheet-enter")
              setResultBagFlight(
                resultOriginRect && nextResultBag
                  ? {
                    path: nextResultBag.path,
                    label: nextResultBag.label,
                    originRect: resultOriginRect,
                  }
                  : null
              )
              isSpinActiveRef.current = false
              setIsSpinActive(false)
            })

            clearPendingSpinRecovery()
            void trackGameEvent("spin_result_shown", {
              positionId: spinState.result?.positionId ?? null,
              type: spinState.result?.type || "",
              hasPromoCode: Boolean(spinState.result?.promoCode),
            })
          }, RESULT_REVEAL_DELAY)
        }, durationMs)
      })
    })
  }

  const handlePrimaryActionClick = () => {
    if (isSpinActive || !activeRouletteItems.length) {
      return
    }

    if (!hasAvailableAttempts) {
      void trackGameEvent("overlay_opened", {
        overlayId: "exclamation",
      })
      openOverlay("exclamation")
      return
    }

    void handleSpin()
  }

  const handleBannerAction = (actionId) => {
    if (actionId === "exclamation") {
      const requestId = embeddedPageRequestRef.current + 1

      embeddedPageRequestRef.current = requestId

      void trackGameEvent("overlay_opened", {
        overlayId: "embedded_page",
        source: actionId,
        url: IMPORTANT_INFO_URL,
      })
      setEmbeddedPage({
        title: IMPORTANT_INFO_TITLE,
        url: IMPORTANT_INFO_URL,
        srcDoc: "",
        isLoading: true,
        sessionKey: requestId,
      })

      void loadEmbeddedPageModule()
        .then(({ loadEmbeddedPageDocument }) => loadEmbeddedPageDocument(IMPORTANT_INFO_URL, IMPORTANT_INFO_TITLE))
        .then((srcDoc) => {
          if (embeddedPageRequestRef.current !== requestId) {
            return
          }

          setEmbeddedPage((currentPage) => {
            if (!currentPage || currentPage.url !== IMPORTANT_INFO_URL) {
              return currentPage
            }

            return {
              ...currentPage,
              srcDoc,
              isLoading: false,
            }
          })
        })
        .catch((error) => {
          logDevWarn("Embedded page preload failed", error)

          if (embeddedPageRequestRef.current !== requestId) {
            return
          }

          setEmbeddedPage((currentPage) => {
            if (!currentPage || currentPage.url !== IMPORTANT_INFO_URL) {
              return currentPage
            }

            return {
              ...currentPage,
              isLoading: false,
            }
          })
        })

      return
    }

    void trackGameEvent("overlay_opened", {
      overlayId: actionId,
      myPrizesCount: actionId === "gift" ? myPrizes.length : undefined,
    })
    openOverlay(actionId)

    if (actionId === "question") {
      return
    }

    if (actionId === "gift") {
      return
    }
  }

  const handleInviteFriend = async () => {
    const shareText = buildReferralShareText(referralLink)

    if (!shareText) {
      openErrorOverlay("Не удалось подготовить реферальную ссылку")
      return
    }

    void trackGameEvent("referral_share_clicked", {
      hasReferralLink: Boolean(referralLink),
    })

    try {
      const miniApp = getMiniApp()

      if (typeof miniApp?.shareMaxContent === "function") {
        const result = await miniApp.shareMaxContent({
          text: REFERRAL_SHARE_MESSAGE,
          link: referralLink,
          disableLinkPreview: true,
        })

        void trackGameEvent("referral_share_completed", {
          status: result?.status || "unknown",
        })
        return
      }

      if (typeof window !== "undefined") {
        window.location.assign(buildMaxShareLink(shareText))
      }
    } catch (error) {
      logDevWarn("MAX share failed", error)
      openErrorOverlay(error, "Не удалось открыть отправку в MAX")
    }
  }

  const handleSupportClick = () => {
    const supportLink = buildSupportLink(SUPPORT_CONTACT)

    if (!supportLink) {
      openErrorOverlay("Не удалось подготовить ссылку поддержки")
      return
    }

    void trackGameEvent("external_link_opened", {
      actionId: "support",
      url: supportLink,
    })

    if (typeof window !== "undefined") {
      window.location.assign(supportLink)
    }
  }

  const handleCloseOverlay = () => {
    const closedOverlayId = renderedOverlay || activeOverlay
    if (closedOverlayId) {
      void trackGameEvent("overlay_closed", {
        overlayId: closedOverlayId,
      })
    }

    if (!renderedOverlay) {
      setActiveOverlay(null)
      return
    }

    clearTimeout(overlayTimeoutRef.current)
    setIsOverlayClosing(true)
    overlayTimeoutRef.current = window.setTimeout(() => {
      setActiveOverlay(null)
      setRenderedOverlay(null)
      setIsOverlayClosing(false)
    }, SURFACE_ANIMATION_DURATION)
  }

  const handleBackToGame = () => {
    void trackGameEvent("result_closed", {
      prizeId: resultBag?.id ?? resultPrize?.positionId ?? null,
      prizeType: resultPrize?.type || resultBag?.type || "",
    })
    clearIdleSpin()
    pendingSpinRef.current = null
    setResultBag(null)
    setResultPrize(null)
    setIsResultCopied(false)
    setResultEntrySource("spin")
    clearTimeout(resultRevealTimeoutRef.current)
    clearPendingSpinRecovery()
    resetResultState()
    resetCarousel(centerBagIndexRef.current)
  }

  const handleCloseEmbeddedPage = () => {
    embeddedPageRequestRef.current += 1

    if (embeddedPage?.url) {
      void trackGameEvent("overlay_closed", {
        overlayId: "embedded_page",
        url: embeddedPage.url,
      })
    }

    setEmbeddedPage(null)
  }

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined
    }

    const handleMessage = (event) => {
      if (event.data?.type === EMBEDDED_PAGE_CLOSE_EVENT) {
        handleCloseEmbeddedPage()
      }
    }

    window.addEventListener("message", handleMessage)
    return () => {
      window.removeEventListener("message", handleMessage)
    }
  })

  const openPrizeResult = (prize) => {
    if (!prize) {
      return
    }

    stopIdleSpin(true)
    void trackGameEvent("my_prize_opened", {
      prizeId: prize.id,
      title: prize.title || "",
      hasPromoCode: Boolean(prize.promoCode),
    })
    clearTimeout(overlayTimeoutRef.current)
    setActiveOverlay(null)
    setRenderedOverlay(null)
    setIsOverlayClosing(false)
    setIsResultCopied(false)
    resetResultState()
    const basePrizeResult = {
      positionId: prize.positionId ?? prize.id,
      type: prize.type || "Приз",
      title: prize.title || "",
      myPrizeText: prize.myPrizeText || prize.title || "",
      description: prize.description || "",
      image: prize.image || "",
      promoCode: prize.promoCode || "",
      expiresAt: prize.expiresAt || "",
    }
    const matchedResultBag = buildResultBag(basePrizeResult, activeRouletteItems)
    const prizeResult = {
      ...basePrizeResult,
      image: matchedResultBag?.path || basePrizeResult.image || "",
      type: matchedResultBag?.type || basePrizeResult.type,
      title: matchedResultBag?.title || basePrizeResult.title,
      myPrizeText: matchedResultBag?.myPrizeText || basePrizeResult.myPrizeText,
      description: matchedResultBag?.description || basePrizeResult.description,
      expiresAt: matchedResultBag?.expiresAt || basePrizeResult.expiresAt,
    }
    const nextResultBag = matchedResultBag || {
      id: prize.id,
      key: `my-prize-${prize.id}`,
      path: prize.image || "",
      slotPath: prize.image || "",
      label: prize.title || `prize-${prize.id}`,
      title: prize.title || "",
      description: prize.description || "",
      myPrizeText: prize.myPrizeText || prize.title || "",
      expiresAt: prize.expiresAt || "",
      chanceValue: prize.chanceValue || "1x",
      type: prize.type || "Приз",
    }
    setResultBag(nextResultBag)
    setResultPrize(buildResultPrize(prizeResult, nextResultBag))
    setResultBagFlight(null)
    setResultEntrySource("collection")
    setResultRevealPhase("sheet-enter")
  }

  const handleOpenTravelApp = () => {
    if (isResultCopied && resultPrize?.promoCode) {
      void trackGameEvent("promo_code_apply_clicked", {
        prizeId: resultBag?.id ?? null,
        codeLength: String(resultPrize.promoCode).length,
      })
    }

    void trackGameEvent("external_link_opened", {
      actionId: "travel_app",
      url: OZON_TRAVEL_APP_URL,
      source: "result_prize",
    })

    openExternalLink(OZON_TRAVEL_APP_URL)
  }

  const handleCarouselSlotImageError = (event) => {
    const imageNode = event.currentTarget

    if (!imageNode || imageNode.dataset.fallbackApplied === "true") {
      return
    }

    imageNode.dataset.fallbackApplied = "true"
    imageNode.src = DEFAULT_ROULETTE_IMAGE_PATH
  }

  const handleCopyResultCode = async () => {
    if (!resultPrize?.promoCode) {
      return
    }

    try {
      await navigator.clipboard.writeText(resultPrize.promoCode)
      setIsResultCopied(true)
      showResultCopyToast()
      void trackGameEvent("promo_code_copied", {
        prizeId: resultBag?.id ?? null,
        codeLength: String(resultPrize.promoCode).length,
      })
    } catch {
      setIsResultCopied(true)
      showResultCopyToast()
    }
  }

  const loadGameBootstrap = useCallback(async () => {
    try {
      const response = await fetchGameBootstrap()
      const assetVersion = getAssetVersion(response)
      applyBootstrapResponse(response, assetVersion, "game_screen")
    } catch (error) {
      logDevWarn("Game bootstrap failed", error)
      setSpinError(getReadableErrorMessage(error, "Не удалось загрузить игру"))
      clearTimeout(overlayTimeoutRef.current)
      setIsOverlayClosing(false)
      setActiveOverlay("error")
      setRenderedOverlay("error")
    }
  }, [applyBootstrapResponse])

  useEffect(() => {
    isMountedRef.current = true
    let frameId = 0

    if (bootstrapSeed && bootstrapAssetVersion) {
      const nextSeedKey = `${bootstrapAssetVersion}:${Array.isArray(bootstrapSeed?.rouletteItems) ? bootstrapSeed.rouletteItems.length : 0}:${Array.isArray(bootstrapSeed?.myPrizes) ? bootstrapSeed.myPrizes.length : 0}`

      if (appliedBootstrapSeedRef.current !== nextSeedKey) {
        appliedBootstrapSeedRef.current = nextSeedKey
        frameId = requestAnimationFrame(() => {
          applyBootstrapResponse(bootstrapSeed, bootstrapAssetVersion, "intro_preload")
        })
      }
    } else if (!deferBootstrap && allowBootstrapFetch) {
      frameId = requestAnimationFrame(() => {
        void loadGameBootstrap()
      })
    }

    return () => {
      cancelAnimationFrame(frameId)
      isMountedRef.current = false
    }
  }, [
    allowBootstrapFetch,
    applyBootstrapResponse,
    bootstrapAssetVersion,
    bootstrapSeed,
    deferBootstrap,
    loadGameBootstrap,
  ])

  useEffect(() => {
    if (isSpinActiveRef.current) {
      return
    }

    applyTrackStyles(trackTranslate)
  }, [trackItems, trackTranslate])

  /* eslint-disable react-hooks/exhaustive-deps */
  // These carousel effects intentionally key off the rendered roulette set to avoid restart jitter.
  useEffect(() => {
    const syncCarousel = () => {
      const measuredHeight = slotRef.current?.getBoundingClientRect().height ?? 0
      const step = measuredHeight > 0 ? measuredHeight + SLOT_GAP : stepRef.current
      const patternWidth = patternUnderlayRef.current?.getBoundingClientRect().width ?? 0

      if (patternWidth > 0) {
        setResultBagPreviewScale(RESULT_PREVIEW_TARGET_WIDTH_PX / patternWidth)
      }

      if (step > SLOT_GAP) {
        stepRef.current = roundToDevicePixel(step)
        const baseTranslate = roundToDevicePixel(-TRACK_VISIBLE_START_OFFSET * stepRef.current)
        setTrackTranslate(baseTranslate)
        virtualTranslateRef.current = baseTranslate
        setCarouselMotionTransition("none")
        applyTrackStyles(baseTranslate)

        if (!isSpinActiveRef.current && !resultBag && activeRouletteItems.length) {
          scheduleIdleSpinRetry()
        }
      }
    }

    const handleResize = () => {
      if (!isSpinActiveRef.current) {
        syncCarousel()
      }
    }

    const frameId = requestAnimationFrame(() => {
      syncCarousel()
    })

    window.addEventListener("resize", handleResize)

    return () => {
      cancelAnimationFrame(frameId)
      cancelAnimationFrame(transitionResetFrameRef.current)
      window.removeEventListener("resize", handleResize)
      clearIdleSpin()
      cancelAnimationFrame(animationFrameRef.current)
      clearTimeout(spinCompletionTimeoutRef.current)
      clearTimeout(overlayTimeoutRef.current)
      clearTimeout(resultRevealTimeoutRef.current)
    }
  }, [activeRouletteItemsKey])

  useEffect(() => {
    if (!activeRouletteItems.length) {
      clearIdleSpin()
      return undefined
    }

    if (resultBag) {
      stopIdleSpin(true)
      return undefined
    }

    if (isSpinActive) {
      clearIdleSpin()
      return undefined
    }

    startIdleSpin()

    return () => {
      clearIdleSpin()
    }
  }, [activeRouletteItemsKey, isSpinActive, resultBag, centerBagIndex, trackItems.length])
  /* eslint-enable react-hooks/exhaustive-deps */

  useEffect(() => {
    centerBagIndexRef.current = centerBagIndex
  }, [centerBagIndex])

  useEffect(() => {
    isSpinActiveRef.current = isSpinActive
  }, [isSpinActive])

  useEffect(() => {
    if (isSpinActive || resultBag) {
      return
    }

    const pendingSpinRecovery = readPendingSpinRecovery()

    if (!pendingSpinRecovery) {
      return
    }
    let isCancelled = false

    const restorePendingSpin = async () => {
      const canonicalSpinResponse = await resolveSpinResponse({
        spin: {
          id: pendingSpinRecovery.spinId,
        },
      })
      const recoveredResponse = isValidSpinResponsePayload(canonicalSpinResponse)
        ? canonicalSpinResponse
        : (
          isValidSpinResultPayload(pendingSpinRecovery.result)
          && Array.isArray(pendingSpinRecovery.myPrizes)
          && isPlainObject(pendingSpinRecovery.attempts)
            ? {
              spin: {
                id: normalizeSpinId(pendingSpinRecovery.spinId),
              },
              result: pendingSpinRecovery.result,
              myPrizes: pendingSpinRecovery.myPrizes,
              attempts: pendingSpinRecovery.attempts,
            }
            : null
        )

      if (isCancelled) {
        return
      }

      if (!recoveredResponse) {
        clearPendingSpinRecovery()
        return
      }

      const recoveredAssetVersion = getBootstrapAssetVersion(
        pendingSpinRecovery.assetVersion || getAssetVersion(recoveredResponse),
      )
      const recoveredMyPrizes = normalizeMyPrizes(
        recoveredResponse.myPrizes,
        recoveredAssetVersion,
      )

      startTransition(() => {
        const nextResultBag = buildResultBag(recoveredResponse.result, activeRouletteItems)
        const nextResultPrize = buildResultPrize(recoveredResponse.result, nextResultBag)

        setMyPrizes(recoveredMyPrizes)
        setAvailableAttempts(Number(recoveredResponse.attempts?.availableAttempts || 0))
        setResultBag(nextResultBag)
        setResultPrize(nextResultPrize)
        setResultEntrySource("spin")
        setResultRevealPhase("sheet-enter")
        setResultBagFlight(null)
        isSpinActiveRef.current = false
        setIsSpinActive(false)
      })

      clearPendingSpinRecovery()
      void trackGameEvent("spin_result_shown", {
        positionId: recoveredResponse.result?.positionId ?? null,
        type: recoveredResponse.result?.type || "",
        hasPromoCode: Boolean(recoveredResponse.result?.promoCode),
        recovered: true,
      })
    }

    void restorePendingSpin()

    return () => {
      isCancelled = true
    }
  }, [activeRouletteItems, activeRouletteItemsKey, isSpinActive, resultBag, resolveSpinResponse])

  useEffect(() => {
    const resultBagElement = resultBagFlightRef.current
    const resultBagTargetElement = resultBagImageRef.current
    const flightState = resultBagFlight

    if (!resultBag || resultRevealPhase !== "bag-enter" || !flightState?.originRect || !resultBagElement || !resultBagTargetElement) {
      return undefined
    }

    cancelAnimationFrame(resultAnimationFrameRef.current)
    clearTimeout(resultAnimationTimeoutRef.current)

    resultAnimationFrameRef.current = requestAnimationFrame(() => {
      const targetRect = measureContainedImageRect(resultBagTargetElement)

      if (!targetRect) {
        setResultBagFlight(null)
        setResultRevealPhase("sheet-enter")
        return
      }

      const originPoint = getRectCenterPoint(flightState.originRect)
      const targetPoint = getRectCenterPoint(targetRect)

      if (!originPoint || !targetPoint) {
        setResultBagFlight(null)
        setResultRevealPhase("sheet-enter")
        return
      }

      const deltaX = roundToDevicePixel(targetPoint.x - originPoint.x)
      const deltaY = roundToDevicePixel(targetPoint.y - originPoint.y)
      const uniformScale = targetRect.width / Math.max(flightState.originRect.width, 1)
      const flightScaleMultiplier = (resultPrize?.type || resultBag?.type || "") === "Не приз"
        ? NON_PRIZE_RESULT_FINAL_SCALE_MULTIPLIER
        : RESULT_BAG_FINAL_SCALE_MULTIPLIER
      const finalScale = uniformScale * flightScaleMultiplier

      resultBagElement.style.transition = "none"
      resultBagElement.style.top = `${flightState.originRect.top}px`
      resultBagElement.style.left = `${flightState.originRect.left}px`
      resultBagElement.style.width = `${flightState.originRect.width}px`
      resultBagElement.style.height = `${flightState.originRect.height}px`
      resultBagElement.style.transform = "translate3d(0, 0, 0) scale(1, 1)"
      void resultBagElement.offsetWidth

      resultAnimationFrameRef.current = requestAnimationFrame(() => {
        resultBagElement.style.transition = `transform ${RESULT_BAG_ANIMATION_DURATION}ms ${RESULT_BAG_ANIMATION_EASING}`
        resultBagElement.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${finalScale})`

        resultAnimationTimeoutRef.current = window.setTimeout(() => {
          resultBagElement.style.transition = ""
          resultBagElement.style.top = `${targetRect.top}px`
          resultBagElement.style.left = `${targetRect.left}px`
          resultBagElement.style.width = `${targetRect.width}px`
          resultBagElement.style.height = `${targetRect.height}px`
          resultBagElement.style.transform = `translate3d(0, 0, 0) scale(${flightScaleMultiplier})`
          setResultRevealPhase("sheet-enter")
        }, RESULT_BAG_ANIMATION_DURATION)
      })
      })

    return () => {
      cancelAnimationFrame(resultAnimationFrameRef.current)
      clearTimeout(resultAnimationTimeoutRef.current)
    }
  }, [resultBag, resultBagFlight, resultPrize?.type, resultRevealPhase])

  useEffect(() => () => {
    cancelAnimationFrame(resultAnimationFrameRef.current)
    clearTimeout(resultAnimationTimeoutRef.current)
    clearTimeout(resultCopyToastTimeoutRef.current)
  }, [])

  return (
    <main className="game-screen" aria-label="Игровой экран">
      <img
        src={CENTER_PATTERN_PATH}
        alt=""
        aria-hidden="true"
        className="game-preload-image"
        fetchPriority="high"
        loading="eager"
        decoding="sync"
      />
      <div className="game-fade-overlay game-fade-overlay-top" aria-hidden="true" />
      <div className="game-fade-overlay game-fade-overlay-bottom" aria-hidden="true" />
      <div className="game-shell">
        <div
          className={[
            "game-stage",
            isResultSheetVisible ? "is-result-mode" : "",
            isResultBagAnimating ? "is-result-entering" : "",
          ].filter(Boolean).join(" ")}
        >
          <div className={`game-carousel-scene ${isSpinActive ? "is-spinning" : ""}`}>
            <div className="game-carousel-backdrop">
              <div
                ref={patternUnderlayRef}
                className="game-carousel-pattern-underlay"
                aria-hidden="true"
              />
              <div
                ref={patternMotionRef}
                className="game-carousel-pattern-motion-layer"
                aria-hidden="true"
              >
                <div
                  className="game-carousel-pattern"
                  aria-hidden="true"
                />
              </div>
              <div
                ref={carouselMotionRef}
                className="game-carousel-track-motion-layer"
              >
                <div
                  ref={trackRef}
                  className="game-carousel-track"
                >
                  {visibleTrackItems.map((bag, index) => (
                    <div
                      key={`${bag.key}-${index}`}
                      ref={index === 0 ? slotRef : null}
                      className="game-carousel-slot"
                    >
                      <div
                        ref={(node) => {
                          trackSlotMediaRefs.current[index] = node
                          if (index === TRACK_CENTER_OFFSET) {
                            centerSlotMediaRef.current = node
                          }
                        }}
                        className="game-carousel-slot-media"
                      >
                        <img
                          ref={(node) => {
                            trackSlotImageRefs.current[index] = node
                            if (index === TRACK_CENTER_OFFSET) {
                              centerSlotImageRef.current = node
                            }
                          }}
                          src={resolveCachedImageSource(bag.slotPath, resolvedImageSources) || bag.slotPath}
                          alt=""
                          className="game-carousel-slot-image"
                          aria-hidden="true"
                          fetchPriority="low"
                          loading="eager"
                          onError={handleCarouselSlotImageError}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <img
              src={LEFT_TRIANGLE_PATH}
              alt=""
              className="game-carousel-triangle game-carousel-triangle-left"
              aria-hidden="true"
            />
            <img
              src={RIGHT_TRIANGLE_PATH}
              alt=""
              className="game-carousel-triangle game-carousel-triangle-right"
              aria-hidden="true"
            />
          </div>
        </div>
        <section
          className={`game-top-banner ${isSpinActive || resultBag || isGiftOverlayVisible ? "is-hidden" : ""}`}
          aria-label="Игровая панель"
        >
          <div className="game-top-banner-section game-top-banner-section--primary">
            <div className="game-top-banner-actions" role="group" aria-label="Быстрые действия">
              {TOP_BANNER_ACTIONS.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  className="game-top-banner-action"
                  aria-label={action.label}
                  onClick={() => handleBannerAction(action.id)}
                >
                  <img
                    src={action.icon}
                    alt=""
                    className="game-top-banner-action-icon"
                    aria-hidden="true"
                  />
                </button>
              ))}
            </div>
          </div>
          <div className="game-top-banner-section game-top-banner-section--secondary">
            <img
              src="/game/icons/logo.webp"
              alt="Логотип"
              className="game-top-banner-logo"
            />
          </div>
        </section>
        <div className={`game-controls ${isSpinActive || resultBag || isGiftOverlayVisible ? "is-hidden" : ""}`}>
          <button
            type="button"
            className={`game-spin-button ${hasAvailableAttempts ? "" : "game-spin-button--single"}`.trim()}
            onClick={handlePrimaryActionClick}
            disabled={isSpinActive || !activeRouletteItems.length}
          >
            <span className="game-spin-button-label">
              {hasAvailableAttempts ? "Крутить" : "Крутить ещё раз"}
            </span>
            {hasAvailableAttempts ? (
              <span className="game-spin-button-attempt">{formatAttemptsLabel(availableAttempts)}</span>
            ) : null}
          </button>
        </div>
        {renderedOverlay === "error" ? (
          <div
            className={`game-overlay ${isOverlayClosing ? "is-closing" : "is-opening"}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="game-error-title"
          >
            <div className="game-overlay-backdrop" />
            <section className="game-overlay-sheet">
              <div className="game-overlay-sheet-inner">
                <h2 id="game-error-title" className="game-overlay-title">
                  Упс!
                </h2>
                <p className="game-overlay-description">
                  {spinError || DEFAULT_ERROR_MESSAGE}
                </p>
                <div className="game-overlay-actions">
                  <button
                    type="button"
                    className="game-overlay-action game-overlay-action--primary"
                    onClick={handleCloseOverlay}
                  >
                    Понятно
                  </button>
                </div>
              </div>
            </section>
          </div>
        ) : null}
        {renderedOverlay === "question" ? (
          <div
            className={`game-overlay ${isOverlayClosing ? "is-closing" : "is-opening"}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="game-question-title"
          >
            <div className="game-overlay-backdrop" />
            <section className="game-overlay-sheet">
              <div className="game-overlay-sheet-inner">
                <h2 id="game-question-title" className="game-overlay-title">
                  Возникли вопросы?
                </h2>
                <p className="game-overlay-description">
                  Обратитесь в наш чат поддержки в МАКС
                </p>
                <div className="game-overlay-actions">
                  <button
                    type="button"
                    className="game-overlay-action game-overlay-action--primary"
                    onClick={handleSupportClick}
                  >
                    Написать в поддержку
                  </button>
                  <button
                    type="button"
                    className="game-overlay-action game-overlay-action--secondary"
                    onClick={handleCloseOverlay}
                  >
                    К Ленте призов
                  </button>
                </div>
              </div>
            </section>
          </div>
        ) : null}
        {renderedOverlay === "exclamation" ? (
          <div
            className={`game-overlay ${isOverlayClosing ? "is-closing" : "is-opening"}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="game-exclamation-title"
          >
            <div className="game-overlay-backdrop" />
            <section className="game-overlay-sheet">
              <div className="game-overlay-sheet-inner">
                <h2 id="game-exclamation-title" className="game-overlay-title game-overlay-title--multiline">
                  Как получить
                  <br />
                  больше подарков?
                </h2>
                <div className="game-overlay-description game-overlay-description--rich">
                  <span className="game-overlay-description-line-fixed">Возвращайтесь каждый день, чтобы крутить</span>
                  <span className="game-overlay-description-line-fixed">Ленту призов, а также приглашайте друзей</span>
                  <span className="game-overlay-description-line-fixed">и получайте больше попыток. За каждого</span>
                  <span className="game-overlay-description-inline">
                    приглашенного друга получаете
                    <span className="game-overlay-badge">+1 попытку</span>
                  </span>
                </div>
                <div className="game-overlay-actions">
                  <button
                    type="button"
                    className="game-overlay-action game-overlay-action--primary"
                    onClick={handleInviteFriend}
                  >
                    Пригласить друга
                  </button>
                  <button
                    type="button"
                    className="game-overlay-action game-overlay-action--secondary"
                    onClick={handleCloseOverlay}
                  >
                    К Ленте призов
                  </button>
                </div>
              </div>
            </section>
          </div>
        ) : null}
        {renderedOverlay === "promo-exhausted" ? (
          <div
            className={`game-overlay ${isOverlayClosing ? "is-closing" : "is-opening"}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="game-promo-exhausted-title"
          >
            <div className="game-overlay-backdrop" />
            <section className="game-overlay-sheet">
              <div className="game-overlay-sheet-inner">
                <h2 id="game-promo-exhausted-title" className="game-overlay-title game-overlay-title--multiline">
                  Упс, все доступные
                  <br />
                  промокоды закончились
                </h2>
                <div className="game-overlay-actions">
                  <button
                    type="button"
                    className="game-overlay-action game-overlay-action--primary"
                    onClick={handleCloseOverlay}
                  >
                    Понятно
                  </button>
                </div>
              </div>
            </section>
          </div>
        ) : null}
        {resultBag ? (
          <section
            className={[
              "game-result",
              isResultSheetVisible ? "is-sheet-visible" : "",
              isResultBagAnimating ? "is-bag-entering" : "",
              resultEntrySource === "collection" ? "is-collection-entering" : "",
            ].filter(Boolean).join(" ")}
            aria-label="Результат приза"
          >
            <div className="game-result-hero">
              <div className="game-result-bag-frame">
              <div
                className={`game-result-bag-visual ${resultBagFlight ? "is-hidden" : ""}`.trim()}
                style={{
                  "--game-result-preview-scale": String(effectiveResultBagPreviewScale),
                }}
              >
                <img
                  ref={resultBagImageRef}
                  src={resolveCachedImageSource(resultBag.path, resolvedImageSources) || resultBag.path || DEFAULT_ROULETTE_IMAGE_PATH}
                  alt={resultBag.label}
                  className="game-result-bag"
                />
                </div>
              </div>
            </div>
            <div className="game-result-sheet">
              <div className="game-result-sheet-inner">
                {resultPrize?.type !== "Не приз" ? (
                  <p className="game-result-kicker">
                    Ваш приз
                  </p>
                ) : null}
                {resultPrize?.type !== "Не приз" ? (
                  <h2 className="game-result-title">
                    {resultPrize?.title || resultBag?.title || "Позиция"}
                  </h2>
                ) : null}
                {resultPrize?.type === "Не приз" ? (
                  <>
                    {renderResultDescription(
                      resultPrize?.description || resultBag?.description,
                      true,
                      "game-result-description--dark",
                    )}
                    {renderResultDescription(NON_PRIZE_COPY, true)}
                  </>
                ) : renderResultDescription(
                  resultPrize?.description || resultBag?.description,
                  false,
                )}
                <div className="game-result-actions">
                  {resultPrize?.promoCode ? (
                    <button
                      type="button"
                      className={`game-result-code ${isResultCopied ? "is-copied" : ""}`.trim()}
                      onClick={isResultCopied ? handleOpenTravelApp : handleCopyResultCode}
                    >
                      <span className="game-result-code-text">
                        {isResultCopied ? "Применить промокод" : resultPrize.promoCode}
                      </span>
                      {!isResultCopied ? (
                        <img
                          src="/game/icons/copy.svg"
                          alt=""
                          className="game-result-code-icon"
                          aria-hidden="true"
                        />
                      ) : null}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={`game-result-primary-action ${isResultCopied && resultPrize?.promoCode ? "is-secondary" : ""}`.trim()}
                    onClick={handleBackToGame}
                  >
                    К Ленте призов
                  </button>
                </div>
              </div>
            </div>
          </section>
        ) : null}
        {resultBagFlight ? (
          <div className="game-result-flight-layer" aria-hidden="true">
            <img
              ref={resultBagFlightRef}
              src={resolveCachedImageSource(resultBagFlight.path, cachedPrizeImageSources) || resultBagFlight.path || DEFAULT_ROULETTE_IMAGE_PATH}
              alt=""
              className="game-result-flight-bag"
              style={{
                top: `${resultBagFlight.originRect.top}px`,
                left: `${resultBagFlight.originRect.left}px`,
                width: `${resultBagFlight.originRect.width}px`,
                height: `${resultBagFlight.originRect.height}px`,
              }}
            />
          </div>
        ) : null}
        {isResultCopyToastVisible ? (
          <div
            className={`game-result-copy-toast ${isResultCopyToastClosing ? "is-closing" : "is-opening"}`.trim()}
            role="status"
            aria-live="polite"
          >
            <span className="game-result-copy-toast-text">Скопировано</span>
            <img
              src="/game/icons/done.svg"
              alt=""
              className="game-result-copy-toast-check"
              aria-hidden="true"
            />
          </div>
        ) : null}
        {embeddedPage ? (
          <div
            className="embedded-page"
            role="dialog"
            aria-modal="true"
            aria-label={embeddedPage.title}
          >
            <section className="embedded-page-inner">
              <div className="embedded-page-frame-wrap">
                {embeddedPage.isLoading ? (
                  <div className="embedded-page-loading" role="status" aria-live="polite">
                    Загружаем страницу…
                  </div>
                ) : (
                  <iframe
                    key={embeddedPage.sessionKey}
                    srcDoc={embeddedPage.srcDoc}
                    title={embeddedPage.title}
                    className="embedded-page-frame"
                    sandbox="allow-popups allow-popups-to-escape-sandbox allow-scripts"
                  />
                )}
              </div>
            </section>
          </div>
        ) : null}
      </div>
      {renderedOverlay === "gift" ? (
        <div
          className={`game-prizes-page ${isOverlayClosing ? "is-closing" : "is-opening"}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="game-prizes-title"
        >
          <section className="game-prizes-page-inner">
            <h2 id="game-prizes-title" className="game-prizes-title">
              Мои призы
            </h2>
            <div className="game-prizes-list" aria-label="Список призов">
              {myPrizes.length ? myPrizes.map((prize) => (
                <button
                  key={prize.id}
                  type="button"
                  className="game-prize-card"
                  onClick={() => openPrizeResult(prize)}
                >
                  <div className="game-prize-card-media">
                    <img
                      src={resolveCachedImageSource(prize.image, resolvedImageSources)}
                      alt=""
                      className="game-prize-card-image"
                      aria-hidden="true"
                    />
                  </div>
                  <div className="game-prize-card-content">
                    <h3 className="game-prize-card-title">{prize.myPrizeText || prize.title}</h3>
                    <p className="game-prize-card-date">{prize.expiresAt}</p>
                  </div>
                </button>
              )) : (
                <p className="game-overlay-description game-prizes-empty-description">
                  Пока призов нет. Крутите ленту, чтобы получить первый.
                </p>
              )}
            </div>
            <div className="game-prizes-footer">
              <button
                type="button"
                className="game-prizes-close"
                onClick={handleCloseOverlay}
              >
                К Ленте призов
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  )
}
