#!/usr/bin/env python3
"""Extract a deterministic route and surface map from Angular routes file."""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


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
class ParsedExpression:
    value: str


@dataclass(frozen=True)
class ParsedObject:
    values: dict[str, Any]
    start: int
    end: int


def _skip_whitespace_and_comments(source: str, idx: int) -> int:
    while idx < len(source):
        if source.startswith("//", idx):
            idx = source.find("\n", idx)
            if idx < 0:
                return len(source)
            continue
        if source.startswith("/*", idx):
            end = source.find("*/", idx + 2)
            if end < 0:
                return len(source)
            idx = end + 2
            continue
        if source[idx].isspace():
            idx += 1
            continue
        break
    return idx


def _read_quoted_string(source: str, idx: int) -> tuple[str, int]:
    quote = source[idx]
    idx += 1
    escaped = False
    chunks: list[str] = []
    while idx < len(source):
        ch = source[idx]
        if escaped:
            chunks.append(ch)
            escaped = False
            idx += 1
            continue
        if ch == "\\":
            escaped = True
            idx += 1
            continue
        if ch == quote:
            return "".join(chunks), idx + 1
        chunks.append(ch)
        idx += 1
    raise ValueError("Unterminated quoted string in routes file")


def _read_identifier(source: str, idx: int) -> tuple[str, int]:
    start = idx
    while idx < len(source) and (source[idx].isalnum() or source[idx] in ("_", "$")):
        idx += 1
    if idx == start:
        raise ValueError(f"Expected identifier at offset {idx}")
    return source[start:idx], idx


def _consume_expression_value(source: str, idx: int) -> tuple[str, int]:
    start = idx
    paren_depth = 0
    bracket_depth = 0
    brace_depth = 0
    while idx < len(source):
        idx = _skip_whitespace_and_comments(source, idx)
        if idx >= len(source):
            break
        ch = source[idx]
        if ch in ("'", '"'):
            _, idx = _read_quoted_string(source, idx)
            continue
        if ch == "(":
            paren_depth += 1
        elif ch == ")":
            if paren_depth > 0:
                paren_depth -= 1
        elif ch == "[":
            bracket_depth += 1
        elif ch == "]":
            if bracket_depth > 0:
                bracket_depth -= 1
            elif paren_depth == 0 and brace_depth == 0:
                break
        elif ch == "{":
            brace_depth += 1
        elif ch == "}":
            if brace_depth > 0:
                brace_depth -= 1
            elif paren_depth == 0 and bracket_depth == 0:
                break
        elif ch == "," and paren_depth == 0 and bracket_depth == 0 and brace_depth == 0:
            break
        idx += 1
    return source[start:idx].strip(), idx


def _parse_value(source: str, idx: int) -> tuple[Any, int]:
    idx = _skip_whitespace_and_comments(source, idx)
    if idx >= len(source):
        return None, idx
    ch = source[idx]
    if ch in ("'", '"'):
        return _read_quoted_string(source, idx)
    if ch == "{":
        obj, next_idx = _parse_object(source, idx)
        return obj.values, next_idx
    if ch == "[":
        return _parse_array(source, idx)
    raw, next_idx = _consume_expression_value(source, idx)
    return ParsedExpression(raw), next_idx


def _parse_object(source: str, idx: int) -> tuple[ParsedObject, int]:
    if source[idx] != "{":
        raise ValueError(f"Expected object start at offset {idx}")
    start = idx
    idx += 1
    values: dict[str, Any] = {}

    while idx < len(source):
        idx = _skip_whitespace_and_comments(source, idx)
        if idx >= len(source):
            break
        if source[idx] == "}":
            return ParsedObject(values=values, start=start, end=idx), idx + 1
        if source[idx] in ("'", '"'):
            key, idx = _read_quoted_string(source, idx)
        else:
            key, idx = _read_identifier(source, idx)
        idx = _skip_whitespace_and_comments(source, idx)
        if idx >= len(source) or source[idx] != ":":
            # Unsupported shorthand property; consume until delimiter.
            _, idx = _consume_expression_value(source, idx)
            idx = _skip_whitespace_and_comments(source, idx)
            if idx < len(source) and source[idx] == ",":
                idx += 1
            continue
        idx += 1
        value, idx = _parse_value(source, idx)
        values[key] = value
        idx = _skip_whitespace_and_comments(source, idx)
        if idx < len(source) and source[idx] == ",":
            idx += 1
    raise ValueError(f"Unterminated object starting at offset {start}")


