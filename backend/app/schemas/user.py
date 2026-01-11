import re
from datetime import datetime, date
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

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
    first_name: str | None = Field(default=None, max_length=100)
    middle_name: str | None = Field(default=None, max_length=100)
    last_name: str | None = Field(default=None, max_length=100)
    date_of_birth: date | None = None
    phone: str | None = Field(default=None, max_length=32)
    preferred_language: str | None = None

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


class UserCreate(UserBase):
    password: str = Field(min_length=6, max_length=128)


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
