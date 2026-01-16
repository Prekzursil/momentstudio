import uuid
from datetime import datetime
import enum

from sqlalchemy import DateTime, ForeignKey, Numeric, String, func, Enum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.address import Address
from app.models.catalog import Product, ProductVariant
from app.models.user import User


class OrderStatus(str, enum.Enum):
    pending = "pending"
    paid = "paid"
    shipped = "shipped"
    cancelled = "cancelled"
    refunded = "refunded"


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    status: Mapped[OrderStatus] = mapped_column(Enum(OrderStatus), nullable=False, default=OrderStatus.pending)
    reference_code: Mapped[str | None] = mapped_column(String(20), unique=True, nullable=True)
    customer_email: Mapped[str] = mapped_column(String(255), nullable=False)
    customer_name: Mapped[str] = mapped_column(String(255), nullable=False)
    shipping_method_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("shipping_methods.id"), nullable=True)
    tracking_number: Mapped[str | None] = mapped_column(String(50), nullable=True)
    tracking_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    shipping_label_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    shipping_label_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    shipping_label_uploaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    tax_amount: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False, default=0)
    shipping_amount: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False, default=0)
    total_amount: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    payment_retry_count: Mapped[int] = mapped_column(default=0, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="RON")
    payment_method: Mapped[str] = mapped_column(String(20), nullable=False, default="stripe")
    courier: Mapped[str | None] = mapped_column(String(30), nullable=True)
    delivery_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    locker_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    locker_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    locker_address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    locker_lat: Mapped[float | None] = mapped_column(Numeric(9, 6), nullable=True)
    locker_lng: Mapped[float | None] = mapped_column(Numeric(9, 6), nullable=True)
    stripe_payment_intent_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    paypal_order_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    paypal_capture_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    shipping_address_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("addresses.id"), nullable=True
    )
    billing_address_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("addresses.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    user: Mapped[User | None] = relationship("User")
    shipping_address: Mapped[Address | None] = relationship("Address", foreign_keys=[shipping_address_id])
    billing_address: Mapped[Address | None] = relationship("Address", foreign_keys=[billing_address_id])
    items: Mapped[list["OrderItem"]] = relationship(
        "OrderItem", back_populates="order", cascade="all, delete-orphan", lazy="selectin"
    )
    shipping_method: Mapped["ShippingMethod | None"] = relationship("ShippingMethod", lazy="selectin")
    events: Mapped[list["OrderEvent"]] = relationship(
        "OrderEvent",
        back_populates="order",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="OrderEvent.created_at",
    )


class OrderItem(Base):
    __tablename__ = "order_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("orders.id"), nullable=False)
    product_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("products.id"), nullable=False)
    variant_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("product_variants.id"), nullable=True)
    quantity: Mapped[int] = mapped_column(nullable=False, default=1)
    shipped_quantity: Mapped[int] = mapped_column(nullable=False, default=0)
    unit_price: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    subtotal: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    order: Mapped[Order] = relationship("Order", back_populates="items")
    product: Mapped[Product] = relationship("Product")
    variant: Mapped[ProductVariant | None] = relationship("ProductVariant")


class ShippingMethod(Base):
    __tablename__ = "shipping_methods"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    rate_flat: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    rate_per_kg: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class OrderEvent(Base):
    __tablename__ = "order_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("orders.id"), nullable=False)
    event: Mapped[str] = mapped_column(String(50), nullable=False)
    note: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    order: Mapped[Order] = relationship("Order", back_populates="events")
