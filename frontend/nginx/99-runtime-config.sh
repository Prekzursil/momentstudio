#!/usr/bin/env sh
set -eu

CONFIG_PATH="/usr/share/nginx/html/assets/app-config.js"

escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

API_BASE_URL="${API_BASE_URL:-/api/v1}"
APP_ENV="${APP_ENV:-production}"
STRIPE_PUBLISHABLE_KEY="${STRIPE_PUBLISHABLE_KEY:-}"

mkdir -p "$(dirname "$CONFIG_PATH")"

cat > "$CONFIG_PATH" <<EOF
// Auto-generated at container startup
window.__APP_CONFIG__ = {
  "apiBaseUrl": "$(escape "$API_BASE_URL")",
  "appEnv": "$(escape "$APP_ENV")",
  "stripePublishableKey": "$(escape "$STRIPE_PUBLISHABLE_KEY")"
};
EOF

