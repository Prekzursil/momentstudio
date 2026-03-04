from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.models.media import MediaJobType
from app.services import media_dam


class _ExecResult:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return SimpleNamespace(all=lambda: list(self._rows))


class _SessionStub:
    def __init__(self, *, scalar_values, row_values):
        self._scalar_iter = iter(list(scalar_values))
        self._row_iter = iter(list(row_values))

    async def scalar(self, _stmt):
        await asyncio.sleep(0)
        return next(self._scalar_iter)

    async def execute(self, _stmt):
        await asyncio.sleep(0)
        return _ExecResult(next(self._row_iter))


def test_media_dam_retry_policy_normalization_and_delay_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    fallback = media_dam.RetryPolicyResolved(max_attempts=4, schedule=[10, 20], jitter_ratio=0.25, enabled=True, version_ts='base')

    normalized = media_dam._normalize_retry_policy_fields(
        max_attempts=100,
        schedule=[],
        jitter_ratio=2.5,
        enabled=False,
        fallback=fallback,
    )
    assert normalized.max_attempts == media_dam.MAX_RETRY_POLICY_ATTEMPTS
    assert normalized.schedule == [30]
    assert normalized.jitter_ratio == pytest.approx(1.0)
    assert normalized.enabled is False

    inherited = media_dam._normalize_retry_policy_fields(
        max_attempts=None,
        schedule=None,
        jitter_ratio=None,
        enabled=None,
        fallback=fallback,
    )
    assert inherited.max_attempts == 4
    assert inherited.schedule == [10, 20]
    assert inherited.jitter_ratio == pytest.approx(0.25)
    assert inherited.enabled is True

    assert media_dam._retry_delay_seconds(attempt=4, max_attempts=4, schedule=[10], jitter_ratio=0.0) is None
    assert media_dam._retry_delay_seconds(attempt=1, max_attempts=4, schedule=[], jitter_ratio=0.0) == 30

    monkeypatch.setattr(media_dam.random, 'uniform', lambda _lo, _hi: 0.5)
    assert media_dam._retry_delay_seconds(attempt=2, max_attempts=4, schedule=[10, 20], jitter_ratio=0.5) == 30


def test_media_dam_parse_job_type_and_policy_payload_validation() -> None:
    assert media_dam._parse_job_type(MediaJobType.ingest) == MediaJobType.ingest
    assert media_dam._parse_job_type('variant') == MediaJobType.variant
    with pytest.raises(ValueError, match='Invalid media job type'):
        media_dam._parse_job_type('not-a-job-type')

    assert media_dam._validate_schedule([1, 2, 3]) == [1, 2, 3]
    with pytest.raises(ValueError, match='positive integers'):
        media_dam._validate_schedule([0])
    with pytest.raises(ValueError, match='at least one'):
        media_dam._validate_schedule([])
    with pytest.raises(ValueError, match='cannot exceed'):
        media_dam._validate_schedule(list(range(1, 22)))

    ok_payload = SimpleNamespace(max_attempts=5, backoff_schedule_seconds=[15, 30], jitter_ratio=0.2)
    media_dam._validate_policy_payload(ok_payload)

    with pytest.raises(ValueError, match='max_attempts'):
        media_dam._validate_policy_payload(SimpleNamespace(max_attempts=0, backoff_schedule_seconds=None, jitter_ratio=None))
    with pytest.raises(ValueError, match='between 0 and 1'):
        media_dam._validate_policy_payload(SimpleNamespace(max_attempts=None, backoff_schedule_seconds=None, jitter_ratio=1.2))


