"""Final-pass coverage completion (worker 1) for ``app.api.v1.auth``.

Closes the residual branches the existing auth suite does not reach:

* module helper functions called directly with synthetic ``Request`` objects
  (``_user_or_ip_identifier``, ``_extract_bearer_token``,
  ``_extract_refresh_session_jti``, ``_extract_country_code``,
  ``_resolve_active_refresh_session_jti``, cookie helpers)
* pydantic request-model validators (``ProfileUpdate``, ``RegisterRequest``,
  ``GoogleCompleteRequest``)
* endpoint error/guard arcs reached via the in-memory ``TestClient`` harness
  (invalid passwords, invalid tokens, not-found, conflict, deletion-due, ...)

Mirrors the suite's in-memory ``TestClient`` + ``get_session`` override pattern.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Dict
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.requests import Request

from app.main import app
from app.core import security
from app.core.config import settings
from app.db.base import Base
from app.db.session import get_session
from app.models.content import ContentBlock, ContentStatus
from app.models.user import RefreshSession, User
from app.api.v1 import auth as auth_api


# --------------------------------------------------------------------------- #
# Fixtures / helpers
# --------------------------------------------------------------------------- #
@pytest.fixture
def test_app() -> Dict[str, object]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    session_local = async_sessionmaker(engine, expire_on_commit=False)

    async def init_models() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with session_local() as session:
            session.add_all(
                [
                    ContentBlock(
                        key="page.terms-and-conditions",
                        title="Terms",
                        body_markdown="Terms",
                        status=ContentStatus.published,
                        version=1,
                        published_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
                    ),
                    ContentBlock(
                        key="page.privacy-policy",
                        title="Privacy",
                        body_markdown="Privacy",
                        status=ContentStatus.published,
                        version=1,
                        published_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
                    ),
                ]
            )
            await session.commit()

    asyncio.run(init_models())

    async def override_get_session():
        async with session_local() as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session
    client = TestClient(app)
    yield {"client": client, "session_factory": session_local}
    client.close()
    app.dependency_overrides.clear()


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _register_payload(email: str, username: str, **over) -> dict:
    payload = {
        "email": email,
        "username": username,
        "password": "supersecret",
        "name": "User",
        "first_name": "Test",
        "last_name": "User",
        "date_of_birth": "2000-01-01",
        "phone": "+40723204204",
        "accept_terms": True,
        "accept_privacy": True,
    }
    payload.update(over)
    return payload


def _register(client: TestClient, email: str, username: str, **over) -> dict:
    resp = client.post(
        "/api/v1/auth/register", json=_register_payload(email, username, **over)
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _make_request(
    *, headers: dict[str, str] | None = None, cookies: dict[str, str] | None = None
) -> Request:
    raw_headers: list[tuple[bytes, bytes]] = []
    for key, value in (headers or {}).items():
        raw_headers.append((key.lower().encode(), value.encode()))
    if cookies:
        cookie_str = "; ".join(f"{k}={v}" for k, v in cookies.items())
        raw_headers.append((b"cookie", cookie_str.encode()))
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": raw_headers,
        "query_string": b"",
        "client": ("1.2.3.4", 1234),
    }
    return Request(scope)


# --------------------------------------------------------------------------- #
# _user_or_ip_identifier (131)
# --------------------------------------------------------------------------- #
def test_user_or_ip_identifier_variants():
    # no auth header -> ip identifier
    assert auth_api._user_or_ip_identifier(_make_request()).startswith("ip:")
    # bearer with a valid access token -> user identifier
    token = security.create_access_token("user-123", "jti-1")
    ident = auth_api._user_or_ip_identifier(
        _make_request(headers={"authorization": f"Bearer {token}"})
    )
    assert ident == "user:user-123"
    # bearer with an undecodable token -> falls back to ip
    bad = auth_api._user_or_ip_identifier(
        _make_request(headers={"authorization": "Bearer not-a-token"})
    )
    assert bad.startswith("ip:")


def test_user_or_ip_identifier_no_client():
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": [],
        "query_string": b"",
    }
    req = Request(scope)
    assert auth_api._user_or_ip_identifier(req) == "ip:anon"


# --------------------------------------------------------------------------- #
# google state helpers (195, 199, 207, 209)
# --------------------------------------------------------------------------- #
def test_validate_google_state_invalid_and_user_mismatch():
    with pytest.raises(HTTPException) as exc:
        auth_api._validate_google_state("garbage", "google_state")
    assert exc.value.status_code == 400

    state = auth_api._build_google_state("google_link", "user-1")
    with pytest.raises(HTTPException) as mism:
        auth_api._validate_google_state(state, "google_link", "user-2")
    assert mism.value.status_code == 400
    # matching user id passes
    auth_api._validate_google_state(state, "google_link", "user-1")


def test_cookie_samesite_variants(monkeypatch):
    monkeypatch.setattr(settings, "cookie_samesite", "strict")
    assert auth_api._cookie_samesite() == "strict"
    monkeypatch.setattr(settings, "cookie_samesite", "none")
    assert auth_api._cookie_samesite() == "none"
    monkeypatch.setattr(settings, "cookie_samesite", "lax")
    assert auth_api._cookie_samesite() == "lax"
    monkeypatch.setattr(settings, "cookie_samesite", "bogus")
    assert auth_api._cookie_samesite() == "lax"


# --------------------------------------------------------------------------- #
# cookie setters (set_refresh_cookie non-persistent: 238-239 area)
# --------------------------------------------------------------------------- #
def test_set_refresh_cookie_non_persistent_and_clear():
    from fastapi import Response

    resp = Response()
    auth_api.set_refresh_cookie(resp, "tok", persistent=False)
    auth_api.set_refresh_cookie(resp, "tok", persistent=True)
    auth_api.clear_refresh_cookie(resp)
    auth_api.set_admin_ip_bypass_cookie(resp, "tok")
    auth_api.clear_admin_ip_bypass_cookie(resp)


# --------------------------------------------------------------------------- #
# _extract_bearer_token (260-267)
# --------------------------------------------------------------------------- #
def test_extract_bearer_token_variants():
    assert auth_api._extract_bearer_token(_make_request()) is None
    assert (
        auth_api._extract_bearer_token(
            _make_request(headers={"authorization": "Basic abc"})
        )
        is None
    )
    assert (
        auth_api._extract_bearer_token(
            _make_request(headers={"authorization": "Bearer "})
        )
        is None
    )
    assert (
        auth_api._extract_bearer_token(
            _make_request(headers={"authorization": "Bearer abc.def"})
        )
        == "abc.def"
    )


# --------------------------------------------------------------------------- #
# _extract_refresh_session_jti (279-287)
# --------------------------------------------------------------------------- #
def test_extract_refresh_session_jti_from_cookie_and_bearer():
    # refresh cookie path
    refresh = security.create_refresh_token(
        "u1", "jti-refresh", datetime.now(timezone.utc) + timedelta(days=1)
    )
    req = _make_request(cookies={"refresh_token": refresh})
    assert auth_api._extract_refresh_session_jti(req) == "jti-refresh"

    # access bearer path (no refresh cookie)
    access = security.create_access_token("u1", "jti-access")
    req2 = _make_request(headers={"authorization": f"Bearer {access}"})
    assert auth_api._extract_refresh_session_jti(req2) == "jti-access"

    # neither -> None
    assert auth_api._extract_refresh_session_jti(_make_request()) is None

    # cookie holds a wrong-type (access) token + bearer holds a wrong-type
    # (refresh) token -> both type checks fail -> None (274->279, 282->287)
    wrong_cookie = security.create_access_token("u1", "jti-x")
    wrong_bearer = security.create_refresh_token(
        "u1", "jti-y", datetime.now(timezone.utc) + timedelta(days=1)
    )
    req3 = _make_request(
        headers={"authorization": f"Bearer {wrong_bearer}"},
        cookies={"refresh_token": wrong_cookie},
    )
    assert auth_api._extract_refresh_session_jti(req3) is None

    # a cookie token with no jti (refresh type but empty jti) -> falls through
    empty_jti = security.create_refresh_token(
        "u1", "", datetime.now(timezone.utc) + timedelta(days=1)
    )
    req4 = _make_request(cookies={"refresh_token": empty_jti})
    assert auth_api._extract_refresh_session_jti(req4) is None


# --------------------------------------------------------------------------- #
# _extract_country_code (302-306)
# --------------------------------------------------------------------------- #
def test_extract_country_code_variants():
    assert auth_api._extract_country_code(_make_request()) is None
    assert (
        auth_api._extract_country_code(_make_request(headers={"cf-ipcountry": "XX"}))
        is None
    )
    # non-alphanumeric -> skipped
    assert (
        auth_api._extract_country_code(_make_request(headers={"x-country": "!!"}))
        is None
    )
    # long code truncated to 8
    code = auth_api._extract_country_code(
        _make_request(headers={"x-country-code": "ABCDEFGHIJ"})
    )
    assert code == "ABCDEFGH"
    # normal code
    assert (
        auth_api._extract_country_code(_make_request(headers={"cf-ipcountry": "ro"}))
        == "RO"
    )


# --------------------------------------------------------------------------- #
# _resolve_active_refresh_session_jti (316, 322-351)
# --------------------------------------------------------------------------- #
def test_resolve_active_refresh_session_jti_all_arcs():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def _run():
        import app.models  # noqa: F401

        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        user_id = uuid4()
        other_id = uuid4()
        now = datetime.now(timezone.utc)

        async with factory() as session:
            # candidate None -> None
            assert (
                await auth_api._resolve_active_refresh_session_jti(
                    session, user_id, None
                )
                is None
            )
            # not stored -> None
            assert (
                await auth_api._resolve_active_refresh_session_jti(
                    session, user_id, "ghost"
                )
                is None
            )

            # active, not revoked -> returns its jti
            active = RefreshSession(
                user_id=user_id,
                jti="active-jti",
                expires_at=now + timedelta(days=1),
                persistent=True,
            )
            # stored for a different user -> None (user mismatch)
            wrong_user = RefreshSession(
                user_id=other_id,
                jti="wrong-user",
                expires_at=now + timedelta(days=1),
            )
            # expired -> None
            expired = RefreshSession(
                user_id=user_id,
                jti="expired-jti",
                expires_at=now - timedelta(days=1),
            )
            # revoked with no replacement -> None
            revoked_no_repl = RefreshSession(
                user_id=user_id,
                jti="revoked-no-repl",
                expires_at=now + timedelta(days=1),
                revoked=True,
            )
            # revoked rotated -> follows replacement
            replacement = RefreshSession(
                user_id=user_id,
                jti="repl-jti",
                expires_at=now + timedelta(days=1),
            )
            revoked_with_repl = RefreshSession(
                user_id=user_id,
                jti="revoked-repl",
                expires_at=now + timedelta(days=1),
                revoked=True,
                replaced_by_jti="repl-jti",
            )
            session.add_all(
                [
                    active,
                    wrong_user,
                    expired,
                    revoked_no_repl,
                    replacement,
                    revoked_with_repl,
                ]
            )
            await session.commit()

            assert (
                await auth_api._resolve_active_refresh_session_jti(
                    session, user_id, "active-jti"
                )
                == "active-jti"
            )
            assert (
                await auth_api._resolve_active_refresh_session_jti(
                    session, user_id, "wrong-user"
                )
                is None
            )
            assert (
                await auth_api._resolve_active_refresh_session_jti(
                    session, user_id, "expired-jti"
                )
                is None
            )
            assert (
                await auth_api._resolve_active_refresh_session_jti(
                    session, user_id, "revoked-no-repl"
                )
                is None
            )
            assert (
                await auth_api._resolve_active_refresh_session_jti(
                    session, user_id, "revoked-repl"
                )
                == "repl-jti"
            )

    asyncio.run(_run())


def test_resolve_active_refresh_session_jti_replacement_invalid():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def _run():
        import app.models  # noqa: F401

        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        user_id = uuid4()
        now = datetime.now(timezone.utc)
        async with factory() as session:
            # replacement points at a missing jti -> None
            dangling = RefreshSession(
                user_id=user_id,
                jti="dangling",
                expires_at=now + timedelta(days=1),
                revoked=True,
                replaced_by_jti="nope",
            )
            # replacement expired -> None
            repl_expired = RefreshSession(
                user_id=user_id,
                jti="repl-exp",
                expires_at=now - timedelta(days=1),
            )
            src_expired_repl = RefreshSession(
                user_id=user_id,
                jti="src-exp",
                expires_at=now + timedelta(days=1),
                revoked=True,
                replaced_by_jti="repl-exp",
            )
            session.add_all([dangling, repl_expired, src_expired_repl])
            await session.commit()
            assert (
                await auth_api._resolve_active_refresh_session_jti(
                    session, user_id, "dangling"
                )
                is None
            )
            assert (
                await auth_api._resolve_active_refresh_session_jti(
                    session, user_id, "src-exp"
                )
                is None
            )

    asyncio.run(_run())


# --------------------------------------------------------------------------- #
# Request-model validators (389-419, 462-478, 2764-2789)
# --------------------------------------------------------------------------- #
def test_profile_update_validators():
    from app.api.v1.auth import ProfileUpdate

    # blank phone -> None
    assert ProfileUpdate(phone="   ").phone is None
    # invalid phone format -> error
    with pytest.raises(ValueError):
        ProfileUpdate(phone="12345")
    # valid phone
    assert ProfileUpdate(phone="+40723204204").phone == "+40723204204"
    # display name stripped
    assert ProfileUpdate(name="  Bob  ").name == "Bob"
    assert ProfileUpdate(name=None).name is None
    # name parts: blank -> None
    assert ProfileUpdate(first_name="   ").first_name is None
    assert ProfileUpdate(first_name="Ann").first_name == "Ann"
    # dob in future -> error
    with pytest.raises(ValueError):
        ProfileUpdate(
            date_of_birth=datetime.now(timezone.utc).date() + timedelta(days=1)
        )
    # dob None ok
    assert ProfileUpdate(date_of_birth=None).date_of_birth is None


def test_register_request_validators():
    from app.api.v1.auth import RegisterRequest

    base = dict(
        username="gooduser",
        email="reg@example.com",
        name="Name",
        first_name="First",
        last_name="Last",
        date_of_birth="2000-01-01",
        phone="+40723204204",
        password="supersecret",
    )
    # blank required string -> error
    with pytest.raises(ValueError):
        RegisterRequest(**{**base, "name": "   "})
    # middle name blank -> None
    model = RegisterRequest(**{**base, "middle_name": "  "})
    assert model.middle_name is None
    # middle name explicit None -> None
    assert RegisterRequest(**{**base, "middle_name": None}).middle_name is None
    # blank phone -> error
    with pytest.raises(ValueError):
        RegisterRequest(**{**base, "phone": "   "})
    # bad phone format -> error
    with pytest.raises(ValueError):
        RegisterRequest(**{**base, "phone": "12345"})
    # future dob -> error
    with pytest.raises(ValueError):
        RegisterRequest(**{**base, "date_of_birth": "2999-01-01"})


def test_google_complete_request_validators():
    from app.api.v1.auth import GoogleCompleteRequest

    base = dict(
        username="googleuser",
        name="Name",
        first_name="First",
        last_name="Last",
        date_of_birth="2000-01-01",
        phone="+40723204204",
        password="supersecret",
    )
    with pytest.raises(ValueError):
        GoogleCompleteRequest(**{**base, "first_name": "  "})
    assert GoogleCompleteRequest(**{**base, "middle_name": " "}).middle_name is None
    with pytest.raises(ValueError):
        GoogleCompleteRequest(**{**base, "phone": "  "})
    with pytest.raises(ValueError):
        GoogleCompleteRequest(**{**base, "phone": "nope"})
    with pytest.raises(ValueError):
        GoogleCompleteRequest(**{**base, "date_of_birth": "2999-01-01"})


# --------------------------------------------------------------------------- #
# Endpoint guard arcs via TestClient
# --------------------------------------------------------------------------- #
def test_login_missing_identifier(test_app):
    client = test_app["client"]
    resp = client.post("/api/v1/auth/login", json={"password": "x"})
    assert resp.status_code == 400
    assert "Identifier" in resp.text


def test_login_two_factor_invalid_token(test_app):
    client = test_app["client"]
    resp = client.post(
        "/api/v1/auth/login/2fa",
        json={"two_factor_token": "garbage", "code": "123456"},
    )
    assert resp.status_code == 400


def test_login_two_factor_bad_subject(test_app):
    client = test_app["client"]
    # a two-factor token with a non-uuid subject
    token = security.create_two_factor_token(
        "not-a-uuid", remember=False, method="password"
    )
    resp = client.post(
        "/api/v1/auth/login/2fa", json={"two_factor_token": token, "code": "1"}
    )
    assert resp.status_code == 400


def test_login_two_factor_user_missing(test_app):
    client = test_app["client"]
    token = security.create_two_factor_token(
        str(uuid4()), remember=False, method="password"
    )
    resp = client.post(
        "/api/v1/auth/login/2fa", json={"two_factor_token": token, "code": "1"}
    )
    assert resp.status_code == 400


def test_passkey_login_verify_invalid_token(test_app):
    client = test_app["client"]
    resp = client.post(
        "/api/v1/auth/passkeys/login/verify",
        json={"authentication_token": "garbage", "credential": {}},
    )
    assert resp.status_code == 400


def test_passkey_login_verify_empty_challenge(test_app):
    client = test_app["client"]
    token = security.create_webauthn_token(purpose="login", challenge="")
    resp = client.post(
        "/api/v1/auth/passkeys/login/verify",
        json={"authentication_token": token, "credential": {}},
    )
    assert resp.status_code == 400


def test_passkey_login_verify_bad_base64_challenge(test_app):
    client = test_app["client"]
    # a challenge that is not valid base64url -> decode raises -> 400
    token = security.create_webauthn_token(purpose="login", challenge="!!!not-b64!!!")
    resp = client.post(
        "/api/v1/auth/passkeys/login/verify",
        json={"authentication_token": token, "credential": {}},
    )
    assert resp.status_code == 400


def test_passkey_register_verify_empty_challenge(test_app):
    client = test_app["client"]
    tokens = _register(client, "pkec@example.com", "pkecuser")["tokens"]
    body = client.get(
        "/api/v1/auth/me", headers=_headers(tokens["access_token"])
    ).json()
    token = security.create_webauthn_token(
        purpose="register", challenge="", user_id=body["id"]
    )
    resp = client.post(
        "/api/v1/auth/me/passkeys/register/verify",
        headers=_headers(tokens["access_token"]),
        json={"registration_token": token, "credential": {}},
    )
    assert resp.status_code == 400


def test_passkey_register_verify_wrong_user(test_app):
    client = test_app["client"]
    tokens = _register(client, "pkwu@example.com", "pkwuuser")["tokens"]
    token = security.create_webauthn_token(
        purpose="register", challenge="abc", user_id=str(uuid4())
    )
    resp = client.post(
        "/api/v1/auth/me/passkeys/register/verify",
        headers=_headers(tokens["access_token"]),
        json={"registration_token": token, "credential": {}},
    )
    assert resp.status_code == 400


def test_passkey_register_verify_bad_base64_challenge(test_app):
    client = test_app["client"]
    tokens = _register(client, "pkbb@example.com", "pkbbuser")["tokens"]
    body = client.get(
        "/api/v1/auth/me", headers=_headers(tokens["access_token"])
    ).json()
    token = security.create_webauthn_token(
        purpose="register", challenge="!!!bad!!!", user_id=body["id"]
    )
    resp = client.post(
        "/api/v1/auth/me/passkeys/register/verify",
        headers=_headers(tokens["access_token"]),
        json={"registration_token": token, "credential": {}},
    )
    assert resp.status_code == 400


def test_passkey_register_verify_invalid_token(test_app):
    client = test_app["client"]
    tokens = _register(client, "pk@example.com", "pkuser")["tokens"]
    resp = client.post(
        "/api/v1/auth/me/passkeys/register/verify",
        headers=_headers(tokens["access_token"]),
        json={"registration_token": "garbage", "credential": {}},
    )
    assert resp.status_code == 400


def test_passkey_register_options_invalid_password(test_app):
    client = test_app["client"]
    tokens = _register(client, "pk2@example.com", "pkuser2")["tokens"]
    resp = client.post(
        "/api/v1/auth/me/passkeys/register/options",
        headers=_headers(tokens["access_token"]),
        json={"password": "wrong"},
    )
    assert resp.status_code == 400


def test_passkey_delete_invalid_password_and_not_found(test_app):
    client = test_app["client"]
    tokens = _register(client, "pk3@example.com", "pkuser3")["tokens"]
    # invalid password
    resp = client.request(
        "DELETE",
        f"/api/v1/auth/me/passkeys/{uuid4()}",
        headers=_headers(tokens["access_token"]),
        json={"password": "wrong"},
    )
    assert resp.status_code == 400
    # right password, missing passkey -> 404
    resp2 = client.request(
        "DELETE",
        f"/api/v1/auth/me/passkeys/{uuid4()}",
        headers=_headers(tokens["access_token"]),
        json={"password": "supersecret"},
    )
    assert resp2.status_code == 404


def test_refresh_missing_token(test_app):
    client = test_app["client"]
    resp = client.post("/api/v1/auth/refresh", json={})
    assert resp.status_code == 401


def test_refresh_invalid_token(test_app):
    client = test_app["client"]
    resp = client.post("/api/v1/auth/refresh", json={"refresh_token": "garbage"})
    assert resp.status_code == 401


def test_refresh_silent_probe_no_content(test_app):
    client = test_app["client"]
    resp = client.post("/api/v1/auth/refresh", json={}, headers={"X-Silent": "true"})
    assert resp.status_code == 204


def _refresh_token_for(client: TestClient, email: str, username: str) -> str:
    auth = _register(client, email, username)
    return auth["tokens"]["refresh_token"]


def _mutate_user(session_factory, email: str, **fields):
    async def _run():
        from sqlalchemy import select as _select

        async with session_factory() as session:
            user = (
                await session.execute(_select(User).where(User.email == email))
            ).scalar_one()
            for key, value in fields.items():
                setattr(user, key, value)
            session.add(user)
            await session.commit()

    asyncio.run(_run())


def test_refresh_success_rotates(test_app):
    client = test_app["client"]
    refresh = _refresh_token_for(client, "rf@example.com", "rfuser")
    resp = client.post("/api/v1/auth/refresh", json={"refresh_token": refresh})
    assert resp.status_code == 200
    assert resp.json()["access_token"]


def test_refresh_silent_probe_invalid_returns_204(test_app):
    client = test_app["client"]
    resp = client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": "garbage"},
        headers={"X-Silent": "1"},
    )
    assert resp.status_code == 204


def test_refresh_silent_probe_bad_subject(test_app):
    client = test_app["client"]
    # refresh-typed token with bad jti/sub triggers the silent 204 branch
    tok = security.create_refresh_token(
        "not-a-uuid", "jti", datetime.now(timezone.utc) + timedelta(days=1)
    )
    resp = client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": tok},
        headers={"X-Silent": "yes"},
    )
    assert resp.status_code == 204


def test_refresh_token_user_deleted(test_app):
    client = test_app["client"]
    refresh = _refresh_token_for(client, "rfd@example.com", "rfduser")
    _mutate_user(
        test_app["session_factory"],
        "rfd@example.com",
        deleted_at=datetime.now(timezone.utc),
    )
    resp = client.post("/api/v1/auth/refresh", json={"refresh_token": refresh})
    assert resp.status_code == 401


def test_refresh_token_locked(test_app):
    client = test_app["client"]
    refresh = _refresh_token_for(client, "rfl@example.com", "rfluser")
    _mutate_user(
        test_app["session_factory"],
        "rfl@example.com",
        locked_until=datetime.now(timezone.utc) + timedelta(hours=1),
    )
    resp = client.post("/api/v1/auth/refresh", json={"refresh_token": refresh})
    assert resp.status_code == 403


def test_refresh_token_password_reset_required(test_app):
    client = test_app["client"]
    refresh = _refresh_token_for(client, "rfp@example.com", "rfpuser")
    _mutate_user(
        test_app["session_factory"], "rfp@example.com", password_reset_required=True
    )
    resp = client.post("/api/v1/auth/refresh", json={"refresh_token": refresh})
    assert resp.status_code == 403


def test_refresh_token_deletion_due(test_app):
    client = test_app["client"]
    refresh = _refresh_token_for(client, "rfdd@example.com", "rfdduser")
    _mutate_user(
        test_app["session_factory"],
        "rfdd@example.com",
        deletion_requested_at=datetime.now(timezone.utc) - timedelta(days=40),
        deletion_scheduled_for=datetime.now(timezone.utc) - timedelta(days=1),
    )
    resp = client.post("/api/v1/auth/refresh", json={"refresh_token": refresh})
    assert resp.status_code == 401


def test_refresh_revoked_token_rejected(test_app):
    client = test_app["client"]
    refresh = _refresh_token_for(client, "rfr@example.com", "rfruser")

    async def _revoke():
        from sqlalchemy import select as _select

        async with test_app["session_factory"]() as session:
            rows = (await session.execute(_select(RefreshSession))).scalars().all()
            for row in rows:
                row.revoked = True
                row.revoked_reason = "manual"
                session.add(row)
            await session.commit()

    asyncio.run(_revoke())
    resp = client.post("/api/v1/auth/refresh", json={"refresh_token": refresh})
    assert resp.status_code == 401


def test_refresh_no_rotation_reissues(test_app, monkeypatch):
    monkeypatch.setattr(settings, "refresh_token_rotation", False)
    client = test_app["client"]
    refresh = _refresh_token_for(client, "rfnr@example.com", "rfnruser")
    resp = client.post("/api/v1/auth/refresh", json={"refresh_token": refresh})
    assert resp.status_code == 200
    assert resp.json()["access_token"]


def test_change_password_wrong_current(test_app):
    client = test_app["client"]
    tokens = _register(client, "cp@example.com", "cpuser")["tokens"]
    resp = client.post(
        "/api/v1/auth/password/change",
        headers=_headers(tokens["access_token"]),
        json={"current_password": "wrong", "new_password": "newsecret"},
    )
    assert resp.status_code == 400


def test_two_factor_setup_wrong_password(test_app):
    client = test_app["client"]
    tokens = _register(client, "2fa@example.com", "tfauser")["tokens"]
    resp = client.post(
        "/api/v1/auth/me/2fa/setup",
        headers=_headers(tokens["access_token"]),
        json={"password": "wrong"},
    )
    assert resp.status_code == 400


def test_two_factor_disable_not_enabled(test_app):
    client = test_app["client"]
    tokens = _register(client, "2fad@example.com", "tfaduser")["tokens"]
    resp = client.post(
        "/api/v1/auth/me/2fa/disable",
        headers=_headers(tokens["access_token"]),
        json={"password": "supersecret", "code": "123456"},
    )
    assert resp.status_code == 400


def test_two_factor_disable_wrong_password(test_app):
    client = test_app["client"]
    tokens = _register(client, "2fadw@example.com", "tfadwuser")["tokens"]
    resp = client.post(
        "/api/v1/auth/me/2fa/disable",
        headers=_headers(tokens["access_token"]),
        json={"password": "wrong", "code": "123456"},
    )
    assert resp.status_code == 400


def test_two_factor_regenerate_wrong_password_and_not_enabled(test_app):
    client = test_app["client"]
    tokens = _register(client, "2far@example.com", "tfaruser")["tokens"]
    resp = client.post(
        "/api/v1/auth/me/2fa/recovery-codes/regenerate",
        headers=_headers(tokens["access_token"]),
        json={"password": "wrong", "code": "1"},
    )
    assert resp.status_code == 400
    resp2 = client.post(
        "/api/v1/auth/me/2fa/recovery-codes/regenerate",
        headers=_headers(tokens["access_token"]),
        json={"password": "supersecret", "code": "1"},
    )
    assert resp2.status_code == 400


def test_update_username_wrong_password(test_app):
    client = test_app["client"]
    tokens = _register(client, "un@example.com", "unuser")["tokens"]
    resp = client.patch(
        "/api/v1/auth/me/username",
        headers=_headers(tokens["access_token"]),
        json={"username": "newname123", "password": "wrong"},
    )
    assert resp.status_code == 400


def test_update_email_wrong_password(test_app):
    client = test_app["client"]
    tokens = _register(client, "ue@example.com", "ueuser")["tokens"]
    resp = client.patch(
        "/api/v1/auth/me/email",
        headers=_headers(tokens["access_token"]),
        json={"email": "new@example.com", "password": "wrong"},
    )
    assert resp.status_code == 400


def test_make_secondary_primary_wrong_password(test_app):
    client = test_app["client"]
    tokens = _register(client, "sp@example.com", "spuser")["tokens"]
    resp = client.post(
        f"/api/v1/auth/me/emails/{uuid4()}/make-primary",
        headers=_headers(tokens["access_token"]),
        json={"password": "wrong"},
    )
    assert resp.status_code == 400


def test_delete_secondary_wrong_password(test_app):
    client = test_app["client"]
    tokens = _register(client, "ds@example.com", "dsuser")["tokens"]
    resp = client.request(
        "DELETE",
        f"/api/v1/auth/me/emails/{uuid4()}",
        headers=_headers(tokens["access_token"]),
        json={"password": "wrong"},
    )
    assert resp.status_code == 400


def test_export_job_latest_not_found(test_app):
    client = test_app["client"]
    tokens = _register(client, "ex@example.com", "exuser")["tokens"]
    resp = client.get(
        "/api/v1/auth/me/export/jobs/latest",
        headers=_headers(tokens["access_token"]),
    )
    assert resp.status_code == 404


def test_export_job_get_not_found(test_app):
    client = test_app["client"]
    tokens = _register(client, "ex2@example.com", "exuser2")["tokens"]
    resp = client.get(
        f"/api/v1/auth/me/export/jobs/{uuid4()}",
        headers=_headers(tokens["access_token"]),
    )
    assert resp.status_code == 404


def test_export_job_download_not_found(test_app):
    client = test_app["client"]
    tokens = _register(client, "ex3@example.com", "exuser3")["tokens"]
    resp = client.get(
        f"/api/v1/auth/me/export/jobs/{uuid4()}/download",
        headers=_headers(tokens["access_token"]),
    )
    assert resp.status_code == 404


def test_request_account_deletion_wrong_confirm_and_password(test_app):
    client = test_app["client"]
    tokens = _register(client, "del@example.com", "deluser")["tokens"]
    resp = client.post(
        "/api/v1/auth/me/delete",
        headers=_headers(tokens["access_token"]),
        json={"confirm": "nope", "password": "supersecret"},
    )
    assert resp.status_code == 400
    resp2 = client.post(
        "/api/v1/auth/me/delete",
        headers=_headers(tokens["access_token"]),
        json={"confirm": "DELETE", "password": "wrong"},
    )
    assert resp2.status_code == 400


def test_account_deletion_lifecycle_and_cancel(test_app):
    client = test_app["client"]
    tokens = _register(client, "del2@example.com", "deluser2")["tokens"]
    hdr = _headers(tokens["access_token"])
    # schedule
    resp = client.post(
        "/api/v1/auth/me/delete",
        headers=hdr,
        json={"confirm": "DELETE", "password": "supersecret"},
    )
    assert resp.status_code == 200
    # scheduling again while pending -> 400
    resp2 = client.post(
        "/api/v1/auth/me/delete",
        headers=hdr,
        json={"confirm": "DELETE", "password": "supersecret"},
    )
    assert resp2.status_code == 400
    # status
    status_resp = client.get("/api/v1/auth/me/delete/status", headers=hdr)
    assert status_resp.status_code == 200
    # cancel
    cancel = client.post("/api/v1/auth/me/delete/cancel", headers=hdr)
    assert cancel.status_code == 200


def test_use_google_avatar_without_google(test_app):
    client = test_app["client"]
    tokens = _register(client, "ga@example.com", "gauser")["tokens"]
    resp = client.post(
        "/api/v1/auth/me/avatar/use-google",
        headers=_headers(tokens["access_token"]),
    )
    assert resp.status_code == 400


def test_update_training_mode_forbidden_for_regular_user(test_app):
    client = test_app["client"]
    tokens = _register(client, "tm@example.com", "tmuser")["tokens"]
    resp = client.patch(
        "/api/v1/auth/me/training-mode",
        headers=_headers(tokens["access_token"]),
        json={"enabled": True},
    )
    assert resp.status_code == 403


def test_update_me_required_field_clears(test_app):
    client = test_app["client"]
    tokens = _register(client, "um@example.com", "umuser")["tokens"]
    hdr = _headers(tokens["access_token"])
    for field in ("phone", "first_name", "last_name", "date_of_birth"):
        resp = client.patch("/api/v1/auth/me", headers=hdr, json={field: None})
        assert resp.status_code == 400


def test_update_me_updates_fields(test_app):
    client = test_app["client"]
    tokens = _register(client, "um2@example.com", "umuser2")["tokens"]
    hdr = _headers(tokens["access_token"])
    resp = client.patch(
        "/api/v1/auth/me",
        headers=hdr,
        json={
            "middle_name": "Mid",
            "preferred_language": "ro",
            "phone": "+40723204205",
        },
    )
    assert resp.status_code == 200
    assert resp.json()["preferred_language"] == "ro"


def test_remove_avatar_and_update_language_notifications(test_app):
    client = test_app["client"]
    tokens = _register(client, "misc@example.com", "miscuser")["tokens"]
    hdr = _headers(tokens["access_token"])
    assert client.delete("/api/v1/auth/me/avatar", headers=hdr).status_code == 200
    assert (
        client.patch(
            "/api/v1/auth/me/language", headers=hdr, json={"preferred_language": "ro"}
        ).status_code
        == 200
    )
    assert (
        client.patch(
            "/api/v1/auth/me/notifications",
            headers=hdr,
            json={"notify_marketing": True},
        ).status_code
        == 200
    )


def test_revoke_other_sessions_wrong_password(test_app):
    client = test_app["client"]
    tokens = _register(client, "ros@example.com", "rosuser")["tokens"]
    resp = client.post(
        "/api/v1/auth/me/sessions/revoke-others",
        headers=_headers(tokens["access_token"]),
        json={"password": "wrong"},
    )
    assert resp.status_code == 400


def test_step_up_requires_admin(test_app):
    client = test_app["client"]
    tokens = _register(client, "su@example.com", "suuser")["tokens"]
    resp = client.post(
        "/api/v1/auth/step-up",
        headers=_headers(tokens["access_token"]),
        json={"password": "supersecret"},
    )
    # regular user is not admin -> 403 from require_admin_section dependency
    assert resp.status_code == 403


def test_clear_admin_ip_bypass_endpoint(test_app):
    client = test_app["client"]
    resp = client.delete("/api/v1/auth/admin/ip-bypass")
    assert resp.status_code == 204


def test_logout_clears_cookies(test_app):
    client = test_app["client"]
    auth = _register(client, "lo@example.com", "louser")
    refresh = auth["tokens"]["refresh_token"]
    resp = client.post("/api/v1/auth/logout", json={"refresh_token": refresh})
    assert resp.status_code == 204


def test_google_start_not_configured(test_app, monkeypatch):
    client = test_app["client"]
    monkeypatch.setattr(settings, "google_client_id", "")
    resp = client.get("/api/v1/auth/google/start")
    assert resp.status_code == 400


def test_google_callback_invalid_state(test_app):
    client = test_app["client"]
    resp = client.post(
        "/api/v1/auth/google/callback", json={"code": "x", "state": "garbage"}
    )
    assert resp.status_code == 400


def test_google_link_start_not_configured(test_app, monkeypatch):
    client = test_app["client"]
    tokens = _register(client, "gls@example.com", "glsuser")["tokens"]
    monkeypatch.setattr(settings, "google_client_id", "")
    resp = client.get(
        "/api/v1/auth/google/link/start", headers=_headers(tokens["access_token"])
    )
    assert resp.status_code == 400


def test_google_link_invalid_state(test_app):
    client = test_app["client"]
    tokens = _register(client, "gl@example.com", "gluser")["tokens"]
    resp = client.post(
        "/api/v1/auth/google/link",
        headers=_headers(tokens["access_token"]),
        json={"code": "x", "state": "garbage", "password": "supersecret"},
    )
    assert resp.status_code == 400


def test_google_unlink_wrong_password(test_app):
    client = test_app["client"]
    tokens = _register(client, "gu@example.com", "guuser")["tokens"]
    resp = client.post(
        "/api/v1/auth/google/unlink",
        headers=_headers(tokens["access_token"]),
        json={"password": "wrong"},
    )
    assert resp.status_code == 400


def test_password_reset_request_unknown_email(test_app):
    client = test_app["client"]
    resp = client.post(
        "/api/v1/auth/password-reset/request", json={"email": "nobody@example.com"}
    )
    assert resp.status_code == 202
