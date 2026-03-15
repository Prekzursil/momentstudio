from __future__ import annotations

import asyncio
from datetime import date, datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.services import fx_store


class _ExecResult:
    def __init__(self, value=None) -> None:
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _StmtStub:
    def values(self, **_kwargs):
        return self

    def on_conflict_do_update(self, **_kwargs):
        return self


class _SessionStub:
    def __init__(self, *, dialect_name: str = 'sqlite') -> None:
        self._dialect_name = dialect_name
        self.added: list[object] = []
        self.deleted: list[object] = []
        self.commits = 0
        self.refreshes = 0
        self.rollbacks = 0

    def execute(self, _stmt):
        return _ExecResult(None)

    def add(self, value):
        self.added.append(value)

    def commit(self):
        self.commits += 1

    def refresh(self, _obj):
        self.refreshes += 1

    def rollback(self):
        self.rollbacks += 1

    def delete(self, value):
        self.deleted.append(value)

    def get_bind(self):
        return SimpleNamespace(dialect=SimpleNamespace(name=self._dialect_name))


def _row(source: str = 'seed'):
    return SimpleNamespace(
        base='RON',
        eur_per_ron=0.20,
        usd_per_ron=0.21,
        as_of=date.today(),
        source=source,
        fetched_at=datetime.now(timezone.utc),
        attempts=0,
        payload={},
        event_type='evt',
    )


def test_apply_row_data_assigns_all_fields() -> None:
    src = _row(source='live')
    read = fx_store._row_to_read(src)
    target = _row(source='old')

    fx_store._apply_fx_row_data(target, read)

    assert target.base == read.base
    assert target.eur_per_ron == read.eur_per_ron
    assert target.usd_per_ron == read.usd_per_ron
    assert target.as_of == read.as_of
    assert target.source == read.source
    assert target.fetched_at == read.fetched_at


