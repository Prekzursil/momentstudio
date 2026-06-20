"""Worker-0 fourth coverage delta for ``app.services.media_dam``.

Closes the final reachable branch arcs: list/history filter-less paths, the
``list_assets`` sort variants, the inline job-processing dispatch + retry-policy
seeding, ai-tag without dimensions, and ``bulk_retry_jobs`` triage transition.
"""

from __future__ import annotations

import uuid

import pytest
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.media import (
    MediaAsset,
    MediaAssetStatus,
    MediaAssetType,
    MediaJob,
    MediaJobStatus,
    MediaJobType,
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


# --------------------------------------------------------------------------- #
# filter-less list/history paths + list_assets sort variants
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_list_retry_policy_history_no_filter(media_roots) -> None:
    engine, Session = _make_local()
    await _init(engine)
    async with Session() as session:
        # No job_type -> the ``if clauses`` guard takes the false arc.
        rows, counts = await md.list_retry_policy_history(session)
        assert counts["total_items"] == 0


@pytest.mark.anyio
async def test_list_assets_sort_variants_and_empty_tag(media_roots) -> None:
    engine, Session = _make_local()
    await _init(engine)
    async with Session() as session:
        asset = MediaAsset(
            id=uuid.uuid4(),
            asset_type=MediaAssetType.image,
            status=MediaAssetStatus.draft,
            visibility=MediaVisibility.private,
            storage_key="originals/s.jpg",
            public_url="/media/originals/s.jpg",
            original_filename="s.jpg",
        )
        session.add(asset)
        await session.commit()
        for sort in ("newest", "oldest", "name_asc", "name_desc", "unknown"):
            rows, counts = await md.list_assets(session, md.MediaListFilters(sort=sort))
            assert isinstance(rows, list)
        # tag that normalizes to empty -> inner guard false arc.
        rows, _ = await md.list_assets(session, md.MediaListFilters(tag="   "))
        assert isinstance(rows, list)


@pytest.mark.anyio
async def test_list_jobs_empty_tag(media_roots) -> None:
    engine, Session = _make_local()
    await _init(engine)
    async with Session() as session:
        rows, _ = await md.list_jobs(session, md.MediaJobListFilters(tag="   "))
        assert isinstance(rows, list)


# --------------------------------------------------------------------------- #
# process_job_inline dispatch + retry-policy snapshot seeding
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_process_job_inline_ingest_completes(media_roots) -> None:
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
            storage_key="originals/inline.jpg",
            public_url="/media/originals/inline.jpg",
            original_filename="inline.jpg",
        )
        path = private / "originals" / "inline.jpg"
        path.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (10, 10), (1, 2, 3)).save(path, format="JPEG")
        session.add(asset)
        await session.commit()

        job = MediaJob(
            id=uuid.uuid4(),
            job_type=MediaJobType.ingest,
            status=MediaJobStatus.queued,
            asset_id=asset_id,
            attempt=0,
            max_attempts=0,
            payload_json="{}",
        )
        session.add(job)
        await session.commit()
        result = await md.process_job_inline(session, job)
        assert result.status == MediaJobStatus.completed
        assert result.triage_state == "resolved"


@pytest.mark.anyio
async def test_process_job_inline_usage_reconcile_branch(media_roots) -> None:
    engine, Session = _make_local()
    await _init(engine)
    asset_id = uuid.uuid4()
    async with Session() as session:
        asset = MediaAsset(
            id=asset_id,
            asset_type=MediaAssetType.image,
            status=MediaAssetStatus.draft,
            visibility=MediaVisibility.private,
            storage_key="originals/ur.jpg",
            public_url="/media/originals/ur.jpg",
        )
        session.add(asset)
        job = MediaJob(
            id=uuid.uuid4(),
            job_type=MediaJobType.usage_reconcile,
            status=MediaJobStatus.queued,
            asset_id=asset_id,
            attempt=0,
            max_attempts=0,
            payload_json="{}",
        )
        session.add(job)
        await session.commit()
        result = await md.process_job_inline(session, job)
        assert result.status == MediaJobStatus.completed


