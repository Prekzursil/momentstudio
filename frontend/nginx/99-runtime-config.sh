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

decimal_or_default() {
  value="$(printf '%s' "${1:-}" | sed 's/^ *//; s/ *$//')"
  fallback="${2:-0}"
  if [ -z "$value" ]; then
    printf '%s' "$fallback"
    return
  fi
  if printf '%s' "$value" | grep -Eq '^[0-9]+([.][0-9]+)?$'; then
    printf '%s' "$value"
    return
  fi
  printf '%s' "$fallback"
}

API_BASE_URL="${API_BASE_URL:-/api/v1}"
APP_ENV="${APP_ENV:-production}"
APP_VERSION="${APP_VERSION:-}"
STRIPE_ENABLED_RAW="${STRIPE_ENABLED:-}"
PAYPAL_ENABLED="${PAYPAL_ENABLED:-}"
NETOPIA_ENABLED="${NETOPIA_ENABLED:-}"
ADDRESS_AUTOCOMPLETE_ENABLED="${ADDRESS_AUTOCOMPLETE_ENABLED:-}"
SENTRY_DSN="${SENTRY_DSN:-}"
SENTRY_TRACES_SAMPLE_RATE="${SENTRY_TRACES_SAMPLE_RATE:-0}"
SENTRY_REPLAY_SESSION_SAMPLE_RATE="${SENTRY_REPLAY_SESSION_SAMPLE_RATE:-0}"
SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE="${SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE:-0}"
CAPTCHA_SITE_KEY="${CAPTCHA_SITE_KEY:-}"

stripe_enabled="$(truthy "$STRIPE_ENABLED_RAW")"

mkdir -p "$(dirname "$CONFIG_PATH")"

cat > "$CONFIG_PATH" <<EOF
// Auto-generated at container startup
window.__APP_CONFIG__ = {
  "apiBaseUrl": "$(escape "$API_BASE_URL")",
  "appEnv": "$(escape "$APP_ENV")",
  "appVersion": "$(escape "$APP_VERSION")",
  "stripeEnabled": ${stripe_enabled},
  "paypalEnabled": $(truthy "$PAYPAL_ENABLED"),
  "netopiaEnabled": $(truthy "$NETOPIA_ENABLED"),
  "addressAutocompleteEnabled": $(truthy "$ADDRESS_AUTOCOMPLETE_ENABLED"),
  "sentryDsn": "$(escape "$SENTRY_DSN")",
  "sentryTracesSampleRate": $(decimal_or_default "$SENTRY_TRACES_SAMPLE_RATE" "0"),
  "sentryReplaySessionSampleRate": $(decimal_or_default "$SENTRY_REPLAY_SESSION_SAMPLE_RATE" "0"),
  "sentryReplayOnErrorSampleRate": $(decimal_or_default "$SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE" "0"),
  "captchaSiteKey": "$(escape "$CAPTCHA_SITE_KEY")"
};
EOF
