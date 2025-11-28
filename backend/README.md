# Backend

FastAPI + PostgreSQL service. Wire configuration via `.env` (see `.env.example`) and run migrations via Alembic.

Quick start (placeholder):
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
alembic upgrade head
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```
