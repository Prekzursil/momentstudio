#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "ERROR: Run with sudo: sudo $0" >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
service_path="/etc/systemd/system/momentstudio-backup.service"
timer_path="/etc/systemd/system/momentstudio-backup.timer"

cat >"${service_path}" <<EOF
[Unit]
Description=momentstudio backup (DB + media)
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
Description=Run momentstudio backups daily

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

systemctl daemon-reload
systemctl enable --now momentstudio-backup.timer

echo
echo "Timer status:"
systemctl status momentstudio-backup.timer --no-pager

echo
echo "Tip: view backup logs with:"
echo "  journalctl -u momentstudio-backup.service -n 200 --no-pager"

