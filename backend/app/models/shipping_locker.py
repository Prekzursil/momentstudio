from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, Float, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ShippingLockerProvider(str, enum.Enum):
    sameday = "sameday"


class ShippingLockerSyncStatus(str, enum.Enum):
    running = "running"
    success = "success"
    failed = "failed"


class ShippingLockerMirror(Base):
    __tablename__ = "shipping_lockers_mirror"
    __table_args__ = (
        UniqueConstraint(
            "provider",
            "external_id",
            name="uq_shipping_lockers_mirror_provider_external",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    provider: Mapped[ShippingLockerProvider] = mapped_column(
        Enum(ShippingLockerProvider),
        nullable=False,
        default=ShippingLockerProvider.sameday,
        index=True,
    )
    external_id: Mapped[str] = mapped_column(String(128), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    city: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    county: Mapped[str | None] = mapped_column(String(120), nullable=True)
    postal_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    lat: Mapped[float] = mapped_column(Float, nullable=False, index=True)
    lng: Mapped[float] = mapped_column(Float, nullable=False, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    source_payload_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class ShippingLockerSyncRun(Base):
    __tablename__ = "shipping_locker_sync_runs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    provider: Mapped[ShippingLockerProvider] = mapped_column(
        Enum(ShippingLockerProvider),
        nullable=False,
        default=ShippingLockerProvider.sameday,
        index=True,
    )
    status: Mapped[ShippingLockerSyncStatus] = mapped_column(
        Enum(ShippingLockerSyncStatus),
        nullable=False,
        default=ShippingLockerSyncStatus.running,
        index=True,
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    fetched_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    upserted_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    deactivated_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_url_used: Mapped[str | None] = mapped_column(String(512), nullable=True)
    payload_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
