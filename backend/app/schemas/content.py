from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.content import ContentStatus


class ContentBlockBase(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    body_markdown: str = Field(min_length=1)
    status: ContentStatus = ContentStatus.draft
    meta: dict[str, Any] | None = None
    sort_order: int = 0

    @field_validator("body_markdown")
    @classmethod
    def _validate_markdown(cls, body: str) -> str:
        if "<script" in body.lower():
            raise ValueError("Script tags are not allowed")
        return body


class ContentBlockCreate(ContentBlockBase):
    pass


class ContentBlockUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    body_markdown: str | None = Field(default=None)
    status: ContentStatus | None = None
    meta: dict[str, Any] | None = None
    sort_order: int | None = None

    @field_validator("body_markdown")
    @classmethod
    def _validate_markdown(cls, body: str | None) -> str | None:
        if body and "<script" in body.lower():
            raise ValueError("Script tags are not allowed")
        return body


class ContentBlockRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    key: str
    title: str
    body_markdown: str
    status: ContentStatus
    version: int
    meta: dict[str, Any] | None = None
    sort_order: int
    published_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    images: list["ContentImageRead"] = Field(default_factory=list)
    audits: list["ContentAuditRead"] = Field(default_factory=list)


class ContentImageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    url: str
    alt_text: str | None = None
    sort_order: int


class ContentAuditRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    action: str
    version: int
    user_id: UUID | None = None
    created_at: datetime


ContentBlockRead.model_rebuild()
