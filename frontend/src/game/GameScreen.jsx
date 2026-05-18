import { useEffect, useRef, useState } from "react"

const BAG_TEXTURES = [
  {
    key: "game-bag-1",
    slotPath: "/game/bags/case.webp",
    path: "/game/bags/case.webp",
    label: "case-1",
  },
  {
    key: "game-bag-2",
    slotPath: "/game/bags/case2.webp",
    path: "/game/bags/case2.webp",
    label: "case-2",
  },
  {
    key: "game-bag-3",
    slotPath: "/game/bags/case3.webp",
    path: "/game/bags/case3.webp",
    label: "case-3",
  },
  {
    key: "game-bag-4",
    slotPath: "/game/bags/case4.webp",
    path: "/game/bags/case4.webp",
    label: "case-4",
  },
  {
    key: "game-bag-5",
    slotPath: "/game/bags/case5.webp",
    path: "/game/bags/case5.webp",
    label: "case-5",
  },
]

const LEFT_TRIANGLE_PATH = "/game/left-triangle.svg"
const RIGHT_TRIANGLE_PATH = "/game/rigth-triangle.svg"
const CENTER_PATTERN_PATH = "/game/center.webp"
const SPIN_TOTAL_DURATION = 5000
const SURFACE_ANIMATION_DURATION = 420
const SPIN_MIN_FULL_LOOPS = 9
const SPIN_MAX_FULL_LOOPS = 11
const SLOT_GAP = 24
const TRACK_CENTER_OFFSET = 9
const TRACK_VISIBLE_START_OFFSET = TRACK_CENTER_OFFSET - 1
const TRACK_TAIL_BUFFER = 9
const SPIN_TOTAL_EASING = "cubic-bezier(0.18, 0.74, 0.24, 1)"
const TOP_BANNER_ACTIONS = [
  { id: "question", icon: "/game/icons/question.svg", label: "Вопрос" },
  { id: "exclamation", icon: "/game/icons/exclamation.svg", label: "Важно" },
  { id: "gift", icon: "/game/icons/gift.svg", label: "Подарки" },
]
const RESULT_PROMO_CODE = "AAAAAAAA"
const PRIZE_ITEMS = [
  {
    id: "prize-flight",
    image: "/intro/bags/colorful-bag.webp",
    title: "Скидка 300 ₽ на заказ авиа от 15 000 ₽",
    expiresAt: "до 31.08.26",
  },
  {
    id: "prize-hotel",
    image: "/intro/bags/pink-bag.webp",
    title: "Скидка 300 ₽ на заказ отеля от 5 000 ₽",
    expiresAt: "до 31.08.26",
  },
  {
    id: "prize-miles",
    image: "/game/bags/case4.webp",
    title: "300 миль",
    expiresAt: "до 30.06.26",
  },
  {
    id: "prize-green-flight",
    image: "/intro/bags/green-bag.webp",
    title: "Скидка 800 ₽ на первый заказ авиа от 15 000 ₽",
    expiresAt: "до 31.08.26",
  },
]

const getLoopedIndex = (value, length) => ((value % length) + length) % length

function createTrackItems(centerBagIndex, totalSteps) {
  const length = TRACK_CENTER_OFFSET + totalSteps + TRACK_TAIL_BUFFER

  return Array.from({ length }, (_, index) => {
    const bagIndex = getLoopedIndex(centerBagIndex + index - TRACK_CENTER_OFFSET, BAG_TEXTURES.length)
    return BAG_TEXTURES[bagIndex]
  })
}

