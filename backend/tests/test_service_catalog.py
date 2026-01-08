import asyncio
from decimal import Decimal

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.catalog import Category
from app.schemas.catalog import ProductCreate
from app.services import catalog as catalog_service


def test_catalog_service_create_and_slug():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

    async def run_flow():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with SessionLocal() as session:
            category = Category(slug="svc-cat", name="Svc Cat")
            session.add(category)
            await session.commit()
            await session.refresh(category)

            prod = await catalog_service.create_product(
                session,
                ProductCreate(
                    category_id=category.id,
                    slug="svc-prod",
                    name="Svc Product",
                    base_price=Decimal("5.00"),
                    currency="RON",
                    stock_quantity=2,
                ),
                user_id=None,
            )
            assert prod.slug == "svc-prod"
            await catalog_service.update_product(session, prod, ProductCreate.model_construct(name="Updated"), commit=True)  # type: ignore[arg-type]

    asyncio.run(run_flow())
