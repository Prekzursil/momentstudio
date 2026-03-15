from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace
import uuid

from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
import pytest
from starlette.requests import Request

from app.core import dependencies
from app.models.user import UserRole


class _Scalars:
    def __init__(self, rows: list[object]) -> None:
        self._rows = rows

    def all(self) -> list[object]:
        return list(self._rows)

    def first(self) -> object | None:
        return self._rows[0] if self._rows else None


class _Result:
    def __init__(self, *, scalar: object | None = None, scalars: list[object] | None = None) -> None:
        self._scalar = scalar
        self._scalars = scalars or []

    def scalar_one(self) -> object | None:
        return self._scalar

    def scalar_one_or_none(self) -> object | None:
        return self._scalar

    def scalars(self) -> _Scalars:
        return _Scalars(self._scalars)


class _QueuedSession:
    def __init__(self, *results: _Result) -> None:
        self._results = list(results)

    async def execute(self, _stmt: object) -> _Result:
        await asyncio.sleep(0)
        if not self._results:
            raise AssertionError("Unexpected execute() call without queued result")
        return self._results.pop(0)


def _request(
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    cookies: dict[str, str] | None = None,
    client_host: str | None = "127.0.0.1",
) -> Request:
    raw_headers: list[tuple[bytes, bytes]] = []
    for key, value in (headers or {}).items():
        raw_headers.append((key.lower().encode("latin-1"), value.encode("latin-1")))
    if cookies:
        cookie_header = "; ".join(f"{k}={v}" for k, v in cookies.items())
        raw_headers.append((b"cookie", cookie_header.encode("latin-1")))

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": method,
        "scheme": "http",
        "path": "/",
        "query_string": b"",
        "headers": raw_headers,
        "client": (client_host, 12345) if client_host else None,
        "server": ("testserver", 80),
    }
    return Request(scope)


def _credentials(token: str = "token") -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


def _ipv4(a: int, b: int, c: int, d: int) -> str:
    return ".".join(str(part) for part in (a, b, c, d))


def _cidr(a: int, b: int, c: int, d: int, prefix: int) -> str:
    return f"{_ipv4(a, b, c, d)}/{prefix}"


def test_parse_ip_networks_skips_blank_and_invalid_values() -> None:
    networks = dependencies._parse_ip_networks(["", "  ", _cidr(10, 0, 0, 0, 8), "bad-network", "2001:db8::/32"])
    assert len(networks) == 2
    assert str(networks[0]) == _cidr(10, 0, 0, 0, 8)
    assert str(networks[1]) == "2001:db8::/32"


