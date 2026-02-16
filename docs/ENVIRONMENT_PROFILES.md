# Environment Profiles (Dev vs Prod)

This repository now supports local profile-based environment switching so you can safely run development and production-like settings on the same machine.

## Goals

- Local development should work without manual `.env` editing.
- Production values should not be accidentally overwritten during local work.
- Profile switching should be deterministic and reversible.
- Local startup should fail fast when production-only settings are active.

## Commands

From repo root:

```bash
./scripts/env/bootstrap.sh
make env-dev
make env-status
make env-doctor
make dev
make dev-owner
```

Switch back to local production-like profile:

```bash
make env-prod
make env-status
```

Optional sandbox profile (real gateway sandbox testing):

```bash
./scripts/env/bootstrap.sh --with-sandbox
./scripts/env/switch.sh dev-sandbox
```

## Files and Profile Sources

Local-only profile files (ignored by git):

- `backend/.env.development.local`
- `backend/.env.production.local`
- `frontend/.env.development.local`
- `frontend/.env.production.local`
- optional:
  - `backend/.env.development.sandbox.local`
  - `frontend/.env.development.sandbox.local`

Active runtime files (used by app scripts and deploy scripts):

- `backend/.env`
- `frontend/.env`

Backups created on every switch:

- `.env.backups/<timestamp>/backend.env.before-switch`
- `.env.backups/<timestamp>/frontend.env.before-switch`

## Default Development Safety

`make env-dev` applies safe defaults:

- Backend:
  - `ENVIRONMENT=local`
  - `DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5433/adrianaart`
  - `FRONTEND_ORIGIN=http://localhost:4200`
  - `SECURE_COOKIES=0`
  - `CAPTCHA_ENABLED=0`
  - `PAYMENTS_PROVIDER=mock`
- Frontend:
  - `APP_ENV=development`
  - `API_BASE_URL=/api/v1`
  - payment buttons enabled (UI visible), captcha key empty

This is designed for daily coding with low risk and fewer setup blockers.

## Start Script Guard

`./start.sh` now runs:

```bash
./scripts/env/doctor.sh --require-dev
```

If production-like settings are active, startup stops and tells you to run:

```bash
make env-dev
```

## One-command local owner workflow

Use this when you want a reproducible local dev start with an owner account already bootstrapped:

```bash
make dev-owner
```

What it does:

1. Bootstraps/switches to the dev profile.
2. Runs env doctor in `--require-dev` mode (fails if profile is production-like).
3. Starts local compose Postgres if DB is down.
4. Runs `alembic upgrade head`.
5. Runs `python -m app.cli bootstrap-owner`.
6. Starts `./start.sh`.

Override defaults if needed:

- `DEV_OWNER_EMAIL`
- `DEV_OWNER_PASSWORD`
- `DEV_OWNER_USERNAME`
- `DEV_OWNER_DISPLAY_NAME`

## Production Integrity Notes

- `infra/prod/deploy.sh` still expects `backend/.env` and `frontend/.env`.
- On VPS, keep those files managed on the server as before.
- Local profile scripts do **not** write to `infra/prod/.env`.

## Troubleshooting

### `adrianaart.db` appears in repo root

Cause: backend settings fallback to sqlite when Postgres/env is unavailable.

Mitigations now in place:

- sqlite fallback path is anchored to `backend/adrianaart.db` (not cwd-dependent)
- root and backend sqlite files are ignored by git
- doctor warns when active DB URL is sqlite

### Local login fails on localhost

Usually caused by production cookies in local mode (`SECURE_COOKIES=1`).

Fix:

```bash
make env-dev
```

### CAPTCHA blocks local forms

Fix:

```bash
make env-dev
```

This sets `CAPTCHA_ENABLED=0` in backend dev profile and clears frontend site key.

### DB is not running

`start.sh` will attempt to auto-start compose Postgres on `localhost:5433`.

Manual fallback:

```bash
docker compose -f infra/docker-compose.yml up -d db
```
