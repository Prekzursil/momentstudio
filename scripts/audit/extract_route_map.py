#!/usr/bin/env python3
"""Extract a deterministic route and surface map from Angular routes file."""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PATH_RE = re.compile(r"path:\s*'([^']*)'")
TITLE_RE = re.compile(r"title:\s*'([^']+)'")
ROBOTS_RE = re.compile(r"robots:\s*([A-Za-z0-9_:'\",\\-]+)")


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
class BlockRange:
    start: int
    end: int

    def contains(self, offset: int) -> bool:
        return self.start <= offset <= self.end


def _find_matching_bracket(text: str, start_idx: int) -> int:
    depth = 0
    in_string = False
    string_quote = ""
    escaped = False
    for idx in range(start_idx, len(text)):
        ch = text[idx]
        if in_string:
            if escaped:
                escaped = False
                continue
            if ch == "\\":
                escaped = True
                continue
            if ch == string_quote:
                in_string = False
                string_quote = ""
            continue
        if ch in ("'", '"'):
            in_string = True
            string_quote = ch
            continue
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                return idx
    raise ValueError(f"Could not find matching bracket for index {start_idx}")


def _find_children_range(source: str, anchor: str) -> BlockRange | None:
    anchor_idx = source.find(anchor)
    if anchor_idx < 0:
        return None
    children_idx = source.find("children", anchor_idx)
    if children_idx < 0:
        return None
    open_idx = source.find("[", children_idx)
    if open_idx < 0:
        return None
    close_idx = _find_matching_bracket(source, open_idx)
    return BlockRange(start=open_idx, end=close_idx)


def _extract_context_block(source: str, offset: int, span: int = 480) -> str:
    return source[offset : min(len(source), offset + span)]


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


def extract_route_map(routes_file: Path) -> dict[str, Any]:
    source = routes_file.read_text(encoding="utf-8")
    account_children = _find_children_range(source, "path: 'account'")
    admin_children = _find_children_range(source, "path: 'admin'")
    admin_content_children = _find_children_range(source, "path: 'content'")

    rows: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()

    for match in PATH_RE.finditer(source):
        raw_path = match.group(1)
        start = match.start()
        prefix = ""

        if admin_content_children and admin_content_children.contains(start):
            prefix = "/admin/content"
        elif admin_children and admin_children.contains(start):
            prefix = "/admin"
        elif account_children and account_children.contains(start):
            prefix = "/account"

        full_path = _to_full_path(prefix, raw_path)
        surface = _surface_for_path(full_path)
        key = (full_path, surface)
        if key in seen:
            continue
        seen.add(key)

        context = _extract_context_block(source, start)
        title_match = TITLE_RE.search(context)
        robots_match = ROBOTS_RE.search(context)

        rows.append(
            {
                "raw_path": raw_path,
                "prefix": prefix or "/",
                "full_path": full_path,
                "surface": surface,
                "title_key": title_match.group(1) if title_match else None,
                "robots_hint": robots_match.group(1) if robots_match else None,
            }
        )

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
