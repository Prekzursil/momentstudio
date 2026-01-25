from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.models.order import OrderStatus
from app.models.support import ContactSubmissionStatus, ContactSubmissionTopic
from app.models.user import UserRole
from app.schemas.admin_common import AdminPaginationMeta


class AdminUserListItem(BaseModel):
    id: UUID
    email: str
    username: str
    name: str | None = None
    name_tag: int | None = None
    role: UserRole
    email_verified: bool
    created_at: datetime


class AdminUserListResponse(BaseModel):
    items: list[AdminUserListItem]
    meta: AdminPaginationMeta


class AdminUserAddress(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    label: str | None = None
    phone: str | None = None
    line1: str
    line2: str | None = None
    city: str
    region: str | None = None
    postal_code: str
    country: str
    is_default_shipping: bool
    is_default_billing: bool
    created_at: datetime
    updated_at: datetime


class AdminUserOrderSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    reference_code: str | None = None
    status: OrderStatus
    total_amount: Decimal
    currency: str
    created_at: datetime
    updated_at: datetime


class AdminUserTicketSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    topic: ContactSubmissionTopic
    status: ContactSubmissionStatus
    order_reference: str | None = None
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None = None


class AdminUserSecurityEventSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    event_type: str
    ip_address: str | None = None
    user_agent: str | None = None
    created_at: datetime


class AdminUserProfileResponse(BaseModel):
    user: AdminUserListItem
    addresses: list[AdminUserAddress] = []
    orders: list[AdminUserOrderSummary] = []
    tickets: list[AdminUserTicketSummary] = []
    security_events: list[AdminUserSecurityEventSummary] = []
