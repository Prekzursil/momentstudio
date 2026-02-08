from __future__ import annotations

import base64
import hashlib
from decimal import Decimal
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from typing import cast

from cryptography import x509
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import types as asymmetric_types
from fastapi import HTTPException, status
import httpx
import simplejson
import jwt
from jwt.exceptions import PyJWTError

from app.core.config import settings

NETOPIA_BASE_URL_LIVE = "https://secure.mobilpay.ro/pay"
NETOPIA_BASE_URL_SANDBOX = "https://secure.sandbox.netopia-payments.com"


def _netopia_env() -> str:
    env = (settings.netopia_env or "sandbox").strip().lower()
    return "live" if env == "live" else "sandbox"


def _netopia_api_key() -> str:
    env = _netopia_env()
    preferred = settings.netopia_api_key_live if env == "live" else settings.netopia_api_key_sandbox
    api_key = (preferred or "").strip()
    if api_key:
        return api_key
    return (settings.netopia_api_key or "").strip()


def _netopia_pos_signature() -> str:
    env = _netopia_env()
    preferred = settings.netopia_pos_signature_live if env == "live" else settings.netopia_pos_signature_sandbox
    pos_signature = (preferred or "").strip()
    if pos_signature:
        return pos_signature
    return (settings.netopia_pos_signature or "").strip()


def _payload_hash_b64(payload: bytes) -> str:
    return base64.b64encode(hashlib.sha512(payload).digest()).decode("ascii")


def _to_subject_public_key_pem(public_key: asymmetric_types.PublicKeyTypes) -> str:
    return (
        public_key.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        .decode("utf-8")
        .strip()
    )


def _read_netopia_key_bytes(path: str) -> bytes:
    raw = (path or "").strip()
    if not raw:
        return b""

    preferred = Path(raw)
    candidates: list[Path] = [preferred]
    if not preferred.is_absolute():
        private_root_value = (getattr(settings, "private_media_root", None) or "private_uploads").strip() or "private_uploads"
        private_root = Path(private_root_value)
        candidates.append(private_root / raw)

        # Also try resolving relative to the backend/app root (e.g. when running `uvicorn` from
        # `backend/`) and one level above it (repo root), so deployments can keep certs under
        # `private_uploads/` without relying on process CWD.
        try:
            module_root = Path(__file__).resolve().parents[2]
        except (OSError, IndexError):
            module_root = None
        if module_root is not None:
            candidates.append(module_root / private_root / raw)
            candidates.append(module_root.parent / private_root / raw)

    last_exc: OSError | None = None
    for candidate in candidates:
        try:
            if candidate.is_file():
                return candidate.read_bytes()
        except OSError as exc:
            last_exc = exc

    if last_exc:
        raise last_exc
    raise FileNotFoundError(raw)


def _public_key_pem() -> str:
    env = _netopia_env()
    preferred_pem = settings.netopia_public_key_pem_live if env == "live" else settings.netopia_public_key_pem_sandbox
    pem = (preferred_pem or settings.netopia_public_key_pem or "").strip()
    if pem:
        return pem
    preferred_path = (
        settings.netopia_public_key_path_live if env == "live" else settings.netopia_public_key_path_sandbox
    )
    path = (preferred_path or settings.netopia_public_key_path or "").strip()
    if path:
        try:
            key_bytes = _read_netopia_key_bytes(path)
        except OSError as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Netopia public key could not be read (check NETOPIA_PUBLIC_KEY_PATH_*)",
            ) from exc

        if not key_bytes:
            return ""

        # Common case: PEM certificate/public key.
        if key_bytes.lstrip().startswith(b"-----BEGIN "):
            header = key_bytes.lstrip().splitlines()[0]
            if b"PRIVATE KEY" in header:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Netopia public key path points to a private key; provide the public certificate/key instead",
                )

            if b"BEGIN CERTIFICATE" in header:
                try:
                    cert = x509.load_pem_x509_certificate(key_bytes)
                    return _to_subject_public_key_pem(cert.public_key())
                except Exception as exc:
                    raise HTTPException(
                        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                        detail="Netopia public certificate could not be parsed",
                    ) from exc

            if b"BEGIN PUBLIC KEY" in header:
                try:
                    loaded_key = serialization.load_pem_public_key(key_bytes)
                    return _to_subject_public_key_pem(cast(asymmetric_types.PublicKeyTypes, loaded_key))
                except Exception as exc:
                    raise HTTPException(
                        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                        detail="Netopia public key could not be parsed",
                    ) from exc

            # Fall back to returning the PEM text verbatim.
            try:
                return key_bytes.decode("utf-8").strip()
            except UnicodeDecodeError as exc:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Netopia public key could not be decoded",
                ) from exc

        # DER certificate/public key (some .cer downloads are DER).
        try:
            cert = x509.load_der_x509_certificate(key_bytes)
        except Exception:
            try:
                loaded_key = serialization.load_der_public_key(key_bytes)
            except Exception as exc:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Netopia public key could not be parsed",
                ) from exc
            return _to_subject_public_key_pem(cast(asymmetric_types.PublicKeyTypes, loaded_key))
        else:
            return _to_subject_public_key_pem(cert.public_key())
    return ""


