#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="${1:-docs/reports/scanner-baselines/latest}"
mkdir -p "$OUT_DIR"

# SonarCloud leg removed 2026-11-05: the owner uninstalled SonarCloud from the
# org GitHub Apps, so its API answers nothing and its data is dead (the stale
# analyses were purged from code scanning separately).
scripts/quality/fetch_codacy_snapshot.sh "$OUT_DIR"

gh api '/repos/Prekzursil/momentstudio/dependabot/alerts?state=open&per_page=100' > "$OUT_DIR/github-dependabot-open.json"
gh api '/repos/Prekzursil/momentstudio/code-scanning/alerts?state=open&per_page=100' > "$OUT_DIR/github-code-scanning-open.json"

CODACY_TOTAL=$(jq -r '.total' "$OUT_DIR/codacy-issues-aggregated.json")
DEPS_OPEN=$(jq 'length' "$OUT_DIR/github-dependabot-open.json")
CS_OPEN=$(jq 'length' "$OUT_DIR/github-code-scanning-open.json")

jq -n \
  --argjson codacy "$CODACY_TOTAL" \
  --argjson dependabot "$DEPS_OPEN" \
  --argjson codescanning "$CS_OPEN" \
  '{codacy_total:$codacy,github_dependabot_open:$dependabot,github_code_scanning_open:$codescanning}' \
  > "$OUT_DIR/scanner-digest.json"

cat "$OUT_DIR/scanner-digest.json"
