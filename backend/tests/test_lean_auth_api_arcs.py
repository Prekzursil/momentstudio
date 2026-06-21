"""Branch-arc closures for ``app.api.v1.auth``.

Coverage worker [w2], batch 6. Drives the remaining partial branch arcs to
completion: the ``if response:`` false sides (handlers called with
``response=None``), naive-datetime normalization branches, admin-login
no-alert paths, the refresh rotation-grace negative arcs, and the avatar
upload return. All via direct handler calls with an in-memory SQLite session.
"""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any, Callable
from uuid import uuid4

import pytest
from fastapi import HTTPException, Response, UploadFile
from io import BytesIO

from app.api.v1 import auth as a
from app.core import security
from app.core.config import settings
from app.db.base import Base
from app.models.user import RefreshSession, User, UserRole, UserSecurityEvent
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


def _no_security_event(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _noop(*a, **k):
        return None

    monkeypatch.setattr(a.auth_service, "record_security_event", _noop)


def _refresh_request(token: str = "") -> Any:
    return SimpleNamespace(refresh_token=token)


# --------------------------------------------------------------------------- #
# _extract_refresh_session_jti: access token blank-jti tail (284->287)        #
# --------------------------------------------------------------------------- #
def test_extract_refresh_jti_access_blank_jti(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        security, "decode_token", lambda t: {"type": "access", "jti": "  "}
    )
    assert (
        a._extract_refresh_session_jti(_Req(headers={"authorization": "Bearer at"}))
        is None
    )


# --------------------------------------------------------------------------- #
# passkey_login_options: empty identifier (871->877)                          #
# --------------------------------------------------------------------------- #
def test_passkey_login_options_no_identifier(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _gen(s, u):
        return ({"challenge": "ch"}, b"ch")

    monkeypatch.setattr(
        a.passkeys_service, "generate_authentication_options_for_user", _gen
    )
    monkeypatch.setattr(security, "create_webauthn_token", lambda **k: "wa")

    async def _scenario(session) -> Any:
        return await a.passkey_login_options(
            payload=SimpleNamespace(identifier="", remember=False),
            session=session,
            _=None,
        )

    assert run(session_factory, _scenario).authentication_token == "wa"


# --------------------------------------------------------------------------- #
# refresh: response=None arcs + grace negative arcs                          #
# --------------------------------------------------------------------------- #
def test_refresh_silent_no_response(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Silent probe with response=None -> 1153->1155 false arc."""
    monkeypatch.setattr(security, "decode_token", lambda t: None)

    async def _scenario(session) -> Any:
        return await a.refresh_tokens(
            refresh_request=_refresh_request("bad"),
            request=_Req(headers={"X-Silent": "1"}),
            session=session,
            _=None,
            response=None,
        )

    resp = run(session_factory, _scenario)
    assert resp.status_code == 204


def test_refresh_no_rotation_response_none(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    """No-rotation reissue with response=None -> 1291->1293 false arc."""
    monkeypatch.setattr(settings, "refresh_token_rotation", False)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        rs = RefreshSession(
            id=uuid4(),
            user_id=user.id,
            jti="nr",
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
            persistent=True,
            revoked=False,
        )
        session.add(rs)
        await session.commit()
        monkeypatch.setattr(
            security,
            "decode_token",
            lambda t: {"type": "refresh", "jti": "nr", "sub": str(user.id)},
        )
        return await a.refresh_tokens(
            refresh_request=_refresh_request("rt"),
            request=_Req(),
            session=session,
            _=None,
            response=None,
        )

    assert run(session_factory, _scenario).access_token


def test_refresh_rotation_response_none(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Rotation reissue with response=None -> 1315->1317 false arc."""
    monkeypatch.setattr(settings, "refresh_token_rotation", True)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        rs = RefreshSession(
            id=uuid4(),
            user_id=user.id,
            jti="rot",
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
            persistent=True,
            revoked=False,
        )
        session.add(rs)
        await session.commit()
        monkeypatch.setattr(
            security,
            "decode_token",
            lambda t: {"type": "refresh", "jti": "rot", "sub": str(user.id)},
        )
        return await a.refresh_tokens(
            refresh_request=_refresh_request("rt"),
            request=_Req(),
            session=session,
            _=None,
            response=None,
        )

    assert run(session_factory, _scenario).access_token


def test_refresh_grace_expired_window_raises(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    """rotated_at + grace < now -> grace window closed -> 1254->1281 raise arc."""
    monkeypatch.setattr(settings, "refresh_token_rotation_grace_seconds", 1)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        old = RefreshSession(
            id=uuid4(),
            user_id=user.id,
            jti="oldg",
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
            persistent=True,
            revoked=True,
            revoked_reason="rotated",
            rotated_at=datetime.now(timezone.utc) - timedelta(hours=1),
            replaced_by_jti="missing-repl",
        )
        session.add(old)
        await session.commit()
        monkeypatch.setattr(
            security,
            "decode_token",
            lambda t: {"type": "refresh", "jti": "oldg", "sub": str(user.id)},
        )
        with pytest.raises(HTTPException):
            await a.refresh_tokens(
                refresh_request=_refresh_request("rt"),
                request=_Req(),
                session=session,
                _=None,
                response=Response(),
            )

    run(session_factory, _scenario)


def test_refresh_grace_replacement_invalid_raises(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    """In-window grace but replacement is revoked -> 1265->1281 raise arc."""
    monkeypatch.setattr(settings, "refresh_token_rotation_grace_seconds", 120)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        replacement = RefreshSession(
            id=uuid4(),
            user_id=user.id,
            jti="replr",
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
            persistent=True,
            revoked=True,  # invalid replacement
        )
        old = RefreshSession(
            id=uuid4(),
            user_id=user.id,
            jti="oldr",
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
            persistent=True,
            revoked=True,
            revoked_reason="rotated",
            rotated_at=datetime.now(timezone.utc),
            replaced_by_jti="replr",
        )
        session.add_all([replacement, old])
        await session.commit()
        monkeypatch.setattr(
            security,
            "decode_token",
            lambda t: {"type": "refresh", "jti": "oldr", "sub": str(user.id)},
        )
        with pytest.raises(HTTPException):
            await a.refresh_tokens(
                refresh_request=_refresh_request("rt"),
                request=_Req(),
                session=session,
                _=None,
                response=Response(),
            )

    run(session_factory, _scenario)


def test_refresh_grace_replay_response_none(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Grace replay with response=None -> 1277->1279 false arc."""
    monkeypatch.setattr(settings, "refresh_token_rotation_grace_seconds", 120)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        replacement = RefreshSession(
            id=uuid4(),
            user_id=user.id,
            jti="replok",
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
            persistent=True,
            revoked=False,
        )
        old = RefreshSession(
            id=uuid4(),
            user_id=user.id,
            jti="oldok",
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
            persistent=True,
            revoked=True,
            revoked_reason="rotated",
            rotated_at=datetime.now(timezone.utc),
            replaced_by_jti="replok",
        )
        session.add_all([replacement, old])
        await session.commit()
        monkeypatch.setattr(
            security,
            "decode_token",
            lambda t: {"type": "refresh", "jti": "oldok", "sub": str(user.id)},
        )
        return await a.refresh_tokens(
            refresh_request=_refresh_request("rt"),
            request=_Req(),
            session=session,
            _=None,
            response=None,
        )

    assert run(session_factory, _scenario).access_token


# --------------------------------------------------------------------------- #
# register / login response=None arcs                                        #
# --------------------------------------------------------------------------- #
def test_register_response_none(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _verify(token, remote_ip=None):
        return None

    monkeypatch.setattr(a.captcha_service, "verify", _verify)
    monkeypatch.setattr(a.metrics, "record_signup", lambda: None)

    async def _consent(session, keys):
        return {k: 1 for k in keys}

    monkeypatch.setattr(a, "_require_published_consent_docs", _consent)
    _no_security_event(monkeypatch)
    monkeypatch.setattr(
        a.email_service, "send_verification_email", lambda *a, **k: None
    )
    monkeypatch.setattr(a.email_service, "send_welcome_email", lambda *a, **k: None)

    async def _scenario(session) -> Any:
        created = await _mk_user(session)

        async def _create_user(s, data):
            return created

        async def _create_verif(s, u):
            return SimpleNamespace(token="vtok")

        async def _issue(s, u, **k):
            return {"access_token": "at", "refresh_token": "rt"}

        monkeypatch.setattr(a.auth_service, "create_user", _create_user)
        monkeypatch.setattr(a.auth_service, "create_email_verification", _create_verif)
        monkeypatch.setattr(a.auth_service, "issue_tokens_for_user", _issue)
        return await a.register(
            payload=SimpleNamespace(
                captcha_token="c",
                accept_terms=True,
                accept_privacy=True,
                username="newuser1",
                email="e@x.com",
                password="password123",
                name="N",
                first_name="F",
                middle_name=None,
                last_name="L",
                date_of_birth=date(1990, 1, 1),
                phone="+40712345678",
                preferred_language="en",
            ),
            request=_Req(),
            background_tasks=_BG(),
            session=session,
            _=None,
            response=None,
        )

    assert run(session_factory, _scenario).tokens.access_token == "at"


def test_login_response_none(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _verify(token, remote_ip=None):
        return None

    monkeypatch.setattr(a.captcha_service, "verify", _verify)
    monkeypatch.setattr(a.metrics, "record_login_success", lambda: None)
    monkeypatch.setattr(a.metrics, "record_login_failure", lambda: None)
    _no_security_event(monkeypatch)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)

        async def _auth(s, i, p):
            return user

        async def _issue(s, u, **k):
            return {"access_token": "at", "refresh_token": "rt"}

        monkeypatch.setattr(a.auth_service, "authenticate_user", _auth)
        monkeypatch.setattr(a.auth_service, "issue_tokens_for_user", _issue)
        return await a.login(
            payload=SimpleNamespace(
                identifier="u@x.com",
                email=None,
                password="pw",
                captcha_token="c",
                remember=False,
            ),
            request=_Req(),
            background_tasks=_BG(),
            session=session,
            _=None,
            response=None,
        )

    assert run(session_factory, _scenario).tokens.access_token == "at"


def test_login_2fa_response_none(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _no_security_event(monkeypatch)

    async def _scenario(session) -> Any:
        user = await _mk_user(session, two_factor_enabled=True)
        monkeypatch.setattr(
            security,
            "decode_token",
            lambda t: {"type": "two_factor", "sub": str(user.id)},
        )

        async def _verify(s, u, code):
            return True

        async def _issue(s, u, **k):
            return {"access_token": "at", "refresh_token": "rt"}

        monkeypatch.setattr(a.auth_service, "verify_two_factor_code", _verify)
        monkeypatch.setattr(a.auth_service, "issue_tokens_for_user", _issue)
        return await a.login_two_factor(
            payload=SimpleNamespace(two_factor_token="t", code="1"),
            request=_Req(),
            background_tasks=_BG(),
            session=session,
            _=None,
            response=None,
        )

    assert run(session_factory, _scenario).tokens.access_token == "at"


def test_passkey_login_verify_response_none(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        security,
        "decode_token",
        lambda t: {"type": "webauthn", "purpose": "login", "challenge": "abc"},
    )
    monkeypatch.setattr(a, "base64url_to_bytes", lambda c: b"abc")
    monkeypatch.setattr(a.auth_service, "is_profile_complete", lambda u: True)
    monkeypatch.setattr(a.metrics, "record_login_success", lambda: None)
    _no_security_event(monkeypatch)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)

        async def _verify(s, *, credential, expected_challenge, user_id):
            return user, SimpleNamespace()

        async def _issue(s, u, **k):
            return {"access_token": "at", "refresh_token": "rt"}

        monkeypatch.setattr(
            a.passkeys_service, "verify_passkey_authentication", _verify
        )
        monkeypatch.setattr(a.auth_service, "issue_tokens_for_user", _issue)
        return await a.passkey_login_verify(
            payload=SimpleNamespace(authentication_token="t", credential={}),
            request=_Req(),
            background_tasks=_BG(),
            session=session,
            _=None,
            response=None,
        )

    assert run(session_factory, _scenario).tokens.access_token == "at"


# --------------------------------------------------------------------------- #
# logout / admin ip-bypass response=None arcs                                #
# --------------------------------------------------------------------------- #
def test_logout_response_none(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        return await a.logout(
            payload=SimpleNamespace(refresh_token=""),
            request=_Req(),
            session=session,
            response=None,
        )

    assert run(session_factory, _scenario) is None


def test_admin_ip_bypass_response_none(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "admin_ip_bypass_token", "secret")
    monkeypatch.setattr(security, "create_admin_ip_bypass_token", lambda uid: "bt")
    _no_security_event(monkeypatch)

    async def _scenario(session) -> Any:
        user = await _mk_user(session, role=UserRole.admin)
        return await a.admin_ip_bypass(
            payload=SimpleNamespace(token="secret"),
            request=_Req(),
            session=session,
            current_user=user,
            response=None,
        )

    assert run(session_factory, _scenario) is None


def test_clear_admin_ip_bypass_response_none() -> None:
    assert asyncio.run(a.clear_admin_ip_bypass(response=None)) is None


# --------------------------------------------------------------------------- #
# 2fa status: no confirmed_at (1512->1514)                                   #
# --------------------------------------------------------------------------- #
def test_two_factor_status_no_confirmed(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        user = await _mk_user(session, two_factor_confirmed_at=None)
        return await a.two_factor_status(current_user=user)

    assert run(session_factory, _scenario).confirmed_at is None


# --------------------------------------------------------------------------- #
# request_secondary_email_verification: secondary missing (1883->1892)        #
# --------------------------------------------------------------------------- #
def test_request_secondary_email_verification_missing(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _req(s, u, secondary_email_id):
        return SimpleNamespace(token="tk")

    monkeypatch.setattr(a.auth_service, "request_secondary_email_verification", _req)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        bg = _BG()
        out = await a.request_secondary_email_verification(
            secondary_email_id=uuid4(),  # no such secondary row
            background_tasks=bg,
            next=None,
            current_user=user,
            session=session,
        )
        assert len(bg.tasks) == 0  # secondary None -> no email task
        return out

    assert "sent" in run(session_factory, _scenario)["detail"]


# --------------------------------------------------------------------------- #
# list_my_sessions: naive datetimes + skip current (2275/2280)                #
# --------------------------------------------------------------------------- #
def test_list_my_sessions_naive_datetimes(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(a, "_extract_refresh_session_jti", lambda req: "cur")

    async def _resolve(s, uid, jti):
        return "cur"

    monkeypatch.setattr(a, "_resolve_active_refresh_session_jti", _resolve)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        rs = RefreshSession(
            id=uuid4(),
            user_id=user.id,
            jti="cur",
            expires_at=(datetime.now(timezone.utc) + timedelta(days=1)).replace(
                tzinfo=None
            ),
            persistent=True,
            revoked=False,
            created_at=datetime(2024, 1, 1),
        )
        session.add(rs)
        await session.commit()
        return await a.list_my_sessions(
            request=_Req(), current_user=user, session=session
        )

    out = run(session_factory, _scenario)
    assert out[0].is_current is True


# --------------------------------------------------------------------------- #
# revoke_other_sessions: naive expiry skip arcs (2344/2352)                   #
# --------------------------------------------------------------------------- #
def test_revoke_other_sessions_naive_and_expired(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(security, "verify_password", lambda raw, hashed: True)
    monkeypatch.setattr(a, "_extract_refresh_session_jti", lambda req: "cur")

    async def _resolve(s, uid, jti):
        return "cur"

    monkeypatch.setattr(a, "_resolve_active_refresh_session_jti", _resolve)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        # current, one other with naive expiry, one expired
        for jti, exp, naive in [
            ("cur", timedelta(days=1), False),
            ("other", timedelta(days=1), True),
            ("expired", timedelta(days=-1), False),
        ]:
            e = datetime.now(timezone.utc) + exp
            if naive:
                e = e.replace(tzinfo=None)
            session.add(
                RefreshSession(
                    id=uuid4(),
                    user_id=user.id,
                    jti=jti,
                    expires_at=e,
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

    assert run(session_factory, _scenario).revoked == 1


# --------------------------------------------------------------------------- #
# list_security_events: naive created_at (2386->2388)                         #
# --------------------------------------------------------------------------- #
def test_list_security_events_aware(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        session.add(
            UserSecurityEvent(
                id=uuid4(),
                user_id=user.id,
                event_type="login_password",
                created_at=datetime.now(timezone.utc),  # aware -> 2386->2388 false arc
            )
        )
        await session.commit()
        return await a.list_security_events(
            current_user=user, session=session, limit=10
        )

    assert len(run(session_factory, _scenario)) == 1


# --------------------------------------------------------------------------- #
# update_me: no name in payload (2425->2427) and name None (2423 arc)         #
# --------------------------------------------------------------------------- #
def _profile(data: dict) -> Any:
    class P(SimpleNamespace):
        def model_dump(self, exclude_unset=False):
            return data

    return P(**data)


def test_update_me_no_name_key(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        return await a.update_me(
            payload=_profile({"phone": "+40712345678"}),
            current_user=user,
            session=session,
        )

    assert run(session_factory, _scenario).phone == "+40712345678"


def test_update_me_name_none(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        # name key present but None -> skips update_display_name (2423->2425 arc)
        return await a.update_me(
            payload=_profile({"name": None, "preferred_language": None}),
            current_user=user,
            session=session,
        )

    run(session_factory, _scenario)


# --------------------------------------------------------------------------- #
# avatar upload (2472)                                                        #
# --------------------------------------------------------------------------- #
def test_upload_avatar(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    def _save(file, *, root, filename, allowed_content_types, max_bytes):
        return ("/media/avatars/" + filename, filename)

    monkeypatch.setattr(a.storage, "save_upload", _save)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        upload = UploadFile(filename="pic.png", file=BytesIO(b"data"))
        return await a.upload_avatar(file=upload, current_user=user, session=session)

    out = run(session_factory, _scenario)
    assert out.avatar_url.endswith(".png")


# --------------------------------------------------------------------------- #
# google_complete: email already verified (2840->2848)                       #
# --------------------------------------------------------------------------- #
def test_google_complete_email_verified_skips_verif(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _consent(session, keys):
        return {k: 1 for k in keys}

    monkeypatch.setattr(a, "_require_published_consent_docs", _consent)
    _no_security_event(monkeypatch)
    monkeypatch.setattr(a.email_service, "send_welcome_email", lambda *a, **k: None)

    async def _scenario(session) -> Any:
        completed = await _mk_user(session, email_verified=True)

        async def _complete(s, cu, **k):
            return completed

        async def _issue(s, u, **k):
            return {"access_token": "at", "refresh_token": "rt"}

        monkeypatch.setattr(a.auth_service, "complete_google_registration", _complete)
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
        # only welcome (email already verified -> no verification email)
        assert len(bg.tasks) == 1
        return out

    assert run(session_factory, _scenario).tokens.access_token == "at"


def test_google_complete_response_none(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    """google_complete with response=None -> 2855->2857 false arc."""

    async def _consent(session, keys):
        return {k: 1 for k in keys}

    monkeypatch.setattr(a, "_require_published_consent_docs", _consent)
    _no_security_event(monkeypatch)
    monkeypatch.setattr(a.email_service, "send_welcome_email", lambda *a, **k: None)

    async def _scenario(session) -> Any:
        completed = await _mk_user(session, email_verified=True)

        async def _complete(s, cu, **k):
            return completed

        async def _issue(s, u, **k):
            return {"access_token": "at", "refresh_token": "rt"}

        monkeypatch.setattr(a.auth_service, "complete_google_registration", _complete)
        monkeypatch.setattr(a.auth_service, "issue_tokens_for_user", _issue)
        return await a.google_complete_registration(
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
            background_tasks=_BG(),
            current_user=completed,
            session=session,
            response=None,
        )

    assert run(session_factory, _scenario).tokens.access_token == "at"


# --------------------------------------------------------------------------- #
# google_link: name already set (2939->2941)                                 #
# --------------------------------------------------------------------------- #
class _ScalarsResult:
    """Stub ``session.execute(...)`` result returning preset rows."""

    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def scalars(self) -> "_ScalarsResult":
        return self

    def all(self) -> list[Any]:
        return self._rows


def test_list_my_sessions_aware_datetimes(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Rows already carry tz-aware datetimes -> the normalize-skip arcs
    (2275->2277, 2280->2282) which aiosqlite cannot otherwise produce."""
    monkeypatch.setattr(a, "_extract_refresh_session_jti", lambda req: None)

    async def _resolve(s, uid, jti):
        return None

    monkeypatch.setattr(a, "_resolve_active_refresh_session_jti", _resolve)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        aware_row = SimpleNamespace(
            id=uuid4(),
            jti="aware",
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
            created_at=datetime.now(timezone.utc),
            persistent=True,
            user_agent="ua",
            ip_address="1.2.3.4",
            country_code="RO",
        )

        async def _execute(*args, **kwargs):
            return _ScalarsResult([aware_row])

        monkeypatch.setattr(session, "execute", _execute)
        return await a.list_my_sessions(
            request=_Req(), current_user=user, session=session
        )

    out = run(session_factory, _scenario)
    assert len(out) == 1


def test_revoke_other_sessions_aware_datetime(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Other session with tz-aware expiry -> 2344->2346 normalize-skip arc."""
    monkeypatch.setattr(security, "verify_password", lambda raw, hashed: True)
    monkeypatch.setattr(a, "_extract_refresh_session_jti", lambda req: "cur")

    async def _resolve(s, uid, jti):
        return "cur"

    monkeypatch.setattr(a, "_resolve_active_refresh_session_jti", _resolve)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        # A real (unpersisted) RefreshSession with a tz-aware expiry; add_all on
        # the real session accepts it, and the aware expiry hits the skip arc.
        other = RefreshSession(
            id=uuid4(),
            user_id=user.id,
            jti="other",
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
            persistent=True,
            revoked=False,
        )

        async def _execute(*args, **kwargs):
            return _ScalarsResult([other])

        monkeypatch.setattr(session, "execute", _execute)
        # ``commit`` is invoked on the real session; keep it working.
        return await a.revoke_other_sessions(
            payload=SimpleNamespace(password="x"),
            request=_Req(),
            current_user=user,
            session=session,
        )

    assert run(session_factory, _scenario).revoked == 1


def test_list_security_events_aware_datetime_skip(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Event with tz-aware created_at -> 2386->2388 normalize-skip arc."""

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        evt = SimpleNamespace(
            id=uuid4(),
            event_type="login_password",
            created_at=datetime.now(timezone.utc),
            user_agent="ua",
            ip_address="1.2.3.4",
        )

        async def _execute(*args, **kwargs):
            return _ScalarsResult([evt])

        monkeypatch.setattr(session, "execute", _execute)
        return await a.list_security_events(
            current_user=user, session=session, limit=10
        )

    out = run(session_factory, _scenario)
    assert out[0].event_type == "login_password"


def test_passkey_login_verify_admin_no_alert_no_email(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Admin passkey login, unknown device, no owner email + no fallback (992->1005)."""
    monkeypatch.setattr(
        security,
        "decode_token",
        lambda t: {"type": "webauthn", "purpose": "login", "challenge": "abc"},
    )
    monkeypatch.setattr(a, "base64url_to_bytes", lambda c: b"abc")
    monkeypatch.setattr(a.auth_service, "is_profile_complete", lambda u: True)
    monkeypatch.setattr(a.metrics, "record_login_success", lambda: None)
    monkeypatch.setattr(settings, "admin_alert_email", "")
    _no_security_event(monkeypatch)

    async def _scenario(session) -> Any:
        user = await _mk_user(session, role=UserRole.admin, name="A")

        async def _verify(s, *, credential, expected_challenge, user_id):
            return user, SimpleNamespace()

        async def _seen(s, *, user_id, user_agent):
            return False

        async def _owner(s):
            return SimpleNamespace(email=None, preferred_language=None)

        async def _issue(s, u, **k):
            return {"access_token": "at", "refresh_token": "rt"}

        monkeypatch.setattr(
            a.passkeys_service, "verify_passkey_authentication", _verify
        )
        monkeypatch.setattr(a.auth_service, "has_seen_refresh_device", _seen)
        monkeypatch.setattr(a.auth_service, "get_owner_user", _owner)
        monkeypatch.setattr(a.auth_service, "issue_tokens_for_user", _issue)
        bg = _BG()
        out = await a.passkey_login_verify(
            payload=SimpleNamespace(authentication_token="t", credential={}),
            request=_Req(),
            background_tasks=bg,
            session=session,
            _=None,
            response=Response(),
        )
        assert len(bg.tasks) == 0
        return out

    assert run(session_factory, _scenario).tokens.access_token == "at"


def test_revoke_other_sessions_nothing_to_revoke(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Only the current session is active -> to_revoke empty (2352->2356)."""
    monkeypatch.setattr(security, "verify_password", lambda raw, hashed: True)
    monkeypatch.setattr(a, "_extract_refresh_session_jti", lambda req: "cur")

    async def _resolve(s, uid, jti):
        return "cur"

    monkeypatch.setattr(a, "_resolve_active_refresh_session_jti", _resolve)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        # Only the current session exists -> nothing to revoke.
        session.add(
            RefreshSession(
                id=uuid4(),
                user_id=user.id,
                jti="cur",
                expires_at=datetime.now(timezone.utc) + timedelta(days=1),
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

    assert run(session_factory, _scenario).revoked == 0


def test_login_2fa_admin_no_alert_no_email(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Admin 2FA login, unknown device, but no owner email + no fallback (992->1005)."""
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
            return SimpleNamespace(email=None, preferred_language=None)

        async def _issue(s, u, **k):
            return {"access_token": "at", "refresh_token": "rt"}

        monkeypatch.setattr(a.auth_service, "verify_two_factor_code", _verify)
        monkeypatch.setattr(a.auth_service, "has_seen_refresh_device", _seen)
        monkeypatch.setattr(a.auth_service, "get_owner_user", _owner)
        monkeypatch.setattr(a.auth_service, "issue_tokens_for_user", _issue)
        monkeypatch.setattr(settings, "admin_alert_email", "")
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


def test_google_callback_admin_no_alert_no_email(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Admin google login, unknown device, no owner email + no fallback (2675->2688)
    and response=None (2661->2663)."""
    monkeypatch.setattr(a, "_validate_google_state", lambda *a, **k: None)
    monkeypatch.setattr(a.self_service, "is_deletion_due", lambda u: False)
    monkeypatch.setattr(a.auth_service, "is_profile_complete", lambda u: True)
    monkeypatch.setattr(settings, "google_allowed_domains", [])
    monkeypatch.setattr(settings, "admin_alert_email", "")
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
            return SimpleNamespace(email=None, preferred_language=None)

        async def _issue(s, u, **k):
            return {"access_token": "at", "refresh_token": "rt"}

        monkeypatch.setattr(a.auth_service, "get_user_by_google_sub", _by_sub)
        monkeypatch.setattr(a.auth_service, "has_seen_refresh_device", _seen)
        monkeypatch.setattr(a.auth_service, "get_owner_user", _owner)
        monkeypatch.setattr(a.auth_service, "issue_tokens_for_user", _issue)
        bg = _BG()
        out = await a.google_callback(
            payload=SimpleNamespace(code="c", state="s"),
            request=_Req(),
            background_tasks=bg,
            session=session,
            response=None,  # 2661->2663 false arc
            _=None,
        )
        assert len(bg.tasks) == 0
        return out

    assert run(session_factory, _scenario).tokens.access_token == "at"


def test_google_link_name_already_set(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(a, "_validate_google_state", lambda *a, **k: None)
    monkeypatch.setattr(security, "verify_password", lambda raw, hashed: True)
    monkeypatch.setattr(settings, "google_allowed_domains", [])

    async def _scenario(session) -> Any:
        user = await _mk_user(session, name="Existing Name", email_verified=True)

        async def _exchange(code):
            return {
                "sub": "g1",
                "email": "user@x.com",
                "name": "Goog",
                "picture": "http://g/p.png",
                "email_verified": False,
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
    assert out.name == "Existing Name"  # name not overwritten
