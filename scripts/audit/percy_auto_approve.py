#!/usr/bin/env python3
"""Auto-approve Percy builds for a commit when review state is unreviewed.

This script is intended for CI usage on pull_request runs where Percy status
would otherwise stay in `needs review` state and block merges.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Iterable
from typing import Any

API_BASE = "https://percy.io/api/v1"
SHA_RE = re.compile(r"^[0-9a-f]{7,40}$", re.IGNORECASE)


class PercyApiError(RuntimeError):
    """Raised when Percy API calls fail."""


def extract_builds(payload: dict[str, Any]) -> list[dict[str, Any]]:
    data = payload.get("data")
    if not isinstance(data, list):
        return []
    return [item for item in data if isinstance(item, dict)]


def build_query_params(*, sha: str, branch: str | None, limit: int) -> dict[str, str]:
    params: dict[str, str] = {
        "filter[sha]": sha,
        "filter[state]": "finished",
        "page[limit]": str(limit),
    }
    if branch:
        params["filter[branch]"] = branch
    return params


def _created_at(item: dict[str, Any]) -> str:
    attrs = item.get("attributes")
    if not isinstance(attrs, dict):
        return ""
    value = attrs.get("created-at")
    return str(value or "")


def _is_approvable_build(item: dict[str, Any]) -> bool:
    attrs = item.get("attributes")
    if not isinstance(attrs, dict):
        return False
    state = str(attrs.get("state") or "").lower()
    review_state = str(attrs.get("review-state") or "").lower()
    return state == "finished" and review_state == "unreviewed"


def select_build_for_approval(builds: Iterable[dict[str, Any]]) -> dict[str, Any] | None:
    candidates = [build for build in builds if _is_approvable_build(build)]
    if not candidates:
        return None
    candidates.sort(key=_created_at, reverse=True)
    return candidates[0]


def _request_json(
    *,
    token: str | None,
    method: str,
    path: str,
    query: dict[str, str] | None = None,
    payload: dict[str, Any] | None = None,
    basic_auth: tuple[str, str] | None = None,
) -> dict[str, Any]:
    query_suffix = ""
    if query:
        query_suffix = "?" + urllib.parse.urlencode(query)
    url = f"{API_BASE}{path}{query_suffix}"
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")

    headers: dict[str, str] = {
        "Accept": "application/json",
        "User-Agent": "adrianaart-percy-auto-approve",
    }
    if data is not None:
        headers["Content-Type"] = "application/json"
    if basic_auth is not None:
        username, access_key = basic_auth
        auth_pair = f"{username}:{access_key}".encode("utf-8")
        headers["Authorization"] = "Basic " + base64.b64encode(auth_pair).decode("ascii")
    elif token:
        headers["Authorization"] = f"Token token={token}"
    else:
        raise ValueError("Token or basic_auth credentials are required")

    req = urllib.request.Request(url=url, method=method, data=data, headers=headers)

    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        msg = f"Percy API {method} {path} failed (HTTP {exc.code})"
        if body:
            msg += ": " + body[:300]
        raise PercyApiError(msg) from exc
    except urllib.error.URLError as exc:
        raise PercyApiError(f"Percy API {method} {path} failed: {exc}") from exc

    if not raw:
        return {}
    try:
        data_json = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise PercyApiError(f"Percy API {method} {path} returned non-JSON response") from exc
    if not isinstance(data_json, dict):
        raise PercyApiError(f"Percy API {method} {path} returned unexpected payload")
    return data_json


def _validate_sha(sha: str) -> str:
    value = sha.strip()
    if not value:
        raise ValueError("Missing commit SHA")
    if not SHA_RE.fullmatch(value):
        raise ValueError(f"Invalid commit SHA: {value}")
    return value


def run(
    *,
    token: str,
    sha: str,
    branch: str | None,
    dry_run: bool,
    limit: int,
    browserstack_username: str | None = None,
    browserstack_access_key: str | None = None,
) -> int:
    safe_sha = _validate_sha(sha)
    if limit < 1:
        raise ValueError("Limit must be >= 1")

    builds_payload = _request_json(
        token=token,
        method="GET",
        path="/builds",
        query=build_query_params(sha=safe_sha, branch=branch, limit=limit),
    )
    builds = extract_builds(builds_payload)

    selected = select_build_for_approval(builds)
    if selected is None:
        print("approved=false")
        print("reason=no-approvable-build")
        print(f"builds_scanned={len(builds)}")
        return 0

    build_id = str(selected.get("id") or "")
    if not build_id:
        print("approved=false")
        print("reason=missing-build-id")
        print(f"builds_scanned={len(builds)}")
        return 0

    print(f"selected_build_id={build_id}")
    print(f"builds_scanned={len(builds)}")

    if dry_run:
        print("approved=false")
        print("reason=dry-run")
        return 0

    approval_basic_auth: tuple[str, str] | None = None
    if browserstack_username and browserstack_access_key:
        approval_basic_auth = (browserstack_username, browserstack_access_key)

    try:
        _request_json(
            token=token if approval_basic_auth is None else None,
            method="POST",
            path="/reviews",
            payload={
                "data": {
                    "type": "reviews",
                    "attributes": {"state": "approved"},
                    "relationships": {
                        "build": {
                            "data": {
                                "type": "builds",
                                "id": build_id,
                            }
                        }
                    },
                }
            },
            basic_auth=approval_basic_auth,
        )
    except PercyApiError as exc:
        print("approved=false")
        print(f"reason=approval-error:{exc}")
        print(f"selected_build_id={build_id}")
        raise

    print("approved=true")
    print("reason=build-approved")
    return 0


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Auto-approve Percy build for a SHA")
    parser.add_argument("--sha", default=os.environ.get("GITHUB_SHA", ""), help="Commit SHA to match (defaults to GITHUB_SHA)")
    parser.add_argument("--branch", default=os.environ.get("GITHUB_HEAD_REF") or os.environ.get("GITHUB_REF_NAME"), help="Optional branch filter")
    parser.add_argument("--token", help="Percy token (defaults to PERCY_TOKEN env)")
    parser.add_argument("--browserstack-username", help="BrowserStack username (defaults to BROWSERSTACK_USERNAME env)")
    parser.add_argument("--browserstack-access-key", help="BrowserStack access key (defaults to BROWSERSTACK_ACCESS_KEY env)")
    parser.add_argument("--limit", type=int, default=25, help="How many recent builds to inspect")
    parser.add_argument("--dry-run", action="store_true", help="Report candidate without approving")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])

    token = str(args.token or os.environ.get("PERCY_TOKEN", "")).strip()
    if not token:
        print("approved=false")
        print("reason=missing-token")
        return 0
    browserstack_username = str(args.browserstack_username or os.environ.get("BROWSERSTACK_USERNAME", "")).strip() or None
    browserstack_access_key = str(args.browserstack_access_key or os.environ.get("BROWSERSTACK_ACCESS_KEY", "")).strip() or None

    try:
        return run(
            token=token,
            sha=args.sha,
            branch=args.branch,
            dry_run=bool(args.dry_run),
            limit=int(args.limit),
            browserstack_username=browserstack_username,
            browserstack_access_key=browserstack_access_key,
        )
    except ValueError as exc:
        print(f"error={exc}", file=sys.stderr)
        return 2
    except PercyApiError as exc:
        print(f"error={exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
