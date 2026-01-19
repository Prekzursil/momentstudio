import enum
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.order import Order
from app.models.user import User


class PromotionDiscountType(str, enum.Enum):
    percent = "percent"
    amount = "amount"
    free_shipping = "free_shipping"


class CouponVisibility(str, enum.Enum):
    public = "public"
    assigned = "assigned"


class CouponBulkJobAction(str, enum.Enum):
    assign = "assign"
    revoke = "revoke"


class CouponBulkJobStatus(str, enum.Enum):
    pending = "pending"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"
    cancelled = "cancelled"


class PromotionScopeEntityType(str, enum.Enum):
    product = "product"
    category = "category"


class PromotionScopeMode(str, enum.Enum):
    include = "include"
    exclude = "exclude"


class Promotion(Base):
    __tablename__ = "promotions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    key: Mapped[str | None] = mapped_column(String(80), unique=True, nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    discount_type: Mapped[PromotionDiscountType] = mapped_column(
        Enum(PromotionDiscountType, native_enum=False),
        nullable=False,
        default=PromotionDiscountType.percent,
    )
    percentage_off: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    amount_off: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    max_discount_amount: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    min_subtotal: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    allow_on_sale_items: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_automatic: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    coupons: Mapped[list["Coupon"]] = relationship(
        "Coupon", back_populates="promotion", cascade="all, delete-orphan", lazy="selectin"
    )
    scopes: Mapped[list["PromotionScope"]] = relationship(
        "PromotionScope", back_populates="promotion", cascade="all, delete-orphan", lazy="selectin"
    )


class Coupon(Base):
    __tablename__ = "coupons"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    promotion_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("promotions.id"), nullable=False)
    code: Mapped[str] = mapped_column(String(40), unique=True, nullable=False, index=True)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    visibility: Mapped[CouponVisibility] = mapped_column(
        Enum(CouponVisibility, native_enum=False),
        nullable=False,
        default=CouponVisibility.public,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    global_max_redemptions: Mapped[int | None] = mapped_column(Integer, nullable=True)
    per_customer_max_redemptions: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    promotion: Mapped[Promotion] = relationship("Promotion", back_populates="coupons")
    assignments: Mapped[list["CouponAssignment"]] = relationship(
        "CouponAssignment", back_populates="coupon", cascade="all, delete-orphan", lazy="selectin"
    )


class PromotionScope(Base):
    __tablename__ = "promotion_scopes"
    __table_args__ = (UniqueConstraint("promotion_id", "entity_type", "entity_id", name="uq_promotion_scopes_promotion_type_entity"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    promotion_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("promotions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    entity_type: Mapped[PromotionScopeEntityType] = mapped_column(
        Enum(PromotionScopeEntityType, native_enum=False),
        nullable=False,
    )
    entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    mode: Mapped[PromotionScopeMode] = mapped_column(
        Enum(PromotionScopeMode, native_enum=False),
        nullable=False,
        default=PromotionScopeMode.include,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    promotion: Mapped[Promotion] = relationship("Promotion", back_populates="scopes")


class CouponAssignment(Base):
    __tablename__ = "coupon_assignments"
    __table_args__ = (UniqueConstraint("coupon_id", "user_id", name="uq_coupon_assignments_coupon_user"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    coupon_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("coupons.id"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)

    coupon: Mapped[Coupon] = relationship("Coupon", back_populates="assignments")
    user: Mapped[User] = relationship("User")


class CouponReservation(Base):
    __tablename__ = "coupon_reservations"
    __table_args__ = (UniqueConstraint("order_id", name="uq_coupon_reservations_order"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    coupon_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("coupons.id"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    order_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("orders.id"), nullable=False)
    reserved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    discount_ron: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, default=0)
    shipping_discount_ron: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, default=0)

    coupon: Mapped[Coupon] = relationship("Coupon")
    user: Mapped[User] = relationship("User")
    order: Mapped[Order] = relationship("Order")


class CouponRedemption(Base):
    __tablename__ = "coupon_redemptions"
    __table_args__ = (UniqueConstraint("order_id", name="uq_coupon_redemptions_order"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    coupon_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("coupons.id"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    order_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("orders.id"), nullable=False)
    redeemed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    discount_ron: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, default=0)
    shipping_discount_ron: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, default=0)
    voided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    void_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)

    coupon: Mapped[Coupon] = relationship("Coupon")
    user: Mapped[User] = relationship("User")
    order: Mapped[Order] = relationship("Order")


class CouponBulkJob(Base):
    __tablename__ = "coupon_bulk_jobs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    coupon_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("coupons.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    action: Mapped[CouponBulkJobAction] = mapped_column(
        Enum(CouponBulkJobAction, native_enum=False),
        nullable=False,
        default=CouponBulkJobAction.assign,
    )
    status: Mapped[CouponBulkJobStatus] = mapped_column(
        Enum(CouponBulkJobStatus, native_enum=False),
        nullable=False,
        default=CouponBulkJobStatus.pending,
    )
    require_marketing_opt_in: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    require_email_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    send_email: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    revoke_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)

    total_candidates: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    processed: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    restored: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    already_active: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    revoked: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    already_revoked: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    not_assigned: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    error_message: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    coupon: Mapped[Coupon] = relationship("Coupon")
    created_by: Mapped[User | None] = relationship("User")
