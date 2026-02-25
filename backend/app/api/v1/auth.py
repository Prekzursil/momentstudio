import logging
import re
from datetime import datetime, timedelta, timezone, date
from functools import partial
from pathlib import Path
from typing import Annotated, Any
from urllib.parse import urlencode
from uuid import UUID

import anyio
import jwt

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field, EmailStr, field_validator
from sqlalchemy import func, select, or_
from sqlalchemy.ext.asyncio import AsyncSession
from webauthn.helpers import base64url_to_bytes

from app.core import security
from app.core.config import settings
from app.core.dependencies import (
    get_current_user,
    get_google_completion_user,
    require_admin,
    require_admin_section,
    require_complete_profile,
)
from app.core.rate_limit import limiter, per_identifier_limiter
from app.core.security import decode_token
from app.db.session import get_session
from app.models.user import (
    RefreshSession,
    User,
    UserRole,
    UserDisplayNameHistory,
    UserEmailHistory,
    UserSecondaryEmail,
    UserSecurityEvent,
    UserUsernameHistory,
)
from app.models.content import ContentBlock, ContentStatus
from app.models.legal import LegalConsent, LegalConsentContext
from app.models.user_export import UserDataExportJob, UserDataExportStatus
from app.schemas.auth import (
    AuthResponse,
    GoogleCallbackResponse,
    AccountDeletionStatus,
    UserDataExportJobResponse,
    RefreshSessionResponse,
    RefreshSessionsRevokeResponse,
    UserSecurityEventResponse,
    TwoFactorChallengeResponse,
    TwoFactorEnableResponse,
    TwoFactorSetupResponse,
    TwoFactorStatusResponse,
    PasskeyAuthenticationOptionsResponse,
    PasskeyRegistrationOptionsResponse,
    PasskeyResponse,
    EmailVerificationConfirm,
    SecondaryEmailConfirmRequest,
    SecondaryEmailCreateRequest,
    SecondaryEmailMakePrimaryRequest,
    SecondaryEmailResponse,
    PasswordResetConfirm,
    PasswordResetRequest,
    RefreshRequest,
    StepUpRequest,
    StepUpResponse,
    TrainingModeUpdateRequest,
    TokenPair,
    UserEmailsResponse,
    UserResponse,
)
from app.schemas.user import UserCreate
from app.services import auth as auth_service
from app.services import captcha as captcha_service
from app.services import email as email_service
from app.services import passkeys as passkeys_service
from app.services import private_storage
from app.services import self_service
from app.services import user_export as user_export_service
from app.services import storage
from app.core import metrics

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)

register_rate_limit = per_identifier_limiter(
    lambda r: r.client.host if r.client else "anon",
    settings.auth_rate_limit_register,
    60,
    key="auth:register",
)
login_rate_limit = limiter("auth:login", settings.auth_rate_limit_login, 60)
step_up_rate_limit = limiter("auth:step_up", settings.auth_rate_limit_login, 60)
two_factor_rate_limit = limiter("auth:2fa", settings.auth_rate_limit_login, 60)
refresh_rate_limit = limiter("auth:refresh", settings.auth_rate_limit_refresh, 60)
reset_request_rate_limit = limiter("auth:reset_request", settings.auth_rate_limit_reset_request, 60)
reset_confirm_rate_limit = limiter("auth:reset_confirm", settings.auth_rate_limit_reset_confirm, 60)
google_rate_limit = per_identifier_limiter(
    lambda r: r.client.host if r.client else "anon",
    settings.auth_rate_limit_google,
    60,
    key="auth:google",
)


def _user_or_ip_identifier(request: Request) -> str:
    auth_header = request.headers.get("authorization") or ""
    if auth_header.lower().startswith("bearer "):
        token = auth_header.split(" ", 1)[1]
        decoded = decode_token(token)
        if decoded and decoded.get("sub"):
            return f"user:{decoded['sub']}"
    return f"ip:{request.client.host if request.client else 'anon'}"


verify_request_rate_limit = per_identifier_limiter(
    _user_or_ip_identifier,
    settings.auth_rate_limit_verify_request,
    60,
    key="auth:verify_request",
)

_REQUIRED_REGISTRATION_CONSENT_KEYS = ("page.terms-and-conditions", "page.privacy-policy")


async def _require_published_consent_docs(session: AsyncSession, keys: tuple[str, ...]) -> dict[str, int]:
    now = datetime.now(timezone.utc)
    rows = (
        await session.execute(
            select(ContentBlock.key, ContentBlock.version).where(
                ContentBlock.key.in_(keys),
                ContentBlock.status == ContentStatus.published,
                or_(ContentBlock.published_at.is_(None), ContentBlock.published_at <= now),
                or_(ContentBlock.published_until.is_(None), ContentBlock.published_until > now),
            )
        )
    ).all()
    versions = {str(key): int(version) for key, version in rows if key and version is not None}
    missing = [key for key in keys if key not in versions]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Legal documents are not configured (missing published content: {', '.join(missing)})",
        )
    return versions


def _build_google_state(kind: str, user_id: str | None = None) -> str:
    payload = {
        "sub": "google-oauth",
        "type": kind,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=10),
    }
    if user_id:
        payload["uid"] = user_id
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def _validate_google_state(state: str, expected_type: str, expected_user_id: str | None = None) -> None:
    data = security.decode_token(state)
    if not data or data.get("type") != expected_type:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid state")
    if expected_user_id and data.get("uid") != expected_user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid state")


def set_refresh_cookie(response: Response, token: str, *, persistent: bool = True) -> None:
    payload = {
        "httponly": True,
        "secure": settings.secure_cookies,
        "samesite": settings.cookie_samesite.lower(),
        "path": "/",
    }
    if persistent:
        payload["max_age"] = settings.refresh_token_exp_days * 24 * 60 * 60
    response.set_cookie("refresh_token", token, **payload)


def clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        "refresh_token",
        path="/",
        secure=settings.secure_cookies,
        samesite=settings.cookie_samesite.lower(),
    )


def set_admin_ip_bypass_cookie(response: Response, token: str) -> None:
    max_age = max(60, int(settings.admin_ip_bypass_cookie_minutes) * 60)
    response.set_cookie(
        "admin_ip_bypass",
        token,
        httponly=True,
        secure=settings.secure_cookies,
        samesite=settings.cookie_samesite.lower(),
        path="/",
        max_age=max_age,
    )


def clear_admin_ip_bypass_cookie(response: Response) -> None:
    response.delete_cookie(
        "admin_ip_bypass",
        path="/",
        secure=settings.secure_cookies,
        samesite=settings.cookie_samesite.lower(),
    )


def _extract_bearer_token(request: Request) -> str | None:
    raw = (request.headers.get("authorization") or "").strip()
    if not raw:
        return None
    parts = raw.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    token = parts[1].strip()
    return token or None


def _extract_token_jti(token: str, *, token_type: str) -> str | None:
    payload = security.decode_token(token)
    if not payload or payload.get("type") != token_type:
        return None
    jti = str(payload.get("jti") or "").strip()
    return jti or None


def _extract_refresh_session_jti(request: Request) -> str | None:
    refresh_token = (request.cookies.get("refresh_token") or "").strip()
    if refresh_token:
        refresh_jti = _extract_token_jti(refresh_token, token_type="refresh")
        if refresh_jti:
            return refresh_jti

    access_token = _extract_bearer_token(request)
    if access_token:
        access_jti = _extract_token_jti(access_token, token_type="access")
        if access_jti:
            return access_jti

    return None


def _extract_country_code(request: Request) -> str | None:
    candidates = [
        request.headers.get("cf-ipcountry"),
        request.headers.get("cloudfront-viewer-country"),
        request.headers.get("fastly-client-country"),
        request.headers.get("x-country-code"),
        request.headers.get("x-country"),
    ]
    for raw in candidates:
        code = (raw or "").strip().upper()
        if not code or code in ("XX", "ZZ"):
            continue
        if len(code) > 8:
            code = code[:8]
        if not code.isalnum():
            continue
        return code
    return None


async def _resolve_active_refresh_session_jti(
    session: AsyncSession,
    user_id: UUID,
    candidate_jti: str | None,
) -> str | None:
    def _normalized_expiry(value: datetime | None) -> datetime | None:
        if value and value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value

    def _session_is_active(
        candidate: RefreshSession | None,
        *,
        allow_revoked: bool = False,
        now: datetime,
    ) -> bool:
        if not candidate or candidate.user_id != user_id:
            return False
        if candidate.revoked and not allow_revoked:
            return False
        expires_at = _normalized_expiry(candidate.expires_at)
        return bool(expires_at and expires_at >= now)

    if not candidate_jti:
        return None
    stored = (await session.execute(select(RefreshSession).where(RefreshSession.jti == candidate_jti))).scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if not _session_is_active(stored, allow_revoked=True, now=now):
        return None

    if not stored.revoked:
        return stored.jti

    replacement_jti = (getattr(stored, "replaced_by_jti", None) or "").strip()
    if not replacement_jti:
        return None

    replacement = (
        await session.execute(select(RefreshSession).where(RefreshSession.jti == replacement_jti))
    ).scalar_one_or_none()
    if not _session_is_active(replacement, now=now):
        return None
    return replacement.jti


def _ensure_utc_datetime(value: datetime | None) -> datetime | None:
    if value and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _active_refresh_session_expiry(row: RefreshSession, *, now: datetime) -> datetime | None:
    expires_at = _ensure_utc_datetime(row.expires_at)
    if not expires_at or expires_at < now:
        return None
    return expires_at


