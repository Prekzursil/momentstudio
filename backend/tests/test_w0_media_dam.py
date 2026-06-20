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
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.media import (
    MediaAsset,
    MediaAssetStatus,
    MediaAssetType,
    MediaJobRetryPolicy,
    MediaJobType,
    MediaVisibility,
)
from app.schemas.media import MediaRetryPolicyUpdateRequest
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
