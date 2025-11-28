import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, Enum, ForeignKey, Numeric, String, Table, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(120), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    products: Mapped[list["Product"]] = relationship("Product", back_populates="category")


class ProductStatus(str, enum.Enum):
    draft = "draft"
    published = "published"
    archived = "archived"


product_tags = Table(
    "product_tags",
    Base.metadata,
    Column("product_id", UUID(as_uuid=True), ForeignKey("products.id"), primary_key=True),
    Column("tag_id", UUID(as_uuid=True), ForeignKey("tags.id"), primary_key=True),
)


class Product(Base):
    __tablename__ = "products"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    category_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("categories.id"), nullable=False)
    sku: Mapped[str] = mapped_column(
        String(64), unique=True, nullable=False, index=True, default=lambda: uuid.uuid4().hex[:12].upper()
    )
    slug: Mapped[str] = mapped_column(String(160), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    short_description: Mapped[str | None] = mapped_column(String(280), nullable=True)
    long_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    base_price: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False, default=0)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="USD")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_featured: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    stock_quantity: Mapped[int] = mapped_column(nullable=False, default=0)
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[ProductStatus] = mapped_column(Enum(ProductStatus), nullable=False, default=ProductStatus.draft)
    publish_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rating_average: Mapped[float] = mapped_column(Numeric(3, 2), nullable=False, default=0)
    rating_count: Mapped[int] = mapped_column(nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    last_modified: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    category: Mapped[Category] = relationship("Category", back_populates="products", lazy="joined")
    images: Mapped[list["ProductImage"]] = relationship(
        "ProductImage", back_populates="product", cascade="all, delete-orphan", lazy="selectin"
    )
    variants: Mapped[list["ProductVariant"]] = relationship(
        "ProductVariant", back_populates="product", cascade="all, delete-orphan", lazy="selectin"
    )
    tags: Mapped[list["Tag"]] = relationship("Tag", secondary=product_tags, back_populates="products", lazy="selectin")
    options: Mapped[list["ProductOption"]] = relationship(
        "ProductOption", back_populates="product", cascade="all, delete-orphan", lazy="selectin"
    )
    reviews: Mapped[list["ProductReview"]] = relationship(
        "ProductReview", back_populates="product", cascade="all, delete-orphan", lazy="selectin"
    )


class ProductImage(Base):
    __tablename__ = "product_images"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("products.id"), nullable=False)
    url: Mapped[str] = mapped_column(String(500), nullable=False)
    alt_text: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sort_order: Mapped[int] = mapped_column(nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    product: Mapped[Product] = relationship("Product", back_populates="images")


class ProductVariant(Base):
    __tablename__ = "product_variants"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("products.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    additional_price_delta: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False, default=0)
    stock_quantity: Mapped[int] = mapped_column(nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    product: Mapped[Product] = relationship("Product", back_populates="variants")


class ProductOption(Base):
    __tablename__ = "product_options"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("products.id"), nullable=False)
    option_name: Mapped[str] = mapped_column(String(50), nullable=False)
    option_value: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    product: Mapped[Product] = relationship("Product", back_populates="options")


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True, nullable=False, index=True)

    products: Mapped[list[Product]] = relationship("Product", secondary=product_tags, back_populates="tags")


class ProductReview(Base):
    __tablename__ = "product_reviews"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("products.id"), nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    author_name: Mapped[str] = mapped_column(String(160), nullable=False)
    rating: Mapped[int] = mapped_column(nullable=False)
    title: Mapped[str | None] = mapped_column(String(160), nullable=True)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_approved: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    product: Mapped[Product] = relationship("Product", back_populates="reviews")
