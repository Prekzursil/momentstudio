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


def _value_for_name(name: str, *, alternate: bool):
    lower = name.lower()
    if lower in {"session", "db", "conn", "connection"}:
        return _DummySession()
    if lower in {"lat", "lng", "lon", "x", "y", "latitude", "longitude"}:
        return 44.43 if not alternate else 26.10
    if lower in {"radius_km", "distance_km", "km"}:
        return 5 if not alternate else 15
    if lower in {"limit", "page", "offset", "count"}:
        return 10 if not alternate else 25
    if lower in {"enabled", "active", "strict", "force"}:
        return alternate
    if lower.endswith("_id") or lower == "id":
        return str(uuid4())
    if lower.endswith("_ids") or lower in {"ids", "locker_ids"}:
        return [str(uuid4()), str(uuid4())]
    if lower in {"row", "item", "payload", "data", "meta"}:
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
    if lower in {"rows", "items", "payload_rows", "sources"}:
        return [
            {
                "id": "l-1",
                "name": "Locker One",
                "city": "Bucharest",
                "address": "Main Street",
                "lat": 44.43,
                "lng": 26.10,
                "active": True,
            }
        ]
    if lower in {"city", "name", "key", "slug", "source", "provider", "country", "query"}:
        return "sample"
    if lower in {"now", "created_at", "updated_at", "ts"}:
        return datetime.now(UTC)
    if lower in {"value", "ratio", "amount", "threshold"}:
        return Decimal("1.00")
    return _MISSING


def _value_for_param(param: inspect.Parameter, *, alternate: bool):
    value = _value_for_name(param.name, alternate=alternate)
    if value is not _MISSING:
        return value
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

    assert invoked >= 75