export default function GameScreen() {
  const slotRef = useRef(null)
  const stepRef = useRef(0)
  const animationFrameRef = useRef(0)
  const overlayTimeoutRef = useRef(0)
  const pendingSpinRef = useRef(null)
  const centerBagIndexRef = useRef(0)
  const isSpinActiveRef = useRef(false)
  const [isSpinActive, setIsSpinActive] = useState(false)
  const [activeOverlay, setActiveOverlay] = useState(null)
  const [renderedOverlay, setRenderedOverlay] = useState(null)
  const [isOverlayClosing, setIsOverlayClosing] = useState(false)
  const [resultBag, setResultBag] = useState(null)
  const [isResultCopied, setIsResultCopied] = useState(false)
  const [centerBagIndex, setCenterBagIndex] = useState(0)
  const [trackItems, setTrackItems] = useState(() => createTrackItems(0, 0))
  const [trackTranslate, setTrackTranslate] = useState(0)
  const [isTrackAnimated, setIsTrackAnimated] = useState(false)
  const [trackAnimationDuration, setTrackAnimationDuration] = useState(SPIN_TOTAL_DURATION)
  const [trackAnimationEasing, setTrackAnimationEasing] = useState(SPIN_TOTAL_EASING)
  const [lockedSlotHeight, setLockedSlotHeight] = useState(null)

  const measureStep = () => {
    const nextStep = (slotRef.current?.getBoundingClientRect().height ?? 0) + SLOT_GAP

    if (nextStep > SLOT_GAP) {
      stepRef.current = nextStep
    }

    return stepRef.current
  }

  const resetCarousel = (nextCenterBagIndex = centerBagIndexRef.current) => {
    const step = measureStep()

    setIsTrackAnimated(false)
    setTrackAnimationDuration(SPIN_TOTAL_DURATION)
    setTrackAnimationEasing(SPIN_TOTAL_EASING)
    setLockedSlotHeight(null)
    setTrackItems(createTrackItems(nextCenterBagIndex, 0))

    if (step > 0) {
      setTrackTranslate(-TRACK_VISIBLE_START_OFFSET * step)
    }
  }

  const handleSpin = () => {
    if (isSpinActive || resultBag) {
      return
    }

    const step = measureStep()
    const currentCenterBagIndex = centerBagIndexRef.current

    if (!step) {
      return
    }

    const targetBagIndex = Math.floor(Math.random() * BAG_TEXTURES.length)
    const alignmentSteps = getLoopedIndex(
      targetBagIndex - currentCenterBagIndex,
      BAG_TEXTURES.length
    )
    const fullLoops =
      SPIN_MIN_FULL_LOOPS
      + Math.floor(Math.random() * (SPIN_MAX_FULL_LOOPS - SPIN_MIN_FULL_LOOPS + 1))
    const totalSteps = (fullLoops + 1) * BAG_TEXTURES.length + alignmentSteps

    pendingSpinRef.current = { targetBagIndex }

    clearTimeout(overlayTimeoutRef.current)
    setActiveOverlay(null)
    setRenderedOverlay(null)
    setIsOverlayClosing(false)
    setResultBag(null)
    setIsResultCopied(false)
    setIsSpinActive(true)
    setIsTrackAnimated(false)
    setTrackAnimationDuration(SPIN_TOTAL_DURATION)
    setTrackAnimationEasing(SPIN_TOTAL_EASING)
    setLockedSlotHeight(step - SLOT_GAP)
    setTrackItems(createTrackItems(currentCenterBagIndex, totalSteps))
    setTrackTranslate(-TRACK_VISIBLE_START_OFFSET * step)

    cancelAnimationFrame(animationFrameRef.current)
    animationFrameRef.current = requestAnimationFrame(() => {
      animationFrameRef.current = requestAnimationFrame(() => {
        setIsTrackAnimated(true)
        setTrackTranslate(-(TRACK_VISIBLE_START_OFFSET + totalSteps) * step)
      })
    })
  }

  const handleBannerAction = (actionId) => {
    clearTimeout(overlayTimeoutRef.current)
    setIsOverlayClosing(false)
    setActiveOverlay(actionId)
    setRenderedOverlay(actionId)

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

  const handleCloseOverlay = () => {
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
    setResultBag(null)
    setIsResultCopied(false)
    resetCarousel(centerBagIndexRef.current)
  }

  const handleCopyResultCode = async () => {
    try {
      await navigator.clipboard.writeText(RESULT_PROMO_CODE)
      setIsResultCopied(true)
    } catch {
      setIsResultCopied(true)
    }
  }

  const handleTrackTransitionEnd = (event) => {
    if (event.propertyName !== "transform" || !pendingSpinRef.current) {
      return
    }

    const { targetBagIndex } = pendingSpinRef.current
    pendingSpinRef.current = null
    centerBagIndexRef.current = targetBagIndex

    // Let the browser paint the final transform frame before swapping the UI.
    cancelAnimationFrame(animationFrameRef.current)
    animationFrameRef.current = requestAnimationFrame(() => {
      setCenterBagIndex(targetBagIndex)
      setResultBag(BAG_TEXTURES[targetBagIndex])
      setIsSpinActive(false)
    })
  }

  useEffect(() => {
    if (activeOverlay) {
      clearTimeout(overlayTimeoutRef.current)
      setRenderedOverlay(activeOverlay)
      setIsOverlayClosing(false)
    }
  }, [activeOverlay])

  useEffect(() => {
    const syncCarousel = () => {
      const measuredHeight = slotRef.current?.getBoundingClientRect().height ?? 0
      const step = measuredHeight > 0 ? measuredHeight + SLOT_GAP : stepRef.current

      if (step > SLOT_GAP) {
        stepRef.current = step
        setIsTrackAnimated(false)
        setTrackItems(createTrackItems(centerBagIndexRef.current, 0))
        setTrackTranslate(-TRACK_VISIBLE_START_OFFSET * step)
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
    }
  }, [])

  useEffect(() => {
    centerBagIndexRef.current = centerBagIndex
  }, [centerBagIndex])

  useEffect(() => {
    isSpinActiveRef.current = isSpinActive
  }, [isSpinActive])

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
        <div className={`game-stage ${resultBag ? "is-result-mode" : ""}`}>
          <div className={`game-carousel-scene ${isSpinActive ? "is-spinning" : ""}`}>
            <div className="game-carousel-backdrop">
              <div
                className={`game-carousel-pattern ${isTrackAnimated ? "is-animating" : ""}`}
                style={{
                  backgroundPosition: `center ${trackTranslate}px`,
                  transitionDuration: isTrackAnimated ? `${trackAnimationDuration}ms` : undefined,
                  transitionTimingFunction: isTrackAnimated ? trackAnimationEasing : undefined,
                }}
                aria-hidden="true"
              />
              <div className="game-carousel-viewport">
                <div
                  className={`game-carousel-track ${isTrackAnimated ? "is-animating" : ""}`}
                  style={{
                    transform: `translate3d(0, ${trackTranslate}px, 0)`,
                    transitionDuration: isTrackAnimated ? `${trackAnimationDuration}ms` : undefined,
                    transitionTimingFunction: isTrackAnimated ? trackAnimationEasing : undefined,
                  }}
                  onTransitionEnd={handleTrackTransitionEnd}
                >
                  {trackItems.map((bag, index) => (
                    <div
                      key={`${bag.key}-${index}`}
                      ref={index === 0 ? slotRef : null}
                      className="game-carousel-slot"
                      style={lockedSlotHeight ? { height: `${lockedSlotHeight}px` } : undefined}
                    >
                      <img
                        src={bag.slotPath}
                        alt=""
                        className="game-carousel-slot-image"
                        aria-hidden="true"
                        fetchPriority="low"
                        loading="eager"
                      />
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
            disabled={isSpinActive}
          >
            <span className="game-spin-button-label">Крутить</span>
            <span className="game-spin-button-attempt">1 попытка</span>
          </button>
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
                  <button type="button" className="game-overlay-action game-overlay-action--primary">
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
        {resultBag ? (
          <section className="game-result" aria-label="Результат приза">
            <img
              src={resultBag.path}
              alt={resultBag.label}
              className="game-result-bag"
            />
            <div className="game-result-sheet">
              <div className="game-result-sheet-inner">
                <p className="game-result-kicker">Ваш приз</p>
                <h2 className="game-result-title">1 000 баллов Ozon</h2>
                <p className="game-result-description">
                  Оплатите ими до 90% любых товаров
                  <br />
                  в приложении Ozon. Активируйте промокод
                  <br />
                  до 30.06.26 в разделе «Коды и сертификаты».
                </p>
                <div className="game-result-actions">
                  <button type="button" className="game-result-code" onClick={handleCopyResultCode}>
                    <span className="game-result-code-text">
                      {isResultCopied ? "Скопировано" : RESULT_PROMO_CODE}
                    </span>
                    <img
                      src={isResultCopied ? "/game/icons/check.svg" : "/game/icons/copy.svg"}
                      alt=""
                      className="game-result-code-icon"
                      aria-hidden="true"
                    />
                  </button>
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
              {PRIZE_ITEMS.map((prize) => (
                <article key={prize.id} className="game-prize-card">
                  <img
                    src={prize.image}
                    alt=""
                    className="game-prize-card-image"
                    aria-hidden="true"
                  />
                  <div className="game-prize-card-content">
                    <h3 className="game-prize-card-title">{prize.title}</h3>
                    <p className="game-prize-card-date">{prize.expiresAt}</p>
                  </div>
                </article>
              ))}
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
