from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

from fastapi import HTTPException, Response
import pytest
from starlette.requests import Request
from webauthn.helpers import bytes_to_base64url

from app.api.v1 import auth as auth_api
from app.models.user_export import UserDataExportStatus
from app.schemas.auth import RefreshRequest


def _request(
    *,
    headers: dict[str, str] | None = None,
    cookies: dict[str, str] | None = None,
    client_host: str | None = '127.0.0.1',
) -> Request:
    header_map = {k.lower(): v for k, v in (headers or {}).items()}
    if cookies:
        header_map['cookie'] = '; '.join(f'{key}={value}' for key, value in cookies.items())
    scope = {
        'type': 'http',
        'http_version': '1.1',
        'method': 'GET',
        'path': '/',
        'raw_path': b'/',
        'query_string': b'',
        'headers': [(key.encode('latin-1'), value.encode('latin-1')) for key, value in header_map.items()],
        'client': (client_host, 12345) if client_host else None,
        'server': ('testserver', 80),
        'scheme': 'http',
    }
    return Request(scope)


def test_auth_identifier_token_and_country_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        auth_api.security,
        'decode_token',
        lambda token: {
            'refresh-good': {'type': 'refresh', 'jti': 'refresh-jti'},
            'access-good': {'type': 'access', 'jti': 'access-jti'},
            'user-token': {'sub': 'user-42'},
            'wrong-type': {'type': 'access', 'jti': 'bad'},
            'blank-jti': {'type': 'refresh', 'jti': '  '},
        }.get(token),
    )
    monkeypatch.setattr(auth_api, 'decode_token', lambda token: {'sub': 'user-42'} if token == 'user-token' else None)

    assert auth_api._user_or_ip_identifier(_request(headers={'authorization': 'Bearer user-token'})) == 'user:user-42'
    assert auth_api._user_or_ip_identifier(_request(client_host='198.51.100.5')) == 'ip:198.51.100.5'

    assert auth_api._extract_bearer_token(_request()) is None
    assert auth_api._extract_bearer_token(_request(headers={'authorization': 'Basic abc'})) is None
    assert auth_api._extract_bearer_token(_request(headers={'authorization': 'Bearer    '})) is None
    assert auth_api._extract_bearer_token(_request(headers={'authorization': 'Bearer access-good'})) == 'access-good'

    assert auth_api._extract_token_jti('refresh-good', token_type='refresh') == 'refresh-jti'
    assert auth_api._extract_token_jti('wrong-type', token_type='refresh') is None
    assert auth_api._extract_token_jti('blank-jti', token_type='refresh') is None

    assert auth_api._extract_refresh_session_jti(_request(cookies={'refresh_token': 'refresh-good'})) == 'refresh-jti'
    assert (
        auth_api._extract_refresh_session_jti(
            _request(cookies={'refresh_token': 'wrong-type'}, headers={'authorization': 'Bearer access-good'})
        )
        == 'access-jti'
    )
    assert auth_api._extract_refresh_session_jti(_request(headers={'authorization': 'Bearer blank-jti'})) is None

    assert auth_api._extract_country_code(_request(headers={'cf-ipcountry': 'ro'})) == 'RO'
    assert auth_api._extract_country_code(_request(headers={'x-country': 'abcdefghijk'})) == 'ABCDEFGH'
    assert auth_api._extract_country_code(_request(headers={'x-country-code': 'ro-'})) is None
    assert auth_api._extract_country_code(_request(headers={'cf-ipcountry': 'xx', 'x-country': '  '})) is None


