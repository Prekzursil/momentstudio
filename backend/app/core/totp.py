from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from datetime import datetime, timezone

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings


def generate_base32_secret(num_bytes: int = 20) -> str:
    raw = secrets.token_bytes(num_bytes)
    return base64.b32encode(raw).decode("utf-8").rstrip("=")


def build_otpauth_url(*, issuer: str, account_name: str, secret: str) -> str:
    issuer_clean = (issuer or "").strip() or "momentstudio"
    account_clean = (account_name or "").strip()
    label = f"{issuer_clean}:{account_clean}" if account_clean else issuer_clean
    digits = int(settings.two_factor_totp_digits or 6)
    period = int(settings.two_factor_totp_period_seconds or 30)
    return (
        "otpauth://totp/"
        + _url_quote(label)
        + f"?secret={_url_quote(secret)}&issuer={_url_quote(issuer_clean)}&digits={digits}&period={period}"
    )


def encrypt_secret(secret: str) -> str:
    token = _fernet().encrypt(secret.encode("utf-8"))
    return token.decode("utf-8")


def decrypt_secret(token: str) -> str | None:
    raw = (token or "").strip()
    if not raw:
        return None
    try:
        out = _fernet().decrypt(raw.encode("utf-8"))
    except InvalidToken:
        return None
    return out.decode("utf-8")


def normalize_code(raw: str) -> str:
    raw = (raw or "").strip()
    digits = "".join(ch for ch in raw if ch.isdigit())
    return digits


def _resolved_totp_digits(digits: int | None) -> int:
    return int(settings.two_factor_totp_digits if digits is None else digits)


def _resolved_totp_window(window: int | None) -> int:
    return int(settings.two_factor_totp_window if window is None else window)


def _resolved_totp_period(period: int | None) -> int:
    return int(settings.two_factor_totp_period_seconds if period is None else period)


def _totp_counter(now: datetime | None, period: int) -> int:
    now_dt = now or datetime.now(timezone.utc)
    return int(now_dt.timestamp()) // period


def _matches_totp_window(*, key: bytes, counter: int, digits: int, window: int, normalized: str) -> bool:
    for offset in range(-window, window + 1):
        expected = _totp(key, counter + offset, digits=digits)
        if hmac.compare_digest(expected, normalized):
            return True
    return False


def verify_totp_code(
    *,
    secret: str,
    code: str,
    now: datetime | None = None,
    window: int | None = None,
    period: int | None = None,
    digits: int | None = None,
) -> bool:
    normalized = normalize_code(code)
    if not normalized:
        return False
    resolved_digits = _resolved_totp_digits(digits)
    if len(normalized) != resolved_digits:
        return False

    key = _base32_decode(secret)
    if key is None:
        return False
    resolved_period = _resolved_totp_period(period)
    counter = _totp_counter(now, resolved_period)
    resolved_window = _resolved_totp_window(window)
    return _matches_totp_window(
        key=key,
        counter=counter,
        digits=resolved_digits,
        window=resolved_window,
        normalized=normalized,
    )


def _fernet() -> Fernet:
    digest = hashlib.sha256(settings.secret_key.encode("utf-8")).digest()
    key = base64.urlsafe_b64encode(digest)
    return Fernet(key)


def _base32_decode(secret: str) -> bytes | None:
    clean = (secret or "").strip().upper().replace(" ", "")
    if not clean:
        return None
    padding = "=" * ((8 - len(clean) % 8) % 8)
    try:
        return base64.b32decode(clean + padding, casefold=True)
    except Exception:
        return None


def _totp(key: bytes, counter: int, *, digits: int) -> str:
    msg = counter.to_bytes(8, "big")
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    chunk = digest[offset : offset + 4]
    value = int.from_bytes(chunk, "big") & 0x7FFFFFFF
    mod = 10 ** digits
    code = value % mod
    return f"{code:0{digits}d}"


def _url_quote(value: str) -> str:
    # Minimal URL quoting without pulling in urllib.parse for this small surface.
    out = []
    for ch in value:
        if ch.isalnum() or ch in "-_.~":
            out.append(ch)
        else:
            out.append("%{:02X}".format(ord(ch)))
    return "".join(out)
