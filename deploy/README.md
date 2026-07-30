# Deploy

## Manual

1. Copy `.env.example` to `.env` on the server.
2. Update `ACME_EMAIL` if needed.
3. Run `bash deploy/deploy.sh`.

## GitHub Actions

The workflow in `.github/workflows/deploy.yml` deploys on every push to `main` and can also be started manually.

Required repository secrets:

- `DEPLOY_HOST` - server IP or hostname
- `DEPLOY_USER` - SSH user, for example `root`
- `DEPLOY_PORT` - SSH port, usually `22`
- `DEPLOY_SSH_KEY` - private SSH key that GitHub Actions uses to log in to the server

The workflow syncs the repository to `/opt/ozon-travel` with `rsync` and then runs `bash deploy/deploy.sh` on the server.
The server must already have a production `.env` file at `/opt/ozon-travel/.env` because the workflow does not upload env files.
The deploy script first builds the requested application images and only then runs `docker compose up -d --no-build`, so an unsuccessful build does not stop the current production containers.

The GitHub Actions workflow is currently configured to deploy only `max-bot-test`.
Its token is stored in the `MAX_BOT_TEST_TOKEN` repository secret and uploaded to
`/opt/ozon-travel/.env.max-bot-test` during deployment.
By default the deploy script itself can deploy the full stack: `backend frontend admin max-bot worker`.

To deploy only specific services, pass `DEPLOY_SERVICES` before running the script. Example:

```bash
DEPLOY_SERVICES=admin bash deploy/deploy.sh
```

Before requesting a Let's Encrypt certificate, point the `A` record for `ozon-travel-max.ru` and `www.ozon-travel-max.ru` to the target VPS.
