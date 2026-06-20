"""Lean-gate unit coverage for ``app.services.exporter``.

Exercises :func:`app.services.exporter.export_json` end to end against an
in-memory SQLite database seeded with one of every exported entity. Two orders
and two addresses are seeded so that BOTH sides of the nullable foreign-key
ternaries (``user_id``/``shipping_address_id``/``billing_address_id``) are
executed, giving full line + branch coverage of the export builder.

The only ternary branch that cannot be driven from a real row is
``oi.product_id`` -> ``None`` (``OrderItem.product_id`` is ``NOT NULL``); the
truthy side is covered and the falsy side is structurally unreachable, so no
extra row is fabricated for it.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.address import Address
from app.models.catalog import (
    Category,
    Product,
    ProductImage,
    ProductOption,
    ProductStatus,
    ProductVariant,
    Tag,
)
from app.models.order import Order, OrderItem, OrderStatus
from app.models.user import User, UserRole
from app.services import exporter


def _make_session_factory() -> async_sessionmaker:
    import app.models  # noqa: F401  (register every ORM table on Base.metadata)
    from app.db.base import Base

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)

    async def _init() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_init())
    return async_sessionmaker(engine, expire_on_commit=False)


def test_export_json_full_graph() -> None:
    SessionLocal = _make_session_factory()
    now = datetime(2024, 1, 2, 3, 4, 5, tzinfo=timezone.utc)

    async def run() -> dict:
        async with SessionLocal() as session:
            user = User(
                email="exp@example.com",
                username="exp_user",
                hashed_password="x",
                name="Export User",
                avatar_url="https://cdn/a.png",
                preferred_language="ro-RO",
                email_verified=True,
                role=UserRole.customer,
                created_at=now,
            )
            session.add(user)
            await session.flush()

            category = Category(slug="cat", name="Cat", created_at=now)
            session.add(category)
            await session.flush()

            tag = Tag(name="New", slug="new")
            session.add(tag)
            await session.flush()

            # Product WITH publish_at set (truthy ternary side) and full graph.
            product = Product(
                category_id=category.id,
                sku="SKU-1",
                slug="p1",
                name="Product One",
                short_description="short",
                long_description="long",
                base_price=Decimal("12.50"),
                currency="RON",
                is_featured=True,
                stock_quantity=5,
                status=ProductStatus.published,
                publish_at=now,
                meta_title="mt",
                meta_description="md",
                created_at=now,
            )
            product.tags.append(tag)
            session.add(product)
            await session.flush()

            session.add(
                ProductImage(
                    product_id=product.id,
                    url="https://cdn/p1.png",
                    alt_text="alt",
                    sort_order=0,
                )
            )
            session.add(
                ProductOption(
                    product_id=product.id,
                    option_name="Size",
                    option_value="M",
                )
            )
            session.add(
                ProductVariant(
                    product_id=product.id,
                    name="Variant",
                    additional_price_delta=Decimal("1.00"),
                    stock_quantity=3,
                )
            )

            # Product WITHOUT publish_at (falsy ternary side) and empty graph.
            product2 = Product(
                category_id=category.id,
                sku="SKU-2",
                slug="p2",
                name="Product Two",
                base_price=Decimal("0.00"),
                currency="RON",
                stock_quantity=0,
                status=ProductStatus.draft,
                publish_at=None,
                created_at=now,
            )
            session.add(product2)

            # Address attached to a user (user_id truthy side).
            addr = Address(
                user_id=user.id,
                line1="Str 1",
                line2="Ap 2",
                city="Bucuresti",
                region="B",
                postal_code="010101",
                country="RO",
            )
            # Address without a user (user_id falsy side).
            addr2 = Address(
                user_id=None,
                line1="Str 2",
                city="Cluj",
                postal_code="020202",
                country="RO",
            )
            session.add_all([addr, addr2])
            await session.flush()

            # Order WITH user + both addresses + one item (all truthy sides).
            order = Order(
                user_id=user.id,
                status=OrderStatus.paid,
                total_amount=Decimal("12.50"),
                currency="RON",
                reference_code="REF-1",
                customer_email="exp@example.com",
                customer_name="Export User",
                shipping_address_id=addr.id,
                billing_address_id=addr.id,
                created_at=now,
            )
            order.items.append(
                OrderItem(
                    product_id=product.id,
                    quantity=1,
                    unit_price=Decimal("12.50"),
                    subtotal=Decimal("12.50"),
                )
            )
            # Order WITHOUT user / addresses (all falsy sides), no items.
            order2 = Order(
                user_id=None,
                status=OrderStatus.pending_payment,
                total_amount=Decimal("0.00"),
                currency="RON",
                reference_code=None,
                customer_email="anon@example.com",
                customer_name="Anon",
                shipping_address_id=None,
                billing_address_id=None,
                created_at=now,
            )
            session.add_all([order, order2])
            await session.commit()

            return await exporter.export_json(session)

    data = asyncio.run(run())

    # Users
    assert len(data["users"]) == 1
    exported_user = data["users"][0]
    assert exported_user["email"] == "exp@example.com"
    assert exported_user["role"] == "customer"
    assert exported_user["preferred_language"] == "ro-RO"
    assert exported_user["created_at"].startswith("2024-01-02")

    # Categories
    assert data["categories"][0]["slug"] == "cat"

    # Products: first has full nested graph + publish_at, second is bare.
    assert len(data["products"]) == 2
    p1 = next(p for p in data["products"] if p["slug"] == "p1")
    assert p1["base_price"] == 12.5
    assert p1["status"] == "published"
    assert p1["publish_at"].startswith("2024-01-02")
    assert p1["tags"] == ["new"]
    assert p1["images"][0]["url"] == "https://cdn/p1.png"
    assert p1["options"][0] == {
        "id": p1["options"][0]["id"],
        "name": "Size",
        "value": "M",
    }
    assert p1["variants"][0]["price_delta"] == 1.0
    p2 = next(p for p in data["products"] if p["slug"] == "p2")
    assert p2["publish_at"] is None
    assert p2["tags"] == []
    assert p2["images"] == []
    assert p2["options"] == []
    assert p2["variants"] == []

    # Addresses: one with a user, one without.
    by_city = {a["city"]: a for a in data["addresses"]}
    assert by_city["Bucuresti"]["user_id"] is not None
    assert by_city["Cluj"]["user_id"] is None

    # Orders: one fully linked (with item), one anonymous (empty).
    assert len(data["orders"]) == 2
    o1 = next(o for o in data["orders"] if o["reference_code"] == "REF-1")
    assert o1["user_id"] is not None
    assert o1["shipping_address_id"] is not None
    assert o1["billing_address_id"] is not None
    assert o1["total_amount"] == 12.5
    assert o1["status"] == "paid"
    assert o1["items"][0]["product_id"] is not None
    assert o1["items"][0]["subtotal"] == 12.5
    o2 = next(o for o in data["orders"] if o["reference_code"] != "REF-1")
    assert o2["user_id"] is None
    assert o2["shipping_address_id"] is None
    assert o2["billing_address_id"] is None
    assert o2["items"] == []
