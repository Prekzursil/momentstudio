from __future__ import annotations

from datetime import datetime, timedelta, timezone

from jose import jwt

from app.core.config import settings
from app.core.security import decode_token

NEWSLETTER_TOKEN_TYPE = "newsletter"
NEWSLETTER_PURPOSE_CONFIRM = "confirm"
NEWSLETTER_PURPOSE_UNSUBSCRIBE = "unsubscribe"

CONFIRM_TOKEN_TTL_DAYS = 7
UNSUBSCRIBE_TOKEN_TTL_DAYS = 3650  # 10 years


def create_newsletter_token(*, email: str, purpose: str) -> str:
    cleaned_email = str(email or "").strip().lower()
    ttl_days = CONFIRM_TOKEN_TTL_DAYS if purpose == NEWSLETTER_PURPOSE_CONFIRM else UNSUBSCRIBE_TOKEN_TTL_DAYS
    exp = datetime.now(timezone.utc) + timedelta(days=int(ttl_days))
    payload = {"type": NEWSLETTER_TOKEN_TYPE, "purpose": str(purpose), "email": cleaned_email, "exp": exp}
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def decode_newsletter_token(*, token: str, purpose: str) -> str | None:
    payload = decode_token(str(token or "").strip())
    if not payload or payload.get("type") != NEWSLETTER_TOKEN_TYPE:
        return None
    if payload.get("purpose") != str(purpose):
        return None
    email = payload.get("email")
    if not isinstance(email, str) or not email.strip():
        return None
    return email.strip().lower()


def build_frontend_confirm_url(*, token: str) -> str:
    return f"{settings.frontend_origin.rstrip('/')}/newsletter/confirm?token={token}"


def build_frontend_unsubscribe_url(*, token: str) -> str:
    return f"{settings.frontend_origin.rstrip('/')}/newsletter/unsubscribe?token={token}"


def build_api_unsubscribe_url(*, token: str) -> str:
    return f"{settings.frontend_origin.rstrip('/')}/api/v1/newsletter/unsubscribe?token={token}"

