from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from urllib.parse import urlparse
from uuid import uuid4

from fastapi import BackgroundTasks, HTTPException
import pytest
from starlette.requests import Request

from app.api.v1 import auth as auth_api


def _fixture_value(label: str) -> str:
    return f"{label}-{uuid4().hex}"


FIXTURE_VALUE = _fixture_value("fixture")
TEST_CODE = "123456"
VERIFICATION_HANDLE = _fixture_value("verify")
SECONDARY_HANDLE = _fixture_value("secondary")
GOOGLE_AUTH_HOST = "accounts.google.com"
ADMIN_BYPASS_VALUE = _fixture_value("expected-bypass")
SIGNED_BYPASS_VALUE = _fixture_value("signed-bypass")


def _request(*, user_agent: str = "pytest/1.0", client_host: str = "127.0.0.1") -> Request:
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "GET",
        "path": "/",
        "raw_path": b"/",
        "query_string": b"",
        "headers": [(b"user-agent", user_agent.encode("utf-8"))],
        "client": (client_host, 12345),
        "server": ("testserver", 80),
        "scheme": "http",
    }
    return Request(scope)


class _ScalarRows:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return list(self._rows)


class _ExecuteResult:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return _ScalarRows(self._rows)


class _SessionForRevocation:
    def __init__(self, rows):
        self.rows = rows
        self.commits = 0
        self.added = []

    async def execute(self, _stmt):
        return _ExecuteResult(self.rows)

    def add_all(self, rows):
        self.added.extend(rows)

    async def commit(self):
        self.commits += 1


@pytest.mark.anyio
async def test_ensure_user_account_active_executes_due_deletion(monkeypatch: pytest.MonkeyPatch) -> None:
    user = SimpleNamespace(id=uuid4(), deleted_at=None, deletion_scheduled_for=datetime.now(timezone.utc))
    deleted = {"called": 0}

    monkeypatch.setattr(auth_api.self_service, "is_deletion_due", lambda _user: True)

    async def _execute(session, target):
        assert target is user
        deleted["called"] += 1

    monkeypatch.setattr(auth_api.self_service, "execute_account_deletion", _execute)

    with pytest.raises(HTTPException, match="Account deleted"):
        await auth_api._ensure_user_account_active(SimpleNamespace(), user)

    assert deleted["called"] == 1


@pytest.mark.anyio
async def test_queue_google_completion_emails_verified_vs_unverified(monkeypatch: pytest.MonkeyPatch) -> None:
    verified_user = SimpleNamespace(email="verified@example.test", first_name="V", preferred_language="en", email_verified=True)
    unverified_user = SimpleNamespace(
        email="pending@example.test", first_name="U", preferred_language="ro", email_verified=False
    )
    verification = SimpleNamespace(token=VERIFICATION_HANDLE)

    async def _create_email_verification(_session, user):
        assert user is unverified_user
        return verification

    monkeypatch.setattr(auth_api.auth_service, "create_email_verification", _create_email_verification)

    tasks_verified = BackgroundTasks()
    await auth_api._queue_google_completion_emails(tasks_verified, SimpleNamespace(), verified_user)
    assert len(tasks_verified.tasks) == 1

    tasks_unverified = BackgroundTasks()
    await auth_api._queue_google_completion_emails(tasks_unverified, SimpleNamespace(), unverified_user)
    assert len(tasks_unverified.tasks) == 2


