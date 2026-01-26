import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.order import Order, OrderItem
from app.models.user import User


class ReturnRequestStatus(str, enum.Enum):
    requested = "requested"
    approved = "approved"
    rejected = "rejected"
    received = "received"
    refunded = "refunded"
    closed = "closed"


class ReturnRequest(Base):
    __tablename__ = "return_requests"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("orders.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    status: Mapped[ReturnRequestStatus] = mapped_column(
        Enum(ReturnRequestStatus, name="return_request_status"),
        nullable=False,
        default=ReturnRequestStatus.requested,
        index=True,
    )

    reason: Mapped[str] = mapped_column(Text, nullable=False)
    customer_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    admin_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    return_label_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    return_label_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    return_label_uploaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    order: Mapped[Order] = relationship("Order", lazy="joined")
    user: Mapped[User | None] = relationship("User", foreign_keys=[user_id], lazy="joined")
    created_by_user: Mapped[User | None] = relationship("User", foreign_keys=[created_by], lazy="joined")
    updated_by_user: Mapped[User | None] = relationship("User", foreign_keys=[updated_by], lazy="joined")
    items: Mapped[list["ReturnRequestItem"]] = relationship(
        "ReturnRequestItem", back_populates="return_request", cascade="all, delete-orphan", lazy="selectin"
    )


class ReturnRequestItem(Base):
    __tablename__ = "return_request_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    return_request_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("return_requests.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    order_item_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("order_items.id", ondelete="SET NULL"), nullable=True
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    return_request: Mapped[ReturnRequest] = relationship("ReturnRequest", back_populates="items")
    order_item: Mapped[OrderItem | None] = relationship("OrderItem", lazy="joined")
