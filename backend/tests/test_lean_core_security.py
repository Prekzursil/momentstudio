"""Lean-gate unit coverage for ``app.core.security``.

Fills the uncovered branches the broader suite missed: ``verify_password`` on a
malformed hash, the legacy ``_create_token`` (with and without a ``jti``), the
admin-IP-bypass token minutes guard, the webauthn token without a user id, and
the receipt-token decode guard for a missing/blank order id.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import jwt

from app.core import security
from app.core.config import settings
from app.core.security import (
    create_admin_ip_bypass_token,
    create_receipt_token,
    create_webauthn_token,
    decode_receipt_token,
    decode_token,
    hash_password,
    verify_password,
)


def _decode(token: str) -> dict:
    return jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])


def test_verify_password_round_trip_and_bad_hash() -> None:
    hashed = hash_password("s3cret")
    assert verify_password("s3cret", hashed) is True
    assert verify_password("wrong", hashed) is False
    # A non-bcrypt hash makes ``checkpw`` raise ValueError -> handled as False.
    assert verify_password("s3cret", "not-a-bcrypt-hash") is False


def test_legacy_create_token_with_and_without_jti() -> None:
    with_jti = security._create_token(
        "user-1", "access", timedelta(minutes=5), jti="abc"
    )
    payload = _decode(with_jti)
    assert payload["sub"] == "user-1"
    assert payload["jti"] == "abc"

    without_jti = security._create_token("user-2", "access", timedelta(minutes=5))
    payload2 = _decode(without_jti)
    assert payload2["sub"] == "user-2"
    assert "jti" not in payload2


def test_create_admin_ip_bypass_token_clamps_minutes() -> None:
    token = create_admin_ip_bypass_token("admin-1", expires_minutes=0)
    payload = _decode(token)
    assert payload["type"] == "admin_ip_bypass"
    # default-path branch as well.
    default_token = create_admin_ip_bypass_token("admin-1")
    assert _decode(default_token)["type"] == "admin_ip_bypass"


def test_create_webauthn_token_anonymous_subject() -> None:
    token = create_webauthn_token(purpose="login", challenge="chal")
    payload = _decode(token)
    assert payload["sub"] == "anon"
    assert payload["purpose"] == "login"
    assert "uid" not in payload


def test_decode_receipt_token_round_trip_and_guards() -> None:
    expires = datetime.now(timezone.utc) + timedelta(hours=1)
    good = create_receipt_token(order_id="order-1", expires_at=expires, token_version=2)
    assert decode_receipt_token(good) == ("order-1", 2)

    # Missing/blank order id -> None.
    bad = jwt.encode(
        {"type": "receipt", "order_id": "", "ver": 0, "exp": expires},
        settings.secret_key,
        algorithm=settings.jwt_algorithm,
    )
    assert decode_receipt_token(bad) is None

    # Wrong type -> None.
    not_receipt = jwt.encode(
        {"type": "other", "exp": expires},
        settings.secret_key,
        algorithm=settings.jwt_algorithm,
    )
    assert decode_receipt_token(not_receipt) is None


def test_decode_token_invalid_returns_none() -> None:
    assert decode_token("garbage.token.value") is None
