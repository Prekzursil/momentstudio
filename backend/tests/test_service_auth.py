from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

from fastapi import HTTPException
import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.schemas.user import UserCreate
from app.services import auth as auth_service


class _ExecuteResult:
    def __init__(
        self,
        *,
        first: object | None = None,
        scalar_one_or_none: object | None = None,
        scalars_all: list[object] | None = None,
    ) -> None:
        self._first = first
        self._scalar_one_or_none = scalar_one_or_none
        self._scalars_all = list(scalars_all or [])

    def scalars(self) -> "_ExecuteResult":
        return self

    def first(self) -> object | None:
        return self._first

    def all(self) -> list[object]:
        return list(self._scalars_all)

    def scalar_one_or_none(self) -> object | None:
        return self._scalar_one_or_none


class _SessionStub:
    def __init__(
        self,
        *,
        scalar_values: list[object | None] | None = None,
        get_values: list[object | None] | None = None,
        execute_results: list[_ExecuteResult] | None = None,
    ) -> None:
        self._scalar_values = list(scalar_values or [])
        self._get_values = list(get_values or [])
        self._execute_results = list(execute_results or [])
        self.added: list[object] = []
        self.deleted: list[object] = []
        self.commits = 0
        self.flushed = 0
        self.refreshed: list[object] = []

    async def scalar(self, _statement: object) -> object | None:
        await asyncio.sleep(0)
        return self._scalar_values.pop(0) if self._scalar_values else None

    async def get(self, _model: object, _id: object) -> object | None:
        await asyncio.sleep(0)
        return self._get_values.pop(0) if self._get_values else None

    async def execute(self, _statement: object) -> _ExecuteResult:
        await asyncio.sleep(0)
        if self._execute_results:
            return self._execute_results.pop(0)
        return _ExecuteResult()

    def add(self, value: object) -> None:
        self.added.append(value)

    def add_all(self, values: list[object]) -> None:
        self.added.extend(list(values))

    async def delete(self, value: object) -> None:
        await asyncio.sleep(0)
        self.deleted.append(value)

    async def flush(self) -> None:
        await asyncio.sleep(0)
        self.flushed += 1

    async def commit(self) -> None:
        await asyncio.sleep(0)
        self.commits += 1

    async def refresh(self, value: object) -> None:
        await asyncio.sleep(0)
        self.refreshed.append(value)


def test_auth_service_register_and_login():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

    async def run_flow():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with SessionLocal() as session:
            generated_credential = f"cred-{uuid4()}"
            user = await auth_service.create_user(
                session,
                UserCreate(email="svc@example.com", password=generated_credential, name="Svc"),
            )
            found = await auth_service.authenticate_user(session, "svc@example.com", generated_credential)
            assert found.id == user.id

    asyncio.run(run_flow())


def test_service_auth_email_guard_helpers() -> None:
    with pytest.raises(HTTPException, match="Email cannot be changed while Google is linked"):
        auth_service._require_email_change_allowed(SimpleNamespace(google_sub="google-sub"))

    assert auth_service._normalize_required_email("  User@Example.com  ") == "user@example.com"
    with pytest.raises(HTTPException, match="Email is required"):
        auth_service._normalize_required_email("   ")


@pytest.mark.anyio
async def test_service_auth_email_change_cooldown_matrix() -> None:
    user = SimpleNamespace(id=uuid4())
    await auth_service._enforce_email_change_cooldown(_SessionStub(scalar_values=[1]), user)
    await auth_service._enforce_email_change_cooldown(_SessionStub(scalar_values=[2, "not-a-datetime"]), user)
    await auth_service._enforce_email_change_cooldown(
        _SessionStub(scalar_values=[2, datetime.now(timezone.utc) - timedelta(days=31)]),
        user,
    )

    with pytest.raises(HTTPException, match="You can change your email once every 30 days") as exc:
        await auth_service._enforce_email_change_cooldown(
            _SessionStub(scalar_values=[2, datetime.now() - timedelta(days=1)]),
            user,
        )
    assert exc.value.status_code == 429


