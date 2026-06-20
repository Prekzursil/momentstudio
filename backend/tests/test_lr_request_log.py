"""Lean-gate unit coverage for ``app.middleware.request_log``."""

from __future__ import annotations

import pytest

from app.core.logging_config import request_id_ctx_var
from app.middleware.request_log import RequestLoggingMiddleware


class _FakeURL:
    path = "/x"


class _FakeRequest:
    def __init__(self) -> None:
        self.url = _FakeURL()
        self.method = "GET"

        class _State:
            pass

        self.state = _State()


class _FakeResponse:
    def __init__(self) -> None:
        self.headers: dict[str, str] = {}
        self.status_code = 200


@pytest.mark.anyio
async def test_dispatch_success_sets_request_id_header() -> None:
    mw = RequestLoggingMiddleware(app=lambda scope, receive, send: None)
    request = _FakeRequest()
    response = _FakeResponse()

    async def call_next(req):  # noqa: ANN001
        return response

    out = await mw.dispatch(request, call_next)
    assert out is response
    assert "X-Request-ID" in out.headers
    assert request.state.request_id == out.headers["X-Request-ID"]
    # Context var is reset back to the default after dispatch.
    assert request_id_ctx_var.get() is None


@pytest.mark.anyio
async def test_dispatch_exception_skips_logging_and_resets() -> None:
    mw = RequestLoggingMiddleware(app=lambda scope, receive, send: None)
    request = _FakeRequest()

    async def call_next(req):  # noqa: ANN001
        raise RuntimeError("downstream failure")

    with pytest.raises(RuntimeError):
        await mw.dispatch(request, call_next)
    # response stayed None -> header/log skipped, but the context var is reset.
    assert request_id_ctx_var.get() is None
