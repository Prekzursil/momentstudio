from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel

from app.models.order import OrderStatus
from app.schemas.admin_common import AdminPaginationMeta
from app.schemas.address import AddressRead
from app.schemas.order import OrderRead


class AdminOrderListItem(BaseModel):
    id: UUID
    reference_code: str | None
    status: OrderStatus
    total_amount: Decimal
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
    tracking_url: str | None = None
    shipping_label_filename: str | None = None
    shipping_label_uploaded_at: datetime | None = None
    has_shipping_label: bool = False
