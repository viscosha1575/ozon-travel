import { useEffect, useState } from "react"

const IMAGE_CACHE_PREFIX = "ozon-travel-image-cache"
const IMAGE_CACHE_VERSION = "v2"
const IMAGE_CACHE_NAME = `${IMAGE_CACHE_PREFIX}-${IMAGE_CACHE_VERSION}`
const inMemoryImageSources = new Map()
const pendingImageSources = new Map()
let cacheMaintenancePromise = null

function normalizeImageUrl(value) {
  return String(value || "").trim()
}

function canUsePersistentImageCache() {
  return typeof window !== "undefined"
    && typeof window.fetch === "function"
    && typeof window.caches?.open === "function"
    && typeof window.URL?.createObjectURL === "function"
}

function buildImageSourceState(urls = []) {
  const nextState = {}

  urls.forEach((value) => {
    const url = normalizeImageUrl(value)

    if (!url) {
      return
    }

    nextState[url] = inMemoryImageSources.get(url) || url
  })

  return nextState
}

async function pruneCurrentImageCache(cache, retainedUrls = []) {
  const retainedUrlSet = new Set(
    (Array.isArray(retainedUrls) ? retainedUrls : [])
      .map((value) => normalizeImageUrl(value))
      .filter(Boolean),
  )
  const requests = await cache.keys()

  await Promise.all(
    requests.map(async (request) => {
      const requestUrl = normalizeImageUrl(request?.url || request)

      if (!requestUrl || retainedUrlSet.has(requestUrl)) {
        return
      }

      await cache.delete(request)
      inMemoryImageSources.delete(requestUrl)
      pendingImageSources.delete(requestUrl)
    }),
  )
}

async function cleanupLegacyImageCaches() {
  const cacheNames = await window.caches.keys()
  const legacyCacheNames = cacheNames.filter((cacheName) =>
    cacheName.startsWith(`${IMAGE_CACHE_PREFIX}-`) && cacheName !== IMAGE_CACHE_NAME
  )

  await Promise.all(legacyCacheNames.map((cacheName) => window.caches.delete(cacheName)))
}

async function prepareImageCache(retainedUrls = [], { prune = false } = {}) {
  if (!canUsePersistentImageCache()) {
    return null
  }

  if (!cacheMaintenancePromise) {
    cacheMaintenancePromise = cleanupLegacyImageCaches()
      .catch(() => {})
      .finally(() => {
        cacheMaintenancePromise = null
      })
  }

  await cacheMaintenancePromise

  const cache = await window.caches.open(IMAGE_CACHE_NAME)

  if (prune) {
    await pruneCurrentImageCache(cache, retainedUrls)
  }

  return cache
}

async function fetchImageResponse(cache, url) {
  const cachedResponse = await cache.match(url)

  if (cachedResponse) {
    return cachedResponse
  }

  const response = await fetch(url, {
    method: "GET",
    credentials: "same-origin",
  })

  if (!response.ok || response.type === "opaque") {
    throw new Error(`Image cache fetch failed for ${url}`)
  }

  await cache.put(url, response.clone())
  return response
}

async function createCachedObjectUrl(url) {
  if (!canUsePersistentImageCache()) {
    return url
  }

  if (inMemoryImageSources.has(url)) {
    return inMemoryImageSources.get(url) || url
  }

  const cache = await prepareImageCache()
  const response = await fetchImageResponse(cache, url)
  const blob = await response.blob()
  const objectUrl = window.URL.createObjectURL(blob)

  inMemoryImageSources.set(url, objectUrl)
  return objectUrl
}

export async function ensureCachedImageSource(value) {
  const url = normalizeImageUrl(value)

  if (!url) {
    return ""
  }

  if (!canUsePersistentImageCache()) {
    return url
  }

  if (inMemoryImageSources.has(url)) {
    return inMemoryImageSources.get(url) || url
  }

  if (pendingImageSources.has(url)) {
    return pendingImageSources.get(url) || url
  }

  const request = createCachedObjectUrl(url)
    .catch(() => url)
    .finally(() => {
      pendingImageSources.delete(url)
    })

  pendingImageSources.set(url, request)

  return request
}

export async function warmImageCache(urls = []) {
  const uniqueUrls = Array.from(
    new Set(
      (Array.isArray(urls) ? urls : [])
        .map((value) => normalizeImageUrl(value))
        .filter(Boolean),
    ),
  )

  await prepareImageCache(uniqueUrls, { prune: true })

  return Promise.all(uniqueUrls.map((url) => ensureCachedImageSource(url)))
}

export function resolveCachedImageSource(value, imageSourceState = null) {
  const url = normalizeImageUrl(value)

  if (!url) {
    return ""
  }

  if (imageSourceState && imageSourceState[url]) {
    return imageSourceState[url]
  }

  return inMemoryImageSources.get(url) || url
}

export function useCachedImageSources(urls = [], options = {}) {
  const normalizedUrls = Array.from(
    new Set(
      (Array.isArray(urls) ? urls : [])
        .map((value) => normalizeImageUrl(value))
        .filter(Boolean),
    ),
  )
  const [resolvedImageSources, setResolvedImageSources] = useState({})
  const serializedUrls = JSON.stringify(normalizedUrls)
  const shouldPrune = options?.prune === true

  useEffect(() => {
    let isCancelled = false
    const effectUrls = JSON.parse(serializedUrls)

    if (!effectUrls.length) {
      return () => {
        isCancelled = true
      }
    }

    void prepareImageCache(effectUrls, { prune: shouldPrune })
      .catch(() => null)
      .then(() => Promise.all(
        effectUrls.map(async (url) => [url, await ensureCachedImageSource(url)]),
      ))
      .then((entries) => {
        if (isCancelled) {
          return
        }

        setResolvedImageSources((currentState) => ({
          ...currentState,
          ...Object.fromEntries(entries),
        }))
      })
      .catch(() => {
        if (isCancelled) {
          return
        }

        setResolvedImageSources((currentState) => ({
          ...currentState,
        }))
      })

    return () => {
      isCancelled = true
    }
  }, [serializedUrls, shouldPrune])

  return {
    ...buildImageSourceState(normalizedUrls),
    ...resolvedImageSources,
  }
}
