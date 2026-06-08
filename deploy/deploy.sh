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

deploy_once() {
  docker compose rm -sf "${APP_SERVICES[@]}" || true
  docker compose up -d --build --remove-orphans "${APP_SERVICES[@]}"
}

if ! deploy_once; then
  echo "Initial deploy failed. Retrying once after Docker cache cleanup..."
  cleanup_build_cache
  deploy_once
fi
