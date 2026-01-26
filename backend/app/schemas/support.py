from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.support import ContactSubmissionStatus, ContactSubmissionTopic
from app.models.user import UserRole
from app.schemas.admin_common import AdminPaginationMeta


class SupportAgentRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    username: str
    name: str | None = None
    name_tag: int | None = None
    role: UserRole


class ContactSubmissionCreate(BaseModel):
    topic: ContactSubmissionTopic = ContactSubmissionTopic.contact
    name: str = Field(min_length=1, max_length=255)
    email: EmailStr
    message: str = Field(min_length=1, max_length=10_000)
    order_reference: str | None = Field(default=None, max_length=50)


class ContactSubmissionUpdate(BaseModel):
    status: ContactSubmissionStatus | None = None
    admin_note: str | None = Field(default=None, max_length=10_000)
    assignee_id: UUID | None = None


class ContactSubmissionMessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    from_admin: bool
    message: str
    created_at: datetime


class ContactSubmissionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    topic: ContactSubmissionTopic
    status: ContactSubmissionStatus
    name: str
    email: str
    message: str
    order_reference: str | None = None
    user_id: UUID | None = None
    admin_note: str | None = None
    assignee: SupportAgentRef | None = None
    assigned_by: SupportAgentRef | None = None
    assigned_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None = None
    messages: list[ContactSubmissionMessageRead] = Field(default_factory=list)


class ContactSubmissionListItem(BaseModel):
    id: UUID
    topic: ContactSubmissionTopic
    status: ContactSubmissionStatus
    name: str
    email: str
    order_reference: str | None = None
    assignee: SupportAgentRef | None = None
    created_at: datetime


class ContactSubmissionListResponse(BaseModel):
    items: list[ContactSubmissionListItem]
    meta: AdminPaginationMeta


class SupportCannedResponseRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    body_en: str
    body_ro: str
    is_active: bool = True
    created_at: datetime
    updated_at: datetime


class SupportCannedResponseCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    body_en: str = Field(min_length=1, max_length=10_000)
    body_ro: str = Field(min_length=1, max_length=10_000)
    is_active: bool = True


class SupportCannedResponseUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=120)
    body_en: str | None = Field(default=None, max_length=10_000)
    body_ro: str | None = Field(default=None, max_length=10_000)
    is_active: bool | None = None


class TicketCreate(BaseModel):
    topic: ContactSubmissionTopic = ContactSubmissionTopic.support
    message: str = Field(min_length=1, max_length=10_000)
    order_reference: str | None = Field(default=None, max_length=50)


class TicketMessageCreate(BaseModel):
    message: str = Field(min_length=1, max_length=10_000)


class TicketListItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    topic: ContactSubmissionTopic
    status: ContactSubmissionStatus
    order_reference: str | None = None
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None = None


class TicketMessageRead(BaseModel):
    id: str
    from_admin: bool
    message: str
    created_at: datetime


class TicketRead(BaseModel):
    id: UUID
    topic: ContactSubmissionTopic
    status: ContactSubmissionStatus
    name: str
    email: str
    order_reference: str | None = None
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None = None
    messages: list[TicketMessageRead]


class SupportSlaSettingsRead(BaseModel):
    first_reply_hours: int = Field(default=24, ge=1, le=720)
    resolution_hours: int = Field(default=72, ge=1, le=720)


class SupportSlaSettingsUpdate(BaseModel):
    first_reply_hours: int = Field(default=24, ge=1, le=720)
    resolution_hours: int = Field(default=72, ge=1, le=720)
