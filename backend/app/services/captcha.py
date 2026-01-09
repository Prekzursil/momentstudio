from __future__ import annotations

from typing import Any

import httpx
from fastapi import HTTPException, status

from app.core.config import settings

TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


async def verify(token: str | None, *, remote_ip: str | None = None) -> None:
    if not settings.captcha_enabled:
        return

    provider = (settings.captcha_provider or "").strip().lower()
    if provider != "turnstile":
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="CAPTCHA provider misconfigured")

    secret = (settings.turnstile_secret_key or "").strip()
    if not secret:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="CAPTCHA secret key missing")

    token = (token or "").strip()
    if not token:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CAPTCHA required")

    payload: dict[str, Any] = {"secret": secret, "response": token}
    if remote_ip:
        payload["remoteip"] = remote_ip

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.post(TURNSTILE_VERIFY_URL, data=payload)
    except httpx.HTTPError:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="CAPTCHA verification failed")

    if resp.status_code != 200:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="CAPTCHA verification failed")

    data = resp.json() if resp.content else {}
    success = bool(isinstance(data, dict) and data.get("success"))
    if not success:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CAPTCHA verification failed")

