import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.user import User, UserRole
from app.models.catalog import Category, Product, ProductImage


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.mark.anyio("asyncio")
async def test_user_model_persists_in_sqlite_memory() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

    async with SessionLocal() as session:
        user = User(email="alice@example.com", hashed_password="hashedpw", name="Alice")
        session.add(user)
        await session.commit()
        await session.refresh(user)

        result = await session.execute(select(User).where(User.email == "alice@example.com"))
        fetched = result.scalar_one()
        assert fetched.id is not None
        assert fetched.role == UserRole.customer


@pytest.mark.anyio("asyncio")
async def test_catalog_models_sqlite_memory() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

    async with SessionLocal() as session:
        category = Category(slug="cups", name="Cups")
        product = Product(
            category=category,
            slug="white-cup",
            name="White Cup",
            base_price=15.50,
            currency="USD",
            stock_quantity=5,
        )
        image = ProductImage(product=product, url="http://example.com/cup.jpg", alt_text="Cup", sort_order=1)
        session.add_all([category, product, image])
        await session.commit()

        result = await session.execute(select(Product).where(Product.slug == "white-cup"))
        fetched = result.scalar_one()
        assert fetched.category.slug == "cups"
        assert fetched.images[0].url.endswith("cup.jpg")
