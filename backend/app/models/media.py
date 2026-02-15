from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class MediaAssetType(str, enum.Enum):
    image = "image"
    video = "video"
    document = "document"


class MediaAssetStatus(str, enum.Enum):
    draft = "draft"
    approved = "approved"
    rejected = "rejected"
    archived = "archived"
    trashed = "trashed"


class MediaVisibility(str, enum.Enum):
    public = "public"
    private = "private"


class MediaJobType(str, enum.Enum):
    ingest = "ingest"
    variant = "variant"
    edit = "edit"
    ai_tag = "ai_tag"
    duplicate_scan = "duplicate_scan"
    usage_reconcile = "usage_reconcile"


class MediaJobStatus(str, enum.Enum):
    queued = "queued"
    processing = "processing"
    completed = "completed"
    failed = "failed"
    dead_letter = "dead_letter"


class MediaAsset(Base):
    __tablename__ = "media_assets"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asset_type: Mapped[MediaAssetType] = mapped_column(Enum(MediaAssetType), nullable=False, index=True)
    status: Mapped[MediaAssetStatus] = mapped_column(
        Enum(MediaAssetStatus), nullable=False, default=MediaAssetStatus.draft, index=True
    )
    visibility: Mapped[MediaVisibility] = mapped_column(
        Enum(MediaVisibility), nullable=False, default=MediaVisibility.private, index=True
    )
    source_kind: Mapped[str] = mapped_column(String(64), nullable=False, default="upload", index=True)
    source_ref: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    storage_key: Mapped[str] = mapped_column(String(512), nullable=False, unique=True)
    public_url: Mapped[str] = mapped_column(String(512), nullable=False, unique=True)
    original_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    checksum_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    perceptual_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    dedupe_group: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    rights_license: Mapped[str | None] = mapped_column(String(120), nullable=True)
    rights_owner: Mapped[str | None] = mapped_column(String(255), nullable=True)
    rights_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    approved_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    trashed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    i18n: Mapped[list["MediaAssetI18n"]] = relationship(
        "MediaAssetI18n", back_populates="asset", cascade="all, delete-orphan", lazy="selectin"
    )
    tags: Mapped[list["MediaAssetTag"]] = relationship(
        "MediaAssetTag", back_populates="asset", cascade="all, delete-orphan", lazy="selectin"
    )
    variants: Mapped[list["MediaVariant"]] = relationship(
        "MediaVariant", back_populates="asset", cascade="all, delete-orphan", lazy="selectin"
    )
    usage_edges: Mapped[list["MediaUsageEdge"]] = relationship(
        "MediaUsageEdge", back_populates="asset", cascade="all, delete-orphan", lazy="selectin"
    )
    approval_events: Mapped[list["MediaApprovalEvent"]] = relationship(
        "MediaApprovalEvent", back_populates="asset", cascade="all, delete-orphan", lazy="selectin"
    )