@pytest.mark.anyio
async def test_two_factor_disable_and_regenerate_branch_matrix(monkeypatch: pytest.MonkeyPatch) -> None:
    user = SimpleNamespace(id=uuid4(), hashed_password=_fixture_value("hash"), two_factor_enabled=True)
    request = _request()
    payload = auth_api.TwoFactorDisableRequest(password=FIXTURE_VALUE, code=TEST_CODE)

    # Invalid password branch
    monkeypatch.setattr(auth_api.security, "verify_password", lambda _raw, _hashed: False)
    with pytest.raises(HTTPException, match="Invalid password"):
        await auth_api.two_factor_disable(payload, request, user, SimpleNamespace())

    # Disabled 2FA branch
    monkeypatch.setattr(auth_api.security, "verify_password", lambda _raw, _hashed: True)
    user.two_factor_enabled = False
    with pytest.raises(HTTPException, match="Two-factor is not enabled"):
        await auth_api.two_factor_disable(payload, request, user, SimpleNamespace())

    # Invalid code branch
    user.two_factor_enabled = True

    async def _verify_code_false(_session, _user, _code):
        return False

    monkeypatch.setattr(auth_api.auth_service, "verify_two_factor_code", _verify_code_false)
    with pytest.raises(HTTPException, match="Invalid two-factor code"):
        await auth_api.two_factor_disable(payload, request, user, SimpleNamespace())

    # Success disable branch
    async def _verify_code_true(_session, _user, _code):
        return True

    async def _disable_two_factor(_session, _user):
        return None

    async def _record_event(*_args, **_kwargs):
        return None

    monkeypatch.setattr(auth_api.auth_service, "verify_two_factor_code", _verify_code_true)
    monkeypatch.setattr(auth_api.auth_service, "disable_two_factor", _disable_two_factor)
    monkeypatch.setattr(auth_api.auth_service, "record_security_event", _record_event)
    disable_result = await auth_api.two_factor_disable(payload, request, user, SimpleNamespace())
    assert disable_result.enabled is False

    # Success regenerate branch
    async def _regenerate(_session, _user):
        return ["code-1", "code-2"]

    monkeypatch.setattr(auth_api.auth_service, "regenerate_recovery_codes", _regenerate)
    regen_result = await auth_api.two_factor_regenerate_codes(payload, request, user, SimpleNamespace())
    assert regen_result.recovery_codes == ["code-1", "code-2"]


@pytest.mark.anyio
async def test_request_secondary_email_verification_with_and_without_secondary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    current_user = SimpleNamespace(id=uuid4(), preferred_language="en")
    secondary_email_id = uuid4()
    token = SimpleNamespace(token=SECONDARY_HANDLE)

    async def _request_verify(_session, _user, _email_id):
        return token

    monkeypatch.setattr(auth_api.auth_service, "request_secondary_email_verification", _request_verify)

    class _Session:
        def __init__(self, secondary):
            self.secondary = secondary

        async def get(self, _model, _id):
            return self.secondary

    with_secondary = _Session(SimpleNamespace(email="secondary@example.test"))
    bt = BackgroundTasks()
    result = await auth_api.request_secondary_email_verification(
        secondary_email_id,
        bt,
        "/account/security",
        current_user,
        with_secondary,
    )
    assert result["detail"] == "Verification email sent"
    assert len(bt.tasks) == 1

    without_secondary = _Session(None)
    bt2 = BackgroundTasks()
    result2 = await auth_api.request_secondary_email_verification(
        secondary_email_id,
        bt2,
        None,
        current_user,
        without_secondary,
    )
    assert result2["detail"] == "Verification email sent"
    assert len(bt2.tasks) == 0


