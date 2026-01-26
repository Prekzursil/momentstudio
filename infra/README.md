# Local Docker development

The Docker Compose stack lives in `infra/docker-compose.yml` and starts:

- Postgres (`db`) on `localhost:5433`
- FastAPI backend (`backend`) on `localhost:8001`
- Angular frontend (`frontend`) on `localhost:4201`

## Quick start

From the repo root:

```bash
cd infra
docker compose up --build
```

Then open:

- Frontend: http://localhost:4201
- Backend health: http://localhost:8001/api/v1/health
- Backend docs: http://localhost:8001/docs

## Frontend ↔ backend routing / CORS

The `frontend` container serves the Angular build via nginx and **reverse proxies**:

- `/api/*` → `backend:8000`
- `/media/*` → `backend:8000`

That means the browser talks to a single origin (`localhost:4201`) and you typically **won’t hit CORS** in Docker mode.

If you call the backend directly from a different origin in development, set `FRONTEND_ORIGIN=http://localhost:4201`
in `backend/.env` (or edit `backend/.env.example` for quick local runs).

## Stripe webhook tunneling (local)

The backend webhook endpoint is:

- `POST /api/v1/payments/webhook`

For local development you can use the Stripe CLI:

```bash
stripe listen --forward-to http://localhost:8001/api/v1/payments/webhook
```

Then copy the printed signing secret into `backend/.env` as `STRIPE_WEBHOOK_SECRET_SANDBOX=...` (or legacy `STRIPE_WEBHOOK_SECRET=...` / `*_TEST`).

Note: for live webhooks, set `STRIPE_ENV=live` and use `STRIPE_WEBHOOK_SECRET_LIVE=...` instead.
