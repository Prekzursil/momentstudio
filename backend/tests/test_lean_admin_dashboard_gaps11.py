"""Analytics-handler loop/continue arc closures for admin_dashboard (batch 11).

Coverage worker [w2]. The shipping-performance / stockout-impact / channel-
attribution handlers compute durations by iterating query rows and ``continue``
on null timestamp / channel fields. Valid SQLite rows never carry those nulls,
so each handler's ``session.execute`` is stubbed to return a mix of null-field
rows (exercising the ``continue`` guards and the delta-pct non-None branch)
without touching production behaviour.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any, Callable
from uuid import uuid4

import pytest

from app.api.v1 import admin_dashboard as ad
from app.db.base import Base
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
    """Stub ``session.execute`` result; ``all()`` returns preset tuples."""

    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def all(self) -> list[Any]:
        return self._rows

    def scalars(self) -> "_RowsResult":
        return self


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


# --------------------------------------------------------------------------- #
# shipping-performance: null-timestamp continue (1556/1583) + delta-pct       #
# --------------------------------------------------------------------------- #
def test_shipping_performance_null_rows_and_delta(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    now = datetime.now(timezone.utc)

    async def _scenario(session) -> Any:
        admin = await _admin(session)

        # _collect_ship_durations rows: (created_at, courier, shipped_at)
        # _collect_delivery_durations rows: (courier, shipped_at, delivered_at)
        # Provide one null-field row (continue) + two valid rows for the same
        # courier so both current/previous windows have data -> delta_pct runs.
        ship_rows = [
            (None, "dhl", now),  # null created_at -> continue (1556)
            (now + timedelta(hours=1), "dhl", now),  # negative hours -> continue (1559)
            (now - timedelta(hours=10), "dhl", now),  # valid 10h
        ]
        delivery_rows = [
            ("dhl", None, now),  # null shipped_at -> continue (1583)
            ("dhl", now + timedelta(hours=1), now),  # negative -> continue (1586)
            ("dhl", now - timedelta(hours=5), now),  # valid 5h
        ]
        # The handler calls ship-collect twice then delivery-collect twice. Use
        # a counter so the first two execute() return ship rows, next two return
        # delivery rows (all identical per window -> nonzero prev -> delta_pct).
        state = {"n": 0}

        async def _execute(*args, **kwargs):
            state["n"] += 1
            if state["n"] <= 2:
                return _RowsResult(ship_rows)
            return _RowsResult(delivery_rows)

        monkeypatch.setattr(session, "execute", _execute)
        return await ad.admin_shipping_performance(
            session=session, _=admin, window_days=30
        )

    out = run(session_factory, _scenario)
    # dhl appears in both windows with equal counts -> delta_pct count == 0.0
    ship = {r["courier"]: r for r in out["time_to_ship"]}
    assert "dhl" in ship
    assert ship["dhl"]["delta_pct"]["count"] == 0.0
