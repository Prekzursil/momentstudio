# Production deploy (VPS, Docker Compose + Caddy)

This folder contains a production-oriented Docker Compose stack for **momentstudio.ro**:

- Caddy (TLS termination, reverse proxy)
- Frontend (Angular build served by nginx)
- Backend (FastAPI + Alembic migrations at startup)
- Postgres

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
  - configure Stripe/PayPal/Netopia + SMTP as needed
- `frontend/.env`
  - set `APP_ENV=production`
  - keep `API_BASE_URL=/api/v1`

## 3) Deploy / update

```bash
./infra/prod/deploy.sh
```

View logs:

```bash
docker compose --env-file infra/prod/.env -f infra/prod/docker-compose.yml logs -f --tail=200
```

## 4) First owner bootstrap

After first deploy (or after a DB reset):

```bash
docker compose --env-file infra/prod/.env -f infra/prod/docker-compose.yml exec -T backend python -m app.cli bootstrap-owner \\
  --email owner@example.com --password 'Password123' --username owner --display-name Owner
```

## 5) Backups + restores

Create a backup (DB + uploads):

```bash
./infra/prod/backup.sh
```

Backups are saved to `infra/prod/backups/`. Copy them off-host (recommended).

Restore from a backup:

```bash
./infra/prod/restore.sh infra/prod/backups/backup-<timestamp>.tar.gz
```

## 6) Notes

- This stack mounts `uploads/` + `private_uploads/` from the repo directory so media persists across restarts/rebuilds.
- `restart: unless-stopped` keeps the app running after reboots.
- Docker log rotation is enabled (json-file `max-size`/`max-file`) to reduce the risk of filling disk.

