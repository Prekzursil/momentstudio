import asyncio
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from io import BytesIO
from typing import Dict

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.main import app
from app.db.base import Base
from app.db.session import get_session
from app.schemas.user import UserCreate
from app.services.auth import create_user, issue_tokens_for_user
from app.models.user import UserRole
from app.models.passkeys import UserPasskey
from app.services import social_thumbnails
import httpx
from app.models.content import ContentRedirect
from app.models.catalog import Category, Product, ProductStatus
from app.core import security


@pytest.fixture
def test_app() -> Dict[str, object]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

    async def init_models() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(init_models())

    async def override_get_session():
        async with SessionLocal() as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session
    client = TestClient(app)
    yield {"client": client, "session_factory": SessionLocal}
    client.close()
    app.dependency_overrides.clear()


def auth_headers(token: str) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {token}"}
    payload = security.decode_token(token)
    if payload and payload.get("sub"):
        headers["X-Admin-Step-Up"] = security.create_step_up_token(str(payload["sub"]))
    return headers


def create_admin_token(session_factory) -> str:
    async def create_and_token():
        async with session_factory() as session:
            user = await create_user(session, UserCreate(email="cms@example.com", password="cmspassword", name="CMS"))
            user.role = UserRole.admin
            session.add(
                UserPasskey(
                    user_id=user.id,
                    name="Test Passkey",
                    credential_id=f"cred-{user.id}",
                    public_key=b"test",
                    sign_count=0,
                    backed_up=False,
                )
            )
            await session.commit()
            tokens = await issue_tokens_for_user(session, user)
            return tokens["access_token"]

    return asyncio.run(create_and_token())


def _jpeg_bytes() -> bytes:
    buf = BytesIO()
    Image.new("RGB", (1, 1), color=(255, 0, 0)).save(buf, format="JPEG")
    return buf.getvalue()


def test_content_asset_delete_versions_flag(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]
    admin_token = create_admin_token(SessionLocal)

    img_resp = client.post(
        "/api/v1/content/admin/home.hero/images",
        files={"file": ("hero.jpg", _jpeg_bytes(), "image/jpeg")},
        headers=auth_headers(admin_token),
    )
    assert img_resp.status_code == 200

    assets = client.get("/api/v1/content/admin/assets/images", headers=auth_headers(admin_token))
    assert assets.status_code == 200, assets.text
    first_img = assets.json()["items"][0]

    edited = client.post(
        f"/api/v1/content/admin/assets/images/{first_img['id']}/edit",
        json={"rotate_cw": 90},
        headers=auth_headers(admin_token),
    )
    assert edited.status_code == 201, edited.text
    edited_json = edited.json()

    blocked = client.delete(
        f"/api/v1/content/admin/assets/images/{first_img['id']}",
        headers=auth_headers(admin_token),
    )
    assert blocked.status_code == 409, blocked.text

    deleted = client.delete(
        f"/api/v1/content/admin/assets/images/{first_img['id']}",
        params={"delete_versions": 1},
        headers=auth_headers(admin_token),
    )
    assert deleted.status_code == 204, deleted.text

    missing_edit = client.delete(
        f"/api/v1/content/admin/assets/images/{edited_json['id']}",
        headers=auth_headers(admin_token),
    )
    assert missing_edit.status_code == 404, missing_edit.text


