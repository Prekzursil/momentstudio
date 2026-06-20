"""Lean-gate coverage for ``app.main`` lifespan + exception handlers."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import main as main_module


@pytest.fixture
def stub_schedulers(monkeypatch):
    """Replace scheduler start/stop + redis close with no-ops for lifespan tests."""
    for mod_name in (
        "fx_refresh",
        "admin_report_scheduler",
        "account_deletion_scheduler",
        "order_expiration_scheduler",
        "media_usage_reconcile_scheduler",
        "sameday_easybox_sync_scheduler",
    ):
        mod = getattr(main_module, mod_name)
        monkeypatch.setattr(mod, "start", lambda app: None)

        async def _stop(app, _m=mod):  # noqa: ANN001
            return None

        monkeypatch.setattr(mod, "stop", _stop)

    async def _close_redis():
        return None

    monkeypatch.setattr(main_module.redis_client, "close_redis", _close_redis)


def test_lifespan_starts_and_stops(stub_schedulers) -> None:
    app = main_module.get_application()
    # Entering the TestClient context manager runs the lifespan startup/shutdown.
    with TestClient(app) as client:
        res = client.get("/api/v1/health")
        assert res.status_code == 200


@pytest.mark.anyio
async def test_http_exception_handler_429_with_request_id() -> None:
    app = main_module.get_application()
    handler = app.exception_handlers[
        __import__("starlette.exceptions", fromlist=["HTTPException"]).HTTPException
    ]
    from starlette.exceptions import HTTPException as StarletteHTTPException

    class _State:
        request_id = "rid-123"

    class _Req:
        state = _State()

    exc = StarletteHTTPException(
        status_code=429, detail="Too many requests", headers={"Retry-After": "5"}
    )
    resp = await handler(_Req(), exc)
    assert resp.status_code == 429
    import json

    body = json.loads(bytes(resp.body))
    assert body["request_id"] == "rid-123"
    assert body["retry_after"] == 5


@pytest.mark.anyio
async def test_http_exception_handler_429_non_int_retry_after() -> None:
    app = main_module.get_application()
    from starlette.exceptions import HTTPException as StarletteHTTPException

    handler = app.exception_handlers[StarletteHTTPException]

    class _State:
        request_id = None

    class _Req:
        state = _State()

    exc = StarletteHTTPException(
        status_code=429, detail="Too many", headers={"Retry-After": "soon"}
    )
    resp = await handler(_Req(), exc)
    import json

    body = json.loads(bytes(resp.body))
    # Non-int retry-after falls back to the string value.
    assert body["retry_after"] == "soon"
    assert "request_id" not in body


@pytest.mark.anyio
async def test_http_exception_handler_generic_with_error_code() -> None:
    app = main_module.get_application()
    from starlette.exceptions import HTTPException as StarletteHTTPException

    handler = app.exception_handlers[StarletteHTTPException]

    class _Req:
        class state:  # noqa: N801
            request_id = None

    exc = StarletteHTTPException(
        status_code=403, detail="Nope", headers={"X-Error-Code": "forbidden"}
    )
    resp = await handler(_Req(), exc)
    import json

    body = json.loads(bytes(resp.body))
    assert resp.status_code == 403
    assert body["code"] == "forbidden"


@pytest.mark.anyio
async def test_validation_exception_handler() -> None:
    app = main_module.get_application()
    from fastapi.exceptions import RequestValidationError

    handler = app.exception_handlers[RequestValidationError]
    exc = RequestValidationError(errors=[{"loc": ["body"], "msg": "bad", "type": "x"}])

    class _Req:
        pass

    resp = await handler(_Req(), exc)
    assert resp.status_code == 422
    import json

    body = json.loads(bytes(resp.body))
    assert body["code"] == "validation_error"
