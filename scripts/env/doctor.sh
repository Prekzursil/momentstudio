#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/env/_common.sh
source "${SCRIPT_DIR}/_common.sh"

REQUIRE_DEV=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --require-dev)
      REQUIRE_DEV=1
      shift
      ;;
    -h|--help)
      cat <<'EOF'
Usage: ./scripts/env/doctor.sh [--require-dev]

Checks backend/.env + frontend/.env coherence and prints warnings/errors.

Options:
  --require-dev   Treat non-development setup as an error (used by start.sh).
EOF
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ ! -f "${BACKEND_ENV}" || ! -f "${FRONTEND_ENV}" ]]; then
  echo "ERROR: backend/.env and frontend/.env must both exist." >&2
  echo "Run: ./scripts/env/bootstrap.sh && ./scripts/env/switch.sh dev" >&2
  exit 1
fi

errors=()
warnings=()

backend_environment="$(lower "$(env_get "${BACKEND_ENV}" "ENVIRONMENT")")"
frontend_environment="$(lower "$(env_get "${FRONTEND_ENV}" "APP_ENV")")"
frontend_origin="$(env_get "${BACKEND_ENV}" "FRONTEND_ORIGIN")"
secure_cookies="$(env_get "${BACKEND_ENV}" "SECURE_COOKIES")"
captcha_enabled="$(env_get "${BACKEND_ENV}" "CAPTCHA_ENABLED")"
database_url="$(env_get "${BACKEND_ENV}" "DATABASE_URL")"
payments_provider="$(lower "$(env_get "${BACKEND_ENV}" "PAYMENTS_PROVIDER")")"
secret_key="$(env_get "${BACKEND_ENV}" "SECRET_KEY")"
stripe_live_key="$(env_get "${BACKEND_ENV}" "STRIPE_SECRET_KEY_LIVE")"
paypal_live_id="$(env_get "${BACKEND_ENV}" "PAYPAL_CLIENT_ID_LIVE")"
frontend_captcha_site_key="$(env_get "${FRONTEND_ENV}" "CAPTCHA_SITE_KEY")"
lockers_overpass_fallback="$(env_get "${BACKEND_ENV}" "LOCKERS_USE_OVERPASS_FALLBACK")"
sameday_mirror_enabled="$(env_get "${BACKEND_ENV}" "SAMEDAY_MIRROR_ENABLED")"
sameday_api_base_url="$(env_get "${BACKEND_ENV}" "SAMEDAY_API_BASE_URL")"
sameday_api_username="$(env_get "${BACKEND_ENV}" "SAMEDAY_API_USERNAME")"
sameday_api_password="$(env_get "${BACKEND_ENV}" "SAMEDAY_API_PASSWORD")"
fan_api_username="$(env_get "${BACKEND_ENV}" "FAN_API_USERNAME")"
fan_api_password="$(env_get "${BACKEND_ENV}" "FAN_API_PASSWORD")"

backend_is_dev=0
backend_is_prod=0
frontend_is_dev=0
frontend_is_prod=0

case "${backend_environment}" in
  local|development|dev) backend_is_dev=1 ;;
  production|prod) backend_is_prod=1 ;;
esac

case "${frontend_environment}" in
  local|development|dev) frontend_is_dev=1 ;;
  production|prod) frontend_is_prod=1 ;;
esac

if [[ "${backend_is_prod}" -eq 1 ]]; then
  if is_localhost_value "${frontend_origin}"; then
    errors+=("Backend ENVIRONMENT=production but FRONTEND_ORIGIN points to localhost.")
  fi
  if ! is_truthy "${secure_cookies}"; then
    errors+=("Backend ENVIRONMENT=production but SECURE_COOKIES is not enabled.")
  fi
  if [[ -z "$(trim "${secret_key}")" ]]; then
    warnings+=("SECRET_KEY is empty in production mode.")
  fi
  if [[ -z "$(trim "${stripe_live_key}")" ]]; then
    warnings+=("STRIPE_SECRET_KEY_LIVE is empty in production mode.")
  fi
  if [[ -z "$(trim "${paypal_live_id}")" ]]; then
    warnings+=("PAYPAL_CLIENT_ID_LIVE is empty in production mode.")
  fi
