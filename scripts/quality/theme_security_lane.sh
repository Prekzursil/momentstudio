#!/usr/bin/env bash
# WU13 theme security lane — the black-box adversarial regression net over the
# theme gate / SSR-sink revalidator / authz (the 6-bypass saga). Wire this as a
# named lane under the existing quality gate's test stage (gate 3) so any
# sink/authz regression fails the build.
#
# It is a strict subset of the full backend suite (fast; no external services),
# runnable on its own for a quick security-only signal. The full 100%-coverage
# gate still runs `pytest` over the whole tree separately.
set -euo pipefail

cd "$(dirname "$0")/../.."

# Consume the WU2-owned corpus in place; the tests resolve it at repo root.
exec python -m pytest backend/tests/security -q "$@"
