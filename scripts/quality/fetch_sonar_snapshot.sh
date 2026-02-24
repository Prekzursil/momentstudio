#!/usr/bin/env bash
set -euo pipefail

SONAR_TOKEN="${SONAR_TOKEN:-}"
SONAR_HOST="${SONAR_HOST:-https://sonarcloud.io}"
SONAR_PROJECT_KEY="${SONAR_PROJECT_KEY:-Prekzursil_AdrianaArt}"
OUT_DIR="${1:-docs/reports/scanner-baselines/latest}"

if [ -z "$SONAR_TOKEN" ]; then
  echo "SONAR_TOKEN is required" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

summary_file="$OUT_DIR/sonar-unresolved-summary.json"
issues_jsonl="$OUT_DIR/sonar-issues.jsonl"
agg_file="$OUT_DIR/sonar-issues-aggregated.json"

curl -sS -u "$SONAR_TOKEN:" \
  "$SONAR_HOST/api/issues/search?componentKeys=$SONAR_PROJECT_KEY&resolved=false&ps=1&facets=severities,types,statuses,rules" \
  > "$summary_file"

rm -f "$issues_jsonl"
for p in 1 2 3; do
  curl -sS -u "$SONAR_TOKEN:" \
    "$SONAR_HOST/api/issues/search?componentKeys=$SONAR_PROJECT_KEY&resolved=false&ps=500&p=$p" \
    | jq -c '.issues[]' >> "$issues_jsonl"
done

jq -s '{
  total:length,
  by_rule:(group_by(.rule)|map({rule:.[0].rule,count:length})|sort_by(-.count)),
  by_component:(group_by(.component)|map({component:.[0].component,count:length})|sort_by(-.count)),
  by_severity:(group_by(.severity)|map({severity:.[0].severity,count:length})|sort_by(-.count)),
  by_status:(group_by(.status)|map({status:.[0].status,count:length})|sort_by(-.count)),
  by_type:(group_by(.type)|map({type:.[0].type,count:length})|sort_by(-.count))
}' "$issues_jsonl" > "$agg_file"

jq '{total}' "$summary_file"
