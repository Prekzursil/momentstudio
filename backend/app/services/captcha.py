from __future__ import annotations

from typing import Any

import httpx
from fastapi import HTTPException, status

from app.core.config import settings

TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


def _require_turnstile_provider() -> None:
    provider = (settings.captcha_provider or "").strip().lower()
    if provider == "turnstile":
        return
    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="CAPTCHA provider misconfigured")


def _require_turnstile_secret() -> str:
    secret = (settings.turnstile_secret_key or "").strip()
    if secret:
        return secret
    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="CAPTCHA secret key missing")


def _require_captcha_token(token: str | None) -> str:
    normalized = (token or "").strip()
    if normalized:
        return normalized
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CAPTCHA required")


def _turnstile_payload(secret: str, token: str, remote_ip: str | None) -> dict[str, Any]:
    payload: dict[str, Any] = {"secret": secret, "response": token}
    if remote_ip:
        payload["remoteip"] = remote_ip
    return payload


async def _turnstile_verify(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.post(TURNSTILE_VERIFY_URL, data=payload)
    except httpx.HTTPError:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="CAPTCHA verification failed")
    if resp.status_code != 200:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="CAPTCHA verification failed")
    if not resp.content:
        return {}
    parsed = resp.json()
    return parsed if isinstance(parsed, dict) else {}


async def verify(token: str | None, *, remote_ip: str | None = None) -> None:
    if not settings.captcha_enabled:
        return
    _require_turnstile_provider()
    secret = _require_turnstile_secret()
    normalized_token = _require_captcha_token(token)
    payload = _turnstile_payload(secret, normalized_token, remote_ip)
    data = await _turnstile_verify(payload)
    if not bool(data.get("success")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CAPTCHA verification failed")
