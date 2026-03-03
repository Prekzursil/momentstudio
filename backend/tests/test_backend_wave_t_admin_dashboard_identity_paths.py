from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi import BackgroundTasks, HTTPException
from starlette.requests import Request

from app.api.v1 import admin_dashboard
from app.models.user import UserRole


def _request(*, headers: dict[str, str] | None = None, client_host: str | None = "198.51.100.12") -> Request:
    normalized = {key.lower(): value for key, value in (headers or {}).items()}
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "GET",
        "scheme": "https",
        "path": "/",
        "raw_path": b"/",
        "query_string": b"",
        "headers": [(k.encode("latin-1"), v.encode("latin-1")) for k, v in normalized.items()],
        "client": (client_host, 443) if client_host else None,
        "server": ("testserver", 80),
    }
    return Request(scope)


def _user(**overrides: object) -> SimpleNamespace:
    base = {
        "id": uuid4(),
        "email": "user@example.com",
        "username": "user1",
        "name": "User One",
        "name_tag": 1,
        "role": UserRole.customer,
        "email_verified": False,
        "preferred_language": "en",
        "created_at": datetime(2026, 1, 1, tzinfo=timezone.utc),
        "deleted_at": None,
        "vip": False,
        "admin_note": None,
        "locked_until": None,
        "locked_reason": None,
        "password_reset_required": False,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def _credential_value() -> str:
    return f"cred-{uuid4()}"


class _Rows:
    def __init__(self, rows: list[object] | None = None) -> None:
        self._rows = list(rows or [])

    def all(self) -> list[object]:
        return list(self._rows)


class _ExecResult:
    def __init__(self, rows: list[object] | None = None) -> None:
        self._rows = list(rows or [])

    def scalars(self) -> _Rows:
        return _Rows(self._rows)


class _Session:
    def __init__(
        self,
        *,
        get_map: dict[UUID, object] | None = None,
        execute_results: list[_ExecResult] | None = None,
        scalar_results: list[object | None] | None = None,
    ) -> None:
        self.get_map = dict(get_map or {})
        self.execute_results = list(execute_results or [])
        self.scalar_results = list(scalar_results or [])
        self.added: list[object] = []
        self.added_all_batches: list[list[object]] = []
        self.commits = 0
        self.flushes = 0
        self.refreshed: list[object] = []

    async def get(self, _model: object, key: UUID):
        return self.get_map.get(key)

    async def execute(self, _stmt: object) -> _ExecResult:
        if not self.execute_results:
            raise AssertionError("Unexpected execute() call")
        return self.execute_results.pop(0)

    async def scalar(self, _stmt: object):
        if self.scalar_results:
            return self.scalar_results.pop(0)
        return None

    def add(self, value: object) -> None:
        self.added.append(value)

    def add_all(self, values: list[object]) -> None:
        batch = list(values)
        self.added.extend(batch)
        self.added_all_batches.append(batch)

    async def flush(self) -> None:
        self.flushes += 1

    async def commit(self) -> None:
        self.commits += 1

    async def refresh(self, value: object) -> None:
        self.refreshed.append(value)


def test_admin_dashboard_existing_active_user_guard_paths() -> None:
    active_user = _user()
    assert admin_dashboard._existing_active_user(active_user) is active_user

    with pytest.raises(HTTPException, match="User not found"):
        admin_dashboard._existing_active_user(None)

    with pytest.raises(HTTPException, match="User not found"):
        admin_dashboard._existing_active_user(_user(deleted_at=datetime.now(timezone.utc)))


@pytest.mark.anyio
async def test_admin_dashboard_password_reset_email_resolution_paths() -> None:
    user = _user(email="Primary@Example.com")
    session = _Session()
    primary_email, primary_kind = await admin_dashboard._password_reset_target_email(
        session,
        user=user,
        requested_email="",
    )
    assert primary_email == "Primary@Example.com"
    assert primary_kind == "primary"

    same_email, same_kind = await admin_dashboard._password_reset_target_email(
        session,
        user=user,
        requested_email="primary@example.com",
    )
    assert same_email == "Primary@Example.com"
    assert same_kind == "primary"

    secondary_session = _Session(
        scalar_results=[SimpleNamespace(email=" secondary@example.com ")]
    )
    secondary_email, secondary_kind = await admin_dashboard._password_reset_target_email(
        secondary_session,
        user=user,
        requested_email="secondary@example.com",
    )
    assert secondary_email == "secondary@example.com"
    assert secondary_kind == "secondary"

    missing_secondary = _Session(scalar_results=[None])
    with pytest.raises(HTTPException, match="Invalid email"):
        await admin_dashboard._password_reset_target_email(
            missing_secondary,
            user=user,
            requested_email="missing@example.com",
        )


@pytest.mark.anyio
async def test_admin_dashboard_set_unused_email_verification_tokens_paths() -> None:
    user_id = uuid4()
    empty_session = _Session(execute_results=[_ExecResult([])])
    await admin_dashboard._set_unused_email_verification_tokens_used(empty_session, user_id)
    assert empty_session.added_all_batches == []

    token_a = SimpleNamespace(id=uuid4(), used=False)
    token_b = SimpleNamespace(id=uuid4(), used=False)
    token_session = _Session(execute_results=[_ExecResult([token_a, token_b])])
    await admin_dashboard._set_unused_email_verification_tokens_used(token_session, user_id)
    assert token_a.used is True
    assert token_b.used is True
    assert token_session.added_all_batches == [[token_a, token_b]]


@pytest.mark.anyio
async def test_admin_dashboard_email_verification_history_paths() -> None:
    user_id = uuid4()
    with pytest.raises(HTTPException, match="User not found"):
        await admin_dashboard.email_verification_history(
            user_id=user_id,
            session=_Session(get_map={}),
            _=object(),
        )

    token_1 = SimpleNamespace(
        id=uuid4(),
        created_at=datetime(2026, 2, 1, tzinfo=timezone.utc),
        expires_at=datetime(2026, 2, 3, tzinfo=timezone.utc),
        used=False,
    )
    token_2 = SimpleNamespace(
        id=uuid4(),
        created_at=datetime(2026, 2, 2, tzinfo=timezone.utc),
        expires_at=datetime(2026, 2, 4, tzinfo=timezone.utc),
        used=True,
    )
    user = _user(id=user_id)
    session = _Session(
        get_map={user_id: user},
        execute_results=[_ExecResult([token_1, token_2])],
    )
    response = await admin_dashboard.email_verification_history(
        user_id=user_id,
        session=session,
        _=object(),
    )
    assert [token.id for token in response.tokens] == [token_1.id, token_2.id]
    assert [token.used for token in response.tokens] == [False, True]


@pytest.mark.anyio
async def test_admin_dashboard_resend_email_verification_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    user_id = uuid4()
    request = _request(headers={"user-agent": "AdminAgent/1.0"})
    current_user = _user(role=UserRole.admin)

    with pytest.raises(HTTPException, match="User not found"):
        await admin_dashboard.resend_email_verification(
            user_id=user_id,
            request=request,
            background_tasks=BackgroundTasks(),
            session=_Session(get_map={}),
            current_user=current_user,
        )

    with pytest.raises(HTTPException, match="Email already verified"):
        await admin_dashboard.resend_email_verification(
            user_id=user_id,
            request=request,
            background_tasks=BackgroundTasks(),
            session=_Session(get_map={user_id: _user(id=user_id, email_verified=True)}),
            current_user=current_user,
        )

    record = SimpleNamespace(
        id=uuid4(),
        token=str(uuid4()),
        expires_at=datetime(2026, 3, 5, tzinfo=timezone.utc),
    )

    async def _create_verification(_session: object, _user_obj: object):
        return record

    monkeypatch.setattr(admin_dashboard.auth_service, "create_email_verification", _create_verification)

    audit_calls: list[dict[str, object]] = []

    async def _audit_log(_session: object, **kwargs: object) -> None:
        audit_calls.append(kwargs)

    monkeypatch.setattr(admin_dashboard.audit_chain_service, "add_admin_audit_log", _audit_log)

    target_user = _user(id=user_id, email="target@example.com", email_verified=False)
    session = _Session(get_map={user_id: target_user})
    background_tasks = BackgroundTasks()
    response = await admin_dashboard.resend_email_verification(
        user_id=user_id,
        request=request,
        background_tasks=background_tasks,
        session=session,
        current_user=current_user,
    )
    assert response == {"detail": "Verification email sent"}
    assert session.commits == 1
    assert len(background_tasks.tasks) == 1
    assert len(audit_calls) == 1
    assert audit_calls[0]["action"] == "user.email_verification.resend"


@pytest.mark.anyio
async def test_admin_dashboard_resend_password_reset_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    user_id = uuid4()
    current_user = _user(role=UserRole.admin)
    user = _user(id=user_id, email="primary@example.com")
    request = _request(headers={"user-agent": "AdminAgent/2.0"})

    async def _no_target_email(_session: object, *, user: object, requested_email: str):
        return "", "primary"

    monkeypatch.setattr(admin_dashboard, "_password_reset_target_email", _no_target_email)
    with pytest.raises(HTTPException, match="User email missing"):
        await admin_dashboard.resend_password_reset(
            user_id=user_id,
            payload=SimpleNamespace(email=None),
            request=request,
            background_tasks=BackgroundTasks(),
            session=_Session(get_map={user_id: user}),
            current_user=current_user,
            _=None,
        )

    async def _target_primary(_session: object, *, user: object, requested_email: str):
        return "primary@example.com", "primary"

    async def _missing_reset(_session: object, _email: str):
        return None

    monkeypatch.setattr(admin_dashboard, "_password_reset_target_email", _target_primary)
    monkeypatch.setattr(admin_dashboard.auth_service, "create_reset_token", _missing_reset)
    with pytest.raises(HTTPException, match="User not found"):
        await admin_dashboard.resend_password_reset(
            user_id=user_id,
            payload=SimpleNamespace(email=None),
            request=request,
            background_tasks=BackgroundTasks(),
            session=_Session(get_map={user_id: user}),
            current_user=current_user,
            _=None,
        )

    async def _target_secondary(_session: object, *, user: object, requested_email: str):
        return "secondary@example.com", "secondary"

    reset = SimpleNamespace(
        id=uuid4(),
        token=str(uuid4()),
        expires_at=datetime(2026, 3, 6, tzinfo=timezone.utc),
    )

    async def _create_reset(_session: object, _email: str):
        return reset

    monkeypatch.setattr(admin_dashboard, "_password_reset_target_email", _target_secondary)
    monkeypatch.setattr(admin_dashboard.auth_service, "create_reset_token", _create_reset)
    monkeypatch.setattr(admin_dashboard.pii_service, "mask_email", lambda _email: "s***@example.com")

    audit_calls: list[dict[str, object]] = []

    async def _audit_log(_session: object, **kwargs: object) -> None:
        audit_calls.append(kwargs)

    monkeypatch.setattr(admin_dashboard.audit_chain_service, "add_admin_audit_log", _audit_log)

    session = _Session(get_map={user_id: user})
    background_tasks = BackgroundTasks()
    response = await admin_dashboard.resend_password_reset(
        user_id=user_id,
        payload=SimpleNamespace(email="secondary@example.com"),
        request=request,
        background_tasks=background_tasks,
        session=session,
        current_user=current_user,
        _=None,
    )
    assert response == {"detail": "Password reset email sent"}
    assert session.commits == 1
    assert len(background_tasks.tasks) == 1
    assert len(audit_calls) == 1
    assert audit_calls[0]["action"] == "user.password_reset.resend"
    assert audit_calls[0]["data"]["to_email_kind"] == "secondary"


@pytest.mark.anyio
async def test_admin_dashboard_override_email_verification_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    user_id = uuid4()
    actor = _user(role=UserRole.admin)
    request = _request(headers={"user-agent": "AdminAgent/3.0"})
    monkeypatch.setattr(admin_dashboard, "_require_admin_password", lambda _password, _current: None)

    marked_user_ids: list[UUID] = []

    async def _mark_tokens(_session: object, marked_user_id: UUID) -> None:
        marked_user_ids.append(marked_user_id)

    monkeypatch.setattr(admin_dashboard, "_set_unused_email_verification_tokens_used", _mark_tokens)

    audit_calls: list[dict[str, object]] = []

    async def _audit_log(_session: object, **kwargs: object) -> None:
        audit_calls.append(kwargs)

    monkeypatch.setattr(admin_dashboard.audit_chain_service, "add_admin_audit_log", _audit_log)

    unverified_user = _user(id=user_id, email_verified=False)
    session = _Session(get_map={user_id: unverified_user})
    response = await admin_dashboard.override_email_verification(
        user_id=user_id,
        payload=SimpleNamespace(password=_credential_value()),
        request=request,
        session=session,
        current_user=actor,
    )
    assert response.email_verified is True
    assert marked_user_ids == [user_id]
    assert session.flushes == 1
    assert session.commits == 1
    assert len(audit_calls) == 1

    already_verified = _user(id=user_id, email_verified=True)
    session_verified = _Session(get_map={user_id: already_verified})
    audit_calls.clear()
    response_verified = await admin_dashboard.override_email_verification(
        user_id=user_id,
        payload=SimpleNamespace(password=_credential_value()),
        request=request,
        session=session_verified,
        current_user=actor,
    )
    assert response_verified.email_verified is True
    assert marked_user_ids == [user_id]
    assert session_verified.flushes == 1
    assert session_verified.commits == 1
    assert audit_calls == []


@pytest.mark.anyio
async def test_admin_dashboard_impersonate_user_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    user_id = uuid4()
    request = _request(headers={"user-agent": "AdminAgent/4.0"})
    current_user = _user(role=UserRole.admin)

    with pytest.raises(HTTPException, match="User not found"):
        await admin_dashboard.impersonate_user(
            user_id=user_id,
            request=request,
            session=_Session(get_map={}),
            current_user=current_user,
        )

    with pytest.raises(HTTPException, match="Only customer accounts can be impersonated"):
        await admin_dashboard.impersonate_user(
            user_id=user_id,
            request=request,
            session=_Session(get_map={user_id: _user(id=user_id, role=UserRole.admin)}),
            current_user=current_user,
        )

    monkeypatch.setattr(admin_dashboard.settings, "admin_impersonation_exp_minutes", -5, raising=False)
    token_calls: list[tuple[str, str, int]] = []
    generated_access_credential = str(uuid4())

    def _create_access_token(user_value: str, *, impersonator_user_id: str, expires_minutes: int) -> str:
        token_calls.append((user_value, impersonator_user_id, expires_minutes))
        return generated_access_credential

    monkeypatch.setattr(admin_dashboard.security, "create_impersonation_access_token", _create_access_token)

    audit_calls: list[dict[str, object]] = []

    async def _audit_log(_session: object, **kwargs: object) -> None:
        audit_calls.append(kwargs)

    monkeypatch.setattr(admin_dashboard.audit_chain_service, "add_admin_audit_log", _audit_log)

    customer = _user(id=user_id, role=UserRole.customer)
    session = _Session(get_map={user_id: customer})
    response = await admin_dashboard.impersonate_user(
        user_id=user_id,
        request=request,
        session=session,
        current_user=current_user,
    )
    assert response.access_token == generated_access_credential
    assert token_calls == [(str(user_id), str(current_user.id), 1)]
    assert session.commits == 1
    assert len(audit_calls) == 1
    remaining_seconds = (response.expires_at - datetime.now(timezone.utc)).total_seconds()
    assert 0 < remaining_seconds <= 120


@pytest.mark.anyio
async def test_admin_dashboard_transfer_owner_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(admin_dashboard, "_require_confirm_value", lambda value, *, keyword, detail: None)
    monkeypatch.setattr(admin_dashboard, "_require_admin_password", lambda password, current_user: None)

    owner = _user(
        role=UserRole.owner,
        email="owner@example.com",
        username="owner",
        name="Owner Current",
        name_tag=1,
    )
    payload = SimpleNamespace(identifier="owner@example.com", confirm="TRANSFER", password=_credential_value())

    async def _same_owner(_session: object, _identifier: str):
        return owner

    monkeypatch.setattr(admin_dashboard, "_owner_transfer_target", _same_owner)
    same_session = _Session()
    same_response = await admin_dashboard.transfer_owner(
        payload=payload,
        session=same_session,
        current_owner=owner,
    )
    assert same_response == {
        "old_owner_id": str(owner.id),
        "new_owner_id": str(owner.id),
    }
    assert same_session.flushes == 0
    assert same_session.commits == 0

    new_owner = _user(
        role=UserRole.customer,
        email="new-owner@example.com",
        username="new_owner",
        name="Owner Next",
        name_tag=7,
    )

    async def _new_owner(_session: object, _identifier: str):
        return new_owner

    monkeypatch.setattr(admin_dashboard, "_owner_transfer_target", _new_owner)

    audit_calls: list[dict[str, object]] = []

    async def _audit_log(_session: object, **kwargs: object) -> None:
        audit_calls.append(kwargs)

    monkeypatch.setattr(admin_dashboard.audit_chain_service, "add_admin_audit_log", _audit_log)

    transfer_session = _Session()
    transfer_response = await admin_dashboard.transfer_owner(
        payload=SimpleNamespace(identifier="new_owner", confirm="TRANSFER", password=_credential_value()),
        session=transfer_session,
        current_owner=owner,
    )
    assert owner.role == UserRole.admin
    assert new_owner.role == UserRole.owner
    assert transfer_session.flushes == 1
    assert transfer_session.commits == 1
    assert transfer_session.refreshed == [new_owner]
    assert transfer_response["old_owner_id"] == str(owner.id)
    assert transfer_response["new_owner_id"] == str(new_owner.id)
    assert transfer_response["email"] == "new-owner@example.com"
    assert len(audit_calls) == 1
    assert audit_calls[0]["action"] == "owner_transfer"