def _parse_array(source: str, idx: int) -> tuple[list[Any], int]:
    if source[idx] != "[":
        raise ValueError(f"Expected array start at offset {idx}")
    idx += 1
    items: list[Any] = []
    while idx < len(source):
        idx = _skip_whitespace_and_comments(source, idx)
        if idx >= len(source):
            break
        if source[idx] == "]":
            return items, idx + 1
        value, idx = _parse_value(source, idx)
        items.append(value)
        idx = _skip_whitespace_and_comments(source, idx)
        if idx < len(source) and source[idx] == ",":
            idx += 1
    raise ValueError("Unterminated array in routes file")


def _extract_routes_array(source: str) -> list[Any]:
    routes_anchor = source.find("routes")
    search_start = 0 if routes_anchor < 0 else routes_anchor
    open_idx = source.find("[", search_start)
    if open_idx < 0:
        return []
    routes, _ = _parse_array(source, open_idx)
    return routes


def _to_full_path(prefix: str, raw_path: str) -> str:
    pfx = (prefix or "").strip()
    raw = (raw_path or "").strip()
    if not raw:
        return pfx if pfx else "/"
    if raw.startswith("/"):
        return raw
    if not pfx:
        return f"/{raw}"
    return f"{pfx.rstrip('/')}/{raw}"


def _surface_for_path(path: str) -> str:
    if path.startswith("/admin"):
        return "admin"
    if path.startswith("/account") or path.startswith("/tickets"):
        return "account"
    return "storefront"


def _extract_robots_hint(route: dict[str, Any]) -> str | None:
    robots = route.get("robots")
    if isinstance(robots, str) and robots.strip():
        return robots
    if isinstance(robots, ParsedExpression) and robots.value.strip():
        return robots.value
    data = route.get("data")
    if isinstance(data, dict):
        data_robots = data.get("robots")
        if isinstance(data_robots, str) and data_robots.strip():
            return data_robots
        if isinstance(data_robots, ParsedExpression) and data_robots.value.strip():
            return data_robots.value
    return None


def _collect_rows(
    routes: list[Any],
    *,
    prefix: str,
    rows: list[dict[str, Any]],
    seen: set[tuple[str, str]],
) -> None:
    for route in routes:
        if not isinstance(route, dict):
            continue
        raw_path = route.get("path")
        if not isinstance(raw_path, str):
            continue

        full_path = _to_full_path(prefix, raw_path)
        surface = _surface_for_path(full_path)
        key = (full_path, surface)
        if key not in seen:
            seen.add(key)
            title = route.get("title")
            rows.append(
                {
                    "raw_path": raw_path,
                    "prefix": prefix or "/",
                    "full_path": full_path,
                    "surface": surface,
                    "title_key": title if isinstance(title, str) else None,
                    "robots_hint": _extract_robots_hint(route),
                }
            )

        children = route.get("children")
        if isinstance(children, list):
            _collect_rows(children, prefix=full_path, rows=rows, seen=seen)


def extract_route_map(routes_file: Path) -> dict[str, Any]:
    source = routes_file.read_text(encoding="utf-8")
    parsed_routes = _extract_routes_array(source)
    rows: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    _collect_rows(parsed_routes, prefix="", rows=rows, seen=seen)

    rows.sort(key=lambda item: (item["surface"], item["full_path"]))
    by_surface: dict[str, int] = {"storefront": 0, "account": 0, "admin": 0}
    for row in rows:
        by_surface[row["surface"]] = by_surface.get(row["surface"], 0) + 1

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_file": str(routes_file.as_posix()),
        "summary": {"total_routes": len(rows), "by_surface": by_surface},
        "routes": rows,
    }


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--routes-file",
        default="frontend/src/app/app.routes.ts",
        help="Path to Angular routes file.",
    )
    parser.add_argument(
        "--out",
        default="artifacts/audit-evidence/route-map.json",
        help="Output JSON file path.",
    )
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    routes_file = _resolve_repo_path(args.routes_file, allowed_prefixes=("frontend",))
    out_path = _resolve_repo_path(args.out, allowed_prefixes=("artifacts",))
    if routes_file.suffix != ".ts":
        raise ValueError("Routes file must be a TypeScript file.")
    if out_path.suffix != ".json":
        raise ValueError("Output file must be a JSON file.")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    route_map = extract_route_map(routes_file)
    out_path.write_text(json.dumps(route_map, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote route map to {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
