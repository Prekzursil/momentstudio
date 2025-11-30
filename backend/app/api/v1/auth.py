from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.dependencies import get_current_user, require_admin
from app.core.security import decode_token
from app.db.session import get_session
from app.models.user import User
from app.schemas.auth import (
    AuthResponse,
    PasswordResetConfirm,
    PasswordResetRequest,
    RefreshRequest,
    TokenPair,
    UserResponse,
)
from app.schemas.user import UserCreate
from app.services import auth as auth_service
from app.services import email as email_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", status_code=status.HTTP_201_CREATED, response_model=AuthResponse)
async def register(user_in: UserCreate, session: AsyncSession = Depends(get_session)) -> AuthResponse:
    user = await auth_service.create_user(session, user_in)
    tokens = auth_service.issue_tokens_for_user(user)
    return AuthResponse(user=UserResponse.model_validate(user), tokens=TokenPair(**tokens))


@router.post("/login", response_model=AuthResponse)
async def login(
    user_in: UserCreate,  # reuse for email/password fields
    session: AsyncSession = Depends(get_session),
) -> AuthResponse:
    user = await auth_service.authenticate_user(session, user_in.email, user_in.password)
    tokens = auth_service.issue_tokens_for_user(user)
    return AuthResponse(user=UserResponse.model_validate(user), tokens=TokenPair(**tokens))


@router.post("/refresh", response_model=TokenPair)
async def refresh_tokens(
    refresh_request: RefreshRequest,
    session: AsyncSession = Depends(get_session),
) -> TokenPair:
    payload = decode_token(refresh_request.refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    try:
        user_id = UUID(str(payload.get("sub")))
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

    result = await session.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    tokens = auth_service.issue_tokens_for_user(user)
    return TokenPair(**tokens)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(current_user: User = Depends(get_current_user)) -> None:
    # Stateless JWT logout: clients should drop tokens.
    return None


@router.get("/me", response_model=UserResponse)
async def read_me(current_user: User = Depends(get_current_user)) -> UserResponse:
    return UserResponse.model_validate(current_user)


@router.get("/admin/ping", response_model=dict[str, str])
async def admin_ping(admin_user: User = Depends(require_admin)) -> dict[str, str]:
    return {"status": "admin-ok", "user": str(admin_user.id)}


@router.post("/password-reset/request", status_code=status.HTTP_202_ACCEPTED)
async def request_password_reset(
    payload: PasswordResetRequest,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    reset = await auth_service.create_reset_token(session, payload.email)
    background_tasks.add_task(email_service.send_password_reset, payload.email, reset.token)
    return {"status": "sent"}


@router.post("/password-reset/confirm", status_code=status.HTTP_200_OK)
async def confirm_password_reset(
    payload: PasswordResetConfirm,
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    await auth_service.confirm_reset_token(session, payload.token, payload.new_password)
    return {"status": "updated"}
