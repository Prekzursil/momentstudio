"""Lean coverage for ``app.api.v1.email_preview``.

The single ``GET /email-preview`` route is admin-gated. These tests override
``require_admin`` (so no auth plumbing is needed) and stub the email service so
the assertions target the route body itself: JSON-decoding the ``context`` query
param and delegating to ``email_service.preview_email`` with the parsed dict.
"""

import pytest
from fastapi.testclient import TestClient

from app.api.v1 import email_preview
from app.core.dependencies import require_admin
from app.main import app


@pytest.fixture
def admin_client(monkeypatch):
    captured: dict[str, object] = {}

    async def _fake_preview(template_name: str, context: dict) -> dict[str, str]:
        captured["template"] = template_name
        captured["context"] = context
        return {"text": f"text:{template_name}", "html": "<p>x</p>"}

    monkeypatch.setattr(email_preview.email_service, "preview_email", _fake_preview)

    async def _override_admin() -> str:
        return "admin"

    app.dependency_overrides[require_admin] = _override_admin
    client = TestClient(app)
    try:
        yield client, captured
    finally:
        client.close()
        app.dependency_overrides.pop(require_admin, None)


def test_preview_email_parses_context_and_delegates(admin_client) -> None:
    client, captured = admin_client

    resp = client.get(
        "/api/v1/email-preview",
        params={"template": "back_in_stock.txt.j2", "context": '{"name": "Ada"}'},
    )

    assert resp.status_code == 200
    assert resp.json() == {"text": "text:back_in_stock.txt.j2", "html": "<p>x</p>"}
    assert captured["template"] == "back_in_stock.txt.j2"
    assert captured["context"] == {"name": "Ada"}


def test_preview_email_defaults_empty_context_to_empty_dict(admin_client) -> None:
    client, captured = admin_client

    resp = client.get(
        "/api/v1/email-preview",
        params={"template": "base.txt.j2", "context": ""},
    )

    assert resp.status_code == 200
    # An empty ``context`` query string falls back to ``"{}"`` -> empty dict.
    assert captured["context"] == {}
    assert captured["template"] == "base.txt.j2"