@pytest.mark.anyio
async def test_google_link_start_and_google_link_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    current_user = SimpleNamespace(id=uuid4(), hashed_password=_fixture_value("hash"))
    token_guard = None

    monkeypatch.setattr(auth_api.settings, "google_client_id", "", raising=False)
    monkeypatch.setattr(auth_api.settings, "google_redirect_uri", "", raising=False)
    with pytest.raises(HTTPException, match="Google OAuth not configured"):
        await auth_api.google_link_start(current_user, token_guard)

    monkeypatch.setattr(auth_api.settings, "google_client_id", "client", raising=False)
    monkeypatch.setattr(auth_api.settings, "google_redirect_uri", "https://example.test/callback", raising=False)
    auth_url = await auth_api.google_link_start(current_user, token_guard)
    parsed_auth_url = urlparse(auth_url["auth_url"])
    assert parsed_auth_url.scheme == "https"
    assert parsed_auth_url.hostname == GOOGLE_AUTH_HOST

    payload = auth_api.GoogleLinkCallback(code="code", state="state", password=FIXTURE_VALUE)
    monkeypatch.setattr(auth_api, "_validate_google_state", lambda *_args, **_kwargs: None)

    # Invalid password branch
    monkeypatch.setattr(auth_api.security, "verify_password", lambda _raw, _hashed: False)
    with pytest.raises(HTTPException, match="Invalid password"):
        await auth_api.google_link(payload, current_user, SimpleNamespace(), token_guard)

    # Already-linked conflict branch
    monkeypatch.setattr(auth_api.security, "verify_password", lambda _raw, _hashed: True)

    async def _exchange(_code):
        return {
            "sub": "google-sub",
            "email": "linked@example.test",
            "name": "Linked User",
            "picture": "https://img.example.test/avatar.png",
            "email_verified": True,
        }

    async def _existing_sub(_session, _sub):
        return SimpleNamespace(id=uuid4())

    monkeypatch.setattr(auth_api.auth_service, "exchange_google_code", _exchange)
    monkeypatch.setattr(auth_api.auth_service, "get_user_by_google_sub", _existing_sub)

    with pytest.raises(HTTPException, match="already linked elsewhere"):
        await auth_api.google_link(payload, current_user, SimpleNamespace(), token_guard)


@pytest.mark.anyio
async def test_revoke_other_sessions_invalid_current_and_success(monkeypatch: pytest.MonkeyPatch) -> None:
    user_id = uuid4()
    current_user = SimpleNamespace(id=user_id, hashed_password=_fixture_value("hash"))
    request = _request()
    payload = auth_api.ConfirmPasswordRequest(password=FIXTURE_VALUE)

    monkeypatch.setattr(auth_api.security, "verify_password", lambda _raw, _hashed: True)
    monkeypatch.setattr(auth_api, "_extract_refresh_session_jti", lambda _request: "candidate-jti")

    async def _resolve_none(*_args, **_kwargs):
        return None

    monkeypatch.setattr(auth_api, "_resolve_active_refresh_session_jti", _resolve_none)

    with pytest.raises(HTTPException, match="Could not identify current session"):
        await auth_api.revoke_other_sessions(payload, request, current_user, SimpleNamespace())

    now = datetime.now(timezone.utc)
    current = SimpleNamespace(jti="current", user_id=user_id, revoked=False, expires_at=now + timedelta(hours=1))
    expired = SimpleNamespace(jti="expired", user_id=user_id, revoked=False, expires_at=now - timedelta(seconds=1))
    active = SimpleNamespace(jti="active", user_id=user_id, revoked=False, expires_at=now + timedelta(hours=1))
    session = _SessionForRevocation([current, expired, active])

    async def _resolve_current(*_args, **_kwargs):
        return "current"

    monkeypatch.setattr(auth_api, "_resolve_active_refresh_session_jti", _resolve_current)
    result = await auth_api.revoke_other_sessions(payload, request, current_user, session)
    assert result.revoked == 1
    assert session.commits == 1
    assert len(session.added) == 1
    assert session.added[0].jti == "active"


