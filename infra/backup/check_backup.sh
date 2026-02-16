#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<USAGE
Usage: $0 [--health-check [--health-url URL]] path/to/backup.tar.gz

Options:
  --health-check        Run HTTP health verification after restore/import.
  --health-url URL      Health endpoint URL (default: http://localhost:8000/api/v1/health).
USAGE
}

log_pass() {
  echo "✅ $1"
}

log_fail() {
  echo "❌ $1" >&2
}

log_info() {
  echo "ℹ️  $1"
}

HEALTH_CHECK=false
HEALTH_URL="http://localhost:8000/api/v1/health"
BACKUP=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --health-check)
      HEALTH_CHECK=true
      shift
      ;;
    --health-url)
      if [[ -z "${2:-}" ]]; then
        log_fail "--health-url requires a value"
        usage
        exit 1
      fi
      HEALTH_URL="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [[ -n "$BACKUP" ]]; then
        log_fail "Unexpected argument: $1"
        usage
        exit 1
      fi
      BACKUP="$1"
      shift
      ;;
  esac
done

if [[ -z "$BACKUP" ]]; then
  log_fail "Backup archive path is required"
  usage
  exit 1
fi

if [[ ! -f "$BACKUP" ]]; then
  log_fail "Backup file not found: $BACKUP"
  exit 1
fi

WORKDIR=""
CONTAINER_NAME=""

cleanup() {
  local exit_code=$?

  if [[ -n "$CONTAINER_NAME" ]]; then
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  fi

  if [[ -n "$WORKDIR" && -d "$WORKDIR" ]]; then
    rm -rf "$WORKDIR"
  fi

  if [[ $exit_code -eq 0 ]]; then
    log_pass "Cleanup complete"
  else
    log_fail "Cleanup complete after failure"
  fi
}
trap cleanup EXIT

check_dependency() {
  local dep="$1"
  local hint="$2"

  if command -v "$dep" >/dev/null 2>&1; then
    log_pass "Dependency available: $dep"
  else
    log_fail "Missing dependency: $dep. $hint"
    exit 1
  fi
}

check_dependency docker "Install Docker and ensure the daemon is running."
check_dependency pg_restore "Install PostgreSQL client tools."
check_dependency python "Install Python 3."

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

if PYTHONPATH=backend python -m app.cli --help >/dev/null 2>&1; then
  log_pass "Python CLI available: python -m app.cli"
else
  log_fail "Python CLI unavailable. Ensure backend dependencies are installed for 'python -m app.cli'."
  exit 1
fi

WORKDIR="$(mktemp -d)"
log_info "Using temp dir $WORKDIR"

log_info "Extracting backup archive"
tar -xzf "$BACKUP" -C "$WORKDIR"
log_pass "Archive extracted"

DB_DUMP="$(find "$WORKDIR" -name "*.dump" | head -n1)"
EXPORT_JSON="$(find "$WORKDIR" -name "export-*.json" | head -n1)"
MEDIA_DIR="$(find "$WORKDIR" -maxdepth 2 -type d -name "uploads" | head -n1 || true)"

if [[ -z "$DB_DUMP" || -z "$EXPORT_JSON" ]]; then
  log_fail "Missing required files in archive (expected *.dump and export-*.json)"
  exit 1
fi
log_pass "Found DB dump and export JSON"

CONTAINER_NAME="backup-check-$RANDOM-$(date +%s)"
log_info "Starting temporary PostgreSQL container: $CONTAINER_NAME"
docker run -d --name "$CONTAINER_NAME" -e POSTGRES_PASSWORD=test -p 127.0.0.1::5432 postgres:16-alpine >/dev/null
log_pass "PostgreSQL container started"

for _ in {1..30}; do
  if docker exec "$CONTAINER_NAME" pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! docker exec "$CONTAINER_NAME" pg_isready -U postgres >/dev/null 2>&1; then
  log_fail "PostgreSQL did not become ready in time"
  exit 1
fi
log_pass "PostgreSQL is ready"

PORT_LINE="$(docker port "$CONTAINER_NAME" 5432/tcp | head -n1 || true)"
HOST_PORT="${PORT_LINE##*:}"
if [[ -z "$PORT_LINE" || -z "$HOST_PORT" || "$HOST_PORT" == "$PORT_LINE" ]]; then
  log_fail "Unable to discover mapped PostgreSQL host port"
  exit 1
fi

PGURL="postgresql://postgres:test@localhost:${HOST_PORT}/postgres"
log_info "Using PostgreSQL URL: $PGURL"

if pg_restore --clean --if-exists -d "$PGURL" "$DB_DUMP"; then
  log_pass "Database restore succeeded"
else
  log_fail "Database restore failed"
  exit 1
fi

export DATABASE_URL="$PGURL"
export PYTHONPATH=backend

if python -m app.cli import-data --input "$EXPORT_JSON"; then
  log_pass "Application data import succeeded"
else
  log_fail "Application data import failed"
  exit 1
fi

if [[ -n "$MEDIA_DIR" ]]; then
  log_info "Found media directory in backup: $MEDIA_DIR"
fi

if [[ "$HEALTH_CHECK" == true ]]; then
  if command -v curl >/dev/null 2>&1; then
    log_info "Running health check: $HEALTH_URL"
    if curl -fsS "$HEALTH_URL" >/dev/null; then
      log_pass "Health check passed"
    else
      log_fail "Health check failed"
      exit 1
    fi
  else
    log_fail "curl is required for --health-check"
    exit 1
  fi
else
  log_info "Health check skipped (pass --health-check to enable)"
fi

log_pass "Backup check complete"
