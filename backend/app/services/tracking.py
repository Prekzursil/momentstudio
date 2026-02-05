from __future__ import annotations

import re
from urllib.parse import urlparse

from fastapi import HTTPException, status


_COURIER_TRACKING_RE = re.compile(r"^[A-Za-z0-9]{5,30}$")
_GENERIC_TRACKING_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{4,49}$")


def validate_tracking_number(*, courier: str | None, tracking_number: str | None) -> str | None:
    cleaned = (tracking_number or "").strip() or None
    if cleaned is None:
        return None
    if len(cleaned) > 50:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tracking number is too long")

    courier_clean = (courier or "").strip().lower()
    if courier_clean in {"sameday", "fan_courier"}:
        if not _COURIER_TRACKING_RE.match(cleaned):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid tracking number for courier")
        return cleaned

    if " " in cleaned or not _GENERIC_TRACKING_RE.match(cleaned):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid tracking number")
    return cleaned


def validate_tracking_url(*, tracking_url: str | None) -> str | None:
    cleaned = (tracking_url or "").strip() or None
    if cleaned is None:
        return None
    if len(cleaned) > 255:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tracking URL is too long")
    parsed = urlparse(cleaned)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid tracking URL")
    return cleaned
