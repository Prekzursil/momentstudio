# Backend

FastAPI + PostgreSQL service with versioned API routing under `/api/v1`.

## Requirements

- Python 3.12+
- Postgres (or use the Docker Compose stack in `infra/`)

## Quick start

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env  # update DATABASE_URL, SECRET_KEY, STRIPE_ENV/STRIPE_SECRET_KEY_SANDBOX, SMTP_*, FRONTEND_ORIGIN as needed
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Key env vars:
- `SECRET_KEY`, `JWT_ALGORITHM`, `ACCESS_TOKEN_EXP_MINUTES`, `REFRESH_TOKEN_EXP_DAYS`
- `DATABASE_URL` (async driver, e.g., `postgresql+asyncpg://...`)
- Optional (recommended for multi-replica): `REDIS_URL` (shared rate limiting/caches)
- `SMTP_*`, `FRONTEND_ORIGIN`
- `STRIPE_ENV` and `STRIPE_SECRET_KEY_SANDBOX` / `STRIPE_SECRET_KEY_LIVE` (or legacy `STRIPE_SECRET_KEY`)
- `STRIPE_WEBHOOK_SECRET_SANDBOX` / `STRIPE_WEBHOOK_SECRET_LIVE` (or legacy `STRIPE_WEBHOOK_SECRET`) if processing webhooks
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_ALLOWED_DOMAINS` (optional list) for Google OAuth
- `DATABASE_URL` is also used by backup scripts and CLI import/export.

### Google OAuth quick notes
- Configure a Google OAuth client (Web) with authorized redirect URI matching `GOOGLE_REDIRECT_URI` (e.g., `http://localhost:4200/auth/google/callback` in dev).
- Set env vars above; `GOOGLE_ALLOWED_DOMAINS` is optional for restricting enterprise domains.
- Frontend calls `/auth/google/start` and then posts the returned `code`/`state` to `/auth/google/callback` to exchange for tokens.
- Authenticated users can link/unlink via `/auth/google/link/start` → `/auth/google/link` (requires password) and `/auth/google/unlink`.
- Update the frontend `.env`/config to point `GOOGLE_REDIRECT_URI` at the Angular callback route when testing locally.
- See `docs/GOOGLE_OAUTH.md` for a step-by-step Google Console walkthrough.

## Database and migrations

- Default `DATABASE_URL` uses async Postgres via `postgresql+asyncpg://...`.
- Alembic is configured for async migrations:

```bash
alembic upgrade head
alembic revision --autogenerate -m "describe change"  # after models exist
```

## Tests

```bash
pytest
```

## Lint & type-check

CI pins tooling versions via `backend/requirements-ci.txt`. To run locally:

```bash
pip install -r requirements-ci.txt
ruff check .
PYTHONPATH=$(pwd) mypy app
```

## Data portability & backups

- Export JSON (users/categories/products/addresses/orders):

  ```bash
  python -m app.cli export-data --output export.json
  ```

- Import JSON (idempotent upserts, placeholder password for new users):

  ```bash
  DATABASE_URL=postgresql+asyncpg://... python -m app.cli import-data --input export.json
  ```

- Full backup helper (Postgres dump + JSON + uploads):

  ```bash
  DATABASE_URL=... ./infra/backup/export_all.sh
  ```

- Backup verification:

  ```bash
  ./check_backup.sh /path/to/backup-YYYYMMDD-HHMMSS.tar.gz
  ```

- Move/restore:
  1) Restore DB via `pg_restore` from the `.dump`.
  2) Restore `uploads/` media folder.
  3) Run `alembic upgrade head`.
  4) Run `python -m app.cli import-data --input export-*.json`.
