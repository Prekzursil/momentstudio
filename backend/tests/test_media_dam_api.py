import asyncio
import json
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from typing import Dict
from urllib.parse import parse_qs, urlparse
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core import security
from app.core.config import settings
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.media import MediaJobStatus, MediaJobType
from app.models.passkeys import UserPasskey
from app.models.user import UserRole
from app.schemas.user import UserCreate
from app.services.auth import create_user, issue_tokens_for_user
from app.services import media_dam


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


def test_media_dam_retry_dead_letter_triage_and_events_v2(
    test_app: Dict[str, object], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]
    admin_token = create_staff_token(SessionLocal, email="dam-admin-retry@example.com", role=UserRole.admin)
    monkeypatch.setattr(settings, "media_root", str(tmp_path / "uploads"))
    monkeypatch.setattr(settings, "private_media_root", str(tmp_path / "private_uploads"))

    async def _fail_variant(*_args, **_kwargs):
        raise RuntimeError("variant failed on purpose")

    monkeypatch.setattr(media_dam, "_process_variant_job", _fail_variant)

    upload = client.post(
        "/api/v1/content/admin/media/assets/upload",
        files={"file": ("dam-retry.jpg", _jpeg_bytes(), "image/jpeg")},
        params={"visibility": "private", "auto_finalize": "true"},
        headers=auth_headers(admin_token),
    )
    assert upload.status_code == 201, upload.text
    asset_id = upload.json()["id"]

    first_try = client.post(
        f"/api/v1/content/admin/media/assets/{asset_id}/variants",
        json={"profile": "web-640"},
        headers=auth_headers(admin_token),
    )
    assert first_try.status_code == 200, first_try.text
    job_payload = first_try.json()
    job_id = job_payload["id"]
    assert job_payload["status"] == "failed"
    assert job_payload["attempt"] == 1
    assert job_payload["max_attempts"] == 5
    assert job_payload["next_retry_at"] is not None
    assert job_payload["triage_state"] == "retrying"

    overdue_iso = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    triage_update = client.patch(
        f"/api/v1/content/admin/media/jobs/{job_id}/triage",
        json={
            "triage_state": "open",
            "add_tags": ["timeout", "variant"],
            "incident_url": "https://example.invalid/incidents/123",
            "sla_due_at": overdue_iso,
            "note": "Investigate failing variant profile",
        },
        headers=auth_headers(admin_token),
    )
    assert triage_update.status_code == 200, triage_update.text
    triage_payload = triage_update.json()
    assert triage_payload["triage_state"] == "open"
    assert "timeout" in triage_payload["tags"]
    assert triage_payload["sla_due_at"] is not None

    async def _exhaust_attempts() -> None:
        async with SessionLocal() as session:
            for _ in range(4):
                job = await media_dam.get_job_or_404(session, UUID(job_id))
                await media_dam.manual_retry_job(session, job=job, actor_user_id=None)
                queued = await media_dam.get_job_or_404(session, UUID(job_id))
                await media_dam.process_job_inline(session, queued)

    asyncio.run(_exhaust_attempts())

    after_exhaust = client.get(f"/api/v1/content/admin/media/jobs/{job_id}", headers=auth_headers(admin_token))
    assert after_exhaust.status_code == 200, after_exhaust.text
    exhausted_payload = after_exhaust.json()
    assert exhausted_payload["status"] == "dead_letter"
    assert exhausted_payload["dead_lettered_at"] is not None
    assert exhausted_payload["triage_state"] == "open"
    assert exhausted_payload["attempt"] == 5

    filtered = client.get(
        "/api/v1/content/admin/media/jobs?dead_letter_only=true&triage_state=open&tag=timeout&sla_breached=true&limit=20",
        headers=auth_headers(admin_token),
    )
    assert filtered.status_code == 200, filtered.text
    assert any(row["id"] == job_id for row in filtered.json()["items"])

    retry_now = client.post(f"/api/v1/content/admin/media/jobs/{job_id}/retry", headers=auth_headers(admin_token))
    assert retry_now.status_code == 200, retry_now.text
    assert retry_now.json()["status"] == "queued"

    events = client.get(f"/api/v1/content/admin/media/jobs/{job_id}/events?limit=200", headers=auth_headers(admin_token))
    assert events.status_code == 200, events.text
    actions = [row["action"] for row in events.json()["items"]]
    assert "retry_scheduled" in actions
    assert "dead_lettered" in actions
    assert "triage_updated" in actions
    assert "manual_retry" in actions


