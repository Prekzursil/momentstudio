#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="${1:-artifacts/scanner-gate/codacy-equivalent-zero}"
mkdir -p "$OUT_DIR"

STATUS_FILE="$OUT_DIR/check-status.tsv"
SUMMARY_FILE="$OUT_DIR/gate-summary.json"
RUN_LOG="$OUT_DIR/gate-run.log"
: > "$STATUS_FILE"
: > "$RUN_LOG"

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Required command not found: $cmd" >&2
    exit 1
  fi
  return 0
}

run_check() {
  local name="$1"
  local command_str="$2"
  local log_file="$OUT_DIR/${name}.log"

  echo "[$name] $command_str" | tee -a "$RUN_LOG"

  set +e
  bash -lc "$command_str" >"$log_file" 2>&1
  local rc=$?
  set -e

  printf '%s\t%s\n' "$name" "$rc" >> "$STATUS_FILE"

  if [[ "$rc" -eq 0 ]]; then
    echo "[$name] PASS" | tee -a "$RUN_LOG"
  else
    echo "[$name] FAIL (exit $rc, see $log_file)" | tee -a "$RUN_LOG"
  fi
  return 0
}

require_cmd jq
require_cmd lizard
require_cmd markdownlint-cli2
require_cmd npx
require_cmd stylelint
require_cmd bandit
require_cmd checkov
require_cmd semgrep

STYLELINT_CONFIG="$OUT_DIR/stylelint.config.json"
cat > "$STYLELINT_CONFIG" <<'STYLELINT_JSON'
{
  "rules": {
    "block-no-empty": true,
    "color-no-invalid-hex": true,
    "declaration-block-no-duplicate-properties": true,
    "declaration-block-no-shorthand-property-overrides": true
  }
}
STYLELINT_JSON

SEMGREP_RULES="$OUT_DIR/semgrep-targeted-rules.yml"
cat > "$SEMGREP_RULES" <<'SEMGREP_YAML'
rules:
  - id: python-subprocess-shell-true
    message: Avoid subprocess calls with shell=True.
    severity: ERROR
    languages: [python]
    pattern-either:
      - pattern: subprocess.$FUNC(..., shell=True, ...)
      - pattern: $FUNC(..., shell=True, ...)

  - id: python-bare-except-pass
    message: Avoid bare except with pass.
    severity: ERROR
    languages: [python]
    pattern: |
      try:
        ...
      except:
        pass

  - id: js-ts-eval-use
    message: Avoid eval().
    severity: ERROR
    languages: [javascript, typescript]
    pattern: eval(...)
SEMGREP_YAML

run_check "lizard-ccn-nloc" "lizard -w -C 8 -L 50 backend/app frontend/src scripts infra"
run_check "markdownlint" "markdownlint-cli2 '**/*.md' '#**/node_modules/**'"
run_check "eslint" "cd frontend && npx eslint ."
run_check "prettier" "cd frontend && npx prettier --check ."
run_check "stylelint" "stylelint --allow-empty-input --config '$STYLELINT_CONFIG' 'frontend/src/**/*.{css,scss,sass}'"
run_check "bandit-b110" "bandit -r backend -t B110 -f json -o '$OUT_DIR/bandit-B110.json'"
run_check "checkov-ckv-gha-7" "checkov -d .github/workflows --check CKV_GHA_7 --quiet --output json > '$OUT_DIR/checkov-CKV_GHA_7.json'"
run_check "semgrep-targeted" "semgrep --config '$SEMGREP_RULES' --error --json --output '$OUT_DIR/semgrep-targeted.json' backend frontend scripts .github"

CHECKS_JSON="$OUT_DIR/check-status.json"
awk -F '\t' '
  BEGIN { print "[" }
  {
    status = ($2 == 0) ? "pass" : "fail"
    printf "%s{\"check\":\"%s\",\"exit_code\":%s,\"status\":\"%s\"}", (NR > 1 ? "," : ""), $1, $2, status
  }
  END { print "]" }
' "$STATUS_FILE" > "$CHECKS_JSON"

failed_count="$(awk -F '\t' '$2 != 0 { count++ } END { print count + 0 }' "$STATUS_FILE")"

jq -n \
  --argjson failed "$failed_count" \
  --slurpfile checks "$CHECKS_JSON" \
  '{
    gate:(if $failed == 0 then "pass" else "fail" end),
    failed_checks:$failed,
    total_checks:($checks[0] | length),
    checks:$checks[0]
  }' > "$SUMMARY_FILE"

cat "$SUMMARY_FILE"

if [[ "$failed_count" -ne 0 ]]; then
  echo "Codacy-equivalent gate failed: $failed_count checks failed." >&2
  exit 1
fi

echo "Codacy-equivalent gate passed."
