"""Additional arc closures for admin_dashboard handlers (batch 5).

Coverage worker [w2]. Closes the GDPR export-list / download tz-aware and
guard arcs and the user-segment ``include_pii`` reveal branches in
``app.api.v1.admin_dashboard``.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1 import admin_dashboard as ad
from app.db.base import Base
from app.models.user import User, UserRole
from app.models.user_export import UserDataExportStatus
from app.schemas.user import UserCreate
from app.services.auth import create_user
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest.fixture
def session_factory() -> async_sessionmaker:
    import app.models  # noqa: F401

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def _init() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_init())
    return factory


def run(factory: async_sessionmaker, coro_fn: Callable[[Any], Any]) -> Any:
    async def _wrapped() -> Any:
        async with factory() as session:
            return await coro_fn(session)

    return asyncio.run(_wrapped())


class _Req:
    def __init__(self, *, ua: str = "agent", host: str | None = "127.0.0.1") -> None:
        self.headers = {"user-agent": ua}
        self.client = type("C", (), {"host": host})() if host is not None else None


class _BG:
    def __init__(self) -> None:
        self.tasks: list[Any] = []

    def add_task(self, fn: Any, *args: Any, **kwargs: Any) -> None:
        self.tasks.append((fn, args, kwargs))


class _RowsResult:
    """Stub ``session.execute`` result yielding ``(job, user)`` tuples."""

    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def all(self) -> list[Any]:
        return self._rows


async def _admin(session, *, role: UserRole = UserRole.admin) -> User:
    user = await create_user(
        session,
        UserCreate(
            email=f"{role.value}-{uuid4().hex[:6]}@x.com",
            password="password123",
            name="A",
        ),
    )
    user.role = role
    await session.commit()
    await session.refresh(user)
    return user


def _no_audit(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _noop(*a, **k):
        return None

    monkeypatch.setattr(ad.audit_chain_service, "add_admin_audit_log", _noop)


# --------------------------------------------------------------------------- #
# GDPR export list: tz-aware started/finished/expires skip arcs (4003/6/9)    #
# --------------------------------------------------------------------------- #
def test_gdpr_export_jobs_aware_timestamps(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ad.pii_service, "mask_email", lambda e: "m***@x.com")

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        now = datetime.now(timezone.utc)
        job = SimpleNamespace(
            id=uuid4(),
            status=UserDataExportStatus.succeeded,
            progress=100,
            created_at=now,
            updated_at=now,
            started_at=now,  # aware -> 4002->4004 skip
            finished_at=now,  # aware -> 4005->4007 skip
            expires_at=now + timedelta(days=1),  # aware -> 4008->4010 skip
            file_path="e.json",
        )
        user = SimpleNamespace(
            id=uuid4(), email="u@x.com", username="u", role=UserRole.customer
        )

        async def _execute(*args, **kwargs):
            return _RowsResult([(job, user)])

        async def _scalar(*args, **kwargs):
            return 1

        monkeypatch.setattr(session, "execute", _execute)
        monkeypatch.setattr(session, "scalar", _scalar)
        return await ad.admin_gdpr_export_jobs(
            request=_Req(),
            q=None,
            status_filter=None,
            page=1,
            limit=25,
            include_pii=False,
            session=session,
            current_user=admin,
        )

    out = run(session_factory, _scenario)
    assert out.items[0].started_at is not None
    assert out.items[0].finished_at is not None


def test_gdpr_export_jobs_naive_timestamps(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Real seeded job with set started/finished/expires -> aiosqlite returns
    naive datetimes, exercising the normalize branches (4003/4006/4009)."""
    from app.models.user_export import UserDataExportJob

    monkeypatch.setattr(ad.pii_service, "mask_email", lambda e: "m***@x.com")

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        target = await create_user(
            session, UserCreate(email="jt@x.com", password="password123", name="JT")
        )
        await session.commit()
        now = datetime.now(timezone.utc)
        session.add(
            UserDataExportJob(
                id=uuid4(),
                user_id=target.id,
                status=UserDataExportStatus.succeeded,
                progress=100,
                started_at=now,
                finished_at=now,
                expires_at=now + timedelta(days=1),
                file_path="e.json",
            )
        )
        await session.commit()
        return await ad.admin_gdpr_export_jobs(
            request=_Req(),
            q=None,
            status_filter=None,
            page=1,
            limit=25,
            include_pii=False,
            session=session,
            current_user=admin,
        )

    out = run(session_factory, _scenario)
    assert out.items[0].started_at is not None


