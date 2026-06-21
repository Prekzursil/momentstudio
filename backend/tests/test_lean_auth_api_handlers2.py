"""Direct-call coverage for the final ``app.api.v1.auth`` handler clusters.

Coverage worker [w2], batch 3. Completes the residual auth router coverage:
register, the full passkey lifecycle (login options/verify, list, register
options/verify, delete), admin IP-bypass, logout, secondary-email management,
data-export jobs, and the Google OAuth callback/complete flows. Each handler is
called directly with an in-memory SQLite session; WebAuthn/passkey, Google,
captcha, email, export, and self-service delegations are monkeypatched on the
*auth* namespace so the router branch logic is what is measured.
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
from app.models.user import User, UserRole
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
        cookies: dict[str, str] | None = None,
        client_host: str | None = "1.2.3.4",
    ) -> None:
        self.headers = headers or {}
        self.cookies = cookies or {}
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


def _published_consent(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _consent(session, keys):
        return {k: 1 for k in keys}

    monkeypatch.setattr(a, "_require_published_consent_docs", _consent)


# --------------------------------------------------------------------------- #
# register                                                                    #
# --------------------------------------------------------------------------- #
def _register_payload(**kw: Any) -> SimpleNamespace:
    base = dict(
        captcha_token="c",
        accept_terms=True,
        accept_privacy=True,
        username="newuser",
        email="new@x.com",
        password="password123",
        name="New User",
        first_name="New",
        middle_name=None,
        last_name="User",
        date_of_birth=date(1990, 1, 1),
        phone="+40712345678",
        preferred_language="en",
    )
    base.update(kw)
    return SimpleNamespace(**base)


def test_register_consents_required(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _verify(token, remote_ip=None):
        return None

    monkeypatch.setattr(a.captcha_service, "verify", _verify)

    async def _scenario(session) -> Any:
        with pytest.raises(HTTPException) as exc:
            await a.register(
                payload=_register_payload(accept_terms=False),
                request=_Req(),
                background_tasks=_BG(),
                session=session,
                _=None,
                response=Response(),
            )
        assert exc.value.detail == "Legal consents required"

    run(session_factory, _scenario)


def test_register_success(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _verify(token, remote_ip=None):
        return None

    monkeypatch.setattr(a.captcha_service, "verify", _verify)
    monkeypatch.setattr(a.metrics, "record_signup", lambda: None)
    _published_consent(monkeypatch)
    _no_security_event(monkeypatch)
    monkeypatch.setattr(
        a.email_service, "send_verification_email", lambda *a, **k: None
    )
    monkeypatch.setattr(a.email_service, "send_welcome_email", lambda *a, **k: None)

    async def _scenario(session) -> Any:
        created = await _mk_user(session, email="new@x.com")

        async def _create_user(s, data):
            return created

        async def _create_verif(s, u):
            return SimpleNamespace(token="vtok")

        async def _issue(s, u, **k):
            return {"access_token": "at", "refresh_token": "rt"}

        monkeypatch.setattr(a.auth_service, "create_user", _create_user)
        monkeypatch.setattr(a.auth_service, "create_email_verification", _create_verif)
        monkeypatch.setattr(a.auth_service, "issue_tokens_for_user", _issue)
        bg = _BG()
        out = await a.register(
            payload=_register_payload(),
            request=_Req(),
            background_tasks=bg,
            session=session,
            _=None,
            response=Response(),
        )
        assert len(bg.tasks) == 2  # verification + welcome
        return out

    assert run(session_factory, _scenario).tokens.access_token == "at"


# --------------------------------------------------------------------------- #
# logout / admin ip-bypass                                                    #
# --------------------------------------------------------------------------- #
def test_logout_revokes_when_jti(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(a, "decode_token", lambda t: {"jti": "j1"})
    revoked = {"called": False}

    async def _revoke(s, jti, reason):
        revoked["called"] = True

    monkeypatch.setattr(a.auth_service, "revoke_refresh_token", _revoke)

    async def _scenario(session) -> Any:
        await a.logout(
            payload=SimpleNamespace(refresh_token="rt"),
            request=_Req(),
            session=session,
            response=Response(),
        )
        assert revoked["called"] is True

    run(session_factory, _scenario)


def test_logout_no_token(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        out = await a.logout(
            payload=SimpleNamespace(refresh_token=""),
            request=_Req(),
            session=session,
            response=Response(),
        )
        assert out is None

    run(session_factory, _scenario)


def test_admin_ip_bypass_not_configured(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "admin_ip_bypass_token", "")

    async def _scenario(session) -> Any:
        user = await _mk_user(session, role=UserRole.admin)
        with pytest.raises(HTTPException) as exc:
            await a.admin_ip_bypass(
                payload=SimpleNamespace(token="x"),
                request=_Req(),
                session=session,
                current_user=user,
                response=Response(),
            )
        assert "not configured" in exc.value.detail

    run(session_factory, _scenario)


def test_admin_ip_bypass_invalid_token(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "admin_ip_bypass_token", "secret")

    async def _scenario(session) -> Any:
        user = await _mk_user(session, role=UserRole.admin)
        with pytest.raises(HTTPException) as exc:
            await a.admin_ip_bypass(
                payload=SimpleNamespace(token="wrong"),
                request=_Req(),
                session=session,
                current_user=user,
                response=Response(),
            )
        assert exc.value.status_code == status.HTTP_403_FORBIDDEN

    run(session_factory, _scenario)


def test_admin_ip_bypass_success(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "admin_ip_bypass_token", "secret")
    monkeypatch.setattr(
        security, "create_admin_ip_bypass_token", lambda uid: "bypass-token"
    )
    _no_security_event(monkeypatch)

    async def _scenario(session) -> Any:
        user = await _mk_user(session, role=UserRole.admin)
        out = await a.admin_ip_bypass(
            payload=SimpleNamespace(token="secret"),
            request=_Req(),
            session=session,
            current_user=user,
            response=Response(),
        )
        assert out is None

    run(session_factory, _scenario)


def test_clear_admin_ip_bypass() -> None:
    assert asyncio.run(a.clear_admin_ip_bypass(response=Response())) is None


def test_admin_access() -> None:
    out = asyncio.run(a.admin_access(_=None))
    assert out["allowed"] is True


# --------------------------------------------------------------------------- #
# passkey login options / verify                                             #
# --------------------------------------------------------------------------- #
def test_passkey_login_options_email(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _scenario(session) -> Any:
        user = await _mk_user(session, email="pk@x.com")

        async def _by_email(s, ident):
            return user

        async def _gen(s, u):
            return ({"challenge": "abc"}, b"abc")

        monkeypatch.setattr(a.auth_service, "get_user_by_login_email", _by_email)
        monkeypatch.setattr(
            a.passkeys_service,
            "generate_authentication_options_for_user",
            _gen,
        )
        monkeypatch.setattr(security, "create_webauthn_token", lambda **k: "wa-token")
        return await a.passkey_login_options(
            payload=SimpleNamespace(identifier="pk@x.com", remember=True),
            session=session,
            _=None,
        )

    out = run(session_factory, _scenario)
    assert out.authentication_token == "wa-token"


def test_passkey_login_options_username_no_challenge(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _scenario(session) -> Any:
        async def _by_username(s, ident):
            return None

        async def _gen(s, u):
            return ({"challenge": ""}, b"")

        monkeypatch.setattr(a.auth_service, "get_user_by_username", _by_username)
        monkeypatch.setattr(
            a.passkeys_service,
            "generate_authentication_options_for_user",
            _gen,
        )
        with pytest.raises(HTTPException) as exc:
            await a.passkey_login_options(
                payload=SimpleNamespace(identifier="someuser", remember=False),
                session=session,
                _=None,
            )
        assert exc.value.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR

    run(session_factory, _scenario)


def test_passkey_login_verify_bad_token(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(security, "decode_token", lambda t: None)

    async def _scenario(session) -> Any:
        with pytest.raises(HTTPException) as exc:
            await a.passkey_login_verify(
                payload=SimpleNamespace(authentication_token="t", credential={}),
                request=_Req(),
                background_tasks=_BG(),
                session=session,
                _=None,
                response=Response(),
            )
        assert exc.value.detail == "Invalid passkey token"

    run(session_factory, _scenario)


def test_passkey_login_verify_blank_challenge(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        security,
        "decode_token",
        lambda t: {"type": "webauthn", "purpose": "login", "challenge": "  "},
    )

    async def _scenario(session) -> Any:
        with pytest.raises(HTTPException):
            await a.passkey_login_verify(
                payload=SimpleNamespace(authentication_token="t", credential={}),
                request=_Req(),
                background_tasks=_BG(),
                session=session,
                _=None,
                response=Response(),
            )

    run(session_factory, _scenario)


def test_passkey_login_verify_bad_challenge_b64(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        security,
        "decode_token",
        lambda t: {"type": "webauthn", "purpose": "login", "challenge": "abc"},
    )

    def _bad(c):
        raise ValueError("bad b64")

    monkeypatch.setattr(a, "base64url_to_bytes", _bad)

    async def _scenario(session) -> Any:
        with pytest.raises(HTTPException):
            await a.passkey_login_verify(
                payload=SimpleNamespace(authentication_token="t", credential={}),
                request=_Req(),
                background_tasks=_BG(),
                session=session,
                _=None,
                response=Response(),
            )

    run(session_factory, _scenario)


def test_passkey_login_verify_incomplete_google(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        security,
        "decode_token",
        lambda t: {"type": "webauthn", "purpose": "login", "challenge": "abc"},
    )
    monkeypatch.setattr(a, "base64url_to_bytes", lambda c: b"abc")
    monkeypatch.setattr(a.auth_service, "is_profile_complete", lambda u: False)

    async def _scenario(session) -> Any:
        user = await _mk_user(session, google_sub="g1")

        async def _verify(s, *, credential, expected_challenge, user_id):
            return user, SimpleNamespace()

        monkeypatch.setattr(
            a.passkeys_service, "verify_passkey_authentication", _verify
        )
        with pytest.raises(HTTPException) as exc:
            await a.passkey_login_verify(
                payload=SimpleNamespace(authentication_token="t", credential={}),
                request=_Req(),
                background_tasks=_BG(),
                session=session,
                _=None,
                response=Response(),
            )
        assert exc.value.status_code == status.HTTP_403_FORBIDDEN

    run(session_factory, _scenario)


def test_passkey_login_verify_admin_alert_success(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        security,
        "decode_token",
        lambda t: {
            "type": "webauthn",
            "purpose": "login",
            "challenge": "abc",
            "remember": True,
            "uid": "u",
        },
    )
    monkeypatch.setattr(a, "base64url_to_bytes", lambda c: b"abc")
    monkeypatch.setattr(a.auth_service, "is_profile_complete", lambda u: True)
    monkeypatch.setattr(a.metrics, "record_login_success", lambda: None)
    _no_security_event(monkeypatch)

    async def _scenario(session) -> Any:
        user = await _mk_user(session, role=UserRole.owner, name="Owner")

        async def _verify(s, *, credential, expected_challenge, user_id):
            return user, SimpleNamespace()

        async def _seen(s, *, user_id, user_agent):
            return False

        async def _owner(s):
            return None  # owner None -> uses admin_alert_email

        async def _issue(s, u, **k):
            return {"access_token": "at", "refresh_token": "rt"}

        monkeypatch.setattr(
            a.passkeys_service, "verify_passkey_authentication", _verify
        )
        monkeypatch.setattr(a.auth_service, "has_seen_refresh_device", _seen)
        monkeypatch.setattr(a.auth_service, "get_owner_user", _owner)
        monkeypatch.setattr(a.auth_service, "issue_tokens_for_user", _issue)
        monkeypatch.setattr(settings, "admin_alert_email", "alert@x.com")
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
# passkey list / register / delete                                          #
# --------------------------------------------------------------------------- #
def test_list_my_passkeys(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _list(s, uid):
        return []

    monkeypatch.setattr(a.passkeys_service, "list_passkeys", _list)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        return await a.list_my_passkeys(current_user=user, session=session)

    assert run(session_factory, _scenario) == []


def test_passkey_register_options_bad_password(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pw_ok(monkeypatch, False)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        with pytest.raises(HTTPException):
            await a.passkey_register_options(
                payload=SimpleNamespace(password="x"),
                current_user=user,
                session=session,
            )

    run(session_factory, _scenario)


def test_passkey_register_options_no_challenge(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pw_ok(monkeypatch, True)

    async def _gen(s, u):
        return ({"challenge": ""}, None)

    monkeypatch.setattr(
        a.passkeys_service, "generate_registration_options_for_user", _gen
    )

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        with pytest.raises(HTTPException) as exc:
            await a.passkey_register_options(
                payload=SimpleNamespace(password="x"),
                current_user=user,
                session=session,
            )
        assert exc.value.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR

    run(session_factory, _scenario)


def test_passkey_register_options_success(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pw_ok(monkeypatch, True)

    async def _gen(s, u):
        return ({"challenge": "ch"}, None)

    monkeypatch.setattr(
        a.passkeys_service, "generate_registration_options_for_user", _gen
    )
    monkeypatch.setattr(security, "create_webauthn_token", lambda **k: "reg-token")

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        return await a.passkey_register_options(
            payload=SimpleNamespace(password="x"),
            current_user=user,
            session=session,
        )

    assert run(session_factory, _scenario).registration_token == "reg-token"


def test_passkey_register_verify_bad_token(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(security, "decode_token", lambda t: None)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        with pytest.raises(HTTPException):
            await a.passkey_register_verify(
                payload=SimpleNamespace(
                    registration_token="t", credential={}, name="k"
                ),
                request=_Req(),
                current_user=user,
                session=session,
            )

    run(session_factory, _scenario)


def test_passkey_register_verify_uid_mismatch(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        security,
        "decode_token",
        lambda t: {"type": "webauthn", "purpose": "register", "uid": "other"},
    )

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        with pytest.raises(HTTPException):
            await a.passkey_register_verify(
                payload=SimpleNamespace(
                    registration_token="t", credential={}, name="k"
                ),
                request=_Req(),
                current_user=user,
                session=session,
            )

    run(session_factory, _scenario)


def test_passkey_register_verify_blank_challenge(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        monkeypatch.setattr(
            security,
            "decode_token",
            lambda t: {
                "type": "webauthn",
                "purpose": "register",
                "uid": str(user.id),
                "challenge": "",
            },
        )
        with pytest.raises(HTTPException):
            await a.passkey_register_verify(
                payload=SimpleNamespace(
                    registration_token="t", credential={}, name="k"
                ),
                request=_Req(),
                current_user=user,
                session=session,
            )

    run(session_factory, _scenario)


def test_passkey_register_verify_bad_challenge_b64(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    def _bad(c):
        raise ValueError("bad")

    monkeypatch.setattr(a, "base64url_to_bytes", _bad)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        monkeypatch.setattr(
            security,
            "decode_token",
            lambda t: {
                "type": "webauthn",
                "purpose": "register",
                "uid": str(user.id),
                "challenge": "ch",
            },
        )
        with pytest.raises(HTTPException):
            await a.passkey_register_verify(
                payload=SimpleNamespace(
                    registration_token="t", credential={}, name="k"
                ),
                request=_Req(),
                current_user=user,
                session=session,
            )

    run(session_factory, _scenario)


def test_passkey_register_verify_success(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(a, "base64url_to_bytes", lambda c: b"ch")
    _no_security_event(monkeypatch)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        monkeypatch.setattr(
            security,
            "decode_token",
            lambda t: {
                "type": "webauthn",
                "purpose": "register",
                "uid": str(user.id),
                "challenge": "ch",
            },
        )

        async def _register(s, *, user, credential, expected_challenge, name):
            return SimpleNamespace(
                id=uuid4(),
                name=name,
                created_at=datetime.now(timezone.utc),
                last_used_at=None,
            )

        monkeypatch.setattr(a.passkeys_service, "register_passkey", _register)

        # PasskeyResponse.model_validate needs from_attributes; patch to a simple obj
        monkeypatch.setattr(
            a.PasskeyResponse,
            "model_validate",
            classmethod(lambda cls, obj: obj),
        )
        return await a.passkey_register_verify(
            payload=SimpleNamespace(
                registration_token="t", credential={}, name="MyKey"
            ),
            request=_Req(),
            current_user=user,
            session=session,
        )

    out = run(session_factory, _scenario)
    assert out.name == "MyKey"


def test_passkey_delete_bad_password(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pw_ok(monkeypatch, False)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        with pytest.raises(HTTPException):
            await a.passkey_delete(
                passkey_id=uuid4(),
                payload=SimpleNamespace(password="x"),
                request=_Req(),
                current_user=user,
                session=session,
            )

    run(session_factory, _scenario)


def test_passkey_delete_not_found(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pw_ok(monkeypatch, True)

    async def _delete(s, *, user_id, passkey_id):
        return False

    monkeypatch.setattr(a.passkeys_service, "delete_passkey", _delete)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        with pytest.raises(HTTPException) as exc:
            await a.passkey_delete(
                passkey_id=uuid4(),
                payload=SimpleNamespace(password="x"),
                request=_Req(),
                current_user=user,
                session=session,
            )
        assert exc.value.status_code == status.HTTP_404_NOT_FOUND

    run(session_factory, _scenario)


def test_passkey_delete_success(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pw_ok(monkeypatch, True)
    _no_security_event(monkeypatch)

    async def _delete(s, *, user_id, passkey_id):
        return True

    monkeypatch.setattr(a.passkeys_service, "delete_passkey", _delete)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        out = await a.passkey_delete(
            passkey_id=uuid4(),
            payload=SimpleNamespace(password="x"),
            request=_Req(),
            current_user=user,
            session=session,
        )
        assert out is None

    run(session_factory, _scenario)


# --------------------------------------------------------------------------- #
# secondary emails                                                            #
# --------------------------------------------------------------------------- #
def test_add_secondary_email(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        a.email_service, "send_verification_email", lambda *a, **k: None
    )
    monkeypatch.setattr(
        a.SecondaryEmailResponse, "model_validate", classmethod(lambda cls, obj: obj)
    )

    async def _scenario(session) -> Any:
        user = await _mk_user(session)

        async def _add(s, u, email):
            return SimpleNamespace(email=email), SimpleNamespace(token="tk")

        monkeypatch.setattr(a.auth_service, "add_secondary_email", _add)
        bg = _BG()
        out = await a.add_my_secondary_email(
            payload=SimpleNamespace(email="sec@x.com"),
            background_tasks=bg,
            current_user=user,
            session=session,
        )
        assert len(bg.tasks) == 1
        return out

    assert run(session_factory, _scenario).email == "sec@x.com"


def test_confirm_secondary_email(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        a.SecondaryEmailResponse, "model_validate", classmethod(lambda cls, obj: obj)
    )

    async def _confirm(s, token):
        return SimpleNamespace(email="sec@x.com")

    monkeypatch.setattr(
        a.auth_service, "confirm_secondary_email_verification", _confirm
    )

    async def _scenario(session) -> Any:
        return await a.confirm_secondary_email_verification(
            payload=SimpleNamespace(token="t"), session=session
        )

    assert run(session_factory, _scenario).email == "sec@x.com"


def test_make_secondary_email_primary_bad_password(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pw_ok(monkeypatch, False)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        with pytest.raises(HTTPException):
            await a.make_secondary_email_primary(
                secondary_email_id=uuid4(),
                payload=SimpleNamespace(password="x"),
                request=_Req(),
                current_user=user,
                session=session,
            )

    run(session_factory, _scenario)


def test_make_secondary_email_primary_success(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pw_ok(monkeypatch, True)
    _no_security_event(monkeypatch)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)

        async def _make(s, u, sid):
            return u

        monkeypatch.setattr(a.auth_service, "make_secondary_email_primary", _make)
        return await a.make_secondary_email_primary(
            secondary_email_id=uuid4(),
            payload=SimpleNamespace(password="x"),
            request=_Req(),
            current_user=user,
            session=session,
        )

    assert run(session_factory, _scenario) is not None


def test_delete_secondary_email_bad_password(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pw_ok(monkeypatch, False)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        with pytest.raises(HTTPException):
            await a.delete_secondary_email(
                secondary_email_id=uuid4(),
                payload=SimpleNamespace(password="x"),
                current_user=user,
                session=session,
            )

    run(session_factory, _scenario)


def test_delete_secondary_email_success(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pw_ok(monkeypatch, True)

    async def _del(s, u, sid):
        return None

    monkeypatch.setattr(a.auth_service, "delete_secondary_email", _del)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        out = await a.delete_secondary_email(
            secondary_email_id=uuid4(),
            payload=SimpleNamespace(password="x"),
            current_user=user,
            session=session,
        )
        assert out is None

    run(session_factory, _scenario)


def test_request_secondary_email_verification(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        a.email_service, "send_verification_email", lambda *a, **k: None
    )

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        from app.models.user import UserSecondaryEmail

        sid = uuid4()
        session.add(UserSecondaryEmail(id=sid, user_id=user.id, email="sec@x.com"))
        await session.commit()

        async def _req(s, u, secondary_email_id):
            return SimpleNamespace(token="tk")

        monkeypatch.setattr(
            a.auth_service, "request_secondary_email_verification", _req
        )
        bg = _BG()
        out = await a.request_secondary_email_verification(
            secondary_email_id=sid,
            background_tasks=bg,
            next="/n",
            current_user=user,
            session=session,
        )
        assert len(bg.tasks) == 1
        return out

    assert "sent" in run(session_factory, _scenario)["detail"]


# --------------------------------------------------------------------------- #
# data export jobs                                                            #
# --------------------------------------------------------------------------- #
def test_latest_export_job_not_found(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        with pytest.raises(HTTPException) as exc:
            await a.latest_export_job(current_user=user, session=session)
        assert exc.value.status_code == status.HTTP_404_NOT_FOUND

    run(session_factory, _scenario)


def test_get_export_job_not_found(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        with pytest.raises(HTTPException):
            await a.get_export_job(job_id=uuid4(), current_user=user, session=session)

    run(session_factory, _scenario)


def test_start_export_job_returns_running(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        a.UserDataExportJobResponse,
        "model_validate",
        classmethod(lambda cls, obj, from_attributes=False: SimpleNamespace(id=obj.id)),
    )

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        job = UserDataExportJob(
            id=uuid4(),
            user_id=user.id,
            status=UserDataExportStatus.running,
            progress=10,
        )
        session.add(job)
        await session.commit()
        return await a.start_export_job(
            background_tasks=_BG(), current_user=user, session=session
        )

    out = run(session_factory, _scenario)
    assert out.id is not None


def test_start_export_job_pending_reschedules(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        a.UserDataExportJobResponse,
        "model_validate",
        classmethod(lambda cls, obj, from_attributes=False: SimpleNamespace(id=obj.id)),
    )
    monkeypatch.setattr(
        a.user_export_service, "run_user_export_job", lambda *a, **k: None
    )

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        job = UserDataExportJob(
            id=uuid4(),
            user_id=user.id,
            status=UserDataExportStatus.pending,
            progress=0,
        )
        session.add(job)
        await session.commit()
        bg = _BG()
        out = await a.start_export_job(
            background_tasks=bg, current_user=user, session=session
        )
        assert len(bg.tasks) == 1
        return out

    assert run(session_factory, _scenario).id is not None


def test_start_export_job_creates_new(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        a.UserDataExportJobResponse,
        "model_validate",
        classmethod(lambda cls, obj, from_attributes=False: SimpleNamespace(id=obj.id)),
    )
    monkeypatch.setattr(
        a.user_export_service, "run_user_export_job", lambda *a, **k: None
    )

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        bg = _BG()
        out = await a.start_export_job(
            background_tasks=bg, current_user=user, session=session
        )
        assert len(bg.tasks) == 1
        return out

    assert run(session_factory, _scenario).id is not None


def test_start_export_job_recent_success_returned(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        a.UserDataExportJobResponse,
        "model_validate",
        classmethod(lambda cls, obj, from_attributes=False: SimpleNamespace(id=obj.id)),
    )

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        job = UserDataExportJob(
            id=uuid4(),
            user_id=user.id,
            status=UserDataExportStatus.succeeded,
            progress=100,
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
        )
        session.add(job)
        await session.commit()
        return await a.start_export_job(
            background_tasks=_BG(), current_user=user, session=session
        )

    assert run(session_factory, _scenario).id is not None


# --------------------------------------------------------------------------- #
# google_callback / google_complete                                          #
# --------------------------------------------------------------------------- #
def _google_profile(**kw: Any) -> dict:
    base = dict(
        sub="g1",
        email="user@x.com",
        name="Goog",
        picture="http://g/p.png",
        email_verified=True,
        given_name="Goog",
        family_name="User",
    )
    base.update(kw)
    return base


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


def test_google_callback_invalid_profile(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_google_common(monkeypatch, _google_profile(sub="", email=""))

    async def _scenario(session) -> Any:
        with pytest.raises(HTTPException) as exc:
            await a.google_callback(
                payload=SimpleNamespace(code="c", state="s"),
                request=_Req(),
                background_tasks=_BG(),
                session=session,
                response=Response(),
                _=None,
            )
        assert exc.value.detail == "Invalid Google profile"

    run(session_factory, _scenario)


def test_google_callback_existing_complete_login(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_google_common(monkeypatch, _google_profile())
    _no_security_event(monkeypatch)
    monkeypatch.setattr(a.auth_service, "is_profile_complete", lambda u: True)

    async def _scenario(session) -> Any:
        user = await _mk_user(session, google_sub="g1")

        async def _by_sub(s, sub):
            return user

        async def _issue(s, u, **k):
            return {"access_token": "at", "refresh_token": "rt"}

        monkeypatch.setattr(a.auth_service, "get_user_by_google_sub", _by_sub)
        monkeypatch.setattr(a.auth_service, "issue_tokens_for_user", _issue)
        return await a.google_callback(
            payload=SimpleNamespace(code="c", state="s"),
            request=_Req(),
            background_tasks=_BG(),
            session=session,
            response=Response(),
            _=None,
        )

    assert run(session_factory, _scenario).tokens.access_token == "at"


def test_google_callback_existing_two_factor(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_google_common(monkeypatch, _google_profile())
    monkeypatch.setattr(a.auth_service, "is_profile_complete", lambda u: True)
    monkeypatch.setattr(security, "create_two_factor_token", lambda *a, **k: "2fa")

    async def _scenario(session) -> Any:
        user = await _mk_user(session, google_sub="g1", two_factor_enabled=True)

        async def _by_sub(s, sub):
            return user

        monkeypatch.setattr(a.auth_service, "get_user_by_google_sub", _by_sub)
        return await a.google_callback(
            payload=SimpleNamespace(code="c", state="s"),
            request=_Req(),
            background_tasks=_BG(),
            session=session,
            response=Response(),
            _=None,
        )

    out = run(session_factory, _scenario)
    assert out.requires_two_factor is True


def test_google_callback_existing_needs_completion(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_google_common(monkeypatch, _google_profile())
    monkeypatch.setattr(a.auth_service, "is_profile_complete", lambda u: False)
    monkeypatch.setattr(security, "create_google_completion_token", lambda uid: "comp")

    async def _scenario(session) -> Any:
        user = await _mk_user(session, google_sub="g1")

        async def _by_sub(s, sub):
            return user

        monkeypatch.setattr(a.auth_service, "get_user_by_google_sub", _by_sub)
        return await a.google_callback(
            payload=SimpleNamespace(code="c", state="s"),
            request=_Req(),
            background_tasks=_BG(),
            session=session,
            response=Response(),
            _=None,
        )

    out = run(session_factory, _scenario)
    assert out.requires_completion is True


def test_google_callback_email_linked_elsewhere(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_google_common(monkeypatch, _google_profile())

    async def _scenario(session) -> Any:
        existing = await _mk_user(session, google_sub="other-sub")

        async def _by_sub(s, sub):
            return None

        async def _by_email(s, email):
            return existing

        monkeypatch.setattr(a.auth_service, "get_user_by_google_sub", _by_sub)
        monkeypatch.setattr(a.auth_service, "get_user_by_any_email", _by_email)
        with pytest.raises(HTTPException) as exc:
            await a.google_callback(
                payload=SimpleNamespace(code="c", state="s"),
                request=_Req(),
                background_tasks=_BG(),
                session=session,
                response=Response(),
                _=None,
            )
        assert exc.value.status_code == status.HTTP_409_CONFLICT

    run(session_factory, _scenario)


def test_google_callback_email_password_account(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_google_common(monkeypatch, _google_profile())

    async def _scenario(session) -> Any:
        existing = await _mk_user(session, google_sub=None)

        async def _by_sub(s, sub):
            return None

        async def _by_email(s, email):
            return existing

        monkeypatch.setattr(a.auth_service, "get_user_by_google_sub", _by_sub)
        monkeypatch.setattr(a.auth_service, "get_user_by_any_email", _by_email)
        with pytest.raises(HTTPException) as exc:
            await a.google_callback(
                payload=SimpleNamespace(code="c", state="s"),
                request=_Req(),
                background_tasks=_BG(),
                session=session,
                response=Response(),
                _=None,
            )
        assert "already registered" in exc.value.detail

    run(session_factory, _scenario)


def test_google_callback_first_time_creates(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_google_common(monkeypatch, _google_profile())
    monkeypatch.setattr(security, "create_google_completion_token", lambda uid: "comp")

    async def _scenario(session) -> Any:
        async def _by_sub(s, sub):
            return None

        async def _by_email(s, email):
            return None

        new_user = await _mk_user(session)

        async def _create(s, **k):
            return new_user

        monkeypatch.setattr(a.auth_service, "get_user_by_google_sub", _by_sub)
        monkeypatch.setattr(a.auth_service, "get_user_by_any_email", _by_email)
        monkeypatch.setattr(a.auth_service, "create_google_user", _create)
        return await a.google_callback(
            payload=SimpleNamespace(code="c", state="s"),
            request=_Req(),
            background_tasks=_BG(),
            session=session,
            response=Response(),
            _=None,
        )

    out = run(session_factory, _scenario)
    assert out.requires_completion is True


def test_google_callback_domain_not_allowed(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_google_common(monkeypatch, _google_profile(email="user@bad.com"))
    monkeypatch.setattr(settings, "google_allowed_domains", ["good.com"])

    async def _scenario(session) -> Any:
        with pytest.raises(HTTPException) as exc:
            await a.google_callback(
                payload=SimpleNamespace(code="c", state="s"),
                request=_Req(),
                background_tasks=_BG(),
                session=session,
                response=Response(),
                _=None,
            )
        assert exc.value.status_code == status.HTTP_403_FORBIDDEN

    run(session_factory, _scenario)


def test_google_complete_consents_required(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        with pytest.raises(HTTPException) as exc:
            await a.google_complete_registration(
                payload=SimpleNamespace(accept_terms=False, accept_privacy=True),
                request=_Req(),
                background_tasks=_BG(),
                current_user=user,
                session=session,
                response=Response(),
            )
        assert exc.value.detail == "Legal consents required"

    run(session_factory, _scenario)


def test_google_complete_success(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _published_consent(monkeypatch)
    _no_security_event(monkeypatch)
    monkeypatch.setattr(a.email_service, "send_welcome_email", lambda *a, **k: None)
    monkeypatch.setattr(
        a.email_service, "send_verification_email", lambda *a, **k: None
    )

    async def _scenario(session) -> Any:
        completed = await _mk_user(session, email_verified=False)

        async def _complete(s, cu, **k):
            return completed

        async def _create_verif(s, u):
            return SimpleNamespace(token="vtok")

        async def _issue(s, u, **k):
            return {"access_token": "at", "refresh_token": "rt"}

        monkeypatch.setattr(a.auth_service, "complete_google_registration", _complete)
        monkeypatch.setattr(a.auth_service, "create_email_verification", _create_verif)
        monkeypatch.setattr(a.auth_service, "issue_tokens_for_user", _issue)
        bg = _BG()
        out = await a.google_complete_registration(
            payload=SimpleNamespace(
                accept_terms=True,
                accept_privacy=True,
                username="u",
                name="N",
                first_name="F",
                middle_name=None,
                last_name="L",
                date_of_birth=date(1990, 1, 1),
                phone="+40712345678",
                password="pw",
                preferred_language="en",
            ),
            request=_Req(),
            background_tasks=bg,
            current_user=completed,
            session=session,
            response=Response(),
        )
        # welcome + verification (email not verified)
        assert len(bg.tasks) == 2
        return out

    assert run(session_factory, _scenario).tokens.access_token == "at"
