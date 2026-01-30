#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-${ROOT_DIR}/infra/docker-compose.yml}"

BACKEND_READY_URL="${BACKEND_READY_URL:-http://localhost:8001/api/v1/health/ready}"
BACKEND_HEALTH_URL="${BACKEND_HEALTH_URL:-http://localhost:8001/api/v1/health}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:4201}"

OWNER_EMAIL="${OWNER_EMAIL:-owner@example.com}"
OWNER_PASSWORD="${OWNER_PASSWORD:-Password123}"
OWNER_USERNAME="${OWNER_USERNAME:-owner}"
OWNER_DISPLAY_NAME="${OWNER_DISPLAY_NAME:-Owner}"

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
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci
  if [[ "$(id -u)" -eq 0 ]]; then
    npx playwright install --with-deps chromium
  elif command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
    npx playwright install --with-deps chromium
  else
    echo "[compose-smoke] Warning: no passwordless sudo detected; skipping OS deps install."
    echo "[compose-smoke] Installing Chromium browser only (you may need to install Playwright deps manually)."
    npx playwright install chromium
  fi
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
docker compose -f "${COMPOSE_FILE}" exec -T backend python -m app.seeds
docker compose -f "${COMPOSE_FILE}" exec -T backend python -m app.cli bootstrap-owner \
  --email "${OWNER_EMAIL}" --password "${OWNER_PASSWORD}" --username "${OWNER_USERNAME}" --display-name "${OWNER_DISPLAY_NAME}"

echo "[compose-smoke] Running Playwright E2E (checkout + admin)..."
(
  cd frontend
  E2E_BASE_URL="${FRONTEND_URL}" npm run e2e
)

echo "[compose-smoke] Done."
