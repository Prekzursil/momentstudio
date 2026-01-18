#!/usr/bin/env bash
set -euo pipefail

echo "Applying database migrations"
alembic upgrade head

exec "$@"

