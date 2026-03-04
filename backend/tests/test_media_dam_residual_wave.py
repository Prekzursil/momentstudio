from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from PIL import Image

from app.models.media import MediaAssetStatus, MediaAssetType, MediaJobStatus, MediaJobType, MediaVisibility
from app.services import media_dam


class _ExecResult:
    def __init__(self, rows):
        self._rows = list(rows)

    def scalars(self):
        return SimpleNamespace(all=lambda: list(self._rows))

    def all(self):
        return list(self._rows)


@dataclass
class _SessionStub:
    scalar_values: list[object] | None = None
    execute_values: list[list[object]] | None = None

    def __post_init__(self) -> None:
        self._scalar_values = list(self.scalar_values or [])
        self._execute_values = list(self.execute_values or [])
        self.added: list[object] = []
        self.deleted: list[object] = []
        self.commits = 0
        self.flushes = 0
        self.refreshed: list[object] = []

    async def scalar(self, _stmt):
        await asyncio.sleep(0)
        return self._scalar_values.pop(0) if self._scalar_values else None

    async def execute(self, _stmt):
        await asyncio.sleep(0)
        rows = self._execute_values.pop(0) if self._execute_values else []
        return _ExecResult(rows)

    def add(self, obj) -> None:
        self.added.append(obj)

    async def delete(self, obj) -> None:
        await asyncio.sleep(0)
        self.deleted.append(obj)

    async def commit(self) -> None:
        await asyncio.sleep(0)
        self.commits += 1

    async def flush(self) -> None:
        await asyncio.sleep(0)
        self.flushes += 1

    async def refresh(self, obj) -> None:
        await asyncio.sleep(0)
        stamp = datetime(2026, 3, 4, tzinfo=timezone.utc)
        if hasattr(obj, "created_at") and getattr(obj, "created_at", None) is None:
            obj.created_at = stamp
        if hasattr(obj, "updated_at") and getattr(obj, "updated_at", None) is None:
            obj.updated_at = stamp
        self.refreshed.append(obj)


class _AsyncRedisScan:
    def __init__(self, keys: list[str]):
        self._keys = list(keys)

    async def scan_iter(self, *, match: str):
        assert match.startswith('media:')
        for key in self._keys:
            yield key


def test_parse_ratio_and_move_helpers_guard_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    assert media_dam._parse_ratio(object()) == pytest.approx(0.0)
    assert media_dam._parse_ratio(2.0) == pytest.approx(1.0)

    asset_without_key = SimpleNamespace(storage_key=None)
    media_dam._move_asset_file_roots(asset_without_key, to_public=True)

    variant_asset = SimpleNamespace(variants=[SimpleNamespace(storage_key=None), SimpleNamespace(storage_key='missing/key.jpg')])
    monkeypatch.setattr(media_dam, '_find_existing_storage_path', lambda _key: None)
    media_dam._move_variant_file_roots(variant_asset, to_public=False)

    called: list[str] = []

    def _raise_move(*_args, **_kwargs):
        called.append('asset')
        raise RuntimeError('move failed')

    monkeypatch.setattr(media_dam, '_move_asset_file_roots', _raise_move)
    monkeypatch.setattr(media_dam, '_move_variant_file_roots', lambda *_a, **_k: called.append('variant'))
    probe = SimpleNamespace(storage_key='x', variants=[], visibility=MediaVisibility.private, status=MediaAssetStatus.draft)
    media_dam._ensure_asset_storage_placement(probe)
    assert called == ['asset']


