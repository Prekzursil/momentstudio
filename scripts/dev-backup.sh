#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="${repo_root}/infra/docker-compose.yml"
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

mkdir -p "${backup_dir}" "${repo_root}/uploads" "${repo_root}/private_uploads"

ts="$(date -u +"%Y%m%dT%H%M%SZ")"
out="${backup_dir}/dev-backup-${ts}.tar.gz"

tmp="$(mktemp -d)"
cleanup() { rm -rf "${tmp}"; }
trap cleanup EXIT

echo "Ensuring dev database container is running..."
docker compose -f "${compose_file}" up -d db

echo "Waiting for database to become ready..."
db_deadline="$((SECONDS + 60))"
until docker compose -f "${compose_file}" exec -T db pg_isready -U postgres -d adrianaart >/dev/null 2>&1; do
  if (( SECONDS > db_deadline )); then
    echo "ERROR: Database did not become ready within 60s." >&2
    exit 1
  fi
  sleep 2
done

echo "Dumping Postgres (dev)..."
docker compose -f "${compose_file}" exec -T db pg_dump \
  -U postgres \
  -d adrianaart \
  -Fc \
  > "${tmp}/db.dump"

git_rev="$(git rev-parse HEAD 2>/dev/null || true)"
cat >"${tmp}/manifest.txt" <<EOF
timestamp_utc=${ts}
git_rev=${git_rev}
source=dev
EOF

echo "Creating backup archive..."
tar -C "${repo_root}" -czf "${out}" \
  uploads \
  private_uploads \
  -C "${tmp}" db.dump manifest.txt

echo "Backup created: ${out}"
echo "Tip: copy this file to the VPS and restore with: ./infra/prod/restore.sh ${out}"

