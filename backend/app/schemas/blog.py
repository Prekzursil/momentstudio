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


class BlogCommentFlagCreate(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class BlogCommentFlagRead(BaseModel):
    id: UUID
    user_id: UUID
    reason: str | None = None
    created_at: datetime


class BlogCommentRead(BaseModel):
    id: UUID
    parent_id: UUID | None = None
    body: str
    is_deleted: bool
    is_hidden: bool = False
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None = None
    hidden_at: datetime | None = None
    author: BlogCommentAuthor


class BlogCommentListResponse(BaseModel):
    items: list[BlogCommentRead]
    meta: PaginationMeta


class BlogCommentAdminRead(BaseModel):
    id: UUID
    content_block_id: UUID
    post_slug: str
    parent_id: UUID | None = None
    body: str
    is_deleted: bool
    deleted_at: datetime | None = None
    deleted_by: UUID | None = None
    is_hidden: bool
    hidden_at: datetime | None = None
    hidden_by: UUID | None = None
    hidden_reason: str | None = None
    created_at: datetime
    updated_at: datetime
    author: BlogCommentAuthor
    flag_count: int = 0
    flags: list[BlogCommentFlagRead] = Field(default_factory=list)


class BlogCommentAdminListResponse(BaseModel):
    items: list[BlogCommentAdminRead]
    meta: PaginationMeta


class BlogCommentHideRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class BlogMyCommentParentContext(BaseModel):
    id: UUID
    author_name: str | None = None
    snippet: str


class BlogMyCommentLastReplyContext(BaseModel):
    id: UUID
    author_name: str | None = None
    snippet: str
    created_at: datetime


class BlogMyCommentRead(BaseModel):
    id: UUID
    post_slug: str
    post_title: str
    parent_id: UUID | None = None
    body: str
    status: str
    created_at: datetime
    updated_at: datetime
    reply_count: int = 0
    parent: BlogMyCommentParentContext | None = None
    last_reply: BlogMyCommentLastReplyContext | None = None


class BlogMyCommentListResponse(BaseModel):
    items: list[BlogMyCommentRead]
    meta: PaginationMeta
