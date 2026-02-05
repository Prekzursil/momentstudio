import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.user import User


class ContactSubmissionTopic(str, enum.Enum):
    contact = "contact"
    support = "support"
    refund = "refund"
    dispute = "dispute"
    feedback = "feedback"


class ContactSubmissionStatus(str, enum.Enum):
    new = "new"
    triaged = "triaged"
    resolved = "resolved"


class ContactSubmission(Base):
    __tablename__ = "contact_submissions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    topic: Mapped[ContactSubmissionTopic] = mapped_column(
        Enum(ContactSubmissionTopic, name="contact_submission_topic"),
        nullable=False,
        default=ContactSubmissionTopic.contact,
    )
    status: Mapped[ContactSubmissionStatus] = mapped_column(
        Enum(ContactSubmissionStatus, name="contact_submission_status"),
        nullable=False,
        default=ContactSubmissionStatus.new,
        index=True,
    )

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    order_reference: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)

    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    assignee_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    assigned_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    assigned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    admin_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[User | None] = relationship("User", foreign_keys=[user_id], lazy="joined")
    assignee: Mapped[User | None] = relationship("User", foreign_keys=[assignee_user_id], lazy="joined")
    assigned_by: Mapped[User | None] = relationship("User", foreign_keys=[assigned_by_user_id], lazy="joined")
    messages: Mapped[list["ContactSubmissionMessage"]] = relationship(
        "ContactSubmissionMessage",
        back_populates="submission",
        cascade="all, delete-orphan",
        order_by="ContactSubmissionMessage.created_at",
        lazy="selectin",
    )


class ContactSubmissionMessage(Base):
    __tablename__ = "contact_submission_messages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    submission_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("contact_submissions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    from_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    submission: Mapped[ContactSubmission] = relationship("ContactSubmission", back_populates="messages")


class SupportCannedResponse(Base):
    __tablename__ = "support_canned_responses"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    body_en: Mapped[str] = mapped_column(Text, nullable=False)
    body_ro: Mapped[str] = mapped_column(Text, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true", index=True)

    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    updated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    created_by: Mapped[User | None] = relationship("User", foreign_keys=[created_by_user_id], lazy="joined")
    updated_by: Mapped[User | None] = relationship("User", foreign_keys=[updated_by_user_id], lazy="joined")
