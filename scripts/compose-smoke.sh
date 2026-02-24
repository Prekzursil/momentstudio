#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-${ROOT_DIR}/infra/docker-compose.yml}"

BACKEND_READY_URL="${BACKEND_READY_URL:-http://localhost:8001/api/v1/health/ready}"
BACKEND_HEALTH_URL="${BACKEND_HEALTH_URL:-http://localhost:8001/api/v1/health}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:4201}"

OWNER_EMAIL="${OWNER_EMAIL:-owner@local.test}"
OWNER_PASSWORD="${OWNER_PASSWORD:-OwnerDev!123}"
OWNER_USERNAME="${OWNER_USERNAME:-owner}"
OWNER_DISPLAY_NAME="${OWNER_DISPLAY_NAME:-Owner Local}"
SEED_PROFILE="${SEED_PROFILE:-default}"

if [[ -z "${OWNER_PASSWORD}" ]]; then
  echo "[compose-smoke] ERROR: OWNER_PASSWORD cannot be empty." >&2
  exit 1
fi

export LOCKERS_USE_OVERPASS_FALLBACK="${LOCKERS_USE_OVERPASS_FALLBACK:-0}"
export PAYMENTS_PROVIDER="${PAYMENTS_PROVIDER:-mock}"

cleanup() {
  status=$?
  set +e
  if [[ "${status}" -ne 0 ]]; then
    echo "[compose-smoke] Logs (on failure)..."
    docker compose -f "${COMPOSE_FILE}" ps || true
    docker compose -f "${COMPOSE_FILE}" logs --no-color || true
  fi
  docker compose -f "${COMPOSE_FILE}" down -v || true
  exit "${status}"
}

cd "${ROOT_DIR}"

echo "[compose-smoke] Installing frontend deps (Playwright)..."
(
  cd frontend
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --loglevel=error
  E2E_ADMIN_PROJECT="chromium"
  if [[ "$(id -u)" -eq 0 ]]; then
    npx playwright install --with-deps chromium firefox
    E2E_ADMIN_PROJECT="firefox"
  elif command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
    npx playwright install --with-deps chromium firefox
    E2E_ADMIN_PROJECT="firefox"
  else
    echo "[compose-smoke] Warning: no passwordless sudo detected; skipping OS deps install."
    echo "[compose-smoke] Installing Chromium browser only (you may need to install Playwright deps manually)."
    npx playwright install chromium
  fi
  echo "${E2E_ADMIN_PROJECT}" > /tmp/compose-smoke-admin-project.txt
)

echo "[compose-smoke] Building and starting stack..."
docker compose -f "${COMPOSE_FILE}" up -d --build
trap cleanup EXIT

echo "[compose-smoke] Waiting for backend readiness..."
for i in $(seq 1 60); do
  if curl -fsS "${BACKEND_READY_URL}" >/dev/null; then
    echo "[compose-smoke] Backend is ready"
    break
  fi
  echo "[compose-smoke] Waiting for backend readiness... (${i}/60)"
  sleep 2
done
curl -fsS "${BACKEND_HEALTH_URL}" >/dev/null
curl -fsS "${BACKEND_READY_URL}" >/dev/null

echo "[compose-smoke] Waiting for frontend..."
for i in $(seq 1 60); do
  if curl -fsS "${FRONTEND_URL}" >/dev/null; then
    echo "[compose-smoke] Frontend is up"
    break
  fi
  echo "[compose-smoke] Waiting for frontend... (${i}/60)"
  sleep 2
done
curl -fsS "${FRONTEND_URL}" >/dev/null

echo "[compose-smoke] Preparing DB (migrations + seeds + owner)..."
docker compose -f "${COMPOSE_FILE}" exec -T backend alembic upgrade head
docker compose -f "${COMPOSE_FILE}" exec -T backend python -m app.seeds --profile "${SEED_PROFILE}"
docker compose -f "${COMPOSE_FILE}" exec -T backend python -m app.cli bootstrap-owner \
  --email "${OWNER_EMAIL}" --password "${OWNER_PASSWORD}" --username "${OWNER_USERNAME}" --display-name "${OWNER_DISPLAY_NAME}"

echo "[compose-smoke] Running Playwright E2E (checkout + admin)..."
(
  cd frontend
  admin_project="$(cat /tmp/compose-smoke-admin-project.txt 2>/dev/null || echo chromium)"

  E2E_BASE_URL="${FRONTEND_URL}" \
  E2E_OWNER_IDENTIFIER="${OWNER_USERNAME}" \
  E2E_OWNER_PASSWORD="${OWNER_PASSWORD}" \
  E2E_OWNER_EMAIL="${OWNER_EMAIL}" \
  npx playwright test e2e/checkout-stripe.spec.ts e2e/checkout-paypal.spec.ts --workers=1 --project=chromium

  E2E_BASE_URL="${FRONTEND_URL}" \
  E2E_OWNER_IDENTIFIER="${OWNER_USERNAME}" \
  E2E_OWNER_PASSWORD="${OWNER_PASSWORD}" \
  E2E_OWNER_EMAIL="${OWNER_EMAIL}" \
  npx playwright test e2e/smoke.spec.ts --workers=1 --project=chromium

  E2E_BASE_URL="${FRONTEND_URL}" \
  npx playwright test e2e/seo-public-routes.spec.ts --workers=1 --project=chromium

  E2E_BASE_URL="${FRONTEND_URL}" \
  E2E_OWNER_IDENTIFIER="${OWNER_USERNAME}" \
  E2E_OWNER_PASSWORD="${OWNER_PASSWORD}" \
  E2E_OWNER_EMAIL="${OWNER_EMAIL}" \
  npx playwright test e2e/admin-dashboard-freeze.spec.ts --workers=1 --project="${admin_project}"
)

echo "[compose-smoke] Done."
