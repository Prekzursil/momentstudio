"""Lean-gate unit coverage for ``app.middleware.security``.

The pure redaction helpers are exercised directly (empty key, max recursion
depth, dict/list truncation, long-string clipping). The middleware classes are
driven through a minimal Starlette app so the body-read exception path, the
bearer-token user extraction, the malformed-JSON payload path and the security
header branches all run.
"""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.security import create_access_token
from app.middleware.security import (
    AuditMiddleware,
    SecurityHeadersMiddleware,
    _is_sensitive_key,
    _redact_payload,
)


def test_is_sensitive_key_branches() -> None:
    assert _is_sensitive_key("") is False
    assert _is_sensitive_key("   ") is False
    assert _is_sensitive_key("password") is True  # exact match
    assert _is_sensitive_key("billing_address") is True  # fragment match
    assert _is_sensitive_key("quantity") is False


def test_redact_payload_depth_and_truncation() -> None:
    # Max recursion depth -> "***".
    deep: dict = {}
    cur = deep
    for _ in range(8):
        cur["child"] = {}
        cur = cur["child"]
    redacted = _redact_payload(deep)
    assert "***" in repr(redacted)

    # Dict truncation past 80 keys.
    big_dict = {f"k{i}": i for i in range(100)}
    out = _redact_payload(big_dict)
    assert out["..."] == "truncated"

    # List truncation past 80 items.
    big_list = list(range(100))
    out_list = _redact_payload(big_list)
    assert out_list[-1] == "...truncated"

    # Long string clipped to 2000 chars.
    long_str = "x" * 5000
    assert len(_redact_payload(long_str)) == 2000

    # Sensitive key redacted within a dict.
    assert _redact_payload({"password": "p"})["password"] == "***"

    # A short list completes its loop without hitting the truncation break.
    assert _redact_payload([1, 2, 3]) == [1, 2, 3]


def _build_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(AuditMiddleware)

    @app.post("/echo")
    async def echo(request: Request) -> dict:
        return {"ok": True}

    return app


def test_audit_middleware_logs_json_and_bearer_user(monkeypatch) -> None:
    monkeypatch.setattr(settings, "csp_enabled", True, raising=False)
    monkeypatch.setattr(settings, "secure_cookies", True, raising=False)
    client = TestClient(_build_app())

    token = create_access_token("user-123")
    res = client.post(
        "/echo",
        json={"password": "secret", "quantity": 3},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    # Security headers applied.
    assert "Content-Security-Policy" in res.headers
    assert "Strict-Transport-Security" in res.headers
    assert res.headers["X-Content-Type-Options"] == "nosniff"


def test_audit_middleware_malformed_json_payload() -> None:
    client = TestClient(_build_app())
    # Declared JSON content-type but invalid body -> json.loads raises, handled.
    res = client.post(
        "/echo",
        content=b"{not-json",
        headers={"Content-Type": "application/json"},
    )
    assert res.status_code == 200


def test_audit_middleware_body_read_exception() -> None:
    import asyncio

    from starlette.responses import PlainTextResponse

    mw = AuditMiddleware(app=lambda scope, receive, send: None)

    class _BoomRequest:
        headers: dict = {}
        method = "POST"

        class _URL:
            path = "/boom"

        url = _URL()
        client = None

        async def body(self):
            raise RuntimeError("boom")

    async def _call_next(_request):
        return PlainTextResponse("ok")

    async def run() -> None:
        resp = await mw.dispatch(_BoomRequest(), _call_next)
        assert resp.status_code == 200

    asyncio.run(run())


def test_security_headers_disabled_branches(monkeypatch) -> None:
    monkeypatch.setattr(settings, "csp_enabled", False, raising=False)
    monkeypatch.setattr(settings, "secure_cookies", False, raising=False)
    client = TestClient(_build_app())
    res = client.post("/echo", json={"a": 1})
    assert res.status_code == 200
    assert "Content-Security-Policy" not in res.headers
    assert "Strict-Transport-Security" not in res.headers


def test_audit_middleware_payload_logging_disabled(monkeypatch) -> None:
    # log_payload False -> body read is skipped entirely (100->109 branch).
    monkeypatch.setattr(settings, "audit_log_request_payload", False, raising=False)
    client = TestClient(_build_app())
    res = client.post("/echo", json={"a": 1})
    assert res.status_code == 200


def test_audit_middleware_large_body_not_decoded(monkeypatch) -> None:
    # Body present but >= max_bytes -> not decoded (104->109 branch).
    monkeypatch.setattr(settings, "audit_log_max_body_bytes", 8, raising=False)
    client = TestClient(_build_app())
    res = client.post("/echo", json={"a": "x" * 100})
    assert res.status_code == 200


def test_audit_middleware_bearer_without_sub() -> None:
    import jwt

    # A valid-but-subjectless token: decode succeeds, ``sub`` missing (114->117).
    token = jwt.encode(
        {"type": "access"}, settings.secret_key, algorithm=settings.jwt_algorithm
    )
    client = TestClient(_build_app())
    res = client.post(
        "/echo", json={"a": 1}, headers={"Authorization": f"Bearer {token}"}
    )
    assert res.status_code == 200
