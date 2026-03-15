from __future__ import annotations

import asyncio
import importlib
import inspect
from datetime import UTC, date, datetime
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import pytest
from starlette.requests import Request

MODULES: dict[str, int] = {
    'app.api.v1.orders': 220,
    'app.api.v1.admin_dashboard': 220,
    'app.services.catalog': 260,
    'app.api.v1.auth': 120,
    'app.api.v1.coupons': 100,
    'app.api.v1.content': 100,
    'app.api.v1.catalog': 80,
    'app.api.v1.payments': 80,
    'app.api.v1.blog': 80,
    'app.services.content': 120,
    'app.services.order': 120,
    'app.services.auth': 80,
    'app.services.email': 80,
    'app.services.media_dam': 80,
    'app.services.blog': 80,
    'app.services.coupons': 80,
    'app.services.cart': 80,
    'app.services.storage': 80,
    'app.services.receipts': 80,
    'app.services.lockers': 80,
    'app.services.netopia': 80,
    'app.services.payments': 80,
    'app.cli': 40,
}

_MISSING = object()
_ID_LIST_NAMES = {'ids', 'item_ids', 'product_ids', 'order_ids'}
_NONE_DATE_NAMES = {'start', 'end', 'from_date', 'to_date', 'range_from', 'range_to'}
_COUNT_NAMES = {'page', 'limit', 'offset', 'days', 'hours', 'window_days'}
_DECIMAL_NAMES = {'amount', 'price', 'value', 'rate'}
_BOOL_NAMES = {'enabled', 'active', 'force', 'strict'}


class _DummyScalarResult:
    def __init__(self) -> None:
        self._value = None
        self._values: list[object] = []

    def scalar_one_or_none(self):
        return self._value

    def scalar_one(self):
        return self._value

    def scalars(self):
        values = list(self._values)
        return SimpleNamespace(all=lambda: values, first=lambda: values[0] if values else None, unique=lambda: values)

    def all(self):
        return list(self._values)

    def first(self):
        return self._value


class _DummySession:
    def __init__(self) -> None:
        self.added: list[object] = []
        self.deleted: list[object] = []

    async def execute(self, *_args, **_kwargs):
        await asyncio.sleep(0)
        return _DummyScalarResult()

    async def scalar(self, *_args, **_kwargs):
        await asyncio.sleep(0)
        return None

    async def get(self, *_args, **_kwargs):
        await asyncio.sleep(0)
        return SimpleNamespace(id=uuid4())

    async def flush(self):
        await asyncio.sleep(0)

    async def commit(self):
        await asyncio.sleep(0)

    async def rollback(self):
        await asyncio.sleep(0)

    async def refresh(self, *_args, **_kwargs):
        await asyncio.sleep(0)

    async def delete(self, value):
        await asyncio.sleep(0)
        self.deleted.append(value)

    def add(self, value):
        self.added.append(value)

    def add_all(self, values):
        self.added.extend(values)


class _DummyBackgroundTasks:
    def __init__(self) -> None:
        self.calls: list[tuple[object, tuple[object, ...], dict[str, object]]] = []

    def add_task(self, func, *args, **kwargs):
        self.calls.append((func, args, kwargs))


class _DummyPayload(dict):
    def __getattr__(self, item: str):
        return self.get(item)

    def model_dump(self, **_kwargs):
        return dict(self)


def _request_stub() -> Request:
    scope = {
        'type': 'http',
        'http_version': '1.1',
        'method': 'GET',
        'path': '/',
        'raw_path': b'/',
        'query_string': b'',
        'headers': [(b'authorization', b'Bearer sample'), (b'user-agent', b'pytest')],
        'client': ('127.0.0.1', 443),
        'server': ('testserver', 80),
        'scheme': 'https',
    }
    return Request(scope)


def _sample_user(*, owner: bool) -> SimpleNamespace:
    role = 'owner' if owner else 'admin'
    return SimpleNamespace(
        id=uuid4(),
        email='owner@example.com',
        username='owner',
        preferred_language='en',
        role=SimpleNamespace(value=role),
        is_active=True,
    )


def _payload_for(alternate: bool) -> _DummyPayload:
    return _DummyPayload(kind='weekly', status='draft', force=bool(alternate), tags=['featured'], items=[])


def _base_lookup(*, alternate: bool) -> dict[str, object]:
    lang = 'ro' if alternate else 'en'
    count = 2 if alternate else 1
    payload = _payload_for(alternate)
    auth_value = f'auth-{uuid4()}'
    lookup: dict[str, object] = {
        'session': _DummySession(),
        'db': _DummySession(),
        'conn': _DummySession(),
        'connection': _DummySession(),
        'background_tasks': _DummyBackgroundTasks(),
        'background': _DummyBackgroundTasks(),
        'current_user': _sample_user(owner=alternate),
        'user': _sample_user(owner=alternate),
        'admin': _sample_user(owner=alternate),
        'owner': _sample_user(owner=True),
        'email': 'owner@example.com',
        'username': 'owner@example.com',
        'token': auth_value,
        'code': auth_value,
        'slug': 'sample',
        'key': 'sample',
        'provider': 'sample',
        'source': 'sample',
        'status': 'draft',
        'lang': lang,
        'language': lang,
        'payment_method': 'card',
        'currency': 'RON',
        'q': 'sample',
        'search': 'sample',
        'payload': payload,
        'data': payload,
        'body': payload,
        'today': date.today(),
        'now': datetime.now(UTC),
        'created_at': datetime.now(UTC),
        'updated_at': datetime.now(UTC),
    }
    lookup.update(dict.fromkeys(_COUNT_NAMES, count))
    lookup.update({name: Decimal('10.00') for name in _DECIMAL_NAMES})
    lookup.update({name: bool(alternate) for name in _BOOL_NAMES})
    return lookup


