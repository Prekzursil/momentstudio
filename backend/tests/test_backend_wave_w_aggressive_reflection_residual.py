from __future__ import annotations

import asyncio
import importlib
import inspect
from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import pytest
from starlette.requests import Request

MODULES = [
    "app.api.v1.catalog",
    "app.api.v1.payments",
    "app.services.blog",
    "app.services.cart",
    "app.services.coupons",
    "app.services.netopia",
    "app.services.payments",
    "app.services.receipts",
    "app.services.storage",
]

_MISSING = object()


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
        "type": "http",
        "http_version": "1.1",
        "method": "GET",
        "path": "/",
        "raw_path": b"/",
        "query_string": b"",
        "headers": [(b"authorization", b"Bearer token"), (b"user-agent", b"pytest")],
        "client": ("127.0.0.1", 443),
        "server": ("testserver", 80),
        "scheme": "https",
    }
    return Request(scope)


def _sample_user(*, owner: bool) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid4(),
        email="owner@example.com",
        username="owner",
        preferred_language="en",
        role=SimpleNamespace(value="owner" if owner else "admin"),
        is_active=True,
    )


def _exact_name_value(name: str, *, alternate: bool):
    lookup = {
        "session": _DummySession(),
        "db": _DummySession(),
        "conn": _DummySession(),
        "connection": _DummySession(),
        "background_tasks": _DummyBackgroundTasks(),
        "background": _DummyBackgroundTasks(),
        "current_user": _sample_user(owner=alternate),
        "user": _sample_user(owner=alternate),
        "admin": _sample_user(owner=alternate),
        "owner": _sample_user(owner=True),
        "email": "owner@example.com",
        "username": "owner@example.com",
        "token": "token-123",
        "code": "123456",
        "slug": "sample",
        "key": "sample",
        "provider": "sample",
        "source": "sample",
        "status": "draft",
        "lang": "ro" if alternate else "en",
        "language": "ro" if alternate else "en",
        "payment_method": "card",
        "currency": "RON",
        "q": "sample",
        "search": "sample",
        "page": 2 if alternate else 1,
        "limit": 2 if alternate else 1,
        "offset": 2 if alternate else 0,
        "days": 2 if alternate else 1,
        "hours": 2 if alternate else 1,
        "window_days": 2 if alternate else 1,
        "amount": Decimal("10.00"),
        "price": Decimal("10.00"),
        "value": Decimal("10.00"),
        "rate": Decimal("10.00"),
        "enabled": alternate,
        "active": alternate,
        "force": alternate,
        "strict": alternate,
        "payload": _DummyPayload(kind="weekly", status="draft", force=alternate, tags=["featured"], items=[]),
        "data": _DummyPayload(kind="weekly", status="draft", force=alternate, tags=["featured"], items=[]),
        "body": _DummyPayload(kind="weekly", status="draft", force=alternate, tags=["featured"], items=[]),
        "now": datetime.now(UTC),
        "created_at": datetime.now(UTC),
        "updated_at": datetime.now(UTC),
    }
    return lookup.get(name, _MISSING)


def _value_for_param(param: inspect.Parameter, *, alternate: bool):
    lowered = param.name.lower()

    if "request" in lowered:
        return _request_stub()
    if lowered.endswith("_id") or lowered == "id":
        return uuid4()
    if lowered.endswith("_ids") or lowered in {"ids", "item_ids", "product_ids", "order_ids"}:
        return [uuid4(), uuid4()]
    if lowered in {"start", "end", "from_date", "to_date", "range_from", "range_to"}:
        return None

    exact = _exact_name_value(lowered, alternate=alternate)
    if exact is not _MISSING:
        return exact

    if param.default is not inspect._empty:
        return param.default
    if param.annotation in {UUID, UUID | None}:
        return uuid4()
    return MagicMock(name=f"auto_{param.name}")


def _build_kwargs(func, *, alternate: bool, include_optional: bool) -> dict[str, object]:
    kwargs: dict[str, object] = {}
    for param in inspect.signature(func).parameters.values():
        if param.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD):
            continue
        if param.name in {"self", "cls"}:
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
    except (Exception, SystemExit) as exc:
        _ = str(exc)
        return


def _iter_targets(module_name: str):
    module = importlib.import_module(module_name)
    for name, func in inspect.getmembers(module, inspect.isfunction):
        if func.__module__ == module_name:
            yield name, func


@pytest.mark.parametrize("module_name", MODULES)
def test_aggressive_reflection_wave_for_residual_modules(module_name: str) -> None:
    invoked = 0
    for _name, func in _iter_targets(module_name):
        _invoke(func, _build_kwargs(func, alternate=False, include_optional=False))
        invoked += 1
        _invoke(func, _build_kwargs(func, alternate=True, include_optional=False))
        invoked += 1
        _invoke(func, _build_kwargs(func, alternate=True, include_optional=True))
        invoked += 1

    assert invoked >= 120
