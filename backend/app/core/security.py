from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import bcrypt
from jose import JWTError, jwt

from app.core.config import settings


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed_password.encode("utf-8"))
    except ValueError:
        return False


def _create_token(subject: str, token_type: str, expires_delta: timedelta, jti: str | None = None) -> str:
    expire = datetime.now(timezone.utc) + expires_delta
    to_encode = {"sub": subject, "type": token_type, "exp": expire}
    if jti:
        to_encode["jti"] = jti
    return jwt.encode(to_encode, settings.secret_key, algorithm=settings.jwt_algorithm)


def _create_token_with_claims(
    subject: str,
    token_type: str,
    expires_delta: timedelta,
    *,
    jti: str | None = None,
    extra_claims: dict[str, Any] | None = None,
) -> str:
    expire = datetime.now(timezone.utc) + expires_delta
    to_encode: dict[str, Any] = {"sub": subject, "type": token_type, "exp": expire}
    if jti:
        to_encode["jti"] = jti
    if extra_claims:
        to_encode.update(extra_claims)
    return jwt.encode(to_encode, settings.secret_key, algorithm=settings.jwt_algorithm)


def create_access_token(subject: str, jti: str | None = None) -> str:
    return _create_token_with_claims(subject, "access", timedelta(minutes=settings.access_token_exp_minutes), jti=jti)


def create_impersonation_access_token(
    subject: str,
    *,
    impersonator_user_id: str,
    expires_minutes: int | None = None,
) -> str:
    minutes = int(expires_minutes if expires_minutes is not None else settings.admin_impersonation_exp_minutes)
    minutes = max(1, minutes)
    return _create_token_with_claims(
        subject,
        "access",
        timedelta(minutes=minutes),
        extra_claims={"impersonator": str(impersonator_user_id)},
    )


def create_refresh_token(subject: str, jti: str, expires_at: datetime | None = None) -> str:
    delta = expires_at - datetime.now(timezone.utc) if expires_at else timedelta(days=settings.refresh_token_exp_days)
    return _create_token_with_claims(subject, "refresh", delta, jti=jti)


def create_admin_ip_bypass_token(subject: str, *, expires_minutes: int | None = None) -> str:
    minutes = int(expires_minutes if expires_minutes is not None else settings.admin_ip_bypass_cookie_minutes)
    minutes = max(1, minutes)
    return _create_token_with_claims(subject, "admin_ip_bypass", timedelta(minutes=minutes))


def create_google_completion_token(subject: str) -> str:
    return _create_token_with_claims(subject, "google_completion", timedelta(minutes=settings.google_completion_token_exp_minutes))


def create_two_factor_token(subject: str, *, remember: bool, method: str) -> str:
    return _create_token_with_claims(
        subject,
        "two_factor",
        timedelta(minutes=settings.two_factor_challenge_exp_minutes),
        extra_claims={"remember": bool(remember), "method": str(method)},
    )


def create_webauthn_token(
    *,
    purpose: str,
    challenge: str,
    user_id: str | None = None,
    remember: bool | None = None,
) -> str:
    claims: dict[str, Any] = {"purpose": str(purpose), "challenge": str(challenge)}
    if user_id:
        claims["uid"] = str(user_id)
    if remember is not None:
        claims["remember"] = bool(remember)
    subject = str(user_id) if user_id else "anon"
    return _create_token_with_claims(
        subject,
        "webauthn",
        timedelta(minutes=settings.webauthn_challenge_exp_minutes),
        extra_claims=claims,
    )


def decode_token(token: str) -> Optional[dict[str, Any]]:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError:
        return None


def create_content_preview_token(*, content_key: str, expires_at: datetime) -> str:
    to_encode = {"type": "content_preview", "key": content_key, "exp": expires_at}
    return jwt.encode(to_encode, settings.secret_key, algorithm=settings.jwt_algorithm)


def decode_content_preview_token(token: str) -> str | None:
    payload = decode_token(token)
    if not payload or payload.get("type") != "content_preview":
        return None
    key = payload.get("key")
    return str(key) if isinstance(key, str) and key else None


def create_receipt_token(*, order_id: str, expires_at: datetime, token_version: int = 0) -> str:
    to_encode = {"type": "receipt", "order_id": str(order_id), "ver": int(token_version), "exp": expires_at}
    return jwt.encode(to_encode, settings.secret_key, algorithm=settings.jwt_algorithm)


def decode_receipt_token(token: str) -> tuple[str, int] | None:
    payload = decode_token(token)
    if not payload or payload.get("type") != "receipt":
        return None
    order_id = payload.get("order_id")
    if not isinstance(order_id, str) or not order_id:
        return None
    ver_raw = payload.get("ver")
    ver = int(ver_raw) if isinstance(ver_raw, (int, float, str)) and str(ver_raw).strip() else 0
    return str(order_id), max(0, ver)