@pytest.mark.anyio
async def test_service_auth_secondary_email_error_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    user = SimpleNamespace(id=uuid4(), email="primary@example.com")

    with pytest.raises(HTTPException, match="Email is required"):
        await auth_service.add_secondary_email(_SessionStub(), user, "   ")
    with pytest.raises(HTTPException, match="already your primary email"):
        await auth_service.add_secondary_email(_SessionStub(), user, "primary@example.com")

    async def _always_taken(_session: object, _email: str, *, exclude_user_id: object | None = None) -> bool:
        await asyncio.sleep(0)
        _ = exclude_user_id
        return True

    monkeypatch.setattr(auth_service, "is_email_taken", _always_taken)
    with pytest.raises(HTTPException, match="Email already registered"):
        await auth_service.add_secondary_email(_SessionStub(), user, "alt@example.com")

    with pytest.raises(HTTPException, match="Secondary email not found"):
        await auth_service.request_secondary_email_verification(_SessionStub(get_values=[None]), user, uuid4())

    verified_secondary = SimpleNamespace(id=uuid4(), user_id=user.id, verified=True)
    with pytest.raises(HTTPException, match="already verified"):
        await auth_service.request_secondary_email_verification(
            _SessionStub(get_values=[verified_secondary]),
            user,
            verified_secondary.id,
        )

    with pytest.raises(HTTPException, match="Invalid or expired token"):
        await auth_service.confirm_secondary_email_verification(_SessionStub(), "   ")

    expired_record = SimpleNamespace(
        expires_at=datetime.now(timezone.utc) - timedelta(seconds=1),
        secondary_email_id=uuid4(),
        used=False,
    )
    expired_verification_id = str(uuid4())
    with pytest.raises(HTTPException, match="Invalid or expired token"):
        await auth_service.confirm_secondary_email_verification(
            _SessionStub(execute_results=[_ExecuteResult(first=expired_record)]),
            expired_verification_id,
        )

    valid_record = SimpleNamespace(
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
        secondary_email_id=uuid4(),
        used=False,
    )
    valid_verification_id = str(uuid4())
    with pytest.raises(HTTPException, match="Secondary email not found"):
        await auth_service.confirm_secondary_email_verification(
            _SessionStub(execute_results=[_ExecuteResult(first=valid_record)], get_values=[None]),
            valid_verification_id,
        )


@pytest.mark.anyio
async def test_service_auth_preserve_old_primary_matrix() -> None:
    user = SimpleNamespace(id=uuid4())
    now = datetime.now(timezone.utc)

    blank_session = _SessionStub()
    await auth_service._preserve_old_primary_as_secondary(
        blank_session,
        user=user,
        old_primary="",
        old_primary_verified=False,
        now=now,
    )
    assert blank_session.added == []

    existing_secondary = SimpleNamespace(verified=False, verified_at=None)
    existing_session = _SessionStub(scalar_values=[existing_secondary])
    await auth_service._preserve_old_primary_as_secondary(
        existing_session,
        user=user,
        old_primary="old@example.com",
        old_primary_verified=True,
        now=now,
    )
    assert existing_secondary.verified is True
    assert existing_secondary.verified_at == now
    assert existing_session.added == [existing_secondary]

    new_secondary_session = _SessionStub(scalar_values=[None])
    await auth_service._preserve_old_primary_as_secondary(
        new_secondary_session,
        user=user,
        old_primary="fresh@example.com",
        old_primary_verified=False,
        now=now,
    )
    assert len(new_secondary_session.added) == 1
    created = new_secondary_session.added[0]
    assert getattr(created, "email") == "fresh@example.com"
    assert getattr(created, "verified") is False
    assert getattr(created, "verified_at") is None


def test_service_auth_login_access_state_guards() -> None:
    with pytest.raises(HTTPException, match="Account temporarily locked"):
        auth_service._enforce_login_access_state(
            SimpleNamespace(locked_until=datetime.now() + timedelta(minutes=5), password_reset_required=False)
        )

    with pytest.raises(HTTPException, match="Password reset required"):
        auth_service._enforce_login_access_state(
            SimpleNamespace(locked_until=datetime.now(timezone.utc) - timedelta(minutes=5), password_reset_required=True)
        )

    auth_service._enforce_login_access_state(
        SimpleNamespace(locked_until=datetime.now(timezone.utc) - timedelta(minutes=5), password_reset_required=False)
    )


