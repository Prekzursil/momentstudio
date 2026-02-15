from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


MediaAssetTypeLiteral = Literal["image", "video", "document"]
MediaAssetStatusLiteral = Literal["draft", "approved", "rejected", "archived", "trashed"]
MediaVisibilityLiteral = Literal["public", "private"]
MediaJobStatusLiteral = Literal["queued", "processing", "completed", "failed"]
MediaJobTypeLiteral = Literal["ingest", "variant", "edit", "ai_tag", "duplicate_scan"]


class MediaAssetI18nRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    lang: Literal["en", "ro"]
    title: str | None = None
    alt_text: str | None = None
    caption: str | None = None
    description: str | None = None


class MediaVariantRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    profile: str
    format: str | None = None
    width: int | None = None
    height: int | None = None
    public_url: str
    size_bytes: int | None = None
    created_at: datetime


class MediaAssetRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    asset_type: MediaAssetTypeLiteral
    status: MediaAssetStatusLiteral
    visibility: MediaVisibilityLiteral
    source_kind: str
    source_ref: str | None = None
    storage_key: str
    public_url: str
    original_filename: str | None = None
    mime_type: str | None = None
    size_bytes: int | None = None
    width: int | None = None
    height: int | None = None
    duration_ms: int | None = None
    page_count: int | None = None
    checksum_sha256: str | None = None
    perceptual_hash: str | None = None
    dedupe_group: str | None = None
    rights_license: str | None = None
    rights_owner: str | None = None
    rights_notes: str | None = None
    approved_at: datetime | None = None
    trashed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    tags: list[str] = Field(default_factory=list)
    i18n: list[MediaAssetI18nRead] = Field(default_factory=list)
    variants: list[MediaVariantRead] = Field(default_factory=list)


class MediaAssetListResponse(BaseModel):
    items: list[MediaAssetRead]
    meta: dict[str, int]


class MediaAssetUpdateI18nItem(BaseModel):
    lang: Literal["en", "ro"]
    title: str | None = Field(default=None, max_length=255)
    alt_text: str | None = Field(default=None, max_length=255)
    caption: str | None = None
    description: str | None = None


class MediaAssetUpdateRequest(BaseModel):
    status: MediaAssetStatusLiteral | None = None
    visibility: MediaVisibilityLiteral | None = None
    rights_license: str | None = Field(default=None, max_length=120)
    rights_owner: str | None = Field(default=None, max_length=255)
    rights_notes: str | None = None
    tags: list[str] | None = None
    i18n: list[MediaAssetUpdateI18nItem] | None = None


class MediaAssetUploadResponse(BaseModel):
    asset: MediaAssetRead
    ingest_job_id: UUID | None = None


class MediaFinalizeRequest(BaseModel):
    run_ai_tagging: bool = True
    run_duplicate_scan: bool = True


class MediaApproveRequest(BaseModel):
    note: str | None = None


class MediaRejectRequest(BaseModel):
    note: str | None = None


class MediaVariantRequest(BaseModel):
    profile: str = Field(default="web-1280", min_length=1, max_length=64)


class MediaEditRequest(BaseModel):
    rotate_cw: int = 0
    crop_aspect_w: int | None = Field(default=None, ge=1, le=1000)
    crop_aspect_h: int | None = Field(default=None, ge=1, le=1000)
    resize_max_width: int | None = Field(default=None, ge=1, le=12000)
    resize_max_height: int | None = Field(default=None, ge=1, le=12000)


class MediaUsageEdgeRead(BaseModel):
    source_type: str
    source_key: str
    source_id: str | None = None
    field_path: str
    lang: str | None = None
    last_seen_at: datetime


class MediaUsageResponse(BaseModel):
    asset_id: UUID
    public_url: str
    items: list[MediaUsageEdgeRead]


class MediaJobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    asset_id: UUID | None = None
    job_type: MediaJobTypeLiteral
    status: MediaJobStatusLiteral
    progress_pct: int
    attempt: int
    error_code: str | None = None
    error_message: str | None = None
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None


class MediaCollectionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    slug: str
    visibility: MediaVisibilityLiteral
    created_at: datetime
    updated_at: datetime
    item_count: int = 0


class MediaCollectionUpsertRequest(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    slug: str = Field(min_length=1, max_length=190)
    visibility: MediaVisibilityLiteral = "private"


class MediaCollectionItemsRequest(BaseModel):
    asset_ids: list[UUID] = Field(default_factory=list)

