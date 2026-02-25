from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
import re
from typing import Any
from urllib.parse import quote
from uuid import uuid4

import httpx
from fastapi import HTTPException, status

from app.core.config import settings
from app.services import fx_rates
from app.services.payment_provider import is_mock_payments

_token_cache: dict[str, dict[str, object]] = {}
_SUPPORTED_CURRENCIES = {"EUR", "USD", "RON"}
_PAYPAL_ID_RE = re.compile(r"^[A-Z0-9-]{8,64}$")


def _paypal_env() -> str:
    env = (settings.paypal_env or "sandbox").strip().lower()
    return "live" if env == "live" else "sandbox"


def _paypal_currency(currency_code: str | None = None) -> str:
    raw = (currency_code or settings.paypal_currency or "EUR").strip().upper()
    if raw in _SUPPORTED_CURRENCIES:
        return raw
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail=f"Unsupported PayPal currency {raw!r}; configure PAYPAL_CURRENCY as RON, EUR or USD",
    )


async def _fx_per_ron(currency_code: str, *, fx_eur_per_ron: float | None, fx_usd_per_ron: float | None) -> Decimal:
    if currency_code == "RON":
        return Decimal("1.0")
    if currency_code == "EUR" and fx_eur_per_ron:
        return Decimal(str(fx_eur_per_ron))
    if currency_code == "USD" and fx_usd_per_ron:
        return Decimal(str(fx_usd_per_ron))
    fetched = await fx_rates.get_fx_rates()
    return Decimal(str(fetched.usd_per_ron if currency_code == "USD" else fetched.eur_per_ron))


def _convert_ron(value_ron: Decimal, fx_per_ron: Decimal) -> Decimal:
    return (Decimal(value_ron) * fx_per_ron).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _effective_client_id() -> str:
    if _paypal_env() == "live":
        return (settings.paypal_client_id_live or settings.paypal_client_id or "").strip()
    return (settings.paypal_client_id_sandbox or settings.paypal_client_id or "").strip()


def _effective_client_secret() -> str:
    if _paypal_env() == "live":
        return (settings.paypal_client_secret_live or settings.paypal_client_secret or "").strip()
    return (settings.paypal_client_secret_sandbox or settings.paypal_client_secret or "").strip()


def _effective_webhook_id() -> str:
    if _paypal_env() == "live":
        return (settings.paypal_webhook_id_live or settings.paypal_webhook_id or "").strip()
    return (settings.paypal_webhook_id_sandbox or settings.paypal_webhook_id or "").strip()


def paypal_webhook_id() -> str:
    return _effective_webhook_id()


def is_paypal_webhook_configured() -> bool:
    return bool(paypal_webhook_id())


def _cache_bucket() -> dict[str, object]:
    return _token_cache.setdefault(_paypal_env(), {"access_token": None, "expires_at": None})


def _cached_access_token(now: datetime) -> str | None:
    bucket = _cache_bucket()
    cached_token = bucket.get("access_token")
    cached_expires_at = bucket.get("expires_at")
    if isinstance(cached_token, str) and isinstance(cached_expires_at, datetime):
        # Refresh a bit early to avoid edge-of-expiry failures.
        if cached_expires_at - now > timedelta(seconds=30):
            return cached_token
    return None


def _cache_access_token(*, access_token: str, expires_in: Any, now: datetime) -> None:
    expiry_seconds = int(expires_in) if isinstance(expires_in, (int, float)) else 300
    bucket = _cache_bucket()
    bucket["access_token"] = access_token
    bucket["expires_at"] = now + timedelta(seconds=expiry_seconds)


def is_paypal_configured() -> bool:
    return bool(_effective_client_id() and _effective_client_secret())


def _base_url() -> str:
    return "https://api-m.paypal.com" if _paypal_env() == "live" else "https://api-m.sandbox.paypal.com"


async def _fetch_access_token(*, client_id: str, client_secret: str) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(base_url=_base_url(), timeout=10) as client:
            resp = await client.post(
                "/v1/oauth2/token",
                data={"grant_type": "client_credentials"},
                auth=(client_id, client_secret),
                headers={"Accept": "application/json", "Accept-Language": "en_US"},
            )
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="PayPal token request failed") from exc