fi

if [[ "${frontend_is_prod}" -eq 1 && "${backend_is_prod}" -ne 1 ]]; then
  warnings+=("Frontend APP_ENV=production while backend ENVIRONMENT is not production.")
fi

if [[ "${backend_is_prod}" -eq 1 && "${frontend_is_prod}" -ne 1 ]]; then
  warnings+=("Backend ENVIRONMENT=production while frontend APP_ENV is not production.")
fi

if [[ "${database_url}" == sqlite* ]]; then
  warnings+=("DATABASE_URL uses sqlite; this may recreate adrianaart.db when Postgres is expected.")
fi

if [[ "${payments_provider}" == "mock" && "${backend_is_prod}" -eq 1 ]]; then
  errors+=("PAYMENTS_PROVIDER=mock must not be used in production mode.")
fi

if [[ "${backend_is_dev}" -eq 1 ]] && is_truthy "${secure_cookies}"; then
  warnings+=("SECURE_COOKIES is enabled in dev mode; login cookies may fail on http://localhost.")
fi

if [[ "${backend_is_dev}" -eq 1 ]] && is_truthy "${captcha_enabled}"; then
  warnings+=("CAPTCHA_ENABLED is on in dev mode; local login/register may be blocked without valid Turnstile setup.")
fi

if [[ "${frontend_is_dev}" -eq 1 && -n "$(trim "${frontend_captcha_site_key}")" ]]; then
  warnings+=("Frontend CAPTCHA_SITE_KEY is set in dev mode; ensure localhost is allowed in Turnstile widget settings.")
fi

if [[ "${backend_is_dev}" -eq 1 ]]; then
  if ! is_truthy "${lockers_overpass_fallback}" \
    && [[ -z "$(trim "${fan_api_username}")" || -z "$(trim "${fan_api_password}")" ]]; then
    warnings+=("FAN lockers will fail in dev (LOCKERS_USE_OVERPASS_FALLBACK=0 and FAN API credentials are empty).")
  fi
  if is_truthy "${sameday_mirror_enabled}" \
    && [[ -z "$(trim "${sameday_api_base_url}")" || -z "$(trim "${sameday_api_username}")" || -z "$(trim "${sameday_api_password}")" ]] \
    && ! is_truthy "${lockers_overpass_fallback}"; then
    warnings+=("Sameday lockers are likely unavailable in dev (mirror enabled without snapshot/credentials and no Overpass fallback).")
  fi
fi

if [[ "${REQUIRE_DEV}" -eq 1 ]]; then
  if [[ "${backend_is_dev}" -ne 1 ]]; then
    errors+=("Expected backend development profile, got ENVIRONMENT=${backend_environment:-<unset>}.")
  fi
  if [[ "${frontend_is_dev}" -ne 1 ]]; then
    errors+=("Expected frontend development profile, got APP_ENV=${frontend_environment:-<unset>}.")
  fi
  if is_truthy "${secure_cookies}"; then
    errors+=("SECURE_COOKIES must be disabled for local dev startup.")
  fi
  if ! is_localhost_value "${frontend_origin}"; then
    errors+=("FRONTEND_ORIGIN must target localhost for local dev startup.")
  fi
fi

printf 'Profile check: %s\n' "$(current_profile_label)"
printf 'Backend ENVIRONMENT=%s\n' "${backend_environment:-<unset>}"
printf 'Frontend APP_ENV=%s\n' "${frontend_environment:-<unset>}"

if [[ ${#warnings[@]} -gt 0 ]]; then
  echo "Warnings:"
  for item in "${warnings[@]}"; do
    echo "- ${item}"
  done
fi

if [[ ${#errors[@]} -gt 0 ]]; then
  echo "Errors:"
  for item in "${errors[@]}"; do
    echo "- ${item}"
  done
  exit 1
fi

echo "Environment doctor: OK"
