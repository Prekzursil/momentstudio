import asyncio
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from app.workers import media_worker


class _RedisStub:
    def __init__(self, payload):
        self._payload = payload
        self._calls = 0

    async def set(self, *_args, **_kwargs):
        return True

    async def blpop(self, *_args, **_kwargs):
        if self._calls == 0:
            self._calls += 1
            return (media_worker.QUEUE_KEY, self._payload)
        raise asyncio.CancelledError


@pytest.mark.anyio
@pytest.mark.parametrize("payload", [str(uuid4()).encode("utf-8"), str(uuid4())])
async def test_run_media_worker_normalizes_decode_modes(monkeypatch: pytest.MonkeyPatch, payload) -> None:
    redis = _RedisStub(payload)
    process_mock = AsyncMock()

    monkeypatch.setattr(media_worker, "get_redis", lambda: redis)
    monkeypatch.setattr(media_worker, "_process_job_id", process_mock)
    monkeypatch.setattr(media_worker, "_publish_heartbeat", AsyncMock())
    monkeypatch.setattr(media_worker, "_enqueue_due_retries_once", AsyncMock())

    with pytest.raises(asyncio.CancelledError):
        await media_worker.run_media_worker(poll_interval_seconds=1)

    process_mock.assert_awaited_once()
    expected = payload.decode("utf-8") if isinstance(payload, bytes) else payload
    assert process_mock.await_args.args == (expected.strip(),)


@pytest.mark.anyio
async def test_run_media_worker_logs_warning_on_invalid_payload(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    redis = _RedisStub(b"\xff\xfe")
    process_mock = AsyncMock()

    monkeypatch.setattr(media_worker, "get_redis", lambda: redis)
    monkeypatch.setattr(media_worker, "_process_job_id", process_mock)
    monkeypatch.setattr(media_worker, "_publish_heartbeat", AsyncMock())
    monkeypatch.setattr(media_worker, "_enqueue_due_retries_once", AsyncMock())

    with caplog.at_level("WARNING"):
        with pytest.raises(asyncio.CancelledError):
            await media_worker.run_media_worker(poll_interval_seconds=1)

    process_mock.assert_not_awaited()
    assert "media_worker_invalid_job_payload" in caplog.text
