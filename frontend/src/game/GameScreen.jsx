import { startTransition, useCallback, useEffect, useRef, useState } from "react"

import { getJson, postJson, trackGameEvent } from "../api.js"
import {
  getMiniApp,
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
const MOBILE_SPIN_DISTANCE_MULTIPLIER = 0.5
const MOBILE_SPIN_DURATION_MULTIPLIER = 0.82
const SLOT_GAP = 24
const TRACK_CENTER_OFFSET = 9
const TRACK_VISIBLE_START_OFFSET = TRACK_CENTER_OFFSET - 1
const TRACK_TAIL_BUFFER = 9
const RESULT_REVEAL_DELAY = 72
const RESULT_BAG_ANIMATION_DURATION = 1400
const RESULT_BAG_ANIMATION_EASING = "cubic-bezier(0.18, 0.82, 0.22, 1)"
const RESULT_BAG_FINAL_SCALE_MULTIPLIER = 1.24
const SPIN_TRANSITION_EASING = "cubic-bezier(0.22, 0.72, 0.3, 1)"
const IDLE_SPIN_CYCLE_DURATION = 18000
const RESULT_COPY_TOAST_DURATION = 2200
const BOOTSTRAP_CACHE_KEY = "ozon-travel-bootstrap-cache"
const NON_PRIZE_COPY = "А ваш багаж прилетит следующим рейсом.\nВозвращайтесь за ним позже!"
const REFERRAL_SHARE_MESSAGE = [
  "100 000 баллов Ozon и классные промокоды на путешествия ждут на Ленте призов!",
  "",
  "Скорее летим забирать!",
].join("\n")
const IMPORTANT_INFO_URL = "https://cdn1.ozone.ru/s3/promo-sync-api/1077004356.html"
const OZON_TRAVEL_APP_URL = "https://www.ozon.ru/travel/?__rr=1"
const SUPPORT_CONTACT = String(import.meta.env.VITE_SUPPORT_CONTACT || "@ozon_travel_support_bot").trim()
const DEFAULT_ERROR_MESSAGE = "Что-то пошло не так. Попробуйте еще раз."
const TOP_BANNER_ACTIONS = [
  { id: "question", icon: "/game/icons/question.svg", label: "Вопрос" },
  { id: "exclamation", icon: "/game/icons/exclamation.svg", label: "Важно" },
  { id: "gift", icon: "/game/icons/gift.svg", label: "Подарки" },
]
const getLoopedIndex = (value, length) => ((value % length) + length) % length
const normalizeEntityId = (value) => String(value ?? "").trim()

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

  if (!value || !assetVersion) {
    return value
  }

  try {
    const nextUrl = new URL(value, "http://localhost")
    nextUrl.searchParams.set("v", String(assetVersion))

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
    window.sessionStorage.removeItem(BOOTSTRAP_CACHE_KEY)
  } catch {
    // Ignore sessionStorage failures.
  }

  return null
}

