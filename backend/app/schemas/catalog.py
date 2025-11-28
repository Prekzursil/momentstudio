from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


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
    name: str = Field(min_length=1, max_length=160)
    short_description: str | None = Field(default=None, max_length=280)
    long_description: str | None = None
    base_price: float = Field(ge=0)
    currency: str = Field(min_length=3, max_length=3)
    is_active: bool = True
    is_featured: bool = False
    stock_quantity: int = Field(ge=0)


class ProductCreate(ProductBase):
    images: list["ProductImageCreate"] = []


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


class ProductImageBase(BaseModel):
    url: str
    alt_text: str | None = None
    sort_order: int = 0


class ProductImageCreate(ProductImageBase):
    pass


class ProductImageRead(ProductImageBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID


class ProductRead(ProductBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    updated_at: datetime
    images: list[ProductImageRead] = []
    category: CategoryRead
