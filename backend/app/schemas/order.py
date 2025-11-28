from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class OrderItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    product_id: UUID
    variant_id: UUID | None = None
    quantity: int
    unit_price: float
    subtotal: float


class OrderRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    status: str
    total_amount: float
    currency: str
    shipping_address_id: UUID | None = None
    billing_address_id: UUID | None = None
    created_at: datetime
    updated_at: datetime
    items: list[OrderItemRead] = []
