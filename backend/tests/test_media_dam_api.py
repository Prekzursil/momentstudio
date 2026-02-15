import asyncio
from io import BytesIO
from pathlib import Path
from typing import Dict

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core import security
from app.core.config import settings
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.passkeys import UserPasskey
from app.models.user import UserRole
from app.schemas.user import UserCreate
from app.services.auth import create_user, issue_tokens_for_user


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


def create_staff_token(session_factory, *, email: str, role: UserRole) -> str:
    async def create_and_token() -> str:
        async with session_factory() as session:
            user = await create_user(session, UserCreate(email=email, password="password123", name="DAM staff"))
            user.role = role
            if role in (UserRole.admin, UserRole.owner):
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
    Image.new("RGB", (32, 32), color=(255, 0, 0)).save(buf, format="JPEG")
    return buf.getvalue()


def test_media_dam_upload_finalize_and_lifecycle(test_app: Dict[str, object], tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]
    admin_token = create_staff_token(SessionLocal, email="dam-admin@example.com", role=UserRole.admin)
    monkeypatch.setattr(settings, "media_root", str(tmp_path))

    upload = client.post(
        "/api/v1/content/admin/media/assets/upload",
        files={"file": ("dam.jpg", _jpeg_bytes(), "image/jpeg")},
        params={"visibility": "private", "auto_finalize": "true"},
        headers=auth_headers(admin_token),
    )
    assert upload.status_code == 201, upload.text
    asset = upload.json()
    assert asset["asset_type"] == "image"
    assert asset["public_url"].startswith("/media/originals/")
    asset_id = asset["id"]

    listed = client.get("/api/v1/content/admin/media/assets", headers=auth_headers(admin_token))
    assert listed.status_code == 200, listed.text
    assert any(row["id"] == asset_id for row in listed.json()["items"])

    finalize = client.post(
        f"/api/v1/content/admin/media/assets/{asset_id}/finalize",
        json={"run_ai_tagging": True, "run_duplicate_scan": True},
        headers=auth_headers(admin_token),
    )
    assert finalize.status_code == 200, finalize.text
    job_id = finalize.json()["id"]
    job = client.get(f"/api/v1/content/admin/media/jobs/{job_id}", headers=auth_headers(admin_token))
    assert job.status_code == 200, job.text
    assert job.json()["job_type"] == "ingest"

    variant = client.post(
        f"/api/v1/content/admin/media/assets/{asset_id}/variants",
        json={"profile": "web-640"},
        headers=auth_headers(admin_token),
    )
    assert variant.status_code == 200, variant.text
    assert variant.json()["status"] == "completed"

    approve = client.post(
        f"/api/v1/content/admin/media/assets/{asset_id}/approve",
        json={"note": "Looks good"},
        headers=auth_headers(admin_token),
    )
    assert approve.status_code == 200, approve.text
    assert approve.json()["status"] == "approved"

    usage = client.get(f"/api/v1/content/admin/media/assets/{asset_id}/usage", headers=auth_headers(admin_token))
    assert usage.status_code == 200, usage.text
    assert usage.json()["asset_id"] == asset_id

    to_trash = client.delete(f"/api/v1/content/admin/media/assets/{asset_id}", headers=auth_headers(admin_token))
    assert to_trash.status_code == 204, to_trash.text

    restore = client.post(f"/api/v1/content/admin/media/assets/{asset_id}/restore", headers=auth_headers(admin_token))
    assert restore.status_code == 200, restore.text
    assert restore.json()["status"] == "draft"

    client.delete(f"/api/v1/content/admin/media/assets/{asset_id}", headers=auth_headers(admin_token))
    purge = client.post(f"/api/v1/content/admin/media/assets/{asset_id}/purge", headers=auth_headers(admin_token))
    assert purge.status_code == 204, purge.text


def test_media_dam_owner_admin_restrictions(test_app: Dict[str, object], tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]
    admin_token = create_staff_token(SessionLocal, email="dam-admin-2@example.com", role=UserRole.admin)
    content_token = create_staff_token(SessionLocal, email="dam-content@example.com", role=UserRole.content)
    monkeypatch.setattr(settings, "media_root", str(tmp_path))

    upload = client.post(
        "/api/v1/content/admin/media/assets/upload",
        files={"file": ("dam-2.jpg", _jpeg_bytes(), "image/jpeg")},
        headers=auth_headers(admin_token),
    )
    assert upload.status_code == 201, upload.text
    asset_id = upload.json()["id"]

    approve_forbidden = client.post(
        f"/api/v1/content/admin/media/assets/{asset_id}/approve",
        json={"note": "try approve"},
        headers=auth_headers(content_token),
    )
    assert approve_forbidden.status_code == 403, approve_forbidden.text

    purge_forbidden = client.post(
        f"/api/v1/content/admin/media/assets/{asset_id}/purge",
        headers=auth_headers(content_token),
    )
    assert purge_forbidden.status_code == 403, purge_forbidden.text

