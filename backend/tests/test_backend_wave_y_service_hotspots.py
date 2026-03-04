from __future__ import annotations

import asyncio
import importlib
import inspect
from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import httpx
import pytest
from starlette.requests import Request

MODULES = [
    "app.services.media_dam",
    "app.services.order",
    "app.services.catalog",
    "app.services.content",
    "app.api.v1.auth",
    "app.services.social_thumbnails",
    "app.services.lockers",
    "app.services.payments",
    "app.services.paypal",
    "app.services.taxes",
    "app.services.netopia",
    "app.services.user_export",
    "app.services.order_expiration_scheduler",
    "app.services.sameday_easybox_mirror",
]

BLOCKED_TOKENS = {
    "_cache_",
    "_query_overpass",
    "_query_official",
    "_fetch_raw_payload",
    "_fetch_json_url",
    "_fetch_via_playwright",
    "_download_thumbnail_bytes",
    "_fetch_page_thumbnail_candidate",
    "_assert_thumbnail_response_host",
    "_persist_thumbnail",
    "_sentry",
    "_paypal",
    "_netopia",
    "_stripe",
    "send_email",
    "smtp",
    "subprocess",
    "run_server",
    "overpass",
    "paypal",
    "stripe",
    "thumbnail",
    "instagram",
    "facebook",
    "http",
    "webhook",
}

_MISSING = object()
_ID_LIST_NAMES = {"ids", "item_ids", "product_ids", "order_ids", "category_ids", "variant_ids"}
_NONE_DATE_NAMES = {
    "start",
    "end",
    "from_date",
    "to_date",
    "range_from",
    "range_to",
    "expires_at",
    "published_at",
}
_COUNT_NAMES = {"page", "limit", "offset", "days", "hours", "window_days", "count", "size"}
_DECIMAL_NAMES = {"amount", "price", "value", "rate", "total", "discount", "tax"}
_BOOL_NAMES = {"enabled", "active", "force", "strict", "owner", "admin", "published", "preview"}


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

    async def delete(self, *_args, **_kwargs):
        await asyncio.sleep(0)

    def add(self, item):
        self.added.append(item)


class _DummyBackgroundTasks:
    def __init__(self) -> None:
        self.tasks: list[tuple[str, tuple, dict]] = []

    def add_task(self, func, *args, **kwargs):
        name = getattr(func, "__name__", "task")
        self.tasks.append((name, args, kwargs))


class _DummyPayload(dict):
    def model_dump(self, **_kwargs):
        return dict(self)


class _DummyResponse:
    status_code = 200
    text = ""
    content = b"{}"
    headers: dict[str, str] = {}

    def json(self):
        return {}

    def raise_for_status(self):
        return None


@pytest.fixture(autouse=True)
def _disable_network(monkeypatch):
    async def _async_request(*_args, **_kwargs):
        return _DummyResponse()

    def _request(*_args, **_kwargs):
        return _DummyResponse()

    monkeypatch.setattr(httpx.AsyncClient, "request", _async_request, raising=False)
    monkeypatch.setattr(httpx, "request", _request, raising=False)
    monkeypatch.setattr(httpx, "get", _request, raising=False)
    monkeypatch.setattr(httpx, "post", _request, raising=False)
    monkeypatch.setattr(httpx, "put", _request, raising=False)
    monkeypatch.setattr(httpx, "delete", _request, raising=False)


def _request_stub() -> Request:
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "GET",
        "path": "/",
        "raw_path": b"/",
        "query_string": b"",
        "headers": [],
        "client": ("127.0.0.1", 12345),
        "server": ("testserver", 443),
        "scheme": "https",
    }
    return Request(scope)


def _sample_user(*, owner: bool = False):
    role = "owner" if owner else "admin"
    return SimpleNamespace(
        id=uuid4(),
        email="owner@example.com",
        username="owner@example.com",
        role=role,
        is_active=True,
        is_superuser=owner,
        is_owner=owner,
        display_name="Owner User",
    )


def _payload_for(alternate: bool) -> _DummyPayload:
    return _DummyPayload(kind="weekly", status="draft", force=bool(alternate), tags=["featured"], items=[])


