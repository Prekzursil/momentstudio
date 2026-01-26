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

sha256_file() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${file}" | awk '{print $1}'
    return 0
  fi
  python3 - "${file}" <<'PY'
import hashlib
import sys

path = sys.argv[1]
h = hashlib.sha256()
with open(path, "rb") as f:
    for chunk in iter(lambda: f.read(1024 * 1024), b""):
        h.update(chunk)
print(h.hexdigest())
PY
}

port_is_free() {
  python3 - "$1" <<'PY'
import errno
import socket
import sys

port = int(sys.argv[1])

def can_bind(family: int, addr: str) -> bool:
    s = socket.socket(family, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        s.bind((addr, port))
    except OSError as exc:
        if exc.errno == errno.EADDRINUSE:
            return False
        # IPv6 might be disabled or unsupported; treat as non-fatal.
        return True
    finally:
        s.close()
    return True

free = can_bind(socket.AF_INET, "127.0.0.1")
if socket.has_ipv6:
    try:
        free = free and can_bind(socket.AF_INET6, "::1")
    except OSError:
        pass

sys.exit(0 if free else 1)
PY
}

pick_free_port() {
  local base="${1}"
  local max_tries="${2:-20}"
  local port="${base}"
  local i=0
  while [ "${i}" -le "${max_tries}" ]; do
    port=$((base + i))
    if port_is_free "${port}"; then
      echo "${port}"
      return 0
    fi
    i=$((i + 1))
  done
  return 1
}

is_backend_healthy() {
  local host="${1}"
  local port="${2}"
  local url="http://${host}:${port}/api/v1/health/ready"
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 1 "${url}" >/dev/null 2>&1
    return $?
  fi
  python3 - "${url}" <<'PY'
import sys
import urllib.request

url = sys.argv[1]
try:
    with urllib.request.urlopen(url, timeout=1) as resp:
        sys.exit(0 if 200 <= resp.status < 300 else 1)
except Exception:
    sys.exit(1)
PY
}

wait_for_backend_database() {
  local max_wait_seconds="${DB_WAIT_SECONDS:-30}"
  local connect_timeout="${DB_CONNECT_TIMEOUT_SECONDS:-2}"

  (cd "${BACKEND_DIR}" && python - "${max_wait_seconds}" "${connect_timeout}" <<'PY'
import asyncio
import sys
from urllib.parse import urlsplit

import asyncpg

from app.core.config import settings

max_wait = int(sys.argv[1])
connect_timeout = float(sys.argv[2])

raw_url = settings.database_url
url = raw_url
if url.startswith("postgresql+asyncpg://"):
    url = url.replace("postgresql+asyncpg://", "postgresql://", 1)

parts = urlsplit(url)
host = parts.hostname or "localhost"
port = parts.port or 5432
db = (parts.path or "").lstrip("/") or "postgres"

async def main() -> None:
    last_exc: Exception | None = None
    for i in range(max_wait):
        try:
            conn = await asyncpg.connect(url, timeout=connect_timeout)
        except Exception as exc:
            last_exc = exc
            if i == 0:
                print(f"Waiting for Postgres at {host}:{port}/{db} (from DATABASE_URL)")
            await asyncio.sleep(1)
            continue
        else:
            await conn.close()
            print("Postgres is reachable")
            return
    msg = f"Could not connect to Postgres at {host}:{port}/{db} after {max_wait}s"
    if last_exc:
        msg += f": {last_exc}"
    raise SystemExit(msg)

asyncio.run(main())
PY
  )
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

run_step() {
  local title="$1"
  shift
  echo ""
  echo "==> ${title}"
  "$@"
}

START_BACKEND=1
BACKEND_PORT="${UVICORN_PORT}"
FRONTEND_PORT_BASE="${FRONTEND_PORT}"
if ! port_is_free "${UVICORN_PORT}"; then
  if is_backend_healthy "${UVICORN_HOST}" "${UVICORN_PORT}"; then
    echo "Port ${UVICORN_PORT} is already in use and looks like the backend is running; skipping backend start."
    START_BACKEND=0
  else
    echo "Port ${UVICORN_PORT} is already in use; selecting a free backend port."
    print_port_diagnostics "${UVICORN_PORT}"
    BACKEND_PORT="$(pick_free_port "${UVICORN_PORT}" 50 || true)"
    if [ -z "${BACKEND_PORT}" ]; then
      echo "Could not find a free backend port starting at ${UVICORN_PORT}."
      exit 1
    fi
    echo "Using backend port ${BACKEND_PORT} instead."
  fi
fi

if ! port_is_free "${FRONTEND_PORT}"; then
  echo "Port ${FRONTEND_PORT} is already in use; selecting a free frontend port."
  print_port_diagnostics "${FRONTEND_PORT}"
  FRONTEND_PORT="$(pick_free_port "${FRONTEND_PORT}" 50 || true)"
  if [ -z "${FRONTEND_PORT}" ]; then
    echo "Could not find a free frontend port starting at ${FRONTEND_PORT_BASE}."
    exit 1
  fi
  echo "Using frontend port ${FRONTEND_PORT} instead."
fi

if [ "${START_BACKEND}" -eq 1 ]; then
  run_step "Backend: set up Python environment" true

  # Python env + deps
  if [ ! -d "${VENV_DIR}" ]; then
    python3 -m venv "${VENV_DIR}"
  fi
  # shellcheck disable=SC1091
  source "${VENV_DIR}/bin/activate"

  REQUIREMENTS_FILE="${BACKEND_DIR}/requirements.txt"
  REQUIREMENTS_HASH_FILE="${VENV_DIR}/.requirements.sha256"
  REQUIREMENTS_HASH="$(sha256_file "${REQUIREMENTS_FILE}")"
  PREV_REQUIREMENTS_HASH=""
  if [ -f "${REQUIREMENTS_HASH_FILE}" ]; then
    PREV_REQUIREMENTS_HASH="$(cat "${REQUIREMENTS_HASH_FILE}" 2>/dev/null || true)"
  fi

  if [ "${REQUIREMENTS_HASH}" != "${PREV_REQUIREMENTS_HASH}" ] || [ "${FORCE_PIP_INSTALL:-0}" = "1" ]; then
    run_step "Backend: ensure pip is up-to-date" python -m pip install --disable-pip-version-check --progress-bar off --upgrade pip
    run_step "Backend: install Python dependencies (first run can take a few minutes)" \
      python -m pip install --disable-pip-version-check --progress-bar off --no-input -r "${REQUIREMENTS_FILE}"
    echo "${REQUIREMENTS_HASH}" >"${REQUIREMENTS_HASH_FILE}"
  else
    echo "Backend: Python dependencies are already installed (set FORCE_PIP_INSTALL=1 to reinstall)."
  fi

  # Migrations
  if ! run_step "Backend: wait for database" wait_for_backend_database; then
    if [ "${AUTO_START_DB:-1}" != "0" ] && command -v docker >/dev/null 2>&1 && [ -f "${ROOT_DIR}/infra/docker-compose.yml" ]; then
      echo ""
      echo "Database is not reachable; attempting to start the Docker Compose Postgres service."
      run_step "Backend: start Postgres via Docker Compose" docker compose -f infra/docker-compose.yml up -d db
      export DATABASE_URL="postgresql+asyncpg://postgres:postgres@localhost:5433/adrianaart"
      run_step "Backend: wait for database" wait_for_backend_database
    else
      echo ""
      echo "Failed to connect to Postgres."
      echo "Tip: ensure Postgres is running and DATABASE_URL points to it (backend/.env or env var)."
      echo "If you're using Docker Compose for the DB, start it with:"
      echo "  docker compose -f infra/docker-compose.yml up -d db"
      exit 1
    fi
  fi

  run_step "Backend: apply migrations" true
  if ! (cd "${BACKEND_DIR}" && alembic upgrade head); then
    echo ""
    echo "Failed to apply backend migrations."
    echo "Tip: ensure Postgres is running and DATABASE_URL points to it (backend/.env or env var)."
    echo "If you're using Docker Compose for the DB, start it with:"
    echo "  docker compose -f infra/docker-compose.yml up -d db"
    exit 1
  fi
else
  echo "Skipping backend setup (backend already running)"
  echo "Tip: if you pulled new migrations and see errors like \"column ... does not exist\", run:"
  echo "  cd backend && alembic upgrade head"
fi

# Node deps
if [ ! -d "${FRONTEND_DIR}/node_modules" ]; then
  run_step "Frontend: install Node dependencies" bash -lc "cd \"${FRONTEND_DIR}\" && npm ci"
fi

cleanup() {
  if [ -n "${PROXY_CONF:-}" ] && [ -f "${PROXY_CONF}" ]; then
    rm -f "${PROXY_CONF}" || true
  fi
  if [ -n "${BACKEND_PID:-}" ]; then
    kill "${BACKEND_PID}" 2>/dev/null || true
  fi
}

PROXY_CONF=""
BACKEND_PID=""

echo ""
echo "Starting backend on http://${UVICORN_HOST}:${BACKEND_PORT}"
if [ "${START_BACKEND}" -eq 1 ]; then
  export FRONTEND_ORIGIN="${FRONTEND_ORIGIN:-http://localhost:${FRONTEND_PORT}}"
  (cd "${BACKEND_DIR}" && exec uvicorn app.main:app --host "${UVICORN_HOST}" --port "${BACKEND_PORT}" --reload) &
  BACKEND_PID=$!
else
  echo "Backend was not started; assuming something else is serving http://${UVICORN_HOST}:${BACKEND_PORT}"
fi

trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

echo ""
echo "Starting frontend dev server on http://localhost:${FRONTEND_PORT}"
PROXY_CONF="$(mktemp "${TMPDIR:-/tmp}/adrianaart-proxy.XXXXXX.json")"
cat >"${PROXY_CONF}" <<EOF
{
  "/api": {
    "target": "http://${UVICORN_HOST}:${BACKEND_PORT}",
    "secure": false,
    "changeOrigin": true,
    "logLevel": "warn"
  },
  "/media": {
    "target": "http://${UVICORN_HOST}:${BACKEND_PORT}",
    "secure": false,
    "changeOrigin": true,
    "logLevel": "warn"
  }
}
EOF

(cd "${FRONTEND_DIR}" && node scripts/generate-config.mjs)
(cd "${FRONTEND_DIR}" && exec npx ng serve --proxy-config "${PROXY_CONF}" --port "${FRONTEND_PORT}")
