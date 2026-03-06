from __future__ import annotations

import base64
import hashlib
import logging
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
logger = logging.getLogger(__name__)


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


def _private_media_root_path() -> Path:
    private_root_value = (getattr(settings, "private_media_root", None) or "private_uploads").strip()
    return Path(private_root_value or "private_uploads")


def _key_path_candidates(raw_path: str) -> list[Path]:
    preferred = Path(raw_path)
    candidates: list[Path] = [preferred]
    if preferred.is_absolute():
        return candidates

    private_root = _private_media_root_path()
    candidates.append(private_root / raw_path)

    try:
        module_root = Path(__file__).resolve().parents[2]
    except (OSError, IndexError):
        module_root = None
    if module_root is not None:
        candidates.append(module_root / private_root / raw_path)
        candidates.append(module_root.parent / private_root / raw_path)
    return candidates


def _read_existing_candidate(candidates: list[Path]) -> bytes:
    last_exc: OSError | None = None
    for candidate in candidates:
        try:
            if candidate.is_file():
                return candidate.read_bytes()
        except OSError as exc:
            last_exc = exc
    if last_exc:
        raise last_exc
    raise FileNotFoundError(str(candidates[0]) if candidates else "")


def _read_netopia_key_bytes(path: str) -> bytes:
    raw = (path or "").strip()
    if not raw:
        return b""
    return _read_existing_candidate(_key_path_candidates(raw))


def _configured_public_key_material(env: str) -> tuple[str, str]:
    preferred_pem = settings.netopia_public_key_pem_live if env == "live" else settings.netopia_public_key_pem_sandbox
    pem = (preferred_pem or settings.netopia_public_key_pem or "").strip()
    preferred_path = settings.netopia_public_key_path_live if env == "live" else settings.netopia_public_key_path_sandbox
    path = (preferred_path or settings.netopia_public_key_path or "").strip()
    return pem, path


def _parse_pem_public_material(key_bytes: bytes) -> str:
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
    try:
        return key_bytes.decode("utf-8").strip()
    except UnicodeDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Netopia public key could not be decoded",
        ) from exc


def _parse_der_public_material(key_bytes: bytes) -> str:
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
    return _to_subject_public_key_pem(cert.public_key())


def _public_key_pem_from_bytes(key_bytes: bytes) -> str:
    if key_bytes.lstrip().startswith(b"-----BEGIN "):
        return _parse_pem_public_material(key_bytes)
    return _parse_der_public_material(key_bytes)


def _public_key_pem() -> str:
    env = _netopia_env()
    pem, path = _configured_public_key_material(env)
    if pem:
        return pem
    if not path:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Netopia public key not configured",
        )

    try:
        key_bytes = _read_netopia_key_bytes(path)
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Netopia public key could not be read (check NETOPIA_PUBLIC_KEY_PATH_*)",
        ) from exc

    if not key_bytes:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Netopia public key file is empty",
        )

    return _public_key_pem_from_bytes(key_bytes)


def is_netopia_configured() -> bool:
    configured, _ = netopia_configuration_status()
    return configured


def _missing_primary_netopia_config(env: str) -> list[str]:
    missing: list[str] = []
    if not _netopia_api_key():
        missing.append(f"NETOPIA_API_KEY_{env.upper()} (or NETOPIA_API_KEY)")
    if not _netopia_pos_signature():
        missing.append(f"NETOPIA_POS_SIGNATURE_{env.upper()} (or NETOPIA_POS_SIGNATURE)")
    return missing


def _public_key_config_error(env: str) -> str | None:
    pem, path = _configured_public_key_material(env)
    if not (pem or path):
        return (
            f"Missing Netopia configuration: NETOPIA_PUBLIC_KEY_PEM_{env.upper()} / "
            f"NETOPIA_PUBLIC_KEY_PATH_{env.upper()} (or NETOPIA_PUBLIC_KEY_PEM / NETOPIA_PUBLIC_KEY_PATH)"
        )
    try:
        _public_key_pem()
    except HTTPException as exc:
        return str(getattr(exc, "detail", "") or "Netopia public key could not be loaded")
    return None


