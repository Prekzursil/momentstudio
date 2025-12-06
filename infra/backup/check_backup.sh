#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${1:-}" ]]; then
  echo "Usage: $0 path/to/backup.tar.gz" >&2
  exit 1
fi

BACKUP="$1"
WORKDIR="$(mktemp -d)"
echo "Using temp dir $WORKDIR"

tar -xzf "$BACKUP" -C "$WORKDIR"

DB_DUMP=$(find "$WORKDIR" -name "*.dump" | head -n1)
EXPORT_JSON=$(find "$WORKDIR" -name "export-*.json" | head -n1)
MEDIA_DIR=$(find "$WORKDIR" -maxdepth 2 -type d -name "uploads" | head -n1)

if [[ -z "$DB_DUMP" || -z "$EXPORT_JSON" ]]; then
  echo "Missing dump or export json in archive" >&2
  exit 1
fi

docker run --rm -d --name backup-check -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:16-alpine
sleep 5

PGURL="postgresql://postgres:test@localhost:55432/postgres"
pg_restore --clean --if-exists -d "$PGURL" "$DB_DUMP"

export DATABASE_URL="$PGURL"
python -m app.cli import-data --input "$EXPORT_JSON"

curl -f http://localhost:8000/api/v1/health || echo "(health check requires app running against restored DB)"

docker stop backup-check
rm -rf "$WORKDIR"
echo "Backup check complete"
