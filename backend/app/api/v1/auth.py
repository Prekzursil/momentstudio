from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Response, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.dependencies import get_current_user, require_admin
from app.core.rate_limit import limiter, per_identifier_limiter
from app.core.security import decode_token
from app.db.session import get_session
from app.models.user import User
from app.core import security
from app.schemas.auth import (
    AuthResponse,
    EmailVerificationConfirm,
    PasswordResetConfirm,
    PasswordResetRequest,
    RefreshRequest,
    TokenPair,
    UserResponse,
)
from app.schemas.user import UserCreate
from app.services import auth as auth_service
from app.services import email as email_service
from app.services import storage

router = APIRouter(prefix="/auth", tags=["auth"])

register_rate_limit = per_identifier_limiter(
    lambda r: r.client.host if r.client else "anon", settings.auth_rate_limit_register, 60
)
login_rate_limit = limiter("auth:login", settings.auth_rate_limit_login, 60)
refresh_rate_limit = limiter("auth:refresh", settings.auth_rate_limit_refresh, 60)
reset_request_rate_limit = limiter("auth:reset_request", settings.auth_rate_limit_reset_request, 60)
reset_confirm_rate_limit = limiter("auth:reset_confirm", settings.auth_rate_limit_reset_confirm, 60)


def set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        "refresh_token",
        token,
        httponly=True,
        secure=settings.secure_cookies,
        samesite=settings.cookie_samesite.lower(),
        max_age=settings.refresh_token_exp_days * 24 * 60 * 60,
        path="/",
    )


def clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        "refresh_token",
        path="/",
        secure=settings.secure_cookies,
        samesite=settings.cookie_samesite.lower(),
    )


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@router.post("/register", status_code=status.HTTP_201_CREATED, response_model=AuthResponse)
async def register(
    user_in: UserCreate,
    session: AsyncSession = Depends(get_session),
    _: None = Depends(register_rate_limit),
) -> AuthResponse:
    user = await auth_service.create_user(session, user_in)
    tokens = await auth_service.issue_tokens_for_user(session, user)
    return AuthResponse(user=UserResponse.model_validate(user), tokens=TokenPair(**tokens))


@router.post("/login", response_model=AuthResponse)
async def login(
    user_in: UserCreate,  # reuse for email/password fields
    session: AsyncSession = Depends(get_session),
    _: None = Depends(login_rate_limit),
    response: Response = None,
) -> AuthResponse:
    user = await auth_service.authenticate_user(session, user_in.email, user_in.password)
    tokens = await auth_service.issue_tokens_for_user(session, user)
    if response:
        set_refresh_cookie(response, tokens["refresh_token"])
    return AuthResponse(user=UserResponse.model_validate(user), tokens=TokenPair(**tokens))


@router.post("/refresh", response_model=TokenPair)
async def refresh_tokens(
    refresh_request: RefreshRequest,
    session: AsyncSession = Depends(get_session),
    _: None = Depends(refresh_rate_limit),
    response: Response = None,
) -> TokenPair:
    stored = await auth_service.validate_refresh_token(session, refresh_request.refresh_token)
    user = await session.get(User, stored.user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    # rotate token
    stored.revoked = True
    stored.revoked_reason = "rotated"
    session.add(stored)
    await session.flush()
    tokens = await auth_service.issue_tokens_for_user(session, user)
    if response:
        set_refresh_cookie(response, tokens["refresh_token"])
    return TokenPair(**tokens)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    payload: RefreshRequest,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(get_current_user),
    response: Response = None,
) -> None:
    payload_data = decode_token(payload.refresh_token)
    if payload_data and payload_data.get("jti"):
        await auth_service.revoke_refresh_token(session, payload_data["jti"], reason="logout")
    if response:
        clear_refresh_cookie(response)
    return None


@router.post("/password/change", status_code=status.HTTP_200_OK)
async def change_password(
    payload: ChangePasswordRequest,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict:
    if not security.verify_password(payload.current_password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
    current_user.hashed_password = security.hash_password(payload.new_password)
    session.add(current_user)
    await session.flush()
    return {"detail": "Password updated"}


@router.post("/verify/request", status_code=status.HTTP_202_ACCEPTED)
async def request_email_verification(
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    record = await auth_service.create_email_verification(session, current_user)
    background_tasks.add_task(email_service.send_verification_email, current_user.email, record.token)
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


@router.post("/me/avatar", response_model=UserResponse)
async def upload_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> UserResponse:
    avatars_root = Path(settings.media_root) / "avatars"
    extension = Path(file.filename or "").suffix.lower() or ".png"
    filename = f"avatar-{current_user.id}{extension}"
    path, saved_name = storage.save_upload(
        file,
        root=avatars_root,
        filename=filename,
        allowed_content_types=("image/png", "image/jpeg", "image/webp", "image/gif"),
        max_bytes=5 * 1024 * 1024,
    )
    current_user.avatar_url = f"/media/avatars/{saved_name}"
    session.add(current_user)
    await session.flush()
    return UserResponse.model_validate(current_user)


@router.get("/admin/ping", response_model=dict[str, str])
async def admin_ping(admin_user: User = Depends(require_admin)) -> dict[str, str]:
    return {"status": "admin-ok", "user": str(admin_user.id)}


@router.post("/password-reset/request", status_code=status.HTTP_202_ACCEPTED)
async def request_password_reset(
    payload: PasswordResetRequest,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    _: None = Depends(reset_request_rate_limit),
) -> dict[str, str]:
    reset = await auth_service.create_reset_token(session, payload.email)
    background_tasks.add_task(email_service.send_password_reset, payload.email, reset.token)
    return {"status": "sent"}


@router.post("/password-reset/confirm", status_code=status.HTTP_200_OK)
async def confirm_password_reset(
    payload: PasswordResetConfirm,
    session: AsyncSession = Depends(get_session),
    _: None = Depends(reset_confirm_rate_limit),
) -> dict[str, str]:
    await auth_service.confirm_reset_token(session, payload.token, payload.new_password)
    return {"status": "updated"}
