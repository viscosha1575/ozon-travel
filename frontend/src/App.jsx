import { memo, startTransition, useCallback, useEffect, useRef, useState } from "react"

import { getJson, postJson, trackGameEvent } from "./api.js"
import { logDevWarn } from "./devLogger.js"
import { fetchGameBootstrap, getBootstrapAssetVersion } from "./gameBootstrap.js"
import { resolveCachedImageSource, useCachedImageSources, warmImageCache } from "./imageCache.js"
import GameScreen from "./game/GameScreen.jsx"
import { getMiniApp, getMiniAppPlatform, isMaxMiniApp, isTelegramMiniApp, openExternalLink } from "./telegram.js"

const INTRO_DISABLED = false
const APP_OPEN_STORAGE_KEY = "ozon-travel-app-open-tracked"
const SUBSCRIPTION_CHANNEL_URL = String(
  import.meta.env.VITE_MAX_CHANNEL_URL || "https://max.ru/ozontravel_official",
).trim()
const SUBSCRIPTION_RETURN_BOT_URL = String(
  import.meta.env.VITE_MAX_BOT_RETURN_URL || "https://max.ru/ozontravel_lenta_bot?start=subscription_return",
).trim()
const SUPPORT_CONTACT = String(import.meta.env.VITE_SUPPORT_CONTACT || "@ozon_travel_support_bot").trim()
const IMPORTANT_INFO_URL = "https://cdn1.ozone.ru/s3/promo-sync-api/1077004356.html"
const INITIAL_INTRO_VISIBILITY_FALLBACK_MS = 1200
const EMBEDDED_PAGE_CLOSE_EVENT = "ozon-travel-embedded-page-close"
let embeddedPageModulePromise = null

const screens = [
  {
    id: "intro",
    kicker: ["Ловите ваш багаж!"],
    titleLines: ["Промокоды", "на путешествия и шоппинг"],
    accentLine: {
      before: "до ",
      amount: "100 000",
      iconSrc: "/intro/vectors/b.svg",
      accessibleText: "100 000 баллов",
      after: " на Ozon",
    },
    description: [
      "Крутите каждый день, приглашайте друзей",
      "и получайте больше попыток",
    ],
    actionLabel: "Начать",
  },
  {
    id: "subscription",
    variant: "subscription",
    compact: true,
    titleLines: ["Перед стартом подпишитесь", "на канал Ozon Travel"],
    actionLabel: "Подписаться",
    secondaryActionLabel: "Проверить подписку",
  },
  {
    id: "subscription-failed",
    variant: "subscription-failed",
    compact: true,
    titleLines: ["Упс!"],
    description: [
      "Вы не подписаны на канал Ozon Travel.",
      "Самое время это исправить!",
    ],
    actionLabel: "Подписаться",
  },
  {
    id: "result",
    variant: "result",
    compact: true,
    titleLines: ["Ура!"],
    description: [
      "Лента призов уже ждёт вас! Заходите в мини-",
      "приложение и ловите ваш багаж с призами",
    ],
    actionLabel: "Играть",
  },
]

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

function getMaxLaunchErrorMessage(errorCode, platform) {
  const normalizedCode = String(errorCode || "").trim().toUpperCase()

  if (!normalizedCode) {
    return ""
  }

  if (
    normalizedCode === "MAX_INIT_DATA_MISSING"
    || normalizedCode === "MAX_INIT_DATA_REQUIRED"
    || normalizedCode === "MAX_INIT_DATA_INVALID_PAYLOAD"
    || normalizedCode === "MAX_INIT_DATA_INVALID_HASH_COUNT"
    || normalizedCode === "MAX_INIT_DATA_DUPLICATE_FIELDS"
  ) {
    return "MAX открыл мини-приложение без данных профиля. Откройте его заново из чата с ботом. Если лента не появится, напишите в поддержку и передайте ваш MAX ID."
  }

  if (
    normalizedCode === "MAX_INIT_DATA_EXPIRED"
    || normalizedCode === "MAX_INIT_DATA_INVALID_SIGNATURE"
  ) {
    return "Сессия запуска MAX устарела. Закройте мини-приложение и откройте его заново из чата с ботом."
  }

  return "Не удалось подтвердить запуск мини-приложения в MAX. Откройте его заново из чата с ботом или напишите в поддержку."
}

const PersistentGameScreen = memo(GameScreen)
const IMPORTANT_INFO_TITLE = "Условия акции"

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function loadEmbeddedPageModule() {
  if (!embeddedPageModulePromise) {
    embeddedPageModulePromise = import("./embeddedPage.js")
  }

  return embeddedPageModulePromise
}

