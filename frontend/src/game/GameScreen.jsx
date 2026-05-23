import { startTransition, useEffect, useRef, useState } from "react"

import { getJson, postJson, trackGameEvent } from "../api.js"

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
const SLOT_GAP = 24
const TRACK_CENTER_OFFSET = 9
const TRACK_VISIBLE_START_OFFSET = TRACK_CENTER_OFFSET - 1
const TRACK_TAIL_BUFFER = 9
const SPIN_TOTAL_EASING = "cubic-bezier(0.12, 0.72, 0.2, 1)"
const RESULT_REVEAL_DELAY = 72
const DEBUG_PANEL_UPDATE_INTERVAL = 120
const BOOTSTRAP_CACHE_KEY = "ozon-travel-bootstrap-cache"
const NON_PRIZE_COPY = "Ваш багаж прилетит следующим рейсом.\nВозвращайтесь за ним завтра!\n\nА пока держите интересный факт:"
const REFERRAL_SHARE_TITLE = "Приглашаю в игру"
const TOP_BANNER_ACTIONS = [
  { id: "question", icon: "/game/icons/question.svg", label: "Вопрос" },
  { id: "exclamation", icon: "/game/icons/exclamation.svg", label: "Важно" },
  { id: "gift", icon: "/game/icons/gift.svg", label: "Подарки" },
]
const getLoopedIndex = (value, length) => ((value % length) + length) % length

function roundToDevicePixel(value) {
  const ratio = typeof window !== "undefined" && Number(window.devicePixelRatio) > 0
    ? Number(window.devicePixelRatio)
    : 1

  return Math.round(Number(value || 0) * ratio) / ratio
}

function easeSpinProgress(value) {
  const progress = Math.min(1, Math.max(0, Number(value) || 0))
  const easedOut = 1 - ((1 - progress) ** 1.03)
  return easedOut * easedOut * (3 - (2 * easedOut))
}

function getSpinDistanceMultiplier() {
  if (typeof window === "undefined") {
    return 1
  }

  const viewportWidth = Math.max(
    Number(window.Telegram?.WebApp?.viewportStableWidth) || 0,
    Number(window.Telegram?.WebApp?.viewportWidth) || 0,
    Number(window.innerWidth) || 0,
  )

  return viewportWidth > 0 && viewportWidth <= 768
    ? MOBILE_SPIN_DISTANCE_MULTIPLIER
    : 1
}

