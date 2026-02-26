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


def _parse_positive_int(value: Any) -> int | None:
    try:
        parsed = int(str(value))
    except Exception:
        return None
    return parsed if parsed > 0 else None


def _parse_decimal(value: Any) -> Decimal | None:
    try:
        return Decimal(str(value))
    except Exception:
        return None


def _convert_order_item(*, raw_item: dict[str, Any], currency: str, fx_per_ron: Decimal) -> tuple[dict[str, Any] | None, Decimal]:
    quantity = _parse_positive_int(raw_item.get("quantity"))
    if quantity is None:
        return None, Decimal("0.00")

    raw_unit_amount = raw_item.get("unit_amount")
    if not isinstance(raw_unit_amount, dict):
        return None, Decimal("0.00")

    unit_ron = _parse_decimal(raw_unit_amount.get("value"))
    if unit_ron is None:
        return None, Decimal("0.00")

    unit_converted = _convert_ron(unit_ron, fx_per_ron)
    unit_amount = dict(raw_unit_amount)
    unit_amount["currency_code"] = currency
    unit_amount["value"] = _format_amount(unit_converted)

    item = dict(raw_item)
    item["quantity"] = str(quantity)
    item["unit_amount"] = unit_amount
    return item, unit_converted * quantity


def _convert_items(*, items: list[dict[str, Any]] | None, currency: str, fx_per_ron: Decimal) -> tuple[list[dict[str, Any]] | None, Decimal | None]:
    if not items:
        return None, None

    converted_items: list[dict[str, Any]] = []
    item_total_converted = Decimal("0.00")
    for raw_item in items:
        if not isinstance(raw_item, dict):
            continue
        item, item_total = _convert_order_item(raw_item=raw_item, currency=currency, fx_per_ron=fx_per_ron)
        if item is None:
            continue
        converted_items.append(item)
        item_total_converted += item_total

    if not converted_items:
        return None, None
    return converted_items, item_total_converted


def _convert_optional_amount(value_ron: Decimal | None, fx_per_ron: Decimal) -> Decimal | None:
    return _convert_ron(Decimal(value_ron), fx_per_ron) if value_ron is not None else None


def _discount_requested(discount_ron: Decimal | None) -> bool:
    return discount_ron is not None and Decimal(discount_ron) > 0


def _convert_discount(discount_ron: Decimal | None, fx_per_ron: Decimal) -> Decimal | None:
    if discount_ron is None:
        return None
    discount_value = Decimal(discount_ron)
    if discount_value <= 0:
        return None
    return _convert_ron(discount_value, fx_per_ron)


def _resolve_item_total(
    *,
    item_total_converted: Decimal | None,
    item_total_ron: Decimal | None,
    fx_per_ron: Decimal,
) -> Decimal | None:
    if item_total_converted is not None or item_total_ron is None:
        return item_total_converted
    return _convert_ron(Decimal(item_total_ron), fx_per_ron)


def _compute_total_converted(
    *,
    item_total_converted: Decimal | None,
    shipping_converted: Decimal | None,
    fee_converted: Decimal | None,
    tax_converted: Decimal | None,
    discount_converted: Decimal | None,
) -> Decimal:
    total_converted = Decimal("0.00")
    for value in (item_total_converted, shipping_converted, fee_converted, tax_converted):
        if value is not None:
            total_converted += value
    if discount_converted is not None:
        total_converted -= discount_converted
    if total_converted <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid PayPal order total")
    return total_converted


def _amount_value(currency: str, value: Decimal) -> dict[str, str]:
    return {"currency_code": currency, "value": _format_amount(value)}


def _set_breakdown_amount(
    *,
    breakdown: dict[str, Any],
    key: str,
    currency: str,
    value: Decimal | None,
    allow_zero: bool = False,
) -> None:
    if value is None:
        return
    if not allow_zero and Decimal(value) <= 0:
        return
    breakdown[key] = _amount_value(currency, value)


def _build_breakdown(
    *,
    currency: str,
    item_total_converted: Decimal | None,
    shipping_converted: Decimal | None,
    fee_converted: Decimal | None,
    tax_converted: Decimal | None,
    discount_converted: Decimal | None,
) -> dict[str, Any]:
    breakdown: dict[str, Any] = {}
    _set_breakdown_amount(
        breakdown=breakdown,
        key="item_total",
        currency=currency,
        value=item_total_converted,
        allow_zero=True,
    )
    _set_breakdown_amount(breakdown=breakdown, key="shipping", currency=currency, value=shipping_converted)
    _set_breakdown_amount(breakdown=breakdown, key="handling", currency=currency, value=fee_converted)
    _set_breakdown_amount(breakdown=breakdown, key="tax_total", currency=currency, value=tax_converted)
    _set_breakdown_amount(breakdown=breakdown, key="discount", currency=currency, value=discount_converted)
    return breakdown