def netopia_configuration_status() -> tuple[bool, str | None]:
    env = _netopia_env()
    missing = _missing_primary_netopia_config(env)
    key_error = _public_key_config_error(env)
    if key_error:
        if key_error.startswith("Missing Netopia configuration:"):
            missing.append(key_error.removeprefix("Missing Netopia configuration: ").strip())
        else:
            return False, key_error

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


def _require_netopia_enabled() -> None:
    if not settings.netopia_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")


def _required_pos_signature() -> str:
    pos_signature = _netopia_pos_signature()
    if not pos_signature:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Netopia not configured")
    return pos_signature


def _first_non_empty(mapping: dict[str, Any], keys: tuple[str, ...]) -> str | None:
    for key in keys:
        value = mapping.get(key)
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return None


async def _post_start_payment(url: str, body: bytes) -> httpx.Response:
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            return await client.post(url, headers=_netopia_headers(), content=body)
    except httpx.RequestError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Netopia request failed") from exc


def _start_payment_payload(
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
    pos_signature: str,
) -> dict[str, Any]:
    amount_value = Decimal(str(amount_ron)).quantize(Decimal("0.01"))
    return {
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


def _netopia_error_detail(response: httpx.Response, *, default: str) -> str:
    detail = default
    try:
        data = response.json()
        if isinstance(data, dict):
            detail = str(data.get("message") or data.get("error") or detail)
    except Exception as exc:
        logger.debug(
            "netopia_start_payment_error_body_not_json",
            extra={"status_code": response.status_code},
            exc_info=exc,
        )
    return detail


def _extract_start_payment_url(data: Any) -> tuple[str | None, str]:
    payment = data.get("payment") if isinstance(data, dict) else None
    if not isinstance(payment, dict):
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Netopia start payment did not return a URL")
    payment_url = _first_non_empty(payment, ("paymentURL", "paymentUrl"))
    ntp_id = _first_non_empty(payment, ("ntpID", "ntpId"))
    if not payment_url:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Netopia start payment did not return a URL")
    return ntp_id, payment_url


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
    _require_netopia_enabled()
    pos_signature = _required_pos_signature()

    url = f"{_netopia_base_url().rstrip('/')}/payment/card/start"
    payload = _start_payment_payload(
        order_id=order_id,
        amount_ron=amount_ron,
        description=description,
        billing=billing,
        shipping=shipping,
        products=products,
        language=language,
        cancel_url=cancel_url,
        notify_url=notify_url,
        redirect_url=redirect_url,
        pos_signature=pos_signature,
    )

    body = simplejson.dumps(payload, use_decimal=True).encode("utf-8")
    resp = await _post_start_payment(url, body)

    if resp.status_code >= 400:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=_netopia_error_detail(resp, default="Netopia start payment failed"),
        )

    try:
        data = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Invalid Netopia response") from exc
    return _extract_start_payment_url(data)


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


def _safe_header_algorithm(verification_token: str, *, allowed_algs: set[str]) -> str | None:
    try:
        header = jwt.get_unverified_header(verification_token)
        header_alg = str((header or {}).get("alg") or "").strip().upper()
        if header_alg in allowed_algs:
            return header_alg
    except Exception as exc:
        logger.debug("netopia_ipn_header_parse_failed", exc_info=exc)
    return None


def _resolve_ipn_algorithms(verification_token: str) -> list[str]:
    alg = (settings.netopia_jwt_alg or "RS512").strip().upper() or "RS512"
    allowed_algs = {"RS256", "RS384", "RS512"}
    algs: list[str] = [alg] if alg in allowed_algs else ["RS512"]
    extra_alg = _safe_header_algorithm(verification_token, allowed_algs=allowed_algs)
    if extra_alg and extra_alg not in algs:
        algs.append(extra_alg)
    return algs


