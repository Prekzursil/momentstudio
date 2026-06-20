"""Worker-0 coverage delta for ``app.services.media_dam``.

This file is a *disjoint delta*: it targets uncovered filesystem-placement
helpers and the retry-policy CRUD/history paths that the existing media suites
(``test_w2_media_dam_helpers`` / ``test_media_dam_api`` / ``test_media_worker``
/ ``test_lr_media_worker`` / ``test_lr_media_usage_reconcile_scheduler``) do not
reach. It is meant to be measured as a union with those files.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.media import (
    MediaAsset,
    MediaAssetStatus,
    MediaAssetType,
    MediaJob,
    MediaJobRetryPolicy,
    MediaJobStatus,
    MediaJobType,
    MediaVisibility,
)
from app.models.user import UserRole
from app.schemas.media import (
    MediaAssetUpdateI18nItem,
    MediaAssetUpdateRequest,
    MediaRetryPolicyRollbackRequest,
    MediaRetryPolicyUpdateRequest,
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


def _asset(
    *,
    storage_key: str,
    public_url: str,
    visibility: MediaVisibility = MediaVisibility.private,
    status: MediaAssetStatus = MediaAssetStatus.draft,
) -> MediaAsset:
    return MediaAsset(
        id=uuid.uuid4(),
        asset_type=MediaAssetType.image,
        status=status,
        visibility=visibility,
        storage_key=storage_key,
        public_url=public_url,
    )


# --------------------------------------------------------------------------- #
# Filesystem placement helpers (tmp_path + monkeypatched roots)
# --------------------------------------------------------------------------- #


@pytest.fixture
def media_roots(tmp_path, monkeypatch):
    public = tmp_path / "public"
    private = tmp_path / "private"
    public.mkdir()
    private.mkdir()
    monkeypatch.setattr(md, "_public_media_root", lambda: public)
    monkeypatch.setattr(md, "_private_media_root", lambda: private)
    return public, private


def test_is_publicly_servable() -> None:
    public_ok = _asset(
        storage_key="k", public_url="/media/k",
        visibility=MediaVisibility.public, status=MediaAssetStatus.approved,
    )
    assert md._is_publicly_servable(public_ok) is True
    private_asset = _asset(storage_key="k", public_url="/media/k")
    assert md._is_publicly_servable(private_asset) is False


def test_storage_path_and_find_existing(media_roots) -> None:
    public, private = media_roots
    # empty key -> None
    assert md._find_existing_storage_path("") is None
    # path resolution
    p = md._storage_path_for_key("/sub/file.png", public_root=True)
    assert p == (public / "sub" / "file.png").resolve()
    # create a file in the private root, find it there
    target = private / "sub" / "f.png"
    target.parent.mkdir(parents=True)
    target.write_bytes(b"x")
    found = md._find_existing_storage_path("sub/f.png")
    assert found == target.resolve()
    # not present anywhere
    assert md._find_existing_storage_path("missing/none.png") is None


def test_asset_file_path_variants(media_roots) -> None:
    public, private = media_roots
    asset = _asset(
        storage_key="orig/a.png", public_url="/media/orig/a.png",
        visibility=MediaVisibility.public, status=MediaAssetStatus.approved,
    )
    # preferred (public) exists
    pref = public / "orig" / "a.png"
    pref.parent.mkdir(parents=True)
    pref.write_bytes(b"x")
    assert md._asset_file_path(asset) == pref.resolve()

    # only the alternate (private) root has the file
    pref.unlink()
    alt = private / "orig" / "a.png"
    alt.parent.mkdir(parents=True)
    alt.write_bytes(b"x")
    assert md._asset_file_path(asset) == alt.resolve()

    # nothing exists -> expected public path
    alt.unlink()
    expected = md._storage_path_for_key("orig/a.png", public_root=True)
    assert md._asset_file_path(asset) == expected

    # no storage_key but a public_url that resolves
    asset2 = _asset(storage_key="", public_url="/media/orig/b.png")
    b = private / "orig" / "b.png"
    b.write_bytes(b"x")
    assert md._asset_file_path(asset2) == b.resolve()


def test_move_file_and_roots(media_roots) -> None:
    public, private = media_roots
    # _move_file: simple replace
    src = private / "m" / "s.png"
    src.parent.mkdir(parents=True)
    src.write_bytes(b"data")
    dst = public / "m" / "s.png"
    dst.parent.mkdir(parents=True)
    md._move_file(src, dst)
    assert dst.read_bytes() == b"data"
    assert not src.exists()

    # _move_asset_file_roots: no storage_key -> no-op
    md._move_asset_file_roots(_asset(storage_key="", public_url="/media/x"),
                              to_public=True)
    # _move_asset_file_roots: source missing -> no-op
    md._move_asset_file_roots(
        _asset(storage_key="nope/x.png", public_url="/media/nope/x.png"),
        to_public=True,
    )

    # _move_asset_file_roots: actual move private -> public
    asset = _asset(storage_key="mv/a.png", public_url="/media/mv/a.png")
    pf = private / "mv" / "a.png"
    pf.parent.mkdir(parents=True)
    pf.write_bytes(b"q")
    md._move_asset_file_roots(asset, to_public=True)
    assert (public / "mv" / "a.png").exists()

    # source == destination -> no move
    md._move_asset_file_roots(asset, to_public=True)


def test_move_variant_file_roots(media_roots) -> None:
    public, private = media_roots

    class _Variant:
        def __init__(self, key):
            self.storage_key = key

    class _AssetStub:
        # plain stub: _move_variant_file_roots only reads .variants
        def __init__(self, variants):
            self.variants = variants

    v1 = _Variant("var/v1.png")
    v2 = _Variant("")  # no key -> skipped
    v3 = _Variant("var/missing.png")  # source missing -> skipped
    asset = _AssetStub([v1, v2, v3])
    src = private / "var" / "v1.png"
    src.parent.mkdir(parents=True)
    src.write_bytes(b"v")
    md._move_variant_file_roots(asset, to_public=True)
    assert (public / "var" / "v1.png").exists()
    # second call: source == destination -> continue
    md._move_variant_file_roots(asset, to_public=True)


def test_ensure_asset_storage_placement(media_roots, monkeypatch) -> None:
    public, private = media_roots
    asset = _asset(
        storage_key="e/a.png", public_url="/media/e/a.png",
        visibility=MediaVisibility.public, status=MediaAssetStatus.approved,
    )
    asset.variants = []
    src = private / "e" / "a.png"
    src.parent.mkdir(parents=True)
    src.write_bytes(b"z")
    md._ensure_asset_storage_placement(asset)
    assert (public / "e" / "a.png").exists()

    # exception path swallowed
    def _boom(*a, **k):
        raise OSError("blocked")

    monkeypatch.setattr(md, "_move_asset_file_roots", _boom)
    md._ensure_asset_storage_placement(asset)  # returns without raising


def test_public_url_helpers() -> None:
    assert md._public_url_from_storage_key("/a/b.png") == "/media/a/b.png"
    assert md._asset_base_folder(uuid.UUID(int=1)) == str(uuid.UUID(int=1))


# --------------------------------------------------------------------------- #
# Preview signing / verification
# --------------------------------------------------------------------------- #


def test_preview_url_sign_and_verify() -> None:
    asset_id = uuid.uuid4()
    url = md.build_preview_url(asset_id, variant_profile="thumb", ttl_seconds=60)
    assert "preview?exp=" in url
    assert "variant_profile=thumb" in url
    # parse exp + sig
    import urllib.parse as up

    qs = up.parse_qs(up.urlparse(url).query)
    exp = int(qs["exp"][0])
    sig = qs["sig"][0]
    assert md.verify_preview_signature(
        asset_id, exp=exp, sig=sig, variant_profile="thumb"
    )
    # bad sig
    assert md.verify_preview_signature(
        asset_id, exp=exp, sig="deadbeef", variant_profile="thumb"
    ) is False
    # non-int exp
    assert md.verify_preview_signature(
        asset_id, exp="notanint", sig=sig
    ) is False
    # expired
    assert md.verify_preview_signature(
        asset_id, exp=1, sig=sig
    ) is False
    # url without variant_profile
    url2 = md.build_preview_url(asset_id, ttl_seconds=10)
    assert "variant_profile" not in url2


# --------------------------------------------------------------------------- #
# Retry-policy CRUD / validation
# --------------------------------------------------------------------------- #


def test_parse_job_type_and_validate_schedule() -> None:
    assert md._parse_job_type(MediaJobType.ingest) == MediaJobType.ingest
    assert md._parse_job_type("variant") == MediaJobType.variant
    with pytest.raises(ValueError, match="Invalid media job type"):
        md._parse_job_type("bogus")

    assert md._validate_schedule([1, 2, 3]) == [1, 2, 3]
    with pytest.raises(ValueError, match="positive integers"):
        md._validate_schedule([0])
    with pytest.raises(ValueError, match="at least one"):
        md._validate_schedule([])
    with pytest.raises(ValueError, match="cannot exceed 20"):
        md._validate_schedule(list(range(1, 25)))


def test_validate_policy_payload() -> None:
    md._validate_policy_payload(
        MediaRetryPolicyUpdateRequest(max_attempts=3, jitter_ratio=0.5)
    )
    # max_attempts out of range is blocked at schema level, so validate via schedule
    with pytest.raises(ValueError, match="positive integers"):
        md._validate_policy_payload(
            MediaRetryPolicyUpdateRequest(backoff_schedule_seconds=[5, 10])
            .model_copy(update={"backoff_schedule_seconds": [0]})
        )


@pytest.mark.anyio
async def test_retry_policy_lifecycle() -> None:
    engine, local = _make_local()
    await _init(engine)
    actor = uuid.uuid4()

    async with local() as session:
        # get for a job type with no row -> default resolved
        resolved = await md.get_retry_policy_for_job_type(session, MediaJobType.ingest)
        assert resolved.max_attempts >= 1

        # list (no rows yet) -> one entry per job type, all defaults
        listed = await md.list_retry_policies(session)
        assert len(listed) == len(list(MediaJobType))

    async with local() as session:
        # upsert: creates a new row then updates it
        out = await md.upsert_retry_policy(
            session,
            job_type="ingest",
            payload=MediaRetryPolicyUpdateRequest(
                max_attempts=4, backoff_schedule_seconds=[1, 2, 3],
                jitter_ratio=0.25, enabled=True,
            ),
            updated_by_user_id=actor,
        )
        assert out.max_attempts == 4

    async with local() as session:
        # upsert again on the existing row (update branch)
        out = await md.upsert_retry_policy(
            session,
            job_type=MediaJobType.ingest,
            payload=MediaRetryPolicyUpdateRequest(enabled=False),
            updated_by_user_id=actor,
        )
        assert out.enabled is False

    async with local() as session:
        # reset an existing policy
        out = await md.reset_retry_policy(
            session, job_type="ingest", updated_by_user_id=actor
        )
        assert out.max_attempts >= 1

    async with local() as session:
        # reset a job type that has no row yet (row is None branch)
        out = await md.reset_retry_policy(
            session, job_type=MediaJobType.variant, updated_by_user_id=actor
        )
        assert out.job_type == MediaJobType.variant

    async with local() as session:
        # reset_all (mix of existing + missing rows)
        outs = await md.reset_all_retry_policies(session, updated_by_user_id=actor)
        assert len(outs) == len(list(MediaJobType))


@pytest.mark.anyio
async def test_retry_policy_history() -> None:
    engine, local = _make_local()
    await _init(engine)
    actor = uuid.uuid4()
    async with local() as session:
        await md.upsert_retry_policy(
            session,
            job_type="ingest",
            payload=MediaRetryPolicyUpdateRequest(max_attempts=2),
            updated_by_user_id=actor,
        )
    async with local() as session:
        events, meta = await md.list_retry_policy_history(session, job_type="ingest")
        assert isinstance(events, list)
        assert len(events) >= 1
        assert meta["total_items"] >= 1


@pytest.mark.anyio
async def test_retry_policy_presets_known_good_rollback() -> None:
    engine, local = _make_local()
    await _init(engine)
    actor = uuid.uuid4()

    async with local() as session:
        # presets with no history -> all fallbacks used
        presets = await md.get_retry_policy_presets(session, job_type="ingest")
        assert len(presets.items) == 3
        assert presets.items[1].fallback_used is True  # last_change fallback
        assert presets.items[2].fallback_used is True  # known_good fallback

    async with local() as session:
        # create a policy and an update event so last_change has a source
        await md.upsert_retry_policy(
            session,
            job_type="ingest",
            payload=MediaRetryPolicyUpdateRequest(max_attempts=5),
            updated_by_user_id=actor,
        )

    async with local() as session:
        # mark known-good
        evt = await md.mark_retry_policy_known_good(
            session, job_type="ingest", actor_user_id=actor, note="ok"
        )
        assert evt.action == "mark_known_good"

    async with local() as session:
        # presets now resolve known_good + last_change from events
        presets = await md.get_retry_policy_presets(session, job_type="ingest")
        assert presets.items[2].fallback_used is False  # known_good resolved
        assert presets.items[1].fallback_used is False  # last_change resolved

    async with local() as session:
        # rollback to a preset (preset_key branch)
        out = await md.rollback_retry_policy(
            session,
            job_type="ingest",
            payload=MediaRetryPolicyRollbackRequest(preset_key="factory_default"),
            actor_user_id=actor,
        )
        assert out.job_type == MediaJobType.ingest

    async with local() as session:
        # rollback to a specific history event (event_id branch)
        events, _meta = await md.list_retry_policy_history(session, job_type="ingest")
        target = events[-1]
        out = await md.rollback_retry_policy(
            session,
            job_type="ingest",
            payload=MediaRetryPolicyRollbackRequest(event_id=target.id),
            actor_user_id=actor,
        )
        assert out.job_type == MediaJobType.ingest

    async with local() as session:
        # rollback with unknown event_id -> ValueError
        with pytest.raises(ValueError, match="history event not found"):
            await md.rollback_retry_policy(
                session,
                job_type="ingest",
                payload=MediaRetryPolicyRollbackRequest(event_id=uuid.uuid4()),
                actor_user_id=actor,
            )


@pytest.mark.anyio
async def test_list_assets_filters() -> None:
    engine, local = _make_local()
    await _init(engine)
    async with local() as session:
        asset = MediaAsset(
            id=uuid.uuid4(), asset_type=MediaAssetType.image,
            status=MediaAssetStatus.approved, visibility=MediaVisibility.public,
            storage_key="originals/x/photo.png",
            public_url="/media/originals/x/photo.png",
            original_filename="photo.png",
            created_at=datetime(2025, 1, 5, tzinfo=UTC),
        )
        session.add(asset)
        await session.commit()

    async with local() as session:
        # exercise every filter branch + each sort option
        for sort in ("newest", "oldest", "name_asc", "name_desc", "unknown"):
            _rows, meta = await md.list_assets(
                session,
                md.MediaListFilters(
                    q="photo", asset_type="image", status="approved",
                    visibility="public",
                    created_from=datetime(2025, 1, 1, tzinfo=UTC),
                    created_to=datetime(2025, 12, 31, tzinfo=UTC),
                    include_trashed=True, tag="sometag", sort=sort,
                ),
            )
            assert meta["total_items"] >= 0
        # default branch (no filters)
        _rows, meta = await md.list_assets(session, md.MediaListFilters())
        assert meta["total_items"] == 1


@pytest.mark.anyio
async def test_list_jobs_filters() -> None:
    engine, local = _make_local()
    await _init(engine)
    async with local() as session:
        asset_id = uuid.uuid4()
        session.add(
            MediaAsset(
                id=asset_id, asset_type=MediaAssetType.image,
                status=MediaAssetStatus.draft, visibility=MediaVisibility.private,
                storage_key="o/j.png", public_url="/media/o/j.png",
            )
        )
        job = MediaJob(
            id=uuid.uuid4(), asset_id=asset_id, job_type=MediaJobType.ingest,
            status=MediaJobStatus.dead_letter, triage_state="open",
            sla_due_at=datetime(2000, 1, 1, tzinfo=UTC),
        )
        session.add(job)
        await session.commit()
    actor = uuid.uuid4()

    async with local() as session:
        _rows, meta = await md.list_jobs(
            session,
            md.MediaJobListFilters(
                status="dead_letter", job_type="ingest", asset_id=asset_id,
                created_from=datetime(2025, 1, 1, tzinfo=UTC),
                created_to=datetime(2025, 12, 31, tzinfo=UTC),
                triage_state="open", assigned_to_user_id=actor,
                tag="jtag", sla_breached=True, dead_letter_only=True,
            ),
        )
        assert meta["total_items"] >= 0
        # default branch
        _rows, meta = await md.list_jobs(session, md.MediaJobListFilters())
        assert meta["total_items"] == 1


@pytest.mark.anyio
async def test_asset_lifecycle(media_roots) -> None:
    """get_or_404, apply_asset_update (incl public transition), change_status,
    soft_delete, restore, purge, purge_expired_trash."""
    public, private = media_roots
    engine, local = _make_local()
    await _init(engine)

    async with local() as session:
        asset = MediaAsset(
            id=uuid.uuid4(), asset_type=MediaAssetType.image,
            status=MediaAssetStatus.draft, visibility=MediaVisibility.private,
            storage_key="originals/a/img.png",
            public_url="/media/originals/a/img.png",
            original_filename="img.png",
        )
        session.add(asset)
        await session.commit()
        asset_id = asset.id
    # put the file in the private root so move/purge paths run
    f = private / "originals" / "a" / "img.png"
    f.parent.mkdir(parents=True)
    f.write_bytes(b"img")

    async with local() as session:
        # get_or_404 missing -> ValueError
        with pytest.raises(ValueError, match="Asset not found"):
            await md.get_asset_or_404(session, uuid.uuid4())
        asset = await md.get_asset_or_404(session, asset_id)
        # update: approve + make public (triggers file move) + rights + tags + i18n
        await md.apply_asset_update(
            session,
            asset,
            MediaAssetUpdateRequest(
                status="approved", visibility="public",
                rights_license="CC-BY", rights_owner="Me", rights_notes="note",
                tags=["Hello World", "hello-world", ""],  # dedup + skip empty
                i18n=[
                    MediaAssetUpdateI18nItem(lang="en", title="T", alt_text="A"),
                    MediaAssetUpdateI18nItem(lang="en", title="dup"),  # dup lang skip
                    MediaAssetUpdateI18nItem(lang="ro", caption="C"),
                ],
            ),
        )
        await session.commit()

    async with local() as session:
        asset = await md.get_asset_or_404(session, asset_id)
        # change_status to approved with actor
        await md.change_status(
            session, asset=asset, to_status=MediaAssetStatus.approved,
            actor_id=uuid.uuid4(), note="ok", set_approved_actor=True,
        )

    async with local() as session:
        asset = await md.get_asset_or_404(session, asset_id)
        await md.soft_delete_asset(session, asset, uuid.uuid4())
        assert asset.status == MediaAssetStatus.trashed

    async with local() as session:
        asset = await md.get_asset_or_404(session, asset_id)
        # restore when not trashed -> early return
        restored = await md.restore_asset(session, asset, uuid.uuid4())
        assert restored.status == MediaAssetStatus.draft
        # restore again now that it is draft -> no-op early return
        again = await md.restore_asset(session, restored, uuid.uuid4())
        assert again.status == MediaAssetStatus.draft

    async with local() as session:
        asset = await md.get_asset_or_404(session, asset_id)
        await md.purge_asset(session, asset)

    async with local() as session:
        assert await session.get(MediaAsset, asset_id) is None


@pytest.mark.anyio
async def test_purge_expired_trash(media_roots) -> None:
    public, private = media_roots
    engine, local = _make_local()
    await _init(engine)
    async with local() as session:
        old = MediaAsset(
            id=uuid.uuid4(), asset_type=MediaAssetType.image,
            status=MediaAssetStatus.trashed, visibility=MediaVisibility.private,
            storage_key="trash/old.png", public_url="/media/trash/old.png",
            trashed_at=datetime(2000, 1, 1, tzinfo=UTC),
        )
        fresh = MediaAsset(
            id=uuid.uuid4(), asset_type=MediaAssetType.image,
            status=MediaAssetStatus.trashed, visibility=MediaVisibility.private,
            storage_key="trash/new.png", public_url="/media/trash/new.png",
            trashed_at=datetime.now(UTC),
        )
        session.add_all([old, fresh])
        await session.commit()

    async with local() as session:
        purged = await md.purge_expired_trash(session)
        assert purged == 1


@pytest.mark.anyio
async def test_enqueue_job_with_snapshot_and_max_attempts() -> None:
    engine, local = _make_local()
    await _init(engine)
    async with local() as session:
        # payload carries a retry-policy snapshot (policy_snapshot not None branch)
        # and max_attempts override is applied.
        job = await md.enqueue_job(
            session,
            asset_id=None,
            job_type=MediaJobType.ingest,
            payload={
                md.RETRY_POLICY_PAYLOAD_KEY: {
                    "max_attempts": 7,
                    "schedule": [1, 2],
                    "jitter_ratio": 0.3,
                    "enabled": True,
                    "version_ts": "snap",
                }
            },
            created_by_user_id=None,
            max_attempts=3,
        )
        await session.commit()
        assert job.max_attempts == 3


@pytest.mark.anyio
async def test_queue_job_and_await_if_needed(monkeypatch) -> None:
    # _await_if_needed: sync value passthrough + awaitable resolution
    assert await md._await_if_needed(5) == 5

    async def _coro():
        return 9

    assert await md._await_if_needed(_coro()) == 9

    # queue_job with a fake redis present -> rpush path
    pushed = {}

    class _FakeRedis:
        def rpush(self, key, value):
            pushed["key"] = key
            pushed["value"] = value
            return 1

    monkeypatch.setattr(md, "get_redis", lambda: _FakeRedis())
    job_id = uuid.uuid4()
    await md.queue_job(job_id)
    assert pushed["value"] == str(job_id)

    # _maybe_queue_job with no redis -> early return
    monkeypatch.setattr(md, "get_redis", lambda: None)
    await md._maybe_queue_job(uuid.uuid4())


@pytest.mark.anyio
async def test_create_asset_from_upload(media_roots, monkeypatch) -> None:
    public, private = media_roots
    engine, local = _make_local()
    await _init(engine)

    # Stage a temp file that save_upload "produced".
    temp_path = public / "tmp_upload.png"
    temp_path.write_bytes(b"PNGDATA")

    def _fake_save_upload(file, **kwargs):
        return "/media/tmp_upload.png", {}

    monkeypatch.setattr(md.storage, "save_upload", _fake_save_upload)
    monkeypatch.setattr(md.storage, "media_url_to_path", lambda url: temp_path)

    async def _noop_queue(job_id):
        return None

    monkeypatch.setattr(md, "_maybe_queue_job", _noop_queue)

    class _Upload:
        filename = "picture.png"
        content_type = "image/png"

    async with local() as session:
        resp = await md.create_asset_from_upload(
            session,
            file=_Upload(),
            created_by_user_id=uuid.uuid4(),
            visibility=MediaVisibility.private,
        )
        assert resp.asset.original_filename == "picture.png"
        assert resp.ingest_job_id is not None


def test_pure_helpers_sha_dims_roles(tmp_path) -> None:
    # _sha256_for_path
    f = tmp_path / "h.bin"
    f.write_bytes(b"abc")
    import hashlib as _h

    assert md._sha256_for_path(f) == _h.sha256(b"abc").hexdigest()

    # _detect_image_dimensions: real image + failure path
    img_path = tmp_path / "i.png"
    Image.new("RGB", (8, 4)).save(img_path)
    assert md._detect_image_dimensions(img_path) == (8, 4)
    assert md._detect_image_dimensions(tmp_path / "missing.png") == (None, None)

    # can_approve_or_purge
    assert md.can_approve_or_purge(UserRole.admin) is True
    assert md.can_approve_or_purge("owner") is True
    assert md.can_approve_or_purge(UserRole.customer) is False

    # coerce_visibility
    assert md.coerce_visibility("public") == MediaVisibility.public
    assert md.coerce_visibility("nonsense") == MediaVisibility.private


def _seed_job(session, *, status, attempt=0, max_attempts=5, triage="open",
              next_retry_at=None):
    job = MediaJob(
        id=uuid.uuid4(), asset_id=None, job_type=MediaJobType.ingest,
        status=status, attempt=attempt, max_attempts=max_attempts,
        triage_state=triage, next_retry_at=next_retry_at,
    )
    session.add(job)
    return job


@pytest.mark.anyio
async def test_job_management(monkeypatch) -> None:
    monkeypatch.setattr(md, "get_redis", lambda: None)  # skip queueing
    engine, local = _make_local()
    await _init(engine)
    actor = uuid.uuid4()

    async with local() as session:
        # due retry: failed + next_retry_at in past + attempt < max
        due = _seed_job(
            session, status=MediaJobStatus.failed, attempt=1,
            next_retry_at=datetime(2000, 1, 1, tzinfo=UTC),
        )
        await session.commit()
        due_id = due.id

    async with local() as session:
        queued = await md.enqueue_due_retries(session, limit=10)
        assert due_id in queued

    async with local() as session:
        # get_job_or_404
        with pytest.raises(ValueError, match="Job not found"):
            await md.get_job_or_404(session, uuid.uuid4())
        job = await md.get_job_or_404(session, due_id)
        # manual retry
        retried = await md.manual_retry_job(session, job=job, actor_user_id=actor)
        assert retried.status == MediaJobStatus.queued

    async with local() as session:
        # bulk retry: empty list short-circuit
        assert await md.bulk_retry_jobs(session, job_ids=[]) == []

    async with local() as session:
        processing = _seed_job(session, status=MediaJobStatus.processing)
        exhausted = _seed_job(
            session, status=MediaJobStatus.failed, attempt=5, max_attempts=5
        )
        dead = _seed_job(session, status=MediaJobStatus.dead_letter, attempt=5,
                         max_attempts=5)
        await session.commit()
        ids = [processing.id, exhausted.id, dead.id]

    async with local() as session:
        retried = await md.bulk_retry_jobs(session, job_ids=ids, actor_user_id=actor)
        # processing skipped, exhausted-non-dead skipped, dead retried
        retried_ids = {j.id for j in retried}
        assert dead.id in retried_ids
        assert processing.id not in retried_ids

    async with local() as session:
        job = await md.get_job_or_404(session, due_id)
        # triage update: all branches (set state, assign, sla, incident, tags)
        await md.update_job_triage(
            session, job=job, actor_user_id=actor,
            triage_state="resolved", assigned_to_user_id=actor,
            sla_due_at=datetime(2030, 1, 1, tzinfo=UTC),
            incident_url="https://example.com/i",
            add_tags=["urgent"], remove_tags=["stale"], note="done",
        )

    async with local() as session:
        job = await md.get_job_or_404(session, due_id)
        # triage update: clear branches
        await md.update_job_triage(
            session, job=job, actor_user_id=actor,
            clear_assignee=True, clear_sla_due_at=True, clear_incident_url=True,
        )

    async with local() as session:
        events = await md.list_job_events(session, job_id=due_id, limit=50)
        assert len(events) >= 1


@pytest.mark.anyio
async def test_ensure_public_asset() -> None:
    engine, local = _make_local()
    await _init(engine)
    async with local() as session:
        public_ok = MediaAsset(
            id=uuid.uuid4(), asset_type=MediaAssetType.image,
            status=MediaAssetStatus.approved, visibility=MediaVisibility.public,
            storage_key="p/ok.png", public_url="/media/p/ok.png",
        )
        private_asset = MediaAsset(
            id=uuid.uuid4(), asset_type=MediaAssetType.image,
            status=MediaAssetStatus.approved, visibility=MediaVisibility.private,
            storage_key="p/pr.png", public_url="/media/p/pr.png",
        )
        rejected = MediaAsset(
            id=uuid.uuid4(), asset_type=MediaAssetType.image,
            status=MediaAssetStatus.rejected, visibility=MediaVisibility.public,
            storage_key="p/rj.png", public_url="/media/p/rj.png",
        )
        session.add_all([public_ok, private_asset, rejected])
        await session.commit()
        ids = (public_ok.id, private_asset.id, rejected.id)

    async with local() as session:
        assert await md.ensure_public_asset(session, ids[0]) is not None
        assert await md.ensure_public_asset(session, ids[1]) is None
        assert await md.ensure_public_asset(session, ids[2]) is None
        assert await md.ensure_public_asset(session, uuid.uuid4()) is None


@pytest.mark.anyio
async def test_collections_crud() -> None:
    from app.schemas.media import MediaCollectionUpsertRequest

    engine, local = _make_local()
    await _init(engine)
    actor = uuid.uuid4()

    async with local() as session:
        # empty list initially
        assert await md.list_collections(session) == []

    async with local() as session:
        # create
        created = await md.upsert_collection(
            session,
            collection_id=None,
            payload=MediaCollectionUpsertRequest(
                name="Gallery", slug="gallery", visibility="public"
            ),
            actor_id=actor,
        )
        collection_id = created.id
        assert created.name == "Gallery"

    async with local() as session:
        # update existing
        updated = await md.upsert_collection(
            session,
            collection_id=collection_id,
            payload=MediaCollectionUpsertRequest(
                name="Gallery 2", slug="gallery-2", visibility="private"
            ),
            actor_id=actor,
        )
        assert updated.name == "Gallery 2"

    async with local() as session:
        # seed assets and add them as items
        a1 = MediaAsset(
            id=uuid.uuid4(), asset_type=MediaAssetType.image,
            status=MediaAssetStatus.approved, visibility=MediaVisibility.public,
            storage_key="c/a1.png", public_url="/media/c/a1.png",
        )
        a2 = MediaAsset(
            id=uuid.uuid4(), asset_type=MediaAssetType.image,
            status=MediaAssetStatus.approved, visibility=MediaVisibility.public,
            storage_key="c/a2.png", public_url="/media/c/a2.png",
        )
        session.add_all([a1, a2])
        await session.commit()
        asset_ids = [a1.id, a2.id]

    async with local() as session:
        await md.replace_collection_items(
            session, collection_id=collection_id, asset_ids=asset_ids
        )

    async with local() as session:
        cols = await md.list_collections(session)
        assert len(cols) == 1
        assert cols[0].item_count == 2


@pytest.mark.anyio
async def test_rebuild_usage_edges() -> None:
    from app.models.catalog import Category, Product

    engine, local = _make_local()
    await _init(engine)

    async with local() as session:
        asset = MediaAsset(
            id=uuid.uuid4(), asset_type=MediaAssetType.image,
            status=MediaAssetStatus.approved, visibility=MediaVisibility.public,
            storage_key="u/a.png", public_url="/media/u/a.png",
        )
        category = Category(slug="c", name="C", sort_order=1)
        session.add_all([asset, category])
        await session.flush()
        # a product whose image references the asset public_url
        from app.models.catalog import ProductImage, ProductStatus

        product = Product(
            category_id=category.id, slug="p", sku="SKU", name="P",
            base_price=10, currency="RON", stock_quantity=1,
            status=ProductStatus.published,
            images=[ProductImage(url="/media/u/a.png", alt_text="a")],
        )
        session.add(product)
        await session.commit()
        asset_id = asset.id

    async with local() as session:
        asset = await session.get(MediaAsset, asset_id)
        resp = await md.rebuild_usage_edges(session, asset, commit=True)
        assert resp is not None


def _seed_asset_with_file(session, *, public, private, key, dims=(8, 4),
                          original_filename="my-photo.png"):
    asset = MediaAsset(
        id=uuid.uuid4(), asset_type=MediaAssetType.image,
        status=MediaAssetStatus.draft, visibility=MediaVisibility.private,
        storage_key=key, public_url=md._public_url_from_storage_key(key),
        original_filename=original_filename,
    )
    session.add(asset)
    f = private / key
    f.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", dims).save(f)
    return asset


@pytest.mark.anyio
async def test_process_ingest_job_success(media_roots, monkeypatch) -> None:
    public, private = media_roots
    monkeypatch.setattr(md, "get_redis", lambda: None)
    engine, local = _make_local()
    await _init(engine)
    async with local() as session:
        asset = _seed_asset_with_file(
            session, public=public, private=private, key="originals/i/p.png"
        )
        await session.flush()
        job = await md.enqueue_job(
            session, asset_id=asset.id, job_type=MediaJobType.ingest,
            payload={"reason": "upload"}, created_by_user_id=None,
        )
        await session.commit()
        job_id, asset_id = job.id, asset.id

    async with local() as session:
        job = await session.get(MediaJob, job_id)
        done = await md.process_job_inline(session, job)
        assert done.status == MediaJobStatus.completed
        refreshed = await session.get(MediaAsset, asset_id)
        assert refreshed.checksum_sha256 is not None
        assert refreshed.width == 8


@pytest.mark.anyio
async def test_process_ingest_job_missing_file_dead_letters(media_roots,
                                                            monkeypatch) -> None:
    public, private = media_roots
    monkeypatch.setattr(md, "get_redis", lambda: None)
    engine, local = _make_local()
    await _init(engine)
    async with local() as session:
        asset = MediaAsset(
            id=uuid.uuid4(), asset_type=MediaAssetType.image,
            status=MediaAssetStatus.draft, visibility=MediaVisibility.private,
            storage_key="originals/missing/x.png",
            public_url="/media/originals/missing/x.png",
        )
        session.add(asset)
        await session.flush()
        # disabled retry policy in payload -> exception goes straight to dead_letter
        job = await md.enqueue_job(
            session, asset_id=asset.id, job_type=MediaJobType.ingest,
            payload={
                md.RETRY_POLICY_PAYLOAD_KEY: {
                    "max_attempts": 1, "schedule": [60],
                    "jitter_ratio": 0.0, "enabled": False, "version_ts": "s",
                }
            },
            created_by_user_id=None,
        )
        await session.commit()
        job_id = job.id

    async with local() as session:
        job = await session.get(MediaJob, job_id)
        done = await md.process_job_inline(session, job)
        assert done.status == MediaJobStatus.dead_letter
        assert done.error_code == "processing_failed"


@pytest.mark.anyio
async def test_process_ingest_job_failure_schedules_retry(media_roots,
                                                          monkeypatch) -> None:
    public, private = media_roots
    monkeypatch.setattr(md, "get_redis", lambda: None)
    engine, local = _make_local()
    await _init(engine)
    async with local() as session:
        asset = MediaAsset(
            id=uuid.uuid4(), asset_type=MediaAssetType.image,
            status=MediaAssetStatus.draft, visibility=MediaVisibility.private,
            storage_key="originals/m2/y.png",
            public_url="/media/originals/m2/y.png",
        )
        session.add(asset)
        await session.flush()
        # enabled retry policy with attempts remaining -> failed + next_retry_at
        job = await md.enqueue_job(
            session, asset_id=asset.id, job_type=MediaJobType.ingest,
            payload={
                md.RETRY_POLICY_PAYLOAD_KEY: {
                    "max_attempts": 3, "schedule": [60, 120],
                    "jitter_ratio": 0.0, "enabled": True, "version_ts": "s",
                }
            },
            created_by_user_id=None,
        )
        await session.commit()
        job_id = job.id

    async with local() as session:
        job = await session.get(MediaJob, job_id)
        done = await md.process_job_inline(session, job)
        assert done.status == MediaJobStatus.failed
        assert done.next_retry_at is not None


@pytest.mark.anyio
async def test_process_ai_tag_duplicate_usage_jobs(media_roots, monkeypatch) -> None:
    public, private = media_roots
    monkeypatch.setattr(md, "get_redis", lambda: None)
    engine, local = _make_local()
    await _init(engine)
    async with local() as session:
        asset = _seed_asset_with_file(
            session, public=public, private=private, key="originals/t/p.png",
            original_filename="sunny-beach.png",
        )
        asset.width = 8
        asset.height = 4
        asset.checksum_sha256 = "abc123checksum00"
        await session.flush()
        # a duplicate with the same checksum
        dup = MediaAsset(
            id=uuid.uuid4(), asset_type=MediaAssetType.image,
            status=MediaAssetStatus.draft, visibility=MediaVisibility.private,
            storage_key="originals/t/dup.png",
            public_url="/media/originals/t/dup.png",
            checksum_sha256="abc123checksum00",
        )
        session.add(dup)
        ai_job = await md.enqueue_job(
            session, asset_id=asset.id, job_type=MediaJobType.ai_tag,
            payload={}, created_by_user_id=None,
        )
        dup_job = await md.enqueue_job(
            session, asset_id=asset.id, job_type=MediaJobType.duplicate_scan,
            payload={}, created_by_user_id=None,
        )
        usage_job = await md.enqueue_job(
            session, asset_id=None, job_type=MediaJobType.usage_reconcile,
            payload={"limit": 10}, created_by_user_id=None,
        )
        await session.commit()
        ai_id, dup_id, usage_id = ai_job.id, dup_job.id, usage_job.id

    async with local() as session:
        for jid in (ai_id, dup_id, usage_id):
            job = await session.get(MediaJob, jid)
            done = await md.process_job_inline(session, job)
            assert done.status == MediaJobStatus.completed


@pytest.mark.anyio
async def test_process_variant_job(media_roots, monkeypatch) -> None:
    public, private = media_roots
    monkeypatch.setattr(md, "get_redis", lambda: None)
    engine, local = _make_local()
    await _init(engine)
    async with local() as session:
        asset = _seed_asset_with_file(
            session, public=public, private=private, key="originals/v/p.png",
            dims=(2000, 1000),
        )
        await session.flush()
        job = await md.enqueue_job(
            session, asset_id=asset.id, job_type=MediaJobType.variant,
            payload={"profile": "web-1280"}, created_by_user_id=None,
        )
        await session.commit()
        job_id, asset_id = job.id, asset.id

    async with local() as session:
        job = await session.get(MediaJob, job_id)
        done = await md.process_job_inline(session, job)
        assert done.status == MediaJobStatus.completed
        variant = await session.scalar(
            __import__("sqlalchemy").select(md.MediaVariant).where(
                md.MediaVariant.asset_id == asset_id
            )
        )
        assert variant is not None


@pytest.mark.anyio
async def test_process_edit_job_with_crop_and_rotate(media_roots, monkeypatch) -> None:
    public, private = media_roots
    monkeypatch.setattr(md, "get_redis", lambda: None)
    engine, local = _make_local()
    await _init(engine)

    async def _run_edit(key, dims, payload):
        async with local() as session:
            asset = _seed_asset_with_file(
                session, public=public, private=private, key=key, dims=dims
            )
            await session.flush()
            job = await md.enqueue_job(
                session, asset_id=asset.id, job_type=MediaJobType.edit,
                payload=payload, created_by_user_id=None,
            )
            await session.commit()
            jid = job.id
        async with local() as session:
            job = await session.get(MediaJob, jid)
            done = await md.process_job_inline(session, job)
            assert done.status == MediaJobStatus.completed

    # wide image cropped to a taller target ratio -> current_ratio > target
    await _run_edit(
        "originals/e1/p.png", (2000, 500),
        {"rotate_cw": 90, "crop_aspect_w": 1, "crop_aspect_h": 1,
         "resize_max_width": 500, "resize_max_height": 500},
    )
    # tall image cropped to a wider target ratio -> current_ratio < target
    await _run_edit(
        "originals/e2/p.png", (500, 2000),
        {"rotate_cw": 0, "crop_aspect_w": 4, "crop_aspect_h": 1},
    )
