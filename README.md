# momentstudio (AdrianaArt)

Bilingual (RO/EN) e-commerce storefront + admin suite for showcasing and selling handmade products.

This repository is a monorepo:
- `backend/` — FastAPI (Python) API under `/api/v1`
- `frontend/` — Angular app (storefront + admin UI)
- `infra/` — Docker Compose + backup helpers

## Requirements

- Python 3.12+
- Node.js (CI uses Node 24 + npm 11.7)
- Docker (optional, for the prod-like stack and CI-style E2E)

## Tech stack (current)

- Frontend: Angular 21 + Tailwind, i18n via `@ngx-translate`
- Backend: FastAPI + SQLAlchemy + Alembic
- DB: Postgres (Docker stack) or SQLite (local dev)
- Payments: Stripe + PayPal + Cash on delivery (Netopia is scaffolded/configurable)
- CI: GitHub Actions (backend, frontend, Docker Compose smoke/E2E)

## Quick start

### Option A: one-command dev (recommended)

```bash
make env-dev
make dev
# or
./start.sh
```

- Starts the backend + frontend in dev mode and runs `alembic upgrade head`.
- `make env-dev` activates safe local settings (mock payments, captcha disabled, localhost cookies).
- Uses an Angular dev proxy so the browser talks to a single origin (avoids CORS in local dev).
- Defaults to:
  - Frontend: `http://localhost:4200`
  - Backend: `http://127.0.0.1:8000`
  - Ports automatically bump if they’re already in use.
- If `DATABASE_URL` is not reachable and Docker is available, `start.sh` will try to start the Compose Postgres service.

### Option B: Docker Compose stack (prod-like)

```bash
make docker-up
# or
cd infra && docker compose up --build
```

- Frontend: `http://localhost:4201`
- Backend health: `http://localhost:8001/api/v1/health`
- Backend docs: `http://localhost:8001/docs`
- Postgres: `localhost:5433` (named volume; use `docker compose down -v` to reset)
- Redis: `localhost:6379` (shared rate limiting/caches; optional in non-Compose dev)

After first boot / after a DB reset, seed data and bootstrap the owner:

```bash
docker compose -f infra/docker-compose.yml exec -T backend python -m app.seeds
docker compose -f infra/docker-compose.yml exec -T backend python -m app.cli bootstrap-owner \
  --email owner@example.com --password Password123 --username owner --display-name Owner
```

## Configuration

- One-time profile bootstrap:

  ```bash
  ./scripts/env/bootstrap.sh
  ```

- Switch active local profile:

  ```bash
  make env-dev    # safe daily local development
  make env-prod   # local production-like mode
  make env-status
  make env-doctor
  ```

- Backend profile files:
  - `backend/.env.development.local`
  - `backend/.env.production.local`
- Frontend profile files:
  - `frontend/.env.development.local`
  - `frontend/.env.production.local`
- Docker stack: `infra/docker-compose.yml`

See `docs/ENVIRONMENT_PROFILES.md` for full details and troubleshooting.

## Common commands

```bash
make dev
make env-dev
make env-prod
make env-status
make env-doctor
make lint
make test
make docker-up
make docker-down
make compose-smoke
```

Frontend-only:

```bash
cd frontend
npm ci
npm run lint
npm run i18n:check
npm test -- --watch=false
npm run build
```

Backend-only:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
pytest
```

## E2E tests (Playwright)

The CI runs Playwright against the Docker stack. You can run it locally too:

```bash
cd infra && docker compose up -d --build
cd ../frontend
E2E_BASE_URL=http://localhost:4201 npm run e2e
```

To run the same end-to-end flow as the `compose-smoke` GitHub Actions job (build stack, wait for health, seed + bootstrap owner, run E2E):

```bash
make compose-smoke
```

## Backups & data portability

- Export/import JSON: `python -m app.cli export-data` / `python -m app.cli import-data`
- Full backup helpers: `infra/backup/export_all.sh` + `infra/backup/check_backup.sh`

See `backend/README.md` and `infra/README.md`.

## Release images (GHCR)

The `Release` GitHub Actions workflow builds/pushes images when you push a tag like `v1.2.3`:

- `ghcr.io/<owner>/<repo>/backend:<tag>`
- `ghcr.io/<owner>/<repo>/frontend:<tag>`

## Docs

- `ARCHITECTURE.md` — high-level design notes
- `CONTRIBUTING.md` — conventions and workflows
- `docs/PRODUCTION.md` — production deployment guide
- `docs/ENVIRONMENT_PROFILES.md` — local dev/prod profile switching guide
- `docs/GOOGLE_OAUTH.md` — Google OAuth setup (origins + redirect URIs)
- `docs/DEV_PORTS.md` — dev ports + proxy/CORS expectations
- `backend/README.md`, `frontend/README.md`, `infra/README.md`
