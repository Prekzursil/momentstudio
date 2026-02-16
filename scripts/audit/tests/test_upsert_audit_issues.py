from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def _load_module():
    module_path = Path(__file__).resolve().parents[1] / "upsert_audit_issues.py"
    spec = importlib.util.spec_from_file_location("upsert_audit_issues", module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_should_upsert_issue_includes_s1_s2_and_optional_s3_seo() -> None:
    module = _load_module()
    severe = {"severity": "s2", "labels": ["audit:correctness"]}
    seo_s3 = {"severity": "s3", "labels": ["audit:seo"], "indexable": True}
    seo_s3_non_indexable = {"severity": "s3", "labels": ["audit:seo"], "indexable": False}
    low = {"severity": "s4", "labels": ["audit:seo"], "indexable": True}

    assert module._should_upsert_issue(severe, include_s3_seo=False)
    assert module._should_upsert_issue(severe, include_s3_seo=True)
    assert not module._should_upsert_issue(seo_s3, include_s3_seo=False)
    assert module._should_upsert_issue(seo_s3, include_s3_seo=True)
    assert not module._should_upsert_issue(seo_s3_non_indexable, include_s3_seo=True)
    assert not module._should_upsert_issue(low, include_s3_seo=True)


def test_upsert_issues_updates_existing_and_creates_new(monkeypatch) -> None:
    module = _load_module()
    ctx = module.GitHubContext(token="token", owner="octo", repo="demo")
    findings = [
        {
            "fingerprint": "fp-existing",
            "severity": "s2",
            "surface": "storefront",
            "title": "Existing finding",
            "labels": ["audit:seo", "surface:storefront", "severity:s2"],
        },
        {
            "fingerprint": "fp-new",
            "severity": "s3",
            "surface": "storefront",
            "title": "New SEO s3",
            "labels": ["audit:seo", "surface:storefront", "severity:s3"],
            "indexable": True,
        },
    ]

    module._list_open_issues = lambda _ctx, labels=None: [
        {
            "number": 77,
            "title": "Existing",
            "body": "<!-- audit:fingerprint:fp-existing -->\n\nBody",
        }
    ]

    created_calls: list[tuple[str, str, list[str]]] = []
    patched_numbers: list[int] = []

    def fake_request(_ctx, method: str, path: str, payload=None):
        if method == "PATCH":
            patched_numbers.append(int(path.split("/")[-1]))
            return {"number": 77}
        raise AssertionError(f"Unexpected request: {method} {path}")

    def fake_create_issue(_ctx, *, title: str, body: str, labels: list[str]):
        created_calls.append((title, body, labels))
        return {"number": 88}

    monkeypatch.setattr(module, "_request", fake_request)
    monkeypatch.setattr(module, "_safe_create_issue", fake_create_issue)

    created, updated = module._upsert_issues(
        ctx,
        findings,
        run_url="https://example.test/run",
        include_s3_seo=True,
    )
    assert created == 1
    assert updated == 1
    assert patched_numbers == [77]
    assert len(created_calls) == 1
    assert "ai:ready" in created_calls[0][2]
