"""Lean-gate unit coverage for ``app.services.user_export``.

Covers the localized ready-copy helper (RO + EN), the early returns in
``run_user_export_job`` (missing job, already-terminal status), and the full
success path which writes the export file under a temp private root and creates
a completion notification. The ``except`` failure path is already marked
``# pragma: no cover`` in the source.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core import security
from app.core.config import settings
from app.models.user import User, UserRole
from app.models.user_export import UserDataExportJob, UserDataExportStatus
from app.services import user_export


def test_export_ready_copy_localized() -> None:
    ro_title, ro_body = user_export.export_ready_copy("ro-RO")
    assert ro_title.startswith("Exportul")
    en_title, en_body = user_export.export_ready_copy("en")
    assert en_title == "Your data export is ready"
    # None falls back to English.
    assert user_export.export_ready_copy(None)[0] == "Your data export is ready"


def _make_engine():
    import app.models  # noqa: F401  (register all tables)
    from app.db.base import Base

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)

    async def _init() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_init())
    return engine


def test_run_user_export_job_missing_job() -> None:
    engine = _make_engine()
    from uuid import uuid4

    async def run() -> None:
        await user_export.run_user_export_job(
            engine, job_id=uuid4()
        )  # no row -> return

    asyncio.run(run())


def test_run_user_export_job_terminal_status_skipped() -> None:
    engine = _make_engine()
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

    async def run() -> None:
        async with SessionLocal() as session:
            user = User(
                email="exp@e.com",
                username="exp_user",
                hashed_password=security.hash_password("pw123456"),
                role=UserRole.customer,
            )
            session.add(user)
            await session.commit()
            await session.refresh(user)
            job = UserDataExportJob(
                user_id=user.id, status=UserDataExportStatus.succeeded
            )
            session.add(job)
            await session.commit()
            await session.refresh(job)
            job_id = job.id

        await user_export.run_user_export_job(engine, job_id=job_id)

        async with SessionLocal() as session:
            again = await session.get(UserDataExportJob, job_id)
            # Untouched (still succeeded, no progress changes from this run).
            assert again.status == UserDataExportStatus.succeeded

    asyncio.run(run())


def test_run_user_export_job_user_missing_marks_failed(monkeypatch, tmp_path) -> None:
    # SQLite does not enforce FKs by default, so a job can reference a missing
    # user; ``session.get(User, ...)`` returns None and the job is failed.
    monkeypatch.setattr(settings, "private_media_root", str(tmp_path), raising=False)
    engine = _make_engine()
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)
    from uuid import uuid4

    async def run() -> None:
        async with SessionLocal() as session:
            job = UserDataExportJob(
                user_id=uuid4(), status=UserDataExportStatus.pending
            )
            session.add(job)
            await session.commit()
            await session.refresh(job)
            job_id = job.id

        await user_export.run_user_export_job(engine, job_id=job_id)

        async with SessionLocal() as session:
            done = await session.get(UserDataExportJob, job_id)
            assert done.status == UserDataExportStatus.failed
            assert "User not found" in (done.error_message or "")

    asyncio.run(run())


def test_run_user_export_job_success(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(settings, "private_media_root", str(tmp_path), raising=False)
    engine = _make_engine()
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

    async def run() -> None:
        async with SessionLocal() as session:
            user = User(
                email="success@e.com",
                username="success_user",
                hashed_password=security.hash_password("pw123456"),
                role=UserRole.customer,
                preferred_language="ro",
            )
            session.add(user)
            await session.commit()
            await session.refresh(user)
            job = UserDataExportJob(
                user_id=user.id, status=UserDataExportStatus.pending
            )
            session.add(job)
            await session.commit()
            await session.refresh(job)
            job_id = job.id
            user_id = user.id

        await user_export.run_user_export_job(engine, job_id=job_id)

        async with SessionLocal() as session:
            done = await session.get(UserDataExportJob, job_id)
            assert done.status == UserDataExportStatus.succeeded
            assert done.progress == 100
            assert done.file_path is not None
            assert done.expires_at is not None

            # The export file exists and contains the user's id.
            export_file = Path(tmp_path) / done.file_path
            assert export_file.exists()
            payload = json.loads(export_file.read_text(encoding="utf-8"))
            assert payload["user"]["id"] == str(user_id)

    asyncio.run(run())