def test_media_dam_due_retry_sweep_requeues_failed_jobs(
    test_app: Dict[str, object], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]
    admin_token = create_staff_token(SessionLocal, email="dam-admin-retry-sweep@example.com", role=UserRole.admin)
    monkeypatch.setattr(settings, "media_root", str(tmp_path / "uploads"))
    monkeypatch.setattr(settings, "private_media_root", str(tmp_path / "private_uploads"))

    upload = client.post(
        "/api/v1/content/admin/media/assets/upload",
        files={"file": ("dam-retry-sweep.jpg", _jpeg_bytes(), "image/jpeg")},
        params={"visibility": "private", "auto_finalize": "true"},
        headers=auth_headers(admin_token),
    )
    assert upload.status_code == 201, upload.text
    asset_id = upload.json()["id"]

    queued_job = client.post(
        f"/api/v1/content/admin/media/assets/{asset_id}/finalize",
        json={"run_ai_tagging": False, "run_duplicate_scan": False},
        headers=auth_headers(admin_token),
    )
    assert queued_job.status_code == 200, queued_job.text
    job_id = queued_job.json()["id"]

    async def _mark_failed_and_sweep() -> None:
        async with SessionLocal() as session:
            job = await media_dam.get_job_or_404(session, UUID(job_id))
            job.status = MediaJobStatus.failed
            job.triage_state = "retrying"
            job.next_retry_at = datetime.now(timezone.utc) - timedelta(minutes=1)
            job.error_message = "failed before sweep"
            job.attempt = 1
            session.add(job)
            await session.commit()
            queued = await media_dam.enqueue_due_retries(session, limit=10)
            assert UUID(job_id) in queued

    asyncio.run(_mark_failed_and_sweep())

    job_after = client.get(f"/api/v1/content/admin/media/jobs/{job_id}", headers=auth_headers(admin_token))
    assert job_after.status_code == 200, job_after.text
    assert job_after.json()["status"] == "queued"


def test_media_dam_retry_policy_endpoints_and_permissions(
    test_app: Dict[str, object], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]
    admin_token = create_staff_token(SessionLocal, email="dam-admin-policy@example.com", role=UserRole.admin)
    content_token = create_staff_token(SessionLocal, email="dam-content-policy@example.com", role=UserRole.content)
    monkeypatch.setattr(settings, "media_root", str(tmp_path / "uploads"))
    monkeypatch.setattr(settings, "private_media_root", str(tmp_path / "private_uploads"))

    listed = client.get("/api/v1/content/admin/media/retry-policies", headers=auth_headers(content_token))
    assert listed.status_code == 200, listed.text
    by_type = {row["job_type"]: row for row in listed.json()["items"]}
    assert "ingest" in by_type
    assert "variant" in by_type

    forbidden = client.patch(
        "/api/v1/content/admin/media/retry-policies/variant",
        json={"max_attempts": 6},
        headers=auth_headers(content_token),
    )
    assert forbidden.status_code == 403, forbidden.text

    updated = client.patch(
        "/api/v1/content/admin/media/retry-policies/variant",
        json={
            "max_attempts": 6,
            "backoff_schedule_seconds": [12, 34, 89],
            "jitter_ratio": 0.25,
            "enabled": True,
        },
        headers=auth_headers(admin_token),
    )
    assert updated.status_code == 200, updated.text
    updated_payload = updated.json()
    assert updated_payload["job_type"] == "variant"
    assert updated_payload["max_attempts"] == 6
    assert updated_payload["backoff_schedule_seconds"] == [12, 34, 89]
    assert updated_payload["jitter_ratio"] == pytest.approx(0.25)

    invalid_schedule = client.patch(
        "/api/v1/content/admin/media/retry-policies/variant",
        json={"backoff_schedule_seconds": [0]},
        headers=auth_headers(admin_token),
    )
    assert invalid_schedule.status_code == 400, invalid_schedule.text

    reset_one = client.post(
        "/api/v1/content/admin/media/retry-policies/variant/reset",
        headers=auth_headers(admin_token),
    )
    assert reset_one.status_code == 200, reset_one.text
    assert reset_one.json()["backoff_schedule_seconds"] == [20, 90, 300, 900]
    assert reset_one.json()["max_attempts"] == 5

    reset_all = client.post(
        "/api/v1/content/admin/media/retry-policies/reset-all",
        headers=auth_headers(admin_token),
    )
    assert reset_all.status_code == 200, reset_all.text
    all_types = {row["job_type"] for row in reset_all.json()["items"]}
    assert all_types == {job_type.value for job_type in MediaJobType}


