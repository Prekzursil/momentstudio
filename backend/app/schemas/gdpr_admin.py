from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from app.models.user import UserRole
from app.models.user_export import UserDataExportStatus
from app.schemas.admin_common import AdminPaginationMeta


class AdminGdprUserRef(BaseModel):
    id: UUID
    email: str
    username: str
    role: UserRole


class AdminGdprExportJobItem(BaseModel):
    id: UUID
    user: AdminGdprUserRef
    status: UserDataExportStatus
    progress: int = 0
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None
    expires_at: datetime | None = None
    has_file: bool = False
    sla_due_at: datetime
    sla_breached: bool = False


class AdminGdprExportJobsResponse(BaseModel):
    items: list[AdminGdprExportJobItem]
    meta: AdminPaginationMeta


class AdminGdprDeletionRequestItem(BaseModel):
    user: AdminGdprUserRef
    requested_at: datetime
    scheduled_for: datetime | None = None
    status: str
    sla_due_at: datetime
    sla_breached: bool = False


class AdminGdprDeletionRequestsResponse(BaseModel):
    items: list[AdminGdprDeletionRequestItem]
    meta: AdminPaginationMeta

