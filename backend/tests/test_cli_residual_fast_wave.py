from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app import cli
from app.models.user import UserRole


class _ScalarRows:
    def __init__(self, rows):
        self._rows = list(rows)

    def all(self):
        return list(self._rows)


class _ExecuteRows:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return _ScalarRows(self._rows)


class _ExecuteScalarOne:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _SessionStub:
    def __init__(self, *, execute_results=None):
        self.execute_results = list(execute_results or [])
        self.added: list[object] = []
        self.flushes = 0
        self.commits = 0
        self.refreshes: list[object] = []

    def add(self, value: object) -> None:
        self.added.append(value)

    async def execute(self, _stmt: object):
        await asyncio.sleep(0)
        if not self.execute_results:
            raise AssertionError('Unexpected execute() call')
        return self.execute_results.pop(0)

    async def flush(self) -> None:
        await asyncio.sleep(0)
        self.flushes += 1

    async def commit(self) -> None:
        await asyncio.sleep(0)
        self.commits += 1

    async def refresh(self, value: object) -> None:
        await asyncio.sleep(0)
        self.refreshes.append(value)


class _SessionCM:
    def __init__(self, session: _SessionStub):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, exc_type, exc, tb):
        return False


@pytest.mark.anyio
async def test_create_owner_user_and_update_owner_user_record_histories(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _SessionStub()

    async def _name_tag(*_args, **_kwargs):
        await asyncio.sleep(0)
        return 7

    monkeypatch.setattr(cli, '_allocate_name_tag', _name_tag)
    monkeypatch.setattr(cli.security, 'hash_password', lambda raw: f'hash::{raw}')

    now = datetime.now(timezone.utc)
    user = await cli._create_owner_user(
        session,
        email_norm='owner@example.com',
        username_norm='owner',
        display_name_norm='Owner',
        password='secret-1',
        now=now,
    )

    assert user.email == 'owner@example.com'
    assert user.username == 'owner'
    assert user.name_tag == 7
    assert user.hashed_password == 'hash::secret-1'
    assert session.flushes == 1
    assert len(session.added) == 4

    owner = SimpleNamespace(
        id=user.id,
        username='owner',
        name='Owner',
        name_tag=7,
        hashed_password='old',
        email_verified=False,
        role=UserRole.customer,
    )
    await cli._update_owner_user(
        session,
        user=owner,
        existing_username_user=None,
        username_norm='owner',
        display_name_norm='Owner Updated',
        password='secret-2',
        now=now,
    )

    assert owner.name == 'Owner Updated'
    assert owner.name_tag == 7
    assert owner.hashed_password == 'hash::secret-2'
    assert owner.email_verified is True
    assert owner.role == UserRole.owner


@pytest.mark.anyio
async def test_repair_owner_username_and_display_name_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    owner = SimpleNamespace(id=uuid4(), username='owner', name='Owner', name_tag=0)

    # username_norm missing -> early return branch
    session_empty = _SessionStub()
    await cli._repair_owner_username(session_empty, owner=owner, username_norm=None, now=datetime.now(timezone.utc))

    # username unchanged -> query branch without history append
    session_same = _SessionStub(execute_results=[_ExecuteScalarOne(None)])
    await cli._repair_owner_username(session_same, owner=owner, username_norm='owner', now=datetime.now(timezone.utc))

    # conflicting username branch
    conflict_user = SimpleNamespace(id=uuid4())
    session_conflict = _SessionStub(execute_results=[_ExecuteScalarOne(conflict_user)])
    with pytest.raises(SystemExit, match='Username already taken'):
        await cli._repair_owner_username(
            session_conflict,
            owner=owner,
            username_norm='taken',
            now=datetime.now(timezone.utc),
        )

    async def _name_tag(*_args, **_kwargs):
        await asyncio.sleep(0)
        return 3

    monkeypatch.setattr(cli, '_allocate_name_tag', _name_tag)

    # display_name missing/same -> early return branch
    session_display = _SessionStub()
    await cli._repair_owner_display_name(session_display, owner=owner, display_name_norm=None, now=datetime.now(timezone.utc))
    await cli._repair_owner_display_name(session_display, owner=owner, display_name_norm='Owner', now=datetime.now(timezone.utc))

    # display_name changed -> tag update branch
    await cli._repair_owner_display_name(
        session_display,
        owner=owner,
        display_name_norm='Owner Next',
        now=datetime.now(timezone.utc),
    )
    assert owner.name == 'Owner Next'
    assert owner.name_tag == 3


@pytest.mark.anyio
async def test_repair_owner_sets_role_and_commits(monkeypatch: pytest.MonkeyPatch) -> None:
    owner = SimpleNamespace(id=uuid4(), email='owner@example.com', username='owner', role=UserRole.customer)
    session = _SessionStub()
    calls: list[str] = []

    async def _require_owner(_session):
        await asyncio.sleep(0)
        return owner

    async def _record(name: str):
        async def _inner(*_args, **_kwargs):
            await asyncio.sleep(0)
            calls.append(name)
        return _inner

    monkeypatch.setattr(cli, 'SessionLocal', lambda: _SessionCM(session))
    monkeypatch.setattr(cli, '_require_owner', _require_owner)
    monkeypatch.setattr(cli, '_repair_owner_email', await _record('email'))
    monkeypatch.setattr(cli, '_repair_owner_username', await _record('username'))
    monkeypatch.setattr(cli, '_repair_owner_display_name', await _record('display'))
    monkeypatch.setattr(cli.security, 'hash_password', lambda raw: f'hash::{raw}')

    await cli.repair_owner(
        email='owner@example.com',
        password='new-secret',
        username='owner',
        display_name='Owner',
        verify_email=True,
    )

    assert calls == ['email', 'username', 'display']
    assert owner.role == UserRole.owner
    assert owner.hashed_password == 'hash::new-secret'
    assert session.commits == 1
    assert session.refreshes == [owner]


@pytest.mark.anyio
async def test_export_data_serializes_full_payload(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    session = _SessionStub(
        execute_results=[
            _ExecuteRows([SimpleNamespace(id='u1')]),
            _ExecuteRows([SimpleNamespace(id='c1')]),
            _ExecuteRows([SimpleNamespace(id='p1')]),
            _ExecuteRows([SimpleNamespace(id='a1')]),
            _ExecuteRows([SimpleNamespace(id='o1')]),
        ]
    )

    monkeypatch.setattr(cli, 'SessionLocal', lambda: _SessionCM(session))
    monkeypatch.setattr(cli, '_serialize_user', lambda row: {'u': row.id})
    monkeypatch.setattr(cli, '_serialize_category', lambda row: {'c': row.id})
    monkeypatch.setattr(cli, '_serialize_product', lambda row: {'p': row.id})
    monkeypatch.setattr(cli, '_serialize_address', lambda row: {'a': row.id})
    monkeypatch.setattr(cli, '_serialize_order', lambda row: {'o': row.id})

    output = tmp_path / 'export.json'
    await cli.export_data(output)

    payload = json.loads(output.read_text(encoding='utf-8'))
    assert payload['users'] == [{'u': 'u1'}]
    assert payload['categories'] == [{'c': 'c1'}]
    assert payload['products'] == [{'p': 'p1'}]
    assert payload['addresses'] == [{'a': 'a1'}]
    assert payload['orders'] == [{'o': 'o1'}]
