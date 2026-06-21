"""Final branch-closing coverage for ``app.api.v1.auth``.

Coverage worker [w2], batch 4. Closes the last residual branches: consent-doc
happy path, the non-silent refresh guard raises, the refresh rotation-grace
naive-datetime arc, two-factor-login account-deletion guards, the data-export
``export_me`` / latest / get / download handlers (incl. engine-unavailable and
expired/missing-file branches), the admin Google-cleanup endpoint, and the
Google-callback account-deletion / admin-known-device arcs.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable
from uuid import uuid4

import pytest
from fastapi import HTTPException, Response, status

from app.api.v1 import auth as a
from app.core import security
from app.core.config import settings
from app.db.base import Base
from app.models.content import ContentBlock, ContentStatus
from app.models.user import RefreshSession, User, UserRole
from app.models.user_export import UserDataExportJob, UserDataExportStatus
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
        self,
        *,
        headers: dict[str, str] | None = None,
        client_host: str | None = "1.2.3.4",
    ) -> None:
        self.headers = headers or {}
        self.client = type("C", (), {"host": client_host})() if client_host else None


class _BG:
    def __init__(self) -> None:
        self.tasks: list[Any] = []

    def add_task(self, fn: Any, *args: Any, **kwargs: Any) -> None:
        self.tasks.append((fn, args, kwargs))


async def _mk_user(session, **kwargs: Any) -> User:
    defaults: dict[str, Any] = dict(
        id=uuid4(),
        email=f"u{uuid4().hex[:8]}@example.com",
        username=f"u{uuid4().hex[:8]}",
        hashed_password="hashed",
        role=UserRole.customer,
        preferred_language="en",
    )
    defaults.update(kwargs)
    user = User(**defaults)
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


def _refresh_request(token: str = "") -> Any:
    return SimpleNamespace(refresh_token=token)


def _no_security_event(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _noop(*a, **k):
        return None

    monkeypatch.setattr(a.auth_service, "record_security_event", _noop)


# --------------------------------------------------------------------------- #
# consent docs happy path (176)                                              #
# --------------------------------------------------------------------------- #
def test_require_consent_docs_present(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        session.add(
            ContentBlock(
                key="page.terms-and-conditions",
                title="T",
                body_markdown="T",
                status=ContentStatus.published,
                version=3,
                published_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
            )
        )
        await session.commit()
        return await a._require_published_consent_docs(
            session, ("page.terms-and-conditions",)
        )

    versions = run(session_factory, _scenario)
    assert versions["page.terms-and-conditions"] == 3


# --------------------------------------------------------------------------- #
# refresh non-silent raises (1179) + user-not-found (1213) + deletion (1224) #
# --------------------------------------------------------------------------- #
def test_refresh_missing_jti_raises(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(security, "decode_token", lambda t: {"type": "refresh"})

    async def _scenario(session) -> Any:
        with pytest.raises(HTTPException):
            await a.refresh_tokens(
                refresh_request=_refresh_request("rt"),
                request=_Req(),
                session=session,
                _=None,
                response=Response(),
            )

    run(session_factory, _scenario)


def test_refresh_invalid_type_raises(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(security, "decode_token", lambda t: {"type": "access"})

    async def _scenario(session) -> Any:
        with pytest.raises(HTTPException):
            await a.refresh_tokens(
                refresh_request=_refresh_request("rt"),
                request=_Req(),
                session=session,
                _=None,
                response=Response(),
            )

    run(session_factory, _scenario)


def test_refresh_user_not_found(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _scenario(session) -> Any:
        # Create a refresh session row whose user was then removed.
        user = await _mk_user(session)
        rs = RefreshSession(
            id=uuid4(),
            user_id=user.id,
            jti="j-orphan",
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
            persistent=True,
            revoked=False,
        )
        session.add(rs)
        await session.commit()
        await session.delete(user)
        await session.commit()
        monkeypatch.setattr(
            security,
            "decode_token",
            lambda t: {"type": "refresh", "jti": "j-orphan", "sub": str(user.id)},
        )
        with pytest.raises(HTTPException) as exc:
            await a.refresh_tokens(
                refresh_request=_refresh_request("rt"),
                request=_Req(),
                session=session,
                _=None,
                response=Response(),
            )
        assert exc.value.detail == "User not found"

    run(session_factory, _scenario)


def test_refresh_deletion_due_executes(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(a.self_service, "is_deletion_due", lambda u: True)

    async def _exec(s, u):
        return None

    monkeypatch.setattr(a.self_service, "execute_account_deletion", _exec)

    async def _scenario(session) -> Any:
        user = await _mk_user(
            session,
            deletion_scheduled_for=datetime.now(timezone.utc) - timedelta(hours=1),
        )
        rs = RefreshSession(
            id=uuid4(),
            user_id=user.id,
            jti="j-del",
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
            persistent=True,
            revoked=False,
        )
        session.add(rs)
        await session.commit()
        monkeypatch.setattr(
            security,
            "decode_token",
            lambda t: {"type": "refresh", "jti": "j-del", "sub": str(user.id)},
        )
        with pytest.raises(HTTPException) as exc:
            await a.refresh_tokens(
                refresh_request=_refresh_request("rt"),
                request=_Req(),
                session=session,
                _=None,
                response=Response(),
            )
        assert exc.value.detail == "Account deleted"

    run(session_factory, _scenario)


def test_refresh_grace_replay_naive_datetimes(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Rotation-grace replay with naive rotated_at / replacement expiry (348, 1252)."""
    monkeypatch.setattr(settings, "refresh_token_rotation_grace_seconds", 120)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        replacement = RefreshSession(
            id=uuid4(),
            user_id=user.id,
            jti="repl",
            expires_at=(datetime.now(timezone.utc) + timedelta(days=1)).replace(
                tzinfo=None
            ),
            persistent=True,
            revoked=False,
        )
        old = RefreshSession(
            id=uuid4(),
            user_id=user.id,
            jti="old",
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
            persistent=True,
            revoked=True,
            revoked_reason="rotated",
            rotated_at=datetime.now(timezone.utc).replace(tzinfo=None),
            replaced_by_jti="repl",
        )
        session.add_all([replacement, old])
        await session.commit()
        monkeypatch.setattr(
            security,
            "decode_token",
            lambda t: {"type": "refresh", "jti": "old", "sub": str(user.id)},
        )
        return await a.refresh_tokens(
            refresh_request=_refresh_request("rt"),
            request=_Req(),
            session=session,
            _=None,
            response=Response(),
        )

    out = run(session_factory, _scenario)
    assert out.access_token


