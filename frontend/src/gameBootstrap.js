import { getJson } from "./api.js"
import { buildBootstrapAssetVersion } from "./bootstrapAssets.js"

let pendingBootstrapRequest = null

export function enrichGameBootstrap(response) {
  const assetVersion = buildBootstrapAssetVersion(response)

  return {
    ...response,
    assetVersion,
  }
}

export function getBootstrapAssetVersion(value) {
  return String(value || "").trim()
}

export async function fetchGameBootstrap() {
  if (!pendingBootstrapRequest) {
    pendingBootstrapRequest = getJson("/game/bootstrap")
      .then((response) => enrichGameBootstrap(response))
      .finally(() => {
        pendingBootstrapRequest = null
      })
  }

  return pendingBootstrapRequest
}
