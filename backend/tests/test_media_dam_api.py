import asyncio
from io import BytesIO
from pathlib import Path
from typing import Dict
from urllib.parse import parse_qs, urlparse

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
    monkeypatch.setattr(settings, "media_root", str(tmp_path / "uploads"))
    monkeypatch.setattr(settings, "private_media_root", str(tmp_path / "private_uploads"))

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
    monkeypatch.setattr(settings, "media_root", str(tmp_path / "uploads"))
    monkeypatch.setattr(settings, "private_media_root", str(tmp_path / "private_uploads"))

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


def test_media_dam_jobs_telemetry_and_reconcile(test_app: Dict[str, object], tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]
    admin_token = create_staff_token(SessionLocal, email="dam-admin-telemetry@example.com", role=UserRole.admin)
    monkeypatch.setattr(settings, "media_root", str(tmp_path / "uploads"))
    monkeypatch.setattr(settings, "private_media_root", str(tmp_path / "private_uploads"))

    upload = client.post(
        "/api/v1/content/admin/media/assets/upload",
        files={"file": ("dam-telemetry.jpg", _jpeg_bytes(), "image/jpeg")},
        params={"visibility": "private", "auto_finalize": "true"},
        headers=auth_headers(admin_token),
    )
    assert upload.status_code == 201, upload.text
    asset_id = upload.json()["id"]

    list_jobs = client.get("/api/v1/content/admin/media/jobs?limit=10", headers=auth_headers(admin_token))
    assert list_jobs.status_code == 200, list_jobs.text
    payload = list_jobs.json()
    assert payload["meta"]["total_items"] >= 1
    assert any(item["asset_id"] == asset_id for item in payload["items"])

    telemetry = client.get("/api/v1/content/admin/media/telemetry", headers=auth_headers(admin_token))
    assert telemetry.status_code == 200, telemetry.text
    telemetry_payload = telemetry.json()
    assert "queue_depth" in telemetry_payload
    assert "online_workers" in telemetry_payload
    assert "status_counts" in telemetry_payload
    assert "type_counts" in telemetry_payload

    queued = client.post("/api/v1/content/admin/media/usage/reconcile", headers=auth_headers(admin_token))
    assert queued.status_code == 200, queued.text
    queued_payload = queued.json()
    assert queued_payload["job_type"] == "usage_reconcile"

    filtered = client.get(
        "/api/v1/content/admin/media/jobs?job_type=usage_reconcile&limit=10",
        headers=auth_headers(admin_token),
    )
    assert filtered.status_code == 200, filtered.text
    assert any(item["id"] == queued_payload["id"] for item in filtered.json()["items"])

    invalid_range = client.get(
        "/api/v1/content/admin/media/jobs?created_from=2026-02-20T00:00:00&created_to=2026-02-01T00:00:00",
        headers=auth_headers(admin_token),
    )
    assert invalid_range.status_code == 400, invalid_range.text


def test_media_dam_private_preview_and_public_serving_gate(test_app: Dict[str, object], tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]
    admin_token = create_staff_token(SessionLocal, email="dam-admin-preview@example.com", role=UserRole.admin)
    monkeypatch.setattr(settings, "media_private_preview_ttl_seconds", 600)

    private_upload = client.post(
        "/api/v1/content/admin/media/assets/upload",
        files={"file": ("dam-private.jpg", _jpeg_bytes(), "image/jpeg")},
        params={"visibility": "private", "auto_finalize": "true"},
        headers=auth_headers(admin_token),
    )
    assert private_upload.status_code == 201, private_upload.text
    private_asset = private_upload.json()

    # Private/non-approved assets should not be retrievable from the public /media mount.
    private_public_fetch = client.get(private_asset["public_url"])
    assert private_public_fetch.status_code == 404

    preview_url = private_asset["preview_url"]
    parsed_preview = urlparse(preview_url)
    params = parse_qs(parsed_preview.query)
    assert params.get("exp")
    assert params.get("sig")

    private_preview_fetch = client.get(preview_url)
    assert private_preview_fetch.status_code == 200
    assert private_preview_fetch.headers.get("Cache-Control") == "private, no-store"

    bad_sig_fetch = client.get(
        f"{parsed_preview.path}?exp={params['exp'][0]}&sig={'0' * 64}",
    )
    assert bad_sig_fetch.status_code == 403

    public_upload = client.post(
        "/api/v1/content/admin/media/assets/upload",
        files={"file": ("dam-public.jpg", _jpeg_bytes(), "image/jpeg")},
        params={"visibility": "public", "auto_finalize": "true"},
        headers=auth_headers(admin_token),
    )
    assert public_upload.status_code == 201, public_upload.text
    public_asset = public_upload.json()
    public_asset_id = public_asset["id"]

    before_approve = client.get(public_asset["public_url"])
    assert before_approve.status_code == 404

    approve = client.post(
        f"/api/v1/content/admin/media/assets/{public_asset_id}/approve",
        json={"note": "publish"},
        headers=auth_headers(admin_token),
    )
    assert approve.status_code == 200, approve.text
    assert approve.json()["status"] == "approved"

    listed_after = client.get("/api/v1/content/admin/media/assets", headers=auth_headers(admin_token))
    assert listed_after.status_code == 200, listed_after.text
    listed_asset = next((row for row in listed_after.json()["items"] if row["id"] == public_asset_id), None)
    assert listed_asset is not None
    assert listed_asset["preview_url"] == listed_asset["public_url"]

    after_approve = client.get(public_asset["public_url"])
    assert after_approve.status_code == 200
