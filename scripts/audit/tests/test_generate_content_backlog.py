from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def _load_module():
    module_path = Path(__file__).resolve().parents[2] / "seo" / "generate_content_backlog.py"
    spec = importlib.util.spec_from_file_location("generate_content_backlog", module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_backlog_accepts_new_seo_rule_ids_and_evidence_files() -> None:
    module = _load_module()
    findings = [
        {
            "rule_id": "seo_missing_description",
            "route": "/about",
            "severity": "s2",
            "title": "Missing description",
            "labels": ["audit:seo"],
            "indexable": True,
            "evidence_files": ["seo-snapshot.json"],
        },
        {
            "rule_id": "seo_low_internal_links",
            "route": "/about",
            "severity": "s3",
            "title": "Low internal links",
            "labels": ["audit:seo"],
            "indexable": True,
            "evidence_files": ["seo-snapshot.json", "layout-signals.json"],
        },
    ]
    backlog = module.build_backlog(findings)

    assert len(backlog) == 2
    by_type = {item.issue_type: item for item in backlog}
    assert "description" in by_type
    assert "internal_links" in by_type
    assert by_type["description"].route == "/about"
    assert "seo-snapshot.json" in by_type["description"].evidence
    assert "layout-signals.json" in by_type["internal_links"].evidence


def test_backlog_skips_non_indexable_or_non_seo_findings() -> None:
    module = _load_module()
    findings = [
        {
            "rule_id": "seo_missing_description",
            "route": "/account",
            "severity": "s2",
            "title": "Missing description",
            "labels": ["audit:seo"],
            "indexable": False,
            "evidence_files": ["seo-snapshot.json"],
        },
        {
            "rule_id": "browser_console_error",
            "route": "/shop",
            "severity": "s2",
            "title": "Browser error",
            "labels": ["audit:correctness"],
            "indexable": True,
            "evidence_files": ["console-errors.json"],
        },
    ]
    assert module.build_backlog(findings) == []
