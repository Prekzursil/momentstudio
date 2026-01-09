from datetime import datetime, timedelta, timezone, date
import secrets
import uuid
import re
from typing import Any

import httpx
from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core import security
from app.core.config import settings
from app.models.user import (
    EmailVerificationToken,
    PasswordResetToken,
    RefreshSession,
    User,
    UserUsernameHistory,
    UserDisplayNameHistory,
    UserEmailHistory,
)
from app.schemas.user import UserCreate
from app.services import self_service


async def get_user_by_email(session: AsyncSession, email: str) -> User | None:
    email = (email or "").strip().lower()
    result = await session.execute(select(User).where(func.lower(User.email) == email))
    return result.scalar_one_or_none()


async def get_user_by_username(session: AsyncSession, username: str) -> User | None:
    result = await session.execute(select(User).where(User.username == username))
    return result.scalar_one_or_none()


async def get_user_by_google_sub(session: AsyncSession, google_sub: str) -> User | None:
    result = await session.execute(select(User).where(User.google_sub == google_sub))
    return result.scalar_one_or_none()


USERNAME_ALLOWED_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{2,29}$")

USERNAME_CHANGE_COOLDOWN = timedelta(days=7)
DISPLAY_NAME_CHANGE_COOLDOWN = timedelta(hours=1)
EMAIL_CHANGE_COOLDOWN = timedelta(days=30)


def _profile_is_complete(user: User) -> bool:
    return bool(
        (user.name or "").strip()
        and (user.username or "").strip()
        and (user.first_name or "").strip()
        and (user.last_name or "").strip()
        and user.date_of_birth
        and (user.phone or "").strip()
    )


def is_profile_complete(user: User) -> bool:
    return _profile_is_complete(user)


def _validate_username(username: str) -> str:
    cleaned = (username or "").strip()
    if not USERNAME_ALLOWED_RE.match(cleaned):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username must be 3-30 chars and contain only letters, numbers, '.', '_', or '-'",
        )
    return cleaned


def _sanitize_username_from_email(email: str) -> str:
    local = (email or "").split("@")[0]
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", local).strip("._-")
    if not cleaned:
        cleaned = "user"
    if not cleaned[0].isalnum():
        cleaned = f"u{cleaned}"
    cleaned = cleaned[:30]
    while len(cleaned) < 3:
        cleaned = f"{cleaned}0"
        cleaned = cleaned[:30]
    if not USERNAME_ALLOWED_RE.match(cleaned):
        cleaned = f"user-{secrets.token_hex(3)}"[:30]
    return cleaned


async def _generate_unique_username(session: AsyncSession, email: str) -> str:
    base = _sanitize_username_from_email(email)
    if not await get_user_by_username(session, base):
        return base
    suffix_num = 2
    while True:
        suffix = f"-{suffix_num}"
        trimmed = base[: 30 - len(suffix)]
        candidate = f"{trimmed}{suffix}"
        if not await get_user_by_username(session, candidate):
            return candidate
        suffix_num += 1


async def _allocate_name_tag(session: AsyncSession, name: str, *, exclude_user_id: uuid.UUID | None = None) -> int:
    q = select(User.name_tag).where(User.name == name)
    if exclude_user_id:
        q = q.where(User.id != exclude_user_id)
    rows = (await session.execute(q)).scalars().all()
    used = {int(x) for x in rows if x is not None}
    tag = 0
    while tag in used:
        tag += 1
    return tag


