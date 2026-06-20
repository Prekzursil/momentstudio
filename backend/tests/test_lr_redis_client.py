"""Lean-gate unit coverage for ``app.core.redis_client``."""

from __future__ import annotations

import pytest

from app.core import redis_client
from app.core.redis_client import (
    close_redis,
    get_redis,
    json_dumps,
    json_loads,
    _resolve_redis_class,
)


@pytest.fixture(autouse=True)
def _reset_client():
    redis_client._client = None
    yield
    redis_client._client = None


class _FakeRedis:
    created: list[dict] = []

    def __init__(self) -> None:
        self.closed = False

    @classmethod
    def from_url(cls, url, **kwargs):  # noqa: ANN001
        cls.created.append({"url": url, **kwargs})
        return cls()

    async def close(self) -> None:
        self.closed = True


def test_get_redis_no_url_returns_none(monkeypatch) -> None:
    monkeypatch.setattr(redis_client.settings, "redis_url", "", raising=False)
    assert get_redis() is None


def test_get_redis_blank_url_returns_none(monkeypatch) -> None:
    monkeypatch.setattr(redis_client.settings, "redis_url", "   ", raising=False)
    assert get_redis() is None


def test_get_redis_unavailable_class_returns_none(monkeypatch) -> None:
    monkeypatch.setattr(
        redis_client.settings, "redis_url", "redis://localhost:6379", raising=False
    )
    monkeypatch.setattr(redis_client, "_resolve_redis_class", lambda: None)
    assert get_redis() is None


def test_get_redis_builds_and_caches_client(monkeypatch) -> None:
    _FakeRedis.created = []
    monkeypatch.setattr(
        redis_client.settings, "redis_url", "redis://host:6379/0", raising=False
    )
    monkeypatch.setattr(redis_client, "_resolve_redis_class", lambda: _FakeRedis)
    first = get_redis()
    assert isinstance(first, _FakeRedis)
    assert _FakeRedis.created[0]["url"] == "redis://host:6379/0"
    assert _FakeRedis.created[0]["decode_responses"] is True
    # Second call returns the cached client (no new from_url).
    second = get_redis()
    assert second is first
    assert len(_FakeRedis.created) == 1


def test_resolve_redis_class_real_import() -> None:
    # redis is installed in the test env, so this returns the real class.
    cls = _resolve_redis_class()
    assert cls is not None


@pytest.mark.anyio
async def test_close_redis_noop_when_unset() -> None:
    redis_client._client = None
    await close_redis()  # should not raise
    assert redis_client._client is None


@pytest.mark.anyio
async def test_close_redis_closes_client() -> None:
    fake = _FakeRedis()
    redis_client._client = fake
    await close_redis()
    assert fake.closed is True
    assert redis_client._client is None


@pytest.mark.anyio
async def test_close_redis_swallows_errors(caplog) -> None:
    class Boom(_FakeRedis):
        async def close(self) -> None:
            raise RuntimeError("nope")

    redis_client._client = Boom()
    await close_redis()  # exception logged, not raised
    assert redis_client._client is None


def test_json_round_trip() -> None:
    assert json_dumps({"a": 1}) == '{"a":1}'
    assert json_loads('{"a":1}') == {"a": 1}
