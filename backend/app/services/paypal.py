from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

import httpx
from fastapi import HTTPException, status

from app.core.config import settings

_token_cache: dict[str, object] = {"access_token": None, "expires_at": None}


def is_paypal_configured() -> bool:
    return bool((settings.paypal_client_id or "").strip() and (settings.paypal_client_secret or "").strip())


def _base_url() -> str:
    env = (settings.paypal_env or "sandbox").strip().lower()
    return "https://api-m.paypal.com" if env == "live" else "https://api-m.sandbox.paypal.com"


async def _get_access_token() -> str:
    if not is_paypal_configured():
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="PayPal not configured")

    now = datetime.now(timezone.utc)
    cached_token = _token_cache.get("access_token")
    cached_expires_at = _token_cache.get("expires_at")
    if isinstance(cached_token, str) and isinstance(cached_expires_at, datetime):
        # Refresh a bit early to avoid edge-of-expiry failures.
        if cached_expires_at - now > timedelta(seconds=30):
            return cached_token

    client_id = (settings.paypal_client_id or "").strip()
    client_secret = (settings.paypal_client_secret or "").strip()
    token_url = f"{_base_url()}/v1/oauth2/token"

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                token_url,
                data={"grant_type": "client_credentials"},
                auth=(client_id, client_secret),
                headers={"Accept": "application/json", "Accept-Language": "en_US"},
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="PayPal token request failed") from exc

    access_token = data.get("access_token")
    expires_in = data.get("expires_in")
    if not isinstance(access_token, str) or not access_token:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="PayPal token missing")

    expiry = now + timedelta(seconds=int(expires_in) if isinstance(expires_in, (int, float)) else 300)
    _token_cache["access_token"] = access_token
    _token_cache["expires_at"] = expiry
    return access_token


async def create_order(*, total_ron: Decimal, reference: str, return_url: str, cancel_url: str) -> tuple[str, str]:
    """Create a PayPal order and return (paypal_order_id, approval_url)."""
    token = await _get_access_token()
    orders_url = f"{_base_url()}/v2/checkout/orders"

    # PayPal expects a string amount with 2 decimal places.
    value = str(Decimal(total_ron).quantize(Decimal("0.01")))
    payload: dict[str, Any] = {
        "intent": "CAPTURE",
        "purchase_units": [
            {
                "amount": {"currency_code": "RON", "value": value},
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

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                orders_url,
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


async def capture_order(*, paypal_order_id: str) -> str:
    """Capture an approved PayPal order and return the PayPal capture id (if available)."""
    token = await _get_access_token()
    capture_url = f"{_base_url()}/v2/checkout/orders/{paypal_order_id}/capture"
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                capture_url,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="PayPal capture failed") from exc

    # Best-effort extraction of the capture id.
    purchase_units = data.get("purchase_units")
    if isinstance(purchase_units, list) and purchase_units:
        payments = purchase_units[0].get("payments") if isinstance(purchase_units[0], dict) else None
        captures = payments.get("captures") if isinstance(payments, dict) else None
        if isinstance(captures, list) and captures:
            cap = captures[0]
            if isinstance(cap, dict) and isinstance(cap.get("id"), str):
                return cap["id"]
    return ""