# --------------------------------------------------------------------------- #
# ai_tag without dimensions (skips landscape/portrait branch)
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_process_ai_tag_no_dimensions(media_roots) -> None:
    engine, Session = _make_local()
    await _init(engine)
    asset_id = uuid.uuid4()
    async with Session() as session:
        asset = MediaAsset(
            id=asset_id,
            asset_type=MediaAssetType.image,
            status=MediaAssetStatus.draft,
            visibility=MediaVisibility.private,
            storage_key="originals/nd.jpg",
            public_url="/media/originals/nd.jpg",
            original_filename="seaside_view.jpg",
            width=None,
            height=None,
        )
        session.add(asset)
        await session.commit()
        job = MediaJob(
            id=uuid.uuid4(),
            job_type=MediaJobType.ai_tag,
            status=MediaJobStatus.queued,
            asset_id=asset_id,
            payload_json="{}",
        )
        await md._process_ai_tag_job(session, job)
        await session.commit()
        await session.refresh(asset)
        tags = md.asset_to_read(asset).tags
        assert "seaside" in tags
        assert "landscape" not in tags and "portrait" not in tags


# --------------------------------------------------------------------------- #
# bulk_retry_jobs triage transition (open/ignored/resolved -> retrying)
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_bulk_retry_jobs_transitions_triage(media_roots) -> None:
    engine, Session = _make_local()
    await _init(engine)
    job_id = uuid.uuid4()
    async with Session() as session:
        job = MediaJob(
            id=job_id,
            job_type=MediaJobType.ingest,
            status=MediaJobStatus.failed,
            attempt=1,
            max_attempts=5,
            triage_state="open",
            payload_json="{}",
        )
        session.add(job)
        await session.commit()

    async with Session() as session:
        retried = await md.bulk_retry_jobs(
            session, job_ids=[job_id], actor_user_id=None
        )
        assert len(retried) == 1
        assert retried[0].status == MediaJobStatus.queued
        assert retried[0].triage_state == "retrying"


# --------------------------------------------------------------------------- #
# tag-change: add a tag the job already has (skip arc)
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_apply_job_tag_changes_add_existing_is_skipped(media_roots) -> None:
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
        await session.commit()

    async with Session() as session:
        job = await md.get_job_or_404(session, job_id)
        await md._apply_job_tag_changes(session, job=job, add_tags=["dup"])
        await session.commit()

    async with Session() as session:
        job = await md.get_job_or_404(session, job_id)
        # Adding "dup" again must hit the ``value in existing_by_value`` skip.
        await md._apply_job_tag_changes(session, job=job, add_tags=["dup"])
        await session.commit()

    async with Session() as session:
        job = await md.get_job_or_404(session, job_id)
        assert md.job_to_read(job).tags == ["dup"]


# --------------------------------------------------------------------------- #
# create_asset temp == target (no move) via storage stub
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_create_asset_from_upload_temp_equals_target(
    media_roots, monkeypatch
) -> None:
    public, private = media_roots
    engine, Session = _make_local()
    await _init(engine)

    class _UploadFile:
        filename = "pic.jpg"
        content_type = "image/jpeg"

    captured: dict = {}

    def _fake_save_upload(file, **kwargs):
        # Persist directly at the resolved target so temp_path == target_path.
        filename = kwargs["filename"]
        # The service builds: target_root / "originals/<base>/<filename>".
        # Mirror that so media_url_to_path returns the identical path.
        url = f"/media/originals/{captured['base']}/{filename}"
        target = private / "originals" / captured["base"] / filename
        target.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (8, 8), (1, 1, 1)).save(target, format="JPEG")
        return url, None

    # Patch _asset_base_folder to a deterministic value we can mirror.
    real_base = md._asset_base_folder

    def _base(asset_id):
        value = real_base(asset_id)
        captured["base"] = value
        return value

    monkeypatch.setattr(md, "_asset_base_folder", _base)
    monkeypatch.setattr(md.storage, "save_upload", _fake_save_upload)
    monkeypatch.setattr(
        md.storage,
        "media_url_to_path",
        lambda url: private / url.replace("/media/", ""),
    )

    async with Session() as session:
        resp = await md.create_asset_from_upload(
            session,
            file=_UploadFile(),
            created_by_user_id=None,
            visibility=MediaVisibility.private,
        )
        assert resp.asset.id is not None
