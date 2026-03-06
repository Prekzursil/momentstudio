from __future__ import annotations

import asyncio
import json
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app import cli


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
    def __init__(self, *, execute_results=None, get_results=None):
        self.execute_results = list(execute_results or [])
        self.get_results = list(get_results or [])
        self.added: list[object] = []
        self.commits = 0
        self.refreshes: list[object] = []
        self.flushes = 0

    def add(self, value: object) -> None:
        self.added.append(value)

    async def execute(self, _stmt: object):
        await asyncio.sleep(0)
        if not self.execute_results:
            raise AssertionError('Unexpected execute()')
        return self.execute_results.pop(0)

    async def get(self, _model: object, _pk: object):
        await asyncio.sleep(0)
        if not self.get_results:
            return None
        return self.get_results.pop(0)

    async def commit(self) -> None:
        await asyncio.sleep(0)
        self.commits += 1

    async def refresh(self, value: object) -> None:
        await asyncio.sleep(0)
        self.refreshes.append(value)

    async def flush(self) -> None:
        await asyncio.sleep(0)
        self.flushes += 1


class _SessionCM:
    def __init__(self, session: _SessionStub):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, exc_type, exc, tb):
        return False


@pytest.mark.anyio
async def test_bootstrap_owner_create_and_update_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    created_user = SimpleNamespace(id=uuid4(), email='owner@example.com', username='owner')
    existing_user = SimpleNamespace(id=uuid4(), email='owner@example.com', username='owner-old')

    create_session = _SessionStub()
    monkeypatch.setattr(cli, 'SessionLocal', lambda: _SessionCM(create_session))
    monkeypatch.setattr(cli, '_load_bootstrap_candidates', lambda *a, **k: asyncio.sleep(0, result=(None, None, None)))
    monkeypatch.setattr(cli, '_demote_owner_if_needed', lambda *a, **k: asyncio.sleep(0))
    monkeypatch.setattr(cli, '_create_owner_user', lambda *a, **k: asyncio.sleep(0, result=created_user))

    await cli.bootstrap_owner(
        email='owner@example.com',
        password='password-1',
        username='owner',
        display_name='Owner',
    )
    assert create_session.commits == 1
    assert create_session.refreshes == [created_user]

    update_session = _SessionStub()
    update_calls: list[dict[str, object]] = []

    async def _load_existing(*_a, **_k):
        await asyncio.sleep(0)
        return None, existing_user, None

    async def _update_owner(*_a, **kwargs):
        await asyncio.sleep(0)
        update_calls.append(kwargs)

    monkeypatch.setattr(cli, 'SessionLocal', lambda: _SessionCM(update_session))
    monkeypatch.setattr(cli, '_load_bootstrap_candidates', _load_existing)
    monkeypatch.setattr(cli, '_update_owner_user', _update_owner)

    await cli.bootstrap_owner(
        email='owner@example.com',
        password='password-2',
        username='owner-new',
        display_name='Owner New',
    )

    assert update_calls and update_calls[0]['user'] is existing_user
    assert update_session.commits == 1
    assert update_session.refreshes == [existing_user]


