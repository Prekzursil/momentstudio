#!/usr/bin/env bash
set -euo pipefail

SONAR_TOKEN="${SONAR_TOKEN:-}"
SONAR_HOST="${SONAR_HOST:-${SONAR_HOST_URL:-https://sonarcloud.io}}"
SONAR_PROJECT_KEY="${SONAR_PROJECT_KEY:-Prekzursil_AdrianaArt}"
SONAR_BRANCH_NAME="${1:-${SONAR_BRANCH_NAME:-${GITHUB_HEAD_REF:-${GITHUB_REF_NAME:-}}}}"
SONAR_PULL_REQUEST_KEY="${SONAR_PULL_REQUEST_KEY:-}"
SONAR_EXPECTED_SHA="${SONAR_EXPECTED_SHA:-}"
SONAR_WAIT_SECONDS="${SONAR_WAIT_SECONDS:-300}"
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

if [[ -n "$SONAR_PULL_REQUEST_KEY" && -n "$SONAR_EXPECTED_SHA" ]]; then
  wait_until=$((SECONDS + SONAR_WAIT_SECONDS))
  expected_sha_lower="${SONAR_EXPECTED_SHA,,}"
  while true; do
    pr_payload="$(curl -sS --fail-with-body -u "$SONAR_TOKEN:" --get \
      "$SONAR_HOST/api/project_pull_requests/list" \
      --data-urlencode "project=$SONAR_PROJECT_KEY")"
    analyzed_sha="$(
      jq -r --arg pr "$SONAR_PULL_REQUEST_KEY" \
        '.pullRequests[] | select(.key == $pr) | .commit.sha // empty' <<<"$pr_payload"
    )"
    if [[ -n "$analyzed_sha" && "${analyzed_sha,,}" == "$expected_sha_lower" ]]; then
      echo "Sonar analysis is up to date for PR '$SONAR_PULL_REQUEST_KEY' at commit '$analyzed_sha'."
      break
    fi
    if (( SECONDS >= wait_until )); then
      echo "Timed out waiting for Sonar analysis of PR '$SONAR_PULL_REQUEST_KEY' to reach '$SONAR_EXPECTED_SHA' (latest '$analyzed_sha')." >&2
      exit 1
    fi
    echo "Waiting for Sonar analysis to reach commit '$SONAR_EXPECTED_SHA' (latest '$analyzed_sha')."
    sleep 10
  done
fi

query_args=(
  --data-urlencode "componentKeys=$SONAR_PROJECT_KEY"
  --data-urlencode "resolved=false"
  --data-urlencode "ps=500"
  --data-urlencode "p=1"
  --data-urlencode "facets=severities,types,statuses,rules"
)

if [[ -n "$SONAR_PULL_REQUEST_KEY" ]]; then
  query_args+=(--data-urlencode "pullRequest=$SONAR_PULL_REQUEST_KEY")
else
  query_args+=(--data-urlencode "branch=$SONAR_BRANCH_NAME")
fi

curl -sS --fail-with-body -u "$SONAR_TOKEN:" --get "$SONAR_HOST/api/issues/search" \
  "${query_args[@]}" \
  > "$summary_file"

jq '.issues' "$summary_file" > "$issues_file"

unresolved_total="$(jq -r '.total // 0' "$summary_file")"

jq -n \
  --arg branch "$SONAR_BRANCH_NAME" \
  --arg pull_request "$SONAR_PULL_REQUEST_KEY" \
  --arg component "$SONAR_PROJECT_KEY" \
  --arg host "$SONAR_HOST" \
  --argjson unresolved "$unresolved_total" \
  '{
    branch:$branch,
    pull_request:$pull_request,
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
