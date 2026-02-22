#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
compose_file="${repo_root}/infra/prod/docker-compose.yml"
env_file="${repo_root}/infra/prod/.env"

cd "${repo_root}"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is not installed." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: docker compose is not available." >&2
  exit 1
fi

if [[ ! -f "${env_file}" ]]; then
  echo "ERROR: Missing ${env_file}. Copy infra/prod/.env.example to infra/prod/.env" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${env_file}"
set +a

APP_SLUG="${APP_SLUG:-momentstudio}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-${APP_SLUG}}"
export APP_SLUG COMPOSE_PROJECT_NAME

echo "Stopping ${APP_SLUG} production stack (keeps volumes/data)..."
docker compose --env-file "${env_file}" -f "${compose_file}" stop "$@"

echo
docker compose --env-file "${env_file}" -f "${compose_file}" ps
