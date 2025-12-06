#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "$0")"/../.. && pwd)"
EXPORT_DIR="${BASE_DIR}/backups"
MEDIA_DIR="${BASE_DIR}/uploads"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$EXPORT_DIR"
cd "$BASE_DIR"

# Export JSON via app CLI
python -m app.cli export-data --output "$EXPORT_DIR/export-${TIMESTAMP}.json"

# Postgres dump (requires PG* env vars)
pg_dump "$DATABASE_URL" -Fc -f "$EXPORT_DIR/db-${TIMESTAMP}.dump"

# Archive everything
tar -czf "$EXPORT_DIR/backup-${TIMESTAMP}.tar.gz" -C "$EXPORT_DIR" "export-${TIMESTAMP}.json" "db-${TIMESTAMP}.dump" -C "$BASE_DIR" "$(basename "$MEDIA_DIR")"

echo "Backup created at $EXPORT_DIR/backup-${TIMESTAMP}.tar.gz"
