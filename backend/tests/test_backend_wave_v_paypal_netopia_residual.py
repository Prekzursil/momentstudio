from __future__ import annotations

from decimal import Decimal
from typing import Any

import httpx
import pytest
from fastapi import HTTPException

from app.services import netopia as netopia_service
from app.services import paypal as paypal_service


class _DummyResponse:
    def __init__(
        self,
        *,
        status_code: int = 200,
        payload: Any | None = None,
        raise_http: bool = False,
        raise_json: bool = False,
    ) -> None:
        self.status_code = status_code
        self._payload = {} if payload is None else payload
        self._raise_http = raise_http
        self._raise_json = raise_json

    def raise_for_status(self) -> None:
        if self._raise_http:
            request = httpx.Request("POST", "https://example.test/api")
            response = httpx.Response(self.status_code or 500, request=request)
            raise httpx.HTTPStatusError("http failure", request=request, response=response)

    def json(self) -> Any:
        if self._raise_json:
            raise ValueError("invalid-json")
        return self._payload


class _AsyncClientStub:
    def __init__(
        self,
        *,
        response: _DummyResponse | None = None,
        error: Exception | None = None,
        calls: list[dict[str, Any]] | None = None,
        **_kwargs: Any,
    ) -> None:
        self._response = response or _DummyResponse()
        self._error = error
        self._calls = calls if calls is not None else []

    def __aenter__(self) -> "_AsyncClientStub":
        return self

    def __aexit__(self, exc_type, exc, tb) -> bool:
        del exc_type, exc, tb
        return False

    def post(self, url: str, **kwargs: Any) -> _DummyResponse:
        self._calls.append({"url": url, **kwargs})
        if self._error is not None:
            raise self._error
        return self._response


@pytest.mark.anyio
async def test_paypal_get_access_token_and_create_itemized_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    paypal_service._token_cache.clear()
    monkeypatch.setattr(paypal_service.settings, "paypal_env", "sandbox")
    monkeypatch.setattr(paypal_service.settings, "paypal_client_id_sandbox", "sandbox-id")
    monkeypatch.setattr(paypal_service.settings, "paypal_client_secret_sandbox", "sandbox-cred")
    monkeypatch.setattr(paypal_service.settings, "paypal_client_id", "")
    monkeypatch.setattr(paypal_service.settings, "paypal_client_secret", "")

    def _fetch_ok(*, client_id: str, client_secret: str) -> dict[str, Any]:
        assert client_id == "sandbox-id"
        assert client_secret == "sandbox-cred"
        return {"access_token": "access-value", "expires_in": 120}

    monkeypatch.setattr(paypal_service, "_fetch_access_token", _fetch_ok)
    token = await paypal_service._get_access_token()
    assert token == "access-value"

    def _fetch_missing(*, client_id: str, client_secret: str) -> dict[str, Any]:
        del client_id, client_secret
        return {"expires_in": 120}

    paypal_service._token_cache.clear()
    monkeypatch.setattr(paypal_service, "_fetch_access_token", _fetch_missing)
    with pytest.raises(HTTPException, match="PayPal token missing"):
        await paypal_service._get_access_token()

    def _token() -> str:
        return "auth-value"

    def _fx(*_args: Any, **_kwargs: Any) -> Decimal:
        return Decimal("0.2")

    def _order_response(*, token: str, payload: dict[str, Any]) -> dict[str, Any]:
        assert token == "auth-value"
        assert payload["intent"] == "CAPTURE"
        return {"id": "ORDER-1234", "links": [{"rel": "approve", "href": "https://paypal.example/approve"}]}

    monkeypatch.setattr(paypal_service, "_get_access_token", _token)
    monkeypatch.setattr(paypal_service, "_fx_per_ron", _fx)
    monkeypatch.setattr(paypal_service, "_create_order_response", _order_response)

    order_id, approval_url = await paypal_service.create_order_itemized(
        total_ron=Decimal("120.00"),
        reference="REF-100",
        return_url="https://shop.test/return",
        cancel_url="https://shop.test/cancel",
        item_total_ron=Decimal("100.00"),
        shipping_ron=Decimal("20.00"),
        discount_ron=Decimal("0.00"),
        items=[],
        currency_code="EUR",
    )
    assert order_id == "ORDER-1234"
    assert approval_url.startswith("https://paypal.example/")

    def _order_response_missing(*, token: str, payload: dict[str, Any]) -> dict[str, Any]:
        del token, payload
        return {"id": "", "links": []}

    monkeypatch.setattr(paypal_service, "_create_order_response", _order_response_missing)
    with pytest.raises(HTTPException, match="approval link missing"):
        await paypal_service.create_order_itemized(
            total_ron=Decimal("120.00"),
            reference="REF-101",
            return_url="https://shop.test/return",
            cancel_url="https://shop.test/cancel",
            item_total_ron=Decimal("100.00"),
            shipping_ron=Decimal("20.00"),
            discount_ron=Decimal("0.00"),
            items=[],
            currency_code="EUR",
        )