function writeBootstrapCache() {
  if (typeof window === "undefined") {
    return
  }

  try {
    window.sessionStorage.removeItem(BOOTSTRAP_CACHE_KEY)
  } catch {
    // Ignore sessionStorage failures.
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

function getAssetVersion() {
  return Date.now()
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

export default function GameScreen() {
  const cachedBootstrap = readBootstrapCache()
  const slotRef = useRef(null)
  const centerSlotMediaRef = useRef(null)
  const centerSlotImageRef = useRef(null)
  const trackSlotImageRefs = useRef([])
  const trackSlotMediaRefs = useRef([])
  const carouselMotionRef = useRef(null)
  const trackRef = useRef(null)
  const resultBagImageRef = useRef(null)
  const resultBagFlightRef = useRef(null)
  const stepRef = useRef(0)
  const animationFrameRef = useRef(0)
  const idleAnimationFrameRef = useRef(0)
  const spinCompletionTimeoutRef = useRef(0)
  const idleSpinTimeoutRef = useRef(0)
  const overlayTimeoutRef = useRef(0)
  const resultRevealTimeoutRef = useRef(0)
  const resultAnimationFrameRef = useRef(0)
  const resultAnimationTimeoutRef = useRef(0)
  const resultCopyToastTimeoutRef = useRef(0)
  const virtualTranslateRef = useRef(0)
  const pendingSpinRef = useRef(null)
  const centerBagIndexRef = useRef(0)
  const isSpinActiveRef = useRef(false)
  const isIdleSpinActiveRef = useRef(false)
  const isMountedRef = useRef(true)
  const [rouletteItems, setRouletteItems] = useState(() => normalizeRouletteItems(cachedBootstrap?.rouletteItems, 0))
  const [myPrizes, setMyPrizes] = useState(() => normalizeMyPrizes(cachedBootstrap?.myPrizes, 0))
  const [availableAttempts, setAvailableAttempts] = useState(() => Number(cachedBootstrap?.attempts?.availableAttempts || 0))
  const [referralLink, setReferralLink] = useState(() => String(cachedBootstrap?.referral?.referralLink || "").trim())
  const [isSpinActive, setIsSpinActive] = useState(false)
  const [activeOverlay, setActiveOverlay] = useState(null)
  const [renderedOverlay, setRenderedOverlay] = useState(null)
  const [isOverlayClosing, setIsOverlayClosing] = useState(false)
  const [resultBag, setResultBag] = useState(null)
  const [resultPrize, setResultPrize] = useState(null)
  const [isResultCopied, setIsResultCopied] = useState(false)
  const [isResultCopyToastVisible, setIsResultCopyToastVisible] = useState(false)
  const [resultRevealPhase, setResultRevealPhase] = useState("idle")
  const [resultBagFlight, setResultBagFlight] = useState(null)
  const [centerBagIndex, setCenterBagIndex] = useState(0)
  const [trackItems, setTrackItems] = useState(() => createTrackItems([], 0, 0))
  const [trackTranslate, setTrackTranslate] = useState(0)
  const [lockedSlotHeight, setLockedSlotHeight] = useState(null)
  const [spinError, setSpinError] = useState("")
  const [isDevWidgetOpen, setIsDevWidgetOpen] = useState(false)
  const [isDevBootstrapReloading, setIsDevBootstrapReloading] = useState(false)
  const isDevWidgetVisible = true

  const measureStep = () => {
    const nextStep = roundToDevicePixel((slotRef.current?.getBoundingClientRect().height ?? 0) + SLOT_GAP)

    if (nextStep > SLOT_GAP) {
      stepRef.current = nextStep
    }

    return stepRef.current
  }

  const activeRouletteItems = rouletteItems
  const activeRouletteItemsKey = activeRouletteItems.map((item) => item.key).join("|")
  const hasAvailableAttempts = availableAttempts > 0
  const isResultBagAnimating = resultRevealPhase === "bag-enter"
  const isResultSheetVisible = Boolean(resultBag) && resultRevealPhase !== "bag-enter"

  const resetResultState = useCallback(() => {
    cancelAnimationFrame(resultAnimationFrameRef.current)
    clearTimeout(resultAnimationTimeoutRef.current)
    clearTimeout(resultCopyToastTimeoutRef.current)
    if (resultBagFlightRef.current) {
      resultBagFlightRef.current.style.transition = ""
      resultBagFlightRef.current.style.transform = ""
    }
    setIsResultCopyToastVisible(false)
    setResultBagFlight(null)
    setResultRevealPhase("idle")
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

  const applyTrackStyles = (translateY) => {
    const normalizedTranslateY = Number(translateY || 0)

    if (carouselMotionRef.current) {
      carouselMotionRef.current.style.transform = `translate3d(0, ${normalizedTranslateY}px, 0)`
    }

    if (trackRef.current) {
      trackRef.current.style.transform = "translate3d(0, 0, 0)"
    }
  }

  const clearIdleSpin = () => {
    cancelAnimationFrame(idleAnimationFrameRef.current)
    clearTimeout(idleSpinTimeoutRef.current)
    idleSpinTimeoutRef.current = 0
    isIdleSpinActiveRef.current = false
  }

  const stopIdleSpin = (preserveCurrentPosition = false) => {
    clearIdleSpin()

    const currentTranslate = preserveCurrentPosition && carouselMotionRef.current
      ? readTranslateY(carouselMotionRef.current)
      : virtualTranslateRef.current

    if (carouselMotionRef.current) {
      carouselMotionRef.current.style.transition = "none"
    }

    applyTrackStyles(currentTranslate)
    virtualTranslateRef.current = currentTranslate
    setTrackTranslate(currentTranslate)

    return currentTranslate
  }

  const startIdleSpin = () => {
    if (isSpinActiveRef.current || resultBag || !activeRouletteItems.length) {
      return
    }

    const step = measureStep()

    if (!step) {
      return
    }

    const idleSteps = activeRouletteItems.length
    const baseTranslate = roundToDevicePixel(-TRACK_VISIBLE_START_OFFSET * step)
    const finalTranslate = roundToDevicePixel(-(TRACK_VISIBLE_START_OFFSET + idleSteps) * step)

    clearIdleSpin()
    isIdleSpinActiveRef.current = true
    setLockedSlotHeight(null)
    setTrackItems(createTrackItems(
      activeRouletteItems,
      centerBagIndexRef.current,
      idleSteps,
    ))
    setTrackTranslate(baseTranslate)
    virtualTranslateRef.current = baseTranslate

    idleAnimationFrameRef.current = requestAnimationFrame(() => {
      if (!carouselMotionRef.current || isSpinActiveRef.current || resultBag || !isIdleSpinActiveRef.current) {
        return
      }

      carouselMotionRef.current.style.transition = "none"
      applyTrackStyles(baseTranslate)
      void carouselMotionRef.current.offsetWidth

      idleAnimationFrameRef.current = requestAnimationFrame(() => {
        if (!carouselMotionRef.current || isSpinActiveRef.current || resultBag || !isIdleSpinActiveRef.current) {
          return
        }

        carouselMotionRef.current.style.transition = `transform ${IDLE_SPIN_CYCLE_DURATION}ms linear`
        applyTrackStyles(finalTranslate)
        virtualTranslateRef.current = finalTranslate

        idleSpinTimeoutRef.current = window.setTimeout(() => {
          if (!carouselMotionRef.current || isSpinActiveRef.current || resultBag || !isIdleSpinActiveRef.current) {
            return
          }

          carouselMotionRef.current.style.transition = "none"
          applyTrackStyles(baseTranslate)
          virtualTranslateRef.current = baseTranslate
          startIdleSpin()
        }, IDLE_SPIN_CYCLE_DURATION)
      })
    })
  }

  const resetCarousel = (nextCenterBagIndex = centerBagIndexRef.current) => {
    if (!activeRouletteItems.length) {
      setTrackItems([])
      return
    }

    const step = measureStep()
    const normalizedCenterBagIndex = getLoopedIndex(nextCenterBagIndex, activeRouletteItems.length)
    const baseTranslate = roundToDevicePixel(-TRACK_VISIBLE_START_OFFSET * step)

    setLockedSlotHeight(null)
    setTrackItems(createTrackItems(
      activeRouletteItems,
      normalizedCenterBagIndex,
      getTrackWindowSteps(activeRouletteItems.length),
    ))

    if (step > 0) {
      setTrackTranslate(baseTranslate)
      virtualTranslateRef.current = baseTranslate
      requestAnimationFrame(() => {
        if (carouselMotionRef.current) {
          carouselMotionRef.current.style.transition = ""
        }
        applyTrackStyles(baseTranslate)
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
      console.warn("Spin request failed", error)

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

    const targetPositionId = spinResponse?.result?.positionId
    const normalizedTargetPositionId = normalizeEntityId(targetPositionId)
    const targetBagIndex = Math.max(
      0,
      activeRouletteItems.findIndex((item) => normalizeEntityId(item.id) === normalizedTargetPositionId)
    )
    const matchedRouletteItem = activeRouletteItems[targetBagIndex] || null
    const assetVersion = matchedRouletteItem?.assetVersion || getAssetVersion()
    const nextResult = spinResponse?.result
      ? {
        ...spinResponse.result,
        // Reuse the already rendered carousel asset so the result popup
        // does not force a second network fetch right at reveal time.
        image: matchedRouletteItem?.path || spinResponse.result.image || "",
      }
      : null
    const nextMyPrizes = Array.isArray(spinResponse?.myPrizes)
      ? spinResponse.myPrizes.map((item) => ({
        ...item,
        image: withAssetVersion(item.image, assetVersion),
      }))
      : []

    const baseTranslate = roundToDevicePixel(-TRACK_VISIBLE_START_OFFSET * step)
    const currentProgressSteps = normalizeLoopProgress(
      step > 0 ? (baseTranslate - currentTranslate) / step : 0,
      activeRouletteItems.length,
    )
    const targetProgressSteps = getLoopedIndex(
      targetBagIndex - currentCenterBagIndex,
      activeRouletteItems.length
    )
    const fullLoops = getRandomLoopCount(SPIN_MIN_FULL_LOOPS, SPIN_MAX_FULL_LOOPS)
    const baseLoopCycles = fullLoops + 1
    const loopCycles = Math.max(
      1,
      Math.round(baseLoopCycles * getSpinDistanceMultiplier()),
    )
    const loopSteps = loopCycles * activeRouletteItems.length
    let totalSteps = loopSteps + targetProgressSteps

    while (totalSteps <= currentProgressSteps) {
      totalSteps += activeRouletteItems.length
    }

    const additionalSteps = totalSteps - currentProgressSteps
    const durationMs = getSpinDurationMs(additionalSteps, step)

    pendingSpinRef.current = {
      currentCenterBagIndex,
      targetBagIndex,
      result: nextResult,
      myPrizes: nextMyPrizes,
      attempts: spinResponse?.attempts || null,
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
    setLockedSlotHeight(step - SLOT_GAP)
    setTrackItems(createTrackItems(
      activeRouletteItems,
      currentCenterBagIndex,
      totalSteps,
    ))
    const finalTranslate = roundToDevicePixel(-(TRACK_VISIBLE_START_OFFSET + totalSteps) * step)
    setTrackTranslate(currentTranslate)
    virtualTranslateRef.current = currentTranslate

    cancelAnimationFrame(animationFrameRef.current)
    clearTimeout(spinCompletionTimeoutRef.current)
    animationFrameRef.current = requestAnimationFrame(() => {
      const spinState = pendingSpinRef.current

      if (!spinState || !carouselMotionRef.current) {
        return
      }

      carouselMotionRef.current.style.transition = "none"
      applyTrackStyles(currentTranslate)
      void carouselMotionRef.current.offsetWidth

      animationFrameRef.current = requestAnimationFrame(() => {
        if (!carouselMotionRef.current) {
          return
        }

        carouselMotionRef.current.style.transition = `transform ${durationMs}ms ${SPIN_TRANSITION_EASING}`
        applyTrackStyles(finalTranslate)

        spinCompletionTimeoutRef.current = window.setTimeout(() => {
          const settledCenterTrackIndex = TRACK_CENTER_OFFSET + spinState.totalSteps

          if (carouselMotionRef.current) {
            carouselMotionRef.current.style.transition = ""
          }

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
          }, RESULT_REVEAL_DELAY)

          void trackGameEvent("spin_result_shown", {
            positionId: spinState.result?.positionId ?? activeRouletteItems[spinState.targetBagIndex]?.id ?? null,
            type: spinState.result?.type || activeRouletteItems[spinState.targetBagIndex]?.type || "",
            hasPromoCode: Boolean(spinState.result?.promoCode),
          })
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
      void trackGameEvent("external_link_opened", {
        actionId,
        url: IMPORTANT_INFO_URL,
      })

      if (typeof window !== "undefined") {
        window.location.assign(IMPORTANT_INFO_URL)
      }
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
      console.warn("MAX share failed", error)
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
    setResultBag(null)
    setResultPrize(null)
    setIsResultCopied(false)
    clearTimeout(resultRevealTimeoutRef.current)
    resetResultState()
    resetCarousel(centerBagIndexRef.current)
  }

  const openPrizeResult = (prize) => {
    if (!prize) {
      return
    }

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
    const prizeResult = {
      positionId: prize.positionId ?? prize.id,
      type: prize.type || "Приз",
      title: prize.title || "",
      myPrizeText: prize.myPrizeText || prize.title || "",
      description: prize.description || "",
      image: prize.image || "",
      promoCode: prize.promoCode || "",
      expiresAt: prize.expiresAt || "",
    }
    const nextResultBag = buildResultBag(prizeResult, activeRouletteItems) || {
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
    const resultOriginRect = measureContainedImageRect(centerSlotImageRef.current)
      || measureRectSnapshot(centerSlotMediaRef.current)

    setResultBag(nextResultBag)
    setResultPrize(buildResultPrize(prizeResult, nextResultBag))
    setResultBagFlight(
      resultOriginRect && nextResultBag
        ? {
          path: nextResultBag.path,
          label: nextResultBag.label,
          originRect: resultOriginRect,
        }
        : null
    )
    setResultRevealPhase(resultOriginRect ? "bag-enter" : "sheet-enter")
  }

  const handleOpenTravelApp = () => {
    void trackGameEvent("external_link_opened", {
      actionId: "travel_app",
      url: OZON_TRAVEL_APP_URL,
      source: "result_prize",
    })

    if (typeof window !== "undefined") {
      window.location.assign(OZON_TRAVEL_APP_URL)
    }
  }

  const handleCopyResultCode = async () => {
    if (!resultPrize?.promoCode) {
      return
    }

    if (isResultCopied) {
      handleOpenTravelApp()
      return
    }

    try {
      await navigator.clipboard.writeText(resultPrize.promoCode)
      setIsResultCopied(true)
      clearTimeout(resultCopyToastTimeoutRef.current)
      setIsResultCopyToastVisible(true)
      resultCopyToastTimeoutRef.current = window.setTimeout(() => {
        setIsResultCopyToastVisible(false)
      }, RESULT_COPY_TOAST_DURATION)
      void trackGameEvent("promo_code_copied", {
        prizeId: resultBag?.id ?? null,
        codeLength: String(resultPrize.promoCode).length,
      })
    } catch {
      setIsResultCopied(true)
      clearTimeout(resultCopyToastTimeoutRef.current)
      setIsResultCopyToastVisible(true)
      resultCopyToastTimeoutRef.current = window.setTimeout(() => {
        setIsResultCopyToastVisible(false)
      }, RESULT_COPY_TOAST_DURATION)
    }
  }

  const loadGameBootstrap = useCallback(async () => {
    try {
      const response = await getJson("/game/bootstrap")
      const assetVersion = getAssetVersion()

      if (!isMountedRef.current) {
        return
      }

      const nextRouletteItems = normalizeRouletteItems(response?.rouletteItems, assetVersion)
      const nextMyPrizes = normalizeMyPrizes(response?.myPrizes, assetVersion)

      setRouletteItems(nextRouletteItems)
      setMyPrizes(nextMyPrizes)
      setAvailableAttempts(Number(response?.attempts?.availableAttempts || 0))
      setReferralLink(String(response?.referral?.referralLink || "").trim())
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
        rouletteItems: Array.isArray(response?.rouletteItems) ? response.rouletteItems : [],
        myPrizes: Array.isArray(response?.myPrizes) ? response.myPrizes : [],
        attempts: response?.attempts || {},
        referral: response?.referral || {},
      })
      void trackGameEvent("bootstrap_loaded", {
        rouletteItemsCount: nextRouletteItems.length,
        myPrizesCount: nextMyPrizes.length,
        availableAttempts: Number(response?.attempts?.availableAttempts || 0),
      })
    } catch (error) {
      console.warn("Game bootstrap failed", error)
      setSpinError(getReadableErrorMessage(error, "Не удалось загрузить игру"))
      clearTimeout(overlayTimeoutRef.current)
      setIsOverlayClosing(false)
      setActiveOverlay("error")
      setRenderedOverlay("error")
    }
  }, [])

  const handleDevGrantAttempts = async () => {
    try {
      const response = await postJson("/game/dev/grant-attempts", {
        count: 10,
      })
      setAvailableAttempts(Number(response?.attempts?.availableAttempts || 0))
      setSpinError("")
      setIsDevWidgetOpen(false)
    } catch (error) {
      openErrorOverlay(error, "Не удалось начислить попытки")
    }
  }

  const handleDevReloadBootstrap = async () => {
    if (isDevBootstrapReloading) {
      return
    }

    setIsDevBootstrapReloading(true)
    clearIdleSpin()
    pendingSpinRef.current = null
    clearTimeout(overlayTimeoutRef.current)
    clearTimeout(resultRevealTimeoutRef.current)
    setActiveOverlay(null)
    setRenderedOverlay(null)
    setIsOverlayClosing(false)
    setResultBag(null)
    setResultPrize(null)
    setIsResultCopied(false)
    resetResultState()
    isSpinActiveRef.current = false
    setIsSpinActive(false)
    setLockedSlotHeight(null)
    setSpinError("")

    try {
      await loadGameBootstrap()
      setIsDevWidgetOpen(false)
    } finally {
      setIsDevBootstrapReloading(false)
    }
  }

  const handleDevDeleteUser = async () => {
    try {
      await postJson("/game/dev/delete-user", {})
      if (typeof window !== "undefined") {
        window.location.reload()
      }
    } catch (error) {
      openErrorOverlay(error, "Не удалось удалить игрока")
    }
  }

  useEffect(() => {
    isMountedRef.current = true
    const frameId = requestAnimationFrame(() => {
      void loadGameBootstrap()
    })

    return () => {
      cancelAnimationFrame(frameId)
      isMountedRef.current = false
    }
  }, [loadGameBootstrap])

  useEffect(() => {
    const frameId = requestAnimationFrame(() => {
      centerBagIndexRef.current = 0
      setCenterBagIndex(0)
      setTrackItems(createTrackItems(activeRouletteItems, 0, getTrackWindowSteps(activeRouletteItems.length)))
      setTrackTranslate(0)
      setLockedSlotHeight(null)
    })

    return () => {
      cancelAnimationFrame(frameId)
    }
  }, [activeRouletteItemsKey])

  useEffect(() => {
    if (isSpinActiveRef.current) {
      return
    }

    applyTrackStyles(trackTranslate)
  }, [trackItems, trackTranslate])

  useEffect(() => {
    const syncCarousel = () => {
      const measuredHeight = slotRef.current?.getBoundingClientRect().height ?? 0
      const step = measuredHeight > 0 ? measuredHeight + SLOT_GAP : stepRef.current

      if (step > SLOT_GAP) {
        stepRef.current = roundToDevicePixel(step)
        setTrackItems(createTrackItems(
          activeRouletteItems,
          centerBagIndexRef.current,
          getTrackWindowSteps(activeRouletteItems.length),
        ))
        const baseTranslate = roundToDevicePixel(-TRACK_VISIBLE_START_OFFSET * stepRef.current)
        setTrackTranslate(baseTranslate)
        applyTrackStyles(baseTranslate)
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

  useEffect(() => {
    centerBagIndexRef.current = centerBagIndex
  }, [centerBagIndex])

  useEffect(() => {
    isSpinActiveRef.current = isSpinActive
  }, [isSpinActive])

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
      const finalScale = uniformScale * RESULT_BAG_FINAL_SCALE_MULTIPLIER

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
          resultBagElement.style.transform = `translate3d(0, 0, 0) scale(${RESULT_BAG_FINAL_SCALE_MULTIPLIER})`
          setResultRevealPhase("sheet-enter")
        }, RESULT_BAG_ANIMATION_DURATION)
      })
      })

    return () => {
      cancelAnimationFrame(resultAnimationFrameRef.current)
      clearTimeout(resultAnimationTimeoutRef.current)
    }
  }, [resultBag, resultBagFlight, resultRevealPhase])

  useEffect(() => () => {
    cancelAnimationFrame(resultAnimationFrameRef.current)
    clearTimeout(resultAnimationTimeoutRef.current)
    clearTimeout(resultCopyToastTimeoutRef.current)
  }, [])

  return (
    <main className="game-screen" aria-label="Игровой экран">
      {isDevWidgetVisible ? (
        <div className={`game-dev-widget ${isDevWidgetOpen ? "is-open" : ""}`}>
          <button
            type="button"
            className="game-dev-widget-toggle"
            onClick={() => setIsDevWidgetOpen((currentValue) => !currentValue)}
            aria-label="Открыть dev-инструменты"
          >
            {isDevWidgetOpen ? "←" : "→"}
          </button>
          {isDevWidgetOpen ? (
            <div className="game-dev-widget-panel">
              <button
                type="button"
                className="game-dev-widget-action"
                onClick={handleDevReloadBootstrap}
                disabled={isDevBootstrapReloading}
              >
                {isDevBootstrapReloading ? "Обновляем" : "Обновить ленту"}
              </button>
              <button
                type="button"
                className="game-dev-widget-action game-dev-widget-action--danger"
                onClick={handleDevDeleteUser}
              >
                Удалить
              </button>
              <button
                type="button"
                className="game-dev-widget-action"
                onClick={handleDevGrantAttempts}
              >
                +10 попыток
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
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
                className="game-carousel-pattern-underlay"
                aria-hidden="true"
              />
              <div
                ref={carouselMotionRef}
                className="game-carousel-motion-layer"
                aria-hidden="true"
              >
                <div
                  className="game-carousel-pattern"
                  aria-hidden="true"
                />
                <div
                  ref={trackRef}
                  className="game-carousel-track"
                >
                  {trackItems.map((bag, index) => (
                    <div
                      key={`${bag.key}-${index}`}
                      ref={index === 0 ? slotRef : null}
                      className="game-carousel-slot"
                      style={lockedSlotHeight ? { height: `${lockedSlotHeight}px` } : undefined}
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
                          src={bag.slotPath}
                          alt=""
                          className="game-carousel-slot-image"
                          aria-hidden="true"
                          fetchPriority="low"
                          loading="eager"
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
          className={`game-top-banner ${isSpinActive || resultBag ? "is-hidden" : ""}`}
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
        <div className={`game-controls ${isSpinActive || resultBag ? "is-hidden" : ""}`}>
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
            className={`game-result ${isResultSheetVisible ? "is-sheet-visible" : "is-bag-entering"}`}
            aria-label="Результат приза"
          >
            <div className="game-result-hero">
              <div className="game-result-bag-frame">
              <div
                className={`game-result-bag-visual ${resultBagFlight ? "is-hidden" : ""}`.trim()}
              >
                <img
                  ref={resultBagImageRef}
                    src={resultBag.path}
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
                      onClick={handleCopyResultCode}
                    >
                      <span className="game-result-code-text">
                        {isResultCopied ? "Перейти в приложение" : resultPrize.promoCode}
                      </span>
                      <img
                        src={isResultCopied ? "/intro/subscribe.webp" : "/game/icons/copy.svg"}
                        alt=""
                        className="game-result-code-icon"
                        aria-hidden="true"
                      />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="game-result-primary-action"
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
              src={resultBagFlight.path}
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
          <div className="game-result-copy-toast" role="status" aria-live="polite">
            <span className="game-result-copy-toast-text">Скопировано</span>
            <span className="game-result-copy-toast-check" aria-hidden="true">✓</span>
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
                      src={prize.image || ""}
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
                <p className="game-overlay-description">Пока призов нет. Крутите ленту, чтобы получить первый.</p>
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
