#!/usr/bin/env bash
set -euo pipefail

# Simple dev launcher for backend (FastAPI) and frontend (Angular)

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"
FRONTEND_DIR="${ROOT_DIR}/frontend"
VENV_DIR="${ROOT_DIR}/.venv"

command -v python3 >/dev/null 2>&1 || { echo "python3 is required"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm is required"; exit 1; }

UVICORN_HOST="${UVICORN_HOST:-127.0.0.1}"
UVICORN_PORT="${UVICORN_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-4200}"

port_is_free() {
  python3 - "$1" <<'PY'
import socket
import sys

port = int(sys.argv[1])
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
try:
    s.bind(("127.0.0.1", port))
except OSError:
    sys.exit(1)
finally:
    s.close()
sys.exit(0)
PY
}

print_port_diagnostics() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"${port}" -sTCP:LISTEN -P -n || true
    return
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp "sport = :${port}" || true
  fi
}

START_BACKEND=1
if ! port_is_free "${UVICORN_PORT}"; then
  echo "Port ${UVICORN_PORT} is already in use; skipping backend start."
  print_port_diagnostics "${UVICORN_PORT}"
  echo "Tip: if you want to run the backend from start.sh, stop anything using the port (often docker compose):"
  echo "  docker compose -f infra/docker-compose.yml down"
  START_BACKEND=0
fi

if ! port_is_free "${FRONTEND_PORT}"; then
  echo "Port ${FRONTEND_PORT} is already in use; cannot start frontend."
  print_port_diagnostics "${FRONTEND_PORT}"
  echo "If you're running Docker Compose, stop it with:"
  echo "  docker compose -f infra/docker-compose.yml down"
  exit 1
fi

# Python env + deps
if [ ! -d "${VENV_DIR}" ]; then
  python3 -m venv "${VENV_DIR}"
fi
# shellcheck disable=SC1091
source "${VENV_DIR}/bin/activate"
python -m pip install --upgrade pip
pip install -r "${BACKEND_DIR}/requirements.txt"

# Migrations
echo "Applying backend migrations"
(cd "${BACKEND_DIR}" && alembic upgrade head)

# Node deps
if [ ! -d "${FRONTEND_DIR}/node_modules" ]; then
  (cd "${FRONTEND_DIR}" && npm ci)
fi

echo "Starting backend on http://${UVICORN_HOST}:${UVICORN_PORT}"
if [ "${START_BACKEND}" -eq 1 ]; then
  (cd "${BACKEND_DIR}" && exec uvicorn app.main:app --host "${UVICORN_HOST}" --port "${UVICORN_PORT}" --reload) &
  BACKEND_PID=$!
  trap 'kill "${BACKEND_PID}" 2>/dev/null || true' EXIT
else
  echo "Backend was not started; assuming something else is serving http://${UVICORN_HOST}:${UVICORN_PORT}"
fi

echo "Starting frontend dev server on http://localhost:${FRONTEND_PORT}"
(cd "${FRONTEND_DIR}" && exec npm start -- --port "${FRONTEND_PORT}")
