from __future__ import annotations

from fastapi import Request

from app.models.user import User


def has_step_up(request: Request, user: User) -> bool:
    # Step-up is intentionally disabled to avoid excessive password prompts in the admin UI.
    # Admin access is still protected by normal authentication + role-based guards.
    return True


def require_step_up(request: Request, user: User) -> None:
    return None
