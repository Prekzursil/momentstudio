"""Targeted unit tests for app.core.dependencies (coverage worker 4).

Exercises the FastAPI auth/role dependencies and private helpers directly,
using an in-memory SQLite session and a lightweight fake ``Request``. No live
network is used.
"""

import asyncio
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import jwt
import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core import dependencies as deps
from app.core.config import settings
from app.db.base import Base
from app.models.passkeys import UserPasskey
from app.models.user import User, UserRole
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

pytestmark = pytest.mark.anyio


# --------------------------------------------------------------------------- #
# Fixtures / helpers
# --------------------------------------------------------------------------- #


@pytest.fixture
def session_factory() -> async_sessionmaker:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def _init() -> None:
        import app.models  # noqa: F401

        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_init())
    return factory


class FakeClient:
    def __init__(self, host: str | None):
        self.host = host


class FakeRequest:
    """Minimal stand-in for starlette.Request used by the dependencies."""

    def __init__(
        self,
        *,
        method: str = "GET",
        headers: dict[str, str] | None = None,
        cookies: dict[str, str] | None = None,
        client_host: str | None = "1.2.3.4",
    ):
        self.method = method
        self.headers = headers or {}
        self.cookies = cookies or {}
        self.client = FakeClient(client_host) if client_host is not None else None

        class _State:
            pass

        self.state = _State()


def _make_token(claims: dict) -> str:
    payload = dict(claims)
    payload.setdefault("exp", datetime.now(timezone.utc) + timedelta(minutes=10))
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def _creds(token: str) -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


async def _add_user(
    factory: async_sessionmaker,
    *,
    role: UserRole = UserRole.customer,
    email: str = "u@example.com",
    with_passkey: bool = False,
    **fields,
) -> User:
    async with factory() as session:
        suffix = uuid4().hex[:12]
        fields.setdefault("username", f"user-{suffix}")
        fields.setdefault("name", f"User {suffix}")
        user = User(email=email, hashed_password="x", role=role, **fields)
        session.add(user)
        await session.flush()
        if with_passkey:
            session.add(
                UserPasskey(
                    user_id=user.id,
                    name="pk",
                    credential_id=f"cred-{user.id}",
                    public_key=b"k",
                    sign_count=0,
                    backed_up=False,
                )
            )
        await session.commit()
        await session.refresh(user)
        return user


# --------------------------------------------------------------------------- #
# _has_passkey / _require_admin_mfa
# --------------------------------------------------------------------------- #


async def test_has_passkey_true_and_false(session_factory):
    user = await _add_user(session_factory, with_passkey=True)
    other = await _add_user(session_factory, email="o@example.com")
    async with session_factory() as session:
        assert await deps._has_passkey(session, user.id) is True
        assert await deps._has_passkey(session, other.id) is False


async def test_require_admin_mfa_non_admin_returns(session_factory):
    user = await _add_user(session_factory, role=UserRole.customer)
    async with session_factory() as session:
        await deps._require_admin_mfa(session, user)  # no raise


async def test_require_admin_mfa_not_required(session_factory, monkeypatch):
    monkeypatch.setattr(settings, "admin_mfa_required", False, raising=False)
    user = await _add_user(session_factory, role=UserRole.admin)
    async with session_factory() as session:
        await deps._require_admin_mfa(session, user)


async def test_require_admin_mfa_with_2fa(session_factory, monkeypatch):
    monkeypatch.setattr(settings, "admin_mfa_required", True, raising=False)
    user = await _add_user(
        session_factory, role=UserRole.owner, two_factor_enabled=True
    )
    async with session_factory() as session:
        await deps._require_admin_mfa(session, user)


async def test_require_admin_mfa_with_passkey(session_factory, monkeypatch):
    monkeypatch.setattr(settings, "admin_mfa_required", True, raising=False)
    user = await _add_user(session_factory, role=UserRole.admin, with_passkey=True)
    async with session_factory() as session:
        await deps._require_admin_mfa(session, user)


