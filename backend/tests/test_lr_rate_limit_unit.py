"""Lean-gate unit coverage for ``app.core.rate_limit`` internals.

The existing ``test_rate_limit.py`` exercises the in-memory limiter via the auth
HTTP surface; this file covers the Redis path, the pure helpers, and the
limiter/per-identifier dependency wiring directly (disjoint from that file).
"""

from __future__ import annotations

from collections import deque

import pytest
from fastapi import HTTPException

from app.core import rate_limit
from app.core.rate_limit import (
    _enforce_limit,
    _enforce_limit_redis,
    _prune,
    limiter,
    per_identifier_limiter,
    reset_buckets,
)


# --------------------------------------------------------------------------- #
# pure helpers                                                                 #
# --------------------------------------------------------------------------- #
def test_prune_drops_expired_entries() -> None:
    bucket = deque([1.0, 2.0, 50.0])
    _prune(bucket, now=60.0, window_seconds=20)
    assert list(bucket) == [50.0]


def test_prune_empty_bucket_noop() -> None:
    bucket: deque[float] = deque()
    _prune(bucket, now=60.0, window_seconds=20)
    assert list(bucket) == []


def test_prune_no_expired_keeps_all() -> None:
    bucket = deque([59.0, 60.0])
    _prune(bucket, now=60.0, window_seconds=20)
    assert list(bucket) == [59.0, 60.0]


def test_enforce_limit_appends_when_under_limit() -> None:
    bucket: deque[float] = deque()
    _enforce_limit(bucket, limit=2, window_seconds=10, now=100.0)
    assert list(bucket) == [100.0]


def test_enforce_limit_raises_429_with_retry_after() -> None:
    bucket = deque([100.0, 101.0])
    with pytest.raises(HTTPException) as exc:
        _enforce_limit(bucket, limit=2, window_seconds=10, now=105.0)
    assert exc.value.status_code == 429
    assert int(exc.value.headers["Retry-After"]) >= 1


def test_enforce_limit_raises_with_empty_bucket_zero_limit() -> None:
    # limit==0 with an empty bucket trips the 429 before any timestamp exists,
    # exercising the ``if bucket:`` false branch (retry stays at the default 1).
    bucket: deque[float] = deque()
    with pytest.raises(HTTPException) as exc:
        _enforce_limit(bucket, limit=0, window_seconds=10, now=100.0)
    assert exc.value.headers["Retry-After"] == "1"


def test_reset_buckets_clears_all() -> None:
    from collections import defaultdict

    b1 = defaultdict(deque)
    b1["k"].append(1.0)
    b2 = defaultdict(deque)
    b2["j"].append(2.0)
    reset_buckets([b1, b2])
    assert not b1["k"]
    assert not b2["j"]


# --------------------------------------------------------------------------- #
# _enforce_limit_redis                                                         #
# --------------------------------------------------------------------------- #
class _FakeRedis:
    def __init__(self, counts: list[int]) -> None:
        self._counts = counts
        self._i = 0
        self.expired: list[tuple[str, int]] = []

    async def incr(self, key):  # noqa: ANN001
        val = self._counts[self._i]
        self._i += 1
        return val

    async def expire(self, key, seconds):  # noqa: ANN001
        self.expired.append((key, seconds))


@pytest.mark.anyio
async def test_redis_returns_false_when_no_client(monkeypatch) -> None:
    monkeypatch.setattr(rate_limit, "get_redis", lambda: None)
    out = await _enforce_limit_redis(
        key="k", identifier="id", limit=5, window_seconds=10, now=100.0
    )
    assert out is False


@pytest.mark.anyio
async def test_redis_zero_limit_short_circuit(monkeypatch) -> None:
    monkeypatch.setattr(rate_limit, "get_redis", lambda: _FakeRedis([1]))
    out = await _enforce_limit_redis(
        key="k", identifier="id", limit=0, window_seconds=10, now=100.0
    )
    assert out is True


@pytest.mark.anyio
async def test_redis_first_hit_sets_expiry(monkeypatch) -> None:
    fake = _FakeRedis([1])
    monkeypatch.setattr(rate_limit, "get_redis", lambda: fake)
    out = await _enforce_limit_redis(
        key="k", identifier="id", limit=5, window_seconds=10, now=100.0
    )
    assert out is True
    assert fake.expired and fake.expired[0][1] == 10


@pytest.mark.anyio
async def test_redis_under_limit_no_expiry(monkeypatch) -> None:
    fake = _FakeRedis([2])
    monkeypatch.setattr(rate_limit, "get_redis", lambda: fake)
    out = await _enforce_limit_redis(
        key="k", identifier="id", limit=5, window_seconds=10, now=100.0
    )
    assert out is True
    assert fake.expired == []


@pytest.mark.anyio
async def test_redis_over_limit_raises(monkeypatch) -> None:
    fake = _FakeRedis([6])
    monkeypatch.setattr(rate_limit, "get_redis", lambda: fake)
    with pytest.raises(HTTPException) as exc:
        await _enforce_limit_redis(
            key="k", identifier="id", limit=5, window_seconds=10, now=100.0
        )
    assert exc.value.status_code == 429


@pytest.mark.anyio
async def test_redis_failure_falls_back_false(monkeypatch) -> None:
    class Boom:
        async def incr(self, key):  # noqa: ANN001
            raise RuntimeError("redis down")

    monkeypatch.setattr(rate_limit, "get_redis", lambda: Boom())
    out = await _enforce_limit_redis(
        key="k", identifier="id", limit=5, window_seconds=10, now=100.0
    )
    assert out is False


# --------------------------------------------------------------------------- #
# limiter / per_identifier_limiter dependencies                               #
# --------------------------------------------------------------------------- #
@pytest.mark.anyio
async def test_limiter_uses_memory_when_redis_absent(monkeypatch) -> None:
    monkeypatch.setattr(rate_limit, "get_redis", lambda: None)
    dep = limiter("test:key", limit=1, window_seconds=60)
    await dep(None)  # first allowed
    with pytest.raises(HTTPException):
        await dep(None)  # second blocked via in-memory bucket


@pytest.mark.anyio
async def test_limiter_skips_memory_when_redis_enforced(monkeypatch) -> None:
    monkeypatch.setattr(rate_limit, "get_redis", lambda: _FakeRedis([1, 1, 1]))
    dep = limiter("test:key2", limit=1, window_seconds=60)
    await dep(None)
    await dep(None)  # redis returns True each time -> no in-memory enforcement
    assert not dep.buckets["test:key2"]  # type: ignore[attr-defined]


@pytest.mark.anyio
async def test_per_identifier_limiter_memory(monkeypatch) -> None:
    monkeypatch.setattr(rate_limit, "get_redis", lambda: None)

    class Req:
        client_ip = "1.2.3.4"

    dep = per_identifier_limiter(
        lambda r: r.client_ip, limit=1, window_seconds=60, key="ip"
    )
    req = Req()
    await dep(req)
    with pytest.raises(HTTPException):
        await dep(req)


@pytest.mark.anyio
async def test_per_identifier_limiter_redis(monkeypatch) -> None:
    monkeypatch.setattr(rate_limit, "get_redis", lambda: _FakeRedis([1, 1]))

    class Req:
        client_ip = "9.9.9.9"

    dep = per_identifier_limiter(
        lambda r: r.client_ip, limit=1, window_seconds=60, key="ip2"
    )
    req = Req()
    await dep(req)
    await dep(req)
    assert not dep.buckets["9.9.9.9"]  # type: ignore[attr-defined]