async def _try_reuse_name_tag(
    session: AsyncSession, *, user_id: uuid.UUID, name: str
) -> int | None:
    rows = (
        (
            await session.execute(
                select(UserDisplayNameHistory.name_tag)
                .where(UserDisplayNameHistory.user_id == user_id, UserDisplayNameHistory.name == name)
                .order_by(UserDisplayNameHistory.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    for tag in sorted({int(x) for x in rows}):
        existing = await session.scalar(
            select(func.count())
            .select_from(User)
            .where(User.name == name, User.name_tag == tag, User.id != user_id)
        )
        if int(existing or 0) == 0:
            return tag
    return None


async def create_user(session: AsyncSession, user_in: UserCreate) -> User:
    normalized_email = (user_in.email or "").strip().lower()
    existing = await get_user_by_email(session, normalized_email)
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")

    username = (
        _validate_username(user_in.username)
        if user_in.username
        else await _generate_unique_username(session, normalized_email)
    )
    if await get_user_by_username(session, username):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username already taken")

    display_name = (user_in.name or "").strip() or username
    display_name = display_name[:255]
    name_tag = await _allocate_name_tag(session, display_name)

    db_user = User(
        email=normalized_email,
        username=username,
        hashed_password=security.hash_password(user_in.password),
        name=display_name,
        name_tag=name_tag,
        first_name=(user_in.first_name or "").strip() or None,
        middle_name=(user_in.middle_name or "").strip() or None,
        last_name=(user_in.last_name or "").strip() or None,
        date_of_birth=user_in.date_of_birth,
        phone=(user_in.phone or "").strip() or None,
        preferred_language=user_in.preferred_language or "en",
    )
    session.add(db_user)
    await session.flush()
    now = datetime.now(timezone.utc)
    session.add(UserUsernameHistory(user_id=db_user.id, username=username, created_at=now))
    session.add(UserDisplayNameHistory(user_id=db_user.id, name=display_name, name_tag=name_tag, created_at=now))
    session.add(UserEmailHistory(user_id=db_user.id, email=db_user.email, created_at=now))
    await session.commit()
    await session.refresh(db_user)
    return db_user


async def authenticate_user(session: AsyncSession, identifier: str, password: str) -> User:
    identifier = (identifier or "").strip()
    if "@" in identifier:
        user = await get_user_by_email(session, identifier)
    else:
        user = await get_user_by_username(session, identifier)
    if not user or not security.verify_password(password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if getattr(user, "google_sub", None) and not _profile_is_complete(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Complete your Google sign-in registration before using password login.",
        )
    if getattr(user, "deleted_at", None) is not None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account deleted")
    if getattr(user, "deletion_scheduled_for", None) and self_service.is_deletion_due(user):
        await self_service.execute_account_deletion(session, user)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account deleted")
    return user


async def complete_google_registration(
    session: AsyncSession,
    user: User,
    *,
    username: str,
    display_name: str,
    first_name: str,
    middle_name: str | None,
    last_name: str,
    date_of_birth: date,
    phone: str,
    password: str,
    preferred_language: str | None = None,
) -> User:
    if not user.google_sub:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Google account required")
    if _profile_is_complete(user):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Profile already complete")

    new_username = _validate_username(username)
    if new_username != user.username:
        existing = await get_user_by_username(session, new_username)
        if existing and existing.id != user.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username already taken")
        user.username = new_username
        session.add(UserUsernameHistory(user_id=user.id, username=new_username, created_at=datetime.now(timezone.utc)))

    cleaned_name = (display_name or "").strip()
    if not cleaned_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Display name is required")
    cleaned_name = cleaned_name[:255]
    if cleaned_name != (user.name or ""):
        reused = await _try_reuse_name_tag(session, user_id=user.id, name=cleaned_name)
        tag = reused if reused is not None else await _allocate_name_tag(session, cleaned_name, exclude_user_id=user.id)
        user.name = cleaned_name
        user.name_tag = tag
        session.add(UserDisplayNameHistory(user_id=user.id, name=cleaned_name, name_tag=tag, created_at=datetime.now(timezone.utc)))

    user.first_name = (first_name or "").strip() or None
    user.middle_name = (middle_name or "").strip() or None
    user.last_name = (last_name or "").strip() or None
    user.date_of_birth = date_of_birth
    user.phone = (phone or "").strip()
    if preferred_language:
        user.preferred_language = preferred_language

    user.hashed_password = security.hash_password(password)
    session.add(user)
    await session.commit()
    await session.refresh(user)

    if not _profile_is_complete(user):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Profile incomplete")
    return user


async def update_username(session: AsyncSession, user: User, new_username: str) -> User:
    new_username = _validate_username(new_username)
    if new_username == user.username:
        return user
    if _profile_is_complete(user):
        last = await session.scalar(
            select(UserUsernameHistory.created_at)
            .where(UserUsernameHistory.user_id == user.id)
            .order_by(UserUsernameHistory.created_at.desc())
            .limit(1)
        )
        if last and isinstance(last, datetime):
            if last.tzinfo is None:
                last = last.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) - last < USERNAME_CHANGE_COOLDOWN:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="You can change your username once every 7 days.",
                )
    existing = await get_user_by_username(session, new_username)
    if existing and existing.id != user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username already taken")
    user.username = new_username
    session.add(user)
    session.add(UserUsernameHistory(user_id=user.id, username=new_username, created_at=datetime.now(timezone.utc)))
    await session.commit()
    await session.refresh(user)
    return user


async def update_display_name(session: AsyncSession, user: User, new_name: str) -> User:
    cleaned = (new_name or "").strip()
    if not cleaned:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Display name is required")
    cleaned = cleaned[:255]
    if cleaned == (user.name or ""):
        return user
    # If the user is reverting to a previously used display name, allow it even inside the cooldown window.
    reused = await _try_reuse_name_tag(session, user_id=user.id, name=cleaned)

    if _profile_is_complete(user) and reused is None:
        last = await session.scalar(
            select(UserDisplayNameHistory.created_at)
            .where(UserDisplayNameHistory.user_id == user.id)
            .order_by(UserDisplayNameHistory.created_at.desc())
            .limit(1)
        )
        if last and isinstance(last, datetime):
            if last.tzinfo is None:
                last = last.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) - last < DISPLAY_NAME_CHANGE_COOLDOWN:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="You can change your display name once per hour.",
                )

    tag = reused if reused is not None else await _allocate_name_tag(session, cleaned, exclude_user_id=user.id)
    user.name = cleaned
    user.name_tag = tag
    session.add(user)
    session.add(UserDisplayNameHistory(user_id=user.id, name=cleaned, name_tag=tag, created_at=datetime.now(timezone.utc)))
    await session.commit()
    await session.refresh(user)
    return user


async def list_username_history(session: AsyncSession, user_id: uuid.UUID) -> list[UserUsernameHistory]:
    result = await session.execute(
        select(UserUsernameHistory)
        .where(UserUsernameHistory.user_id == user_id)
        .order_by(UserUsernameHistory.created_at.desc())
    )
    return list(result.scalars().all())


async def list_display_name_history(session: AsyncSession, user_id: uuid.UUID) -> list[UserDisplayNameHistory]:
    result = await session.execute(
        select(UserDisplayNameHistory)
        .where(UserDisplayNameHistory.user_id == user_id)
        .order_by(UserDisplayNameHistory.created_at.desc())
    )
    return list(result.scalars().all())


async def create_google_user(
    session: AsyncSession,
    *,
    email: str,
    name: str | None,
    first_name: str | None = None,
    last_name: str | None = None,
    picture: str | None,
    sub: str,
    email_verified: bool,
    preferred_language: str = "en",
) -> User:
    email = (email or "").strip().lower()
    username = await _generate_unique_username(session, email)
    display_name = (name or "").strip() or username
    display_name = display_name[:255]
    name_tag = await _allocate_name_tag(session, display_name)

    password_placeholder = security.hash_password(secrets.token_urlsafe(16))
    user = User(
        email=email,
        username=username,
        hashed_password=password_placeholder,
        name=display_name,
        name_tag=name_tag,
        first_name=(first_name or "").strip() or None,
        last_name=(last_name or "").strip() or None,
        google_sub=sub,
        google_email=email,
        google_picture_url=picture,
        email_verified=email_verified,
        preferred_language=preferred_language or "en",
    )
    session.add(user)
    await session.flush()
    now = datetime.now(timezone.utc)
    session.add(UserUsernameHistory(user_id=user.id, username=username, created_at=now))
    session.add(UserDisplayNameHistory(user_id=user.id, name=display_name, name_tag=name_tag, created_at=now))
    session.add(UserEmailHistory(user_id=user.id, email=user.email, created_at=now))
    await session.commit()
    await session.refresh(user)
    return user


async def update_email(session: AsyncSession, user: User, new_email: str) -> User:
    cleaned = (new_email or "").strip().lower()
    if not cleaned:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email is required")
    if user.google_sub:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email cannot be changed while Google is linked. Unlink Google first.",
        )
    if cleaned == (user.email or "").strip().lower():
        return user

    last = await session.scalar(
        select(UserEmailHistory.created_at)
        .where(UserEmailHistory.user_id == user.id)
        .order_by(UserEmailHistory.created_at.desc())
        .limit(1)
    )
    if last and isinstance(last, datetime):
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) - last < EMAIL_CHANGE_COOLDOWN:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="You can change your email once every 30 days.",
            )

    existing = await get_user_by_email(session, cleaned)
    if existing and existing.id != user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")

    user.email = cleaned
    user.email_verified = False
    now = datetime.now(timezone.utc)
    session.add(user)
    session.add(UserEmailHistory(user_id=user.id, email=cleaned, created_at=now))
    await session.commit()
    await session.refresh(user)
    return user



