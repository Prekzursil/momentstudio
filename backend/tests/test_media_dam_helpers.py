from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from PIL import Image

from app.models.media import MediaJobType
from app.services import media_dam


class _ExecResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _SessionStub:
    def __init__(self, rows_by_call):
        self._rows_by_call = list(rows_by_call)

    async def execute(self, _stmt):
        await asyncio.sleep(0)
        rows = self._rows_by_call.pop(0)
        return _ExecResult(rows)


@dataclass
class _SessionDeleteStub:
    deleted: object | None = None
    committed: bool = False

    async def delete(self, obj) -> None:
        await asyncio.sleep(0)
        self.deleted = obj

    async def commit(self) -> None:
        await asyncio.sleep(0)
        self.committed = True



def test_retry_policy_payload_parsing() -> None:
    payload = {
        media_dam.RETRY_POLICY_PAYLOAD_KEY: {
            "max_attempts": "4",
            "schedule": ["5", 12, " 20 "],
            "jitter_ratio": "0.4",
            "enabled": False,
            "version_ts": "v1",
        }
    }

    parsed = media_dam._retry_policy_from_payload(payload, job_type=MediaJobType.variant)

    assert parsed is not None
    assert parsed.max_attempts == 4
    assert parsed.schedule == [5, 12, 20]
    assert parsed.jitter_ratio == pytest.approx(0.4)
    assert parsed.enabled is False
    assert parsed.version_ts == "v1"



def test_retry_policy_payload_rejects_invalid_values() -> None:
    payload = {
        media_dam.RETRY_POLICY_PAYLOAD_KEY: {
            "max_attempts": 0,
            "schedule": ["x", None],
        }
    }

    assert media_dam._retry_policy_from_payload(payload, job_type=MediaJobType.variant) is None



def test_parse_schedule_json_ignores_invalid_items() -> None:
    parsed = media_dam._parse_schedule_json('["1", 0, "", "abc", 9]', fallback=[30])
    assert parsed == [1, 1, 9]

    fallback = media_dam._parse_schedule_json('"not-a-list"', fallback=[30, 60])
    assert fallback == [30, 60]



def test_heartbeat_payload_to_worker() -> None:
    now = datetime(2026, 2, 26, tzinfo=timezone.utc)
    payload = {
        "worker_id": "worker-a",
        "hostname": "host-1",
        "pid": "123",
        "app_version": "1.0.0",
        "last_seen_at": "2026-02-25T00:00:00+00:00",
    }

    worker = media_dam._heartbeat_payload_to_worker(payload, key="media:workers:heartbeat:abc", now=now)

    assert worker is not None
    assert worker.worker_id == "worker-a"
    assert worker.hostname == "host-1"
    assert worker.pid == 123
    assert worker.app_version == "1.0.0"
    assert worker.lag_seconds == 86400



def test_heartbeat_payload_to_worker_invalid_timestamp() -> None:
    worker = media_dam._heartbeat_payload_to_worker({"last_seen_at": "bad"}, key="worker:x", now=datetime.now(timezone.utc))
    assert worker is None



def test_purge_candidate_paths_collects_existing_paths(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    primary = tmp_path / "primary.jpg"
    variant = tmp_path / "variant.jpg"

    path_map = {
        "originals/file.jpg": primary,
        "variants/file.jpg": variant,
    }

    def _fake_find(key: str):
        if key == "explode":
            raise RuntimeError("boom")
        return path_map.get(key)

    monkeypatch.setattr(media_dam, "_find_existing_storage_path", _fake_find)

    asset = SimpleNamespace(
        id=uuid4(),
        storage_key="originals/file.jpg",
        variants=[SimpleNamespace(storage_key="variants/file.jpg"), SimpleNamespace(storage_key="explode")],
    )

    paths = media_dam._purge_candidate_paths(asset)
    assert paths == [primary, variant]



def test_unlink_purge_paths_ignores_missing_files(tmp_path: Path) -> None:
    existing = tmp_path / "existing.jpg"
    existing.write_bytes(b"x")
    missing = tmp_path / "missing.jpg"

    media_dam._unlink_purge_paths([existing, missing], asset_id=uuid4())

    assert not existing.exists()


@pytest.mark.anyio("asyncio")
async def test_purge_asset_uses_candidate_paths(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    asset = SimpleNamespace(id=uuid4(), storage_key="originals/file.jpg", variants=[])
    target = tmp_path / "to-delete.jpg"
    target.write_bytes(b"x")

    monkeypatch.setattr(media_dam, "_purge_candidate_paths", lambda _asset: [target])

    session = _SessionDeleteStub()
    await media_dam.purge_asset(session, asset)

    assert session.deleted is asset
    assert session.committed is True
    assert not target.exists()


@pytest.mark.anyio("asyncio")
async def test_usage_ref_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _SessionStub(
        rows_by_call=[
            [(1, "block-a")],
            [(2, "product-a")],
            [("block-b", "en")],
            [("site.social",)],
        ]
    )

    async def _fake_usage_keys(_session, *, url: str):
        await asyncio.sleep(0)
        assert url == "/media/a.jpg"
        return ["block-key"]

    monkeypatch.setattr(media_dam.content_service, "get_asset_usage_keys", _fake_usage_keys)

    refs = await media_dam._collect_usage_refs_for_url(session, url="/media/a.jpg")

    assert ("content_block", "block-key", None, "auto_scan", None) in refs
    assert ("content_image", "block-a", "1", "content_images.url", None) in refs
    assert ("product_image", "product-a", "2", "product_images.url", None) in refs
    assert ("content_translation", "block-b", None, "translations.body_markdown", "en") in refs
    assert ("site_social", "site.social", None, "site.social", None) in refs



def test_render_edited_image_helpers(tmp_path: Path) -> None:
    source = tmp_path / "source.jpg"
    edited = tmp_path / "edited.jpg"

    Image.new("RGB", (120, 80), color=(255, 0, 0)).save(source)

    options = media_dam.MediaEditOptions(
        rotate_cw=90,
        crop_aspect_w=1,
        crop_aspect_h=1,
        resize_max_width=40,
        resize_max_height=40,
    )
    width, height = media_dam._render_edited_image(src_path=source, edited_path=edited, options=options)

    assert edited.exists()
    assert width <= 40
    assert height <= 40



def test_edit_options_from_payload() -> None:
    options = media_dam._edit_options_from_payload(
        {
            "rotate_cw": "180",
            "crop_aspect_w": "4",
            "crop_aspect_h": "3",
            "resize_max_width": "200",
            "resize_max_height": "100",
        }
    )

    assert options.rotate_cw == 180
    assert options.crop_aspect_w == "4"
    assert options.resize_max_width == "200"
