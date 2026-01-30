# Contributing to momentstudio

Thanks for helping build the momentstudio storefront and admin suite. This monorepo contains the FastAPI backend, Angular frontend, and infra tooling. Keep changes small, tested, and documented so the project stays easy to evolve.

## Workflow

- Default branch: `main`. Always branch from a fresh `main`.
- Branch names: `feat/<slug>`, `fix/<slug>`, or `chore/<slug>` (examples: `feat/auth-api`, `fix/cart-merge`, `chore/ci-tweaks`).
- Commits: conventional style (`feat: ...`, `fix: ...`, `chore: ...`, `docs: ...`, `refactor: ...`, `test: ...`).
- Pull requests: keep scope tight; include summary, key changes, tests, and risks. Update `TODO.md` when you finish or add work items.
- Keep PRs focused on one area (backend vs frontend vs infra) when possible.

## Local setup

Prereqs: Python 3.12+, Node.js (CI uses Node 24 + npm 11.7), Docker + docker-compose.

### Backend (FastAPI)

```
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env  # set DATABASE_URL, SECRET_KEY, STRIPE_ENV/STRIPE_SECRET_KEY_SANDBOX, SMTP_*, FRONTEND_ORIGIN
alembic upgrade head
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend (Angular)

```
cd frontend
npm ci
cp .env.example .env  # set API_BASE_URL, STRIPE_ENV/STRIPE_PUBLISHABLE_KEY_SANDBOX, APP_ENV
npm start
```

### Docker stack

```
cd infra
docker compose up --build
```

## Quality gates

- Backend: `ruff check .`, `mypy`, `pytest` (install `backend/requirements-ci.txt` for CI-pinned tool versions).
- Frontend: `npm run lint`, `npm run i18n:check`, `npm test`, `npm run build`.
- Infra: `docker compose config` to validate compose file.
- Run the relevant checks before opening a PR; fix lint/type issues in the same branch.

## Pre-commit hooks

This repo ships a `.pre-commit-config.yaml` to keep formatting and basic linting consistent.

```
python -m pip install pre-commit
pre-commit install
pre-commit run --all-files
```

It runs Black/Ruff for Python and Prettier/ESLint for the Angular code.

Note: the frontend hooks run via `npm --prefix frontend ...`, so you need `npm ci` in `frontend/` at least once.

## Shortcuts

If you have `make` available, common workflows are:

- `make dev`
- `make test`
- `make lint`
- `make docker-up`

## Runbook

- Sync main: `git checkout main && git pull --rebase origin main`.
- Create branch: `git checkout -b feat/<slug>` from `main`.
- Update backlog: mark finished items in `TODO.md` and add concise follow-ups when needed.
- Reset local DB (Docker): `docker compose down -v && docker compose up --build`.
- Apply migrations: `cd backend && alembic upgrade head`.
- Logs: `docker compose logs -f backend` or `docker compose logs -f frontend` for live debugging.

## Pull request expectations

- Include tests or a short note when skipping them.
- Update docs/config when behavior changes (README, `.env.example`, `ARCHITECTURE.md`, `TODO.md`).
- Note any breaking changes, data migrations, or manual steps in the PR description.
