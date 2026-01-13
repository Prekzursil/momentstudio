from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from pydantic import field_validator

from app.models.catalog import ProductStatus


class CategoryBase(BaseModel):
    slug: str = Field(min_length=1, max_length=120)
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None
    sort_order: int = 0


class CategoryCreate(CategoryBase):
    pass


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    description: str | None = None
    sort_order: int | None = None


class CategoryReorderItem(BaseModel):
    slug: str
    sort_order: int


class CategoryRead(CategoryBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    updated_at: datetime
    sort_order: int


class CategoryTranslationUpsert(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: str | None = None


class CategoryTranslationRead(CategoryTranslationUpsert):
    model_config = ConfigDict(from_attributes=True)

    lang: str


class ProductBase(BaseModel):
    category_id: UUID
    slug: str = Field(min_length=1, max_length=160)
    sku: str | None = Field(default=None, min_length=3, max_length=64)
    name: str = Field(min_length=1, max_length=160)
    short_description: str | None = Field(default=None, max_length=280)
    long_description: str | None = None
    base_price: float = Field(ge=0)
    currency: str = Field(default="RON", min_length=3, max_length=3)
    is_active: bool = True
    is_featured: bool = False
    stock_quantity: int = Field(ge=0)
    allow_backorder: bool = False
    restock_at: datetime | None = None
    weight_grams: int | None = Field(default=None, ge=0)
    width_cm: float | None = Field(default=None, ge=0)
    height_cm: float | None = Field(default=None, ge=0)
    depth_cm: float | None = Field(default=None, ge=0)
    meta_title: str | None = Field(default=None, max_length=180)
    meta_description: str | None = Field(default=None, max_length=300)

    @field_validator("long_description")
    @classmethod
    def validate_long_description(cls, value: str | None):
        if value and "<script" in value.lower():
            raise ValueError("Invalid rich text content")
        return value

    @field_validator("currency")
    @classmethod
    def validate_currency(cls, value: str):
        cleaned = (value or "").strip().upper()
        if cleaned != "RON":
            raise ValueError("Only RON currency is supported")
        return cleaned


class ProductImageBase(BaseModel):
    url: str
    alt_text: str | None = None
    sort_order: int = 0


class ProductImageCreate(ProductImageBase):
    pass


class ProductImageRead(ProductImageBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID


class ProductVariantBase(BaseModel):
    name: str
    additional_price_delta: float = 0
    stock_quantity: int = 0


class ProductVariantCreate(ProductVariantBase):
    pass


class ProductVariantRead(ProductVariantBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID


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


class FeaturedCollectionBase(BaseModel):
    slug: str = Field(min_length=1, max_length=120)
    name: str = Field(min_length=1, max_length=160)
    description: str | None = None


class FeaturedCollectionCreate(FeaturedCollectionBase):
    product_ids: list[UUID] = []


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


class ProductCreate(ProductBase):
    images: list[ProductImageCreate] = []
    variants: list[ProductVariantCreate] = []
    tags: list[str] = []
    options: list[ProductOptionCreate] = []
    status: ProductStatus = ProductStatus.draft


class ProductUpdate(BaseModel):
    slug: str | None = Field(default=None, min_length=1, max_length=160)
    name: str | None = Field(default=None, max_length=160)
    short_description: str | None = Field(default=None, max_length=280)
    long_description: str | None = None
    base_price: float | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    is_active: bool | None = None
    is_featured: bool | None = None
    stock_quantity: int | None = Field(default=None, ge=0)
    category_id: UUID | None = None
    sku: str | None = Field(default=None, min_length=3, max_length=64)
    status: ProductStatus | None = None
    publish_at: datetime | None = None
    tags: list[str] | None = None
    options: list[ProductOptionCreate] | None = None
    allow_backorder: bool | None = None
    restock_at: datetime | None = None
    weight_grams: int | None = Field(default=None, ge=0)
    width_cm: float | None = Field(default=None, ge=0)
    height_cm: float | None = Field(default=None, ge=0)
    depth_cm: float | None = Field(default=None, ge=0)

    @field_validator("currency")
    @classmethod
    def validate_currency(cls, value: str | None):
        if value is None:
            return value
        cleaned = (value or "").strip().upper()
        if cleaned != "RON":
            raise ValueError("Only RON currency is supported")
        return cleaned
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
    base_price: float | None = Field(default=None, ge=0)
    stock_quantity: int | None = Field(default=None, ge=0)
    status: ProductStatus | None = None


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
    images: list[ProductImageRead] = []
    category: CategoryRead
    variants: list[ProductVariantRead] = []
    options: list[ProductOptionRead] = []
    tags: list[TagRead] = []
    reviews: list[ProductReviewRead] = []
    featured_collections: list[FeaturedCollectionBase] = []


class ProductReadBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    slug: str
    name: str
    base_price: float
    currency: str
    is_featured: bool
    status: ProductStatus
    tags: list[TagRead] = []


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
