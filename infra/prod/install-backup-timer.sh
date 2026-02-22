#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "ERROR: Run with sudo: sudo $0" >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
env_file="${repo_root}/infra/prod/.env"

if [[ -f "${env_file}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${env_file}"
  set +a
fi

APP_SLUG="${APP_SLUG:-momentstudio}"
SYSTEMD_SERVICE_PREFIX="${SYSTEMD_SERVICE_PREFIX:-${APP_SLUG}}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-${APP_SLUG}}"
export APP_SLUG SYSTEMD_SERVICE_PREFIX COMPOSE_PROJECT_NAME

service_name="${SYSTEMD_SERVICE_PREFIX}-backup.service"
timer_name="${SYSTEMD_SERVICE_PREFIX}-backup.timer"
service_path="/etc/systemd/system/${service_name}"
timer_path="/etc/systemd/system/${timer_name}"

cat >"${service_path}" <<EOF
[Unit]
Description=${APP_SLUG} backup (DB + media)
Wants=network-online.target
After=network-online.target docker.service
Requires=docker.service

[Service]
Type=oneshot
WorkingDirectory=${repo_root}
ExecStart=${repo_root}/infra/prod/backup.sh
EOF

cat >"${timer_path}" <<EOF
[Unit]
Description=Run ${APP_SLUG} backups daily

[Timer]
OnCalendar=daily
Persistent=true
RandomizedDelaySec=15m

[Install]
WantedBy=timers.target
EOF

echo "Installing systemd units:"
echo "- ${service_path}"
echo "- ${timer_path}"
echo "Using APP_SLUG=${APP_SLUG}, COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME}, SYSTEMD_SERVICE_PREFIX=${SYSTEMD_SERVICE_PREFIX}"

systemctl daemon-reload
systemctl enable --now "${timer_name}"

echo
echo "Timer status:"
systemctl status "${timer_name}" --no-pager

echo
echo "Tip: view backup logs with:"
echo "  journalctl -u ${service_name} -n 200 --no-pager"
