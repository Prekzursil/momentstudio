from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

FINDINGS_PAYLOAD = [
    {
        "fingerprint": "fp-severe",
        "severity": "s2",
        "title": "Severe finding",
        "route": "/shop",
        "surface": "storefront",
    },
    {
        "fingerprint": "fp-low",
        "severity": "s3",
        "title": "Low finding",
        "route": "/about",
        "surface": "storefront",
    },
]

SEVERE_OUTPUT_PAYLOAD = [
    {
        "issue_number": 220,
        "issue_node_id": "I_kwDO-example",
        "fingerprint": "fp-severe",
        "route": "/shop",
        "surface": "storefront",
        "severity": "s2",
        "action": "created",
    }
]


def _load_module():
    module_path = Path(__file__).resolve().parents[1] / "upsert_audit_issues.py"
    spec = importlib.util.spec_from_file_location("upsert_audit_issues", module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _write_findings(tmp_path: Path) -> None:
    findings_path = tmp_path / "artifacts" / "audit-evidence" / "deterministic-findings.json"
    findings_path.parent.mkdir(parents=True, exist_ok=True)
    findings_path.write_text(json.dumps(FINDINGS_PAYLOAD), encoding="utf-8")


def _expected_output_path(tmp_path: Path) -> Path:
    return tmp_path / "artifacts" / "audit-evidence" / "severe-issues-upserted.json"


def test_main_writes_severe_output_and_excludes_non_severe(tmp_path, monkeypatch) -> None:
    module = _load_module()
    monkeypatch.setattr(module, "_repo_root", lambda: tmp_path)
    _write_findings(tmp_path)

    observed: dict[str, object] = {}

    def fake_upsert(ctx, findings, run_url, *, include_s3_seo):
        observed["count"] = len(findings)
        observed["fingerprints"] = [row.get("fingerprint") for row in findings]
        observed["include_s3_seo"] = include_s3_seo
        return (1, 0, SEVERE_OUTPUT_PAYLOAD)

    monkeypatch.setattr(module, "_upsert_issues", fake_upsert)
    monkeypatch.setattr(
        module,
        "_github_context",
        lambda _: module.GitHubContext(token="x", owner="Prekzursil", repo="AdrianaArt"),
    )

    argv = [
        "upsert_audit_issues.py",
        "--findings",
        "artifacts/audit-evidence/deterministic-findings.json",
        "--severe-output",
        "artifacts/audit-evidence/severe-issues-upserted.json",
        "--skip-digest",
    ]
    monkeypatch.setattr(sys, "argv", argv)

    assert module.main() == 0
    assert observed["count"] == 2
    assert observed["fingerprints"] == ["fp-severe", "fp-low"]
    assert observed["include_s3_seo"] is False

    severe_output = _expected_output_path(tmp_path)
    payload = json.loads(severe_output.read_text(encoding="utf-8"))
    assert payload == SEVERE_OUTPUT_PAYLOAD


def test_upsert_severe_returns_updated_entry_for_existing_issue(monkeypatch) -> None:
    module = _load_module()
    ctx = module.GitHubContext(token="x", owner="Prekzursil", repo="AdrianaArt")

    marker = "fp-existing"
    open_issue = {
        "number": 42,
        "node_id": "I_kwDO-existing",
        "title": "old",
        "body": f"<!-- audit:fingerprint:{marker} -->\nold body",
    }

    monkeypatch.setattr(module, "_list_open_issues", lambda *_args, **_kwargs: [open_issue])

    calls: list[tuple[str, str, dict[str, object] | None]] = []

    def fake_request(_ctx, method, path, payload=None):
        calls.append((method, path, payload))
        return {}

    monkeypatch.setattr(module, "_request", fake_request)

    finding = {
        "fingerprint": marker,
        "severity": "s2",
        "title": "Browser error",
        "route": "/shop",
        "surface": "storefront",
        "labels": ["severity:s2", "surface:storefront"],
    }

    rows = module._upsert_severe(ctx, [finding], None)

    assert rows == [
        {
            "issue_number": 42,
            "issue_node_id": "I_kwDO-existing",
            "fingerprint": "fp-existing",
            "route": "/shop",
            "surface": "storefront",
            "severity": "s2",
            "action": "updated",
        }
    ]
    assert calls
    assert calls[0][0] == "PATCH"
    assert calls[0][1].endswith("/issues/42")