@pytest.mark.anyio
async def test_auth_consent_docs_and_active_refresh_resolution() -> None:
    class _ExecResult:
        def __init__(self, *, rows: list[tuple[str, int]] | None = None, scalar: object | None = None) -> None:
            self._rows = rows or []
            self._scalar = scalar

        def all(self) -> list[tuple[str, int]]:
            return list(self._rows)

        def scalar_one_or_none(self) -> object | None:
            return self._scalar

    class _Session:
        def __init__(self, *results: _ExecResult) -> None:
            self._results = list(results)

        def execute(self, _stmt: object):
            if not self._results:
                raise AssertionError('Unexpected execute() call')
            return asyncio.sleep(0, result=self._results.pop(0))

    keys = ('page.terms-and-conditions', 'page.privacy-policy')
    versions = await auth_api._require_published_consent_docs(
        _Session(_ExecResult(rows=[('page.terms-and-conditions', 2), ('page.privacy-policy', 3)])),
        keys,
    )
    assert versions == {'page.terms-and-conditions': 2, 'page.privacy-policy': 3}

    with pytest.raises(HTTPException, match='missing published content'):
        await auth_api._require_published_consent_docs(
            _Session(_ExecResult(rows=[('page.terms-and-conditions', 2)])),
            keys,
        )

    user_id = uuid4()
    now = datetime.now(timezone.utc)
    assert await auth_api._resolve_active_refresh_session_jti(_Session(), user_id, None) is None

    foreign_row = SimpleNamespace(user_id=uuid4(), revoked=False, expires_at=now + timedelta(hours=1), jti='foreign')
    assert (
        await auth_api._resolve_active_refresh_session_jti(
            _Session(_ExecResult(scalar=foreign_row)),
            user_id,
            'candidate',
        )
        is None
    )

    active_row = SimpleNamespace(user_id=user_id, revoked=False, expires_at=datetime.now() + timedelta(hours=1), jti='active-jti')
    assert (
        await auth_api._resolve_active_refresh_session_jti(
            _Session(_ExecResult(scalar=active_row)),
            user_id,
            'candidate',
        )
        == 'active-jti'
    )

    revoked_without_replacement = SimpleNamespace(
        user_id=user_id,
        revoked=True,
        expires_at=now + timedelta(hours=1),
        jti='old',
        replaced_by_jti=' ',
    )
    assert (
        await auth_api._resolve_active_refresh_session_jti(
            _Session(_ExecResult(scalar=revoked_without_replacement)),
            user_id,
            'candidate',
        )
        is None
    )

    revoked_with_replacement = SimpleNamespace(
        user_id=user_id,
        revoked=True,
        expires_at=now + timedelta(hours=1),
        jti='old',
        replaced_by_jti='new-jti',
    )
    replacement = SimpleNamespace(user_id=user_id, revoked=False, expires_at=now + timedelta(hours=1), jti='new-jti')
    assert (
        await auth_api._resolve_active_refresh_session_jti(
            _Session(_ExecResult(scalar=revoked_with_replacement), _ExecResult(scalar=replacement)),
            user_id,
            'candidate',
        )
        == 'new-jti'
    )

    expired_replacement = SimpleNamespace(user_id=user_id, revoked=False, expires_at=now - timedelta(seconds=1), jti='new-jti')
    assert (
        await auth_api._resolve_active_refresh_session_jti(
            _Session(_ExecResult(scalar=revoked_with_replacement), _ExecResult(scalar=expired_replacement)),
            user_id,
            'candidate',
        )
        is None
    )


def test_auth_registration_consent_helpers() -> None:
    auth_api._require_registration_consents(True, True)
    with pytest.raises(HTTPException, match='Legal consents required'):
        auth_api._require_registration_consents(False, True)

    class _ConsentSession:
        def __init__(self) -> None:
            self.added: list[object] = []

        def add(self, value: object) -> None:
            self.added.append(value)

    session = _ConsentSession()
    user_id = uuid4()
    auth_api._record_registration_consents(
        session,
        user_id=user_id,
        consent_versions={'page.terms-and-conditions': 2, 'page.privacy-policy': 3},
    )
    assert len(session.added) == 2
    assert {record.doc_key for record in session.added} == {'page.terms-and-conditions', 'page.privacy-policy'}
    assert all(record.user_id == user_id for record in session.added)


