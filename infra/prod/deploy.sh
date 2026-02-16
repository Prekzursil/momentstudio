#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
compose_file="${repo_root}/infra/prod/docker-compose.yml"
env_file="${repo_root}/infra/prod/.env"

cd "${repo_root}"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is not installed. See infra/prod/README.md" >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: docker compose is not available. See infra/prod/README.md" >&2
  exit 1
fi

if [[ ! -f "${env_file}" ]]; then
  echo "ERROR: Missing ${env_file}" >&2
  echo "Copy infra/prod/.env.example to infra/prod/.env and fill it in." >&2
  exit 1
fi

if [[ ! -f "${repo_root}/backend/.env" ]]; then
  echo "ERROR: Missing ${repo_root}/backend/.env" >&2
  echo "Copy backend/.env.example to backend/.env and set production values." >&2
  exit 1
fi

if [[ ! -f "${repo_root}/frontend/.env" ]]; then
  echo "ERROR: Missing ${repo_root}/frontend/.env" >&2
  echo "Copy frontend/.env.example to frontend/.env and set production values." >&2
  exit 1
fi

mkdir -p "${repo_root}/uploads" "${repo_root}/private_uploads"

# Stamp backend/frontend runtime config with the deployed git revision unless overridden.
if [[ -z "${APP_VERSION:-}" ]]; then
  APP_VERSION="$(git rev-parse --short HEAD)"
  export APP_VERSION
fi

echo "Starting (or updating) momentstudio production stack..."
docker compose --env-file "${env_file}" -f "${compose_file}" up -d --build

echo
echo "Services:"
docker compose --env-file "${env_file}" -f "${compose_file}" ps

echo
echo "Waiting for media-worker heartbeat health..."
worker_ok=0
worker_container_id="$(docker compose --env-file "${env_file}" -f "${compose_file}" ps -q media-worker || true)"
if [[ -z "${worker_container_id}" ]]; then
  echo "ERROR: media-worker container not found after startup." >&2
  docker compose --env-file "${env_file}" -f "${compose_file}" logs --no-color --tail=200 media-worker >&2 || true
  exit 1
fi
for i in $(seq 1 30); do
  worker_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}unknown{{end}}' "${worker_container_id}" 2>/dev/null || true)"
  if [[ "${worker_health}" == "healthy" ]]; then
    worker_ok=1
    break
  fi
  sleep 2
done
if [[ "${worker_ok}" != "1" ]]; then
  echo "ERROR: media-worker did not become healthy. Recent logs:" >&2
  docker compose --env-file "${env_file}" -f "${compose_file}" logs --no-color --tail=200 media-worker >&2 || true
  exit 1
fi

if [[ "${RUN_POST_SYNC_VERIFY:-1}" == "1" ]]; then
  echo
  echo "Running post-sync verification checks..."
  EXPECTED_APP_VERSION="${APP_VERSION}" "${repo_root}/infra/prod/verify-live.sh"
fi

if [[ "${RUN_GSC_INDEXING_CHECKLIST:-1}" != "0" ]]; then
  echo
  echo "Printing Search Console indexing checklist..."
  "${repo_root}/infra/prod/request-indexing-checklist.sh"
fi

echo
echo "Tip: first-time deploy requires DNS + ports 80/443 open for TLS issuance."