def test_media_dam_asset_and_job_filter_clause_builders() -> None:
    assert media_dam._asset_tag_clause('   ') is None
    assert media_dam._job_tag_clause('') is None

    asset_filters = media_dam.MediaListFilters(
        q=' hero ',
        tag='featured',
        asset_type='image',
        status='approved',
        visibility='public',
        created_from=datetime(2026, 1, 1, tzinfo=timezone.utc),
        created_to=datetime(2026, 1, 31, tzinfo=timezone.utc),
        include_trashed=False,
    )
    asset_clauses = media_dam._build_asset_filter_clauses(asset_filters)
    assert len(asset_clauses) >= 6

    job_filters = media_dam.MediaJobListFilters(
        status='failed',
        job_type='variant',
        asset_id=uuid4(),
        created_from=datetime(2026, 1, 1, tzinfo=timezone.utc),
        created_to=datetime(2026, 1, 2, tzinfo=timezone.utc),
        triage_state='retrying',
        assigned_to_user_id=uuid4(),
        tag='ops',
        sla_breached=True,
        dead_letter_only=False,
    )
    job_clauses = media_dam._build_job_filter_clauses(job_filters, now=datetime(2026, 1, 3, tzinfo=timezone.utc))
    assert len(job_clauses) >= 8

    fallback_filters = media_dam.MediaJobListFilters(triage_state='invalid', sla_breached=False)
    fallback_clauses = media_dam._build_job_filter_clauses(fallback_filters, now=datetime(2026, 1, 3, tzinfo=timezone.utc))
    assert any('triage_state' in str(clause) for clause in fallback_clauses)


@pytest.mark.anyio('asyncio')
async def test_media_dam_list_assets_and_jobs_meta_branches() -> None:
    assets_session = _SessionStub(
        scalar_values=[0, 7],
        row_values=[
            [SimpleNamespace(id='asset-1')],
            [SimpleNamespace(id='asset-2'), SimpleNamespace(id='asset-3')],
        ],
    )

    empty_assets, empty_meta = await media_dam.list_assets(assets_session, media_dam.MediaListFilters(sort='unknown', page=1, limit=24))
    assert len(empty_assets) == 1
    assert empty_meta == {'total_items': 0, 'total_pages': 1, 'page': 1, 'limit': 24}

    paged_assets, paged_meta = await media_dam.list_assets(assets_session, media_dam.MediaListFilters(sort='name_desc', page=2, limit=3))
    assert len(paged_assets) == 2
    assert paged_meta['total_items'] == 7
    assert paged_meta['total_pages'] == 3

    jobs_session = _SessionStub(
        scalar_values=[4],
        row_values=[[SimpleNamespace(id='job-1')]],
    )
    jobs, jobs_meta = await media_dam.list_jobs(
        jobs_session,
        media_dam.MediaJobListFilters(status='queued', page=2, limit=2),
    )
    assert len(jobs) == 1
    assert jobs_meta['total_items'] == 4
    assert jobs_meta['total_pages'] == 2


@pytest.mark.anyio('asyncio')
async def test_media_dam_queue_depth_and_heartbeat_parsers(monkeypatch: pytest.MonkeyPatch) -> None:
    class _RedisGood:
        async def llen(self, _key):
            await asyncio.sleep(0)
            return 9

    class _RedisBad:
        async def llen(self, _key):
            await asyncio.sleep(0)
            raise RuntimeError('boom')

    assert await media_dam._redis_queue_depth(_RedisGood()) == 9
    assert await media_dam._redis_queue_depth(_RedisBad()) == 0

    monkeypatch.setattr(media_dam.settings, 'media_dam_telemetry_heartbeat_scan_limit', -5)
    assert media_dam._heartbeat_scan_limit() == 1
    monkeypatch.setattr(media_dam.settings, 'media_dam_telemetry_heartbeat_scan_limit', 11)
    assert media_dam._heartbeat_scan_limit() == 11

    naive = media_dam._parse_heartbeat_timestamp('2026-02-01T10:30:00')
    aware = media_dam._parse_heartbeat_timestamp('2026-02-01T10:30:00+02:00')
    assert naive is not None and naive.tzinfo == timezone.utc
    assert aware is not None and aware.tzinfo is not None
    assert media_dam._parse_heartbeat_timestamp('invalid') is None
