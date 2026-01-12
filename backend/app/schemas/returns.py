from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.returns import ReturnRequestStatus
from app.schemas.admin_common import AdminPaginationMeta


class ReturnRequestItemCreate(BaseModel):
    order_item_id: UUID
    quantity: int = Field(default=1, ge=1)


class ReturnRequestCreate(BaseModel):
    order_id: UUID
    reason: str = Field(min_length=1, max_length=2000)
    customer_message: str | None = Field(default=None, max_length=5000)
    items: list[ReturnRequestItemCreate] = Field(min_length=1)


class ReturnRequestUpdate(BaseModel):
    status: ReturnRequestStatus | None = None
    admin_note: str | None = Field(default=None, max_length=5000)


class ReturnRequestListItem(BaseModel):
    id: UUID
    order_id: UUID
    order_reference: str | None = None
    customer_email: str | None = None
    customer_name: str | None = None
    status: ReturnRequestStatus
    created_at: datetime


class ReturnRequestListResponse(BaseModel):
    items: list[ReturnRequestListItem]
    meta: AdminPaginationMeta


class ReturnRequestItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    order_item_id: UUID | None = None
    quantity: int
    product_id: UUID | None = None
    product_name: str | None = None


class ReturnRequestRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    order_id: UUID
    order_reference: str | None = None
    customer_email: str | None = None
    customer_name: str | None = None
    user_id: UUID | None = None

    status: ReturnRequestStatus
    reason: str
    customer_message: str | None = None
    admin_note: str | None = None

    created_by: UUID | None = None
    updated_by: UUID | None = None

    created_at: datetime
    updated_at: datetime
    closed_at: datetime | None = None

    items: list[ReturnRequestItemRead] = Field(default_factory=list)

