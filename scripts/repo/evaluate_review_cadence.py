#!/usr/bin/env python3
"""Evaluate whether contributor cadence justifies required PR approvals."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Any


def _iso_now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def _parse_iso(ts: str) -> dt.datetime:
    return dt.datetime.fromisoformat(ts.replace("Z", "+00:00"))


def _is_bot(user: dict[str, Any] | None) -> bool:
    if not user:
        return True
    login = str(user.get("login") or "").lower()
    user_type = str(user.get("type") or "").lower()
    return user_type == "bot" or login.endswith("[bot]")


def _load_token(explicit_token: str | None) -> str:
    if explicit_token:
        return explicit_token
    for key in ("GITHUB_TOKEN", "GH_TOKEN"):
        value = os.getenv(key, "").strip()
        if value:
            return value
    try:
        token = subprocess.check_output(["gh", "auth", "token"], text=True).strip()
        if token:
            return token
    except Exception:
        pass
    raise RuntimeError("Missing GitHub token. Set GITHUB_TOKEN or run `gh auth login`.")


def _github_get_json(url: str, token: str) -> tuple[list[dict[str, Any]], str | None]:
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "adrianaart-repo-policy-evaluator",
        },
    )
    with urllib.request.urlopen(req, timeout=20) as resp:  # nosec B310
        payload = json.loads(resp.read().decode("utf-8"))
        link_header = resp.headers.get("Link")
        return payload, link_header


def _next_link(link_header: str | None) -> str | None:
    if not link_header:
        return None
    parts = [part.strip() for part in link_header.split(",")]
    for part in parts:
        if 'rel="next"' not in part:
            continue
        start = part.find("<")
        end = part.find(">")
        if start >= 0 and end > start:
            return part[start + 1 : end]
    return None


def fetch_merged_prs(
    owner: str,
    repo: str,
    base: str,
    window_days: int,
    token: str,
    per_page: int = 100,
) -> list[dict[str, Any]]:
    cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=window_days)
    base_url = f"https://api.github.com/repos/{owner}/{repo}/pulls"
    query = urllib.parse.urlencode(
        {
            "state": "closed",
            "base": base,
            "sort": "updated",
            "direction": "desc",
            "per_page": per_page,
            "page": 1,
        }
    )
    url = f"{base_url}?{query}"
    merged: list[dict[str, Any]] = []
    page = 0
    max_pages = 20
    while url and page < max_pages:
        page += 1
        rows, link_header = _github_get_json(url, token)
        if not rows:
            break
        stop_due_to_age = False
        for pr in rows:
            merged_at = pr.get("merged_at")
            if not merged_at:
                continue
            merged_ts = _parse_iso(merged_at)
            if merged_ts < cutoff:
                stop_due_to_age = True
                continue
            merged.append(pr)
        if stop_due_to_age:
            # API sorting is by updated timestamp, so once merged_at falls behind
            # the window for the page, older pages will only be older.
            break
        url = _next_link(link_header)
    return merged


def evaluate(prs: list[dict[str, Any]], min_contributors: int, min_total_human: int, min_prs_per_contributor: int) -> dict[str, Any]:
    total_all = len(prs)
    counter: Counter[str] = Counter()
    for pr in prs:
        user = pr.get("user")
        if _is_bot(user):
            continue
        login = str((user or {}).get("login") or "").strip()
        if not login:
            continue
        counter[login] += 1

    total_human = sum(counter.values())
    unique_human = len(counter)
    qualifying = {k: v for k, v in counter.items() if v >= min_prs_per_contributor}
    trigger_met = len(qualifying) >= min_contributors and total_human >= min_total_human

    return {
        "merged_all_authors": total_all,
        "merged_non_bot": total_human,
        "unique_non_bot_contributors": unique_human,
        "contributors_with_min_merged_prs": len(qualifying),
        "contributors": sorted(
            [{"login": login, "merged_prs": count} for login, count in counter.items()],
            key=lambda row: (-row["merged_prs"], row["login"]),
        ),
        "trigger_met_this_window": trigger_met,
    }


def to_markdown(
    owner: str,
    repo: str,
    base: str,
    generated_at: str,
    window_days: int,
    min_contributors: int,
    min_total_human: int,
    min_prs_per_contributor: int,
    evaluation: dict[str, Any],
) -> str:
    contrib_rows = evaluation["contributors"][:10]
    if contrib_rows:
        contrib_table = "\n".join(
            f"| `{row['login']}` | {row['merged_prs']} |" for row in contrib_rows
        )
    else:
        contrib_table = "| _none_ | 0 |"

    status_line = (
        "Trigger met for this window. Keep checks-only until two consecutive monthly evaluations pass."
        if evaluation["trigger_met_this_window"]
        else "Trigger not met. Keep checks-only branch protection."
    )
    return f"""# Repo policy phase 2 evaluation

