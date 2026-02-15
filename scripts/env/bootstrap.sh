#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/env/_common.sh
source "${SCRIPT_DIR}/_common.sh"

WITH_SANDBOX=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-sandbox)
      WITH_SANDBOX=1
      shift
      ;;
    -h|--help)
      cat <<'EOF'
Usage: ./scripts/env/bootstrap.sh [--with-sandbox]

Creates local environment profile files if they are missing:
  backend/.env.development.local
  backend/.env.production.local
  frontend/.env.development.local
  frontend/.env.production.local

Optional:
  --with-sandbox   Also creates:
    backend/.env.development.sandbox.local
    frontend/.env.development.sandbox.local
EOF
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

seed_backend_dev_profile() {
  cp "${BACKEND_ENV_EXAMPLE}" "${BACKEND_ENV_DEV_PROFILE}"
  upsert_env "${BACKEND_ENV_DEV_PROFILE}" "ENVIRONMENT" "local"
  upsert_env "${BACKEND_ENV_DEV_PROFILE}" "DATABASE_URL" "postgresql+asyncpg://postgres:postgres@localhost:5433/adrianaart"
  upsert_env "${BACKEND_ENV_DEV_PROFILE}" "FRONTEND_ORIGIN" "http://localhost:4200"
  upsert_env "${BACKEND_ENV_DEV_PROFILE}" "SECURE_COOKIES" "0"
  upsert_env "${BACKEND_ENV_DEV_PROFILE}" "COOKIE_SAMESITE" "lax"
  upsert_env "${BACKEND_ENV_DEV_PROFILE}" "CAPTCHA_ENABLED" "0"
  upsert_env "${BACKEND_ENV_DEV_PROFILE}" "PAYMENTS_PROVIDER" "mock"
  upsert_env "${BACKEND_ENV_DEV_PROFILE}" "STRIPE_ENV" "sandbox"
  upsert_env "${BACKEND_ENV_DEV_PROFILE}" "PAYPAL_ENV" "sandbox"
  upsert_env "${BACKEND_ENV_DEV_PROFILE}" "NETOPIA_ENABLED" "0"
  upsert_env "${BACKEND_ENV_DEV_PROFILE}" "GOOGLE_REDIRECT_URI" "http://localhost:4200/auth/google/callback"
}

seed_frontend_dev_profile() {
  cp "${FRONTEND_ENV_EXAMPLE}" "${FRONTEND_ENV_DEV_PROFILE}"
  upsert_env "${FRONTEND_ENV_DEV_PROFILE}" "APP_ENV" "development"
  upsert_env "${FRONTEND_ENV_DEV_PROFILE}" "API_BASE_URL" "/api/v1"
  upsert_env "${FRONTEND_ENV_DEV_PROFILE}" "CAPTCHA_SITE_KEY" ""
  upsert_env "${FRONTEND_ENV_DEV_PROFILE}" "STRIPE_ENABLED" "1"
  upsert_env "${FRONTEND_ENV_DEV_PROFILE}" "PAYPAL_ENABLED" "1"
  upsert_env "${FRONTEND_ENV_DEV_PROFILE}" "NETOPIA_ENABLED" "1"
}

seed_backend_prod_profile() {
  if [[ -f "${BACKEND_ENV}" ]]; then
    cp "${BACKEND_ENV}" "${BACKEND_ENV_PROD_PROFILE}"
  else
    cp "${BACKEND_ENV_EXAMPLE}" "${BACKEND_ENV_PROD_PROFILE}"
    upsert_env "${BACKEND_ENV_PROD_PROFILE}" "ENVIRONMENT" "production"
    upsert_env "${BACKEND_ENV_PROD_PROFILE}" "SECURE_COOKIES" "1"
    upsert_env "${BACKEND_ENV_PROD_PROFILE}" "FRONTEND_ORIGIN" "https://momentstudio.ro"
  fi
}

seed_frontend_prod_profile() {
  if [[ -f "${FRONTEND_ENV}" ]]; then
    cp "${FRONTEND_ENV}" "${FRONTEND_ENV_PROD_PROFILE}"
  else
    cp "${FRONTEND_ENV_EXAMPLE}" "${FRONTEND_ENV_PROD_PROFILE}"
    upsert_env "${FRONTEND_ENV_PROD_PROFILE}" "APP_ENV" "production"
  fi
}

seed_sandbox_profiles() {
  [[ -f "${BACKEND_ENV_DEV_SANDBOX_PROFILE}" ]] || {
    if [[ -f "${BACKEND_SANDBOX_TEMPLATE}" ]]; then
      cp "${BACKEND_SANDBOX_TEMPLATE}" "${BACKEND_ENV_DEV_SANDBOX_PROFILE}"
    else
      cp "${BACKEND_ENV_DEV_PROFILE}" "${BACKEND_ENV_DEV_SANDBOX_PROFILE}"
      upsert_env "${BACKEND_ENV_DEV_SANDBOX_PROFILE}" "PAYMENTS_PROVIDER" "real"
      upsert_env "${BACKEND_ENV_DEV_SANDBOX_PROFILE}" "STRIPE_ENV" "sandbox"
      upsert_env "${BACKEND_ENV_DEV_SANDBOX_PROFILE}" "PAYPAL_ENV" "sandbox"
      upsert_env "${BACKEND_ENV_DEV_SANDBOX_PROFILE}" "NETOPIA_ENABLED" "0"
    fi
    echo "Created ${BACKEND_ENV_DEV_SANDBOX_PROFILE#${REPO_ROOT}/}"
  }
  [[ -f "${FRONTEND_ENV_DEV_SANDBOX_PROFILE}" ]] || {
    if [[ -f "${FRONTEND_SANDBOX_TEMPLATE}" ]]; then
      cp "${FRONTEND_SANDBOX_TEMPLATE}" "${FRONTEND_ENV_DEV_SANDBOX_PROFILE}"
    else
      cp "${FRONTEND_ENV_DEV_PROFILE}" "${FRONTEND_ENV_DEV_SANDBOX_PROFILE}"
    fi
    echo "Created ${FRONTEND_ENV_DEV_SANDBOX_PROFILE#${REPO_ROOT}/}"
  }
}

if [[ ! -f "${BACKEND_ENV_DEV_PROFILE}" ]]; then
  seed_backend_dev_profile
  echo "Created ${BACKEND_ENV_DEV_PROFILE#${REPO_ROOT}/}"
fi

if [[ ! -f "${FRONTEND_ENV_DEV_PROFILE}" ]]; then
  seed_frontend_dev_profile
  echo "Created ${FRONTEND_ENV_DEV_PROFILE#${REPO_ROOT}/}"
fi

if [[ ! -f "${BACKEND_ENV_PROD_PROFILE}" ]]; then
  seed_backend_prod_profile
  echo "Created ${BACKEND_ENV_PROD_PROFILE#${REPO_ROOT}/}"
fi

if [[ ! -f "${FRONTEND_ENV_PROD_PROFILE}" ]]; then
  seed_frontend_prod_profile
  echo "Created ${FRONTEND_ENV_PROD_PROFILE#${REPO_ROOT}/}"
fi

if [[ "${WITH_SANDBOX}" -eq 1 ]]; then
  seed_sandbox_profiles
fi

echo "Environment profiles are bootstrapped."
