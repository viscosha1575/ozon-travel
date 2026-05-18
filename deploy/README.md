# Deploy

## Manual

1. Copy `.env.example` to `.env` on the server.
2. Update `ACME_EMAIL` if needed.
3. Run `docker compose up -d --build`.

## GitHub Actions

The workflow in `.github/workflows/deploy.yml` deploys on every push to `main` and can also be started manually.

Required repository secrets:

- `DEPLOY_HOST` - server IP or hostname
- `DEPLOY_USER` - SSH user, for example `root`
- `DEPLOY_PORT` - SSH port, usually `22`
- `DEPLOY_SSH_KEY` - private SSH key that GitHub Actions uses to log in to the server

The workflow syncs the repository to `/opt/ozon-travel` and then runs `bash deploy/deploy.sh` on the server.

Before requesting a Let's Encrypt certificate, point the `A` record for `ozon-travel-max.ru` and `www.ozon-travel-max.ru` to the target VPS.
