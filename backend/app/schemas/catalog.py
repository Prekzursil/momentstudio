from decimal import Decimal
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from pydantic import field_validator

from app.models.catalog import ProductBadgeType, ProductStatus, ShippingClass, StockAdjustmentReason


_ALLOWED_COURIERS: set[str] = {"sameday", "fan_courier"}


def _normalize_courier(value: object) -> str:
    return str(value or "").strip().lower()


def _validate_disallowed_couriers(value: object | None) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError("Invalid couriers list")
    cleaned: list[str] = []
    for raw in value:
        code = _normalize_courier(raw)
        if not code:
            continue
        if code not in _ALLOWED_COURIERS:
            raise ValueError("Invalid courier")
        cleaned.append(code)
    # Preserve the requested order as much as possible, but drop duplicates.
    seen: set[str] = set()
    unique: list[str] = []
    for code in cleaned:
        if code in seen:
            continue
        seen.add(code)
        unique.append(code)
    return unique


class CategoryFields(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None
    thumbnail_url: str | None = Field(default=None, max_length=500)
    banner_url: str | None = Field(default=None, max_length=500)
    is_visible: bool = True
    low_stock_threshold: int | None = Field(default=None, ge=0)
    sort_order: int = 0
    parent_id: UUID | None = None
    tax_group_id: UUID | None = None


class CategoryBase(CategoryFields):
    slug: str = Field(min_length=1, max_length=120)


class CategoryCreate(CategoryFields):
    """Category create payload.

    Category slugs are auto-generated from the name and are not user-editable.
    """


class CategoryUpdate(BaseModel):
    slug: str | None = Field(default=None, min_length=1, max_length=120)
    name: str | None = Field(default=None, max_length=120)
    description: str | None = None
    thumbnail_url: str | None = Field(default=None, max_length=500)
    banner_url: str | None = Field(default=None, max_length=500)
    is_visible: bool | None = None
    low_stock_threshold: int | None = Field(default=None, ge=0)
    sort_order: int | None = None
    parent_id: UUID | None = None
    tax_group_id: UUID | None = None


class CategoryReorderItem(BaseModel):
    slug: str
    sort_order: int


class CategoryRead(CategoryBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    updated_at: datetime
    sort_order: int
    tax_group_id: UUID | None = None


class CategoryDeletePreview(BaseModel):
    slug: str
    product_count: int
    child_count: int
    can_delete: bool


class CategoryMergePreview(BaseModel):
    source_slug: str
    target_slug: str
    product_count: int
    child_count: int
    can_merge: bool
    reason: str | None = None


class CategoryMergeRequest(BaseModel):
    target_slug: str = Field(min_length=1, max_length=120)


class CategoryMergeResult(BaseModel):
    source_slug: str
    target_slug: str
    moved_products: int


class CategoryTranslationUpsert(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: str | None = None


class CategoryTranslationRead(CategoryTranslationUpsert):
    model_config = ConfigDict(from_attributes=True)

    lang: str


class ProductFields(BaseModel):
    category_id: UUID
    sku: str | None = Field(default=None, min_length=3, max_length=64)
    name: str = Field(min_length=1, max_length=160)
    short_description: str | None = Field(default=None, max_length=280)
    long_description: str | None = None
    base_price: Decimal = Field(ge=0)
    sale_type: str | None = Field(default=None, pattern="^(percent|amount)$")
    sale_value: Decimal | None = Field(default=None, ge=0)
    sale_start_at: datetime | None = None
    sale_end_at: datetime | None = None
    sale_auto_publish: bool = False
    currency: str = Field(default="RON", min_length=3, max_length=3)
    is_active: bool = True
    is_featured: bool = False
    stock_quantity: int = Field(ge=0)
    low_stock_threshold: int | None = Field(default=None, ge=0)
    allow_backorder: bool = False
    restock_at: datetime | None = None
    weight_grams: int | None = Field(default=None, ge=0)
    width_cm: float | None = Field(default=None, ge=0)
    height_cm: float | None = Field(default=None, ge=0)
    depth_cm: float | None = Field(default=None, ge=0)
    shipping_class: ShippingClass = ShippingClass.standard
    shipping_allow_locker: bool = True
    shipping_disallowed_couriers: list[str] = Field(default_factory=list)
    meta_title: str | None = Field(default=None, max_length=180)
    meta_description: str | None = Field(default=None, max_length=300)

    @field_validator("long_description")
    @classmethod
    def validate_long_description(cls, value: str | None):
        if value and "<script" in value.lower():
            raise ValueError("Invalid rich text content")
        return value

    @field_validator("shipping_disallowed_couriers")
    @classmethod
    def validate_shipping_disallowed_couriers(cls, value: object):
        return _validate_disallowed_couriers(value)

    @field_validator("currency")
    @classmethod
    def validate_currency(cls, value: str):
        cleaned = (value or "").strip().upper()
        if cleaned != "RON":
            raise ValueError("Only RON currency is supported")
        return cleaned


class ProductBase(ProductFields):
    slug: str = Field(min_length=1, max_length=160)


class ProductImageBase(BaseModel):
    url: str
    alt_text: str | None = None
    caption: str | None = None
    sort_order: int = 0


class ProductImageCreate(ProductImageBase):
    pass


class ProductImageRead(ProductImageBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID


class ProductImageTranslationUpsert(BaseModel):
    alt_text: str | None = Field(default=None, max_length=255)
    caption: str | None = None


class ProductImageTranslationRead(ProductImageTranslationUpsert):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    lang: str


class ProductImageOptimizationStats(BaseModel):
    original_bytes: int | None = None
    thumb_sm_bytes: int | None = None
    thumb_md_bytes: int | None = None
    thumb_lg_bytes: int | None = None
    width: int | None = None
    height: int | None = None


class ProductVariantBase(BaseModel):
    name: str
    additional_price_delta: Decimal = Decimal("0.00")
    stock_quantity: int = 0


class ProductVariantCreate(ProductVariantBase):
    pass


class ProductVariantRead(ProductVariantBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID


class ProductVariantUpsert(BaseModel):
    id: UUID | None = None
    name: str = Field(min_length=1, max_length=120)
    additional_price_delta: Decimal = Decimal("0.00")
    stock_quantity: int = Field(default=0, ge=0)


class ProductVariantMatrixUpdate(BaseModel):
    variants: list[ProductVariantUpsert] = []
    delete_variant_ids: list[UUID] = []


class ProductOptionBase(BaseModel):
    option_name: str
    option_value: str


class ProductOptionCreate(ProductOptionBase):
    pass


class ProductOptionRead(ProductOptionBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID


class TagRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    slug: str


class ProductBadgeUpsert(BaseModel):
    badge: ProductBadgeType
    start_at: datetime | None = None
    end_at: datetime | None = None


class ProductBadgeRead(ProductBadgeUpsert):
    model_config = ConfigDict(from_attributes=True)

    id: UUID


class FeaturedCollectionBase(BaseModel):
    slug: str = Field(min_length=1, max_length=120)
    name: str = Field(min_length=1, max_length=160)
    description: str | None = None


class FeaturedCollectionCreate(BaseModel):
    """Featured collection create payload.

    Collection slugs are auto-generated from the name and are not user-editable.
    """

    name: str = Field(min_length=1, max_length=160)
    description: str | None = None
    product_ids: list[UUID] = Field(default_factory=list)


class FeaturedCollectionUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=160)
    description: str | None = None
    product_ids: list[UUID] | None = None


class FeaturedCollectionRead(FeaturedCollectionBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    products: list["ProductReadBrief"] = []


class ProductReviewCreate(BaseModel):
    author_name: str
    rating: int = Field(ge=1, le=5)
    title: str | None = None
    body: str | None = None


class ProductReviewRead(ProductReviewCreate):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    is_approved: bool
    created_at: datetime


class PaginationMeta(BaseModel):
    total_items: int
    total_pages: int
    page: int
    limit: int


class ProductCreate(ProductFields):
    slug: str | None = Field(default=None, min_length=1, max_length=160)
    images: list[ProductImageCreate] = []
    variants: list[ProductVariantCreate] = []
    tags: list[str] = []
    badges: list[ProductBadgeUpsert] = []
    options: list[ProductOptionCreate] = []
    status: ProductStatus = ProductStatus.draft


class ProductUpdate(BaseModel):
    slug: str | None = Field(default=None, min_length=1, max_length=160)
    name: str | None = Field(default=None, max_length=160)
    short_description: str | None = Field(default=None, max_length=280)
    long_description: str | None = None
    base_price: Decimal | None = Field(default=None, ge=0)
    sale_type: str | None = Field(default=None, pattern="^(percent|amount)$")
    sale_value: Decimal | None = Field(default=None, ge=0)
    sale_start_at: datetime | None = None
    sale_end_at: datetime | None = None
    sale_auto_publish: bool | None = None
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    is_active: bool | None = None
    is_featured: bool | None = None
    stock_quantity: int | None = Field(default=None, ge=0)
    low_stock_threshold: int | None = Field(default=None, ge=0)
    category_id: UUID | None = None
    sku: str | None = Field(default=None, min_length=3, max_length=64)
    status: ProductStatus | None = None
    publish_at: datetime | None = None
    publish_scheduled_for: datetime | None = None
    unpublish_scheduled_for: datetime | None = None
    tags: list[str] | None = None
    badges: list[ProductBadgeUpsert] | None = None
    options: list[ProductOptionCreate] | None = None
    allow_backorder: bool | None = None
    restock_at: datetime | None = None
    weight_grams: int | None = Field(default=None, ge=0)
    width_cm: float | None = Field(default=None, ge=0)
    height_cm: float | None = Field(default=None, ge=0)
    depth_cm: float | None = Field(default=None, ge=0)
    shipping_class: ShippingClass | None = None
    shipping_allow_locker: bool | None = None
    shipping_disallowed_couriers: list[str] | None = None

    @field_validator("currency")
    @classmethod
    def validate_currency(cls, value: str | None):
        if value is None:
            return value
        cleaned = (value or "").strip().upper()
        if cleaned != "RON":
            raise ValueError("Only RON currency is supported")
        return cleaned

    @field_validator("shipping_disallowed_couriers")
    @classmethod
    def validate_shipping_disallowed_couriers(cls, value: object | None):
        if value is None:
            return value
        return _validate_disallowed_couriers(value)
    meta_title: str | None = Field(default=None, max_length=180)
    meta_description: str | None = Field(default=None, max_length=300)

    @field_validator("long_description")
    @classmethod
    def validate_long_description(cls, value: str | None):
        if value and "<script" in value.lower():
            raise ValueError("Invalid rich text content")
        return value


class ProductTranslationUpsert(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    short_description: str | None = Field(default=None, max_length=280)
    long_description: str | None = None
    meta_title: str | None = Field(default=None, max_length=180)
    meta_description: str | None = Field(default=None, max_length=300)

    @field_validator("long_description")
    @classmethod
    def validate_long_description(cls, value: str | None):
        if value and "<script" in value.lower():
            raise ValueError("Invalid rich text content")
        return value


class ProductTranslationRead(ProductTranslationUpsert):
    model_config = ConfigDict(from_attributes=True)

    lang: str


class BackInStockRequestRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    fulfilled_at: datetime | None = None
    canceled_at: datetime | None = None
    notified_at: datetime | None = None


class BackInStockStatus(BaseModel):
    in_stock: bool
    request: BackInStockRequestRead | None = None


class BulkProductUpdateItem(BaseModel):
    product_id: UUID
    base_price: Decimal | None = Field(default=None, ge=0)
    sale_type: str | None = Field(default=None, pattern="^(percent|amount)$")
    sale_value: Decimal | None = Field(default=None, ge=0)
    sale_start_at: datetime | None = None
    sale_end_at: datetime | None = None
    sale_auto_publish: bool | None = None
    stock_quantity: int | None = Field(default=None, ge=0)
    is_featured: bool | None = None
    category_id: UUID | None = None
    publish_scheduled_for: datetime | None = None
    unpublish_scheduled_for: datetime | None = None
    status: ProductStatus | None = None


class StockAdjustmentCreate(BaseModel):
    product_id: UUID
    variant_id: UUID | None = None
    delta: int
    reason: StockAdjustmentReason
    note: str | None = Field(default=None, max_length=500)


class ProductRelationshipsUpdate(BaseModel):
    related_product_ids: list[UUID] = Field(default_factory=list, max_length=30)
    upsell_product_ids: list[UUID] = Field(default_factory=list, max_length=30)


class ProductRelationshipsRead(ProductRelationshipsUpdate):
    pass


class StockAdjustmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    product_id: UUID
    variant_id: UUID | None
    actor_user_id: UUID | None
    reason: StockAdjustmentReason
    delta: int
    before_quantity: int
    after_quantity: int
    note: str | None
    created_at: datetime


class ProductRead(ProductBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    updated_at: datetime
    publish_at: datetime | None = None
    last_modified: datetime
    status: ProductStatus
    rating_average: float
    rating_count: int
    sale_price: Decimal | None = None
    images: list[ProductImageRead] = []
    category: CategoryRead
    variants: list[ProductVariantRead] = []
    options: list[ProductOptionRead] = []
    tags: list[TagRead] = []
    badges: list[ProductBadgeRead] = []
    reviews: list[ProductReviewRead] = []
    featured_collections: list[FeaturedCollectionBase] = []


class ProductReadBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    slug: str
    name: str
    base_price: Decimal
    sale_price: Decimal | None = None
    currency: str
    is_featured: bool
    status: ProductStatus
    tags: list[TagRead] = []
    badges: list[ProductBadgeRead] = []


class ProductFeedItem(BaseModel):
    slug: str
    name: str
    price: float
    currency: str
    description: str | None = None
    category_slug: str | None = None
    tags: list[str] = []


class ProductPriceBounds(BaseModel):
    min_price: float
    max_price: float
    currency: str | None = None


class ProductListResponse(BaseModel):
    items: list[ProductRead]
    meta: PaginationMeta
    bounds: ProductPriceBounds | None = None


class ImportResult(BaseModel):
    created: int
    updated: int
    errors: list[str] = []
