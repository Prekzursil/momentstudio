# Production deployment guide

This document describes a practical, production-oriented way to deploy the `momentstudio` stack.

At a high level:

- **Backend**: FastAPI container (runs Alembic migrations at startup).
- **Database**: Postgres (managed service or container).
- **Frontend**: static Angular build served by nginx (also reverse-proxies `/api/*` and `/media/*` to the backend).
- **TLS / public ingress**: your reverse proxy (Caddy/nginx/Traefik) in front of the frontend.

Important local-vs-production note:

- The local profile switcher (`scripts/env/switch.sh`, `make env-dev`, `make env-prod`) is for local machines.
- On VPS, keep managing `backend/.env` and `frontend/.env` directly for production deployment.
- Do not copy local development profile files to production hosts.

## 1) Pick a deployment model

### Model A (recommended): Docker Compose + reverse proxy

Use Compose for `frontend` + `backend` + `db` (or external DB), and run a reverse proxy that terminates TLS and forwards
traffic to the `frontend` container.

This repo also includes a ready-to-use VPS production stack under `infra/prod/` (Docker Compose + Caddy + deploy/backup scripts). In that stack, Caddy routes `/api/*` and `/media/*` to the backend and everything else to the frontend.

Why this works well:

- The browser only talks to **one origin** (your domain).
- The frontend container already reverse-proxies `/api/*` and `/media/*` to the backend, so CORS is usually a non-issue.

### Model B: Separate services (Kubernetes / managed)

Still keep the same external contract:

- public origin: `https://<your-domain>`
- backend: reachable by the frontend (internal networking)
- database: reachable by backend

## 2) Required environment variables (production)

Use `backend/.env.example` and `frontend/.env.example` as the authoritative list.

### Backend (minimum)

- `ENVIRONMENT=production`
- `DATABASE_URL=postgresql+asyncpg://...`
- Optional (recommended for multi-replica): `REDIS_URL=redis://...` (shared rate limiting/caches)
- `SECRET_KEY=<long-random-secret>`
- `FRONTEND_ORIGIN=https://<your-domain>`
- `SMTP_ENABLED=1` + `SMTP_*` + `SMTP_FROM_EMAIL=...` (for real emails)
- Optional CAPTCHA (Cloudflare Turnstile):
  - `CAPTCHA_ENABLED=1`
  - `TURNSTILE_SECRET_KEY=...` (from Cloudflare Turnstile)
- Payments:
  - Stripe: `STRIPE_ENV=live` + `STRIPE_SECRET_KEY_LIVE=...` (+ webhook secret if you accept webhooks)
  - Optional PayPal: `PAYPAL_ENV=live` + `PAYPAL_CLIENT_ID_LIVE` / `PAYPAL_CLIENT_SECRET_LIVE` (+ webhook id)
  - Optional Netopia:
    - `NETOPIA_ENABLED=1`
    - `NETOPIA_ENV=live` (or `sandbox`)
    - Live credentials:
      - `NETOPIA_API_KEY_LIVE=...` (from the Netopia admin panel)
      - `NETOPIA_POS_SIGNATURE_LIVE=...`
      - `NETOPIA_PUBLIC_KEY_PEM_LIVE=...` (or `NETOPIA_PUBLIC_KEY_PATH_LIVE=...`; supports `.cer` DER/PEM)
    - Sandbox credentials (optional, for testing): `NETOPIA_*_SANDBOX=...`
    - Legacy single-env vars (`NETOPIA_API_KEY`, `NETOPIA_POS_SIGNATURE`, `NETOPIA_PUBLIC_KEY_*`) are still supported as fallbacks.

Recommended hardening:

- `ADMIN_MFA_REQUIRED=1`
- `ADMIN_IP_ALLOWLIST=[...]` (when you have a stable admin IP range)

Operational visibility:

- `BACKUP_LAST_AT=<ISO8601 timestamp>` is displayed in the Admin dashboard system health panel. Update it after successful backups.

### Frontend (minimum)

