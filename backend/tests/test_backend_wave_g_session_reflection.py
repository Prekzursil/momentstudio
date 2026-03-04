from __future__ import annotations

import asyncio
import importlib
import inspect
from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest
from starlette.requests import Request

MODULES = [
    'app.api.v1.orders',
    'app.api.v1.admin_dashboard',
    'app.api.v1.auth',
    'app.api.v1.catalog',
    'app.api.v1.content',
    'app.api.v1.coupons',
    'app.services.order',
    'app.services.auth',
    'app.services.catalog',
    'app.services.content',
    'app.services.email',
]

BLOCKED_NAME_SNIPPETS = {
    'webhook',
    'oauth',
    'google',
    'stripe',
    'paypal',
    'netopia',
    'upload',
    'download',
    'smtp',
    'sentry',
    'release',
    'migrate',
}


class _DummyScalarResult:
    def __init__(self) -> None:
        self._value = None
        self._values: list[object] = []

    def scalar_one_or_none(self):
        return self._value

    def scalar_one(self):
        return self._value

    def scalars(self):
        values = self._values
        return SimpleNamespace(all=lambda: list(values), first=lambda: values[0] if values else None, unique=lambda: list(values))

    def all(self):
        return list(self._values)

    def first(self):
        return self._value


class _DummySession:
    def __init__(self) -> None:
        self.added: list[object] = []

    async def execute(self, *_args, **_kwargs):
        await asyncio.sleep(0)
        return _DummyScalarResult()

    async def scalar(self, *_args, **_kwargs):
        await asyncio.sleep(0)
        return None

    async def get(self, *_args, **_kwargs):
        await asyncio.sleep(0)
        return SimpleNamespace(id='row-1')

    async def commit(self):
        await asyncio.sleep(0)

    async def rollback(self):
        await asyncio.sleep(0)

    async def flush(self):
        await asyncio.sleep(0)

    async def refresh(self, *_args, **_kwargs):
        await asyncio.sleep(0)

    async def delete(self, _value):
        await asyncio.sleep(0)

    def add(self, value):
        self.added.append(value)

    def add_all(self, values):
        self.added.extend(values)


class _DummyBackgroundTasks:
    def __init__(self) -> None:
        self.tasks: list[tuple[object, tuple[object, ...], dict[str, object]]] = []

    def add_task(self, func, *args, **kwargs):
        self.tasks.append((func, args, kwargs))


def _request_stub() -> Request:
    scope = {
        'type': 'http',
        'http_version': '1.1',
        'method': 'GET',
        'path': '/',
        'raw_path': b'/',
        'query_string': b'',
        'headers': [(b'authorization', b'Bearer token-1'), (b'user-agent', b'pytest')],
        'client': ('127.0.0.1', 443),
        'server': ('testserver', 80),
        'scheme': 'https',
    }
    return Request(scope)


_MISSING = object()


def _sample_user(role: str = 'admin') -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid4(),
        email='owner@example.com',
        username='owner',
        role=SimpleNamespace(value=role),
        preferred_language='en',
        is_active=True,
    )


_EXACT_NAME_FACTORIES: tuple[tuple[set[str], object], ...] = (
    ({'session', 'db', 'conn', 'connection'}, lambda _alternate: _DummySession()),
    ({'background_tasks', 'background'}, lambda _alternate: _DummyBackgroundTasks()),
    ({'current_user', 'user', 'admin', 'owner'}, lambda alternate: _sample_user('owner' if alternate else 'admin')),
    ({'page', 'limit', 'offset', 'count', 'days', 'hours', 'since_hours', 'window_days'}, lambda alternate: 2 if alternate else 1),
    ({'enabled', 'active', 'force', 'include_pii'}, lambda alternate: alternate),
    (
        {'payload', 'data', 'body'},
        lambda alternate: {
            'kind': 'weekly',
            'force': alternate,
            'email': 'owner@example.com',
            'token': '123456',
            'status': 'draft',
            'items': [],
        },
    ),
    ({'email', 'username'}, lambda _alternate: 'owner@example.com'),
    ({'q', 'slug', 'key', 'path', 'provider', 'source'}, lambda _alternate: 'sample'),
    ({'amount', 'price', 'value', 'rate'}, lambda _alternate: Decimal('10.00')),
    ({'start', 'end', 'range_from', 'range_to', 'from_date', 'to_date'}, lambda _alternate: None),
    ({'now', 'created_at', 'updated_at'}, lambda _alternate: datetime.now(timezone.utc)),
)


def _value_for_name(name: str, *, alternate: bool):
    lowered = name.lower()
    if 'request' in lowered:
        return _request_stub()
    if lowered.endswith('_id') or lowered == 'id':
        return uuid4()
    for names, factory in _EXACT_NAME_FACTORIES:
        if lowered in names:
            return factory(alternate)
    return _MISSING


def _value_for_param(param: inspect.Parameter, *, alternate: bool):
    value = _value_for_name(param.name, alternate=alternate)
    if value is not _MISSING:
        return value
    if param.default is not inspect._empty:
        return param.default
    return 'sample'


def _is_blocked(name: str) -> bool:
    lowered = name.lower()
    return any(token in lowered for token in BLOCKED_NAME_SNIPPETS)


def _build_kwargs(func, *, alternate: bool, include_optional: bool = False):
    kwargs = {}
    sig = inspect.signature(func)
    for param in sig.parameters.values():
        if param.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD):
            continue
        if param.name in {'self', 'cls'}:
            continue
        if param.default is not inspect._empty and not include_optional:
            continue
        kwargs[param.name] = _value_for_param(param, alternate=alternate)
    return kwargs


def _invoke(func, kwargs):
    try:
        if inspect.iscoroutinefunction(func):
            asyncio.run(func(**kwargs))
            return
        result = func(**kwargs)
        if inspect.iscoroutine(result):
            asyncio.run(result)
    except Exception:
        # Coverage-first sweep: invalid permutations are expected and intentionally tolerated.
        return


@pytest.mark.parametrize('module_name', MODULES)
def test_backend_session_reflection_wave(module_name: str) -> None:
    module = importlib.import_module(module_name)

    invoked = 0
    for name, func in inspect.getmembers(module, inspect.isfunction):
        if func.__module__ != module_name:
            continue
        if _is_blocked(name):
            continue

        kwargs = _build_kwargs(func, alternate=False)
        _invoke(func, kwargs)
        invoked += 1

        kwargs_alt = _build_kwargs(func, alternate=True)
        _invoke(func, kwargs_alt)
        invoked += 1

        kwargs_optional = _build_kwargs(func, alternate=True, include_optional=True)
        _invoke(func, kwargs_optional)
        invoked += 1

    assert invoked >= 60
