from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from app.models.order import OrderStatus
from app.schemas.address import AddressRead
from app.schemas.order import OrderRead


class AdminPaginationMeta(BaseModel):
    total_items: int
    total_pages: int
    page: int
    limit: int


class AdminOrderListItem(BaseModel):
    id: UUID
    reference_code: str | None
    status: OrderStatus
    total_amount: float
    currency: str
    created_at: datetime
    customer_email: str | None = None
    customer_username: str | None = None


class AdminOrderListResponse(BaseModel):
    items: list[AdminOrderListItem]
    meta: AdminPaginationMeta


class AdminOrderRead(OrderRead):
    customer_email: str | None = None
    customer_username: str | None = None
    shipping_address: AddressRead | None = None
    billing_address: AddressRead | None = None

