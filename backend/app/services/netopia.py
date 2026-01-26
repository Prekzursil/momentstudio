from __future__ import annotations

import base64
import hashlib
from pathlib import Path
from typing import Any

from fastapi import HTTPException, status
from jose import jwt
from jose.exceptions import JWTError

from app.core.config import settings


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
    return bool((settings.netopia_pos_signature or "").strip() and _public_key_pem())


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