def test_auth_google_state_and_cookie_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    state = auth_api._build_google_state('google_state', 'user-1')
    assert isinstance(state, str)
    assert state.count('.') == 2

    monkeypatch.setattr(
        auth_api.security,
        'decode_token',
        lambda token: {'type': 'google_state', 'uid': 'user-1'} if token == 'valid' else None,
    )
    auth_api._validate_google_state('valid', 'google_state')
    auth_api._validate_google_state('valid', 'google_state', expected_user_id='user-1')
    with pytest.raises(HTTPException, match='Invalid state'):
        auth_api._validate_google_state('invalid', 'google_state')
    with pytest.raises(HTTPException, match='Invalid state'):
        auth_api._validate_google_state('valid', 'google_link')
    with pytest.raises(HTTPException, match='Invalid state'):
        auth_api._validate_google_state('valid', 'google_state', expected_user_id='other-user')

    monkeypatch.setattr(auth_api.settings, 'secure_cookies', False, raising=False)
    monkeypatch.setattr(auth_api.settings, 'cookie_samesite', 'Lax', raising=False)
    monkeypatch.setattr(auth_api.settings, 'refresh_token_exp_days', 7, raising=False)
    monkeypatch.setattr(auth_api.settings, 'admin_ip_bypass_cookie_minutes', 0, raising=False)

    refresh_response = Response()
    auth_api.set_refresh_cookie(refresh_response, 'refresh-token', persistent=True)
    refresh_headers = '; '.join(refresh_response.headers.getlist('set-cookie'))
    assert 'refresh_token=refresh-token' in refresh_headers
    assert 'Max-Age=604800' in refresh_headers

    non_persistent_response = Response()
    auth_api.set_refresh_cookie(non_persistent_response, 'refresh-token', persistent=False)
    non_persistent_headers = '; '.join(non_persistent_response.headers.getlist('set-cookie'))
    assert 'refresh_token=refresh-token' in non_persistent_headers
    assert 'Max-Age' not in non_persistent_headers

    clear_response = Response()
    auth_api.clear_refresh_cookie(clear_response)
    clear_headers = '; '.join(clear_response.headers.getlist('set-cookie'))
    assert 'refresh_token=' in clear_headers
    assert 'Max-Age=0' in clear_headers

    bypass_response = Response()
    auth_api.set_admin_ip_bypass_cookie(bypass_response, 'bypass-token')
    bypass_headers = '; '.join(bypass_response.headers.getlist('set-cookie'))
    assert 'admin_ip_bypass=bypass-token' in bypass_headers
    assert 'Max-Age=60' in bypass_headers

    clear_bypass_response = Response()
    auth_api.clear_admin_ip_bypass_cookie(clear_bypass_response)
    clear_bypass_headers = '; '.join(clear_bypass_response.headers.getlist('set-cookie'))
    assert 'admin_ip_bypass=' in clear_bypass_headers
    assert 'Max-Age=0' in clear_bypass_headers


def test_auth_refresh_session_response_and_cooldown_helpers() -> None:
    now = datetime(2026, 2, 20, 12, 0, tzinfo=timezone.utc)
    row = SimpleNamespace(
        id=uuid4(),
        created_at=datetime(2026, 2, 20, 10, 0),
        expires_at=datetime(2026, 2, 20, 13, 0),
        persistent=False,
        jti='session-jti',
        user_agent='Agent/1.0',
        ip_address='198.51.100.10',
        country_code='RO',
    )
    response = auth_api._build_refresh_session_response(row, now=now, current_jti='session-jti')
    assert response is not None
    assert response.is_current is True
    assert response.created_at.tzinfo == timezone.utc
    assert response.expires_at.tzinfo == timezone.utc

    expired = SimpleNamespace(
        id=uuid4(),
        created_at=now - timedelta(hours=2),
        expires_at=now - timedelta(seconds=1),
        persistent=True,
        jti='old-jti',
        user_agent=None,
        ip_address=None,
        country_code=None,
    )
    assert auth_api._build_refresh_session_response(expired, now=now, current_jti='old-jti') is None

    cooldown_disabled = auth_api._build_cooldown_info(
        last=now - timedelta(minutes=1),
        cooldown=timedelta(minutes=5),
        enforce=False,
        now=now,
    )
    assert cooldown_disabled.remaining_seconds == 0
    assert cooldown_disabled.next_allowed_at is None

    cooldown_active = auth_api._build_cooldown_info(
        last=now - timedelta(seconds=30),
        cooldown=timedelta(minutes=1),
        enforce=True,
        now=now,
    )
    assert cooldown_active.remaining_seconds == 30
    assert cooldown_active.next_allowed_at == now + timedelta(seconds=30)

    cooldown_elapsed = auth_api._build_cooldown_info(
        last=now - timedelta(minutes=5),
        cooldown=timedelta(minutes=1),
        enforce=True,
        now=now,
    )
    assert cooldown_elapsed.remaining_seconds == 0
    assert cooldown_elapsed.next_allowed_at is None

    request = _request(headers={'user-agent': 'CLI/1.0'}, client_host='203.0.113.2')
    assert auth_api._request_user_agent(request) == 'CLI/1.0'
    assert auth_api._request_ip(request) == '203.0.113.2'
    assert auth_api._request_ip(_request(client_host=None)) is None


