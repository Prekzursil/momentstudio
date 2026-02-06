# Production deploy (VPS, Docker Compose + Caddy)

This folder contains a production-oriented Docker Compose stack for **momentstudio.ro**:

- Caddy (TLS termination, reverse proxy)
- Frontend (Angular build served by nginx)
- Backend (FastAPI + Alembic migrations at startup)
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

Useful helpers:

- Start (no rebuild): `./infra/prod/start.sh`
- Stop (keeps volumes/data): `./infra/prod/stop.sh`
- Apply `.env` changes without rebuilding images: `./infra/prod/reload-env.sh` (defaults to `backend frontend caddy`)
- View logs: `./infra/prod/logs.sh` (optionally pass service names)
- List services: `./infra/prod/ps.sh`

View logs manually:

```bash
docker compose --env-file infra/prod/.env -f infra/prod/docker-compose.yml logs -f --tail=200
```

## 4) First owner bootstrap

After first deploy (or after a DB reset):

```bash
./infra/prod/bootstrap-owner.sh --email owner@example.com --password 'Password123' --username owner --display-name Owner
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
