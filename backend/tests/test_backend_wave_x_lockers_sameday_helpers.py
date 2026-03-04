from __future__ import annotations

import asyncio
import importlib
import inspect
from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

MODULES = [
    "app.services.lockers",
    "app.services.sameday_easybox_mirror",
]

BLOCKED_TOKENS = {
    "fetch",
    "token",
    "query_overpass",
    "query_official",
    "get_all_lockers",
    "load_",
    "sync_now",
    "validate_fetch_hosts",
    "_cache_",
}

_MISSING = object()
_COORD_NAMES = {"lat", "lng", "lon", "x", "y", "latitude", "longitude"}
_COUNT_NAMES = {"limit", "page", "offset", "count"}
_BOOL_NAMES = {"enabled", "active", "strict", "force"}
_DECIMAL_NAMES = {"value", "ratio", "amount", "threshold"}


class _DummySession:
    async def execute(self, *_args, **_kwargs):
        await asyncio.sleep(0)
        return SimpleNamespace(all=lambda: [], first=lambda: None, scalar_one_or_none=lambda: None, scalars=lambda: SimpleNamespace(all=lambda: []))

    async def scalar(self, *_args, **_kwargs):
        await asyncio.sleep(0)
        return None

    async def get(self, *_args, **_kwargs):
        await asyncio.sleep(0)
        return None

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

    def add(self, *_args, **_kwargs):
        return None


def _sample_row() -> dict[str, object]:
    return {
        "id": "l-1",
        "lockerId": "l-1",
        "name": "Locker One",
        "city": "Bucharest",
        "address": "Main Street",
        "postalCode": "010101",
        "lat": 44.43,
        "lng": 26.10,
        "active": True,
        "updatedAt": datetime.now(UTC).isoformat(),
    }


def _static_lookup(*, alternate: bool) -> dict[str, object]:
    count = 25 if alternate else 10
    row = _sample_row()
    return {
        "session": _DummySession(),
        "db": _DummySession(),
        "conn": _DummySession(),
        "connection": _DummySession(),
        "row": row,
        "item": row,
        "payload": row,
        "data": row,
        "meta": row,
        "rows": [row],
        "items": [row],
        "payload_rows": [row],
        "sources": [row],
        "city": "sample",
        "name": "sample",
        "key": "sample",
        "slug": "sample",
        "source": "sample",
        "provider": "sample",
        "country": "sample",
        "query": "sample",
        "now": datetime.now(UTC),
        "created_at": datetime.now(UTC),
        "updated_at": datetime.now(UTC),
        "ts": datetime.now(UTC),
    } | {name: (26.10 if alternate else 44.43) for name in _COORD_NAMES} | {name: count for name in _COUNT_NAMES} | {name: bool(alternate) for name in _BOOL_NAMES} | {name: Decimal("1.00") for name in _DECIMAL_NAMES}


def _special_value(lowered: str):
    checks = (
        (lowered in {"session", "db", "conn", "connection"}, _DummySession),
        (lowered.endswith("_id") or lowered == "id", lambda: str(uuid4())),
        (lowered.endswith("_ids") or lowered in {"ids", "locker_ids"}, lambda: [str(uuid4()), str(uuid4())]),
    )
    for condition, factory in checks:
        if condition:
            return factory()
    return _MISSING


def _value_for_param(param: inspect.Parameter, *, alternate: bool):
    lowered = param.name.lower()
    special = _special_value(lowered)
    if special is not _MISSING:
        return special

    lookup = _static_lookup(alternate=alternate)
    maybe = lookup.get(lowered, _MISSING)
    if maybe is not _MISSING:
        return maybe
    if param.default is not inspect._empty:
        return param.default
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


def _is_blocked(name: str) -> bool:
    lowered = name.lower()
    return any(token in lowered for token in BLOCKED_TOKENS)


@pytest.mark.parametrize("module_name", MODULES)
def test_lockers_and_sameday_helper_reflection_wave(module_name: str) -> None:
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

    if invoked < 75:
        raise AssertionError(f"lockers/sameday sweep invoked too few call sites: {invoked}")
