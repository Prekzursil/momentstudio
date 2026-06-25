"""Worker-0 third coverage delta for ``app.services.media_dam``.

Targets the residual branch arcs left after ``delta2``: validation guards, the
per-field ``apply_asset_update`` branches, i18n/tag replacement against existing
rows, the telemetry redis scan, list/history filter clauses, retry-policy
rollback, edit wide-crop, and usage-edge collection against real referencing
rows.
"""

from __future__ import annotations

import json
import uuid
from datetime import timezone

import pytest
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.db.base import Base
from app.models.catalog import Category, Product, ProductImage
from app.models.content import (
    ContentBlock,
    ContentImage,
)
from app.models.media import (
    MediaAsset,
    MediaAssetI18n,
    MediaAssetStatus,
    MediaAssetTag,
    MediaAssetType,
    MediaJob,
    MediaJobStatus,
    MediaJobType,
    MediaTag,
    MediaVisibility,
)
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
# validation guards
# --------------------------------------------------------------------------- #


def test_validate_policy_payload_attempts_and_jitter_bounds() -> None:
    # The pydantic schema clamps these, so bypass validation with model_construct
    # to reach the service-level defensive guards.
    with pytest.raises(ValueError, match="max_attempts"):
        md._validate_policy_payload(
            MediaRetryPolicyUpdateRequest.model_construct(max_attempts=999)
        )
    with pytest.raises(ValueError, match="jitter_ratio"):
        md._validate_policy_payload(
            MediaRetryPolicyUpdateRequest.model_construct(jitter_ratio=2.0)
        )


def test_move_file_falls_back_to_shutil(tmp_path, monkeypatch) -> None:
    src = tmp_path / "a.txt"
    dst = tmp_path / "sub" / "b.txt"
    dst.parent.mkdir()
    src.write_bytes(b"data")

    original_replace = md.Path.replace

    def _replace(self, target):
        if self == src:
            raise OSError("cross-device")
        return original_replace(self, target)

    monkeypatch.setattr(md.Path, "replace", _replace)
    md._move_file(src, dst)
    assert dst.read_bytes() == b"data"


# --------------------------------------------------------------------------- #
# apply_asset_update: per-field branches + no-op
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_apply_asset_update_no_fields_is_noop(media_roots) -> None:
    engine, Session = _make_local()
    await _init(engine)
    async with Session() as session:
        asset = MediaAsset(
            id=uuid.uuid4(),
            asset_type=MediaAssetType.image,
            status=MediaAssetStatus.draft,
            visibility=MediaVisibility.private,
            storage_key="originals/n.jpg",
            public_url="/media/originals/n.jpg",
        )
        session.add(asset)
        await session.commit()
        await session.refresh(asset)
        # Empty payload: every ``if payload.<field>`` guard takes the false arc
        # and visibility does not change -> no move.
        await md.apply_asset_update(session, asset, MediaAssetUpdateRequest())
        await session.commit()
        assert asset.status == MediaAssetStatus.draft


@pytest.mark.anyio
async def test_apply_asset_update_replaces_existing_i18n_and_tags(media_roots) -> None:
    engine, Session = _make_local()
    await _init(engine)
    asset_id = uuid.uuid4()
    async with Session() as session:
        asset = MediaAsset(
            id=asset_id,
            asset_type=MediaAssetType.image,
            status=MediaAssetStatus.draft,
            visibility=MediaVisibility.private,
            storage_key="originals/e.jpg",
            public_url="/media/originals/e.jpg",
        )
        session.add(asset)
        await session.flush()
        # Pre-existing i18n row + tag link so replace takes the update / delete arcs.
        session.add(MediaAssetI18n(asset_id=asset_id, lang="en", title="old"))
        tag = MediaTag(value="oldtag")
        session.add(tag)
        await session.flush()
        session.add(MediaAssetTag(asset_id=asset_id, tag_id=tag.id))
        await session.commit()

    async with Session() as session:
        asset = await md.get_asset_or_404(session, asset_id)
        payload = MediaAssetUpdateRequest(
            i18n=[
                MediaAssetUpdateI18nItem(lang="en", title="new"),
                MediaAssetUpdateI18nItem(lang="en", title="dup"),  # seen-lang skip
            ],
            tags=["newtag"],  # oldtag dropped (delete arc), newtag created
        )
        await md.apply_asset_update(session, asset, payload)
        await session.commit()

    async with Session() as session:
        asset = await md.get_asset_or_404(session, asset_id)
        read = md.asset_to_read(asset)
        assert read.tags == ["newtag"]
        assert any(i.title == "new" for i in read.i18n)