function withBootstrapAssetVersion(url, assetVersion) {
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

function collectBootstrapCarouselImageUrls(response, assetVersion) {
  return Array.from(
    new Set(
      (Array.isArray(response?.rouletteItems) ? response.rouletteItems : [])
        .map((item) => withBootstrapAssetVersion(item?.image, assetVersion))
        .filter(Boolean),
    ),
  )
}

function App() {
  const isTelegramHost = isTelegramMiniApp()
  const isMaxHost = isMaxMiniApp()
  const isMiniAppHost = isTelegramHost || isMaxHost
  const [activeScreen, setActiveScreen] = useState(0)
  const [isGameActive, setIsGameActive] = useState(INTRO_DISABLED)
  const [isGameSceneReady, setIsGameSceneReady] = useState(INTRO_DISABLED)
  const [isGameLaunchPending, setIsGameLaunchPending] = useState(false)
  const [isUserSubscribed, setIsUserSubscribed] = useState(null)
  const [isSubscriptionCheckPending, setIsSubscriptionCheckPending] = useState(false)
  const [isProjectFinished, setIsProjectFinished] = useState(null)
  const [prefetchedGameBootstrap, setPrefetchedGameBootstrap] = useState(null)
  const [prefetchedGameAssetVersion, setPrefetchedGameAssetVersion] = useState(0)
  const [isGameBootstrapPreloading, setIsGameBootstrapPreloading] = useState(!INTRO_DISABLED)
  const [projectFinishedMyPrizes, setProjectFinishedMyPrizes] = useState([])
  const [isProjectFinishedPrizesOpen, setIsProjectFinishedPrizesOpen] = useState(false)
  const [projectFinishedOverlay, setProjectFinishedOverlay] = useState(null)
  const [embeddedPage, setEmbeddedPage] = useState(null)
  const [isInitialIntroMounted, setIsInitialIntroMounted] = useState(INTRO_DISABLED)
  const [maxLaunchError, setMaxLaunchError] = useState("")
  const embeddedPageRequestRef = useRef(0)
  const initialIntroMountCommittedRef = useRef(INTRO_DISABLED)
  const currentScreen = screens[activeScreen]
  const canOpenGame = isTelegramHost || isUserSubscribed === true
  const miniAppPlatform = getMiniAppPlatform()
  const projectFinishedPrizeImageSources = useCachedImageSources(
    projectFinishedMyPrizes.map((item) => item?.image || ""),
  )
  const deferredGameBootstrap = !INTRO_DISABLED
    && isProjectFinished !== true
    && !isGameActive
    && isGameBootstrapPreloading
  const visibleProjectFinishedMyPrizes = isProjectFinished ? projectFinishedMyPrizes : []
  const activeProjectFinishedOverlay = isProjectFinished ? projectFinishedOverlay : null
  const isProjectFinishedPrizesDialogOpen = isProjectFinished ? isProjectFinishedPrizesOpen : false

  const pollSubscriptionStatus = useCallback(async ({
    attempts,
    delayMs = 0,
    onProgress,
  }) => {
    const totalAttempts = Math.max(1, Number(attempts) || 1)
    let lastResponse = null

    for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
      onProgress?.(attempt, totalAttempts)

      const subscriptionStatus = await getJson("/game/subscription-status")
      const isSubscribed = Boolean(subscriptionStatus?.user?.subscribedToChannel)
      lastResponse = subscriptionStatus

      if (isSubscribed || attempt >= totalAttempts || !isMaxHost) {
        return {
          isSubscribed,
          subscriptionStatus,
          attemptsUsed: attempt,
        }
      }

      if (delayMs > 0) {
        await wait(delayMs)
      }
    }

    return {
      isSubscribed: Boolean(lastResponse?.user?.subscribedToChannel),
      subscriptionStatus: lastResponse,
      attemptsUsed: totalAttempts,
    }
  }, [isMaxHost])

  useEffect(() => {
    let isCancelled = false
    const shouldTrackOpen = typeof window === "undefined"
      ? true
      : window.sessionStorage.getItem(APP_OPEN_STORAGE_KEY) !== "1"

    if (typeof window !== "undefined" && shouldTrackOpen) {
      window.sessionStorage.setItem(APP_OPEN_STORAGE_KEY, "1")
    }

    const initApp = async () => {
      try {
        const response = await postJson("/game/open", {
          entryScreen: INTRO_DISABLED ? "game" : "intro",
          trackOpen: shouldTrackOpen,
        })
        const projectFinished = Boolean(response?.projectFinished)

        if (isCancelled) {
          return
        }

        if (isMaxHost) {
          setMaxLaunchError(getMaxLaunchErrorMessage(response?.user?.errorCode, miniAppPlatform))
          setIsUserSubscribed(response?.user?.subscribedToChannel === true)
        }

        setIsProjectFinished(projectFinished)

        if (projectFinished || isTelegramHost) {
          return
        }

      } catch (error) {
        if (isCancelled) {
          return
        }

        logDevWarn("Game open tracking failed", error)
        setIsUserSubscribed(false)
        setProjectFinishedMyPrizes([])
        setIsProjectFinishedPrizesOpen(false)
        setProjectFinishedOverlay(null)
        setIsProjectFinished(false)
        setMaxLaunchError("")
      }
    }

    void initApp()

    return () => {
      isCancelled = true
    }
  }, [isMaxHost, isTelegramHost, miniAppPlatform, pollSubscriptionStatus])

  useEffect(() => {
    if (INTRO_DISABLED || isProjectFinished === true || isProjectFinished === null) {
      return
    }

    const canPreloadRemoteBootstrap = isTelegramHost || isUserSubscribed === true

    if (isGameSceneReady && (!canPreloadRemoteBootstrap || prefetchedGameBootstrap)) {
      return
    }

    let isCancelled = false
    const startPreload = window.setTimeout(() => {
      const preloadGameScene = async () => {
        setIsGameBootstrapPreloading(true)
        let bootstrapResponse = prefetchedGameBootstrap
        let assetVersion = prefetchedGameAssetVersion

        if (canPreloadRemoteBootstrap && !bootstrapResponse) {
          try {
            bootstrapResponse = await fetchGameBootstrap()
            assetVersion = getBootstrapAssetVersion(bootstrapResponse?.assetVersion)
            await warmImageCache(
              collectBootstrapCarouselImageUrls(bootstrapResponse, assetVersion),
            )
          } catch (error) {
            logDevWarn("Intro bootstrap preload failed", error)
          }
        }

        if (isCancelled) {
          return
        }

        setPrefetchedGameBootstrap(bootstrapResponse)
        setPrefetchedGameAssetVersion(assetVersion)
        setIsGameBootstrapPreloading(false)
        setIsGameSceneReady(true)
      }

      void preloadGameScene()
    }, 0)

    return () => {
      isCancelled = true
      window.clearTimeout(startPreload)
    }
  }, [
    isGameSceneReady,
    isProjectFinished,
    isTelegramHost,
    isUserSubscribed,
    prefetchedGameAssetVersion,
    prefetchedGameBootstrap,
  ])

  useEffect(() => {
    if (!isProjectFinished) {
      return
    }

    let cancelled = false

    void fetchGameBootstrap()
      .then((response) => {
        if (!cancelled) {
          setProjectFinishedMyPrizes(Array.isArray(response?.myPrizes) ? response.myPrizes : [])
        }
      })
      .catch((error) => {
        logDevWarn("Project finished prizes bootstrap failed", error)
      })

    return () => {
      cancelled = true
    }
  }, [isProjectFinished])

  useEffect(() => {
    if (INTRO_DISABLED || isGameActive || isProjectFinished !== false || initialIntroMountCommittedRef.current) {
      return undefined
    }

    let isCancelled = false
    let firstFrameId = 0
    let secondFrameId = 0
    let fallbackTimeoutId = 0

    const commitIntroMount = () => {
      if (isCancelled || initialIntroMountCommittedRef.current) {
        return
      }

      firstFrameId = window.requestAnimationFrame(() => {
        secondFrameId = window.requestAnimationFrame(() => {
          if (isCancelled || initialIntroMountCommittedRef.current) {
            return
          }

          initialIntroMountCommittedRef.current = true
          setIsInitialIntroMounted(true)
        })
      })
    }

    const handleVisibilityReady = () => {
      if (document.visibilityState !== "visible") {
        return
      }

      window.removeEventListener("pageshow", handleVisibilityReady)
      window.removeEventListener("focus", handleVisibilityReady)
      document.removeEventListener("visibilitychange", handleVisibilityReady)
      commitIntroMount()
    }

    if (!isMiniAppHost || document.visibilityState === "visible") {
      commitIntroMount()
    } else {
      window.addEventListener("pageshow", handleVisibilityReady)
      window.addEventListener("focus", handleVisibilityReady)
      document.addEventListener("visibilitychange", handleVisibilityReady)
      fallbackTimeoutId = window.setTimeout(() => {
        commitIntroMount()
      }, INITIAL_INTRO_VISIBILITY_FALLBACK_MS)
    }

    return () => {
      isCancelled = true
      window.cancelAnimationFrame(firstFrameId)
      window.cancelAnimationFrame(secondFrameId)
      window.clearTimeout(fallbackTimeoutId)
      window.removeEventListener("pageshow", handleVisibilityReady)
      window.removeEventListener("focus", handleVisibilityReady)
      document.removeEventListener("visibilitychange", handleVisibilityReady)
    }
  }, [isGameActive, isMiniAppHost, isProjectFinished])

  useEffect(() => {
    if (!isGameLaunchPending || !isGameSceneReady || !canOpenGame) {
      return
    }

    startTransition(() => {
      setIsGameActive(true)
    })
    setIsSubscriptionCheckPending(false)
  }, [canOpenGame, isGameLaunchPending, isGameSceneReady])

  useEffect(() => {
    if (INTRO_DISABLED || isProjectFinished === true || isProjectFinished === null) {
      return
    }

    void trackGameEvent("intro_screen_viewed", {
      screenId: currentScreen.id,
    })
  }, [currentScreen.id, isProjectFinished])

  const handleStartGame = (skipSubscriptionGate = false) => {
    if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }

    if (!skipSubscriptionGate && !canOpenGame) {
      setIsGameLaunchPending(false)
      setIsGameActive(false)
      setActiveScreen(1)
      return
    }

    void trackGameEvent("intro_start_clicked", {
      screenId: currentScreen.id,
    })
    setIsGameLaunchPending(true)

    if (!isGameSceneReady) {
      return
    }

    startTransition(() => {
      setIsGameActive(true)
    })
  }

  const handlePrimaryAction = () => {
    if (currentScreen.id === "intro") {
      if (isTelegramHost) {
        handleStartGame()
        return
      }

      void handleSubscriptionCheck()
      return
    }

    if (currentScreen.id === "subscription-failed") {
      setActiveScreen(1)
      handleSubscriptionAction()
      return
    }

    if (currentScreen.id === "result") {
      handleStartGame()
    }
  }

  const handleSubscriptionAction = () => {
    openExternalLink(SUBSCRIPTION_CHANNEL_URL)
  }

  const handleSubscriptionReturn = () => {
    openExternalLink(SUBSCRIPTION_RETURN_BOT_URL)
  }

  const handleSubscriptionCheck = async () => {
    if (isTelegramHost) {
      startTransition(() => {
        setActiveScreen(3)
      })
      return
    }

    setIsSubscriptionCheckPending(true)

    try {
      const { isSubscribed, subscriptionStatus } = await pollSubscriptionStatus({
        attempts: 1,
        reason: "manual",
      })

      if (isMaxHost) {
        setMaxLaunchError(getMaxLaunchErrorMessage(subscriptionStatus?.user?.errorCode, miniAppPlatform))
        setIsUserSubscribed(subscriptionStatus?.user?.subscribedToChannel === true)

        if (subscriptionStatus?.user?.subscribedToChannel === true) {
          handleStartGame(true)
          return
        }

        startTransition(() => {
          setActiveScreen(1)
        })
        return
      }

      setIsUserSubscribed(isSubscribed)

      if (isSubscribed) {
        handleStartGame(true)
      } else {
        startTransition(() => {
          setActiveScreen(1)
        })
      }
    } catch (error) {
      logDevWarn("Subscription status refresh failed", error)
    } finally {
      setIsSubscriptionCheckPending(false)
    }
  }

  const handleProjectFinishedAction = () => {
    openExternalLink(SUBSCRIPTION_CHANNEL_URL)
  }

  const handleCloseProjectFinishedPrizes = () => {
    setIsProjectFinishedPrizesOpen(false)
  }

  const handleOpenProjectFinishedOverlay = (overlayId) => {
    if (!overlayId) {
      return
    }

    void trackGameEvent("overlay_opened", {
      overlayId,
      source: "project_finished",
      myPrizesCount: overlayId === "gift" ? visibleProjectFinishedMyPrizes.length : undefined,
    })
    setProjectFinishedOverlay(overlayId)
  }

  const handleCloseProjectFinishedOverlay = () => {
    if (!activeProjectFinishedOverlay) {
      return
    }

    void trackGameEvent("overlay_closed", {
      overlayId: activeProjectFinishedOverlay,
      source: "project_finished",
    })
    setProjectFinishedOverlay(null)
  }

  const handleProjectFinishedSupportClick = () => {
    const supportLink = buildSupportLink(SUPPORT_CONTACT)

    if (!supportLink) {
      return
    }

    void trackGameEvent("external_link_opened", {
      actionId: "support",
      url: supportLink,
      source: "project_finished",
    })
    openExternalLink(supportLink)
  }

  const handleOpenEmbeddedPage = (title, url, source) => {
    const normalizedUrl = String(url || "").trim()
    const normalizedTitle = String(title || "").trim() || IMPORTANT_INFO_TITLE

    if (!normalizedUrl) {
      return
    }

    void trackGameEvent("overlay_opened", {
      overlayId: "embedded_page",
      source,
      url: normalizedUrl,
    })

    const requestId = embeddedPageRequestRef.current + 1

    embeddedPageRequestRef.current = requestId

    setEmbeddedPage({
      title: normalizedTitle,
      url: normalizedUrl,
      srcDoc: "",
      isLoading: true,
      sessionKey: requestId,
    })

    void loadEmbeddedPageModule()
      .then(({ loadEmbeddedPageDocument }) => loadEmbeddedPageDocument(normalizedUrl, normalizedTitle))
      .then((srcDoc) => {
        if (embeddedPageRequestRef.current !== requestId) {
          return
        }

        setEmbeddedPage((currentPage) => {
          if (!currentPage || currentPage.url !== normalizedUrl) {
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
          if (!currentPage || currentPage.url !== normalizedUrl) {
            return currentPage
          }

          return {
            ...currentPage,
            isLoading: false,
          }
        })
      })
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

  const handleProjectFinishedBannerAction = (actionId) => {
    if (actionId === "question") {
      handleOpenProjectFinishedOverlay("question")
      return
    }

    if (actionId === "exclamation") {
      handleOpenEmbeddedPage(IMPORTANT_INFO_TITLE, IMPORTANT_INFO_URL, "project_finished")
      return
    }

    if (actionId === "gift") {
      setIsProjectFinishedPrizesOpen(true)
      return
    }

    void trackGameEvent("external_link_opened", {
      actionId,
      url: SUBSCRIPTION_CHANNEL_URL,
      source: "project_finished",
    })
    openExternalLink(SUBSCRIPTION_CHANNEL_URL)
  }

  const isProjectStateResolved = INTRO_DISABLED || isProjectFinished !== null

  return (
    <main className="app-shell" aria-label="Application shell">
      <div className={`app-layer game-layer ${isGameActive ? "is-visible" : "is-hidden"}`} aria-hidden={!isGameActive}>
        <PersistentGameScreen
          bootstrapSeed={prefetchedGameBootstrap}
          bootstrapAssetVersion={prefetchedGameAssetVersion}
          deferBootstrap={deferredGameBootstrap}
          allowBootstrapFetch={isGameActive}
          isVisible={isGameActive}
        />
      </div>
      <div className={`app-layer intro-layer ${isGameActive ? "is-hidden" : "is-visible"}`} aria-hidden={isGameActive}>
        {!isProjectStateResolved || (!isProjectFinished && !isInitialIntroMounted) ? (
          <div className="project-finished-loading" aria-hidden="true" />
        ) : isProjectFinished ? (
          <section className="project-finished-screen" aria-label="Проект завершен">
            <div className="project-finished-stage">
              <div className="game-carousel-scene project-finished-scene" aria-hidden="true">
                <div className="game-carousel-backdrop">
                  <div className="game-carousel-pattern-underlay" />
                  <div className="game-carousel-pattern project-finished-pattern" />
                </div>
              </div>
              <section className="game-top-banner project-finished-banner" aria-hidden="true">
                <div className="game-top-banner-section game-top-banner-section--primary">
                  <div className="game-top-banner-actions">
                    <button
                      type="button"
                      className="game-top-banner-action"
                      aria-label="Вопрос"
                      onClick={() => handleProjectFinishedBannerAction("question")}
                    >
                      <img src="/game/icons/question.svg" alt="" className="game-top-banner-action-icon" />
                    </button>
                    <button
                      type="button"
                      className="game-top-banner-action"
                      aria-label="Важно"
                      onClick={() => handleProjectFinishedBannerAction("exclamation")}
                    >
                      <img src="/game/icons/exclamation.svg" alt="" className="game-top-banner-action-icon" />
                    </button>
                    <button
                      type="button"
                      className="game-top-banner-action"
                      aria-label="Подарки"
                      onClick={() => handleProjectFinishedBannerAction("gift")}
                    >
                      <img src="/game/icons/gift.svg" alt="" className="game-top-banner-action-icon" />
                    </button>
                  </div>
                </div>
                <div className="game-top-banner-section game-top-banner-section--secondary">
                  <img src="/game/icons/logo.webp" alt="" className="game-top-banner-logo" />
                </div>
              </section>
              <img
                src="/intro/hands.webp"
                alt=""
                className="project-finished-hands"
                aria-hidden="true"
              />
              <section className="project-finished-sheet">
                <div className="project-finished-sheet-inner">
                  <h1 className="project-finished-title">Выдача багажа завершена</h1>
                  <p className="project-finished-description">
                    <span className="content-line">Благодарим, что были с нами.</span>
                    <span className="content-line">До встречи на новых рейсах!</span>
                  </p>
                  <button
                    type="button"
                    className="content-action project-finished-action"
                    onClick={handleProjectFinishedAction}
                  >
                    Вернуться в канал
                  </button>
                </div>
              </section>
            </div>
            {isProjectFinishedPrizesDialogOpen ? (
              <div
                className="game-prizes-page is-opening"
                role="dialog"
                aria-modal="true"
                aria-labelledby="project-finished-prizes-title"
              >
                <section className="game-prizes-page-inner">
                  <h2 id="project-finished-prizes-title" className="game-prizes-title">
                    Мои призы
                  </h2>
                  <div className="game-prizes-list" aria-label="Список призов">
                    {visibleProjectFinishedMyPrizes.length ? visibleProjectFinishedMyPrizes.map((prize) => (
                      <div
                        key={prize.id}
                        className="game-prize-card"
                      >
                        <div className="game-prize-card-media">
                          <img
                            src={resolveCachedImageSource(prize.image, projectFinishedPrizeImageSources)}
                            alt=""
                            className="game-prize-card-image"
                          />
                        </div>
                        <div className="game-prize-card-content">
                          <h3 className="game-prize-card-title">{prize.myPrizeText || prize.title}</h3>
                          <p className="game-prize-card-date">{prize.expiresAt}</p>
                        </div>
                      </div>
                    )) : (
                      <p className="game-overlay-description">Пока призов нет. Спасибо, что были с нами.</p>
                    )}
                  </div>
                  <div className="game-prizes-footer">
                    <button
                      type="button"
                      className="game-prizes-close"
                      onClick={handleCloseProjectFinishedPrizes}
                    >
                      Закрыть
                    </button>
                  </div>
                </section>
              </div>
            ) : null}
            {activeProjectFinishedOverlay === "question" ? (
              <div
                className="game-overlay is-opening"
                role="dialog"
                aria-modal="true"
                aria-labelledby="project-finished-question-title"
              >
                <div className="game-overlay-backdrop" />
                <section className="game-overlay-sheet">
                  <div className="game-overlay-sheet-inner">
                    <h2 id="project-finished-question-title" className="game-overlay-title">
                      Возникли вопросы?
                    </h2>
                    <p className="game-overlay-description">
                      Обратитесь в наш чат поддержки в МАКС
                    </p>
                    <div className="game-overlay-actions">
                      <button
                        type="button"
                        className="game-overlay-action game-overlay-action--primary"
                        onClick={handleProjectFinishedSupportClick}
                      >
                        Написать в поддержку
                      </button>
                      <button
                        type="button"
                        className="game-overlay-action game-overlay-action--secondary"
                        onClick={handleCloseProjectFinishedOverlay}
                      >
                        Назад
                      </button>
                    </div>
                  </div>
                </section>
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
          </section>
        ) : (
        <div className="split-screen" aria-label="Three-row expanded layout">
          <div className="background-vectors" aria-hidden="true">
        <svg
          className="background-vector background-vector-left"
          width="847"
          height="1326"
          viewBox="0 0 847 1326"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            className="background-vector-path background-vector-path-left"
            pathLength="1"
            d="M563.067 375.513L556.477 387.59L563.067 375.513ZM825.001 693.965L811.273 694.883L811.347 695.984L811.594 697.058L825.001 693.965ZM553.967 1296.15L543.648 1305.25L561.849 1325.88L572.167 1316.78L563.067 1306.47L553.967 1296.15ZM194.833 224.779L181.076 224.572V224.572L194.833 224.779ZM411.255 143.89L412.062 130.155L411.917 130.147L411.771 130.141L411.255 143.89ZM753.508 94.0097L739.973 96.479V96.479L753.508 94.0097ZM-68.9234 167.315C-70.5861 174.73 -65.9236 182.088 -58.5092 183.751C-51.0949 185.414 -43.7364 180.751 -42.0737 173.337L-55.4985 170.326L-68.9234 167.315ZM107.999 412.306L121.584 414.484V414.484L107.999 412.306ZM351.001 326.965L350.477 313.217L351.001 326.965ZM650.5 412.306L661.508 420.56V420.56L650.5 412.306ZM534.501 165.465L530.015 178.471L534.501 165.465ZM563.067 375.513L556.477 387.59C675.349 452.459 799.334 516.297 811.273 694.883L825.001 693.965L838.728 693.048C825.665 497.634 686.834 427.379 569.658 363.436L563.067 375.513ZM825.001 693.965L811.594 697.058C834.853 797.873 818.179 1063.14 553.967 1296.15L563.067 1306.47L572.167 1316.78C844.064 1077 863.904 801.391 838.407 690.873L825.001 693.965ZM194.833 224.779L208.59 224.986C208.694 218.039 212.447 210.01 222.319 201.323C232.185 192.641 247.03 184.392 266.106 177.408C304.173 163.47 356.267 155.593 410.738 157.639L411.255 143.89L411.771 130.141C354.395 127.986 298.644 136.192 256.646 151.569C235.689 159.241 217.446 168.958 204.14 180.666C190.84 192.37 181.338 207.158 181.076 224.572L194.833 224.779ZM753.508 94.0097L739.973 96.479C742.652 111.168 738.361 125.651 726.777 140.4C714.987 155.411 696.083 170.02 671.34 183.645C621.925 210.856 552.61 232.311 481.666 245.661C410.767 259.003 339.563 264.004 286.702 259.075C260.115 256.595 239.325 251.7 225.666 244.892C212.053 238.106 208.496 231.189 208.59 224.986L194.833 224.779L181.076 224.572C180.755 245.93 195.234 260.468 213.391 269.519C231.501 278.546 256.215 283.867 284.147 286.472C340.325 291.711 414.224 286.352 486.755 272.703C559.242 259.063 631.683 236.895 684.613 207.749C711.042 193.196 733.458 176.443 748.418 157.396C763.583 138.087 771.471 115.816 767.042 91.5405L753.508 94.0097ZM-55.4985 170.326L-42.0737 173.337C-39.4761 161.754 -28.3065 147.945 -5.62175 133.126C16.5301 118.655 47.2596 104.79 84.2352 92.1254C158.083 66.8323 254.55 47.1 351.292 36.397C448.094 25.6873 544.209 24.1257 617.432 34.6754C654.126 39.962 684.171 48.1691 705.523 59.1893C726.955 70.2504 737.504 82.9479 739.973 96.479L753.508 94.0097L767.042 91.5405C762.403 66.1077 743.292 47.7172 718.143 34.7373C692.914 21.7164 659.457 12.9294 621.356 7.43997C544.99 -3.56249 446.349 -1.8041 348.266 9.04723C250.123 19.9052 151.577 39.9749 75.3191 66.0934C37.2421 79.1349 4.14611 93.8777 -20.6705 110.089C-44.9541 125.952 -63.8961 144.898 -68.9234 167.315L-55.4985 170.326ZM107.999 412.306L121.584 414.484C125.768 388.377 151.452 370.069 196.966 358.135C241.263 346.521 297.808 342.764 351.526 340.714L351.001 326.965L350.477 313.217C296.871 315.263 237.545 319.049 189.987 331.518C143.645 343.669 101.49 365.983 94.4141 410.129L107.999 412.306ZM650.5 412.306L639.493 404.052C615.351 436.246 569.686 462.876 512.856 481.728C456.439 500.443 390.932 510.854 329.414 511.984C267.645 513.119 211.309 504.873 172.588 487.432C153.29 478.74 139.263 468.168 130.767 456.227C122.523 444.641 118.931 431.036 121.584 414.484L107.999 412.306L94.4141 410.129C90.6369 433.694 95.8476 454.615 108.347 472.181C120.594 489.391 139.251 502.595 161.287 512.521C205.232 532.315 266.16 540.668 329.919 539.496C393.929 538.32 462.214 527.519 521.519 507.846C580.411 488.31 632.4 459.376 661.508 420.56L650.5 412.306ZM534.501 165.465L530.015 178.471C578.235 195.107 631.484 218.6 659.649 254.094C673.289 271.283 680.859 291.071 679.251 314.704C677.617 338.707 666.409 368.16 639.493 404.052L650.5 412.306L661.508 420.56C690.378 382.062 704.591 347.613 706.704 316.572C708.841 285.162 698.481 258.763 681.204 236.989C647.533 194.558 586.996 169.021 538.988 152.459L534.501 165.465ZM351.001 326.965L351.526 340.714C421.929 338.027 508.982 361.673 556.477 387.59L563.067 375.513L569.658 363.436C518.02 335.258 426.074 310.332 350.477 313.217L351.001 326.965ZM534.501 165.465L538.988 152.459C521.838 146.543 473.558 133.771 412.062 130.155L411.255 143.89L410.447 157.624C469.357 161.088 515.165 173.348 530.015 178.471L534.501 165.465Z"
          />
        </svg>
        <svg
          className="background-vector background-vector-right"
          width="179"
          height="685"
          viewBox="0 0 179 685"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            className="background-vector-path background-vector-path-right"
            pathLength="1"
            d="M276.251 415.02L274.483 401.375L276.251 415.02ZM257.2 684.29C264.776 684.872 271.39 679.203 271.973 671.627C272.555 664.051 266.885 657.437 259.309 656.854L258.255 670.572L257.2 684.29ZM276.251 415.02L274.483 401.375C268.772 402.115 265.28 402.211 263.185 402.001C261.153 401.798 261.931 401.452 263.162 402.615C264.439 403.822 264.254 404.799 264.025 403.23C263.777 401.52 263.741 398.682 264.082 393.85C265.427 374.816 271.587 338.34 265.479 281.115L251.798 282.576L238.117 284.036C243.889 338.105 238.113 370.981 236.634 391.911C236.269 397.07 236.097 402.386 236.795 407.19C237.514 412.134 239.36 417.984 244.267 422.619C249.127 427.21 255.133 428.849 260.442 429.381C265.687 429.906 271.649 429.489 278.019 428.664L276.251 415.02ZM66.7267 -119.132L71.1112 -106.091C85.2638 -110.849 100.213 -108.678 116.47 -99.3294C133.017 -89.8136 150.186 -73.1998 167.218 -50.6659C201.232 -5.66318 232.405 59.8595 255.79 128.156C279.16 196.409 294.319 266.161 297.019 319.182C298.378 345.85 296.514 367.127 291.735 381.621C286.971 396.066 280.636 400.578 274.483 401.375L276.251 415.02L278.019 428.664C299.203 425.919 311.514 409.505 317.867 390.239C324.205 371.021 325.928 345.8 324.5 317.783C321.63 261.434 305.73 189.067 281.822 119.242C257.929 49.4607 225.604 -19.0538 189.169 -67.2578C170.977 -91.3272 151.183 -111.109 130.188 -123.183C108.903 -135.423 85.7316 -140.036 62.3423 -132.173L66.7267 -119.132ZM258.255 670.572L259.309 656.854C247.474 655.944 232.206 646.87 214.287 626.545C196.79 606.697 178.662 578.273 160.826 543.495C125.206 474.037 91.8453 381.396 67.3815 287.189C42.9024 192.922 27.5754 98.0248 27.5169 24.0457C27.4875 -13.0268 31.3018 -43.9383 39.1464 -66.65C47.0203 -89.4462 58.0739 -101.707 71.1112 -106.091L66.7267 -119.132L62.3423 -132.173C37.8376 -123.934 22.3773 -102.384 13.1376 -75.6335C3.86867 -48.7984 -0.030203 -14.4266 0.000239055 24.0675C0.061261 101.222 15.9453 198.591 40.7482 294.105C65.5663 389.677 99.5588 484.327 136.342 556.052C154.708 591.865 174.044 622.505 193.646 644.741C212.827 666.499 234.294 682.529 257.2 684.29L258.255 670.572Z"
          />
        </svg>
        <svg
          className="background-vector background-vector-center"
          width="1080"
          height="461"
          viewBox="0 0 1080 461"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            className="background-vector-path background-vector-path-center"
            pathLength="1"
            d="M554.41 241.515L542.268 247.986V247.986L554.41 241.515ZM689.435 16.2185L690.48 2.49988L689.435 16.2185ZM1101.64 13.8225C1102.96 6.34007 1110.1 1.34712 1117.58 2.67037C1125.07 3.99364 1130.06 11.132 1128.74 18.6144L1115.19 16.2185L1101.64 13.8225ZM554.41 241.515L542.268 247.986C539.405 242.614 537.321 239.497 535.804 237.761C534.329 236.074 534.373 236.823 535.902 237.126C537.493 237.441 538.043 236.755 536.474 237.56C534.779 238.43 532.268 240.177 528.321 243.428C512.758 256.249 485.271 283.766 432.469 313.451L425.727 301.458L418.985 289.465C469.019 261.335 493.796 236.219 510.826 222.19C515.027 218.729 519.435 215.376 523.912 213.078C528.515 210.716 534.491 208.796 541.245 210.133C547.936 211.457 552.879 215.484 556.521 219.651C560.122 223.771 563.376 229.085 566.551 235.044L554.41 241.515ZM-32.3509 388.024L-19.1836 384.035C-14.5442 399.349 -3.36166 411.003 14.7448 419.316C33.155 427.768 58.0257 432.367 87.838 433.224C147.381 434.935 222.784 421.639 295.767 399.97C368.707 378.315 437.94 348.68 485.2 318.547C508.962 303.396 526.184 288.734 535.79 275.664C545.365 262.634 545.536 254.118 542.268 247.986L554.41 241.515L566.551 235.044C576.948 254.552 570.545 274.838 557.963 291.958C545.412 309.037 524.895 325.872 499.993 341.749C449.925 373.673 378.13 404.221 303.599 426.349C229.111 448.465 150.602 462.555 87.0477 460.729C55.3114 459.817 26.3373 454.916 3.26389 444.323C-20.1133 433.591 -38.0533 416.653 -45.5182 392.013L-32.3509 388.024ZM689.435 16.2185L688.391 29.9371C497.987 15.4412 308.098 67.6892 172.038 143.181C103.985 180.939 50.1356 224.105 16.4247 266.883C-17.4873 309.917 -29.4083 350.286 -19.1836 384.035L-32.3509 388.024L-45.5182 392.013C-59.502 345.856 -41.645 296.115 -5.18763 249.852C31.471 203.333 88.5824 158.016 158.687 119.12C298.942 41.301 494.155 -12.4468 690.48 2.49988L689.435 16.2185ZM689.435 16.2185L690.48 2.49988C721.312 4.84724 762.228 16.1602 805.082 28.616C848.602 41.2654 894.932 55.3597 938.48 64.3851C982.351 73.4773 1021.2 76.9075 1050.13 69.7156C1064.3 66.1911 1075.53 60.2464 1083.92 51.6325C1092.25 43.0683 1098.6 31.0123 1101.64 13.8225L1115.19 16.2185L1128.74 18.6144C1124.9 40.2995 1116.43 57.677 1103.64 70.823C1090.89 83.9193 1074.69 91.9615 1056.77 96.419C1021.49 105.191 977.463 100.566 932.896 91.3291C888.006 82.0257 840.336 67.5182 797.402 55.0392C753.802 42.3665 715.81 32.0246 688.391 29.9371L689.435 16.2185Z"
          />
        </svg>
          </div>
          <section className="logo-panel" aria-label="Logo area">
        <img
          src="/intro/logo.webp"
          alt="Logo"
          className="logo-image"
        />
          </section>
          <section className="spacer-panel" aria-hidden="true" />
          <div
            className={`content-bag-layer ${activeScreen === 0 ? "is-visible" : activeScreen === 3 ? "is-visible is-static" : "is-hidden"}`}
            aria-hidden="true"
          >
        <img
          src="/intro/bags/pink-bag.webp"
          alt=""
          className="content-bag-accent content-bag-accent-left"
        />
        <img
          src="/intro/bags/green-bag.webp"
          alt=""
          className="content-bag-accent content-bag-accent-right"
        />
        <img
          src="/intro/bags/colorful-bag.webp"
          alt=""
          className="content-bag"
        />
          </div>
          <div
            className={`content-subscribe-layer ${activeScreen === 1 || activeScreen === 2 ? "is-visible" : "is-hidden"}`}
            aria-hidden="true"
          >
        <img
          src="/intro/subscribe-2.webp"
          alt=""
          className="content-subscribe-image"
        />
          </div>
          <section
            className={`content-panel ${currentScreen.compact ? "is-compact" : ""}`}
            data-screen={currentScreen.id}
            aria-label="Content area"
          >
            <div className={`content-panel-inner ${currentScreen.compact ? "is-compact" : ""}`}>
              <div className={`content-screen-stack ${currentScreen.compact ? "is-compact" : ""}`}>
            {screens.map((screen, index) => {
              const isActive = index === activeScreen
              const positionClass = isActive
                ? "is-active"
                : index < activeScreen
                  ? "is-before"
                  : "is-after"

              return (
                <section
                  key={screen.id}
                  className={`content-screen ${screen.variant ? `content-screen--${screen.variant}` : ""} ${positionClass}`}
                  data-screen={screen.id}
                  aria-hidden={!isActive}
                >
                  {screen.variant === "subscription" ? (
                    <>
                      <h1 className="content-title content-title--subscription">
                        <span className="content-line">Для старта подпишитесь</span>
                        <span className="content-line">
                          на каналы <span className="subscription-brand subscription-brand--travel">Ozon Travel</span>
                        </span>
                        <span className="content-line">
                          и <span className="subscription-brand subscription-brand--bank">Ozon Банк</span>
                        </span>
                      </h1>
                      <p className="content-description content-description--subscription">
                        и получите <strong>+3 попытки</strong> крутить Ленту призов
                      </p>
                      <button
                        type="button"
                        className="content-action"
                        onClick={handleSubscriptionReturn}
                      >
                        Вернуться
                      </button>
                    </>
                  ) : screen.variant === "subscription-failed" ? (
                    <>
                      <div className="content-copy">
                        <h1 className="content-title">
                          {screen.titleLines.map((line) => (
                            <span key={line} className="content-line">{line}</span>
                          ))}
                        </h1>
                        <p className="content-description">
                          {screen.description.map((line) => (
                            <span key={line} className="content-line">{line}</span>
                          ))}
                        </p>
                      </div>

                      <button
                        type="button"
                        className="content-action"
                        onClick={handlePrimaryAction}
                      >
                        {screen.actionLabel}
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="content-copy">
                        {screen.kicker?.length ? (
                          <p className="content-kicker">
                            {screen.kicker.map((line) => (
                              <span key={line} className="content-line">{line}</span>
                            ))}
                          </p>
                        ) : null}
                        <h1 className={`content-title ${screen.variant === "result" ? "content-title--result" : ""}`}>
                          {screen.titleLines.map((line) => (
                            <span key={line} className="content-line">{line}</span>
                          ))}
                          {screen.accentLine ? (
                            <span className="content-line">
                              {screen.accentLine.before}
                              <span className="content-accent" aria-label={screen.accentLine.accessibleText}>
                                <span>{screen.accentLine.amount}</span>
                                <img
                                  src={screen.accentLine.iconSrc}
                                  alt=""
                                  aria-hidden="true"
                                  className="content-accent-icon"
                                />
                              </span>
                              {screen.accentLine.after}
                            </span>
                          ) : null}
                        </h1>
                        <p className={`content-description ${screen.variant === "result" ? "content-description--result" : ""}`}>
                          {screen.description.map((line) => (
                            <span key={line} className="content-line">{line}</span>
                          ))}
                        </p>
                      </div>

                      <button
                        type="button"
                        className="content-action"
                        onClick={handlePrimaryAction}
                        disabled={screen.id === "intro" && (isSubscriptionCheckPending || isGameLaunchPending)}
                      >
                        {screen.id === "intro" && (isSubscriptionCheckPending || isGameLaunchPending)
                          ? "Проверяем..."
                          : screen.actionLabel}
                      </button>
                    </>
                  )}
                </section>
              )
            })}
              </div>
            </div>
          </section>
        </div>
        )}
      </div>
    </main>
  )
}

export default App