@pytest.mark.anyio
async def test_service_auth_deleted_login_guard_executes_due_deletion(monkeypatch: pytest.MonkeyPatch) -> None:
    called: list[object] = []

    async def _fake_execute_account_deletion(_session: object, user: object) -> None:
        await asyncio.sleep(0)
        called.append(user)

    monkeypatch.setattr(auth_service.self_service, "is_deletion_due", lambda _user: True)
    monkeypatch.setattr(auth_service.self_service, "execute_account_deletion", _fake_execute_account_deletion)

    pending_user = SimpleNamespace(deleted_at=None, deletion_scheduled_for=datetime.now(timezone.utc) - timedelta(minutes=1))
    with pytest.raises(HTTPException, match="Account deleted"):
        await auth_service._enforce_not_deleted_for_login(_SessionStub(), pending_user)
    assert called == [pending_user]

    deleted_user = SimpleNamespace(deleted_at=datetime.now(timezone.utc), deletion_scheduled_for=None)
    with pytest.raises(HTTPException, match="Account deleted"):
        await auth_service._enforce_not_deleted_for_login(_SessionStub(), deleted_user)

@pytest.mark.anyio
async def test_service_auth_lookup_and_unique_username_edges(monkeypatch: pytest.MonkeyPatch) -> None:
    assert auth_service._is_expired_timestamp(None) is True
    assert await auth_service.get_user_by_any_email(_SessionStub(), "   ") is None
    assert await auth_service.is_email_taken(_SessionStub(), "   ") is False

    taken_session = _SessionStub(scalar_values=[uuid4()])
    assert await auth_service.is_email_taken(taken_session, "taken@example.com") is True

    seen: list[str] = []

    def _get_user(_session: object, username: str):
        seen.append(username)
        return object() if len(seen) < 3 else None

    monkeypatch.setattr(auth_service, "get_user_by_username", _get_user)
    generated = await auth_service._generate_unique_username(_SessionStub(), "user@example.com")
    assert generated.endswith("-3")

    class _AlwaysInvalid:
        def match(self, _value: str):
            return None

    monkeypatch.setattr(auth_service, "USERNAME_ALLOWED_RE", _AlwaysInvalid())
    monkeypatch.setattr(auth_service.secrets, "token_hex", lambda _n: "abc123")
    sanitized = auth_service._sanitize_username_from_email("!@example.com")
    assert sanitized.startswith("user-")


@pytest.mark.anyio
async def test_service_auth_google_registration_update_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _SessionStub()
    user = SimpleNamespace(id=uuid4(), username="current", name="Current", name_tag=1)
    other = SimpleNamespace(id=uuid4())

    def _get_user(_session: object, username: str):
        return other if username == "taken-name" else None

    monkeypatch.setattr(auth_service, "get_user_by_username", _get_user)

    with pytest.raises(HTTPException, match="Username already taken"):
        await auth_service._update_google_registration_username(session, user, "taken-name")

    await auth_service._update_google_registration_username(session, user, "new-name")
    assert user.username == "new-name"

    with pytest.raises(HTTPException, match="Display name is required"):
        await auth_service._update_google_registration_display_name(session, user, "   ")

    def _reuse_none(_session: object, *, user_id: object, name: str):
        _ = user_id
        _ = name
        return None

    def _allocate(_session: object, name: str, *, exclude_user_id: object | None = None):
        _ = name
        _ = exclude_user_id
        return 7

    monkeypatch.setattr(auth_service, "_try_reuse_name_tag", _reuse_none)
    monkeypatch.setattr(auth_service, "_allocate_name_tag", _allocate)

    await auth_service._update_google_registration_display_name(session, user, " Fresh Name ")
    assert user.name == "Fresh Name"
    assert user.name_tag == 7


@pytest.mark.anyio
async def test_service_auth_secondary_email_token_success_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    tok1 = SimpleNamespace(used=False)
    tok2 = SimpleNamespace(used=False)
    revoke_session = _SessionStub(execute_results=[_ExecuteResult(scalars_all=[tok1, tok2])])

    await auth_service._revoke_other_secondary_email_tokens(revoke_session, uuid4())
    assert tok1.used is True
    assert tok2.used is True
    assert revoke_session.flushed == 1

    user = SimpleNamespace(id=uuid4())
    secondary = SimpleNamespace(id=uuid4(), user_id=user.id, verified=False)
    verify_session = _SessionStub(get_values=[secondary])
    monkeypatch.setattr(auth_service.secrets, "token_urlsafe", lambda _n: "secondary-token")

    token = await auth_service.request_secondary_email_verification(
        verify_session,
        user,
        secondary.id,
        expires_minutes=5,
    )
    assert token.token == "secondary-token"
    assert verify_session.commits == 1
    assert verify_session.refreshed and verify_session.refreshed[0] is token


