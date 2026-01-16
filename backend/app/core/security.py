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


def create_access_token(subject: str, jti: str | None = None) -> str:
    return _create_token(subject, "access", timedelta(minutes=settings.access_token_exp_minutes), jti=jti)


def create_refresh_token(subject: str, jti: str, expires_at: datetime | None = None) -> str:
    delta = expires_at - datetime.now(timezone.utc) if expires_at else timedelta(days=settings.refresh_token_exp_days)
    return _create_token(subject, "refresh", delta, jti=jti)


def create_google_completion_token(subject: str) -> str:
    return _create_token(subject, "google_completion", timedelta(minutes=settings.google_completion_token_exp_minutes))


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


def create_receipt_token(*, order_id: str, expires_at: datetime) -> str:
    to_encode = {"type": "receipt", "order_id": str(order_id), "exp": expires_at}
    return jwt.encode(to_encode, settings.secret_key, algorithm=settings.jwt_algorithm)


def decode_receipt_token(token: str) -> str | None:
    payload = decode_token(token)
    if not payload or payload.get("type") != "receipt":
        return None
    order_id = payload.get("order_id")
    return str(order_id) if isinstance(order_id, str) and order_id else None
