#!/usr/bin/env python3
"""Collect deterministic evidence artifacts for UX/IA and correctness audits."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SEVERITY_TO_IMPACT = {"s1": 5, "s2": 4, "s3": 2, "s4": 1}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _fingerprint(route: str, rule_id: str, primary_file: str, surface: str) -> str:
    payload = "||".join(
        [
            " ".join((route or "").strip().lower().split()),
            " ".join((rule_id or "").strip().lower().split()),
            " ".join((primary_file or "").strip().lower().split()),
            " ".join((surface or "").strip().lower().split()),
        ]
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _run(cmd: list[str], *, cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        check=True,
        text=True,
        capture_output=True,
    )


def _load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _load_changed_files(path: Path | None) -> list[str]:
    if not path or not path.exists():
        return []
    return [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def _infer_surfaces_from_changes(changed_files: list[str]) -> set[str]:
    if not changed_files:
        return {"storefront", "account", "admin"}

    surfaces: set[str] = set()
    for file in changed_files:
        f = file.replace("\\", "/")
        if "/pages/admin/" in f or "/app/api/v1/content.py" in f or "/services/media_" in f:
            surfaces.add("admin")
        if "/pages/account/" in f or "/app/api/v1/account" in f or "/services/account" in f:
            surfaces.add("account")
        if "/pages/blog/" in f or "/pages/shop/" in f or "/layout/" in f or "/pages/home/" in f:
            surfaces.add("storefront")

    if not surfaces:
        return {"storefront", "account", "admin"}
    return surfaces


def _routes_for_mode(route_map: dict[str, Any], *, changed_files: list[str], max_routes: int) -> list[dict[str, Any]]:
    routes = list(route_map.get("routes") or [])
    if not routes:
        return []

    surfaces = _infer_surfaces_from_changes(changed_files)
    selected = [row for row in routes if row.get("surface") in surfaces]
    selected.sort(key=lambda item: (item.get("surface", ""), item.get("full_path", "")))
    return selected[:max_routes]


def _browser_collect(
    *,
    repo_root: Path,
    base_url: str,
    selected_routes_path: Path,
    output_dir: Path,
    max_routes: int,
) -> tuple[bool, str]:
    script = repo_root / "scripts" / "audit" / "collect_browser_evidence.mjs"
    cmd = [
        "node",
        str(script),
        "--base-url",
        base_url,
        "--routes-json",
        str(selected_routes_path),
        "--output-dir",
        str(output_dir),
        "--max-routes",
        str(max_routes),
    ]
    try:
        proc = _run(cmd, cwd=repo_root)
        return True, (proc.stdout or "").strip()
    except subprocess.CalledProcessError as exc:
        err = (exc.stderr or exc.stdout or str(exc)).strip()
        return False, err


def _finding(
    *,
    title: str,
    description: str,
    severity: str,
    route: str,
    surface: str,
    rule_id: str,
    primary_file: str,
    evidence_files: list[str],
    effort: str,
) -> dict[str, Any]:
    return {
        "fingerprint": _fingerprint(route, rule_id, primary_file, surface),
        "title": title,
        "description": description,
        "severity": severity,
        "impact": SEVERITY_TO_IMPACT.get(severity, 1),
        "effort": effort,
        "route": route,
        "surface": surface,
        "rule_id": rule_id,
        "primary_file": primary_file,
        "evidence_files": evidence_files,
        "labels": [f"severity:{severity}", f"surface:{surface}", "audit:correctness"],
    }


def _build_deterministic_findings(
    *,
    seo_snapshot: list[dict[str, Any]],
    console_errors: list[dict[str, Any]],
    layout_signals: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []

    for row in seo_snapshot:
        route = str(row.get("route") or "/")
        surface = str(row.get("surface") or "storefront")
        title = str(row.get("title") or "").strip()
        canonical = str(row.get("canonical") or "").strip()
        h1_count = int(row.get("h1_count") or 0)
        render_error = str(row.get("error") or "").strip()

        if render_error:
            findings.append(
                _finding(
                    title=f"Route render error on `{route}`",
                    description=render_error,
                    severity="s2",
                    route=route,
                    surface=surface,
                    rule_id="route_render_error",
                    primary_file="scripts/audit/collect_browser_evidence.mjs",
                    evidence_files=["seo-snapshot.json", "console-errors.json"],
                    effort="M",
                )
            )
            continue

        if not title:
            findings.append(
                _finding(
                    title=f"Missing title on `{route}`",
                    description="Route has an empty document title.",
                    severity="s2",
                    route=route,
                    surface=surface,
                    rule_id="seo_missing_title",
                    primary_file="frontend/src/app/app.routes.ts",
                    evidence_files=["seo-snapshot.json"],
                    effort="S",
                )
            )

        if surface == "storefront" and h1_count == 0:
            findings.append(
                _finding(
                    title=f"Missing H1 on storefront route `{route}`",
                    description="Storefront route rendered without a primary H1 heading.",
                    severity="s2",
                    route=route,
                    surface=surface,
                    rule_id="ux_missing_h1",
                    primary_file="frontend/src/app/app.routes.ts",
                    evidence_files=["seo-snapshot.json"],
                    effort="M",
                )
            )
        elif h1_count > 1:
            findings.append(
                _finding(
                    title=f"Multiple H1 headings on `{route}`",
                    description=f"Found {h1_count} H1 elements. This can hurt IA clarity.",
                    severity="s3",
                    route=route,
                    surface=surface,
                    rule_id="ux_multiple_h1",
                    primary_file="frontend/src/app/app.routes.ts",
                    evidence_files=["seo-snapshot.json"],
                    effort="M",
                )
            )

        if surface == "storefront" and not canonical:
            findings.append(
                _finding(
                    title=f"Missing canonical link on `{route}`",
                    description="Storefront route did not expose a canonical URL.",
                    severity="s3",
                    route=route,
                    surface=surface,
                    rule_id="seo_missing_canonical",
                    primary_file="frontend/src/app/core/seo-head-links.service.ts",
                    evidence_files=["seo-snapshot.json"],
                    effort="S",
                )
            )

    for row in console_errors:
        route = str(row.get("route") or "/")
        surface = str(row.get("surface") or "storefront")
        text = str(row.get("text") or "").strip()
        if not text:
            continue
        severity = str(row.get("severity") or "s3")
        findings.append(
            _finding(
                title=f"Browser error on `{route}`",
                description=text[:500],
                severity=severity if severity in {"s1", "s2", "s3", "s4"} else "s3",
                route=route,
                surface=surface,
                rule_id="browser_console_error",
                primary_file="scripts/audit/collect_browser_evidence.mjs",
                evidence_files=["console-errors.json"],
                effort="M",
            )
        )

    for row in layout_signals:
        route = str(row.get("route") or "/")
        surface = str(row.get("surface") or "storefront")
        nested = int(row.get("nested_scrollables_count") or 0)
        sticky = int(row.get("sticky_count") or 0)
        if nested > 0:
            findings.append(
                _finding(
                    title=f"Nested scrollables on `{route}`",
                    description=f"Detected {nested} nested scrollable container(s), often linked to awkward UX.",
                    severity="s2",
                    route=route,
                    surface=surface,
                    rule_id="ux_nested_scrollables",
                    primary_file="scripts/audit/collect_browser_evidence.mjs",
                    evidence_files=["layout-signals.json"],
                    effort="M",
                )
            )
        if sticky > 6:
            findings.append(
                _finding(
                    title=f"High sticky-control density on `{route}`",
                    description=f"Detected {sticky} sticky elements; control surfaces may be overloaded.",
                    severity="s3",
                    route=route,
                    surface=surface,
                    rule_id="ux_sticky_overload",
                    primary_file="scripts/audit/collect_browser_evidence.mjs",
                    evidence_files=["layout-signals.json"],
                    effort="M",
                )
            )

    deduped: dict[str, dict[str, Any]] = {}
    for item in findings:
        deduped[item["fingerprint"]] = item
    ordered = sorted(
        deduped.values(),
        key=lambda item: (
            {"s1": 0, "s2": 1, "s3": 2, "s4": 3}.get(item["severity"], 9),
            item["surface"],
            item["route"],
            item["rule_id"],
        ),
    )
    return ordered


def _write_evidence_index(
    *,
    output_dir: Path,
    mode: str,
    base_url: str | None,
    route_map: dict[str, Any],
    selected_routes: list[dict[str, Any]],
    findings: list[dict[str, Any]],
    browser_ok: bool,
    browser_message: str,
) -> None:
    by_surface = route_map.get("summary", {}).get("by_surface", {})
    lines = [
        "# Audit Evidence Pack",
        "",
        f"- Generated at: `{_now_iso()}`",
        f"- Mode: `{mode}`",
        f"- Base URL: `{base_url or 'n/a'}`",
        f"- Browser collection: `{'ok' if browser_ok else 'skipped_or_failed'}`",
        "",
        "## Route coverage",
        "",
        f"- Total routes discovered: `{route_map.get('summary', {}).get('total_routes', 0)}`",
        f"- Selected routes for this run: `{len(selected_routes)}`",
        f"- Storefront routes discovered: `{by_surface.get('storefront', 0)}`",
        f"- Account routes discovered: `{by_surface.get('account', 0)}`",
        f"- Admin routes discovered: `{by_surface.get('admin', 0)}`",
        "",
        "## Deterministic findings",
        "",
        f"- Total findings: `{len(findings)}`",
        f"- Severe findings (s1/s2): `{sum(1 for f in findings if f.get('severity') in {'s1', 's2'})}`",
        "",
        "## Artifact files",
        "",
        "- `route-map.json`",
        "- `surface-map.json`",
        "- `seo-snapshot.json`",
        "- `console-errors.json`",
        "- `layout-signals.json`",
        "- `deterministic-findings.json`",
        "- `screenshots/`",
    ]
    if browser_message:
        lines.extend(["", "## Browser collector output", "", "```text", browser_message, "```"])
    (output_dir / "evidence-index.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=["pr", "weekly"], default="pr")
    parser.add_argument("--routes-file", default="frontend/src/app/app.routes.ts")
    parser.add_argument("--output-dir", default="artifacts/audit-evidence")
    parser.add_argument("--base-url", default="")
    parser.add_argument("--changed-files-file", default="")
    parser.add_argument("--max-routes", type=int, default=40)
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    repo_root = Path(__file__).resolve().parents[2]
    output_dir = (repo_root / args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    route_map_path = output_dir / "route-map.json"
    _run(
        [
            sys.executable,
            str(repo_root / "scripts" / "audit" / "extract_route_map.py"),
            "--routes-file",
            str((repo_root / args.routes_file).resolve()),
            "--out",
            str(route_map_path),
        ],
        cwd=repo_root,
    )
    route_map = _load_json(route_map_path, default={"routes": [], "summary": {}})

    changed_files = _load_changed_files((repo_root / args.changed_files_file).resolve() if args.changed_files_file else None)
    selected_routes = _routes_for_mode(route_map, changed_files=changed_files, max_routes=max(1, int(args.max_routes)))
    _write_json(
        output_dir / "surface-map.json",
        {
            "generated_at": _now_iso(),
            "mode": args.mode,
            "selected_surfaces": sorted({row.get("surface") for row in selected_routes}),
            "selected_route_count": len(selected_routes),
            "selected_routes": selected_routes,
        },
    )
    _write_json(output_dir / "selected-routes.json", {"routes": selected_routes})

    browser_ok = False
    browser_message = ""
    if args.base_url.strip():
        browser_ok, browser_message = _browser_collect(
            repo_root=repo_root,
            base_url=args.base_url.strip(),
            selected_routes_path=output_dir / "selected-routes.json",
            output_dir=output_dir,
            max_routes=max(1, int(args.max_routes)),
        )

    if not (output_dir / "seo-snapshot.json").exists():
        _write_json(output_dir / "seo-snapshot.json", [])
    if not (output_dir / "console-errors.json").exists():
        _write_json(output_dir / "console-errors.json", [])
    if not (output_dir / "layout-signals.json").exists():
        _write_json(output_dir / "layout-signals.json", [])
    (output_dir / "screenshots").mkdir(parents=True, exist_ok=True)

    seo_snapshot = _load_json(output_dir / "seo-snapshot.json", default=[])
    console_errors = _load_json(output_dir / "console-errors.json", default=[])
    layout_signals = _load_json(output_dir / "layout-signals.json", default=[])
    findings = _build_deterministic_findings(
        seo_snapshot=seo_snapshot if isinstance(seo_snapshot, list) else [],
        console_errors=console_errors if isinstance(console_errors, list) else [],
        layout_signals=layout_signals if isinstance(layout_signals, list) else [],
    )
    _write_json(output_dir / "deterministic-findings.json", findings)

    _write_evidence_index(
        output_dir=output_dir,
        mode=args.mode,
        base_url=args.base_url.strip() or None,
        route_map=route_map if isinstance(route_map, dict) else {},
        selected_routes=selected_routes,
        findings=findings,
        browser_ok=browser_ok,
        browser_message=browser_message,
    )

    severe = sum(1 for row in findings if row.get("severity") in {"s1", "s2"})
    print(
        f"Evidence pack ready at {output_dir}. "
        f"routes={len(selected_routes)} findings={len(findings)} severe={severe} browser_ok={browser_ok}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

