from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel

from app.models.catalog import ProductStatus
from app.schemas.admin_common import AdminPaginationMeta


class AdminProductListItem(BaseModel):
    id: UUID
    slug: str
    sku: str
    name: str
    base_price: Decimal
    sale_type: str | None = None
    sale_value: Decimal | None = None
    currency: str
    status: ProductStatus
    is_active: bool
    is_featured: bool
    stock_quantity: int
    category_slug: str
    category_name: str
    updated_at: datetime
    publish_at: datetime | None = None


class AdminProductListResponse(BaseModel):
    items: list[AdminProductListItem]
    meta: AdminPaginationMeta


class AdminProductByIdsRequest(BaseModel):
    ids: list[UUID]
