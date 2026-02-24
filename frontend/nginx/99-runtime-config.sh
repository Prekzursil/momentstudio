#!/usr/bin/env sh
set -eu

CONFIG_PATH="${CONFIG_PATH:-/usr/share/nginx/html/assets/app-config.js}"

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
FRONTEND_CLARITY_PROJECT_ID="${FRONTEND_CLARITY_PROJECT_ID:-}"
CLARITY_ENABLED="${CLARITY_ENABLED:-}"
SENTRY_ENABLED="${SENTRY_ENABLED:-1}"
SENTRY_DSN="${SENTRY_DSN:-}"
SENTRY_SEND_DEFAULT_PII="${SENTRY_SEND_DEFAULT_PII:-1}"
SENTRY_TRACES_SAMPLE_RATE="${SENTRY_TRACES_SAMPLE_RATE:-1.0}"
SENTRY_REPLAY_SESSION_SAMPLE_RATE="${SENTRY_REPLAY_SESSION_SAMPLE_RATE:-0.25}"
SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE="${SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE:-1.0}"
CAPTCHA_SITE_KEY="${CAPTCHA_SITE_KEY:-}"
SITE_NAME="${SITE_NAME:-momentstudio}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://momentstudio.ro}"
SUPPORT_EMAIL="${SUPPORT_EMAIL:-momentstudio.ro@gmail.com}"
DEFAULT_LOCALE="${DEFAULT_LOCALE:-en}"
SUPPORTED_LOCALES="${SUPPORTED_LOCALES:-en,ro}"

stripe_enabled="$(truthy "$STRIPE_ENABLED_RAW")"

clarity_enabled="false"
trimmed_clarity_enabled="$(printf '%s' "$CLARITY_ENABLED" | sed 's/^ *//; s/ *$//')"
trimmed_clarity_project_id="$(printf '%s' "$FRONTEND_CLARITY_PROJECT_ID" | sed 's/^ *//; s/ *$//')"
if [ -n "$trimmed_clarity_enabled" ]; then
  clarity_enabled="$(truthy "$trimmed_clarity_enabled")"
elif [ -n "$trimmed_clarity_project_id" ]; then
  clarity_enabled="true"
fi

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
  "clarityProjectId": "$(escape "$FRONTEND_CLARITY_PROJECT_ID")",
  "clarityEnabled": ${clarity_enabled},
  "sentryEnabled": $(truthy "$SENTRY_ENABLED"),
  "sentryDsn": "$(escape "$SENTRY_DSN")",
  "sentrySendDefaultPii": $(truthy "$SENTRY_SEND_DEFAULT_PII"),
  "sentryTracesSampleRate": $(decimal_or_default "$SENTRY_TRACES_SAMPLE_RATE" "1.0"),
  "sentryReplaySessionSampleRate": $(decimal_or_default "$SENTRY_REPLAY_SESSION_SAMPLE_RATE" "0.25"),
  "sentryReplayOnErrorSampleRate": $(decimal_or_default "$SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE" "1.0"),
  "captchaSiteKey": "$(escape "$CAPTCHA_SITE_KEY")",
  "siteName": "$(escape "$SITE_NAME")",
  "publicBaseUrl": "$(escape "$PUBLIC_BASE_URL")",
  "supportEmail": "$(escape "$SUPPORT_EMAIL")",
  "defaultLocale": "$(escape "$DEFAULT_LOCALE")",
  "supportedLocales": [$(printf '%s' "$SUPPORTED_LOCALES" | awk -F',' '{for (i=1;i<=NF;i++){gsub(/^ +| +$/,"",$i); if(length($i)){printf "%s\"%s\"", (count++?",":""), $i}}}') ]
};
EOF
