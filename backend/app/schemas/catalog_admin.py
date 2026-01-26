from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.catalog import ProductStatus
from app.schemas.admin_common import AdminPaginationMeta


class AdminProductListItem(BaseModel):
    id: UUID
    slug: str
    deleted_slug: str | None = None
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
    deleted_at: datetime | None = None
    publish_at: datetime | None = None
    publish_scheduled_for: datetime | None = None
    unpublish_scheduled_for: datetime | None = None
    missing_translations: list[str] = Field(default_factory=list)


class AdminProductListResponse(BaseModel):
    items: list[AdminProductListItem]
    meta: AdminPaginationMeta


class AdminProductByIdsRequest(BaseModel):
    ids: list[UUID]


class AdminProductDuplicateMatch(BaseModel):
    id: UUID
    slug: str
    sku: str
    name: str
    status: ProductStatus
    is_active: bool


class AdminProductDuplicateCheckResponse(BaseModel):
    slug_base: str | None = None
    suggested_slug: str | None = None
    slug_matches: list[AdminProductDuplicateMatch] = Field(default_factory=list)
    sku_matches: list[AdminProductDuplicateMatch] = Field(default_factory=list)
    name_matches: list[AdminProductDuplicateMatch] = Field(default_factory=list)


class AdminDeletedProductImage(BaseModel):
    id: UUID
    url: str
    alt_text: str | None = None
    caption: str | None = None
    deleted_at: datetime | None = None


class AdminProductAuditEntry(BaseModel):
    id: UUID
    action: str
    created_at: datetime
    user_id: UUID | None = None
    user_email: str | None = None
    payload: dict | None = None
