import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, Integer, Numeric, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AdminDashboardAlertThresholds(Base):
    __tablename__ = "admin_dashboard_alert_thresholds"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    key: Mapped[str] = mapped_column(String(50), nullable=False, unique=True, index=True, server_default="default")

    failed_payments_min_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    failed_payments_min_delta_pct: Mapped[Decimal | None] = mapped_column(Numeric(8, 2), nullable=True)

    refund_requests_min_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    refund_requests_min_rate_pct: Mapped[Decimal | None] = mapped_column(Numeric(8, 2), nullable=True)

    stockouts_min_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