def test_auth_passkey_and_two_factor_decoding(monkeypatch: pytest.MonkeyPatch) -> None:
    user_id = uuid4()
    challenge = bytes_to_base64url(b'challenge-bytes')

    def _decode_token(token: str) -> dict[str, object] | None:
        mapping = {
            'valid-reg': {'type': 'webauthn', 'purpose': 'register', 'uid': str(user_id), 'challenge': challenge},
            'bad-reg': {'type': 'access'},
            'valid-two-factor': {'type': 'two_factor', 'sub': str(user_id), 'remember': True, 'method': 'passkey'},
            'bad-two-factor': {'type': 'access', 'sub': str(user_id)},
            'valid-login': {'type': 'webauthn', 'purpose': 'login', 'uid': str(user_id), 'challenge': challenge, 'remember': True},
            'bad-login': {'type': 'webauthn', 'purpose': 'register', 'challenge': challenge},
        }
        return mapping.get(token)

    monkeypatch.setattr(auth_api.security, 'decode_token', _decode_token)

    token_payload = auth_api._validated_passkey_registration_token_payload('valid-reg')
    assert token_payload['purpose'] == 'register'
    assert auth_api._decode_passkey_registration_challenge('valid-reg', expected_user_id=user_id) == b'challenge-bytes'

    with pytest.raises(HTTPException, match='Invalid passkey token'):
        auth_api._validated_passkey_registration_token_payload('bad-reg')
    with pytest.raises(HTTPException, match='Invalid passkey token'):
        auth_api._challenge_from_passkey_registration_token_payload(
            {'uid': str(uuid4()), 'challenge': challenge},
            expected_user_id=user_id,
        )
    with pytest.raises(HTTPException, match='Invalid passkey token'):
        auth_api._challenge_from_passkey_registration_token_payload(
            {'uid': str(user_id), 'challenge': ''},
            expected_user_id=user_id,
        )

    def _boom(_value: str) -> bytes:
        raise ValueError('invalid')

    original_base64url_to_bytes = auth_api.base64url_to_bytes
    monkeypatch.setattr(auth_api, 'base64url_to_bytes', _boom)
    with pytest.raises(HTTPException, match='Invalid passkey token'):
        auth_api._challenge_from_passkey_registration_token_payload(
            {'uid': str(user_id), 'challenge': challenge},
            expected_user_id=user_id,
        )
    monkeypatch.setattr(auth_api, 'base64url_to_bytes', original_base64url_to_bytes)

    decoded_user, remember, method = auth_api._decode_two_factor_login_token('valid-two-factor')
    assert decoded_user == user_id
    assert remember is True
    assert method == 'passkey'
    with pytest.raises(HTTPException, match='Invalid two-factor token'):
        auth_api._decode_two_factor_login_token('bad-two-factor')

    expected_challenge, passkey_remember, token_user_id = auth_api._decode_passkey_login_token('valid-login')
    assert expected_challenge == b'challenge-bytes'
    assert passkey_remember is True
    assert token_user_id == str(user_id)
    with pytest.raises(HTTPException, match='Invalid passkey token'):
        auth_api._decode_passkey_login_token('bad-login')


