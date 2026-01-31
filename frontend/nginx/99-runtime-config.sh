#!/usr/bin/env sh
set -eu

CONFIG_PATH="/usr/share/nginx/html/assets/app-config.js"

escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

truthy() {
  value="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]' | sed 's/^ *//; s/ *$//')"
  case "$value" in
    1|true|yes|on) echo "true" ;;
    *) echo "false" ;;
  esac
}

API_BASE_URL="${API_BASE_URL:-/api/v1}"
APP_ENV="${APP_ENV:-production}"
APP_VERSION="${APP_VERSION:-}"
STRIPE_ENV_RAW="${STRIPE_ENV:-sandbox}"
STRIPE_ENABLED_RAW="${STRIPE_ENABLED:-}"
STRIPE_PUBLISHABLE_KEY_SANDBOX="${STRIPE_PUBLISHABLE_KEY_SANDBOX:-}"
STRIPE_PUBLISHABLE_KEY_TEST="${STRIPE_PUBLISHABLE_KEY_TEST:-}"
STRIPE_PUBLISHABLE_KEY_LIVE="${STRIPE_PUBLISHABLE_KEY_LIVE:-}"
STRIPE_PUBLISHABLE_KEY="${STRIPE_PUBLISHABLE_KEY:-}"
PAYPAL_ENABLED="${PAYPAL_ENABLED:-}"
NETOPIA_ENABLED="${NETOPIA_ENABLED:-}"
ADDRESS_AUTOCOMPLETE_ENABLED="${ADDRESS_AUTOCOMPLETE_ENABLED:-}"
SENTRY_DSN="${SENTRY_DSN:-}"
CAPTCHA_SITE_KEY="${CAPTCHA_SITE_KEY:-}"

stripe_env="$(printf '%s' "$STRIPE_ENV_RAW" | tr '[:upper:]' '[:lower:]' | sed 's/^ *//; s/ *$//')"
case "$stripe_env" in
  live|prod|production) stripe_mode="live" ;;
  *) stripe_mode="sandbox" ;;
esac

if [ -z "$STRIPE_PUBLISHABLE_KEY" ]; then
  if [ "$stripe_mode" = "live" ]; then
    STRIPE_PUBLISHABLE_KEY="$STRIPE_PUBLISHABLE_KEY_LIVE"
  else
    STRIPE_PUBLISHABLE_KEY="$STRIPE_PUBLISHABLE_KEY_SANDBOX"
    if [ -z "$STRIPE_PUBLISHABLE_KEY" ]; then
      STRIPE_PUBLISHABLE_KEY="$STRIPE_PUBLISHABLE_KEY_TEST"
    fi
  fi
fi

stripe_enabled="true"
if [ -n "${STRIPE_ENABLED_RAW}" ]; then
  stripe_enabled="$(truthy "$STRIPE_ENABLED_RAW")"
fi

mkdir -p "$(dirname "$CONFIG_PATH")"

cat > "$CONFIG_PATH" <<EOF
// Auto-generated at container startup
window.__APP_CONFIG__ = {
  "apiBaseUrl": "$(escape "$API_BASE_URL")",
  "appEnv": "$(escape "$APP_ENV")",
  "appVersion": "$(escape "$APP_VERSION")",
  "stripeEnabled": ${stripe_enabled},
  "stripePublishableKey": "$(escape "$STRIPE_PUBLISHABLE_KEY")",
  "paypalEnabled": $(truthy "$PAYPAL_ENABLED"),
  "netopiaEnabled": $(truthy "$NETOPIA_ENABLED"),
  "addressAutocompleteEnabled": $(truthy "$ADDRESS_AUTOCOMPLETE_ENABLED"),
  "sentryDsn": "$(escape "$SENTRY_DSN")",
  "captchaSiteKey": "$(escape "$CAPTCHA_SITE_KEY")"
};
EOF