@pytest.mark.anyio
async def test_service_auth_two_factor_extra_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    enabled_user = SimpleNamespace(two_factor_enabled=True)
    with pytest.raises(HTTPException, match="already enabled"):
        await auth_service.start_two_factor_setup(_SessionStub(), enabled_user)
    with pytest.raises(HTTPException, match="already enabled"):
        await auth_service.enable_two_factor(_SessionStub(), enabled_user, "123456")

    setup_user = SimpleNamespace(
        two_factor_enabled=False,
        two_factor_totp_secret="enc_value",
        two_factor_recovery_codes=None,
        two_factor_confirmed_at=None,
        email="user@example.com",
    )
    monkeypatch.setattr(auth_service, "_two_factor_secret", lambda _user: "plain_value")
    monkeypatch.setattr(auth_service.totp_core, "verify_totp_code", lambda **_kwargs: False)
    with pytest.raises(HTTPException, match="Invalid two-factor code"):
        await auth_service.enable_two_factor(_SessionStub(), setup_user, "000000")

    regen_user = SimpleNamespace(two_factor_enabled=True, two_factor_recovery_codes=None)
    monkeypatch.setattr(auth_service, "_generate_recovery_codes", lambda count: (["RC-1"], ["hash-1"]))
    regen_session = _SessionStub()
    codes = await auth_service.regenerate_recovery_codes(regen_session, regen_user)
    assert codes == ["RC-1"]
    assert regen_user.two_factor_recovery_codes == ["hash-1"]
    assert regen_session.commits == 1


class _HttpResponseStub:
    def __init__(self, status_code: int, payload: dict[str, object]) -> None:
        self.status_code = status_code
        self._payload = payload

    def json(self) -> dict[str, object]:
        return dict(self._payload)


class _HttpClientStub:
    def __init__(self, post_resp: _HttpResponseStub, get_resp: _HttpResponseStub) -> None:
        self._post = post_resp
        self._get = get_resp

    def __aenter__(self):
        return self

    def __aexit__(self, exc_type, exc, tb):
        _ = (exc_type, exc, tb)
        return False

    def post(self, *_args, **_kwargs):
        return self._post

    def get(self, *_args, **_kwargs):
        return self._get


@pytest.mark.anyio
async def test_service_auth_refresh_and_google_exchange_error_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    refresh = SimpleNamespace(revoked=False, revoked_reason=None)
    revoke_session = _SessionStub(execute_results=[_ExecuteResult(scalar_one_or_none=refresh)])
    await auth_service.revoke_refresh_token(revoke_session, "jti-1", reason="manual")
    assert refresh.revoked is True
    assert refresh.revoked_reason == "manual"
    assert revoke_session.commits == 1

    monkeypatch.setattr(auth_service.security, "decode_token", lambda _token: {"type": "refresh", "jti": "j1", "sub": "u1"})
    invalid_session = _SessionStub(execute_results=[_ExecuteResult(scalar_one_or_none=None)])
    with pytest.raises(HTTPException, match="Invalid refresh token"):
        await auth_service.validate_refresh_token(invalid_session, "refresh-token")

    monkeypatch.setattr(auth_service.settings, "google_client_id", "client-id")
    monkeypatch.setattr(auth_service.settings, "google_client_secret", "client-value")
    monkeypatch.setattr(auth_service.settings, "google_redirect_uri", "https://app.example/redirect")

    monkeypatch.setattr(
        auth_service.httpx,
        "AsyncClient",
        lambda **_kwargs: _HttpClientStub(_HttpResponseStub(400, {}), _HttpResponseStub(200, {})),
    )
    with pytest.raises(HTTPException, match="Failed to exchange Google code"):
        await auth_service.exchange_google_code("code-1")

    monkeypatch.setattr(
        auth_service.httpx,
        "AsyncClient",
        lambda **_kwargs: _HttpClientStub(_HttpResponseStub(200, {}), _HttpResponseStub(200, {})),
    )
    with pytest.raises(HTTPException, match="Missing Google access token"):
        await auth_service.exchange_google_code("code-2")

    monkeypatch.setattr(
        auth_service.httpx,
        "AsyncClient",
        lambda **_kwargs: _HttpClientStub(
            _HttpResponseStub(200, {"access_token": "at-1"}),
            _HttpResponseStub(401, {}),
        ),
    )
    with pytest.raises(HTTPException, match="Failed to fetch Google profile"):
        await auth_service.exchange_google_code("code-3")

