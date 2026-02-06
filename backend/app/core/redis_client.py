from __future__ import annotations

import json
import logging
from typing import Any, TYPE_CHECKING

from app.core.config import settings

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from redis.asyncio import Redis as RedisClient

_client: "RedisClient | None" = None


def _resolve_redis_class() -> type["RedisClient"] | None:
    try:
        from redis.asyncio import Redis  # type: ignore[import-not-found]
    except Exception:  # pragma: no cover
        return None
    return Redis


def get_redis() -> "RedisClient | None":
    """Return a shared Redis client when REDIS_URL is configured."""
    global _client
    url = (getattr(settings, "redis_url", None) or "").strip()
    if not url:
        return None
    redis_class = _resolve_redis_class()
    if redis_class is None:
        return None
    if _client is None:
        _client = redis_class.from_url(url, encoding="utf-8", decode_responses=True)
    return _client


async def close_redis() -> None:
    global _client
    client = _client
    _client = None
    if client is None:
        return
    try:
        await client.close()
    except Exception:
        logger.exception("Failed to close Redis client")


def json_dumps(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def json_loads(raw: str) -> Any:
    return json.loads(raw)
