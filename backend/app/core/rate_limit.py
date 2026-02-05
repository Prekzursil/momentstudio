from __future__ import annotations

import time
import math
import logging
from collections import defaultdict, deque
from typing import Awaitable, Callable, DefaultDict, Deque, Hashable, Iterable

from fastapi import HTTPException, Request, status

from app.core.redis_client import get_redis

WindowBucket = Deque[float]

logger = logging.getLogger(__name__)


def _prune(bucket: WindowBucket, now: float, window_seconds: int) -> None:
    while bucket and now - bucket[0] > window_seconds:
        bucket.popleft()


def _enforce_limit(bucket: WindowBucket, limit: int, window_seconds: int, now: float) -> None:
    _prune(bucket, now, window_seconds)
    if len(bucket) >= limit:
        retry_after_seconds = 1
        if bucket:
            retry_after_seconds = max(1, int(math.ceil(bucket[0] + window_seconds - now)))
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests",
            headers={"Retry-After": str(retry_after_seconds)},
        )
    bucket.append(now)


async def _enforce_limit_redis(
    *,
    key: Hashable,
    identifier: Hashable,
    limit: int,
    window_seconds: int,
    now: float,
) -> bool:
    client = get_redis()
    if client is None:
        return False
    if limit <= 0:
        return True
    try:
        now_int = int(now)
        window = now_int // max(1, int(window_seconds))
        redis_key = f"rate_limit:{key}:{identifier}:{window}"
        count = await client.incr(redis_key)
        if count == 1:
            await client.expire(redis_key, int(window_seconds))
        if int(count) > int(limit):
            retry_after_seconds = max(1, int(window_seconds) - (now_int % int(window_seconds or 1)))
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests",
                headers={"Retry-After": str(retry_after_seconds)},
            )
        return True
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("redis_rate_limit_failed", extra={"error": str(exc)})
        return False


def limiter(
    key: Hashable, limit: int, window_seconds: int
) -> Callable[[Request], Awaitable[None]]:
    """
    Simple in-memory rate limiter shared per-process.

    Args:
        key: identifier for the bucket (e.g., "auth:login").
        limit: max requests allowed in the window.
        window_seconds: rolling window length in seconds.
    """
    buckets: DefaultDict[Hashable, WindowBucket] = defaultdict(deque)

    async def dependency(_: Request) -> None:
        now = time.time()
        enforced = await _enforce_limit_redis(key=key, identifier="global", limit=limit, window_seconds=window_seconds, now=now)
        if not enforced:
            _enforce_limit(buckets[key], limit, window_seconds, now)

    dependency.buckets = buckets  # type: ignore[attr-defined]
    return dependency


def per_identifier_limiter(
    identifier_fn: Callable[[Request], Hashable],
    limit: int,
    window_seconds: int,
    key: Hashable,
) -> Callable[[Request], Awaitable[None]]:
    """
    Rate limiter that uses a dynamic identifier (e.g., client IP or user id).

    Args:
        identifier_fn: function that maps the request to an identifier.
        limit: max requests allowed in the window.
        window_seconds: rolling window length in seconds.
    """
    buckets: DefaultDict[Hashable, WindowBucket] = defaultdict(deque)

    async def dependency(request: Request) -> None:
        ident = identifier_fn(request)
        now = time.time()
        enforced = await _enforce_limit_redis(key=key, identifier=ident, limit=limit, window_seconds=window_seconds, now=now)
        if not enforced:
            _enforce_limit(buckets[ident], limit, window_seconds, now)

    dependency.buckets = buckets  # type: ignore[attr-defined]
    return dependency


def reset_buckets(buckets: Iterable[DefaultDict[Hashable, WindowBucket]]) -> None:
    """Helper for tests to clear limiter state."""
    for bucket in buckets:
        bucket.clear()