@pytest.mark.anyio('asyncio')
async def test_replace_asset_i18n_and_apply_asset_update_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _SessionStub()
    existing = SimpleNamespace(lang='en', title='old', alt_text='old', caption='old', description='old')
    asset = SimpleNamespace(id=uuid4(), i18n=[existing])
    entries = [
        SimpleNamespace(lang='en', title='  Title ', alt_text=' Alt ', caption='  ', description=' Desc '),
        SimpleNamespace(lang='en', title='ignored', alt_text='ignored', caption='ignored', description='ignored'),
        SimpleNamespace(lang='ro', title=' Titlu ', alt_text=None, caption=None, description=''),
    ]

    await media_dam._replace_asset_i18n(session, asset, entries)

    assert existing.title == 'Title'
    assert existing.alt_text == 'Alt'
    created = [row for row in session.added if getattr(row, 'lang', None) == 'ro']
    assert len(created) == 1

    calls = {'tags': 0, 'i18n': 0, 'asset_move': 0, 'variant_move': 0}

    async def _fake_replace_tags(_session, _asset, _tags):
        calls['tags'] += 1

    async def _fake_replace_i18n(_session, _asset, _i18n):
        calls['i18n'] += 1

    monkeypatch.setattr(media_dam, '_replace_asset_tags', _fake_replace_tags)
    monkeypatch.setattr(media_dam, '_replace_asset_i18n', _fake_replace_i18n)
    monkeypatch.setattr(media_dam, '_move_asset_file_roots', lambda *_a, **_k: calls.__setitem__('asset_move', calls['asset_move'] + 1))
    monkeypatch.setattr(media_dam, '_move_variant_file_roots', lambda *_a, **_k: calls.__setitem__('variant_move', calls['variant_move'] + 1))

    updatable = SimpleNamespace(
        id=uuid4(),
        status=MediaAssetStatus.draft,
        visibility=MediaVisibility.private,
        rights_license=None,
        rights_owner=None,
        rights_notes=None,
        tags=[],
        i18n=[],
        storage_key='originals/test.jpg',
        variants=[]
    )
    payload = SimpleNamespace(
        status='approved',
        visibility='public',
        rights_license='  license  ',
        rights_owner='   ',
        rights_notes=' note ',
        tags=['hero'],
        i18n=[SimpleNamespace(lang='en', title='Title', alt_text='Alt', caption=None, description=None)]
    )

    await media_dam.apply_asset_update(session, updatable, payload)

    assert updatable.status == MediaAssetStatus.approved
    assert updatable.visibility == MediaVisibility.public
    assert updatable.rights_license == 'license'
    assert updatable.rights_owner is None
    assert updatable.rights_notes == 'note'
    assert calls == {'tags': 1, 'i18n': 1, 'asset_move': 1, 'variant_move': 1}


@pytest.mark.anyio('asyncio')
async def test_collect_workers_and_get_telemetry_exception_branch(monkeypatch: pytest.MonkeyPatch) -> None:
    now = datetime(2026, 3, 4, tzinfo=timezone.utc)
    redis = _AsyncRedisScan(['media:workers:heartbeat:w1', 'media:workers:heartbeat:w2', 'media:workers:heartbeat:w3'])

    monkeypatch.setattr(media_dam, '_heartbeat_scan_limit', lambda: 2)

    async def _consume(_redis, *, key, now):
        return SimpleNamespace(worker_id=str(key), last_seen_at=now)

    monkeypatch.setattr(media_dam, '_consume_heartbeat', _consume)
    workers = await media_dam._collect_telemetry_workers(redis, prefix='media:workers:heartbeat', now=now)
    assert len(workers) == 2

    class _RedisQueue:
        async def llen(self, _key):
            await asyncio.sleep(0)
            return 7

    monkeypatch.setattr(media_dam, 'get_redis', lambda: _RedisQueue())

    async def _raise_collect(_redis, *, prefix: str, now: datetime):
        raise RuntimeError('scan-failed')

    async def _counters(_session, *, now: datetime):
        return (1, 2, 3, 4, 5, {'queued': 2}, {'ingest': 1}, 33)

    monkeypatch.setattr(media_dam, '_collect_telemetry_workers', _raise_collect)
    monkeypatch.setattr(media_dam, '_telemetry_job_counters', _counters)

    telemetry = await media_dam.get_telemetry(_SessionStub())
    assert telemetry.queue_depth == 7
    assert telemetry.online_workers == 0
    assert telemetry.workers == []
    assert telemetry.dead_letter_count == 2


