#!/usr/bin/env bash
set -euo pipefail

# Simple dev launcher for backend (FastAPI) and frontend (Angular)

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"
FRONTEND_DIR="${ROOT_DIR}/frontend"
VENV_DIR="${ROOT_DIR}/.venv"

command -v python3 >/dev/null 2>&1 || { echo "python3 is required"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm is required"; exit 1; }

# Python env + deps
if [ ! -d "${VENV_DIR}" ]; then
  python3 -m venv "${VENV_DIR}"
fi
# shellcheck disable=SC1091
source "${VENV_DIR}/bin/activate"
pip install -r "${BACKEND_DIR}/requirements.txt"

# Migrations
echo "Applying backend migrations"
(cd "${BACKEND_DIR}" && alembic upgrade head)

# Node deps
if [ ! -d "${FRONTEND_DIR}/node_modules" ]; then
  (cd "${FRONTEND_DIR}" && npm ci)
fi

UVICORN_HOST="${UVICORN_HOST:-127.0.0.1}"
UVICORN_PORT="${UVICORN_PORT:-8000}"

echo "Starting backend on http://${UVICORN_HOST}:${UVICORN_PORT}"
(cd "${BACKEND_DIR}" && exec uvicorn app.main:app --host "${UVICORN_HOST}" --port "${UVICORN_PORT}" --reload) &
BACKEND_PID=$!
trap 'kill "${BACKEND_PID}" 2>/dev/null || true' EXIT

echo "Starting frontend dev server on http://localhost:4200"
(cd "${FRONTEND_DIR}" && exec npm start)
