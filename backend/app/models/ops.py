import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class MaintenanceBanner(Base):
    __tablename__ = "maintenance_banners"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true", index=True)
    level: Mapped[str] = mapped_column(String(20), nullable=False, default="info", index=True)

    message_en: Mapped[str] = mapped_column(Text, nullable=False)
    message_ro: Mapped[str] = mapped_column(Text, nullable=False)

    link_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    link_label_en: Mapped[str | None] = mapped_column(String(120), nullable=True)
    link_label_ro: Mapped[str | None] = mapped_column(String(120), nullable=True)

    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
