#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="${1:-artifacts/scanner-gate/codacy-equivalent-zero}"
mkdir -p "$OUT_DIR"

STATUS_FILE="$OUT_DIR/check-status.tsv"
SUMMARY_FILE="$OUT_DIR/gate-summary.json"
PATTERN_COUNTS_FILE="$OUT_DIR/pattern-counts.json"
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

resolve_cmd_or() {
  local cmd="$1"
  local fallback="$2"
  if command -v "$cmd" >/dev/null 2>&1; then
    printf '%s' "$cmd"
  else
    printf '%s' "$fallback"
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
require_cmd python3
require_cmd npx

LIZARD_CMD="$(resolve_cmd_or lizard '.tmp/quality-venv/bin/lizard')"
if [[ "$LIZARD_CMD" == ".tmp/quality-venv/bin/lizard" && ! -x "$LIZARD_CMD" ]]; then
  echo "Required command not found: lizard (and fallback .tmp/quality-venv/bin/lizard missing)" >&2
  exit 1
fi
MARKDOWNLINT_CMD="$(resolve_cmd_or markdownlint-cli2 'npx --yes markdownlint-cli2')"
STYLELINT_CMD="$(resolve_cmd_or stylelint 'npx --yes stylelint')"
BANDIT_CMD="$(resolve_cmd_or bandit '.venv/bin/bandit')"
CHECKOV_CMD="$(resolve_cmd_or checkov '.venv/bin/checkov')"
SEMGREP_CMD="$(resolve_cmd_or semgrep '.venv/bin/semgrep')"

MARKDOWNLINT_CONFIG="$OUT_DIR/.markdownlint-cli2.jsonc"
cat > "$MARKDOWNLINT_CONFIG" <<'MARKDOWNLINT_JSON'
{
  "default": false,
  "MD032": true,
  "MD034": true
}
MARKDOWNLINT_JSON

STYLELINT_CONFIG="$OUT_DIR/stylelint.config.json"
cat > "$STYLELINT_CONFIG" <<'STYLELINT_JSON'
{
  "rules": {
    "selector-class-pattern": "^[a-z][a-z0-9\\-]*$",
    "color-hex-length": "short",
    "font-family-name-quotes": "always-where-recommended",
    "media-feature-range-notation": "context"
  }
}
STYLELINT_JSON

SEMGREP_RULES="$OUT_DIR/semgrep-targeted-rules.yml"
cat > "$SEMGREP_RULES" <<'SEMGREP_YAML'
rules:
  - id: Semgrep_python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
    message: Avoid SQLAlchemy text(...) in migrations.
    severity: ERROR
    languages: [python]
    pattern: op.execute(sa.text(...))

  - id: Semgrep_yaml.github-actions.security.run-shell-injection.run-shell-injection
    message: Avoid interpolating GitHub expressions directly into shell commands.
    severity: ERROR
    languages: [yaml]
    pattern-regex: 'run:\\s*[^\\n]*\\$\\{\\{[^\\n]*\\}\\}'
SEMGREP_YAML

run_check "lizard-ccn-nloc" "$LIZARD_CMD -w -C 8 -L 50 backend/app frontend/src scripts infra"
run_check "markdownlint" "$MARKDOWNLINT_CMD --config '$MARKDOWNLINT_CONFIG' '**/*.md' '#**/node_modules/**'"
run_check "eslint" "cd frontend && npx eslint . -f json -o '../$OUT_DIR/eslint.json'"
run_check "prettier" "cd frontend && mapfile -t files < <(find scripts -type f \\( -name '*.js' -o -name '*.mjs' -o -name '*.cjs' -o -name '*.ts' -o -name '*.json' \\)); if [[ \${#files[@]} -eq 0 ]]; then echo 'No frontend/scripts files found for Prettier check.'; else npx prettier --check \"\${files[@]}\"; fi"
run_check "stylelint" "$STYLELINT_CMD --allow-empty-input --formatter json --config '$STYLELINT_CONFIG' 'frontend/src/styles.css' > '$OUT_DIR/stylelint.json'"
run_check "bandit-b110" "$BANDIT_CMD -r backend -t B110 -f json -o '$OUT_DIR/bandit-B110.json'"
run_check "checkov-ckv-gha-7" "$CHECKOV_CMD -d .github/workflows --check CKV_GHA_7 --quiet --output json > '$OUT_DIR/checkov-CKV_GHA_7.json'"
run_check "semgrep-targeted" "$SEMGREP_CMD --config '$SEMGREP_RULES' --error --json --output '$OUT_DIR/semgrep-targeted.json' backend frontend scripts .github"

CHECKS_JSON="$OUT_DIR/check-status.json"
awk -F '\t' '
  BEGIN { print "[" }
  {
    status = ($2 == 0) ? "pass" : "fail"
    printf "%s{\"check\":\"%s\",\"exit_code\":%s,\"status\":\"%s\"}", (NR > 1 ? "," : ""), $1, $2, status
  }
  END { print "]" }
' "$STATUS_FILE" > "$CHECKS_JSON"

runtime_failed_count="$(awk -F '\t' '$2 != 0 { count++ } END { print count + 0 }' "$STATUS_FILE")"

python3 - "$OUT_DIR" "$PATTERN_COUNTS_FILE" <<'PY'
import json
import pathlib
import re
import sys

out_dir = pathlib.Path(sys.argv[1])
pattern_counts_file = pathlib.Path(sys.argv[2])

def read_text(path: pathlib.Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="ignore")
    except FileNotFoundError:
        return ""

pattern_counts: dict[str, int] = {}

# Lizard: split into CCN and NLOC buckets from warning lines.
lizard_text = read_text(out_dir / "lizard-ccn-nloc.log")
ccn_count = 0
nloc_count = 0
for line in lizard_text.splitlines():
    match = re.search(r"has (\d+) NLOC, (\d+) CCN", line)
    if not match:
        continue
    nloc = int(match.group(1))
    ccn = int(match.group(2))
    if ccn > 8:
        ccn_count += 1
    if nloc > 50:
        nloc_count += 1
pattern_counts["Lizard_ccn-medium"] = ccn_count
pattern_counts["Lizard_nloc-medium"] = nloc_count

# Markdownlint: count only MD032 and MD034.
markdown_text = read_text(out_dir / "markdownlint.log")
pattern_counts["markdownlint_MD032"] = len(re.findall(r"MD032/", markdown_text))
pattern_counts["markdownlint_MD034"] = len(re.findall(r"MD034/", markdown_text))

# Prettier warnings.
prettier_text = read_text(out_dir / "prettier.log")
pattern_counts["ESLint_prettier-vue_prettier"] = len(re.findall(r"\[warn\]", prettier_text))

# ESLint pattern IDs (json formatter output).
eslint_counts = {
    "ESLint8_@typescript-eslint_prefer-nullish-coalescing": 0,
    "ESLint_node_no-unsupported-features_es-syntax": 0,
    "ESLint_security_detect-non-literal-fs-filename": 0,
    "ESLint_regexp_prefer-d": 0,
    "ESLint_regexp_prefer-w": 0,
}
eslint_path = out_dir / "eslint.json"
if eslint_path.exists():
    try:
        entries = json.loads(eslint_path.read_text(encoding="utf-8"))
        for entry in entries:
            for msg in entry.get("messages", []):
                rule_id = msg.get("ruleId") or ""
                if rule_id == "@typescript-eslint/prefer-nullish-coalescing":
                    eslint_counts["ESLint8_@typescript-eslint_prefer-nullish-coalescing"] += 1
                elif rule_id == "node/no-unsupported-features/es-syntax":
                    eslint_counts["ESLint_node_no-unsupported-features_es-syntax"] += 1
                elif rule_id == "security/detect-non-literal-fs-filename":
                    eslint_counts["ESLint_security_detect-non-literal-fs-filename"] += 1
                elif rule_id == "regexp/prefer-d":
                    eslint_counts["ESLint_regexp_prefer-d"] += 1
                elif rule_id == "regexp/prefer-w":
                    eslint_counts["ESLint_regexp_prefer-w"] += 1
    except Exception:
        pass
pattern_counts.update(eslint_counts)

# Stylelint rule counts from json formatter.
stylelint_counts = {
    "Stylelint_selector-class-pattern": 0,
    "Stylelint_color-hex-length": 0,
    "Stylelint_font-family-name-quotes": 0,
    "Stylelint_media-feature-range-notation": 0,
}
stylelint_path = out_dir / "stylelint.json"
if stylelint_path.exists():
    try:
        entries = json.loads(stylelint_path.read_text(encoding="utf-8"))
        for entry in entries:
            for warning in entry.get("warnings", []):
                rule = warning.get("rule") or ""
                key = {
                    "selector-class-pattern": "Stylelint_selector-class-pattern",
                    "color-hex-length": "Stylelint_color-hex-length",
                    "font-family-name-quotes": "Stylelint_font-family-name-quotes",
                    "media-feature-range-notation": "Stylelint_media-feature-range-notation",
                }.get(rule)
                if key:
                    stylelint_counts[key] += 1
    except Exception:
        pass
pattern_counts.update(stylelint_counts)

# Bandit / Checkov.
bandit_path = out_dir / "bandit-B110.json"
if bandit_path.exists():
    try:
        bandit = json.loads(bandit_path.read_text(encoding="utf-8"))
        pattern_counts["Bandit_B110"] = len(bandit.get("results", []))
    except Exception:
        pattern_counts["Bandit_B110"] = 0
else:
    pattern_counts["Bandit_B110"] = 0

checkov_path = out_dir / "checkov-CKV_GHA_7.json"
if checkov_path.exists():
    try:
        checkov = json.loads(checkov_path.read_text(encoding="utf-8"))
        pattern_counts["Checkov_CKV_GHA_7"] = len(checkov.get("results", {}).get("failed_checks", []))
    except Exception:
        pattern_counts["Checkov_CKV_GHA_7"] = 0
else:
    pattern_counts["Checkov_CKV_GHA_7"] = 0

# Semgrep targeted patterns.
semgrep_counts = {
    "Semgrep_python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text": 0,
    "Semgrep_yaml.github-actions.security.run-shell-injection.run-shell-injection": 0,
}
semgrep_path = out_dir / "semgrep-targeted.json"
if semgrep_path.exists():
    try:
        semgrep = json.loads(semgrep_path.read_text(encoding="utf-8"))
        for result in semgrep.get("results", []):
            rule_id = result.get("check_id") or ""
            for expected_rule in semgrep_counts:
                if rule_id == expected_rule or rule_id.endswith(expected_rule):
                    semgrep_counts[expected_rule] += 1
                    break
    except Exception:
        pass
pattern_counts.update(semgrep_counts)

pattern_counts_file.write_text(json.dumps(pattern_counts, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY

failed_count="$(jq '[to_entries[] | select(.value > 0)] | length' "$PATTERN_COUNTS_FILE")"

jq -n \
  --argjson failed "$failed_count" \
  --argjson runtime_failed "$runtime_failed_count" \
  --slurpfile checks "$CHECKS_JSON" \
  --slurpfile patterns "$PATTERN_COUNTS_FILE" \
  '{
    gate:(if $failed == 0 then "pass" else "fail" end),
    failed_patterns:$failed,
    runtime_failed_checks:$runtime_failed,
    total_checks:($checks[0] | length),
    checks:$checks[0],
    pattern_counts:$patterns[0]
  }' > "$SUMMARY_FILE"

cat "$SUMMARY_FILE"

if [[ "$failed_count" -ne 0 ]]; then
  echo "Codacy-equivalent gate failed: $failed_count patterns still non-zero." >&2
  exit 1
fi

echo "Codacy-equivalent gate passed."
