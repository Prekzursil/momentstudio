from datetime import datetime, timedelta, timezone
import secrets
import uuid

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core import security
from app.core.config import settings
from app.models.user import EmailVerificationToken, PasswordResetToken, RefreshSession, User
from app.schemas.user import UserCreate


async def get_user_by_email(session: AsyncSession, email: str) -> User | None:
    result = await session.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()


async def create_user(session: AsyncSession, user_in: UserCreate) -> User:
    existing = await get_user_by_email(session, user_in.email)
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")

    db_user = User(
        email=user_in.email,
        hashed_password=security.hash_password(user_in.password),
        name=user_in.name,
    )
    session.add(db_user)
    await session.commit()
    await session.refresh(db_user)
    return db_user


async def authenticate_user(session: AsyncSession, email: str, password: str) -> User:
    user = await get_user_by_email(session, email)
    if not user or not security.verify_password(password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
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
