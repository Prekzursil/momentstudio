from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.catalog import ProductStatus


class CategoryBase(BaseModel):
    slug: str = Field(min_length=1, max_length=120)
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None


class CategoryCreate(CategoryBase):
    pass


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    description: str | None = None


class CategoryRead(CategoryBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    updated_at: datetime


class ProductBase(BaseModel):
    category_id: UUID
    slug: str = Field(min_length=1, max_length=160)
    sku: str | None = Field(default=None, min_length=3, max_length=64)
    name: str = Field(min_length=1, max_length=160)
    short_description: str | None = Field(default=None, max_length=280)
    long_description: str | None = None
    base_price: float = Field(ge=0)
    currency: str = Field(min_length=3, max_length=3)
    is_active: bool = True
    is_featured: bool = False
    stock_quantity: int = Field(ge=0)


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


class ProductCreate(ProductBase):
    images: list[ProductImageCreate] = []
    variants: list[ProductVariantCreate] = []
    tags: list[str] = []
    options: list[ProductOptionCreate] = []
    status: ProductStatus = ProductStatus.draft


class ProductUpdate(BaseModel):
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
