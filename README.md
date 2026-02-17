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

One-command owner bootstrap + dev start:

```bash
make dev-owner
```

- Forces the local dev profile (`make env-dev` behavior).
- Applies backend migrations.
- Creates/repairs the local owner account.
- Starts backend + frontend in the foreground.
- Default local owner credentials:
  - email: `owner@local.test`
  - password: `OwnerDev!123`
  - override with `DEV_OWNER_EMAIL`, `DEV_OWNER_PASSWORD`, `DEV_OWNER_USERNAME`, `DEV_OWNER_DISPLAY_NAME`.

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

## Sentry observability (backend + frontend)

Sentry is optional and disabled unless DSNs are configured.

Backend env keys (`backend/.env*`):

- `SENTRY_DSN`
- `SENTRY_TRACES_SAMPLE_RATE` (0.0-1.0)
- `SENTRY_PROFILES_SAMPLE_RATE` (0.0-1.0)
- `SENTRY_ENABLE_LOGS` (`0`/`1`)
- `SENTRY_LOG_LEVEL` (for example `error`, `warning`, `info`)

Frontend runtime keys (`frontend/.env*` -> `assets/app-config.js`):

- `SENTRY_DSN`
- `SENTRY_TRACES_SAMPLE_RATE` (0.0-1.0)
- `SENTRY_REPLAY_SESSION_SAMPLE_RATE` (0.0-1.0)
- `SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE` (0.0-1.0)

Suggested production starting point (adjust with real traffic):

- backend: traces `0.10`, profiles `0.05`, logs enabled at `error`
- frontend: traces `0.10`, replay session `0.02`, replay-on-error `1.0`

Rollback/noise guardrail: set all sample rates to `0` (and optionally clear DSN) to disable traffic quickly.

## Common commands

```bash
make dev
make env-dev
make env-prod
make env-status
make env-doctor
make dev-owner
make lint
make test
make docker-up
make docker-down
make compose-smoke
```

## Sameday mirror first sync (ops runbook)

The checkout locker picker uses the local Sameday mirror snapshot from the database.

First-time initialization:

1. Sign in as owner/admin and open `Admin -> Ops` (`/admin/ops`).
2. In the Sameday mirror card, click `Run sync now`.
3. Confirm expected status:
   - latest run = `success`
   - locker count > `0`
   - stale = `false`

If stale appears:

- `stale=true` + previous successful snapshot: checkout still serves the last snapshot.
- `stale=true` + no successful snapshot: Sameday locker queries can return `503` until a successful sync completes.

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

Payment provider test parity:

```bash
# Local dev default is mock provider. For CI-like payment assertions:
PAYMENTS_PROVIDER=providers PYTHONPATH=backend /home/prekzursil/AdrianaArt/backend/.venv/bin/pytest -q backend/tests/test_checkout_flow.py
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
- `SECURITY.md` — security disclosure policy
- `docs/REPOSITORY_POLICY.md` — branch protection, labels, CI gates, and merge policy
- `docs/PRODUCTION.md` — production deployment guide
- `docs/ENVIRONMENT_PROFILES.md` — local dev/prod profile switching guide
- `docs/AI_AUDIT_PHASES.md` — AI audit phase architecture and runbooks
- `docs/GOOGLE_OAUTH.md` — Google OAuth setup (origins + redirect URIs)
- `docs/DEV_PORTS.md` — dev ports + proxy/CORS expectations
- `backend/README.md`, `frontend/README.md`, `infra/README.md`

## Repository governance

This repository uses a lightweight governance pack to keep collaboration predictable:

- PR template with test/risk/backlog evidence sections.
- Structured issue templates (bug, feature, ops incident).
- Dependabot for grouped weekly patch/minor updates (backend/frontend/actions).
- PR auto-labeling by changed paths and branch patterns.
- Dependency review checks on pull requests.

### AI audit workflow (Evidence Pack + Copilot Agent)

The UX/IA/correctness automation is split intentionally:

- Deterministic CI collects evidence artifacts only:
  - `route-map.json`
  - `surface-map.json`
  - `seo-snapshot.json`
  - `console-errors.json`
  - `layout-signals.json`
  - screenshots
- Copilot agent provides judgment and recommendations through issues/PRs.
- No OpenAI/Anthropic API usage is configured in CI.

Workflows:

- `Audit PR Evidence` (required check): fast deterministic evidence on pull requests.
- `Audit Weekly Evidence`: full weekly evidence pack.
- `Audit Weekly Agent`: creates/updates rolling issue `Weekly UX/IA Audit Digest` and assigns `@copilot`.
- `Audit PR Agent`: label a PR with `audit:agent` (or run the workflow manually) to open a Copilot-assigned audit issue against the latest PR evidence.
- `Audit PR Deep Agent`: opt-in deep pass for PRs labeled `audit:deep`.
- `Audit Agent Watchdog`: re-queues stale `ai:in-progress` audit issues.

Quick usage:

1. Open PR and review `audit-evidence-pack` artifact from `Audit PR Evidence`.
2. Add label `audit:deep` to request a Copilot deep audit issue for that PR.
3. Review weekly digest issue for severe findings + rolling lower-severity notes.
4. Manual run helpers:
   - Weekly chain: run `Audit Weekly Evidence`, then run `Audit Weekly Agent` (or let `workflow_run` trigger it automatically).
   - Deep agent: run `Audit PR Deep Agent` with `pr_number` (or leave blank to auto-detect when exactly one open PR targets `main`).

Phase 2 roadmap sync (optional, weekly severe issue auto-sync to lane `Now`):

1. Configure repository secret `ROADMAP_PROJECT_WRITE_TOKEN` with ProjectV2 write access.
2. Optional overrides:
   - `ROADMAP_PROJECT_OWNER` (default: `Prekzursil`)
   - `ROADMAP_PROJECT_NUMBER` (default: `2`)
3. Run `Audit Weekly Evidence` then `Audit Weekly Agent`.
4. Expected result:
   - severe `s1/s2` audit issues are upserted and synced to `AdrianaArt Roadmap` lane `Now`
   - if token is missing, workflow stays green and reports an explicit skip reason.

Roadmap board:

- `AdrianaArt Roadmap` — https://github.com/users/Prekzursil/projects/2
- Structure: `Status` + `Roadmap Lane` (`Now`, `Next`, `Later`) with draft-first roadmap items.

See `docs/REPOSITORY_POLICY.md` for required CI checks and merge expectations.
See `docs/AI_AUDIT_PHASES.md` for full Phase 1 + Phase 2 architecture/runbooks.
