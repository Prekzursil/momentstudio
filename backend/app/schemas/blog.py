from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.catalog import PaginationMeta


class BlogPostListItem(BaseModel):
    slug: str
    title: str
    excerpt: str
    published_at: datetime | None = None
    cover_image_url: str | None = None
    tags: list[str] = Field(default_factory=list)
    reading_time_minutes: int | None = None


class BlogPostListResponse(BaseModel):
    items: list[BlogPostListItem]
    meta: PaginationMeta


class BlogPreviewTokenResponse(BaseModel):
    token: str
    expires_at: datetime
    url: str


class BlogPostImage(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    url: str
    alt_text: str | None = None
    sort_order: int


class BlogPostRead(BaseModel):
    slug: str
    title: str
    body_markdown: str
    published_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    images: list[BlogPostImage] = Field(default_factory=list)
    meta: dict | None = None
    summary: str | None = None
    cover_image_url: str | None = None
    tags: list[str] = Field(default_factory=list)
    reading_time_minutes: int | None = None


class BlogCommentAuthor(BaseModel):
    id: UUID
    name: str | None = None
    avatar_url: str | None = None


class BlogCommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=2000)
    parent_id: UUID | None = None


class BlogCommentRead(BaseModel):
    id: UUID
    parent_id: UUID | None = None
    body: str
    is_deleted: bool
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None = None
    author: BlogCommentAuthor


class BlogCommentListResponse(BaseModel):
    items: list[BlogCommentRead]
    meta: PaginationMeta