- `APP_ENV=production`
- `API_BASE_URL=/api/v1` (when using the frontend nginx reverse proxy)
- Optional CAPTCHA (Cloudflare Turnstile):
  - `CAPTCHA_SITE_KEY=...` (public site key from Cloudflare Turnstile)
- Payments:
  - Stripe: `STRIPE_ENABLED=1`
  - Optional PayPal: `PAYPAL_ENABLED=1`
  - Optional Netopia: `NETOPIA_ENABLED=1`

### Sentry (required in production)

Backend:

- `SENTRY_DSN` must be configured when `ENVIRONMENT=production` (startup fails fast otherwise).
- `SENTRY_SEND_DEFAULT_PII=1` (repository policy).
- Recommended baseline:
  - `SENTRY_TRACES_SAMPLE_RATE=1.0`
  - `SENTRY_PROFILES_SAMPLE_RATE=1.0`
  - `SENTRY_ENABLE_LOGS=1`
  - `SENTRY_LOG_LEVEL=info`

Frontend:

- `SENTRY_ENABLED=1`
- `SENTRY_DSN` (same DSN as backend for shared-project strategy)
- `SENTRY_SEND_DEFAULT_PII=1`
- Recommended baseline:
  - `SENTRY_TRACES_SAMPLE_RATE=1.0`
  - `SENTRY_REPLAY_SESSION_SAMPLE_RATE=0.25`
  - `SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE=1.0`

Release/sourcemap upload from GitHub Actions:

- Workflow: `.github/workflows/sentry-release.yml`
- Required repository settings:
  - secret: `SENTRY_AUTH_TOKEN`
  - variable: `SENTRY_ORG`
  - variable: `SENTRY_PROJECT`
  - optional variable: `SENTRY_URL` (self-hosted only)

Rollback/noise controls (without disabling Sentry entirely):

- backend: set `SENTRY_TRACES_SAMPLE_RATE=0` and `SENTRY_PROFILES_SAMPLE_RATE=0`
- frontend: set `SENTRY_TRACES_SAMPLE_RATE=0` and `SENTRY_REPLAY_SESSION_SAMPLE_RATE=0`
- keep `SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE=1.0` if you still want replay only for error sessions

### Visual/a11y workflow sanity checks

- Run `Percy Visual` and `Applitools Visual` manually after major UI/layout changes.
- Run `Audit Weekly Evidence` before `Audit Weekly Agent` if testing manually.
- If `Audit Weekly Agent` fails, check the `Sync severe issues to roadmap project` step first (token/config or script issues) before triaging findings.

### Cloudflare Turnstile (setup)

1. Cloudflare Dashboard → **Turnstile** → **Add widget**.
2. Hostnames: add `momentstudio.ro` and `www.momentstudio.ro` (add `localhost` only if you want it in local dev).
3. Choose a mode:
   - **Managed** (recommended): mostly invisible; shows a checkbox only when needed.
   - **Non-interactive** / **Invisible**: less friction, but can be more strict; use only if you prefer it.
4. Copy keys:
   - **Site key** → `frontend/.env` as `CAPTCHA_SITE_KEY`.
   - **Secret key** → `backend/.env` as `TURNSTILE_SECRET_KEY`.
5. Enable backend verification by setting `CAPTCHA_ENABLED=1` in `backend/.env`, then redeploy/restart.

## 3) Reverse proxy (TLS termination)

The frontend container should be the primary upstream for your domain.

### Example: nginx (host reverse proxy)

```nginx
server {
  listen 443 ssl;
  server_name example.com;

  # TLS config omitted for brevity

  location / {
    proxy_pass http://127.0.0.1:4201;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Notes:

- If you enable backend admin IP checks, configure `ADMIN_IP_HEADER` and ensure your proxy strips spoofed headers.

## 4) Database migrations

The backend container runs `alembic upgrade head` on startup (see `backend/docker-entrypoint.sh`).

If you need to run migrations manually:

```bash
docker compose -f infra/docker-compose.yml exec -T backend alembic upgrade head
```

## 5) First-owner bootstrap

After the first deploy (or after a DB reset), create the owner account:

```bash
docker compose -f infra/docker-compose.yml exec -T backend python -m app.cli bootstrap-owner \
  --email owner@example.com --password 'Password123' --username owner --display-name Owner
