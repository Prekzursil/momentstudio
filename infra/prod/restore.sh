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

backup_path="${1:-}"
if [[ -z "${backup_path}" ]]; then
  echo "Usage: infra/prod/restore.sh path/to/backup-<timestamp>.tar.gz" >&2
  exit 2
fi

backup_path="$(cd "$(dirname "${backup_path}")" && pwd)/$(basename "${backup_path}")"
if [[ ! -f "${backup_path}" ]]; then
  echo "ERROR: Backup not found: ${backup_path}" >&2
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

echo "WARNING: This will overwrite:"
echo "- Postgres database (${POSTGRES_DB:-adrianaart})"
echo "- ${repo_root}/uploads"
echo "- ${repo_root}/private_uploads"
echo
read -r -p "Type RESTORE to continue: " confirm
if [[ "${confirm}" != "RESTORE" ]]; then
  echo "Aborted."
  exit 1
fi

tmp="$(mktemp -d)"
cleanup() { rm -rf "${tmp}"; }
trap cleanup EXIT

echo "Extracting backup..."
tar -xzf "${backup_path}" -C "${tmp}"

if [[ ! -f "${tmp}/db.dump" ]]; then
  echo "ERROR: db.dump not found in backup archive" >&2
  exit 1
fi

mkdir -p "${repo_root}/uploads" "${repo_root}/private_uploads"

echo "Stopping app containers (keeps db running)..."
docker compose --env-file "${env_file}" -f "${compose_file}" stop backend frontend caddy || true

echo "Restoring media..."
rm -rf "${repo_root}/uploads" "${repo_root}/private_uploads"
mkdir -p "${repo_root}/uploads" "${repo_root}/private_uploads"
cp -a "${tmp}/uploads/." "${repo_root}/uploads/"
cp -a "${tmp}/private_uploads/." "${repo_root}/private_uploads/"

echo "Restoring Postgres..."
cat "${tmp}/db.dump" | docker compose --env-file "${env_file}" -f "${compose_file}" exec -T db pg_restore \
  -U "${POSTGRES_USER:-postgres}" \
  -d "${POSTGRES_DB:-adrianaart}" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges

echo "Starting app containers..."
docker compose --env-file "${env_file}" -f "${compose_file}" up -d --build

echo "Done."
