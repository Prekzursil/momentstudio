#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
compose_file="${repo_root}/infra/prod/docker-compose.yml"
env_file="${repo_root}/infra/prod/.env"
backup_dir="${repo_root}/infra/prod/backups"

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

mkdir -p "${backup_dir}" "${repo_root}/uploads" "${repo_root}/private_uploads"

ts="$(date -u +"%Y%m%dT%H%M%SZ")"
out="${backup_dir}/backup-${ts}.tar.gz"

tmp="$(mktemp -d)"
cleanup() { rm -rf "${tmp}"; }
trap cleanup EXIT

echo "Dumping Postgres..."
docker compose --env-file "${env_file}" -f "${compose_file}" exec -T db pg_dump \
  -U "${POSTGRES_USER:-postgres}" \
  -d "${POSTGRES_DB:-adrianaart}" \
  -Fc \
  > "${tmp}/db.dump"

git_rev="$(git rev-parse HEAD 2>/dev/null || true)"
cat >"${tmp}/manifest.txt" <<EOF
timestamp_utc=${ts}
git_rev=${git_rev}
EOF

echo "Creating backup archive..."
tar -C "${repo_root}" -czf "${out}" \
  uploads \
  private_uploads \
  -C "${tmp}" db.dump manifest.txt

echo "Backup created: ${out}"
