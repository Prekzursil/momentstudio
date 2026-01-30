from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, JSON, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.order import Order
from app.models.user import User


class AnalyticsEvent(Base):
    __tablename__ = "analytics_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    event: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    user: Mapped[User | None] = relationship("User", lazy="joined")
    order: Mapped[Order | None] = relationship("Order", lazy="joined")