@pytest.mark.anyio
async def test_replace_asset_tags_caps_at_30(media_roots) -> None:
    engine, Session = _make_local()
    await _init(engine)
    asset_id = uuid.uuid4()
    async with Session() as session:
        asset = MediaAsset(
            id=asset_id,
            asset_type=MediaAssetType.image,
            status=MediaAssetStatus.draft,
            visibility=MediaVisibility.private,
            storage_key="originals/cap.jpg",
            public_url="/media/originals/cap.jpg",
        )
        session.add(asset)
        await session.commit()

    async with Session() as session:
        asset = await md.get_asset_or_404(session, asset_id)
        # 35 distinct tags -> break at 30.
        await md._replace_asset_tags(session, asset, [f"tag{i}" for i in range(35)])
        await session.commit()

    async with Session() as session:
        asset = await md.get_asset_or_404(session, asset_id)
        assert len(md.asset_to_read(asset).tags) == 30


# --------------------------------------------------------------------------- #
# asset_to_read i18n lang coercion
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_asset_to_read_coerces_unknown_lang(media_roots) -> None:
    engine, Session = _make_local()
    await _init(engine)
    asset_id = uuid.uuid4()
    async with Session() as session:
        asset = MediaAsset(
            id=asset_id,
            asset_type=MediaAssetType.image,
            status=MediaAssetStatus.draft,
            visibility=MediaVisibility.private,
            storage_key="originals/lang.jpg",
            public_url="/media/originals/lang.jpg",
        )
        session.add(asset)
        await session.flush()
        session.add(MediaAssetI18n(asset_id=asset_id, lang="fr", title="bonjour"))
        await session.commit()

    async with Session() as session:
        asset = await md.get_asset_or_404(session, asset_id)
        read = md.asset_to_read(asset)
        # Unknown lang coerced to "en".
        assert read.i18n[0].lang == "en"


# --------------------------------------------------------------------------- #
# telemetry redis scan
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_get_telemetry_with_redis_workers(media_roots, monkeypatch) -> None:
    engine, Session = _make_local()
    await _init(engine)
    prefix = "media:workers:heartbeat:unit"
    monkeypatch.setattr(settings, "media_dam_worker_heartbeat_prefix", prefix)
    monkeypatch.setattr(settings, "media_dam_telemetry_heartbeat_scan_limit", 10)
    now = md._now()

    class FakeRedis:
        def __init__(self) -> None:
            self.payloads = {
                f"{prefix}:w1": json.dumps(
                    {
                        "worker_id": "w1",
                        "hostname": "h1",
                        "pid": 10,
                        "app_version": "v1",
                        "last_seen_at": now.isoformat(),
                    }
                ),
                # naive datetime -> tz added; pid non-digit -> None
                f"{prefix}:w2": json.dumps(
                    {
                        "hostname": "",
                        "pid": "x",
                        "last_seen_at": now.replace(tzinfo=None).isoformat(),
                    }
                ),
                f"{prefix}:w3": "",  # falsy raw -> skipped
                f"{prefix}:w4": json.dumps(
                    {"last_seen_at": "not-a-date"}
                ),  # parse fail
            }

        def llen(self, key):
            return 3

        def scan_iter(self, *, match):
            async def _aiter():
                for key in sorted(self.payloads):
                    yield key

            return _aiter()

        def get(self, key):
            value = self.payloads.get(key)
            return value.encode("utf-8") if key.endswith("w1") else value

    monkeypatch.setattr(md, "get_redis", lambda: FakeRedis())
    async with Session() as session:
        resp = await md.get_telemetry(session)
        assert resp.queue_depth == 3
        # w1 + w2 valid; w3 empty, w4 unparsable -> 2 online.
        assert resp.online_workers == 2


