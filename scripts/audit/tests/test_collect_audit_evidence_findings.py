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
    assert findings[0]["rule_id"] == "browser_console_error"
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
