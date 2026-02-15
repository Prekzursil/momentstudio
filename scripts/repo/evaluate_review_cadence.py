#!/usr/bin/env python3
"""Evaluate whether contributor cadence justifies required PR approvals."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path
from typing import Any


_IDENTIFIER_RE = re.compile(r"^[A-Za-z0-9._-]+$")
_DEFAULT_OUTPUT_ROOTS = (Path("docs/reports"), Path("artifacts/repo-policy"))


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


def _validate_identifier(name: str, value: str) -> str:
    cleaned = str(value or "").strip()
    if not cleaned:
        raise ValueError(f"{name} is required")
    if not _IDENTIFIER_RE.fullmatch(cleaned):
        raise ValueError(f"Invalid {name}: {value!r}")
    return cleaned


def _allowed_output_roots() -> list[Path]:
    cwd = Path.cwd().resolve()
    return [(cwd / root).resolve() for root in _DEFAULT_OUTPUT_ROOTS]


def _resolve_output_path(raw_path: str) -> Path:
    candidate = Path(str(raw_path or "").strip())
    if candidate.is_absolute():
        raise ValueError("Output paths must be relative to repository root")
    resolved = (Path.cwd() / candidate).resolve()
    for root in _allowed_output_roots():
        if resolved == root or root in resolved.parents:
            return resolved
    allowed = ", ".join(str(root.relative_to(Path.cwd())) for root in _allowed_output_roots())
    raise ValueError(f"Output path must be under one of: {allowed}")


def _gh_api_json(endpoint: str, *, token: str, fields: dict[str, str]) -> Any:
    cmd = [
        "gh",
        "api",
        "--method",
        "GET",
        endpoint,
        "-H",
        "Accept: application/vnd.github+json",
        "-H",
        "X-GitHub-Api-Version: 2022-11-28",
    ]
    for key, value in fields.items():
        cmd.extend(["-f", f"{key}={value}"])
    env = os.environ.copy()
    env["GH_TOKEN"] = token
    env["GITHUB_TOKEN"] = token
    out = subprocess.check_output(cmd, text=True, env=env)
    return json.loads(out)


def fetch_merged_prs(
    owner: str,
    repo: str,
    base: str,
    window_days: int,
    token: str,
    per_page: int = 100,
) -> list[dict[str, Any]]:
    cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=window_days)
    owner = _validate_identifier("owner", owner)
    repo = _validate_identifier("repo", repo)
    base = _validate_identifier("base branch", base)
    endpoint = f"/repos/{owner}/{repo}/pulls"
    merged: list[dict[str, Any]] = []
    page = 0
    max_pages = 20
    while page < max_pages:
        page += 1
        rows = _gh_api_json(
            endpoint,
            token=token,
            fields={
                "state": "closed",
                "base": base,
                "sort": "updated",
                "direction": "desc",
                "per_page": str(per_page),
                "page": str(page),
            },
        )
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
        if stop_due_to_age or len(rows) < per_page:
            # API sorting is by updated timestamp, so once merged_at falls behind
            # the window for the page, older pages will only be older.
            break
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
        json_path = _resolve_output_path(args.json_out)
        json_path.parent.mkdir(parents=True, exist_ok=True)
        json_path.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    if args.md_out:
        md_path = _resolve_output_path(args.md_out)
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
