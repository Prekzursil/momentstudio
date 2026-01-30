from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, JSON, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.order import Order
from app.models.user import User


class OrderDocumentExportKind(str, enum.Enum):
    packing_slip = "packing_slip"
    packing_slips_batch = "packing_slips_batch"
    shipping_label = "shipping_label"
    receipt = "receipt"


class OrderDocumentExport(Base):
    __tablename__ = "order_document_exports"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    kind: Mapped[OrderDocumentExportKind] = mapped_column(
        Enum(OrderDocumentExportKind, native_enum=False),
        nullable=False,
        index=True,
    )
    order_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orders.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    order_ids: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False, default="application/pdf", server_default="application/pdf")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    order: Mapped[Order | None] = relationship("Order", lazy="joined")
    created_by: Mapped[User | None] = relationship("User", lazy="joined")

