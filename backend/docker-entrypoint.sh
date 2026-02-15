#!/usr/bin/env bash
set -euo pipefail

echo "Applying database migrations"
if [ "${RUN_DB_MIGRATIONS:-1}" = "1" ]; then
  alembic upgrade head
else
  echo "Skipping database migrations (RUN_DB_MIGRATIONS=${RUN_DB_MIGRATIONS:-0})"
fi

exec "$@"
