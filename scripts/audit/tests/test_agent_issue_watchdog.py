from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def _load_module():
    module_path = Path(__file__).resolve().parents[1] / "agent_issue_watchdog.py"
    spec = importlib.util.spec_from_file_location("agent_issue_watchdog", module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_split_repo_rejects_malformed_tokens() -> None:
    module = _load_module()
    owner, repo = module._split_repo("Prekzursil/momentstudio")
    assert owner == "Prekzursil"
    assert repo == "AdrianaArt"

    for invalid in ["bad owner/AdrianaArt", "Prekzursil/adriana/art", "onlyowner", "/repo", "owner/"]:
        try:
            module._split_repo(invalid)
        except ValueError:
            continue
        raise AssertionError(f"Expected ValueError for invalid repo identifier: {invalid}")


def test_update_labels_replaces_in_progress_with_ready() -> None:
    module = _load_module()
    labels = module._update_labels(
        {
            "labels": [
                {"name": "ai:in-progress"},
                {"name": "audit:ux"},
                {"name": "severity:s2"},
            ]
        }
    )
    assert labels == ["ai:ready", "audit:ux", "severity:s2"]


def test_run_outputs_counters_and_applies_issue_updates(capsys) -> None:
    module = _load_module()
    ctx = module.GitHubContext(token="token", owner="Prekzursil", repo="AdrianaArt")

    def fake_list_open_in_progress_issues(_ctx):
        return [
            {
                "number": 42,
                "updated_at": "2020-01-01T00:00:00Z",
                "labels": [{"name": "ai:in-progress"}, {"name": "audit:ux"}],
                "assignees": [{"login": "copilot"}],
            },
            {
                "number": 43,
                "updated_at": "2020-01-01T00:00:00Z",
                "labels": [{"name": "ai:in-progress"}, {"name": "area:docs"}],
                "assignees": [],
            },
        ]

    calls: list[tuple[str, str, dict[str, object] | None]] = []

    def fake_request(_ctx, method: str, path: str, payload=None):
        calls.append((method, path, payload))
        return {}

    module._github_context = lambda _repo: ctx
    module._list_open_in_progress_issues = fake_list_open_in_progress_issues
    module._request = fake_request

    assert module.run(repo="Prekzursil/momentstudio", stale_days=5, audit_filter="audit:*") == 0

    out = capsys.readouterr().out
    assert "scanned=1" in out
    assert "stale=1" in out
    assert "updated=1" in out

    methods = [method for method, _, _ in calls]
    assert methods == ["POST", "PATCH", "DELETE"]

