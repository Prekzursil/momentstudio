import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class TaxGroup(Base):
    __tablename__ = "tax_groups"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(40), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    rates: Mapped[list["TaxRate"]] = relationship(
        "TaxRate", back_populates="group", cascade="all, delete-orphan", lazy="selectin"
    )


class TaxRate(Base):
    __tablename__ = "tax_rates"
    __table_args__ = (UniqueConstraint("group_id", "country_code", name="uq_tax_rates_group_country"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tax_groups.id", ondelete="CASCADE"), nullable=False, index=True
    )
    country_code: Mapped[str] = mapped_column(String(2), nullable=False, index=True)
    vat_rate_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=Decimal("0.00"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    group: Mapped[TaxGroup] = relationship("TaxGroup", back_populates="rates")

