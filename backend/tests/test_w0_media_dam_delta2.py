"""Worker-0 second coverage delta for ``app.services.media_dam``.

Closes the residual gaps left after ``test_w0_media_dam`` /
``test_w2_media_dam_helpers`` / ``test_media_dam_api`` / ``test_media_worker``:
policy-parsing exception arcs, asset-update field branches, status/trash/restore
move arcs, purge failure-handling, usage-edge collection, the job-processing
dispatch handlers, triage updates, and the ``job_to_read`` defensive guard.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.media import (
    MediaApprovalEvent,  # noqa: F401  (ensure mapper configured)
    MediaAsset,
    MediaAssetStatus,
    MediaAssetType,
    MediaJob,
    MediaJobStatus,
    MediaJobType,
    MediaVisibility,
)
from app.schemas.media import (
    MediaAssetUpdateI18nItem,
    MediaAssetUpdateRequest,
)
from app.services import media_dam as md

UTC = timezone.utc


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


def _write_image(path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (40, 20), (10, 20, 30)).save(path, format="JPEG")


# --------------------------------------------------------------------------- #
# Pure-helper exception arcs
# --------------------------------------------------------------------------- #


def test_parse_schedule_json_invalid_falls_back() -> None:
    # invalid JSON -> [] -> fallback returned
    assert md._parse_schedule_json("{bad", fallback=[5, 10]) == [5, 10]
    # non-list JSON -> iterated as [] -> fallback
    assert md._parse_schedule_json("123", fallback=[7]) == [7]
    # mixed list with blanks / non-coercible -> filtered (order preserved):
    # " " stripped empty -> skip; "x" -> int() fails -> skip; 3 -> 3; 0 -> max(1,0)=1
    assert md._parse_schedule_json('[" ", "x", 3, 0]', fallback=[9]) == [3, 1]


def test_policy_snapshot_from_raw_bad_numbers() -> None:
    job_type = MediaJobType.ingest
    base = md._default_retry_policy(job_type)
    # max_attempts not coercible -> except branch -> base
    resolved = md._policy_snapshot_from_raw(
        {"max_attempts": "not-a-number", "jitter_ratio": "nope"}, job_type=job_type
    )
    assert resolved.max_attempts == max(
        1, min(md.MAX_RETRY_POLICY_ATTEMPTS, base.max_attempts)
    )
    assert 0.0 <= resolved.jitter_ratio <= 1.0


def test_deserialize_policy_snapshot_json_invalid_and_non_dict() -> None:
    job_type = MediaJobType.ingest
    # invalid JSON -> {} ; non-dict JSON -> {}
    r1 = md._deserialize_policy_snapshot_json("{bad", job_type=job_type)
    r2 = md._deserialize_policy_snapshot_json("[1,2]", job_type=job_type)
    assert r1.max_attempts >= 1
    assert r2.max_attempts >= 1


def test_snapshot_to_schema_roundtrip() -> None:
    job_type = MediaJobType.ingest
    policy = md._default_retry_policy(job_type)
    schema = md._snapshot_to_schema(policy)
    assert schema.max_attempts == policy.max_attempts
    assert schema.version_ts == str(policy.version_ts)


def test_job_payload_invalid_json_returns_empty() -> None:
    job = MediaJob(
        id=uuid.uuid4(), job_type=MediaJobType.ingest, payload_json="{not json"
    )
    assert md._job_payload(job) == {}


def test_job_to_read_handles_tag_access_failure() -> None:
    """A non-``MissingGreenlet`` error on ``job.tags`` hits the generic guard."""

    class _FakeJob:
        id = uuid.uuid4()
        asset_id = None
        job_type = MediaJobType.ingest
        status = MediaJobStatus.queued
        progress_pct = 0
        attempt = 0
        max_attempts = 0
        next_retry_at = None
        last_error_at = None
        dead_lettered_at = None
        triage_state = "open"
        assigned_to_user_id = None
        sla_due_at = None
        incident_url = None
        error_code = None
        error_message = None
        created_at = datetime.now(UTC)
        started_at = None
        completed_at = None

        @property
        def tags(self):
            raise RuntimeError("lazy load outside greenlet")

    read = md.job_to_read(_FakeJob())  # type: ignore[arg-type]
    assert read.tags == []


def test_detect_image_dimensions_invalid(tmp_path) -> None:
    bad = tmp_path / "x.bin"
    bad.write_bytes(b"not-an-image")
    assert md._detect_image_dimensions(bad) == (None, None)


# --------------------------------------------------------------------------- #
# apply_asset_update field branches + visibility move
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_apply_asset_update_all_fields_and_visibility_move(media_roots) -> None:
    engine, Session = _make_local()
    await _init(engine)
    asset_id = uuid.uuid4()
    async with Session() as session:
        asset = MediaAsset(
            id=asset_id,
            asset_type=MediaAssetType.image,
            status=MediaAssetStatus.draft,
            visibility=MediaVisibility.private,
            storage_key="originals/x.jpg",
            public_url="/media/originals/x.jpg",
        )
        session.add(asset)
        await session.commit()
        await session.refresh(asset)

        payload = MediaAssetUpdateRequest(
            status="approved",
            visibility="public",
            rights_license="  CC-BY  ",
            rights_owner="  Owner  ",
            rights_notes="  notes  ",
            tags=["Foo", "foo", " "],
            i18n=[
                MediaAssetUpdateI18nItem(
                    lang="en",
                    title=" Title ",
                    alt_text="",
                    caption=None,
                    description=" ",
                ),
                MediaAssetUpdateI18nItem(lang="en", title="dup-skipped"),
            ],
        )
        await md.apply_asset_update(session, asset, payload)
        await session.commit()
        await session.refresh(asset)
        assert asset.status == MediaAssetStatus.approved
        assert asset.visibility == MediaVisibility.public
        assert asset.rights_license == "CC-BY"
        assert asset.rights_owner == "Owner"
        assert asset.rights_notes == "notes"


# --------------------------------------------------------------------------- #
# change_status / soft_delete / restore move arcs
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_change_status_triggers_public_move(media_roots) -> None:
    public, private = media_roots
    engine, Session = _make_local()
    await _init(engine)
    async with Session() as session:
        asset = MediaAsset(
            id=uuid.uuid4(),
            asset_type=MediaAssetType.image,
            status=MediaAssetStatus.draft,
            visibility=MediaVisibility.public,
            storage_key="originals/move.jpg",
            public_url="/media/originals/move.jpg",
        )
        _write_image(private / "originals" / "move.jpg")
        session.add(asset)
        await session.commit()
        await session.refresh(asset)
        # draft+public is not servable; approving makes it servable -> move.
        updated = await md.change_status(
            session,
            asset=asset,
            to_status=MediaAssetStatus.approved,
            actor_id=None,
            note="  ok  ",
            set_approved_actor=True,
        )
        assert updated.status == MediaAssetStatus.approved


@pytest.mark.anyio
async def test_soft_delete_and_restore_move(media_roots) -> None:
    public, private = media_roots
    engine, Session = _make_local()
    await _init(engine)
    async with Session() as session:
        asset = MediaAsset(
            id=uuid.uuid4(),
            asset_type=MediaAssetType.image,
            status=MediaAssetStatus.approved,
            visibility=MediaVisibility.public,
            storage_key="originals/del.jpg",
            public_url="/media/originals/del.jpg",
            approved_at=md._now(),
        )
        _write_image(public / "originals" / "del.jpg")
        session.add(asset)
        await session.commit()
        await session.refresh(asset)

        trashed = await md.soft_delete_asset(session, asset, actor_id=None)
        assert trashed.status == MediaAssetStatus.trashed
        assert trashed.storage_key.startswith("trash/")

        restored = await md.restore_asset(session, trashed, actor_id=None)
        assert restored.status == MediaAssetStatus.draft
        assert restored.storage_key.startswith("originals/")
        # restore on a non-trashed asset is a no-op.
        assert (
            await md.restore_asset(session, restored, actor_id=None)
        ).status == MediaAssetStatus.draft


@pytest.mark.anyio
async def test_soft_delete_move_failure_is_swallowed(media_roots, monkeypatch) -> None:
    engine, Session = _make_local()
    await _init(engine)

    def _boom(*a, **k):
        raise OSError("disk full")

    async with Session() as session:
        asset = MediaAsset(
            id=uuid.uuid4(),
            asset_type=MediaAssetType.image,
            status=MediaAssetStatus.approved,
            visibility=MediaVisibility.public,
            storage_key="originals/boom.jpg",
            public_url="/media/originals/boom.jpg",
        )
        session.add(asset)
        await session.commit()
        await session.refresh(asset)
        # _asset_file_path raising forces the except arc.
        monkeypatch.setattr(md, "_asset_file_path", _boom)
        trashed = await md.soft_delete_asset(session, asset, actor_id=None)
        assert trashed.status == MediaAssetStatus.trashed


@pytest.mark.anyio
async def test_restore_move_failure_is_swallowed(media_roots, monkeypatch) -> None:
    engine, Session = _make_local()
    await _init(engine)

    def _boom(*a, **k):
        raise OSError("disk full")

    async with Session() as session:
        asset = MediaAsset(
            id=uuid.uuid4(),
            asset_type=MediaAssetType.image,
            status=MediaAssetStatus.trashed,
            visibility=MediaVisibility.private,
            storage_key="trash/boom.jpg",
            public_url="/media/trash/boom.jpg",
            trashed_at=md._now(),
        )
        session.add(asset)
        await session.commit()
        await session.refresh(asset)
        monkeypatch.setattr(md, "_asset_file_path", _boom)
        restored = await md.restore_asset(session, asset, actor_id=None)
        assert restored.status == MediaAssetStatus.draft


# --------------------------------------------------------------------------- #
# purge / purge_expired_trash failure arcs
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_purge_asset_handles_resolve_and_unlink_failures(
    media_roots, monkeypatch
) -> None:
    engine, Session = _make_local()
    await _init(engine)
    async with Session() as session:
        asset = MediaAsset(
            id=uuid.uuid4(),
            asset_type=MediaAssetType.image,
            status=MediaAssetStatus.trashed,
            visibility=MediaVisibility.private,
            storage_key="trash/p.jpg",
            public_url="/media/trash/p.jpg",
            trashed_at=md._now(),
        )
        session.add(asset)
        await session.commit()
        await session.refresh(asset)

        # primary path resolution raises -> logged + continue.
        def _boom(_key):
            raise OSError("nope")

        monkeypatch.setattr(md, "_find_existing_storage_path", _boom)
        await md.purge_asset(session, asset)


@pytest.mark.anyio
async def test_purge_expired_trash_counts(media_roots) -> None:
    engine, Session = _make_local()
    await _init(engine)
    async with Session() as session:
        old = MediaAsset(
            id=uuid.uuid4(),
            asset_type=MediaAssetType.image,
            status=MediaAssetStatus.trashed,
            visibility=MediaVisibility.private,
            storage_key="trash/old.jpg",
            public_url="/media/trash/old.jpg",
            trashed_at=md._now() - timedelta(days=md.TRASH_RETENTION_DAYS + 1),
        )
        session.add(old)
        await session.commit()
        count = await md.purge_expired_trash(session)
        assert count == 1


# --------------------------------------------------------------------------- #
# rebuild_usage_edges / _collect_usage_refs
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_rebuild_usage_edges_dedupes(media_roots, monkeypatch) -> None:
    engine, Session = _make_local()
    await _init(engine)

    async def _fake_refs(_session, _asset):
        return [
            ("content_block", "k1", None, "auto_scan", None),
            ("content_block", "k1", None, "auto_scan", None),  # duplicate -> skipped
            ("content_image", "k2", "id1", "content_images.url", None),
        ]

    monkeypatch.setattr(md, "_collect_usage_refs", _fake_refs)
    async with Session() as session:
        asset = MediaAsset(
            id=uuid.uuid4(),
            asset_type=MediaAssetType.image,
            status=MediaAssetStatus.draft,
            visibility=MediaVisibility.private,
            storage_key="originals/u.jpg",
            public_url="/media/originals/u.jpg",
        )
        session.add(asset)
        await session.commit()
        await session.refresh(asset)
        resp = await md.rebuild_usage_edges(session, asset, commit=True)
        assert len(resp.items) == 2


# --------------------------------------------------------------------------- #
# Job-processing dispatch handlers
# --------------------------------------------------------------------------- #


def _make_job(job_type: MediaJobType, *, asset_id=None, payload=None) -> MediaJob:
    return MediaJob(
        id=uuid.uuid4(),
        job_type=job_type,
        status=MediaJobStatus.queued,
        asset_id=asset_id,
        attempt=0,
        max_attempts=0,
        payload_json=json.dumps(payload or {}),
    )


@pytest.mark.anyio
async def test_process_handlers_no_asset_id_short_circuit() -> None:
    engine, Session = _make_local()
    await _init(engine)
    async with Session() as session:
        for jt in (
            MediaJobType.ingest,
            MediaJobType.variant,
            MediaJobType.edit,
            MediaJobType.ai_tag,
            MediaJobType.duplicate_scan,
        ):
            await {
                MediaJobType.ingest: md._process_ingest_job,
                MediaJobType.variant: md._process_variant_job,
                MediaJobType.edit: md._process_edit_job,
                MediaJobType.ai_tag: md._process_ai_tag_job,
                MediaJobType.duplicate_scan: md._process_duplicate_scan_job,
            }[jt](session, _make_job(jt, asset_id=None))


@pytest.mark.anyio
async def test_process_handlers_missing_asset_short_circuit() -> None:
    engine, Session = _make_local()
    await _init(engine)
    missing = uuid.uuid4()
    async with Session() as session:
        await md._process_ingest_job(
            session, _make_job(MediaJobType.ingest, asset_id=missing)
        )
        await md._process_variant_job(
            session, _make_job(MediaJobType.variant, asset_id=missing)
        )
        await md._process_edit_job(
            session, _make_job(MediaJobType.edit, asset_id=missing)
        )
        await md._process_ai_tag_job(
            session, _make_job(MediaJobType.ai_tag, asset_id=missing)
        )
        await md._process_duplicate_scan_job(
            session, _make_job(MediaJobType.duplicate_scan, asset_id=missing)
        )


@pytest.mark.anyio
async def test_process_ingest_and_variant_and_edit_render(media_roots) -> None:
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
            storage_key="originals/render.jpg",
            public_url="/media/originals/render.jpg",
            original_filename="my_photo_name.jpg",
        )
        _write_image(private / "originals" / "render.jpg")
        session.add(asset)
        await session.commit()

        await md._process_ingest_job(
            session, _make_job(MediaJobType.ingest, asset_id=asset_id)
        )
        await session.commit()
        await session.refresh(asset)
        assert asset.checksum_sha256

        await md._process_variant_job(
            session,
            _make_job(
                MediaJobType.variant, asset_id=asset_id, payload={"profile": "web-1280"}
            ),
        )
        await md._process_edit_job(
            session,
            _make_job(
                MediaJobType.edit,
                asset_id=asset_id,
                payload={
                    "rotate_cw": 90,
                    "crop_aspect_w": 16,
                    "crop_aspect_h": 9,
                    "resize_max_width": 30,
                },
            ),
        )
        await md._process_ai_tag_job(
            session, _make_job(MediaJobType.ai_tag, asset_id=asset_id)
        )
        await session.commit()


@pytest.mark.anyio
async def test_process_edit_tall_crop_branch(media_roots) -> None:
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
            storage_key="originals/tall.jpg",
            public_url="/media/originals/tall.jpg",
        )
        path = private / "originals" / "tall.jpg"
        path.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (20, 60), (1, 2, 3)).save(path, format="JPEG")
        session.add(asset)
        await session.commit()
        # current_ratio < target_ratio -> the elif crop branch.
        await md._process_edit_job(
            session,
            _make_job(
                MediaJobType.edit,
                asset_id=asset_id,
                payload={"crop_aspect_w": 16, "crop_aspect_h": 9},
            ),
        )
        await session.commit()


@pytest.mark.anyio
async def test_process_ingest_missing_file_raises(media_roots) -> None:
    engine, Session = _make_local()
    await _init(engine)
    asset_id = uuid.uuid4()
    async with Session() as session:
        asset = MediaAsset(
            id=asset_id,
            asset_type=MediaAssetType.image,
            status=MediaAssetStatus.draft,
            visibility=MediaVisibility.private,
            storage_key="originals/missing.jpg",
            public_url="/media/originals/missing.jpg",
        )
        session.add(asset)
        await session.commit()
        with pytest.raises(FileNotFoundError):
            await md._process_ingest_job(
                session, _make_job(MediaJobType.ingest, asset_id=asset_id)
            )


@pytest.mark.anyio
async def test_process_variant_and_edit_non_image_short_circuit(media_roots) -> None:
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
        session.add(asset)
        await session.commit()
        await md._process_variant_job(
            session, _make_job(MediaJobType.variant, asset_id=asset_id)
        )
        await md._process_edit_job(
            session, _make_job(MediaJobType.edit, asset_id=asset_id)
        )


@pytest.mark.anyio
async def test_process_variant_missing_file_raises(media_roots) -> None:
    engine, Session = _make_local()
    await _init(engine)
    asset_id = uuid.uuid4()
    async with Session() as session:
        asset = MediaAsset(
            id=asset_id,
            asset_type=MediaAssetType.image,
            status=MediaAssetStatus.draft,
            visibility=MediaVisibility.private,
            storage_key="originals/gone.jpg",
            public_url="/media/originals/gone.jpg",
        )
        session.add(asset)
        await session.commit()
        with pytest.raises(FileNotFoundError):
            await md._process_variant_job(
                session, _make_job(MediaJobType.variant, asset_id=asset_id)
            )
        with pytest.raises(FileNotFoundError):
            await md._process_edit_job(
                session, _make_job(MediaJobType.edit, asset_id=asset_id)
            )


# --------------------------------------------------------------------------- #
# update_job_triage branches
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_update_job_triage_sla_and_incident(media_roots) -> None:
    engine, Session = _make_local()
    await _init(engine)
    async with Session() as session:
        job = _make_job(MediaJobType.ingest)
        job.status = MediaJobStatus.failed
        session.add(job)
        await session.commit()
        await session.refresh(job)

        due = datetime.now(UTC) + timedelta(hours=2)
        updated = await md.update_job_triage(
            session,
            job=job,
            actor_user_id=None,
            triage_state="ignored",
            sla_due_at=due,
            incident_url="  https://incident.example/x  ",
            add_tags=["urgent"],
        )
        assert updated.triage_state == "ignored"
        assert updated.sla_due_at is not None
        assert updated.incident_url == "https://incident.example/x"

        cleared = await md.update_job_triage(
            session,
            job=updated,
            actor_user_id=None,
            clear_sla_due_at=True,
            clear_incident_url=True,
            clear_assignee=True,
        )
        assert cleared.sla_due_at is None
        assert cleared.incident_url is None


@pytest.mark.anyio
async def test_apply_job_tag_changes_add_and_delete() -> None:
    engine, Session = _make_local()
    await _init(engine)
    job_id = uuid.uuid4()
    async with Session() as session:
        job = _make_job(MediaJobType.ingest)
        job.id = job_id
        job.status = MediaJobStatus.failed
        session.add(job)
        await session.commit()

    # Add a tag (exercises the create-new-tag + link arc).
    async with Session() as session:
        job = await md.get_job_or_404(session, job_id)
        await md._apply_job_tag_changes(session, job=job, add_tags=["keepme"])
        await session.commit()

    # Reload fresh, then remove the existing tag (exercises the delete arc at the
    # ``relation is not None`` branch) without a stale relationship reference.
    async with Session() as session:
        job = await md.get_job_or_404(session, job_id)
        await md._apply_job_tag_changes(session, job=job, remove_tags=["keepme"])
        await session.commit()

    async with Session() as session:
        job = await md.get_job_or_404(session, job_id)
        assert md.job_to_read(job).tags == []


@pytest.mark.anyio
async def test_update_job_triage_assignee_set(media_roots) -> None:
    engine, Session = _make_local()
    await _init(engine)
    async with Session() as session:
        job = _make_job(MediaJobType.ingest)
        job.status = MediaJobStatus.failed
        session.add(job)
        await session.commit()
        await session.refresh(job)
        assignee = uuid.uuid4()
        updated = await md.update_job_triage(
            session, job=job, actor_user_id=None, assigned_to_user_id=assignee
        )
        assert updated.assigned_to_user_id == assignee
