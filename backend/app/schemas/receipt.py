from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ReceiptAddressRead(BaseModel):
    line1: str = Field(min_length=1, max_length=200)
    line2: str | None = Field(default=None, max_length=200)
    city: str = Field(min_length=1, max_length=100)
    region: str | None = Field(default=None, max_length=100)
    postal_code: str = Field(min_length=1, max_length=20)
    country: str = Field(min_length=2, max_length=2)


class ReceiptItemRead(BaseModel):
    product_id: UUID
    slug: str | None = None
    name: str
    quantity: int
    unit_price: float
    subtotal: float
    product_url: str | None = None


class ReceiptRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    order_id: UUID
    reference_code: str | None = None
    status: str
    created_at: datetime
    currency: str
    payment_method: str | None = None
    courier: str | None = None
    delivery_type: str | None = None
    locker_name: str | None = None
    locker_address: str | None = None
    tracking_number: str | None = None
    customer_email: str | None = None
    customer_name: str | None = None
    shipping_amount: float | None = None
    tax_amount: float | None = None
    total_amount: float | None = None
    shipping_address: ReceiptAddressRead | None = None
    billing_address: ReceiptAddressRead | None = None
    items: list[ReceiptItemRead] = Field(default_factory=list)

