from __future__ import annotations

import time
import math
from collections import defaultdict, deque
from typing import Awaitable, Callable, DefaultDict, Deque, Hashable, Iterable

from fastapi import HTTPException, Request, status

WindowBucket = Deque[float]


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
        _enforce_limit(buckets[key], limit, window_seconds, now)

    dependency.buckets = buckets  # type: ignore[attr-defined]
    return dependency


def per_identifier_limiter(
    identifier_fn: Callable[[Request], Hashable], limit: int, window_seconds: int
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
        _enforce_limit(buckets[ident], limit, window_seconds, now)

    dependency.buckets = buckets  # type: ignore[attr-defined]
    return dependency


def reset_buckets(buckets: Iterable[DefaultDict[Hashable, WindowBucket]]) -> None:
    """Helper for tests to clear limiter state."""
    for bucket in buckets:
        bucket.clear()
