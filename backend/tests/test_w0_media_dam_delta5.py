"""Worker-0 fifth coverage delta for ``app.services.media_dam``.

Final reachable-branch pass: change_status status variants (approve without
actor, trash), soft-delete / restore file-move success arcs, purge variant
unlink, existing-tag link reuse, the telemetry scan-limit break, the usage
translation/social refs, and bulk-retry's already-retrying triage arc.
"""

from __future__ import annotations

import json
import uuid

import pytest
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.db.base import Base
from app.models.content import ContentBlock, ContentBlockTranslation
from app.models.media import (
    MediaAsset,
    MediaAssetStatus,
    MediaAssetType,
    MediaJob,
    MediaJobStatus,
    MediaJobTag,
    MediaJobType,
    MediaVariant,
    MediaVisibility,
)
from app.services import media_dam as md

UTC = md.timezone.utc


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
# change_status variants
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_change_status_to_draft_without_approval(media_roots) -> None:
    engine, Session = _make_local()
    await _init(engine)
    async with Session() as session:
        asset = MediaAsset(
            id=uuid.uuid4(),
            asset_type=MediaAssetType.image,
            status=MediaAssetStatus.rejected,
            visibility=MediaVisibility.private,
            storage_key="originals/d.jpg",
            public_url="/media/originals/d.jpg",
        )
        session.add(asset)
        await session.commit()
        await session.refresh(asset)
        # to_status != approved (skip approved block) and != trashed (clear trash).
        updated = await md.change_status(
            session,
            asset=asset,
            to_status=MediaAssetStatus.draft,
            actor_id=None,
            set_approved_actor=False,
        )
        assert updated.status == MediaAssetStatus.draft


@pytest.mark.anyio
async def test_change_status_approve_without_actor(media_roots) -> None:
    engine, Session = _make_local()
    await _init(engine)
    async with Session() as session:
        asset = MediaAsset(
            id=uuid.uuid4(),
            asset_type=MediaAssetType.image,
            status=MediaAssetStatus.rejected,
            visibility=MediaVisibility.private,
            storage_key="originals/a.jpg",
            public_url="/media/originals/a.jpg",
        )
        session.add(asset)
        await session.commit()
        await session.refresh(asset)
        # approved branch true, set_approved_actor false -> inner if skipped.
        updated = await md.change_status(
            session,
            asset=asset,
            to_status=MediaAssetStatus.approved,
            actor_id=uuid.uuid4(),
            set_approved_actor=False,
        )
        assert updated.approved_at is not None
        assert updated.approved_by_user_id is None


@pytest.mark.anyio
async def test_change_status_to_trashed_keeps_trashed_at(media_roots) -> None:
    engine, Session = _make_local()
    await _init(engine)
    async with Session() as session:
        asset = MediaAsset(
            id=uuid.uuid4(),
            asset_type=MediaAssetType.image,
            status=MediaAssetStatus.draft,
            visibility=MediaVisibility.private,
            storage_key="originals/t.jpg",
            public_url="/media/originals/t.jpg",
        )
        session.add(asset)
        await session.commit()
        await session.refresh(asset)
        # to_status == trashed -> the ``!= trashed`` guard takes the false arc.
        updated = await md.change_status(
            session,
            asset=asset,
            to_status=MediaAssetStatus.trashed,
            actor_id=None,
        )
        assert updated.status == MediaAssetStatus.trashed


# --------------------------------------------------------------------------- #
# soft-delete / restore: file present -> move-success arc
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_soft_delete_moves_present_file(media_roots) -> None:
    public, private = media_roots
    engine, Session = _make_local()
    await _init(engine)
    async with Session() as session:
        asset = MediaAsset(
            id=uuid.uuid4(),
            asset_type=MediaAssetType.image,
            status=MediaAssetStatus.draft,
            visibility=MediaVisibility.private,
            storage_key="originals/present.jpg",
            public_url="/media/originals/present.jpg",
        )
        # Private+draft -> not publicly servable -> file lives in private root.
        _img(private / "originals" / "present.jpg")
        session.add(asset)
        await session.commit()
        await session.refresh(asset)
        trashed = await md.soft_delete_asset(session, asset, actor_id=None)
        assert trashed.storage_key.startswith("trash/")
        assert (private / trashed.storage_key).exists()

        restored = await md.restore_asset(session, trashed, actor_id=None)
        assert restored.storage_key.startswith("originals/")
        assert (private / restored.storage_key).exists()


