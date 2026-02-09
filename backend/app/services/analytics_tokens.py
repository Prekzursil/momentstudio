from __future__ import annotations

from datetime import datetime, timedelta, timezone

import jwt

from app.core.config import settings
from app.core.security import decode_token

ANALYTICS_TOKEN_TYPE = "analytics"


def create_analytics_token(*, session_id: str) -> str:
    cleaned_session_id = (session_id or "").strip()[:100]
    ttl_seconds = int(getattr(settings, "analytics_token_ttl_seconds", 60 * 60 * 24) or 60 * 60 * 24)
    exp = datetime.now(timezone.utc) + timedelta(seconds=max(ttl_seconds, 60))
    payload = {"type": ANALYTICS_TOKEN_TYPE, "session_id": cleaned_session_id, "exp": exp}
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def validate_analytics_token(*, token: str, session_id: str) -> bool:
    payload = decode_token((token or "").strip())
    if not payload or payload.get("type") != ANALYTICS_TOKEN_TYPE:
        return False
    cleaned_session_id = (session_id or "").strip()[:100]
    return str(payload.get("session_id") or "").strip()[:100] == cleaned_session_id
