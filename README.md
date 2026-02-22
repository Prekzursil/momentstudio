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

## Observability and Visual Regression

Runtime env keys (frontend):

- `FRONTEND_CLARITY_PROJECT_ID` — Microsoft Clarity project id.
- `CLARITY_ENABLED` — enable/disable Clarity bootstrap.
- `SENTRY_ENABLED` — global frontend Sentry switch (`1` by default).
- `SENTRY_DSN` — shared Sentry DSN (frontend + backend).
- `SENTRY_SEND_DEFAULT_PII` — defaults to `1` for this repository policy.
- `SENTRY_TRACES_SAMPLE_RATE`, `SENTRY_REPLAY_SESSION_SAMPLE_RATE`, `SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE`.

Runtime env keys (backend):

- `SENTRY_DSN` — shared DSN.
- `SENTRY_SEND_DEFAULT_PII` — defaults to `1`.
- `SENTRY_TRACES_SAMPLE_RATE`, `SENTRY_PROFILES_SAMPLE_RATE`, `SENTRY_ENABLE_LOGS`, `SENTRY_LOG_LEVEL`.

Recommended max-observability baseline (override per environment as needed):

- backend: `SENTRY_TRACES_SAMPLE_RATE=1.0`, `SENTRY_PROFILES_SAMPLE_RATE=1.0`, `SENTRY_ENABLE_LOGS=1`, `SENTRY_LOG_LEVEL=info`
- frontend: `SENTRY_ENABLED=1`, `SENTRY_TRACES_SAMPLE_RATE=1.0`, `SENTRY_REPLAY_SESSION_SAMPLE_RATE=0.25`, `SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE=1.0`

Behavior policy:

- Clarity initializes only when analytics opt-in is enabled, on public storefront routes, and never for authenticated sessions.
- Sentry initializes only when `SENTRY_DSN` is configured.

CI sourcemap + release upload:

- Workflow: `.github/workflows/sentry-release.yml`
- Required GitHub configuration:
  - secret: `SENTRY_AUTH_TOKEN`
  - variable: `SENTRY_ORG`
  - variable: `SENTRY_PROJECT`
  - optional variable: `SENTRY_URL` (for self-hosted Sentry)
- Release identifier: full git SHA (`GITHUB_SHA`), aligned with production `APP_VERSION` stamping.
- If required Sentry secret/variables are missing, the workflow exits green with an explicit skip summary.

Percy workflows:

- `Percy Visual` runs core snapshots on pull requests (non-blocking).
- `Percy Visual` runs expanded snapshots on weekly schedule or manual dispatch (non-blocking).
- Pull request runs auto-approve Percy build reviews by default to prevent external Percy review statuses from blocking merges.
- If `PERCY_TOKEN` is not configured, Percy jobs are skipped with a summary note.
- Optional variable: `PERCY_AUTO_APPROVE_PR=1` (default behavior). Set to `0` to keep manual Percy review approval.

Applitools workflows:

- `Applitools Visual` runs Eyes snapshots on pull requests (non-blocking).
- `Applitools Visual` also runs weekly and supports manual dispatch.
- If `APPLITOOLS_API_KEY` is not configured, Applitools jobs are skipped with a summary note.

Validation baseline snapshots:

- Store reconciliation snapshots under `docs/reports/visual-a11y-reconciliation/` with run URLs for:
  - `Percy Visual`
  - `Applitools Visual`
  - `Audit Weekly Evidence`
  - `Audit Weekly Agent`

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
make coverage
make coverage-codacy
make docker-up
make docker-down
make compose-smoke
```

## Codacy coverage (local + GitHub CI)

This repository now includes a dedicated `Codacy Coverage` GitHub workflow (`.github/workflows/codacy-coverage.yml`) that:

- runs backend tests and writes `backend/coverage.xml`
- runs frontend tests with `--code-coverage` and writes `frontend/coverage/app/lcov.info`
- uploads both reports to Codacy

Required GitHub secret:

- `CODACY_API_TOKEN` (from Codacy coverage settings)

Optional environment values (defaults are already set in workflow and Makefile):

- `CODACY_ORGANIZATION_PROVIDER=gh`
- `CODACY_USERNAME=Prekzursil`
- `CODACY_PROJECT_NAME=AdrianaArt`

Run the same flow locally:

```bash
export CODACY_API_TOKEN="<your_token>"
export CODACY_ORGANIZATION_PROVIDER=gh
export CODACY_USERNAME=Prekzursil
export CODACY_PROJECT_NAME=AdrianaArt
make coverage-codacy
```

## Codecov (GitHub App + uploads)

- Install the Codecov GitHub App for this repository via https://github.com/settings/installations/110555522 (select the Prekzursil org and the `AdrianaArt` repo).
- Ensure the repo is present in the Prekzursil Codecov org at https://app.codecov.io/gh/Prekzursil; if it is missing, add the repository from the dashboard and grab the repo upload token.
- Add a GitHub Actions secret `CODECOV_TOKEN` (org- or repo-level). The token is required by `.github/workflows/codecov-analytics.yml` for coverage, test-results, and bundle analysis uploads; policy is in `codecov.yml`.

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

Frontend SSR smoke (initial HTML crawlability):

```bash
cd frontend
npm run build:ssr
PORT=4000 SSR_API_BASE_URL=http://127.0.0.1:8000/api/v1 npm run serve:ssr
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

