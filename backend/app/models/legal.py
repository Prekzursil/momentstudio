import enum
import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Enum, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class LegalConsentContext(str, enum.Enum):
    register = "register"
    checkout = "checkout"


class LegalConsent(Base):
    __tablename__ = "legal_consents"
    __table_args__ = (CheckConstraint("user_id IS NOT NULL OR order_id IS NOT NULL", name="ck_legal_consents_subject"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    doc_key: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    doc_version: Mapped[int] = mapped_column(Integer, nullable=False)
    context: Mapped[LegalConsentContext] = mapped_column(
        Enum(LegalConsentContext, native_enum=False), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    order_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("orders.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    accepted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    user = relationship("User", foreign_keys=[user_id])
    order = relationship("Order", foreign_keys=[order_id])

