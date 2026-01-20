import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, String, Text, func, JSON, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

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
    meta: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    lang: Mapped[str | None] = mapped_column(String(10), nullable=True, index=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    versions: Mapped[list["ContentBlockVersion"]] = relationship(
        "ContentBlockVersion", back_populates="block", cascade="all, delete-orphan", lazy="selectin"
    )
    images: Mapped[list["ContentImage"]] = relationship(
        "ContentImage",
        back_populates="block",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="ContentImage.sort_order",
    )
    audits: Mapped[list["ContentAuditLog"]] = relationship(
        "ContentAuditLog",
        back_populates="block",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="ContentAuditLog.created_at",
    )
    translations: Mapped[list["ContentBlockTranslation"]] = relationship(
        "ContentBlockTranslation", back_populates="block", cascade="all, delete-orphan", lazy="selectin"
    )


class ContentBlockVersion(Base):
    __tablename__ = "content_block_versions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    content_block_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("content_blocks.id"), nullable=False)
    version: Mapped[int] = mapped_column(nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body_markdown: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[ContentStatus] = mapped_column(Enum(ContentStatus), nullable=False)
    meta: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    lang: Mapped[str | None] = mapped_column(String(10), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    translations: Mapped[list[dict] | None] = mapped_column(JSON, nullable=True)
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


class ContentAuditLog(Base):
    __tablename__ = "content_audit_log"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    content_block_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("content_blocks.id"), nullable=False)
    action: Mapped[str] = mapped_column(String(120), nullable=False)
    version: Mapped[int] = mapped_column(nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    block: Mapped[ContentBlock] = relationship("ContentBlock", back_populates="audits")


class ContentBlockTranslation(Base):
    __tablename__ = "content_block_translations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    content_block_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("content_blocks.id", ondelete="CASCADE"))
    lang: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body_markdown: Mapped[str] = mapped_column(Text, nullable=False)

    block: Mapped[ContentBlock] = relationship("ContentBlock", back_populates="translations")


class ContentRedirect(Base):
    __tablename__ = "content_redirects"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    from_key: Mapped[str] = mapped_column(String(120), unique=True, nullable=False, index=True)
    to_key: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
