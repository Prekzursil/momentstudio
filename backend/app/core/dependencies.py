from collections.abc import Awaitable, Callable
from ipaddress import ip_address, ip_network, IPv4Address, IPv4Network, IPv6Address, IPv6Network
from typing import NoReturn
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.config import settings
from app.core.security import decode_token
from app.db.session import get_session
from app.models.passkeys import UserPasskey
from app.models.user import User, UserRole
from app.services import auth as auth_service
from app.services import self_service

bearer_scheme = HTTPBearer(auto_error=False)
_IMPERSONATION_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
_TRAINING_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
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
    "audit": {UserRole.owner, UserRole.admin},
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

_ADMIN_MFA_REQUIRED_DETAIL = "Two-factor authentication or passkey required for admin access"
_ADMIN_IP_BYPASS_COOKIE = "admin_ip_bypass"
_ADMIN_IP_BYPASS_HEADER = "x-admin-ip-bypass"
_ADMIN_IP_DENIED_DETAIL = "Admin access is blocked from this IP address"
_ADMIN_IP_ALLOWLIST_DETAIL = "Admin access is restricted to approved IP addresses"
_TRAINING_MODE_DETAIL = "Training mode is read-only"

_IPAddress = IPv4Address | IPv6Address
_IPNetwork = IPv4Network | IPv6Network


async def _has_passkey(session: AsyncSession, user_id: UUID) -> bool:
    result = await session.execute(select(UserPasskey.id).where(UserPasskey.user_id == user_id).limit(1))
    return result.scalar_one_or_none() is not None


async def _require_admin_mfa(session: AsyncSession, user: User) -> None:
    if user.role not in (UserRole.admin, UserRole.owner):
        return
    if not getattr(settings, "admin_mfa_required", True):
        return
    if bool(getattr(user, "two_factor_enabled", False)):
        return
    if await _has_passkey(session, user.id):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=_ADMIN_MFA_REQUIRED_DETAIL,
        headers={"X-Error-Code": "admin_mfa_required"},
    )


def _parse_ip_networks(values: list[str]) -> list[_IPNetwork]:
    networks: list[_IPNetwork] = []
    for raw in values or []:
        candidate = (raw or "").strip()
        if not candidate:
            continue
        try:
            networks.append(ip_network(candidate, strict=False))
        except ValueError:
            continue
    return networks


def _extract_admin_client_ip(request: Request) -> str | None:
    header = (getattr(settings, "admin_ip_header", None) or "").strip()
    if header:
        raw = (request.headers.get(header) or "").strip()
        if raw:
            if header.lower() == "x-forwarded-for":
                raw = raw.split(",", 1)[0].strip()
            return raw or None
    return request.client.host if request.client else None


def _admin_ip_bypass_cookie_active(request: Request, user: User) -> bool:
    cookie_value = (request.cookies.get(_ADMIN_IP_BYPASS_COOKIE) or "").strip()
    if not cookie_value:
        return False
    payload = decode_token(cookie_value)
    if not payload or payload.get("type") != "admin_ip_bypass":
        return False
    subject = str(payload.get("sub") or "").strip()
    return subject == str(user.id)


def _admin_ip_bypass_active(request: Request, user: User) -> bool:
    bypass_secret = (getattr(settings, "admin_ip_bypass_token", None) or "").strip()
    if not bypass_secret:
        return False
    header_value = (request.headers.get(_ADMIN_IP_BYPASS_HEADER) or "").strip()
    if header_value and header_value == bypass_secret:
        return True
    return _admin_ip_bypass_cookie_active(request, user)


def _raise_admin_ip_error(detail: str, code: str) -> NoReturn:
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=detail,
        headers={"X-Error-Code": code},
    )


def _parse_admin_client_ip_or_deny(request: Request) -> _IPAddress:
    ip_raw = (_extract_admin_client_ip(request) or "").strip()
    if not ip_raw:
        _raise_admin_ip_error(_ADMIN_IP_DENIED_DETAIL, "admin_ip_denied")
    try:
        return ip_address(ip_raw)
    except ValueError:
        _raise_admin_ip_error(_ADMIN_IP_DENIED_DETAIL, "admin_ip_denied")


def _ensure_not_denied(client_ip: _IPAddress, deny_raw: list[str]) -> None:
    deny = _parse_ip_networks(deny_raw)
    if any(client_ip in network for network in deny):
        _raise_admin_ip_error(_ADMIN_IP_DENIED_DETAIL, "admin_ip_denied")


def _ensure_allowlisted(client_ip: _IPAddress, allow_raw: list[str]) -> None:
    allow = _parse_ip_networks(allow_raw)
    if allow and not any(client_ip in network for network in allow):
        _raise_admin_ip_error(_ADMIN_IP_ALLOWLIST_DETAIL, "admin_ip_allowlist")


def _require_admin_ip_access(request: Request, user: User) -> None:
    allow_raw = list(getattr(settings, "admin_ip_allowlist", None) or [])
    deny_raw = list(getattr(settings, "admin_ip_denylist", None) or [])
    if not allow_raw and not deny_raw:
        return
    if _admin_ip_bypass_active(request, user):
        return
    client_ip = _parse_admin_client_ip_or_deny(request)
    _ensure_not_denied(client_ip, deny_raw)
    _ensure_allowlisted(client_ip, allow_raw)


