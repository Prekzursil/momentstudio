"""Targeted unit tests for app.services.paypal (coverage worker 4).

These cover the PayPal service helpers and async flows by mocking httpx with
``httpx.MockTransport`` (same pattern used by ``test_google_oauth.py``) and by
monkeypatching settings / FX rates. No live network or real database is used.
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import httpx
import pytest

from app.core.config import settings
from app.services import paypal as svc
from app.services import fx_rates


@pytest.fixture(autouse=True)
def _reset_paypal_state(monkeypatch: pytest.MonkeyPatch):
    """Clear the module-level token cache and force deterministic config."""
    svc._token_cache.clear()
    # Default to a configured sandbox environment for most tests.
    monkeypatch.setattr(settings, "paypal_env", "sandbox", raising=False)
    monkeypatch.setattr(settings, "paypal_currency", "EUR", raising=False)
    monkeypatch.setattr(settings, "paypal_client_id", "cid", raising=False)
    monkeypatch.setattr(settings, "paypal_client_secret", "secret", raising=False)
    monkeypatch.setattr(settings, "paypal_client_id_sandbox", "", raising=False)
    monkeypatch.setattr(settings, "paypal_client_secret_sandbox", "", raising=False)
    monkeypatch.setattr(settings, "paypal_client_id_live", "", raising=False)
    monkeypatch.setattr(settings, "paypal_client_secret_live", "", raising=False)
    monkeypatch.setattr(settings, "paypal_webhook_id", "wh-base", raising=False)
    monkeypatch.setattr(settings, "paypal_webhook_id_sandbox", "", raising=False)
    monkeypatch.setattr(settings, "paypal_webhook_id_live", "", raising=False)
    monkeypatch.setattr(settings, "payments_provider", "real", raising=False)
    monkeypatch.setattr(settings, "frontend_origin", "https://shop.test/", raising=False)
    yield
    svc._token_cache.clear()


def _mock_httpx(monkeypatch: pytest.MonkeyPatch, handler) -> None:
    transport = httpx.MockTransport(handler)
    real_async_client = httpx.AsyncClient

    class MockAsyncClient:
        def __init__(self, *args, **kwargs):
            self._client = real_async_client(
                transport=transport,
                base_url=kwargs.get("base_url", ""),
                timeout=kwargs.get("timeout"),
            )

        async def __aenter__(self):
            return self._client

        async def __aexit__(self, exc_type, exc, tb):
            await self._client.aclose()

    monkeypatch.setattr(svc.httpx, "AsyncClient", MockAsyncClient)


# --------------------------------------------------------------------------- #
# _paypal_env / _base_url
# --------------------------------------------------------------------------- #


def test_paypal_env_live(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "paypal_env", "LIVE", raising=False)
    assert svc._paypal_env() == "live"
    assert svc._base_url() == "https://api-m.paypal.com"


def test_paypal_env_defaults_sandbox(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "paypal_env", None, raising=False)
    assert svc._paypal_env() == "sandbox"
    assert svc._base_url() == "https://api-m.sandbox.paypal.com"


# --------------------------------------------------------------------------- #
# _paypal_currency
# --------------------------------------------------------------------------- #


def test_paypal_currency_explicit_and_default():
    assert svc._paypal_currency("usd") == "USD"
    assert svc._paypal_currency(None) == "EUR"


def test_paypal_currency_unsupported_raises():
    with pytest.raises(svc.HTTPException) as exc:
        svc._paypal_currency("GBP")
    assert exc.value.status_code == 500


# --------------------------------------------------------------------------- #
# _fx_per_ron
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_fx_per_ron_ron_is_one():
    assert await svc._fx_per_ron(
        "RON", fx_eur_per_ron=None, fx_usd_per_ron=None
    ) == Decimal("1.0")


@pytest.mark.anyio
async def test_fx_per_ron_eur_provided():
    assert await svc._fx_per_ron(
        "EUR", fx_eur_per_ron=0.2, fx_usd_per_ron=None
    ) == Decimal("0.2")


@pytest.mark.anyio
async def test_fx_per_ron_usd_provided():
    assert await svc._fx_per_ron(
        "USD", fx_eur_per_ron=None, fx_usd_per_ron=0.22
    ) == Decimal("0.22")


@pytest.mark.anyio
async def test_fx_per_ron_fetches_eur(monkeypatch: pytest.MonkeyPatch):
    async def fake_rates(*, force_refresh: bool = False):
        return fx_rates.FxRates(
            base="RON",
            eur_per_ron=0.2,
            usd_per_ron=0.22,
            as_of=datetime.now(timezone.utc).date(),
            source="test",
            fetched_at=datetime.now(timezone.utc),
        )

    monkeypatch.setattr(svc.fx_rates, "get_fx_rates", fake_rates)
    assert await svc._fx_per_ron(
        "EUR", fx_eur_per_ron=None, fx_usd_per_ron=None
    ) == Decimal("0.2")


@pytest.mark.anyio
async def test_fx_per_ron_fetches_usd(monkeypatch: pytest.MonkeyPatch):
    async def fake_rates(*, force_refresh: bool = False):
        return fx_rates.FxRates(
            base="RON",
            eur_per_ron=0.2,
            usd_per_ron=0.22,
            as_of=datetime.now(timezone.utc).date(),
            source="test",
            fetched_at=datetime.now(timezone.utc),
        )

    monkeypatch.setattr(svc.fx_rates, "get_fx_rates", fake_rates)
    assert await svc._fx_per_ron(
        "USD", fx_eur_per_ron=None, fx_usd_per_ron=None
    ) == Decimal("0.22")


# --------------------------------------------------------------------------- #
# _convert_ron / _format_amount
# --------------------------------------------------------------------------- #


def test_convert_ron_and_format_amount():
    assert svc._convert_ron(Decimal("10"), Decimal("0.205")) == Decimal("2.05")
    assert svc._format_amount(Decimal("2.5")) == "2.50"


# --------------------------------------------------------------------------- #
# effective client id/secret/webhook (live vs sandbox + fallback)
# --------------------------------------------------------------------------- #


def test_effective_ids_live_specific(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "paypal_env", "live", raising=False)
    monkeypatch.setattr(settings, "paypal_client_id_live", "live-id", raising=False)
    monkeypatch.setattr(
        settings, "paypal_client_secret_live", "live-secret", raising=False
    )
    monkeypatch.setattr(settings, "paypal_webhook_id_live", "live-wh", raising=False)
    assert svc._effective_client_id() == "live-id"
    assert svc._effective_client_secret() == "live-secret"
    assert svc._effective_webhook_id() == "live-wh"


def test_effective_ids_live_fallback_to_base(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "paypal_env", "live", raising=False)
    monkeypatch.setattr(settings, "paypal_client_id", "base-id", raising=False)
    monkeypatch.setattr(settings, "paypal_client_secret", "base-secret", raising=False)
    monkeypatch.setattr(settings, "paypal_webhook_id", "base-wh", raising=False)
    assert svc._effective_client_id() == "base-id"
    assert svc._effective_client_secret() == "base-secret"
    assert svc._effective_webhook_id() == "base-wh"


def test_effective_ids_sandbox_specific(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "paypal_client_id_sandbox", "sb-id", raising=False)
    monkeypatch.setattr(
        settings, "paypal_client_secret_sandbox", "sb-secret", raising=False
    )
    monkeypatch.setattr(settings, "paypal_webhook_id_sandbox", "sb-wh", raising=False)
    assert svc._effective_client_id() == "sb-id"
    assert svc._effective_client_secret() == "sb-secret"
    assert svc._effective_webhook_id() == "sb-wh"


def test_paypal_webhook_id_and_configured():
    assert svc.paypal_webhook_id() == "wh-base"
    assert svc.is_paypal_webhook_configured() is True


def test_is_paypal_webhook_not_configured(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "paypal_webhook_id", "", raising=False)
    assert svc.is_paypal_webhook_configured() is False


def test_is_paypal_configured_true_and_false(monkeypatch: pytest.MonkeyPatch):
    assert svc.is_paypal_configured() is True
    monkeypatch.setattr(settings, "paypal_client_id", "", raising=False)
    assert svc.is_paypal_configured() is False


# --------------------------------------------------------------------------- #
# _get_access_token
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_get_access_token_not_configured(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "paypal_client_id", "", raising=False)
    with pytest.raises(svc.HTTPException) as exc:
        await svc._get_access_token()
    assert exc.value.status_code == 500
    assert exc.value.detail == "PayPal not configured"


@pytest.mark.anyio
async def test_get_access_token_success_and_cache(monkeypatch: pytest.MonkeyPatch):
    calls = {"n": 0}

    async def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(
            200, json={"access_token": "tok-123", "expires_in": 3600}, request=request
        )

    _mock_httpx(monkeypatch, handler)
    tok = await svc._get_access_token()
    assert tok == "tok-123"
    # Second call hits the cache (still valid, not within 30s of expiry).
    tok2 = await svc._get_access_token()
    assert tok2 == "tok-123"
    assert calls["n"] == 1


@pytest.mark.anyio
async def test_get_access_token_expired_cache_refreshes(monkeypatch: pytest.MonkeyPatch):
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, json={"access_token": "fresh", "expires_in": 3600}, request=request
        )

    _mock_httpx(monkeypatch, handler)
    bucket = svc._cache_bucket()
    bucket["access_token"] = "stale"
    bucket["expires_at"] = datetime.now(timezone.utc) + timedelta(seconds=5)
    tok = await svc._get_access_token()
    assert tok == "fresh"


@pytest.mark.anyio
async def test_get_access_token_http_error(monkeypatch: pytest.MonkeyPatch):
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "boom"}, request=request)

    _mock_httpx(monkeypatch, handler)
    with pytest.raises(svc.HTTPException) as exc:
        await svc._get_access_token()
    assert exc.value.status_code == 502
    assert exc.value.detail == "PayPal token request failed"


@pytest.mark.anyio
async def test_get_access_token_missing_token(monkeypatch: pytest.MonkeyPatch):
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"expires_in": 3600}, request=request)

    _mock_httpx(monkeypatch, handler)
    with pytest.raises(svc.HTTPException) as exc:
        await svc._get_access_token()
    assert exc.value.status_code == 502
    assert exc.value.detail == "PayPal token missing"


@pytest.mark.anyio
async def test_get_access_token_non_numeric_expiry_defaults(
    monkeypatch: pytest.MonkeyPatch,
):
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"access_token": "tok", "expires_in": "not-a-number"},
            request=request,
        )

    _mock_httpx(monkeypatch, handler)
    tok = await svc._get_access_token()
    assert tok == "tok"
    bucket = svc._cache_bucket()
    # Default expiry of 300s applied.
    assert isinstance(bucket["expires_at"], datetime)


# --------------------------------------------------------------------------- #
# create_order (mock payments shortcut)
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_create_order_mock_payments(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "payments_provider", "mock", raising=False)
    monkeypatch.setattr(settings, "environment", "dev", raising=False)
    order_id, approval = await svc.create_order(
        total_ron=Decimal("100"),
        reference="ref-1",
        return_url="https://r",
        cancel_url="https://c",
    )
    assert order_id.startswith("paypal_mock_")
    assert approval == f"https://shop.test/checkout/mock/paypal?token={order_id}"


@pytest.mark.anyio
async def test_create_order_delegates_to_itemized(monkeypatch: pytest.MonkeyPatch):
    captured = {}

    async def fake_itemized(**kwargs):
        captured.update(kwargs)
        return ("oid", "https://approve")

    monkeypatch.setattr(svc, "create_order_itemized", fake_itemized)
    out = await svc.create_order(
        total_ron=Decimal("50"),
        reference="ref-2",
        return_url="https://r",
        cancel_url="https://c",
        shipping_ron=Decimal("5"),
    )
    assert out == ("oid", "https://approve")
    assert captured["reference"] == "ref-2"
    assert captured["shipping_ron"] == Decimal("5")


# --------------------------------------------------------------------------- #
# create_order_itemized
# --------------------------------------------------------------------------- #


def _token_only_handler(order_response):
    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/oauth2/token"):
            return httpx.Response(
                200,
                json={"access_token": "tok", "expires_in": 3600},
                request=request,
            )
        return order_response(request)

    return handler


@pytest.mark.anyio
async def test_create_order_itemized_full_breakdown(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "paypal_currency", "RON", raising=False)
    sent_payload = {}

    def order_resp(request: httpx.Request) -> httpx.Response:
        import json as _json

        sent_payload.update(_json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "id": "ORDER1",
                "links": [
                    {"rel": "self", "href": "https://self"},
                    {"rel": "approve", "href": "https://approve.me"},
                ],
            },
            request=request,
        )

    _mock_httpx(monkeypatch, _token_only_handler(order_resp))

    items = [
        {"name": "Widget", "quantity": "2", "unit_amount": {"value": "10"}},
        {"name": "bad", "quantity": "0", "unit_amount": {"value": "1"}},  # skipped qty
        {"name": "noqty"},  # missing unit_amount -> skipped after qty parse fails
    ]
    order_id, approval = await svc.create_order_itemized(
        total_ron=Decimal("100"),
        reference="ref-x",
        return_url="https://r",
        cancel_url="https://c",
        item_total_ron=Decimal("20"),
        shipping_ron=Decimal("5"),
        tax_ron=Decimal("3"),
        fee_ron=Decimal("2"),
        discount_ron=Decimal("4"),
        items=items,
        currency_code="RON",
    )
    assert order_id == "ORDER1"
    assert approval == "https://approve.me"
    breakdown = sent_payload["purchase_units"][0]["amount"]["breakdown"]
    assert breakdown["item_total"]["value"] == "20.00"
    assert breakdown["shipping"]["value"] == "5.00"
    assert breakdown["handling"]["value"] == "2.00"
    assert breakdown["tax_total"]["value"] == "3.00"
    assert breakdown["discount"]["value"] == "4.00"
    assert sent_payload["purchase_units"][0]["items"][0]["quantity"] == "2"


@pytest.mark.anyio
async def test_create_order_itemized_items_all_invalid(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "paypal_currency", "RON", raising=False)

    def order_resp(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"id": "O2", "links": [{"rel": "approve", "href": "https://a"}]},
            request=request,
        )

    _mock_httpx(monkeypatch, _token_only_handler(order_resp))
    # items present but every entry invalid (non-dict + bad qty) -> converted_items None
    order_id, approval = await svc.create_order_itemized(
        total_ron=Decimal("10"),
        reference="r",
        return_url="https://r",
        cancel_url="https://c",
        item_total_ron=Decimal("10"),
        items=["not-a-dict", {"quantity": "x", "unit_amount": {"value": "1"}}],
        currency_code="RON",
    )
    assert order_id == "O2"
    assert approval == "https://a"


@pytest.mark.anyio
async def test_create_order_itemized_bad_unit_value(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "paypal_currency", "RON", raising=False)

    def order_resp(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"id": "O3", "links": [{"rel": "approve", "href": "https://a"}]},
            request=request,
        )

    _mock_httpx(monkeypatch, _token_only_handler(order_resp))
    order_id, _ = await svc.create_order_itemized(
        total_ron=Decimal("10"),
        reference="r",
        return_url="https://r",
        cancel_url="https://c",
        item_total_ron=Decimal("10"),
        items=[
            {"quantity": "1", "unit_amount": "not-a-dict"},  # unit_amount not dict
            {"quantity": "1", "unit_amount": {"value": "oops"}},  # bad Decimal
        ],
        currency_code="RON",
    )
    assert order_id == "O3"


@pytest.mark.anyio
async def test_create_order_itemized_invalid_total(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "paypal_currency", "RON", raising=False)

    def order_resp(request: httpx.Request) -> httpx.Response:  # pragma: no cover -- order call never reached
        return httpx.Response(200, json={"id": "x"}, request=request)

    _mock_httpx(monkeypatch, _token_only_handler(order_resp))
    # discount exceeds item total => total_converted <= 0
    with pytest.raises(svc.HTTPException) as exc:
        await svc.create_order_itemized(
            total_ron=Decimal("0"),
            reference="r",
            return_url="https://r",
            cancel_url="https://c",
            item_total_ron=Decimal("5"),
            discount_ron=Decimal("10"),
            currency_code="RON",
        )
    assert exc.value.status_code == 400
    assert exc.value.detail == "Invalid PayPal order total"


@pytest.mark.anyio
async def test_create_order_itemized_no_breakdown(monkeypatch: pytest.MonkeyPatch):
    """Only item_total via converted items, no shipping/tax/etc -> no breakdown dict."""
    monkeypatch.setattr(settings, "paypal_currency", "RON", raising=False)
    sent = {}

    def order_resp(request: httpx.Request) -> httpx.Response:
        import json as _json

        sent.update(_json.loads(request.content))
        return httpx.Response(
            200,
            json={"id": "O4", "links": [{"rel": "approve", "href": "https://a"}]},
            request=request,
        )

    _mock_httpx(monkeypatch, _token_only_handler(order_resp))
    order_id, _ = await svc.create_order_itemized(
        total_ron=Decimal("10"),
        reference="r",
        return_url="https://r",
        cancel_url="https://c",
        items=[{"quantity": "1", "unit_amount": {"value": "10"}}],
        currency_code="RON",
    )
    assert order_id == "O4"
    # No breakdown-triggering fields were passed.
    assert "breakdown" not in sent["purchase_units"][0]["amount"]


@pytest.mark.anyio
async def test_create_order_itemized_shipping_only(monkeypatch: pytest.MonkeyPatch):
    """No items / no item_total: total comes purely from shipping; breakdown has
    only shipping (exercises the item_total-is-None branches)."""
    monkeypatch.setattr(settings, "paypal_currency", "RON", raising=False)
    sent = {}

    def order_resp(request: httpx.Request) -> httpx.Response:
        import json as _json

        sent.update(_json.loads(request.content))
        return httpx.Response(
            200,
            json={"id": "O7", "links": [{"rel": "approve", "href": "https://a"}]},
            request=request,
        )

    _mock_httpx(monkeypatch, _token_only_handler(order_resp))
    order_id, _ = await svc.create_order_itemized(
        total_ron=Decimal("5"),
        reference="r",
        return_url="https://r",
        cancel_url="https://c",
        shipping_ron=Decimal("5"),
        currency_code="RON",
    )
    assert order_id == "O7"
    breakdown = sent["purchase_units"][0]["amount"]["breakdown"]
    assert "item_total" not in breakdown
    assert breakdown["shipping"]["value"] == "5.00"


@pytest.mark.anyio
async def test_create_order_itemized_http_error(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "paypal_currency", "RON", raising=False)

    def order_resp(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"e": 1}, request=request)

    _mock_httpx(monkeypatch, _token_only_handler(order_resp))
    with pytest.raises(svc.HTTPException) as exc:
        await svc.create_order_itemized(
            total_ron=Decimal("10"),
            reference="r",
            return_url="https://r",
            cancel_url="https://c",
            item_total_ron=Decimal("10"),
            currency_code="RON",
        )
    assert exc.value.status_code == 502
    assert exc.value.detail == "PayPal order creation failed"


@pytest.mark.anyio
async def test_create_order_itemized_missing_approval(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "paypal_currency", "RON", raising=False)

    def order_resp(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "id": "O5",
                "links": [
                    "not-a-dict",
                    {"rel": "self", "href": "https://self"},
                    {"rel": "approve", "href": 123},  # non-str href ignored
                ],
            },
            request=request,
        )

    _mock_httpx(monkeypatch, _token_only_handler(order_resp))
    with pytest.raises(svc.HTTPException) as exc:
        await svc.create_order_itemized(
            total_ron=Decimal("10"),
            reference="r",
            return_url="https://r",
            cancel_url="https://c",
            item_total_ron=Decimal("10"),
            currency_code="RON",
        )
    assert exc.value.status_code == 502
    assert exc.value.detail == "PayPal approval link missing"


@pytest.mark.anyio
async def test_create_order_itemized_links_not_list(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "paypal_currency", "RON", raising=False)

    def order_resp(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, json={"id": "O6", "links": "nope"}, request=request
        )

    _mock_httpx(monkeypatch, _token_only_handler(order_resp))
    with pytest.raises(svc.HTTPException):
        await svc.create_order_itemized(
            total_ron=Decimal("10"),
            reference="r",
            return_url="https://r",
            cancel_url="https://c",
            item_total_ron=Decimal("10"),
            currency_code="RON",
        )


# --------------------------------------------------------------------------- #
# _sanitize_paypal_id / _capture_path / _refund_path
# --------------------------------------------------------------------------- #


def test_sanitize_paypal_id_valid():
    assert svc._sanitize_paypal_id("abc-123def4") == "ABC-123DEF4"


def test_sanitize_paypal_id_not_str():
    with pytest.raises(svc.HTTPException) as exc:
        svc._sanitize_paypal_id(123)  # type: ignore[arg-type]
    assert exc.value.status_code == 400


def test_sanitize_paypal_id_empty():
    with pytest.raises(svc.HTTPException):
        svc._sanitize_paypal_id("   ")


def test_sanitize_paypal_id_bad_pattern():
    with pytest.raises(svc.HTTPException):
        svc._sanitize_paypal_id("short")  # too short
    with pytest.raises(svc.HTTPException):
        svc._sanitize_paypal_id("has space here!!")


def test_capture_and_refund_path():
    assert svc._capture_path("abc-12345").endswith("/ABC-12345/capture")
    assert svc._refund_path("cap-67890").endswith("/CAP-67890/refund")


# --------------------------------------------------------------------------- #
# capture_order
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_capture_order_success(monkeypatch: pytest.MonkeyPatch):
    def cap_resp(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "purchase_units": [
                    {"payments": {"captures": [{"id": "CAP123"}]}}
                ]
            },
            request=request,
        )

    _mock_httpx(monkeypatch, _token_only_handler(cap_resp))
    cap = await svc.capture_order(paypal_order_id="order-1234")
    assert cap == "CAP123"


@pytest.mark.anyio
async def test_capture_order_no_capture_id(monkeypatch: pytest.MonkeyPatch):
    def cap_resp(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"purchase_units": [{"payments": {"captures": []}}]},
            request=request,
        )

    _mock_httpx(monkeypatch, _token_only_handler(cap_resp))
    cap = await svc.capture_order(paypal_order_id="order-1234")
    assert cap == ""


@pytest.mark.anyio
async def test_capture_order_units_not_list(monkeypatch: pytest.MonkeyPatch):
    def cap_resp(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"purchase_units": "x"}, request=request)

    _mock_httpx(monkeypatch, _token_only_handler(cap_resp))
    assert await svc.capture_order(paypal_order_id="order-1234") == ""


@pytest.mark.anyio
async def test_capture_order_unit_not_dict(monkeypatch: pytest.MonkeyPatch):
    def cap_resp(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, json={"purchase_units": ["not-dict"]}, request=request
        )

    _mock_httpx(monkeypatch, _token_only_handler(cap_resp))
    assert await svc.capture_order(paypal_order_id="order-1234") == ""


@pytest.mark.anyio
async def test_capture_order_cap_not_dict(monkeypatch: pytest.MonkeyPatch):
    def cap_resp(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"purchase_units": [{"payments": {"captures": ["x"]}}]},
            request=request,
        )

    _mock_httpx(monkeypatch, _token_only_handler(cap_resp))
    assert await svc.capture_order(paypal_order_id="order-1234") == ""


@pytest.mark.anyio
async def test_capture_order_http_error(monkeypatch: pytest.MonkeyPatch):
    def cap_resp(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={}, request=request)

    _mock_httpx(monkeypatch, _token_only_handler(cap_resp))
    with pytest.raises(svc.HTTPException) as exc:
        await svc.capture_order(paypal_order_id="order-1234")
    assert exc.value.status_code == 502
    assert exc.value.detail == "PayPal capture failed"


# --------------------------------------------------------------------------- #
# refund_capture
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_refund_capture_full(monkeypatch: pytest.MonkeyPatch):
    def refund_resp(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"id": "RF1"}, request=request)

    _mock_httpx(monkeypatch, _token_only_handler(refund_resp))
    rid = await svc.refund_capture(paypal_capture_id="cap-12345")
    assert rid == "RF1"


@pytest.mark.anyio
async def test_refund_capture_partial(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "paypal_currency", "RON", raising=False)
    sent = {}

    def refund_resp(request: httpx.Request) -> httpx.Response:
        import json as _json

        sent.update(_json.loads(request.content))
        return httpx.Response(200, json={"id": "RF2"}, request=request)

    _mock_httpx(monkeypatch, _token_only_handler(refund_resp))
    rid = await svc.refund_capture(
        paypal_capture_id="cap-12345",
        amount_ron=Decimal("25"),
        currency_code="RON",
    )
    assert rid == "RF2"
    assert sent["amount"]["value"] == "25.00"
    assert sent["amount"]["currency_code"] == "RON"


@pytest.mark.anyio
async def test_refund_capture_non_str_id(monkeypatch: pytest.MonkeyPatch):
    def refund_resp(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"id": 999}, request=request)

    _mock_httpx(monkeypatch, _token_only_handler(refund_resp))
    assert await svc.refund_capture(paypal_capture_id="cap-12345") == ""


@pytest.mark.anyio
async def test_refund_capture_http_error(monkeypatch: pytest.MonkeyPatch):
    def refund_resp(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={}, request=request)

    _mock_httpx(monkeypatch, _token_only_handler(refund_resp))
    with pytest.raises(svc.HTTPException) as exc:
        await svc.refund_capture(paypal_capture_id="cap-12345")
    assert exc.value.status_code == 502
    assert exc.value.detail == "PayPal refund failed"


# --------------------------------------------------------------------------- #
# _get_header / verify_webhook_signature
# --------------------------------------------------------------------------- #


def test_get_header_variants():
    headers = {"X-Foo": "bar"}
    assert svc._get_header(headers, "X-Foo") == "bar"
    lower = {"x-foo": "baz"}
    assert svc._get_header(lower, "X-Foo") == "baz"
    assert svc._get_header({}, "X-Foo") is None
    assert svc._get_header({"X-Foo": "   "}, "X-Foo") is None


@pytest.mark.anyio
async def test_verify_webhook_no_id(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "paypal_webhook_id", "", raising=False)
    with pytest.raises(svc.HTTPException) as exc:
        await svc.verify_webhook_signature(headers={}, event={})
    assert exc.value.status_code == 500
    assert exc.value.detail == "PayPal webhook id not configured"


@pytest.mark.anyio
async def test_verify_webhook_missing_headers(monkeypatch: pytest.MonkeyPatch):
    with pytest.raises(svc.HTTPException) as exc:
        await svc.verify_webhook_signature(
            headers={"paypal-auth-algo": "alg"}, event={}
        )
    assert exc.value.status_code == 400
    assert exc.value.detail == "Missing PayPal signature headers"


def _sig_headers() -> dict[str, str]:
    return {
        "paypal-auth-algo": "SHA256withRSA",
        "paypal-cert-url": "https://cert",
        "paypal-transmission-id": "tid",
        "paypal-transmission-sig": "sig",
        "paypal-transmission-time": "2024-01-01T00:00:00Z",
    }


@pytest.mark.anyio
async def test_verify_webhook_success(monkeypatch: pytest.MonkeyPatch):
    def verify_resp(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, json={"verification_status": "success"}, request=request
        )

    _mock_httpx(monkeypatch, _token_only_handler(verify_resp))
    ok = await svc.verify_webhook_signature(headers=_sig_headers(), event={"k": "v"})
    assert ok is True


@pytest.mark.anyio
async def test_verify_webhook_failure_status(monkeypatch: pytest.MonkeyPatch):
    def verify_resp(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, json={"verification_status": "FAILURE"}, request=request
        )

    _mock_httpx(monkeypatch, _token_only_handler(verify_resp))
    ok = await svc.verify_webhook_signature(headers=_sig_headers(), event={})
    assert ok is False


@pytest.mark.anyio
async def test_verify_webhook_http_error(monkeypatch: pytest.MonkeyPatch):
    def verify_resp(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={}, request=request)

    _mock_httpx(monkeypatch, _token_only_handler(verify_resp))
    with pytest.raises(svc.HTTPException) as exc:
        await svc.verify_webhook_signature(headers=_sig_headers(), event={})
    assert exc.value.status_code == 502
    assert exc.value.detail == "PayPal signature verification failed"