# --------------------------------------------------------------------------- #
# purge: variant file present -> unlink arc
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_purge_asset_unlinks_present_files(media_roots) -> None:
    public, private = media_roots
    engine, Session = _make_local()
    await _init(engine)
    asset_id = uuid.uuid4()
    async with Session() as session:
        asset = MediaAsset(
            id=asset_id,
            asset_type=MediaAssetType.image,
            status=MediaAssetStatus.trashed,
            visibility=MediaVisibility.private,
            storage_key="trash/purge.jpg",
            public_url="/media/trash/purge.jpg",
            trashed_at=md._now(),
        )
        _img(private / "trash" / "purge.jpg")
        session.add(asset)
        await session.flush()
        variant = MediaVariant(
            id=uuid.uuid4(),
            asset_id=asset_id,
            profile="web-1280",
            format="jpeg",
            storage_key="variants/purge/web.jpg",
            public_url="/media/variants/purge/web.jpg",
        )
        _img(private / "variants" / "purge" / "web.jpg")
        session.add(variant)
        await session.commit()

    async with Session() as session:
        asset = await md.get_asset_or_404(session, asset_id)
        await md.purge_asset(session, asset)
        assert not (private / "trash" / "purge.jpg").exists()
        assert not (private / "variants" / "purge" / "web.jpg").exists()


# --------------------------------------------------------------------------- #
# existing MediaJobTag re-used when linking
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_apply_job_tag_changes_reuses_existing_tag_row(media_roots) -> None:
    engine, Session = _make_local()
    await _init(engine)
    job_id = uuid.uuid4()
    async with Session() as session:
        job = MediaJob(
            id=job_id,
            job_type=MediaJobType.ingest,
            status=MediaJobStatus.failed,
            payload_json="{}",
        )
        session.add(job)
        # A MediaJobTag that exists but is NOT linked to this job -> the
        # ``tag is None`` guard takes the false (reuse) arc.
        session.add(MediaJobTag(id=uuid.uuid4(), value="shared"))
        await session.commit()

    async with Session() as session:
        job = await md.get_job_or_404(session, job_id)
        await md._apply_job_tag_changes(session, job=job, add_tags=["shared"])
        await session.commit()

    async with Session() as session:
        job = await md.get_job_or_404(session, job_id)
        assert md.job_to_read(job).tags == ["shared"]


# --------------------------------------------------------------------------- #
# telemetry scan-limit break
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_get_telemetry_scan_limit_break(media_roots, monkeypatch) -> None:
    engine, Session = _make_local()
    await _init(engine)
    prefix = "media:workers:heartbeat:lim"
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
            for key in sorted(self.payloads):
                yield key

        def get(self, key):
            return self.payloads.get(key)

    monkeypatch.setattr(md, "get_redis", lambda: FakeRedis())
    async with Session() as session:
        resp = await md.get_telemetry(session)
        # scan_limit=1 -> only the first key consumed.
        assert resp.online_workers == 1


# --------------------------------------------------------------------------- #
# usage refs: content-translation + site.social
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_collect_usage_refs_translation_and_social(media_roots) -> None:
    engine, Session = _make_local()
    await _init(engine)
    asset_id = uuid.uuid4()
    url = "/media/originals/social.jpg"
    async with Session() as session:
        asset = MediaAsset(
            id=asset_id,
            asset_type=MediaAssetType.image,
            status=MediaAssetStatus.draft,
            visibility=MediaVisibility.private,
            storage_key="originals/social.jpg",
            public_url=url,
        )
        session.add(asset)

        block = ContentBlock(
            id=uuid.uuid4(),
            key="some.block",
            title="B",
            body_markdown="x",
        )
        session.add(block)
        await session.flush()
        session.add(
            ContentBlockTranslation(
                id=uuid.uuid4(),
                content_block_id=block.id,
                lang="en",
                title="t",
                body_markdown=f"see {url} here",
            )
        )

        social = ContentBlock(
            id=uuid.uuid4(),
            key="site.social",
            title="Social",
            body_markdown=f"icon {url}",
        )
        session.add(social)
        await session.commit()

    async with Session() as session:
        asset = await md.get_asset_or_404(session, asset_id)
        resp = await md.rebuild_usage_edges(session, asset, commit=True)
        source_types = {item.source_type for item in resp.items}
        assert "content_translation" in source_types
        assert "site_social" in source_types


# --------------------------------------------------------------------------- #
# bulk_retry: triage already "retrying" -> skip transition arc
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_bulk_retry_jobs_triage_already_retrying(media_roots) -> None:
    engine, Session = _make_local()
    await _init(engine)
    job_id = uuid.uuid4()
    async with Session() as session:
        job = MediaJob(
            id=job_id,
            job_type=MediaJobType.ingest,
            status=MediaJobStatus.dead_letter,
            attempt=5,
            max_attempts=5,
            triage_state="retrying",
            payload_json="{}",
        )
        session.add(job)
        await session.commit()

    async with Session() as session:
        retried = await md.bulk_retry_jobs(
            session, job_ids=[job_id], actor_user_id=None
        )
        assert len(retried) == 1
        # triage was already "retrying" -> the ``in {...}`` guard false arc.
        assert retried[0].triage_state == "retrying"
