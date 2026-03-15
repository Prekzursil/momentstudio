from __future__ import annotations
import asyncio

from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from PIL import Image

from app.schemas.content import ContentImageEditRequest
from app.services import content as content_service


class _ScalarSession:
    def __init__(self, values: list[object | None]) -> None:
        self._values = list(values)

    async def scalar(self, _stmt: object) -> object | None:
        await asyncio.sleep(0)
        if not self._values:
            return None
        return self._values.pop(0)


@pytest.mark.anyio
async def test_content_resolve_redirect_key_chain_loop_and_empty_paths() -> None:
    empty_session = _ScalarSession([])
    assert await content_service.resolve_redirect_key(empty_session, "") == ""

    chain_session = _ScalarSession([
        SimpleNamespace(to_key='page.step-1'),
        SimpleNamespace(to_key='page.final'),
        None,
    ])
    assert await content_service.resolve_redirect_key(chain_session, 'page.start') == 'page.final'

    loop_session = _ScalarSession([
        SimpleNamespace(to_key='page.loop'),
        SimpleNamespace(to_key='page.loop'),
    ])
    with pytest.raises(HTTPException, match='redirect loop'):
        await content_service.resolve_redirect_key(loop_session, 'page.loop', max_hops=4)


@pytest.mark.anyio
async def test_content_resolve_available_page_key_validation_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _fake_resolve(_session: object, _new_key: str) -> str:
        await asyncio.sleep(0)
        return 'page.other'

    monkeypatch.setattr(content_service, 'resolve_redirect_key', _fake_resolve)

    ok_session = _ScalarSession([None, None])
    norm, key = await content_service._resolve_available_page_key(
        ok_session,
        old_norm='about',
        old_key='page.about',
        new_slug='new-about',
    )
    assert norm == 'new-about'
    assert key == 'page.new-about'

    same_session = _ScalarSession([])
    with pytest.raises(HTTPException, match='must be different'):
        await content_service._resolve_available_page_key(
            same_session,
            old_norm='story',
            old_key='page.story',
            new_slug='story',
        )

    existing_session = _ScalarSession([1])
    with pytest.raises(HTTPException, match='already exists'):
        await content_service._resolve_available_page_key(
            existing_session,
            old_norm='about',
            old_key='page.about',
            new_slug='exists',
        )

    reserved_session = _ScalarSession([None, 1])
    with pytest.raises(HTTPException, match='reserved by a redirect'):
        await content_service._resolve_available_page_key(
            reserved_session,
            old_norm='about',
            old_key='page.about',
            new_slug='reserved',
        )


def test_content_image_edit_rotate_crop_resize_and_save(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    img = Image.new('RGB', (120, 80), color='white')

    rotate90 = ContentImageEditRequest(rotate_cw=90)
    rotated, fx, fy = content_service._rotate_image_with_focal(
        img,
        payload=rotate90,
        base_w=120,
        base_h=80,
        fx=60,
        fy=20,
    )
    assert rotated.size == (80, 120)
    assert (fx, fy) == (60, 60)

    no_crop_payload = ContentImageEditRequest(rotate_cw=180)
    unchanged, fx2, fy2 = content_service._crop_image_with_focal(img, payload=no_crop_payload, fx=50, fy=30)
    assert unchanged.size == (120, 80)
    assert (fx2, fy2) == (50, 30)

    crop_payload = ContentImageEditRequest(rotate_cw=90, crop_aspect_w=1, crop_aspect_h=1)
    cropped, cfx, cfy = content_service._crop_image_with_focal(img, payload=crop_payload, fx=10, fy=10)
    assert cropped.size[0] == cropped.size[1]
    assert cfx >= 0 and cfy >= 0

    resize_same = ContentImageEditRequest(rotate_cw=90, resize_max_width=500)
    same_size, _, _ = content_service._resize_image_with_focal(img, payload=resize_same, fx=40, fy=20)
    assert same_size.size == (120, 80)

    resize_payload = ContentImageEditRequest(rotate_cw=90, resize_max_width=60, resize_max_height=40)
    resized, rfx, rfy = content_service._resize_image_with_focal(img, payload=resize_payload, fx=60, fy=20)
    assert resized.size == (60, 40)
    assert rfx == pytest.approx(30)
    assert rfy == pytest.approx(10)

    monkeypatch.setattr(content_service.storage, 'ensure_media_root', lambda: tmp_path)
    monkeypatch.setattr(content_service.storage, 'generate_thumbnails', lambda _dest: None)
    saved_url = content_service._save_edited_image(resized, suffix='.jpg', out_format='JPEG')
    assert saved_url.startswith('/media/')
    saved_path = tmp_path / saved_url.removeprefix('/media/')
    assert saved_path.exists()


def test_content_block_url_and_target_registration_helpers() -> None:
    carousel_refs = content_service._block_urls_carousel(
        {'slides': [{'image_url': '/a.jpg', 'cta_url': '/shop/rings'}, {'image_url': '/b.jpg', 'cta_url': '/shop/bracelets'}]}
    )
    assert ('image', '/a.jpg') in carousel_refs
    assert ('link', '/shop/bracelets') in carousel_refs

    category_slugs: set[str] = set()
    content_service._register_shop_targets('/shop/rings', 'sub=bracelets&category=chains', category_slugs=category_slugs)
    assert {'rings', 'bracelets', 'chains'}.issubset(category_slugs)

    assert content_service._normalize_content_path('/media/sample.jpg', 'media/sample.jpg') == 'media/sample.jpg'
    media_urls: set[str] = set()
    assert content_service._register_media_target('/media/catalog/a.jpg', media_urls=media_urls) is True
    assert '/media/catalog/a.jpg' in media_urls
    assert content_service._register_product_target('/products/ring-one', product_slugs=set()) is True



