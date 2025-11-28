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
