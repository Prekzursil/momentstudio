from collections.abc import Awaitable, Callable
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.security import decode_token
from app.db.session import get_session
from app.models.user import User, UserRole
from app.services import auth as auth_service
from app.services import self_service

bearer_scheme = HTTPBearer(auto_error=False)
_IMPERSONATION_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
_STAFF_ROLES = {
    UserRole.owner,
    UserRole.admin,
    UserRole.support,
    UserRole.fulfillment,
    UserRole.content,
}
_SECTION_ROLES: dict[str, set[UserRole]] = {
    "dashboard": {
        UserRole.owner,
        UserRole.admin,
        UserRole.support,
        UserRole.fulfillment,
        UserRole.content,
    },
    "content": {UserRole.owner, UserRole.admin, UserRole.content},
    "products": {UserRole.owner, UserRole.admin, UserRole.content},
    "inventory": {UserRole.owner, UserRole.admin, UserRole.fulfillment},
    "orders": {UserRole.owner, UserRole.admin, UserRole.fulfillment},
    "returns": {UserRole.owner, UserRole.admin, UserRole.fulfillment},
    "coupons": {UserRole.owner, UserRole.admin, UserRole.content},
    "users": {UserRole.owner, UserRole.admin, UserRole.support},
    "support": {UserRole.owner, UserRole.admin, UserRole.support},
    "ops": {UserRole.owner, UserRole.admin},
}


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    session: AsyncSession = Depends(get_session),
) -> User:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    payload = decode_token(credentials.credentials)
    if not payload or payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    try:
        user_id = UUID(str(payload.get("sub")))
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

    impersonator = payload.get("impersonator")
    if impersonator:
        try:
            impersonator_id = UUID(str(impersonator))
        except Exception:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")
        if request.method.upper() not in _IMPERSONATION_SAFE_METHODS:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Impersonation is read-only")
        request.state.impersonator_user_id = impersonator_id

    result = await session.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    if getattr(user, "deletion_scheduled_for", None) and self_service.is_deletion_due(user):
        await self_service.execute_account_deletion(session, user)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account deleted")
    if getattr(user, "deleted_at", None) is not None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account deleted")

    return user


async def get_current_user_optional(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    session: AsyncSession = Depends(get_session),
) -> User | None:
    if credentials is None:
        return None
    payload = decode_token(credentials.credentials)
    if not payload or payload.get("type") != "access":
        return None

    try:
        user_id = UUID(str(payload.get("sub")))
    except Exception:
        return None

    impersonator = payload.get("impersonator")
    if impersonator:
        try:
            impersonator_id = UUID(str(impersonator))
        except Exception:
            return None
        if request.method.upper() not in _IMPERSONATION_SAFE_METHODS:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Impersonation is read-only")
        request.state.impersonator_user_id = impersonator_id

    result = await session.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        return None
    if getattr(user, "deletion_scheduled_for", None) and self_service.is_deletion_due(user):
        await self_service.execute_account_deletion(session, user)
        return None
    if getattr(user, "deleted_at", None) is not None:
        return None
    return user


async def get_google_completion_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    session: AsyncSession = Depends(get_session),
) -> User:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    payload = decode_token(credentials.credentials)
    if not payload or payload.get("type") != "google_completion":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    try:
        user_id = UUID(str(payload.get("sub")))
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

    result = await session.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    if getattr(user, "deletion_scheduled_for", None) and self_service.is_deletion_due(user):
        await self_service.execute_account_deletion(session, user)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account deleted")
    if getattr(user, "deleted_at", None) is not None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account deleted")

    if not getattr(user, "google_sub", None):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Google account required")
    if auth_service.is_profile_complete(user):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Profile already complete")

    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role not in (UserRole.admin, UserRole.owner):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user


async def require_staff(user: User = Depends(get_current_user)) -> User:
    if user.role not in _STAFF_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Staff access required")
    return user


def require_admin_section(section: str) -> Callable[..., Awaitable[User]]:
    section_key = (section or "").strip().lower()
    allowed = set(_SECTION_ROLES.get(section_key, set()))

    async def _dep(user: User = Depends(get_current_user)) -> User:
        if user.role not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient role for this section")
        return user

    return _dep


async def require_owner(user: User = Depends(get_current_user)) -> User:
    if user.role != UserRole.owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Owner access required")
    return user


async def require_complete_profile(user: User = Depends(get_current_user)) -> User:
    if getattr(user, "google_sub", None) and not auth_service.is_profile_complete(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Profile incomplete")
    return user


async def require_verified_email(user: User = Depends(require_complete_profile)) -> User:
    if not getattr(user, "email_verified", False):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Email verification required")
    return user