async def test_require_admin_mfa_missing_raises(session_factory, monkeypatch):
    monkeypatch.setattr(settings, "admin_mfa_required", True, raising=False)
    user = await _add_user(session_factory, role=UserRole.admin)
    async with session_factory() as session:
        with pytest.raises(HTTPException) as exc:
            await deps._require_admin_mfa(session, user)
        assert exc.value.status_code == 403


# --------------------------------------------------------------------------- #
# _parse_ip_networks
# --------------------------------------------------------------------------- #


def test_parse_ip_networks():
    out = deps._parse_ip_networks(["10.0.0.0/8", "  ", "", "not-an-ip", "192.168.1.1"])
    assert len(out) == 2
    assert deps._parse_ip_networks(None) == []


# --------------------------------------------------------------------------- #
# _extract_admin_client_ip
# --------------------------------------------------------------------------- #


def test_extract_admin_client_ip_no_header(monkeypatch):
    monkeypatch.setattr(settings, "admin_ip_header", None, raising=False)
    req = FakeRequest(client_host="5.6.7.8")
    assert deps._extract_admin_client_ip(req) == "5.6.7.8"


def test_extract_admin_client_ip_no_header_no_client(monkeypatch):
    monkeypatch.setattr(settings, "admin_ip_header", "", raising=False)
    req = FakeRequest(client_host=None)
    assert deps._extract_admin_client_ip(req) is None


def test_extract_admin_client_ip_forwarded_for(monkeypatch):
    monkeypatch.setattr(settings, "admin_ip_header", "x-forwarded-for", raising=False)
    req = FakeRequest(headers={"x-forwarded-for": "9.9.9.9, 8.8.8.8"})
    assert deps._extract_admin_client_ip(req) == "9.9.9.9"


def test_extract_admin_client_ip_custom_header(monkeypatch):
    monkeypatch.setattr(settings, "admin_ip_header", "x-real-ip", raising=False)
    req = FakeRequest(headers={"x-real-ip": "7.7.7.7"})
    assert deps._extract_admin_client_ip(req) == "7.7.7.7"


def test_extract_admin_client_ip_header_empty_falls_back(monkeypatch):
    monkeypatch.setattr(settings, "admin_ip_header", "x-real-ip", raising=False)
    req = FakeRequest(headers={"x-real-ip": "   "}, client_host="2.2.2.2")
    assert deps._extract_admin_client_ip(req) == "2.2.2.2"


# --------------------------------------------------------------------------- #
# _admin_ip_bypass_active
# --------------------------------------------------------------------------- #


def _user_stub(uid=None):
    u = User(email="x@x.com", name="x", hashed_password="x")
    u.id = uid or uuid4()
    return u


def test_admin_ip_bypass_no_secret(monkeypatch):
    monkeypatch.setattr(settings, "admin_ip_bypass_token", None, raising=False)
    assert deps._admin_ip_bypass_active(FakeRequest(), _user_stub()) is False


def test_admin_ip_bypass_via_header(monkeypatch):
    monkeypatch.setattr(settings, "admin_ip_bypass_token", "topsecret", raising=False)
    req = FakeRequest(headers={deps._ADMIN_IP_BYPASS_HEADER: "topsecret"})
    assert deps._admin_ip_bypass_active(req, _user_stub()) is True


def test_admin_ip_bypass_no_cookie(monkeypatch):
    monkeypatch.setattr(settings, "admin_ip_bypass_token", "topsecret", raising=False)
    req = FakeRequest(headers={deps._ADMIN_IP_BYPASS_HEADER: "wrong"})
    assert deps._admin_ip_bypass_active(req, _user_stub()) is False


def test_admin_ip_bypass_invalid_cookie_token(monkeypatch):
    monkeypatch.setattr(settings, "admin_ip_bypass_token", "topsecret", raising=False)
    req = FakeRequest(cookies={deps._ADMIN_IP_BYPASS_COOKIE: "garbage"})
    assert deps._admin_ip_bypass_active(req, _user_stub()) is False


def test_admin_ip_bypass_wrong_type(monkeypatch):
    monkeypatch.setattr(settings, "admin_ip_bypass_token", "topsecret", raising=False)
    user = _user_stub()
    token = _make_token({"type": "other", "sub": str(user.id)})
    req = FakeRequest(cookies={deps._ADMIN_IP_BYPASS_COOKIE: token})
    assert deps._admin_ip_bypass_active(req, user) is False