async def _revoke_other_reset_tokens(session: AsyncSession, user_id: uuid.UUID) -> None:
    result = await session.execute(
        select(PasswordResetToken).where(PasswordResetToken.user_id == user_id, PasswordResetToken.used.is_(False))
    )
    tokens = result.scalars().all()
    for tok in tokens:
        tok.used = True
    if tokens:
        session.add_all(tokens)
        await session.flush()


async def create_reset_token(session: AsyncSession, email: str, expires_minutes: int = 60) -> PasswordResetToken:
    user = await get_user_by_email(session, email)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    await _revoke_other_reset_tokens(session, user.id)
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=expires_minutes)
    reset = PasswordResetToken(user_id=user.id, token=token, expires_at=expires_at, used=False)
    session.add(reset)
    await session.commit()
    await session.refresh(reset)
    return reset


async def confirm_reset_token(session: AsyncSession, token: str, new_password: str) -> User:
    result = await session.execute(
        select(PasswordResetToken).where(PasswordResetToken.token == token, PasswordResetToken.used.is_(False))
    )
    reset = result.scalar_one_or_none()
    expires_at = reset.expires_at if reset else None
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if not reset or not expires_at or expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired token")
    user = await session.get(User, reset.user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    user.hashed_password = security.hash_password(new_password)
    reset.used = True
    await _revoke_other_reset_tokens(session, user.id)
    session.add_all([user, reset])
    await session.commit()
    await session.refresh(user)
    return user


async def create_refresh_session(session: AsyncSession, user_id: uuid.UUID) -> RefreshSession:
    jti = secrets.token_hex(16)
    expires_at = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_exp_days)
    refresh_session = RefreshSession(user_id=user_id, jti=jti, expires_at=expires_at, revoked=False)
    session.add(refresh_session)
    await session.flush()
    return refresh_session


