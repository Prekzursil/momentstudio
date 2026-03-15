#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
import os
from typing import Any


SEVERITY_WEIGHT = {"s1": 100, "s2": 60, "s3": 25, "s4": 10}
ALLOWED_RELATIVE_ROOTS = (
  "artifacts/audit-evidence",
  "docs/reports",
)
ISSUE_TYPE_RULES: tuple[tuple[str, tuple[str, str]], ...] = (
  ("missing_h1", ("heading", "Add a unique route H1 and align above-the-fold copy with primary intent.")),
  ("missing_canonical", ("canonical", "Set canonical URL and language alternates consistent with sitemap policy.")),
  ("missing_title", ("title", "Add unique title template with primary keyword + brand suffix.")),
  ("missing_description", ("description", "Add concise meta description with intent + differentiator.")),
  ("no_meaningful_text", ("thin_content", "Add a meaningful introductory paragraph and internal links.")),
  ("duplicate_title", ("duplicate_title", "Make title unique by route context (entity + intent).")),
  ("duplicate_description", ("duplicate_description", "Make description unique with route-specific summary.")),
  ("broken_link", ("broken_link", "Fix or remove broken links; replace with canonical destination.")),
  ("low_internal_links", ("internal_links", "Add contextual internal links to related indexable routes.")),
  ("canonical_policy_mismatch", ("canonical_policy", "Align canonical policy with sitemap language policy.")),
)
DEFAULT_ISSUE_TYPE = ("other", "Review route content and metadata for SEO intent clarity.")


@dataclass
class BacklogItem:
  route: str
  issue_type: str
  severity: str
  score: int
  title: str
  proposed_task: str
  evidence: list[str]


def _read_json(path: Path) -> Any:
  return json.loads(path.read_text(encoding="utf-8"))


def _is_relative_to(path: Path, root: Path) -> bool:
  try:
    path.relative_to(root)
    return True
  except ValueError:
    return False


def _normalize_relative_path(raw: str) -> str:
  value = (raw or "").strip()
  if not value:
    raise SystemExit("path value cannot be empty")
  if os.path.isabs(value):
    raise SystemExit(f"absolute paths are not allowed: {value}")
  return value


def _resolve_candidate_path(value: str, repo_root: Path) -> Path:
  candidate = (repo_root / value).resolve()
  if not _is_relative_to(candidate, repo_root):
    raise SystemExit(f"path escapes repository root: {value}")
  return candidate


def _is_under_allowed_root(candidate: Path, repo_root: Path) -> bool:
  allowed_roots = ((repo_root / root).resolve() for root in ALLOWED_RELATIVE_ROOTS)
  return any(_is_relative_to(candidate, allowed_root) for allowed_root in allowed_roots)


def _resolve_repo_path(raw: str, *, must_exist: bool) -> Path:
  value = _normalize_relative_path(raw)
  repo_root = Path.cwd().resolve()
  candidate = _resolve_candidate_path(value, repo_root)
  if not _is_under_allowed_root(candidate, repo_root):
    raise SystemExit(
      "path must be under one of: "
      + ", ".join(ALLOWED_RELATIVE_ROOTS)
      + f" (got: {value})"
    )

  if must_exist and not candidate.exists():
    raise SystemExit(f"path does not exist: {value}")
  return candidate


def _classify_issue_type(rule_id: str) -> tuple[str, str]:
  rid = (rule_id or "").lower()
  for marker, result in ISSUE_TYPE_RULES:
    if marker in rid:
      return result
  return DEFAULT_ISSUE_TYPE


def _extract_evidence_paths(finding: dict[str, Any]) -> list[str]:
  evidence_files = finding.get("evidence_files") or []
  return [
    str(path).strip()
    for path in evidence_files
    if str(path).strip()
  ]


def _finding_rule_id(finding: dict[str, Any]) -> str:
  return str(finding.get("rule_id") or "")


def _finding_labels(finding: dict[str, Any]) -> list[str]:
  return [str(label).strip().lower() for label in (finding.get("labels") or [])]


def _is_seo_finding(rule_id: str, labels: list[str]) -> bool:
  if rule_id.startswith("seo_"):
    return True
  return "audit:seo" in labels


def _finding_route(finding: dict[str, Any]) -> str:
  route = str(finding.get("route") or "").strip()
  if route:
    return route
  return "/"


def _finding_severity(finding: dict[str, Any]) -> str:
  return str(finding.get("severity") or "s4").lower()


def _finding_title(finding: dict[str, Any]) -> str:
  return str(finding.get("title") or "SEO issue")


