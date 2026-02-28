from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest


def _load_module():
    module_path = Path(__file__).resolve().parents[1] / "sync_severe_issues_to_project.py"
    spec = importlib.util.spec_from_file_location("sync_severe_issues_to_project", module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _write_issues(path: Path, payload: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def _project_payload(*, include_lane: bool = True):
    fields = [
        {
            "__typename": "ProjectV2SingleSelectField",
            "id": "F_STATUS",
            "name": "Status",
            "options": [
                {"id": "OPT_TODO", "name": "Todo"},
                {"id": "OPT_DONE", "name": "Done"},
            ],
        }
    ]
    if include_lane:
        fields.append(
            {
                "__typename": "ProjectV2SingleSelectField",
                "id": "F_LANE",
                "name": "Roadmap Lane",
                "options": [
                    {"id": "OPT_NOW", "name": "Now"},
                    {"id": "OPT_NEXT", "name": "Next"},
                ],
            }
        )
    return {
        "user": {
            "projectV2": {
                "id": "PVT_1",
                "url": "https://github.com/users/Prekzursil/projects/2",
                "closed": False,
                "fields": {"nodes": fields},
            }
        },
        "organization": None,
    }


def test_run_sync_missing_token_safe_skip(tmp_path) -> None:
    module = _load_module()
    issues_path = tmp_path / "artifacts" / "audit-evidence" / "severe.json"
    _write_issues(issues_path, [{"issue_number": 1, "issue_node_id": "I_1"}])

    summary = module.run_sync(
        token="",
        repo=module.RepoRef(owner="Prekzursil", repo="AdrianaArt"),
        project_owner="Prekzursil",
        project_number=2,
        issues_path=issues_path,
        lane_name="Now",
        status_name="Todo",
        dry_run=False,
        allow_skip_missing_token=True,
        request_fn=lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("unexpected call")),
    )

    assert summary["skipped_run"] is True
    assert summary["skip_reason"] == "missing_project_write_token"
    assert summary["skipped"] == 1


def test_run_sync_adds_missing_issue_and_sets_lane_and_status(tmp_path) -> None:
    module = _load_module()
    issues_path = tmp_path / "artifacts" / "audit-evidence" / "severe.json"
    _write_issues(issues_path, [{"issue_number": 220, "issue_node_id": "ISSUE_220"}])

    calls: list[tuple[str, dict[str, object]]] = []

    def fake_request(_token: str, query: str, variables: dict[str, object]) -> dict[str, object]:
        if "query ResolveProject" in query:
            return _project_payload()
        if "query ProjectItems" in query:
            return {
                "node": {
                    "items": {
                        "nodes": [],
                        "pageInfo": {"hasNextPage": False, "endCursor": None},
                    }
                }
            }
        if "mutation AddProjectItem" in query:
            calls.append(("add", variables))
            return {"addProjectV2ItemById": {"item": {"id": "ITEM_220"}}}
        if "mutation SetSingleSelect" in query:
            calls.append(("set", variables))
            return {"updateProjectV2ItemFieldValue": {"projectV2Item": {"id": "ITEM_220"}}}
        raise AssertionError(f"Unexpected query: {query[:80]}")

    summary = module.run_sync(
        token="token",
        repo=module.RepoRef(owner="Prekzursil", repo="AdrianaArt"),
        project_owner="Prekzursil",
        project_number=2,
        issues_path=issues_path,
        lane_name="Now",
        status_name="Todo",
        dry_run=False,
        allow_skip_missing_token=False,
        request_fn=fake_request,
    )

    assert summary["added"] == 1
    assert summary["updated"] == 0
    assert summary["lane_updates"] == 1
    assert summary["status_updates"] == 1
    assert summary["results"][0]["result"] == "added"
    assert [name for name, _ in calls].count("add") == 1
    assert [name for name, _ in calls].count("set") == 2


def _existing_item_project_items_payload() -> dict[str, object]:
    return {
        "node": {
            "items": {
                "nodes": [
                    {
                        "id": "ITEM_221",
                        "content": {"__typename": "Issue", "id": "ISSUE_221", "number": 221},
                        "fieldValues": {
                            "nodes": [
                                {
                                    "__typename": "ProjectV2ItemFieldSingleSelectValue",
                                    "name": "Next",
                                    "optionId": "OPT_NEXT",
                                    "field": {"name": "Roadmap Lane"},
                                },
                                {
                                    "__typename": "ProjectV2ItemFieldSingleSelectValue",
                                    "name": "Done",
                                    "optionId": "OPT_DONE",
                                    "field": {"name": "Status"},
                                },
                            ]
                        },
                    }
                ],
                "pageInfo": {"hasNextPage": False, "endCursor": None},
            }
        }
    }


def _existing_item_request(set_calls: list[dict[str, object]]):
    def fake_request(_token: str, query: str, variables: dict[str, object]) -> dict[str, object]:
        if "query ResolveProject" in query:
            return _project_payload()
        if "query ProjectItems" in query:
            return _existing_item_project_items_payload()
        if "mutation AddProjectItem" in query:
            raise AssertionError("Should not add an existing issue")
        if "mutation SetSingleSelect" in query:
            set_calls.append(variables)
            return {"updateProjectV2ItemFieldValue": {"projectV2Item": {"id": "ITEM_221"}}}
        raise AssertionError(f"Unexpected query: {query[:80]}")

    return fake_request


def test_run_sync_updates_existing_and_preserves_done_status(tmp_path) -> None:
    module = _load_module()
    issues_path = tmp_path / "artifacts" / "audit-evidence" / "severe.json"
    _write_issues(issues_path, [{"issue_number": 221, "issue_node_id": "ISSUE_221"}])

    set_calls: list[dict[str, object]] = []

    summary = module.run_sync(
        token="token",
        repo=module.RepoRef(owner="Prekzursil", repo="AdrianaArt"),
        project_owner="Prekzursil",
        project_number=2,
        issues_path=issues_path,
        lane_name="Now",
        status_name="Todo",
        dry_run=False,
        allow_skip_missing_token=False,
        request_fn=_existing_item_request(set_calls),
    )

    assert summary["added"] == 0
    assert summary["updated"] == 1
    assert summary["lane_updates"] == 1
    assert summary["status_updates"] == 0
    assert len(set_calls) == 1
    assert set_calls[0]["fieldId"] == "F_LANE"


def test_run_sync_dedupes_duplicate_issue_numbers_and_resolves_missing_node_id(tmp_path) -> None:
    module = _load_module()
    issues_path = tmp_path / "artifacts" / "audit-evidence" / "severe.json"
    _write_issues(
        issues_path,
        [
            {"issue_number": 500, "severity": "s2", "route": "/shop"},
            {"issue_number": 500, "severity": "s2", "route": "/shop", "surface": "storefront"},
        ],
    )

    lookup_calls = {"issue_lookup": 0}

    def fake_request(_token: str, query: str, variables: dict[str, object]) -> dict[str, object]:
        if "query ResolveProject" in query:
            return _project_payload()
        if "query ProjectItems" in query:
            return {
                "node": {
                    "items": {
                        "nodes": [],
                        "pageInfo": {"hasNextPage": False, "endCursor": None},
                    }
                }
            }
        if "query IssueNodeId" in query:
            lookup_calls["issue_lookup"] += 1
            return {"repository": {"issue": {"id": "ISSUE_500", "number": 500}}}
        if "mutation AddProjectItem" in query:
            return {"addProjectV2ItemById": {"item": {"id": "ITEM_500"}}}
        if "mutation SetSingleSelect" in query:
            return {"updateProjectV2ItemFieldValue": {"projectV2Item": {"id": "ITEM_500"}}}
        raise AssertionError(f"Unexpected query: {query[:80]}")

    summary = module.run_sync(
        token="token",
        repo=module.RepoRef(owner="Prekzursil", repo="AdrianaArt"),
        project_owner="Prekzursil",
        project_number=2,
        issues_path=issues_path,
        lane_name="Now",
        status_name="Todo",
        dry_run=False,
        allow_skip_missing_token=False,
        request_fn=fake_request,
    )

    assert summary["scanned"] == 1
    assert summary["added"] == 1
    assert lookup_calls["issue_lookup"] == 1


def test_resolve_project_errors_when_lane_field_missing() -> None:
    module = _load_module()

    def fake_request(_token: str, _query: str, _variables: dict[str, object]) -> dict[str, object]:
        return _project_payload(include_lane=False)

    with pytest.raises(RuntimeError, match="Roadmap Lane"):
        module._resolve_project(
            token="token",
            project_owner="Prekzursil",
            project_number=2,
            lane_name="Now",
            status_name="Todo",
            request_fn=fake_request,
        )
