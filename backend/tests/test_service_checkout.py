import asyncio
from decimal import Decimal

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.cart import Cart, CartItem
from app.models.catalog import Category, Product
from app.services import order as order_service
from app.schemas.order import ShippingMethodCreate


def test_checkout_build_order():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

    async def run_flow():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with SessionLocal() as session:
            category = Category(slug="svc-checkout", name="Svc Checkout")
            product = Product(
                category=category,
                slug="svc-checkout-prod",
                sku="SVC-CHK",
                name="Svc Checkout Product",
                base_price=Decimal("12.00"),
                currency="RON",
                stock_quantity=10,
            )
            cart = Cart(user_id=None)
            cart.items = [CartItem(product=product, quantity=1, unit_price_at_add=Decimal("12.00"))]
            session.add(cart)
            await session.commit()
            await session.refresh(cart)

            method = await order_service.create_shipping_method(
                session, ShippingMethodCreate(name="Svc Ship", rate_flat=2.0, rate_per_kg=0)
            )
            order = await order_service.build_order_from_cart(
                session,
                None,
                customer_email="buyer@example.com",
                customer_name="Buyer",
                cart=cart,
                shipping_address_id=None,
                billing_address_id=None,
                shipping_method=method,
            )
            expected_total = Decimal("12.00") + Decimal(str(order.tax_amount)) + Decimal(str(order.shipping_amount))
            assert Decimal(str(order.total_amount)) == expected_total

    asyncio.run(run_flow())
