"""Deep-handler arc closures for admin_dashboard (batch 6).

Coverage worker [w2]. Covers the alert-thresholds IntegrityError-recovery race,
the global-search UUID/text match + PII-mask branches, and the duplicate-check
slug-suggestion loop / exclude branches in ``app.api.v1.admin_dashboard``.
"""

from __future__ import annotations

import asyncio
from decimal import Decimal
from typing import Any, Callable
from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError

from app.api.v1 import admin_dashboard as ad
from app.db.base import Base
from app.models.catalog import Category, Product
from app.models.order import Order
from app.models.user import User, UserRole
from app.schemas.user import UserCreate
from app.services.auth import create_user
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest.fixture
def session_factory() -> async_sessionmaker:
    import app.models  # noqa: F401

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def _init() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_init())
    return factory


def run(factory: async_sessionmaker, coro_fn: Callable[[Any], Any]) -> Any:
    async def _wrapped() -> Any:
        async with factory() as session:
            return await coro_fn(session)

    return asyncio.run(_wrapped())


class _Req:
    def __init__(self, *, ua: str = "agent", host: str | None = "127.0.0.1") -> None:
        self.headers = {"user-agent": ua}
        self.client = type("C", (), {"host": host})() if host is not None else None


async def _admin(session, *, role: UserRole = UserRole.admin) -> User:
    user = await create_user(
        session,
        UserCreate(
            email=f"{role.value}-{uuid4().hex[:6]}@x.com",
            password="password123",
            name="A",
        ),
    )
    user.role = role
    await session.commit()
    await session.refresh(user)
    return user


async def _make_product(session, **kw: Any) -> Product:
    cat = Category(id=uuid4(), slug=f"c-{uuid4().hex[:6]}", name="Cat")
    session.add(cat)
    await session.commit()
    defaults = dict(
        id=uuid4(),
        category_id=cat.id,
        slug=f"p-{uuid4().hex[:6]}",
        name="Prod",
        stock_quantity=5,
        is_deleted=False,
        is_active=True,
    )
    defaults.update(kw)
    product = Product(**defaults)
    session.add(product)
    await session.commit()
    await session.refresh(product)
    return product


# --------------------------------------------------------------------------- #
# _get_dashboard_alert_thresholds: IntegrityError race (186-194)             #
# --------------------------------------------------------------------------- #
def test_alert_thresholds_integrity_race_recovers(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _scenario(session) -> Any:
        # Pre-seed the default row so the post-rollback select finds it.
        from app.models.admin_dashboard_settings import AdminDashboardAlertThresholds

        session.add(AdminDashboardAlertThresholds(key="default"))
        await session.commit()

        # Force the first commit (the insert) to raise IntegrityError once so
        # the except branch runs and recovers via the select.
        real_commit = session.commit
        state = {"raised": False}

        async def _commit():
            if not state["raised"]:
                state["raised"] = True
                raise IntegrityError("dup", None, Exception("dup"))
            return await real_commit()

        # Detach the pre-seeded row from the identity map so the helper's
        # ``scalar(... key == default)`` first lookup misses and it attempts an
        # insert (which our patched commit fails), then recovers.
        session.expunge_all()
        monkeypatch.setattr(session, "commit", _commit)
        record = await ad._get_dashboard_alert_thresholds(session)
        return record

    rec = run(session_factory, _scenario)
    assert rec is not None
    assert rec.key == "default"


# --------------------------------------------------------------------------- #
# admin_global_search: UUID matches + text matches with PII mask             #
# --------------------------------------------------------------------------- #
def test_global_search_uuid_order_masked(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ad.pii_service, "mask_email", lambda e: "m***@x.com")

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        oid = uuid4()
        session.add(
            Order(
                id=oid,
                customer_email="buyer@x.com",
                customer_name="Buyer",
                total_amount=Decimal("10.00"),
                reference_code="REF1",
            )
        )
        await session.commit()
        return await ad.admin_global_search(
            request=_Req(),
            q=str(oid),
            include_pii=False,
            session=session,
            current_user=admin,
        )

    out = run(session_factory, _scenario)
    assert any(r.type == "order" and r.subtitle == "m***@x.com" for r in out.items)


def test_global_search_uuid_product_and_user(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        ad.pii_service, "require_pii_reveal", lambda u, request=None: None
    )

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        product = await _make_product(session)
        # search by product UUID with include_pii=True
        return await ad.admin_global_search(
            request=_Req(),
            q=str(product.id),
            include_pii=True,
            session=session,
            current_user=admin,
        )

    out = run(session_factory, _scenario)
    assert any(r.type == "product" for r in out.items)


def test_global_search_text_order_masked(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ad.pii_service, "mask_email", lambda e: "m***@x.com")

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        session.add(
            Order(
                id=uuid4(),
                customer_email="findme@x.com",
                customer_name="Find",
                total_amount=Decimal("5.00"),
                reference_code="FINDREF",
            )
        )
        await session.commit()
        return await ad.admin_global_search(
            request=_Req(),
            q="findme",
            include_pii=False,
            session=session,
            current_user=admin,
        )

    out = run(session_factory, _scenario)
    assert any(r.type == "order" for r in out.items)


def test_global_search_text_product_and_user(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ad.pii_service, "mask_email", lambda e: "m***@x.com")

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        await _make_product(session, name="Searchable Widget", slug="searchable-widget")
        return await ad.admin_global_search(
            request=_Req(),
            q="searchable",
            include_pii=False,
            session=session,
            current_user=admin,
        )

    out = run(session_factory, _scenario)
    assert any(r.type == "product" for r in out.items)


def test_global_search_empty_needle(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        return await ad.admin_global_search(
            request=_Req(),
            q="   ",
            include_pii=False,
            session=session,
            current_user=admin,
        )

    assert run(session_factory, _scenario).items == []


# --------------------------------------------------------------------------- #
# duplicate_check_products: slug-suggestion loop + exclude branches          #
# --------------------------------------------------------------------------- #
def test_duplicate_check_slug_suggestion_loop(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ad.catalog_service, "slugify", lambda v: "widget")

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        # Existing slugs widget, widget-2 -> suggestion must roll to widget-3
        # which exercises the ``counter += 1`` loop iteration (2415).
        await _make_product(session, slug="widget", name="Widget")
        await _make_product(session, slug="widget-2", name="Widget Two")
        return await ad.duplicate_check_products(
            session=session,
            _=admin,
            name="Widget",
            sku=None,
            exclude_slug=None,
        )

    out = run(session_factory, _scenario)
    assert out.suggested_slug == "widget-3"


def test_duplicate_check_sku_and_name_with_exclude(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ad.catalog_service, "slugify", lambda v: "thing")

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        await _make_product(session, slug="thing", name="Thing", sku="SKU-DUP")
        return await ad.duplicate_check_products(
            session=session,
            _=admin,
            name="Thing",
            sku="SKU-DUP",
            exclude_slug="thing",  # exercises exclude branches (2381/2402/2422/2442)
        )

    out = run(session_factory, _scenario)
    # excluded the only match -> suggestion is the base slug
    assert out.suggested_slug == "thing"


def test_duplicate_check_no_inputs(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        return await ad.duplicate_check_products(
            session=session, _=admin, name=None, sku=None, exclude_slug=None
        )

    out = run(session_factory, _scenario)
    assert out.suggested_slug is None