## Release Verification Checklist

Before tagging a release, run through this hygiene checklist to ensure production readiness:

### Pre-Release Verification

1. **Run full verification suite:**
   ```bash
   make verify
   ```
   This executes both `make lint` and `make test` across backend and frontend.

2. **Check environment profile status:**
   ```bash
   make env-status
   make env-doctor
   ```

3. **Validate Docker stack health:**
   ```bash
   make docker-up
   make compose-smoke
   ```

4. **Review audit evidence (if applicable):**
   - Check latest `Audit PR Evidence` artifact for any regressions
   - Review `Audit Weekly Agent` issue for unresolved `severity:s1/s2` findings
   - Confirm no breaking changes in route/surface maps

5. **Verify observability configuration:**
   - Confirm `SENTRY_DSN` is set for production backend
   - Validate frontend Sentry config (`SENTRY_ENABLED`, `SENTRY_DSN`, sample rates)
   - Check Clarity config if enabled (`FRONTEND_CLARITY_PROJECT_ID`)

6. **Database migration check:**
   ```bash
   cd backend && alembic check
   ```

7. **Test payment provider integration (if changed):**
   ```bash
   PAYMENTS_PROVIDER=providers PYTHONPATH=backend pytest backend/tests/test_checkout_flow.py
   ```

### Post-Release Validation

1. **Verify GHCR images were published:**
   - Check `ghcr.io/<owner>/<repo>/backend:<tag>`
   - Check `ghcr.io/<owner>/<repo>/frontend:<tag>`

2. **Confirm Sentry release creation:**
   - Review `Sentry Release` workflow success
   - Verify sourcemaps uploaded (frontend only)

3. **Monitor production logs (first 30 minutes):**
   - Backend startup health check
   - No unexpected error spikes in Sentry
   - Payment provider connectivity (if applicable)

### Rollback Plan

If post-release issues are detected:

1. **Immediate rollback:**
   - Revert to previous stable tag
   - Roll back database migrations if schema changed: `alembic downgrade -1`

2. **Incident documentation:**
   - Open issue with `type:bug` + `priority:p0`
   - Document incident timeline and root cause
   - Update `TODO.md` with lessons learned

## Docs

- `ARCHITECTURE.md` — high-level design notes
- `docs/AI_NATIVE_ENGINEERING_PLAYBOOK.md` — AI-native execution model (intake, risk, evidence, rollback)
- `CONTRIBUTING.md` — conventions and workflows
- `SECURITY.md` — security disclosure policy
- `docs/REPOSITORY_POLICY.md` — branch protection, labels, CI gates, and merge policy
- `docs/PRODUCTION.md` — production deployment guide
- `docs/ENVIRONMENT_PROFILES.md` — local dev/prod profile switching guide
- `docs/GOOGLE_OAUTH.md` — Google OAuth setup (origins + redirect URIs)
- `docs/DEV_PORTS.md` — dev ports + proxy/CORS expectations
- `backend/README.md`, `frontend/README.md`, `infra/README.md`

## AI-native working model

This repository follows a soft-enforced AI-native workflow:

- deterministic evidence before judgment,
- explicit intake + risk + acceptance criteria in PRs/issues,
- role-based execution (`Planner`, `Implementer`, `Verifier`, `Reviewer`, `Operator`),
- explicit rollback notes for medium/high-risk changes.

See `docs/AI_NATIVE_ENGINEERING_PLAYBOOK.md` for the canonical policy and rollout details.

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

- `Audit PR Evidence` (required check): fast deterministic evidence on pull requests, captured against SSR output.
- `Audit Weekly Evidence`: full weekly evidence pack + generated SEO content backlog, captured against SSR output.
- `Audit Weekly Agent`: creates/updates rolling issue `Weekly UX/IA Audit Digest`, upserts `s1/s2` findings, and also upserts indexable-route `s3` SEO debt issues (`audit:seo`) with deterministic fingerprint dedupe.
- `Audit PR Agent`: label a PR with `audit:agent` (or run the workflow manually) to open a Copilot-assigned audit issue against the latest PR evidence.
- `Audit PR Deep Agent`: opt-in deep pass for PRs labeled `audit:deep`.

Quick usage:

1. Open PR and review `audit-evidence-pack` artifact from `Audit PR Evidence`.
2. Add label `audit:deep` to request a Copilot deep audit issue for that PR.
3. Review weekly digest issue for severe findings + rolling lower-severity notes.
4. Review route-level SEO debt issues labeled `audit:seo` + `ai:ready` (created from weekly evidence for indexable routes only).
5. Manual run helpers:
   - Weekly chain: run `Audit Weekly Evidence`, then run `Audit Weekly Agent` (or let `workflow_run` trigger it automatically).
   - Deep agent: run `Audit PR Deep Agent` with `pr_number` (or leave blank to auto-detect when exactly one open PR targets `main`).

Roadmap board:

- `AdrianaArt Roadmap` — https://github.com/users/Prekzursil/projects/2
- Structure: `Status` + `Roadmap Lane` (`Now`, `Next`, `Later`) with draft-first roadmap items.

See `docs/REPOSITORY_POLICY.md` for required CI checks and merge expectations.
