from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def _load_module():
    module_path = Path(__file__).resolve().parents[1] / "collect_audit_evidence.py"
    spec = importlib.util.spec_from_file_location("collect_audit_evidence", module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_noindex_storefront_routes_skip_severe_h1_and_canonical_findings() -> None:
    module = _load_module()
    findings = module._build_deterministic_findings(
        seo_snapshot=[
            {
                "route": "/newsletter/confirm",
                "surface": "storefront",
                "title": "Newsletter confirm",
                "canonical": "",
                "robots": "noindex,nofollow",
                "h1_count": 0,
            }
        ],
        console_errors=[],
        layout_signals=[],
    )
    rules = {row["rule_id"] for row in findings}
    assert "ux_missing_h1" not in rules
    assert "seo_missing_canonical" not in rules


def test_unresolved_placeholder_routes_skip_severe_h1_and_canonical_findings() -> None:
    module = _load_module()
    findings = module._build_deterministic_findings(
        seo_snapshot=[
            {
                "route": "/products/:slug",
                "route_template": "/products/:slug",
                "resolved_route": "/products/:slug",
                "surface": "storefront",
                "title": "",
                "canonical": "",
                "robots": "index,follow",
                "h1_count": 0,
                "unresolved_placeholder": True,
            }
        ],
        console_errors=[],
        layout_signals=[],
    )
    rules = {row["rule_id"] for row in findings}
    assert "ux_missing_h1" not in rules
    assert "seo_missing_canonical" not in rules
    assert "seo_missing_title" not in rules


def test_console_noise_finding_stays_non_severe() -> None:
    module = _load_module()
    findings = module._build_deterministic_findings(
        seo_snapshot=[],
        console_errors=[
            {
                "route": "/shop",
                "surface": "storefront",
                "severity": "s4",
                "level": "error",
                "text": "HttpErrorResponse: GET /api/v1/content/home.sections 404",
            }
        ],
        layout_signals=[],
    )
    assert len(findings) == 1
    assert findings[0]["rule_id"] == "browser_console_noise_cluster"
    assert findings[0]["severity"] == "s4"
    assert findings[0]["aggregated"] is True
    assert findings[0]["cluster_count"] == 1
    assert findings[0]["sample_routes"] == ["/shop"]


def test_expected_account_export_latest_404_noise_is_suppressed() -> None:
    module = _load_module()
    findings = module._build_deterministic_findings(
        seo_snapshot=[],
        console_errors=[
            {
                "route": "/account/privacy",
                "surface": "account",
                "severity": "s4",
                "level": "error",
                "text": "Failed resource request: status 404 | xhr | GET | http://127.0.0.1:8001/api/v1/auth/me/export/jobs/latest",
                "request_url": "http://127.0.0.1:8001/api/v1/auth/me/export/jobs/latest",
                "status_code": 404,
                "resource_type": "xhr",
                "method": "GET",
            }
        ],
        layout_signals=[],
    )
    assert findings == []


def test_expected_admin_site_content_404_noise_is_suppressed() -> None:
    module = _load_module()
    findings = module._build_deterministic_findings(
        seo_snapshot=[],
        console_errors=[
            {
                "route": "/admin/content/settings",
                "surface": "admin",
                "severity": "s4",
                "level": "error",
                "text": "Failed resource request: status 404 | xhr | GET | http://127.0.0.1:8001/api/v1/content/admin/site.social",
                "request_url": "http://127.0.0.1:8001/api/v1/content/admin/site.social",
                "status_code": 404,
                "resource_type": "xhr",
                "method": "GET",
            }
        ],
        layout_signals=[],
    )
    assert findings == []


def test_expected_admin_cms_snippets_404_noise_is_suppressed() -> None:
    module = _load_module()
    findings = module._build_deterministic_findings(
        seo_snapshot=[],
        console_errors=[
            {
                "route": "/admin/content/pages",
                "surface": "admin",
                "severity": "s4",
                "level": "error",
                "text": "Failed resource request: status 404 | xhr | GET | http://127.0.0.1:8001/api/v1/content/admin/cms.snippets",
                "request_url": "http://127.0.0.1:8001/api/v1/content/admin/cms.snippets",
                "status_code": 404,
                "resource_type": "xhr",
                "method": "GET",
            }
        ],
        layout_signals=[],
    )
    assert findings == []


def test_non_allowlisted_resource_failure_remains_clustered() -> None:
    module = _load_module()
    findings = module._build_deterministic_findings(
        seo_snapshot=[],
        console_errors=[
            {
                "route": "/admin/content/settings",
                "surface": "admin",
                "severity": "s4",
                "level": "error",
                "text": "Failed resource request: status 500 | xhr | GET | http://127.0.0.1:8001/api/v1/content/admin/site.social",
                "request_url": "http://127.0.0.1:8001/api/v1/content/admin/site.social",
                "status_code": 500,
                "resource_type": "xhr",
                "method": "GET",
            }
        ],
        layout_signals=[],
    )
    assert len(findings) == 1
    assert findings[0]["rule_id"] == "browser_console_noise_cluster"
    assert findings[0]["severity"] == "s4"
    assert findings[0]["endpoint_class"] == "admin_site_content"
    assert findings[0]["status_code"] == 500


def test_expected_admin_access_403_noise_is_suppressed() -> None:
    module = _load_module()
    findings = module._build_deterministic_findings(
        seo_snapshot=[],
        console_errors=[
            {
                "route": "/admin/content",
                "surface": "admin",
                "severity": "s4",
                "level": "error",
                "text": "Failed resource request: status 403 | xhr | GET | http://127.0.0.1:8000/api/v1/auth/admin/access",
                "request_url": "http://127.0.0.1:8000/api/v1/auth/admin/access",
                "status_code": 403,
                "resource_type": "xhr",
                "method": "GET",
            }
        ],
        layout_signals=[],
    )
    assert findings == []


def test_expected_example_orb_image_noise_is_suppressed() -> None:
    module = _load_module()
    findings = module._build_deterministic_findings(
        seo_snapshot=[],
        console_errors=[
            {
                "route": "/shop",
                "surface": "storefront",
                "severity": "s4",
                "level": "error",
                "text": "Failed resource request: net::ERR_BLOCKED_BY_ORB | image | GET | https://example.com/images/blue-bowl-1.jpg",
                "request_url": "https://example.com/images/blue-bowl-1.jpg",
                "status_code": None,
                "resource_type": "image",
                "method": "GET",
                "failure_text": "net::ERR_BLOCKED_BY_ORB",
            }
        ],
        layout_signals=[],
    )
    assert findings == []


def test_unexpected_token_cluster_is_suppressed_for_admin_surface() -> None:
    module = _load_module()
    findings = module._build_deterministic_findings(
        seo_snapshot=[],
        console_errors=[
            {
                "route": "/admin/content/pages",
                "surface": "admin",
                "severity": "s4",
                "level": "error",
                "text": "Unexpected token '<'",
            }
        ],
        layout_signals=[],
    )
    assert findings == []


def test_unexpected_token_cluster_remains_for_public_storefront() -> None:
    module = _load_module()
    findings = module._build_deterministic_findings(
        seo_snapshot=[],
        console_errors=[
            {
                "route": "/shop",
                "surface": "storefront",
                "severity": "s4",
                "level": "error",
                "text": "Unexpected token '<'",
            }
        ],
        layout_signals=[],
    )
    assert len(findings) == 1
    assert findings[0]["rule_id"] == "browser_console_noise_cluster"
    assert findings[0]["severity"] == "s4"


def test_canonical_policy_requires_clean_en_and_lang_ro() -> None:
    module = _load_module()
    findings = module._build_deterministic_findings(
        seo_snapshot=[
            {
                "route": "/shop",
                "resolved_route": "/shop",
                "surface": "storefront",
                "title": "Shop",
                "description": "Browse products.",
                "canonical": "https://momentstudio.ro/shop?lang=en",
                "robots": "index,follow",
                "h1_count": 1,
                "word_count_initial_html": 100,
                "meaningful_text_block_count": 2,
                "internal_link_count": 3,
                "indexable": True,
            },
            {
                "route": "/shop?lang=ro",
                "resolved_route": "/shop?lang=ro",
                "surface": "storefront",
                "title": "Shop RO",
                "description": "Exploreaza produse.",
                "canonical": "https://momentstudio.ro/shop",
                "robots": "index,follow",
                "h1_count": 1,
                "word_count_initial_html": 100,
                "meaningful_text_block_count": 2,
                "internal_link_count": 3,
                "indexable": True,
            },
        ],
        console_errors=[],
        layout_signals=[],
    )
    mismatches = [row for row in findings if row["rule_id"] == "seo_canonical_policy_mismatch"]
    assert len(mismatches) == 2


def test_indexable_missing_description_and_thin_content_rules() -> None:
    module = _load_module()
    findings = module._build_deterministic_findings(
        seo_snapshot=[
            {
                "route": "/about",
                "resolved_route": "/about",
                "surface": "storefront",
                "title": "About",
                "description": "",
                "canonical": "https://momentstudio.ro/about",
                "robots": "index,follow",
                "h1_count": 1,
                "word_count_initial_html": 12,
                "meaningful_text_block_count": 0,
                "internal_link_count": 1,
                "indexable": True,
            }
        ],
        console_errors=[],
        layout_signals=[],
    )
    rules = {row["rule_id"] for row in findings}
    assert "seo_missing_description" in rules
    assert "seo_no_meaningful_text" in rules
    assert "seo_low_internal_links" in rules


def test_no_meaningful_text_rule_skips_when_route_has_api_noise_console_error() -> None:
    module = _load_module()
    findings = module._build_deterministic_findings(
        seo_snapshot=[
            {
                "route": "/about",
                "route_template": "/about",
                "resolved_route": "/about",
                "surface": "storefront",
                "title": "About",
                "description": "About page",
                "canonical": "https://momentstudio.ro/about",
                "robots": "index,follow",
                "h1_count": 1,
                "word_count_initial_html": 0,
                "meaningful_text_block_count": 0,
                "internal_link_count": 0,
                "indexable": True,
            }
        ],
        console_errors=[
            {
                "route": "/about",
                "route_template": "/about",
                "resolved_route": "/about",
                "surface": "storefront",
                "severity": "s4",
                "level": "error",
                "text": "Unexpected token '<'",
            }
        ],
        layout_signals=[],
    )
    rules = {row["rule_id"] for row in findings}
    assert "seo_no_meaningful_text" not in rules
    assert "seo_low_internal_links" not in rules


def test_visibility_issue_emits_actionable_finding() -> None:
    module = _load_module()
    findings = module._build_deterministic_findings(
        seo_snapshot=[],
        console_errors=[],
        layout_signals=[],
        visibility_signals=[
            {
                "route": "/admin/dashboard",
                "route_template": "/admin/dashboard",
                "surface": "admin",
                "visibility_issue": True,
                "issue_reasons": ["form_controls_appear_after_passive_events"],
            }
        ],
    )
    matches = [row for row in findings if row["rule_id"] == "ux_visibility_after_interaction"]
    assert len(matches) == 1
    assert matches[0]["severity"] == "s2"