def test_extract_admin_client_ip_prefers_header_and_forwarded_for(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(dependencies.settings, "admin_ip_header", "x-forwarded-for", raising=False)
    req = _request(headers={"x-forwarded-for": "203.0.113.10, 192.0.2.1"})
    assert dependencies._extract_admin_client_ip(req) == "203.0.113.10"

    monkeypatch.setattr(dependencies.settings, "admin_ip_header", "x-real-ip", raising=False)
    req2 = _request(headers={"x-real-ip": "198.51.100.77"})
    assert dependencies._extract_admin_client_ip(req2) == "198.51.100.77"

    monkeypatch.setattr(dependencies.settings, "admin_ip_header", "", raising=False)
    client_host = _ipv4(198, 18, 0, 5)
    req3 = _request(client_host=client_host)
    assert dependencies._extract_admin_client_ip(req3) == client_host


def test_admin_ip_bypass_active_uses_header_or_signed_cookie(monkeypatch: pytest.MonkeyPatch) -> None:
    user = SimpleNamespace(id=uuid.uuid4())
    monkeypatch.setattr(dependencies.settings, "admin_ip_bypass_token", "bypass-secret", raising=False)

    request_with_header = _request(headers={"x-admin-ip-bypass": "bypass-secret"})
    assert dependencies._admin_ip_bypass_active(request_with_header, user) is True

    request_cookie = _request(cookies={"admin_ip_bypass": "jwt-cookie"})
    monkeypatch.setattr(
        dependencies,
        "decode_token",
        lambda token: {"type": "admin_ip_bypass", "sub": str(user.id)} if token == "jwt-cookie" else None,
    )
    assert dependencies._admin_ip_bypass_active(request_cookie, user) is True

    monkeypatch.setattr(dependencies, "decode_token", lambda _token: {"type": "admin_ip_bypass", "sub": str(uuid.uuid4())})
    assert dependencies._admin_ip_bypass_active(request_cookie, user) is False

    monkeypatch.setattr(dependencies, "decode_token", lambda _token: {"type": "access", "sub": str(user.id)})
    assert dependencies._admin_ip_bypass_active(request_cookie, user) is False


def test_require_admin_ip_access_enforces_allow_and_deny_lists(monkeypatch: pytest.MonkeyPatch) -> None:
    user = SimpleNamespace(id=uuid.uuid4())
    monkeypatch.setattr(dependencies.settings, "admin_ip_bypass_token", "", raising=False)
    monkeypatch.setattr(dependencies.settings, "admin_ip_header", "x-real-ip", raising=False)
    monkeypatch.setattr(dependencies.settings, "admin_ip_allowlist", [_cidr(10, 0, 0, 0, 8)], raising=False)
    monkeypatch.setattr(dependencies.settings, "admin_ip_denylist", [_cidr(10, 1, 2, 3, 32)], raising=False)

    with pytest.raises(HTTPException) as denied:
        dependencies._require_admin_ip_access(_request(headers={"x-real-ip": _ipv4(10, 1, 2, 3)}), user)
    assert denied.value.headers == {"X-Error-Code": "admin_ip_denied"}

    with pytest.raises(HTTPException) as allowlist:
        dependencies._require_admin_ip_access(_request(headers={"x-real-ip": _ipv4(192, 168, 1, 20)}), user)
    assert allowlist.value.headers == {"X-Error-Code": "admin_ip_allowlist"}

    dependencies._require_admin_ip_access(_request(headers={"x-real-ip": _ipv4(10, 9, 8, 7)}), user)

    with pytest.raises(HTTPException) as invalid_ip:
        dependencies._require_admin_ip_access(_request(headers={"x-real-ip": "not-an-ip"}), user)
    assert invalid_ip.value.headers == {"X-Error-Code": "admin_ip_denied"}

    with pytest.raises(HTTPException) as missing_ip:
        dependencies._require_admin_ip_access(_request(client_host=None), user)
    assert missing_ip.value.headers == {"X-Error-Code": "admin_ip_denied"}


def test_training_mode_write_guard_allows_safe_methods_only() -> None:
    user = SimpleNamespace(admin_training_mode=True)
    dependencies._require_training_mode_writes_allowed(_request(method="GET"), user)

    with pytest.raises(HTTPException) as exc:
        dependencies._require_training_mode_writes_allowed(_request(method="PATCH"), user)
    assert exc.value.headers == {"X-Error-Code": "training_readonly"}


@pytest.mark.anyio
async def test_require_admin_mfa_respects_role_setting_2fa_and_passkey(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _QueuedSession(_Result(scalar=None))

    await dependencies._require_admin_mfa(session, SimpleNamespace(role=UserRole.content, two_factor_enabled=False))

    monkeypatch.setattr(dependencies.settings, "admin_mfa_required", False, raising=False)
    await dependencies._require_admin_mfa(session, SimpleNamespace(role=UserRole.admin, two_factor_enabled=False))

    monkeypatch.setattr(dependencies.settings, "admin_mfa_required", True, raising=False)
    await dependencies._require_admin_mfa(session, SimpleNamespace(role=UserRole.admin, two_factor_enabled=True))

    async def _has_passkey(_session: object, _user_id: uuid.UUID) -> bool:
        await asyncio.sleep(0)
        return True

    monkeypatch.setattr(dependencies, "_has_passkey", _has_passkey)
    await dependencies._require_admin_mfa(
        session,
        SimpleNamespace(role=UserRole.owner, two_factor_enabled=False, id=uuid.uuid4()),
    )

    async def _no_passkey(_session: object, _user_id: uuid.UUID) -> bool:
        await asyncio.sleep(0)
        return False

    monkeypatch.setattr(dependencies, "_has_passkey", _no_passkey)
    with pytest.raises(HTTPException) as exc:
        await dependencies._require_admin_mfa(
            session,
            SimpleNamespace(role=UserRole.admin, two_factor_enabled=False, id=uuid.uuid4()),
        )
    assert exc.value.headers == {"X-Error-Code": "admin_mfa_required"}


@pytest.mark.anyio
async def test_get_current_user_happy_path_with_impersonation(monkeypatch: pytest.MonkeyPatch) -> None:
    user_id = uuid.uuid4()
    impersonator_id = uuid.uuid4()
    user = SimpleNamespace(id=user_id, deletion_scheduled_for=None, deleted_at=None)
    session = _QueuedSession(_Result(scalar=user))

    monkeypatch.setattr(
        dependencies,
        "decode_token",
        lambda _token: {"type": "access", "sub": str(user_id), "impersonator": str(impersonator_id)},
    )
    monkeypatch.setattr(dependencies.self_service, "is_deletion_due", lambda _user: False)

    req = _request(method="GET")
    resolved = await dependencies.get_current_user(req, credentials=_credentials(), session=session)
    assert resolved is user
    assert req.state.impersonator_user_id == impersonator_id


@pytest.mark.anyio
async def test_get_current_user_error_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _QueuedSession(_Result(scalar=None))
    req = _request(method="GET")

    with pytest.raises(HTTPException, match="Not authenticated"):
        await dependencies.get_current_user(req, credentials=None, session=session)

    monkeypatch.setattr(dependencies, "decode_token", lambda _token: None)
    with pytest.raises(HTTPException, match="Invalid token"):
        await dependencies.get_current_user(req, credentials=_credentials(), session=session)

    monkeypatch.setattr(dependencies, "decode_token", lambda _token: {"type": "access", "sub": "bad-uuid"})
    with pytest.raises(HTTPException, match="Invalid token payload"):
        await dependencies.get_current_user(req, credentials=_credentials(), session=session)

    monkeypatch.setattr(
        dependencies,
        "decode_token",
        lambda _token: {"type": "access", "sub": str(uuid.uuid4()), "impersonator": str(uuid.uuid4())},
    )
    with pytest.raises(HTTPException, match="Impersonation is read-only"):
        await dependencies.get_current_user(_request(method="POST"), credentials=_credentials(), session=session)

    monkeypatch.setattr(
        dependencies,
        "decode_token",
        lambda _token: {"type": "access", "sub": str(uuid.uuid4())},
    )
    with pytest.raises(HTTPException, match="User not found"):
        await dependencies.get_current_user(req, credentials=_credentials(), session=_QueuedSession(_Result(scalar=None)))


@pytest.mark.anyio
async def test_get_current_user_deletion_due_executes_cleanup(monkeypatch: pytest.MonkeyPatch) -> None:
    user_id = uuid.uuid4()
    user = SimpleNamespace(
        id=user_id,
        deletion_scheduled_for=datetime.now(timezone.utc),
        deleted_at=None,
    )
    session = _QueuedSession(_Result(scalar=user))
    deleted: list[tuple[object, object]] = []

    monkeypatch.setattr(dependencies, "decode_token", lambda _token: {"type": "access", "sub": str(user_id)})
    monkeypatch.setattr(dependencies.self_service, "is_deletion_due", lambda _user: True)

    async def _delete(_session: object, _user: object) -> None:
        await asyncio.sleep(0)
        deleted.append((_session, _user))

    monkeypatch.setattr(dependencies.self_service, "execute_account_deletion", _delete)

    with pytest.raises(HTTPException, match="Account deleted"):
        await dependencies.get_current_user(_request(), credentials=_credentials(), session=session)
    assert deleted and deleted[0][1] is user


@pytest.mark.anyio
async def test_optional_and_google_completion_user_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    user_id = uuid.uuid4()
    google_user = SimpleNamespace(
        id=user_id,
        deletion_scheduled_for=None,
        deleted_at=None,
        google_sub="google-sub",
    )
    req = _request(method="GET")

    assert await dependencies.get_current_user_optional(req, credentials=None, session=_QueuedSession()) is None

    monkeypatch.setattr(dependencies, "decode_token", lambda _token: {"type": "access", "sub": str(user_id)})
    result = await dependencies.get_current_user_optional(
        req,
        credentials=_credentials(),
        session=_QueuedSession(_Result(scalar=google_user)),
    )
    assert result is google_user

    monkeypatch.setattr(
        dependencies,
        "decode_token",
        lambda _token: {"type": "access", "sub": str(user_id), "impersonator": str(uuid.uuid4())},
    )
    with pytest.raises(HTTPException, match="Impersonation is read-only"):
        await dependencies.get_current_user_optional(
            _request(method="PUT"),
            credentials=_credentials(),
            session=_QueuedSession(_Result(scalar=google_user)),
        )

    monkeypatch.setattr(dependencies, "decode_token", lambda _token: {"type": "google_completion", "sub": str(user_id)})
    monkeypatch.setattr(dependencies.self_service, "is_deletion_due", lambda _user: False)
    monkeypatch.setattr(dependencies.auth_service, "is_profile_complete", lambda _user: False)
    assert (
        await dependencies.get_google_completion_user(
            credentials=_credentials(),
            session=_QueuedSession(_Result(scalar=google_user)),
        )
        is google_user
    )

    monkeypatch.setattr(dependencies.auth_service, "is_profile_complete", lambda _user: True)
    with pytest.raises(HTTPException, match="Profile already complete"):
        await dependencies.get_google_completion_user(
            credentials=_credentials(),
            session=_QueuedSession(_Result(scalar=google_user)),
        )

    no_google_user = SimpleNamespace(
        id=user_id,
        deletion_scheduled_for=None,
        deleted_at=None,
        google_sub=None,
    )
    monkeypatch.setattr(dependencies.auth_service, "is_profile_complete", lambda _user: False)
    with pytest.raises(HTTPException, match="Google account required"):
        await dependencies.get_google_completion_user(
            credentials=_credentials(),
            session=_QueuedSession(_Result(scalar=no_google_user)),
        )


@pytest.mark.anyio
async def test_role_and_profile_dependencies(monkeypatch: pytest.MonkeyPatch) -> None:
    req = _request(method="GET")
    session = _QueuedSession()

    dep = dependencies.require_admin_section("coupons")
    with pytest.raises(HTTPException, match="Insufficient role"):
        await dep(request=req, session=session, user=SimpleNamespace(role=UserRole.support))

    called = {"mfa": 0, "ip": 0, "training": 0}

    async def _mfa(_session: object, _user: object) -> None:
        await asyncio.sleep(0)
        called["mfa"] += 1

    def _ip(_request: Request, _user: object) -> None:
        called["ip"] += 1

    def _training(_request: Request, _user: object) -> None:
        called["training"] += 1

    monkeypatch.setattr(dependencies, "_require_admin_mfa", _mfa)
    monkeypatch.setattr(dependencies, "_require_admin_ip_access", _ip)
    monkeypatch.setattr(dependencies, "_require_training_mode_writes_allowed", _training)

    allowed = SimpleNamespace(role=UserRole.content)
    assert await dep(request=req, session=session, user=allowed) is allowed
    assert called == {"mfa": 1, "ip": 1, "training": 1}

    with pytest.raises(HTTPException, match="Admin access required"):
        await dependencies.require_admin(req, session=session, user=SimpleNamespace(role=UserRole.customer))

    admin = SimpleNamespace(role=UserRole.admin)
    assert await dependencies.require_admin(req, session=session, user=admin) is admin

    with pytest.raises(HTTPException, match="Owner access required"):
        await dependencies.require_owner(req, session=session, user=SimpleNamespace(role=UserRole.admin))

    owner = SimpleNamespace(role=UserRole.owner)
    assert await dependencies.require_owner(req, session=session, user=owner) is owner

    with pytest.raises(HTTPException, match="Staff access required"):
        await dependencies.require_staff(user=SimpleNamespace(role=UserRole.customer))
    assert await dependencies.require_staff(user=SimpleNamespace(role=UserRole.support)) is not None

    monkeypatch.setattr(dependencies.auth_service, "is_profile_complete", lambda _user: False)
    with pytest.raises(HTTPException, match="Profile incomplete"):
        await dependencies.require_complete_profile(user=SimpleNamespace(google_sub="sub"))

    complete = SimpleNamespace(google_sub="sub")
    monkeypatch.setattr(dependencies.auth_service, "is_profile_complete", lambda _user: True)
    assert await dependencies.require_complete_profile(user=complete) is complete

    with pytest.raises(HTTPException, match="Email verification required"):
        await dependencies.require_verified_email(user=SimpleNamespace(email_verified=False))
    verified = SimpleNamespace(email_verified=True)
    assert await dependencies.require_verified_email(user=verified) is verified