class MediaAssetI18n(Base):
    __tablename__ = "media_asset_i18n"
    __table_args__ = (UniqueConstraint("asset_id", "lang", name="uq_media_asset_i18n_asset_lang"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asset_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("media_assets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    lang: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    alt_text: Mapped[str | None] = mapped_column(String(255), nullable=True)
    caption: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    asset: Mapped[MediaAsset] = relationship("MediaAsset", back_populates="i18n")


class MediaTag(Base):
    __tablename__ = "media_tags"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    value: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class MediaAssetTag(Base):
    __tablename__ = "media_asset_tags"
    __table_args__ = (UniqueConstraint("asset_id", "tag_id", name="uq_media_asset_tags_asset_tag"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asset_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("media_assets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    tag_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("media_tags.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    asset: Mapped[MediaAsset] = relationship("MediaAsset", back_populates="tags")
    tag: Mapped[MediaTag] = relationship("MediaTag", lazy="joined")


class MediaVariant(Base):
    __tablename__ = "media_variants"
    __table_args__ = (UniqueConstraint("asset_id", "profile", name="uq_media_variant_asset_profile"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asset_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("media_assets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    profile: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    format: Mapped[str | None] = mapped_column(String(24), nullable=True)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    storage_key: Mapped[str] = mapped_column(String(512), nullable=False)
    public_url: Mapped[str] = mapped_column(String(512), nullable=False)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    asset: Mapped[MediaAsset] = relationship("MediaAsset", back_populates="variants")


class MediaUsageEdge(Base):
    __tablename__ = "media_usage_edges"
    __table_args__ = (
        UniqueConstraint(
            "asset_id",
            "source_type",
            "source_key",
            "field_path",
            "lang",
            name="uq_media_usage_edges_asset_source",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asset_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("media_assets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    source_key: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    source_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    field_path: Mapped[str] = mapped_column(String(255), nullable=False)
    lang: Mapped[str | None] = mapped_column(String(10), nullable=True, index=True)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    asset: Mapped[MediaAsset] = relationship("MediaAsset", back_populates="usage_edges")


class MediaJob(Base):
    __tablename__ = "media_jobs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asset_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("media_assets.id", ondelete="SET NULL"), nullable=True, index=True
    )
    job_type: Mapped[MediaJobType] = mapped_column(Enum(MediaJobType), nullable=False, index=True)
    status: Mapped[MediaJobStatus] = mapped_column(
        Enum(MediaJobStatus), nullable=False, default=MediaJobStatus.queued, index=True
    )
    payload_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    progress_pct: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    attempt: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    next_retry_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    last_error_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    dead_lettered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    triage_state: Mapped[str] = mapped_column(String(32), nullable=False, default="open", index=True)
    assigned_to_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    sla_due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    incident_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(120), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    asset: Mapped[MediaAsset | None] = relationship("MediaAsset", lazy="selectin")
    events: Mapped[list["MediaJobEvent"]] = relationship(
        "MediaJobEvent", back_populates="job", cascade="all, delete-orphan", lazy="selectin"
    )
    tags: Mapped[list["MediaJobTagLink"]] = relationship(
        "MediaJobTagLink", back_populates="job", cascade="all, delete-orphan", lazy="selectin"
    )


class MediaJobEvent(Base):
    __tablename__ = "media_job_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("media_jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    action: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    meta_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    job: Mapped[MediaJob] = relationship("MediaJob", back_populates="events")


class MediaJobTag(Base):
    __tablename__ = "media_job_tags"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    value: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class MediaJobTagLink(Base):
    __tablename__ = "media_job_tag_links"
    __table_args__ = (UniqueConstraint("job_id", "tag_id", name="uq_media_job_tag_links_job_tag"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("media_jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    tag_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("media_job_tags.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    job: Mapped[MediaJob] = relationship("MediaJob", back_populates="tags")
    tag: Mapped[MediaJobTag] = relationship("MediaJobTag", lazy="joined")


class MediaCollection(Base):
    __tablename__ = "media_collections"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    slug: Mapped[str] = mapped_column(String(190), nullable=False, unique=True, index=True)
    visibility: Mapped[MediaVisibility] = mapped_column(
        Enum(MediaVisibility), nullable=False, default=MediaVisibility.private, index=True
    )
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    items: Mapped[list["MediaCollectionItem"]] = relationship(
        "MediaCollectionItem", back_populates="collection", cascade="all, delete-orphan", lazy="selectin"
    )


class MediaCollectionItem(Base):
    __tablename__ = "media_collection_items"
    __table_args__ = (
        UniqueConstraint("collection_id", "asset_id", name="uq_media_collection_items_collection_asset"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    collection_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("media_collections.id", ondelete="CASCADE"), nullable=False, index=True
    )
    asset_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("media_assets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    collection: Mapped[MediaCollection] = relationship("MediaCollection", back_populates="items")
    asset: Mapped[MediaAsset] = relationship("MediaAsset", lazy="joined")


class MediaApprovalEvent(Base):
    __tablename__ = "media_approval_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asset_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("media_assets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    from_status: Mapped[MediaAssetStatus | None] = mapped_column(Enum(MediaAssetStatus), nullable=True)
    to_status: Mapped[MediaAssetStatus] = mapped_column(Enum(MediaAssetStatus), nullable=False)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    asset: Mapped[MediaAsset] = relationship("MediaAsset", back_populates="approval_events")