def _decode_ipn_claims(*, verification_token: str, public_key: str, algorithms: list[str]) -> dict[str, Any]:
    try:
        claims = jwt.decode(
            verification_token,
            public_key,
            algorithms=algorithms,
            leeway=5 * 60,
            options={
                "require": ["sub", "aud", "iss", "iat"],
                "verify_aud": False,
                "verify_iss": False,
            },
        )
    except PyJWTError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Netopia signature") from exc
    return cast(dict[str, Any], claims)


def _normalize_numeric_claims(claims: dict[str, Any]) -> None:
    for key in ("iat", "nbf", "exp"):
        value = claims.get(key)
        if isinstance(value, str) and value.isdigit():
            claims[key] = int(value)


def _validate_iat_and_exp(claims: dict[str, Any]) -> None:
    now_ts = datetime.now(timezone.utc).timestamp()
    max_age_seconds = max(60, int(getattr(settings, "netopia_ipn_max_age_seconds", 60 * 60 * 24)))
    skew_seconds = 5 * 60

    iat = claims.get("iat")
    if isinstance(iat, (int, float)):
        if iat - skew_seconds > now_ts:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Netopia token time")
        if now_ts - float(iat) > max_age_seconds:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Stale Netopia token")

    exp = claims.get("exp")
    if isinstance(exp, (int, float)) and float(exp) + skew_seconds < now_ts:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Expired Netopia token")


def _validate_issuer(claims: dict[str, Any]) -> None:
    issuer = str(claims.get("iss") or "").strip()
    if issuer != "NETOPIA Payments":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Netopia issuer")


def _audience_values(claims: dict[str, Any]) -> list[str]:
    aud = claims.get("aud")
    if isinstance(aud, str):
        return [aud.strip()]
    if isinstance(aud, list):
        return [str(item).strip() for item in aud if item]
    return [str(aud).strip()] if aud else []


def _validate_audience(claims: dict[str, Any], *, pos_signature: str) -> None:
    if pos_signature.strip() not in _audience_values(claims):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Netopia audience")


def _digest_variants(payload_bytes: bytes) -> set[str]:
    digest = hashlib.sha512(payload_bytes).digest()
    std = base64.b64encode(digest).decode("ascii")
    url = base64.urlsafe_b64encode(digest).decode("ascii")
    return {std, std.rstrip("="), url, url.rstrip("=")}


def _canonicalize_payload(payload: bytes) -> bytes:
    try:
        parsed = simplejson.loads(payload)
        return simplejson.dumps(parsed, use_decimal=True, separators=(",", ":"), sort_keys=True).encode("utf-8")
    except Exception:
        return b""


def _validate_payload_hash(claims: dict[str, Any], *, payload: bytes) -> None:
    token_sub = str(claims.get("sub") or "").strip()
    if not token_sub:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Netopia payload hash mismatch")

    if token_sub in _digest_variants(payload):
        return

    canonical_payload = _canonicalize_payload(payload)
    if canonical_payload and token_sub in _digest_variants(canonical_payload):
        return
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Netopia payload hash mismatch")


def verify_ipn(*, verification_token: str, payload: bytes) -> dict[str, Any]:
    if not settings.netopia_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    pos_signature = _netopia_pos_signature()
    if not pos_signature:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Netopia not configured")

    try:
        public_key = _public_key_pem()
    except HTTPException as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Netopia not configured") from exc

    claims = _decode_ipn_claims(
        verification_token=verification_token,
        public_key=public_key,
        algorithms=_resolve_ipn_algorithms(verification_token),
    )
    _normalize_numeric_claims(claims)
    _validate_iat_and_exp(claims)
    _validate_issuer(claims)
    _validate_audience(claims, pos_signature=pos_signature)
    _validate_payload_hash(claims, payload=payload)

    return claims
