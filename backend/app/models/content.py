import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import JSON, Integer

from app.db.base import Base


class ContentStatus(str, enum.Enum):
    draft = "draft"
    published = "published"


class ContentBlock(Base):
    __tablename__ = "content_blocks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    key: Mapped[str] = mapped_column(String(120), unique=True, nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body_markdown: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[ContentStatus] = mapped_column(Enum(ContentStatus), nullable=False, default=ContentStatus.draft)
    version: Mapped[int] = mapped_column(nullable=False, default=1)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    meta: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    versions: Mapped[list["ContentBlockVersion"]] = relationship(
        "ContentBlockVersion", back_populates="block", cascade="all, delete-orphan", lazy="selectin"
    )
    images: Mapped[list["ContentImage"]] = relationship(
        "ContentImage", back_populates="block", cascade="all, delete-orphan", lazy="selectin", order_by="ContentImage.sort_order"
    )


class ContentBlockVersion(Base):
    __tablename__ = "content_block_versions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    content_block_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("content_blocks.id"), nullable=False)
    version: Mapped[int] = mapped_column(nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body_markdown: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[ContentStatus] = mapped_column(Enum(ContentStatus), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    block: Mapped[ContentBlock] = relationship("ContentBlock", back_populates="versions")


class ContentImage(Base):
    __tablename__ = "content_images"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    content_block_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("content_blocks.id"), nullable=False)
    url: Mapped[str] = mapped_column(String(255), nullable=False)
    alt_text: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    block: Mapped[ContentBlock] = relationship("ContentBlock", back_populates="images")
