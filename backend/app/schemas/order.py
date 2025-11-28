from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.order import OrderStatus


class ShippingMethodBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    rate_flat: float | None = Field(default=None, ge=0)
    rate_per_kg: float | None = Field(default=None, ge=0)


class ShippingMethodCreate(ShippingMethodBase):
    pass


class ShippingMethodRead(ShippingMethodBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime


class OrderItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    product_id: UUID
    variant_id: UUID | None = None
    quantity: int
    shipped_quantity: int
    unit_price: float
    subtotal: float


class OrderRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    reference_code: str | None = None
    status: OrderStatus
    payment_retry_count: int
    total_amount: float
    tax_amount: float
    shipping_amount: float
    currency: str
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
    tracking_number: str | None = Field(default=None, max_length=50)
    shipping_method_id: UUID | None = None
    shipped_quantity: int | None = Field(default=None, ge=0)


class OrderEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    event: str
    note: str | None = None
    created_at: datetime


OrderRead.model_rebuild()