```

## 6) Backups and restores

The repo includes backup helpers in `infra/backup/`.

If you deploy using the VPS stack in `infra/prod/`, you can also use:

- `./infra/prod/backup.sh` and `./infra/prod/restore.sh` (DB + uploads in a single archive)
- `sudo ./infra/prod/install-backup-timer.sh` to run backups automatically every 24h (systemd timer)

### Backups

The simplest “all-in-one” backup is:

- JSON export of app entities (`python -m app.cli export-data`)
- Postgres dump (`pg_dump`)
- `uploads/` media folder

Example (host-based), from repo root:

```bash
DATABASE_URL=postgresql://... ./infra/backup/export_all.sh
```

Recommended practice:

- Store backups off-host (S3/Backblaze/etc).
- Run `infra/backup/check_backup.sh` periodically to verify you can restore.
- After successful backups, update `BACKUP_LAST_AT` (ISO8601) in the backend env so the admin UI shows “last backup”.

### Restore outline

1) Restore Postgres from the `.dump` (`pg_restore`).
2) Restore the `uploads/` directory.
3) Run migrations (`alembic upgrade head`).
4) Re-import JSON (`python -m app.cli import-data --input export-*.json`).

### DAM local-volume backup baseline

Media DAM is intentionally local-only (no S3/object storage). Treat these folders as critical data:

- `uploads/originals/`
- `uploads/variants/`
- `uploads/previews/`
- `uploads/trash/`

Operational baseline:

- daily incremental filesystem snapshot
- weekly full snapshot
- retention >= 30 days
- monthly restore drill to staging validating `/media/*` and DAM admin endpoints

## 7) Updating the app

If you deploy from GHCR images (see `.github/workflows/release.yml`), the typical upgrade flow is:

1) Pull new images.
2) Restart services: `docker compose up -d`
3) Verify health:
   - backend: `/api/v1/health` and `/api/v1/health/ready`
   - frontend: load `/` and admin area

## 8) Search Console indexing checklist (post-deploy)

For the VPS stack (`infra/prod/`), `./infra/prod/deploy.sh` can print a ready-to-run URL Inspection checklist after verification.

- Enabled by default: `RUN_GSC_INDEXING_CHECKLIST=1` (set in `infra/prod/.env`).
- Disable when needed: `RUN_GSC_INDEXING_CHECKLIST=0`.
- Run manually anytime:

```bash
./infra/prod/request-indexing-checklist.sh
```

The checklist prints key URLs for EN/RO (`home`, `shop`, `blog`) and a representative product URL discovered from `/sitemap.xml`,
plus direct URL Inspection links for quick “Request indexing” actions.

## 9) Sameday mirror sync runbook

The Sameday Easybox/FANbox checkout picker is served from the local mirror snapshot in DB. Checkout should not depend on live upstream calls.

### First-time snapshot initialization

1. Sign in as owner/admin and open `Admin -> Ops` (`/admin/ops`).
2. In the Sameday mirror card, click `Run sync now`.
3. Verify:
   - latest run status = `success`
   - locker count is greater than `0`
   - stale flag = `false`

### Stale interpretation

- `stale=false`: mirror is fresh; normal operation.
- `stale=true` with prior successful snapshot:
  - checkout continues serving the last successful snapshot.
  - manual sync should still be triggered to refresh.
- `stale=true` with no successful snapshot:
  - Sameday locker endpoints can return `503`.
  - checkout should prompt fallback delivery method until snapshot succeeds.

### Recovery flow

1. Trigger manual sync (`Run sync now`) and inspect recent runs/errors.
2. If repeated failures persist:
   - review backend logs for crawler/Cloudflare changes,
   - verify mirror configuration/env values,
   - validate outbound connectivity.
3. Keep checkout live using existing last successful snapshot when available.
4. If no snapshot is available, temporarily steer users to non-locker shipping options, then retry sync after fix.
