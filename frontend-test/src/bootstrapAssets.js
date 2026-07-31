function appendImageEntry(chunks, item, fallbackKey) {
  if (!item || typeof item !== "object") {
    return
  }

  const id = String(item.id ?? item.positionId ?? fallbackKey ?? "")
  const image = String(item.image || "").trim()

  chunks.push(`${id}:${image}`)
}

export function buildBootstrapAssetVersion(payload) {
  const rouletteItems = Array.isArray(payload?.rouletteItems) ? payload.rouletteItems : []
  const myPrizes = Array.isArray(payload?.myPrizes) ? payload.myPrizes : []
  const chunks = []

  rouletteItems.forEach((item, index) => appendImageEntry(chunks, item, `roulette-${index}`))
  myPrizes.forEach((item, index) => appendImageEntry(chunks, item, `my-prize-${index}`))

  const source = chunks.sort().join("|")

  if (!source) {
    return "bootstrap-empty"
  }

  let hash = 0

  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash * 31) + source.charCodeAt(index)) >>> 0
  }

  return `bootstrap-${hash}`
}
