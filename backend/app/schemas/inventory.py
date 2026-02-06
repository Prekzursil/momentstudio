from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.admin_common import AdminPaginationMeta


class RestockNoteUpsert(BaseModel):
    product_id: UUID
    variant_id: UUID | None = None
    supplier: str | None = Field(default=None, max_length=200)
    desired_quantity: int | None = Field(default=None, ge=0)
    note: str | None = Field(default=None, max_length=2000)


class RestockNoteRead(RestockNoteUpsert):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    actor_user_id: UUID | None
    created_at: datetime
    updated_at: datetime


class RestockListItem(BaseModel):
    kind: Literal["product", "variant"]
    product_id: UUID
    variant_id: UUID | None = None
    sku: str
    product_slug: str
    product_name: str
    variant_name: str | None = None
    stock_quantity: int
    reserved_in_carts: int
    reserved_in_orders: int
    available_quantity: int
    threshold: int
    is_critical: bool
    restock_at: datetime | None = None
    supplier: str | None = None
    desired_quantity: int | None = None
    note: str | None = None
    note_updated_at: datetime | None = None


class RestockListResponse(BaseModel):
    items: list[RestockListItem]
    meta: AdminPaginationMeta


class CartReservationItem(BaseModel):
    cart_id: UUID
    updated_at: datetime
    customer_email: str | None = None
    quantity: int


class CartReservationsResponse(BaseModel):
    cutoff: datetime
    items: list[CartReservationItem]


class OrderReservationItem(BaseModel):
    order_id: UUID
    reference_code: str | None = None
    status: str
    created_at: datetime
    customer_email: str | None = None
    quantity: int


class OrderReservationsResponse(BaseModel):
    items: list[OrderReservationItem]
