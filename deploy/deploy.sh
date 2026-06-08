#!/usr/bin/env bash
set -euo pipefail

cd /opt/ozon-travel

if [ ! -f .env ]; then
  echo "Missing /opt/ozon-travel/.env. Upload the production env file before running deploy." >&2
  exit 1
fi

APP_SERVICES=(
  backend
  frontend
  admin
  max-bot
  worker
)

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
  docker compose up -d --no-build --remove-orphans "${APP_SERVICES[@]}"
}

if ! build_once; then
  echo "Initial build failed. Retrying once after Docker cache cleanup..."
  cleanup_build_cache
  build_once
fi

switch_once
