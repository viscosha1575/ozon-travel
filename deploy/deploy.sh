#!/usr/bin/env bash
set -euo pipefail

cd /opt/ozon-travel

if [ -f .env.example ] && [ ! -f .env ]; then
  cp .env.example .env
fi

git fetch origin
git pull --ff-only origin "$(git rev-parse --abbrev-ref HEAD)"

docker compose up -d --build --remove-orphans
