import asyncio
from datetime import datetime, timedelta, timezone
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
from app.services import social_thumbnails
import httpx


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
    return {"Authorization": f"Bearer {token}"}


def create_admin_token(session_factory) -> str:
    async def create_and_token():
        async with session_factory() as session:
            user = await create_user(session, UserCreate(email="cms@example.com", password="cmspassword", name="CMS"))
            user.role = UserRole.admin
            await session.commit()
            tokens = await issue_tokens_for_user(session, user)
            return tokens["access_token"]

    return asyncio.run(create_and_token())


def _jpeg_bytes() -> bytes:
    buf = BytesIO()
    Image.new("RGB", (1, 1), color=(255, 0, 0)).save(buf, format="JPEG")
    return buf.getvalue()


def test_content_crud_and_public(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]
    admin_token = create_admin_token(SessionLocal)

    # Create
    create = client.post(
        "/api/v1/content/admin/home.hero",
        json={"title": "Hero", "body_markdown": "Welcome!", "status": "published", "meta": {"headline": "Hero"}, "lang": "en"},
        headers=auth_headers(admin_token),
    )
    assert create.status_code == 201, create.text
    assert create.json()["version"] == 1
    assert create.json()["meta"]["headline"] == "Hero"

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

    assets_filtered = client.get(
        "/api/v1/content/admin/assets/images",
        params={"key": "home.hero"},
        headers=auth_headers(admin_token),
    )
    assert assets_filtered.status_code == 200, assets_filtered.text
    assert all(item["content_key"] == "home.hero" for item in assets_filtered.json()["items"])

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
    ro_public = client.get("/api/v1/content/home.hero?lang=ro")
    assert ro_public.status_code == 200
    assert ro_public.json()["title"] == "Erou"


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