def test_content_crud_and_public(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]
    admin_token = create_admin_token(SessionLocal)

    async def create_customer_token() -> str:
        async with SessionLocal() as session:
            user = await create_user(session, UserCreate(email="user@example.com", password="password123", name="User"))
            user.role = UserRole.customer
            await session.commit()
            tokens = await issue_tokens_for_user(session, user)
            return tokens["access_token"]

    user_token = asyncio.run(create_customer_token())

    # Create
    create = client.post(
        "/api/v1/content/admin/home.hero",
        json={"title": "Hero", "body_markdown": "Welcome!", "status": "published", "meta": {"headline": "Hero"}, "lang": "en"},
        headers=auth_headers(admin_token),
    )
    assert create.status_code == 201, create.text
    assert create.json()["version"] == 1
    assert create.json()["meta"]["headline"] == "Hero"
    assert create.json()["needs_translation_en"] is False
    assert create.json()["needs_translation_ro"] is True

    public = client.get("/api/v1/content/home.hero")
    assert public.status_code == 200
    assert public.json()["title"] == "Hero"
    assert public.json()["meta"]["headline"] == "Hero"

    # Publish window: an expired block should not be visible publicly.
    now = datetime.now(timezone.utc)
    expired = client.post(
        "/api/v1/content/admin/site.expired",
        json={
            "title": "Expired",
            "body_markdown": "Expired body",
            "status": "published",
            "published_at": (now - timedelta(days=2)).isoformat(),
            "published_until": (now - timedelta(days=1)).isoformat(),
        },
        headers=auth_headers(admin_token),
    )
    assert expired.status_code == 201, expired.text
    expired_public = client.get("/api/v1/content/site.expired")
    assert expired_public.status_code == 404, expired_public.text

    active = client.post(
        "/api/v1/content/admin/site.active",
        json={
            "title": "Active",
            "body_markdown": "Active body",
            "status": "published",
            "published_at": (now - timedelta(days=1)).isoformat(),
            "published_until": (now + timedelta(days=1)).isoformat(),
        },
        headers=auth_headers(admin_token),
    )
    assert active.status_code == 201, active.text
    active_public = client.get("/api/v1/content/site.active")
    assert active_public.status_code == 200, active_public.text
    assert active_public.json()["title"] == "Active"

    # Update increments version
    update = client.patch(
        "/api/v1/content/admin/home.hero",
        json={"body_markdown": "Updated body", "status": "published", "sort_order": 5},
        headers=auth_headers(admin_token),
    )
    assert update.status_code == 200
    assert update.json()["version"] == 2
    assert update.json()["body_markdown"] == "Updated body"
    assert update.json()["sort_order"] == 5

    # Optimistic locking rejects stale writes
    stale = client.patch(
        "/api/v1/content/admin/home.hero",
        json={"body_markdown": "Stale write", "expected_version": 1},
        headers=auth_headers(admin_token),
    )
    assert stale.status_code == 409, stale.text

    ok_lock = client.patch(
        "/api/v1/content/admin/home.hero",
        json={"body_markdown": "Fresh write", "expected_version": 2},
        headers=auth_headers(admin_token),
    )
    assert ok_lock.status_code == 200, ok_lock.text
    assert ok_lock.json()["version"] == 3

    # Validation rejects script
    bad = client.patch(
        "/api/v1/content/admin/home.hero",
        json={"body_markdown": "<script>alert(1)</script>"},
        headers=auth_headers(admin_token),
    )
    assert bad.status_code == 422

    # Static page slug
    client.post(
        "/api/v1/content/admin/page.faq",
        json={"title": "FAQ", "body_markdown": "FAQ body", "status": "published", "meta": {"priority": 1}},
        headers=auth_headers(admin_token),
    )
    page = client.get("/api/v1/content/pages/faq")
    assert page.status_code == 200
    assert page.json()["title"] == "FAQ"
    assert page.json()["meta"]["priority"] == 1

    restricted = client.post(
        "/api/v1/content/admin/page.secret",
        json={"title": "Secret", "body_markdown": "Hidden", "status": "published", "meta": {"requires_auth": True}},
        headers=auth_headers(admin_token),
    )
    assert restricted.status_code == 201, restricted.text

    restricted_public = client.get("/api/v1/content/pages/secret")
    assert restricted_public.status_code == 401, restricted_public.text

    restricted_authed = client.get("/api/v1/content/pages/secret", headers=auth_headers(user_token))
    assert restricted_authed.status_code == 200, restricted_authed.text

    sitemap = client.get("/api/v1/sitemap.xml")
    assert sitemap.status_code == 200
    assert "pages/secret?lang=en" not in sitemap.text

    # Draft not visible publicly
    client.patch(
        "/api/v1/content/admin/page.about",
        json={"title": "About", "body_markdown": "Draft only", "status": "draft"},
        headers=auth_headers(admin_token),
    )
    missing = client.get("/api/v1/content/page.about")
    assert missing.status_code == 404

    # Preview token works for draft
    preview = client.get("/api/v1/content/admin/page.about/preview", params={"token": "preview-token"})
    assert preview.status_code == 200

    # Shareable preview token works for draft page
    page_token_resp = client.post(
        "/api/v1/content/pages/about/preview-token",
        headers=auth_headers(admin_token),
    )
    assert page_token_resp.status_code == 200, page_token_resp.text
    page_token = page_token_resp.json()["token"]
    page_preview = client.get(
        "/api/v1/content/pages/about/preview",
        params={"token": page_token},
    )
    assert page_preview.status_code == 200, page_preview.text
    assert page_preview.headers.get("cache-control") == "private, no-store"
    assert page_preview.json()["key"] == "page.about"

    # Shareable preview token works for home preview
    home_sections_create = client.post(
        "/api/v1/content/admin/home.sections",
        json={"title": "Home sections", "body_markdown": "Layout", "status": "draft", "meta": {}},
        headers=auth_headers(admin_token),
    )
    assert home_sections_create.status_code in (200, 201), home_sections_create.text
    home_story_create = client.post(
        "/api/v1/content/admin/home.story",
        json={"title": "Story", "body_markdown": "Draft story", "status": "draft"},
        headers=auth_headers(admin_token),
    )
    assert home_story_create.status_code in (200, 201), home_story_create.text
    home_token_resp = client.post(
        "/api/v1/content/home/preview-token",
        headers=auth_headers(admin_token),
    )
    assert home_token_resp.status_code == 200, home_token_resp.text
    home_token = home_token_resp.json()["token"]
    home_preview = client.get(
        "/api/v1/content/home/preview",
        params={"token": home_token},
    )
    assert home_preview.status_code == 200, home_preview.text
    assert home_preview.headers.get("cache-control") == "private, no-store"
    home_preview_json = home_preview.json()
    assert home_preview_json["sections"]["key"] == "home.sections"
    assert home_preview_json["story"]["key"] == "home.story"

    # Image upload
    img_resp = client.post(
        "/api/v1/content/admin/home.hero/images",
        files={"file": ("hero.jpg", _jpeg_bytes(), "image/jpeg")},
        headers=auth_headers(admin_token),
    )
    assert img_resp.status_code == 200
    assert len(img_resp.json()["images"]) == 1

    assets = client.get("/api/v1/content/admin/assets/images", headers=auth_headers(admin_token))
    assert assets.status_code == 200, assets.text
    data = assets.json()
    assert data["meta"]["total_items"] >= 1
    assert any(item["content_key"] == "home.hero" for item in data["items"])
    first_img = data["items"][0]
    assert "focal_x" in first_img
    assert "focal_y" in first_img
    assert first_img["root_image_id"] is None
    assert first_img["source_image_id"] is None

    # Asset tags: set tags and filter by tag.
    tag_set = client.patch(
        f"/api/v1/content/admin/assets/images/{first_img['id']}/tags",
        json={"tags": ["Hero", " Homepage ", "hero"]},
        headers=auth_headers(admin_token),
    )
    assert tag_set.status_code == 200, tag_set.text
    assert tag_set.json()["tags"] == ["hero", "homepage"]

    focal_set = client.patch(
        f"/api/v1/content/admin/assets/images/{first_img['id']}/focal",
        json={"focal_x": 25, "focal_y": 80},
        headers=auth_headers(admin_token),
    )
    assert focal_set.status_code == 200, focal_set.text
    assert focal_set.json()["focal_x"] == 25
    assert focal_set.json()["focal_y"] == 80

    edited = client.post(
        f"/api/v1/content/admin/assets/images/{first_img['id']}/edit",
        json={"rotate_cw": 90},
        headers=auth_headers(admin_token),
    )
    assert edited.status_code == 201, edited.text
    edited_json = edited.json()
    assert edited_json["id"] != first_img["id"]
    assert edited_json["root_image_id"] == first_img["id"]
    assert edited_json["source_image_id"] == first_img["id"]
    assert edited_json["content_key"] == "home.hero"
    assert set(edited_json["tags"]) == {"hero", "homepage"}
    assert edited_json["focal_x"] == 20
    assert edited_json["focal_y"] == 25

    client.patch(
        "/api/v1/content/admin/page.about",
        json={"title": "About", "body_markdown": f"Uses {first_img['url']}", "status": "draft"},
        headers=auth_headers(admin_token),
    )
    usage = client.get(
        f"/api/v1/content/admin/assets/images/{first_img['id']}/usage",
        headers=auth_headers(admin_token),
    )
    assert usage.status_code == 200, usage.text
    usage_json = usage.json()
    assert usage_json["stored_in_key"] == "home.hero"
    usage_keys = usage_json["keys"]
    assert "page.about" in usage_keys

    tagged = client.get(
        "/api/v1/content/admin/assets/images",
        params={"tag": "hero"},
        headers=auth_headers(admin_token),
    )
    assert tagged.status_code == 200, tagged.text
    assert any("hero" in (item.get("tags") or []) for item in tagged.json()["items"])

    assets_filtered = client.get(
        "/api/v1/content/admin/assets/images",
        params={"key": "home.hero"},
        headers=auth_headers(admin_token),
    )
    assert assets_filtered.status_code == 200, assets_filtered.text
    assert all(item["content_key"] == "home.hero" for item in assets_filtered.json()["items"])

    # Delete: blocked while used, then requires deleting edited versions first.
    delete_used = client.delete(
        f"/api/v1/content/admin/assets/images/{first_img['id']}",
        headers=auth_headers(admin_token),
    )
    assert delete_used.status_code == 409, delete_used.text

    client.patch(
        "/api/v1/content/admin/page.about",
        json={"title": "About", "body_markdown": "No usage", "status": "draft"},
        headers=auth_headers(admin_token),
    )
    delete_with_versions = client.delete(
        f"/api/v1/content/admin/assets/images/{first_img['id']}",
        headers=auth_headers(admin_token),
    )
    assert delete_with_versions.status_code == 409, delete_with_versions.text

    delete_edited = client.delete(
        f"/api/v1/content/admin/assets/images/{edited_json['id']}",
        headers=auth_headers(admin_token),
    )
    assert delete_edited.status_code == 204, delete_edited.text

    delete_original = client.delete(
        f"/api/v1/content/admin/assets/images/{first_img['id']}",
        headers=auth_headers(admin_token),
    )
    assert delete_original.status_code == 204, delete_original.text

    # Audit log
    audit = client.get("/api/v1/content/admin/home.hero/audit", headers=auth_headers(admin_token))
    assert audit.status_code == 200
    assert len(audit.json()) >= 2

    # Translations: add RO and fetch via lang
    tr = client.patch(
        "/api/v1/content/admin/home.hero",
        json={"title": "Erou", "body_markdown": "Bun venit!", "lang": "ro"},
        headers=auth_headers(admin_token),
    )
    assert tr.status_code == 200
    assert tr.json()["needs_translation_ro"] is False
    ro_public = client.get("/api/v1/content/home.hero?lang=ro")
    assert ro_public.status_code == 200
    assert ro_public.json()["title"] == "Erou"

    status_toggle = client.patch(
        "/api/v1/content/admin/home.hero/translation-status",
        json={"needs_translation_en": True, "needs_translation_ro": False},
        headers=auth_headers(admin_token),
    )
    assert status_toggle.status_code == 200, status_toggle.text
    assert status_toggle.json()["needs_translation_en"] is True
    assert status_toggle.json()["needs_translation_ro"] is False

    # Redirects: import/export + loop detection.
    client.post(
        "/api/v1/content/admin/page.new",
        json={"title": "New", "body_markdown": "New body", "status": "published"},
        headers=auth_headers(admin_token),
    )
    redirect_upsert = client.post(
        "/api/v1/content/admin/redirects",
        json={"from_key": "page.old2", "to_key": "page.new"},
        headers=auth_headers(admin_token),
    )
    assert redirect_upsert.status_code == 200, redirect_upsert.text
    assert redirect_upsert.json()["from_key"] == "page.old2"
    assert redirect_upsert.json()["to_key"] == "page.new"

    missing_target = client.post(
        "/api/v1/content/admin/redirects",
        json={"from_key": "page.old3", "to_key": "page.does-not-exist"},
        headers=auth_headers(admin_token),
    )
    assert missing_target.status_code == 400

    redirect_import = client.post(
        "/api/v1/content/admin/redirects/import",
        files={"file": ("redirects.csv", b"from,to\n/pages/old,/pages/new\n", "text/csv")},
        headers=auth_headers(admin_token),
    )
    assert redirect_import.status_code == 200, redirect_import.text
    assert redirect_import.json()["created"] == 1

    redirect_list = client.get("/api/v1/content/admin/redirects", headers=auth_headers(admin_token))
    assert redirect_list.status_code == 200, redirect_list.text
    items = redirect_list.json()["items"]
    assert any(item["from_key"] == "page.old" and item["to_key"] == "page.new" for item in items)
    imported = next(item for item in items if item["from_key"] == "page.old")
    assert imported["target_exists"] is True
    assert imported["chain_error"] is None

    redirect_export = client.get("/api/v1/content/admin/redirects/export", headers=auth_headers(admin_token))
    assert redirect_export.status_code == 200, redirect_export.text
    assert "text/csv" in (redirect_export.headers.get("content-type") or "")
    assert "from,to,from_key,to_key" in redirect_export.text
    assert "/pages/old" in redirect_export.text
    assert "page.old" in redirect_export.text

    loop = client.post(
        "/api/v1/content/admin/redirects/import",
        files={"file": ("redirects.csv", b"from,to\n/pages/a,/pages/b\n/pages/b,/pages/a\n", "text/csv")},
        headers=auth_headers(admin_token),
    )
    assert loop.status_code == 400

    async def seed_loop() -> None:
        async with SessionLocal() as session:
            session.add(ContentRedirect(from_key="page.loop1", to_key="page.loop2"))
            session.add(ContentRedirect(from_key="page.loop2", to_key="page.loop1"))
            await session.commit()

    asyncio.run(seed_loop())
    loop_list = client.get("/api/v1/content/admin/redirects", headers=auth_headers(admin_token))
    assert loop_list.status_code == 200, loop_list.text
    loop_items = [item for item in loop_list.json()["items"] if item["from_key"] in {"page.loop1", "page.loop2"}]
    assert loop_items
    assert all(item["chain_error"] == "loop" for item in loop_items)

    sitemap_preview = client.get("/api/v1/content/admin/seo/sitemap-preview", headers=auth_headers(admin_token))
    assert sitemap_preview.status_code == 200, sitemap_preview.text
    by_lang = sitemap_preview.json()["by_lang"]
    assert "en" in by_lang and "ro" in by_lang
    assert any("/pages/new" in url for url in by_lang["en"])

    async def seed_product() -> None:
        async with SessionLocal() as session:
            cat = Category(slug="mugs", name="Mugs")
            session.add(cat)
            await session.flush()
            session.add(
                Product(
                    category_id=cat.id,
                    slug="test-product",
                    name="Test product",
                    base_price=Decimal("10.00"),
                    currency="RON",
                    status=ProductStatus.published,
                )
            )
            await session.commit()

    asyncio.run(seed_product())

    structured = client.get("/api/v1/content/admin/seo/structured-data/validate", headers=auth_headers(admin_token))
    assert structured.status_code == 200, structured.text
    payload = structured.json()
    assert payload["checked_products"] >= 1
    assert any(i["entity_type"] == "product" and i["severity"] == "warning" for i in payload["issues"])

    # Broken link checker for internal URLs.
    link_block = client.post(
        "/api/v1/content/admin/site.linkcheck",
        json={
            "title": "Linkcheck",
            "body_markdown": "![missing](/media/does-not-exist.png) [product](/products/missing) [page](/pages/missing-page)",
            "status": "draft",
        },
        headers=auth_headers(admin_token),
    )
    assert link_block.status_code == 201, link_block.text
    check = client.get(
        "/api/v1/content/admin/tools/link-check",
        params={"key": "site.linkcheck"},
        headers=auth_headers(admin_token),
    )
    assert check.status_code == 200, check.text
    issues = check.json()["issues"]
    assert any(i["reason"] == "Media file not found" for i in issues)
    assert any(i["reason"] == "Product not found" for i in issues)
    assert any(i["reason"] == "Content not found" for i in issues)

    preview = client.post(
        "/api/v1/content/admin/tools/link-check/preview",
        json={
            "key": "site.preview",
            "body_markdown": "![missing](/media/does-not-exist.png) [product](/products/missing) [page](/pages/missing-page)",
            "meta": None,
            "images": [],
        },
        headers=auth_headers(admin_token),
    )
    assert preview.status_code == 200, preview.text
    preview_issues = preview.json()["issues"]
    assert any(i["reason"] == "Media file not found" for i in preview_issues)
    assert any(i["reason"] == "Product not found" for i in preview_issues)
    assert any(i["reason"] == "Content not found" for i in preview_issues)

    # Find & replace (preview + apply) across body/meta/translations.
    seed_fr = client.post(
        "/api/v1/content/admin/page.findreplace",
        json={
            "title": "Findreplace",
            "body_markdown": "hello old",
            "status": "draft",
            "lang": "en",
            "meta": {"blocks": [{"type": "text", "body_markdown": {"en": "old in meta", "ro": "old in meta ro"}}]},
        },
        headers=auth_headers(admin_token),
    )
    assert seed_fr.status_code == 201, seed_fr.text

    tr_fr = client.patch(
        "/api/v1/content/admin/page.findreplace",
        json={"title": "Găsește", "body_markdown": "salut old", "lang": "ro"},
        headers=auth_headers(admin_token),
    )
    assert tr_fr.status_code == 200, tr_fr.text

    fr_preview = client.post(
        "/api/v1/content/admin/tools/find-replace/preview",
        json={"find": "old", "replace": "new", "key_prefix": "page.", "case_sensitive": True, "limit": 50},
        headers=auth_headers(admin_token),
    )
    assert fr_preview.status_code == 200, fr_preview.text
    preview_payload = fr_preview.json()
    assert any(item["key"] == "page.findreplace" for item in preview_payload["items"])
    assert preview_payload["total_items"] >= 1
    assert preview_payload["total_matches"] >= 3

    fr_apply = client.post(
        "/api/v1/content/admin/tools/find-replace/apply",
        json={"find": "old", "replace": "new", "key_prefix": "page.", "case_sensitive": True},
        headers=auth_headers(admin_token),
    )
    assert fr_apply.status_code == 200, fr_apply.text
    apply_payload = fr_apply.json()
    assert apply_payload["updated_blocks"] >= 1
    assert apply_payload["total_replacements"] >= 3
    assert apply_payload["errors"] == []

    base_after = client.get(
        "/api/v1/content/admin/page.findreplace",
        headers=auth_headers(admin_token),
    )
    assert base_after.status_code == 200, base_after.text
    assert "old" not in base_after.json()["body_markdown"]
    assert "new" in base_after.json()["body_markdown"]
    assert "new in meta" in str(base_after.json().get("meta") or {})

    ro_after = client.get(
        "/api/v1/content/admin/page.findreplace",
        params={"lang": "ro"},
        headers=auth_headers(admin_token),
    )
    assert ro_after.status_code == 200, ro_after.text
    assert "old" not in ro_after.json()["body_markdown"]
    assert "new" in ro_after.json()["body_markdown"]


