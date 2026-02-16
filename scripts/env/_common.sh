#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
BACKEND_DIR="${REPO_ROOT}/backend"
FRONTEND_DIR="${REPO_ROOT}/frontend"

BACKEND_ENV="${BACKEND_DIR}/.env"
FRONTEND_ENV="${FRONTEND_DIR}/.env"
BACKUPS_DIR="${REPO_ROOT}/.env.backups"

BACKEND_ENV_DEV_PROFILE="${BACKEND_DIR}/.env.development.local"
BACKEND_ENV_DEV_SANDBOX_PROFILE="${BACKEND_DIR}/.env.development.sandbox.local"
BACKEND_ENV_PROD_PROFILE="${BACKEND_DIR}/.env.production.local"
FRONTEND_ENV_DEV_PROFILE="${FRONTEND_DIR}/.env.development.local"
FRONTEND_ENV_DEV_SANDBOX_PROFILE="${FRONTEND_DIR}/.env.development.sandbox.local"
FRONTEND_ENV_PROD_PROFILE="${FRONTEND_DIR}/.env.production.local"

BACKEND_ENV_EXAMPLE="${BACKEND_DIR}/.env.example"
FRONTEND_ENV_EXAMPLE="${FRONTEND_DIR}/.env.example"

BACKEND_SANDBOX_TEMPLATE="${REPO_ROOT}/scripts/env/templates/backend.env.development.sandbox.local.example"
FRONTEND_SANDBOX_TEMPLATE="${REPO_ROOT}/scripts/env/templates/frontend.env.development.sandbox.local.example"

lower() {
  printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]'
}

trim() {
  local value
  value="$(printf '%s' "${1:-}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  printf '%s' "${value}"
}

is_truthy() {
  case "$(lower "$(trim "${1:-}")")" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

is_localhost_value() {
  local value
  value="$(lower "$(trim "${1:-}")")"
  [[ -n "${value}" ]] && [[ "${value}" == *"localhost"* || "${value}" == *"127.0.0.1"* ]]
}

env_get() {
  local file="$1"
  local key="$2"
  [[ -f "${file}" ]] || {
    printf ''
    return 0
  }

  awk -v key="${key}" '
    BEGIN { value = "" }
    /^[[:space:]]*#/ { next }
    {
      line = $0
      sub(/\r$/, "", line)
      if (line ~ "^[[:space:]]*" key "=") {
        value = substr(line, index(line, "=") + 1)
      }
    }
    END {
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      if ((value ~ /^".*"$/) || (value ~ /^'\''.*'\''$/)) {
        value = substr(value, 2, length(value) - 2)
      }
      print value
    }
  ' "${file}"
}

upsert_env() {
  local file="$1"
  local key="$2"
  local value="$3"
  local tmp

  [[ -f "${file}" ]] || touch "${file}"
  tmp="${file}.tmp"

  awk -v key="${key}" -v value="${value}" '
    BEGIN { written = 0 }
    {
      line = $0
      if (line ~ "^[[:space:]]*" key "=") {
        if (!written) {
          print key "=" value
          written = 1
        }
        next
      }
      print $0
    }
    END {
      if (!written) {
        print key "=" value
      }
    }
  ' "${file}" > "${tmp}"

  mv "${tmp}" "${file}"
}

current_profile_label() {
  if [[ -f "${BACKEND_ENV_DEV_PROFILE}" && -f "${FRONTEND_ENV_DEV_PROFILE}" ]] \
    && cmp -s "${BACKEND_ENV}" "${BACKEND_ENV_DEV_PROFILE}" \
    && cmp -s "${FRONTEND_ENV}" "${FRONTEND_ENV_DEV_PROFILE}"; then
    printf 'dev'
    return 0
  fi

  if [[ -f "${BACKEND_ENV_DEV_SANDBOX_PROFILE}" && -f "${FRONTEND_ENV_DEV_SANDBOX_PROFILE}" ]] \
    && cmp -s "${BACKEND_ENV}" "${BACKEND_ENV_DEV_SANDBOX_PROFILE}" \
    && cmp -s "${FRONTEND_ENV}" "${FRONTEND_ENV_DEV_SANDBOX_PROFILE}"; then
    printf 'dev-sandbox'
    return 0
  fi

  if [[ -f "${BACKEND_ENV_PROD_PROFILE}" && -f "${FRONTEND_ENV_PROD_PROFILE}" ]] \
    && cmp -s "${BACKEND_ENV}" "${BACKEND_ENV_PROD_PROFILE}" \
    && cmp -s "${FRONTEND_ENV}" "${FRONTEND_ENV_PROD_PROFILE}"; then
    printf 'prod'
    return 0
  fi

  local be_env fe_env
  be_env="$(lower "$(env_get "${BACKEND_ENV}" "ENVIRONMENT")")"
  fe_env="$(lower "$(env_get "${FRONTEND_ENV}" "APP_ENV")")"
  if [[ "${be_env}" == "local" || "${be_env}" == "development" || "${be_env}" == "dev" ]]; then
    if [[ "${fe_env}" == "development" || "${fe_env}" == "local" || "${fe_env}" == "dev" ]]; then
      printf 'custom-dev'
      return 0
    fi
  fi
  if [[ "${be_env}" == "production" || "${be_env}" == "prod" ]] \
    && [[ "${fe_env}" == "production" || "${fe_env}" == "prod" ]]; then
    printf 'custom-prod'
    return 0
  fi
  printf 'mixed'
}

ensure_backups_dir() {
  mkdir -p "${BACKUPS_DIR}"
}
