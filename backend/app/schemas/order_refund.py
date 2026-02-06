from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class OrderRefundItem(BaseModel):
    order_item_id: UUID
    quantity: int = Field(ge=1)


class AdminOrderRefundRequest(BaseModel):
    password: str | None = Field(default=None, max_length=200)
    note: str | None = Field(default=None, max_length=2000)


class AdminOrderRefundCreate(BaseModel):
    password: str | None = Field(default=None, max_length=200)
    amount: Decimal = Field(gt=0)
    note: str = Field(min_length=1, max_length=2000)
    items: list[OrderRefundItem] = Field(default_factory=list, max_length=200)
    process_payment: bool = False


class OrderRefundRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    order_id: UUID
    amount: Decimal
    currency: str
    provider: str
    provider_refund_id: str | None = None
    note: str | None = None
    data: dict | None = None
    created_at: datetime
