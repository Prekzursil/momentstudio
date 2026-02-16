from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from unittest.mock import patch


MODULE_PATH = Path(__file__).resolve().parent / "upsert_audit_issues.py"
spec = importlib.util.spec_from_file_location("upsert_audit_issues", MODULE_PATH)
assert spec and spec.loader
upsert = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = upsert
spec.loader.exec_module(upsert)


def test_list_open_issues_paginates_and_filters_pull_requests() -> None:
    ctx = upsert.GitHubContext(token="t", owner="owner", repo="repo")

    calls: list[str] = []

    def fake_request(_ctx: upsert.GitHubContext, method: str, path: str):
        assert _ctx == ctx
        assert method == "GET"
        calls.append(path)

        query = parse_qs(urlparse(path).query)
        page = int(query["page"][0])
        per_page = int(query["per_page"][0])

        assert per_page == 100
        assert query["state"] == ["open"]
        assert query["labels"] == ["audit:ux,ai:ready"]

        if page == 1:
            return [{"number": 1}] * per_page
        if page == 2:
            rows = [{"number": n} for n in range(2, per_page + 1)]
            rows.append({"number": 404, "pull_request": {"url": "https://example.invalid/pr/404"}})
            return rows
        if page == 3:
            return [{"number": 999}]
        raise AssertionError(f"Unexpected page: {page}")

    with patch.object(upsert, "_request", side_effect=fake_request):
        issues = upsert._list_open_issues(ctx, labels=["audit:ux", "ai:ready"])

    assert len(calls) == 3
    assert [issue["number"] for issue in issues[:3]] == [1, 1, 1]
    assert issues[-1]["number"] == 999
    assert all("pull_request" not in issue for issue in issues)
    assert len(issues) == 200
