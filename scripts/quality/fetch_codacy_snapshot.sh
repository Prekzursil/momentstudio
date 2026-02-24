#!/usr/bin/env bash
set -euo pipefail

CODACY_API_TOKEN="${CODACY_API_TOKEN:-}"
CODACY_PROVIDER="${CODACY_PROVIDER:-gh}"
CODACY_ORG="${CODACY_ORG:-Prekzursil}"
CODACY_REPO="${CODACY_REPO:-AdrianaArt}"
CODACY_HOST="${CODACY_HOST:-https://app.codacy.com}"
OUT_DIR="${1:-docs/reports/scanner-baselines/latest}"

if [[ -z "$CODACY_API_TOKEN" ]]; then
  echo "CODACY_API_TOKEN is required" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

issues_jsonl="$OUT_DIR/codacy-issues.jsonl"
agg_file="$OUT_DIR/codacy-issues-aggregated.json"
base_url="$CODACY_HOST/api/v3/analysis/organizations/$CODACY_PROVIDER/$CODACY_ORG/repositories/$CODACY_REPO/issues/search?limit=100"

rm -f "$issues_jsonl"
cursor=''
for i in $(seq 1 30); do
  if [[ -n "$cursor" ]]; then
    url="$base_url&cursor=$cursor"
  else
    url="$base_url"
  fi

  page_file="$OUT_DIR/codacy-page-$i.json"
  curl -sS -H "api-token: $CODACY_API_TOKEN" -H 'content-type: application/json' -X POST "$url" -d '{}' > "$page_file"

  jq -c '.data[]' "$page_file" >> "$issues_jsonl"

  next_cursor=$(jq -r '.pagination.cursor // empty' "$page_file")
  page_count=$(jq '.data | length' "$page_file")
  if [[ -z "$next_cursor" ]] || [[ "$page_count" -eq 0 ]]; then
    break
  fi
  cursor="$next_cursor"
done

jq -s '{
  total:length,
  by_pattern:(group_by(.patternInfo.id)|map({pattern:.[0].patternInfo.id,count:length})|sort_by(-.count)),
  by_category:(group_by(.patternInfo.category)|map({category:.[0].patternInfo.category,count:length})|sort_by(-.count)),
  by_level:(group_by(.patternInfo.level)|map({level:.[0].patternInfo.level,count:length})|sort_by(-.count)),
  by_file:(group_by(.filePath)|map({file:.[0].filePath,count:length})|sort_by(-.count))
}' "$issues_jsonl" > "$agg_file"

jq '{total}' "$agg_file"