@pytest.mark.anyio
async def test_paypal_capture_refund_and_webhook_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, Any]] = []
    request_error = httpx.RequestError("network-failure", request=httpx.Request("POST", "https://paypal.test"))

    def _token() -> str:
        return "auth-value"

    monkeypatch.setattr(paypal_service, "_get_access_token", _token)
    monkeypatch.setattr(paypal_service.settings, "paypal_env", "sandbox")
    monkeypatch.setattr(paypal_service.settings, "paypal_webhook_id_sandbox", "webhook-value")
    monkeypatch.setattr(paypal_service.settings, "paypal_webhook_id", "")

    def _client_success(*_args: Any, **kwargs: Any) -> _AsyncClientStub:
        del kwargs
        return _AsyncClientStub(
            response=_DummyResponse(
                payload={
                    "purchase_units": [
                        {"payments": {"captures": [{"id": "CAPTURE-1234"}]}},
                    ]
                }
            ),
            calls=calls,
        )

    monkeypatch.setattr(paypal_service.httpx, "AsyncClient", _client_success)
    capture_id = await paypal_service.capture_order(paypal_order_id="ORDER-1234")
    assert capture_id == "CAPTURE-1234"
    assert any("/v2/checkout/orders/" in c["url"] for c in calls)

    calls.clear()

    def _client_http_error(*_args: Any, **kwargs: Any) -> _AsyncClientStub:
        del kwargs
        return _AsyncClientStub(response=_DummyResponse(status_code=500, raise_http=True), calls=calls)

    monkeypatch.setattr(paypal_service.httpx, "AsyncClient", _client_http_error)
    with pytest.raises(HTTPException, match="PayPal capture failed"):
        await paypal_service.capture_order(paypal_order_id="ORDER-1234")

    calls.clear()

    def _fx(*_args: Any, **_kwargs: Any) -> Decimal:
        return Decimal("0.2")

    monkeypatch.setattr(paypal_service, "_fx_per_ron", _fx)

    def _client_refund_success(*_args: Any, **kwargs: Any) -> _AsyncClientStub:
        del kwargs
        return _AsyncClientStub(response=_DummyResponse(payload={"id": "REFUND-1"}), calls=calls)

    monkeypatch.setattr(paypal_service.httpx, "AsyncClient", _client_refund_success)
    refund_id = await paypal_service.refund_capture(
        paypal_capture_id="CAPTURE-1234",
        amount_ron=Decimal("50.00"),
        currency_code="EUR",
    )
    assert refund_id == "REFUND-1"
    assert calls and calls[0]["json"]["amount"]["currency_code"] == "EUR"

    calls.clear()

    def _client_refund_http_error(*_args: Any, **kwargs: Any) -> _AsyncClientStub:
        del kwargs
        return _AsyncClientStub(response=_DummyResponse(status_code=502, raise_http=True), calls=calls)

    monkeypatch.setattr(paypal_service.httpx, "AsyncClient", _client_refund_http_error)
    with pytest.raises(HTTPException, match="PayPal refund failed"):
        await paypal_service.refund_capture(paypal_capture_id="CAPTURE-1234")

    calls.clear()

    def _client_webhook_ok(*_args: Any, **kwargs: Any) -> _AsyncClientStub:
        del kwargs
        return _AsyncClientStub(response=_DummyResponse(payload={"verification_status": "SUCCESS"}), calls=calls)

    monkeypatch.setattr(paypal_service.httpx, "AsyncClient", _client_webhook_ok)
    verified = await paypal_service.verify_webhook_signature(
        headers={
            "paypal-auth-algo": "SHA256",
            "paypal-cert-url": "https://example/cert.pem",
            "paypal-transmission-id": "tid-1",
            "paypal-transmission-sig": "sig-1",
            "paypal-transmission-time": "2026-03-04T00:00:00Z",
        },
        event={"id": "evt-1"},
    )
    assert verified is True

    def _client_webhook_error(*_args: Any, **kwargs: Any) -> _AsyncClientStub:
        del kwargs
        return _AsyncClientStub(error=request_error, calls=calls)

    monkeypatch.setattr(paypal_service.httpx, "AsyncClient", _client_webhook_error)
    with pytest.raises(HTTPException, match="signature verification failed"):
        await paypal_service.verify_webhook_signature(
            headers={
                "paypal-auth-algo": "SHA256",
                "paypal-cert-url": "https://example/cert.pem",
                "paypal-transmission-id": "tid-1",
                "paypal-transmission-sig": "sig-1",
                "paypal-transmission-time": "2026-03-04T00:00:00Z",
            },
            event={"id": "evt-2"},
        )

    monkeypatch.setattr(paypal_service.settings, "paypal_webhook_id_sandbox", "")
    with pytest.raises(HTTPException, match="webhook id not configured"):
        await paypal_service.verify_webhook_signature(
            headers={
                "paypal-auth-algo": "SHA256",
                "paypal-cert-url": "https://example/cert.pem",
                "paypal-transmission-id": "tid-1",
                "paypal-transmission-sig": "sig-1",
                "paypal-transmission-time": "2026-03-04T00:00:00Z",
            },
            event={"id": "evt-3"},
        )


