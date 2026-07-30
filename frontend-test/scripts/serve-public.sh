#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-4173}"

cd "$ROOT_DIR"

cleanup() {
  if [[ -n "${PREVIEW_PID:-}" ]] && kill -0 "$PREVIEW_PID" 2>/dev/null; then
    kill "$PREVIEW_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

echo "Building production bundle..."
npm run build

echo "Starting local preview on http://localhost:${PORT} ..."
npm run preview -- --host 0.0.0.0 --port "${PORT}" &
PREVIEW_PID=$!

sleep 2

echo "Opening public HTTPS tunnel..."
cloudflared tunnel --url "http://127.0.0.1:${PORT}"
