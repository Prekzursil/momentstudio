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


def _resolve_repo_path(raw: str, *, must_exist: bool) -> Path:
  value = (raw or "").strip()
  if not value:
    raise SystemExit("path value cannot be empty")

  if os.path.isabs(value):
    raise SystemExit(f"absolute paths are not allowed: {value}")

  repo_root = Path.cwd().resolve()
  candidate = (repo_root / value).resolve()

  try:
    candidate.relative_to(repo_root)
  except ValueError as exc:
    raise SystemExit(f"path escapes repository root: {value}") from exc

  allowed = False
  for root in ALLOWED_RELATIVE_ROOTS:
    allowed_root = (repo_root / root).resolve()
    try:
      candidate.relative_to(allowed_root)
      allowed = True
      break
    except ValueError:
      continue
  if not allowed:
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
  if "missing_h1" in rid:
    return "heading", "Add a unique route H1 and align above-the-fold copy with primary intent."
  if "missing_canonical" in rid:
    return "canonical", "Set canonical URL and language alternates consistent with sitemap policy."
  if "missing_title" in rid:
    return "title", "Add unique title template with primary keyword + brand suffix."
  if "missing_description" in rid:
    return "description", "Add concise meta description with intent + differentiator."
  if "no_meaningful_text" in rid:
    return "thin_content", "Add a meaningful introductory paragraph and internal links."
  if "duplicate_title" in rid:
    return "duplicate_title", "Make title unique by route context (entity + intent)."
  if "duplicate_description" in rid:
    return "duplicate_description", "Make description unique with route-specific summary."
  if "broken_link" in rid:
    return "broken_link", "Fix or remove broken links; replace with canonical destination."
  return "other", "Review route content and metadata for SEO intent clarity."


def build_backlog(findings: list[dict[str, Any]]) -> list[BacklogItem]:
  grouped: dict[tuple[str, str], BacklogItem] = {}
  by_key_evidence: dict[tuple[str, str], list[str]] = defaultdict(list)

  for finding in findings:
    rule_id = str(finding.get("rule_id") or "")
    if not rule_id.startswith("seo."):
      continue
    route = str(finding.get("route") or "").strip() or "/"
    severity = str(finding.get("severity") or "s4").lower()
    title = str(finding.get("title") or "SEO issue")
    issue_type, task = _classify_issue_type(rule_id)
    key = (route, issue_type)
    score = SEVERITY_WEIGHT.get(severity, 0)
    evidence_path = str(finding.get("evidence_path") or "").strip()

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
    else:
      if score > existing.score:
        existing.score = score
        existing.severity = severity
        existing.title = title
      else:
        existing.score += max(1, score // 4)

    if evidence_path:
      by_key_evidence[key].append(evidence_path)

  backlog = list(grouped.values())
  for item in backlog:
    item.evidence = sorted(set(by_key_evidence[(item.route, item.issue_type)]))[:5]
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
