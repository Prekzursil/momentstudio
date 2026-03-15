from __future__ import annotations

import asyncio
from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI, HTTPException
from sqlalchemy.exc import SQLAlchemyError

from app.services import fx_store, media_usage_reconcile_scheduler as scheduler, taxes


class _DummyResult:
    def __init__(self, *, scalar=None, rows=None):
        self._scalar = scalar
        self._rows = rows or []

    def scalar_one_or_none(self):
        return self._scalar

    def scalar_one(self):
        return self._scalar

    def all(self):
        return list(self._rows)


class _DummySession:
    def __init__(self, *, dialect_name: str = "sqlite"):
        self._dialect_name = dialect_name
        self.commits = 0
        self.rollbacks = 0
        self.added = []
        self.deleted = []
        self.refreshed = []

    def get_bind(self):
        return SimpleNamespace(dialect=SimpleNamespace(name=self._dialect_name))

    async def execute(self, _stmt):
        await asyncio.sleep(0)
        return _DummyResult()

    async def scalar(self, _stmt):
        await asyncio.sleep(0)
        return 0

    def add(self, item):
        self.added.append(item)

    async def commit(self):
        await asyncio.sleep(0)
        self.commits += 1

    async def rollback(self):
        await asyncio.sleep(0)
        self.rollbacks += 1

    async def refresh(self, item):
        await asyncio.sleep(0)
        self.refreshed.append(item)

    async def delete(self, item):
        await asyncio.sleep(0)
        self.deleted.append(item)


class _DummySessionCtx:
    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        await asyncio.sleep(0)
        return self._session

    async def __aexit__(self, exc_type, exc, tb):
        await asyncio.sleep(0)
        return False