def test_admin_fetch_social_thumbnail(monkeypatch: pytest.MonkeyPatch, test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]
    admin_token = create_admin_token(SessionLocal)

    html = '<html><head><meta property="og:image" content="/img/profile.png"></head><body>ok</body></html>'

    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=html, request=request)

    transport = httpx.MockTransport(handler)
    real_async_client = httpx.AsyncClient

    class MockAsyncClient:
        def __init__(self, *args, **kwargs):
            self._client = real_async_client(
                transport=transport,
                follow_redirects=kwargs.get("follow_redirects", False),
                timeout=kwargs.get("timeout"),
                headers=kwargs.get("headers"),
            )

        async def __aenter__(self):
            return self._client

        async def __aexit__(self, exc_type, exc, tb):
            await self._client.aclose()

    monkeypatch.setattr(social_thumbnails.httpx, "AsyncClient", MockAsyncClient)

    res = client.post(
        "/api/v1/content/admin/social/thumbnail",
        json={"url": "https://www.instagram.com/momentstudio/"},
        headers=auth_headers(admin_token),
    )
    assert res.status_code == 200, res.text
    assert res.json()["thumbnail_url"] == "https://www.instagram.com/img/profile.png"

    bad = client.post(
        "/api/v1/content/admin/social/thumbnail",
        json={"url": "https://example.com"},
        headers=auth_headers(admin_token),
    )
    assert bad.status_code == 400


