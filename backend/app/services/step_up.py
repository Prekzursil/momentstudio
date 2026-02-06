from __future__ import annotations

from fastapi import HTTPException, Request, status

from app.core.security import decode_token
from app.models.user import User

_STEP_UP_HEADER = "x-admin-step-up"
_STEP_UP_ERROR_CODE = "step_up_required"
_STEP_UP_DETAIL = "Step-up authentication required"


def _deny() -> None:
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=_STEP_UP_DETAIL,
        headers={"X-Error-Code": _STEP_UP_ERROR_CODE},
    )


def has_step_up(request: Request, user: User) -> bool:
    token = (request.headers.get(_STEP_UP_HEADER) or "").strip()
    if not token:
        return False

    payload = decode_token(token)
    if not payload or payload.get("type") != "step_up":
        return False

    subject = str(payload.get("sub") or "").strip()
    if not subject or subject != str(getattr(user, "id", "")):
        return False

    return True


def require_step_up(request: Request, user: User) -> None:
    if not has_step_up(request, user):
        _deny()
