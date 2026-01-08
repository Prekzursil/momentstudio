import asyncio
from decimal import Decimal
from typing import Any, TypedDict

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.future import select

from app.core.config import settings
from app.models.catalog import Category, Product, ProductImage, ProductVariant


class SeedImage(TypedDict):
    url: str
    alt_text: str
    sort_order: int


class SeedVariant(TypedDict):
    name: str
    additional_price_delta: Decimal
    stock_quantity: int


class SeedProduct(TypedDict):
    slug: str
    name: str
    category_slug: str
    short_description: str
    long_description: str
    base_price: Decimal
    currency: str
    stock_quantity: int
    is_featured: bool
    images: list[SeedImage]
    variants: list[SeedVariant]


SEED_CATEGORIES: list[dict[str, Any]] = [
    {"slug": "cups", "name": "Cups & Mugs", "description": "Handmade cups and mugs."},
    {"slug": "plates", "name": "Plates", "description": "Dinner and side plates."},
    {"slug": "bowls", "name": "Bowls", "description": "Serving and cereal bowls."},
]

SEED_PRODUCTS: list[SeedProduct] = [
    {
        "slug": "white-cup",
        "name": "White Glazed Cup",
        "category_slug": "cups",
        "short_description": "Matte white glaze, comfortable handle.",
        "long_description": "Wheel-thrown stoneware with white matte glaze and speckle.",
        "base_price": Decimal("24.00"),
        "currency": "RON",
        "stock_quantity": 10,
        "is_featured": True,
        "images": [
            {"url": "https://example.com/images/white-cup-1.jpg", "alt_text": "White cup front", "sort_order": 1},
            {"url": "https://example.com/images/white-cup-2.jpg", "alt_text": "White cup angle", "sort_order": 2},
        ],
        "variants": [
            {"name": "8oz", "additional_price_delta": Decimal("0.00"), "stock_quantity": 5},
            {"name": "12oz", "additional_price_delta": Decimal("4.00"), "stock_quantity": 5},
        ],
    },
    {
        "slug": "blue-bowl",
        "name": "Blue Splash Bowl",
        "category_slug": "bowls",
        "short_description": "Splash glaze interior with raw exterior.",
        "long_description": "Medium bowl perfect for ramen or salads.",
        "base_price": Decimal("36.00"),
        "currency": "RON",
        "stock_quantity": 6,
        "is_featured": False,
        "images": [
            {"url": "https://example.com/images/blue-bowl-1.jpg", "alt_text": "Blue bowl top", "sort_order": 1},
        ],
        "variants": [],
    },
]


async def seed(session: AsyncSession) -> None:
    # Categories
    for cat in SEED_CATEGORIES:
        existing = await session.execute(select(Category).where(Category.slug == cat["slug"]))
        if existing.scalar_one_or_none():
            continue
        session.add(Category(**cat))
    await session.commit()

    # Products
    for prod in SEED_PRODUCTS:
        result = await session.execute(select(Product).where(Product.slug == prod["slug"]))
        if result.scalar_one_or_none():
            continue

        cat_result = await session.execute(select(Category).where(Category.slug == prod["category_slug"]))
        category = cat_result.scalar_one()

        product = Product(
            category_id=category.id,
            slug=prod["slug"],
            name=prod["name"],
            short_description=prod["short_description"],
            long_description=prod["long_description"],
            base_price=prod["base_price"],
            currency=prod["currency"],
            is_active=True,
            is_featured=prod["is_featured"],
            stock_quantity=prod["stock_quantity"],
        )
        product.images = [ProductImage(**img) for img in prod["images"]]
        product.variants = [ProductVariant(**variant) for variant in prod["variants"]]
        session.add(product)

    await session.commit()


async def main() -> None:
    engine = create_async_engine(settings.database_url, future=True, echo=False)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)
    async with SessionLocal() as session:
        await seed(session)
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