async def _get_access_token() -> str:
    if not is_paypal_configured():
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="PayPal not configured")

    now = datetime.now(timezone.utc)
    cached_token = _cached_access_token(now)
    if cached_token:
        return cached_token

    data = await _fetch_access_token(client_id=_effective_client_id(), client_secret=_effective_client_secret())

    access_token = data.get("access_token")
    expires_in = data.get("expires_in")
    if not isinstance(access_token, str) or not access_token:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="PayPal token missing")

    _cache_access_token(access_token=access_token, expires_in=expires_in, now=now)
    return access_token


async def create_order(
    *,
    total_ron: Decimal,
    reference: str,
    return_url: str,
    cancel_url: str,
    item_total_ron: Decimal | None = None,
    shipping_ron: Decimal | None = None,
    tax_ron: Decimal | None = None,
    fee_ron: Decimal | None = None,
    discount_ron: Decimal | None = None,
    items: list[dict[str, Any]] | None = None,
    currency_code: str | None = None,
    fx_eur_per_ron: float | None = None,
    fx_usd_per_ron: float | None = None,
) -> tuple[str, str]:
    """Create a PayPal order and return (paypal_order_id, approval_url)."""
    if is_mock_payments():
        order_id = f"paypal_mock_{uuid4().hex}"
        base = settings.frontend_origin.rstrip("/")
        approval_url = f"{base}/checkout/mock/paypal?token={order_id}"
        return order_id, approval_url

    return await create_order_itemized(
        total_ron=total_ron,
        reference=reference,
        return_url=return_url,
        cancel_url=cancel_url,
        item_total_ron=item_total_ron,
        shipping_ron=shipping_ron,
        tax_ron=tax_ron,
        fee_ron=fee_ron,
        discount_ron=discount_ron,
        items=items,
        currency_code=currency_code,
        fx_eur_per_ron=fx_eur_per_ron,
        fx_usd_per_ron=fx_usd_per_ron,
    )


def _format_amount(value: Decimal) -> str:
    return str(Decimal(value).quantize(Decimal("0.01")))