@pytest.mark.anyio('asyncio')
async def test_restore_and_purge_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _SessionStub()

    healthy = SimpleNamespace(status=MediaAssetStatus.approved)
    same = await media_dam.restore_asset(session, healthy, actor_id=None)
    assert same is healthy

    restored_asset = SimpleNamespace(
        id=uuid4(),
        status=MediaAssetStatus.trashed,
        trashed_at=datetime.now(timezone.utc),
        storage_key='trash/x.jpg',
        public_url='/media/trash/x.jpg',
        variants=[]
    )

    monkeypatch.setattr(media_dam, '_asset_file_path', lambda _asset: (_ for _ in ()).throw(RuntimeError('move error')))
    moved = {'variant': 0}
    monkeypatch.setattr(media_dam, '_move_variant_file_roots', lambda *_a, **_k: moved.__setitem__('variant', moved['variant'] + 1))

    out = await media_dam.restore_asset(session, restored_asset, actor_id=None)
    assert out.status == MediaAssetStatus.draft
    assert moved['variant'] == 1

    assets = [SimpleNamespace(id=uuid4()), SimpleNamespace(id=uuid4())]
    purge_calls: list[object] = []

    async def _fake_purge(_session, asset):
        purge_calls.append(asset)

    monkeypatch.setattr(media_dam, 'purge_asset', _fake_purge)
    purge_session = _SessionStub(execute_values=[assets])
    count = await media_dam.purge_expired_trash(purge_session)
    assert count == 2
    assert purge_calls == assets


