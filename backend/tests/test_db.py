import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.user import User, UserRole
from app.models.catalog import Category, Product, ProductImage, ProductVariant
from app.models.cart import Cart, CartItem
from app.models.order import Order, OrderItem


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
        user = User(email="alice@example.com", username="alice", hashed_password="hashedpw", name="Alice")
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
            currency="RON",
            stock_quantity=5,
        )
        product.variants = [ProductVariant(name="Large", additional_price_delta=2.0, stock_quantity=1)]
        image = ProductImage(product=product, url="http://example.com/cup.jpg", alt_text="Cup", sort_order=1)
        session.add_all([category, product, image])
        await session.commit()

        result = await session.execute(select(Product).where(Product.slug == "white-cup"))
        fetched = result.scalar_one()
        assert fetched.category.slug == "cups"
        assert fetched.images[0].url.endswith("cup.jpg")
        assert fetched.variants[0].name == "Large"


@pytest.mark.anyio("asyncio")
async def test_cart_models_sqlite_memory() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)
    async with SessionLocal() as session:
        category = Category(slug="plates", name="Plates")
        product = Product(
            category=category,
            slug="plate",
            sku="SKU-PLATE",
            name="Plate",
            base_price=20,
            currency="RON",
            stock_quantity=2,
        )
        session.add_all([category, product])
        await session.commit()

        cart = Cart(session_id="guest-123")
        session.add(cart)
        session.add(CartItem(cart=cart, product=product, quantity=2, unit_price_at_add=product.base_price))
        await session.commit()

        result = await session.execute(select(CartItem).where(CartItem.cart == cart))
        fetched = result.scalar_one()
        assert fetched.quantity == 2
        assert float(fetched.unit_price_at_add) == 20.0


@pytest.mark.anyio("asyncio")
async def test_order_models_sqlite_memory() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)
    async with SessionLocal() as session:
        user = User(email="order@example.com", username="order", hashed_password="x")
        category = Category(slug="order-cups", name="Cups")
        product = Product(
            category=category,
            slug="order-cup",
            sku="SKU-ORDER",
            name="Order Cup",
            base_price=15,
            currency="RON",
            stock_quantity=2,
        )
        session.add_all([user, category, product])
        await session.commit()
        await session.refresh(user)
        await session.refresh(product)

        order = Order(user_id=user.id, total_amount=15, currency="RON")
        session.add(order)
        session.add(OrderItem(order=order, product_id=product.id, quantity=1, unit_price=15, subtotal=15))
        await session.commit()

        result = await session.execute(select(OrderItem).where(OrderItem.order == order))
        fetched = result.scalar_one()
        assert fetched.subtotal == 15
