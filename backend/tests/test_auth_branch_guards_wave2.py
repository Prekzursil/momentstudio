from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

from fastapi import BackgroundTasks, HTTPException, Response, status
import pytest
from pydantic import ValidationError
from starlette.requests import Request

from app.api.v1 import auth as auth_api


def _request() -> Request:
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "GET",
        "path": "/",
        "raw_path": b"/",
        "query_string": b"",
        "headers": [(b"user-agent", b"pytest-wave2")],
        "client": ("127.0.0.1", 12345),
        "server": ("testserver", 80),
        "scheme": "http",
    }
    return Request(scope)


def _user(**overrides):
    data = {
        "id": uuid4(),
        "hashed_password": "hashed",
        "two_factor_enabled": True,
        "email": "user@example.test",
        "preferred_language": "en",
        "google_picture_url": None,
        "avatar_url": None,
    }
    data.update(overrides)
    return SimpleNamespace(**data)


class _Session:
    def __init__(self, *, bind=None, user=None):
        self.bind = bind
        self._user = user
        self.added: list[object] = []

    async def get(self, _model, _id):
        return self._user

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        return None

    async def refresh(self, _obj, **_kwargs):
        return None


def test_auth_helper_validators_and_schedule_job_branches() -> None:
    with pytest.raises(HTTPException) as missing_engine:
        auth_api._schedule_export_job(BackgroundTasks(), _Session(bind=None), job_id=uuid4())
    assert missing_engine.value.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR

    background_tasks = BackgroundTasks()
    auth_api._schedule_export_job(background_tasks, _Session(bind=object()), job_id=uuid4())
    assert len(background_tasks.tasks) == 1

    assert auth_api.ProfileUpdate._normalize_phone(None) is None
    with pytest.raises(ValueError, match="E.164"):
        auth_api.ProfileUpdate._normalize_phone("0700000000")

    with pytest.raises(ValueError, match="Field cannot be empty"):
        auth_api.RegisterRequest._strip_required_strings("   ")
    with pytest.raises(ValueError, match="Phone is required"):
        auth_api.RegisterRequest._strip_phone(" ")

    with pytest.raises(ValidationError):
        auth_api.ProfileUpdate(phone="invalid-phone")


@pytest.mark.anyio
async def test_decode_and_passkey_login_guard_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(auth_api.security, "decode_token", lambda _token: {"type": "two_factor", "sub": "not-a-uuid"})
    with pytest.raises(HTTPException, match="Invalid two-factor token"):
        auth_api._decode_two_factor_login_token("bad")

    async def _user_by_email(*_args, **_kwargs):
        return _user()

    monkeypatch.setattr(auth_api.auth_service, "get_user_by_login_email", _user_by_email)

    async def _empty_challenge(*_args, **_kwargs):
        return ({}, None)

    monkeypatch.setattr(auth_api.passkeys_service, "generate_authentication_options_for_user", _empty_challenge)
    with pytest.raises(HTTPException, match="Failed to generate passkey challenge"):
        await auth_api.passkey_login_options(
            auth_api.PasskeyLoginOptionsRequest(identifier="user@example.test", remember=True),
            _Session(),
            None,
        )


@pytest.mark.anyio
async def test_login_two_factor_invalid_user_not_enabled_and_bad_code(monkeypatch: pytest.MonkeyPatch) -> None:
    user_id = uuid4()
    monkeypatch.setattr(auth_api, "_decode_two_factor_login_token", lambda _token: (user_id, True, "password"))

    async def _ensure_active(_session, _user):
        return None

    monkeypatch.setattr(auth_api, "_ensure_user_account_active", _ensure_active)

    session = _Session(user=None)
    payload = auth_api.TwoFactorLoginRequest(two_factor_token="token", code="123456")
    with pytest.raises(HTTPException, match="Invalid two-factor token"):
        await auth_api.login_two_factor(payload, _request(), BackgroundTasks(), session, None, Response())

    user = _user(two_factor_enabled=False)
    session._user = user
    with pytest.raises(HTTPException, match="Two-factor is not enabled"):
        await auth_api.login_two_factor(payload, _request(), BackgroundTasks(), session, None, Response())

    user.two_factor_enabled = True

    async def _verify_false(*_args, **_kwargs):
        return False

    monkeypatch.setattr(auth_api.auth_service, "verify_two_factor_code", _verify_false)
    with pytest.raises(HTTPException, match="Invalid two-factor code"):
        await auth_api.login_two_factor(payload, _request(), BackgroundTasks(), session, None, Response())


