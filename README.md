# Ozon Travel Prize Feed

A gamified promo mini app for the MAX messenger where users subscribe, spin a roulette-style prize feed, collect travel discounts and Ozon rewards, and earn extra attempts through daily activity and referrals.

## Highlights

- MAX bot onboarding and deep-link entry
- subscription-gated access to the mini app
- animated roulette with prize history
- limited promo-code pools and unlimited rewards
- referral bonuses and daily attempt grants
- admin panel for prizes, analytics, logs, and user actions
- worker-driven reminders and notification flows

## Demo

- Video walkthrough: [readme/demo.mp4](./readme/demo.mp4)
- Detailed README: [readme/README.detailed.md](./readme/README.detailed.md)
- Portfolio case study: [readme/README.portfolio.md](./readme/README.portfolio.md)

## Screens

| Intro | Roulette |
| --- | --- |
| ![Intro screen](./readme/SCR-20260706-ovxw.png) | ![Prize roulette](./readme/SCR-20260706-ovzo.png) |

| Prize history | Support |
| --- | --- |
| ![My prizes](./readme/SCR-20260706-owbc.png) | ![Support entrypoint](./readme/SCR-20260706-owdc.png) |

## Stack

- Frontend: React 19, Vite, Tailwind CSS 4
- Admin: React, Chakra UI, Vite
- Backend: Node.js, Express, PostgreSQL
- Infra: Redis, BullMQ, Docker Compose, Traefik
- Messaging: MAX Bot API

## Repository

```text
frontend/   player-facing mini app
admin/      campaign operations panel
backend/    API and game logic
max-bot/    MAX onboarding bot
worker/     background jobs and reminders
readme/     screenshots, video, detailed docs
```

## Run Locally

Quick local stack:

```bash
docker compose -f docker-compose.local.yml up --build
```

Main local URLs:

- `http://localhost:4173` - frontend
- `http://localhost:4174` - admin
- `http://localhost:3001` - backend
- `http://localhost:3011` - MAX bot

## What Makes It Interesting

This project blends product UX, reward inventory management, bot integration, operational tooling, and audit-friendly backend logic in one campaign system. It is a strong full-stack example of how a promotional game can be shipped and operated as a real product, not just a landing page.
