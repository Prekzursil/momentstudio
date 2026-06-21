"""Last-mile branch closures for ``app.api.v1.auth``.

Coverage worker [w2], batch 5. Covers the few remaining arcs: the
``_resolve_active_refresh_session_jti`` revoked-with-replacement path, the
``ProfileUpdate`` date-of-birth validator (real schema instance), passkey-login
deletion guards, the login / two-factor-login owner-email admin-alert arcs, the
export-download naive-expiry normalization, and the new-job engine-unavailable
guard in ``start_export_job``.
"""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone
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


def _no_security_event(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _noop(*a, **k):
        return None

    monkeypatch.setattr(a.auth_service, "record_security_event", _noop)


# --------------------------------------------------------------------------- #
# _resolve_active_refresh_session_jti: revoked -> replacement (335-351)       #
# --------------------------------------------------------------------------- #
def test_resolve_active_jti_revoked_returns_replacement_naive(
    session_factory: async_sessionmaker,
) -> None:
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
        stored = RefreshSession(
            id=uuid4(),
            user_id=user.id,
            jti="stored",
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
            persistent=True,
            revoked=True,
            replaced_by_jti="repl",
        )
        session.add_all([replacement, stored])
        await session.commit()
        return await a._resolve_active_refresh_session_jti(session, user.id, "stored")

    assert run(session_factory, _scenario) == "repl"


def test_resolve_active_jti_revoked_no_replacement_jti(
    session_factory: async_sessionmaker,
) -> None:
    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        stored = RefreshSession(
            id=uuid4(),
            user_id=user.id,
            jti="stored2",
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
            persistent=True,
            revoked=True,
            replaced_by_jti=None,
        )
        session.add(stored)
        await session.commit()
        return await a._resolve_active_refresh_session_jti(session, user.id, "stored2")

    assert run(session_factory, _scenario) is None


def test_resolve_active_jti_revoked_replacement_revoked(
    session_factory: async_sessionmaker,
) -> None:
    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        replacement = RefreshSession(
            id=uuid4(),
            user_id=user.id,
            jti="repl2",
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
            persistent=True,
            revoked=True,  # replacement itself revoked -> None
        )
        stored = RefreshSession(
            id=uuid4(),
            user_id=user.id,
            jti="stored3",
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
            persistent=True,
            revoked=True,
            replaced_by_jti="repl2",
        )
        session.add_all([replacement, stored])
        await session.commit()
        return await a._resolve_active_refresh_session_jti(session, user.id, "stored3")

    assert run(session_factory, _scenario) is None


# --------------------------------------------------------------------------- #
# ProfileUpdate dob validator (419)                                          #
# --------------------------------------------------------------------------- #
def test_profile_update_dob_valid() -> None:
    p = a.ProfileUpdate(date_of_birth=date(1990, 1, 1))
    assert p.date_of_birth == date(1990, 1, 1)


def test_profile_update_dob_future_rejected() -> None:
    with pytest.raises(ValueError):
        a.ProfileUpdate(date_of_birth=date.today() + timedelta(days=1))


# --------------------------------------------------------------------------- #
# passkey_login_verify deletion guards (949, 955-956)                        #
# --------------------------------------------------------------------------- #
def _patch_passkey_login(monkeypatch: pytest.MonkeyPatch, user: User) -> None:
    monkeypatch.setattr(
        security,
        "decode_token",
        lambda t: {"type": "webauthn", "purpose": "login", "challenge": "abc"},
    )
    monkeypatch.setattr(a, "base64url_to_bytes", lambda c: b"abc")
    monkeypatch.setattr(a.auth_service, "is_profile_complete", lambda u: True)
    monkeypatch.setattr(a.metrics, "record_login_success", lambda: None)

    async def _verify(s, *, credential, expected_challenge, user_id):
        return user, SimpleNamespace()

    monkeypatch.setattr(a.passkeys_service, "verify_passkey_authentication", _verify)


def test_passkey_login_verify_deleted(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _scenario(session) -> Any:
        user = await _mk_user(session, deleted_at=datetime.now(timezone.utc))
        _patch_passkey_login(monkeypatch, user)
        with pytest.raises(HTTPException) as exc:
            await a.passkey_login_verify(
                payload=SimpleNamespace(authentication_token="t", credential={}),
                request=_Req(),
                background_tasks=_BG(),
                session=session,
                _=None,
                response=Response(),
            )
        assert exc.value.detail == "Account deleted"

    run(session_factory, _scenario)


def test_passkey_login_verify_deletion_due(
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
        _patch_passkey_login(monkeypatch, user)
        with pytest.raises(HTTPException) as exc:
            await a.passkey_login_verify(
                payload=SimpleNamespace(authentication_token="t", credential={}),
                request=_Req(),
                background_tasks=_BG(),
                session=session,
                _=None,
                response=Response(),
            )
        assert exc.value.detail == "Account deleted"

    run(session_factory, _scenario)


def test_passkey_login_verify_admin_owner_email_alert(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Admin passkey login, unknown device, owner has email -> owner.email arc."""
    _no_security_event(monkeypatch)

    async def _scenario(session) -> Any:
        user = await _mk_user(session, role=UserRole.admin, name="Admin")
        _patch_passkey_login(monkeypatch, user)

        async def _seen(s, *, user_id, user_agent):
            return False

        async def _owner(s):
            return SimpleNamespace(email="owner@x.com", preferred_language="ro")

        async def _issue(s, u, **k):
            return {"access_token": "at", "refresh_token": "rt"}

        monkeypatch.setattr(a.auth_service, "has_seen_refresh_device", _seen)
        monkeypatch.setattr(a.auth_service, "get_owner_user", _owner)
        monkeypatch.setattr(a.auth_service, "issue_tokens_for_user", _issue)
        monkeypatch.setattr(
            a.email_service, "send_admin_login_alert", lambda *a, **k: None
        )
        bg = _BG()
        out = await a.passkey_login_verify(
            payload=SimpleNamespace(authentication_token="t", credential={}),
            request=_Req(),
            background_tasks=bg,
            session=session,
            _=None,
            response=Response(),
        )
        assert len(bg.tasks) == 1
        return out

    assert run(session_factory, _scenario).tokens.access_token == "at"


# --------------------------------------------------------------------------- #
# login owner-email admin-alert arc (836-841 etc.)                           #
# --------------------------------------------------------------------------- #
def test_login_admin_unknown_device_owner_no_email(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Owner exists but has no email -> falls back to admin_alert_email (834->...)."""

    async def _verify(token, remote_ip=None):
        return None

    monkeypatch.setattr(a.captcha_service, "verify", _verify)
    monkeypatch.setattr(a.metrics, "record_login_success", lambda: None)
    monkeypatch.setattr(a.metrics, "record_login_failure", lambda: None)
    _no_security_event(monkeypatch)

    async def _scenario(session) -> Any:
        user = await _mk_user(session, role=UserRole.admin, name="Admin")

        async def _auth(s, i, p):
            return user

        async def _seen(s, *, user_id, user_agent):
            return False

        async def _owner(s):
            return SimpleNamespace(email=None, preferred_language=None)

        async def _issue(s, u, **k):
            return {"access_token": "at", "refresh_token": "rt"}

        monkeypatch.setattr(a.auth_service, "authenticate_user", _auth)
        monkeypatch.setattr(a.auth_service, "has_seen_refresh_device", _seen)
        monkeypatch.setattr(a.auth_service, "get_owner_user", _owner)
        monkeypatch.setattr(a.auth_service, "issue_tokens_for_user", _issue)
        monkeypatch.setattr(settings, "admin_alert_email", "")  # no fallback -> no task
        bg = _BG()
        out = await a.login(
            payload=SimpleNamespace(
                identifier="admin@x.com",
                email=None,
                password="pw",
                captcha_token="c",
                remember=False,
            ),
            request=_Req(),
            background_tasks=bg,
            session=session,
            _=None,
            response=Response(),
        )
        assert len(bg.tasks) == 0  # no owner email + no fallback => no alert
        return out

    assert run(session_factory, _scenario).tokens.access_token == "at"


def test_login_2fa_admin_unknown_device_alert(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Admin 2FA login, unknown device, owner email -> alert (836-852)."""
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
            return False

        async def _owner(s):
            return SimpleNamespace(email="owner@x.com", preferred_language="en")

        async def _issue(s, u, **k):
            return {"access_token": "at", "refresh_token": "rt"}

        monkeypatch.setattr(a.auth_service, "verify_two_factor_code", _verify)
        monkeypatch.setattr(a.auth_service, "has_seen_refresh_device", _seen)
        monkeypatch.setattr(a.auth_service, "get_owner_user", _owner)
        monkeypatch.setattr(a.auth_service, "issue_tokens_for_user", _issue)
        monkeypatch.setattr(
            a.email_service, "send_admin_login_alert", lambda *a, **k: None
        )
        bg = _BG()
        out = await a.login_two_factor(
            payload=SimpleNamespace(two_factor_token="t", code="1"),
            request=_Req(),
            background_tasks=bg,
            session=session,
            _=None,
            response=Response(),
        )
        assert len(bg.tasks) == 1
        return out

    assert run(session_factory, _scenario).tokens.access_token == "at"


# --------------------------------------------------------------------------- #
# google_callback admin unknown device owner-email alert (2671-2687)         #
# --------------------------------------------------------------------------- #
def test_google_callback_admin_unknown_device_alert(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(a, "_validate_google_state", lambda *a, **k: None)
    monkeypatch.setattr(a.self_service, "is_deletion_due", lambda u: False)
    monkeypatch.setattr(a.auth_service, "is_profile_complete", lambda u: True)
    monkeypatch.setattr(settings, "google_allowed_domains", [])
    _no_security_event(monkeypatch)

    async def _exchange(code):
        return dict(
            sub="g1",
            email="user@x.com",
            name="G",
            picture="p",
            email_verified=True,
            given_name="G",
            family_name="U",
        )

    async def _cleanup(s):
        return None

    monkeypatch.setattr(a.auth_service, "exchange_google_code", _exchange)
    monkeypatch.setattr(
        a.self_service, "maybe_cleanup_incomplete_google_accounts", _cleanup
    )

    async def _scenario(session) -> Any:
        user = await _mk_user(session, google_sub="g1", role=UserRole.admin, name="A")

        async def _by_sub(s, sub):
            return user

        async def _seen(s, *, user_id, user_agent):
            return False

        async def _owner(s):
            return SimpleNamespace(email="owner@x.com", preferred_language="en")

        async def _issue(s, u, **k):
            return {"access_token": "at", "refresh_token": "rt"}

        monkeypatch.setattr(a.auth_service, "get_user_by_google_sub", _by_sub)
        monkeypatch.setattr(a.auth_service, "has_seen_refresh_device", _seen)
        monkeypatch.setattr(a.auth_service, "get_owner_user", _owner)
        monkeypatch.setattr(a.auth_service, "issue_tokens_for_user", _issue)
        monkeypatch.setattr(
            a.email_service, "send_admin_login_alert", lambda *a, **k: None
        )
        bg = _BG()
        out = await a.google_callback(
            payload=SimpleNamespace(code="c", state="s"),
            request=_Req(),
            background_tasks=bg,
            session=session,
            response=Response(),
            _=None,
        )
        assert len(bg.tasks) == 1
        return out

    assert run(session_factory, _scenario).tokens.access_token == "at"


# --------------------------------------------------------------------------- #
# download export naive expiry (2092) + start_export new-job engine guard     #
# --------------------------------------------------------------------------- #
def test_download_export_job_naive_expiry_success(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    export_file = tmp_path / "export.json"
    export_file.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(
        a.private_storage, "resolve_private_path", lambda p: export_file
    )

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        job = UserDataExportJob(
            id=uuid4(),
            user_id=user.id,
            status=UserDataExportStatus.succeeded,
            progress=100,
            file_path="export.json",
            # naive expiry exercises the tzinfo-normalization branch (2092)
            expires_at=(datetime.now(timezone.utc) + timedelta(days=1)).replace(
                tzinfo=None
            ),
        )
        session.add(job)
        await session.commit()
        return await a.download_export_job(
            job_id=job.id, current_user=user, session=session
        )

    resp = run(session_factory, _scenario)
    assert resp.media_type == "application/json"


def test_start_export_job_new_engine_unavailable(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    """No prior job -> new job created, but engine not AsyncEngine -> 500 (2026)."""

    async def _scenario(session) -> Any:
        user = await _mk_user(session)

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
