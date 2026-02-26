#!/usr/bin/env python3
"""Upsert audit findings into severe issues + one rolling digest issue."""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any


SEVERE_LEVELS = {"s1", "s2"}


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _resolve_repo_path(raw: str, *, allowed_prefixes: tuple[str, ...]) -> Path:
    root = _repo_root()
    candidate = (root / raw).resolve()
    try:
        rel = candidate.relative_to(root).as_posix()
    except ValueError as exc:
        raise ValueError(f"Path must stay inside repository: {raw}") from exc
    if not any(rel == prefix or rel.startswith(f"{prefix}/") for prefix in allowed_prefixes):
        raise ValueError(f"Path is outside allowed audit roots: {raw}")
    return candidate


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


@dataclass(frozen=True)
class GitHubContext:
    token: str
    owner: str
    repo: str

    @property
    def api_root(self) -> str:
        return "https://api.github.com"


def _split_repo(full_name: str) -> tuple[str, str]:
    if "/" not in full_name:
        raise ValueError("Repository must be in owner/repo format.")
    owner, repo = full_name.split("/", 1)
    owner = owner.strip()
    repo = repo.strip()
    if not owner or not repo:
        raise ValueError("Repository must be in owner/repo format.")
    return owner, repo


def _github_context(repo_arg: str | None) -> GitHubContext:
    token = (os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN") or "").strip()
    if not token:
        raise RuntimeError("Missing GITHUB_TOKEN/GH_TOKEN.")
    repo_full = (repo_arg or os.environ.get("GITHUB_REPOSITORY") or "").strip()
    if not repo_full:
        raise RuntimeError("Missing --repo and GITHUB_REPOSITORY.")
    owner, repo = _split_repo(repo_full)
    return GitHubContext(token=token, owner=owner, repo=repo)


def _request(ctx: GitHubContext, method: str, path: str, payload: dict[str, Any] | None = None) -> Any:
    url = f"{ctx.api_root}{path}"
    data = None
    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {ctx.token}",
        "User-Agent": "adrianaart-audit-upsert",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url=url, method=method, headers=headers, data=data)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"GitHub API {method} {path} failed: {exc.code} {body}") from exc


def _list_open_issues(ctx: GitHubContext, *, labels: list[str] | None = None) -> list[dict[str, Any]]:
    per_page = 100
    page = 1
    all_issues: list[dict[str, Any]] = []

    while True:
        params = {"state": "open", "per_page": str(per_page), "page": str(page)}
        if labels:
            params["labels"] = ",".join(labels)
        query = urllib.parse.urlencode(params)
        path = f"/repos/{ctx.owner}/{ctx.repo}/issues?{query}"
        page_rows = _request(ctx, "GET", path)
        all_issues.extend(row for row in page_rows if "pull_request" not in row)

        if len(page_rows) < per_page:
            break
        page += 1

    return all_issues


def _extract_fingerprint_marker(body: str) -> str:
    marker_prefix = "<!-- audit:fingerprint:"
    idx = body.find(marker_prefix)
    if idx < 0:
        return ""
    end_idx = body.find("-->", idx)
    if end_idx < 0:
        return ""
    return body[idx + len(marker_prefix) : end_idx].strip()


def _finding_metadata_lines(
    *,
    fingerprint: str,
    title: str,
    route: str,
    surface: str,
    severity: str,
    effort: str,
    impact: Any,
    run_url: str | None,
) -> list[str]:
    lines = [
        f"<!-- audit:fingerprint:{fingerprint} -->",
        "",
        f"## {title}",
        "",
        f"- Severity: `{severity}`",
        f"- Surface: `{surface}`",
        f"- Route: `{route}`",
        f"- Effort: `{effort}`",
        f"- Impact: `{impact}`",
    ]
    if run_url:
        lines.append(f"- Evidence run: {run_url}")
    return lines


def _evidence_file_lines(evidence_files: list[Any]) -> list[str]:
    return [f"- `artifacts/audit-evidence/{item}`" for item in evidence_files]


def _finding_guidance_lines(description: str) -> list[str]:
    return [
        "",
        "### Why this matters",
        "",
        description or "See evidence files for details.",
        "",
        "### Suggested fix",
        "",
        "- Reproduce from the evidence pack route and screenshot.",
        "- Apply focused fix in the owning surface/module.",
        "- Add or update tests to cover this behavior.",
    ]


