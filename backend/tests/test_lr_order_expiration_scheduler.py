"""Lean-gate unit coverage for ``app.services.order_expiration_scheduler``."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.order import Order, OrderEvent, OrderStatus
from app.services import order_expiration_scheduler as sched


def _memory_session_factory() -> async_sessionmaker:
    import app.models  # noqa: F401  (register all ORM tables on Base.metadata)
    from app.db.base import Base

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def _init() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_init())
    return factory


@pytest.fixture
def session_factory(monkeypatch):
    factory = _memory_session_factory()
    monkeypatch.setattr(sched, "SessionLocal", factory)
    return factory


def _make_order(*, created_at: datetime, status=OrderStatus.pending_payment, **kw) -> Order:
    return Order(
        status=status,
        customer_email="c@example.com",
        customer_name="Cust",
        total_amount=10,
        created_at=created_at,
        **kw,
    )


@pytest.mark.anyio
async def test_run_once_disabled_returns_zero(monkeypatch) -> None:
    monkeypatch.setattr(
        sched.settings, "order_pending_payment_expiry_enabled", False, raising=False
    )
    assert await sched._run_once() == 0


@pytest.mark.anyio
async def test_run_once_zero_ttl_returns_zero(monkeypatch) -> None:
    monkeypatch.setattr(
        sched.settings, "order_pending_payment_expiry_enabled", True, raising=False
    )
    monkeypatch.setattr(
        sched.settings, "order_pending_payment_expiry_minutes", 0, raising=False
    )
    assert await sched._run_once() == 0


@pytest.mark.anyio
async def test_run_once_no_matching_rows(monkeypatch, session_factory) -> None:
    monkeypatch.setattr(
        sched.settings, "order_pending_payment_expiry_enabled", True, raising=False
    )
    monkeypatch.setattr(
        sched.settings, "order_pending_payment_expiry_minutes", 30, raising=False
    )
    # A fresh (non-expired) order should not be touched.
    async with session_factory() as session:
        session.add(_make_order(created_at=datetime.now(timezone.utc)))
        await session.commit()
    assert await sched._run_once() == 0


@pytest.mark.anyio
async def test_run_once_cancels_expired_orders(monkeypatch, session_factory) -> None:
    monkeypatch.setattr(
        sched.settings, "order_pending_payment_expiry_enabled", True, raising=False
    )
    monkeypatch.setattr(
        sched.settings, "order_pending_payment_expiry_minutes", 30, raising=False
    )
    monkeypatch.setattr(
        sched.settings, "order_pending_payment_expiry_batch_limit", 0, raising=False
    )  # exercises the max(1, ...) clamp
    old = datetime.now(timezone.utc) - timedelta(hours=2)
    async with session_factory() as session:
        # One with a blank cancel_reason -> default applied.
        session.add(_make_order(created_at=old))
        # One with an existing cancel_reason -> preserved.
        session.add(_make_order(created_at=old, cancel_reason="Manual"))
        await session.commit()

    count = await sched._run_once()
    assert count == 2

    async with session_factory() as session:
        orders = (await session.execute(select(Order))).scalars().all()
        assert all(o.status is OrderStatus.cancelled for o in orders)
        reasons = sorted(o.cancel_reason for o in orders)
        assert reasons == ["Manual", "Payment expired"]
        events = (await session.execute(select(OrderEvent))).scalars().all()
        assert len(events) == 2


@pytest.mark.anyio
async def test_loop_runs_then_stops(monkeypatch) -> None:
    calls = {"n": 0}
    stop = asyncio.Event()

    # Distinct sentinel interval lets the wait_for shim recognise the loop's own
    # backoff call (vs. the test's outer timeout) and force the suppressed
    # TimeoutError branch on the first iteration, then stop on the second.
    monkeypatch.setattr(
        sched.settings,
        "order_pending_payment_expiry_poll_interval_seconds",
        4242,
        raising=False,
    )

    async def fake_run_once() -> int:
        calls["n"] += 1
        if calls["n"] >= 2:
            stop.set()
        return 3  # non-zero -> logs

    monkeypatch.setattr(sched, "_run_once", fake_run_once)

    real_wait_for = asyncio.wait_for

    async def shim_wait_for(awaitable, timeout):  # noqa: ANN001
        if timeout == 4242:
            awaitable.close()
            raise asyncio.TimeoutError
        return await real_wait_for(awaitable, timeout)

    monkeypatch.setattr(sched.asyncio, "wait_for", shim_wait_for)

    await real_wait_for(sched._loop(stop), timeout=5)
    assert calls["n"] == 2


@pytest.mark.anyio
async def test_loop_cancelled_breaks(monkeypatch) -> None:
    async def boom_run_once() -> int:
        raise asyncio.CancelledError

    monkeypatch.setattr(sched, "_run_once", boom_run_once)
    stop = asyncio.Event()
    await sched._loop(stop)  # CancelledError caught -> break -> returns


@pytest.mark.anyio
async def test_loop_logs_unexpected_error(monkeypatch) -> None:
    state = {"called": False}
    stop = asyncio.Event()

    async def boom_then_stop() -> int:
        if not state["called"]:
            state["called"] = True
            raise RuntimeError("kaboom")
        stop.set()
        return 0

    monkeypatch.setattr(sched, "_run_once", boom_then_stop)
    monkeypatch.setattr(
        sched.settings,
        "order_pending_payment_expiry_poll_interval_seconds",
        4242,
        raising=False,
    )

    real_wait_for = asyncio.wait_for

    async def shim_wait_for(awaitable, timeout):  # noqa: ANN001
        if timeout == 4242:
            awaitable.close()
            raise asyncio.TimeoutError
        return await real_wait_for(awaitable, timeout)

    monkeypatch.setattr(sched.asyncio, "wait_for", shim_wait_for)

    await real_wait_for(sched._loop(stop), timeout=5)
    assert state["called"] is True


# --------------------------------------------------------------------------- #
# start / stop                                                                 #
# --------------------------------------------------------------------------- #
class _FakeState:
    pass


class _FakeApp:
    def __init__(self) -> None:
        self.state = _FakeState()


@pytest.mark.anyio
async def test_start_disabled_noop(monkeypatch) -> None:
    monkeypatch.setattr(
        sched.settings, "order_pending_payment_expiry_enabled", False, raising=False
    )
    app = _FakeApp()
    sched.start(app)
    assert getattr(app.state, "order_expiration_scheduler_task", None) is None


@pytest.mark.anyio
async def test_start_idempotent_when_already_running(monkeypatch) -> None:
    monkeypatch.setattr(
        sched.settings, "order_pending_payment_expiry_enabled", True, raising=False
    )
    app = _FakeApp()
    app.state.order_expiration_scheduler_task = "sentinel"
    sched.start(app)
    assert app.state.order_expiration_scheduler_task == "sentinel"


@pytest.mark.anyio
async def test_start_then_stop(monkeypatch) -> None:
    monkeypatch.setattr(
        sched.settings, "order_pending_payment_expiry_enabled", True, raising=False
    )

    async def fake_leader(*, name, stop, work):  # noqa: ANN001
        await stop.wait()

    monkeypatch.setattr(sched.leader_lock, "run_as_leader", fake_leader)
    app = _FakeApp()
    sched.start(app)
    assert app.state.order_expiration_scheduler_task is not None
    await sched.stop(app)
    assert getattr(app.state, "order_expiration_scheduler_task", None) is None
    assert getattr(app.state, "order_expiration_scheduler_stop", None) is None


@pytest.mark.anyio
async def test_stop_noop_when_nothing_running() -> None:
    app = _FakeApp()
    await sched.stop(app)  # no attrs set -> safe
