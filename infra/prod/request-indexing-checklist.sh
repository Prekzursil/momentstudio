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

url_encode() {
  python3 - "$1" <<'PY'
import sys
from urllib.parse import quote

print(quote(sys.argv[1], safe=''))
PY
}

if [[ -z "${PUBLIC_DOMAIN:-}" ]]; then
  PUBLIC_DOMAIN="$(read_env_var "PUBLIC_DOMAIN" "${env_file}")"
fi
PUBLIC_DOMAIN="${PUBLIC_DOMAIN:-momentstudio.ro}"
APP_SLUG="${APP_SLUG:-momentstudio}"

verify_base_url="${VERIFY_BASE_URL:-https://${PUBLIC_DOMAIN}}"
verify_base_url="${verify_base_url%/}"

urls=(
  "${verify_base_url}/?lang=en"
  "${verify_base_url}/?lang=ro"
  "${verify_base_url}/shop?lang=en"
  "${verify_base_url}/shop?lang=ro"
  "${verify_base_url}/blog?lang=en"
  "${verify_base_url}/blog?lang=ro"
)

sitemap_xml="$(curl -fsS "${verify_base_url}/sitemap.xml" 2>/dev/null || true)"
product_slug=""
if [[ -n "${sitemap_xml}" ]]; then
  first_match="$(printf '%s' "${sitemap_xml}" | tr '\n' ' ' | grep -oE 'https?://[^< ]+/products/[^?<\" ]+|/products/[^?<\" ]+' | head -n 1 || true)"
  if [[ -n "${first_match}" ]]; then
    first_path="$(printf '%s' "${first_match}" | sed -E 's#https?://[^/]+##')"
    first_path="${first_path%/}"
    if [[ "${first_path}" == /products/* ]]; then
      product_slug="${first_path#/products/}"
      product_slug="${product_slug%%/*}"
    fi
  fi
fi

if [[ -n "${product_slug}" ]]; then
  urls+=("${verify_base_url}/products/${product_slug}?lang=en")
  urls+=("${verify_base_url}/products/${product_slug}?lang=ro")
fi

echo "Search Console post-deploy indexing checklist (${APP_SLUG})"
echo "Property: ${PUBLIC_DOMAIN}"
echo "Base URL: ${verify_base_url}"
echo

if [[ -z "${sitemap_xml}" ]]; then
  echo "Warning: could not fetch ${verify_base_url}/sitemap.xml."
  echo "Continue with the URLs below and add one live product URL manually."
  echo
elif [[ -z "${product_slug}" ]]; then
  echo "Warning: sitemap was fetched but no /products/<slug> URL was detected."
  echo "Add one representative published product URL manually."
  echo
fi

echo "Checklist:"
echo "1. Open Search Console for this property."
echo "2. For each URL below, run URL Inspection, click Test Live URL, then click Request Indexing."
echo "3. Confirm the inspected URL canonical matches the page canonical."
echo "4. Record completion in deploy notes (date + operator + any rejected URLs)."
echo

echo "URLs to request:"
for url in "${urls[@]}"; do
  encoded_url="$(url_encode "${url}")"
  inspect_link="https://search.google.com/search-console/inspect?resource_id=sc-domain:${PUBLIC_DOMAIN}&inspection_url=${encoded_url}"
  echo "- ${url}"
  echo "  Inspect: ${inspect_link}"
done

if [[ -z "${product_slug}" ]]; then
  echo
  echo "Manual product URL placeholder:"
  echo "- ${verify_base_url}/products/<published-product-slug>?lang=en"
  echo "- ${verify_base_url}/products/<published-product-slug>?lang=ro"
fi