def test_admin_ip_bypass_valid_cookie(monkeypatch):
    monkeypatch.setattr(settings, "admin_ip_bypass_token", "topsecret", raising=False)
    user = _user_stub()
    token = _make_token({"type": "admin_ip_bypass", "sub": str(user.id)})
    req = FakeRequest(cookies={deps._ADMIN_IP_BYPASS_COOKIE: token})
    assert deps._admin_ip_bypass_active(req, user) is True


def test_admin_ip_bypass_sub_mismatch(monkeypatch):
    monkeypatch.setattr(settings, "admin_ip_bypass_token", "topsecret", raising=False)
    user = _user_stub()
    token = _make_token({"type": "admin_ip_bypass", "sub": str(uuid4())})
    req = FakeRequest(cookies={deps._ADMIN_IP_BYPASS_COOKIE: token})
    assert deps._admin_ip_bypass_active(req, user) is False


# --------------------------------------------------------------------------- #
# _require_admin_ip_access
# --------------------------------------------------------------------------- #


def test_require_admin_ip_no_lists(monkeypatch):
    monkeypatch.setattr(settings, "admin_ip_allowlist", [], raising=False)
    monkeypatch.setattr(settings, "admin_ip_denylist", [], raising=False)
    deps._require_admin_ip_access(FakeRequest(), _user_stub())  # no raise


def test_require_admin_ip_bypass(monkeypatch):
    monkeypatch.setattr(settings, "admin_ip_allowlist", ["10.0.0.0/8"], raising=False)
    monkeypatch.setattr(settings, "admin_ip_denylist", [], raising=False)
    monkeypatch.setattr(settings, "admin_ip_bypass_token", "s", raising=False)
    monkeypatch.setattr(settings, "admin_ip_header", None, raising=False)
    req = FakeRequest(headers={deps._ADMIN_IP_BYPASS_HEADER: "s"})
    deps._require_admin_ip_access(req, _user_stub())


def test_require_admin_ip_no_ip(monkeypatch):
    monkeypatch.setattr(settings, "admin_ip_allowlist", ["10.0.0.0/8"], raising=False)
    monkeypatch.setattr(settings, "admin_ip_denylist", [], raising=False)
    monkeypatch.setattr(settings, "admin_ip_bypass_token", None, raising=False)
    monkeypatch.setattr(settings, "admin_ip_header", None, raising=False)
    req = FakeRequest(client_host=None)
    with pytest.raises(HTTPException) as exc:
        deps._require_admin_ip_access(req, _user_stub())
    assert exc.value.status_code == 403


def test_require_admin_ip_invalid_ip(monkeypatch):
    monkeypatch.setattr(settings, "admin_ip_allowlist", ["10.0.0.0/8"], raising=False)
    monkeypatch.setattr(settings, "admin_ip_denylist", [], raising=False)
    monkeypatch.setattr(settings, "admin_ip_bypass_token", None, raising=False)
    monkeypatch.setattr(settings, "admin_ip_header", "x-real-ip", raising=False)
    req = FakeRequest(headers={"x-real-ip": "not-an-ip"})
    with pytest.raises(HTTPException) as exc:
        deps._require_admin_ip_access(req, _user_stub())
    assert exc.value.status_code == 403


def test_require_admin_ip_denied(monkeypatch):
    monkeypatch.setattr(settings, "admin_ip_allowlist", [], raising=False)
    monkeypatch.setattr(settings, "admin_ip_denylist", ["10.0.0.0/8"], raising=False)
    monkeypatch.setattr(settings, "admin_ip_bypass_token", None, raising=False)
    monkeypatch.setattr(settings, "admin_ip_header", "x-real-ip", raising=False)
    req = FakeRequest(headers={"x-real-ip": "10.0.0.5"})
    with pytest.raises(HTTPException) as exc:
        deps._require_admin_ip_access(req, _user_stub())
    assert exc.value.detail == deps._ADMIN_IP_DENIED_DETAIL