async def create_order_itemized(
    *,
    total_ron: Decimal,
    reference: str,
    return_url: str,
    cancel_url: str,
    item_total_ron: Decimal | None = None,
    shipping_ron: Decimal | None = None,
    tax_ron: Decimal | None = None,
    fee_ron: Decimal | None = None,
    discount_ron: Decimal | None = None,
    items: list[dict[str, Any]] | None = None,
    currency_code: str | None = None,
    fx_eur_per_ron: float | None = None,
    fx_usd_per_ron: float | None = None,
) -> tuple[str, str]:
    """Create a PayPal order and return (paypal_order_id, approval_url).

    When item totals are provided, the order includes an itemized breakdown so the buyer can see
    products, shipping, taxes, fees and discounts on PayPal checkout.
    """
    token = await _get_access_token()
    currency = _paypal_currency(currency_code)
    fx_per_ron = await _fx_per_ron(currency, fx_eur_per_ron=fx_eur_per_ron, fx_usd_per_ron=fx_usd_per_ron)

    # PayPal expects a string amount with 2 decimal places.
    converted_items: list[dict[str, Any]] | None = None
    item_total_converted: Decimal | None = None
    if items:
        converted_items = []
        item_total_converted = Decimal("0.00")
        for raw_item in items:
            if not isinstance(raw_item, dict):
                continue
            qty_raw = raw_item.get("quantity")
            try:
                qty_int = int(str(qty_raw))
            except Exception:
                continue
            if qty_int <= 0:
                continue
            raw_unit_amount = raw_item.get("unit_amount")
            if not isinstance(raw_unit_amount, dict):
                continue
            raw_value = raw_unit_amount.get("value")
            try:
                unit_ron = Decimal(str(raw_value))
            except Exception:
                continue
            unit_converted = _convert_ron(unit_ron, fx_per_ron)
            item_total_converted += unit_converted * qty_int
            unit_amount = dict(raw_unit_amount)
            unit_amount["currency_code"] = currency
            unit_amount["value"] = _format_amount(unit_converted)
            item = dict(raw_item)
            item["quantity"] = str(qty_int)
            item["unit_amount"] = unit_amount
            converted_items.append(item)
        if not converted_items:
            converted_items = None
            item_total_converted = None

    shipping_converted = _convert_ron(Decimal(shipping_ron), fx_per_ron) if shipping_ron is not None else None
    fee_converted = _convert_ron(Decimal(fee_ron), fx_per_ron) if fee_ron is not None else None
    tax_converted = _convert_ron(Decimal(tax_ron), fx_per_ron) if tax_ron is not None else None
    discount_converted = (
        _convert_ron(Decimal(discount_ron), fx_per_ron)
        if discount_ron is not None and Decimal(discount_ron) > 0
        else None
    )
    item_total_ron_dec = Decimal(item_total_ron) if item_total_ron is not None else None
    if item_total_converted is None and item_total_ron_dec is not None:
        item_total_converted = _convert_ron(item_total_ron_dec, fx_per_ron)

    # Compute a PayPal-compatible total in the settlement currency.
    total_converted = Decimal("0.00")
    if item_total_converted is not None:
        total_converted += item_total_converted
    if shipping_converted is not None:
        total_converted += shipping_converted
    if fee_converted is not None:
        total_converted += fee_converted
    if tax_converted is not None:
        total_converted += tax_converted
    if discount_converted is not None:
        total_converted -= discount_converted
    if total_converted <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid PayPal order total")

    amount: dict[str, Any] = {"currency_code": currency, "value": _format_amount(total_converted)}
    if (
        item_total_ron is not None
        or shipping_ron is not None
        or tax_ron is not None
        or fee_ron is not None
        or (discount_ron is not None and Decimal(discount_ron) > 0)
    ):
        breakdown: dict[str, Any] = {}
        if item_total_converted is not None:
            breakdown["item_total"] = {"currency_code": currency, "value": _format_amount(item_total_converted)}
        if shipping_converted is not None and Decimal(shipping_converted) > 0:
            breakdown["shipping"] = {"currency_code": currency, "value": _format_amount(shipping_converted)}
        if fee_converted is not None and Decimal(fee_converted) > 0:
            breakdown["handling"] = {"currency_code": currency, "value": _format_amount(fee_converted)}
        if tax_converted is not None and Decimal(tax_converted) > 0:
            breakdown["tax_total"] = {"currency_code": currency, "value": _format_amount(tax_converted)}
        if discount_converted is not None and Decimal(discount_converted) > 0:
            breakdown["discount"] = {"currency_code": currency, "value": _format_amount(discount_converted)}
        if breakdown:
            amount["breakdown"] = breakdown

    payload: dict[str, Any] = {
        "intent": "CAPTURE",
        "purchase_units": [
            {
                "amount": amount,
                "custom_id": reference,
                "description": f"momentstudio order {reference}",
            }
        ],
        "application_context": {
            "brand_name": "momentstudio",
            "landing_page": "NO_PREFERENCE",
            "user_action": "PAY_NOW",
            "return_url": return_url,
            "cancel_url": cancel_url,
        },
    }
    if converted_items:
        payload["purchase_units"][0]["items"] = converted_items

    try:
        async with httpx.AsyncClient(base_url=_base_url(), timeout=15) as client:
            resp = await client.post(
                "/v2/checkout/orders",
                json=payload,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="PayPal order creation failed") from exc

    paypal_order_id = data.get("id")
    links = data.get("links")
    approval_url = None
    if isinstance(links, list):
        for link in links:
            if not isinstance(link, dict):
                continue
            if link.get("rel") == "approve" and isinstance(link.get("href"), str):
                approval_url = link["href"]
                break

    if not isinstance(paypal_order_id, str) or not paypal_order_id or not approval_url:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="PayPal approval link missing")

    return paypal_order_id, approval_url


def _sanitize_paypal_id(paypal_id: str) -> str:
    """
    Validate a PayPal identifier to ensure it is safe to use in a URL path segment.

    PayPal order and capture IDs are opaque, but in practice they are short strings consisting
    of letters, digits, and hyphens. Reject anything that contains other characters to prevent
    path manipulation.
    """
    if not isinstance(paypal_id, str):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid PayPal order id")
    value = paypal_id.strip().upper()
    if not value:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid PayPal order id")
    # PayPal IDs are uppercase letters/digits with optional hyphen separators.
    if not _PAYPAL_ID_RE.fullmatch(value):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid PayPal order id")
    return value


