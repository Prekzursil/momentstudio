#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/env/_common.sh
source "${SCRIPT_DIR}/_common.sh"

if [[ ! -f "${BACKEND_ENV}" || ! -f "${FRONTEND_ENV}" ]]; then
  echo "Missing backend/.env or frontend/.env."
  echo "Run: ./scripts/env/bootstrap.sh && ./scripts/env/switch.sh dev"
  exit 1
fi

backend_environment="$(env_get "${BACKEND_ENV}" "ENVIRONMENT")"
frontend_environment="$(env_get "${FRONTEND_ENV}" "APP_ENV")"
database_url="$(env_get "${BACKEND_ENV}" "DATABASE_URL")"
frontend_origin="$(env_get "${BACKEND_ENV}" "FRONTEND_ORIGIN")"
secure_cookies="$(env_get "${BACKEND_ENV}" "SECURE_COOKIES")"
captcha_enabled="$(env_get "${BACKEND_ENV}" "CAPTCHA_ENABLED")"
payments_provider="$(env_get "${BACKEND_ENV}" "PAYMENTS_PROVIDER")"
stripe_env="$(env_get "${BACKEND_ENV}" "STRIPE_ENV")"
paypal_env="$(env_get "${BACKEND_ENV}" "PAYPAL_ENV")"
netopia_enabled="$(env_get "${BACKEND_ENV}" "NETOPIA_ENABLED")"
frontend_captcha_key="$(env_get "${FRONTEND_ENV}" "CAPTCHA_SITE_KEY")"

if [[ "${database_url}" == *"://"* ]]; then
  db_kind="${database_url%%://*}"
else
  db_kind="unknown"
fi

if is_truthy "${secure_cookies}"; then
  secure_label="on"
else
  secure_label="off"
fi

if is_truthy "${captcha_enabled}"; then
  captcha_label="on"
else
  captcha_label="off"
fi

if [[ -n "$(trim "${frontend_captcha_key}")" ]]; then
  frontend_captcha_label="set"
else
  frontend_captcha_label="empty"
fi

cat <<EOF
Active profile: $(current_profile_label)
Backend ENVIRONMENT: ${backend_environment:-<unset>}
Frontend APP_ENV: ${frontend_environment:-<unset>}
Database URL kind: ${db_kind}
Frontend origin: ${frontend_origin:-<unset>}
Secure cookies: ${secure_label}
Backend CAPTCHA: ${captcha_label}
Frontend CAPTCHA site key: ${frontend_captcha_label}
Payments provider: ${payments_provider:-<unset>}
Stripe env: ${stripe_env:-<unset>}
PayPal env: ${paypal_env:-<unset>}
Netopia enabled: ${netopia_enabled:-<unset>}
EOF
