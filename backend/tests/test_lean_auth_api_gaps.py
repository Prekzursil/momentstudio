"""Direct-call branch-completion coverage for ``app.api.v1.auth``.

Coverage worker [w2]. ``auth.py`` already has a broad sibling suite; this file
closes the residual branches the existing tests do not reach. Pure helpers are
called directly; route handlers are invoked as coroutines with an in-memory
SQLite session and stubbed request/response objects so the defensive error
paths (silent-refresh probes, rotation-grace replay, lock/deletion guards,
two-factor and secondary-email lifecycles) are exercised without a full HTTP
round-trip. Delegated services are monkeypatched on the *auth* namespace.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any, Callable
from uuid import UUID, uuid4

import jwt
import pytest
from fastapi import HTTPException, Response, status

from app.api.v1 import auth as a
from app.core import security
from app.core.config import settings
from app.db.base import Base
from app.models.user import RefreshSession, User, UserRole
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
        cookies: dict[str, str] | None = None,
        client_host: str | None = "1.2.3.4",
    ) -> None:
        self.headers = headers or {}
        self.cookies = cookies or {}
        self.client = type("C", (), {"host": client_host})() if client_host else None


async def _mk_user(session, **kwargs: Any) -> User:
    defaults: dict[str, Any] = dict(
        id=uuid4(),
        email=f"u{uuid4().hex[:8]}@example.com",
        username=f"u{uuid4().hex[:8]}",
        hashed_password="x",
        role=UserRole.customer,
    )
    defaults.update(kwargs)
    user = User(**defaults)
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _mk_refresh_session(session, user_id: UUID, **kwargs: Any) -> RefreshSession:
    defaults: dict[str, Any] = dict(
        id=uuid4(),
        user_id=user_id,
        jti=uuid4().hex,
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
        persistent=True,
        revoked=False,
    )
    defaults.update(kwargs)
    rs = RefreshSession(**defaults)
    session.add(rs)
    await session.commit()
    await session.refresh(rs)
    return rs


def _refresh_request(token: str = "") -> Any:
    return type("RR", (), {"refresh_token": token})()


# --------------------------------------------------------------------------- #
# _user_or_ip_identifier                                                      #
# --------------------------------------------------------------------------- #
def test_user_or_ip_identifier_from_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(a, "decode_token", lambda t: {"sub": "user-9"})
    assert (
        a._user_or_ip_identifier(_Req(headers={"authorization": "Bearer x"}))
        == "user:user-9"
    )


def test_user_or_ip_identifier_token_no_sub_falls_to_ip(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(a, "decode_token", lambda t: None)
    assert (
        a._user_or_ip_identifier(
            _Req(headers={"authorization": "Bearer x"}, client_host="5.5.5.5")
        )
        == "ip:5.5.5.5"
    )


def test_user_or_ip_identifier_anon() -> None:
    assert a._user_or_ip_identifier(_Req(client_host=None)) == "ip:anon"


# --------------------------------------------------------------------------- #
# _extract_bearer_token                                                       #
# --------------------------------------------------------------------------- #
def test_extract_bearer_token_empty() -> None:
    assert a._extract_bearer_token(_Req(headers={})) is None


def test_extract_bearer_token_malformed() -> None:
    assert a._extract_bearer_token(_Req(headers={"authorization": "Token x"})) is None
    assert a._extract_bearer_token(_Req(headers={"authorization": "Bearer"})) is None


def test_extract_bearer_token_blank_value() -> None:
    assert (
        a._extract_bearer_token(_Req(headers={"authorization": "Bearer    "})) is None
    )


def test_extract_bearer_token_ok() -> None:
    assert (
        a._extract_bearer_token(_Req(headers={"authorization": "Bearer abc"})) == "abc"
    )


# --------------------------------------------------------------------------- #
# _extract_refresh_session_jti                                                #
# --------------------------------------------------------------------------- #
def test_extract_refresh_jti_from_cookie(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        security, "decode_token", lambda t: {"type": "refresh", "jti": "j-1"}
    )
    assert (
        a._extract_refresh_session_jti(_Req(cookies={"refresh_token": "rt"})) == "j-1"
    )


def test_extract_refresh_jti_from_access_header(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _decode(t):
        return {"type": "access", "jti": "a-1"}

    monkeypatch.setattr(security, "decode_token", _decode)
    assert (
        a._extract_refresh_session_jti(_Req(headers={"authorization": "Bearer at"}))
        == "a-1"
    )


def test_extract_refresh_jti_none(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(security, "decode_token", lambda t: None)
    assert a._extract_refresh_session_jti(_Req()) is None


def test_extract_refresh_jti_cookie_wrong_type_then_no_access(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(security, "decode_token", lambda t: {"type": "access"})
    # cookie present but wrong type; no bearer header -> None
    assert a._extract_refresh_session_jti(_Req(cookies={"refresh_token": "rt"})) is None


def test_extract_refresh_jti_blank_jti(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        security, "decode_token", lambda t: {"type": "refresh", "jti": "  "}
    )
    assert a._extract_refresh_session_jti(_Req(cookies={"refresh_token": "rt"})) is None


# --------------------------------------------------------------------------- #
# _extract_country_code                                                       #
# --------------------------------------------------------------------------- #
def test_country_code_first_valid() -> None:
    assert a._extract_country_code(_Req(headers={"cf-ipcountry": "ro"})) == "RO"


def test_country_code_skips_placeholders_and_nonalnum() -> None:
    req = _Req(
        headers={
            "cf-ipcountry": "XX",
            "cloudfront-viewer-country": "ZZ",
            "fastly-client-country": "  ",
            "x-country-code": "!!",
            "x-country": "DE",
        }
    )
    assert a._extract_country_code(req) == "DE"


def test_country_code_truncates_long() -> None:
    assert (
        a._extract_country_code(_Req(headers={"cf-ipcountry": "ABCDEFGHIJ"}))
        == "ABCDEFGH"
    )


def test_country_code_none_when_all_invalid() -> None:
    assert a._extract_country_code(_Req(headers={"cf-ipcountry": "XX"})) is None


# --------------------------------------------------------------------------- #
# _cookie_samesite                                                            #
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "value,expected",
    [("strict", "strict"), ("none", "none"), ("lax", "lax"), ("weird", "lax")],
)
def test_cookie_samesite(
    monkeypatch: pytest.MonkeyPatch, value: str, expected: str
) -> None:
    monkeypatch.setattr(settings, "cookie_samesite", value)
    assert a._cookie_samesite() == expected


# --------------------------------------------------------------------------- #
# _validate_google_state                                                      #
# --------------------------------------------------------------------------- #
def test_validate_google_state_invalid_type(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(security, "decode_token", lambda s: {"type": "other"})
    with pytest.raises(HTTPException):
        a._validate_google_state("s", "login")


def test_validate_google_state_uid_mismatch(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        security, "decode_token", lambda s: {"type": "link", "uid": "a"}
    )
    with pytest.raises(HTTPException):
        a._validate_google_state("s", "link", expected_user_id="b")


def test_validate_google_state_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        security, "decode_token", lambda s: {"type": "link", "uid": "a"}
    )
    a._validate_google_state("s", "link", expected_user_id="a")  # no raise


def test_build_google_state_roundtrip() -> None:
    state = a._build_google_state("login", user_id="u1")
    decoded = jwt.decode(
        state, settings.secret_key, algorithms=[settings.jwt_algorithm]
    )
    assert decoded["type"] == "login"
    assert decoded["uid"] == "u1"


# --------------------------------------------------------------------------- #
# _require_published_consent_docs                                             #
# --------------------------------------------------------------------------- #
def test_require_consent_docs_missing_raises(
    session_factory: async_sessionmaker,
) -> None:
    async def _scenario(session) -> Any:
        with pytest.raises(HTTPException) as exc:
            await a._require_published_consent_docs(
                session, ("page.terms-and-conditions",)
            )
        assert exc.value.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR

    run(session_factory, _scenario)


# --------------------------------------------------------------------------- #
# _resolve_active_refresh_session_jti                                         #
# --------------------------------------------------------------------------- #
def test_resolve_active_jti_none_candidate(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        return await a._resolve_active_refresh_session_jti(session, uuid4(), None)

    assert run(session_factory, _scenario) is None


def test_resolve_active_jti_not_found(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        return await a._resolve_active_refresh_session_jti(session, uuid4(), "nope")

    assert run(session_factory, _scenario) is None


def test_resolve_active_jti_wrong_user(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        rs = await _mk_refresh_session(session, user.id)
        return await a._resolve_active_refresh_session_jti(session, uuid4(), rs.jti)

    assert run(session_factory, _scenario) is None


def test_resolve_active_jti_expired(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        rs = await _mk_refresh_session(
            session,
            user.id,
            expires_at=datetime.now(timezone.utc) - timedelta(days=1),
        )
        return await a._resolve_active_refresh_session_jti(session, user.id, rs.jti)

    assert run(session_factory, _scenario) is None


def test_resolve_active_jti_naive_expiry_and_active(
    session_factory: async_sessionmaker,
) -> None:
    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        # naive datetime exercises the tzinfo-normalisation branch
        rs = await _mk_refresh_session(
            session,
            user.id,
            expires_at=(datetime.now(timezone.utc) + timedelta(days=3)).replace(
                tzinfo=None
            ),
        )
        return await a._resolve_active_refresh_session_jti(session, user.id, rs.jti)

    jti = run(session_factory, _scenario)
    assert jti is not None


# --------------------------------------------------------------------------- #
# refresh_tokens                                                              #
# --------------------------------------------------------------------------- #
def test_refresh_missing_token_silent_probe(
    session_factory: async_sessionmaker,
) -> None:
    async def _scenario(session) -> Any:
        return await a.refresh_tokens(
            refresh_request=_refresh_request(""),
            request=_Req(headers={"X-Silent": "1"}),
            session=session,
            _=None,
            response=Response(),
        )

    resp = run(session_factory, _scenario)
    assert resp.status_code == status.HTTP_204_NO_CONTENT


def test_refresh_missing_token_raises(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        with pytest.raises(HTTPException) as exc:
            await a.refresh_tokens(
                refresh_request=_refresh_request(""),
                request=_Req(),
                session=session,
                _=None,
                response=Response(),
            )
        assert exc.value.status_code == status.HTTP_401_UNAUTHORIZED

    run(session_factory, _scenario)


def test_refresh_invalid_token_type_silent(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(security, "decode_token", lambda t: {"type": "access"})

    async def _scenario(session) -> Any:
        return await a.refresh_tokens(
            refresh_request=_refresh_request("bad"),
            request=_Req(headers={"X-Silent": "true"}),
            session=session,
            _=None,
            response=Response(),
        )

    assert run(session_factory, _scenario).status_code == status.HTTP_204_NO_CONTENT


def test_refresh_missing_jti_sub_silent(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(security, "decode_token", lambda t: {"type": "refresh"})

    async def _scenario(session) -> Any:
        return await a.refresh_tokens(
            refresh_request=_refresh_request("bad"),
            request=_Req(headers={"X-Silent": "yes"}),
            session=session,
            _=None,
            response=Response(),
        )

    assert run(session_factory, _scenario).status_code == status.HTTP_204_NO_CONTENT


def test_refresh_bad_sub_uuid_silent(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        security,
        "decode_token",
        lambda t: {"type": "refresh", "jti": "j", "sub": "not-uuid"},
    )

    async def _scenario(session) -> Any:
        return await a.refresh_tokens(
            refresh_request=_refresh_request("bad"),
            request=_Req(headers={"X-Silent": "on"}),
            session=session,
            _=None,
            response=Response(),
        )

    assert run(session_factory, _scenario).status_code == status.HTTP_204_NO_CONTENT


def test_refresh_bad_sub_uuid_raises(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        security, "decode_token", lambda t: {"type": "refresh", "jti": "j", "sub": "x"}
    )

    async def _scenario(session) -> Any:
        with pytest.raises(HTTPException):
            await a.refresh_tokens(
                refresh_request=_refresh_request("bad"),
                request=_Req(),
                session=session,
                _=None,
                response=Response(),
            )

    run(session_factory, _scenario)


def test_refresh_stored_missing_raises(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        security,
        "decode_token",
        lambda t: {"type": "refresh", "jti": "ghost", "sub": str(uuid4())},
    )

    async def _scenario(session) -> Any:
        with pytest.raises(HTTPException) as exc:
            await a.refresh_tokens(
                refresh_request=_refresh_request("bad"),
                request=_Req(),
                session=session,
                _=None,
                response=Response(),
            )
        assert exc.value.detail == "Invalid refresh token"

    run(session_factory, _scenario)


def test_refresh_user_deleted_raises(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _scenario(session) -> Any:
        user = await _mk_user(session, deleted_at=datetime.now(timezone.utc))
        rs = await _mk_refresh_session(session, user.id)
        monkeypatch.setattr(
            security,
            "decode_token",
            lambda t: {"type": "refresh", "jti": rs.jti, "sub": str(user.id)},
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


def test_refresh_user_locked_raises(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _scenario(session) -> Any:
        user = await _mk_user(
            session, locked_until=datetime.now(timezone.utc) + timedelta(hours=1)
        )
        rs = await _mk_refresh_session(session, user.id)
        monkeypatch.setattr(
            security,
            "decode_token",
            lambda t: {"type": "refresh", "jti": rs.jti, "sub": str(user.id)},
        )
        with pytest.raises(HTTPException) as exc:
            await a.refresh_tokens(
                refresh_request=_refresh_request("rt"),
                request=_Req(),
                session=session,
                _=None,
                response=Response(),
            )
        assert exc.value.status_code == status.HTTP_403_FORBIDDEN

    run(session_factory, _scenario)


def test_refresh_password_reset_required_raises(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _scenario(session) -> Any:
        user = await _mk_user(session, password_reset_required=True)
        rs = await _mk_refresh_session(session, user.id)
        monkeypatch.setattr(
            security,
            "decode_token",
            lambda t: {"type": "refresh", "jti": rs.jti, "sub": str(user.id)},
        )
        with pytest.raises(HTTPException) as exc:
            await a.refresh_tokens(
                refresh_request=_refresh_request("rt"),
                request=_Req(),
                session=session,
                _=None,
                response=Response(),
            )
        assert exc.value.detail == "Password reset required"

    run(session_factory, _scenario)


def test_refresh_no_rotation_reissues(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "refresh_token_rotation", False)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        rs = await _mk_refresh_session(session, user.id, persistent=False)
        monkeypatch.setattr(
            security,
            "decode_token",
            lambda t: {"type": "refresh", "jti": rs.jti, "sub": str(user.id)},
        )
        resp = Response()
        out = await a.refresh_tokens(
            refresh_request=_refresh_request("rt"),
            request=_Req(),
            session=session,
            _=None,
            response=resp,
        )
        return out

    out = run(session_factory, _scenario)
    assert out.access_token and out.refresh_token


def test_refresh_rotation_issues_replacement(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "refresh_token_rotation", True)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        rs = await _mk_refresh_session(session, user.id)
        monkeypatch.setattr(
            security,
            "decode_token",
            lambda t: {"type": "refresh", "jti": rs.jti, "sub": str(user.id)},
        )
        out = await a.refresh_tokens(
            refresh_request=_refresh_request("rt"),
            request=_Req(headers={"user-agent": "ua"}),
            session=session,
            _=None,
            response=Response(),
        )
        await session.refresh(rs)
        assert rs.revoked is True
        assert rs.revoked_reason == "rotated"
        return out

    out = run(session_factory, _scenario)
    assert out.access_token


def test_refresh_revoked_grace_replay(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "refresh_token_rotation_grace_seconds", 60)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        replacement = await _mk_refresh_session(session, user.id)
        old = await _mk_refresh_session(
            session,
            user.id,
            revoked=True,
            revoked_reason="rotated",
            rotated_at=datetime.now(timezone.utc),
            replaced_by_jti=replacement.jti,
        )
        monkeypatch.setattr(
            security,
            "decode_token",
            lambda t: {"type": "refresh", "jti": old.jti, "sub": str(user.id)},
        )
        out = await a.refresh_tokens(
            refresh_request=_refresh_request("rt"),
            request=_Req(),
            session=session,
            _=None,
            response=Response(),
        )
        return out

    out = run(session_factory, _scenario)
    assert out.access_token and out.refresh_token


def test_refresh_revoked_no_grace_raises(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "refresh_token_rotation_grace_seconds", 0)

    async def _scenario(session) -> Any:
        user = await _mk_user(session)
        old = await _mk_refresh_session(
            session, user.id, revoked=True, revoked_reason="rotated"
        )
        monkeypatch.setattr(
            security,
            "decode_token",
            lambda t: {"type": "refresh", "jti": old.jti, "sub": str(user.id)},
        )
        with pytest.raises(HTTPException) as exc:
            await a.refresh_tokens(
                refresh_request=_refresh_request("rt"),
                request=_Req(),
                session=session,
                _=None,
                response=Response(),
            )
        assert exc.value.detail == "Invalid refresh token"

    run(session_factory, _scenario)