@pytest.mark.anyio('asyncio')
async def test_upsert_row_fallback_existing_and_new(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _SessionStub(dialect_name='other')
    existing = _row(source='existing')

    monkeypatch.setattr(fx_store, '_get_row', lambda *_args, **_kwargs: asyncio.sleep(0, result=existing))
    updated = await fx_store._upsert_row_fallback(session, is_override=True, data=fx_store._row_to_read(_row(source='admin')))
    assert updated is existing
    assert session.commits == 1
    assert session.refreshes == 1

    monkeypatch.setattr(fx_store, '_get_row', lambda *_args, **_kwargs: asyncio.sleep(0, result=None))
    created = await fx_store._upsert_row_fallback(session, is_override=False, data=fx_store._row_to_read(_row(source='live')))
    assert created in session.added


@pytest.mark.anyio('asyncio')
async def test_upsert_row_after_integrity_error_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _SessionStub(dialect_name='other')
    existing = _row(source='seed')

    monkeypatch.setattr(fx_store, '_get_row', lambda *_args, **_kwargs: asyncio.sleep(0, result=existing))
    resolved = await fx_store._upsert_row_after_integrity_error(
        session,
        is_override=False,
        data=fx_store._row_to_read(_row(source='admin')),
    )
    assert resolved is existing
    assert session.rollbacks == 1
    assert session.commits == 1

    session_missing = _SessionStub(dialect_name='other')
    monkeypatch.setattr(fx_store, '_get_row', lambda *_args, **_kwargs: asyncio.sleep(0, result=None))
    with pytest.raises(RuntimeError):
        await fx_store._upsert_row_after_integrity_error(
            session_missing,
            is_override=False,
            data=fx_store._row_to_read(_row(source='admin')),
        )


@pytest.mark.anyio('asyncio')
async def test_upsert_row_via_conflict_stmt_runtime_error_when_row_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _SessionStub(dialect_name='sqlite')
    monkeypatch.setattr(fx_store, '_get_row', lambda *_args, **_kwargs: asyncio.sleep(0, result=None))

    with pytest.raises(RuntimeError, match='fx_rate_upsert_failed'):
        await fx_store._upsert_row_via_conflict_stmt(
            session,
            is_override=True,
            data=fx_store._row_to_read(_row(source='admin')),
            insert_fn=lambda _model: _StmtStub(),
        )


@pytest.mark.anyio('asyncio')
async def test_upsert_row_unknown_dialect_commit_and_integrity_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _SessionStub(dialect_name='other')
    row = _row(source='seed')

    monkeypatch.setattr(fx_store, '_upsert_row_fallback', lambda *_args, **_kwargs: asyncio.sleep(0, result=row))

    recovered = _row(source='recovered')

    def _after_integrity(*_args, **_kwargs):
        return recovered

    monkeypatch.setattr(fx_store, '_upsert_row_after_integrity_error', _after_integrity)

    def _commit_raise_once():
        if session.commits == 0:
            session.commits += 1
            raise IntegrityError('insert', params={}, orig=Exception('dup'))
        session.commits += 1

    session.commit = _commit_raise_once
    out = await fx_store._upsert_row(session, is_override=False, data=fx_store._row_to_read(_row(source='live')))
    assert out is recovered

    session_ok = _SessionStub(dialect_name='other')
    monkeypatch.setattr(fx_store, '_upsert_row_fallback', lambda *_args, **_kwargs: asyncio.sleep(0, result=row))
    out_ok = await fx_store._upsert_row(session_ok, is_override=False, data=fx_store._row_to_read(_row(source='live')))
    assert out_ok is row
    assert session_ok.refreshes == 1


@pytest.mark.anyio('asyncio')
async def test_get_effective_rates_paths_and_clear_override(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _SessionStub(dialect_name='other')
    override_row = _row(source='override')
    last_known_row = _row(source='last_known')

    def _get_row_override_first(_session, *, is_override: bool):
        return override_row if is_override else last_known_row

    monkeypatch.setattr(fx_store, '_get_row', _get_row_override_first)
    effective = await fx_store.get_effective_rates(session)
    assert effective.source == 'override'

    def _get_row_last_known_only(_session, *, is_override: bool):
        return None if is_override else last_known_row

    monkeypatch.setattr(fx_store, '_get_row', _get_row_last_known_only)
    effective_last = await fx_store.get_effective_rates(session)
    assert effective_last.source == 'last_known'

    def _get_row_none(_session, *, is_override: bool):
        return None

    class _Live:
        base = 'RON'
        eur_per_ron = 0.24
        usd_per_ron = 0.25
        as_of = date.today()
        source = 'bnr'
        fetched_at = datetime.now(timezone.utc)

    monkeypatch.setattr(fx_store, '_get_row', _get_row_none)
    monkeypatch.setattr(fx_store.fx_rates, 'get_fx_rates', lambda **_kwargs: asyncio.sleep(0, result=_Live()))

    def _upsert_fail(*_args, **_kwargs):
        raise SQLAlchemyError('persist fail')

    monkeypatch.setattr(fx_store, '_upsert_row', _upsert_fail)
    effective_live = await fx_store.get_effective_rates(session)
    assert effective_live.source == 'bnr'
    assert session.rollbacks >= 1

    monkeypatch.setattr(fx_store, '_get_row', _get_row_none)
    await fx_store.clear_override(session, user_id=uuid4())
    assert session.deleted == []


@pytest.mark.anyio('asyncio')
async def test_refresh_last_known_error_and_success_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _SessionStub(dialect_name='other')

    class _Live:
        base = 'RON'
        eur_per_ron = 0.26
        usd_per_ron = 0.27
        as_of = date.today()
        source = 'bnr'
        fetched_at = datetime.now(timezone.utc)

    monkeypatch.setattr(fx_store.fx_rates, 'get_fx_rates', lambda **_kwargs: asyncio.sleep(0, result=_Live()))

    def _upsert_fail(*_args, **_kwargs):
        raise SQLAlchemyError('persist fail')

    monkeypatch.setattr(fx_store, '_upsert_row', _upsert_fail)
    read = await fx_store.refresh_last_known(session)
    assert read.source == 'bnr'
    assert session.rollbacks == 1

    session_ok = _SessionStub(dialect_name='other')
    monkeypatch.setattr(fx_store, '_upsert_row', lambda *_args, **_kwargs: asyncio.sleep(0, result=None))
    read_ok = await fx_store.refresh_last_known(session_ok)
    assert read_ok.base == 'RON'
