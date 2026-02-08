from __future__ import annotations

import asyncio
import hashlib
import logging
from collections.abc import Awaitable, Callable
from contextlib import suppress

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.core.config import settings
from app.db.session import engine

logger = logging.getLogger(__name__)

_RETRY_SECONDS = 15
_LEADER_ENGINE: AsyncEngine | None = None


def _is_postgres() -> bool:
    try:
        return (engine.url.get_backend_name() or "").lower() == "postgresql"
    except Exception:  # pragma: no cover - defensive
        return False


def _lock_id(name: str) -> int:
    digest = hashlib.blake2b(str(name or "").encode("utf-8"), digest_size=8).digest()
    value = int.from_bytes(digest, "big", signed=False)
    # Fit within signed BIGINT range.
    return int(value % (2**63 - 1))


def _leader_engine() -> AsyncEngine:
    """Dedicated engine for leader locks to avoid starving the request DB pool.

    Advisory locks are session-scoped, so the leader holds a connection for the duration of the loop.
    Using a small dedicated pool avoids consuming connections from the main API engine under load.
    """
    global _LEADER_ENGINE
    if _LEADER_ENGINE is not None:
        return _LEADER_ENGINE

    connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
    _LEADER_ENGINE = create_async_engine(
        settings.database_url,
        future=True,
        echo=False,
        connect_args=connect_args,
        pool_size=1,
        max_overflow=0,
        pool_pre_ping=True,
    )
    return _LEADER_ENGINE


async def run_as_leader(
    *,
    name: str,
    stop: asyncio.Event,
    work: Callable[[asyncio.Event], Awaitable[None]],
    retry_seconds: int = _RETRY_SECONDS,
) -> None:
    """
    Run the given background loop only on the leader instance.

    Uses a Postgres advisory lock to ensure only one worker/replica performs the work.
    On non-Postgres backends (e.g., sqlite), runs the work without leader election.
    """
    if not _is_postgres():
        await work(stop)
        return

    lock_id = _lock_id(name)
    retry = max(5, int(retry_seconds or _RETRY_SECONDS))

    while not stop.is_set():
        try:
            async with _leader_engine().connect() as conn:
                acquired = bool(
                    (await conn.execute(text("SELECT pg_try_advisory_lock(:id)"), {"id": lock_id})).scalar()
                )
                if not acquired:
                    with suppress(asyncio.TimeoutError):
                        await asyncio.wait_for(stop.wait(), timeout=retry)
                    continue

                logger.info("leader_lock_acquired", extra={"lock_name": name, "lock_id": lock_id})
                try:
                    await work(stop)
                finally:
                    with suppress(Exception):
                        await conn.execute(text("SELECT pg_advisory_unlock(:id)"), {"id": lock_id})
                return
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.warning("leader_lock_failed", extra={"lock_name": name, "lock_id": lock_id, "error": str(exc)})
            with suppress(asyncio.TimeoutError):
                await asyncio.wait_for(stop.wait(), timeout=retry)
