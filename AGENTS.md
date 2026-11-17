# AGENTS.md

## Operating Model
This repository follows an evidence-first, zero-external-API-cost workflow.
Use GitHub Copilot coding agent and Codex app/IDE/CLI for implementation and review.

## Existing Audit Pipeline
This repository already has advanced audit/evidence workflows.
Do not duplicate them. Extend and reuse existing audit contracts instead.

## Risk Policy
- Default merge policy: human-reviewed only.
- Use explicit risk labels: `risk:low`, `risk:medium`, `risk:high`.
- Payments/auth/security-sensitive changes require explicit rollback notes and human sign-off.

## Canonical Verification Command
Run this command before completion claims:

```bash
make verify
```

## Scope Guardrails
- Keep changes minimal and task-focused.
- Preserve storefront/account/admin shell boundaries.
- Avoid broad refactors unless explicitly requested.

## Agent Queue Contract
- Intake issues via `.github/ISSUE_TEMPLATE/agent_task.yml`.
- Queue work by adding `agent:ready`.
- Queue workflow posts execution packet and notifies `@copilot`.

## Queue Trigger Warning
Applying label `agent:ready` triggers the queue workflow immediately.

## Cursor Cloud specific instructions

Scope: this environment has no Docker. The full stack (FastAPI backend + Angular
frontend) runs directly against a local PostgreSQL. Standard commands live in
`README.md`, `Makefile`, and `docs/ENVIRONMENT_PROFILES.md` — the notes below are
only the non-obvious caveats discovered while setting this environment up.

### Node toolchain (important)
- The frontend lockfile is generated with npm 11 (CI uses Node 24). `npm ci` fails
  with the default Node 22 (`Missing: readdirp@... from lock file`). Use Node 24 via
  nvm before any frontend command:
  `. "$HOME/.nvm/nvm.sh" && nvm use 24` (installed by the update script).
- A `/exec-daemon/node` shim (Node 22) sits ahead of nvm on `PATH`. Prepend nvm's bin
  so `node`/`npm` resolve to v24:
  `export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"`.

### Database — Postgres is required (SQLite cannot migrate)
- Alembic migrations use Postgres-only DDL (e.g. `ALTER COLUMN ... DROP DEFAULT`), so
  SQLite cannot run `alembic upgrade head`. Local dev/full-stack needs Postgres.
- A local cluster is installed on **port 5433** to match the dev profile. Postgres is
  NOT auto-started; start it each session:
  `sudo pg_ctlcluster 16 main start` (verify: `PGPASSWORD=postgres psql -h 127.0.0.1 -p 5433 -U postgres -d adrianaart -c 'select 1'`).
- DB/creds: database `adrianaart`, user/password `postgres`/`postgres`.
- First-time DB prep (from `backend/`, venv active): `alembic upgrade head`, then
  `python -m app.seeds --profile default`, then
  `python -m app.cli bootstrap-owner --email owner@local.test --password 'OwnerDev!123' --username owner --display-name Owner`.

### Env profiles
- `./scripts/env/bootstrap.sh && ./scripts/env/switch.sh dev` creates/activates the
  dev profile (mock payments, captcha off, Postgres @5433).

### Running the app (dev)
- `./start.sh` / `make dev` currently break at `ng serve --proxy-config`: the pinned
  `http-proxy-middleware@3` override is incompatible with the object-style
  `proxy.conf.json` (`[HPM] Missing "target" option`), and start.sh then kills the
  backend. Run the two servers independently instead:
  - Backend: `uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload` (from `backend/`, venv active).
  - Frontend (proxy-free, the supported alternative documented in `frontend/.env`):
    set `API_BASE_URL=http://localhost:8000/api/v1` in `frontend/.env`, then
    `node scripts/generate-config.mjs && ./node_modules/@angular/cli/bin/ng.js serve --host 127.0.0.1 --port 4200`.
- CORS gotcha: open the app via **http://localhost:4200** (NOT `127.0.0.1`). The
  backend CORS allowlist contains `http://localhost:4200`; a `127.0.0.1` origin is
  blocked and every API call fails.

### Tests
- Backend: run with the default SQLite (do NOT inherit the Postgres `backend/.env`),
  or `test_lr_leader_lock.py::test_is_postgres_false_on_sqlite` fails:
  `DATABASE_URL="sqlite+aiosqlite:///:memory:" PYTHONPATH=backend pytest backend/tests`.
  The Postgres-only test is separate: `backend/tests/test_integration_postgres.py`.
- Frontend: needs a Chrome binary. Use system Chrome + the no-sandbox launcher:
  `CHROME_BIN=$(which google-chrome) npm test -- --watch=false --browsers=ChromeHeadlessNoSandbox`.
- Lint: `cd backend && ruff check . && PYTHONPATH=$(pwd) mypy app`; `cd frontend && npm run lint`.

### Production deployment — awareness + hard safety boundary
This local dev environment maps directly onto a **live production deployment**. Be
aware of it, but never mutate it without explicit human sanction.
- **Live site:** `https://momentstudio.ro` (also `www.`). It is currently up and
  healthy — `GET /api/v1/health` returns `{"status":"ok"}`. Public origin is served by
  nginx behind Caddy, matching the `infra/prod/` stack.
- **Where it runs:** a VPS (chroot.ro KVM) running the `infra/prod/` Docker Compose
  stack — Caddy (TLS + reverse proxy → `frontend-ssr:4000`, and `/api/*` `/media/*` →
  backend), backend (FastAPI), Postgres, Redis, and the media worker. Runbook:
  `infra/prod/README.md` + `docs/PRODUCTION.md`.
- **How it deploys:** the manual GitHub Actions workflow
  `.github/workflows/deploy-production-manual.yml` (`workflow_dispatch`). It SSHes to
  the VPS using repo secrets (`PROD_SSH_HOST/PORT/USER/KEY`, `PROD_DEPLOY_PATH`),
  checks out the target SHA, optionally backs up, runs `infra/prod/deploy.sh`
  (`docker compose up -d --build` + `alembic upgrade head`), then `verify-live.sh`.
  **Rollback:** rerun the workflow with a previous known-good `target_sha`.
- **Config boundary:** production `backend/.env` / `frontend/.env` are managed
  on the VPS. Never copy local `*.development.local` profiles to prod, and never point
  local dev's `DATABASE_URL` at the production DB/host — `app/core/config.py`
  `_validate_dev_safety` refuses to boot `ENVIRONMENT=local` against a non-local DB host.
- **Do NOT, without explicit sanction:** SSH to the VPS, trigger the deploy workflow,
  run migrations against prod, or change payment/auth/DNS/secrets. Verification against
  prod must stay read-only (public health endpoints / `infra/prod/verify-live.sh`).
  Never commit VPS credentials, IPs, or panel logins to the repo.
