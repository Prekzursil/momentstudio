# Production deploy (VPS, Docker Compose + Caddy)

This folder contains a production-oriented Docker Compose stack for **momentstudio.ro**:

- Caddy (TLS termination, reverse proxy)
- Frontend (Angular build served by nginx)
- Backend (FastAPI + Alembic migrations at startup)
- Media worker (Redis-backed DAM job processor)
- Postgres
- Redis (shared rate limiting/caches; recommended for multi-replica)

## 0) DNS + firewall prerequisites

1. Point DNS to your VPS:
   - `momentstudio.ro` **A** → `<VPS_IP>`
   - `www.momentstudio.ro` **A** → `<VPS_IP>`
2. Open firewall ports:
   - 80/tcp (Let’s Encrypt HTTP-01 + HTTP→HTTPS)
   - 443/tcp (HTTPS)

## 1) Install Docker on Ubuntu

Recommended: Docker Engine + Compose plugin (official docs).

Sanity check after install:

```bash
docker --version
docker compose version
```

## 2) Bootstrap on the VPS

From your deploy directory (example: `/opt/momentstudio`):

```bash
git clone https://github.com/Prekzursil/AdrianaArt.git momentstudio
cd momentstudio
git checkout main
```

Create required env files:

```bash
cp infra/prod/.env.example infra/prod/.env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Important:

- The local profile tooling (`scripts/env/switch.sh`, `make env-dev`, `make env-prod`) is intended for local development machines.
- Production deployment in this folder continues to use explicit VPS-side `backend/.env` and `frontend/.env` files.
- Do not sync local development profile files (`*.development.local`) to the VPS.

Edit:

- `infra/prod/.env`
  - set a strong `POSTGRES_PASSWORD`
  - optionally set `CADDY_EMAIL`
- `backend/.env`
  - set `ENVIRONMENT=production`
  - set a strong `SECRET_KEY`
  - optional (recommended for multi-replica): set `REDIS_URL=redis://redis:6379/0`
  - optional CAPTCHA (Cloudflare Turnstile): set `CAPTCHA_ENABLED=1` and `TURNSTILE_SECRET_KEY=...`
  - configure Stripe/PayPal/Netopia + SMTP as needed
- `frontend/.env`
  - set `APP_ENV=production`
  - keep `API_BASE_URL=/api/v1`
  - optional CAPTCHA (Cloudflare Turnstile): set `CAPTCHA_SITE_KEY=...`

## 3) Deploy / update

```bash
./infra/prod/deploy.sh
```

Notes:

- `deploy.sh` runs `docker compose up -d --build`. It **does not wipe** your database or uploads (volumes are preserved).
- After a VPS reboot, the stack starts automatically (`restart: unless-stopped`). You usually **do not** need to run `deploy.sh` again.
- By default, `deploy.sh` exports `APP_VERSION=$(git rev-parse --short HEAD)` before recreating containers so backend/frontend diagnostics show the deployed revision.
- `deploy.sh` waits for `media-worker` heartbeat health before running post-sync checks. If the worker is unhealthy, deploy exits non-zero and prints worker logs.
- `deploy.sh` runs `infra/prod/verify-live.sh` after startup. Set `RUN_POST_SYNC_VERIFY=0` to skip that step.
- `deploy.sh` can print a Search Console URL Inspection checklist for key URLs (home/shop/blog/product). Set `RUN_GSC_INDEXING_CHECKLIST=0` to skip it.

Useful helpers:

- Start (no rebuild): `./infra/prod/start.sh`
- Stop (keeps volumes/data): `./infra/prod/stop.sh`
- Apply `.env` changes without rebuilding images: `./infra/prod/reload-env.sh` (defaults to `backend frontend caddy`)
- View logs: `./infra/prod/logs.sh` (optionally pass service names)
- List services: `./infra/prod/ps.sh`
- Verify live endpoints/headers manually: `./infra/prod/verify-live.sh`
- Print Search Console indexing checklist manually: `./infra/prod/request-indexing-checklist.sh`

Sameday mirror post-deploy check:

1. Open `Admin -> Ops` (`/admin/ops`).
2. Confirm Sameday mirror status is healthy (`latest run = success`, locker count > 0, stale = false).
3. If stale/error is shown, run `Run sync now` from the same card and re-check run history.

View logs manually:

```bash
docker compose --env-file infra/prod/.env -f infra/prod/docker-compose.yml logs -f --tail=200
```

## 4) First owner bootstrap

After first deploy (or after a DB reset):

