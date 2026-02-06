from __future__ import annotations

import re
from typing import Iterable

from fastapi import HTTPException, Request, status

from app.models.user import User, UserRole
from app.services import step_up as step_up_service


_EMAIL_RE = re.compile(r"(?i)(?<![\w.+-])([\w.+-]{1,64})@([\w-]{1,255}(?:\.[\w-]{2,})+)")
_PHONE_RE = re.compile(r"^\+?[0-9]{6,20}$")

PII_REVEAL_ROLES: set[UserRole] = {UserRole.owner, UserRole.admin, UserRole.support, UserRole.fulfillment}


def can_reveal_pii(user: User | None) -> bool:
    if not user:
        return False
    return user.role in PII_REVEAL_ROLES


def require_pii_reveal(user: User | None, *, request: Request) -> None:
    if not can_reveal_pii(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="PII reveal not permitted")
    assert user is not None
    step_up_service.require_step_up(request, user)


def mask_email(email: str | None) -> str | None:
    raw = (email or "").strip()
    if not raw or "@" not in raw:
        return email
    local, _, domain = raw.partition("@")
    if not local or not domain:
        return email
    if len(local) <= 1:
        masked_local = "*"
    else:
        masked_local = f"{local[0]}{'*' * min(len(local) - 1, 8)}"
    return f"{masked_local}@{domain}"


def mask_phone(phone: str | None) -> str | None:
    raw = (phone or "").strip()
    if not raw:
        return phone
    normalized = raw if raw.startswith("+") else f"+{raw}"
    if not _PHONE_RE.match(normalized):
        return "***"
    digits = normalized[1:]
    if len(digits) <= 4:
        return f"+{'*' * len(digits)}"
    keep_tail = digits[-2:]
    masked = "*" * (len(digits) - 2)
    return f"+{masked}{keep_tail}"


def mask_text(value: str | None, *, keep: int = 1) -> str | None:
    raw = (value or "").strip()
    if not raw:
        return value
    if keep <= 0:
        return "***"
    head = raw[:keep]
    return f"{head}{'*' * 3}"


def redact_emails_in_text(value: str | None) -> str | None:
    text = value or ""

    def _mask(match: re.Match) -> str:
        return str(mask_email(match.group(0)) or "***")

    return _EMAIL_RE.sub(_mask, text)


def mask_address_lines(
    *,
    line1: str | None,
    line2: str | None,
    postal_code: str | None,
    phone: str | None = None,
) -> dict[str, str | None]:
    return {
        "line1": "***" if (line1 or "").strip() else line1,
        "line2": "***" if (line2 or "").strip() else line2,
        "postal_code": "***" if (postal_code or "").strip() else postal_code,
        "phone": mask_phone(phone) if phone else None,
    }


def mask_many_emails(values: Iterable[str | None]) -> list[str | None]:
    return [mask_email(v) for v in values]
