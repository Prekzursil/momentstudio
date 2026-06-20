"""Lean-gate coverage worker [w3] for ``app.api.v1.auth`` — the user data-export
job endpoints.

``auth.py`` is already exercised broadly by the sibling auth suite; this file
closes the residual around the GDPR-style export-job lifecycle endpoints
(``/me/export/jobs`` POST/latest/get/download) which the existing tests do not
touch. It reuses the suite's in-memory TestClient + ``get_session`` override
pattern. Path ``{job_id}: UUID`` params arrive as real ``uuid.UUID`` objects, so
``session.get(UserDataExportJob, job_id)`` binds correctly under aiosqlite (no
string-UUID wall).
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Dict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.content import ContentBlock, ContentStatus
from app.models.user import User
from app.models.user_export import UserDataExportJob, UserDataExportStatus


@pytest.fixture
def test_app() -> Dict[str, object]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    session_local = async_sessionmaker(engine, expire_on_commit=False)

    async def init_models() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        # Registration requires published legal docs (terms + privacy).
        async with session_local() as session:
            session.add_all(
                [
                    ContentBlock(
                        key="page.terms-and-conditions",
                        title="Terms",
                        body_markdown="Terms",
                        status=ContentStatus.published,
                        version=1,
                        published_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
                    ),
                    ContentBlock(
                        key="page.privacy-policy",
                        title="Privacy",
                        body_markdown="Privacy",
                        status=ContentStatus.published,
                        version=1,
                        published_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
                    ),
                ]
            )
            await session.commit()

    asyncio.run(init_models())

    async def override_get_session():
        async with session_local() as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session
    client = TestClient(app)
    yield {"client": client, "session_factory": session_local}
    client.close()
    app.dependency_overrides.clear()


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _register(client: TestClient, *, email: str, username: str) -> dict:
    payload = {
        "email": email,
        "username": username,
        "password": "supersecret",
        "name": "Export User",
        "first_name": "Export",
        "last_name": "User",
        "date_of_birth": "2000-01-01",
        "phone": "+40723204204",
        "accept_terms": True,
        "accept_privacy": True,
    }
    res = client.post("/api/v1/auth/register", json=payload)
    assert res.status_code == 201, res.text
    return res.json()


def _user_id(session_factory, email: str):
    async def fetch():
        async with session_factory() as session:
            user = (
                await session.execute(select(User).where(User.email == email))
            ).scalar_one()
            return user.id

    return asyncio.run(fetch())


def _add_job(session_factory, **kwargs):
    holder = {}

    async def add():
        async with session_factory() as session:
            job = UserDataExportJob(**kwargs)
            session.add(job)
            await session.commit()
            await session.refresh(job)
            holder["id"] = job.id

    asyncio.run(add())
    return holder["id"]


# --------------------------------------------------------------------------- #
# POST /me/export/jobs                                                         #
# --------------------------------------------------------------------------- #
def test_start_export_job_creates_new(test_app, monkeypatch) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    # Stub the background worker so no real export runs.
    monkeypatch.setattr(
        "app.api.v1.auth.user_export_service.run_user_export_job",
        lambda *a, **k: None,
    )
    body = _register(client, email="ex1@x.io", username="ex1")
    token = body["tokens"]["access_token"]

    res = client.post("/api/v1/auth/me/export/jobs", headers=_auth_headers(token))
    assert res.status_code == 201, res.text
    assert res.json()["status"] == "pending"


def test_start_export_job_returns_pending_in_progress(test_app, monkeypatch) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    factory = test_app["session_factory"]
    monkeypatch.setattr(
        "app.api.v1.auth.user_export_service.run_user_export_job",
        lambda *a, **k: None,
    )
    body = _register(client, email="ex2@x.io", username="ex2")
    token = body["tokens"]["access_token"]
    uid = _user_id(factory, "ex2@x.io")
    _add_job(factory, user_id=uid, status=UserDataExportStatus.pending, progress=0)

    res = client.post("/api/v1/auth/me/export/jobs", headers=_auth_headers(token))
    assert res.status_code == 201
    assert res.json()["status"] == "pending"


def test_start_export_job_returns_running(test_app, monkeypatch) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    factory = test_app["session_factory"]
    monkeypatch.setattr(
        "app.api.v1.auth.user_export_service.run_user_export_job",
        lambda *a, **k: None,
    )
    body = _register(client, email="ex3@x.io", username="ex3")
    token = body["tokens"]["access_token"]
    uid = _user_id(factory, "ex3@x.io")
    _add_job(factory, user_id=uid, status=UserDataExportStatus.running, progress=50)

    res = client.post("/api/v1/auth/me/export/jobs", headers=_auth_headers(token))
    assert res.status_code == 201
    assert res.json()["status"] == "running"


def test_start_export_job_returns_recent_succeeded(test_app, monkeypatch) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    factory = test_app["session_factory"]
    monkeypatch.setattr(
        "app.api.v1.auth.user_export_service.run_user_export_job",
        lambda *a, **k: None,
    )
    body = _register(client, email="ex4@x.io", username="ex4")
    token = body["tokens"]["access_token"]
    uid = _user_id(factory, "ex4@x.io")
    _add_job(
        factory,
        user_id=uid,
        status=UserDataExportStatus.succeeded,
        progress=100,
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    )

    res = client.post("/api/v1/auth/me/export/jobs", headers=_auth_headers(token))
    assert res.status_code == 201
    assert res.json()["status"] == "succeeded"


def test_start_export_job_succeeded_expired_creates_new(test_app, monkeypatch) -> None:
    # A succeeded-but-expired job (naive expires_at in the past) falls through to
    # creating a fresh pending job, exercising the tz-normalisation arc.
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    factory = test_app["session_factory"]
    monkeypatch.setattr(
        "app.api.v1.auth.user_export_service.run_user_export_job",
        lambda *a, **k: None,
    )
    body = _register(client, email="ex5@x.io", username="ex5")
    token = body["tokens"]["access_token"]
    uid = _user_id(factory, "ex5@x.io")
    _add_job(
        factory,
        user_id=uid,
        status=UserDataExportStatus.succeeded,
        progress=100,
        expires_at=datetime.now() - timedelta(days=2),  # naive + past
    )

    res = client.post("/api/v1/auth/me/export/jobs", headers=_auth_headers(token))
    assert res.status_code == 201
    assert res.json()["status"] == "pending"


# --------------------------------------------------------------------------- #
# GET /me/export/jobs/latest                                                   #
# --------------------------------------------------------------------------- #
def test_latest_export_job_found(test_app) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    factory = test_app["session_factory"]
    body = _register(client, email="lt1@x.io", username="lt1")
    token = body["tokens"]["access_token"]
    uid = _user_id(factory, "lt1@x.io")
    _add_job(factory, user_id=uid, status=UserDataExportStatus.running, progress=10)

    res = client.get("/api/v1/auth/me/export/jobs/latest", headers=_auth_headers(token))
    assert res.status_code == 200
    assert res.json()["status"] == "running"


def test_latest_export_job_none(test_app) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    body = _register(client, email="lt2@x.io", username="lt2")
    token = body["tokens"]["access_token"]

    res = client.get("/api/v1/auth/me/export/jobs/latest", headers=_auth_headers(token))
    assert res.status_code == 404


# --------------------------------------------------------------------------- #
# GET /me/export/jobs/{job_id}                                                 #
# --------------------------------------------------------------------------- #
def test_get_export_job_found(test_app) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    factory = test_app["session_factory"]
    body = _register(client, email="gt1@x.io", username="gt1")
    token = body["tokens"]["access_token"]
    uid = _user_id(factory, "gt1@x.io")
    job_id = _add_job(
        factory, user_id=uid, status=UserDataExportStatus.running, progress=20
    )

    res = client.get(
        f"/api/v1/auth/me/export/jobs/{job_id}", headers=_auth_headers(token)
    )
    assert res.status_code == 200
    assert res.json()["status"] == "running"


def test_get_export_job_not_found(test_app) -> None:
    import uuid

    client: TestClient = test_app["client"]  # type: ignore[assignment]
    body = _register(client, email="gt2@x.io", username="gt2")
    token = body["tokens"]["access_token"]

    res = client.get(
        f"/api/v1/auth/me/export/jobs/{uuid.uuid4()}", headers=_auth_headers(token)
    )
    assert res.status_code == 404


def test_get_export_job_other_user(test_app) -> None:
    # A job owned by a different user -> 404 (ownership guard).
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    factory = test_app["session_factory"]
    _register(client, email="own@x.io", username="ownjob")
    other = _register(client, email="oth@x.io", username="othjob")
    owner_id = _user_id(factory, "own@x.io")
    job_id = _add_job(
        factory, user_id=owner_id, status=UserDataExportStatus.running, progress=1
    )

    res = client.get(
        f"/api/v1/auth/me/export/jobs/{job_id}",
        headers=_auth_headers(other["tokens"]["access_token"]),
    )
    assert res.status_code == 404


# --------------------------------------------------------------------------- #
# GET /me/export/jobs/{job_id}/download                                        #
# --------------------------------------------------------------------------- #
def test_download_export_job_not_found(test_app) -> None:
    import uuid

    client: TestClient = test_app["client"]  # type: ignore[assignment]
    body = _register(client, email="dl1@x.io", username="dl1")
    token = body["tokens"]["access_token"]

    res = client.get(
        f"/api/v1/auth/me/export/jobs/{uuid.uuid4()}/download",
        headers=_auth_headers(token),
    )
    assert res.status_code == 404


def test_download_export_job_not_ready(test_app) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    factory = test_app["session_factory"]
    body = _register(client, email="dl2@x.io", username="dl2")
    token = body["tokens"]["access_token"]
    uid = _user_id(factory, "dl2@x.io")
    job_id = _add_job(
        factory, user_id=uid, status=UserDataExportStatus.running, progress=10
    )

    res = client.get(
        f"/api/v1/auth/me/export/jobs/{job_id}/download", headers=_auth_headers(token)
    )
    assert res.status_code == 400


def test_download_export_job_expired(test_app) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    factory = test_app["session_factory"]
    body = _register(client, email="dl3@x.io", username="dl3")
    token = body["tokens"]["access_token"]
    uid = _user_id(factory, "dl3@x.io")
    job_id = _add_job(
        factory,
        user_id=uid,
        status=UserDataExportStatus.succeeded,
        progress=100,
        file_path="exports/x.json",
        expires_at=datetime.now() - timedelta(days=1),  # naive + past
    )

    res = client.get(
        f"/api/v1/auth/me/export/jobs/{job_id}/download", headers=_auth_headers(token)
    )
    assert res.status_code == 404


def test_download_export_job_file_missing(test_app, monkeypatch, tmp_path) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    factory = test_app["session_factory"]
    body = _register(client, email="dl4@x.io", username="dl4")
    token = body["tokens"]["access_token"]
    uid = _user_id(factory, "dl4@x.io")
    job_id = _add_job(
        factory,
        user_id=uid,
        status=UserDataExportStatus.succeeded,
        progress=100,
        file_path="exports/missing.json",
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    )
    # resolve to a path that does not exist.
    monkeypatch.setattr(
        "app.api.v1.auth.private_storage.resolve_private_path",
        lambda p: tmp_path / "nope.json",
    )

    res = client.get(
        f"/api/v1/auth/me/export/jobs/{job_id}/download", headers=_auth_headers(token)
    )
    assert res.status_code == 404


def test_download_export_job_success(test_app, monkeypatch, tmp_path) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    factory = test_app["session_factory"]
    body = _register(client, email="dl5@x.io", username="dl5")
    token = body["tokens"]["access_token"]
    uid = _user_id(factory, "dl5@x.io")
    export_file = tmp_path / "export.json"
    export_file.write_text('{"ok": true}', encoding="utf-8")
    job_id = _add_job(
        factory,
        user_id=uid,
        status=UserDataExportStatus.succeeded,
        progress=100,
        file_path="exports/export.json",
        finished_at=datetime.now(timezone.utc),
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    )
    monkeypatch.setattr(
        "app.api.v1.auth.private_storage.resolve_private_path",
        lambda p: export_file,
    )

    res = client.get(
        f"/api/v1/auth/me/export/jobs/{job_id}/download", headers=_auth_headers(token)
    )
    assert res.status_code == 200
    assert res.json() == {"ok": True}
    assert "no-store" in res.headers.get("cache-control", "")
