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


async def run_user_export_job(engine: AsyncEngine, *, job_id: UUID) -> None:
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False, autoflush=False, class_=AsyncSession)
    async with SessionLocal() as session:
        job = await session.get(UserDataExportJob, job_id)
        if not job:
            return
        if job.status not in (UserDataExportStatus.pending, UserDataExportStatus.running):
            return

        now = datetime.now(timezone.utc)
        try:
            job.status = UserDataExportStatus.running
            job.started_at = job.started_at or now
            job.finished_at = None
            job.error_message = None
            job.progress = max(int(job.progress or 0), 1)
            session.add(job)
            await session.commit()

            user = await session.get(User, job.user_id)
            if not user:
                raise RuntimeError("User not found")

            job.progress = max(int(job.progress or 0), 5)
            session.add(job)
            await session.commit()

            payload = await self_service.export_user_data(session, user)

            job.progress = max(int(job.progress or 0), 70)
            session.add(job)
            await session.commit()

            private_root = private_storage.ensure_private_root().resolve()
            export_dir = (private_root / "exports" / str(user.id)).resolve()
            export_dir.mkdir(parents=True, exist_ok=True)
            export_path = export_dir / f"{job.id}.json"

            content = json.dumps(payload, ensure_ascii=False, indent=2)
            await asyncio.to_thread(export_path.write_text, content, encoding="utf-8")

            job.file_path = export_path.relative_to(private_root).as_posix()
            job.progress = 100
            job.status = UserDataExportStatus.succeeded
            job.finished_at = datetime.now(timezone.utc)
            job.expires_at = job.finished_at + timedelta(days=7)
            session.add(job)
            await session.commit()

            title, body = export_ready_copy(getattr(user, "preferred_language", None))
            await notification_service.create_notification(
                session,
                user_id=user.id,
                type="privacy",
                title=title,
                body=body,
                url="/account/privacy",
            )
        except Exception as exc:  # pragma: no cover
            job.status = UserDataExportStatus.failed
            job.error_message = str(exc)[:1000]
            job.finished_at = datetime.now(timezone.utc)
            job.progress = min(int(job.progress or 0), 99)
            session.add(job)
            await session.commit()

