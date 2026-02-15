#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/env/_common.sh
source "${SCRIPT_DIR}/_common.sh"

usage() {
  cat <<'EOF'
Usage: ./scripts/env/switch.sh <dev|prod|dev-sandbox>

Switches active backend/.env and frontend/.env from local profile files.
EOF
}

if [[ $# -ne 1 ]]; then
  usage
  exit 2
fi

profile="$1"
case "${profile}" in
  dev)
    source_backend="${BACKEND_ENV_DEV_PROFILE}"
    source_frontend="${FRONTEND_ENV_DEV_PROFILE}"
    ;;
  prod)
    source_backend="${BACKEND_ENV_PROD_PROFILE}"
    source_frontend="${FRONTEND_ENV_PROD_PROFILE}"
    ;;
  dev-sandbox)
    source_backend="${BACKEND_ENV_DEV_SANDBOX_PROFILE}"
    source_frontend="${FRONTEND_ENV_DEV_SANDBOX_PROFILE}"
    ;;
  *)
    usage
    exit 2
    ;;
esac

"${SCRIPT_DIR}/bootstrap.sh"

if [[ ! -f "${source_backend}" || ! -f "${source_frontend}" ]]; then
  echo "Missing profile files for '${profile}'." >&2
  if [[ "${profile}" == "dev-sandbox" ]]; then
    echo "Create sandbox profiles with: ./scripts/env/bootstrap.sh --with-sandbox" >&2
  else
    echo "Run: ./scripts/env/bootstrap.sh" >&2
  fi
  exit 1
fi

ensure_backups_dir
timestamp="$(date +%Y%m%d-%H%M%S)"
backup_dir="${BACKUPS_DIR}/${timestamp}"
mkdir -p "${backup_dir}"

if [[ -f "${BACKEND_ENV}" ]]; then
  cp "${BACKEND_ENV}" "${backup_dir}/backend.env.before-switch"
fi
if [[ -f "${FRONTEND_ENV}" ]]; then
  cp "${FRONTEND_ENV}" "${backup_dir}/frontend.env.before-switch"
fi

cp "${source_backend}" "${BACKEND_ENV}"
cp "${source_frontend}" "${FRONTEND_ENV}"

echo "Activated profile '${profile}'."
echo "Backups saved in ${backup_dir#${REPO_ROOT}/}"
echo ""
"${SCRIPT_DIR}/status.sh"

echo ""
if [[ "${profile}" == "prod" ]]; then
  echo "Next steps:"
  echo "1. Run ./scripts/env/doctor.sh"
  echo "2. Use infra/prod/deploy.sh only on VPS with VPS-managed env files."
else
  echo "Next steps:"
  echo "1. Run make dev"
  echo "2. If DB is down, start.sh will auto-start compose Postgres at localhost:5433."
fi
