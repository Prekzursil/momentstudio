#!/usr/bin/env bash
set -euo pipefail

SONAR_TOKEN="${SONAR_TOKEN:-}"
SONAR_HOST="${SONAR_HOST:-${SONAR_HOST_URL:-https://sonarcloud.io}}"
SONAR_PROJECT_KEY="${SONAR_PROJECT_KEY:-Prekzursil_AdrianaArt}"
SONAR_BRANCH_NAME="${1:-${SONAR_BRANCH_NAME:-${GITHUB_HEAD_REF:-${GITHUB_REF_NAME:-}}}}"
OUT_DIR="${2:-artifacts/scanner-gate/sonar-branch-zero}"

if [[ -z "$SONAR_TOKEN" ]]; then
  echo "SONAR_TOKEN is required" >&2
  exit 1
fi

if [[ -z "$SONAR_BRANCH_NAME" ]]; then
  echo "Sonar branch name is required (arg1 or SONAR_BRANCH_NAME/GITHUB_HEAD_REF/GITHUB_REF_NAME)." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

summary_file="$OUT_DIR/sonar-unresolved-summary.json"
issues_file="$OUT_DIR/sonar-unresolved-issues.json"
digest_file="$OUT_DIR/sonar-branch-digest.json"

curl -sS --fail-with-body -u "$SONAR_TOKEN:" --get "$SONAR_HOST/api/issues/search" \
  --data-urlencode "componentKeys=$SONAR_PROJECT_KEY" \
  --data-urlencode "resolved=false" \
  --data-urlencode "branch=$SONAR_BRANCH_NAME" \
  --data-urlencode "ps=500" \
  --data-urlencode "p=1" \
  --data-urlencode "facets=severities,types,statuses,rules" \
  > "$summary_file"

jq '.issues' "$summary_file" > "$issues_file"

unresolved_total="$(jq -r '.total // 0' "$summary_file")"

jq -n \
  --arg branch "$SONAR_BRANCH_NAME" \
  --arg component "$SONAR_PROJECT_KEY" \
  --arg host "$SONAR_HOST" \
  --argjson unresolved "$unresolved_total" \
  '{
    branch:$branch,
    component:$component,
    host:$host,
    unresolved:$unresolved,
    gate:(if $unresolved == 0 then "pass" else "fail" end)
  }' > "$digest_file"

cat "$digest_file"

if [[ "$unresolved_total" -gt 0 ]]; then
  echo "Sonar branch unresolved issues is $unresolved_total (expected 0)." >&2
  exit 1
fi

echo "Sonar branch unresolved issues is zero for branch '$SONAR_BRANCH_NAME'."