```bash
./infra/prod/bootstrap-owner.sh --email owner@example.com --password 'Password123' --username owner --display-name Owner
```

For momentstudio.ro (example/reminder):

```bash
./infra/prod/bootstrap-owner.sh --email momentstudio.ro@gmail.com --password 'NEW_PASSWORD' --username owner --display-name Adriana
```

## 5) Backups + restores

Create a backup (DB + uploads):

```bash
./infra/prod/backup.sh
```

Backups are saved to `infra/prod/backups/`. Copy them off-host (recommended).

Retention is controlled via `infra/prod/.env`:

- `BACKUP_RETENTION_COUNT` (keep last N) takes precedence over
- `BACKUP_RETENTION_DAYS` (delete older than N days).

### Automatic daily backup (systemd timer)

On Ubuntu, run:

```bash
sudo ./infra/prod/install-backup-timer.sh
```

Check schedules:

```bash
systemctl list-timers momentstudio-backup.timer
```

View logs:

```bash
journalctl -u momentstudio-backup.service -n 200 --no-pager
```

Restore from a backup:

```bash
./infra/prod/restore.sh infra/prod/backups/backup-<timestamp>.tar.gz
```

### DAM local storage snapshot policy (local-only, no cloud/object storage)

The DAM stack is local-volume only. Keep these subpaths on the same persistent volume:

- `uploads/originals/`
- `uploads/variants/`
- `uploads/previews/`
- `uploads/trash/`

Recommended policy:

- daily incremental snapshot
- weekly full snapshot
- retention aligned with DAM trash retention (`30 days` by default)

Restore drill (monthly):

1. Restore latest DB + uploads archive to staging.
2. Verify `/api/v1/content/admin/media/assets` listing and random sample renders from `/media/*`.
3. Verify trash/restore/purge actions on staging.
4. Record restore duration and any gaps in ops notes.

### One-time migration: local dev → VPS

To move your current local dev DB + uploads to the VPS:

1. On your dev machine, create a backup archive:

   ```bash
   ./scripts/dev-backup.sh
   ```

2. Copy the resulting `infra/prod/backups/dev-backup-*.tar.gz` to the VPS (e.g. `scp`).
3. On the VPS, restore using `restore.sh`:

   ```bash
   ./infra/prod/restore.sh infra/prod/backups/dev-backup-<timestamp>.tar.gz
   ```

## 6) Notes

- This stack mounts `uploads/` + `private_uploads/` from the repo directory so media persists across restarts/rebuilds.
- `restart: unless-stopped` keeps the app running after reboots.
- Docker log rotation is enabled (json-file `max-size`/`max-file`) to reduce the risk of filling disk.
- `APP_VERSION` can be overridden explicitly when needed:

  ```bash
  APP_VERSION=v1.0.0 ./infra/prod/deploy.sh
  ```

## 7) Edge rate limiting + real client IP (recommended)

The backend includes best-effort app-level rate limiting, but you should still enforce limits at the edge (CDN/WAF/proxy)
to protect against bursts, bot abuse, and volumetric traffic.

### Recommended edge rate limits (Cloudflare / CDN / WAF)

Apply rate limiting (or bot protection / managed challenge) to:

- `POST /api/v1/orders/checkout`
- `POST /api/v1/orders/guest-checkout`
- `POST /api/v1/orders/guest-checkout/email/request`
- `POST /api/v1/payments/intent`
- `POST /api/v1/auth/verify/request`
- `POST /api/v1/support/contact`
- `POST /api/v1/newsletter/subscribe`

Suggested starting point (adjust to your traffic):

- Checkout endpoints: 10/min per IP + additional per-session/user throttles
- Verification resend: 5/min per IP
- Newsletter/contact: 5–10/min per IP

### Ensure the backend sees the real client IP

If the backend is behind a reverse proxy, enable proxy headers and restrict which upstreams are trusted.

In this repo’s `infra/prod/docker-compose.yml`, Uvicorn is started with:

- `--proxy-headers`
- `--forwarded-allow-ips ${FORWARDED_ALLOW_IPS:-127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16}`

Never use `FORWARDED_ALLOW_IPS=*` unless you are 100% sure the backend port is not reachable from untrusted networks.
If the backend is reachable directly, trusting `*` allows spoofing `X-Forwarded-For` and breaks IP-based protections.

If your proxy sits behind a public IP (or runs outside RFC1918 networks), set `FORWARDED_ALLOW_IPS` to the exact
IPs/CIDRs of your proxy layer (Caddy/Nginx/CDN) so the backend sees real client IPs without accepting spoofed headers.
