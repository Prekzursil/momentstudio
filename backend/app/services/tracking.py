from __future__ import annotations

from urllib.parse import urlparse

from fastapi import HTTPException, status


def validate_tracking_number(*, courier: str | None, tracking_number: str | None) -> str | None:
    cleaned = (tracking_number or "").strip()
    if not cleaned:
        return None
    if len(cleaned) > 50:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tracking number is too long")
    if "\r" in cleaned or "\n" in cleaned:
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
