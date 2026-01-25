from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.content import ContentStatus
from app.schemas.catalog import PaginationMeta


class ContentBlockBase(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    body_markdown: str = Field(min_length=1)
    status: ContentStatus = ContentStatus.draft
    published_at: datetime | None = None
    published_until: datetime | None = None
    meta: dict[str, Any] | None = None
    sort_order: int = 0
    lang: str | None = Field(default=None, pattern="^(en|ro)$")

    @field_validator("body_markdown")
    @classmethod
    def _validate_markdown(cls, body: str) -> str:
        if "<script" in body.lower():
            raise ValueError("Script tags are not allowed")
        return body


class ContentBlockCreate(ContentBlockBase):
    pass


class ContentBlockUpdate(BaseModel):
    expected_version: int | None = Field(default=None, ge=1)
    title: str | None = Field(default=None, max_length=200)
    body_markdown: str | None = Field(default=None)
    status: ContentStatus | None = None
    published_at: datetime | None = None
    published_until: datetime | None = None
    meta: dict[str, Any] | None = None
    sort_order: int | None = None
    lang: str | None = Field(default=None, pattern="^(en|ro)$")

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
    lang: str | None = None
    needs_translation_en: bool = False
    needs_translation_ro: bool = False
    published_at: datetime | None = None
    published_until: datetime | None = None
    created_at: datetime
    updated_at: datetime
    images: list["ContentImageRead"] = Field(default_factory=list)
    audits: list["ContentAuditRead"] = Field(default_factory=list)


class ContentPageListItem(BaseModel):
    key: str
    slug: str
    title: str
    status: ContentStatus
    updated_at: datetime
    published_at: datetime | None = None
    published_until: datetime | None = None
    needs_translation_en: bool = False
    needs_translation_ro: bool = False


class ContentPageRenameRequest(BaseModel):
    new_slug: str = Field(min_length=1, max_length=120)


class ContentPageRenameResponse(BaseModel):
    old_slug: str
    new_slug: str
    old_key: str
    new_key: str


class ContentRedirectRead(BaseModel):
    id: UUID
    from_key: str
    to_key: str
    created_at: datetime
    updated_at: datetime
    target_exists: bool = True


class ContentRedirectListResponse(BaseModel):
    items: list[ContentRedirectRead]
    meta: PaginationMeta


class ContentImageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    url: str
    alt_text: str | None = None
    sort_order: int
    focal_x: int = 50
    focal_y: int = 50


class ContentImageAssetRead(BaseModel):
    id: UUID
    url: str
    alt_text: str | None = None
    sort_order: int
    created_at: datetime
    content_key: str
    tags: list[str] = Field(default_factory=list)
    focal_x: int = 50
    focal_y: int = 50


class ContentImageAssetListResponse(BaseModel):
    items: list[ContentImageAssetRead]
    meta: PaginationMeta


class ContentImageTagsUpdate(BaseModel):
    tags: list[str] = Field(default_factory=list)


class ContentImageFocalPointUpdate(BaseModel):
    focal_x: int = Field(default=50, ge=0, le=100)
    focal_y: int = Field(default=50, ge=0, le=100)


class ContentTranslationStatusUpdate(BaseModel):
    needs_translation_en: bool | None = None
    needs_translation_ro: bool | None = None


class ContentLinkCheckIssue(BaseModel):
    key: str
    kind: str = Field(pattern="^(link|image)$")
    source: str = Field(pattern="^(markdown|block)$")
    field: str
    url: str
    reason: str


class ContentLinkCheckResponse(BaseModel):
    issues: list[ContentLinkCheckIssue]


class ContentBlockVersionListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    version: int
    title: str
    status: ContentStatus
    created_at: datetime


class ContentTranslationSnapshot(BaseModel):
    lang: str
    title: str
    body_markdown: str


class ContentBlockVersionRead(ContentBlockVersionListItem):
    body_markdown: str
    meta: dict[str, Any] | None = None
    lang: str | None = None
    published_at: datetime | None = None
    published_until: datetime | None = None
    translations: list[ContentTranslationSnapshot] | None = None


class ContentAuditRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    action: str
    version: int
    user_id: UUID | None = None
    created_at: datetime


ContentBlockRead.model_rebuild()
