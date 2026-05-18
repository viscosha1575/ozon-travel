#!/usr/bin/env bash
set -euo pipefail

cd /opt/ozon-travel

if [ -f .env.example ] && [ ! -f .env ]; then
  cp .env.example .env
fi

docker compose up -d --build --remove-orphans