def test_media_dam_retry_policy_snapshot_and_jitter_schedule(
    test_app: Dict[str, object], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]
    admin_token = create_staff_token(SessionLocal, email="dam-admin-jitter@example.com", role=UserRole.admin)
    monkeypatch.setattr(settings, "media_root", str(tmp_path / "uploads"))
    monkeypatch.setattr(settings, "private_media_root", str(tmp_path / "private_uploads"))

    async def _fail_variant(*_args, **_kwargs):
        raise RuntimeError("variant failed for jitter test")

    monkeypatch.setattr(media_dam, "_process_variant_job", _fail_variant)
    monkeypatch.setattr(media_dam.random, "uniform", lambda _a, _b: 0.5)

    update_policy = client.patch(
        "/api/v1/content/admin/media/retry-policies/variant",
        json={"max_attempts": 4, "backoff_schedule_seconds": [100], "jitter_ratio": 0.5, "enabled": True},
        headers=auth_headers(admin_token),
    )
    assert update_policy.status_code == 200, update_policy.text

    upload = client.post(
        "/api/v1/content/admin/media/assets/upload",
        files={"file": ("dam-jitter.jpg", _jpeg_bytes(), "image/jpeg")},
        params={"visibility": "private", "auto_finalize": "true"},
        headers=auth_headers(admin_token),
    )
    assert upload.status_code == 201, upload.text
    asset_id = upload.json()["id"]

    variant_job = client.post(
        f"/api/v1/content/admin/media/assets/{asset_id}/variants",
        json={"profile": "web-640"},
        headers=auth_headers(admin_token),
    )
    assert variant_job.status_code == 200, variant_job.text
    payload = variant_job.json()
    assert payload["status"] == "failed"
    assert payload["max_attempts"] == 4
    assert payload["next_retry_at"] is not None
    completed_at = datetime.fromisoformat(payload["completed_at"].replace("Z", "+00:00"))
    next_retry_at = datetime.fromisoformat(payload["next_retry_at"].replace("Z", "+00:00"))
    retry_delay_seconds = int(round((next_retry_at - completed_at).total_seconds()))
    assert retry_delay_seconds == 150

    async def _assert_snapshot() -> None:
        async with SessionLocal() as session:
            job = await media_dam.get_job_or_404(session, UUID(payload["id"]))
            body = json.loads(job.payload_json or "{}")
            snap = body.get("__retry_policy")
            assert isinstance(snap, dict)
            assert int(snap["max_attempts"]) == 4
            assert [int(v) for v in snap["schedule"]] == [100]
            assert float(snap["jitter_ratio"]) == pytest.approx(0.5)

            # Legacy jobs without a snapshot still fall back to the active DB policy.
            body.pop("__retry_policy", None)
            job.payload_json = json.dumps(body, separators=(",", ":"))
            job.attempt = 0
            job.max_attempts = 0
            job.status = MediaJobStatus.queued
            session.add(job)
            await session.commit()

            queued = await media_dam.get_job_or_404(session, job.id)
            await media_dam.process_job_inline(session, queued)
            refreshed = await media_dam.get_job_or_404(session, job.id)
            assert refreshed.max_attempts == 4
            assert refreshed.status == MediaJobStatus.failed
            assert refreshed.next_retry_at is not None

    asyncio.run(_assert_snapshot())
