# Contributing to AdrianaArt

Thanks for helping build the AdrianaArt storefront and admin suite. This monorepo will house the FastAPI backend, Angular frontend, and infra tooling. Keep contributions small, well-tested, and documented so the project stays easy to evolve.

## Workflow

- Default branch: `main`. Create topic branches from an up-to-date `main`.
- Branch names: `feat/<slug>`, `fix/<slug>`, or `chore/<slug>` (e.g., `feat/auth-api`, `chore/ci-tweaks`).
- Commits: Conventional style (`feat: ...`, `fix: ...`, `chore: ...`, `docs: ...`, `refactor: ...`, `test: ...`).
- Pull requests: Keep scope tight; include summary, key changes, tests run, and risks/impact. Update `TODO.md` when you complete or add work items.
- Keep commits/PRs in the same language/service wherever possible (backend vs frontend vs infra).

## Local setup (until scaffolding lands)

Prereqs: Python 3.11+, Node.js 20 LTS, Docker + docker-compose.

### Backend (FastAPI)

```
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Configure secrets
cp .env.example .env  # or create .env with DATABASE_URL, SECRET_KEY, STRIPE_SECRET_KEY, SMTP_*, FRONTEND_ORIGIN

# Run migrations and start API
alembic upgrade head
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend (Angular)

```
cd frontend
npm install
cp .env.example .env  # set API_BASE_URL, STRIPE_PUBLISHABLE_KEY, APP_ENV
npm start
```

### Docker stack

```
cd infra
docker compose up --build
```

## Quality gates

- **Backend**: `ruff check .`, `black .`, `isort .`, `mypy .`, `pytest`.
- **Frontend**: `npm run lint`, `npm test`, `npm run build`.
- **Infra**: `docker compose config` to validate compose file.
- Run relevant checks before opening a PR; prefer fixing lint/type issues in the same branch.

## Runbook (common tasks)

- **Sync main**: `git checkout main && git pull --rebase origin main`.
- **Create branch**: `git checkout -b feat/<slug>` from `main`.
- **Update backlog**: Mark finished items in `TODO.md`; append concise follow-ups when discovered.
- **Reset local DB** (Docker): `docker compose down -v && docker compose up --build`.
- **Apply migrations**: `alembic upgrade head` (once migrations exist).
- **Seed dev data**: add or run a seed script under `backend/` once available to speed up UI testing.
- **Logs**: `docker compose logs -f backend` and `docker compose logs -f frontend` for live debugging.

## Pull request expectations

- Include tests or rationale when skipping them.
- Update docs/config when behavior changes (README, `.env.example`, `ARCHITECTURE.md`, `TODO.md`).
- Keep PRs reviewable; split into smaller PRs rather than mixing backend, frontend, and infra changes.
- Note any breaking changes, data migrations, or manual steps in the PR description.
