from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

from fastapi import HTTPException, status
import pytest

from app.api.v1 import content as content_api


class _Session:
    def __init__(self) -> None:
        self.commits = 0

    async def commit(self):
        self.commits += 1


@pytest.mark.anyio
async def test_content_media_asset_mutations_raise_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _missing_asset(*_args, **_kwargs):
        raise ValueError('missing asset')

    monkeypatch.setattr(content_api.media_dam, 'get_asset_or_404', _missing_asset)
    monkeypatch.setattr(content_api, '_require_owner_or_admin', lambda *_args, **_kwargs: None)

    admin = SimpleNamespace(id=uuid4())
    session = _Session()
    payload_update = SimpleNamespace()
    payload_note = SimpleNamespace(note='review')

    with pytest.raises(HTTPException) as update_missing:
        await content_api.admin_update_media_asset(uuid4(), payload_update, session, admin)
    assert update_missing.value.status_code == status.HTTP_404_NOT_FOUND

    with pytest.raises(HTTPException) as approve_missing:
        await content_api.admin_approve_media_asset(uuid4(), payload_note, session, admin)
    assert approve_missing.value.status_code == status.HTTP_404_NOT_FOUND

    with pytest.raises(HTTPException) as reject_missing:
        await content_api.admin_reject_media_asset(uuid4(), payload_note, session, admin)
    assert reject_missing.value.status_code == status.HTTP_404_NOT_FOUND

    with pytest.raises(HTTPException) as delete_missing:
        await content_api.admin_soft_delete_media_asset(uuid4(), session, admin)
    assert delete_missing.value.status_code == status.HTTP_404_NOT_FOUND

    with pytest.raises(HTTPException) as restore_missing:
        await content_api.admin_restore_media_asset(uuid4(), session, admin)
    assert restore_missing.value.status_code == status.HTTP_404_NOT_FOUND

    with pytest.raises(HTTPException) as purge_missing:
        await content_api.admin_purge_media_asset(uuid4(), session, admin)
    assert purge_missing.value.status_code == status.HTTP_404_NOT_FOUND

    with pytest.raises(HTTPException) as usage_missing:
        await content_api.admin_media_asset_usage(uuid4(), session, admin)
    assert usage_missing.value.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.anyio
async def test_content_media_preview_signature_and_variant_error_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    asset_id = uuid4()
    asset = SimpleNamespace(id=asset_id)

    async def _asset_ok(*_args, **_kwargs):
        return asset

    monkeypatch.setattr(content_api.media_dam, 'get_asset_or_404', _asset_ok)
    session = _Session()

    monkeypatch.setattr(content_api.media_dam, 'verify_preview_signature', lambda *_args, **_kwargs: False)
    with pytest.raises(HTTPException) as bad_sig:
        await content_api.admin_media_asset_preview(asset_id, exp=123, sig='x' * 16, variant_profile=None, session=session)
    assert bad_sig.value.status_code == status.HTTP_403_FORBIDDEN

    monkeypatch.setattr(content_api.media_dam, 'verify_preview_signature', lambda *_args, **_kwargs: True)
    monkeypatch.setattr(content_api.media_dam, 'resolve_asset_preview_path', lambda *_args, **_kwargs: (_ for _ in ()).throw(ValueError('no variant')))
    with pytest.raises(HTTPException) as missing_variant:
        await content_api.admin_media_asset_preview(asset_id, exp=123, sig='x' * 16, variant_profile='thumb', session=session)
    assert missing_variant.value.status_code == status.HTTP_404_NOT_FOUND

    monkeypatch.setattr(content_api.media_dam, 'resolve_asset_preview_path', lambda *_args, **_kwargs: (_ for _ in ()).throw(FileNotFoundError('missing file')))
    with pytest.raises(HTTPException) as missing_file:
        await content_api.admin_media_asset_preview(asset_id, exp=123, sig='x' * 16, variant_profile='thumb', session=session)
    assert missing_file.value.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.anyio
async def test_content_media_preview_success_path_returns_file(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    asset = SimpleNamespace(id=uuid4())
    media_file = tmp_path / 'preview.jpg'
    media_file.write_bytes(b'jpeg-bytes')

    async def _asset_ok(*_args, **_kwargs):
        return asset

    monkeypatch.setattr(content_api.media_dam, 'get_asset_or_404', _asset_ok)
    monkeypatch.setattr(content_api.media_dam, 'verify_preview_signature', lambda *_args, **_kwargs: True)
    monkeypatch.setattr(content_api.media_dam, 'resolve_asset_preview_path', lambda *_args, **_kwargs: media_file)

    response = await content_api.admin_media_asset_preview(
        asset.id,
        exp=123,
        sig='y' * 16,
        variant_profile='thumb',
        session=_Session(),
    )
    assert Path(response.path) == media_file


@pytest.mark.anyio
async def test_content_background_media_runner_swallows_processing_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    class _Ctx:
        async def __aenter__(self):
            return _Session()

        async def __aexit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr('app.db.session.SessionLocal', lambda: _Ctx())

    async def _missing_job(*_args, **_kwargs):
        raise RuntimeError('job missing')

    monkeypatch.setattr(content_api.media_dam, 'get_job_or_404', _missing_job)
    await content_api._run_media_job_in_background(uuid4())

