"""Worker-0 sixth coverage delta for ``app.services.media_dam``.

Mops up the last reachable branch arcs: the async telemetry scan-limit break,
non-image ingest, variant re-processing (existing row), the edit equal-ratio
crop skip, and the soft-delete / restore file-absent arcs.
"""

from __future__ import annotations

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
    MediaAssetType,
    MediaJob,
    MediaJobStatus,
    MediaJobType,
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


def _img(path, size=(12, 12)) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, (5, 6, 7)).save(path, format="JPEG")


# --------------------------------------------------------------------------- #
# async telemetry scan-limit break
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_get_telemetry_async_scan_limit_break(media_roots, monkeypatch) -> None:
    engine, Session = _make_local()
    await _init(engine)
    prefix = "media:workers:heartbeat:async"
    monkeypatch.setattr(settings, "media_dam_worker_heartbeat_prefix", prefix)
    monkeypatch.setattr(settings, "media_dam_telemetry_heartbeat_scan_limit", 1)
    now = md._now()

    class FakeRedis:
        def __init__(self) -> None:
            self.payloads = {
                f"{prefix}:a": json.dumps(
                    {"worker_id": "a", "last_seen_at": now.isoformat()}
                ),
                f"{prefix}:b": json.dumps(
                    {"worker_id": "b", "last_seen_at": now.isoformat()}
                ),
            }

        def llen(self, key):
            return 0

        def scan_iter(self, *, match):
            async def _aiter():
                for key in sorted(self.payloads):
                    yield key

            return _aiter()

        def get(self, key):
            return self.payloads.get(key)

    monkeypatch.setattr(md, "get_redis", lambda: FakeRedis())
    async with Session() as session:
        resp = await md.get_telemetry(session)
        # async scan, scan_limit=1 -> break after the first key.
        assert resp.online_workers == 1


# --------------------------------------------------------------------------- #
# non-image ingest (skips width/height assignment)
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_process_ingest_non_image(media_roots) -> None:
    public, private = media_roots
    engine, Session = _make_local()
    await _init(engine)
    asset_id = uuid.uuid4()
    async with Session() as session:
        asset = MediaAsset(
            id=asset_id,
            asset_type=MediaAssetType.document,
            status=MediaAssetStatus.draft,
            visibility=MediaVisibility.private,
            storage_key="originals/doc.pdf",
            public_url="/media/originals/doc.pdf",
        )
        path = private / "originals" / "doc.pdf"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"%PDF-1.4 fake")
        session.add(asset)
        await session.commit()
        job = MediaJob(
            id=uuid.uuid4(),
            job_type=MediaJobType.ingest,
            status=MediaJobStatus.queued,
            asset_id=asset_id,
            payload_json="{}",
        )
        await md._process_ingest_job(session, job)
        await session.commit()
        await session.refresh(asset)
        assert asset.checksum_sha256


# --------------------------------------------------------------------------- #
# variant re-processing (existing row updated, not created)
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_process_variant_updates_existing_row(media_roots) -> None:
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
            storage_key="originals/v.jpg",
            public_url="/media/originals/v.jpg",
        )
        _img(private / "originals" / "v.jpg", size=(60, 40))
        session.add(asset)
        await session.flush()
        # Pre-existing variant row for the same profile -> ``row is None`` false.
        session.add(
            MediaVariant(
                id=uuid.uuid4(),
                asset_id=asset_id,
                profile="web-1280",
                format="jpeg",
                storage_key="variants/v/web-1280.jpg",
                public_url="/media/variants/v/web-1280.jpg",
            )
        )
        await session.commit()
        job = MediaJob(
            id=uuid.uuid4(),
            job_type=MediaJobType.variant,
            status=MediaJobStatus.queued,
            asset_id=asset_id,
            payload_json=json.dumps({"profile": "web-1280"}),
        )
        await md._process_variant_job(session, job)
        await session.commit()


# --------------------------------------------------------------------------- #
# edit equal-ratio crop (neither wide nor tall branch)
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_process_edit_equal_ratio_crop(media_roots) -> None:
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
            storage_key="originals/sq.jpg",
            public_url="/media/originals/sq.jpg",
        )
        # Square image + 1:1 crop -> current_ratio == target_ratio -> both crop
        # sub-branches skipped.
        _img(private / "originals" / "sq.jpg", size=(40, 40))
        session.add(asset)
        await session.commit()
        job = MediaJob(
            id=uuid.uuid4(),
            job_type=MediaJobType.edit,
            status=MediaJobStatus.queued,
            asset_id=asset_id,
            payload_json=json.dumps({"crop_aspect_w": 1, "crop_aspect_h": 1}),
        )
        await md._process_edit_job(session, job)
        await session.commit()


# --------------------------------------------------------------------------- #
# soft-delete / restore when the file is ABSENT (exists() false arc)
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_soft_delete_and_restore_file_absent(media_roots) -> None:
    engine, Session = _make_local()
    await _init(engine)
    async with Session() as session:
        asset = MediaAsset(
            id=uuid.uuid4(),
            asset_type=MediaAssetType.image,
            status=MediaAssetStatus.draft,
            visibility=MediaVisibility.private,
            storage_key="originals/absent.jpg",
            public_url="/media/originals/absent.jpg",
        )
        # No file on disk -> _asset_file_path returns the expected path, which
        # does not exist -> the ``if old_path.exists()`` guard takes the false arc
        # (no move, storage_key unchanged) for both soft-delete and restore.
        session.add(asset)
        await session.commit()
        await session.refresh(asset)

        trashed = await md.soft_delete_asset(session, asset, actor_id=None)
        assert trashed.status == MediaAssetStatus.trashed
        # storage_key stays the original because nothing was moved.
        assert trashed.storage_key == "originals/absent.jpg"

        restored = await md.restore_asset(session, trashed, actor_id=None)
        assert restored.status == MediaAssetStatus.draft
        assert restored.storage_key == "originals/absent.jpg"


# --------------------------------------------------------------------------- #
# _replace_asset_tags creating a brand-new MediaTag row
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_replace_asset_tags_creates_new_tag(media_roots) -> None:
    engine, Session = _make_local()
    await _init(engine)
    asset_id = uuid.uuid4()
    async with Session() as session:
        asset = MediaAsset(
            id=asset_id,
            asset_type=MediaAssetType.image,
            status=MediaAssetStatus.draft,
            visibility=MediaVisibility.private,
            storage_key="originals/nt.jpg",
            public_url="/media/originals/nt.jpg",
        )
        session.add(asset)
        await session.commit()

    async with Session() as session:
        asset = await md.get_asset_or_404(session, asset_id)
        await md._replace_asset_tags(session, asset, ["freshtag"])
        await session.commit()

    async with Session() as session:
        asset = await md.get_asset_or_404(session, asset_id)
        assert md.asset_to_read(asset).tags == ["freshtag"]
