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


def _issue_body_for_finding(finding: dict[str, Any], run_url: str | None) -> str:
    fingerprint = str(finding.get("fingerprint") or "")
    title = str(finding.get("title") or "Audit finding")
    route = str(finding.get("route") or "/")
    surface = str(finding.get("surface") or "storefront")
    severity = str(finding.get("severity") or "s3")
    effort = str(finding.get("effort") or "M")
    impact = finding.get("impact", 1)
    description = str(finding.get("description") or "").strip()
    evidence_files = finding.get("evidence_files") or []

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
    lines.extend(
        [
            "",
            "### Evidence files",
            "",
        ]
    )
    for item in evidence_files:
        lines.append(f"- `artifacts/audit-evidence/{item}`")
    lines.extend(
        [
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
    )
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


def _upsert_issues(
    ctx: GitHubContext,
    findings: list[dict[str, Any]],
    run_url: str | None,
    *,
    include_s3_seo: bool,
) -> tuple[int, int]:
    open_issues = _list_open_issues(ctx)
    by_marker: dict[str, dict[str, Any]] = {}
    for issue in open_issues:
        body = str(issue.get("body") or "")
        marker_prefix = "<!-- audit:fingerprint:"
        idx = body.find(marker_prefix)
        if idx < 0:
            continue
        end_idx = body.find("-->", idx)
        if end_idx < 0:
            continue
        marker = body[idx + len(marker_prefix) : end_idx].strip()
        if marker:
            by_marker[marker] = issue

    created_count = 0
    updated_count = 0
    for finding in findings:
        if not _should_upsert_issue(finding, include_s3_seo=include_s3_seo):
            continue
        fp = str(finding.get("fingerprint") or "")
        if not fp:
            continue
        issue_title = (
            f"[Audit][{finding.get('severity','s3').upper()}]"
            f"[{finding.get('surface','storefront')}] {finding.get('title','Audit finding')}"
        )
        body = _issue_body_for_finding(finding, run_url)
        labels = sorted(set(["ai:ready", *list(finding.get("labels") or [])]))

        existing = by_marker.get(fp)
        if existing:
            _request(
                ctx,
                "PATCH",
                f"/repos/{ctx.owner}/{ctx.repo}/issues/{existing['number']}",
                payload={"title": issue_title, "body": body, "state": "open"},
            )
            updated_count += 1
            continue

        created = _safe_create_issue(ctx, title=issue_title, body=body, labels=labels)
        by_marker[fp] = created
        created_count += 1

    return created_count, updated_count


def _upsert_severe(ctx: GitHubContext, findings: list[dict[str, Any]], run_url: str | None) -> None:
    # Backward-compatible test helper used by existing unit tests.
    _upsert_issues(ctx, findings, run_url, include_s3_seo=False)


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
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    findings_path = _resolve_repo_path(
        args.findings,
        allowed_prefixes=("artifacts/audit-evidence", "artifacts/audit-evidence-local"),
    )
    if not findings_path.exists():
        raise FileNotFoundError(f"Findings file not found: {findings_path}")

    findings = _load_findings(findings_path)
    issue_candidate_fingerprints = {
        str(row.get("fingerprint") or "")
        for row in findings
        if _should_upsert_issue(row, include_s3_seo=bool(args.include_s3_seo))
    }
    issue_candidates = [row for row in findings if str(row.get("fingerprint") or "") in issue_candidate_fingerprints]
    low = [row for row in findings if str(row.get("fingerprint") or "") not in issue_candidate_fingerprints]

    try:
        ctx = _github_context(args.repo)
    except Exception as exc:
        print(f"Audit issue upsert skipped: {exc}")
        return 0

    run_url = args.run_url.strip() or None
    created, updated = _upsert_issues(
        ctx,
        findings,
        run_url,
        include_s3_seo=bool(args.include_s3_seo),
    )
    if not args.skip_digest:
        _upsert_digest(
            ctx,
            digest_title=args.digest_title.strip() or "Weekly UX/IA Audit Digest",
            low_findings=low,
            run_url=run_url,
        )
    print(
        f"Audit issue upsert complete: "
        f"issue_candidates={len(issue_candidates)} created={created} updated={updated} "
        f"low={len(low)} include_s3_seo={bool(args.include_s3_seo)} repo={ctx.owner}/{ctx.repo}"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # pragma: no cover - defensive CLI guard
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from exc