def test_auth_refresh_identity_rotation_and_profile_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    user_id = uuid4()
    request = _request(cookies={'refresh_token': 'good-refresh'})
    assert auth_api._refresh_token_from_request(RefreshRequest(refresh_token='  explicit  '), request) == 'explicit'
    assert auth_api._refresh_token_from_request(RefreshRequest(refresh_token=None), request) == 'good-refresh'

    def _decode_token(token: str) -> dict[str, object] | None:
        mapping = {
            'good-refresh': {'type': 'refresh', 'jti': 'jti-1', 'sub': str(user_id)},
            'wrong-type': {'type': 'access', 'jti': 'jti-1', 'sub': str(user_id)},
            'missing-jti': {'type': 'refresh', 'sub': str(user_id)},
            'bad-sub': {'type': 'refresh', 'jti': 'jti-1', 'sub': 'not-a-uuid'},
        }
        return mapping.get(token)

    monkeypatch.setattr(auth_api.security, 'decode_token', _decode_token)

    with pytest.raises(HTTPException, match='Refresh token missing'):
        auth_api._extract_refresh_identity(
            RefreshRequest(refresh_token=None),
            _request(),
            silent_refresh_probe=False,
            response=None,
        )

    silent_missing = auth_api._extract_refresh_identity(
        RefreshRequest(refresh_token=None),
        _request(),
        silent_refresh_probe=True,
        response=Response(),
    )
    assert isinstance(silent_missing, Response)
    assert silent_missing.status_code == 204

    with pytest.raises(HTTPException, match='Invalid refresh token'):
        auth_api._extract_refresh_identity(
            RefreshRequest(refresh_token='wrong-type'),
            _request(),
            silent_refresh_probe=False,
            response=None,
        )

    identity = auth_api._extract_refresh_identity(
        RefreshRequest(refresh_token='good-refresh'),
        _request(),
        silent_refresh_probe=False,
        response=None,
    )
    assert identity == ('jti-1', user_id)

    silent_bad_payload = auth_api._extract_refresh_identity(
        RefreshRequest(refresh_token='missing-jti'),
        _request(),
        silent_refresh_probe=True,
        response=Response(),
    )
    assert isinstance(silent_bad_payload, Response)
    assert silent_bad_payload.status_code == 204

    silent_bad_sub = auth_api._extract_refresh_identity(
        RefreshRequest(refresh_token='bad-sub'),
        _request(),
        silent_refresh_probe=True,
        response=Response(),
    )
    assert isinstance(silent_bad_sub, Response)
    assert silent_bad_sub.status_code == 204

    now = datetime(2026, 2, 20, 12, 0, tzinfo=timezone.utc)
    rotated = SimpleNamespace(revoked_reason='rotated', rotated_at=now - timedelta(seconds=5), replaced_by_jti='new-jti')
    monkeypatch.setattr(auth_api.settings, 'refresh_token_rotation_grace_seconds', 10, raising=False)
    assert auth_api._rotated_replacement_jti_within_grace(rotated, now=now) == 'new-jti'
    monkeypatch.setattr(auth_api.settings, 'refresh_token_rotation_grace_seconds', 0, raising=False)
    assert auth_api._rotated_replacement_jti_within_grace(rotated, now=now) is None
    monkeypatch.setattr(auth_api.settings, 'refresh_token_rotation_grace_seconds', 60, raising=False)
    assert (
        auth_api._rotated_replacement_jti_within_grace(
            SimpleNamespace(revoked_reason='manual', rotated_at=now, replaced_by_jti='x'),
            now=now,
        )
        is None
    )

    with pytest.raises(HTTPException, match='Phone is required'):
        auth_api._validate_profile_update_required_fields(
            {'phone': '+40723204204'},
            SimpleNamespace(phone=None, first_name='A', last_name='B', date_of_birth='2000-01-01'),
        )

    user = SimpleNamespace(
        phone='old',
        first_name='Old',
        middle_name=None,
        last_name='Name',
        date_of_birth=None,
        preferred_language='en',
    )
    payload = SimpleNamespace(
        phone='+40723204204',
        first_name='New',
        middle_name='Middle',
        last_name='User',
        date_of_birth='2000-01-01',
        preferred_language='ro',
    )
    auth_api._apply_profile_update_values(
        {'phone': True, 'first_name': True, 'preferred_language': True},
        payload,
        user,
    )
    assert user.phone == '+40723204204'
    assert user.first_name == 'New'
    assert user.preferred_language == 'ro'


