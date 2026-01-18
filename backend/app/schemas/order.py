from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.order import OrderStatus


class ShippingMethodBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    rate_flat: Decimal | None = Field(default=None, ge=0)
    rate_per_kg: Decimal | None = Field(default=None, ge=0)


class ShippingMethodCreate(ShippingMethodBase):
    pass


class ShippingMethodRead(ShippingMethodBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime


class OrderItemProductRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    slug: str
    name: str


class OrderItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    product_id: UUID
    variant_id: UUID | None = None
    product: OrderItemProductRead | None = None
    quantity: int
    shipped_quantity: int
    unit_price: Decimal
    subtotal: Decimal


class OrderRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID | None = None
    reference_code: str | None = None
    status: OrderStatus
    cancel_reason: str | None = Field(default=None, max_length=2000)
    courier: str | None = None
    delivery_type: str | None = None
    locker_id: str | None = None
    locker_name: str | None = None
    locker_address: str | None = None
    locker_lat: float | None = None
    locker_lng: float | None = None
    payment_retry_count: int
    total_amount: Decimal
    tax_amount: Decimal
    fee_amount: Decimal = Decimal("0.00")
    shipping_amount: Decimal
    currency: str
    payment_method: str
    stripe_payment_intent_id: str | None = None
    paypal_order_id: str | None = None
    paypal_capture_id: str | None = None
    tracking_number: str | None = None
    shipping_method: ShippingMethodRead | None = None
    shipping_address_id: UUID | None = None
    billing_address_id: UUID | None = None
    items: list[OrderItemRead] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
    events: list["OrderEventRead"] = Field(default_factory=list)


class OrderCreate(BaseModel):
    shipping_address_id: UUID | None = None
    billing_address_id: UUID | None = None
    shipping_method_id: UUID | None = None


class OrderUpdate(BaseModel):
    status: OrderStatus | None = None
    cancel_reason: str | None = Field(default=None, max_length=2000)
    tracking_number: str | None = Field(default=None, max_length=50)
    tracking_url: str | None = Field(default=None, max_length=255)
    shipping_method_id: UUID | None = None
    shipped_quantity: int | None = Field(default=None, ge=0)


class OrderEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    event: str
    note: str | None = None
    created_at: datetime


OrderRead.model_rebuild()
