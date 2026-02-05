from __future__ import annotations

import json
import logging
from typing import Any

from app.core.config import settings

logger = logging.getLogger(__name__)

try:
    from redis.asyncio import Redis  # type: ignore[import-not-found]
except Exception:  # pragma: no cover
    Redis = None  # type: ignore[assignment]

_client: "Redis | None" = None


def get_redis() -> "Redis | None":
    """Return a shared Redis client when REDIS_URL is configured."""
    global _client
    if Redis is None:
        return None
    url = (getattr(settings, "redis_url", None) or "").strip()
    if not url:
        return None
    if _client is None:
        _client = Redis.from_url(url, encoding="utf-8", decode_responses=True)
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

