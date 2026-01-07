from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.user import UserRole


class UserBase(BaseModel):
    email: EmailStr
    username: str | None = Field(
        default=None,
        min_length=3,
        max_length=30,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{2,29}$",
    )
    name: str | None = None
    preferred_language: str | None = None


class UserCreate(UserBase):
    password: str = Field(min_length=8, max_length=128)


class UserRead(UserBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    avatar_url: str | None = None
    preferred_language: str | None = None
    google_sub: str | None = None
    google_email: str | None = None
    google_picture_url: str | None = None
    role: UserRole
    created_at: datetime
    updated_at: datetime