def _require_training_mode_writes_allowed(request: Request, user: User) -> None:
    if not bool(getattr(user, "admin_training_mode", False)):
        return
    if request.method.upper() in _TRAINING_SAFE_METHODS:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=_TRAINING_MODE_DETAIL,
        headers={"X-Error-Code": "training_readonly"},
    )


def _decode_required_payload(credentials: HTTPAuthorizationCredentials | None, token_type: str) -> dict:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    payload = decode_token(credentials.credentials)
    if not payload or payload.get("type") != token_type:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    return payload


def _decode_optional_payload(credentials: HTTPAuthorizationCredentials | None, token_type: str) -> dict | None:
    if credentials is None:
        return None
    payload = decode_token(credentials.credentials)
    if not payload or payload.get("type") != token_type:
        return None
    return payload


def _parse_uuid_claim_or_raise(payload: dict, claim: str) -> UUID:
    try:
        return UUID(str(payload.get(claim)))
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")


def _parse_uuid_claim_or_none(payload: dict, claim: str) -> UUID | None:
    try:
        return UUID(str(payload.get(claim)))
    except Exception:
        return None


def _apply_required_impersonation_claim(request: Request, payload: dict) -> None:
    impersonator = payload.get("impersonator")
    if not impersonator:
        return
    try:
        impersonator_id = UUID(str(impersonator))
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")
    if request.method.upper() not in _IMPERSONATION_SAFE_METHODS:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Impersonation is read-only")
    request.state.impersonator_user_id = impersonator_id


def _apply_optional_impersonation_claim(request: Request, payload: dict) -> bool:
    impersonator = payload.get("impersonator")
    if not impersonator:
        return True
    try:
        impersonator_id = UUID(str(impersonator))
    except Exception:
        return False
    if request.method.upper() not in _IMPERSONATION_SAFE_METHODS:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Impersonation is read-only")
    request.state.impersonator_user_id = impersonator_id
    return True


async def _load_user_by_id(session: AsyncSession, user_id: UUID) -> User | None:
    result = await session.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def _ensure_active_user(session: AsyncSession, user: User, *, optional: bool) -> bool:
    if getattr(user, "deletion_scheduled_for", None) and self_service.is_deletion_due(user):
        await self_service.execute_account_deletion(session, user)
        if optional:
            return False
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account deleted")
    if getattr(user, "deleted_at", None) is not None:
        if optional:
            return False
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account deleted")
    return True


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    session: AsyncSession = Depends(get_session),
) -> User:
    payload = _decode_required_payload(credentials, "access")
    user_id = _parse_uuid_claim_or_raise(payload, "sub")
    _apply_required_impersonation_claim(request, payload)
    user = await _load_user_by_id(session, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    await _ensure_active_user(session, user, optional=False)
    return user


async def get_current_user_optional(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    session: AsyncSession = Depends(get_session),
) -> User | None:
    payload = _decode_optional_payload(credentials, "access")
    if not payload:
        return None
    user_id = _parse_uuid_claim_or_none(payload, "sub")
    if user_id is None:
        return None
    if not _apply_optional_impersonation_claim(request, payload):
        return None
    user = await _load_user_by_id(session, user_id)
    if not user:
        return None
    if not await _ensure_active_user(session, user, optional=True):
        return None
    return user


async def get_google_completion_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    session: AsyncSession = Depends(get_session),
) -> User:
    payload = _decode_required_payload(credentials, "google_completion")
    user_id = _parse_uuid_claim_or_raise(payload, "sub")
    user = await _load_user_by_id(session, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    await _ensure_active_user(session, user, optional=False)

    if not getattr(user, "google_sub", None):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Google account required")
    if auth_service.is_profile_complete(user):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Profile already complete")

    return user


async def require_admin(
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> User:
    if user.role not in (UserRole.admin, UserRole.owner):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    await _require_admin_mfa(session, user)
    _require_training_mode_writes_allowed(request, user)
    return user


async def require_staff(user: User = Depends(get_current_user)) -> User:
    if user.role not in _STAFF_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Staff access required")
    return user


def require_admin_section(section: str) -> Callable[..., Awaitable[User]]:
    section_key = (section or "").strip().lower()
    allowed = set(_SECTION_ROLES.get(section_key, set()))

    async def _dep(
        request: Request,
        session: AsyncSession = Depends(get_session),
        user: User = Depends(get_current_user),
    ) -> User:
        if user.role not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient role for this section")
        await _require_admin_mfa(session, user)
        _require_admin_ip_access(request, user)
        _require_training_mode_writes_allowed(request, user)
        return user

    return _dep


async def require_owner(
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> User:
    if user.role != UserRole.owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Owner access required")
    await _require_admin_mfa(session, user)
    _require_training_mode_writes_allowed(request, user)
    return user


async def require_complete_profile(user: User = Depends(get_current_user)) -> User:
    if getattr(user, "google_sub", None) and not auth_service.is_profile_complete(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Profile incomplete")
    return user


async def require_verified_email(user: User = Depends(require_complete_profile)) -> User:
    if not getattr(user, "email_verified", False):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Email verification required")
    return user
