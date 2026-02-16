#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "$0")"/../.. && pwd)"
EXPORT_DIR="${BASE_DIR}/backups"
MEDIA_DIR="${BASE_DIR}/uploads"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

usage() {
  cat <<'EOF'
Usage:
  DATABASE_URL=postgresql://... ./infra/backup/export_all.sh

Notes:
  - Run from the repository root (as shown above), or from infra/backup with:
      DATABASE_URL=postgresql://... ./export_all.sh
  - Requires `pg_dump` to be installed and available on PATH.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Error: DATABASE_URL is not set." >&2
  echo "Set it inline when invoking the script, for example:" >&2
  echo "  DATABASE_URL=postgresql://... ./infra/backup/export_all.sh" >&2
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "Error: pg_dump is not installed or not available in PATH." >&2
  echo "Install PostgreSQL client tools, then re-run:" >&2
  echo "  DATABASE_URL=postgresql://... ./infra/backup/export_all.sh" >&2
  exit 1
fi

mkdir -p "$EXPORT_DIR"
cd "$BASE_DIR"

# Export JSON via app CLI
if ! PYTHONPATH=backend python -m app.cli export-data --output "$EXPORT_DIR/export-${TIMESTAMP}.json"; then
  echo "Error: export command failed (python -m app.cli export-data)." >&2
  echo "Check that backend Python dependencies are installed and your environment is configured." >&2
  echo "Example: cd backend && pip install -r requirements.txt" >&2
  exit 1
fi

# Postgres dump (requires PG* env vars)
if ! pg_dump "$DATABASE_URL" -Fc -f "$EXPORT_DIR/db-${TIMESTAMP}.dump"; then
  echo "Error: pg_dump failed for DATABASE_URL." >&2
  echo "Verify DATABASE_URL points to a reachable Postgres instance and credentials are valid." >&2
  exit 1
fi

# Archive everything
tar -czf "$EXPORT_DIR/backup-${TIMESTAMP}.tar.gz" -C "$EXPORT_DIR" "export-${TIMESTAMP}.json" "db-${TIMESTAMP}.dump" -C "$BASE_DIR" "$(basename "$MEDIA_DIR")"

echo "Backup created at $EXPORT_DIR/backup-${TIMESTAMP}.tar.gz"
