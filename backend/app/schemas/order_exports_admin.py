from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.schemas.admin_common import AdminPaginationMeta


class AdminOrderDocumentExportRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    kind: str
    filename: str
    mime_type: str
    created_at: datetime
    expires_at: datetime | None = None
    order_id: UUID | None = None
    order_reference: str | None = None
    order_count: int = 0


class AdminOrderDocumentExportListResponse(BaseModel):
    items: list[AdminOrderDocumentExportRead]
    meta: AdminPaginationMeta