def _finding_text(finding: dict[str, Any], key: str, default: str) -> str:
    return str(finding.get(key) or default)


def _finding_description(finding: dict[str, Any]) -> str:
    return str(finding.get("description") or "").strip()


def _finding_evidence_files(finding: dict[str, Any]) -> list[Any]:
    return list(finding.get("evidence_files") or [])


def _issue_body_for_finding(finding: dict[str, Any], run_url: str | None) -> str:
    fingerprint = _finding_text(finding, "fingerprint", "")
    title = _finding_text(finding, "title", "Audit finding")
    route = _finding_text(finding, "route", "/")
    surface = _finding_text(finding, "surface", "storefront")
    severity = _finding_text(finding, "severity", "s3")
    effort = _finding_text(finding, "effort", "M")
    impact = finding.get("impact", 1)
    description = _finding_description(finding)
    evidence_files = _finding_evidence_files(finding)

    lines = _finding_metadata_lines(
        fingerprint=fingerprint,
        title=title,
        route=route,
        surface=surface,
        severity=severity,
        effort=effort,
        impact=impact,
        run_url=run_url,
    )
    lines.extend(["", "### Evidence files", ""])
    lines.extend(_evidence_file_lines(evidence_files))
    lines.extend(_finding_guidance_lines(description))
    return "\n".join(lines).strip() + "\n"


def _digest_body(low_findings: list[dict[str, Any]], run_url: str | None) -> str:
    lines = [
        "# Weekly UX/IA Audit Digest",
        "",
        "This issue tracks rolling lower-severity audit findings (`s3/s4`).",
    ]
    if run_url:
        lines.append(f"Latest evidence run: {run_url}")
    lines.extend(["", "## Latest findings", ""])
    if not low_findings:
        lines.append("- No lower-severity findings in this run.")
    else:
        for finding in low_findings:
            lines.extend(
                [
                    f"- [{finding.get('severity','s3')}] {finding.get('title','Audit finding')}",
                    f"  - Route: `{finding.get('route','/')}`",
                    f"  - Surface: `{finding.get('surface','storefront')}`",
                    f"  - Fingerprint: `{finding.get('fingerprint','')}`",
                ]
            )
    return "\n".join(lines).strip() + "\n"


def _safe_create_issue(
    ctx: GitHubContext,
    *,
    title: str,
    body: str,
    labels: list[str],
) -> dict[str, Any]:
    try:
        return _request(
            ctx,
            "POST",
            f"/repos/{ctx.owner}/{ctx.repo}/issues",
            payload={"title": title, "body": body, "labels": labels},
        )
    except RuntimeError as exc:
        # If labels are missing remotely, retry without labels so the workflow still succeeds.
        if "Validation Failed" in str(exc):
            return _request(
                ctx,
                "POST",
                f"/repos/{ctx.owner}/{ctx.repo}/issues",
                payload={"title": title, "body": body},
            )
        raise


def _should_upsert_issue(finding: dict[str, Any], *, include_s3_seo: bool) -> bool:
    severity = str(finding.get("severity") or "").lower()
    if severity in SEVERE_LEVELS:
        return True
    if not include_s3_seo or severity != "s3":
        return False
    labels = [str(label).strip().lower() for label in list(finding.get("labels") or [])]
    is_seo = "audit:seo" in labels
    is_indexable = bool(finding.get("indexable"))
    return is_seo and is_indexable


def _issue_title_for_finding(finding: dict[str, Any]) -> str:
    return (
        f"[Audit][{finding.get('severity','s3').upper()}]"
        f"[{finding.get('surface','storefront')}] {finding.get('title','Audit finding')}"
    )


def _issue_labels_for_finding(finding: dict[str, Any]) -> list[str]:
    return sorted(set(["ai:ready", *list(finding.get("labels") or [])]))


