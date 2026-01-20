from datetime import datetime, date
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.user import UserRole


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class TokenPayload(BaseModel):
    sub: str
    type: str
    exp: int


class RefreshRequest(BaseModel):
    refresh_token: str | None = None


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    username: str
    name: str | None = None
    name_tag: int = 0
    first_name: str | None = None
    middle_name: str | None = None
    last_name: str | None = None
    date_of_birth: date | None = None
    phone: str | None = None
    avatar_url: str | None = None
    preferred_language: str | None = None
    email_verified: bool = False
    notify_blog_comments: bool = False
    notify_blog_comment_replies: bool = False
    notify_marketing: bool = False
    google_sub: str | None = None
    google_email: str | None = None
    google_picture_url: str | None = None
    role: UserRole
    created_at: datetime
    updated_at: datetime


class AuthResponse(BaseModel):
    user: UserResponse
    tokens: TokenPair


class GoogleCallbackResponse(BaseModel):
    user: UserResponse
    tokens: TokenPair | None = None
    requires_completion: bool = False
    completion_token: str | None = None


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirm(BaseModel):
    token: str
    new_password: str = Field(min_length=6, max_length=128)


class EmailVerificationConfirm(BaseModel):
    token: str


class SecondaryEmailCreateRequest(BaseModel):
    email: EmailStr


class SecondaryEmailConfirmRequest(BaseModel):
    token: str


class SecondaryEmailMakePrimaryRequest(BaseModel):
    password: str = Field(min_length=1, max_length=128)


class SecondaryEmailResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    verified: bool = False
    verified_at: datetime | None = None
    created_at: datetime


class UserEmailsResponse(BaseModel):
    primary_email: str
    primary_verified: bool
    secondary_emails: list[SecondaryEmailResponse]


class AccountDeletionStatus(BaseModel):
    requested_at: datetime | None = None
    scheduled_for: datetime | None = None
    deleted_at: datetime | None = None
    cooldown_hours: int


class RefreshSessionResponse(BaseModel):
    id: UUID
    created_at: datetime
    expires_at: datetime
    persistent: bool
    is_current: bool = False
    user_agent: str | None = None
    ip_address: str | None = None


class RefreshSessionsRevokeResponse(BaseModel):
    revoked: int


class UserSecurityEventResponse(BaseModel):
    id: UUID
    event_type: str
    created_at: datetime
    user_agent: str | None = None
    ip_address: str | None = None
