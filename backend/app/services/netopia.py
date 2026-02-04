from __future__ import annotations

import base64
import hashlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException, status
import httpx
from jose import jwt
from jose.exceptions import JWTError

from app.core.config import settings

NETOPIA_BASE_URL_LIVE = "https://secure.mobilpay.ro/pay"
NETOPIA_BASE_URL_SANDBOX = "https://secure-sandbox.netopia-payments.com"


def _payload_hash_b64(payload: bytes) -> str:
    return base64.b64encode(hashlib.sha512(payload).digest()).decode("ascii")


def _public_key_pem() -> str:
    pem = (settings.netopia_public_key_pem or "").strip()
    if pem:
        return pem
    path = (settings.netopia_public_key_path or "").strip()
    if path:
        try:
            return Path(path).read_text(encoding="utf-8").strip()
        except OSError as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Netopia public key could not be read",
            ) from exc
    return ""


def is_netopia_configured() -> bool:
    return bool(
        (settings.netopia_api_key or "").strip()
        and (settings.netopia_pos_signature or "").strip()
        and _public_key_pem()
    )


def _netopia_base_url() -> str:
    env = (settings.netopia_env or "sandbox").strip().lower()
    return NETOPIA_BASE_URL_LIVE if env == "live" else NETOPIA_BASE_URL_SANDBOX


def _netopia_headers() -> dict[str, str]:
    api_key = (settings.netopia_api_key or "").strip()
    if not api_key:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Netopia not configured")
    return {
        "Content-Type": "application/json",
        "Authorization": api_key,
    }


async def start_payment(
    *,
    order_id: str,
    amount_ron: float,
    description: str,
    billing: dict[str, Any],
    shipping: dict[str, Any],
    products: list[dict[str, Any]],
    language: str,
    cancel_url: str,
    notify_url: str,
    redirect_url: str,
) -> tuple[str | None, str]:
    """Start a NETOPIA payment and return (ntpID, paymentURL)."""
    if not settings.netopia_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    pos_signature = (settings.netopia_pos_signature or "").strip()
    if not pos_signature:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Netopia not configured")

    url = f"{_netopia_base_url().rstrip('/')}/payment/card/start"
    payload = {
        "config": {
            "emailTemplate": "default",
            "emailSubject": "Order Confirmation",
            "cancelUrl": cancel_url,
            "notifyUrl": notify_url,
            "redirectUrl": redirect_url,
            "language": (language or "ro").strip().lower() or "ro",
        },
        "payment": {
            "options": {"installments": 1, "bonus": 0, "split": []},
            "instrument": None,
            "data": {},
        },
        "order": {
            "ntpID": None,
            "posSignature": pos_signature,
            "dateTime": datetime.now(timezone.utc).isoformat(),
            "orderID": str(order_id),
            "description": (description or "").strip() or str(order_id),
            "amount": float(amount_ron),
            "currency": "RON",
            "billing": billing,
            "shipping": shipping,
            "products": products,
            "installments": {},
            "data": {},
        },
    }

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(url, headers=_netopia_headers(), json=payload)
    except httpx.RequestError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Netopia request failed") from exc

    if resp.status_code >= 400:
        detail = "Netopia start payment failed"
        try:
            data = resp.json()
            if isinstance(data, dict):
                detail = str(data.get("message") or data.get("error") or detail)
        except Exception:
            pass
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail)

    try:
        data = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Invalid Netopia response") from exc

    payment = data.get("payment") if isinstance(data, dict) else None
    payment_url = None
    ntp_id = None
    if isinstance(payment, dict):
        payment_url = (payment.get("paymentURL") or payment.get("paymentUrl") or "").strip() or None
        ntp_id = (payment.get("ntpID") or payment.get("ntpId") or "").strip() or None

    if not payment_url:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Netopia start payment did not return a URL")

    return ntp_id, payment_url


async def get_status(*, ntp_id: str, order_id: str) -> dict[str, Any]:
    if not settings.netopia_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    pos_signature = (settings.netopia_pos_signature or "").strip()
    if not pos_signature:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Netopia not configured")

    url = f"{_netopia_base_url().rstrip('/')}/operation/status"
    payload = {
        "posID": pos_signature,
        "ntpID": (ntp_id or "").strip(),
        "orderID": str(order_id),
    }

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(url, headers=_netopia_headers(), json=payload)
    except httpx.RequestError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Netopia request failed") from exc

    if resp.status_code >= 400:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Netopia status lookup failed")

    try:
        data = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Invalid Netopia response") from exc

    if not isinstance(data, dict):
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Invalid Netopia response")
    return data


def verify_ipn(*, verification_token: str, payload: bytes) -> dict[str, Any]:
    if not settings.netopia_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    pos_signature = (settings.netopia_pos_signature or "").strip()
    if not pos_signature:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Netopia not configured")

    public_key = _public_key_pem()
    if not public_key:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Netopia not configured")

    alg = (settings.netopia_jwt_alg or "RS512").strip().upper() or "RS512"

    try:
        claims = jwt.decode(
            verification_token,
            public_key,
            algorithms=[alg],
            options={
                "verify_aud": False,
                "verify_exp": False,
                "verify_nbf": False,
                "verify_iat": False,
            },
        )
    except JWTError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Netopia signature") from exc

    issuer = str(claims.get("iss") or "")
    if issuer != "NETOPIA Payments":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Netopia issuer")

    aud = claims.get("aud")
    aud_values: list[str] = []
    if isinstance(aud, str):
        aud_values = [aud]
    elif isinstance(aud, list):
        aud_values = [str(item) for item in aud if item]
    else:
        aud_values = [str(aud)] if aud else []

    if pos_signature not in aud_values:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Netopia audience")

    expected_sub = _payload_hash_b64(payload)
    token_sub = str(claims.get("sub") or "")
    if not token_sub or token_sub != expected_sub:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Netopia payload hash mismatch")

    return claims
