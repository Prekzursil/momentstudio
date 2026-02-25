#!/usr/bin/env python3
"""Collect deterministic evidence artifacts for UX/IA and correctness audits."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse


SEVERITY_TO_IMPACT = {"s1": 5, "s2": 4, "s3": 2, "s4": 1}
SEO_SNAPSHOT_FILE = "seo-snapshot.json"
CONSOLE_ERRORS_FILE = "console-errors.json"
LAYOUT_SIGNALS_FILE = "layout-signals.json"
VISIBILITY_SIGNALS_FILE = "visibility-signals.json"
DETERMINISTIC_FINDINGS_FILE = "deterministic-findings.json"
CONSOLE_NOISE_TELEMETRY_FILE = "console-noise-telemetry.json"
UNEXPECTED_TOKEN_LT_QUOTED = "unexpected token '<'"
UNEXPECTED_TOKEN_LT_RAW = "unexpected token <"
API_PATH_TOKEN = "/api/"
URL_SCHEME_PATTERN = re.compile(r"(?i)^[a-z][a-z0-9+.-]*://")
URL_TOKEN_PATTERN = re.compile(r"(?:[a-zA-Z][a-zA-Z0-9+.-]*://[^\s|)]+|/api/[^\s|)]+)")


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


def _validate_base_url(raw: str) -> str:
    value = raw.strip()
    if not value:
        return ""
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("base-url must be an http/https URL with host.")
    return value


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


def _run_python(args: list[str], *, cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    cmd = [sys.executable, *args]
    return subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        check=True,
        text=True,
        capture_output=True,
    )


def _run_node(args: list[str], *, cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    cmd = ["node", *args]
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


def _normalize_whitespace_lower(value: str) -> str:
    return " ".join(str(value or "").split()).lower()


def _parse_optional_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    text = str(value or "").strip()
    if not text:
        return None
    if text.isdigit():
        return int(text)
    match = re.search(r"(\d{3})", text)
    if not match:
        return None
    try:
        return int(match.group(1))
    except Exception:
        return None


def _has_unexpected_token_lt(text: str) -> bool:
    return UNEXPECTED_TOKEN_LT_QUOTED in text or UNEXPECTED_TOKEN_LT_RAW in text


def _has_benign_source_context(row: dict[str, Any]) -> bool:
    source_url = str(row.get("source_url") or "").strip().lower()
    source_looks_like_bundle = source_url.endswith(".js") or any(
        token in source_url for token in ("/main.", "/polyfills.", "/runtime.", "/vendor.")
    )
    has_source_position = _parse_optional_int(row.get("line")) is not None and _parse_optional_int(row.get("column")) is not None
    return source_looks_like_bundle or has_source_position


def _has_benign_storefront_context(row: dict[str, Any], message: str) -> bool:
    if str(row.get("surface") or "").strip().lower() != "storefront":
        return False
    if ":" in str(row.get("route") or "").strip():
        return False
    request_url = str(row.get("request_url") or "").strip().lower()
    return API_PATH_TOKEN in request_url or API_PATH_TOKEN in message


def _is_benign_storefront_unexpected_token(row: dict[str, Any]) -> bool:
    message = _normalize_whitespace_lower(str(row.get("text") or ""))
    if not _has_unexpected_token_lt(message):
        return False
    if not _has_benign_storefront_context(row, message):
        return False
    if not _has_benign_source_context(row):
        return False
    status_code = _parse_optional_int(row.get("status_code"))
    return status_code is None or status_code >= 400


def _build_console_noise_telemetry(console_errors: list[dict[str, Any]]) -> dict[str, Any]:
    clusters: dict[str, dict[str, Any]] = {}
    for row in console_errors:
        if not _is_benign_storefront_unexpected_token(row):
            continue
        signature_payload = "||".join(
            [
                str(row.get("surface") or "storefront"),
                _normalize_whitespace_lower(str(row.get("text") or "")),
                str(_parse_optional_int(row.get("status_code")) or "none"),
                str(row.get("request_url") or ""),
            ]
        )
        signature = hashlib.sha256(signature_payload.encode("utf-8")).hexdigest()[:12]
        cluster = clusters.setdefault(
            signature,
            {
                "signature": signature,
                "surface": "storefront",
                "message": str(row.get("text") or "")[:500],
                "status_code": _parse_optional_int(row.get("status_code")),
                "request_url": str(row.get("request_url") or "") or None,
                "sample_routes": [],
                "cluster_count": 0,
            },
        )
        route = str(row.get("route") or "").strip()
        if route and route not in cluster["sample_routes"] and len(cluster["sample_routes"]) < 8:
            cluster["sample_routes"].append(route)
        cluster["cluster_count"] += 1

    ordered = sorted(clusters.values(), key=lambda item: (-int(item["cluster_count"]), str(item["signature"])))
    suppressed_count = sum(int(item["cluster_count"]) for item in ordered)
    return {
        "suppressed_finding_rule": "browser_console_noise_cluster",
        "suppressed_cluster_count": len(ordered),
        "suppressed_event_count": suppressed_count,
        "clusters": ordered,
    }


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
    api_base_url: str,
    selected_routes_path: Path,
    output_dir: Path,
    max_routes: int,
    owner_identifier: str,
    owner_password: str,
) -> tuple[bool, str]:
    script = repo_root / "scripts" / "audit" / "collect_browser_evidence.mjs"
    cmd = [
        str(script),
        "--base-url",
        base_url,
        "--api-base-url",
        api_base_url or base_url,
        "--routes-json",
        str(selected_routes_path),
        "--output-dir",
        str(output_dir),
        "--max-routes",
        str(max_routes),
        "--route-samples",
        str(repo_root / "scripts" / "audit" / "fixtures" / "route-samples.json"),
    ]
    if owner_identifier.strip() and owner_password.strip():
        cmd.extend(
            [
                "--auth-mode",
                "owner",
                "--owner-identifier",
                owner_identifier.strip(),
                "--owner-password",
                owner_password.strip(),
            ]
        )
    try:
        proc = _run_node(cmd, cwd=repo_root)
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
    audit_label: str = "audit:correctness",
    indexable: bool | None = None,
) -> dict[str, Any]:
    payload = {
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
        "labels": [f"severity:{severity}", f"surface:{surface}", audit_label],
    }
    if indexable is not None:
        payload["indexable"] = bool(indexable)
    return payload


def _compact_console_noise_text(text: str) -> str:
    compact = re.sub(r"\b[a-zA-Z][a-zA-Z0-9+.-]*://", "url://", text)
    compact = compact.replace("127.0.0.1", "host").replace("localhost", "host")
    while "//" in compact:
        compact = compact.replace("//", "/")
    return compact


def _normalize_console_noise_signature(message: str) -> str:
    text = _normalize_whitespace_lower(str(message or ""))
    if not text:
        return ""
    if _has_unexpected_token_lt(text):
        return "unexpected_token_lt_json_parse"
    if "executing inline script violates the following content security policy directive" in text:
        return "csp_inline_script_blocked"
    if any(token in text for token in ("private access token challenge", "turnstile", "cloudflare challenge")):
        return "cloudflare_challenge_noise"
    if "was preloaded using link preload but not used within a few seconds" in text:
        return "unused_preload_warning"
    return _compact_console_noise_text(text)


def _is_api_noise_message(message: str) -> bool:
    text = _normalize_whitespace_lower(str(message or ""))
    if not text:
        return False
    patterns = (
        API_PATH_TOKEN,
        "net::err_connection_refused",
        "failed to load resource",
        "status of 404",
        "httperrorresponse",
        "failed to fetch",
        "networkerror when attempting to fetch resource",
        "xmlhttprequest",
        "response with status",
        UNEXPECTED_TOKEN_LT_QUOTED,
        UNEXPECTED_TOKEN_LT_RAW,
        "is not valid json",
        "cloudflare challenge",
        "private access token challenge",
        "cloudflare",
        "turnstile",
        "executing inline script violates the following content security policy directive",
        "the action has been blocked",
        "was preloaded using link preload but not used within a few seconds from the window's load event",
    )
    return any(pattern in text for pattern in patterns)


def _extract_status_code(row: dict[str, Any]) -> int | None:
    raw = row.get("status_code")
    if isinstance(raw, int):
        return raw
    if isinstance(raw, str) and raw.strip().isdigit():
        return int(raw.strip())
    text = str(row.get("text") or "")
    match = re.search(r"status(?: of)?\s+(\d{3})", text, flags=re.IGNORECASE)
    if not match:
        return None
    try:
        return int(match.group(1))
    except Exception:
        return None


def _extract_url_path(value: str) -> str:
    try:
        parsed = urlparse(value)
    except Exception:
        return ""
    return (parsed.path or "").strip().lower()


def _extract_request_path(row: dict[str, Any]) -> str:
    request_url = str(row.get("request_url") or "").strip()
    if request_url:
        return _extract_url_path(request_url)
    text = str(row.get("text") or "")
    match = URL_TOKEN_PATTERN.search(text)
    if not match:
        return ""
    token = match.group(0).strip()
    if URL_SCHEME_PATTERN.match(token):
        return _extract_url_path(token)
    return token.lower()


def _classify_endpoint(path: str) -> str:
    normalized = str(path or "").lower()
    if not normalized:
        return "unknown"
    endpoint_prefixes = (
        ("/api/v1/auth/me/export/jobs/latest", "account_export_latest"),
        ("/api/v1/content/admin/site.", "admin_site_content"),
        ("/api/v1/content/admin/page.", "admin_page_content"),
        ("/api/v1/content/admin/", "admin_content_api"),
        ("/api/v1/content/", "content_api"),
        ("/api/v1/", "first_party_api"),
    )
    for prefix, endpoint_class in endpoint_prefixes:
        if normalized.startswith(prefix):
            return endpoint_class
    return "other"


def _is_expected_account_export_noise(route: str, surface: str, endpoint_class: str, status_code: int | None) -> bool:
    return (
        route.startswith("/account/privacy")
        and surface == "account"
        and endpoint_class == "account_export_latest"
        and status_code == 404
    )


def _is_expected_admin_content_noise(
    route: str,
    surface: str,
    endpoint_path: str,
    endpoint_class: str,
    status_code: int | None,
) -> bool:
    if surface != "admin" or route not in {"/admin/content/pages", "/admin/content/settings"}:
        return False
    if endpoint_class == "admin_site_content" and status_code in {403, 404}:
        return True
    return route == "/admin/content/pages" and endpoint_path == "/api/v1/content/admin/cms.snippets" and status_code == 404


def _is_expected_admin_auth_noise(surface: str, endpoint_path: str, status_code: int | None) -> bool:
    return (
        surface == "admin"
        and endpoint_path in {"/api/v1/auth/admin/access", "/api/v1/admin/ui/favorites"}
        and status_code in {401, 403}
    )


def _is_expected_receipt_noise(endpoint_path: str, status_code: int | None) -> bool:
    return endpoint_path.startswith("/api/v1/orders/receipt/") and status_code in {401, 403, 404}


def _is_expected_orb_image_noise(request_url: str, message: str) -> bool:
    if "err_blocked_by_orb" not in message:
        return False
    try:
        parsed_request = urlparse(request_url)
    except Exception:
        return False
    return parsed_request.netloc == "example.com" and parsed_request.path.startswith("/images/")


def _is_expected_resource_noise(
    *,
    route: str,
    surface: str,
    endpoint_path: str,
    endpoint_class: str,
    status_code: int | None,
    request_url: str,
    message: str,
) -> bool:
    normalized_route = str(route or "").strip().lower()
    normalized_surface = str(surface or "").strip().lower()
    normalized_request_url = str(request_url or "").strip().lower()
    normalized_message = _normalize_whitespace_lower(str(message or ""))
    if not endpoint_path and endpoint_class == "unknown":
        return False
    return any(
        (
            _is_expected_account_export_noise(normalized_route, normalized_surface, endpoint_class, status_code),
            _is_expected_admin_content_noise(
                normalized_route,
                normalized_surface,
                endpoint_path,
                endpoint_class,
                status_code,
            ),
            _is_expected_admin_auth_noise(normalized_surface, endpoint_path, status_code),
            _is_expected_receipt_noise(endpoint_path, status_code),
            _is_expected_orb_image_noise(normalized_request_url, normalized_message),
        )
    )


def _has_lang_query(url: str, lang: str) -> bool:
    parsed = urlparse(url)
    values = [value.strip().lower() for value in parse_qs(parsed.query).get("lang", [])]
    return lang.strip().lower() in values


def _row_text_or_default(row: dict[str, Any], key: str, default: str) -> str:
    return str(row.get(key) or default)


def _row_int_or_zero(row: dict[str, Any], key: str) -> int:
    return int(row.get(key) or 0)


def _first_non_empty_text(*values: Any, default: str = "") -> str:
    for value in values:
        text = str(value or "").strip()
        if text:
            return text
    return default


def _collect_noisy_routes(console_errors: list[dict[str, Any]]) -> set[str]:
    noisy_routes: set[str] = set()
    for row in console_errors:
        severity = _row_text_or_default(row, "severity", "s3").lower()
        text = _row_text_or_default(row, "text", "")
        if severity != "s4" and not _is_api_noise_message(text):
            continue
        for key in ("route", "route_template", "resolved_route"):
            token = _first_non_empty_text(row.get(key), default="")
            if token:
                noisy_routes.add(token)
    return noisy_routes


def _route_has_console_noise(
    *,
    noisy_routes: set[str],
    route: str,
    route_template: str,
    resolved_route: str,
) -> bool:
    for candidate in (route, route_template, resolved_route):
        if candidate in noisy_routes:
            return True
    return False


def _build_seo_row_context(row: dict[str, Any], noisy_routes: set[str]) -> dict[str, Any]:
    route = _first_non_empty_text(row.get("route"), default="/")
    route_template = _first_non_empty_text(row.get("route_template"), default=route)
    resolved_route = _first_non_empty_text(row.get("resolved_route"), default=route_template)
    surface = _first_non_empty_text(row.get("surface"), default="storefront")
    robots = _row_text_or_default(row, "robots", "").strip().lower()
    noindex_route = "noindex" in robots
    indexable_value = row.get("indexable")
    indexable = bool(indexable_value) if isinstance(indexable_value, bool) else not noindex_route
    return {
        "route": route,
        "route_template": route_template,
        "resolved_route": resolved_route,
        "surface": surface,
        "title": _row_text_or_default(row, "title", "").strip(),
        "description_meta": _row_text_or_default(row, "description", "").strip(),
        "canonical": _row_text_or_default(row, "canonical", "").strip(),
        "h1_count": _row_int_or_zero(row, "h1_count"),
        "word_count": _row_int_or_zero(row, "word_count_initial_html"),
        "meaningful_text_blocks": _row_int_or_zero(row, "meaningful_text_block_count"),
        "internal_link_count": _row_int_or_zero(row, "internal_link_count"),
        "render_error": _row_text_or_default(row, "error", "").strip(),
        "unresolved_placeholder": bool(row.get("unresolved_placeholder")),
        "indexable": indexable,
        "route_is_ro": _has_lang_query(route, "ro") or _has_lang_query(resolved_route, "ro"),
        "route_has_console_noise": _route_has_console_noise(
            noisy_routes=noisy_routes,
            route=route,
            route_template=route_template,
            resolved_route=resolved_route,
        ),
    }


def _append_render_error_finding(findings: list[dict[str, Any]], ctx: dict[str, Any]) -> bool:
    if not ctx["render_error"] or ctx["unresolved_placeholder"]:
        return False
    findings.append(
        _finding(
            title=f"Route render error on `{ctx['route_template']}`",
            description=ctx["render_error"],
            severity="s2",
            route=ctx["route_template"],
            surface=ctx["surface"],
            rule_id="route_render_error",
            primary_file="scripts/audit/collect_browser_evidence.mjs",
            evidence_files=[SEO_SNAPSHOT_FILE, CONSOLE_ERRORS_FILE],
            effort="M",
        )
    )
    return True


def _is_storefront_indexable_context(ctx: dict[str, Any]) -> bool:
    return ctx["surface"] == "storefront" and ctx["indexable"] and not ctx["unresolved_placeholder"]


def _append_storefront_title_finding(findings: list[dict[str, Any]], ctx: dict[str, Any]) -> None:
    if ctx["title"]:
        return
    findings.append(
        _finding(
            title=f"Missing title on indexable route `{ctx['route_template']}`",
            description="Indexable storefront route rendered with an empty document title.",
            severity="s2",
            route=ctx["route_template"],
            surface=ctx["surface"],
            rule_id="seo_missing_title",
            primary_file="frontend/src/app/app.routes.ts",
            evidence_files=[SEO_SNAPSHOT_FILE],
            effort="S",
            audit_label="audit:seo",
            indexable=ctx["indexable"],
        )
    )


def _append_storefront_h1_findings(findings: list[dict[str, Any]], ctx: dict[str, Any]) -> None:
    if ctx["h1_count"] == 0:
        findings.append(
            _finding(
                title=f"Missing H1 on storefront route `{ctx['route_template']}`",
                description="Storefront route rendered without a primary H1 heading.",
                severity="s2",
                route=ctx["route_template"],
                surface=ctx["surface"],
                rule_id="ux_missing_h1",
                primary_file="frontend/src/app/app.routes.ts",
                evidence_files=[SEO_SNAPSHOT_FILE],
                effort="M",
                audit_label="audit:seo",
                indexable=ctx["indexable"],
            )
        )
    if ctx["h1_count"] > 1:
        findings.append(
            _finding(
                title=f"Multiple H1 headings on `{ctx['route_template']}`",
                description=f"Found {ctx['h1_count']} H1 elements. This can hurt IA clarity.",
                severity="s3",
                route=ctx["route_template"],
                surface=ctx["surface"],
                rule_id="ux_multiple_h1",
                primary_file="frontend/src/app/app.routes.ts",
                evidence_files=[SEO_SNAPSHOT_FILE],
                effort="M",
                audit_label="audit:seo",
                indexable=ctx["indexable"],
            )
        )


def _append_storefront_heading_findings(findings: list[dict[str, Any]], ctx: dict[str, Any]) -> None:
    if not _is_storefront_indexable_context(ctx):
        return
    _append_storefront_title_finding(findings, ctx)
    _append_storefront_h1_findings(findings, ctx)


def _canonical_policy_reason(canonical_url: str, route_is_ro: bool) -> str:
    canonical_has_en = _has_lang_query(canonical_url, "en")
    canonical_has_ro = _has_lang_query(canonical_url, "ro")
    if route_is_ro:
        return "" if canonical_has_ro else "Romanian route is missing `?lang=ro` in canonical URL."
    if canonical_has_en or canonical_has_ro:
        return "English canonical must be a clean URL without language query parameters."
    return ""


def _append_storefront_canonical_findings(findings: list[dict[str, Any]], ctx: dict[str, Any]) -> None:
    if not _is_storefront_indexable_context(ctx):
        return
    if not ctx["canonical"]:
        findings.append(
            _finding(
                title=f"Missing canonical link on `{ctx['route_template']}`",
                description=(
                    f"Storefront route did not expose a canonical URL "
                    f"(resolved route `{ctx['resolved_route']}`)."
                ),
                severity="s3",
                route=ctx["route_template"],
                surface=ctx["surface"],
                rule_id="seo_missing_canonical",
                primary_file="frontend/src/app/core/seo-head-links.service.ts",
                evidence_files=[SEO_SNAPSHOT_FILE],
                effort="S",
                audit_label="audit:seo",
                indexable=ctx["indexable"],
            )
        )
        return
    canonical_reason = _canonical_policy_reason(ctx["canonical"], bool(ctx["route_is_ro"]))
    if not canonical_reason:
        return
    findings.append(
        _finding(
            title=f"Canonical policy mismatch on `{ctx['route_template']}`",
            description=canonical_reason,
            severity="s2",
            route=ctx["route_template"],
            surface=ctx["surface"],
            rule_id="seo_canonical_policy_mismatch",
            primary_file="frontend/src/app/core/seo-head-links.service.ts",
            evidence_files=[SEO_SNAPSHOT_FILE],
            effort="S",
            audit_label="audit:seo",
            indexable=ctx["indexable"],
        )
    )


def _is_storefront_content_eligible(ctx: dict[str, Any]) -> bool:
    return _is_storefront_indexable_context(ctx) and not ctx["route_has_console_noise"]


def _append_storefront_description_finding(findings: list[dict[str, Any]], ctx: dict[str, Any]) -> None:
    if not ctx["description_meta"]:
        findings.append(
            _finding(
                title=f"Missing description on `{ctx['route_template']}`",
                description="Indexable storefront route rendered without a meta description.",
                severity="s2",
                route=ctx["route_template"],
                surface=ctx["surface"],
                rule_id="seo_missing_description",
                primary_file="frontend/src/app/app.routes.ts",
                evidence_files=[SEO_SNAPSHOT_FILE],
                effort="S",
                audit_label="audit:seo",
                indexable=ctx["indexable"],
            )
        )


def _append_storefront_text_depth_finding(findings: list[dict[str, Any]], ctx: dict[str, Any]) -> None:
    if ctx["meaningful_text_blocks"] <= 0 or ctx["word_count"] < 45:
        findings.append(
            _finding(
                title=f"No meaningful text in initial HTML on `{ctx['route_template']}`",
                description=(
                    f"Indexable storefront route rendered with low initial text depth "
                    f"(words={ctx['word_count']}, blocks={ctx['meaningful_text_blocks']})."
                ),
                severity="s2",
                route=ctx["route_template"],
                surface=ctx["surface"],
                rule_id="seo_no_meaningful_text",
                primary_file="frontend/src/app/app.routes.ts",
                evidence_files=[SEO_SNAPSHOT_FILE],
                effort="M",
                audit_label="audit:seo",
                indexable=ctx["indexable"],
            )
        )


def _append_storefront_internal_link_finding(findings: list[dict[str, Any]], ctx: dict[str, Any]) -> None:
    if ctx["internal_link_count"] < 2:
        findings.append(
            _finding(
                title=f"Low internal links on `{ctx['route_template']}`",
                description=(
                    f"Indexable storefront route rendered with only {ctx['internal_link_count']} "
                    "internal link(s) in initial HTML."
                ),
                severity="s3",
                route=ctx["route_template"],
                surface=ctx["surface"],
                rule_id="seo_low_internal_links",
                primary_file="frontend/src/app/app.routes.ts",
                evidence_files=[SEO_SNAPSHOT_FILE],
                effort="M",
                audit_label="audit:seo",
                indexable=ctx["indexable"],
            )
        )


def _append_indexable_seo_row(indexable_rows: list[dict[str, str]], ctx: dict[str, Any]) -> None:
    indexable_rows.append(
        {
            "route": ctx["route_template"],
            "surface": ctx["surface"],
            "title": " ".join(ctx["title"].lower().split()),
            "description": " ".join(ctx["description_meta"].lower().split()),
        }
    )


def _append_storefront_content_findings(
    findings: list[dict[str, Any]],
    indexable_rows: list[dict[str, str]],
    ctx: dict[str, Any],
) -> None:
    if not _is_storefront_content_eligible(ctx):
        return
    _append_storefront_description_finding(findings, ctx)
    _append_storefront_text_depth_finding(findings, ctx)
    _append_storefront_internal_link_finding(findings, ctx)
    _append_indexable_seo_row(indexable_rows, ctx)


def _collect_seo_findings(
    seo_snapshot: list[dict[str, Any]],
    noisy_routes: set[str],
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    findings: list[dict[str, Any]] = []
    indexable_rows: list[dict[str, str]] = []
    for row in seo_snapshot:
        ctx = _build_seo_row_context(row, noisy_routes)
        if _append_render_error_finding(findings, ctx):
            continue
        _append_storefront_heading_findings(findings, ctx)
        _append_storefront_canonical_findings(findings, ctx)
        _append_storefront_content_findings(findings, indexable_rows, ctx)
    return findings, indexable_rows


def _group_duplicate_seo_values(indexable_rows: list[dict[str, str]]) -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    duplicate_titles: dict[str, list[str]] = {}
    duplicate_descriptions: dict[str, list[str]] = {}
    for row in indexable_rows:
        route = row["route"]
        if row["title"]:
            duplicate_titles.setdefault(row["title"], []).append(route)
        if row["description"]:
            duplicate_descriptions.setdefault(row["description"], []).append(route)
    return duplicate_titles, duplicate_descriptions


def _append_duplicate_title_findings(findings: list[dict[str, Any]], duplicate_titles: dict[str, list[str]]) -> None:
    for routes_for_title in duplicate_titles.values():
        if len(routes_for_title) < 2:
            continue
        sorted_routes = sorted(set(routes_for_title))
        for route in sorted_routes:
            siblings = [r for r in sorted_routes if r != route][:4]
            findings.append(
                _finding(
                    title=f"Duplicate title on `{route}`",
                    description=(
                        "Indexable storefront route shares the same `<title>` with other routes: "
                        + ", ".join(f"`{r}`" for r in siblings)
                    ),
                    severity="s3",
                    route=route,
                    surface="storefront",
                    rule_id="seo_duplicate_title",
                    primary_file="frontend/src/app/app.routes.ts",
                    evidence_files=[SEO_SNAPSHOT_FILE],
                    effort="M",
                    audit_label="audit:seo",
                    indexable=True,
                )
            )


def _append_duplicate_description_findings(
    findings: list[dict[str, Any]],
    duplicate_descriptions: dict[str, list[str]],
) -> None:
    for routes_for_description in duplicate_descriptions.values():
        if len(routes_for_description) < 2:
            continue
        sorted_routes = sorted(set(routes_for_description))
        for route in sorted_routes:
            siblings = [r for r in sorted_routes if r != route][:4]
            findings.append(
                _finding(
                    title=f"Duplicate description on `{route}`",
                    description=(
                        "Indexable storefront route shares the same meta description with other routes: "
                        + ", ".join(f"`{r}`" for r in siblings)
                    ),
                    severity="s3",
                    route=route,
                    surface="storefront",
                    rule_id="seo_duplicate_description",
                    primary_file="frontend/src/app/app.routes.ts",
                    evidence_files=[SEO_SNAPSHOT_FILE],
                    effort="M",
                    audit_label="audit:seo",
                    indexable=True,
                )
            )


def _normalize_console_severity(value: Any) -> str:
    severity = str(value or "s3").lower()
    return severity if severity in {"s1", "s2", "s3", "s4"} else "s3"


def _should_skip_unexpected_token_noise(
    *,
    row: dict[str, Any],
    route: str,
    surface: str,
    text: str,
    normalized_text: str,
    status_code: int | None,
) -> bool:
    if normalized_text != "unexpected_token_lt_json_parse":
        return False
    if surface in {"account", "admin"} or ":" in route:
        return True
    return _is_benign_storefront_unexpected_token(
        {
            "route": route,
            "surface": surface,
            "text": text,
            "status_code": status_code,
            "request_url": str(row.get("request_url") or ""),
            "source_url": str(row.get("source_url") or ""),
            "line": row.get("line"),
            "column": row.get("column"),
        }
    )


def _seed_console_noise_cluster(
    *,
    surface: str,
    severity: str,
    text: str,
    status_code: int | None,
    endpoint_class: str,
    endpoint_path: str,
) -> dict[str, Any]:
    return {
        "surface": surface,
        "severity": severity,
        "message": text[:500],
        "status_code": status_code,
        "endpoint_class": endpoint_class,
        "endpoint_path": endpoint_path,
        "routes": set(),
    }


def _accumulate_console_noise_cluster(
    *,
    row: dict[str, Any],
    route: str,
    surface: str,
    severity: str,
    text: str,
    clusters: dict[tuple[str, str, str, str, str], dict[str, Any]],
) -> None:
    status_code = _extract_status_code(row)
    endpoint_path = _extract_request_path(row)
    endpoint_class = _classify_endpoint(endpoint_path)
    if _is_expected_resource_noise(
        route=route,
        surface=surface,
        endpoint_path=endpoint_path,
        endpoint_class=endpoint_class,
        status_code=status_code,
        request_url=str(row.get("request_url") or ""),
        message=text,
    ):
        return
    normalized_text = _normalize_console_noise_signature(text)
    if not normalized_text:
        return
    if _should_skip_unexpected_token_noise(
        row=row,
        route=route,
        surface=surface,
        text=text,
        normalized_text=normalized_text,
        status_code=status_code,
    ):
        return
    status_token = str(status_code) if status_code is not None else "none"
    key = (surface, severity, normalized_text, status_token, endpoint_class)
    cluster = clusters.setdefault(
        key,
        _seed_console_noise_cluster(
            surface=surface,
            severity=severity,
            text=text,
            status_code=status_code,
            endpoint_class=endpoint_class,
            endpoint_path=endpoint_path,
        ),
    )
    cluster["routes"].add(route)
    if endpoint_path and not cluster.get("endpoint_path"):
        cluster["endpoint_path"] = endpoint_path


def _status_note(status_token: str) -> str:
    return f"HTTP status: `{status_token}`" if status_token != "none" else "HTTP status: `unknown`"


def _endpoint_note(endpoint_class: str, endpoint_path: str) -> str:
    note = f"Endpoint class: `{endpoint_class}`"
    if endpoint_path:
        note += f"; sample endpoint: `{endpoint_path}`"
    return note


def _build_console_noise_cluster_finding(
    *,
    surface: str,
    severity: str,
    normalized_text: str,
    status_token: str,
    endpoint_class: str,
    cluster: dict[str, Any],
) -> dict[str, Any] | None:
    routes = sorted(str(route) for route in cluster.get("routes", set()) if str(route).strip())
    if not routes:
        return None
    sample_routes = routes[:8]
    signature = hashlib.sha256(
        f"{surface}|{severity}|{normalized_text}|{status_token}|{endpoint_class}".encode("utf-8")
    ).hexdigest()[:12]
    endpoint_path = str(cluster.get("endpoint_path") or "").strip()
    noise_finding = _finding(
        title=f"Browser console noise cluster on `{surface}` ({len(routes)} routes)",
        description=(
            f"Representative console message: {cluster.get('message','')}\n\n"
            f"{_status_note(status_token)}\n"
            f"{_endpoint_note(endpoint_class, endpoint_path)}\n\n"
            f"Affected routes (sample): {', '.join(f'`{route}`' for route in sample_routes)}"
        ),
        severity=severity,
        route=f"cluster:{signature}",
        surface=surface,
        rule_id="browser_console_noise_cluster",
        primary_file="scripts/audit/collect_browser_evidence.mjs",
        evidence_files=[CONSOLE_ERRORS_FILE],
        effort="S",
    )
    noise_finding["cluster_count"] = len(routes)
    noise_finding["sample_routes"] = sample_routes
    noise_finding["representative_message"] = cluster.get("message", "")
    noise_finding["status_code"] = cluster.get("status_code")
    noise_finding["endpoint_class"] = cluster.get("endpoint_class")
    if endpoint_path:
        noise_finding["endpoint_path"] = endpoint_path
    noise_finding["aggregated"] = True
    return noise_finding


def _build_console_noise_cluster_findings(
    clusters: dict[tuple[str, str, str, str, str], dict[str, Any]],
) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    for (surface, severity, normalized_text, status_token, endpoint_class), cluster in sorted(clusters.items()):
        finding = _build_console_noise_cluster_finding(
            surface=surface,
            severity=severity,
            normalized_text=normalized_text,
            status_token=status_token,
            endpoint_class=endpoint_class,
            cluster=cluster,
        )
        if not finding:
            continue
        findings.append(finding)
    return findings


def _collect_console_findings(console_errors: list[dict[str, Any]]) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    console_noise_clusters: dict[tuple[str, str, str, str, str], dict[str, Any]] = {}
    for row in console_errors:
        route = str(row.get("route") or "/")
        surface = str(row.get("surface") or "storefront")
        text = str(row.get("text") or "").strip()
        if not text:
            continue
        severity = _normalize_console_severity(row.get("severity"))
        if severity == "s4":
            _accumulate_console_noise_cluster(
                row=row,
                route=route,
                surface=surface,
                severity=severity,
                text=text,
                clusters=console_noise_clusters,
            )
            continue
        findings.append(
            _finding(
                title=f"Browser error on `{route}`",
                description=text[:500],
                severity=severity,
                route=route,
                surface=surface,
                rule_id="browser_console_error",
                primary_file="scripts/audit/collect_browser_evidence.mjs",
                evidence_files=[CONSOLE_ERRORS_FILE],
                effort="M",
            )
        )
    findings.extend(_build_console_noise_cluster_findings(console_noise_clusters))
    return findings


def _collect_layout_findings(layout_signals: list[dict[str, Any]]) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
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
                    evidence_files=[LAYOUT_SIGNALS_FILE],
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
                    evidence_files=[LAYOUT_SIGNALS_FILE],
                    effort="M",
                )
            )
    return findings


def _is_visibility_issue_row(row: dict[str, Any]) -> bool:
    if not bool(row.get("visibility_issue")):
        return False
    if bool(row.get("unresolved_placeholder")):
        return False
    return not _row_text_or_default(row, "error", "").strip()


def _visibility_issue_reasons(row: dict[str, Any]) -> list[str]:
    raw_reasons = row.get("issue_reasons") or []
    return [str(reason) for reason in raw_reasons if str(reason).strip()]


def _collect_visibility_findings(visibility_signals: list[dict[str, Any]]) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    for row in visibility_signals:
        if not _is_visibility_issue_row(row):
            continue
        reasons = _visibility_issue_reasons(row)
        if not reasons:
            continue
        route = _first_non_empty_text(row.get("route_template"), row.get("route"), default="/")
        surface = _first_non_empty_text(row.get("surface"), default="storefront")
        severity = "s2" if surface in {"account", "admin"} else "s3"
        findings.append(
            _finding(
                title=f"Content appears only after interaction on `{route}`",
                description=(
                    "Initial render visibility check detected delayed text/form discoverability. "
                    f"Reasons: {', '.join(reasons)}."
                ),
                severity=severity,
                route=route,
                surface=surface,
                rule_id="ux_visibility_after_interaction",
                primary_file="scripts/audit/collect_browser_evidence.mjs",
                evidence_files=[VISIBILITY_SIGNALS_FILE],
                effort="M",
                audit_label="audit:ux",
            )
        )
    return findings


def _dedupe_and_order_findings(findings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: dict[str, dict[str, Any]] = {}
    for item in findings:
        deduped[item["fingerprint"]] = item
    return sorted(
        deduped.values(),
        key=lambda item: (
            {"s1": 0, "s2": 1, "s3": 2, "s4": 3}.get(item["severity"], 9),
            item["surface"],
            item["route"],
            item["rule_id"],
        ),
    )


def _build_deterministic_findings(
    *,
    seo_snapshot: list[dict[str, Any]],
    console_errors: list[dict[str, Any]],
    layout_signals: list[dict[str, Any]],
    visibility_signals: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    noisy_routes = _collect_noisy_routes(console_errors)
    seo_findings, indexable_rows = _collect_seo_findings(seo_snapshot, noisy_routes)
    findings.extend(seo_findings)
    duplicate_titles, duplicate_descriptions = _group_duplicate_seo_values(indexable_rows)
    _append_duplicate_title_findings(findings, duplicate_titles)
    _append_duplicate_description_findings(findings, duplicate_descriptions)
    findings.extend(_collect_console_findings(console_errors))
    findings.extend(_collect_layout_findings(layout_signals))
    findings.extend(_collect_visibility_findings(visibility_signals or []))
    return _dedupe_and_order_findings(findings)


def _write_evidence_index(
    *,
    output_dir: Path,
    mode: str,
    base_url: str | None,
    api_base_url: str | None,
    auth_profile: str,
    route_map: dict[str, Any],
    selected_routes: list[dict[str, Any]],
    findings: list[dict[str, Any]],
    console_noise_telemetry: dict[str, Any],
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
        f"- API base URL: `{api_base_url or 'n/a'}`",
        f"- Auth profile: `{auth_profile}`",
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
        f"- Suppressed benign parser-noise clusters: `{console_noise_telemetry.get('suppressed_cluster_count', 0)}`",
        f"- Suppressed benign parser-noise events: `{console_noise_telemetry.get('suppressed_event_count', 0)}`",
        "",
        "## Artifact files",
        "",
        "- `route-map.json`",
        "- `surface-map.json`",
        f"- `{SEO_SNAPSHOT_FILE}`",
        f"- `{CONSOLE_ERRORS_FILE}`",
        f"- `{LAYOUT_SIGNALS_FILE}`",
        f"- `{VISIBILITY_SIGNALS_FILE}`",
        f"- `{DETERMINISTIC_FINDINGS_FILE}`",
        f"- `{CONSOLE_NOISE_TELEMETRY_FILE}`",
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
    parser.add_argument("--api-base-url", default="")
    parser.add_argument("--owner-identifier", default="")
    parser.add_argument("--owner-password", default="")
    parser.add_argument("--changed-files-file", default="")
    parser.add_argument("--max-routes", type=int, default=40)
    return parser.parse_args()


def _as_rows(payload: Any) -> list[dict[str, Any]]:
    return payload if isinstance(payload, list) else []


def _ensure_browser_artifacts(output_dir: Path) -> None:
    for file_name in (SEO_SNAPSHOT_FILE, CONSOLE_ERRORS_FILE, LAYOUT_SIGNALS_FILE, VISIBILITY_SIGNALS_FILE):
        path = output_dir / file_name
        if not path.exists():
            _write_json(path, [])
    (output_dir / "screenshots").mkdir(parents=True, exist_ok=True)


def _load_browser_artifacts(output_dir: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    seo_snapshot = _as_rows(_load_json(output_dir / SEO_SNAPSHOT_FILE, default=[]))
    console_errors = _as_rows(_load_json(output_dir / CONSOLE_ERRORS_FILE, default=[]))
    layout_signals = _as_rows(_load_json(output_dir / LAYOUT_SIGNALS_FILE, default=[]))
    visibility_signals = _as_rows(_load_json(output_dir / VISIBILITY_SIGNALS_FILE, default=[]))
    return seo_snapshot, console_errors, layout_signals, visibility_signals


def _collect_findings(output_dir: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    seo_snapshot, console_errors, layout_signals, visibility_signals = _load_browser_artifacts(output_dir)
    findings = _build_deterministic_findings(
        seo_snapshot=seo_snapshot,
        console_errors=console_errors,
        layout_signals=layout_signals,
        visibility_signals=visibility_signals,
    )
    telemetry = _build_console_noise_telemetry(console_errors)
    _write_json(output_dir / DETERMINISTIC_FINDINGS_FILE, findings)
    _write_json(output_dir / CONSOLE_NOISE_TELEMETRY_FILE, telemetry)
    return findings, telemetry


def _auth_profile(owner_identifier: str, owner_password: str) -> str:
    return "owner" if owner_identifier.strip() and owner_password.strip() else "anonymous"


def main() -> int:
    args = _parse_args()
    repo_root = _repo_root()
    output_dir = _resolve_repo_path(args.output_dir, allowed_prefixes=("artifacts",))
    output_dir.mkdir(parents=True, exist_ok=True)

    route_map_path = output_dir / "route-map.json"
    routes_file = _resolve_repo_path(args.routes_file, allowed_prefixes=("frontend",))
    _run_python(
        [
            str(repo_root / "scripts" / "audit" / "extract_route_map.py"),
            "--routes-file",
            str(routes_file.relative_to(repo_root)),
            "--out",
            str(route_map_path.relative_to(repo_root)),
        ],
        cwd=repo_root,
    )
    route_map = _load_json(route_map_path, default={"routes": [], "summary": {}})

    changed_files_path = (
        _resolve_repo_path(args.changed_files_file, allowed_prefixes=("artifacts",)) if args.changed_files_file else None
    )
    changed_files = _load_changed_files(changed_files_path)
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
    base_url = _validate_base_url(args.base_url)
    api_base_url = _validate_base_url(args.api_base_url) if args.api_base_url else base_url
    if base_url:
        browser_ok, browser_message = _browser_collect(
            repo_root=repo_root,
            base_url=base_url,
            api_base_url=api_base_url,
            selected_routes_path=output_dir / "selected-routes.json",
            output_dir=output_dir,
            max_routes=max(1, int(args.max_routes)),
            owner_identifier=str(args.owner_identifier or ""),
            owner_password=str(args.owner_password or ""),
        )

    _ensure_browser_artifacts(output_dir)
    findings, console_noise_telemetry = _collect_findings(output_dir)

    _write_evidence_index(
        output_dir=output_dir,
        mode=args.mode,
        base_url=base_url or None,
        api_base_url=api_base_url or None,
        auth_profile=_auth_profile(str(args.owner_identifier or ""), str(args.owner_password or "")),
        route_map=route_map if isinstance(route_map, dict) else {},
        selected_routes=selected_routes,
        findings=findings,
        console_noise_telemetry=console_noise_telemetry,
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
