"""Unit tests for ``app.services.fx_store`` (slice f-k).

Drives the FX-rate persistence/override service directly against an in-memory
SQLite session from the shared conftest helper. Disjoint from ``test_fx_api.py``
(API layer) and ``test_fx_rates_service.py`` (BNR parser/cache): here we cover
``fx_store``'s own branches — the generic non-pg/sqlite upsert fallback, the
503/persist-error paths, override clear-when-absent, and ``refresh_last_known``.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import date, datetime, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.schemas.fx import FxOverrideUpsert, FxRatesRead
from app.services import fx_rates, fx_store
from tests.conftest import make_memory_session_factory


@pytest.fixture
def session_factory():
    return make_memory_session_factory()


def _run(coro):
    return asyncio.run(coro)


def _read(**overrides) -> FxRatesRead:
    base = dict(
        base="RON",
        eur_per_ron=0.2,
        usd_per_ron=0.22,
        as_of=date(2026, 1, 1),
        source="bnr",
        fetched_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    base.update(overrides)
    return FxRatesRead(**base)


def _live(**overrides):
    base = dict(
        base="RON",
        eur_per_ron=0.2,
        usd_per_ron=0.22,
        as_of=date(2026, 1, 1),
        source="bnr",
        fetched_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    base.update(overrides)
    return fx_rates.FxRates(**base)


def test_upsert_row_sqlite_path_inserts_and_updates(session_factory) -> None:
    async def scenario() -> None:
        async with session_factory() as session:
            row = await fx_store._upsert_row(session, is_override=False, data=_read())
            assert float(row.eur_per_ron) == 0.2
            # second call exercises on_conflict_do_update
            row2 = await fx_store._upsert_row(
                session, is_override=False, data=_read(eur_per_ron=0.3)
            )
            assert float(row2.eur_per_ron) == 0.3

    _run(scenario())


class _FakeDialect:
    name = "mysql"  # neither postgresql nor sqlite -> generic branch


class _FakeBind:
    dialect = _FakeDialect()


def test_upsert_row_generic_dialect_insert_then_update(session_factory) -> None:
    """Generic dialect path: real sqlite engine but a faked dialect name forces
    the ORM insert/update fallback (lines 82-123)."""

    async def scenario() -> None:
        async with session_factory() as session:
            session.get_bind = lambda: _FakeBind()  # type: ignore[assignment]
            # First call: no existing row -> ORM insert + commit + refresh.
            row = await fx_store._upsert_row(session, is_override=False, data=_read())
            assert float(row.eur_per_ron) == 0.2
            # Second call: existing row -> in-place update branch.
            row2 = await fx_store._upsert_row(
                session, is_override=False, data=_read(usd_per_ron=0.5)
            )
            assert float(row2.usd_per_ron) == 0.5

    _run(scenario())


def test_upsert_row_generic_dialect_integrity_error_fallback(
    session_factory, monkeypatch
) -> None:
    """When the ORM insert races and raises IntegrityError, the fallback
    re-fetches the existing row and updates it (lines 105-122)."""

    async def scenario() -> None:
        async with session_factory() as session:
            session.get_bind = lambda: _FakeBind()  # type: ignore[assignment]
            # Pre-create the row so a fresh insert would violate the unique key.
            await fx_store._upsert_row(session, is_override=False, data=_read())

            real_commit = session.commit
            calls = {"n": 0}

            async def flaky_commit(*args, **kwargs):
                calls["n"] += 1
                if calls["n"] == 1:
                    raise IntegrityError("stmt", {}, Exception("dup"))
                return await real_commit(*args, **kwargs)

            # Force the "new row" code path by deleting the existing row from the
            # identity map view: instead, monkeypatch _get_row to report None on
            # the first existence probe so the insert branch is taken, then the
            # IntegrityError fallback finds the real row.
            real_get_row = fx_store._get_row
            probe = {"n": 0}

            async def fake_get_row(sess, *, is_override):
                probe["n"] += 1
                if probe["n"] == 1:
                    return None  # pretend no existing -> take insert path
                return await real_get_row(sess, is_override=is_override)

            monkeypatch.setattr(fx_store, "_get_row", fake_get_row)
            monkeypatch.setattr(session, "commit", flaky_commit)

            row = await fx_store._upsert_row(
                session, is_override=False, data=_read(eur_per_ron=0.9)
            )
            assert float(row.eur_per_ron) == 0.9

    _run(scenario())


def test_upsert_row_generic_integrity_error_reraises_when_still_absent(
    session_factory, monkeypatch
) -> None:
    """IntegrityError on the ORM insert, but the post-rollback re-fetch still
    finds no row -> the IntegrityError is re-raised (lines 110-111)."""

    async def scenario() -> None:
        async with session_factory() as session:
            session.get_bind = lambda: _FakeBind()  # type: ignore[assignment]

            async def always_none(sess, *, is_override):
                return None

            monkeypatch.setattr(fx_store, "_get_row", always_none)

            real_commit = session.commit

            async def integrity_commit(*args, **kwargs):
                raise IntegrityError("stmt", {}, Exception("dup"))

            monkeypatch.setattr(session, "commit", integrity_commit)

            with pytest.raises(IntegrityError):
                await fx_store._upsert_row(session, is_override=False, data=_read())
            # restore a working commit so teardown/rollback is clean
            monkeypatch.setattr(session, "commit", real_commit)

    _run(scenario())


def test_get_effective_rates_override_then_last_known_then_live(
    session_factory, monkeypatch
) -> None:
    async def scenario() -> None:
        async with session_factory() as session:
            # No rows yet -> fetch live and persist as last_known.
            monkeypatch.setattr(fx_rates, "get_fx_rates", _async_return(_live()))
            first = await fx_store.get_effective_rates(session)
            assert first.eur_per_ron == 0.2

            # Now a last_known row exists -> served without calling live.
            monkeypatch.setattr(
                fx_rates, "get_fx_rates", _async_raise(RuntimeError("no live"))
            )
            second = await fx_store.get_effective_rates(session)
            assert second.eur_per_ron == 0.2

            # An override takes precedence over last_known.
            await fx_store.set_override(
                session,
                FxOverrideUpsert(eur_per_ron=0.4, usd_per_ron=0.41),
            )
            third = await fx_store.get_effective_rates(session)
            assert third.eur_per_ron == 0.4
            assert third.source == "admin"

    _run(scenario())


def test_get_effective_rates_live_failure_raises_503(
    session_factory, monkeypatch
) -> None:
    async def scenario() -> None:
        async with session_factory() as session:
            monkeypatch.setattr(
                fx_rates, "get_fx_rates", _async_raise(RuntimeError("upstream down"))
            )
            with pytest.raises(HTTPException) as exc:
                await fx_store.get_effective_rates(session)
            assert exc.value.status_code == 503

    _run(scenario())


def test_get_effective_rates_persist_error_is_swallowed(
    session_factory, monkeypatch
) -> None:
    async def scenario() -> None:
        async with session_factory() as session:
            monkeypatch.setattr(fx_rates, "get_fx_rates", _async_return(_live()))

            async def failing_upsert(*args, **kwargs):
                raise SQLAlchemyError("persist boom")

            monkeypatch.setattr(fx_store, "_upsert_row", failing_upsert)
            # Live fetch succeeds; persist fails but is logged + rolled back,
            # and the live read is still returned (lines 173-176).
            read = await fx_store.get_effective_rates(session)
            assert read.eur_per_ron == 0.2

    _run(scenario())


def test_clear_override_noop_when_absent(session_factory) -> None:
    async def scenario() -> None:
        async with session_factory() as session:
            # No override exists -> early return (line 209), no error.
            result = await fx_store.clear_override(session, user_id=uuid.uuid4())
            assert result is None

    _run(scenario())


def test_set_then_clear_override(session_factory) -> None:
    async def scenario() -> None:
        async with session_factory() as session:
            uid = uuid.uuid4()
            await fx_store.set_override(
                session,
                FxOverrideUpsert(eur_per_ron=0.4, usd_per_ron=0.41),
                user_id=uid,
            )
            assert await fx_store._get_row(session, is_override=True) is not None
            await fx_store.clear_override(session, user_id=uid)
            assert await fx_store._get_row(session, is_override=True) is None

    _run(scenario())


def test_get_admin_status_with_override(session_factory) -> None:
    async def scenario() -> None:
        async with session_factory() as session:
            await fx_store.set_override(
                session,
                FxOverrideUpsert(eur_per_ron=0.4, usd_per_ron=0.41),
            )
            status_obj = await fx_store.get_admin_status(session)
            assert status_obj.override is not None
            assert status_obj.effective.eur_per_ron == 0.4

    _run(scenario())


def test_get_admin_status_falls_back_to_effective(session_factory, monkeypatch) -> None:
    async def scenario() -> None:
        async with session_factory() as session:
            monkeypatch.setattr(fx_rates, "get_fx_rates", _async_return(_live()))
            status_obj = await fx_store.get_admin_status(session)
            assert status_obj.override is None
            assert status_obj.effective.eur_per_ron == 0.2

    _run(scenario())


def test_refresh_last_known_persists(session_factory, monkeypatch) -> None:
    async def scenario() -> None:
        async with session_factory() as session:
            monkeypatch.setattr(fx_rates, "get_fx_rates", _async_return(_live()))
            read = await fx_store.refresh_last_known(session)
            assert read.eur_per_ron == 0.2
            stored = await fx_store._get_row(session, is_override=False)
            assert stored is not None

    _run(scenario())


def test_refresh_last_known_persist_error_swallowed(
    session_factory, monkeypatch
) -> None:
    async def scenario() -> None:
        async with session_factory() as session:
            monkeypatch.setattr(fx_rates, "get_fx_rates", _async_return(_live()))

            async def failing_upsert(*args, **kwargs):
                raise SQLAlchemyError("persist boom")

            monkeypatch.setattr(fx_store, "_upsert_row", failing_upsert)
            read = await fx_store.refresh_last_known(session)
            assert read.eur_per_ron == 0.2

    _run(scenario())


def test_upsert_row_sqlite_missing_after_upsert_raises(
    session_factory, monkeypatch
) -> None:
    """If the row vanishes right after the dialect upsert, a RuntimeError is
    raised (line 78)."""

    async def scenario() -> None:
        async with session_factory() as session:

            async def none_get_row(sess, *, is_override):
                return None

            monkeypatch.setattr(fx_store, "_get_row", none_get_row)
            with pytest.raises(RuntimeError, match="fx_rate_upsert_failed"):
                await fx_store._upsert_row(session, is_override=False, data=_read())

    _run(scenario())


# --- async helper factories -------------------------------------------------


def _async_return(value):
    async def _fn(*args, **kwargs):
        return value

    return _fn


def _async_raise(exc):
    async def _fn(*args, **kwargs):
        raise exc

    return _fn
