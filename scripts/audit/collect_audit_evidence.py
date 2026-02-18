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


def _build_deterministic_findings(
    *,
    seo_snapshot: list[dict[str, Any]],
    console_errors: list[dict[str, Any]],
    layout_signals: list[dict[str, Any]],
    visibility_signals: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    indexable_rows: list[dict[str, str]] = []
    noisy_routes: set[str] = set()

    def _normalize_console_noise_signature(message: str) -> str:
        text = " ".join(str(message or "").split()).lower()
        if not text:
            return ""
        if "unexpected token '<'" in text or "unexpected token <" in text:
            return "unexpected_token_lt_json_parse"
        if "executing inline script violates the following content security policy directive" in text:
            return "csp_inline_script_blocked"
        if "private access token challenge" in text or "turnstile" in text or "challenges.cloudflare.com" in text:
            return "cloudflare_challenge_noise"
        if "was preloaded using link preload but not used within a few seconds" in text:
            return "unused_preload_warning"
        # Collapse route/url/path churn to keep low-noise clustering stable.
        compact = text
        compact = compact.replace("http://", "url://").replace("https://", "url://")
        compact = compact.replace("127.0.0.1", "host").replace("localhost", "host")
        while "//" in compact:
            compact = compact.replace("//", "/")
        return compact

    def _is_api_noise_message(message: str) -> bool:
        text = " ".join(str(message or "").lower().split())
        if not text:
            return False
        patterns = (
            "/api/",
            "net::err_connection_refused",
            "failed to load resource",
            "status of 404",
            "httperrorresponse",
            "failed to fetch",
            "networkerror when attempting to fetch resource",
            "xmlhttprequest",
            "response with status",
            "unexpected token '<'",
            "unexpected token <",
            "is not valid json",
            "challenges.cloudflare.com",
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

    def _extract_request_path(row: dict[str, Any]) -> str:
        request_url = str(row.get("request_url") or "").strip()
        if request_url:
            try:
                parsed = urlparse(request_url)
                return (parsed.path or "").strip().lower()
            except Exception:
                return ""
        text = str(row.get("text") or "")
        match = re.search(r"(?:https?://[^\s|)]+|/api/[^\s|)]+)", text)
        if not match:
            return ""
        token = match.group(0).strip()
        if token.startswith("http://") or token.startswith("https://"):
            try:
                return (urlparse(token).path or "").strip().lower()
            except Exception:
                return ""
        return token.lower()

    def _classify_endpoint(path: str) -> str:
        normalized = str(path or "").lower()
        if not normalized:
            return "unknown"
        if normalized.startswith("/api/v1/auth/me/export/jobs/latest"):
            return "account_export_latest"
        if normalized.startswith("/api/v1/content/admin/site."):
            return "admin_site_content"
        if normalized.startswith("/api/v1/content/admin/page."):
            return "admin_page_content"
        if normalized.startswith("/api/v1/content/admin/"):
            return "admin_content_api"
        if normalized.startswith("/api/v1/content/"):
            return "content_api"
        if normalized.startswith("/api/v1/"):
            return "first_party_api"
        return "other"

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
        normalized_message = " ".join(str(message or "").lower().split())
        if not endpoint_path and endpoint_class == "unknown":
            return False

        if (
            normalized_route.startswith("/account/privacy")
            and normalized_surface == "account"
            and endpoint_class == "account_export_latest"
            and status_code == 404
        ):
            return True

        if normalized_surface == "admin" and normalized_route in {"/admin/content/pages", "/admin/content/settings"}:
            if endpoint_class == "admin_site_content" and status_code in {403, 404}:
                return True
            if (
                normalized_route == "/admin/content/pages"
                and endpoint_path == "/api/v1/content/admin/cms.snippets"
                and status_code == 404
            ):
                return True

        if (
            normalized_surface == "admin"
            and endpoint_path == "/api/v1/auth/admin/access"
            and status_code in {401, 403}
        ):
            return True

        if (
            normalized_surface == "admin"
            and endpoint_path == "/api/v1/admin/ui/favorites"
            and status_code in {401, 403}
        ):
            return True

        if endpoint_path.startswith("/api/v1/orders/receipt/") and status_code in {401, 403, 404}:
            return True

        if (
            normalized_request_url.startswith("https://example.com/images/")
            and "err_blocked_by_orb" in normalized_message
        ):
            return True

        return False

    for row in console_errors:
        severity = str(row.get("severity") or "s3").lower()
        text = str(row.get("text") or "")
        if severity != "s4" and not _is_api_noise_message(text):
            continue
        for key in ("route", "route_template", "resolved_route"):
            token = str(row.get(key) or "").strip()
            if token:
                noisy_routes.add(token)

    def _has_lang_query(url: str, lang: str) -> bool:
        parsed = urlparse(url)
        values = [value.strip().lower() for value in parse_qs(parsed.query).get("lang", [])]
        return lang.strip().lower() in values

    for row in seo_snapshot:
        route = str(row.get("route") or "/")
        route_template = str(row.get("route_template") or route)
        resolved_route = str(row.get("resolved_route") or route_template)
        surface = str(row.get("surface") or "storefront")
        title = str(row.get("title") or "").strip()
        description_meta = str(row.get("description") or "").strip()
        canonical = str(row.get("canonical") or "").strip()
        robots = str(row.get("robots") or "").strip().lower()
        h1_count = int(row.get("h1_count") or 0)
        word_count = int(row.get("word_count_initial_html") or 0)
        meaningful_text_blocks = int(row.get("meaningful_text_block_count") or 0)
        internal_link_count = int(row.get("internal_link_count") or 0)
        render_error = str(row.get("error") or "").strip()
        unresolved_placeholder = bool(row.get("unresolved_placeholder"))
        noindex_route = "noindex" in robots
        indexable = bool(row.get("indexable")) if isinstance(row.get("indexable"), bool) else not noindex_route
        route_is_ro = _has_lang_query(route, "ro") or _has_lang_query(resolved_route, "ro")
        route_has_console_noise = any(
            candidate in noisy_routes for candidate in (route, route_template, resolved_route)
        )

        if render_error:
            if unresolved_placeholder:
                continue
            findings.append(
                _finding(
                    title=f"Route render error on `{route_template}`",
                    description=render_error,
                    severity="s2",
                    route=route_template,
                    surface=surface,
                    rule_id="route_render_error",
                    primary_file="scripts/audit/collect_browser_evidence.mjs",
                    evidence_files=["seo-snapshot.json", "console-errors.json"],
                    effort="M",
                )
            )
            continue

        if surface == "storefront" and not title and indexable and not unresolved_placeholder:
            findings.append(
                _finding(
                    title=f"Missing title on indexable route `{route_template}`",
                    description="Indexable storefront route rendered with an empty document title.",
                    severity="s2",
                    route=route_template,
                    surface=surface,
                    rule_id="seo_missing_title",
                    primary_file="frontend/src/app/app.routes.ts",
                    evidence_files=["seo-snapshot.json"],
                    effort="S",
                    audit_label="audit:seo",
                    indexable=indexable,
                )
            )

        if surface == "storefront" and h1_count == 0 and indexable and not unresolved_placeholder:
            findings.append(
                _finding(
                    title=f"Missing H1 on storefront route `{route_template}`",
                    description="Storefront route rendered without a primary H1 heading.",
                    severity="s2",
                    route=route_template,
                    surface=surface,
                    rule_id="ux_missing_h1",
                    primary_file="frontend/src/app/app.routes.ts",
                    evidence_files=["seo-snapshot.json"],
                    effort="M",
                    audit_label="audit:seo",
                    indexable=indexable,
                )
            )
        elif surface == "storefront" and h1_count > 1 and indexable and not unresolved_placeholder:
            findings.append(
                _finding(
                    title=f"Multiple H1 headings on `{route_template}`",
                    description=f"Found {h1_count} H1 elements. This can hurt IA clarity.",
                    severity="s3",
                    route=route_template,
                    surface=surface,
                    rule_id="ux_multiple_h1",
                    primary_file="frontend/src/app/app.routes.ts",
                    evidence_files=["seo-snapshot.json"],
                    effort="M",
                    audit_label="audit:seo" if surface == "storefront" else "audit:correctness",
                    indexable=indexable if surface == "storefront" else None,
                )
            )

        if surface == "storefront" and not canonical and indexable and not unresolved_placeholder:
            findings.append(
                _finding(
                    title=f"Missing canonical link on `{route_template}`",
                    description=(
                        f"Storefront route did not expose a canonical URL "
                        f"(resolved route `{resolved_route}`)."
                    ),
                    severity="s3",
                    route=route_template,
                    surface=surface,
                    rule_id="seo_missing_canonical",
                    primary_file="frontend/src/app/core/seo-head-links.service.ts",
                    evidence_files=["seo-snapshot.json"],
                    effort="S",
                    audit_label="audit:seo",
                    indexable=indexable,
                )
            )

        if surface == "storefront" and canonical and indexable and not unresolved_placeholder:
            canonical_has_en = _has_lang_query(canonical, "en")
            canonical_has_ro = _has_lang_query(canonical, "ro")
            canonical_violation = False
            canonical_reason = ""
            if route_is_ro and not canonical_has_ro:
                canonical_violation = True
                canonical_reason = "Romanian route is missing `?lang=ro` in canonical URL."
            elif not route_is_ro and (canonical_has_en or canonical_has_ro):
                canonical_violation = True
                canonical_reason = "English canonical must be a clean URL without language query parameters."
            if canonical_violation:
                findings.append(
                    _finding(
                        title=f"Canonical policy mismatch on `{route_template}`",
                        description=canonical_reason,
                        severity="s2",
                        route=route_template,
                        surface=surface,
                        rule_id="seo_canonical_policy_mismatch",
                        primary_file="frontend/src/app/core/seo-head-links.service.ts",
                        evidence_files=["seo-snapshot.json"],
                        effort="S",
                        audit_label="audit:seo",
                        indexable=indexable,
                    )
                )

        if surface == "storefront" and indexable and not unresolved_placeholder and not route_has_console_noise:
            if not description_meta:
                findings.append(
                    _finding(
                        title=f"Missing description on `{route_template}`",
                        description="Indexable storefront route rendered without a meta description.",
                        severity="s2",
                        route=route_template,
                        surface=surface,
                        rule_id="seo_missing_description",
                        primary_file="frontend/src/app/app.routes.ts",
                        evidence_files=["seo-snapshot.json"],
                        effort="S",
                        audit_label="audit:seo",
                        indexable=indexable,
                    )
                )

            if meaningful_text_blocks <= 0 or word_count < 45:
                findings.append(
                    _finding(
                        title=f"No meaningful text in initial HTML on `{route_template}`",
                        description=(
                            f"Indexable storefront route rendered with low initial text depth "
                            f"(words={word_count}, blocks={meaningful_text_blocks})."
                        ),
                        severity="s2",
                        route=route_template,
                        surface=surface,
                        rule_id="seo_no_meaningful_text",
                        primary_file="frontend/src/app/app.routes.ts",
                        evidence_files=["seo-snapshot.json"],
                        effort="M",
                        audit_label="audit:seo",
                        indexable=indexable,
                    )
                )

            if internal_link_count < 2:
                findings.append(
                    _finding(
                        title=f"Low internal links on `{route_template}`",
                        description=(
                            f"Indexable storefront route rendered with only {internal_link_count} "
                            "internal link(s) in initial HTML."
                        ),
                        severity="s3",
                        route=route_template,
                        surface=surface,
                        rule_id="seo_low_internal_links",
                        primary_file="frontend/src/app/app.routes.ts",
                        evidence_files=["seo-snapshot.json"],
                        effort="M",
                        audit_label="audit:seo",
                        indexable=indexable,
                    )
                )

            normalized_title = " ".join(title.lower().split())
            normalized_description = " ".join(description_meta.lower().split())
            indexable_rows.append(
                {
                    "route": route_template,
                    "surface": surface,
                    "title": normalized_title,
                    "description": normalized_description,
                }
            )

    duplicate_titles: dict[str, list[str]] = {}
    duplicate_descriptions: dict[str, list[str]] = {}
    for row in indexable_rows:
        route = row["route"]
        if row["title"]:
            duplicate_titles.setdefault(row["title"], []).append(route)
        if row["description"]:
            duplicate_descriptions.setdefault(row["description"], []).append(route)

    for normalized_title, routes_for_title in duplicate_titles.items():
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
                    evidence_files=["seo-snapshot.json"],
                    effort="M",
                    audit_label="audit:seo",
                    indexable=True,
                )
            )

    for normalized_description, routes_for_description in duplicate_descriptions.items():
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
                    evidence_files=["seo-snapshot.json"],
                    effort="M",
                    audit_label="audit:seo",
                    indexable=True,
                )
            )

    console_noise_clusters: dict[tuple[str, str, str, str, str], dict[str, Any]] = {}
    for row in console_errors:
        route = str(row.get("route") or "/")
        surface = str(row.get("surface") or "storefront")
        text = str(row.get("text") or "").strip()
        if not text:
            continue
        severity = str(row.get("severity") or "s3").lower()
        severity = severity if severity in {"s1", "s2", "s3", "s4"} else "s3"
        if severity == "s4":
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
                continue
            normalized_text = _normalize_console_noise_signature(text)
            if not normalized_text:
                continue
            if normalized_text == "unexpected_token_lt_json_parse":
                # These signatures are expected in auth-gated shells and unresolved template routes
                # where JSON parsing occurs against guarded/placeholder responses.
                if surface in {"account", "admin"} or ":" in route:
                    continue
            status_token = str(status_code) if status_code is not None else "none"
            key = (surface, severity, normalized_text, status_token, endpoint_class)
            cluster = console_noise_clusters.setdefault(
                key,
                {
                    "surface": surface,
                    "severity": severity,
                    "message": text[:500],
                    "status_code": status_code,
                    "endpoint_class": endpoint_class,
                    "endpoint_path": endpoint_path,
                    "routes": set(),
                },
            )
            cluster["routes"].add(route)
            if endpoint_path and not cluster.get("endpoint_path"):
                cluster["endpoint_path"] = endpoint_path
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
                evidence_files=["console-errors.json"],
                effort="M",
            )
        )

    for (surface, severity, normalized_text, status_token, endpoint_class), cluster in sorted(console_noise_clusters.items()):
        routes = sorted(str(route) for route in cluster.get("routes", set()) if str(route).strip())
        if not routes:
            continue
        sample_routes = routes[:8]
        signature = hashlib.sha256(
            f"{surface}|{severity}|{normalized_text}|{status_token}|{endpoint_class}".encode("utf-8")
        ).hexdigest()[:12]
        status_note = f"HTTP status: `{status_token}`" if status_token != "none" else "HTTP status: `unknown`"
        endpoint_note = (
            f"Endpoint class: `{endpoint_class}`"
            + (
                f"; sample endpoint: `{cluster.get('endpoint_path')}`"
                if str(cluster.get("endpoint_path") or "").strip()
                else ""
            )
        )
        noise_finding = _finding(
            title=f"Browser console noise cluster on `{surface}` ({len(routes)} routes)",
            description=(
                f"Representative console message: {cluster.get('message','')}\n\n"
                f"{status_note}\n"
                f"{endpoint_note}\n\n"
                f"Affected routes (sample): {', '.join(f'`{route}`' for route in sample_routes)}"
            ),
            severity=severity,
            route=f"cluster:{signature}",
            surface=surface,
            rule_id="browser_console_noise_cluster",
            primary_file="scripts/audit/collect_browser_evidence.mjs",
            evidence_files=["console-errors.json"],
            effort="S",
        )
        noise_finding["cluster_count"] = len(routes)
        noise_finding["sample_routes"] = sample_routes
        noise_finding["representative_message"] = cluster.get("message", "")
        noise_finding["status_code"] = cluster.get("status_code")
        noise_finding["endpoint_class"] = cluster.get("endpoint_class")
        if str(cluster.get("endpoint_path") or "").strip():
            noise_finding["endpoint_path"] = cluster.get("endpoint_path")
        noise_finding["aggregated"] = True
        findings.append(noise_finding)

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

    for row in visibility_signals or []:
        if not bool(row.get("visibility_issue")):
            continue
        if bool(row.get("unresolved_placeholder")):
            continue
        if str(row.get("error") or "").strip():
            continue
        route = str(row.get("route_template") or row.get("route") or "/")
        surface = str(row.get("surface") or "storefront")
        reasons = [str(reason) for reason in list(row.get("issue_reasons") or []) if str(reason).strip()]
        if not reasons:
            continue
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
                evidence_files=["visibility-signals.json"],
                effort="M",
                audit_label="audit:ux",
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
    api_base_url: str | None,
    auth_profile: str,
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
        "",
        "## Artifact files",
        "",
        "- `route-map.json`",
        "- `surface-map.json`",
        "- `seo-snapshot.json`",
        "- `console-errors.json`",
        "- `layout-signals.json`",
        "- `visibility-signals.json`",
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
    parser.add_argument("--api-base-url", default="")
    parser.add_argument("--owner-identifier", default="")
    parser.add_argument("--owner-password", default="")
    parser.add_argument("--changed-files-file", default="")
    parser.add_argument("--max-routes", type=int, default=40)
    return parser.parse_args()


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

    if not (output_dir / "seo-snapshot.json").exists():
        _write_json(output_dir / "seo-snapshot.json", [])
    if not (output_dir / "console-errors.json").exists():
        _write_json(output_dir / "console-errors.json", [])
    if not (output_dir / "layout-signals.json").exists():
        _write_json(output_dir / "layout-signals.json", [])
    if not (output_dir / "visibility-signals.json").exists():
        _write_json(output_dir / "visibility-signals.json", [])
    (output_dir / "screenshots").mkdir(parents=True, exist_ok=True)

    seo_snapshot = _load_json(output_dir / "seo-snapshot.json", default=[])
    console_errors = _load_json(output_dir / "console-errors.json", default=[])
    layout_signals = _load_json(output_dir / "layout-signals.json", default=[])
    visibility_signals = _load_json(output_dir / "visibility-signals.json", default=[])
    findings = _build_deterministic_findings(
        seo_snapshot=seo_snapshot if isinstance(seo_snapshot, list) else [],
        console_errors=console_errors if isinstance(console_errors, list) else [],
        layout_signals=layout_signals if isinstance(layout_signals, list) else [],
        visibility_signals=visibility_signals if isinstance(visibility_signals, list) else [],
    )
    _write_json(output_dir / "deterministic-findings.json", findings)

    _write_evidence_index(
        output_dir=output_dir,
        mode=args.mode,
        base_url=base_url or None,
        api_base_url=api_base_url or None,
        auth_profile="owner" if str(args.owner_identifier).strip() and str(args.owner_password).strip() else "anonymous",
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
