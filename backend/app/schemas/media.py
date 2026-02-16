from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


MediaAssetTypeLiteral = Literal["image", "video", "document"]
MediaAssetStatusLiteral = Literal["draft", "approved", "rejected", "archived", "trashed"]
MediaVisibilityLiteral = Literal["public", "private"]
MediaJobStatusLiteral = Literal["queued", "processing", "completed", "failed", "dead_letter"]
MediaJobTypeLiteral = Literal["ingest", "variant", "edit", "ai_tag", "duplicate_scan", "usage_reconcile"]
MediaJobTriageStateLiteral = Literal["open", "retrying", "ignored", "resolved"]
MediaRetryPolicyJobTypeLiteral = MediaJobTypeLiteral


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
    preview_url: str | None = None
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
    max_attempts: int = 5
    next_retry_at: datetime | None = None
    last_error_at: datetime | None = None
    dead_lettered_at: datetime | None = None
    triage_state: MediaJobTriageStateLiteral = "open"
    assigned_to_user_id: UUID | None = None
    sla_due_at: datetime | None = None
    incident_url: str | None = None
    tags: list[str] = Field(default_factory=list)
    error_code: str | None = None
    error_message: str | None = None
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None


class MediaJobListResponse(BaseModel):
    items: list[MediaJobRead]
    meta: dict[str, int]


class MediaJobEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    job_id: UUID
    actor_user_id: UUID | None = None
    action: str
    note: str | None = None
    meta_json: str | None = None
    created_at: datetime


class MediaJobEventsResponse(BaseModel):
    items: list[MediaJobEventRead]


class MediaRetryPolicyRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    job_type: MediaRetryPolicyJobTypeLiteral
    max_attempts: int
    backoff_schedule_seconds: list[int] = Field(default_factory=list)
    jitter_ratio: float
    enabled: bool = True
    updated_by_user_id: UUID | None = None
    created_at: datetime
    updated_at: datetime


class MediaRetryPolicyListResponse(BaseModel):
    items: list[MediaRetryPolicyRead]


class MediaRetryPolicyUpdateRequest(BaseModel):
    max_attempts: int | None = Field(default=None, ge=1, le=20)
    backoff_schedule_seconds: list[int] | None = Field(default=None, min_length=1, max_length=20)
    jitter_ratio: float | None = Field(default=None, ge=0.0, le=1.0)
    enabled: bool | None = None


class MediaJobRetryBulkRequest(BaseModel):
    job_ids: list[UUID] = Field(default_factory=list, min_length=1, max_length=200)


class MediaJobTriageUpdateRequest(BaseModel):
    triage_state: MediaJobTriageStateLiteral | None = None
    assigned_to_user_id: UUID | None = None
    clear_assignee: bool = False
    sla_due_at: datetime | None = None
    clear_sla_due_at: bool = False
    incident_url: str | None = Field(default=None, max_length=512)
    clear_incident_url: bool = False
    add_tags: list[str] = Field(default_factory=list)
    remove_tags: list[str] = Field(default_factory=list)
    note: str | None = None


class MediaTelemetryWorkerRead(BaseModel):
    worker_id: str
    hostname: str | None = None
    pid: int | None = None
    app_version: str | None = None
    last_seen_at: datetime
    lag_seconds: int


class MediaTelemetryResponse(BaseModel):
    queue_depth: int
    online_workers: int
    workers: list[MediaTelemetryWorkerRead]
    stale_processing_count: int
    dead_letter_count: int = 0
    sla_breached_count: int = 0
    retry_scheduled_count: int = 0
    oldest_queued_age_seconds: int | None = None
    avg_processing_seconds: int | None = None
    status_counts: dict[str, int] = Field(default_factory=dict)
    type_counts: dict[str, int] = Field(default_factory=dict)


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
