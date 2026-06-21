"""Channel-attribution + search/dup-check tail arcs for admin_dashboard (batch 12).

Coverage worker [w2]. Closes the channel-attribution loop ``continue`` guards
and empty-attribution early return (stubbed analytics rows), the search-products
no-result translation-skip arc, and the duplicate-check sku exclude arc.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Callable
from uuid import uuid4

import pytest

from app.api.v1 import admin_dashboard as ad
from app.db.base import Base
from app.models.catalog import Category, Product
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


class _RowsResult:
    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def all(self) -> list[Any]:
        return self._rows


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
        sku=f"SKU-{uuid4().hex[:6]}",
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
# channel-attribution: empty -> early return (1872->1879)                    #
# --------------------------------------------------------------------------- #
def test_channel_attribution_empty_early_return(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)

        async def _scalar(*args, **kwargs):
            return 0

        async def _execute(*args, **kwargs):
            # checkout_rows: only null/invalid rows -> order_to_session empty.
            return _RowsResult([(None, None), ("s1", None)])

        monkeypatch.setattr(session, "scalar", _scalar)
        monkeypatch.setattr(session, "execute", _execute)
        return await ad.admin_channel_attribution(
            session=session,
            _=admin,
            range_days=30,
            range_from=None,
            range_to=None,
            limit=12,
        )

    out = run(session_factory, _scenario)
    assert out["tracked_orders"] == 0
    assert out["channels"] == []


# --------------------------------------------------------------------------- #
# channel-attribution: full path with continues (1873/1875/1921/1943)        #
# --------------------------------------------------------------------------- #
def test_channel_attribution_full_path(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    oid1 = uuid4()
    oid2 = uuid4()

    async def _scenario(session) -> Any:
        admin = await _admin(session)

        async def _scalar(*args, **kwargs):
            return 5  # nonzero total_orders -> coverage_pct branch

        state = {"n": 0}

        async def _execute(*args, **kwargs):
            state["n"] += 1
            if state["n"] == 1:
                # checkout_rows (session_id, order_id): null row -> 1873 continue;
                # duplicate order -> 1875 continue; two valid.
                return _RowsResult(
                    [
                        (None, None),
                        ("sess-a", oid1),
                        ("sess-a", oid1),  # dup order_id -> continue
                        ("sess-b", oid2),
                    ]
                )
            if state["n"] == 2:
                # order_rows (id, amount): oid1 has amount, oid2 missing -> 1943
                return _RowsResult([(oid1, Decimal("100.00"))])
            # session_start_rows (session_id, payload, created_at): dup -> 1921
            return _RowsResult(
                [
                    (
                        "sess-a",
                        {"utm_source": "google", "utm_medium": "cpc"},
                        datetime.now(timezone.utc),
                    ),
                    ("sess-a", {"utm_source": "x"}, datetime.now(timezone.utc)),  # dup
                ]
            )

        monkeypatch.setattr(session, "scalar", _scalar)
        monkeypatch.setattr(session, "execute", _execute)
        return await ad.admin_channel_attribution(
            session=session,
            _=admin,
            range_days=30,
            range_from=None,
            range_to=None,
            limit=12,
        )

    out = run(session_factory, _scenario)
    assert out["tracked_orders"] == 1  # only oid1 had an amount
    assert out["coverage_pct"] is not None


def test_channel_attribution_zero_total_orders(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    """order_to_session non-empty but total_orders == 0 -> coverage_pct stays
    None (1969->1972 false arc)."""
    oid = uuid4()

    async def _scenario(session) -> Any:
        admin = await _admin(session)

        async def _scalar(*args, **kwargs):
            return 0  # total_orders falsy

        state = {"n": 0}

        async def _execute(*args, **kwargs):
            state["n"] += 1
            if state["n"] == 1:
                return _RowsResult([("sess-a", oid)])
            if state["n"] == 2:
                return _RowsResult([(oid, Decimal("50.00"))])
            return _RowsResult(
                [("sess-a", {"utm_source": "g"}, datetime.now(timezone.utc))]
            )

        monkeypatch.setattr(session, "scalar", _scalar)
        monkeypatch.setattr(session, "execute", _execute)
        return await ad.admin_channel_attribution(
            session=session,
            _=admin,
            range_days=30,
            range_from=None,
            range_to=None,
            limit=12,
        )

    out = run(session_factory, _scenario)
    assert out["coverage_pct"] is None


def test_channel_attribution_range_validation(
    session_factory: async_sessionmaker,
) -> None:
    from datetime import date

    from fastapi import HTTPException

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        with pytest.raises(HTTPException):
            await ad.admin_channel_attribution(
                session=session,
                _=admin,
                range_days=30,
                range_from=date(2024, 2, 1),
                range_to=None,  # mismatched -> 400
                limit=12,
            )

    run(session_factory, _scenario)


# --------------------------------------------------------------------------- #
# admin_summary: nonzero previous-window failed payments -> delta_pct (650)   #
# --------------------------------------------------------------------------- #
def test_admin_summary_failed_payments_delta(
    session_factory: async_sessionmaker,
) -> None:
    from datetime import timedelta

    from app.models.order import Order, OrderStatus

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        now = datetime.now(timezone.utc)
        # pending_payment order in the previous 24h window (now-48h..now-24h)
        # makes failed_payments_prev > 0 so _delta_pct computes (line 650).
        session.add(
            Order(
                id=uuid4(),
                customer_email="fp@x.com",
                customer_name="FP",
                total_amount=Decimal("10.00"),
                status=OrderStatus.pending_payment,
                created_at=now - timedelta(hours=36),
            )
        )
        # A current-window pending_payment order too, so the delta is nonzero.
        session.add(
            Order(
                id=uuid4(),
                customer_email="fp2@x.com",
                customer_name="FP2",
                total_amount=Decimal("10.00"),
                status=OrderStatus.pending_payment,
                created_at=now - timedelta(hours=2),
            )
        )
        await session.commit()
        return await ad.admin_summary(
            session=session, _=admin, range_days=30, range_from=None, range_to=None
        )

    out = run(session_factory, _scenario)
    assert isinstance(out, dict)


# --------------------------------------------------------------------------- #
# search_products: no results -> translation block skipped (2244->2258)      #
# --------------------------------------------------------------------------- #
def test_search_products_no_results(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        return await ad.search_products(
            session=session,
            _=admin,
            q="zzz-nonexistent-zzz",
            status=None,
            category_slug=None,
            missing_translations=False,
            missing_translation_lang=None,
            deleted=False,
            page=1,
            limit=25,
        )

    out = run(session_factory, _scenario)
    assert out.meta.total_items == 0


# --------------------------------------------------------------------------- #
# search_products: translation row with null pid/lang -> continue (2255)      #
# --------------------------------------------------------------------------- #
def test_search_products_null_translation_row(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    class _Result:
        def __init__(self, rows):
            self._rows = rows

        def all(self):
            return self._rows

        def scalars(self):
            return self

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        product = await _make_product(session, name="Widget", slug="widget")

        real_execute = session.execute
        state = {"n": 0}

        async def _execute(stmt, *args, **kwargs):
            state["n"] += 1
            # First execute = the product list query (use the real result so a
            # product is returned and product_ids is non-empty). The second is
            # the translation query -> inject a null-pid/lang row (2254 continue).
            if state["n"] == 2:
                return _Result([(None, None)])
            return await real_execute(stmt, *args, **kwargs)

        monkeypatch.setattr(session, "execute", _execute)
        return await ad.search_products(
            session=session,
            _=admin,
            q="widget",
            status=None,
            category_slug=None,
            missing_translations=False,
            missing_translation_lang=None,
            deleted=False,
            page=1,
            limit=25,
        )

    out = run(session_factory, _scenario)
    assert out.meta.total_items >= 1


# --------------------------------------------------------------------------- #
# duplicate_check: sku match present, exclude_slug excludes it (2422->2424)   #
# --------------------------------------------------------------------------- #
def test_duplicate_check_sku_match_not_excluded(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ad.catalog_service, "slugify", lambda v: "")

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        await _make_product(session, slug="kept", sku="MATCH-SKU", name="K")
        # No exclude_slug -> 2422 false arc; sku match returned.
        return await ad.duplicate_check_products(
            session=session,
            _=admin,
            name=None,
            sku="MATCH-SKU",
            exclude_slug=None,
        )

    out = run(session_factory, _scenario)
    assert len(out.sku_matches) == 1
