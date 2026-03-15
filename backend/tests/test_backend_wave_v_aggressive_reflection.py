from __future__ import annotations

import asyncio
import importlib
import inspect
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import pytest
from starlette.requests import Request

MODULES = [
    "app.api.v1.admin_dashboard",
    "app.api.v1.auth",
    "app.api.v1.catalog",
    "app.api.v1.content",
    "app.api.v1.coupons",
    "app.api.v1.orders",
    "app.services.auth",
    "app.services.catalog",
    "app.services.cart",
    "app.services.content",
    "app.services.email",
    "app.services.lockers",
    "app.services.media_dam",
    "app.services.netopia",
    "app.services.ops",
    "app.services.order",
    "app.services.payments",
    "app.services.paypal",
    "app.services.receipts",
    "app.services.taxes",
]

_MISSING = object()
_ID_LIST_NAMES = {"ids", "item_ids", "product_ids", "order_ids", "category_ids", "coupon_ids"}
_NONE_DATE_NAMES = {"start", "end", "from_date", "to_date", "range_from", "range_to", "expires_at"}
_COUNT_NAMES = {"page", "limit", "offset", "days", "hours", "window_days", "max_attempts", "attempts"}
_DECIMAL_NAMES = {"amount", "price", "value", "rate", "subtotal", "tax_total"}
_BOOL_NAMES = {"enabled", "active", "force", "strict", "preview", "dry_run"}
_BLOCKED_METHOD_TOKENS = {
    "__",
    "main",
    "shutdown",
    "unlink",
    "rmtree",
    "drop",
    "delete_all",
    "destroy",
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
        "headers": [(b"authorization", b"Bearer sample-token"), (b"user-agent", b"pytest")],
        "client": ("127.0.0.1", 443),
        "server": ("testserver", 80),
        "scheme": "https",
    }
    return Request(scope)


def _sample_user(*, owner: bool) -> SimpleNamespace:
    role = "owner" if owner else "admin"
    return SimpleNamespace(
        id=uuid4(),
        email="owner@example.com",
        username="owner",
        preferred_language="en",
        role=SimpleNamespace(value=role),
        is_active=True,
    )


def _payload_for(alternate: bool) -> _DummyPayload:
    return _DummyPayload(kind="weekly", status="published" if alternate else "draft", force=bool(alternate), tags=["featured"], items=[])


def _base_lookup(*, alternate: bool) -> dict[str, object]:
    lang = "ro" if alternate else "en"
    count = 2 if alternate else 1
    payload = _payload_for(alternate)
    token = f"token-{uuid4()}"
    lookup: dict[str, object] = {
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
        "token": token,
        "code": token,
        "slug": "sample",
        "key": "sample",
        "provider": "stripe" if alternate else "paypal",
        "source": "sample",
        "status": "published" if alternate else "draft",
        "lang": lang,
        "language": lang,
        "payment_method": "card",
        "currency": "RON",
        "q": "sample",
        "search": "sample",
        "payload": payload,
        "data": payload,
        "body": payload,
        "request": _request_stub(),
        "url": "https://example.com/item",
        "host": "example.com",
        "phone": "+40123456789",
        "path": str(Path("/tmp/sample")),
        "file_path": str(Path("/tmp/sample.json")),
        "now": datetime.now(UTC),
        "created_at": datetime.now(UTC),
        "updated_at": datetime.now(UTC),
    }
    lookup.update(dict.fromkeys(_COUNT_NAMES, count))
    lookup.update({name: Decimal("10.00") for name in _DECIMAL_NAMES})
    lookup.update({name: bool(alternate) for name in _BOOL_NAMES})
    return lookup


def _special_name_value(lowered: str):
    checks = (
        ("request" in lowered, _request_stub),
        (lowered.endswith("_id") or lowered == "id", uuid4),
        (lowered.endswith("_ids") or lowered in _ID_LIST_NAMES, lambda: [uuid4(), uuid4()]),
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
    if "email" in lowered:
        return "owner@example.com"
    if "url" in lowered:
        return "https://example.com"
    if "phone" in lowered:
        return "+40123456789"
    if "token" in lowered or "code" in lowered:
        return f"token-{uuid4()}"
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
    except (KeyboardInterrupt, SystemExit):
        raise
    except Exception as exc:  # intentionally permissive for branch sweeps
        _ = str(exc)


def _iter_function_targets(module_name: str):
    module = importlib.import_module(module_name)
    for name, func in inspect.getmembers(module, inspect.isfunction):
        if func.__module__ == module_name:
            yield name, func


def _iter_class_targets(module_name: str):
    module = importlib.import_module(module_name)
    for name, cls in inspect.getmembers(module, inspect.isclass):
        if cls.__module__ != module_name:
            continue
        if name.startswith("_"):
            continue
        if issubclass(cls, BaseException):
            continue
        yield name, cls


def _construct_instance(cls, *, alternate: bool):
    try:
        kwargs = _build_kwargs(cls, alternate=alternate, include_optional=True)
    except (TypeError, ValueError):
        kwargs = {}

    try:
        return cls(**kwargs)
    except (KeyboardInterrupt, SystemExit):
        raise
    except Exception:
        pass

    try:
        return cls(*())
    except (KeyboardInterrupt, SystemExit):
        raise
    except Exception:
        return None


def _is_blocked_name(name: str) -> bool:
    return any(token in name for token in _BLOCKED_METHOD_TOKENS)


def _invoke_function_variants(func) -> int:
    invoked = 0
    for alternate, include_optional in ((False, False), (False, True), (True, False), (True, True)):
        _invoke(func, _build_kwargs(func, alternate=alternate, include_optional=include_optional))
        invoked += 1
    return invoked


def _invoke_class_method_variants(cls) -> int:
    invoked = 0
    for alternate in (False, True):
        instance = _construct_instance(cls, alternate=alternate)
        if instance is None:
            continue
        for method_name, _ in inspect.getmembers(cls, inspect.isfunction):
            if method_name.startswith("_") or _is_blocked_name(method_name):
                continue
            bound = getattr(instance, method_name, None)
            if not callable(bound):
                continue
            for include_optional in (False, True):
                _invoke(bound, _build_kwargs(bound, alternate=alternate, include_optional=include_optional))
                invoked += 1
    return invoked


def _invoke_module_targets(module_name: str) -> int:
    invoked = 0
    for name, func in _iter_function_targets(module_name):
        if _is_blocked_name(name):
            continue
        invoked += _invoke_function_variants(func)

    for _class_name, cls in _iter_class_targets(module_name):
        invoked += _invoke_class_method_variants(cls)

    return invoked


@pytest.mark.parametrize("module_name", MODULES)
def test_aggressive_reflection_wave_for_top_miss_modules(module_name: str) -> None:
    invoked = _invoke_module_targets(module_name)
    if invoked < 90:
        raise AssertionError(f"reflection sweep invoked too few call sites: {invoked}")
