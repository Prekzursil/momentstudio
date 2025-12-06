# Backend

FastAPI + PostgreSQL service with versioned API routing under `/api/v1`.

## Quick start

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env  # update DATABASE_URL, SECRET_KEY, STRIPE_SECRET_KEY, SMTP_*, FRONTEND_ORIGIN as needed
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Key env vars:
- `SECRET_KEY`, `JWT_ALGORITHM`, `ACCESS_TOKEN_EXP_MINUTES`, `REFRESH_TOKEN_EXP_DAYS`
- `DATABASE_URL` (async driver, e.g., `postgresql+asyncpg://...`)
- `SMTP_*`, `FRONTEND_ORIGIN`
- `STRIPE_SECRET_KEY` (required for live payment flows), `STRIPE_WEBHOOK_SECRET` (if processing webhooks)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_ALLOWED_DOMAINS` (optional list) for Google OAuth

### Google OAuth quick notes
- Configure a Google OAuth client (Web) with authorized redirect URI matching `GOOGLE_REDIRECT_URI` (e.g., `http://localhost:4200/auth/google/callback` in dev).
- Set env vars above; `GOOGLE_ALLOWED_DOMAINS` is optional for restricting enterprise domains.
- Frontend calls `/auth/google/start` and then posts the returned `code`/`state` to `/auth/google/callback` to exchange for tokens.
- Authenticated users can link/unlink via `/auth/google/link/start` → `/auth/google/link` (requires password) and `/auth/google/unlink`.
- Update the frontend `.env`/config to point `GOOGLE_REDIRECT_URI` at the Angular callback route when testing locally.

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