function getSpinDurationMs(totalSteps, step) {
  const safeTotalSteps = Math.max(0, Number(totalSteps) || 0)
  const safeStep = Math.max(0, Number(step) || 0)
  const viewportHeight = typeof window !== "undefined"
    ? Math.max(
      Number(window.Telegram?.WebApp?.viewportStableHeight) || 0,
      Number(window.innerHeight) || 0,
      1,
    )
    : 1
  const distancePx = safeTotalSteps * safeStep
  const durationByViewport = distancePx > 0
    ? (distancePx / (viewportHeight * SPIN_SCREENFULS_PER_SECOND)) * 1000
    : SPIN_MIN_DURATION

  return Math.round(Math.min(SPIN_MAX_DURATION, Math.max(SPIN_MIN_DURATION, durationByViewport)))
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

function readBootstrapCache() {
  if (typeof window === "undefined") {
    return null
  }

  try {
    const rawValue = window.sessionStorage.getItem(BOOTSTRAP_CACHE_KEY)

    if (!rawValue) {
      return null
    }

    const parsed = JSON.parse(rawValue)
    return parsed && typeof parsed === "object" ? parsed : null
  } catch {
    return null
  }
}

function writeBootstrapCache(value) {
  if (typeof window === "undefined") {
    return
  }

  try {
    window.sessionStorage.setItem(BOOTSTRAP_CACHE_KEY, JSON.stringify(value))
  } catch {
    // Ignore sessionStorage failures.
  }
}

function buildReferralShareText(referralLink) {
  const normalizedReferralLink = String(referralLink || "").trim()

  return [REFERRAL_SHARE_TITLE, normalizedReferralLink].filter(Boolean).join("\n\n")
}

function buildMaxShareLink(text) {
  return `https://max.ru/:share?text=${encodeURIComponent(String(text || "").trim())}`
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

  if (!isNonPrize) {
    return <p className={className}>{text}</p>
  }

  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)

  return (
    <div className="game-result-description-stack">
      {paragraphs.map((paragraph, paragraphIndex) => {
        const explicitLines = paragraph
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
        const sentenceLines = paragraphIndex === 0 && explicitLines.length === 1
          ? paragraph
            .split(/(?<=[.!?])\s+/)
            .map((line) => line.trim())
            .filter(Boolean)
          : []
        const lines = sentenceLines.length > 1 ? sentenceLines : explicitLines

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

  const matchedItem = Array.isArray(rouletteItems)
    ? rouletteItems.find((item) => item.id === result.positionId)
    : null

  return {
    id: result.positionId ?? matchedItem?.id ?? null,
    key: matchedItem?.key || `result-${result.positionId ?? "item"}`,
    assetVersion: matchedItem?.assetVersion || 0,
    path: result.image || "",
    slotPath: result.image || "",
    label: result.fullTitle || result.title || matchedItem?.label || `result-${result.positionId ?? "item"}`,
    title: result.fullTitle || result.title || matchedItem?.title || "",
    description: result.description || matchedItem?.description || "",
    myPrizeText: result.myPrizeText || matchedItem?.myPrizeText || result.title || "",
    expiresAt: result.expiresAt || matchedItem?.expiresAt || "",
    chanceValue: matchedItem?.chanceValue || "1x",
    type: result.type || matchedItem?.type || "Приз",
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

export default function GameScreen() {
  const cachedBootstrap = readBootstrapCache()
  const slotRef = useRef(null)
  const patternRef = useRef(null)
  const trackRef = useRef(null)
  const stepRef = useRef(0)
  const animationFrameRef = useRef(0)
  const overlayTimeoutRef = useRef(0)
  const resultRevealTimeoutRef = useRef(0)
  const virtualTranslateRef = useRef(0)
  const pendingSpinRef = useRef(null)
  const centerBagIndexRef = useRef(0)
  const isSpinActiveRef = useRef(false)
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

  const openOverlay = (overlayId) => {
    clearTimeout(overlayTimeoutRef.current)
    setIsOverlayClosing(false)
    setActiveOverlay(overlayId)
    setRenderedOverlay(overlayId)
  }

  const applyTrackStyles = (translateY, patternOffsetY = translateY) => {
    const normalizedTranslateY = roundToDevicePixel(translateY)
    const normalizedPatternOffsetY = roundToDevicePixel(patternOffsetY)

    if (trackRef.current) {
      trackRef.current.style.transform = `translate3d(0, ${normalizedTranslateY}px, 0)`
    }

    if (patternRef.current) {
      patternRef.current.style.backgroundPosition = `center ${normalizedPatternOffsetY}px`
    }
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

    let spinResponse
    void trackGameEvent("spin_clicked", {
      activeItemsCount: activeRouletteItems.length,
    })

    try {
      spinResponse = await postJson("/game/spin", {})
    } catch (error) {
      console.warn("Spin request failed", error)

      if (error?.code === "PROMO_CODES_EXHAUSTED") {
        setSpinError("")
        openOverlay("promo-exhausted")
        return
      }

      setSpinError(error.message || "Не удалось выполнить попытку")
      return
    }

    const targetPositionId = spinResponse?.result?.positionId
    const targetBagIndex = Math.max(
      0,
      activeRouletteItems.findIndex((item) => item.id === targetPositionId)
    )
    const matchedRouletteItem = activeRouletteItems[targetBagIndex] || null
    const assetVersion = matchedRouletteItem?.assetVersion || Date.now()
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

    const alignmentSteps = getLoopedIndex(
      targetBagIndex - currentCenterBagIndex,
      activeRouletteItems.length
    )
    const fullLoops =
      SPIN_MIN_FULL_LOOPS
      + Math.floor(Math.random() * (SPIN_MAX_FULL_LOOPS - SPIN_MIN_FULL_LOOPS + 1))
    const baseLoopCycles = fullLoops + 1
    const loopCycles = Math.max(
      1,
      Math.round(baseLoopCycles * getSpinDistanceMultiplier()),
    )
    const loopSteps = loopCycles * activeRouletteItems.length
    const totalSteps = loopSteps + alignmentSteps
    const durationMs = getSpinDurationMs(totalSteps, step)

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
    setSpinError("")
    setActiveOverlay(null)
    setRenderedOverlay(null)
    setIsOverlayClosing(false)
    setResultBag(null)
    setResultPrize(null)
    setIsResultCopied(false)
    setIsSpinActive(true)
    setLockedSlotHeight(step - SLOT_GAP)
    setTrackItems(createTrackItems(
      activeRouletteItems,
      currentCenterBagIndex,
      getTrackWindowSteps(activeRouletteItems.length),
    ))
    const baseTranslate = roundToDevicePixel(-TRACK_VISIBLE_START_OFFSET * step)
    setTrackTranslate(baseTranslate)
    virtualTranslateRef.current = baseTranslate

    cancelAnimationFrame(animationFrameRef.current)
    animationFrameRef.current = requestAnimationFrame(() => {
      const runSpinFrame = (frameAt) => {
        const spinState = pendingSpinRef.current

        if (!spinState) {
          return
        }

        if (!spinState.startedAt) {
          spinState.startedAt = frameAt
        }

        const progress = Math.min(1, (frameAt - spinState.startedAt) / Math.max(1, spinState.durationMs || 0))
        const easedProgress = easeSpinProgress(progress)
        const traveledSteps = spinState.totalSteps * easedProgress
        const wholeSteps = Math.floor(traveledSteps)
        const fractionalStep = traveledSteps - wholeSteps
        const cycleLength = activeRouletteItems.length
        const localWholeSteps = wholeSteps % cycleLength
        const localTraveledSteps = localWholeSteps + fractionalStep
        virtualTranslateRef.current = -(TRACK_VISIBLE_START_OFFSET + traveledSteps) * spinState.step

        applyTrackStyles(
          -(TRACK_VISIBLE_START_OFFSET + localTraveledSteps) * spinState.step,
          -(localTraveledSteps * spinState.step),
        )

        if (progress < 1) {
          animationFrameRef.current = requestAnimationFrame(runSpinFrame)
          return
        }

        const finalOffsetSteps = spinState.totalSteps % cycleLength
        virtualTranslateRef.current = -(TRACK_VISIBLE_START_OFFSET + spinState.totalSteps) * spinState.step
        applyTrackStyles(
          -(TRACK_VISIBLE_START_OFFSET + finalOffsetSteps) * spinState.step,
          -(finalOffsetSteps * spinState.step),
        )
        pendingSpinRef.current = null
        centerBagIndexRef.current = spinState.targetBagIndex

        clearTimeout(resultRevealTimeoutRef.current)
        resultRevealTimeoutRef.current = window.setTimeout(() => {
          startTransition(() => {
            setCenterBagIndex(spinState.targetBagIndex)
            setResultBag(buildResultBag(spinState.result, activeRouletteItems))
            setResultPrize(spinState.result)
            setMyPrizes(spinState.myPrizes)
            setAvailableAttempts(Number(spinState.attempts?.availableAttempts || 0))
            setIsSpinActive(false)
          })
        }, RESULT_REVEAL_DELAY)

        void trackGameEvent("spin_result_shown", {
          positionId: spinState.result?.positionId ?? activeRouletteItems[spinState.targetBagIndex]?.id ?? null,
          type: spinState.result?.type || activeRouletteItems[spinState.targetBagIndex]?.type || "",
          hasPromoCode: Boolean(spinState.result?.promoCode),
        })
      }

      applyTrackStyles(baseTranslate, 0)
      animationFrameRef.current = requestAnimationFrame(runSpinFrame)
    })
  }

  const handleBannerAction = (actionId) => {
    void trackGameEvent("overlay_opened", {
      overlayId: actionId,
      myPrizesCount: actionId === "gift" ? myPrizes.length : undefined,
    })
    openOverlay(actionId)

    if (actionId === "question") {
      return
    }

    if (actionId === "exclamation") {
      return
    }

    if (actionId === "gift") {
      return
    }
  }

  const handleInviteFriend = async () => {
    const shareText = buildReferralShareText(referralLink)

    if (!shareText) {
      setSpinError("Не удалось подготовить реферальную ссылку")
      return
    }

    void trackGameEvent("referral_share_clicked", {
      hasReferralLink: Boolean(referralLink),
    })

    try {
      if (typeof window !== "undefined" && typeof window.WebApp?.shareMaxContent === "function") {
        const result = await window.WebApp.shareMaxContent({
          text: REFERRAL_SHARE_TITLE,
          link: referralLink,
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
      setSpinError("Не удалось открыть отправку в MAX")
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
    setResultBag({
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
    })
    setResultPrize({
      type: prize.type || "Приз",
      title: prize.title || "",
      myPrizeText: prize.myPrizeText || prize.title || "",
      description: prize.description || "",
      image: prize.image || "",
      promoCode: prize.promoCode || "",
      expiresAt: prize.expiresAt || "",
    })
  }

  const handleCopyResultCode = async () => {
    if (!resultPrize?.promoCode) {
      return
    }

    try {
      await navigator.clipboard.writeText(resultPrize.promoCode)
      setIsResultCopied(true)
      void trackGameEvent("promo_code_copied", {
        prizeId: resultBag?.id ?? null,
        codeLength: String(resultPrize.promoCode).length,
      })
    } catch {
      setIsResultCopied(true)
    }
  }

  const loadGameBootstrap = async () => {
    try {
      const response = await getJson("/game/bootstrap")
      const assetVersion = Date.now()

      if (!isMountedRef.current) {
        return
      }

      const nextRouletteItems = normalizeRouletteItems(response?.rouletteItems, assetVersion)
      const nextMyPrizes = normalizeMyPrizes(response?.myPrizes, assetVersion)

      setRouletteItems(nextRouletteItems)
      setMyPrizes(nextMyPrizes)
      setAvailableAttempts(Number(response?.attempts?.availableAttempts || 0))
      setReferralLink(String(response?.referral?.referralLink || "").trim())
      setSpinError(nextRouletteItems.length ? "" : "Сервер не вернул позиции для карусели")
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
      setSpinError(error.message || "Не удалось загрузить игру")
    }
  }

  const handleDevGrantAttempts = async () => {
    try {
      const response = await postJson("/game/dev/grant-attempts", {
        count: 10,
      })
      setAvailableAttempts(Number(response?.attempts?.availableAttempts || 0))
      setSpinError("")
      setIsDevWidgetOpen(false)
    } catch (error) {
      setSpinError(error.message || "Не удалось начислить попытки")
    }
  }

  const handleDevReloadBootstrap = async () => {
    if (isDevBootstrapReloading) {
      return
    }

    setIsDevBootstrapReloading(true)
    cancelAnimationFrame(animationFrameRef.current)
    pendingSpinRef.current = null
    clearTimeout(overlayTimeoutRef.current)
    clearTimeout(resultRevealTimeoutRef.current)
    setActiveOverlay(null)
    setRenderedOverlay(null)
    setIsOverlayClosing(false)
    setResultBag(null)
    setResultPrize(null)
    setIsResultCopied(false)
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
      setSpinError(error.message || "Не удалось удалить игрока")
    }
  }

  useEffect(() => {
    if (activeOverlay) {
      clearTimeout(overlayTimeoutRef.current)
      setRenderedOverlay(activeOverlay)
      setIsOverlayClosing(false)
    }
  }, [activeOverlay])

  useEffect(() => {
    void loadGameBootstrap()

    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    centerBagIndexRef.current = 0
    setCenterBagIndex(0)
    setTrackItems(createTrackItems(activeRouletteItems, 0, getTrackWindowSteps(activeRouletteItems.length)))
    setTrackTranslate(0)
    setLockedSlotHeight(null)
  }, [rouletteItems])

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
      cancelAnimationFrame(animationFrameRef.current)
      clearTimeout(overlayTimeoutRef.current)
      clearTimeout(resultRevealTimeoutRef.current)
    }
  }, [activeRouletteItems])

  useEffect(() => {
    centerBagIndexRef.current = centerBagIndex
  }, [centerBagIndex])

  useEffect(() => {
    isSpinActiveRef.current = isSpinActive
  }, [isSpinActive])

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
        <div className={`game-stage ${resultBag ? "is-result-mode" : ""}`}>
          <div className={`game-carousel-scene ${isSpinActive ? "is-spinning" : ""}`}>
            <div className="game-carousel-backdrop">
              <div
                ref={patternRef}
                className="game-carousel-pattern"
                aria-hidden="true"
              />
              <div className="game-carousel-viewport">
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
                      <div className="game-carousel-slot-media">
                        <img
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
            className="game-spin-button"
            onClick={handleSpin}
            disabled={isSpinActive || availableAttempts <= 0}
          >
            <span className="game-spin-button-label">Крутить</span>
            <span className="game-spin-button-attempt">{formatAttemptsLabel(availableAttempts)}</span>
          </button>
          {spinError ? (
            <p className="game-result-description" style={{ marginTop: "12px", textAlign: "center" }}>
              {spinError}
            </p>
          ) : null}
        </div>
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
                  <button type="button" className="game-overlay-action game-overlay-action--primary">
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
                  <span>Возвращайтесь каждый день, чтобы крутить</span>
                  <span>Ленту призов, а также приглашайте друзей</span>
                  <span>и получайте больше попыток. За каждого</span>
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
          <section className="game-result" aria-label="Результат приза">
            <div className="game-result-bag-frame">
              <img
                src={resultBag.path}
                alt={resultBag.label}
                className="game-result-bag"
              />
            </div>
            <div className="game-result-sheet">
              <div className="game-result-sheet-inner">
                {resultPrize?.type !== "Не приз" ? (
                  <p className="game-result-kicker">
                    Ваш приз
                  </p>
                ) : null}
                <h2 className="game-result-title">{resultPrize?.title || resultBag?.title || "Позиция"}</h2>
                {resultPrize?.type === "Не приз" ? (
                  <>
                    {renderResultDescription(NON_PRIZE_COPY, true)}
                    {renderResultDescription(
                      resultPrize?.description || resultBag?.description,
                      true,
                      "game-result-description--dark",
                    )}
                  </>
                ) : renderResultDescription(
                  resultPrize?.description || resultBag?.description,
                  false,
                )}
                <div className="game-result-actions">
                  {resultPrize?.promoCode ? (
                    <button type="button" className="game-result-code" onClick={handleCopyResultCode}>
                      <span className="game-result-code-text">
                        {isResultCopied ? "Скопировано" : resultPrize.promoCode}
                      </span>
                      <img
                        src={isResultCopied ? "/game/icons/check.svg" : "/game/icons/copy.svg"}
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
