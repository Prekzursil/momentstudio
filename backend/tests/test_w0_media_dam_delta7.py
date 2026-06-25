"""Worker-0 seventh (final) coverage delta for ``app.services.media_dam``.

Targets the precise *negative-direction* arcs the happy-path deltas left open:
the no-clause ``list_assets`` path, kept/reused tag arcs in ``_replace_asset_tags``,
the sync telemetry scan completing without a break, the purge resolve/unlink
exception arcs, the edit no-crop path, and the queue-age / avg-processing
telemetry branches (exercised with a naive clock to match SQLite storage).
"""

from __future__ import annotations

import datetime as dt
import json
import uuid

import pytest
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.db.base import Base
from app.models.media import (
    MediaAsset,
    MediaAssetStatus,
    MediaAssetTag,
    MediaAssetType,
    MediaJob,
    MediaJobStatus,
    MediaJobType,
    MediaTag,
    MediaVariant,
    MediaVisibility,
)
from app.services import media_dam as md


def _make_local() -> tuple[object, async_sessionmaker]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    return engine, async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False, autoflush=False
    )


async def _init(engine) -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


@pytest.fixture
def media_roots(tmp_path, monkeypatch):
    public = tmp_path / "public"
    private = tmp_path / "private"
    public.mkdir()
    private.mkdir()
    monkeypatch.setattr(md, "_public_media_root", lambda: public)
    monkeypatch.setattr(md, "_private_media_root", lambda: private)
    return public, private


def _img(path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (12, 12), (5, 6, 7)).save(path, format="JPEG")


# --------------------------------------------------------------------------- #
# list_assets with NO clauses (include_trashed=True, no filters)
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_list_assets_no_clauses(media_roots) -> None:
    engine, Session = _make_local()
    await _init(engine)
    async with Session() as session:
        rows, counts = await md.list_assets(
            session, md.MediaListFilters(include_trashed=True)
        )
        assert isinstance(rows, list)
        assert "total_items" in counts


# --------------------------------------------------------------------------- #
# _replace_asset_tags: kept tag (no delete) + reused existing MediaTag row
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_replace_asset_tags_keeps_and_reuses(media_roots) -> None:
    engine, Session = _make_local()
    await _init(engine)
    asset_id = uuid.uuid4()
    async with Session() as session:
        asset = MediaAsset(
            id=asset_id,
            asset_type=MediaAssetType.image,
            status=MediaAssetStatus.draft,
            visibility=MediaVisibility.private,
            storage_key="originals/kr.jpg",
            public_url="/media/originals/kr.jpg",
        )
        session.add(asset)
        await session.flush()
        keep_tag = MediaTag(id=uuid.uuid4(), value="keep")
        # An orphan tag row that exists but is not linked to this asset.
        MediaTag_orphan = MediaTag(id=uuid.uuid4(), value="orphan")
        session.add_all([keep_tag, MediaTag_orphan])
        await session.flush()
        session.add(MediaAssetTag(asset_id=asset_id, tag_id=keep_tag.id))
        await session.commit()

    async with Session() as session:
        asset = await md.get_asset_or_404(session, asset_id)
        # "keep" already on asset -> kept (delete-loop false arc + ``in existing``
        # continue); "orphan" exists as a row -> ``tag is None`` false (reuse).
        await md._replace_asset_tags(session, asset, ["keep", "orphan"])
        await session.commit()

    async with Session() as session:
        asset = await md.get_asset_or_404(session, asset_id)
        assert sorted(md.asset_to_read(asset).tags) == ["keep", "orphan"]


# --------------------------------------------------------------------------- #
# sync telemetry scan completing without a break
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_get_telemetry_sync_scan_no_break(media_roots, monkeypatch) -> None:
    engine, Session = _make_local()
    await _init(engine)
    prefix = "media:workers:heartbeat:nb"
    monkeypatch.setattr(settings, "media_dam_worker_heartbeat_prefix", prefix)
    monkeypatch.setattr(settings, "media_dam_telemetry_heartbeat_scan_limit", 100)
    now = md._now()

    class FakeRedis:
        def __init__(self) -> None:
            self.payloads = {
                f"{prefix}:a": json.dumps(
                    {"worker_id": "a", "last_seen_at": now.isoformat()}
                ),
            }

        def llen(self, key):
            return 0

        def scan_iter(self, *, match):
            # Sync generator -> the ``else`` for-loop path; limit high -> no break.
            for key in sorted(self.payloads):
                yield key

        def get(self, key):
            return self.payloads.get(key)

    monkeypatch.setattr(md, "get_redis", lambda: FakeRedis())
    async with Session() as session:
        resp = await md.get_telemetry(session)
        assert resp.online_workers == 1