@pytest.mark.anyio('asyncio')
async def test_rebuild_usage_edges_and_processing_helpers(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    now = datetime(2026, 3, 4, tzinfo=timezone.utc)
    monkeypatch.setattr(media_dam, '_now', lambda: now)

    refs = [
        ('content_block', 'page.about', '1', 'auto_scan', None),
        ('content_block', 'page.about', '1', 'auto_scan', None),
    ]

    async def _fake_collect(_session, _asset):
        return refs

    monkeypatch.setattr(media_dam, '_collect_usage_refs', _fake_collect)

    usage_rows = [
        SimpleNamespace(
            source_type='content_block',
            source_key='page.about',
            source_id='1',
            field_path='auto_scan',
            lang=None,
            last_seen_at=now,
        )
    ]
    usage_session = _SessionStub(execute_values=[[], usage_rows])
    asset = SimpleNamespace(id=uuid4(), public_url='/media/a.jpg')
    usage = await media_dam.rebuild_usage_edges(usage_session, asset, commit=False)
    assert usage_session.flushes == 1
    assert len(usage.items) == 1

    ingest_job = SimpleNamespace(asset_id=None)
    await media_dam._process_ingest_job(usage_session, ingest_job)

    ingest_asset = SimpleNamespace(id=uuid4(), public_url='/media/miss.jpg', asset_type=MediaAssetType.image, mime_type='image/jpeg')
    ingest_session = _SessionStub(scalar_values=[ingest_asset])
    monkeypatch.setattr(media_dam, '_asset_file_path', lambda _asset: tmp_path / 'missing.jpg')
    with pytest.raises(FileNotFoundError):
        await media_dam._process_ingest_job(ingest_session, SimpleNamespace(asset_id=ingest_asset.id))

    variant_session = _SessionStub(scalar_values=[ingest_asset])
    with pytest.raises(FileNotFoundError):
        await media_dam._process_variant_job(variant_session, SimpleNamespace(asset_id=ingest_asset.id, payload_json='{}'))

    await media_dam._process_variant_job(variant_session, SimpleNamespace(asset_id=None, payload_json='{}'))
    await media_dam._process_edit_job(variant_session, SimpleNamespace(asset_id=None, id=uuid4(), payload_json='{}'))

    with pytest.raises(FileNotFoundError):
        await media_dam._process_edit_job(
            _SessionStub(scalar_values=[ingest_asset]),
            SimpleNamespace(asset_id=ingest_asset.id, id=uuid4(), payload_json='{}')
        )


@pytest.mark.anyio('asyncio')
async def test_media_job_specialized_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    assert media_dam._crop_to_aspect(Image.new('RGB', (100, 100)), crop_w=None, crop_h=1).size == (100, 100)
    assert media_dam._crop_to_aspect(Image.new('RGB', (200, 100)), crop_w=1, crop_h=1).size == (100, 100)
    assert media_dam._crop_to_aspect(Image.new('RGB', (100, 200)), crop_w=1, crop_h=1).size == (100, 100)

    await media_dam._process_ai_tag_job(_SessionStub(), SimpleNamespace(asset_id=None))

    tagged_asset = SimpleNamespace(
        id=uuid4(),
        original_filename='Hero_Cover.JPG',
        width=300,
        height=500,
        tags=[]
    )
    ai_session = _SessionStub(scalar_values=[tagged_asset])
    captured_tags: list[str] = []

    async def _fake_replace_tags(_session, _asset, tags):
        captured_tags[:] = list(tags)

    monkeypatch.setattr(media_dam, '_replace_asset_tags', _fake_replace_tags)
    await media_dam._process_ai_tag_job(ai_session, SimpleNamespace(asset_id=tagged_asset.id))
    assert 'portrait' in captured_tags
    assert any(tag.startswith('hero') for tag in captured_tags)

    await media_dam._process_duplicate_scan_job(_SessionStub(), SimpleNamespace(asset_id=None))

    dup_asset = SimpleNamespace(id=uuid4(), checksum_sha256='a' * 64, dedupe_group=None)
    sibling = SimpleNamespace(id=uuid4(), dedupe_group=None)
    dup_session = _SessionStub(scalar_values=[dup_asset], execute_values=[[sibling]])
    await media_dam._process_duplicate_scan_job(dup_session, SimpleNamespace(asset_id=dup_asset.id))
    assert dup_asset.dedupe_group == 'a' * 16
    assert sibling.dedupe_group == 'a' * 16

    await media_dam._process_usage_reconcile_job(_SessionStub(execute_values=[[]]), SimpleNamespace(payload_json='{}', progress_pct=0))

    assets = [SimpleNamespace(id=uuid4()), SimpleNamespace(id=uuid4())]

    async def _no_commit(_session, _asset, *, commit):
        assert commit is False

    monkeypatch.setattr(media_dam, 'rebuild_usage_edges', _no_commit)
    usage_session = _SessionStub(execute_values=[assets])
    usage_job = SimpleNamespace(payload_json='{"limit": 2}', progress_pct=0)
    await media_dam._process_usage_reconcile_job(usage_session, usage_job)
    assert usage_job.progress_pct == 100
    assert usage_session.flushes == 2


@pytest.mark.anyio('asyncio')
async def test_retryability_bulk_retry_collection_and_public_asset_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    processing = SimpleNamespace(status=MediaJobStatus.processing, attempt=0, max_attempts=3)
    failed = SimpleNamespace(status=MediaJobStatus.failed, attempt=1, max_attempts=3)
    exhausted = SimpleNamespace(status=MediaJobStatus.failed, attempt=3, max_attempts=3)
    dead_letter = SimpleNamespace(status=MediaJobStatus.dead_letter, attempt=7, max_attempts=3)

    assert media_dam._is_retryable_job(processing) is False
    assert media_dam._is_retryable_job(failed) is True
    assert media_dam._is_retryable_job(exhausted) is False
    assert media_dam._is_retryable_job(dead_letter) is True

    retriable = SimpleNamespace(
        id=uuid4(),
        status=MediaJobStatus.dead_letter,
        progress_pct=90,
        error_code='x',
        error_message='y',
        next_retry_at=datetime.now(timezone.utc),
        started_at=datetime.now(timezone.utc),
        completed_at=datetime.now(timezone.utc),
        dead_lettered_at=datetime.now(timezone.utc),
        triage_state='open',
        attempt=5,
        max_attempts=3,
    )
    skipped = SimpleNamespace(
        id=uuid4(),
        status=MediaJobStatus.processing,
        progress_pct=20,
        error_code=None,
        error_message=None,
        next_retry_at=None,
        started_at=None,
        completed_at=None,
        dead_lettered_at=None,
        triage_state='open',
        attempt=0,
        max_attempts=3,
    )

    events: list[str] = []
    queued: list[str] = []

    async def _record_event(_session, *, job, actor_user_id, action, meta):
        events.append(f'{action}:{job.id}')

    async def _queue_job(job_id):
        queued.append(str(job_id))

    monkeypatch.setattr(media_dam, '_record_job_event', _record_event)
    monkeypatch.setattr(media_dam, '_maybe_queue_job', _queue_job)

    retry_session = _SessionStub(execute_values=[[retriable, skipped]])
    retried = await media_dam.bulk_retry_jobs(
        retry_session,
        job_ids=[retriable.id, skipped.id],
        actor_user_id=None,
    )
    assert retried == [retriable]
    assert retry_session.commits == 1
    assert len(retry_session.refreshed) == 1
    assert queued == [str(retriable.id)]
    assert any(event.startswith('bulk_retry:') for event in events)

    payload = SimpleNamespace(name=' Gallery ', slug=' HERO-Gallery ', visibility='private')
    collection_session = _SessionStub(scalar_values=[2])
    collection_read = await media_dam.upsert_collection(
        collection_session,
        collection_id=None,
        payload=payload,
        actor_id=uuid4(),
    )
    assert collection_read.slug == 'hero-gallery'
    assert collection_read.item_count == 2

    private_asset = SimpleNamespace(visibility=MediaVisibility.private, status=MediaAssetStatus.approved)
    rejected_asset = SimpleNamespace(visibility=MediaVisibility.public, status=MediaAssetStatus.rejected)
    ok_asset = SimpleNamespace(visibility=MediaVisibility.public, status=MediaAssetStatus.archived)

    assert await media_dam.ensure_public_asset(_SessionStub(scalar_values=[None]), uuid4()) is None
    assert await media_dam.ensure_public_asset(_SessionStub(scalar_values=[private_asset]), uuid4()) is None
    assert await media_dam.ensure_public_asset(_SessionStub(scalar_values=[rejected_asset]), uuid4()) is None
    assert await media_dam.ensure_public_asset(_SessionStub(scalar_values=[ok_asset]), uuid4()) is ok_asset


@pytest.mark.anyio('asyncio')
async def test_rollback_retry_policy_creates_row_and_returns_updated_read(monkeypatch: pytest.MonkeyPatch) -> None:
    parsed = MediaJobType.ingest
    before = media_dam.RetryPolicyResolved(max_attempts=2, schedule=[30], jitter_ratio=0.1, enabled=True, version_ts='old')
    target = media_dam.RetryPolicyResolved(max_attempts=3, schedule=[60], jitter_ratio=0.2, enabled=True, version_ts='new')

    session = _SessionStub(scalar_values=[None])

    monkeypatch.setattr(media_dam, '_parse_job_type', lambda _value: parsed)
    monkeypatch.setattr(media_dam, '_policy_row_to_resolved', lambda _row, *, job_type: before if _row is None else target)

    async def _resolve(_session, *, parsed_job_type, payload):
        return target, 'known_good'

    events: list[str] = []

    async def _record(_session, **kwargs):
        events.append(kwargs['action'])

    monkeypatch.setattr(media_dam, '_resolve_rollback_target_policy', _resolve)
    monkeypatch.setattr(media_dam, '_record_retry_policy_event', _record)

    payload = SimpleNamespace(event_id=None, preset_key='known_good', note='rollback')
    read = await media_dam.rollback_retry_policy(session, job_type='ingest', payload=payload, actor_user_id=None)

    assert read.job_type == 'ingest'
    assert read.max_attempts == 3
    assert 'rollback' in events
