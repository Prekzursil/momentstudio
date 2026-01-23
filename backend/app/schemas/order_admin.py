from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.order import OrderStatus
from app.schemas.admin_common import AdminPaginationMeta
from app.schemas.address import AddressRead
from app.schemas.order_fraud import AdminOrderFraudSignal
from app.schemas.order import OrderRead
from app.schemas.order_admin_note import OrderAdminNoteRead
from app.schemas.order_refund import OrderRefundRead


class AdminOrderListItem(BaseModel):
    id: UUID
    reference_code: str | None
    status: OrderStatus
    total_amount: Decimal
    currency: str
    created_at: datetime
    customer_email: str | None = None
    customer_username: str | None = None
    tags: list[str] = Field(default_factory=list)


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
    refunds: list[OrderRefundRead] = Field(default_factory=list)
    admin_notes: list[OrderAdminNoteRead] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    fraud_signals: list[AdminOrderFraudSignal] = Field(default_factory=list)


class AdminOrderEmailResendRequest(BaseModel):
    note: str | None = Field(default=None, max_length=255)


class AdminOrderIdsRequest(BaseModel):
    order_ids: list[UUID] = Field(default_factory=list, min_length=1, max_length=100)