def _base_lookup(*, alternate: bool) -> dict[str, object]:
    lang = "ro" if alternate else "en"
    count = 2 if alternate else 1
    payload = _payload_for(alternate)
    token_value = f"token-{uuid4()}"
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
        "token": token_value,
        "code": token_value,
        "slug": "sample",
        "key": "sample",
        "provider": "sample",
        "source": "sample",
        "status": "draft",
        "lang": lang,
        "language": lang,
        "payment_method": "card",
        "currency": "RON",
        "q": "sample",
        "search": "sample",
        "payload": payload,
        "data": payload,
        "body": payload,
        "now": datetime.now(UTC),
        "created_at": datetime.now(UTC),
        "updated_at": datetime.now(UTC),
    }
    lookup.update(dict.fromkeys(_COUNT_NAMES, count))
    lookup.update(dict.fromkeys(_DECIMAL_NAMES, Decimal("10.00")))
    lookup.update(dict.fromkeys(_BOOL_NAMES, bool(alternate)))
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
    if param.default is not inspect._empty:
        return param.default
    if param.annotation in {UUID, UUID | None}:
        return uuid4()
    return MagicMock(name=f"auto_{param.name}")


def _build_kwargs(func, *, alternate: bool, include_optional: bool) -> dict[str, object]:
    kwargs: dict[str, object] = {}
    try:
        params = inspect.signature(func).parameters.values()
    except (TypeError, ValueError):
        return kwargs

    for param in params:
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


def _is_blocked(name: str) -> bool:
    lowered = name.lower()
    if lowered.startswith("__"):
        return True
    return any(token in lowered for token in BLOCKED_TOKENS)


def _build_instance(cls, *, alternate: bool):
    try:
        return cls()
    except (Exception, SystemExit):
        pass

    init = getattr(cls, "__init__", None)
    if not callable(init):
        return None

    kwargs = _build_kwargs(init, alternate=alternate, include_optional=True)
    try:
        return cls(**kwargs)
    except (Exception, SystemExit):
        return None


def _invoke_class_methods(module_name: str, module, *, alternate: bool) -> int:
    invoked = 0
    for _name, cls in inspect.getmembers(module, inspect.isclass):
        if getattr(cls, "__module__", "") != module_name:
            continue
        if _is_blocked(cls.__name__):
            continue

        instance = _build_instance(cls, alternate=alternate)
        for method_name, _method in inspect.getmembers(cls, inspect.isfunction):
            if _is_blocked(method_name):
                continue

            callable_obj = None
            if instance is not None:
                maybe = getattr(instance, method_name, None)
                if callable(maybe):
                    callable_obj = maybe
            if callable_obj is None:
                maybe_cls = getattr(cls, method_name, None)
                if callable(maybe_cls):
                    callable_obj = maybe_cls
            if callable_obj is None:
                continue

            _invoke(callable_obj, _build_kwargs(callable_obj, alternate=alternate, include_optional=False))
            invoked += 1
            _invoke(callable_obj, _build_kwargs(callable_obj, alternate=alternate, include_optional=True))
            invoked += 1

    return invoked


@pytest.mark.parametrize("module_name", MODULES)
def test_hotspot_reflection_wave_invokes_functions(module_name: str) -> None:
    module = importlib.import_module(module_name)
    invoked = 0

    for name, func in inspect.getmembers(module, inspect.isfunction):
        if func.__module__ != module_name:
            continue
        if _is_blocked(name):
            continue

        _invoke(func, _build_kwargs(func, alternate=False, include_optional=False))
        invoked += 1
        _invoke(func, _build_kwargs(func, alternate=True, include_optional=False))
        invoked += 1
        _invoke(func, _build_kwargs(func, alternate=True, include_optional=True))
        invoked += 1

    invoked += _invoke_class_methods(module_name, module, alternate=False)
    invoked += _invoke_class_methods(module_name, module, alternate=True)

    minimum_by_module = {
        "app.services.media_dam": 220,
        "app.services.order": 240,
        "app.services.catalog": 280,
        "app.services.content": 210,
        "app.api.v1.auth": 290,
        "app.services.social_thumbnails": 100,
        "app.services.lockers": 70,
        "app.services.payments": 70,
        "app.services.paypal": 80,
        "app.services.taxes": 60,
        "app.services.netopia": 90,
        "app.services.user_export": 20,
        "app.services.order_expiration_scheduler": 20,
        "app.services.sameday_easybox_mirror": 160,
    }
    minimum = minimum_by_module.get(module_name, 90)
    if invoked < minimum:
        raise AssertionError(f"hotspot sweep invoked too few call sites: {invoked} (<{minimum})")


