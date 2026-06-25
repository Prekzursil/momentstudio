"""Direct-call coverage for the remaining ``app.api.v1.auth`` route handlers.

Coverage worker [w2], batch 2. Companion to ``test_lean_auth_api_gaps.py``;
covers the login / two-factor-login / step-up / password-change / verification
/ 2FA-lifecycle / alias / cooldown / profile / secondary-email / account-
deletion / session / security-event / avatar / password-reset / Google OAuth
handlers. Each handler coroutine is called directly with an in-memory SQLite
session, a stub request/response, simple payload namespaces, and the delegated
services (``auth_service``/``security``/``email_service``/``captcha_service``/
``self_service``/``metrics``) monkeypatched on the *auth* namespace so the
branch logic in the router -- not the services -- is what is measured.
"""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any, Callable
from uuid import uuid4

import pytest
from fastapi import HTTPException, Response, status

from app.api.v1 import auth as a
from app.core import security
from app.core.config import settings
from app.db.base import Base
from app.models.user import (
    RefreshSession,
    User,
    UserRole,
    UserSecurityEvent,
)
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


# --------------------------------------------------------------------------- #
# Fixtures / helpers                                                          #
# --------------------------------------------------------------------------- #
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


def _pw_ok(monkeypatch: pytest.MonkeyPatch, ok: bool = True) -> None:
    monkeypatch.setattr(security, "verify_password", lambda raw, hashed: ok)


