"""Lean-gate unit coverage for ``app.core.totp``.

Exercises every branch of the TOTP helpers: secret generation, otpauth URL
building (with and without an account label), Fernet encrypt/decrypt round-trip
plus the empty-token and invalid-token guards, code normalization, base32
decoding guards, and ``verify_totp_code`` for the empty / wrong-length /
bad-secret / mismatch / match paths.
"""

from __future__ import annotations

import base64

from app.core import totp
from app.core.config import settings
from app.core.totp import (
    build_otpauth_url,
    decrypt_secret,
    encrypt_secret,
    generate_base32_secret,
    normalize_code,
    verify_totp_code,
)


def test_generate_base32_secret_has_no_padding() -> None:
    secret = generate_base32_secret()
    assert "=" not in secret
    # Decodable back to 20 bytes (default).
    assert totp._base32_decode(secret) is not None


def test_build_otpauth_url_with_and_without_account() -> None:
    with_account = build_otpauth_url(
        issuer="Moment Studio", account_name="user@example.com", secret="ABC"
    )
    assert with_account.startswith("otpauth://totp/")
    assert "secret=ABC" in with_account
    assert "%3A" in with_account  # the ':' in the label is percent-encoded

    without_account = build_otpauth_url(issuer="", account_name="  ", secret="ABC")
    # Empty issuer falls back to the default and there is no ':' label segment.
    assert "momentstudio" in without_account


def test_encrypt_decrypt_round_trip() -> None:
    secret = generate_base32_secret()
    token = encrypt_secret(secret)
    assert token != secret
    assert decrypt_secret(token) == secret


def test_decrypt_secret_empty_returns_none() -> None:
    assert decrypt_secret("") is None
    assert decrypt_secret("   ") is None


def test_decrypt_secret_invalid_token_returns_none() -> None:
    assert decrypt_secret("not-a-valid-fernet-token") is None


def test_normalize_code_strips_non_digits() -> None:
    assert normalize_code("  12 34-56 ") == "123456"
    assert normalize_code(None) == ""  # type: ignore[arg-type]


def test_base32_decode_guards() -> None:
    assert totp._base32_decode("") is None
    assert totp._base32_decode("   ") is None
    # Invalid base32 alphabet triggers the exception path.
    assert totp._base32_decode("@@@@") is None


def test_verify_totp_code_empty_and_wrong_length() -> None:
    secret = generate_base32_secret()
    assert verify_totp_code(secret=secret, code="") is False
    # Wrong length for the configured digit count.
    assert verify_totp_code(secret=secret, code="1", digits=6) is False


def test_verify_totp_code_bad_secret() -> None:
    assert verify_totp_code(secret="@@@@", code="123456", digits=6) is False


def test_verify_totp_code_match_and_mismatch() -> None:
    secret = generate_base32_secret()
    key = totp._base32_decode(secret)
    assert key is not None

    digits = int(settings.two_factor_totp_digits or 6)
    period = int(settings.two_factor_totp_period_seconds or 30)

    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    counter = int(now.timestamp()) // period
    valid = totp._totp(key, counter, digits=digits)

    assert (
        verify_totp_code(
            secret=secret, code=valid, now=now, window=1, period=period, digits=digits
        )
        is True
    )
    # A code that is the right length but never matches in the window.
    wrong = "0" * digits if valid != "0" * digits else "1" * digits
    assert (
        verify_totp_code(
            secret=secret, code=wrong, now=now, window=0, period=period, digits=digits
        )
        is False
    )