@pytest.mark.anyio
async def test_netopia_get_status_and_configuration_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, Any]] = []

    monkeypatch.setattr(netopia_service.settings, "netopia_enabled", False)
    with pytest.raises(HTTPException, match="Not found"):
        await netopia_service.get_status(ntp_id="NTP-1", order_id="ORD-1")

    monkeypatch.setattr(netopia_service.settings, "netopia_enabled", True)
    monkeypatch.setattr(netopia_service, "_netopia_pos_signature", lambda: "")
    with pytest.raises(HTTPException, match="not configured"):
        await netopia_service.get_status(ntp_id="NTP-1", order_id="ORD-1")

    monkeypatch.setattr(netopia_service, "_netopia_pos_signature", lambda: "POS-1")
    monkeypatch.setattr(netopia_service, "_netopia_headers", lambda: {"Authorization": "api"})
    request_error = httpx.RequestError("network-failure", request=httpx.Request("POST", "https://netopia.test"))

    def _client_request_error(*_args: Any, **kwargs: Any) -> _AsyncClientStub:
        del kwargs
        return _AsyncClientStub(error=request_error, calls=calls)

    monkeypatch.setattr(netopia_service.httpx, "AsyncClient", _client_request_error)
    with pytest.raises(HTTPException, match="request failed"):
        await netopia_service.get_status(ntp_id="NTP-1", order_id="ORD-1")

    def _client_status_error(*_args: Any, **kwargs: Any) -> _AsyncClientStub:
        del kwargs
        return _AsyncClientStub(response=_DummyResponse(status_code=500, payload={"error": "boom"}), calls=calls)

    monkeypatch.setattr(netopia_service.httpx, "AsyncClient", _client_status_error)
    with pytest.raises(HTTPException, match="status lookup failed"):
        await netopia_service.get_status(ntp_id="NTP-1", order_id="ORD-1")

    def _client_invalid_json(*_args: Any, **kwargs: Any) -> _AsyncClientStub:
        del kwargs
        return _AsyncClientStub(response=_DummyResponse(status_code=200, raise_json=True), calls=calls)

    monkeypatch.setattr(netopia_service.httpx, "AsyncClient", _client_invalid_json)
    with pytest.raises(HTTPException, match="Invalid Netopia response"):
        await netopia_service.get_status(ntp_id="NTP-1", order_id="ORD-1")

    def _client_non_dict(*_args: Any, **kwargs: Any) -> _AsyncClientStub:
        del kwargs
        return _AsyncClientStub(response=_DummyResponse(status_code=200, payload=["not-dict"]), calls=calls)

    monkeypatch.setattr(netopia_service.httpx, "AsyncClient", _client_non_dict)
    with pytest.raises(HTTPException, match="Invalid Netopia response"):
        await netopia_service.get_status(ntp_id="NTP-1", order_id="ORD-1")

    def _client_ok(*_args: Any, **kwargs: Any) -> _AsyncClientStub:
        del kwargs
        return _AsyncClientStub(response=_DummyResponse(status_code=200, payload={"status": "paid"}), calls=calls)

    monkeypatch.setattr(netopia_service.httpx, "AsyncClient", _client_ok)
    result = await netopia_service.get_status(ntp_id="NTP-1", order_id="ORD-1")
    assert result == {"status": "paid"}
    assert calls and any("/operation/status" in str(call.get("url")) for call in calls)

    monkeypatch.setattr(netopia_service, "_configured_public_key_material", lambda _env: ("", ""))
    assert "Missing Netopia configuration:" in str(netopia_service._public_key_config_error("sandbox"))

    monkeypatch.setattr(netopia_service, "_configured_public_key_material", lambda _env: ("PEM", ""))
    monkeypatch.setattr(netopia_service, "_public_key_pem", lambda: "PEM")
    assert netopia_service._public_key_config_error("sandbox") is None

    def _raise_public_key() -> str:
        raise HTTPException(status_code=500, detail="bad key data")

    monkeypatch.setattr(netopia_service, "_public_key_pem", _raise_public_key)
    assert netopia_service._public_key_config_error("sandbox") == "bad key data"