def _build_order_amount(
    *,
    currency: str,
    total_converted: Decimal,
    item_total_converted: Decimal | None,
    shipping_converted: Decimal | None,
    fee_converted: Decimal | None,
    tax_converted: Decimal | None,
    discount_converted: Decimal | None,
    item_total_ron: Decimal | None,
    shipping_ron: Decimal | None,
    tax_ron: Decimal | None,
    fee_ron: Decimal | None,
    discount_ron: Decimal | None,
) -> dict[str, Any]:
    amount: dict[str, Any] = _amount_value(currency, total_converted)
    should_include_breakdown = (
        item_total_ron is not None
        or shipping_ron is not None
        or tax_ron is not None
        or fee_ron is not None
        or _discount_requested(discount_ron)
    )
    if should_include_breakdown:
        breakdown = _build_breakdown(
            currency=currency,
            item_total_converted=item_total_converted,
            shipping_converted=shipping_converted,
            fee_converted=fee_converted,
            tax_converted=tax_converted,
            discount_converted=discount_converted,
        )
        if breakdown:
            amount["breakdown"] = breakdown
    return amount


def _prepare_order_amount(
    *,
    currency: str,
    fx_per_ron: Decimal,
    item_total_ron: Decimal | None,
    shipping_ron: Decimal | None,
    tax_ron: Decimal | None,
    fee_ron: Decimal | None,
    discount_ron: Decimal | None,
    items: list[dict[str, Any]] | None,
) -> tuple[dict[str, Any], list[dict[str, Any]] | None]:
    converted_items, item_total_converted = _convert_items(items=items, currency=currency, fx_per_ron=fx_per_ron)
    shipping_converted = _convert_optional_amount(shipping_ron, fx_per_ron)
    fee_converted = _convert_optional_amount(fee_ron, fx_per_ron)
    tax_converted = _convert_optional_amount(tax_ron, fx_per_ron)
    discount_converted = _convert_discount(discount_ron, fx_per_ron)
    item_total_converted = _resolve_item_total(
        item_total_converted=item_total_converted,
        item_total_ron=item_total_ron,
        fx_per_ron=fx_per_ron,
    )
    total_converted = _compute_total_converted(
        item_total_converted=item_total_converted,
        shipping_converted=shipping_converted,
        fee_converted=fee_converted,
        tax_converted=tax_converted,
        discount_converted=discount_converted,
    )
    amount = _build_order_amount(
        currency=currency,
        total_converted=total_converted,
        item_total_converted=item_total_converted,
        shipping_converted=shipping_converted,
        fee_converted=fee_converted,
        tax_converted=tax_converted,
        discount_converted=discount_converted,
        item_total_ron=item_total_ron,
        shipping_ron=shipping_ron,
        tax_ron=tax_ron,
        fee_ron=fee_ron,
        discount_ron=discount_ron,
    )
    return amount, converted_items


def _build_order_payload(
    *,
    amount: dict[str, Any],
    reference: str,
    return_url: str,
    cancel_url: str,
    converted_items: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    purchase_unit: dict[str, Any] = {
        "amount": amount,
        "custom_id": reference,
        "description": f"momentstudio order {reference}",
    }
    if converted_items:
        purchase_unit["items"] = converted_items

    return {
        "intent": "CAPTURE",
        "purchase_units": [purchase_unit],
        "application_context": {
            "brand_name": "momentstudio",
            "landing_page": "NO_PREFERENCE",
            "user_action": "PAY_NOW",
            "return_url": return_url,
            "cancel_url": cancel_url,
        },
    }


async def _create_order_response(*, token: str, payload: dict[str, Any]) -> dict[str, Any]:
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
    return data


def _extract_approval_url(links: Any) -> str | None:
    if not isinstance(links, list):
        return None
    for link in links:
        if not isinstance(link, dict):
            continue
        href = link.get("href")
        if link.get("rel") == "approve" and isinstance(href, str):
            return href
    return None


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
    """Create a PayPal order and return (paypal_order_id, approval_url)."""
    token = await _get_access_token()
    currency = _paypal_currency(currency_code)
    fx_per_ron = await _fx_per_ron(currency, fx_eur_per_ron=fx_eur_per_ron, fx_usd_per_ron=fx_usd_per_ron)
    amount, converted_items = _prepare_order_amount(
        currency=currency,
        fx_per_ron=fx_per_ron,
        item_total_ron=item_total_ron,
        shipping_ron=shipping_ron,
        tax_ron=tax_ron,
        fee_ron=fee_ron,
        discount_ron=discount_ron,
        items=items,
    )
    payload = _build_order_payload(
        amount=amount,
        reference=reference,
        return_url=return_url,
        cancel_url=cancel_url,
        converted_items=converted_items,
    )
    data = await _create_order_response(token=token, payload=payload)

    paypal_order_id = data.get("id")
    approval_url = _extract_approval_url(data.get("links"))

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