def _parse_finding(
  finding: dict[str, Any],
) -> tuple[str, str, str, int, str, str, list[str]] | None:
  rule_id = _finding_rule_id(finding)
  labels = _finding_labels(finding)
  if not _is_seo_finding(rule_id, labels):
    return None
  if not bool(finding.get("indexable")):
    return None

  route = _finding_route(finding)
  severity = _finding_severity(finding)
  title = _finding_title(finding)
  issue_type, task = _classify_issue_type(rule_id)
  score = SEVERITY_WEIGHT.get(severity, 0)
  return route, issue_type, severity, score, title, task, _extract_evidence_paths(finding)


def _merge_backlog_item(existing: BacklogItem, *, score: int, severity: str, title: str) -> None:
  if score > existing.score:
    existing.score = score
    existing.severity = severity
    existing.title = title
    return
  existing.score += max(1, score // 4)


def _update_grouped_backlog(
  grouped: dict[tuple[str, str], BacklogItem],
  *,
  key: tuple[str, str],
  route: str,
  issue_type: str,
  severity: str,
  score: int,
  title: str,
  task: str,
) -> None:
  existing = grouped.get(key)
  if existing is None:
    grouped[key] = BacklogItem(
      route=route,
      issue_type=issue_type,
      severity=severity,
      score=score,
      title=title,
      proposed_task=task,
      evidence=[],
    )
    return
  _merge_backlog_item(existing, score=score, severity=severity, title=title)


def _attach_evidence(
  backlog: list[BacklogItem],
  by_key_evidence: dict[tuple[str, str], list[str]],
) -> None:
  for item in backlog:
    key = (item.route, item.issue_type)
    item.evidence = sorted(set(by_key_evidence[key]))[:5]


def build_backlog(findings: list[dict[str, Any]]) -> list[BacklogItem]:
  grouped: dict[tuple[str, str], BacklogItem] = {}
  by_key_evidence: dict[tuple[str, str], list[str]] = defaultdict(list)

  for finding in findings:
    parsed = _parse_finding(finding)
    if parsed is None:
      continue
    route, issue_type, severity, score, title, task, evidence_paths = parsed
    key = (route, issue_type)
    _update_grouped_backlog(
      grouped,
      key=key,
      route=route,
      issue_type=issue_type,
      severity=severity,
      score=score,
      title=title,
      task=task,
    )
    for evidence_path in evidence_paths:
      by_key_evidence[key].append(evidence_path)

  backlog = list(grouped.values())
  _attach_evidence(backlog, by_key_evidence)
  backlog.sort(key=lambda i: (-i.score, i.route, i.issue_type))
  return backlog


def write_outputs(backlog: list[BacklogItem], json_out: Path, md_out: Path) -> None:
  json_payload = [
    {
      "route": item.route,
      "issue_type": item.issue_type,
      "severity": item.severity,
      "score": item.score,
      "title": item.title,
      "proposed_task": item.proposed_task,
      "evidence": item.evidence,
    }
    for item in backlog
  ]
  json_out.parent.mkdir(parents=True, exist_ok=True)
  json_out.write_text(json.dumps(json_payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

  lines = [
    "# SEO Content Backlog",
    "",
    f"Total items: **{len(backlog)}**",
    "",
    "| Priority | Route | Issue Type | Severity | Proposed Task |",
    "|---|---|---|---|---|",
  ]
  for idx, item in enumerate(backlog, start=1):
    lines.append(
      f"| {idx} | `{item.route}` | `{item.issue_type}` | `{item.severity}` | {item.proposed_task} |"
    )
  lines.append("")
  lines.append("## Evidence")
  lines.append("")
  for item in backlog:
    if not item.evidence:
      continue
    lines.append(f"- `{item.route}` `{item.issue_type}`:")
    for path in item.evidence:
      lines.append(f"  - `{path}`")

  md_out.parent.mkdir(parents=True, exist_ok=True)
  md_out.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
  parser = argparse.ArgumentParser(description="Generate prioritized SEO content backlog from deterministic findings.")
  parser.add_argument("--findings", required=True, help="Path to deterministic-findings.json")
  parser.add_argument("--json-out", required=True, help="Output JSON path")
  parser.add_argument("--md-out", required=True, help="Output Markdown path")
  args = parser.parse_args()

  findings_path = _resolve_repo_path(args.findings, must_exist=True)
  findings = _read_json(findings_path)
  if not isinstance(findings, list):
    raise SystemExit("findings payload must be a list")

  backlog = build_backlog(findings)
  write_outputs(
    backlog,
    _resolve_repo_path(args.json_out, must_exist=False),
    _resolve_repo_path(args.md_out, must_exist=False),
  )

  print(f"items={len(backlog)}")
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
