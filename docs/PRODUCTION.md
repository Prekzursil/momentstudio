# Production deployment guide

This document describes a practical, production-oriented way to deploy the `momentstudio` stack.

At a high level:

- **Backend**: FastAPI container (runs Alembic migrations at startup).
- **Database**: Postgres (managed service or container).
- **Frontend**: static Angular build served by nginx (also reverse-proxies `/api/*` and `/media/*` to the backend).
- **TLS / public ingress**: your reverse proxy (Caddy/nginx/Traefik) in front of the frontend.

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
    - `NETOPIA_API_KEY=...` (from the Netopia admin panel)
    - `NETOPIA_POS_SIGNATURE=...`
    - `NETOPIA_PUBLIC_KEY_PEM=...` (or `NETOPIA_PUBLIC_KEY_PATH=...`)

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
cd infra/backup
DATABASE_URL=postgresql://... ./export_all.sh
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

## 7) Updating the app

If you deploy from GHCR images (see `.github/workflows/release.yml`), the typical upgrade flow is:

1) Pull new images.
2) Restart services: `docker compose up -d`
3) Verify health:
   - backend: `/api/v1/health` and `/api/v1/health/ready`
   - frontend: load `/` and admin area