def is_netopia_configured() -> bool:
    configured, _ = netopia_configuration_status()
    return configured


def netopia_configuration_status() -> tuple[bool, str | None]:
    env = _netopia_env()
    missing: list[str] = []

    api_key = _netopia_api_key()
    if not api_key:
        missing.append(f"NETOPIA_API_KEY_{env.upper()} (or NETOPIA_API_KEY)")

    pos_signature = _netopia_pos_signature()
    if not pos_signature:
        missing.append(f"NETOPIA_POS_SIGNATURE_{env.upper()} (or NETOPIA_POS_SIGNATURE)")

    try:
        public_key = _public_key_pem()
    except HTTPException as exc:
        return False, str(getattr(exc, "detail", "") or "Netopia public key could not be loaded")

    if not public_key:
        missing.append(
            f"NETOPIA_PUBLIC_KEY_PEM_{env.upper()} / NETOPIA_PUBLIC_KEY_PATH_{env.upper()} (or NETOPIA_PUBLIC_KEY_PEM / NETOPIA_PUBLIC_KEY_PATH)"
        )

    if missing:
        return False, "Missing Netopia configuration: " + ", ".join(missing)

    return True, None


def _netopia_base_url() -> str:
    return NETOPIA_BASE_URL_LIVE if _netopia_env() == "live" else NETOPIA_BASE_URL_SANDBOX


def _netopia_headers() -> dict[str, str]:
    api_key = _netopia_api_key()
    if not api_key:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Netopia not configured")
    return {
        "Content-Type": "application/json",
        "Authorization": api_key,
    }


async def start_payment(
    *,
    order_id: str,
    amount_ron: Decimal,
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

    pos_signature = _netopia_pos_signature()
    if not pos_signature:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Netopia not configured")

    url = f"{_netopia_base_url().rstrip('/')}/payment/card/start"
    amount_value = Decimal(str(amount_ron)).quantize(Decimal("0.01"))
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
            "amount": amount_value,
            "currency": "RON",
            "billing": billing,
            "shipping": shipping,
            "products": products,
            "installments": {},
            "data": {},
        },
    }

    try:
        body = simplejson.dumps(payload, use_decimal=True).encode("utf-8")
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(url, headers=_netopia_headers(), content=body)
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

    pos_signature = _netopia_pos_signature()
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

    pos_signature = _netopia_pos_signature()
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
    except PyJWTError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Netopia signature") from exc

    max_age_seconds = max(60, int(getattr(settings, "netopia_ipn_max_age_seconds", 60 * 60 * 24)))
    skew_seconds = 5 * 60
    now_ts = datetime.now(timezone.utc).timestamp()
    for key in ("iat", "nbf", "exp"):
        value = claims.get(key)
        if isinstance(value, str) and value.isdigit():
            claims[key] = int(value)

    iat = claims.get("iat")
    if isinstance(iat, (int, float)):
        if iat - skew_seconds > now_ts:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Netopia token time")
        if now_ts - float(iat) > max_age_seconds:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Stale Netopia token")

    exp = claims.get("exp")
    if isinstance(exp, (int, float)) and float(exp) + skew_seconds < now_ts:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Expired Netopia token")

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