@pytest.mark.anyio
async def test_get_telemetry_redis_llen_failure(media_roots, monkeypatch) -> None:
    engine, Session = _make_local()
    await _init(engine)

    class FakeRedis:
        def llen(self, key):
            raise RuntimeError("redis down")

        def scan_iter(self, *, match):
            raise RuntimeError("scan down")

        def get(self, key):
            return None

    monkeypatch.setattr(md, "get_redis", lambda: FakeRedis())
    async with Session() as session:
        resp = await md.get_telemetry(session)
        assert resp.queue_depth == 0
        assert resp.online_workers == 0


# --------------------------------------------------------------------------- #
# list_jobs tag filter + history job_type filter
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_list_jobs_tag_filter(media_roots) -> None:
    engine, Session = _make_local()
    await _init(engine)
    async with Session() as session:
        job = MediaJob(
            id=uuid.uuid4(),
            job_type=MediaJobType.ingest,
            status=MediaJobStatus.queued,
        )
        session.add(job)
        await session.commit()
        rows, counts = await md.list_jobs(session, md.MediaJobListFilters(tag="needle"))
        assert isinstance(rows, list)
        assert isinstance(counts, dict)


@pytest.mark.anyio
async def test_list_retry_policy_history_job_type_filter(media_roots) -> None:
    engine, Session = _make_local()
    await _init(engine)
    async with Session() as session:
        rows, counts = await md.list_retry_policy_history(session, job_type="ingest")
        assert isinstance(rows, list)
        assert "total_items" in counts


# --------------------------------------------------------------------------- #
# rollback_retry_policy via preset (no existing row)
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_rollback_retry_policy_preset_creates_row(media_roots) -> None:
    engine, Session = _make_local()
    await _init(engine)
    async with Session() as session:
        presets = await md.get_retry_policy_presets(
            session, job_type=MediaJobType.ingest
        )
        preset_key = presets.items[0].preset_key
        result = await md.rollback_retry_policy(
            session,
            job_type=MediaJobType.ingest,
            payload=MediaRetryPolicyRollbackRequest(preset_key=preset_key),
            actor_user_id=None,
        )
        assert result.job_type == MediaJobType.ingest.value


# --------------------------------------------------------------------------- #
# edit wide-crop branch (current_ratio > target_ratio)
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_process_edit_wide_crop_branch(media_roots) -> None:
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
            storage_key="originals/wide.jpg",
            public_url="/media/originals/wide.jpg",
        )
        path = private / "originals" / "wide.jpg"
        path.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (80, 20), (1, 2, 3)).save(path, format="JPEG")
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
# _collect_usage_refs against real referencing rows
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_rebuild_usage_edges_with_real_refs(media_roots) -> None:
    engine, Session = _make_local()
    await _init(engine)
    asset_id = uuid.uuid4()
    url = "/media/originals/ref.jpg"
    async with Session() as session:
        asset = MediaAsset(
            id=asset_id,
            asset_type=MediaAssetType.image,
            status=MediaAssetStatus.draft,
            visibility=MediaVisibility.private,
            storage_key="originals/ref.jpg",
            public_url=url,
        )
        session.add(asset)

        block = ContentBlock(
            id=uuid.uuid4(), key="home.hero", title="Hero", body_markdown="x"
        )
        session.add(block)
        await session.flush()
        session.add(ContentImage(id=uuid.uuid4(), content_block_id=block.id, url=url))

        category = Category(id=uuid.uuid4(), slug="cat-1", name="Cat 1")
        session.add(category)
        await session.flush()
        product = Product(
            id=uuid.uuid4(),
            category_id=category.id,
            sku="SKU1",
            slug="prod-1",
            name="Prod 1",
        )
        session.add(product)
        await session.flush()
        session.add(ProductImage(id=uuid.uuid4(), product_id=product.id, url=url))
        await session.commit()

    async with Session() as session:
        asset = await md.get_asset_or_404(session, asset_id)
        resp = await md.rebuild_usage_edges(session, asset, commit=True)
        source_types = {item.source_type for item in resp.items}
        assert "content_image" in source_types
        assert "product_image" in source_types
