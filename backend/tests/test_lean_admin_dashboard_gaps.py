"""Direct-call coverage for the remaining ``app.api.v1.admin_dashboard`` handlers.

Coverage worker [w2]. Companion to ``test_lean_admin_dashboard_api.py``; covers
the GDPR export/deletion endpoints, user role/internal/security updates, email-
verification admin tooling, password-reset resend, impersonation, owner
transfer, maintenance toggles, and the stock/inventory endpoints. Handlers are
invoked directly with an in-memory SQLite session and an admin/owner ``User``;
delegated services (audit chain, pii, step-up, private storage, exporter,
catalog, inventory, user-export, email, auth, security) are monkeypatched on
the *admin_dashboard* namespace.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable
from uuid import uuid4

import pytest
from fastapi import HTTPException, status

from app.api.v1 import admin_dashboard as ad
from app.core import security
from app.db.base import Base
from app.models.user import RefreshSession, User, UserRole
from app.models.user_export import UserDataExportJob, UserDataExportStatus
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
    def __init__(
        self, *, ua: str = "pytest-agent", host: str | None = "127.0.0.1"
    ) -> None:
        self.headers = {"user-agent": ua}
        self.client = type("C", (), {"host": host})() if host is not None else None


class _BG:
    def __init__(self) -> None:
        self.tasks: list[Any] = []

    def add_task(self, fn: Any, *args: Any, **kwargs: Any) -> None:
        self.tasks.append((fn, args, kwargs))


async def _admin(session, *, role: UserRole = UserRole.admin) -> User:
    user = await create_user(
        session,
        UserCreate(
            email=f"{role.value}-{uuid4().hex[:6]}@x.com",
            password="password123",
            name="Admin",
        ),
    )
    user.role = role
    await session.commit()
    await session.refresh(user)
    return user


async def _customer(session, **kwargs: Any) -> User:
    user = await create_user(
        session,
        UserCreate(
            email=f"cust-{uuid4().hex[:6]}@x.com",
            password="password123",
            name="Cust",
        ),
    )
    for k, v in kwargs.items():
        setattr(user, k, v)
    await session.commit()
    await session.refresh(user)
    return user


def _no_audit(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _noop(*a, **k):
        return None

    monkeypatch.setattr(ad.audit_chain_service, "add_admin_audit_log", _noop)


# --------------------------------------------------------------------------- #
# admin_revoke_user_session                                                   #
# --------------------------------------------------------------------------- #
def test_revoke_user_session_user_not_found(
    session_factory: async_sessionmaker,
) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        with pytest.raises(HTTPException) as exc:
            await ad.admin_revoke_user_session(
                user_id=uuid4(),
                session_id=uuid4(),
                request=_Req(),
                session=session,
                current_user=admin,
            )
        assert exc.value.status_code == status.HTTP_404_NOT_FOUND

    run(session_factory, _scenario)


def test_revoke_user_session_session_not_found(
    session_factory: async_sessionmaker,
) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        target = await _customer(session)
        with pytest.raises(HTTPException) as exc:
            await ad.admin_revoke_user_session(
                user_id=target.id,
                session_id=uuid4(),
                request=_Req(),
                session=session,
                current_user=admin,
            )
        assert exc.value.detail == "Session not found"

    run(session_factory, _scenario)


def test_revoke_user_session_success(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _no_audit(monkeypatch)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        target = await _customer(session)
        rs = RefreshSession(
            id=uuid4(),
            user_id=target.id,
            jti="j",
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
            persistent=True,
            revoked=False,
        )
        session.add(rs)
        await session.commit()
        out = await ad.admin_revoke_user_session(
            user_id=target.id,
            session_id=rs.id,
            request=_Req(),
            session=session,
            current_user=admin,
        )
        await session.refresh(rs)
        assert rs.revoked is True
        return out

    assert run(session_factory, _scenario) is None


def test_revoke_user_session_already_revoked_noop(
    session_factory: async_sessionmaker,
) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        target = await _customer(session)
        rs = RefreshSession(
            id=uuid4(),
            user_id=target.id,
            jti="j2",
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
            persistent=True,
            revoked=True,
        )
        session.add(rs)
        await session.commit()
        return await ad.admin_revoke_user_session(
            user_id=target.id,
            session_id=rs.id,
            request=_Req(),
            session=session,
            current_user=admin,
        )

    assert run(session_factory, _scenario) is None


# --------------------------------------------------------------------------- #
# GDPR export jobs list                                                       #
# --------------------------------------------------------------------------- #
def _seed_export_job(session, user_id, **kw):
    defaults = dict(
        id=uuid4(),
        user_id=user_id,
        status=UserDataExportStatus.pending,
        progress=0,
    )
    defaults.update(kw)
    job = UserDataExportJob(**defaults)
    session.add(job)
    return job


def test_gdpr_export_jobs_list_with_filter_and_pii(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        ad.pii_service, "require_pii_reveal", lambda u, request=None: None
    )

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        target = await _customer(session)
        _seed_export_job(
            session,
            target.id,
            status=UserDataExportStatus.pending,
            created_at=datetime.now(timezone.utc) - timedelta(days=60),
        )
        await session.commit()
        return await ad.admin_gdpr_export_jobs(
            request=_Req(),
            q=target.email[:4],
            status_filter=UserDataExportStatus.pending,
            page=1,
            limit=25,
            include_pii=True,
            session=session,
            current_user=admin,
        )

    out = run(session_factory, _scenario)
    assert out.meta.total_items == 1
    assert out.items[0].sla_breached is True  # 60d old pending


def test_gdpr_export_jobs_list_masked(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ad.pii_service, "mask_email", lambda e: "m***@x.com")

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        target = await _customer(session)
        _seed_export_job(session, target.id, status=UserDataExportStatus.succeeded)
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
    assert out.items[0].user.email == "m***@x.com"


# --------------------------------------------------------------------------- #
# GDPR retry / download                                                       #
# --------------------------------------------------------------------------- #
def test_gdpr_retry_export_not_found(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        with pytest.raises(HTTPException):
            await ad.admin_gdpr_retry_export_job(
                job_id=uuid4(),
                background_tasks=_BG(),
                request=_Req(),
                session=session,
                current_user=admin,
            )

    run(session_factory, _scenario)


def test_gdpr_retry_export_success(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _no_audit(monkeypatch)
    monkeypatch.setattr(
        ad.user_export_service, "run_user_export_job", lambda *a, **k: None
    )

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        target = await _customer(session)
        now = datetime.now(timezone.utc)
        job = _seed_export_job(
            session,
            target.id,
            status=UserDataExportStatus.failed,
            created_at=now,
            updated_at=now,
        )
        await session.commit()

        # The handler reads ``job.updated_at`` after its own commit; that column
        # carries an ``onupdate`` default which SQLAlchemy expires post-flush,
        # forcing an async lazy-load with no greenlet context under aiosqlite.
        # Wrap commit to eagerly refresh the job so the value is loaded in the
        # active greenlet (mirrors production where the reload runs in-request).
        real_commit = session.commit

        async def _commit_then_load():
            await real_commit()
            await session.refresh(job)

        monkeypatch.setattr(session, "commit", _commit_then_load)
        bg = _BG()
        out = await ad.admin_gdpr_retry_export_job(
            job_id=job.id,
            background_tasks=bg,
            request=_Req(),
            session=session,
            current_user=admin,
        )
        assert len(bg.tasks) == 1
        return out

    out = run(session_factory, _scenario)
    assert out.status == UserDataExportStatus.pending


def test_gdpr_download_not_ready(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ad.step_up_service, "require_step_up", lambda req, u: None)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        target = await _customer(session)
        job = _seed_export_job(
            session, target.id, status=UserDataExportStatus.running, file_path=None
        )
        await session.commit()
        with pytest.raises(HTTPException) as exc:
            await ad.admin_gdpr_download_export_job(
                job_id=job.id, request=_Req(), session=session, current_user=admin
            )
        assert "not ready" in exc.value.detail

    run(session_factory, _scenario)


def test_gdpr_download_success(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(ad.step_up_service, "require_step_up", lambda req, u: None)
    _no_audit(monkeypatch)
    f = tmp_path / "e.json"
    f.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(ad.private_storage, "resolve_private_path", lambda p: f)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        target = await _customer(session)
        job = _seed_export_job(
            session,
            target.id,
            status=UserDataExportStatus.succeeded,
            file_path="e.json",
            finished_at=datetime.now(timezone.utc),
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
        )
        await session.commit()
        return await ad.admin_gdpr_download_export_job(
            job_id=job.id, request=_Req(), session=session, current_user=admin
        )

    resp = run(session_factory, _scenario)
    assert resp.media_type == "application/json"


# --------------------------------------------------------------------------- #
# GDPR deletions list / execute / cancel                                     #
# --------------------------------------------------------------------------- #
def test_gdpr_deletion_requests_list(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ad.pii_service, "mask_email", lambda e: "m***@x.com")

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        await _customer(
            session,
            deletion_requested_at=datetime.now(timezone.utc),
            deletion_scheduled_for=datetime.now(timezone.utc) + timedelta(days=5),
        )
        return await ad.admin_gdpr_deletion_requests(
            request=_Req(),
            q=None,
            page=1,
            limit=25,
            include_pii=False,
            session=session,
            current_user=admin,
        )

    out = run(session_factory, _scenario)
    assert out.meta.total_items == 1
    assert out.items[0].status == "cooldown"


def test_gdpr_execute_deletion_bad_password(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(security, "verify_password", lambda raw, h: False)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        with pytest.raises(HTTPException) as exc:
            await ad.admin_gdpr_execute_deletion(
                user_id=uuid4(),
                payload=SimpleNamespace(password="x"),
                request=_Req(),
                session=session,
                current_user=admin,
            )
        assert exc.value.detail == "Invalid password"

    run(session_factory, _scenario)


def test_gdpr_execute_deletion_owner_protected(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(security, "verify_password", lambda raw, h: True)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        owner = await _customer(session)
        owner.role = UserRole.owner
        await session.commit()
        with pytest.raises(HTTPException) as exc:
            await ad.admin_gdpr_execute_deletion(
                user_id=owner.id,
                payload=SimpleNamespace(password="x"),
                request=_Req(),
                session=session,
                current_user=admin,
            )
        assert "Owner account cannot be deleted" in exc.value.detail

    run(session_factory, _scenario)


def test_gdpr_execute_deletion_staff_requires_owner(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(security, "verify_password", lambda raw, h: True)

    async def _scenario(session) -> Any:
        admin = await _admin(session, role=UserRole.admin)
        staff = await _customer(session)
        staff.role = UserRole.support
        await session.commit()
        with pytest.raises(HTTPException) as exc:
            await ad.admin_gdpr_execute_deletion(
                user_id=staff.id,
                payload=SimpleNamespace(password="x"),
                request=_Req(),
                session=session,
                current_user=admin,
            )
        assert exc.value.status_code == status.HTTP_403_FORBIDDEN

    run(session_factory, _scenario)


def test_gdpr_execute_deletion_success(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(security, "verify_password", lambda raw, h: True)
    _no_audit(monkeypatch)

    async def _exec(s, u):
        return None

    monkeypatch.setattr(ad.self_service, "execute_account_deletion", _exec)

    async def _scenario(session) -> Any:
        admin = await _admin(session, role=UserRole.owner)
        target = await _customer(session)
        out = await ad.admin_gdpr_execute_deletion(
            user_id=target.id,
            payload=SimpleNamespace(password="x"),
            request=_Req(),
            session=session,
            current_user=admin,
        )
        return out

    assert run(session_factory, _scenario) is None


def test_gdpr_cancel_deletion_not_found(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        with pytest.raises(HTTPException):
            await ad.admin_gdpr_cancel_deletion(
                user_id=uuid4(),
                request=_Req(),
                session=session,
                current_user=admin,
            )

    run(session_factory, _scenario)


def test_gdpr_cancel_deletion_owner_protected(
    session_factory: async_sessionmaker,
) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        owner = await _customer(session)
        owner.role = UserRole.owner
        await session.commit()
        with pytest.raises(HTTPException) as exc:
            await ad.admin_gdpr_cancel_deletion(
                user_id=owner.id,
                request=_Req(),
                session=session,
                current_user=admin,
            )
        assert "Owner account cannot be modified" in exc.value.detail

    run(session_factory, _scenario)


def test_gdpr_cancel_deletion_staff_requires_owner(
    session_factory: async_sessionmaker,
) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session, role=UserRole.admin)
        staff = await _customer(session)
        staff.role = UserRole.content
        await session.commit()
        with pytest.raises(HTTPException) as exc:
            await ad.admin_gdpr_cancel_deletion(
                user_id=staff.id,
                request=_Req(),
                session=session,
                current_user=admin,
            )
        assert exc.value.status_code == status.HTTP_403_FORBIDDEN

    run(session_factory, _scenario)


def test_gdpr_cancel_deletion_success(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _no_audit(monkeypatch)

    async def _scenario(session) -> Any:
        admin = await _admin(session, role=UserRole.owner)
        target = await _customer(
            session,
            deletion_requested_at=datetime.now(timezone.utc),
            deletion_scheduled_for=datetime.now(timezone.utc) + timedelta(days=5),
        )
        out = await ad.admin_gdpr_cancel_deletion(
            user_id=target.id,
            request=_Req(),
            session=session,
            current_user=admin,
        )
        await session.refresh(target)
        assert target.deletion_requested_at is None
        return out

    assert run(session_factory, _scenario) is None


def test_gdpr_cancel_deletion_nothing_scheduled_noop(
    session_factory: async_sessionmaker,
) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session, role=UserRole.owner)
        target = await _customer(session)  # no deletion scheduled
        return await ad.admin_gdpr_cancel_deletion(
            user_id=target.id,
            request=_Req(),
            session=session,
            current_user=admin,
        )

    assert run(session_factory, _scenario) is None


# --------------------------------------------------------------------------- #
# update_user_role / internal / security                                     #
# --------------------------------------------------------------------------- #
def test_update_user_role_forbidden(
    session_factory: async_sessionmaker,
) -> None:
    async def _scenario(session) -> Any:
        actor = await _customer(session)
        actor.role = UserRole.support
        await session.commit()
        with pytest.raises(HTTPException) as exc:
            await ad.update_user_role(
                user_id=uuid4(),
                payload=SimpleNamespace(password="x", role="admin"),
                request=_Req(),
                session=session,
                current_user=actor,
            )
        assert exc.value.status_code == status.HTTP_403_FORBIDDEN

    run(session_factory, _scenario)


def test_update_user_role_bad_password(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(security, "verify_password", lambda raw, h: False)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        with pytest.raises(HTTPException):
            await ad.update_user_role(
                user_id=uuid4(),
                payload=SimpleNamespace(password="x", role="admin"),
                request=_Req(),
                session=session,
                current_user=admin,
            )

    run(session_factory, _scenario)


def test_update_user_role_owner_protected(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(security, "verify_password", lambda raw, h: True)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        owner = await _customer(session)
        owner.role = UserRole.owner
        await session.commit()
        with pytest.raises(HTTPException) as exc:
            await ad.update_user_role(
                user_id=owner.id,
                payload=SimpleNamespace(password="x", role="admin"),
                request=_Req(),
                session=session,
                current_user=admin,
            )
        assert "transferred" in exc.value.detail

    run(session_factory, _scenario)


def test_update_user_role_invalid_role(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(security, "verify_password", lambda raw, h: True)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        target = await _customer(session)
        with pytest.raises(HTTPException) as exc:
            await ad.update_user_role(
                user_id=target.id,
                payload=SimpleNamespace(password="x", role="owner"),
                request=_Req(),
                session=session,
                current_user=admin,
            )
        assert exc.value.detail == "Invalid role"

    run(session_factory, _scenario)


def test_update_user_role_not_found(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(security, "verify_password", lambda raw, h: True)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        with pytest.raises(HTTPException) as exc:
            await ad.update_user_role(
                user_id=uuid4(),
                payload=SimpleNamespace(password="x", role="admin"),
                request=_Req(),
                session=session,
                current_user=admin,
            )
        assert exc.value.status_code == status.HTTP_404_NOT_FOUND

    run(session_factory, _scenario)


def test_update_user_role_success(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(security, "verify_password", lambda raw, h: True)
    _no_audit(monkeypatch)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        target = await _customer(session)
        out = await ad.update_user_role(
            user_id=target.id,
            payload=SimpleNamespace(password="x", role="support"),
            request=_Req(),
            session=session,
            current_user=admin,
        )
        return out

    out = run(session_factory, _scenario)
    assert out["role"] == UserRole.support


def test_update_user_internal_not_found(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        with pytest.raises(HTTPException):
            await ad.update_user_internal(
                user_id=uuid4(),
                payload=_dump_payload({"vip": True}),
                session=session,
                current_user=admin,
            )

    run(session_factory, _scenario)


def _dump_payload(data: dict) -> Any:
    class P(SimpleNamespace):
        def model_dump(self, exclude_unset=False):
            return data

    return P(**data)


def test_update_user_internal_success_with_changes(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _no_audit(monkeypatch)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        target = await _customer(session)
        out = await ad.update_user_internal(
            user_id=target.id,
            payload=_dump_payload({"vip": True, "admin_note": "  flagged  "}),
            session=session,
            current_user=admin,
        )
        return out

    out = run(session_factory, _scenario)
    assert out.vip is True
    assert out.admin_note == "flagged"


def test_update_user_internal_clear_note(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _no_audit(monkeypatch)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        target = await _customer(session, admin_note="prior")
        return await ad.update_user_internal(
            user_id=target.id,
            payload=_dump_payload({"admin_note": None}),
            session=session,
            current_user=admin,
        )

    assert run(session_factory, _scenario).admin_note is None


def test_update_user_security_owner_protected(
    session_factory: async_sessionmaker,
) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        owner = await _customer(session)
        owner.role = UserRole.owner
        await session.commit()
        with pytest.raises(HTTPException) as exc:
            await ad.update_user_security(
                user_id=owner.id,
                payload=_dump_payload({}),
                request=_Req(),
                session=session,
                current_user=admin,
            )
        assert "owner security" in exc.value.detail

    run(session_factory, _scenario)


def test_update_user_security_self_protected(
    session_factory: async_sessionmaker,
) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        with pytest.raises(HTTPException) as exc:
            await ad.update_user_security(
                user_id=admin.id,
                payload=_dump_payload({}),
                request=_Req(),
                session=session,
                current_user=admin,
            )
        assert "your own" in exc.value.detail

    run(session_factory, _scenario)


def test_update_user_security_lock_and_reset(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _no_audit(monkeypatch)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        target = await _customer(session)
        locked_until = datetime.now(timezone.utc) + timedelta(hours=2)
        out = await ad.update_user_security(
            user_id=target.id,
            payload=_dump_payload(
                {
                    "locked_until": locked_until,
                    "locked_reason": "  abuse  ",
                    "password_reset_required": True,
                }
            ),
            request=_Req(),
            session=session,
            current_user=admin,
        )
        return out

    out = run(session_factory, _scenario)
    assert out.locked_reason == "abuse"
    assert out.password_reset_required is True


def test_update_user_security_unlock_clears_reason(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _no_audit(monkeypatch)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        target = await _customer(
            session,
            locked_until=datetime.now(timezone.utc) + timedelta(hours=1),
            locked_reason="old",
        )
        # locked_until in the past -> normalized to None -> reason cleared
        out = await ad.update_user_security(
            user_id=target.id,
            payload=_dump_payload(
                {"locked_until": datetime.now(timezone.utc) - timedelta(hours=1)}
            ),
            request=_Req(),
            session=session,
            current_user=admin,
        )
        return out

    out = run(session_factory, _scenario)
    assert out.locked_until is None
    assert out.locked_reason is None
