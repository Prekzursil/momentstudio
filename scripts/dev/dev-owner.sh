#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_BOOTSTRAP="${ROOT_DIR}/scripts/env/bootstrap.sh"
ENV_SWITCH="${ROOT_DIR}/scripts/env/switch.sh"
ENV_DOCTOR="${ROOT_DIR}/scripts/env/doctor.sh"
START_SCRIPT="${ROOT_DIR}/start.sh"

BACKEND_DIR="${ROOT_DIR}/backend"
BACKEND_VENV="${BACKEND_DIR}/.venv"
BACKEND_PYTHON="${BACKEND_VENV}/bin/python"
BACKEND_PIP="${BACKEND_VENV}/bin/pip"

DEV_OWNER_EMAIL="${DEV_OWNER_EMAIL:-owner@local.test}"
DEV_OWNER_PASSWORD="${DEV_OWNER_PASSWORD:-OwnerDev!123}"
DEV_OWNER_USERNAME="${DEV_OWNER_USERNAME:-owner}"
DEV_OWNER_DISPLAY_NAME="${DEV_OWNER_DISPLAY_NAME:-Owner Local}"

echo "==> Bootstrapping local env profiles (idempotent)"
"${ENV_BOOTSTRAP}"

echo "==> Activating development profile"
"${ENV_SWITCH}" dev

echo "==> Verifying dev-safe profile"
"${ENV_DOCTOR}" --require-dev

if [[ ! -x "${BACKEND_PYTHON}" ]]; then
  echo "==> Creating backend virtual environment"
  python3 -m venv "${BACKEND_VENV}"
fi

if ! "${BACKEND_PYTHON}" -m alembic --help >/dev/null 2>&1; then
  echo "==> Installing backend dependencies"
  "${BACKEND_PIP}" install --disable-pip-version-check --progress-bar off --upgrade pip
  "${BACKEND_PIP}" install --disable-pip-version-check --progress-bar off -r "${BACKEND_DIR}/requirements.txt"
fi

check_db_ready() {
  (
    cd "${BACKEND_DIR}"
    PYTHONPATH="${BACKEND_DIR}" "${BACKEND_PYTHON}" - <<'PY'
import asyncio
from urllib.parse import urlsplit

import asyncpg

from app.core.config import settings

raw_url = settings.database_url
url = raw_url
if url.startswith("postgresql+asyncpg://"):
    url = url.replace("postgresql+asyncpg://", "postgresql://", 1)

parts = urlsplit(url)
host = parts.hostname or "localhost"
port = parts.port or 5432
db = (parts.path or "").lstrip("/") or "postgres"

async def main() -> None:
    conn = await asyncpg.connect(url, timeout=2)
    await conn.close()
    print(f"Postgres reachable at {host}:{port}/{db}")

asyncio.run(main())
PY
  )
}

echo "==> Checking database availability"
if ! check_db_ready >/dev/null 2>&1; then
  if command -v docker >/dev/null 2>&1 && [[ -f "${ROOT_DIR}/infra/docker-compose.yml" ]]; then
    echo "Database unreachable, starting local compose Postgres service (db)"
    docker compose -f "${ROOT_DIR}/infra/docker-compose.yml" up -d db
  else
    echo "ERROR: Database is unreachable and Docker Compose db auto-start is unavailable." >&2
    exit 1
  fi
fi

echo "==> Waiting for database"
for _ in $(seq 1 30); do
  if check_db_ready >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
check_db_ready

echo "==> Applying database migrations"
(
  cd "${BACKEND_DIR}"
  PYTHONPATH="${BACKEND_DIR}" "${BACKEND_PYTHON}" -m alembic upgrade head
)

echo "==> Bootstrapping owner/admin account for local dev"
(
  cd "${BACKEND_DIR}"
  PYTHONPATH="${BACKEND_DIR}" "${BACKEND_PYTHON}" -m app.cli bootstrap-owner \
    --email "${DEV_OWNER_EMAIL}" \
    --password "${DEV_OWNER_PASSWORD}" \
    --username "${DEV_OWNER_USERNAME}" \
    --display-name "${DEV_OWNER_DISPLAY_NAME}"
)

echo ""
echo "Local owner credentials (development profile):"
echo "- Email: ${DEV_OWNER_EMAIL}"
echo "- Password: ${DEV_OWNER_PASSWORD}"
echo "- Username: ${DEV_OWNER_USERNAME}"
echo "- Display name: ${DEV_OWNER_DISPLAY_NAME}"
echo "- Storefront URL: http://localhost:4200"
echo "- Admin URL: http://localhost:4200/admin/dashboard"
echo ""
echo "==> Starting app in foreground via ./start.sh"
exec "${START_SCRIPT}"