@pytest.mark.anyio
async def test_existing_google_user_callback_incomplete_and_two_factor(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _ensure_active(_session, _user):
        return None

    monkeypatch.setattr(auth_api, "_ensure_user_account_active", _ensure_active)
    existing_user = _user(google_picture_url="https://cdn.example/avatar.png")

    monkeypatch.setattr(auth_api.auth_service, "is_profile_complete", lambda _u: False)
    monkeypatch.setattr(auth_api, "_google_completion_required_response", lambda _u: "completion-required")
    completion = await auth_api._handle_existing_google_user_callback(
        existing_user,
        _request(),
        BackgroundTasks(),
        _Session(),
        response=Response(),
    )
    assert completion == "completion-required"

    monkeypatch.setattr(auth_api.auth_service, "is_profile_complete", lambda _u: True)
    monkeypatch.setattr(auth_api.UserResponse, "model_validate", lambda _u: SimpleNamespace(id=str(existing_user.id)))
    monkeypatch.setattr(auth_api.security, "create_two_factor_token", lambda *_args, **_kwargs: "google-2fa-token")
    monkeypatch.setattr(auth_api, "GoogleCallbackResponse", lambda **kwargs: SimpleNamespace(**kwargs))
    existing_user.two_factor_enabled = True

    response = await auth_api._handle_existing_google_user_callback(
        existing_user,
        _request(),
        BackgroundTasks(),
        _Session(),
        response=Response(),
    )
    assert response.requires_two_factor is True
    assert response.two_factor_token == "google-2fa-token"


@pytest.mark.anyio
async def test_invalid_password_guards_cover_many_endpoints(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(auth_api.security, "verify_password", lambda *_args, **_kwargs: False)
    session = _Session()
    request = _request()
    current_user = _user()

    with pytest.raises(HTTPException, match="Invalid password"):
        await auth_api.passkey_register_options(SimpleNamespace(password="pw"), current_user, session)
    with pytest.raises(HTTPException, match="Invalid password"):
        await auth_api.passkey_delete(uuid4(), SimpleNamespace(password="pw"), request, current_user, session)
    with pytest.raises(HTTPException, match="Invalid password"):
        await auth_api.step_up(SimpleNamespace(password="pw"), request, None, session, current_user)
    with pytest.raises(HTTPException, match="Invalid password"):
        await auth_api.two_factor_setup(SimpleNamespace(password="pw"), request, current_user, session)
    with pytest.raises(HTTPException, match="Invalid password"):
        await auth_api.two_factor_regenerate_codes(SimpleNamespace(password="pw", code="123456"), request, current_user, session)
    with pytest.raises(HTTPException, match="Invalid password"):
        await auth_api.update_username(SimpleNamespace(username="newname", password="pw"), current_user, session)
    with pytest.raises(HTTPException, match="Invalid password"):
        await auth_api.update_email(SimpleNamespace(email="new@example.test", password="pw"), request, BackgroundTasks(), current_user, session)
    with pytest.raises(HTTPException, match="Invalid password"):
        await auth_api.make_secondary_email_primary(uuid4(), SimpleNamespace(password="pw"), request, current_user, session)
    with pytest.raises(HTTPException, match="Invalid password"):
        await auth_api.delete_secondary_email(uuid4(), SimpleNamespace(password="pw"), current_user, session)
    with pytest.raises(HTTPException, match="Invalid password"):
        await auth_api.request_account_deletion(SimpleNamespace(confirm="DELETE", password="pw"), current_user, session)
    with pytest.raises(HTTPException, match="Invalid password"):
        await auth_api.revoke_other_sessions(SimpleNamespace(password="pw"), request, current_user, session)
    with pytest.raises(HTTPException, match="Invalid password"):
        await auth_api.google_unlink(SimpleNamespace(password="pw"), current_user, session, None)


@pytest.mark.anyio
async def test_export_download_and_google_avatar_branches(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    with pytest.raises(HTTPException, match="No Google profile picture available"):
        await auth_api.use_google_avatar(_user(google_picture_url=None), _Session())

    export_path = tmp_path / "export.json"
    export_path.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(auth_api, "_resolve_downloadable_export_path", lambda *_args, **_kwargs: export_path)
    monkeypatch.setattr(auth_api, "_export_download_filename", lambda _job: "user-export.json")

    class _ExportSession(_Session):
        async def get(self, _model, _id):
            return SimpleNamespace(id=uuid4(), user_id=uuid4(), status="succeeded", path=str(export_path), created_at=datetime.now(timezone.utc))

    response = await auth_api.download_export_job(uuid4(), _user(), _ExportSession())
    assert response.filename == "user-export.json"
    assert response.media_type == "application/json"