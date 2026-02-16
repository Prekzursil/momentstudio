#!/usr/bin/env python3
"""Watchdog for stale AI in-progress issues."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any


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
        "User-Agent": "adrianaart-agent-watchdog",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url=url, method=method, headers=headers, data=data)
    with urllib.request.urlopen(req, timeout=30) as resp:  # noqa: S310
        body = resp.read().decode("utf-8")
    return json.loads(body) if body else {}


def _list_open_in_progress_issues(ctx: GitHubContext) -> list[dict[str, Any]]:
    page = 1
    issues: list[dict[str, Any]] = []
    while True:
        query = urllib.parse.urlencode(
            {
                "state": "open",
                "labels": "ai:in-progress",
                "per_page": "100",
                "page": str(page),
            }
        )
        chunk = _request(ctx, "GET", f"/repos/{ctx.owner}/{ctx.repo}/issues?{query}")
        if not isinstance(chunk, list) or not chunk:
            break
        issues.extend(row for row in chunk if "pull_request" not in row)
        if len(chunk) < 100:
            break
        page += 1
    return issues


def _parse_ts(value: str) -> dt.datetime:
    return dt.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)


def _matches_filter(issue: dict[str, Any], audit_filter: str) -> bool:
    normalized = audit_filter.strip().lower()
    if normalized in {"", "all"}:
        return True

    labels = [str(row.get("name") or "") for row in issue.get("labels") or []]
    if normalized in {"audit", "audit:*", "audit-only"}:
        return any(label.startswith("audit:") for label in labels)
    if normalized.startswith("audit:"):
        return normalized in {label.lower() for label in labels}
    raise ValueError("--audit-filter must be one of: all, audit:*, audit-only, or an exact audit:* label.")


def _stale_comment(days: int) -> str:
    return "\n".join(
        [
            "Automated watchdog timeout: this issue has been in `ai:in-progress` without updates",
            f"for at least **{days} days**.",
            "",
            "Escalation action taken:",
            "- Removed `ai:in-progress`.",
            "- Added `ai:ready` for re-queue.",
            "- Removed assignee `copilot` if it was still present.",
            "",
            "Maintainers can relabel or reassign if active work is still underway.",
        ]
    ).strip() + "\n"


def _is_stale(issue: dict[str, Any], now: dt.datetime, stale_days: int) -> bool:
    updated_at = _parse_ts(str(issue.get("updated_at") or ""))
    age_days = (now - updated_at).total_seconds() / 86400
    return age_days >= stale_days


def _update_labels(issue: dict[str, Any]) -> list[str]:
    labels = [str(row.get("name") or "") for row in issue.get("labels") or []]
    keep = [label for label in labels if label and label != "ai:in-progress"]
    if "ai:ready" not in keep:
        keep.append("ai:ready")
    return sorted(set(keep), key=lambda x: x.lower())


def _write_outputs(*, scanned: int, stale: int, updated: int) -> None:
    output_path = (os.environ.get("GITHUB_OUTPUT") or "").strip()
    if output_path:
        with open(output_path, "a", encoding="utf-8") as handle:
            handle.write(f"scanned={scanned}\n")
            handle.write(f"stale={stale}\n")
            handle.write(f"updated={updated}\n")


def _write_step_summary(*, scanned: int, stale: int, updated: int) -> None:
    summary_path = (os.environ.get("GITHUB_STEP_SUMMARY") or "").strip()
    if not summary_path:
        return
    lines = [
        "## Agent watchdog summary",
        "",
        f"- Scanned issues: `{scanned}`",
        f"- Stale candidates: `{stale}`",
        f"- Updated issues: `{updated}`",
    ]
    with open(summary_path, "a", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")


def run(repo: str | None, stale_days: int, audit_filter: str) -> int:
    ctx = _github_context(repo)
    now = dt.datetime.now(dt.timezone.utc)

    scanned = 0
    stale = 0
    updated = 0

    for issue in _list_open_in_progress_issues(ctx):
        if not _matches_filter(issue, audit_filter):
            continue
        scanned += 1
        if not _is_stale(issue, now, stale_days):
            continue

        stale += 1
        issue_number = int(issue["number"])
        _request(
            ctx,
            "POST",
            f"/repos/{ctx.owner}/{ctx.repo}/issues/{issue_number}/comments",
            payload={"body": _stale_comment(stale_days)},
        )

        _request(
            ctx,
            "PATCH",
            f"/repos/{ctx.owner}/{ctx.repo}/issues/{issue_number}",
            payload={"labels": _update_labels(issue)},
        )

        assignees = [str(row.get("login") or "") for row in issue.get("assignees") or []]
        if "copilot" in assignees:
            _request(
                ctx,
                "DELETE",
                f"/repos/{ctx.owner}/{ctx.repo}/issues/{issue_number}/assignees",
                payload={"assignees": ["copilot"]},
            )
        updated += 1

    print(f"scanned={scanned}")
    print(f"stale={stale}")
    print(f"updated={updated}")
    _write_outputs(scanned=scanned, stale=stale, updated=updated)
    _write_step_summary(scanned=scanned, stale=stale, updated=updated)
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Watchdog for stalled ai:in-progress issues.")
    parser.add_argument("--repo", default=None, help="owner/repo override. Defaults to GITHUB_REPOSITORY.")
    parser.add_argument(
        "--stale-days",
        type=int,
        default=5,
        help="Threshold in days since issue updated_at before escalation.",
    )
    parser.add_argument(
        "--audit-filter",
        default="audit:*",
        help="Filter target issues: all, audit:*, audit-only, or exact audit label (e.g. audit:ux).",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    raise SystemExit(run(repo=args.repo, stale_days=args.stale_days, audit_filter=args.audit_filter))