def test_require_admin_ip_not_in_allowlist(monkeypatch):
    monkeypatch.setattr(settings, "admin_ip_allowlist", ["10.0.0.0/8"], raising=False)
    monkeypatch.setattr(settings, "admin_ip_denylist", [], raising=False)
    monkeypatch.setattr(settings, "admin_ip_bypass_token", None, raising=False)
    monkeypatch.setattr(settings, "admin_ip_header", "x-real-ip", raising=False)
    req = FakeRequest(headers={"x-real-ip": "192.168.1.1"})
    with pytest.raises(HTTPException) as exc:
        deps._require_admin_ip_access(req, _user_stub())
    assert exc.value.detail == deps._ADMIN_IP_ALLOWLIST_DETAIL


def test_require_admin_ip_allowed(monkeypatch):
    monkeypatch.setattr(settings, "admin_ip_allowlist", ["10.0.0.0/8"], raising=False)
    monkeypatch.setattr(settings, "admin_ip_denylist", ["172.16.0.0/12"], raising=False)
    monkeypatch.setattr(settings, "admin_ip_bypass_token", None, raising=False)
    monkeypatch.setattr(settings, "admin_ip_header", "x-real-ip", raising=False)
    req = FakeRequest(headers={"x-real-ip": "10.0.0.5"})
    deps._require_admin_ip_access(req, _user_stub())  # allowed, no raise


# --------------------------------------------------------------------------- #
# _require_training_mode_writes_allowed
# --------------------------------------------------------------------------- #


def test_training_mode_not_enabled():
    user = _user_stub()
    user.admin_training_mode = False
    deps._require_training_mode_writes_allowed(FakeRequest(method="POST"), user)


def test_training_mode_safe_method():
    user = _user_stub()
    user.admin_training_mode = True
    deps._require_training_mode_writes_allowed(FakeRequest(method="get"), user)


def test_training_mode_write_blocked():
    user = _user_stub()
    user.admin_training_mode = True
    with pytest.raises(HTTPException) as exc:
        deps._require_training_mode_writes_allowed(FakeRequest(method="POST"), user)
    assert exc.value.detail == deps._TRAINING_MODE_DETAIL


# --------------------------------------------------------------------------- #
# get_current_user
# --------------------------------------------------------------------------- #


async def test_get_current_user_no_credentials(session_factory):
    async with session_factory() as session:
        with pytest.raises(HTTPException) as exc:
            await deps.get_current_user(FakeRequest(), None, session)
        assert exc.value.status_code == 401
        assert exc.value.detail == "Not authenticated"


async def test_get_current_user_invalid_token(session_factory):
    async with session_factory() as session:
        with pytest.raises(HTTPException) as exc:
            await deps.get_current_user(FakeRequest(), _creds("nope"), session)
        assert exc.value.detail == "Invalid token"


async def test_get_current_user_wrong_type(session_factory):
    token = _make_token({"type": "refresh", "sub": str(uuid4())})
    async with session_factory() as session:
        with pytest.raises(HTTPException) as exc:
            await deps.get_current_user(FakeRequest(), _creds(token), session)
        assert exc.value.detail == "Invalid token"


async def test_get_current_user_bad_sub(session_factory):
    token = _make_token({"type": "access", "sub": "not-a-uuid"})
    async with session_factory() as session:
        with pytest.raises(HTTPException) as exc:
            await deps.get_current_user(FakeRequest(), _creds(token), session)
        assert exc.value.detail == "Invalid token payload"


async def test_get_current_user_impersonator_bad(session_factory):
    token = _make_token(
        {"type": "access", "sub": str(uuid4()), "impersonator": "bad-uuid"}
    )
    async with session_factory() as session:
        with pytest.raises(HTTPException) as exc:
            await deps.get_current_user(FakeRequest(), _creds(token), session)
        assert exc.value.detail == "Invalid token payload"


async def test_get_current_user_impersonator_write_blocked(session_factory):
    token = _make_token(
        {"type": "access", "sub": str(uuid4()), "impersonator": str(uuid4())}
    )
    async with session_factory() as session:
        with pytest.raises(HTTPException) as exc:
            await deps.get_current_user(
                FakeRequest(method="POST"), _creds(token), session
            )
        assert exc.value.status_code == 403