# --------------------------------------------------------------------------- #
# purge: variant resolve raises (continue) + unlink raises (logged) + absent
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_purge_variant_resolve_and_unlink_failures(
    media_roots, monkeypatch
) -> None:
    engine, Session = _make_local()
    await _init(engine)
    asset_id = uuid.uuid4()
    async with Session() as session:
        asset = MediaAsset(
            id=asset_id,
            asset_type=MediaAssetType.image,
            status=MediaAssetStatus.trashed,
            visibility=MediaVisibility.private,
            storage_key="trash/pv.jpg",
            public_url="/media/trash/pv.jpg",
            trashed_at=md._now(),
        )
        _img(__import__("pathlib").Path(media_roots[1]) / "trash" / "pv.jpg")
        session.add(asset)
        await session.flush()
        session.add_all(
            [
                MediaVariant(
                    id=uuid.uuid4(),
                    asset_id=asset_id,
                    profile="a",
                    format="jpeg",
                    storage_key="variants/pv/a.jpg",
                    public_url="/media/variants/pv/a.jpg",
                ),
                MediaVariant(
                    id=uuid.uuid4(),
                    asset_id=asset_id,
                    profile="b",
                    format="jpeg",
                    storage_key="variants/pv/b.jpg",
                    public_url="/media/variants/pv/b.jpg",
                ),
            ]
        )
        await session.commit()

    calls = {"n": 0}
    real_resolve = md._find_existing_storage_path

    def _resolve(key):
        # First variant resolution raises (continue arc); primary + second resolve
        # normally so the unlink loop still has a path to process.
        if key == "variants/pv/a.jpg":
            calls["n"] += 1
            raise OSError("resolve boom")
        return real_resolve(key)

    async with Session() as session:
        asset = await md.get_asset_or_404(session, asset_id)
        monkeypatch.setattr(md, "_find_existing_storage_path", _resolve)

        # Make unlink raise for the primary file so the unlink ``except`` arc runs.
        from pathlib import Path as _P

        real_unlink = _P.unlink

        def _unlink(self, *a, **k):
            if self.name == "pv.jpg":
                raise OSError("unlink boom")
            return real_unlink(self, *a, **k)

        monkeypatch.setattr(_P, "unlink", _unlink)
        await md.purge_asset(session, asset)
        assert calls["n"] == 1


@pytest.mark.anyio
async def test_purge_path_absent_at_unlink(media_roots, monkeypatch) -> None:
    """A resolved path that no longer exists at unlink -> ``p.exists()`` false arc."""
    from pathlib import Path as _P

    engine, Session = _make_local()
    await _init(engine)
    asset_id = uuid.uuid4()
    async with Session() as session:
        asset = MediaAsset(
            id=asset_id,
            asset_type=MediaAssetType.image,
            status=MediaAssetStatus.trashed,
            visibility=MediaVisibility.private,
            storage_key="trash/ghost.jpg",
            public_url="/media/trash/ghost.jpg",
            trashed_at=md._now(),
        )
        session.add(asset)
        await session.commit()

    # Resolve returns a path that does not exist on disk.
    ghost = _P(media_roots[1]) / "trash" / "ghost.jpg"
    monkeypatch.setattr(md, "_find_existing_storage_path", lambda key: ghost)
    async with Session() as session:
        asset = await md.get_asset_or_404(session, asset_id)
        assert not ghost.exists()
        await md.purge_asset(session, asset)


# --------------------------------------------------------------------------- #
# edit with rotate + resize but NO crop (``crop_w and crop_h`` false arc)
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_process_edit_no_crop_with_resize(media_roots) -> None:
    public, private = media_roots
    engine, Session = _make_local()
    await _init(engine)
    asset_id = uuid.uuid4()
    async with Session() as session:
        asset = MediaAsset(
            id=asset_id,
            asset_type=MediaAssetType.image,
            status=MediaAssetStatus.draft,
            visibility=MediaVisibility.private,
            storage_key="originals/nc.jpg",
            public_url="/media/originals/nc.jpg",
        )
        _img(private / "originals" / "nc.jpg")
        session.add(asset)
        await session.commit()
        job = MediaJob(
            id=uuid.uuid4(),
            job_type=MediaJobType.edit,
            status=MediaJobStatus.queued,
            asset_id=asset_id,
            payload_json=json.dumps({"rotate_cw": 180, "resize_max_width": 8}),
        )
        await md._process_edit_job(session, job)
        await session.commit()


# --------------------------------------------------------------------------- #
# telemetry queue-age + avg-processing (naive clock matches SQLite storage)
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_get_telemetry_queue_age_and_avg(media_roots, monkeypatch) -> None:
    engine, Session = _make_local()
    await _init(engine)

    fixed = dt.datetime(2030, 1, 1, 12, 0, 0)  # naive UTC, matches SQLite reads

    monkeypatch.setattr(md, "_now", lambda: fixed)
    monkeypatch.setattr(md, "get_redis", lambda: None)

    async with Session() as session:
        queued = MediaJob(
            id=uuid.uuid4(),
            job_type=MediaJobType.ingest,
            status=MediaJobStatus.queued,
            created_at=fixed - dt.timedelta(minutes=5),
        )
        done = MediaJob(
            id=uuid.uuid4(),
            job_type=MediaJobType.ingest,
            status=MediaJobStatus.completed,
            created_at=fixed - dt.timedelta(hours=1),
            started_at=fixed - dt.timedelta(minutes=10),
            completed_at=fixed - dt.timedelta(minutes=8),
        )
        session.add_all([queued, done])
        await session.commit()

        resp = await md.get_telemetry(session)
        assert resp.oldest_queued_age_seconds == 300
        assert resp.avg_processing_seconds == 120
