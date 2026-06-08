#!/usr/bin/env bash
set -euo pipefail

cd /opt/ozon-travel

if [ ! -f .env ]; then
  echo "Missing /opt/ozon-travel/.env. Upload the production env file before running deploy." >&2
  exit 1
fi

DEFAULT_APP_SERVICES=(
  backend
  frontend
  admin
  max-bot
  worker
)

IFS=', ' read -r -a REQUESTED_SERVICES <<< "${DEPLOY_SERVICES:-}"

if [ "${#REQUESTED_SERVICES[@]}" -eq 0 ] || [ -z "${REQUESTED_SERVICES[0]:-}" ]; then
  APP_SERVICES=("${DEFAULT_APP_SERVICES[@]}")
else
  APP_SERVICES=()

  for service in "${REQUESTED_SERVICES[@]}"; do
    if [ -n "$service" ]; then
      APP_SERVICES+=("$service")
    fi
  done
fi

cleanup_build_cache() {
  echo "Cleaning Docker build cache before retry..."
  docker builder prune -af || true
  docker buildx prune -af || true
  docker image prune -af || true
}

build_once() {
  docker compose build "${APP_SERVICES[@]}"
}

switch_once() {
  if [ "${#APP_SERVICES[@]}" -eq 1 ]; then
    docker compose up -d --no-build --no-deps "${APP_SERVICES[@]}"
    return
  fi

  docker compose up -d --no-build --remove-orphans "${APP_SERVICES[@]}"
}

if ! build_once; then
  echo "Initial build failed. Retrying once after Docker cache cleanup..."
  cleanup_build_cache
  build_once
fi

switch_once