- Generated at: `{generated_at}`
- Repository: `{owner}/{repo}`
- Base branch: `{base}`
- Window: last `{window_days}` days

## Metrics

- Merged PRs (all authors): **{evaluation['merged_all_authors']}**
- Merged PRs (non-bot): **{evaluation['merged_non_bot']}**
- Unique non-bot contributors: **{evaluation['unique_non_bot_contributors']}**
- Contributors with >= `{min_prs_per_contributor}` merged PRs: **{evaluation['contributors_with_min_merged_prs']}**

## Trigger policy

To enable `1` required approval, all must be true:

1. At least `{min_contributors}` non-bot contributors each with >= `{min_prs_per_contributor}` merged PRs in `{window_days}` days.
2. At least `{min_total_human}` non-bot merged PRs in `{window_days}` days.
3. Condition must hold for **2 consecutive monthly evaluations**.

Result: **{"PASS" if evaluation["trigger_met_this_window"] else "HOLD"}**  
{status_line}

## Top non-bot contributors in window

| Login | Merged PRs |
| --- | ---: |
{contrib_table}
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owner", required=True, help="GitHub owner/org login")
    parser.add_argument("--repo", required=True, help="GitHub repository name")
    parser.add_argument("--base", default="main", help="Base branch to evaluate")
    parser.add_argument("--window-days", type=int, default=60, help="Evaluation window in days")
    parser.add_argument("--min-contributors", type=int, default=3, help="Minimum qualifying contributors")
    parser.add_argument("--min-total-human-prs", type=int, default=25, help="Minimum total non-bot merged PRs")
    parser.add_argument("--min-prs-per-contributor", type=int, default=2, help="Minimum merged PRs per qualifying contributor")
    parser.add_argument("--token", default=None, help="GitHub token (optional; falls back to env/gh auth)")
    parser.add_argument("--json-out", default=None, help="Path to write JSON result")
    parser.add_argument("--md-out", default=None, help="Path to write markdown summary")
    args = parser.parse_args()

    token = _load_token(args.token)
    generated_at = _iso_now()
    prs = fetch_merged_prs(
        owner=args.owner,
        repo=args.repo,
        base=args.base,
        window_days=args.window_days,
        token=token,
    )
    evaluation = evaluate(
        prs,
        min_contributors=args.min_contributors,
        min_total_human=args.min_total_human_prs,
        min_prs_per_contributor=args.min_prs_per_contributor,
    )

    result = {
        "generated_at": generated_at,
        "repo": f"{args.owner}/{args.repo}",
        "base_branch": args.base,
        "window_days": args.window_days,
        "thresholds": {
            "min_contributors": args.min_contributors,
            "min_total_non_bot_merged_prs": args.min_total_human_prs,
            "min_prs_per_contributor": args.min_prs_per_contributor,
            "consecutive_monthly_passes_required": 2,
        },
        "evaluation": evaluation,
        "recommendation": (
            "keep checks-only branch protection; re-evaluate next month"
            if not evaluation["trigger_met_this_window"]
            else "hold until two consecutive monthly passes, then enable 1 required approval"
        ),
    }
    markdown = to_markdown(
        owner=args.owner,
        repo=args.repo,
        base=args.base,
        generated_at=generated_at,
        window_days=args.window_days,
        min_contributors=args.min_contributors,
        min_total_human=args.min_total_human_prs,
        min_prs_per_contributor=args.min_prs_per_contributor,
        evaluation=evaluation,
    )

    if args.json_out:
        json_path = Path(args.json_out)
        json_path.parent.mkdir(parents=True, exist_ok=True)
        json_path.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    if args.md_out:
        md_path = Path(args.md_out)
        md_path.parent.mkdir(parents=True, exist_ok=True)
        md_path.write_text(markdown, encoding="utf-8")

    print(json.dumps(result, indent=2, ensure_ascii=False))
    if not args.md_out:
        print("\n" + markdown)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # pragma: no cover - defensive CLI failure path
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1)