def _build_refresh_session_response(
    row: RefreshSession,
    *,
    now: datetime,
    current_jti: str | None,
) -> RefreshSessionResponse | None:
    expires_at = _active_refresh_session_expiry(row, now=now)
    if expires_at is None:
        return None
    return RefreshSessionResponse(
        id=row.id,
        created_at=_ensure_utc_datetime(row.created_at),
        expires_at=expires_at,
        persistent=bool(getattr(row, "persistent", True)),
        is_current=bool(current_jti and row.jti == current_jti),
        user_agent=getattr(row, "user_agent", None),
        ip_address=getattr(row, "ip_address", None),
        country_code=getattr(row, "country_code", None),
    )


def _build_cooldown_info(
    *,
    last: datetime | None,
    cooldown: timedelta,
    enforce: bool,
    now: datetime,
) -> "CooldownInfo":
    last_dt = _ensure_utc_datetime(last)
    if not last_dt or not enforce:
        return CooldownInfo(last_changed_at=last_dt, next_allowed_at=None, remaining_seconds=0)
    next_dt = last_dt + cooldown
    remaining = int(max(0, (next_dt - now).total_seconds()))
    return CooldownInfo(
        last_changed_at=last_dt,
        next_allowed_at=next_dt if remaining > 0 else None,
        remaining_seconds=remaining,
    )


async def _latest_user_history_at(session: AsyncSession, model: Any, user_id: UUID) -> datetime | None:
    return await session.scalar(
        select(model.created_at).where(model.user_id == user_id).order_by(model.created_at.desc()).limit(1)
    )


def _request_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def _request_user_agent(request: Request) -> str | None:
    return request.headers.get("user-agent")


def _require_registration_consents(accept_terms: bool, accept_privacy: bool) -> None:
    if not accept_terms or not accept_privacy:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Legal consents required")


def _record_registration_consents(
    session: AsyncSession,
    *,
    user_id: UUID,
    consent_versions: dict[str, int],
) -> None:
    accepted_at = datetime.now(timezone.utc)
    for key, version in consent_versions.items():
        session.add(
            LegalConsent(
                doc_key=key,
                doc_version=version,
                context=LegalConsentContext.register,
                user_id=user_id,
                accepted_at=accepted_at,
            )
        )


def _queue_registration_emails(background_tasks: BackgroundTasks, user: User, verification_token: str) -> None:
    background_tasks.add_task(
        email_service.send_verification_email,
        user.email,
        verification_token,
        user.preferred_language,
    )
    background_tasks.add_task(
        email_service.send_welcome_email,
        user.email,
        first_name=user.first_name,
        lang=user.preferred_language,
    )


async def _queue_registration_with_verification(
    background_tasks: BackgroundTasks,
    session: AsyncSession,
    user: User,
) -> None:
    record = await auth_service.create_email_verification(session, user)
    _queue_registration_emails(background_tasks, user, verification_token=record.token)


def _validated_passkey_registration_token_payload(registration_token: str) -> dict[str, Any]:
    token_payload = security.decode_token(registration_token)
    if not token_payload:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid passkey token")
    if token_payload.get("type") != "webauthn":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid passkey token")
    if token_payload.get("purpose") != "register":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid passkey token")
    return token_payload


def _challenge_from_passkey_registration_token_payload(token_payload: dict[str, Any], *, expected_user_id: UUID) -> bytes:
    token_user_id = str(token_payload.get("uid") or "").strip()
    if token_user_id != str(expected_user_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid passkey token")
    challenge_b64 = str(token_payload.get("challenge") or "").strip()
    if not challenge_b64:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid passkey token")
    try:
        return base64url_to_bytes(challenge_b64)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid passkey token") from exc


def _decode_passkey_registration_challenge(registration_token: str, *, expected_user_id: UUID) -> bytes:
    token_payload = _validated_passkey_registration_token_payload(registration_token)
    return _challenge_from_passkey_registration_token_payload(token_payload, expected_user_id=expected_user_id)


async def _latest_export_job_for_user(session: AsyncSession, user_id: UUID) -> UserDataExportJob | None:
    return (
        (
            await session.execute(
                select(UserDataExportJob).where(UserDataExportJob.user_id == user_id).order_by(UserDataExportJob.created_at.desc()).limit(1)
            )
        )
        .scalars()
        .first()
    )


def _schedule_export_job(background_tasks: BackgroundTasks, session: AsyncSession, *, job_id: UUID) -> None:
    engine = session.bind
    if engine is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Database engine unavailable")
    background_tasks.add_task(user_export_service.run_user_export_job, engine, job_id=job_id)


def _is_reusable_succeeded_export_job(job: UserDataExportJob | None) -> bool:
    if not job or job.status != UserDataExportStatus.succeeded:
        return False
    expires_at = _ensure_utc_datetime(job.expires_at)
    return not expires_at or expires_at > datetime.now(timezone.utc)


async def _create_pending_export_job(session: AsyncSession, user_id: UUID) -> UserDataExportJob:
    job = UserDataExportJob(user_id=user_id, status=UserDataExportStatus.pending, progress=0)
    session.add(job)
    await session.commit()
    await session.refresh(job)
    return job


def _resolve_downloadable_export_path(job: UserDataExportJob | None, *, user_id: UUID) -> Path:
    if not job or job.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Export job not found")
    if job.status != UserDataExportStatus.succeeded or not job.file_path:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Export is not ready")
    expires_at = _ensure_utc_datetime(job.expires_at)
    if expires_at and expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Export job not found")
    path = private_storage.resolve_private_path(job.file_path)
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Export file not found")
    return path


def _export_download_filename(job: UserDataExportJob) -> str:
    stamp = (job.finished_at or job.created_at or datetime.now(timezone.utc)).date().isoformat()
    return f"moment-studio-export-{stamp}.json"


async def _complete_google_registration_user(
    session: AsyncSession,
    current_user: User,
    payload: "GoogleCompleteRequest",
) -> User:
    return await auth_service.complete_google_registration(
        session,
        current_user,
        username=payload.username,
        display_name=payload.name,
        first_name=payload.first_name,
        middle_name=payload.middle_name,
        last_name=payload.last_name,
        date_of_birth=payload.date_of_birth,
        phone=payload.phone,
        password=payload.password,
        preferred_language=payload.preferred_language,
    )


async def _queue_google_completion_emails(background_tasks: BackgroundTasks, session: AsyncSession, user: User) -> None:
    background_tasks.add_task(
        email_service.send_welcome_email,
        user.email,
        first_name=user.first_name,
        lang=user.preferred_language,
    )
    if user.email_verified:
        return
    record = await auth_service.create_email_verification(session, user)
    background_tasks.add_task(email_service.send_verification_email, user.email, record.token, user.preferred_language)


def _extract_valid_google_profile(profile: dict[str, Any]) -> tuple[Any, str, Any, Any, bool]:
    sub = profile.get("sub")
    email = str(profile.get("email") or "").strip().lower()
    name = profile.get("name")
    picture = profile.get("picture")
    email_verified = bool(profile.get("email_verified"))
    if not sub or not email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Google profile")
    domain = email.split("@")[-1]
    if settings.google_allowed_domains and domain not in settings.google_allowed_domains:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Email domain not allowed")
    return sub, email, name, picture, email_verified


def _apply_google_link(
    user: User,
    *,
    sub: Any,
    email: str,
    picture: Any,
    name: Any,
    email_verified: bool,
) -> None:
    user.google_sub = sub
    user.google_email = email
    user.google_picture_url = picture
    user.email_verified = email_verified or user.email_verified
    if not user.name:
        user.name = name


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6, max_length=128)


class PreferredLanguageUpdate(BaseModel):
    preferred_language: str = Field(pattern="^(en|ro)$", description="Language code, e.g., en or ro")


class GoogleCallback(BaseModel):
    code: str
    state: str


class NotificationPreferencesUpdate(BaseModel):
    notify_blog_comments: bool | None = None
    notify_blog_comment_replies: bool | None = None
    notify_marketing: bool | None = None


class ProfileUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=32)
    first_name: str | None = Field(default=None, max_length=100)
    middle_name: str | None = Field(default=None, max_length=100)
    last_name: str | None = Field(default=None, max_length=100)
    date_of_birth: date | None = None
    preferred_language: str | None = Field(default=None, pattern="^(en|ro)$")

    @field_validator("phone")
    @classmethod
    def _normalize_phone(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            return None
        if not re.fullmatch(r"^\+[1-9]\d{1,14}$", value):
            raise ValueError("Phone must be in E.164 format (e.g. +40723204204)")
        return value

    @field_validator("name")
    @classmethod
    def _normalize_display_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip()

    @field_validator("first_name", "middle_name", "last_name")
    @classmethod
    def _normalize_name_parts(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None

    @field_validator("date_of_birth")
    @classmethod
    def _validate_dob(cls, value: date | None) -> date | None:
        if value is None:
            return None
        if value > date.today():
            raise ValueError("Date of birth cannot be in the future")
        return value


class AccountDeletionRequest(BaseModel):
    confirm: str = Field(..., min_length=1, max_length=20, description='Type "DELETE" to confirm account deletion')
    password: str = Field(min_length=1, max_length=128, description="Confirm password")


class ConfirmPasswordRequest(BaseModel):
    password: str = Field(min_length=1, max_length=128)


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=30, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{2,29}$")
    email: EmailStr
    name: str = Field(min_length=1, max_length=255, description="Display name shown publicly")
    first_name: str = Field(min_length=1, max_length=100)
    middle_name: str | None = Field(default=None, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    date_of_birth: date
    phone: str = Field(min_length=7, max_length=32, description="E.164 format")
    password: str = Field(min_length=6, max_length=128)
    preferred_language: str | None = Field(default=None, pattern="^(en|ro)$")
    captcha_token: str | None = Field(default=None, description="CAPTCHA token (required when CAPTCHA is enabled)")
    accept_terms: bool = Field(default=False, description="Accept Terms & Conditions")
    accept_privacy: bool = Field(default=False, description="Accept Privacy Policy")

    @field_validator("name", "first_name", "last_name", "username", mode="before")
    @classmethod
    def _strip_required_strings(cls, value: str) -> str:
        value = (value or "").strip()
        if not value:
            raise ValueError("Field cannot be empty")
        return value

    @field_validator("middle_name", mode="before")
    @classmethod
    def _strip_optional_string(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None

    @field_validator("phone", mode="before")
    @classmethod
    def _strip_phone(cls, value: str) -> str:
        value = (value or "").strip()
        if not value:
            raise ValueError("Phone is required")
        if not re.fullmatch(r"^\+[1-9]\d{1,14}$", value):
            raise ValueError("Phone must be in E.164 format (e.g. +40723204204)")
        return value

    @field_validator("date_of_birth")
    @classmethod
    def _validate_date_of_birth(cls, value: date) -> date:
        if value > date.today():
            raise ValueError("Date of birth cannot be in the future")
        return value


class LoginRequest(BaseModel):
    identifier: str | None = None
    email: str | None = None
    password: str = Field(min_length=1, max_length=128)
    captcha_token: str | None = None
    remember: bool = False


class TwoFactorLoginRequest(BaseModel):
    two_factor_token: str = Field(min_length=1)
    code: str = Field(min_length=1, max_length=32)


class TwoFactorSetupRequest(BaseModel):
    password: str = Field(min_length=1, max_length=128)


class TwoFactorEnableRequest(BaseModel):
    code: str = Field(min_length=1, max_length=32)


class TwoFactorDisableRequest(BaseModel):
    password: str = Field(min_length=1, max_length=128)
    code: str = Field(min_length=1, max_length=32)


class PasskeyLoginOptionsRequest(BaseModel):
    identifier: str | None = None
    remember: bool = False


class PasskeyLoginVerifyRequest(BaseModel):
    authentication_token: str = Field(min_length=1)
    credential: dict


class PasskeyRegistrationOptionsRequest(BaseModel):
    password: str = Field(min_length=1, max_length=128)


class PasskeyRegistrationVerifyRequest(BaseModel):
    registration_token: str = Field(min_length=1)
    credential: dict
    name: str | None = Field(default=None, max_length=120)


class UsernameUpdateRequest(BaseModel):
    username: str = Field(min_length=3, max_length=30, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{2,29}$")
    password: str = Field(min_length=1, max_length=128)


class EmailUpdateRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class UsernameHistoryItem(BaseModel):
    username: str
    created_at: datetime


class DisplayNameHistoryItem(BaseModel):
    name: str
    name_tag: int
    created_at: datetime


class UserAliasesResponse(BaseModel):
    usernames: list[UsernameHistoryItem]
    display_names: list[DisplayNameHistoryItem]


class CooldownInfo(BaseModel):
    last_changed_at: datetime | None = None
    next_allowed_at: datetime | None = None
    remaining_seconds: int = 0


class UserCooldownsResponse(BaseModel):
    username: CooldownInfo
    display_name: CooldownInfo
    email: CooldownInfo


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(
    payload: RegisterRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[None, Depends(register_rate_limit)],
    response: Response = None,
) -> AuthResponse:
    user_agent = _request_user_agent(request)
    ip_address = _request_ip(request)
    await captcha_service.verify(payload.captcha_token, remote_ip=ip_address)
    _require_registration_consents(payload.accept_terms, payload.accept_privacy)
    consent_versions = await _require_published_consent_docs(session, _REQUIRED_REGISTRATION_CONSENT_KEYS)
    user = await auth_service.create_user(
        session,
        UserCreate(
            username=payload.username,
            email=payload.email,
            password=payload.password,
            name=payload.name,
            first_name=payload.first_name,
            middle_name=payload.middle_name,
            last_name=payload.last_name,
            date_of_birth=payload.date_of_birth,
            phone=payload.phone,
            preferred_language=payload.preferred_language,
        ),
    )
    _record_registration_consents(session, user_id=user.id, consent_versions=consent_versions)
    await session.commit()
    metrics.record_signup()
    await _queue_registration_with_verification(background_tasks, session, user)
    tokens = await auth_service.issue_tokens_for_user(
        session,
        user,
        persistent=False,
        user_agent=user_agent,
        ip_address=ip_address,
        country_code=_extract_country_code(request),
    )
    if response:
        set_refresh_cookie(response, tokens["refresh_token"], persistent=False)
    await auth_service.record_security_event(
        session,
        user.id,
        "login_password",
        user_agent=user_agent,
        ip_address=ip_address,
    )
    return AuthResponse(user=UserResponse.model_validate(user), tokens=TokenPair(**tokens))


@router.post(
    "/login",

    summary="Login with email or username",
    description=(
        "Accepts an `identifier` field (email or username). For backward compatibility, an `email` field is also "
        "accepted; if both are provided, `identifier` takes precedence."
    ),
)
async def login(
    payload: LoginRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[None, Depends(login_rate_limit)],
    response: Response = None,
) -> AuthResponse | TwoFactorChallengeResponse:
    await captcha_service.verify(payload.captcha_token, remote_ip=request.client.host if request.client else None)
    identifier = (payload.identifier or payload.email or "").strip()
    if not identifier:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Identifier is required")
    try:
        user = await auth_service.authenticate_user(session, identifier, payload.password)
    except HTTPException:
        metrics.record_login_failure()
        raise
    metrics.record_login_success()
    persistent = bool(payload.remember)
    if bool(getattr(user, "two_factor_enabled", False)):
        token = security.create_two_factor_token(str(user.id), remember=persistent, method="password")
        return TwoFactorChallengeResponse(user=UserResponse.model_validate(user), two_factor_token=token)

    is_admin_login = user.role in (UserRole.admin, UserRole.owner)
    known_device = True
    if is_admin_login:
        known_device = await auth_service.has_seen_refresh_device(
            session,
            user_id=user.id,
            user_agent=request.headers.get("user-agent"),
        )

    tokens = await auth_service.issue_tokens_for_user(
        session,
        user,
        persistent=persistent,
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
        country_code=_extract_country_code(request),
    )
    if response:
        set_refresh_cookie(response, tokens["refresh_token"], persistent=persistent)
    await auth_service.record_security_event(
        session,
        user.id,
        "login_password",
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
    )
    if is_admin_login and not known_device:
        owner = await auth_service.get_owner_user(session)
        to_email = (owner.email if owner and owner.email else None) or settings.admin_alert_email
        if to_email:
            background_tasks.add_task(
                email_service.send_admin_login_alert,
                to_email,
                admin_username=user.username,
                admin_display_name=user.name,
                admin_role=str(user.role),
                ip_address=request.client.host if request.client else None,
                country_code=_extract_country_code(request),
                user_agent=request.headers.get("user-agent"),
                occurred_at=datetime.now(timezone.utc),
                lang=owner.preferred_language if owner else None,
            )
    return AuthResponse(user=UserResponse.model_validate(user), tokens=TokenPair(**tokens))


@router.post("/login/2fa", summary="Complete login with two-factor code")
async def login_two_factor(
    payload: TwoFactorLoginRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[None, Depends(two_factor_rate_limit)],
    response: Response = None,
) -> AuthResponse:
    token_payload = security.decode_token(payload.two_factor_token)
    if not token_payload or token_payload.get("type") != "two_factor":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid two-factor token")

    sub = token_payload.get("sub")
    try:
        user_id = UUID(str(sub))
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid two-factor token")
    remember = bool(token_payload.get("remember"))
    method = str(token_payload.get("method") or "password").strip() or "password"

    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid two-factor token")
    if getattr(user, "deleted_at", None) is not None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account deleted")
    if getattr(user, "deletion_scheduled_for", None) and self_service.is_deletion_due(user):
        await self_service.execute_account_deletion(session, user)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account deleted")

    if not bool(getattr(user, "two_factor_enabled", False)):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Two-factor is not enabled")
    if not await auth_service.verify_two_factor_code(session, user, payload.code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid two-factor code")

    is_admin_login = user.role in (UserRole.admin, UserRole.owner)
    known_device = True
    if is_admin_login:
        known_device = await auth_service.has_seen_refresh_device(
            session,
            user_id=user.id,
            user_agent=request.headers.get("user-agent"),
        )

    tokens = await auth_service.issue_tokens_for_user(
        session,
        user,
        persistent=remember,
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
        country_code=_extract_country_code(request),
    )
    if response:
        set_refresh_cookie(response, tokens["refresh_token"], persistent=remember)

    event_type = "login_google" if method == "google" else "login_password"
    await auth_service.record_security_event(
        session,
        user.id,
        event_type,
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
    )
    if is_admin_login and not known_device:
        owner = await auth_service.get_owner_user(session)
        to_email = (owner.email if owner and owner.email else None) or settings.admin_alert_email
        if to_email:
            background_tasks.add_task(
                email_service.send_admin_login_alert,
                to_email,
                admin_username=user.username,
                admin_display_name=user.name,
                admin_role=str(user.role),
                ip_address=request.client.host if request.client else None,
                country_code=_extract_country_code(request),
                user_agent=request.headers.get("user-agent"),
                occurred_at=datetime.now(timezone.utc),
                lang=owner.preferred_language if owner else None,
            )

    return AuthResponse(user=UserResponse.model_validate(user), tokens=TokenPair(**tokens))


@router.post(
    "/passkeys/login/options",

    summary="Get WebAuthn options for passkey login",
)
async def passkey_login_options(
    payload: PasskeyLoginOptionsRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[None, Depends(login_rate_limit)],
) -> PasskeyAuthenticationOptionsResponse:
    identifier = (payload.identifier or "").strip()
    user: User | None = None
    if identifier:
        if "@" in identifier:
            user = await auth_service.get_user_by_login_email(session, identifier)
        else:
            user = await auth_service.get_user_by_username(session, identifier)

    options, _ = await passkeys_service.generate_authentication_options_for_user(session, user)
    challenge = str(options.get("challenge") or "").strip()
    if not challenge:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to generate passkey challenge")

    token = security.create_webauthn_token(
        purpose="login",
        challenge=challenge,
        user_id=str(user.id) if user else None,
        remember=bool(payload.remember),
    )
    return PasskeyAuthenticationOptionsResponse(authentication_token=token, options=options)


@router.post(
    "/passkeys/login/verify",

    summary="Verify a passkey assertion and start a session",
)
async def passkey_login_verify(
    payload: PasskeyLoginVerifyRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[None, Depends(login_rate_limit)],
    response: Response = None,
) -> AuthResponse:
    token_payload = security.decode_token(payload.authentication_token)
    if not token_payload or token_payload.get("type") != "webauthn" or token_payload.get("purpose") != "login":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid passkey token")
    challenge_b64 = str(token_payload.get("challenge") or "").strip()
    if not challenge_b64:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid passkey token")
    try:
        expected_challenge = base64url_to_bytes(challenge_b64)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid passkey token") from exc

    remember = bool(token_payload.get("remember"))
    token_user_id = str(token_payload.get("uid") or "").strip() or None

    user, _passkey = await passkeys_service.verify_passkey_authentication(
        session,
        credential=payload.credential,
        expected_challenge=expected_challenge,
        user_id=token_user_id,
    )

    if getattr(user, "google_sub", None) and not auth_service.is_profile_complete(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Complete your Google sign-in registration before using passkey login.",
        )
    if getattr(user, "deleted_at", None) is not None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account deleted")
    if getattr(user, "deletion_scheduled_for", None) and self_service.is_deletion_due(user):
        await self_service.execute_account_deletion(session, user)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account deleted")

    metrics.record_login_success()
    is_admin_login = user.role in (UserRole.admin, UserRole.owner)
    known_device = True
    if is_admin_login:
        known_device = await auth_service.has_seen_refresh_device(
            session,
            user_id=user.id,
            user_agent=request.headers.get("user-agent"),
        )
    tokens = await auth_service.issue_tokens_for_user(
        session,
        user,
        persistent=remember,
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
        country_code=_extract_country_code(request),
    )
    if response:
        set_refresh_cookie(response, tokens["refresh_token"], persistent=remember)

    await auth_service.record_security_event(
        session,
        user.id,
        "login_passkey",
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
    )
    if is_admin_login and not known_device:
        owner = await auth_service.get_owner_user(session)
        to_email = (owner.email if owner and owner.email else None) or settings.admin_alert_email
        if to_email:
            background_tasks.add_task(
                email_service.send_admin_login_alert,
                to_email,
                admin_username=user.username,
                admin_display_name=user.name,
                admin_role=str(user.role),
                ip_address=request.client.host if request.client else None,
                country_code=_extract_country_code(request),
                user_agent=request.headers.get("user-agent"),
                occurred_at=datetime.now(timezone.utc),
                lang=owner.preferred_language if owner else None,
            )
    return AuthResponse(user=UserResponse.model_validate(user), tokens=TokenPair(**tokens))


@router.get("/me/passkeys", summary="List my passkeys")
async def list_my_passkeys(
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[PasskeyResponse]:
    passkeys = await passkeys_service.list_passkeys(session, current_user.id)
    return [PasskeyResponse.model_validate(p) for p in passkeys]


@router.post(
    "/me/passkeys/register/options",

    summary="Start passkey registration (generates WebAuthn options)",
)
async def passkey_register_options(
    payload: PasskeyRegistrationOptionsRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> PasskeyRegistrationOptionsResponse:
    if not security.verify_password(payload.password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid password")

    options, _ = await passkeys_service.generate_registration_options_for_user(session, current_user)
    challenge = str(options.get("challenge") or "").strip()
    if not challenge:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to generate passkey challenge")

    token = security.create_webauthn_token(
        purpose="register",
        challenge=challenge,
        user_id=str(current_user.id),
    )
    return PasskeyRegistrationOptionsResponse(registration_token=token, options=options)


@router.post(
    "/me/passkeys/register/verify",

    summary="Finalize passkey registration",
)
async def passkey_register_verify(
    payload: PasskeyRegistrationVerifyRequest,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> PasskeyResponse:
    expected_challenge = _decode_passkey_registration_challenge(
        payload.registration_token,
        expected_user_id=current_user.id,
    )
    passkey = await passkeys_service.register_passkey(
        session,
        user=current_user,
        credential=payload.credential,
        expected_challenge=expected_challenge,
        name=payload.name,
    )
    await auth_service.record_security_event(
        session,
        current_user.id,
        "passkey_added",
        user_agent=_request_user_agent(request),
        ip_address=_request_ip(request),
    )
    return PasskeyResponse.model_validate(passkey)


@router.delete("/me/passkeys/{passkey_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Remove a passkey")
async def passkey_delete(
    passkey_id: UUID,
    payload: ConfirmPasswordRequest,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    if not security.verify_password(payload.password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid password")
    removed = await passkeys_service.delete_passkey(session, user_id=current_user.id, passkey_id=passkey_id)
    if not removed:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Passkey not found")
    await auth_service.record_security_event(
        session,
        current_user.id,
        "passkey_removed",
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
    )
    return None


@router.post("/refresh", response_model=TokenPair)
async def refresh_tokens(
    refresh_request: RefreshRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[None, Depends(refresh_rate_limit)],
    response: Response = None,
) -> TokenPair | Response:
    silent_header = str(request.headers.get("X-Silent") or "").strip().lower()
    silent_refresh_probe = silent_header in {"1", "true", "yes", "on"}

    def _silent_no_content() -> Response:
        if response:
            clear_refresh_cookie(response)
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    refresh_token = (refresh_request.refresh_token or "").strip()
    if not refresh_token:
        refresh_token = (request.cookies.get("refresh_token") or "").strip()
    if not refresh_token:
        if silent_refresh_probe:
            return _silent_no_content()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token missing")

    payload = security.decode_token(refresh_token)
    if not payload or payload.get("type") != "refresh":
        if silent_refresh_probe:
            return _silent_no_content()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
    jti = str(payload.get("jti") or "").strip()
    sub = payload.get("sub")
    if not jti or not sub:
        if silent_refresh_probe:
            return _silent_no_content()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
    try:
        token_user_id = UUID(str(sub))
    except Exception:
        if silent_refresh_probe:
            return _silent_no_content()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    # Lock the refresh session row during rotation to make concurrent refreshes multi-tab safe.
    stored = (
        await session.execute(select(RefreshSession).where(RefreshSession.jti == jti).with_for_update())
    ).scalar_one_or_none()
    now = datetime.now(timezone.utc)
    stored_expires_at = stored.expires_at if stored else None
    if stored_expires_at and stored_expires_at.tzinfo is None:
        stored_expires_at = stored_expires_at.replace(tzinfo=timezone.utc)
    if not stored or stored.user_id != token_user_id or not stored_expires_at or stored_expires_at < now:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    user = await session.get(User, stored.user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if getattr(user, "deleted_at", None) is not None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account deleted")
    if getattr(user, "deletion_scheduled_for", None) and self_service.is_deletion_due(user):
        await self_service.execute_account_deletion(session, user)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account deleted")
    locked_until = getattr(user, "locked_until", None)
    if locked_until and locked_until.tzinfo is None:
        locked_until = locked_until.replace(tzinfo=timezone.utc)
    if locked_until and locked_until > now:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account temporarily locked")
    if bool(getattr(user, "password_reset_required", False)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Password reset required")

    # If the token was already rotated very recently (multi-tab refresh), allow
    # reusing it by issuing tokens for the replacement session without rotating again.
    if stored.revoked:
        grace_seconds = max(0, int(settings.refresh_token_rotation_grace_seconds or 0))
        rotated_at = getattr(stored, "rotated_at", None)
        replaced_by = (getattr(stored, "replaced_by_jti", None) or "").strip()
        if stored.revoked_reason == "rotated" and grace_seconds > 0 and rotated_at and replaced_by:
            rotated_at_norm = rotated_at
            if rotated_at_norm.tzinfo is None:
                rotated_at_norm = rotated_at_norm.replace(tzinfo=timezone.utc)
            if rotated_at_norm + timedelta(seconds=grace_seconds) >= now:
                replacement = (
                    await session.execute(select(RefreshSession).where(RefreshSession.jti == replaced_by))
                ).scalar_one_or_none()
                replacement_expires_at = replacement.expires_at if replacement else None
                if replacement_expires_at and replacement_expires_at.tzinfo is None:
                    replacement_expires_at = replacement_expires_at.replace(tzinfo=timezone.utc)
                if (
                    replacement
                    and replacement.user_id == stored.user_id
                    and not replacement.revoked
                    and replacement_expires_at
                    and replacement_expires_at >= now
                ):
                    persistent = bool(getattr(replacement, "persistent", True))
                    access = security.create_access_token(str(user.id), replacement.jti)
                    refresh = security.create_refresh_token(str(user.id), replacement.jti, replacement_expires_at)
                    if response:
                        set_refresh_cookie(response, refresh, persistent=persistent)
                    return TokenPair(access_token=access, refresh_token=refresh)

        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    persistent = bool(getattr(stored, "persistent", True))
    if not settings.refresh_token_rotation:
        access = security.create_access_token(str(user.id), stored.jti)
        refresh = security.create_refresh_token(str(user.id), stored.jti, stored_expires_at)
        if response:
            set_refresh_cookie(response, refresh, persistent=persistent)
        return TokenPair(access_token=access, refresh_token=refresh)

    # Rotate the token by revoking the current refresh session and issuing a replacement.
    replacement_session = await auth_service.create_refresh_session(
        session,
        user.id,
        persistent=persistent,
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
        country_code=_extract_country_code(request),
    )
    stored.revoked = True
    stored.revoked_reason = "rotated"
    stored.rotated_at = now
    stored.replaced_by_jti = replacement_session.jti
    session.add(stored)
    await session.flush()
    access = security.create_access_token(str(user.id), replacement_session.jti)
    refresh = security.create_refresh_token(str(user.id), replacement_session.jti, replacement_session.expires_at)
    await session.commit()
    if response:
        set_refresh_cookie(response, refresh, persistent=persistent)
    return TokenPair(access_token=access, refresh_token=refresh)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    payload: RefreshRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    response: Response = None,
) -> None:
    refresh_token = (payload.refresh_token or "").strip()
    if not refresh_token:
        refresh_token = (request.cookies.get("refresh_token") or "").strip()
    payload_data = decode_token(refresh_token) if refresh_token else None
    if payload_data and payload_data.get("jti"):
        await auth_service.revoke_refresh_token(session, payload_data["jti"], reason="logout")
    if response:
        clear_refresh_cookie(response)
        clear_admin_ip_bypass_cookie(response)
    return None


class AdminIpBypassRequest(BaseModel):
    token: str = Field(min_length=1, max_length=256)


@router.post("/admin/ip-bypass", status_code=status.HTTP_204_NO_CONTENT, summary="Bypass admin IP allowlist for this device")
async def admin_ip_bypass(
    payload: AdminIpBypassRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    current_user: Annotated[User, Depends(require_admin)],
    response: Response = None,
) -> None:
    secret = (settings.admin_ip_bypass_token or "").strip()
    if not secret:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Admin IP bypass is not configured")
    if (payload.token or "").strip() != secret:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid bypass token")
    token = security.create_admin_ip_bypass_token(str(current_user.id))
    if response:
        set_admin_ip_bypass_cookie(response, token)
    await auth_service.record_security_event(
        session,
        current_user.id,
        "admin_ip_bypass_used",
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
    )
    return None


@router.delete("/admin/ip-bypass", status_code=status.HTTP_204_NO_CONTENT, summary="Clear admin IP bypass for this device")
async def clear_admin_ip_bypass(response: Response = None) -> None:
    if response:
        clear_admin_ip_bypass_cookie(response)
    return None


@router.get("/admin/access", status_code=status.HTTP_200_OK, summary="Check whether this session can access the admin UI")
async def admin_access(_: Annotated[User, Depends(require_admin_section("dashboard"))]) -> dict:
    return {"allowed": True}


@router.post("/step-up", status_code=status.HTTP_200_OK)
async def step_up(
    payload: StepUpRequest,
    request: Request,
    _: Annotated[None, Depends(step_up_rate_limit)],
    session: Annotated[AsyncSession, Depends(get_session)],
    current_user: Annotated[User, Depends(require_admin_section("dashboard"))],
) -> StepUpResponse:
    hashed_password = (getattr(current_user, "hashed_password", None) or "").strip()
    if not hashed_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password authentication is not available for this account")

    if not security.verify_password(payload.password, hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid password")

    expires_minutes = 15
    token = security.create_step_up_token(str(current_user.id), expires_minutes=expires_minutes)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=expires_minutes)

    await auth_service.record_security_event(
        session,
        current_user.id,
        "step_up",
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
    )
    return StepUpResponse(step_up_token=token, expires_at=expires_at)


@router.post("/password/change", status_code=status.HTTP_200_OK)
async def change_password(
    payload: ChangePasswordRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    session: Annotated[AsyncSession, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict:
    if not security.verify_password(payload.current_password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
    current_user.hashed_password = security.hash_password(payload.new_password)
    current_user.password_reset_required = False
    session.add(current_user)
    await session.commit()
    background_tasks.add_task(email_service.send_password_changed, current_user.email, lang=current_user.preferred_language)
    await auth_service.record_security_event(
        session,
        current_user.id,
        "password_changed",
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
    )
    return {"detail": "Password updated"}


@router.post("/verify/request", status_code=status.HTTP_202_ACCEPTED)
async def request_email_verification(
    background_tasks: BackgroundTasks,
    next: str | None = None,
    _: None = Depends(verify_request_rate_limit),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    record = await auth_service.create_email_verification(session, current_user)
    background_tasks.add_task(
        email_service.send_verification_email,
        current_user.email,
        record.token,
        current_user.preferred_language,
        next_path=next,
    )
    return {"detail": "Verification email sent"}


@router.post("/verify/confirm", status_code=status.HTTP_200_OK)
async def confirm_email_verification(
    payload: EmailVerificationConfirm,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    user = await auth_service.confirm_email_verification(session, payload.token)
    return {"detail": "Email verified", "email_verified": user.email_verified}


@router.get("/me")
async def read_me(current_user: Annotated[User, Depends(get_current_user)]) -> UserResponse:
    return UserResponse.model_validate(current_user)


@router.get("/me/2fa", summary="Get my two-factor status")
async def two_factor_status(current_user: Annotated[User, Depends(get_current_user)]) -> TwoFactorStatusResponse:
    confirmed_at = getattr(current_user, "two_factor_confirmed_at", None)
    if confirmed_at and confirmed_at.tzinfo is None:
        confirmed_at = confirmed_at.replace(tzinfo=timezone.utc)
    codes = list(getattr(current_user, "two_factor_recovery_codes", None) or [])
    return TwoFactorStatusResponse(
        enabled=bool(getattr(current_user, "two_factor_enabled", False)),
        confirmed_at=confirmed_at,
        recovery_codes_remaining=len(codes),
    )


@router.post("/me/2fa/setup", summary="Start two-factor setup")
async def two_factor_setup(
    payload: TwoFactorSetupRequest,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TwoFactorSetupResponse:
    if not security.verify_password(payload.password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid password")
    secret, otpauth_url = await auth_service.start_two_factor_setup(session, current_user)
    await auth_service.record_security_event(
        session,
        current_user.id,
        "two_factor_setup_started",
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
    )
    return TwoFactorSetupResponse(secret=secret, otpauth_url=otpauth_url)


@router.post("/me/2fa/enable", summary="Enable two-factor authentication")
async def two_factor_enable(
    payload: TwoFactorEnableRequest,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TwoFactorEnableResponse:
    codes = await auth_service.enable_two_factor(session, current_user, payload.code)
    await auth_service.record_security_event(
        session,
        current_user.id,
        "two_factor_enabled",
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
    )
    return TwoFactorEnableResponse(recovery_codes=codes)


@router.post("/me/2fa/disable", summary="Disable two-factor authentication")
async def two_factor_disable(
    payload: TwoFactorDisableRequest,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TwoFactorStatusResponse:
    if not security.verify_password(payload.password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid password")
    if not bool(getattr(current_user, "two_factor_enabled", False)):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Two-factor is not enabled")
    if not await auth_service.verify_two_factor_code(session, current_user, payload.code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid two-factor code")
    await auth_service.disable_two_factor(session, current_user)
    await auth_service.record_security_event(
        session,
        current_user.id,
        "two_factor_disabled",
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
    )
    return TwoFactorStatusResponse(enabled=False, confirmed_at=None, recovery_codes_remaining=0)


@router.post(
    "/me/2fa/recovery-codes/regenerate",

    summary="Regenerate two-factor recovery codes",
)
async def two_factor_regenerate_codes(
    payload: TwoFactorDisableRequest,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TwoFactorEnableResponse:
    if not security.verify_password(payload.password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid password")
    if not bool(getattr(current_user, "two_factor_enabled", False)):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Two-factor is not enabled")
    if not await auth_service.verify_two_factor_code(session, current_user, payload.code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid two-factor code")
    codes = await auth_service.regenerate_recovery_codes(session, current_user)
    await auth_service.record_security_event(
        session,
        current_user.id,
        "two_factor_recovery_regenerated",
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
    )
    return TwoFactorEnableResponse(recovery_codes=codes)


@router.get(
    "/me/aliases",

    summary="Get my username and display name history",
    description="Returns the full history of your username changes and display-name tags (name#N).",
)
async def read_aliases(
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> UserAliasesResponse:
    usernames = await auth_service.list_username_history(session, current_user.id)
    display_names = await auth_service.list_display_name_history(session, current_user.id)
    return UserAliasesResponse(
        usernames=[UsernameHistoryItem(username=row.username, created_at=row.created_at) for row in usernames],
        display_names=[
            DisplayNameHistoryItem(name=row.name, name_tag=row.name_tag, created_at=row.created_at) for row in display_names
        ],
    )


@router.get(
    "/me/cooldowns",

    summary="Get my profile/email change cooldowns",
)
async def read_cooldowns(
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> UserCooldownsResponse:
    now = datetime.now(timezone.utc)
    username_last = await _latest_user_history_at(session, UserUsernameHistory, current_user.id)
    display_last = await _latest_user_history_at(session, UserDisplayNameHistory, current_user.id)

    email_count = int(
        await session.scalar(select(func.count()).select_from(UserEmailHistory).where(UserEmailHistory.user_id == current_user.id))
        or 0
    )
    email_last = await _latest_user_history_at(session, UserEmailHistory, current_user.id)

    profile_complete = auth_service.is_profile_complete(current_user)
    return UserCooldownsResponse(
        username=_build_cooldown_info(
            last=username_last,
            cooldown=auth_service.USERNAME_CHANGE_COOLDOWN,
            enforce=profile_complete,
            now=now,
        ),
        display_name=_build_cooldown_info(
            last=display_last,
            cooldown=auth_service.DISPLAY_NAME_CHANGE_COOLDOWN,
            enforce=profile_complete,
            now=now,
        ),
        email=_build_cooldown_info(
            last=email_last,
            cooldown=auth_service.EMAIL_CHANGE_COOLDOWN,
            enforce=email_count > 1,
            now=now,
        ),
    )


@router.patch(
    "/me/username",

    summary="Update my username",
    description="Updates your unique username and stores an entry in your username history.",
)
async def update_username(
    payload: UsernameUpdateRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> UserResponse:
    if not security.verify_password(payload.password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid password")
    user = await auth_service.update_username(session, current_user, payload.username)
    return UserResponse.model_validate(user)


@router.patch(
    "/me/email",

    summary="Update my email address",
    description="Updates your email (password required) and sends a new verification token. Disabled while Google is linked.",
)
async def update_email(
    payload: EmailUpdateRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> UserResponse:
    if not security.verify_password(payload.password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid password")
    old_email = current_user.email
    user = await auth_service.update_email(session, current_user, str(payload.email))
    record = await auth_service.create_email_verification(session, user)
    background_tasks.add_task(email_service.send_email_changed, old_email, old_email=old_email, new_email=user.email, lang=user.preferred_language)
    background_tasks.add_task(email_service.send_email_changed, user.email, old_email=old_email, new_email=user.email, lang=user.preferred_language)
    background_tasks.add_task(email_service.send_verification_email, user.email, record.token, user.preferred_language)
    await auth_service.record_security_event(
        session,
        user.id,
        "email_changed",
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
    )
    return UserResponse.model_validate(user)


@router.get(
    "/me/emails",

    summary="List my emails",
    description="Returns primary email and any secondary emails (verified/unverified).",
)
async def list_my_emails(
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> UserEmailsResponse:
    secondary = await auth_service.list_secondary_emails(session, current_user.id)
    return UserEmailsResponse(
        primary_email=current_user.email,
        primary_verified=bool(current_user.email_verified),
        secondary_emails=[SecondaryEmailResponse.model_validate(e) for e in secondary],
    )


@router.post(
    "/me/emails",

    status_code=status.HTTP_201_CREATED,
    summary="Add a secondary email",
)
async def add_my_secondary_email(
    payload: SecondaryEmailCreateRequest,
    background_tasks: BackgroundTasks,
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> SecondaryEmailResponse:
    secondary, token = await auth_service.add_secondary_email(session, current_user, str(payload.email))
    background_tasks.add_task(
        email_service.send_verification_email,
        secondary.email,
        token.token,
        current_user.preferred_language,
        "secondary",
        next_path="/account",
    )
    return SecondaryEmailResponse.model_validate(secondary)


@router.post(
    "/me/emails/{secondary_email_id}/verify/request",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Resend verification for a secondary email",
)
async def request_secondary_email_verification(
    secondary_email_id: UUID,
    background_tasks: BackgroundTasks,
    next: str | None = None,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    token = await auth_service.request_secondary_email_verification(session, current_user, secondary_email_id)
    secondary = await session.get(UserSecondaryEmail, secondary_email_id)
    if secondary:
        background_tasks.add_task(
            email_service.send_verification_email,
            secondary.email,
            token.token,
            current_user.preferred_language,
            "secondary",
            next_path=next or "/account",
        )
    return {"detail": "Verification email sent"}


@router.post(
    "/me/emails/verify/confirm",

    summary="Confirm secondary email verification",
)
async def confirm_secondary_email_verification(
    payload: SecondaryEmailConfirmRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> SecondaryEmailResponse:
    secondary = await auth_service.confirm_secondary_email_verification(session, payload.token)
    return SecondaryEmailResponse.model_validate(secondary)


@router.post(
    "/me/emails/{secondary_email_id}/make-primary",

    summary="Make a verified secondary email the primary email",
)
async def make_secondary_email_primary(
    secondary_email_id: UUID,
    payload: SecondaryEmailMakePrimaryRequest,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> UserResponse:
    if not security.verify_password(payload.password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid password")
    user = await auth_service.make_secondary_email_primary(session, current_user, secondary_email_id)
    await auth_service.record_security_event(
        session,
        user.id,
        "email_changed",
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
    )
    return UserResponse.model_validate(user)


@router.delete(
    "/me/emails/{secondary_email_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a secondary email",
)
async def delete_secondary_email(
    secondary_email_id: UUID,
    payload: ConfirmPasswordRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    if not security.verify_password(payload.password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid password")
    await auth_service.delete_secondary_email(session, current_user, secondary_email_id)


@router.get("/me/export")
async def export_me(
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    data = await self_service.export_user_data(session, current_user)
    filename = f"moment-studio-export-{current_user.id}.json"
    return JSONResponse(
        content=data,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/me/export/jobs", status_code=status.HTTP_201_CREATED)
async def start_export_job(
    background_tasks: BackgroundTasks,
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> UserDataExportJobResponse:
    latest = await _latest_export_job_for_user(session, current_user.id)
    if latest and latest.status in (UserDataExportStatus.pending, UserDataExportStatus.running):
        if latest.status == UserDataExportStatus.pending:
            _schedule_export_job(background_tasks, session, job_id=latest.id)
        return UserDataExportJobResponse.model_validate(latest, from_attributes=True)
    if _is_reusable_succeeded_export_job(latest):
        return UserDataExportJobResponse.model_validate(latest, from_attributes=True)
    job = await _create_pending_export_job(session, current_user.id)
    _schedule_export_job(background_tasks, session, job_id=job.id)
    return UserDataExportJobResponse.model_validate(job, from_attributes=True)


@router.get("/me/export/jobs/latest")
async def latest_export_job(
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> UserDataExportJobResponse:
    job = (
        (
            await session.execute(
                select(UserDataExportJob)
                .where(UserDataExportJob.user_id == current_user.id)
                .order_by(UserDataExportJob.created_at.desc())
                .limit(1)
            )
        )
        .scalars()
        .first()
    )
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Export job not found")
    return UserDataExportJobResponse.model_validate(job, from_attributes=True)


@router.get("/me/export/jobs/{job_id}")
async def get_export_job(
    job_id: UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> UserDataExportJobResponse:
    job = await session.get(UserDataExportJob, job_id)
    if not job or job.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Export job not found")
    return UserDataExportJobResponse.model_validate(job, from_attributes=True)


@router.get("/me/export/jobs/{job_id}/download")
async def download_export_job(
    job_id: UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> FileResponse:
    job = await session.get(UserDataExportJob, job_id)
    path = _resolve_downloadable_export_path(job, user_id=current_user.id)
    filename = _export_download_filename(job)
    return FileResponse(path, media_type="application/json", filename=filename, headers={"Cache-Control": "no-store"})


@router.get("/me/delete/status")
async def account_delete_status(current_user: Annotated[User, Depends(get_current_user)]) -> AccountDeletionStatus:
    return AccountDeletionStatus(
        requested_at=current_user.deletion_requested_at,
        scheduled_for=current_user.deletion_scheduled_for,
        deleted_at=current_user.deleted_at,
        cooldown_hours=settings.account_deletion_cooldown_hours,
    )


@router.post("/me/delete")
async def request_account_deletion(
    payload: AccountDeletionRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> AccountDeletionStatus:
    if payload.confirm.strip().upper() != "DELETE":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Type "DELETE" to confirm')
    if not security.verify_password(payload.password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid password")
    now = datetime.now(timezone.utc)
    scheduled_for = current_user.deletion_scheduled_for
    if scheduled_for and scheduled_for.tzinfo is None:
        scheduled_for = scheduled_for.replace(tzinfo=timezone.utc)
    if scheduled_for and scheduled_for > now:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Account deletion is already scheduled. Cancel it before scheduling again.",
        )
    current_user.deletion_requested_at = now
    current_user.deletion_scheduled_for = now + timedelta(hours=settings.account_deletion_cooldown_hours)
    session.add(current_user)
    await session.commit()
    await session.refresh(current_user)
    return AccountDeletionStatus(
        requested_at=current_user.deletion_requested_at,
        scheduled_for=current_user.deletion_scheduled_for,
        deleted_at=current_user.deleted_at,
        cooldown_hours=settings.account_deletion_cooldown_hours,
    )


@router.post("/me/delete/cancel")
async def cancel_account_deletion(
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> AccountDeletionStatus:
    current_user.deletion_requested_at = None
    current_user.deletion_scheduled_for = None
    session.add(current_user)
    await session.commit()
    await session.refresh(current_user)
    return AccountDeletionStatus(
        requested_at=current_user.deletion_requested_at,
        scheduled_for=current_user.deletion_scheduled_for,
        deleted_at=current_user.deleted_at,
        cooldown_hours=settings.account_deletion_cooldown_hours,
    )


@router.patch("/me/language")
async def update_language(
    payload: PreferredLanguageUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> UserResponse:
    current_user.preferred_language = payload.preferred_language
    session.add(current_user)
    await session.commit()
    await session.refresh(current_user)
    return UserResponse.model_validate(current_user)


@router.patch("/me/notifications")
async def update_notification_preferences(
    payload: NotificationPreferencesUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> UserResponse:
    if payload.notify_blog_comments is not None:
        current_user.notify_blog_comments = bool(payload.notify_blog_comments)
    if payload.notify_blog_comment_replies is not None:
        current_user.notify_blog_comment_replies = bool(payload.notify_blog_comment_replies)
    if payload.notify_marketing is not None:
        current_user.notify_marketing = bool(payload.notify_marketing)
    session.add(current_user)
    await session.commit()
    await session.refresh(current_user)
    return UserResponse.model_validate(current_user)


@router.patch("/me/training-mode")
async def update_training_mode(
    payload: TrainingModeUpdateRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> UserResponse:
    if current_user.role not in (
        UserRole.owner,
        UserRole.admin,
        UserRole.support,
        UserRole.fulfillment,
        UserRole.content,
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Staff access required")
    current_user.admin_training_mode = bool(payload.enabled)
    session.add(current_user)
    await session.commit()
    await session.refresh(current_user)
    return UserResponse.model_validate(current_user)


@router.get(
    "/me/sessions",

    summary="List my active sessions",
    description="Returns active refresh sessions for the current account so you can revoke other devices.",
)
async def list_my_sessions(
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[RefreshSessionResponse]:
    candidate_jti = _extract_refresh_session_jti(request)
    current_jti = await _resolve_active_refresh_session_jti(session, current_user.id, candidate_jti)

    rows = (
        await session.execute(
            select(RefreshSession).where(RefreshSession.user_id == current_user.id, RefreshSession.revoked.is_(False))
        )
    ).scalars().all()

    now = datetime.now(timezone.utc)
    sessions: list[RefreshSessionResponse] = []
    for row in rows:
        payload = _build_refresh_session_response(row, now=now, current_jti=current_jti)
        if payload is not None:
            sessions.append(payload)

    sessions.sort(key=lambda entry: (entry.is_current, entry.created_at), reverse=True)
    return sessions


@router.post(
    "/me/sessions/revoke-others",

    summary="Revoke other active sessions",
    description="Revokes all other active refresh sessions, keeping only the current device signed in.",
)
async def revoke_other_sessions(
    payload: ConfirmPasswordRequest,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> RefreshSessionsRevokeResponse:
    if not security.verify_password(payload.password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid password")
    candidate_jti = _extract_refresh_session_jti(request)
    current_jti = await _resolve_active_refresh_session_jti(session, current_user.id, candidate_jti)
    if not current_jti:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Could not identify current session")

    rows = (
        await session.execute(
            select(RefreshSession).where(RefreshSession.user_id == current_user.id, RefreshSession.revoked.is_(False))
        )
    ).scalars().all()

    now = datetime.now(timezone.utc)
    to_revoke: list[RefreshSession] = []
    for row in rows:
        if row.jti == current_jti:
            continue
        if _active_refresh_session_expiry(row, now=now) is None:
            continue
        row.revoked = True
        row.revoked_reason = "revoke_others"
        to_revoke.append(row)

    if to_revoke:
        session.add_all(to_revoke)
        await session.commit()

    return RefreshSessionsRevokeResponse(revoked=len(to_revoke))


@router.get(
    "/me/security-events",

    summary="List my recent security activity",
    description="Returns recent security-related events like logins and credential changes.",
)
async def list_security_events(
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
    limit: int = Query(default=30, ge=1, le=100),
) -> list[UserSecurityEventResponse]:
    rows = (
        await session.execute(
            select(UserSecurityEvent)
            .where(UserSecurityEvent.user_id == current_user.id)
            .order_by(UserSecurityEvent.created_at.desc())
            .limit(limit)
        )
    ).scalars().all()

    events: list[UserSecurityEventResponse] = []
    for row in rows:
        created_at = row.created_at
        if created_at and created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        events.append(
            UserSecurityEventResponse(
                id=row.id,
                event_type=row.event_type,
                created_at=created_at,
                user_agent=getattr(row, "user_agent", None),
                ip_address=getattr(row, "ip_address", None),
            )
        )
    return events


@router.patch("/me")
async def update_me(
    payload: ProfileUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> UserResponse:
    data = payload.model_dump(exclude_unset=True)
    if "phone" in data and payload.phone is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Phone is required")
    if "first_name" in data and payload.first_name is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="First name is required")
    if "last_name" in data and payload.last_name is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Last name is required")
    if "date_of_birth" in data and payload.date_of_birth is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Date of birth is required")
    if "name" in data and payload.name is not None:
        await auth_service.update_display_name(session, current_user, payload.name)
    if "phone" in data:
        current_user.phone = payload.phone
    if "first_name" in data:
        current_user.first_name = payload.first_name
    if "middle_name" in data:
        current_user.middle_name = payload.middle_name
    if "last_name" in data:
        current_user.last_name = payload.last_name
    if "date_of_birth" in data:
        current_user.date_of_birth = payload.date_of_birth
    if "preferred_language" in data and payload.preferred_language is not None:
        current_user.preferred_language = payload.preferred_language
    session.add(current_user)
    await session.commit()
    await session.refresh(current_user)
    return UserResponse.model_validate(current_user)


@router.post("/me/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> UserResponse:
    avatars_root = Path(settings.media_root) / "avatars"
    extension = Path(file.filename or "").suffix.lower() or ".png"
    filename = f"avatar-{current_user.id}{extension}"
    url_path, saved_name = await anyio.to_thread.run_sync(
        partial(
            storage.save_upload,
            file,
            root=avatars_root,
            filename=filename,
            allowed_content_types=("image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"),
            max_bytes=5 * 1024 * 1024,
        )
    )
    current_user.avatar_url = url_path
    session.add(current_user)
    await session.commit()
    await session.refresh(current_user)
    return UserResponse.model_validate(current_user)


@router.post("/me/avatar/use-google")
async def use_google_avatar(
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> UserResponse:
    if not current_user.google_picture_url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No Google profile picture available")
    current_user.avatar_url = current_user.google_picture_url
    session.add(current_user)
    await session.commit()
    await session.refresh(current_user)
    return UserResponse.model_validate(current_user)


@router.delete("/me/avatar")
async def remove_avatar(
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> UserResponse:
    current_user.avatar_url = None
    session.add(current_user)
    await session.commit()
    await session.refresh(current_user)
    return UserResponse.model_validate(current_user)


@router.get("/admin/ping")
async def admin_ping(admin_user: Annotated[User, Depends(require_admin)]) -> dict[str, str]:
    return {"status": "admin-ok", "user": str(admin_user.id)}


@router.post(
    "/admin/cleanup/incomplete-google",

    summary="Cleanup abandoned incomplete Google accounts",
    description="Soft-deletes Google-created accounts that never completed required profile fields after a grace period.",
)
async def admin_cleanup_incomplete_google_accounts(
    max_age_hours: int = Query(default=168, ge=1, le=24 * 365),
    _: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> dict[str, int]:
    deleted = await self_service.cleanup_incomplete_google_accounts(session, max_age_hours=max_age_hours)
    return {"deleted": deleted}


@router.post("/password-reset/request", status_code=status.HTTP_202_ACCEPTED)
async def request_password_reset(
    payload: PasswordResetRequest,
    background_tasks: BackgroundTasks,
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[None, Depends(reset_request_rate_limit)],
) -> dict[str, str]:
    email = (payload.email or "").strip().lower()
    reset = await auth_service.create_reset_token(session, email)
    if reset:
        user = await session.get(User, reset.user_id)
        background_tasks.add_task(
            email_service.send_password_reset,
            email,
            reset.token,
            getattr(user, "preferred_language", None),
        )
    return {"status": "sent"}


@router.post("/password-reset/confirm", status_code=status.HTTP_200_OK)
async def confirm_password_reset(
    payload: PasswordResetConfirm,
    request: Request,
    background_tasks: BackgroundTasks,
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[None, Depends(reset_confirm_rate_limit)],
) -> dict[str, str]:
    user = await auth_service.confirm_reset_token(session, payload.token, payload.new_password)
    background_tasks.add_task(email_service.send_password_changed, user.email, lang=user.preferred_language)
    await auth_service.record_security_event(
        session,
        user.id,
        "password_reset",
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
    )
    return {"status": "updated"}


@router.get("/google/start")
async def google_start(_: Annotated[None, Depends(google_rate_limit)]) -> dict:
    if not settings.google_client_id or not settings.google_redirect_uri:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Google OAuth not configured")
    state = _build_google_state("google_state")
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "offline",
        "prompt": "select_account",
        "state": state,
    }
    url = f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"
    return {"auth_url": url}


@router.post("/google/callback")
async def google_callback(
    payload: GoogleCallback,
    request: Request,
    background_tasks: BackgroundTasks,
    session: Annotated[AsyncSession, Depends(get_session)],
    response: Response = None,
    _: None = Depends(google_rate_limit),
) -> GoogleCallbackResponse:
    _validate_google_state(payload.state, "google_state")
    profile = await auth_service.exchange_google_code(payload.code)
    sub = profile.get("sub")
    email = str(profile.get("email") or "").strip().lower()
    name = profile.get("name")
    picture = profile.get("picture")
    email_verified = bool(profile.get("email_verified"))
    if not sub or not email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Google profile")
    domain = email.split("@")[-1]
    if settings.google_allowed_domains and domain not in settings.google_allowed_domains:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Email domain not allowed")

    await self_service.maybe_cleanup_incomplete_google_accounts(session)

    existing_sub = await auth_service.get_user_by_google_sub(session, sub)
    if existing_sub:
        if getattr(existing_sub, "deletion_scheduled_for", None) and self_service.is_deletion_due(existing_sub):
            await self_service.execute_account_deletion(session, existing_sub)
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account deleted")
        if getattr(existing_sub, "deleted_at", None) is not None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account deleted")
        if auth_service.is_profile_complete(existing_sub):
            if bool(getattr(existing_sub, "two_factor_enabled", False)):
                token = security.create_two_factor_token(str(existing_sub.id), remember=True, method="google")
                return GoogleCallbackResponse(
                    user=UserResponse.model_validate(existing_sub),
                    requires_two_factor=True,
                    two_factor_token=token,
                )

            is_admin_login = existing_sub.role in (UserRole.admin, UserRole.owner)
            known_device = True
            if is_admin_login:
                known_device = await auth_service.has_seen_refresh_device(
                    session,
                    user_id=existing_sub.id,
                    user_agent=request.headers.get("user-agent"),
                )
            tokens = await auth_service.issue_tokens_for_user(
                session,
                existing_sub,
                user_agent=request.headers.get("user-agent"),
                ip_address=request.client.host if request.client else None,
                country_code=_extract_country_code(request),
            )
            if response:
                set_refresh_cookie(response, tokens["refresh_token"], persistent=True)
            await auth_service.record_security_event(
                session,
                existing_sub.id,
                "login_google",
                user_agent=request.headers.get("user-agent"),
                ip_address=request.client.host if request.client else None,
            )
            if is_admin_login and not known_device:
                owner = await auth_service.get_owner_user(session)
                to_email = (owner.email if owner and owner.email else None) or settings.admin_alert_email
                if to_email:
                    background_tasks.add_task(
                        email_service.send_admin_login_alert,
                        to_email,
                        admin_username=existing_sub.username,
                        admin_display_name=existing_sub.name,
                        admin_role=str(existing_sub.role),
                        ip_address=request.client.host if request.client else None,
                        country_code=_extract_country_code(request),
                        user_agent=request.headers.get("user-agent"),
                        occurred_at=datetime.now(timezone.utc),
                        lang=owner.preferred_language if owner else None,
                    )
            logger.info("google_login_existing", extra={"user_id": str(existing_sub.id)})
            return GoogleCallbackResponse(user=UserResponse.model_validate(existing_sub), tokens=TokenPair(**tokens))

        completion_token = security.create_google_completion_token(str(existing_sub.id))
        logger.info("google_login_needs_completion", extra={"user_id": str(existing_sub.id)})
        return GoogleCallbackResponse(
            user=UserResponse.model_validate(existing_sub),
            requires_completion=True,
            completion_token=completion_token,
        )

    existing_email = await auth_service.get_user_by_any_email(session, email)
    if existing_email and existing_email.google_sub and existing_email.google_sub != sub:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Google account already linked elsewhere")
    if existing_email and not existing_email.google_sub:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This email is already registered. Sign in with your password and link Google in your account settings.",
        )

    user = await auth_service.create_google_user(
        session,
        email=email,
        name=name,
        first_name=str(profile.get("given_name") or "").strip() or None,
        last_name=str(profile.get("family_name") or "").strip() or None,
        picture=picture,
        sub=sub,
        email_verified=email_verified,
        preferred_language="en",
    )
    logger.info("google_login_first_time", extra={"user_id": str(user.id)})
    completion_token = security.create_google_completion_token(str(user.id))
    return GoogleCallbackResponse(
        user=UserResponse.model_validate(user),
        requires_completion=True,
        completion_token=completion_token,
    )


class GoogleCompleteRequest(BaseModel):
    username: str = Field(min_length=3, max_length=30, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{2,29}$")
    name: str = Field(min_length=1, max_length=255, description="Display name shown publicly")
    first_name: str = Field(min_length=1, max_length=100)
    middle_name: str | None = Field(default=None, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    date_of_birth: date
    phone: str = Field(min_length=7, max_length=32, description="E.164 format")
    password: str = Field(min_length=6, max_length=128)
    preferred_language: str | None = Field(default=None, pattern="^(en|ro)$")
    accept_terms: bool = Field(default=False, description="Accept Terms & Conditions")
    accept_privacy: bool = Field(default=False, description="Accept Privacy Policy")

    @field_validator("name", "first_name", "last_name", "username", mode="before")
    @classmethod
    def _strip_required_strings(cls, value: str) -> str:
        value = (value or "").strip()
        if not value:
            raise ValueError("Field cannot be empty")
        return value

    @field_validator("middle_name", mode="before")
    @classmethod
    def _strip_optional_string(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None

    @field_validator("phone", mode="before")
    @classmethod
    def _strip_phone(cls, value: str) -> str:
        value = (value or "").strip()
        if not value:
            raise ValueError("Phone is required")
        if not re.fullmatch(r"^\+[1-9]\d{1,14}$", value):
            raise ValueError("Phone must be in E.164 format (e.g. +40723204204)")
        return value

    @field_validator("date_of_birth")
    @classmethod
    def _validate_date_of_birth(cls, value: date) -> date:
        if value > date.today():
            raise ValueError("Date of birth cannot be in the future")
        return value


@router.post("/google/complete")
async def google_complete_registration(
    payload: GoogleCompleteRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[User, Depends(get_google_completion_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
    response: Response = None,
) -> AuthResponse:
    user_agent = _request_user_agent(request)
    ip_address = _request_ip(request)
    _require_registration_consents(payload.accept_terms, payload.accept_privacy)
    consent_versions = await _require_published_consent_docs(session, _REQUIRED_REGISTRATION_CONSENT_KEYS)
    user = await _complete_google_registration_user(session, current_user, payload)
    _record_registration_consents(session, user_id=user.id, consent_versions=consent_versions)
    await session.commit()
    await _queue_google_completion_emails(background_tasks, session, user)
    tokens = await auth_service.issue_tokens_for_user(
        session,
        user,
        user_agent=user_agent,
        ip_address=ip_address,
        country_code=_extract_country_code(request),
    )
    if response:
        set_refresh_cookie(response, tokens["refresh_token"], persistent=True)
    await auth_service.record_security_event(
        session,
        user.id,
        "login_google",
        user_agent=user_agent,
        ip_address=ip_address,
    )
    return AuthResponse(user=UserResponse.model_validate(user), tokens=TokenPair(**tokens))


@router.get("/google/link/start")
async def google_link_start(current_user: Annotated[User, Depends(get_current_user)], _: Annotated[None, Depends(google_rate_limit)]) -> dict:
    if not settings.google_client_id or not settings.google_redirect_uri:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Google OAuth not configured")
    state = _build_google_state("google_link", str(current_user.id))
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "offline",
        "prompt": "select_account",
        "state": state,
    }
    url = f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"
    return {"auth_url": url}


class GoogleLinkCallback(BaseModel):
    code: str
    state: str
    password: str


@router.post("/google/link")
async def google_link(
    payload: GoogleLinkCallback,
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[None, Depends(google_rate_limit)],
) -> UserResponse:
    _validate_google_state(payload.state, "google_link", str(current_user.id))
    if not security.verify_password(payload.password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid password")
    profile = await auth_service.exchange_google_code(payload.code)
    sub, email, name, picture, email_verified = _extract_valid_google_profile(profile)
    existing_sub = await auth_service.get_user_by_google_sub(session, sub)
    if existing_sub and existing_sub.id != current_user.id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Google account already linked elsewhere")
    _apply_google_link(
        current_user,
        sub=sub,
        email=email,
        picture=picture,
        name=name,
        email_verified=email_verified,
    )
    session.add(current_user)
    await session.commit()
    await session.refresh(current_user)
    logger.info("user_linked_google", extra={"user_id": str(current_user.id)})
    return UserResponse.model_validate(current_user)


class UnlinkRequest(BaseModel):
    password: str


@router.post("/google/unlink")
async def google_unlink(
    payload: UnlinkRequest,
    current_user: Annotated[User, Depends(require_complete_profile)],
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[None, Depends(google_rate_limit)],
) -> UserResponse:
    if not security.verify_password(payload.password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid password")
    if current_user.google_picture_url and current_user.avatar_url == current_user.google_picture_url:
        current_user.avatar_url = None
    current_user.google_sub = None
    current_user.google_email = None
    current_user.google_picture_url = None
    session.add(current_user)
    await session.commit()
    await session.refresh(current_user)
    logger.info("user_unlinked_google", extra={"user_id": str(current_user.id)})
    return UserResponse.model_validate(current_user)