async def issue_tokens_for_user(session: AsyncSession, user: User) -> dict[str, str]:
    refresh_session = await create_refresh_session(session, user.id)
    access = security.create_access_token(str(user.id), refresh_session.jti)
    refresh = security.create_refresh_token(str(user.id), refresh_session.jti, refresh_session.expires_at)
    await session.commit()
    return {"access_token": access, "refresh_token": refresh}


async def _revoke_other_verification_tokens(session: AsyncSession, user_id: uuid.UUID) -> None:
    result = await session.execute(
        select(EmailVerificationToken).where(EmailVerificationToken.user_id == user_id, EmailVerificationToken.used.is_(False))
    )
    tokens = result.scalars().all()
    for tok in tokens:
        tok.used = True
    if tokens:
        session.add_all(tokens)
        await session.flush()


async def create_email_verification(session: AsyncSession, user: User, expires_minutes: int = 60) -> EmailVerificationToken:
    await _revoke_other_verification_tokens(session, user.id)
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=expires_minutes)
    record = EmailVerificationToken(user_id=user.id, token=token, expires_at=expires_at, used=False)
    session.add(record)
    await session.commit()
    await session.refresh(record)
    return record


async def confirm_email_verification(session: AsyncSession, token: str) -> User:
    result = await session.execute(
        select(EmailVerificationToken).where(EmailVerificationToken.token == token, EmailVerificationToken.used.is_(False))
    )
    record = result.scalar_one_or_none()
    expires_at = record.expires_at if record else None
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if not record or not expires_at or expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired token")
    user = await session.get(User, record.user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    user.email_verified = True
    record.used = True
    session.add_all([user, record])
    await session.commit()
    await session.refresh(user)
    return user


async def revoke_refresh_token(session: AsyncSession, jti: str, reason: str = "revoked") -> None:
    result = await session.execute(select(RefreshSession).where(RefreshSession.jti == jti))
    refresh = result.scalar_one_or_none()
    if refresh:
        refresh.revoked = True
        refresh.revoked_reason = reason
        session.add(refresh)
        await session.commit()


async def validate_refresh_token(session: AsyncSession, token: str) -> RefreshSession:
    payload = security.decode_token(token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
    jti = payload.get("jti")
    sub = payload.get("sub")
    if not jti or not sub:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
    result = await session.execute(select(RefreshSession).where(RefreshSession.jti == jti))
    stored = result.scalar_one_or_none()
    expires_at = stored.expires_at if stored else None
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if not stored or stored.revoked or not expires_at or expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
    return stored


async def exchange_google_code(code: str) -> dict[str, Any]:
    if not settings.google_client_id or not settings.google_client_secret or not settings.google_redirect_uri:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Google OAuth not configured")
    token_url = "https://oauth2.googleapis.com/token"
    userinfo_url = "https://www.googleapis.com/oauth2/v3/userinfo"
    async with httpx.AsyncClient(timeout=10) as client:
        token_resp = await client.post(
            token_url,
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": settings.google_redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        if token_resp.status_code != 200:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to exchange Google code")
        access_token = token_resp.json().get("access_token")
        if not access_token:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing Google access token")
        user_resp = await client.get(userinfo_url, headers={"Authorization": f"Bearer {access_token}"})
        if user_resp.status_code != 200:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to fetch Google profile")
        return user_resp.json()
