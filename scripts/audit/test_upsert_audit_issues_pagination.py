from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse


MODULE_PATH = Path(__file__).resolve().parent / "upsert_audit_issues.py"
SPEC = importlib.util.spec_from_file_location("upsert_audit_issues", MODULE_PATH)
assert SPEC and SPEC.loader
upsert_audit_issues = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = upsert_audit_issues
SPEC.loader.exec_module(upsert_audit_issues)


GitHubContext = upsert_audit_issues.GitHubContext


def _paged_issue_rows(path: str, page_1_rows: list[dict[str, object]], page_2_rows: list[dict[str, object]]) -> list[dict[str, object]]:
    query = parse_qs(urlparse(path).query)
    page = query.get("page", ["1"])[0]
    if page == "1":
        return page_1_rows
    if page == "2":
        return page_2_rows
    return []


def test_upsert_severe_uses_paginated_open_issues_for_dedupe(monkeypatch):
    ctx = GitHubContext(token="token", owner="octo", repo="demo")
    finding = {
        "fingerprint": "fp-page-2",
        "severity": "s1",
        "surface": "storefront",
        "title": "Paged duplicate",
        "labels": ["audit:test"],
    }

    page_1_rows = [{"number": i, "title": f"Issue {i}"} for i in range(1, 101)]
    # Keep PR filtering behavior intact by ensuring PR rows do not become dedupe candidates.
    page_1_rows[0]["pull_request"] = {"url": "https://api.github.com/repos/octo/demo/pulls/1"}
    page_2_rows = [
        {
            "number": 999,
            "title": "Existing paged finding",
            "body": "<!-- audit:fingerprint:fp-page-2 -->\n\nOld body",
        }
    ]

    patch_calls: list[tuple[str, dict[str, object]]] = []
    post_calls: list[tuple[str, dict[str, object]]] = []

    def fake_request(_ctx, method, path, payload=None):
        if method == "GET" and path.startswith("/repos/octo/demo/issues?"):
            return _paged_issue_rows(path, page_1_rows, page_2_rows)
        if method == "PATCH":
            patch_calls.append((path, payload or {}))
            return {"number": 999}
        if method == "POST":
            post_calls.append((path, payload or {}))
            return {"number": 1234}
        raise AssertionError(f"Unexpected call: {method} {path}")

    monkeypatch.setattr(upsert_audit_issues, "_request", fake_request)

    upsert_audit_issues._upsert_severe(ctx, [finding], run_url=None)

    assert post_calls == []
    assert len(patch_calls) == 1
    assert patch_calls[0][0].endswith("/issues/999")
