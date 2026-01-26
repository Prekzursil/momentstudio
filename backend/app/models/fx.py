import uuid
from datetime import date, datetime

import sqlalchemy as sa
from sqlalchemy import Boolean, Date, DateTime, Numeric, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class FxRate(Base):
    __tablename__ = "fx_rates"
    __table_args__ = (UniqueConstraint("is_override", name="uq_fx_rates_is_override"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    base: Mapped[str] = mapped_column(String(3), nullable=False, server_default="RON")
    eur_per_ron: Mapped[float] = mapped_column(Numeric(12, 8), nullable=False)
    usd_per_ron: Mapped[float] = mapped_column(Numeric(12, 8), nullable=False)
    as_of: Mapped[date] = mapped_column(Date, nullable=False)
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    is_override: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=sa.false())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class FxOverrideAuditLog(Base):
    __tablename__ = "fx_override_audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    action: Mapped[str] = mapped_column(String(24), nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    eur_per_ron: Mapped[float | None] = mapped_column(Numeric(12, 8), nullable=True)
    usd_per_ron: Mapped[float | None] = mapped_column(Numeric(12, 8), nullable=True)
    as_of: Mapped[date | None] = mapped_column(Date, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
