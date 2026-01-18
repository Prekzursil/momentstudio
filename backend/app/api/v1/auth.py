from pathlib import Path
import logging
import re
from datetime import datetime, timedelta, timezone, date
from urllib.parse import urlencode
from uuid import UUID

from jose import jwt

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, EmailStr, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import security
from app.core.config import settings
from app.core.dependencies import get_current_user, get_google_completion_user, require_admin, require_complete_profile
from app.core.rate_limit import limiter, per_identifier_limiter
from app.core.security import decode_token
from app.db.session import get_session
from app.models.user import User, UserSecondaryEmail
from app.schemas.auth import (
    AuthResponse,
    GoogleCallbackResponse,
    AccountDeletionStatus,
    EmailVerificationConfirm,
    SecondaryEmailConfirmRequest,
    SecondaryEmailCreateRequest,
    SecondaryEmailMakePrimaryRequest,
    SecondaryEmailResponse,
    PasswordResetConfirm,
    PasswordResetRequest,
    RefreshRequest,
    TokenPair,
    UserEmailsResponse,
    UserResponse,
)
from app.schemas.user import UserCreate
from app.services import auth as auth_service
from app.services import captcha as captcha_service
from app.services import email as email_service
from app.services import self_service
from app.services import storage
from app.core import metrics

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)

register_rate_limit = per_identifier_limiter(
    lambda r: r.client.host if r.client else "anon", settings.auth_rate_limit_register, 60
)
login_rate_limit = limiter("auth:login", settings.auth_rate_limit_login, 60)
refresh_rate_limit = limiter("auth:refresh", settings.auth_rate_limit_refresh, 60)
reset_request_rate_limit = limiter("auth:reset_request", settings.auth_rate_limit_reset_request, 60)
reset_confirm_rate_limit = limiter("auth:reset_confirm", settings.auth_rate_limit_reset_confirm, 60)
google_rate_limit = per_identifier_limiter(
    lambda r: r.client.host if r.client else "anon",
    settings.auth_rate_limit_google,
    60,
)


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


@router.post("/register", status_code=status.HTTP_201_CREATED, response_model=AuthResponse)
async def register(
    payload: RegisterRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    _: None = Depends(register_rate_limit),
    response: Response = None,
) -> AuthResponse:
    await captcha_service.verify(payload.captcha_token, remote_ip=request.client.host if request.client else None)
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
    metrics.record_signup()
    record = await auth_service.create_email_verification(session, user)
    background_tasks.add_task(
        email_service.send_verification_email,
        user.email,
        record.token,
        user.preferred_language,
    )
    background_tasks.add_task(
        email_service.send_welcome_email,
        user.email,
        first_name=user.first_name,
        lang=user.preferred_language,
    )
    tokens = await auth_service.issue_tokens_for_user(session, user, persistent=False)
    if response:
        set_refresh_cookie(response, tokens["refresh_token"], persistent=False)
    return AuthResponse(user=UserResponse.model_validate(user), tokens=TokenPair(**tokens))


@router.post(
    "/login",
    response_model=AuthResponse,
    summary="Login with email or username",
    description=(
        "Accepts an `identifier` field (email or username). For backward compatibility, an `email` field is also "
        "accepted; if both are provided, `identifier` takes precedence."
    ),
)
async def login(
    payload: LoginRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    _: None = Depends(login_rate_limit),
    response: Response = None,
) -> AuthResponse:
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
    tokens = await auth_service.issue_tokens_for_user(session, user, persistent=persistent)
    if response:
        set_refresh_cookie(response, tokens["refresh_token"], persistent=persistent)
    return AuthResponse(user=UserResponse.model_validate(user), tokens=TokenPair(**tokens))


