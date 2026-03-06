# Dev ports (4200 vs 4201)

This repo supports two common local workflows. They intentionally use different frontend ports.

## Option A: `start.sh` (local dev proxy)

Before first run, activate the dev profile:

```bash
make env-dev
```

- Frontend (Angular dev server): `http://localhost:4200` (default)
- Backend (uvicorn): `http://127.0.0.1:8000` (default)

`start.sh` generates an Angular proxy config so the browser can call the API via the same origin:

- Browser → `http://localhost:4200/api/v1/*` → proxy → backend `http://127.0.0.1:8000/api/v1/*`

This avoids CORS for day-to-day dev.

### Port bumping

If `4200` is already in use, `start.sh` will pick the next free port (`4201`, `4202`, ...).

When that happens:

- `FRONTEND_ORIGIN` should match the actual frontend origin so links/redirects are correct.
- If the backend is already running and not restarted by `start.sh`, update/restart it with the correct `FRONTEND_ORIGIN`.

## Option B: Docker Compose (prod-like)

- Frontend (nginx serving built Angular app): `http://localhost:4201`
- Backend: `http://localhost:8001/api/v1/*`
- Postgres: `localhost:5433`

In Docker mode the frontend container reverse-proxies:

- `/api/*` → backend
- `/media/*` → backend

So the browser still talks to a single origin (`http://localhost:4201`) and you typically don’t hit CORS.

## CORS expectations

If you run the frontend and backend on different origins without a proxy (advanced setup), ensure:

- Backend `CORS_ORIGINS` includes the frontend origin.
- Backend `FRONTEND_ORIGIN` matches the frontend origin (used for redirects + links in emails and payment flows).