async def test_get_current_user_not_found(session_factory):
    token = _make_token({"type": "access", "sub": str(uuid4())})
    async with session_factory() as session:
        with pytest.raises(HTTPException) as exc:
            await deps.get_current_user(FakeRequest(), _creds(token), session)
        assert exc.value.detail == "User not found"


async def test_get_current_user_success_with_impersonator(session_factory):
    user = await _add_user(session_factory)
    imp_id = uuid4()
    token = _make_token(
        {"type": "access", "sub": str(user.id), "impersonator": str(imp_id)}
    )
    req = FakeRequest(method="GET")
    async with session_factory() as session:
        out = await deps.get_current_user(req, _creds(token), session)
        assert out.id == user.id
        assert req.state.impersonator_user_id == imp_id


async def test_get_current_user_deletion_due(session_factory):
    past = datetime.now(timezone.utc) - timedelta(days=1)
    user = await _add_user(session_factory, deletion_scheduled_for=past)
    token = _make_token({"type": "access", "sub": str(user.id)})
    async with session_factory() as session:
        with pytest.raises(HTTPException) as exc:
            await deps.get_current_user(FakeRequest(), _creds(token), session)
        assert exc.value.detail == "Account deleted"


async def test_get_current_user_deleted_at(session_factory):
    user = await _add_user(session_factory, deleted_at=datetime.now(timezone.utc))
    token = _make_token({"type": "access", "sub": str(user.id)})
    async with session_factory() as session:
        with pytest.raises(HTTPException) as exc:
            await deps.get_current_user(FakeRequest(), _creds(token), session)
        assert exc.value.detail == "Account deleted"


# --------------------------------------------------------------------------- #
# get_current_user_optional
# --------------------------------------------------------------------------- #


async def test_get_current_user_optional_paths(session_factory):
    async with session_factory() as session:
        assert (
            await deps.get_current_user_optional(FakeRequest(), None, session) is None
        )
        assert (
            await deps.get_current_user_optional(FakeRequest(), _creds("bad"), session)
            is None
        )
        wrong = _make_token({"type": "refresh", "sub": str(uuid4())})
        assert (
            await deps.get_current_user_optional(FakeRequest(), _creds(wrong), session)
            is None
        )
        bad_sub = _make_token({"type": "access", "sub": "x"})
        assert (
            await deps.get_current_user_optional(
                FakeRequest(), _creds(bad_sub), session
            )
            is None
        )
        missing = _make_token({"type": "access", "sub": str(uuid4())})
        assert (
            await deps.get_current_user_optional(
                FakeRequest(), _creds(missing), session
            )
            is None
        )


async def test_get_current_user_optional_impersonator_bad(session_factory):
    token = _make_token({"type": "access", "sub": str(uuid4()), "impersonator": "bad"})
    async with session_factory() as session:
        assert (
            await deps.get_current_user_optional(FakeRequest(), _creds(token), session)
            is None
        )


async def test_get_current_user_optional_impersonator_write_blocked(session_factory):
    token = _make_token(
        {"type": "access", "sub": str(uuid4()), "impersonator": str(uuid4())}
    )
    async with session_factory() as session:
        with pytest.raises(HTTPException) as exc:
            await deps.get_current_user_optional(
                FakeRequest(method="DELETE"), _creds(token), session
            )
        assert exc.value.status_code == 403


async def test_get_current_user_optional_success_impersonator(session_factory):
    user = await _add_user(session_factory)
    imp_id = uuid4()
    token = _make_token(
        {"type": "access", "sub": str(user.id), "impersonator": str(imp_id)}
    )
    req = FakeRequest(method="GET")
    async with session_factory() as session:
        out = await deps.get_current_user_optional(req, _creds(token), session)
        assert out is not None and out.id == user.id
        assert req.state.impersonator_user_id == imp_id