@pytest.mark.anyio
async def test_bootstrap_owner_rejects_duplicate_username(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _SessionStub()
    existing_username_user = SimpleNamespace(id=uuid4())

    async def _load(*_a, **_k):
        await asyncio.sleep(0)
        return None, None, existing_username_user

    monkeypatch.setattr(cli, 'SessionLocal', lambda: _SessionCM(session))
    monkeypatch.setattr(cli, '_load_bootstrap_candidates', _load)

    with pytest.raises(SystemExit, match='Username already taken'):
        await cli.bootstrap_owner(
            email='owner@example.com',
            password='password-1',
            username='taken-name',
            display_name='Owner',
        )


@pytest.mark.anyio
async def test_repair_owner_runs_all_repair_steps(monkeypatch: pytest.MonkeyPatch) -> None:
    owner = SimpleNamespace(id=uuid4(), email='owner@example.com', username='owner', role=None)
    session = _SessionStub()
    calls: list[str] = []

    async def _require_owner(_session):
        await asyncio.sleep(0)
        return owner

    async def _repair_email(*_a, **_k):
        await asyncio.sleep(0)
        calls.append('email')

    async def _repair_username(*_a, **_k):
        await asyncio.sleep(0)
        calls.append('username')

    async def _repair_display(*_a, **_k):
        await asyncio.sleep(0)
        calls.append('display')

    monkeypatch.setattr(cli, 'SessionLocal', lambda: _SessionCM(session))
    monkeypatch.setattr(cli, '_require_owner', _require_owner)
    monkeypatch.setattr(cli, '_repair_owner_email', _repair_email)
    monkeypatch.setattr(cli, '_repair_owner_username', _repair_username)
    monkeypatch.setattr(cli, '_repair_owner_display_name', _repair_display)

    await cli.repair_owner(
        email='owner@example.com',
        password='next-password',
        username='owner-updated',
        display_name='Owner Updated',
        verify_email=True,
    )

    assert calls == ['email', 'username', 'display']
    assert session.commits == 1
    assert session.refreshes == [owner]


@pytest.mark.anyio
async def test_export_data_writes_serialized_payload(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    user = SimpleNamespace(id=uuid4())
    category = SimpleNamespace(id=uuid4())
    product = SimpleNamespace(id=uuid4())
    address = SimpleNamespace(id=uuid4())
    order = SimpleNamespace(id=uuid4())

    session = _SessionStub(
        execute_results=[
            _ExecuteRows([user]),
            _ExecuteRows([category]),
            _ExecuteRows([product]),
            _ExecuteRows([address]),
            _ExecuteRows([order]),
        ]
    )

    monkeypatch.setattr(cli, 'SessionLocal', lambda: _SessionCM(session))
    monkeypatch.setattr(cli, '_serialize_user', lambda value: {'kind': 'user', 'id': str(value.id)})
    monkeypatch.setattr(cli, '_serialize_category', lambda value: {'kind': 'category', 'id': str(value.id)})
    monkeypatch.setattr(cli, '_serialize_product', lambda value: {'kind': 'product', 'id': str(value.id)})
    monkeypatch.setattr(cli, '_serialize_address', lambda value: {'kind': 'address', 'id': str(value.id)})
    monkeypatch.setattr(cli, '_serialize_order', lambda value: {'kind': 'order', 'id': str(value.id)})

    output = tmp_path / 'export.json'
    await cli.export_data(output)

    payload = json.loads(output.read_text(encoding='utf-8'))
    assert payload['users'][0]['kind'] == 'user'
    assert payload['orders'][0]['kind'] == 'order'


@pytest.mark.anyio
async def test_import_users_and_tag_cache_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    existing = SimpleNamespace(id=uuid4(), username='existing')
    session = _SessionStub(get_results=[None, existing], execute_results=[_ExecuteScalarOne(None), _ExecuteScalarOne(None)])
    created = SimpleNamespace(id=uuid4(), username='created')

    monkeypatch.setattr(cli, '_create_import_user', lambda *a, **k: created)
    ensure_calls: list[object] = []
    sync_calls: list[object] = []

    monkeypatch.setattr(
        cli,
        '_ensure_import_user_username',
        lambda *a, **k: ensure_calls.append(k.get('user_obj')),
    )
    monkeypatch.setattr(
        cli,
        '_sync_import_user_display_name',
        lambda *a, **k: sync_calls.append(k.get('user_obj')),
    )
    monkeypatch.setattr(cli, '_apply_import_user_fields', lambda *_a, **_k: None)

    users_payload = [
        {'id': str(uuid4()), 'email': 'create@example.com'},
        {'id': str(existing.id), 'email': 'existing@example.com'},
    ]

    await cli._import_users(
        session,
        users_payload=users_payload,
        used_usernames=set(),
        next_tag_by_name={},
    )

    assert created in session.added
    assert existing in session.added
    assert ensure_calls == [existing]
    assert sync_calls == [created, existing]

    tag_cache = await cli._build_tag_cache(
        session,
        products_payload=[
            {'tags': ['gold', 'gold']},
        ],
    )
    assert 'gold' in tag_cache


@pytest.mark.anyio
async def test_import_data_runs_all_pipeline_steps(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    payload = {
        'users': [{'id': str(uuid4()), 'email': 'u@example.com'}],
        'categories': [{'id': str(uuid4()), 'slug': 'rings', 'name': 'Rings'}],
        'products': [],
        'addresses': [],
        'orders': [],
    }

    input_path = tmp_path / 'import.json'
    input_path.write_text(json.dumps(payload), encoding='utf-8')

    session = _SessionStub()
    calls: list[str] = []

    monkeypatch.setattr(cli, 'SessionLocal', lambda: _SessionCM(session))
    monkeypatch.setattr(cli, '_load_import_payload', lambda path: payload if path == input_path else {})

    async def _load_context(_session):
        await asyncio.sleep(0)
        calls.append('context')
        return set(), {}

    async def _import_users(*_a, **_k):
        await asyncio.sleep(0)
        calls.append('users')

    async def _import_categories(*_a, **_k):
        await asyncio.sleep(0)
        calls.append('categories')

    async def _build_tag_cache(*_a, **_k):
        await asyncio.sleep(0)
        calls.append('tags')
        return {}

    async def _import_products(*_a, **_k):
        await asyncio.sleep(0)
        calls.append('products')

    async def _import_addresses(*_a, **_k):
        await asyncio.sleep(0)
        calls.append('addresses')

    async def _ensure_shipping(*_a, **_k):
        await asyncio.sleep(0)
        calls.append('shipping')

    async def _import_orders(*_a, **_k):
        await asyncio.sleep(0)
        calls.append('orders')

    monkeypatch.setattr(cli, '_load_user_import_context', _load_context)
    monkeypatch.setattr(cli, '_import_users', _import_users)
    monkeypatch.setattr(cli, '_import_categories', _import_categories)
    monkeypatch.setattr(cli, '_build_tag_cache', _build_tag_cache)
    monkeypatch.setattr(cli, '_import_products', _import_products)
    monkeypatch.setattr(cli, '_import_addresses', _import_addresses)
    monkeypatch.setattr(cli, '_ensure_shipping_methods', _ensure_shipping)
    monkeypatch.setattr(cli, '_import_orders', _import_orders)

    await cli.import_data(input_path)

    assert calls == ['context', 'users', 'categories', 'tags', 'products', 'addresses', 'shipping', 'orders']
    assert session.flushes == 2
    assert session.commits == 1
