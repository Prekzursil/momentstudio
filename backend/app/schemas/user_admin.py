from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

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

