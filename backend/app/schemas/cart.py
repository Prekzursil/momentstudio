from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class Totals(BaseModel):
    subtotal: Decimal
    fee: Decimal = Decimal("0.00")
    tax: Decimal
    shipping: Decimal
    total: Decimal
    currency: str | None = "RON"


class CartItemCreate(BaseModel):
    product_id: UUID
    variant_id: UUID | None = None
    quantity: int = Field(ge=1)
    max_quantity: int | None = Field(default=None, ge=1)
    note: str | None = Field(default=None, max_length=255)


class CartItemUpdate(BaseModel):
    quantity: int = Field(ge=1)
    note: str | None = Field(default=None, max_length=255)


class CartItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    product_id: UUID
    variant_id: UUID | None = None
    quantity: int
    max_quantity: int | None = None
    note: str | None = None
    unit_price_at_add: Decimal
    name: str | None = None
    slug: str | None = None
    image_url: str | None = None
    currency: str | None = "RON"


class CartRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID | None = None
    session_id: str | None = None
    items: list[CartItemRead] = []
    totals: Totals | None = None