async def test_get_current_user_optional_deletion_due(session_factory):
    past = datetime.now(timezone.utc) - timedelta(days=1)
    user = await _add_user(session_factory, deletion_scheduled_for=past)
    token = _make_token({"type": "access", "sub": str(user.id)})
    async with session_factory() as session:
        assert (
            await deps.get_current_user_optional(FakeRequest(), _creds(token), session)
            is None
        )


async def test_get_current_user_optional_deleted_at(session_factory):
    user = await _add_user(session_factory, deleted_at=datetime.now(timezone.utc))
    token = _make_token({"type": "access", "sub": str(user.id)})
    async with session_factory() as session:
        assert (
            await deps.get_current_user_optional(FakeRequest(), _creds(token), session)
            is None
        )


# --------------------------------------------------------------------------- #
# get_google_completion_user
# --------------------------------------------------------------------------- #


async def test_google_completion_no_credentials(session_factory):
    async with session_factory() as session:
        with pytest.raises(HTTPException) as exc:
            await deps.get_google_completion_user(None, session)
        assert exc.value.detail == "Not authenticated"


async def test_google_completion_wrong_type(session_factory):
    token = _make_token({"type": "access", "sub": str(uuid4())})
    async with session_factory() as session:
        with pytest.raises(HTTPException) as exc:
            await deps.get_google_completion_user(_creds(token), session)
        assert exc.value.detail == "Invalid token"


async def test_google_completion_bad_sub(session_factory):
    token = _make_token({"type": "google_completion", "sub": "bad"})
    async with session_factory() as session:
        with pytest.raises(HTTPException) as exc:
            await deps.get_google_completion_user(_creds(token), session)
        assert exc.value.detail == "Invalid token payload"


async def test_google_completion_not_found(session_factory):
    token = _make_token({"type": "google_completion", "sub": str(uuid4())})
    async with session_factory() as session:
        with pytest.raises(HTTPException) as exc:
            await deps.get_google_completion_user(_creds(token), session)
        assert exc.value.detail == "User not found"


async def test_google_completion_deletion_due(session_factory):
    past = datetime.now(timezone.utc) - timedelta(days=1)
    user = await _add_user(session_factory, deletion_scheduled_for=past)
    token = _make_token({"type": "google_completion", "sub": str(user.id)})
    async with session_factory() as session:
        with pytest.raises(HTTPException) as exc:
            await deps.get_google_completion_user(_creds(token), session)
        assert exc.value.detail == "Account deleted"


async def test_google_completion_deleted_at(session_factory):
    user = await _add_user(session_factory, deleted_at=datetime.now(timezone.utc))
    token = _make_token({"type": "google_completion", "sub": str(user.id)})
    async with session_factory() as session:
        with pytest.raises(HTTPException) as exc:
            await deps.get_google_completion_user(_creds(token), session)
        assert exc.value.detail == "Account deleted"


async def test_google_completion_no_google_sub(session_factory):
    user = await _add_user(session_factory, google_sub=None)
    token = _make_token({"type": "google_completion", "sub": str(user.id)})
    async with session_factory() as session:
        with pytest.raises(HTTPException) as exc:
            await deps.get_google_completion_user(_creds(token), session)
        assert exc.value.detail == "Google account required"


async def test_google_completion_profile_complete(session_factory, monkeypatch):
    user = await _add_user(session_factory, google_sub="g-123")
    monkeypatch.setattr(deps.auth_service, "is_profile_complete", lambda u: True)
    token = _make_token({"type": "google_completion", "sub": str(user.id)})
    async with session_factory() as session:
        with pytest.raises(HTTPException) as exc:
            await deps.get_google_completion_user(_creds(token), session)
        assert exc.value.detail == "Profile already complete"


async def test_google_completion_success(session_factory, monkeypatch):
    user = await _add_user(session_factory, google_sub="g-123")
    monkeypatch.setattr(deps.auth_service, "is_profile_complete", lambda u: False)
    token = _make_token({"type": "google_completion", "sub": str(user.id)})
    async with session_factory() as session:
        out = await deps.get_google_completion_user(_creds(token), session)
        assert out.id == user.id


# --------------------------------------------------------------------------- #
# require_admin / require_staff / require_owner / require_admin_section
# --------------------------------------------------------------------------- #


