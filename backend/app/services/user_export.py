from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.models.user import User
from app.models.user_export import UserDataExportJob, UserDataExportStatus
from app.services import notifications as notification_service
from app.services import private_storage
from app.services import self_service


def export_ready_copy(lang: str | None) -> tuple[str, str]:
    if (lang or "").strip().lower().startswith("ro"):
        return (
            "Exportul tău de date este gata",
            "Îl poți descărca din cont → Confidențialitate.",
        )
    return ("Your data export is ready", "Download it from Account → Privacy.")


async def _set_job_progress(session: AsyncSession, job: UserDataExportJob, progress: int) -> None:
    job.progress = max(int(job.progress or 0), int(progress))
    session.add(job)
    await session.commit()


async def _mark_job_running(session: AsyncSession, job: UserDataExportJob) -> None:
    now = datetime.now(timezone.utc)
    job.status = UserDataExportStatus.running
    job.started_at = job.started_at or now
    job.finished_at = None
    job.error_message = None
    session.add(job)
    await session.commit()
    await _set_job_progress(session, job, 1)


async def _write_export_payload_file(*, user_id: UUID, job_id: UUID, payload: dict) -> str:
    private_root = private_storage.ensure_private_root().resolve()
    export_dir = (private_root / "exports" / str(user_id)).resolve()
    export_dir.mkdir(parents=True, exist_ok=True)
    export_path = export_dir / f"{job_id}.json"
    content = json.dumps(payload, ensure_ascii=False, indent=2)
    await asyncio.to_thread(export_path.write_text, content, encoding="utf-8")
    return export_path.relative_to(private_root).as_posix()


async def _mark_job_succeeded(session: AsyncSession, job: UserDataExportJob, *, file_path: str) -> None:
    finished_at = datetime.now(timezone.utc)
    job.file_path = file_path
    job.progress = 100
    job.status = UserDataExportStatus.succeeded
    job.finished_at = finished_at
    job.expires_at = finished_at + timedelta(days=7)
    session.add(job)
    await session.commit()


async def _notify_export_ready(session: AsyncSession, user: User) -> None:
    title, body = export_ready_copy(getattr(user, "preferred_language", None))
    await notification_service.create_notification(
        session,
        user_id=user.id,
        type="privacy",
        title=title,
        body=body,
        url="/account/privacy",
    )


async def _mark_job_failed(session: AsyncSession, job: UserDataExportJob, exc: Exception) -> None:
    job.status = UserDataExportStatus.failed
    job.error_message = str(exc)[:1000]
    job.finished_at = datetime.now(timezone.utc)
    job.progress = min(int(job.progress or 0), 99)
    session.add(job)
    await session.commit()


async def run_user_export_job(engine: AsyncEngine, *, job_id: UUID) -> None:
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False, autoflush=False, class_=AsyncSession)
    async with SessionLocal() as session:
        job = await session.get(UserDataExportJob, job_id)
        if not job:
            return
        if job.status not in (UserDataExportStatus.pending, UserDataExportStatus.running):
            return

        try:
            await _mark_job_running(session, job)
            user = await session.get(User, job.user_id)
            if not user:
                raise RuntimeError("User not found")
            await _set_job_progress(session, job, 5)
            payload = await self_service.export_user_data(session, user)
            await _set_job_progress(session, job, 70)
            file_path = await _write_export_payload_file(user_id=user.id, job_id=job.id, payload=payload)
            await _mark_job_succeeded(session, job, file_path=file_path)
            await _notify_export_ready(session, user)
        except Exception as exc:  # pragma: no cover
            await _mark_job_failed(session, job, exc)