def _no_security_event(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _noop(*a, **k):
        return None

    monkeypatch.setattr(a.auth_service, "record_security_event", _noop)


# --------------------------------------------------------------------------- #
# login                                                                       #
# --------------------------------------------------------------------------- #
def _patch_captcha(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _verify(token, remote_ip=None):
        return None

    monkeypatch.setattr(a.captcha_service, "verify", _verify)
    monkeypatch.setattr(a.metrics, "record_login_success", lambda: None)
    monkeypatch.setattr(a.metrics, "record_login_failure", lambda: None)


def _login_payload(**kw: Any) -> SimpleNamespace:
    base = dict(
        identifier=None,
        email=None,
        password="pw",
        captcha_token="c",
        remember=False,
    )
    base.update(kw)
    return SimpleNamespace(**base)


def test_login_missing_identifier(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_captcha(monkeypatch)

    async def _scenario(session) -> Any:
        with pytest.raises(HTTPException) as exc:
            await a.login(
                payload=_login_payload(identifier="  "),
                request=_Req(),
                background_tasks=_BG(),
                session=session,
                _=None,
                response=Response(),
            )
        assert exc.value.detail == "Identifier is required"

    run(session_factory, _scenario)


def test_login_auth_failure_reraises(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_captcha(monkeypatch)

    async def _auth(session, identifier, password):
        raise HTTPException(status_code=401, detail="bad creds")

    monkeypatch.setattr(a.auth_service, "authenticate_user", _auth)

    async def _scenario(session) -> Any:
        with pytest.raises(HTTPException) as exc:
            await a.login(
                payload=_login_payload(identifier="user@x.com"),
                request=_Req(),
                background_tasks=_BG(),
                session=session,
                _=None,
                response=Response(),
            )
        assert exc.value.detail == "bad creds"

    run(session_factory, _scenario)


def test_login_two_factor_challenge(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_captcha(monkeypatch)

    async def _scenario(session) -> Any:
        user = await _mk_user(session, two_factor_enabled=True)

        async def _auth(s, i, p):
            return user

        monkeypatch.setattr(a.auth_service, "authenticate_user", _auth)
        monkeypatch.setattr(
            security, "create_two_factor_token", lambda *a, **k: "2fa-token"
        )
        out = await a.login(
            payload=_login_payload(identifier="x", remember=True),
            request=_Req(),
            background_tasks=_BG(),
            session=session,
            _=None,
            response=Response(),
        )
        return out

    out = run(session_factory, _scenario)
    assert out.two_factor_token == "2fa-token"


def test_login_admin_unknown_device_alerts(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_captcha(monkeypatch)
    _no_security_event(monkeypatch)

    async def _scenario(session) -> Any:
        user = await _mk_user(session, role=UserRole.admin, name="Admin")

        async def _auth(s, i, p):
            return user

        async def _seen(s, *, user_id, user_agent):
            return False

        async def _owner(s):
            return SimpleNamespace(email="owner@x.com", preferred_language="en")

        async def _issue(s, u, **k):
            return {"access_token": "at", "refresh_token": "rt"}

        monkeypatch.setattr(a.auth_service, "authenticate_user", _auth)
        monkeypatch.setattr(a.auth_service, "has_seen_refresh_device", _seen)
        monkeypatch.setattr(a.auth_service, "get_owner_user", _owner)
        monkeypatch.setattr(a.auth_service, "issue_tokens_for_user", _issue)
        monkeypatch.setattr(
            a.email_service, "send_admin_login_alert", lambda *a, **k: None
        )
        bg = _BG()
        out = await a.login(
            payload=_login_payload(identifier="admin@x.com"),
            request=_Req(headers={"user-agent": "ua"}),
            background_tasks=bg,
            session=session,
            _=None,
            response=Response(),
        )
        assert len(bg.tasks) == 1  # admin alert queued
        return out

    out = run(session_factory, _scenario)
    assert out.tokens.access_token == "at"


def test_login_customer_no_alert(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_captcha(monkeypatch)
    _no_security_event(monkeypatch)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)

        async def _auth(s, i, p):
            return user

        async def _issue(s, u, **k):
            return {"access_token": "at", "refresh_token": "rt"}

        monkeypatch.setattr(a.auth_service, "authenticate_user", _auth)
        monkeypatch.setattr(a.auth_service, "issue_tokens_for_user", _issue)
        bg = _BG()
        out = await a.login(
            payload=_login_payload(identifier="u@x.com"),
            request=_Req(),
            background_tasks=bg,
            session=session,
            _=None,
            response=Response(),
        )
        assert len(bg.tasks) == 0
        return out

    assert run(session_factory, _scenario).tokens.refresh_token == "rt"


# --------------------------------------------------------------------------- #
# login_two_factor                                                            #
# --------------------------------------------------------------------------- #
def _2fa_payload(token: str = "tok", code: str = "123456") -> SimpleNamespace:
    return SimpleNamespace(two_factor_token=token, code=code)


def test_login_2fa_invalid_token(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(security, "decode_token", lambda t: None)

    async def _scenario(session) -> Any:
        with pytest.raises(HTTPException) as exc:
            await a.login_two_factor(
                payload=_2fa_payload(),
                request=_Req(),
                background_tasks=_BG(),
                session=session,
                _=None,
                response=Response(),
            )
        assert exc.value.detail == "Invalid two-factor token"

    run(session_factory, _scenario)


def test_login_2fa_bad_sub(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        security, "decode_token", lambda t: {"type": "two_factor", "sub": "nope"}
    )

    async def _scenario(session) -> Any:
        with pytest.raises(HTTPException):
            await a.login_two_factor(
                payload=_2fa_payload(),
                request=_Req(),
                background_tasks=_BG(),
                session=session,
                _=None,
                response=Response(),
            )

    run(session_factory, _scenario)


def test_login_2fa_user_missing(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        security,
        "decode_token",
        lambda t: {"type": "two_factor", "sub": str(uuid4())},
    )

    async def _scenario(session) -> Any:
        with pytest.raises(HTTPException):
            await a.login_two_factor(
                payload=_2fa_payload(),
                request=_Req(),
                background_tasks=_BG(),
                session=session,
                _=None,
                response=Response(),
            )

    run(session_factory, _scenario)


def test_login_2fa_not_enabled(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _scenario(session) -> Any:
        user = await _mk_user(session, two_factor_enabled=False)
        monkeypatch.setattr(
            security,
            "decode_token",
            lambda t: {"type": "two_factor", "sub": str(user.id)},
        )
        with pytest.raises(HTTPException) as exc:
            await a.login_two_factor(
                payload=_2fa_payload(),
                request=_Req(),
                background_tasks=_BG(),
                session=session,
                _=None,
                response=Response(),
            )
        assert exc.value.detail == "Two-factor is not enabled"

    run(session_factory, _scenario)


def test_login_2fa_bad_code(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _scenario(session) -> Any:
        user = await _mk_user(session, two_factor_enabled=True)
        monkeypatch.setattr(
            security,
            "decode_token",
            lambda t: {"type": "two_factor", "sub": str(user.id)},
        )

        async def _verify(s, u, code):
            return False

        monkeypatch.setattr(a.auth_service, "verify_two_factor_code", _verify)
        with pytest.raises(HTTPException) as exc:
            await a.login_two_factor(
                payload=_2fa_payload(),
                request=_Req(),
                background_tasks=_BG(),
                session=session,
                _=None,
                response=Response(),
            )
        assert exc.value.detail == "Invalid two-factor code"

    run(session_factory, _scenario)


def test_login_2fa_success_google_method(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _no_security_event(monkeypatch)

    async def _scenario(session) -> Any:
        user = await _mk_user(session, two_factor_enabled=True)
        monkeypatch.setattr(
            security,
            "decode_token",
            lambda t: {
                "type": "two_factor",
                "sub": str(user.id),
                "remember": True,
                "method": "google",
            },
        )

        async def _verify(s, u, code):
            return True

        async def _issue(s, u, **k):
            return {"access_token": "at", "refresh_token": "rt"}

        monkeypatch.setattr(a.auth_service, "verify_two_factor_code", _verify)
        monkeypatch.setattr(a.auth_service, "issue_tokens_for_user", _issue)
        out = await a.login_two_factor(
            payload=_2fa_payload(),
            request=_Req(),
            background_tasks=_BG(),
            session=session,
            _=None,
            response=Response(),
        )
        return out

    assert run(session_factory, _scenario).tokens.access_token == "at"


# --------------------------------------------------------------------------- #
# step_up / change_password / verify                                         #
# --------------------------------------------------------------------------- #
def test_step_up_no_password_account(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _scenario(session) -> Any:
        user = await _mk_user(session, hashed_password="")
        with pytest.raises(HTTPException) as exc:
            await a.step_up(
                payload=SimpleNamespace(password="x"),
                request=_Req(),
                _=None,
                session=session,
                current_user=user,
            )
        assert "not available" in exc.value.detail

    run(session_factory, _scenario)


def test_step_up_bad_password(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pw_ok(monkeypatch, False)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        with pytest.raises(HTTPException) as exc:
            await a.step_up(
                payload=SimpleNamespace(password="x"),
                request=_Req(),
                _=None,
                session=session,
                current_user=user,
            )
        assert exc.value.detail == "Invalid password"

    run(session_factory, _scenario)


def test_step_up_success(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pw_ok(monkeypatch, True)
    _no_security_event(monkeypatch)
    monkeypatch.setattr(security, "create_step_up_token", lambda *a, **k: "su-token")

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        return await a.step_up(
            payload=SimpleNamespace(password="x"),
            request=_Req(),
            _=None,
            session=session,
            current_user=user,
        )

    assert run(session_factory, _scenario).step_up_token == "su-token"


def test_change_password_bad_current(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pw_ok(monkeypatch, False)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        with pytest.raises(HTTPException) as exc:
            await a.change_password(
                payload=SimpleNamespace(current_password="x", new_password="y"),
                request=_Req(),
                background_tasks=_BG(),
                session=session,
                current_user=user,
            )
        assert "incorrect" in exc.value.detail

    run(session_factory, _scenario)


def test_change_password_success(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pw_ok(monkeypatch, True)
    _no_security_event(monkeypatch)
    monkeypatch.setattr(security, "hash_password", lambda p: "new-hash")
    monkeypatch.setattr(a.email_service, "send_password_changed", lambda *a, **k: None)

    async def _scenario(session) -> Any:
        user = await _mk_user(session, password_reset_required=True)
        out = await a.change_password(
            payload=SimpleNamespace(current_password="x", new_password="y"),
            request=_Req(),
            background_tasks=_BG(),
            session=session,
            current_user=user,
        )
        assert user.hashed_password == "new-hash"
        assert user.password_reset_required is False
        return out

    assert run(session_factory, _scenario)["detail"] == "Password updated"


def test_request_email_verification(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _create(s, u):
        return SimpleNamespace(token="tok")

    monkeypatch.setattr(a.auth_service, "create_email_verification", _create)
    monkeypatch.setattr(
        a.email_service, "send_verification_email", lambda *a, **k: None
    )

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        return await a.request_email_verification(
            background_tasks=_BG(),
            next="/n",
            _=None,
            current_user=user,
            session=session,
        )

    assert "sent" in run(session_factory, _scenario)["detail"]


def test_confirm_email_verification(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _confirm(s, token):
        return SimpleNamespace(email_verified=True)

    monkeypatch.setattr(a.auth_service, "confirm_email_verification", _confirm)

    async def _scenario(session) -> Any:
        return await a.confirm_email_verification(
            payload=SimpleNamespace(token="t"), session=session
        )

    out = run(session_factory, _scenario)
    assert out["email_verified"] is True


# --------------------------------------------------------------------------- #
# 2FA lifecycle                                                               #
# --------------------------------------------------------------------------- #
def test_two_factor_status_naive_confirmed(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        user = await _mk_user(
            session,
            two_factor_enabled=True,
            two_factor_confirmed_at=datetime(2024, 1, 1),
        )
        return await a.two_factor_status(current_user=user)

    out = run(session_factory, _scenario)
    assert out.enabled is True
    assert out.confirmed_at.tzinfo is not None


def test_two_factor_setup_bad_password(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pw_ok(monkeypatch, False)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        with pytest.raises(HTTPException):
            await a.two_factor_setup(
                payload=SimpleNamespace(password="x"),
                request=_Req(),
                current_user=user,
                session=session,
            )

    run(session_factory, _scenario)


def test_two_factor_setup_success(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pw_ok(monkeypatch, True)
    _no_security_event(monkeypatch)

    async def _start(s, u):
        return ("SECRET", "otpauth://x")

    monkeypatch.setattr(a.auth_service, "start_two_factor_setup", _start)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        return await a.two_factor_setup(
            payload=SimpleNamespace(password="x"),
            request=_Req(),
            current_user=user,
            session=session,
        )

    assert run(session_factory, _scenario).secret == "SECRET"


def test_two_factor_enable(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _no_security_event(monkeypatch)

    async def _enable(s, u, code):
        return ["c1", "c2"]

    monkeypatch.setattr(a.auth_service, "enable_two_factor", _enable)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        return await a.two_factor_enable(
            payload=SimpleNamespace(code="123"),
            request=_Req(),
            current_user=user,
            session=session,
        )

    assert run(session_factory, _scenario).recovery_codes == ["c1", "c2"]


def test_two_factor_disable_bad_password(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pw_ok(monkeypatch, False)

    async def _scenario(session) -> Any:
        user = await _mk_user(session, two_factor_enabled=True)
        with pytest.raises(HTTPException):
            await a.two_factor_disable(
                payload=SimpleNamespace(password="x", code="1"),
                request=_Req(),
                current_user=user,
                session=session,
            )

    run(session_factory, _scenario)


def test_two_factor_disable_not_enabled(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pw_ok(monkeypatch, True)

    async def _scenario(session) -> Any:
        user = await _mk_user(session, two_factor_enabled=False)
        with pytest.raises(HTTPException) as exc:
            await a.two_factor_disable(
                payload=SimpleNamespace(password="x", code="1"),
                request=_Req(),
                current_user=user,
                session=session,
            )
        assert exc.value.detail == "Two-factor is not enabled"

    run(session_factory, _scenario)


def test_two_factor_disable_bad_code(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pw_ok(monkeypatch, True)

    async def _verify(s, u, code):
        return False

    monkeypatch.setattr(a.auth_service, "verify_two_factor_code", _verify)

    async def _scenario(session) -> Any:
        user = await _mk_user(session, two_factor_enabled=True)
        with pytest.raises(HTTPException) as exc:
            await a.two_factor_disable(
                payload=SimpleNamespace(password="x", code="1"),
                request=_Req(),
                current_user=user,
                session=session,
            )
        assert exc.value.detail == "Invalid two-factor code"

    run(session_factory, _scenario)


def test_two_factor_disable_success(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pw_ok(monkeypatch, True)
    _no_security_event(monkeypatch)

    async def _verify(s, u, code):
        return True

    async def _disable(s, u):
        return None

    monkeypatch.setattr(a.auth_service, "verify_two_factor_code", _verify)
    monkeypatch.setattr(a.auth_service, "disable_two_factor", _disable)

    async def _scenario(session) -> Any:
        user = await _mk_user(session, two_factor_enabled=True)
        return await a.two_factor_disable(
            payload=SimpleNamespace(password="x", code="1"),
            request=_Req(),
            current_user=user,
            session=session,
        )

    assert run(session_factory, _scenario).enabled is False


def test_two_factor_regenerate_codes(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pw_ok(monkeypatch, True)
    _no_security_event(monkeypatch)

    async def _verify(s, u, code):
        return True

    async def _regen(s, u):
        return ["n1", "n2"]

    monkeypatch.setattr(a.auth_service, "verify_two_factor_code", _verify)
    monkeypatch.setattr(a.auth_service, "regenerate_recovery_codes", _regen)

    async def _scenario(session) -> Any:
        user = await _mk_user(session, two_factor_enabled=True)
        return await a.two_factor_regenerate_codes(
            payload=SimpleNamespace(password="x", code="1"),
            request=_Req(),
            current_user=user,
            session=session,
        )

    assert run(session_factory, _scenario).recovery_codes == ["n1", "n2"]


def test_two_factor_regenerate_bad_password(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pw_ok(monkeypatch, False)

    async def _scenario(session) -> Any:
        user = await _mk_user(session, two_factor_enabled=True)
        with pytest.raises(HTTPException):
            await a.two_factor_regenerate_codes(
                payload=SimpleNamespace(password="x", code="1"),
                request=_Req(),
                current_user=user,
                session=session,
            )

    run(session_factory, _scenario)


def test_two_factor_regenerate_not_enabled(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pw_ok(monkeypatch, True)

    async def _scenario(session) -> Any:
        user = await _mk_user(session, two_factor_enabled=False)
        with pytest.raises(HTTPException) as exc:
            await a.two_factor_regenerate_codes(
                payload=SimpleNamespace(password="x", code="1"),
                request=_Req(),
                current_user=user,
                session=session,
            )
        assert exc.value.detail == "Two-factor is not enabled"

    run(session_factory, _scenario)


def test_two_factor_regenerate_bad_code(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pw_ok(monkeypatch, True)

    async def _verify(s, u, code):
        return False

    monkeypatch.setattr(a.auth_service, "verify_two_factor_code", _verify)

    async def _scenario(session) -> Any:
        user = await _mk_user(session, two_factor_enabled=True)
        with pytest.raises(HTTPException) as exc:
            await a.two_factor_regenerate_codes(
                payload=SimpleNamespace(password="x", code="1"),
                request=_Req(),
                current_user=user,
                session=session,
            )
        assert exc.value.detail == "Invalid two-factor code"

    run(session_factory, _scenario)


# --------------------------------------------------------------------------- #
# aliases / cooldowns                                                         #
# --------------------------------------------------------------------------- #
def test_read_aliases(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    now = datetime.now(timezone.utc)

    async def _usernames(s, uid):
        return [SimpleNamespace(username="old", created_at=now)]

    async def _displays(s, uid):
        return [SimpleNamespace(name="Old", name_tag=1, created_at=now)]

    monkeypatch.setattr(a.auth_service, "list_username_history", _usernames)
    monkeypatch.setattr(a.auth_service, "list_display_name_history", _displays)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        return await a.read_aliases(current_user=user, session=session)

    out = run(session_factory, _scenario)
    assert out.usernames[0].username == "old"
    assert out.display_names[0].name == "Old"


def test_read_cooldowns_profile_complete(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(a.auth_service, "is_profile_complete", lambda u: True)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        return await a.read_cooldowns(current_user=user, session=session)

    out = run(session_factory, _scenario)
    assert out.username.remaining_seconds == 0


# --------------------------------------------------------------------------- #
# username / email updates                                                    #
# --------------------------------------------------------------------------- #
def test_update_username_bad_password(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pw_ok(monkeypatch, False)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        with pytest.raises(HTTPException):
            await a.update_username(
                payload=SimpleNamespace(password="x", username="new"),
                current_user=user,
                session=session,
            )

    run(session_factory, _scenario)


def test_update_username_success(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pw_ok(monkeypatch, True)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)

        async def _update(s, u, username):
            u.username = username
            return u

        monkeypatch.setattr(a.auth_service, "update_username", _update)
        return await a.update_username(
            payload=SimpleNamespace(password="x", username="newname"),
            current_user=user,
            session=session,
        )

    assert run(session_factory, _scenario).username == "newname"


def test_update_email_bad_password(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pw_ok(monkeypatch, False)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        with pytest.raises(HTTPException):
            await a.update_email(
                payload=SimpleNamespace(password="x", email="new@x.com"),
                request=_Req(),
                background_tasks=_BG(),
                current_user=user,
                session=session,
            )

    run(session_factory, _scenario)


def test_update_email_success(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pw_ok(monkeypatch, True)
    _no_security_event(monkeypatch)
    monkeypatch.setattr(a.email_service, "send_email_changed", lambda *a, **k: None)
    monkeypatch.setattr(
        a.email_service, "send_verification_email", lambda *a, **k: None
    )

    async def _scenario(session) -> Any:
        user = await _mk_user(session)

        async def _update(s, u, email):
            u.email = email
            return u

        async def _create(s, u):
            return SimpleNamespace(token="tok")

        monkeypatch.setattr(a.auth_service, "update_email", _update)
        monkeypatch.setattr(a.auth_service, "create_email_verification", _create)
        bg = _BG()
        out = await a.update_email(
            payload=SimpleNamespace(password="x", email="new@x.com"),
            request=_Req(),
            background_tasks=bg,
            current_user=user,
            session=session,
        )
        assert len(bg.tasks) == 3
        return out

    assert run(session_factory, _scenario).email == "new@x.com"


def test_list_my_emails(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _secondary(s, uid):
        return []

    monkeypatch.setattr(a.auth_service, "list_secondary_emails", _secondary)

    async def _scenario(session) -> Any:
        user = await _mk_user(session, email_verified=True)
        return await a.list_my_emails(current_user=user, session=session)

    out = run(session_factory, _scenario)
    assert out.primary_verified is True


# --------------------------------------------------------------------------- #
# account deletion / language / notifications / training                      #
# --------------------------------------------------------------------------- #
def test_request_account_deletion_wrong_confirm(
    session_factory: async_sessionmaker,
) -> None:
    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        with pytest.raises(HTTPException) as exc:
            await a.request_account_deletion(
                payload=SimpleNamespace(confirm="nope", password="x"),
                current_user=user,
                session=session,
            )
        assert "DELETE" in exc.value.detail

    run(session_factory, _scenario)


def test_request_account_deletion_bad_password(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pw_ok(monkeypatch, False)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        with pytest.raises(HTTPException) as exc:
            await a.request_account_deletion(
                payload=SimpleNamespace(confirm="DELETE", password="x"),
                current_user=user,
                session=session,
            )
        assert exc.value.detail == "Invalid password"

    run(session_factory, _scenario)


def test_request_account_deletion_already_scheduled(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pw_ok(monkeypatch, True)

    async def _scenario(session) -> Any:
        user = await _mk_user(
            session,
            deletion_scheduled_for=datetime.now(timezone.utc) + timedelta(hours=5),
        )
        with pytest.raises(HTTPException) as exc:
            await a.request_account_deletion(
                payload=SimpleNamespace(confirm="DELETE", password="x"),
                current_user=user,
                session=session,
            )
        assert "already scheduled" in exc.value.detail

    run(session_factory, _scenario)


def test_request_account_deletion_success(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pw_ok(monkeypatch, True)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        out = await a.request_account_deletion(
            payload=SimpleNamespace(confirm="delete", password="x"),
            current_user=user,
            session=session,
        )
        return out

    out = run(session_factory, _scenario)
    assert out.scheduled_for is not None


def test_cancel_account_deletion(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        user = await _mk_user(
            session, deletion_scheduled_for=datetime.now(timezone.utc)
        )
        return await a.cancel_account_deletion(current_user=user, session=session)

    out = run(session_factory, _scenario)
    assert out.scheduled_for is None


def test_account_delete_status(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        return await a.account_delete_status(current_user=user)

    out = run(session_factory, _scenario)
    assert out.deleted_at is None


def test_update_language(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        return await a.update_language(
            payload=SimpleNamespace(preferred_language="ro"),
            current_user=user,
            session=session,
        )

    assert run(session_factory, _scenario).preferred_language == "ro"


def test_update_notification_preferences(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        return await a.update_notification_preferences(
            payload=SimpleNamespace(
                notify_blog_comments=True,
                notify_blog_comment_replies=False,
                notify_marketing=True,
            ),
            current_user=user,
            session=session,
        )

    out = run(session_factory, _scenario)
    assert out.notify_blog_comments is True


def test_update_notification_preferences_all_none(
    session_factory: async_sessionmaker,
) -> None:
    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        return await a.update_notification_preferences(
            payload=SimpleNamespace(
                notify_blog_comments=None,
                notify_blog_comment_replies=None,
                notify_marketing=None,
            ),
            current_user=user,
            session=session,
        )

    run(session_factory, _scenario)  # no raise, no change


def test_update_training_mode_forbidden(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        user = await _mk_user(session, role=UserRole.customer)
        with pytest.raises(HTTPException) as exc:
            await a.update_training_mode(
                payload=SimpleNamespace(enabled=True),
                current_user=user,
                session=session,
            )
        assert exc.value.status_code == status.HTTP_403_FORBIDDEN

    run(session_factory, _scenario)


def test_update_training_mode_staff(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        user = await _mk_user(session, role=UserRole.support)
        return await a.update_training_mode(
            payload=SimpleNamespace(enabled=True),
            current_user=user,
            session=session,
        )

    assert run(session_factory, _scenario) is not None


# --------------------------------------------------------------------------- #
# sessions / security events                                                  #
# --------------------------------------------------------------------------- #
def test_list_my_sessions(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(a, "_extract_refresh_session_jti", lambda req: None)

    async def _resolve(s, uid, jti):
        return None

    monkeypatch.setattr(a, "_resolve_active_refresh_session_jti", _resolve)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        session.add(
            RefreshSession(
                id=uuid4(),
                user_id=user.id,
                jti="active",
                expires_at=datetime.now(timezone.utc) + timedelta(days=1),
                persistent=True,
                revoked=False,
            )
        )
        session.add(
            RefreshSession(
                id=uuid4(),
                user_id=user.id,
                jti="expired",
                expires_at=datetime.now(timezone.utc) - timedelta(days=1),
                persistent=True,
                revoked=False,
            )
        )
        await session.commit()
        return await a.list_my_sessions(
            request=_Req(), current_user=user, session=session
        )

    out = run(session_factory, _scenario)
    assert len(out) == 1  # expired filtered out


def test_revoke_other_sessions_bad_password(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pw_ok(monkeypatch, False)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        with pytest.raises(HTTPException):
            await a.revoke_other_sessions(
                payload=SimpleNamespace(password="x"),
                request=_Req(),
                current_user=user,
                session=session,
            )

    run(session_factory, _scenario)


def test_revoke_other_sessions_no_current_jti(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pw_ok(monkeypatch, True)
    monkeypatch.setattr(a, "_extract_refresh_session_jti", lambda req: None)

    async def _resolve(s, uid, jti):
        return None

    monkeypatch.setattr(a, "_resolve_active_refresh_session_jti", _resolve)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        with pytest.raises(HTTPException) as exc:
            await a.revoke_other_sessions(
                payload=SimpleNamespace(password="x"),
                request=_Req(),
                current_user=user,
                session=session,
            )
        assert "current session" in exc.value.detail

    run(session_factory, _scenario)


def test_revoke_other_sessions_success(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pw_ok(monkeypatch, True)
    monkeypatch.setattr(a, "_extract_refresh_session_jti", lambda req: "current")

    async def _resolve(s, uid, jti):
        return "current"

    monkeypatch.setattr(a, "_resolve_active_refresh_session_jti", _resolve)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        for jti, exp in [
            ("current", timedelta(days=1)),
            ("other", timedelta(days=1)),
            ("expired", timedelta(days=-1)),
        ]:
            session.add(
                RefreshSession(
                    id=uuid4(),
                    user_id=user.id,
                    jti=jti,
                    expires_at=datetime.now(timezone.utc) + exp,
                    persistent=True,
                    revoked=False,
                )
            )
        await session.commit()
        return await a.revoke_other_sessions(
            payload=SimpleNamespace(password="x"),
            request=_Req(),
            current_user=user,
            session=session,
        )

    out = run(session_factory, _scenario)
    assert out.revoked == 1  # only "other" revoked


def test_list_security_events(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        session.add(
            UserSecurityEvent(
                id=uuid4(),
                user_id=user.id,
                event_type="login_password",
                created_at=datetime(2024, 1, 1),
            )
        )
        await session.commit()
        return await a.list_security_events(
            current_user=user, session=session, limit=30
        )

    out = run(session_factory, _scenario)
    assert out[0].event_type == "login_password"
    assert out[0].created_at.tzinfo is not None


# --------------------------------------------------------------------------- #
# profile update / avatar                                                     #
# --------------------------------------------------------------------------- #
def _profile_payload(**kw: Any) -> SimpleNamespace:
    data = dict(kw)

    class P(SimpleNamespace):
        def model_dump(self, exclude_unset=False):
            return data

    return P(**data)


def test_update_me_phone_required(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        with pytest.raises(HTTPException) as exc:
            await a.update_me(
                payload=_profile_payload(phone=None),
                current_user=user,
                session=session,
            )
        assert exc.value.detail == "Phone is required"

    run(session_factory, _scenario)


@pytest.mark.parametrize(
    "field,detail",
    [
        ("first_name", "First name is required"),
        ("last_name", "Last name is required"),
        ("date_of_birth", "Date of birth is required"),
    ],
)
def test_update_me_required_fields(
    session_factory: async_sessionmaker, field: str, detail: str
) -> None:
    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        with pytest.raises(HTTPException) as exc:
            await a.update_me(
                payload=_profile_payload(**{field: None}),
                current_user=user,
                session=session,
            )
        assert exc.value.detail == detail

    run(session_factory, _scenario)


def test_update_me_success(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _update_display(s, u, name):
        u.name = name
        return u

    monkeypatch.setattr(a.auth_service, "update_display_name", _update_display)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        return await a.update_me(
            payload=_profile_payload(
                name="New",
                phone="+40712345678",
                first_name="F",
                middle_name="M",
                last_name="L",
                date_of_birth=date(1990, 1, 1),
                preferred_language="ro",
            ),
            current_user=user,
            session=session,
        )

    out = run(session_factory, _scenario)
    assert out.phone == "+40712345678"
    assert out.preferred_language == "ro"


def test_use_google_avatar_none(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        user = await _mk_user(session, google_picture_url=None)
        with pytest.raises(HTTPException) as exc:
            await a.use_google_avatar(current_user=user, session=session)
        assert "No Google" in exc.value.detail

    run(session_factory, _scenario)


def test_use_google_avatar_success(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        user = await _mk_user(session, google_picture_url="http://g/pic.png")
        return await a.use_google_avatar(current_user=user, session=session)

    assert run(session_factory, _scenario).avatar_url == "http://g/pic.png"


def test_remove_avatar(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        user = await _mk_user(session, avatar_url="http://x/a.png")
        return await a.remove_avatar(current_user=user, session=session)

    assert run(session_factory, _scenario).avatar_url is None


# --------------------------------------------------------------------------- #
# password reset                                                              #
# --------------------------------------------------------------------------- #
def test_request_password_reset_with_token(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(a.email_service, "send_password_reset", lambda *a, **k: None)

    async def _scenario(session) -> Any:
        user = await _mk_user(session, email="reset@x.com")

        async def _create(s, email):
            return SimpleNamespace(token="rtok", user_id=user.id)

        monkeypatch.setattr(a.auth_service, "create_reset_token", _create)
        bg = _BG()
        out = await a.request_password_reset(
            payload=SimpleNamespace(email="Reset@X.com"),
            background_tasks=bg,
            session=session,
            _=None,
        )
        assert len(bg.tasks) == 1
        return out

    assert run(session_factory, _scenario)["status"] == "sent"


def test_request_password_reset_no_user(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _create(s, email):
        return None

    monkeypatch.setattr(a.auth_service, "create_reset_token", _create)

    async def _scenario(session) -> Any:
        bg = _BG()
        out = await a.request_password_reset(
            payload=SimpleNamespace(email="ghost@x.com"),
            background_tasks=bg,
            session=session,
            _=None,
        )
        assert len(bg.tasks) == 0
        return out

    assert run(session_factory, _scenario)["status"] == "sent"


def test_confirm_password_reset(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _no_security_event(monkeypatch)
    monkeypatch.setattr(a.email_service, "send_password_changed", lambda *a, **k: None)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)

        async def _confirm(s, token, new_password):
            return user

        monkeypatch.setattr(a.auth_service, "confirm_reset_token", _confirm)
        return await a.confirm_password_reset(
            payload=SimpleNamespace(token="t", new_password="n"),
            request=_Req(),
            background_tasks=_BG(),
            session=session,
            _=None,
        )

    assert run(session_factory, _scenario)["status"] == "updated"


# --------------------------------------------------------------------------- #
# google start / link / unlink                                               #
# --------------------------------------------------------------------------- #
def test_google_start_not_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "google_client_id", None)
    with pytest.raises(HTTPException):
        asyncio.run(a.google_start(_=None))


def test_google_start_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "google_client_id", "cid")
    monkeypatch.setattr(settings, "google_redirect_uri", "https://r/cb")
    out = asyncio.run(a.google_start(_=None))
    assert out["auth_url"].startswith("https://accounts.google.com")


def test_google_link_start_not_configured(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "google_client_id", None)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        with pytest.raises(HTTPException):
            await a.google_link_start(current_user=user, _=None)

    run(session_factory, _scenario)


def test_google_link_start_ok(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "google_client_id", "cid")
    monkeypatch.setattr(settings, "google_redirect_uri", "https://r/cb")

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        return await a.google_link_start(current_user=user, _=None)

    assert "auth_url" in run(session_factory, _scenario)


def test_google_link_bad_password(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(a, "_validate_google_state", lambda *a, **k: None)
    _pw_ok(monkeypatch, False)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        with pytest.raises(HTTPException):
            await a.google_link(
                payload=SimpleNamespace(code="c", state="s", password="x"),
                current_user=user,
                session=session,
                _=None,
            )

    run(session_factory, _scenario)


def test_google_link_invalid_profile(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(a, "_validate_google_state", lambda *a, **k: None)
    _pw_ok(monkeypatch, True)

    async def _exchange(code):
        return {"sub": "", "email": ""}

    monkeypatch.setattr(a.auth_service, "exchange_google_code", _exchange)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        with pytest.raises(HTTPException) as exc:
            await a.google_link(
                payload=SimpleNamespace(code="c", state="s", password="x"),
                current_user=user,
                session=session,
                _=None,
            )
        assert exc.value.detail == "Invalid Google profile"

    run(session_factory, _scenario)


def test_google_link_domain_not_allowed(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(a, "_validate_google_state", lambda *a, **k: None)
    _pw_ok(monkeypatch, True)
    monkeypatch.setattr(settings, "google_allowed_domains", ["allowed.com"])

    async def _exchange(code):
        return {"sub": "g1", "email": "user@other.com"}

    monkeypatch.setattr(a.auth_service, "exchange_google_code", _exchange)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        with pytest.raises(HTTPException) as exc:
            await a.google_link(
                payload=SimpleNamespace(code="c", state="s", password="x"),
                current_user=user,
                session=session,
                _=None,
            )
        assert exc.value.status_code == status.HTTP_403_FORBIDDEN

    run(session_factory, _scenario)


def test_google_link_already_linked_elsewhere(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(a, "_validate_google_state", lambda *a, **k: None)
    _pw_ok(monkeypatch, True)
    monkeypatch.setattr(settings, "google_allowed_domains", [])

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        other = await _mk_user(session)

        async def _exchange(code):
            return {"sub": "g1", "email": "user@x.com"}

        async def _by_sub(s, sub):
            return other

        monkeypatch.setattr(a.auth_service, "exchange_google_code", _exchange)
        monkeypatch.setattr(a.auth_service, "get_user_by_google_sub", _by_sub)
        with pytest.raises(HTTPException) as exc:
            await a.google_link(
                payload=SimpleNamespace(code="c", state="s", password="x"),
                current_user=user,
                session=session,
                _=None,
            )
        assert exc.value.status_code == status.HTTP_409_CONFLICT

    run(session_factory, _scenario)


def test_google_link_success(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(a, "_validate_google_state", lambda *a, **k: None)
    _pw_ok(monkeypatch, True)
    monkeypatch.setattr(settings, "google_allowed_domains", [])

    async def _scenario(session) -> Any:
        user = await _mk_user(session, name=None, email_verified=False)

        async def _exchange(code):
            return {
                "sub": "g1",
                "email": "user@x.com",
                "name": "Goog",
                "picture": "http://g/p.png",
                "email_verified": True,
            }

        async def _by_sub(s, sub):
            return None

        monkeypatch.setattr(a.auth_service, "exchange_google_code", _exchange)
        monkeypatch.setattr(a.auth_service, "get_user_by_google_sub", _by_sub)
        return await a.google_link(
            payload=SimpleNamespace(code="c", state="s", password="x"),
            current_user=user,
            session=session,
            _=None,
        )

    out = run(session_factory, _scenario)
    assert out.google_sub == "g1"


def test_google_unlink_bad_password(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pw_ok(monkeypatch, False)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        with pytest.raises(HTTPException):
            await a.google_unlink(
                payload=SimpleNamespace(password="x"),
                current_user=user,
                session=session,
                _=None,
            )

    run(session_factory, _scenario)


def test_google_unlink_success_clears_google_avatar(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pw_ok(monkeypatch, True)

    async def _scenario(session) -> Any:
        user = await _mk_user(
            session,
            google_sub="g1",
            google_picture_url="http://g/p.png",
            avatar_url="http://g/p.png",
        )
        return await a.google_unlink(
            payload=SimpleNamespace(password="x"),
            current_user=user,
            session=session,
            _=None,
        )

    out = run(session_factory, _scenario)
    assert out.google_sub is None
    assert out.avatar_url is None