async def test_require_admin_not_admin(session_factory):
    user = _user_stub()
    user.role = UserRole.customer
    async with session_factory() as session:
        with pytest.raises(HTTPException) as exc:
            await deps.require_admin(FakeRequest(), session, user)
        assert exc.value.detail == "Admin access required"


async def test_require_admin_success(session_factory, monkeypatch):
    monkeypatch.setattr(settings, "admin_mfa_required", False, raising=False)
    user = _user_stub()
    user.role = UserRole.admin
    user.admin_training_mode = False
    async with session_factory() as session:
        out = await deps.require_admin(FakeRequest(), session, user)
        assert out is user


async def test_require_staff_denied():
    user = _user_stub()
    user.role = UserRole.customer
    with pytest.raises(HTTPException) as exc:
        await deps.require_staff(user)
    assert exc.value.detail == "Staff access required"


async def test_require_staff_allowed():
    user = _user_stub()
    user.role = UserRole.support
    out = await deps.require_staff(user)
    assert out is user


async def test_require_owner_denied(session_factory):
    user = _user_stub()
    user.role = UserRole.admin
    async with session_factory() as session:
        with pytest.raises(HTTPException) as exc:
            await deps.require_owner(FakeRequest(), session, user)
        assert exc.value.detail == "Owner access required"


async def test_require_owner_success(session_factory, monkeypatch):
    monkeypatch.setattr(settings, "admin_mfa_required", False, raising=False)
    user = _user_stub()
    user.role = UserRole.owner
    user.admin_training_mode = False
    async with session_factory() as session:
        out = await deps.require_owner(FakeRequest(), session, user)
        assert out is user


async def test_require_admin_section_denied(session_factory):
    dep = deps.require_admin_section("content")
    user = _user_stub()
    user.role = UserRole.support  # not in content roles
    async with session_factory() as session:
        with pytest.raises(HTTPException) as exc:
            await dep(FakeRequest(), session, user)
        assert exc.value.detail == "Insufficient role for this section"


async def test_require_admin_section_unknown_section(session_factory):
    dep = deps.require_admin_section("  ")  # empty -> empty allowed set
    user = _user_stub()
    user.role = UserRole.owner
    async with session_factory() as session:
        with pytest.raises(HTTPException):
            await dep(FakeRequest(), session, user)


async def test_require_admin_section_success(session_factory, monkeypatch):
    monkeypatch.setattr(settings, "admin_mfa_required", False, raising=False)
    monkeypatch.setattr(settings, "admin_ip_allowlist", [], raising=False)
    monkeypatch.setattr(settings, "admin_ip_denylist", [], raising=False)
    dep = deps.require_admin_section("content")
    user = _user_stub()
    user.role = UserRole.content
    user.admin_training_mode = False
    async with session_factory() as session:
        out = await dep(FakeRequest(), session, user)
        assert out is user


# --------------------------------------------------------------------------- #
# require_complete_profile / require_verified_email
# --------------------------------------------------------------------------- #


async def test_require_complete_profile_incomplete(monkeypatch):
    user = _user_stub()
    user.google_sub = "g-1"
    monkeypatch.setattr(deps.auth_service, "is_profile_complete", lambda u: False)
    with pytest.raises(HTTPException) as exc:
        await deps.require_complete_profile(user)
    assert exc.value.detail == "Profile incomplete"


async def test_require_complete_profile_ok_no_google():
    user = _user_stub()
    user.google_sub = None
    out = await deps.require_complete_profile(user)
    assert out is user


async def test_require_complete_profile_ok_complete(monkeypatch):
    user = _user_stub()
    user.google_sub = "g-1"
    monkeypatch.setattr(deps.auth_service, "is_profile_complete", lambda u: True)
    out = await deps.require_complete_profile(user)
    assert out is user


async def test_require_verified_email_unverified():
    user = _user_stub()
    user.email_verified = False
    with pytest.raises(HTTPException) as exc:
        await deps.require_verified_email(user)
    assert exc.value.detail == "Email verification required"


async def test_require_verified_email_ok():
    user = _user_stub()
    user.email_verified = True
    out = await deps.require_verified_email(user)
    assert out is user