@router.post("/refresh", response_model=TokenPair)
async def refresh_tokens(
    refresh_request: RefreshRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    _: None = Depends(refresh_rate_limit),
    response: Response = None,
) -> TokenPair:
    refresh_token = (refresh_request.refresh_token or "").strip()
    if not refresh_token:
        refresh_token = (request.cookies.get("refresh_token") or "").strip()
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token missing")

    stored = await auth_service.validate_refresh_token(session, refresh_token)
    user = await session.get(User, stored.user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if getattr(user, "deleted_at", None) is not None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account deleted")
    if getattr(user, "deletion_scheduled_for", None) and self_service.is_deletion_due(user):
        await self_service.execute_account_deletion(session, user)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account deleted")
    # rotate token
    stored.revoked = True
    stored.revoked_reason = "rotated"
    session.add(stored)
    await session.flush()
    persistent = bool(getattr(stored, "persistent", True))
    tokens = await auth_service.issue_tokens_for_user(session, user, persistent=persistent)
    if response:
        set_refresh_cookie(response, tokens["refresh_token"], persistent=persistent)
    return TokenPair(**tokens)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    payload: RefreshRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
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
    return None


@router.post("/password/change", status_code=status.HTTP_200_OK)
async def change_password(
    payload: ChangePasswordRequest,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict:
    if not security.verify_password(payload.current_password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
    current_user.hashed_password = security.hash_password(payload.new_password)
    session.add(current_user)
    await session.commit()
    background_tasks.add_task(email_service.send_password_changed, current_user.email, lang=current_user.preferred_language)
    return {"detail": "Password updated"}


@router.post("/verify/request", status_code=status.HTTP_202_ACCEPTED)
async def request_email_verification(
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    record = await auth_service.create_email_verification(session, current_user)
    background_tasks.add_task(
        email_service.send_verification_email,
        current_user.email,
        record.token,
        current_user.preferred_language,
    )
    return {"detail": "Verification email sent"}


@router.post("/verify/confirm", status_code=status.HTTP_200_OK)
async def confirm_email_verification(
    payload: EmailVerificationConfirm,
    session: AsyncSession = Depends(get_session),
) -> dict:
    user = await auth_service.confirm_email_verification(session, payload.token)
    return {"detail": "Email verified", "email_verified": user.email_verified}


@router.get("/me", response_model=UserResponse)
async def read_me(current_user: User = Depends(get_current_user)) -> UserResponse:
    return UserResponse.model_validate(current_user)


@router.get(
    "/me/aliases",
    response_model=UserAliasesResponse,
    summary="Get my username and display name history",
    description="Returns the full history of your username changes and display-name tags (name#N).",
)
async def read_aliases(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> UserAliasesResponse:
    usernames = await auth_service.list_username_history(session, current_user.id)
    display_names = await auth_service.list_display_name_history(session, current_user.id)
    return UserAliasesResponse(
        usernames=[UsernameHistoryItem(username=row.username, created_at=row.created_at) for row in usernames],
        display_names=[
            DisplayNameHistoryItem(name=row.name, name_tag=row.name_tag, created_at=row.created_at) for row in display_names
        ],
    )


@router.patch(
    "/me/username",
    response_model=UserResponse,
    summary="Update my username",
    description="Updates your unique username and stores an entry in your username history.",
)
async def update_username(
    payload: UsernameUpdateRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> UserResponse:
    if not security.verify_password(payload.password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid password")
    user = await auth_service.update_username(session, current_user, payload.username)
    return UserResponse.model_validate(user)


@router.patch(
    "/me/email",
    response_model=UserResponse,
    summary="Update my email address",
    description="Updates your email (password required) and sends a new verification token. Disabled while Google is linked.",
)
async def update_email(
    payload: EmailUpdateRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> UserResponse:
    if not security.verify_password(payload.password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid password")
    old_email = current_user.email
    user = await auth_service.update_email(session, current_user, str(payload.email))
    record = await auth_service.create_email_verification(session, user)
    background_tasks.add_task(email_service.send_email_changed, old_email, old_email=old_email, new_email=user.email, lang=user.preferred_language)
    background_tasks.add_task(email_service.send_email_changed, user.email, old_email=old_email, new_email=user.email, lang=user.preferred_language)
    background_tasks.add_task(email_service.send_verification_email, user.email, record.token, user.preferred_language)
    return UserResponse.model_validate(user)


@router.get(
    "/me/emails",
    response_model=UserEmailsResponse,
    summary="List my emails",
    description="Returns primary email and any secondary emails (verified/unverified).",
)
async def list_my_emails(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> UserEmailsResponse:
    secondary = await auth_service.list_secondary_emails(session, current_user.id)
    return UserEmailsResponse(
        primary_email=current_user.email,
        primary_verified=bool(current_user.email_verified),
        secondary_emails=[SecondaryEmailResponse.model_validate(e) for e in secondary],
    )


@router.post(
    "/me/emails",
    response_model=SecondaryEmailResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add a secondary email",
)
async def add_my_secondary_email(
    payload: SecondaryEmailCreateRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> SecondaryEmailResponse:
    secondary, token = await auth_service.add_secondary_email(session, current_user, str(payload.email))
    background_tasks.add_task(email_service.send_verification_email, secondary.email, token.token, current_user.preferred_language)
    return SecondaryEmailResponse.model_validate(secondary)


@router.post(
    "/me/emails/{secondary_email_id}/verify/request",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Resend verification for a secondary email",
)
async def request_secondary_email_verification(
    secondary_email_id: UUID,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    token = await auth_service.request_secondary_email_verification(session, current_user, secondary_email_id)
    secondary = await session.get(UserSecondaryEmail, secondary_email_id)
    if secondary:
        background_tasks.add_task(email_service.send_verification_email, secondary.email, token.token, current_user.preferred_language)
    return {"detail": "Verification email sent"}


@router.post(
    "/me/emails/verify/confirm",
    response_model=SecondaryEmailResponse,
    summary="Confirm secondary email verification",
)
async def confirm_secondary_email_verification(
    payload: SecondaryEmailConfirmRequest,
    session: AsyncSession = Depends(get_session),
) -> SecondaryEmailResponse:
    secondary = await auth_service.confirm_secondary_email_verification(session, payload.token)
    return SecondaryEmailResponse.model_validate(secondary)


@router.post(
    "/me/emails/{secondary_email_id}/make-primary",
    response_model=UserResponse,
    summary="Make a verified secondary email the primary email",
)
async def make_secondary_email_primary(
    secondary_email_id: UUID,
    payload: SecondaryEmailMakePrimaryRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> UserResponse:
    if not security.verify_password(payload.password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid password")
    user = await auth_service.make_secondary_email_primary(session, current_user, secondary_email_id)
    return UserResponse.model_validate(user)


@router.delete(
    "/me/emails/{secondary_email_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a secondary email",
)
async def delete_secondary_email(
    secondary_email_id: UUID,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    await auth_service.delete_secondary_email(session, current_user, secondary_email_id)


@router.get("/me/export")
async def export_me(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    data = await self_service.export_user_data(session, current_user)
    filename = f"moment-studio-export-{current_user.id}.json"
    return JSONResponse(
        content=data,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/me/delete/status", response_model=AccountDeletionStatus)
async def account_delete_status(current_user: User = Depends(get_current_user)) -> AccountDeletionStatus:
    return AccountDeletionStatus(
        requested_at=current_user.deletion_requested_at,
        scheduled_for=current_user.deletion_scheduled_for,
        deleted_at=current_user.deleted_at,
        cooldown_hours=settings.account_deletion_cooldown_hours,
    )


@router.post("/me/delete", response_model=AccountDeletionStatus)
async def request_account_deletion(
    payload: AccountDeletionRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AccountDeletionStatus:
    if payload.confirm.strip().upper() != "DELETE":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Type "DELETE" to confirm')
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


@router.post("/me/delete/cancel", response_model=AccountDeletionStatus)
async def cancel_account_deletion(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
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


@router.patch("/me/language", response_model=UserResponse)
async def update_language(
    payload: PreferredLanguageUpdate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> UserResponse:
    current_user.preferred_language = payload.preferred_language
    session.add(current_user)
    await session.commit()
    await session.refresh(current_user)
    return UserResponse.model_validate(current_user)


@router.patch("/me/notifications", response_model=UserResponse)
async def update_notification_preferences(
    payload: NotificationPreferencesUpdate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
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


@router.patch("/me", response_model=UserResponse)
async def update_me(
    payload: ProfileUpdate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
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


@router.post("/me/avatar", response_model=UserResponse)
async def upload_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> UserResponse:
    avatars_root = Path(settings.media_root) / "avatars"
    extension = Path(file.filename or "").suffix.lower() or ".png"
    filename = f"avatar-{current_user.id}{extension}"
    url_path, saved_name = storage.save_upload(
        file,
        root=avatars_root,
        filename=filename,
        allowed_content_types=("image/png", "image/jpeg", "image/webp", "image/gif"),
        max_bytes=5 * 1024 * 1024,
    )
    current_user.avatar_url = url_path
    session.add(current_user)
    await session.commit()
    await session.refresh(current_user)
    return UserResponse.model_validate(current_user)


@router.post("/me/avatar/use-google", response_model=UserResponse)
async def use_google_avatar(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> UserResponse:
    if not current_user.google_picture_url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No Google profile picture available")
    current_user.avatar_url = current_user.google_picture_url
    session.add(current_user)
    await session.commit()
    await session.refresh(current_user)
    return UserResponse.model_validate(current_user)


@router.delete("/me/avatar", response_model=UserResponse)
async def remove_avatar(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> UserResponse:
    current_user.avatar_url = None
    session.add(current_user)
    await session.commit()
    await session.refresh(current_user)
    return UserResponse.model_validate(current_user)


@router.get("/admin/ping", response_model=dict[str, str])
async def admin_ping(admin_user: User = Depends(require_admin)) -> dict[str, str]:
    return {"status": "admin-ok", "user": str(admin_user.id)}


@router.post(
    "/admin/cleanup/incomplete-google",
    response_model=dict[str, int],
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
    session: AsyncSession = Depends(get_session),
    _: None = Depends(reset_request_rate_limit),
) -> dict[str, str]:
    reset = await auth_service.create_reset_token(session, payload.email)
    user = await session.get(User, reset.user_id)
    background_tasks.add_task(email_service.send_password_reset, payload.email, reset.token, getattr(user, "preferred_language", None))
    return {"status": "sent"}


@router.post("/password-reset/confirm", status_code=status.HTTP_200_OK)
async def confirm_password_reset(
    payload: PasswordResetConfirm,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    _: None = Depends(reset_confirm_rate_limit),
) -> dict[str, str]:
    user = await auth_service.confirm_reset_token(session, payload.token, payload.new_password)
    background_tasks.add_task(email_service.send_password_changed, user.email, lang=user.preferred_language)
    return {"status": "updated"}


@router.get("/google/start", response_model=dict)
async def google_start(_: None = Depends(google_rate_limit)) -> dict:
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


@router.post("/google/callback", response_model=GoogleCallbackResponse)
async def google_callback(
    payload: GoogleCallback,
    session: AsyncSession = Depends(get_session),
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
            tokens = await auth_service.issue_tokens_for_user(session, existing_sub)
            if response:
                set_refresh_cookie(response, tokens["refresh_token"], persistent=True)
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


@router.post("/google/complete", response_model=AuthResponse)
async def google_complete_registration(
    payload: GoogleCompleteRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_google_completion_user),
    session: AsyncSession = Depends(get_session),
    response: Response = None,
) -> AuthResponse:
    user = await auth_service.complete_google_registration(
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
    background_tasks.add_task(
        email_service.send_welcome_email,
        user.email,
        first_name=user.first_name,
        lang=user.preferred_language,
    )
    if not user.email_verified:
        record = await auth_service.create_email_verification(session, user)
        background_tasks.add_task(email_service.send_verification_email, user.email, record.token, user.preferred_language)
    tokens = await auth_service.issue_tokens_for_user(session, user)
    if response:
        set_refresh_cookie(response, tokens["refresh_token"], persistent=True)
    return AuthResponse(user=UserResponse.model_validate(user), tokens=TokenPair(**tokens))


@router.get("/google/link/start", response_model=dict)
async def google_link_start(current_user: User = Depends(get_current_user), _: None = Depends(google_rate_limit)) -> dict:
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


@router.post("/google/link", response_model=UserResponse)
async def google_link(
    payload: GoogleLinkCallback,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    _: None = Depends(google_rate_limit),
) -> UserResponse:
    _validate_google_state(payload.state, "google_link", str(current_user.id))
    if not security.verify_password(payload.password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid password")
    profile = await auth_service.exchange_google_code(payload.code)
    sub = profile.get("sub")
    email = str(profile.get("email") or "").strip().lower()
    name = profile.get("name")
    picture = profile.get("picture")
    if not sub or not email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Google profile")
    domain = email.split("@")[-1]
    if settings.google_allowed_domains and domain not in settings.google_allowed_domains:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Email domain not allowed")
    existing_sub = await auth_service.get_user_by_google_sub(session, sub)
    if existing_sub and existing_sub.id != current_user.id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Google account already linked elsewhere")
    current_user.google_sub = sub
    current_user.google_email = email
    current_user.google_picture_url = picture
    current_user.email_verified = bool(profile.get("email_verified")) or current_user.email_verified
    if not current_user.name:
        current_user.name = name
    session.add(current_user)
    await session.commit()
    await session.refresh(current_user)
    logger.info("user_linked_google", extra={"user_id": str(current_user.id)})
    return UserResponse.model_validate(current_user)


class UnlinkRequest(BaseModel):
    password: str


@router.post("/google/unlink", response_model=UserResponse)
async def google_unlink(
    payload: UnlinkRequest,
    current_user: User = Depends(require_complete_profile),
    session: AsyncSession = Depends(get_session),
    _: None = Depends(google_rate_limit),
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
