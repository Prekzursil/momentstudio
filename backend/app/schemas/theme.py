"""Pydantic response schemas for the theme resolve/read API (WU4a)."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.theme import ThemeStatus


class ThemeTokensRead(BaseModel):
    """A resolved theme document (published or draft) exposed to consumers."""

    model_config = ConfigDict(from_attributes=True)

    tokens: dict[str, str]
    version: int
    schema_version: int
    status: ThemeStatus
    published_at: datetime | None = None
    updated_at: datetime | None = None


class ThemeVersionListItem(BaseModel):
    """One entry in the browsable theme version history."""

    model_config = ConfigDict(from_attributes=True)

    version: int
    schema_version: int
    status: ThemeStatus
    created_by_user_id: UUID | None = None
    published_at: datetime | None = None
    created_at: datetime


class ThemeVersionListResponse(BaseModel):
    """Wrapper for the version-history list (newest first)."""

    items: list[ThemeVersionListItem] = Field(default_factory=list)
