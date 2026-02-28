#!/usr/bin/env python3
"""Sync severe audit issues into a GitHub ProjectV2 roadmap lane."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

IDENTIFIER_RE = re.compile(r"^[A-Za-z0-9._-]+$")
TERMINAL_STATUS_NAMES = {"done", "closed", "completed"}
GRAPHQL_URL = "https://api.github.com/graphql"

RESOLVE_PROJECT_QUERY = """
query ResolveProject($owner: String!, $number: Int!) {
  user(login: $owner) {
    projectV2(number: $number) {
      id
      url
      closed
      fields(first: 100) {
        nodes {
          __typename
          ... on ProjectV2FieldCommon {
            id
            name
          }
          ... on ProjectV2SingleSelectField {
            id
            name
            options {
              id
              name
            }
          }
        }
      }
    }
  }
  organization(login: $owner) {
    projectV2(number: $number) {
      id
      url
      closed
      fields(first: 100) {
        nodes {
          __typename
          ... on ProjectV2FieldCommon {
            id
            name
          }
          ... on ProjectV2SingleSelectField {
            id
            name
            options {
              id
              name
            }
          }
        }
      }
    }
  }
}
"""

PROJECT_ITEMS_QUERY = """
query ProjectItems($projectId: ID!, $after: String) {
  node(id: $projectId) {
    ... on ProjectV2 {
      items(first: 100, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          content {
            __typename
            ... on Issue {
              id
              number
            }
          }
          fieldValues(first: 30) {
            nodes {
              __typename
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                optionId
                field {
                  ... on ProjectV2FieldCommon {
                    name
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
"""

ISSUE_NODE_QUERY = """
query IssueNodeId($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      id
      number
    }
  }
}
"""

ADD_PROJECT_ITEM_MUTATION = """
mutation AddProjectItem($projectId: ID!, $contentId: ID!) {
  addProjectV2ItemById(input: {projectId: $projectId, contentId: $contentId}) {
    item {
      id
    }
  }
}
"""

SET_SINGLE_SELECT_MUTATION = """
mutation SetSingleSelect($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
  updateProjectV2ItemFieldValue(
    input: {
      projectId: $projectId
      itemId: $itemId
      fieldId: $fieldId
      value: { singleSelectOptionId: $optionId }
    }
  ) {
    projectV2Item {
      id
    }
  }
}
"""


@dataclass(frozen=True)
class RepoRef:
    owner: str
    repo: str


@dataclass(frozen=True)
class ProjectRef:
    project_id: str
    project_url: str
    lane_field_id: str
    lane_option_id: str
    status_field_id: str
    status_option_id: str


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


def _validate_identifier(value: str, *, label: str) -> str:
    raw = value.strip()
    if not raw:
        raise ValueError(f"Missing {label}.")
    if not IDENTIFIER_RE.fullmatch(raw):
        raise ValueError(f"Invalid {label}: {raw}")
    return raw


def _parse_repo(full_name: str) -> RepoRef:
    if "/" not in full_name:
        raise ValueError("Repository must be owner/repo format.")
    owner_raw, repo_raw = full_name.split("/", 1)
    owner = _validate_identifier(owner_raw, label="repository owner")
    repo = _validate_identifier(repo_raw, label="repository name")
    return RepoRef(owner=owner, repo=repo)


def _graphql_request(token: str, query: str, variables: dict[str, Any]) -> dict[str, Any]:
    payload = json.dumps({"query": query, "variables": variables}).encode("utf-8")
    req = urllib.request.Request(
        url=GRAPHQL_URL,
        method="POST",
        data=payload,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "adrianaart-audit-project-sync",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
            payload_json = json.loads(body) if body else {}
    except urllib.error.HTTPError as exc:
        _ = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"GitHub GraphQL request failed: HTTP {exc.code}.") from exc

    errors = payload_json.get("errors") or []
    if errors:
        first = errors[0] if isinstance(errors[0], dict) else {"message": str(errors[0])}
        message = str(first.get("message") or "GraphQL request failed.")
        raise RuntimeError(f"GitHub GraphQL request failed: {message}")
    data = payload_json.get("data")
    if not isinstance(data, dict):
        raise RuntimeError("GitHub GraphQL request failed: missing data payload.")
    return data


def _extract_project_node(data: dict[str, Any]) -> dict[str, Any] | None:
    user_node = data.get("user") if isinstance(data.get("user"), dict) else None
    org_node = data.get("organization") if isinstance(data.get("organization"), dict) else None
    if user_node and isinstance(user_node.get("projectV2"), dict):
        return user_node["projectV2"]
    if org_node and isinstance(org_node.get("projectV2"), dict):
        return org_node["projectV2"]
    return None


def _find_option_id(options: list[dict[str, Any]], expected_name: str) -> str:
    for option in options:
        if isinstance(option, dict) and str(option.get("name") or "") == expected_name:
            return str(option.get("id") or "")
    return ""


def _field_options(field: dict[str, Any]) -> list[dict[str, Any]]:
    options = field.get("options")
    return options if isinstance(options, list) else []


def _resolve_single_select_field_option(
    fields_nodes: list[dict[str, Any]],
    *,
    field_name: str,
    option_name: str,
    missing_field_error: str,
    missing_option_error: str,
) -> tuple[str, str]:
    field_id = ""
    option_id = ""
    for field in fields_nodes:
        if str(field.get("name") or "") != field_name:
            continue
        field_id = str(field.get("id") or "")
        option_id = _find_option_id(_field_options(field), option_name)

    if not field_id:
        raise RuntimeError(missing_field_error)
    if not option_id:
        raise RuntimeError(missing_option_error)
    return field_id, option_id


def _resolve_project_fields(
    fields_nodes: list[dict[str, Any]],
    *,
    lane_name: str,
    status_name: str,
) -> tuple[str, str, str, str]:
    lane_field_id, lane_option_id = _resolve_single_select_field_option(
        fields_nodes,
        field_name="Roadmap Lane",
        option_name=lane_name,
        missing_field_error="Project field 'Roadmap Lane' not found.",
        missing_option_error=f"Roadmap Lane option '{lane_name}' not found.",
    )
    status_field_id, status_option_id = _resolve_single_select_field_option(
        fields_nodes,
        field_name="Status",
        option_name=status_name,
        missing_field_error="Project field 'Status' not found.",
        missing_option_error=f"Status option '{status_name}' not found.",
    )
    return lane_field_id, lane_option_id, status_field_id, status_option_id


def _require_open_project(data: dict[str, Any], *, project_owner: str, project_number: int) -> dict[str, Any]:
    project = _extract_project_node(data)
    if not isinstance(project, dict):
        raise RuntimeError(f"Project not found for {project_owner} #{project_number}.")
    if bool(project.get("closed")):
        raise RuntimeError(f"Project {project_owner} #{project_number} is closed.")
    return project


def _project_field_nodes(project: dict[str, Any]) -> list[dict[str, Any]]:
    fields = project.get("fields") if isinstance(project.get("fields"), dict) else {}
    nodes = fields.get("nodes") if isinstance(fields.get("nodes"), list) else []
    return [field for field in nodes if isinstance(field, dict)]


def _resolve_project(
    *,
    token: str,
    project_owner: str,
    project_number: int,
    lane_name: str,
    status_name: str,
    request_fn: Callable[[str, str, dict[str, Any]], dict[str, Any]],
) -> ProjectRef:
    data = request_fn(token, RESOLVE_PROJECT_QUERY, {"owner": project_owner, "number": project_number})
    project = _require_open_project(data, project_owner=project_owner, project_number=project_number)
    lane_field_id, lane_option_id, status_field_id, status_option_id = _resolve_project_fields(
        _project_field_nodes(project),
        lane_name=lane_name,
        status_name=status_name,
    )

    return ProjectRef(
        project_id=str(project.get("id") or ""),
        project_url=str(project.get("url") or ""),
        lane_field_id=lane_field_id,
        lane_option_id=lane_option_id,
        status_field_id=status_field_id,
        status_option_id=status_option_id,
    )


def _project_issue_node_id(item: dict[str, Any]) -> str:
    content = item.get("content") if isinstance(item.get("content"), dict) else None
    if not content or str(content.get("__typename") or "") != "Issue":
        return ""
    return str(content.get("id") or "")


def _single_select_field_value(value: dict[str, Any]) -> tuple[str, str] | None:
    if str(value.get("__typename") or "") != "ProjectV2ItemFieldSingleSelectValue":
        return None
    field = value.get("field") if isinstance(value.get("field"), dict) else {}
    return str(field.get("name") or ""), str(value.get("name") or "")


def _project_item_status_and_lane(item: dict[str, Any]) -> tuple[str, str]:
    status_name = ""
    lane_name = ""
    field_values = item.get("fieldValues") if isinstance(item.get("fieldValues"), dict) else {}
    values_nodes = field_values.get("nodes") if isinstance(field_values.get("nodes"), list) else []

    for value in values_nodes:
        parsed_value = _single_select_field_value(value)
        if not parsed_value:
            continue
        field_name, selected_name = parsed_value
        if field_name == "Status":
            status_name = selected_name
        elif field_name == "Roadmap Lane":
            lane_name = selected_name
    return status_name, lane_name


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _dict_rows(values: list[Any]) -> list[dict[str, Any]]:
    return [value for value in values if isinstance(value, dict)]


def _parse_project_item(item: dict[str, Any]) -> tuple[str, dict[str, str]] | None:
    issue_node_id = _project_issue_node_id(item)
    if not issue_node_id:
        return None

    status_name, lane_name = _project_item_status_and_lane(item)

    return issue_node_id, {
        "item_id": str(item.get("id") or ""),
        "status_name": status_name,
        "lane_name": lane_name,
    }


def _project_items_page(payload: dict[str, Any]) -> tuple[list[dict[str, Any]], bool, str] | None:
    node = _as_dict(payload.get("node"))
    if not node:
        return None

    items = _as_dict(node.get("items"))
    page_info = _as_dict(items.get("pageInfo"))
    nodes = _dict_rows(_as_list(items.get("nodes")))
    has_next_page = bool(page_info.get("hasNextPage"))
    end_cursor = str(page_info.get("endCursor") or "")
    return nodes, has_next_page, end_cursor


def _list_project_issue_items(
    *,
    token: str,
    project_id: str,
    request_fn: Callable[[str, str, dict[str, Any]], dict[str, Any]],
) -> dict[str, dict[str, str]]:
    after: str | None = None
    mapping: dict[str, dict[str, str]] = {}

    while True:
        payload = request_fn(token, PROJECT_ITEMS_QUERY, {"projectId": project_id, "after": after})
        page = _project_items_page(payload)
        if page is None:
            break

        nodes, has_next_page, end_cursor = page
        for item in nodes:
            parsed = _parse_project_item(item)
            if parsed:
                issue_node_id, row = parsed
                mapping[issue_node_id] = row

        if not has_next_page or not end_cursor:
            break
        after = end_cursor

    return mapping


def _resolve_issue_node_id(
    *,
    token: str,
    repo: RepoRef,
    issue_number: int,
    request_fn: Callable[[str, str, dict[str, Any]], dict[str, Any]],
) -> str:
    data = request_fn(
        token,
        ISSUE_NODE_QUERY,
        {"owner": repo.owner, "repo": repo.repo, "number": issue_number},
    )
    repository = data.get("repository") if isinstance(data.get("repository"), dict) else None
    if not repository:
        return ""
    issue = repository.get("issue") if isinstance(repository.get("issue"), dict) else None
    if not issue:
        return ""
    return str(issue.get("id") or "")


def _add_project_item(
    *,
    token: str,
    project_id: str,
    issue_node_id: str,
    request_fn: Callable[[str, str, dict[str, Any]], dict[str, Any]],
) -> str:
    data = request_fn(token, ADD_PROJECT_ITEM_MUTATION, {"projectId": project_id, "contentId": issue_node_id})
    created = data.get("addProjectV2ItemById") if isinstance(data.get("addProjectV2ItemById"), dict) else {}
    item = created.get("item") if isinstance(created.get("item"), dict) else {}
    item_id = str(item.get("id") or "")
    if not item_id:
        raise RuntimeError("Failed to add project item: missing item id.")
    return item_id


def _set_single_select_field(
    *,
    token: str,
    project_id: str,
    item_id: str,
    field_id: str,
    option_id: str,
    request_fn: Callable[[str, str, dict[str, Any]], dict[str, Any]],
) -> None:
    request_fn(
        token,
        SET_SINGLE_SELECT_MUTATION,
        {
            "projectId": project_id,
            "itemId": item_id,
            "fieldId": field_id,
            "optionId": option_id,
        },
    )


def _parse_positive_issue_number(raw_value: Any) -> int | None:
    if isinstance(raw_value, bool):
        return None
    try:
        issue_number = int(raw_value)
    except (TypeError, ValueError):
        return None
    return issue_number if issue_number > 0 else None


def _strip_issue_text(value: Any, *, lowercase: bool = False) -> str:
    normalized = str(value or "").strip()
    return normalized.lower() if lowercase else normalized


def _normalize_issue_row(row: dict[str, Any]) -> dict[str, Any] | None:
    issue_number = _parse_positive_issue_number(row.get("issue_number"))
    if issue_number is None:
        return None

    return {
        "issue_number": issue_number,
        "issue_node_id": _strip_issue_text(row.get("issue_node_id")),
        "fingerprint": _strip_issue_text(row.get("fingerprint")),
        "severity": _strip_issue_text(row.get("severity"), lowercase=True),
        "route": _strip_issue_text(row.get("route")),
        "surface": _strip_issue_text(row.get("surface")),
        "action": _strip_issue_text(row.get("action")),
    }


def _load_severe_issues(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError("issues-json must contain a JSON array.")

    deduped: dict[int, dict[str, Any]] = {}
    for row in payload:
        if not isinstance(row, dict):
            continue
        normalized = _normalize_issue_row(row)
        if normalized:
            deduped[int(normalized["issue_number"])] = normalized
    return list(deduped.values())


def _should_set_status_todo(current_status: str, target_status: str) -> bool:
    status = current_status.strip()
    if not status:
        return True
    if status.lower() in TERMINAL_STATUS_NAMES:
        return False
    return status != target_status


def _initialize_summary(
    *,
    repo: RepoRef,
    project_owner: str,
    project_number: int,
    lane_name: str,
    status_name: str,
    issue_count: int,
) -> dict[str, Any]:
    return {
        "repo": f"{repo.owner}/{repo.repo}",
        "project_owner": project_owner,
        "project_number": project_number,
        "project_url": "",
        "lane_name": lane_name,
        "status_name": status_name,
        "scanned": issue_count,
        "added": 0,
        "updated": 0,
        "lane_updates": 0,
        "status_updates": 0,
        "skipped": 0,
        "errors": 0,
        "results": [],
    }


def _resolve_issue_node(issue: dict[str, Any], *, token: str, repo: RepoRef, request_fn: Callable[[str, str, dict[str, Any]], dict[str, Any]]) -> str:
    issue_node_id = str(issue.get("issue_node_id") or "")
    if issue_node_id:
        return issue_node_id
    return _resolve_issue_node_id(
        token=token,
        repo=repo,
        issue_number=int(issue["issue_number"]),
        request_fn=request_fn,
    )


def _initial_sync_counters() -> dict[str, int]:
    return {"added": 0, "updated": 0, "lane_updates": 0, "status_updates": 0}


def _resolve_item_sync_context(
    token: str,
    project: ProjectRef,
    issue_number: int,
    issue_node_id: str,
    existing: dict[str, str] | None,
    dry_run: bool,
    request_fn: Callable[[str, str, dict[str, Any]], dict[str, Any]],
) -> tuple[str, str, str, bool]:
    if existing:
        return (
            str(existing.get("item_id") or ""),
            str(existing.get("lane_name") or ""),
            str(existing.get("status_name") or ""),
            False,
        )
    if dry_run:
        return f"dry-run-{issue_number}", "", "", True
    return (
        _add_project_item(
            token=token,
            project_id=project.project_id,
            issue_node_id=issue_node_id,
            request_fn=request_fn,
        ),
        "",
        "",
        True,
    )


def _sync_lane_value(
    token: str,
    project: ProjectRef,
    item_id: str,
    lane_current: str,
    lane_name: str,
    dry_run: bool,
    request_fn: Callable[[str, str, dict[str, Any]], dict[str, Any]],
) -> bool:
    lane_changed = lane_current != lane_name
    if lane_changed and not dry_run:
        _set_single_select_field(
            token=token,
            project_id=project.project_id,
            item_id=item_id,
            field_id=project.lane_field_id,
            option_id=project.lane_option_id,
            request_fn=request_fn,
        )
    return lane_changed


def _sync_status_value(
    token: str,
    project: ProjectRef,
    item_id: str,
    status_current: str,
    status_name: str,
    dry_run: bool,
    request_fn: Callable[[str, str, dict[str, Any]], dict[str, Any]],
) -> bool:
    status_changed = _should_set_status_todo(status_current, status_name)
    if status_changed and not dry_run:
        _set_single_select_field(
            token=token,
            project_id=project.project_id,
            item_id=item_id,
            field_id=project.status_field_id,
            option_id=project.status_option_id,
            request_fn=request_fn,
        )
    return status_changed


def _build_sync_result(
    issue_number: int,
    issue_node_id: str,
    added: bool,
    lane_changed: bool,
    status_changed: bool,
) -> dict[str, Any]:
    return {
        "issue_number": issue_number,
        "issue_node_id": issue_node_id,
        "result": "added" if added else "updated",
        "lane_changed": lane_changed,
        "status_changed": status_changed,
    }


def _sync_project_item(
    *,
    token: str,
    project: ProjectRef,
    issue: dict[str, Any],
    issue_node_id: str,
    existing: dict[str, str] | None,
    lane_name: str,
    status_name: str,
    dry_run: bool,
    request_fn: Callable[[str, str, dict[str, Any]], dict[str, Any]],
) -> tuple[dict[str, Any], dict[str, int]]:
    issue_number = int(issue["issue_number"])
    counters = _initial_sync_counters()
    item_id, lane_current, status_current, added = _resolve_item_sync_context(token, project, issue_number, issue_node_id, existing, dry_run, request_fn)
    counters["added"] = 1 if added else 0
    counters["updated"] = 0 if added else 1

    lane_changed = _sync_lane_value(token, project, item_id, lane_current, lane_name, dry_run, request_fn)
    if lane_changed:
        counters["lane_updates"] = 1

    status_changed = _sync_status_value(token, project, item_id, status_current, status_name, dry_run, request_fn)
    if status_changed:
        counters["status_updates"] = 1

    result = _build_sync_result(issue_number, issue_node_id, bool(counters["added"]), lane_changed, status_changed)
    return result, counters


def _maybe_skip_sync_run(
    *,
    summary: dict[str, Any],
    token: str,
    allow_skip_missing_token: bool,
    issue_count: int,
) -> dict[str, Any] | None:
    if not token:
        if allow_skip_missing_token:
            summary.update({"skipped": issue_count, "skip_reason": "missing_project_write_token", "skipped_run": True})
            return summary
        raise RuntimeError("Missing ROADMAP_PROJECT_WRITE_TOKEN.")
    if issue_count == 0:
        summary.update({"skip_reason": "no_severe_issues", "skipped_run": True})
        return summary
    return None


def _append_missing_node_error(summary: dict[str, Any], *, issue_number: int) -> None:
    summary["errors"] += 1
    summary["results"].append(
        {
            "issue_number": issue_number,
            "result": "error",
            "error": "issue_node_id_not_found",
        }
    )


def _apply_sync_counters(summary: dict[str, Any], counters: dict[str, int]) -> None:
    for key in ("added", "updated", "lane_updates", "status_updates"):
        summary[key] += counters[key]


def _sync_issues(
    *,
    summary: dict[str, Any],
    issues: list[dict[str, Any]],
    token: str,
    repo: RepoRef,
    project: ProjectRef,
    existing_items: dict[str, dict[str, str]],
    lane_name: str,
    status_name: str,
    dry_run: bool,
    request_fn: Callable[[str, str, dict[str, Any]], dict[str, Any]],
) -> None:
    for issue in issues:
        issue_node_id = _resolve_issue_node(issue, token=token, repo=repo, request_fn=request_fn)
        issue_number = int(issue["issue_number"])
        if not issue_node_id:
            _append_missing_node_error(summary, issue_number=issue_number)
            continue

        result, counters = _sync_project_item(
            token=token,
            project=project,
            issue=issue,
            issue_node_id=issue_node_id,
            existing=existing_items.get(issue_node_id),
            lane_name=lane_name,
            status_name=status_name,
            dry_run=dry_run,
            request_fn=request_fn,
        )
        summary["results"].append(result)
        _apply_sync_counters(summary, counters)


def _load_sync_inputs(
    *,
    repo: RepoRef,
    project_owner: str,
    project_number: int,
    lane_name: str,
    status_name: str,
    issues_path: Path,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    issues = _load_severe_issues(issues_path)
    summary = _initialize_summary(
        repo=repo,
        project_owner=project_owner,
        project_number=project_number,
        lane_name=lane_name,
        status_name=status_name,
        issue_count=len(issues),
    )
    return issues, summary


def _load_project_sync_context(
    *,
    token: str,
    project_owner: str,
    project_number: int,
    lane_name: str,
    status_name: str,
    request_fn: Callable[[str, str, dict[str, Any]], dict[str, Any]],
) -> tuple[ProjectRef, dict[str, dict[str, str]]]:
    project = _resolve_project(
        token=token,
        project_owner=project_owner,
        project_number=project_number,
        lane_name=lane_name,
        status_name=status_name,
        request_fn=request_fn,
    )
    existing_items = _list_project_issue_items(token=token, project_id=project.project_id, request_fn=request_fn)
    return project, existing_items


def _raise_if_sync_errors(summary: dict[str, Any]) -> None:
    if summary["errors"] <= 0:
        return
    raise RuntimeError(
        "Project sync completed with errors "
        f"(errors={summary['errors']}, added={summary['added']}, updated={summary['updated']})."
    )


def run_sync(*, token: str, repo: RepoRef, project_owner: str, project_number: int, issues_path: Path, lane_name: str, status_name: str, dry_run: bool, allow_skip_missing_token: bool, request_fn: Callable[[str, str, dict[str, Any]], dict[str, Any]]) -> dict[str, Any]:
    issues, summary = _load_sync_inputs(
        repo=repo,
        project_owner=project_owner,
        project_number=project_number,
        lane_name=lane_name,
        status_name=status_name,
        issues_path=issues_path,
    )

    skipped_summary = _maybe_skip_sync_run(
        summary=summary,
        token=token,
        allow_skip_missing_token=allow_skip_missing_token,
        issue_count=len(issues),
    )
    if skipped_summary is not None:
        return skipped_summary

    project, existing_items = _load_project_sync_context(
        token=token,
        project_owner=project_owner,
        project_number=project_number,
        lane_name=lane_name,
        status_name=status_name,
        request_fn=request_fn,
    )
    summary["project_url"] = project.project_url

    _sync_issues(
        summary=summary,
        issues=issues,
        token=token,
        repo=repo,
        project=project,
        existing_items=existing_items,
        lane_name=lane_name,
        status_name=status_name,
        dry_run=dry_run,
        request_fn=request_fn,
    )
    _raise_if_sync_errors(summary)
    return summary


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, help="Repository in owner/repo format.")
    parser.add_argument("--project-owner", default="Prekzursil", help="Project owner login.")
    parser.add_argument("--project-number", type=int, default=2, help="ProjectV2 number.")
    parser.add_argument("--issues-json", required=True, help="Path to severe issues handoff JSON.")
    parser.add_argument("--lane-name", default="Now", help="Roadmap Lane option name.")
    parser.add_argument("--status-name", default="Todo", help="Status option name.")
    parser.add_argument("--summary-output", default="", help="Optional output path for summary JSON.")
    parser.add_argument("--dry-run", action="store_true", help="Do not mutate project items.")
    parser.add_argument(
        "--allow-skip-missing-token",
        action="store_true",
        help="Exit 0 with a skipped summary when ROADMAP_PROJECT_WRITE_TOKEN is missing.",
    )
    return parser.parse_args()


def _parse_main_context(args: argparse.Namespace) -> tuple[RepoRef, str, int, Path, Path | None]:
    repo = _parse_repo(args.repo)
    project_owner = _validate_identifier(args.project_owner, label="project owner")
    project_number = int(args.project_number)
    if project_number <= 0:
        raise ValueError("project-number must be a positive integer.")

    issues_path = _resolve_repo_path(
        args.issues_json,
        allowed_prefixes=("artifacts/audit-evidence", "artifacts/audit-evidence-local"),
    )
    if not issues_path.exists():
        raise FileNotFoundError(f"Issues JSON not found: {issues_path}")

    summary_path = None
    if args.summary_output:
        summary_path = _resolve_repo_path(
            args.summary_output,
            allowed_prefixes=("artifacts/audit-evidence", "artifacts/audit-evidence-local"),
        )

    return repo, project_owner, project_number, issues_path, summary_path


def main() -> int:
    args = _parse_args()
    repo, project_owner, project_number, issues_path, summary_path = _parse_main_context(args)

    token = (os.environ.get("ROADMAP_PROJECT_WRITE_TOKEN") or "").strip()
    summary = run_sync(
        token=token,
        repo=repo,
        project_owner=project_owner,
        project_number=project_number,
        issues_path=issues_path,
        lane_name=str(args.lane_name).strip() or "Now",
        status_name=str(args.status_name).strip() or "Todo",
        dry_run=bool(args.dry_run),
        allow_skip_missing_token=bool(args.allow_skip_missing_token),
        request_fn=_graphql_request,
    )

    if summary_path is not None:
        _write_json(summary_path, summary)

    print(
        "Project sync summary: "
        f"scanned={summary.get('scanned', 0)} "
        f"added={summary.get('added', 0)} "
        f"updated={summary.get('updated', 0)} "
        f"lane_updates={summary.get('lane_updates', 0)} "
        f"status_updates={summary.get('status_updates', 0)} "
        f"skipped_reason={summary.get('skip_reason', '') or 'none'}"
    )
    if summary.get("project_url"):
        print(f"Target project: {summary['project_url']}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # pragma: no cover - defensive CLI guard
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from exc