def _capture_path(paypal_order_id: str) -> str:
    order_id = quote(_sanitize_paypal_id(paypal_order_id), safe="")
    return f"/v2/checkout/orders/{order_id}/capture"


def _first_dict_item(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, list):
        return None
    if not value:
        return None
    item = value[0]
    if not isinstance(item, dict):
        return None
    return item


def _extract_capture_id(data: dict[str, Any]) -> str:
    purchase_unit = _first_dict_item(data.get("purchase_units"))
    if purchase_unit is None:
        return ""
    payments = purchase_unit.get("payments")
    if not isinstance(payments, dict):
        return ""
    capture = _first_dict_item(payments.get("captures"))
    if capture is None:
        return ""
    capture_id = capture.get("id")
    return capture_id if isinstance(capture_id, str) else ""


def _refund_path(paypal_capture_id: str) -> str:
    capture_id = quote(_sanitize_paypal_id(paypal_capture_id), safe="")
    return f"/v2/payments/captures/{capture_id}/refund"


async def capture_order(*, paypal_order_id: str) -> str:
    """Capture an approved PayPal order and return the PayPal capture id (if available)."""
    token = await _get_access_token()
    capture_path = _capture_path(paypal_order_id)
    try:
        async with httpx.AsyncClient(base_url=_base_url(), timeout=20) as client:
            resp = await client.post(
                capture_path,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="PayPal capture failed") from exc

    return _extract_capture_id(data)


async def refund_capture(
    *,
    paypal_capture_id: str,
    amount_ron: Decimal | None = None,
    currency_code: str | None = None,
    fx_eur_per_ron: float | None = None,
    fx_usd_per_ron: float | None = None,
) -> str:
    """Refund a captured PayPal payment and return the PayPal refund id (if available).

    If `amount_ron` is provided, the refund is partial; the function converts from RON into the
    configured PayPal settlement currency (EUR/USD) using the latest available FX rates.
    """
    token = await _get_access_token()
    refund_path = _refund_path(paypal_capture_id)
    payload: dict = {}
    if amount_ron is not None:
        currency = _paypal_currency(currency_code)
        fx_per_ron = await _fx_per_ron(currency, fx_eur_per_ron=fx_eur_per_ron, fx_usd_per_ron=fx_usd_per_ron)
        amount_converted = _convert_ron(Decimal(amount_ron), fx_per_ron)
        payload = {"amount": {"value": _format_amount(amount_converted), "currency_code": currency}}
    try:
        async with httpx.AsyncClient(base_url=_base_url(), timeout=20) as client:
            resp = await client.post(
                refund_path,
                json=payload,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="PayPal refund failed") from exc

    refund_id = data.get("id")
    return refund_id if isinstance(refund_id, str) else ""


def _get_header(headers: dict[str, str], name: str) -> str | None:
    for key in (name, name.lower()):
        value = headers.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return None


def _required_header(headers: dict[str, str], name: str) -> str:
    value = _get_header(headers, name)
    if value is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing PayPal signature headers")
    return value


def _webhook_verification_payload(*, headers: dict[str, str], event: dict[str, Any], webhook_id: str) -> dict[str, Any]:
    return {
        "auth_algo": _required_header(headers, "paypal-auth-algo"),
        "cert_url": _required_header(headers, "paypal-cert-url"),
        "transmission_id": _required_header(headers, "paypal-transmission-id"),
        "transmission_sig": _required_header(headers, "paypal-transmission-sig"),
        "transmission_time": _required_header(headers, "paypal-transmission-time"),
        "webhook_id": webhook_id,
        "webhook_event": event,
    }


async def verify_webhook_signature(*, headers: dict[str, str], event: dict[str, Any]) -> bool:
    webhook_id = _effective_webhook_id()
    if not webhook_id:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="PayPal webhook id not configured")

    payload = _webhook_verification_payload(headers=headers, event=event, webhook_id=webhook_id)
    token = await _get_access_token()
    try:
        async with httpx.AsyncClient(base_url=_base_url(), timeout=15) as client:
            resp = await client.post(
                "/v1/notifications/verify-webhook-signature",
                json=payload,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="PayPal signature verification failed") from exc

    return str(data.get("verification_status") or "").strip().upper() == "SUCCESS"