def _checkout(**overrides):
    base = {
        "vat_enabled": True,
        "vat_rate_percent": Decimal("19.00"),
        "vat_apply_to_shipping": True,
        "vat_apply_to_fee": True,
        "money_rounding": "half_up",
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def _line(product_id: UUID, subtotal: str):
    return taxes.TaxableProductLine(product_id=product_id, subtotal=Decimal(subtotal))


def test_taxes_normalizers_and_discount_helpers() -> None:
    assert taxes._normalize_country_code("ro") == "RO"
    assert taxes._normalize_country_code(" ") is None
    with pytest.raises(HTTPException):
        taxes._normalize_country_code("rom")

    assert taxes._normalize_group_code("  Standard VAT  ") == "standard-vat"
    with pytest.raises(HTTPException):
        taxes._normalize_group_code("  ")

    lines = [_line(uuid4(), "100.00"), _line(uuid4(), "50.00")]
    allocations = taxes._allocate_discount(lines, Decimal("30.00"))
    assert allocations == [Decimal("20.00"), Decimal("10.00")]

    assert taxes._allocate_discount([], Decimal("10")) == []
    assert taxes._discount_allocation_inputs(lines, Decimal("0")) is None
    assert taxes._normalized_discount_amount(Decimal("0"), subtotal=Decimal("100")) is None
    assert taxes._normalized_discount_amount(Decimal("200"), subtotal=Decimal("150")) == Decimal("150")


def test_taxes_vat_base_and_extra_amounts() -> None:
    p1 = uuid4()
    p2 = uuid4()
    lines = [_line(p1, "120.00"), _line(p2, "80.00")]

    base = taxes._vat_base_by_rate(
        lines=lines,
        discount_q=Decimal("20.00"),
        rounding="half_up",
        rates_by_product={p1: Decimal("19.00")},
        default_rate=Decimal("9.00"),
    )
    assert Decimal("19.00") in base and Decimal("9.00") in base

    taxes._apply_extra_vat_base(
        base_by_rate=base,
        shipping_q=Decimal("10.00"),
        fee_q=Decimal("2.00"),
        default_rate=Decimal("9.00"),
        apply_to_shipping=True,
        apply_to_fee=False,
    )
    assert base[Decimal("9.00")] >= Decimal("10.00")

    total = taxes._vat_total(base, rounding="half_up")
    assert total >= Decimal("0.00")


def test_compute_cart_vat_amount_default_and_country(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _run() -> None:
        session = _DummySession()
        checkout = _checkout(vat_enabled=False)
        lines = [_line(uuid4(), "100.00")]

        disabled = await taxes.compute_cart_vat_amount(
            session,
            country_code="RO",
            lines=lines,
            discount=Decimal("0"),
            shipping=Decimal("0"),
            fee=Decimal("0"),
            checkout=checkout,
        )
        assert disabled == Decimal("0.00")

        checkout_enabled = _checkout(vat_enabled=True, vat_rate_percent=Decimal("19.00"))
        default_country = await taxes.compute_cart_vat_amount(
            session,
            country_code=None,
            lines=lines,
            discount=Decimal("10.00"),
            shipping=Decimal("5.00"),
            fee=Decimal("0"),
            checkout=checkout_enabled,
        )
        assert default_country > Decimal("0.00")

        async def _rates(*_args, **_kwargs):
            await asyncio.sleep(0)
            return {lines[0].product_id: Decimal("9.00")}

        async def _default_rate(*_args, **_kwargs):
            await asyncio.sleep(0)
            return Decimal("9.00")

        monkeypatch.setattr(taxes, "vat_rates_for_products", _rates)
        monkeypatch.setattr(taxes, "default_country_vat_rate_percent", _default_rate)
        country_vat = await taxes.compute_cart_vat_amount(
            session,
            country_code="RO",
            lines=lines,
            discount=Decimal("0"),
            shipping=Decimal("0"),
            fee=Decimal("0"),
            checkout=checkout_enabled,
        )
        assert country_vat == Decimal("9.00")

    asyncio.run(_run())


def test_fx_store_helpers_and_effective_rates_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _run() -> None:
        now = datetime.now(timezone.utc)
        row = SimpleNamespace(base="RON", eur_per_ron=Decimal("0.20"), usd_per_ron=Decimal("0.21"), as_of=date.today(), source="seed", fetched_at=now)
        read = fx_store._row_to_read(row)
        assert read.base == "RON"

        target = SimpleNamespace(base="EUR", eur_per_ron=Decimal("1"), usd_per_ron=Decimal("1"), as_of=date.today(), source="x", fetched_at=now)
        fx_store._apply_fx_row_data(target, read)
        assert target.base == "RON"

        session = _DummySession()

        async def _get_override(*_args, **_kwargs):
            await asyncio.sleep(0)
            return row

        monkeypatch.setattr(fx_store, "_get_row", _get_override)
        effective = await fx_store.get_effective_rates(session)
        assert effective.source == "seed"

        async def _no_rows(*_args, **_kwargs):
            await asyncio.sleep(0)
            return None

        class _Live:
            base = "RON"
            eur_per_ron = Decimal("0.22")
            usd_per_ron = Decimal("0.23")
            as_of = date.today()
            source = "live"
            fetched_at = now

        async def _live(*_args, **_kwargs):
            await asyncio.sleep(0)
            return _Live()

        async def _upsert(*_args, **_kwargs):
            await asyncio.sleep(0)
            raise SQLAlchemyError("persist-fail")

        monkeypatch.setattr(fx_store, "_get_row", _no_rows)
        monkeypatch.setattr(fx_store.fx_rates, "get_fx_rates", _live)
        monkeypatch.setattr(fx_store, "_upsert_row", _upsert)
        effective_live = await fx_store.get_effective_rates(session)
        assert effective_live.source == "live"
        assert session.rollbacks == 1

        async def _live_fail(*_args, **_kwargs):
            await asyncio.sleep(0)
            raise RuntimeError("upstream down")

        monkeypatch.setattr(fx_store.fx_rates, "get_fx_rates", _live_fail)
        with pytest.raises(HTTPException) as exc:
            await fx_store.get_effective_rates(session)
        assert exc.value.status_code == 503

    asyncio.run(_run())


def test_fx_override_admin_and_clear_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _run() -> None:
        session = _DummySession()
        now = datetime.now(timezone.utc)
        user_id = uuid4()
        payload = SimpleNamespace(eur_per_ron=Decimal("0.20"), usd_per_ron=Decimal("0.21"), as_of=date.today())

        async def _upsert(*_args, **_kwargs):
            await asyncio.sleep(0)
            return None

        async def _audit(*_args, **_kwargs):
            await asyncio.sleep(0)
            return None

        monkeypatch.setattr(fx_store, "_upsert_row", _upsert)
        monkeypatch.setattr(fx_store, "_log_override_audit", _audit)
        result = await fx_store.set_override(session, payload, user_id=user_id)
        assert result.source == "admin"

        existing = SimpleNamespace(base="RON", eur_per_ron=Decimal("0.20"), usd_per_ron=Decimal("0.21"), as_of=date.today(), source="admin", fetched_at=now)

        async def _get_row(*_args, **kwargs):
            await asyncio.sleep(0)
            if kwargs.get("is_override"):
                return existing
            return None

        monkeypatch.setattr(fx_store, "_get_row", _get_row)
        await fx_store.clear_override(session, user_id=user_id)
        assert existing in session.deleted

        async def _get_status(*_args, **kwargs):
            await asyncio.sleep(0)
            if kwargs.get("is_override"):
                return existing
            return existing

        monkeypatch.setattr(fx_store, "_get_row", _get_status)
        status = await fx_store.get_admin_status(session)
        assert status.override is not None

    asyncio.run(_run())


def test_media_usage_scheduler_run_once_loop_and_start_stop(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _run() -> None:
        monkeypatch.setattr(scheduler.settings, "media_usage_reconcile_enabled", False)
        assert await scheduler._run_once() == 0

        monkeypatch.setattr(scheduler.settings, "media_usage_reconcile_enabled", True)
        monkeypatch.setattr(scheduler.settings, "media_usage_reconcile_batch_size", 250)

        session = _DummySession()

        async def _scalar(_stmt):
            await asyncio.sleep(0)
            return 0

        session.scalar = _scalar
        monkeypatch.setattr(scheduler, "SessionLocal", lambda: _DummySessionCtx(session))

        queued = []

        async def _enqueue_job(_session, **_kwargs):
            await asyncio.sleep(0)
            return SimpleNamespace(id=uuid4())

        async def _queue_job(job_id):
            await asyncio.sleep(0)
            queued.append(job_id)

        async def _get_job(_session, job_id):
            await asyncio.sleep(0)
            return SimpleNamespace(id=job_id)

        async def _process_inline(_session, _job):
            await asyncio.sleep(0)
            return None

        monkeypatch.setattr(scheduler.media_dam, "enqueue_job", _enqueue_job)
        monkeypatch.setattr(scheduler.media_dam, "queue_job", _queue_job)
        monkeypatch.setattr(scheduler.media_dam, "get_redis", lambda: None)
        monkeypatch.setattr(scheduler.media_dam, "get_job_or_404", _get_job)
        monkeypatch.setattr(scheduler.media_dam, "process_job_inline", _process_inline)

        assert await scheduler._run_once() == 1
        assert len(queued) == 1

        stop = asyncio.Event()

        async def _run_once_loop():
            await asyncio.sleep(0)
            stop.set()
            return 1

        monkeypatch.setattr(scheduler, "_run_once", _run_once_loop)
        monkeypatch.setattr(scheduler.settings, "media_usage_reconcile_interval_seconds", 300)
        await scheduler._loop(stop)

        app = FastAPI()

        async def _run_as_leader(name, stop, work):
            await work(stop)

        monkeypatch.setattr(scheduler.leader_lock, "run_as_leader", _run_as_leader)
        scheduler.start(app)
        assert getattr(app.state, "media_usage_reconcile_scheduler_task", None) is not None
        await scheduler.stop(app)
        assert getattr(app.state, "media_usage_reconcile_scheduler_task", None) is None

    asyncio.run(_run())
