from __future__ import annotations

from pydantic import BaseModel

from app.schemas.admin_common import AdminPaginationMeta
from app.schemas.user_admin import AdminUserListItem


class AdminUserSegmentListItem(BaseModel):
    user: AdminUserListItem
    orders_count: int = 0
    total_spent: float = 0.0
    avg_order_value: float = 0.0


class AdminUserSegmentResponse(BaseModel):
    items: list[AdminUserSegmentListItem]
    meta: AdminPaginationMeta

