from __future__ import annotations

from decimal import Decimal

import httpx
import pytest
import simplejson

from app.core.config import settings
from app.services import netopia as netopia_service


@pytest.mark.anyio
async def test_netopia_start_payment_serializes_decimal_amount(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "netopia_enabled", True)
    monkeypatch.setattr(settings, "netopia_env", "sandbox")
    monkeypatch.setattr(settings, "netopia_api_key_sandbox", "API-KEY")
    monkeypatch.setattr(settings, "netopia_pos_signature_sandbox", "SIG-TEST")

    async def fake_post(  # type: ignore[no-untyped-def]
        self,
        url,
        *,
        headers=None,
        content=None,
        json=None,
        **_kwargs,
    ) -> httpx.Response:
        assert json is None
        assert isinstance(content, (bytes, bytearray))
        decoded = simplejson.loads(bytes(content).decode("utf-8"), use_decimal=True)
        assert decoded["order"]["amount"] == Decimal("12.34")
        assert isinstance(decoded["order"]["amount"], Decimal)
        assert decoded["order"]["posSignature"] == "SIG-TEST"
        return httpx.Response(
            200,
            json={"payment": {"paymentURL": "https://example.com/pay", "ntpID": "NTP-1"}},
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post, raising=True)

    ntp_id, payment_url = await netopia_service.start_payment(
        order_id="order-1",
        amount_ron=Decimal("12.34"),
        description="Order test",
        billing={},
        shipping={},
        products=[],
        language="ro",
        cancel_url="https://example.com/cancel",
        notify_url="https://example.com/notify",
        redirect_url="https://example.com/ok",
    )

    assert ntp_id == "NTP-1"
    assert payment_url == "https://example.com/pay"