def test_auth_google_conflict_and_export_path_helpers(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(auth_api.settings, 'google_allowed_domains', ['example.com'], raising=False)
    sub, email, name, picture, verified = auth_api._extract_valid_google_profile(
        {'sub': 'sub-1', 'email': 'USER@EXAMPLE.COM', 'name': 'User', 'picture': 'pic', 'email_verified': True}
    )
    assert sub == 'sub-1'
    assert email == 'user@example.com'
    assert name == 'User'
    assert picture == 'pic'
    assert verified is True

    with pytest.raises(HTTPException, match='Email domain not allowed'):
        auth_api._extract_valid_google_profile({'sub': 'sub-1', 'email': 'user@blocked.example'})
    with pytest.raises(HTTPException, match='Invalid Google profile'):
        auth_api._extract_valid_google_profile({'sub': '', 'email': ''})

    auth_api._raise_google_email_conflict(None, sub='sub-1')
    with pytest.raises(HTTPException, match='Google account already linked elsewhere'):
        auth_api._raise_google_email_conflict(SimpleNamespace(google_sub='other-sub'), sub='sub-1')
    with pytest.raises(HTTPException, match='already registered'):
        auth_api._raise_google_email_conflict(SimpleNamespace(google_sub=None), sub='sub-1')

    future_job = SimpleNamespace(status=UserDataExportStatus.succeeded, expires_at=datetime.now(timezone.utc) + timedelta(hours=1))
    expired_job = SimpleNamespace(status=UserDataExportStatus.succeeded, expires_at=datetime.now(timezone.utc) - timedelta(hours=1))
    failed_job = SimpleNamespace(status=UserDataExportStatus.failed, expires_at=None)
    assert auth_api._is_reusable_succeeded_export_job(future_job) is True
    assert auth_api._is_reusable_succeeded_export_job(expired_job) is False
    assert auth_api._is_reusable_succeeded_export_job(failed_job) is False

    user_id = uuid4()
    export_path = tmp_path / 'export.json'
    export_path.write_text('{}')
    monkeypatch.setattr(auth_api.private_storage, 'resolve_private_path', lambda _rel: export_path)

    downloadable_job = SimpleNamespace(
        user_id=user_id,
        status=UserDataExportStatus.succeeded,
        file_path='export.json',
        expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
    )
    assert auth_api._resolve_downloadable_export_path(downloadable_job, user_id=user_id) == export_path

    with pytest.raises(HTTPException, match='Export job not found'):
        auth_api._resolve_downloadable_export_path(downloadable_job, user_id=uuid4())
    with pytest.raises(HTTPException, match='Export is not ready'):
        auth_api._resolve_downloadable_export_path(
            SimpleNamespace(
                user_id=user_id,
                status=UserDataExportStatus.pending,
                file_path='export.json',
                expires_at=None,
            ),
            user_id=user_id,
        )
    with pytest.raises(HTTPException, match='Export job not found'):
        auth_api._resolve_downloadable_export_path(
            SimpleNamespace(
                user_id=user_id,
                status=UserDataExportStatus.succeeded,
                file_path='export.json',
                expires_at=datetime.now(timezone.utc) - timedelta(seconds=1),
            ),
            user_id=user_id,
        )

    monkeypatch.setattr(auth_api.private_storage, 'resolve_private_path', lambda _rel: tmp_path / 'missing.json')
    with pytest.raises(HTTPException, match='Export file not found'):
        auth_api._resolve_downloadable_export_path(downloadable_job, user_id=user_id)

    filename = auth_api._export_download_filename(
        SimpleNamespace(
            finished_at=datetime(2026, 2, 20, tzinfo=timezone.utc),
            created_at=datetime(2026, 2, 10, tzinfo=timezone.utc),
        )
    )
    assert filename == 'moment-studio-export-2026-02-20.json'
