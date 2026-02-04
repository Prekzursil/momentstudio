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

if [[ "${#}" -eq 0 ]]; then
  cat >&2 <<'EOF'
Usage:
  infra/prod/bootstrap-owner.sh --email owner@example.com --password 'Password123' --username owner --display-name Owner

Notes:
- This creates (or updates) the owner account used to access the admin dashboard.
- Run after the first deploy or after restoring/resetting the database.
EOF
  exit 2
fi

docker compose --env-file "${env_file}" -f "${compose_file}" exec -T backend \
  python -m app.cli bootstrap-owner "$@"