def _issue_row_for_finding(
    issue: dict[str, Any],
    finding: dict[str, Any],
    *,
    fingerprint: str,
    action: str,
) -> dict[str, Any]:
    return {
        "issue_number": int(issue.get("number") or 0),
        "issue_node_id": str(issue.get("node_id") or ""),
        "fingerprint": fingerprint,
        "route": str(finding.get("route") or "/"),
        "surface": str(finding.get("surface") or "storefront"),
        "severity": str(finding.get("severity") or "s2").lower(),
        "action": action,
    }


def _issues_by_fingerprint_marker(open_issues: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    by_marker: dict[str, dict[str, Any]] = {}
    for issue in open_issues:
        body = str(issue.get("body") or "")
        marker = _extract_fingerprint_marker(body)
        if marker:
            by_marker[marker] = issue
    return by_marker


def _iter_upsert_candidates(
    findings: list[dict[str, Any]],
    *,
    include_s3_seo: bool,
) -> list[tuple[dict[str, Any], str]]:
    seen_fingerprints: set[str] = set()
    candidates: list[tuple[dict[str, Any], str]] = []
    for finding in findings:
        if not _should_upsert_issue(finding, include_s3_seo=include_s3_seo):
            continue
        fingerprint = str(finding.get("fingerprint") or "")
        if not fingerprint or fingerprint in seen_fingerprints:
            continue
        seen_fingerprints.add(fingerprint)
        candidates.append((finding, fingerprint))
    return candidates


def _upsert_single_issue(
    ctx: GitHubContext,
    *,
    by_marker: dict[str, dict[str, Any]],
    finding: dict[str, Any],
    fingerprint: str,
    run_url: str | None,
) -> tuple[str, dict[str, Any]]:
    issue_title = _issue_title_for_finding(finding)
    body = _issue_body_for_finding(finding, run_url)
    labels = _issue_labels_for_finding(finding)
    existing = by_marker.get(fingerprint)
    if existing:
        _request(
            ctx,
            "PATCH",
            f"/repos/{ctx.owner}/{ctx.repo}/issues/{existing['number']}",
            payload={"title": issue_title, "body": body, "state": "open"},
        )
        return "updated", existing

    created = _safe_create_issue(ctx, title=issue_title, body=body, labels=labels)
    by_marker[fingerprint] = created
    return "created", created


def _upsert_issues(
    ctx: GitHubContext,
    findings: list[dict[str, Any]],
    run_url: str | None,
    *,
    include_s3_seo: bool,
) -> tuple[int, int, list[dict[str, Any]]]:
    by_marker = _issues_by_fingerprint_marker(_list_open_issues(ctx))

    created_count = 0
    updated_count = 0
    issue_rows: list[dict[str, Any]] = []
    for finding, fingerprint in _iter_upsert_candidates(findings, include_s3_seo=include_s3_seo):
        action, issue = _upsert_single_issue(
            ctx,
            by_marker=by_marker,
            finding=finding,
            fingerprint=fingerprint,
            run_url=run_url,
        )
        if action == "created":
            created_count += 1
        else:
            updated_count += 1
        issue_rows.append(
            _issue_row_for_finding(issue, finding, fingerprint=fingerprint, action=action)
        )

    return created_count, updated_count, issue_rows


def _close_stale_fingerprint_issues(
    ctx: GitHubContext,
    *,
    active_fingerprints: set[str],
    run_url: str | None,
) -> int:
    stale_issues = _iter_stale_fingerprint_issues(ctx, active_fingerprints=active_fingerprints)
    closed_count = 0
    for issue in stale_issues:
        _close_fingerprint_issue(ctx, issue_number=int(issue["number"]), run_url=run_url)
        closed_count += 1
    return closed_count


def _issue_label_names(issue: dict[str, Any]) -> list[str]:
    return [str(row.get("name") or "") for row in issue.get("labels") or []]


def _iter_stale_fingerprint_issues(
    ctx: GitHubContext,
    *,
    active_fingerprints: set[str],
) -> list[dict[str, Any]]:
    stale_issues: list[dict[str, Any]] = []
    for issue in _list_open_issues(ctx):
        marker = _extract_fingerprint_marker(str(issue.get("body") or ""))
        if not marker or marker in active_fingerprints:
            continue
        if "ai:in-progress" in _issue_label_names(issue):
            # Never auto-close issues currently being worked by an agent.
            continue
        stale_issues.append(issue)
    return stale_issues


def _close_fingerprint_issue(ctx: GitHubContext, *, issue_number: int, run_url: str | None) -> None:
    comment = (
        "Automated audit reconciliation closed this issue because its fingerprint "
        "was not present in the latest deterministic evidence pack."
    )
    if run_url:
        comment += f"\n\nEvidence run: {run_url}"
    _request(
        ctx,
        "POST",
        f"/repos/{ctx.owner}/{ctx.repo}/issues/{issue_number}/comments",
        payload={"body": comment},
    )
    _request(
        ctx,
        "PATCH",
        f"/repos/{ctx.owner}/{ctx.repo}/issues/{issue_number}",
        payload={"state": "closed"},
    )


def _upsert_severe(ctx: GitHubContext, findings: list[dict[str, Any]], run_url: str | None) -> list[dict[str, Any]]:
    # Backward-compatible test helper used by existing unit tests.
    return _upsert_issues(ctx, findings, run_url, include_s3_seo=False)[2]


def _upsert_digest(
    ctx: GitHubContext,
    *,
    digest_title: str,
    low_findings: list[dict[str, Any]],
    run_url: str | None,
) -> None:
    open_issues = _list_open_issues(ctx, labels=["audit:ux"])
    digest = next((row for row in open_issues if str(row.get("title") or "").strip() == digest_title), None)
    body = _digest_body(low_findings, run_url)
    if digest:
        _request(
            ctx,
            "PATCH",
            f"/repos/{ctx.owner}/{ctx.repo}/issues/{digest['number']}",
            payload={"body": body, "state": "open"},
        )
        return
    _safe_create_issue(
        ctx,
        title=digest_title,
        body=body,
        labels=["audit:ux", "audit:ia", "ai:ready"],
    )


def _load_findings(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        return []
    return [row for row in payload if isinstance(row, dict)]


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default="", help="Repository in owner/repo format.")
    parser.add_argument("--findings", required=True, help="Path to deterministic-findings.json.")
    parser.add_argument(
        "--digest-title",
        default="Weekly UX/IA Audit Digest",
        help="Title used for the rolling lower-severity digest issue.",
    )
    parser.add_argument(
        "--run-url",
        default="",
        help="Optional workflow run URL for evidence traceability.",
    )
    parser.add_argument(
        "--skip-digest",
        action="store_true",
        help="Only upsert severe findings; do not create/update rolling digest issue.",
    )
    parser.add_argument(
        "--include-s3-seo",
        action="store_true",
        help="Also upsert indexable SEO s3 findings as issues.",
    )
    parser.add_argument(
        "--close-stale",
        action="store_true",
        help="Close open fingerprinted audit issues not present in current upsert candidate set.",
    )
    parser.add_argument(
        "--severe-output",
        default="",
        help="Optional JSON output path for severe issue upsert results.",
    )
    return parser.parse_args()


def _resolve_findings_path(raw: str) -> Path:
    findings_path = _resolve_repo_path(
        raw,
        allowed_prefixes=("artifacts/audit-evidence", "artifacts/audit-evidence-local"),
    )
    if not findings_path.exists():
        raise FileNotFoundError(f"Findings file not found: {findings_path}")
    return findings_path


def _resolve_severe_output_path(raw: str) -> Path | None:
    if not raw:
        return None
    return _resolve_repo_path(
        raw,
        allowed_prefixes=("artifacts/audit-evidence", "artifacts/audit-evidence-local"),
    )


def _finding_fingerprint(finding: dict[str, Any]) -> str:
    return str(finding.get("fingerprint") or "")


def _candidate_fingerprints(
    findings: list[dict[str, Any]],
    *,
    include_s3_seo: bool,
) -> set[str]:
    candidates: set[str] = set()
    for finding in findings:
        if _should_upsert_issue(finding, include_s3_seo=include_s3_seo):
            candidates.add(_finding_fingerprint(finding))
    return candidates


def _findings_matching_fingerprints(
    findings: list[dict[str, Any]],
    fingerprints: set[str],
) -> list[dict[str, Any]]:
    return [finding for finding in findings if _finding_fingerprint(finding) in fingerprints]


def _findings_excluding_fingerprints(
    findings: list[dict[str, Any]],
    fingerprints: set[str],
) -> list[dict[str, Any]]:
    return [finding for finding in findings if _finding_fingerprint(finding) not in fingerprints]


def _partition_findings(
    findings: list[dict[str, Any]],
    *,
    include_s3_seo: bool,
) -> tuple[set[str], list[dict[str, Any]], list[dict[str, Any]]]:
    issue_candidate_fingerprints = _candidate_fingerprints(findings, include_s3_seo=include_s3_seo)
    issue_candidates = _findings_matching_fingerprints(findings, issue_candidate_fingerprints)
    low_findings = _findings_excluding_fingerprints(findings, issue_candidate_fingerprints)
    return issue_candidate_fingerprints, issue_candidates, low_findings


def _load_context_or_skip(repo_arg: str, severe_output_path: Path | None) -> GitHubContext | None:
    try:
        return _github_context(repo_arg)
    except Exception as exc:
        print(f"Audit issue upsert skipped: {exc}")
        if severe_output_path is not None:
            _write_json(severe_output_path, [])
        return None


def _write_severe_rows(severe_output_path: Path | None, issue_rows: list[dict[str, Any]]) -> None:
    if severe_output_path is None:
        return
    severe_rows = [row for row in issue_rows if str(row.get("severity") or "").lower() in SEVERE_LEVELS]
    _write_json(severe_output_path, severe_rows)


def _maybe_close_stale(
    ctx: GitHubContext,
    *,
    should_close: bool,
    issue_candidate_fingerprints: set[str],
    run_url: str | None,
) -> int:
    if not should_close:
        return 0
    return _close_stale_fingerprint_issues(
        ctx,
        active_fingerprints=issue_candidate_fingerprints,
        run_url=run_url,
    )


def _maybe_upsert_digest(
    ctx: GitHubContext,
    *,
    skip_digest: bool,
    digest_title: str,
    low_findings: list[dict[str, Any]],
    run_url: str | None,
) -> None:
    if skip_digest:
        return
    _upsert_digest(
        ctx,
        digest_title=digest_title.strip() or "Weekly UX/IA Audit Digest",
        low_findings=low_findings,
        run_url=run_url,
    )


def _print_summary(
    *,
    issue_candidates: int,
    created: int,
    updated: int,
    closed: int,
    low: int,
    include_s3_seo: bool,
    ctx: GitHubContext,
    severe_output_path: Path | None,
) -> None:
    print(
        f"Audit issue upsert complete: "
        f"issue_candidates={issue_candidates} created={created} updated={updated} "
        f"closed={closed} low={low} include_s3_seo={include_s3_seo} "
        f"repo={ctx.owner}/{ctx.repo} "
        f"severe_output={str(severe_output_path) if severe_output_path else 'disabled'}"
    )


def main() -> int:
    args = _parse_args()
    include_s3_seo = bool(args.include_s3_seo)
    findings_path = _resolve_findings_path(args.findings)
    severe_output_path = _resolve_severe_output_path(args.severe_output)
    findings = _load_findings(findings_path)
    issue_candidate_fingerprints, issue_candidates, low_findings = _partition_findings(
        findings,
        include_s3_seo=include_s3_seo,
    )

    ctx = _load_context_or_skip(args.repo, severe_output_path)
    if ctx is None:
        return 0

    run_url = args.run_url.strip() or None
    created, updated, issue_rows = _upsert_issues(
        ctx,
        findings,
        run_url,
        include_s3_seo=include_s3_seo,
    )
    _write_severe_rows(severe_output_path, issue_rows)
    closed = _maybe_close_stale(
        ctx,
        should_close=bool(args.close_stale),
        issue_candidate_fingerprints=issue_candidate_fingerprints,
        run_url=run_url,
    )
    _maybe_upsert_digest(
        ctx,
        skip_digest=bool(args.skip_digest),
        digest_title=args.digest_title,
        low_findings=low_findings,
        run_url=run_url,
    )
    _print_summary(
        issue_candidates=len(issue_candidates),
        created=created,
        updated=updated,
        closed=closed,
        low=len(low_findings),
        include_s3_seo=include_s3_seo,
        ctx=ctx,
        severe_output_path=severe_output_path,
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # pragma: no cover - defensive CLI guard
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from exc