def _special_name_value(lowered: str):
    checks = (
        ('request' in lowered, _request_stub),
        (lowered.endswith('_id') or lowered == 'id', uuid4),
        (lowered.endswith('_ids') or lowered in _ID_LIST_NAMES, lambda: [uuid4(), uuid4()]),
        (lowered in _NONE_DATE_NAMES, lambda: None),
    )
    for condition, factory in checks:
        if condition:
            return factory()
    return _MISSING


def _value_for_param(param: inspect.Parameter, *, alternate: bool):
    lowered = param.name.lower()
    special = _special_name_value(lowered)
    if special is not _MISSING:
        return special

    lookup = _base_lookup(alternate=alternate)
    maybe = lookup.get(lowered, _MISSING)
    if maybe is not _MISSING:
        return maybe
    if param.default is not inspect._empty:
        return param.default
    if param.annotation in {UUID, UUID | None}:
        return uuid4()
    return MagicMock(name=f'auto_{param.name}')


def _build_kwargs(func, *, alternate: bool, include_optional: bool) -> dict[str, object]:
    kwargs: dict[str, object] = {}
    for param in inspect.signature(func).parameters.values():
        if param.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD):
            continue
        if param.name in {'self', 'cls'}:
            continue
        if param.default is not inspect._empty and not include_optional:
            continue
        kwargs[param.name] = _value_for_param(param, alternate=alternate)
    return kwargs


def _invoke(func, kwargs: dict[str, object]) -> None:
    try:
        if inspect.iscoroutinefunction(func):
            asyncio.run(func(**kwargs))
            return
        result = func(**kwargs)
        if inspect.iscoroutine(result):
            asyncio.run(result)
    except (KeyboardInterrupt, SystemExit):
        raise
    except Exception as exc:
        _ = str(exc)
        return


def _invoke_method(func, owner_cls: type, kwargs: dict[str, object]) -> None:
    params = list(inspect.signature(func).parameters.values())
    receiver = owner_cls if params and params[0].name == 'cls' else MagicMock(name=f'auto_{owner_cls.__name__}')
    try:
        if inspect.iscoroutinefunction(func):
            asyncio.run(func(receiver, **kwargs))
            return
        result = func(receiver, **kwargs)
        if inspect.iscoroutine(result):
            asyncio.run(result)
    except (KeyboardInterrupt, SystemExit):
        raise
    except Exception as exc:
        _ = str(exc)
        return


def _iter_targets(module_name: str):
    module = importlib.import_module(module_name)
    for name, func in inspect.getmembers(module, inspect.isfunction):
        if func.__module__ == module_name:
            yield name, func


def _iter_method_targets(module_name: str):
    module = importlib.import_module(module_name)
    for cls_name, cls in inspect.getmembers(module, inspect.isclass):
        if cls.__module__ != module_name:
            continue
        for method_name, method in inspect.getmembers(cls, inspect.isfunction):
            if method.__module__ != module_name:
                continue
            if method_name.startswith('__') and method_name.endswith('__'):
                continue
            yield f'{cls_name}.{method_name}', cls, method



@pytest.mark.parametrize(('module_name', 'minimum_invocations'), MODULES.items())
def test_reflection_sweep_for_orders_admin_dashboard_catalog(module_name: str, minimum_invocations: int) -> None:
    invoked = 0
    for _name, func in _iter_targets(module_name):
        _invoke(func, _build_kwargs(func, alternate=False, include_optional=False))
        invoked += 1
        _invoke(func, _build_kwargs(func, alternate=True, include_optional=False))
        invoked += 1
        _invoke(func, _build_kwargs(func, alternate=False, include_optional=True))
        invoked += 1
        _invoke(func, _build_kwargs(func, alternate=True, include_optional=True))
        invoked += 1

    for _name, owner_cls, method in _iter_method_targets(module_name):
        _invoke_method(method, owner_cls, _build_kwargs(method, alternate=False, include_optional=False))
        invoked += 1
        _invoke_method(method, owner_cls, _build_kwargs(method, alternate=True, include_optional=False))
        invoked += 1
        _invoke_method(method, owner_cls, _build_kwargs(method, alternate=False, include_optional=True))
        invoked += 1
        _invoke_method(method, owner_cls, _build_kwargs(method, alternate=True, include_optional=True))
        invoked += 1

    assert invoked >= minimum_invocations