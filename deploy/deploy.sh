#!/usr/bin/env bash
set -euo pipefail

cd /opt/ozon-travel

if [ ! -f .env ]; then
  echo "Missing /opt/ozon-travel/.env. Upload the production env file before running deploy." >&2
  exit 1
fi

docker compose up -d --build --remove-orphans
