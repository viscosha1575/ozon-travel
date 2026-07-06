# Ozon Travel Prize Feed

Ozon Travel Prize Feed is a promotional mini app for the MAX messenger. It combines a subscription-gated onboarding flow, a roulette-style prize experience, referral-based extra attempts, a back office for campaign operations, and a bot/worker stack for messaging and daily attempt distribution.

## Overview

The project is split into five main parts:

- `frontend` - the player-facing mini app built with React and Vite
- `admin` - the campaign management panel for prizes, promo-code pools, analytics, logs, and player actions
- `backend` - the API layer and core game logic
- `max-bot` - the MAX bot used for onboarding, subscription checks, and support entrypoints
- `worker` - background jobs for daily attempts, reminders, and notification delivery

## Demo

- Demo video: [readme/demo.mp4](./demo.mp4)
- Original capture: [readme/Запись экрана — 2026-07-06 в 16.54.41.mov](./%D0%97%D0%B0%D0%BF%D0%B8%D1%81%D1%8C%20%D1%8D%D0%BA%D1%80%D0%B0%D0%BD%D0%B0%C2%A0%E2%80%94%202026-07-06%20%D0%B2%C2%A016.54.41.mov)

## Screenshots

### Intro screen

![Intro screen](./SCR-20260706-ovxw.png)

### Prize roulette

![Prize roulette](./SCR-20260706-ovzo.png)

### My prizes

![My prizes](./SCR-20260706-owbc.png)

### Support entrypoint

![Support entrypoint](./SCR-20260706-owdc.png)

## User Flow

1. A player enters from the MAX bot and opens the mini app.
2. The app checks whether the player is subscribed to the Ozon Travel MAX channel.
3. After access is confirmed, the player sees the intro and the prize feed.
4. The player uses available attempts to spin the roulette.
5. If a winning prize is selected, the backend issues either:
   - a claimed promo code from a managed code pool, or
   - a static prize payload for unlimited prizes
6. The result is written to logs, saved in the player's prize history, and shown in the "My Prizes" screen.
7. The player can earn more attempts from daily activity and referrals.

## Core Features

- MAX messenger onboarding with bot deep links
- Subscription-gated access to the campaign
- Roulette-style animated prize experience
- Daily attempt distribution based on player activity
- Referral links that grant bonus attempts to inviters
- Prize history with expiration dates and promo-code display
- Support shortcut directly from the mini app
- Admin actions for player lookup, logs, deletion, and prize management
- Background reminder and broadcast workflows

## Prize Logic

The campaign supports both limited and unlimited prize mechanics.

- Limited prizes use `prize_promo_codes` and claim one code at spin time
- Unlimited prizes can return a fixed promo code or a non-code reward payload
- Awarded prizes are stored in `awarded_prizes`
- Attempt changes are stored in `user_attempt_transactions`
- Frontend interaction and result visibility are tracked in `game_event_logs`

This design makes it possible to audit every spin, every attempt grant, and every issued reward.

## Admin Capabilities

The admin panel exposes operational tooling for:

- prize creation and editing
- promo-code pool upload, append, scheduling, and availability changes
- prize ordering and enable/disable controls
- project on/off switching
- player analytics and user-level inspection
- push campaign management
- log inspection
- player deletion

## Architecture

### Player-facing stack

- React 19
- Vite
- Tailwind CSS 4

### Services

- Node.js
- Express
- PostgreSQL
- Redis
- BullMQ

### Delivery

- Docker Compose
- Traefik for HTTPS routing in production

## Repository Structure

```text
.
├── admin/
├── backend/
├── docs/
├── frontend/
├── max-bot/
├── readme/
├── worker/
├── docker-compose.yml
└── docker-compose.local.yml
```

## Local Development

### Option 1: quick local stack

This compose file is useful for frontend, backend, admin, and basic bot work.

```bash
docker compose -f docker-compose.local.yml up --build
```

Exposed ports:

- `http://localhost:4173` - frontend mini app
- `http://localhost:4174` - admin panel
- `http://localhost:3001` - backend API
- `http://localhost:3011` - MAX bot
- `postgres://postgres:postgres@localhost:5432/ozon_travel` - PostgreSQL

### Option 2: full production-like stack

This stack includes Traefik, Redis, the worker, and production-style routing.

```bash
docker compose up --build
```

Before running it, configure the required environment variables such as:

- `DOMAIN`
- `ACME_EMAIL`
- `REQUEST_BODY_SECRET`
- `MAX_BOT_TOKEN`
- `MAX_WEBHOOK_SECRET`
- `INTERNAL_API_TOKEN`
- `BROADCAST_INTERNAL_TOKEN`

## Operational Notes

- The backend exposes public game endpoints under `/api/game/*`
- Internal automation endpoints are protected under `/api/internal/*`
- Admin requests are routed through `/api/admin/*`
- Daily attempts and reminders are handled by the worker service
- Player state, rewards, and audit logs are persisted in PostgreSQL

## Why This Project Is Interesting

This project is more than a landing page or a static promo widget. It combines:

- game-like frontend behavior
- deterministic reward issuance
- promo-code inventory management
- messenger bot integration
- analytics and operational tooling
- background notification workflows

That makes it a good example of a full-stack campaign product with both consumer UX and internal tooling.