# --------------------------------------------------------------------------- #
# GDPR download: aware-expiry skip, file missing, user gone                   #
# --------------------------------------------------------------------------- #
def _seed_job(session, user_id, **kw):
    from app.models.user_export import UserDataExportJob

    defaults = dict(
        id=uuid4(),
        user_id=user_id,
        status=UserDataExportStatus.succeeded,
        progress=100,
        file_path="e.json",
    )
    defaults.update(kw)
    job = UserDataExportJob(**defaults)
    session.add(job)
    return job


def test_gdpr_download_file_missing(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ad.step_up_service, "require_step_up", lambda req, u: None)
    monkeypatch.setattr(
        ad.private_storage,
        "resolve_private_path",
        lambda p: Path("/no/such/file.json"),
    )

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        target = await create_user(
            session,
            UserCreate(email="t@x.com", password="password123", name="T"),
        )
        await session.commit()
        job = _seed_job(
            session,
            target.id,
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
        )
        await session.commit()
        with pytest.raises(HTTPException) as exc:
            await ad.admin_gdpr_download_export_job(
                job_id=job.id, request=_Req(), session=session, current_user=admin
            )
        assert "file not found" in exc.value.detail.lower()

    run(session_factory, _scenario)


def test_gdpr_download_naive_expiry_success(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Naive future expiry -> exercises the 4157->4158 normalize branch."""
    monkeypatch.setattr(ad.step_up_service, "require_step_up", lambda req, u: None)
    _no_audit(monkeypatch)
    f = tmp_path / "e.json"
    f.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(ad.private_storage, "resolve_private_path", lambda p: f)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        target = await create_user(
            session, UserCreate(email="dl@x.com", password="password123", name="DL")
        )
        await session.commit()
        # naive future expiry; aiosqlite returns it naive on reload
        job = _seed_job(
            session,
            target.id,
            finished_at=datetime.now(timezone.utc),
            expires_at=(datetime.now(timezone.utc) + timedelta(days=1)).replace(
                tzinfo=None
            ),
        )
        await session.commit()
        return await ad.admin_gdpr_download_export_job(
            job_id=job.id, request=_Req(), session=session, current_user=admin
        )

    resp = run(session_factory, _scenario)
    assert resp.media_type == "application/json"


def test_gdpr_download_user_gone(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(ad.step_up_service, "require_step_up", lambda req, u: None)
    f = tmp_path / "e.json"
    f.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(ad.private_storage, "resolve_private_path", lambda p: f)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        ghost = uuid4()
        job = _seed_job(
            session,
            ghost,
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
        )
        await session.commit()
        with pytest.raises(HTTPException) as exc:
            await ad.admin_gdpr_download_export_job(
                job_id=job.id, request=_Req(), session=session, current_user=admin
            )
        assert exc.value.detail == "User not found"

    run(session_factory, _scenario)


# --------------------------------------------------------------------------- #
# user segments: include_pii reveal (2670, 2848)                             #
# --------------------------------------------------------------------------- #
def test_segment_repeat_buyers_include_pii(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    called = {"v": False}

    def _reveal(u, request=None):
        called["v"] = True

    monkeypatch.setattr(ad.pii_service, "require_pii_reveal", _reveal)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        out = await ad.admin_user_segment_repeat_buyers(
            request=_Req(),
            q=None,
            min_orders=2,
            page=1,
            limit=25,
            include_pii=True,
            session=session,
            current_user=admin,
        )
        assert called["v"] is True
        return out

    assert run(session_factory, _scenario).meta.total_items == 0


def test_segment_high_aov_include_pii(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    called = {"v": False}

    def _reveal(u, request=None):
        called["v"] = True

    monkeypatch.setattr(ad.pii_service, "require_pii_reveal", _reveal)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        out = await ad.admin_user_segment_high_aov(
            request=_Req(),
            q=None,
            min_orders=1,
            min_aov=100,
            page=1,
            limit=25,
            include_pii=True,
            session=session,
            current_user=admin,
        )
        assert called["v"] is True
        return out

    assert run(session_factory, _scenario).meta.total_items == 0
