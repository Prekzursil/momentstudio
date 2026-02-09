#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
env_file="${repo_root}/infra/prod/.env"

read_env_var() {
  local key="$1"
  local file="$2"
  [[ -f "${file}" ]] || return 0
  local line
  line="$(grep -E "^[[:space:]]*${key}=" "${file}" | tail -n 1 || true)"
  [[ -n "${line}" ]] || return 0
  line="${line#*=}"
  line="${line%\"}"
  line="${line#\"}"
  line="${line%\'}"
  line="${line#\'}"
  printf '%s' "${line}"
}

if [[ -z "${PUBLIC_DOMAIN:-}" ]]; then
  PUBLIC_DOMAIN="$(read_env_var "PUBLIC_DOMAIN" "${env_file}")"
fi
PUBLIC_DOMAIN="${PUBLIC_DOMAIN:-momentstudio.ro}"

verify_base_url="${VERIFY_BASE_URL:-https://${PUBLIC_DOMAIN}}"
expected_manifest_mime="${VERIFY_MANIFEST_MIME:-application/manifest+json}"
expected_app_version="${EXPECTED_APP_VERSION:-}"

failures=0

pass() {
  echo "✅ $1"
}

fail() {
  echo "❌ $1" >&2
  failures=$((failures + 1))
}

check_header_singleton() {
  local header_name="$1"
  local headers_file="$2"
  local count
  count="$(grep -i -c "^${header_name}:" "${headers_file}" || true)"
  if [[ "${count}" -le 1 ]]; then
    pass "Header '${header_name}' appears ${count} time(s)"
  else
    fail "Header '${header_name}' appears ${count} times (expected <= 1)"
  fi
}

echo "Verifying production endpoints at ${verify_base_url}"

if curl -fsS "${verify_base_url}/api/v1/health" >/dev/null; then
  pass "GET /api/v1/health"
else
  fail "GET /api/v1/health failed"
fi

if curl -fsS "${verify_base_url}/api/v1/health/ready" >/dev/null; then
  pass "GET /api/v1/health/ready"
else
  fail "GET /api/v1/health/ready failed"
fi

headers_file="$(mktemp)"
manifest_headers_file="$(mktemp)"
app_config_file="$(mktemp)"
trap 'rm -f "${headers_file}" "${manifest_headers_file}" "${app_config_file}"' EXIT

if curl -fsSI "${verify_base_url}/" >"${headers_file}"; then
  pass "HEAD /"
else
  fail "HEAD / failed"
fi

for header in content-security-policy permissions-policy referrer-policy x-frame-options x-content-type-options; do
  check_header_singleton "${header}" "${headers_file}"
done

if curl -fsSI "${verify_base_url}/manifest.webmanifest" >"${manifest_headers_file}"; then
  pass "HEAD /manifest.webmanifest"
else
  fail "HEAD /manifest.webmanifest failed"
fi

manifest_mime="$(
  awk -F': *' 'tolower($1) == "content-type" { print tolower($2) }' "${manifest_headers_file}" \
    | tr -d '\r' \
    | head -n 1
)"
if [[ "${manifest_mime}" == "${expected_manifest_mime}"* ]]; then
  pass "Manifest content-type is '${manifest_mime}'"
else
  fail "Manifest content-type is '${manifest_mime:-<missing>}' (expected '${expected_manifest_mime}')"
fi

if [[ -n "${expected_app_version}" ]]; then
  if curl -fsS "${verify_base_url}/assets/app-config.js" >"${app_config_file}"; then
    if grep -F "\"appVersion\": \"${expected_app_version}\"" "${app_config_file}" >/dev/null; then
      pass "Frontend appVersion matches expected '${expected_app_version}'"
    else
      fail "Frontend appVersion mismatch (expected '${expected_app_version}')"
    fi
  else
    fail "GET /assets/app-config.js failed"
  fi
fi

if [[ "${failures}" -gt 0 ]]; then
  echo "Verification completed with ${failures} failing check(s)." >&2
  exit 1
fi

echo "All production verification checks passed."
