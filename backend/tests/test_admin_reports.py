from __future__ import annotations

from datetime import datetime, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core import security
from app.db.base import Base
from app.models.catalog import Category, Product, ProductStatus
from app.models.content import ContentBlock, ContentStatus
from app.models.order import Order, OrderItem, OrderStatus
from app.models.user import User, UserRole
from app.services import admin_reports
from app.services import email as email_service


@pytest.mark.anyio
async def test_send_report_now_updates_last_sent(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False, autoflush=False)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    monkeypatch.setattr(admin_reports.settings, "smtp_enabled", True)

    async def fake_send_admin_report_summary(*args, **kwargs) -> bool:
        return True

    monkeypatch.setattr(email_service, "send_admin_report_summary", fake_send_admin_report_summary)

    async with SessionLocal() as session:
        owner = User(
            email="owner@example.com",
            username="owner",
            hashed_password=security.hash_password("Password123"),
            role=UserRole.owner,
        )
        session.add(owner)
        await session.flush()

        category = Category(slug="cat", name="Cat", sort_order=1)
        session.add(category)
        await session.flush()

        product = Product(
            slug="product",
            name="Product",
            base_price=50,
            currency="RON",
            category_id=category.id,
            stock_quantity=0,
            status=ProductStatus.published,
        )
        session.add(product)
        await session.flush()

        # Weekly period will be 2025-01-06 08:00 UTC when now is 2025-01-08.
        order = Order(
            status=OrderStatus.paid,
            total_amount=100,
            currency="RON",
            tax_amount=0,
            shipping_amount=0,
            fee_amount=0,
            customer_email="customer@example.com",
            customer_name="Customer",
            created_at=datetime(2025, 1, 2, 12, 0, tzinfo=timezone.utc),
        )
        session.add(order)
        await session.flush()
        session.add(
            OrderItem(
                order_id=order.id,
                product_id=product.id,
                quantity=2,
                shipped_quantity=0,
                unit_price=50,
                subtotal=100,
                created_at=datetime(2025, 1, 2, 12, 0, tzinfo=timezone.utc),
            )
        )

        session.add(
            ContentBlock(
                key="site.reports",
                title="Reports settings",
                body_markdown="",
                status=ContentStatus.published,
                meta={
                    "reports_weekly_enabled": True,
                    "reports_weekly_weekday": 0,
                    "reports_weekly_hour_utc": 8,
                    "reports_recipients": ["a@example.com", "b@example.com"],
                },
            )
        )
        await session.commit()

    async with SessionLocal() as session:
        now = datetime(2025, 1, 8, 10, 0, tzinfo=timezone.utc)
        res = await admin_reports.send_report_now(session, kind="weekly", force=True, now=now)
        assert res["delivered"] == 2
        assert res["attempted"] == 2
        assert res["skipped"] is False

        block = (await session.execute(select(ContentBlock).where(ContentBlock.key == "site.reports"))).scalar_one()
        assert str(block.meta.get("reports_weekly_last_sent_period_end")).startswith("2025-01-06T08:00:00")