def test_legal_pages_require_bilingual_before_publish(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]
    admin_token = create_admin_token(SessionLocal)

    create = client.post(
        "/api/v1/content/admin/page.terms",
        json={"title": "Terms", "body_markdown": "Terms placeholder", "status": "draft", "lang": "en"},
        headers=auth_headers(admin_token),
    )
    assert create.status_code == 201, create.text

    publish_missing_ro = client.patch(
        "/api/v1/content/admin/page.terms",
        json={"status": "published"},
        headers=auth_headers(admin_token),
    )
    assert publish_missing_ro.status_code == 400, publish_missing_ro.text
    assert "EN and RO" in str(publish_missing_ro.json().get("detail"))

    add_ro = client.patch(
        "/api/v1/content/admin/page.terms",
        json={"title": "Termeni", "body_markdown": "Șablon termeni", "lang": "ro"},
        headers=auth_headers(admin_token),
    )
    assert add_ro.status_code == 200, add_ro.text

    publish_ok = client.patch(
        "/api/v1/content/admin/page.terms",
        json={"status": "published"},
        headers=auth_headers(admin_token),
    )
    assert publish_ok.status_code == 200, publish_ok.text
    assert publish_ok.json()["status"] == "published"

    clear_ro = client.patch(
        "/api/v1/content/admin/page.terms",
        json={"title": "", "body_markdown": "", "lang": "ro"},
        headers=auth_headers(admin_token),
    )
    assert clear_ro.status_code == 400, clear_ro.text
    assert "EN and RO" in str(clear_ro.json().get("detail"))
