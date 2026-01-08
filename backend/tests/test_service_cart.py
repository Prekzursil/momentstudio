import asyncio
from decimal import Decimal

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.cart import Cart
from app.models.catalog import Category, Product
from app.services import cart as cart_service
from app.schemas.cart import CartItemCreate


def test_cart_service_add_and_totals():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

    async def run_flow():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with SessionLocal() as session:
            category = Category(slug="svc", name="Svc")
            product = Product(
                category=category,
                slug="svc-prod",
                sku="SVC-1",
                name="Svc Product",
                base_price=Decimal("10.00"),
                currency="RON",
                stock_quantity=5,
            )
            cart = Cart(user_id=None)
            session.add_all([product, cart])
            await session.commit()
            await session.refresh(cart)

            await cart_service.add_item(
                session,
                cart,
                CartItemCreate(product_id=product.id, quantity=2),
            )
            await session.refresh(cart, attribute_names=["items"])
            assert len(cart.items) == 1
            totals = await cart_service.serialize_cart(session, cart)
            assert totals.totals.total > Decimal("0")

    asyncio.run(run_flow())