def test_google_complete_request_validators_cover_error_paths() -> None:
    with pytest.raises(Exception):
        auth_api.GoogleCompleteRequest(
            username="  ",
            email="user@example.test",
            name="Display",
            first_name="First",
            middle_name=None,
            last_name="Last",
            date_of_birth=date(2000, 1, 1),
            phone="+40710000000",
            password=FIXTURE_VALUE,
            preferred_language="en",
            accept_terms=True,
            accept_privacy=True,
        )

    with pytest.raises(Exception):
        auth_api.GoogleCompleteRequest(
            username="user",
            email="user@example.test",
            name="Display",
            first_name="First",
            middle_name="  ",
            last_name="Last",
            date_of_birth=date(2000, 1, 1),
            phone="0710000000",
            password=FIXTURE_VALUE,
            preferred_language="en",
            accept_terms=True,
            accept_privacy=True,
        )

    with pytest.raises(Exception):
        auth_api.GoogleCompleteRequest(
            username="user",
            email="user@example.test",
            name="Display",
            first_name="First",
            middle_name="Middle",
            last_name="Last",
            date_of_birth=date.today() + timedelta(days=1),
            phone="+40710000000",
            password=FIXTURE_VALUE,
            preferred_language="en",
            accept_terms=True,
            accept_privacy=True,
        )

@pytest.mark.anyio
async def test_admin_ip_bypass_missing_secret_invalid_token_and_success(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = auth_api.AdminIpBypassRequest(token=_fixture_value('provided-bypass'))
    request = _request(user_agent='pytest-agent', client_host='10.0.0.5')
    current_user = SimpleNamespace(id=uuid4())
    session = SimpleNamespace()

    monkeypatch.setattr(auth_api.settings, 'admin_ip_bypass_token', '', raising=False)
    with pytest.raises(HTTPException, match='not configured'):
        await auth_api.admin_ip_bypass(payload, request, session, current_user, SimpleNamespace())

    monkeypatch.setattr(auth_api.settings, 'admin_ip_bypass_token', ADMIN_BYPASS_VALUE, raising=False)
    with pytest.raises(HTTPException, match='Invalid bypass token'):
        await auth_api.admin_ip_bypass(payload, request, session, current_user, SimpleNamespace())

    events: list[tuple[str, str | None]] = []
    monkeypatch.setattr(auth_api.security, 'create_admin_ip_bypass_token', lambda _uid: SIGNED_BYPASS_VALUE)

    async def _record_event(_session, _uid, action, user_agent=None, ip_address=None):
        events.append((action, ip_address))

    monkeypatch.setattr(auth_api.auth_service, 'record_security_event', _record_event)
    set_calls: list[str] = []
    monkeypatch.setattr(auth_api, 'set_admin_ip_bypass_cookie', lambda _resp, token: set_calls.append(token))

    await auth_api.admin_ip_bypass(
        auth_api.AdminIpBypassRequest(token=ADMIN_BYPASS_VALUE),
        request,
        session,
        current_user,
        SimpleNamespace(),
    )

    assert set_calls == [SIGNED_BYPASS_VALUE]
    assert events == [('admin_ip_bypass_used', '10.0.0.5')]


@pytest.mark.anyio
async def test_update_training_mode_role_guard_and_success() -> None:
    class _Session:
        def __init__(self):
            self.added = []
            self.commits = 0
            self.refreshes = 0

        def add(self, obj):
            self.added.append(obj)

        async def commit(self):
            self.commits += 1

        async def refresh(self, _obj):
            self.refreshes += 1

    payload = auth_api.TrainingModeUpdateRequest(enabled=True)
    denied_user = SimpleNamespace(role=auth_api.UserRole.customer, admin_training_mode=False)
    with pytest.raises(HTTPException, match='Staff access required'):
        await auth_api.update_training_mode(payload, denied_user, _Session())

    allowed_user = SimpleNamespace(
        id=uuid4(),
        role=auth_api.UserRole.admin,
        admin_training_mode=False,
        email='admin@example.test',
        username='admin',
        name='Admin User',
        name_tag='001',
        first_name='Admin',
        middle_name=None,
        last_name='User',
        date_of_birth=None,
        phone=None,
        avatar_url=None,
        preferred_language='en',
        email_verified=True,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    session = _Session()
    result = await auth_api.update_training_mode(payload, allowed_user, session)
    assert allowed_user.admin_training_mode is True
    assert session.commits == 1
    assert session.refreshes == 1
    assert result.email == 'admin@example.test'