# --------------------------------------------------------------------------- #
# login_two_factor deletion guards (787, 793-794)                            #
# --------------------------------------------------------------------------- #
def test_login_2fa_deleted_account(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _scenario(session) -> Any:
        user = await _mk_user(session, deleted_at=datetime.now(timezone.utc))
        monkeypatch.setattr(
            security,
            "decode_token",
            lambda t: {"type": "two_factor", "sub": str(user.id)},
        )
        with pytest.raises(HTTPException) as exc:
            await a.login_two_factor(
                payload=SimpleNamespace(two_factor_token="t", code="1"),
                request=_Req(),
                background_tasks=_BG(),
                session=session,
                _=None,
                response=Response(),
            )
        assert exc.value.detail == "Account deleted"

    run(session_factory, _scenario)


def test_login_2fa_deletion_due(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(a.self_service, "is_deletion_due", lambda u: True)

    async def _exec(s, u):
        return None

    monkeypatch.setattr(a.self_service, "execute_account_deletion", _exec)

    async def _scenario(session) -> Any:
        user = await _mk_user(
            session,
            deletion_scheduled_for=datetime.now(timezone.utc) - timedelta(hours=1),
        )
        monkeypatch.setattr(
            security,
            "decode_token",
            lambda t: {"type": "two_factor", "sub": str(user.id)},
        )
        with pytest.raises(HTTPException) as exc:
            await a.login_two_factor(
                payload=SimpleNamespace(two_factor_token="t", code="1"),
                request=_Req(),
                background_tasks=_BG(),
                session=session,
                _=None,
                response=Response(),
            )
        assert exc.value.detail == "Account deleted"

    run(session_factory, _scenario)


def test_login_2fa_admin_known_device_no_alert(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Admin 2FA login on a known device -> no alert task (810, 835->854)."""
    _no_security_event(monkeypatch)

    async def _scenario(session) -> Any:
        user = await _mk_user(session, role=UserRole.admin, two_factor_enabled=True)
        monkeypatch.setattr(
            security,
            "decode_token",
            lambda t: {"type": "two_factor", "sub": str(user.id)},
        )

        async def _verify(s, u, code):
            return True

        async def _seen(s, *, user_id, user_agent):
            return True  # known device

        async def _issue(s, u, **k):
            return {"access_token": "at", "refresh_token": "rt"}

        monkeypatch.setattr(a.auth_service, "verify_two_factor_code", _verify)
        monkeypatch.setattr(a.auth_service, "has_seen_refresh_device", _seen)
        monkeypatch.setattr(a.auth_service, "issue_tokens_for_user", _issue)
        bg = _BG()
        out = await a.login_two_factor(
            payload=SimpleNamespace(two_factor_token="t", code="1"),
            request=_Req(),
            background_tasks=bg,
            session=session,
            _=None,
            response=Response(),
        )
        assert len(bg.tasks) == 0
        return out

    assert run(session_factory, _scenario).tokens.access_token == "at"


# --------------------------------------------------------------------------- #
# export_me / export jobs latest+get success / download                      #
# --------------------------------------------------------------------------- #
def test_export_me(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _export(s, u):
        return {"user": "data"}

    monkeypatch.setattr(a.self_service, "export_user_data", _export)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        return await a.export_me(current_user=user, session=session)

    resp = run(session_factory, _scenario)
    assert resp.status_code == 200


def _seed_job(session, user_id, **kw):
    defaults = dict(
        id=uuid4(),
        user_id=user_id,
        status=UserDataExportStatus.succeeded,
        progress=100,
    )
    defaults.update(kw)
    job = UserDataExportJob(**defaults)
    session.add(job)
    return job


def test_latest_export_job_success(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        _seed_job(session, user.id)
        await session.commit()
        return await a.latest_export_job(current_user=user, session=session)

    out = run(session_factory, _scenario)
    assert out.status == UserDataExportStatus.succeeded


def test_get_export_job_success(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        job = _seed_job(session, user.id)
        await session.commit()
        return await a.get_export_job(job_id=job.id, current_user=user, session=session)

    out = run(session_factory, _scenario)
    assert out.progress == 100


def test_get_export_job_wrong_user(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        owner = await _mk_user(session)
        other = await _mk_user(session)
        job = _seed_job(session, owner.id)
        await session.commit()
        with pytest.raises(HTTPException):
            await a.get_export_job(job_id=job.id, current_user=other, session=session)

    run(session_factory, _scenario)


def test_download_export_job_not_found(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        with pytest.raises(HTTPException):
            await a.download_export_job(
                job_id=uuid4(), current_user=user, session=session
            )

    run(session_factory, _scenario)


def test_download_export_job_not_ready(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        job = _seed_job(
            session, user.id, status=UserDataExportStatus.running, file_path=None
        )
        await session.commit()
        with pytest.raises(HTTPException) as exc:
            await a.download_export_job(
                job_id=job.id, current_user=user, session=session
            )
        assert "not ready" in exc.value.detail

    run(session_factory, _scenario)


def test_download_export_job_expired(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        job = _seed_job(
            session,
            user.id,
            file_path="export.json",
            expires_at=datetime.now(timezone.utc) - timedelta(days=1),
        )
        await session.commit()
        with pytest.raises(HTTPException):
            await a.download_export_job(
                job_id=job.id, current_user=user, session=session
            )

    run(session_factory, _scenario)


def test_download_export_job_file_missing(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        a.private_storage,
        "resolve_private_path",
        lambda p: Path("/nonexistent/file.json"),
    )

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        job = _seed_job(
            session,
            user.id,
            file_path="export.json",
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
        )
        await session.commit()
        with pytest.raises(HTTPException) as exc:
            await a.download_export_job(
                job_id=job.id, current_user=user, session=session
            )
        assert "file not found" in exc.value.detail.lower()

    run(session_factory, _scenario)


def test_download_export_job_success(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    export_file = tmp_path / "export.json"
    export_file.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(
        a.private_storage, "resolve_private_path", lambda p: export_file
    )

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        job = _seed_job(
            session,
            user.id,
            file_path="export.json",
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
            finished_at=datetime(2024, 1, 2, tzinfo=timezone.utc),
        )
        await session.commit()
        return await a.download_export_job(
            job_id=job.id, current_user=user, session=session
        )

    resp = run(session_factory, _scenario)
    assert resp.media_type == "application/json"


def test_start_export_job_pending_engine_unavailable(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Pending job but session.bind is not an AsyncEngine -> 500 (1999)."""

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        _seed_job(session, user.id, status=UserDataExportStatus.pending, progress=0)
        await session.commit()

        # Wrap the session so ``session.bind`` is not an AsyncEngine, forcing the
        # engine-unavailable guard. ``__getattr__`` delegates everything else.
        class _NoEngineSession:
            def __init__(self, inner):
                object.__setattr__(self, "_inner", inner)

            @property
            def bind(self):
                return object()

            def __getattr__(self, name):
                return getattr(object.__getattribute__(self, "_inner"), name)

        wrapped = _NoEngineSession(session)
        with pytest.raises(HTTPException) as exc:
            await a.start_export_job(
                background_tasks=_BG(), current_user=user, session=wrapped
            )
        assert exc.value.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR

    run(session_factory, _scenario)


def test_start_export_job_succeeded_expired_creates_new(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Latest succeeded job is expired -> a new job is created (2012-2033)."""
    monkeypatch.setattr(
        a.user_export_service, "run_user_export_job", lambda *a, **k: None
    )

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        _seed_job(
            session,
            user.id,
            status=UserDataExportStatus.succeeded,
            expires_at=datetime.now(timezone.utc) - timedelta(days=1),
        )
        await session.commit()
        bg = _BG()
        out = await a.start_export_job(
            background_tasks=bg, current_user=user, session=session
        )
        assert len(bg.tasks) == 1
        return out

    assert run(session_factory, _scenario).status == UserDataExportStatus.pending


# --------------------------------------------------------------------------- #
# admin cleanup incomplete google                                            #
# --------------------------------------------------------------------------- #
def test_admin_cleanup_incomplete_google(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _cleanup(s, *, max_age_hours):
        return 4

    monkeypatch.setattr(a.self_service, "cleanup_incomplete_google_accounts", _cleanup)

    async def _scenario(session) -> Any:
        return await a.admin_cleanup_incomplete_google_accounts(
            max_age_hours=10, _=None, session=session
        )

    assert run(session_factory, _scenario)["deleted"] == 4


# --------------------------------------------------------------------------- #
# google_callback deletion / admin known-device arcs                         #
# --------------------------------------------------------------------------- #
def _google_profile() -> dict:
    return dict(
        sub="g1",
        email="user@x.com",
        name="Goog",
        picture="http://g/p.png",
        email_verified=True,
        given_name="Goog",
        family_name="User",
    )


def _patch_google_common(monkeypatch: pytest.MonkeyPatch, profile: dict) -> None:
    monkeypatch.setattr(a, "_validate_google_state", lambda *a, **k: None)

    async def _exchange(code):
        return profile

    async def _cleanup(s):
        return None

    monkeypatch.setattr(a.auth_service, "exchange_google_code", _exchange)
    monkeypatch.setattr(
        a.self_service, "maybe_cleanup_incomplete_google_accounts", _cleanup
    )
    monkeypatch.setattr(settings, "google_allowed_domains", [])


def test_google_callback_existing_deletion_due(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_google_common(monkeypatch, _google_profile())
    monkeypatch.setattr(a.self_service, "is_deletion_due", lambda u: True)

    async def _exec(s, u):
        return None

    monkeypatch.setattr(a.self_service, "execute_account_deletion", _exec)

    async def _scenario(session) -> Any:
        user = await _mk_user(
            session,
            google_sub="g1",
            deletion_scheduled_for=datetime.now(timezone.utc) - timedelta(hours=1),
        )

        async def _by_sub(s, sub):
            return user

        monkeypatch.setattr(a.auth_service, "get_user_by_google_sub", _by_sub)
        with pytest.raises(HTTPException) as exc:
            await a.google_callback(
                payload=SimpleNamespace(code="c", state="s"),
                request=_Req(),
                background_tasks=_BG(),
                session=session,
                response=Response(),
                _=None,
            )
        assert exc.value.detail == "Account deleted"

    run(session_factory, _scenario)


def test_google_callback_existing_deleted(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_google_common(monkeypatch, _google_profile())
    monkeypatch.setattr(a.self_service, "is_deletion_due", lambda u: False)

    async def _scenario(session) -> Any:
        user = await _mk_user(
            session, google_sub="g1", deleted_at=datetime.now(timezone.utc)
        )

        async def _by_sub(s, sub):
            return user

        monkeypatch.setattr(a.auth_service, "get_user_by_google_sub", _by_sub)
        with pytest.raises(HTTPException) as exc:
            await a.google_callback(
                payload=SimpleNamespace(code="c", state="s"),
                request=_Req(),
                background_tasks=_BG(),
                session=session,
                response=Response(),
                _=None,
            )
        assert exc.value.detail == "Account deleted"

    run(session_factory, _scenario)


def test_google_callback_existing_admin_known_device(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Admin Google login on a known device (no alert) -> 2649/2670 arcs."""
    _patch_google_common(monkeypatch, _google_profile())
    monkeypatch.setattr(a.self_service, "is_deletion_due", lambda u: False)
    monkeypatch.setattr(a.auth_service, "is_profile_complete", lambda u: True)
    _no_security_event(monkeypatch)

    async def _scenario(session) -> Any:
        user = await _mk_user(session, google_sub="g1", role=UserRole.admin)

        async def _by_sub(s, sub):
            return user

        async def _seen(s, *, user_id, user_agent):
            return True

        async def _issue(s, u, **k):
            return {"access_token": "at", "refresh_token": "rt"}

        monkeypatch.setattr(a.auth_service, "get_user_by_google_sub", _by_sub)
        monkeypatch.setattr(a.auth_service, "has_seen_refresh_device", _seen)
        monkeypatch.setattr(a.auth_service, "issue_tokens_for_user", _issue)
        bg = _BG()
        out = await a.google_callback(
            payload=SimpleNamespace(code="c", state="s"),
            request=_Req(),
            background_tasks=bg,
            session=session,
            response=Response(),
            _=None,
        )
        assert len(bg.tasks) == 0
        return out

    assert run(session_factory, _scenario).tokens.access_token == "at"
