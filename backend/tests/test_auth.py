import base64
import asyncio
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
from typing import Callable, Dict
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from webauthn.helpers import bytes_to_base64url

from app.main import app
from app.core.config import settings
from app.db.base import Base
from app.db.session import get_session
from app.models.legal import LegalConsent, LegalConsentContext
from app.models.passkeys import UserPasskey
from app.models.content import ContentBlock, ContentStatus
from app.models.user import User, UserRole, UserDisplayNameHistory, UserUsernameHistory


@pytest.fixture
def test_app() -> Dict[str, object]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

    async def init_models() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with SessionLocal() as session:
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
        async with SessionLocal() as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session
    client = TestClient(app)
    yield {"client": client, "session_factory": SessionLocal}
    client.close()
    app.dependency_overrides.clear()


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def make_register_payload(
    *,
    email: str,
    username: str,
    password: str = "supersecret",
    name: str = "User",
    first_name: str = "Test",
    last_name: str = "User",
    middle_name: str | None = None,
    date_of_birth: str = "2000-01-01",
    phone: str = "+40723204204",
    accept_terms: bool = True,
    accept_privacy: bool = True,
) -> dict[str, object]:
    payload: dict[str, object] = {
        "email": email,
        "username": username,
        "password": password,
        "name": name,
        "first_name": first_name,
        "last_name": last_name,
        "date_of_birth": date_of_birth,
        "phone": phone,
        "accept_terms": accept_terms,
        "accept_privacy": accept_privacy,
    }
    if middle_name is not None:
        payload["middle_name"] = middle_name
    return payload


def _totp_code(secret: str, *, now: datetime | None = None) -> str:
    now_dt = now or datetime.now(timezone.utc)
    period = int(getattr(settings, "two_factor_totp_period_seconds", 30) or 30)
    digits = int(getattr(settings, "two_factor_totp_digits", 6) or 6)
    counter = int(now_dt.timestamp()) // period

    clean = (secret or "").strip().upper().replace(" ", "")
    padding = "=" * ((8 - len(clean) % 8) % 8)
    key = base64.b32decode(clean + padding, casefold=True)

    msg = counter.to_bytes(8, "big")
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    chunk = digest[offset : offset + 4]
    value = int.from_bytes(chunk, "big") & 0x7FFFFFFF
    code = value % (10 ** digits)
    return f"{code:0{digits}d}"


def test_register_and_login_flow(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]

    register_payload = make_register_payload(email="user@example.com", username="user", name="User")
    res = client.post("/api/v1/auth/register", json=register_payload)
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["user"]["email"] == "user@example.com"
    assert body["user"]["username"] == "user"
    assert body["tokens"]["access_token"]
    assert body["tokens"]["refresh_token"]

    # Login by email
    res = client.post("/api/v1/auth/login", json={"identifier": "user@example.com", "password": "supersecret"})
    assert res.status_code == 200, res.text
    tokens = res.json()["tokens"]
    assert tokens["access_token"]
    assert tokens["refresh_token"]

    # Login by username
    res = client.post("/api/v1/auth/login", json={"identifier": "user", "password": "supersecret"})
    assert res.status_code == 200, res.text

    # Refresh
    res = client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert res.status_code == 200, res.text
    refreshed = res.json()
    assert refreshed["access_token"]
    assert refreshed["refresh_token"]


def test_register_requires_legal_consents(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]

    register_payload = make_register_payload(
        email="noconsent@example.com",
        username="noconsent",
        name="No Consent",
        accept_terms=False,
        accept_privacy=False,
    )
    res = client.post("/api/v1/auth/register", json=register_payload)
    assert res.status_code == 400, res.text
    assert res.json().get("detail") == "Legal consents required"


def test_register_records_legal_consents(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]

    register_payload = make_register_payload(email="consented@example.com", username="consented", name="Consented")
    res = client.post("/api/v1/auth/register", json=register_payload)
    assert res.status_code == 201, res.text
    user_id = UUID(res.json()["user"]["id"])

    async def read_consents() -> list[LegalConsent]:
        async with SessionLocal() as session:
            rows = (
                (await session.execute(select(LegalConsent).where(LegalConsent.user_id == user_id)))
                .scalars()
                .all()
            )
            return list(rows)

    consents = asyncio.run(read_consents())
    assert len(consents) == 2
    assert {c.doc_key for c in consents} == {"page.terms-and-conditions", "page.privacy-policy"}
    assert all(c.context == LegalConsentContext.register for c in consents)
    assert all(c.doc_version == 1 for c in consents)


def test_cooldowns_endpoint_returns_next_allowed_times(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]

    register_payload = make_register_payload(email="cooldowns@example.com", username="cooldowns", name="Cooldowns")
    res = client.post("/api/v1/auth/register", json=register_payload)
    assert res.status_code == 201, res.text
    access = res.json()["tokens"]["access_token"]

    cooldowns = client.get("/api/v1/auth/me/cooldowns", headers=auth_headers(access))
    assert cooldowns.status_code == 200, cooldowns.text
    body = cooldowns.json()
    assert body["username"]["remaining_seconds"] > 0
    assert body["username"]["next_allowed_at"]
    assert body["display_name"]["remaining_seconds"] > 0
    assert body["display_name"]["next_allowed_at"]
    assert body["email"]["remaining_seconds"] == 0
    assert body["email"]["next_allowed_at"] is None


def test_sessions_list_and_revoke_others(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]

    register_payload = make_register_payload(email="sess@example.com", username="sess1", name="Sess")
    res = client.post("/api/v1/auth/register", json=register_payload)
    assert res.status_code == 201, res.text
    refresh_one = res.json()["tokens"]["refresh_token"]

    login_two = client.post("/api/v1/auth/login", json={"identifier": "sess@example.com", "password": "supersecret"})
    assert login_two.status_code == 200, login_two.text
    access_two = login_two.json()["tokens"]["access_token"]

    sessions_res = client.get("/api/v1/auth/me/sessions", headers=auth_headers(access_two))
    assert sessions_res.status_code == 200, sessions_res.text
    sessions = sessions_res.json()
    assert len(sessions) == 2
    assert sum(1 for s in sessions if s.get("is_current")) == 1

    revoke = client.post("/api/v1/auth/me/sessions/revoke-others", headers=auth_headers(access_two), json={"password": "supersecret"})
    assert revoke.status_code == 200, revoke.text
    assert revoke.json()["revoked"] == 1

    sessions_after = client.get("/api/v1/auth/me/sessions", headers=auth_headers(access_two))
    assert sessions_after.status_code == 200, sessions_after.text
    after = sessions_after.json()
    assert len(after) == 1
    assert after[0]["is_current"] is True

    refresh_old = client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_one})
    assert refresh_old.status_code == 401, refresh_old.text


def test_security_events_include_logins_email_and_password_changes(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]

    res = client.post(
        "/api/v1/auth/register",
        json=make_register_payload(email="activity@example.com", username="activity", password="supersecret", name="Activity"),
    )
    assert res.status_code == 201, res.text
    access = res.json()["tokens"]["access_token"]

    first = client.get("/api/v1/auth/me/security-events", headers=auth_headers(access))
    assert first.status_code == 200, first.text
    first_types = {e["event_type"] for e in first.json()}
    assert "login_password" in first_types

    pw = client.post(
        "/api/v1/auth/password/change",
        headers=auth_headers(access),
        json={"current_password": "supersecret", "new_password": "newsecret"},
    )
    assert pw.status_code == 200, pw.text

    email = client.patch(
        "/api/v1/auth/me/email",
        headers=auth_headers(access),
        json={"email": "activity2@example.com", "password": "newsecret"},
    )
    assert email.status_code == 200, email.text

    events = client.get("/api/v1/auth/me/security-events", headers=auth_headers(access))
    assert events.status_code == 200, events.text
    event_types = {e["event_type"] for e in events.json()}
    assert "login_password" in event_types
    assert "password_changed" in event_types
    assert "email_changed" in event_types


def test_two_factor_setup_and_login_flow(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]

    res = client.post(
        "/api/v1/auth/register",
        json=make_register_payload(email="2fa@example.com", username="twofactor", password="supersecret", name="2FA"),
    )
    assert res.status_code == 201, res.text
    access = res.json()["tokens"]["access_token"]

    setup = client.post("/api/v1/auth/me/2fa/setup", headers=auth_headers(access), json={"password": "supersecret"})
    assert setup.status_code == 200, setup.text
    secret = setup.json()["secret"]

    enable = client.post(
        "/api/v1/auth/me/2fa/enable",
        headers=auth_headers(access),
        json={"code": _totp_code(secret)},
    )
    assert enable.status_code == 200, enable.text
    recovery_codes = enable.json()["recovery_codes"]
    assert isinstance(recovery_codes, list)
    assert len(recovery_codes) >= 5

    status = client.get("/api/v1/auth/me/2fa", headers=auth_headers(access))
    assert status.status_code == 200, status.text
    assert status.json()["enabled"] is True
    assert status.json()["recovery_codes_remaining"] == len(recovery_codes)

    login = client.post("/api/v1/auth/login", json={"identifier": "2fa@example.com", "password": "supersecret"})
    assert login.status_code == 200, login.text
    body = login.json()
    assert body.get("requires_two_factor") is True
    assert body.get("two_factor_token")
    assert body.get("tokens") is None

    two_factor_token = body["two_factor_token"]
    login2 = client.post("/api/v1/auth/login/2fa", json={"two_factor_token": two_factor_token, "code": _totp_code(secret)})
    assert login2.status_code == 200, login2.text
    assert login2.json()["tokens"]["access_token"]

    # Recovery codes should work and be consumed.
    recovery_code = recovery_codes[0]
    login = client.post("/api/v1/auth/login", json={"identifier": "2fa@example.com", "password": "supersecret"})
    token3 = login.json()["two_factor_token"]
    login3 = client.post("/api/v1/auth/login/2fa", json={"two_factor_token": token3, "code": recovery_code})
    assert login3.status_code == 200, login3.text
    access2 = login3.json()["tokens"]["access_token"]

    status2 = client.get("/api/v1/auth/me/2fa", headers=auth_headers(access2))
    assert status2.status_code == 200, status2.text
    assert status2.json()["enabled"] is True
    assert status2.json()["recovery_codes_remaining"] == len(recovery_codes) - 1


def test_passkeys_register_list_and_login_flow(monkeypatch: pytest.MonkeyPatch, test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]

    res = client.post(
        "/api/v1/auth/register",
        json=make_register_payload(email="passkeys@example.com", username="passkeys", password="supersecret", name="Passkeys"),
    )
    assert res.status_code == 201, res.text
    access = res.json()["tokens"]["access_token"]

    class DummyVerifiedRegistration:
        credential_id = b"cred123"
        credential_public_key = b"public_key"
        sign_count = 0
        aaguid = "test-aaguid"
        credential_type = "public-key"
        credential_device_type = "single_device"
        credential_backed_up = False

    class DummyVerifiedAuthentication:
        new_sign_count = 1

    def fake_verify_registration_response(**_kwargs):
        return DummyVerifiedRegistration()

    def fake_verify_authentication_response(**_kwargs):
        return DummyVerifiedAuthentication()

    monkeypatch.setattr("app.services.passkeys.verify_registration_response", fake_verify_registration_response)
    monkeypatch.setattr("app.services.passkeys.verify_authentication_response", fake_verify_authentication_response)

    opts = client.post("/api/v1/auth/me/passkeys/register/options", headers=auth_headers(access), json={"password": "supersecret"})
    assert opts.status_code == 200, opts.text
    registration_token = opts.json()["registration_token"]
    assert registration_token

    verify = client.post(
        "/api/v1/auth/me/passkeys/register/verify",
        headers=auth_headers(access),
        json={"registration_token": registration_token, "credential": {"id": "ignored"}, "name": "Laptop"},
    )
    assert verify.status_code == 200, verify.text
    passkey_id = verify.json()["id"]
    assert passkey_id

    listed = client.get("/api/v1/auth/me/passkeys", headers=auth_headers(access))
    assert listed.status_code == 200, listed.text
    keys = listed.json()
    assert isinstance(keys, list)
    assert len(keys) == 1
    assert keys[0]["id"] == passkey_id

    auth_opts = client.post("/api/v1/auth/passkeys/login/options", json={"identifier": "passkeys", "remember": True})
    assert auth_opts.status_code == 200, auth_opts.text
    authentication_token = auth_opts.json()["authentication_token"]
    assert authentication_token

    raw_id = bytes_to_base64url(DummyVerifiedRegistration.credential_id)
    login = client.post(
        "/api/v1/auth/passkeys/login/verify",
        json={"authentication_token": authentication_token, "credential": {"rawId": raw_id, "id": raw_id}},
    )
    assert login.status_code == 200, login.text
    body = login.json()
    assert body["tokens"]["access_token"]

    deleted = client.request(
        "DELETE",
        f"/api/v1/auth/me/passkeys/{passkey_id}",
        headers=auth_headers(access),
        json={"password": "supersecret"},
    )
    assert deleted.status_code == 204, deleted.text

    listed_after = client.get("/api/v1/auth/me/passkeys", headers=auth_headers(access))
    assert listed_after.status_code == 200, listed_after.text
    assert listed_after.json() == []


def test_secondary_emails_flow(monkeypatch: pytest.MonkeyPatch, test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]

    sent: dict[str, str] = {}

    async def fake_send(email: str, token: str, lang: str | None = None, kind: str = "primary"):
        _ = lang
        _ = kind
        sent[email] = token
        return True

    monkeypatch.setattr("app.services.email.send_verification_email", fake_send)

    res = client.post(
        "/api/v1/auth/register",
        json=make_register_payload(email="user@example.com", username="user2", password="supersecret", name="User"),
    )
    assert res.status_code == 201, res.text
    access = res.json()["tokens"]["access_token"]

    add = client.post(
        "/api/v1/auth/me/emails",
        headers=auth_headers(access),
        json={"email": "alt@example.com"},
    )
    assert add.status_code == 201, add.text
    secondary_id = add.json()["id"]
    assert add.json()["email"] == "alt@example.com"
    assert add.json()["verified"] is False
    assert sent.get("alt@example.com")

    confirm = client.post("/api/v1/auth/me/emails/verify/confirm", json={"token": sent["alt@example.com"]})
    assert confirm.status_code == 200, confirm.text
    assert confirm.json()["verified"] is True

    login_secondary = client.post("/api/v1/auth/login", json={"identifier": "alt@example.com", "password": "supersecret"})
    assert login_secondary.status_code == 200, login_secondary.text

    make_primary = client.post(
        f"/api/v1/auth/me/emails/{secondary_id}/make-primary",
        headers=auth_headers(access),
        json={"password": "supersecret"},
    )
    assert make_primary.status_code == 200, make_primary.text
    assert make_primary.json()["email"] == "alt@example.com"

    emails = client.get("/api/v1/auth/me/emails", headers=auth_headers(access))
    assert emails.status_code == 200, emails.text
    body = emails.json()
    assert body["primary_email"] == "alt@example.com"
    assert any(e["email"] == "user@example.com" for e in body["secondary_emails"])

    old_secondary = next((e for e in body["secondary_emails"] if e["email"] == "user@example.com"), None)
    assert old_secondary and old_secondary.get("id")

    register_conflict = client.post(
        "/api/v1/auth/register",
        json=make_register_payload(email="user@example.com", username="dupuser", password="supersecret", name="User"),
    )
    assert register_conflict.status_code == 400

    removed = client.request(
        "DELETE",
        f"/api/v1/auth/me/emails/{old_secondary['id']}",
        headers=auth_headers(access),
        json={"password": "supersecret"},
    )
    assert removed.status_code == 204, removed.text

    emails_after = client.get("/api/v1/auth/me/emails", headers=auth_headers(access))
    assert emails_after.status_code == 200, emails_after.text
    after = emails_after.json()
    assert all(e["email"] != "user@example.com" for e in after["secondary_emails"])


def test_primary_email_verification_strips_whitespace(monkeypatch: pytest.MonkeyPatch, test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]

    sent: dict[str, str] = {}

    async def fake_send(email: str, token: str, lang: str | None = None, kind: str = "primary"):
        _ = lang
        _ = kind
        sent[email] = token
        return True

    monkeypatch.setattr("app.services.email.send_verification_email", fake_send)

    res = client.post(
        "/api/v1/auth/register",
        json=make_register_payload(email="primary@example.com", username="primary", password="supersecret", name="User"),
    )
    assert res.status_code == 201, res.text
    access = res.json()["tokens"]["access_token"]

    token = sent.get("primary@example.com")
    assert token

    mangled = f"  \u200b{token[:12]} \n\t {token[12:]} \u200b  "
    confirm = client.post("/api/v1/auth/verify/confirm", json={"token": mangled})
    assert confirm.status_code == 200, confirm.text
    assert confirm.json()["email_verified"] is True

    me = client.get("/api/v1/auth/me", headers=auth_headers(access))
    assert me.status_code == 200, me.text
    assert me.json()["email_verified"] is True

def test_register_rejects_invalid_phone(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]

    res = client.post(
        "/api/v1/auth/register",
        json=make_register_payload(email="badphone@example.com", username="badphone", phone="0723204204"),
    )
    assert res.status_code == 422, res.text


def test_register_rejects_future_date_of_birth(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]

    res = client.post(
        "/api/v1/auth/register",
        json=make_register_payload(email="baddob@example.com", username="baddob", date_of_birth="2999-01-01"),
    )
    assert res.status_code == 422, res.text


def test_invalid_login_and_refresh(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]

    res = client.post("/api/v1/auth/login", json={"email": "nobody@example.com", "password": "invalidpw"})
    assert res.status_code == 401

    res = client.post("/api/v1/auth/refresh", json={"refresh_token": "not-a-token"})
    assert res.status_code == 401


def test_admin_guard(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal: Callable = test_app["session_factory"]  # type: ignore[assignment]

    # Register user
    res = client.post(
        "/api/v1/auth/register",
        json=make_register_payload(email="admin@example.com", username="admin", password="adminpass", name="Admin"),
    )
    assert res.status_code == 201
    access_token = res.json()["tokens"]["access_token"]

    # Non-admin should be forbidden
    res = client.get("/api/v1/auth/admin/ping", headers={"Authorization": f"Bearer {access_token}"})
    assert res.status_code == 403

    # Promote to admin directly in DB for test
    async def promote() -> None:
        async with SessionLocal() as session:
            result = await session.execute(select(User).where(User.email == "admin@example.com"))
            user = result.scalar_one()
            user.role = UserRole.admin
            session.add(
                UserPasskey(
                    user_id=user.id,
                    name="Test Passkey",
                    credential_id=f"cred-{user.id}",
                    public_key=b"test",
                    sign_count=0,
                    backed_up=False,
                )
            )
            await session.commit()

    asyncio.run(promote())

    # Acquire new tokens after role change
    res = client.post("/api/v1/auth/login", json={"identifier": "admin@example.com", "password": "adminpass"})
    admin_access = res.json()["tokens"]["access_token"]

    res = client.get("/api/v1/auth/admin/ping", headers={"Authorization": f"Bearer {admin_access}"})
    assert res.status_code == 200
    assert res.json()["status"] == "admin-ok"


def test_password_reset_flow(monkeypatch: pytest.MonkeyPatch, test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    sent = {"token": None}

    async def fake_send(email: str, token: str, lang: str | None = None):
        _ = lang
        sent["token"] = token
        return True

    monkeypatch.setattr("app.services.email.send_password_reset", fake_send)

    res = client.post(
        "/api/v1/auth/register",
        json=make_register_payload(email="reset@example.com", username="reset", password="resetpass", name="Reset"),
    )
    assert res.status_code == 201

    req = client.post("/api/v1/auth/password-reset/request", json={"email": "reset@example.com"})
    assert req.status_code == 202
    assert sent["token"]

    confirm = client.post(
        "/api/v1/auth/password-reset/confirm",
        json={"token": sent["token"], "new_password": "newsecret"},
    )
    assert confirm.status_code == 200

    login = client.post("/api/v1/auth/login", json={"identifier": "reset@example.com", "password": "newsecret"})
    assert login.status_code == 200


def test_update_profile_me(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal: Callable = test_app["session_factory"]  # type: ignore[assignment]

    res = client.post(
        "/api/v1/auth/register",
        json=make_register_payload(email="me@example.com", username="me1", password="supersecret", name="Old"),
    )
    assert res.status_code == 201, res.text
    token = res.json()["tokens"]["access_token"]

    patch = client.patch(
        "/api/v1/auth/me",
        json={"phone": "+40723204204", "preferred_language": "ro"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert patch.status_code == 200, patch.text
    body = patch.json()
    assert body["name"] == "Old"
    assert body["phone"] == "+40723204204"
    assert body["preferred_language"] == "ro"
    assert body["notify_marketing"] is False
    assert body["name_tag"] == 0

    blocked = client.patch(
        "/api/v1/auth/me",
        json={"name": "New Name"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert blocked.status_code == 429, blocked.text

    async def rewind_display_name_cooldown() -> None:
        async with SessionLocal() as session:
            user = (await session.execute(select(User).where(User.email == "me@example.com"))).scalar_one()
            history = (
                (
                    await session.execute(
                        select(UserDisplayNameHistory)
                        .where(UserDisplayNameHistory.user_id == user.id)
                        .order_by(UserDisplayNameHistory.created_at.desc())
                        .limit(1)
                    )
                )
                .scalars()
                .one()
            )
            history.created_at = datetime.now(timezone.utc) - timedelta(hours=2)
            await session.commit()

    asyncio.run(rewind_display_name_cooldown())

    ok = client.patch(
        "/api/v1/auth/me",
        json={"name": "New Name"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["name"] == "New Name"

    cleared = client.patch(
        "/api/v1/auth/me",
        json={"phone": "   "},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert cleared.status_code == 400, cleared.text
    assert cleared.json()["detail"] == "Phone is required"


def test_change_password_persists_and_updates_login(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]

    res = client.post(
        "/api/v1/auth/register",
        json=make_register_payload(email="pw@example.com", username="pw1", password="oldsecret", name="PW"),
    )
    assert res.status_code == 201, res.text
    token = res.json()["tokens"]["access_token"]

    wrong = client.post(
        "/api/v1/auth/password/change",
        json={"current_password": "wrong", "new_password": "newsecret"},
        headers=auth_headers(token),
    )
    assert wrong.status_code == 400

    ok = client.post(
        "/api/v1/auth/password/change",
        json={"current_password": "oldsecret", "new_password": "newsecret"},
        headers=auth_headers(token),
    )
    assert ok.status_code == 200, ok.text

    old_login = client.post("/api/v1/auth/login", json={"identifier": "pw@example.com", "password": "oldsecret"})
    assert old_login.status_code == 401

    new_login = client.post("/api/v1/auth/login", json={"identifier": "pw@example.com", "password": "newsecret"})
    assert new_login.status_code == 200, new_login.text


def test_update_notification_preferences(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]

    res = client.post(
        "/api/v1/auth/register",
        json=make_register_payload(email="notify@example.com", username="notify", password="supersecret", name="N"),
    )
    assert res.status_code == 201, res.text
    token = res.json()["tokens"]["access_token"]

    patch = client.patch(
        "/api/v1/auth/me/notifications",
        json={"notify_blog_comments": True, "notify_marketing": True},
        headers=auth_headers(token),
    )
    assert patch.status_code == 200, patch.text
    updated = patch.json()
    assert updated["notify_blog_comments"] is True
    assert updated["notify_marketing"] is True

    me = client.get("/api/v1/auth/me", headers=auth_headers(token))
    assert me.status_code == 200, me.text
    body = me.json()
    assert body["notify_blog_comments"] is True
    assert body["notify_marketing"] is True


def test_alias_history_and_display_name_tags(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal: Callable = test_app["session_factory"]  # type: ignore[assignment]

    res1 = client.post(
        "/api/v1/auth/register",
        json=make_register_payload(email="ana1@example.com", username="ana1", password="supersecret", name="Ana"),
    )
    assert res1.status_code == 201, res1.text
    assert res1.json()["user"]["name_tag"] == 0
    token = res1.json()["tokens"]["access_token"]

    res2 = client.post(
        "/api/v1/auth/register",
        json=make_register_payload(email="ana2@example.com", username="ana2", password="supersecret", name="Ana"),
    )
    assert res2.status_code == 201, res2.text
    assert res2.json()["user"]["name_tag"] == 1

    aliases = client.get("/api/v1/auth/me/aliases", headers=auth_headers(token))
    assert aliases.status_code == 200, aliases.text
    data = aliases.json()
    assert data["usernames"][0]["username"] == "ana1"
    assert data["display_names"][0]["name"] == "Ana"
    assert data["display_names"][0]["name_tag"] == 0

    update = client.patch(
        "/api/v1/auth/me/username",
        json={"username": "ana1-new", "password": "supersecret"},
        headers=auth_headers(token),
    )
    assert update.status_code == 429, update.text

    async def rewind_username_cooldown() -> None:
        async with SessionLocal() as session:
            user = (await session.execute(select(User).where(User.email == "ana1@example.com"))).scalar_one()
            history = (
                (
                    await session.execute(
                        select(UserUsernameHistory)
                        .where(UserUsernameHistory.user_id == user.id)
                        .order_by(UserUsernameHistory.created_at.desc())
                        .limit(1)
                    )
                )
                .scalars()
                .one()
            )
            history.created_at = datetime.now(timezone.utc) - timedelta(days=8)
            await session.commit()

    asyncio.run(rewind_username_cooldown())

    update = client.patch(
        "/api/v1/auth/me/username",
        json={"username": "ana1-new", "password": "supersecret"},
        headers=auth_headers(token),
    )
    assert update.status_code == 200, update.text
    aliases2 = client.get("/api/v1/auth/me/aliases", headers=auth_headers(token))
    assert aliases2.status_code == 200, aliases2.text
    usernames = [u["username"] for u in aliases2.json()["usernames"]]
    assert usernames[:2] == ["ana1-new", "ana1"]


def test_display_name_history_reuses_name_tag_on_revert(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal: Callable = test_app["session_factory"]  # type: ignore[assignment]

    res1 = client.post(
        "/api/v1/auth/register",
        json=make_register_payload(email="tagreuse1@example.com", username="tagreuse1", password="supersecret", name="Ana"),
    )
    assert res1.status_code == 201, res1.text
    token = res1.json()["tokens"]["access_token"]
    assert res1.json()["user"]["name_tag"] == 0

    res2 = client.post(
        "/api/v1/auth/register",
        json=make_register_payload(email="tagreuse2@example.com", username="tagreuse2", password="supersecret", name="Ana"),
    )
    assert res2.status_code == 201, res2.text
    assert res2.json()["user"]["name_tag"] == 1

    renamed = client.patch(
        "/api/v1/auth/me",
        json={"name": "Maria"},
        headers=auth_headers(token),
    )
    assert renamed.status_code == 429, renamed.text

    async def rewind_display_name_cooldown() -> None:
        async with SessionLocal() as session:
            user = (await session.execute(select(User).where(User.email == "tagreuse1@example.com"))).scalar_one()
            history = (
                (
                    await session.execute(
                        select(UserDisplayNameHistory)
                        .where(UserDisplayNameHistory.user_id == user.id)
                        .order_by(UserDisplayNameHistory.created_at.desc())
                        .limit(1)
                    )
                )
                .scalars()
                .one()
            )
            history.created_at = datetime.now(timezone.utc) - timedelta(hours=2)
            await session.commit()

    asyncio.run(rewind_display_name_cooldown())

    renamed = client.patch(
        "/api/v1/auth/me",
        json={"name": "Maria"},
        headers=auth_headers(token),
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["name"] == "Maria"
    assert renamed.json()["name_tag"] == 0

    reverted = client.patch(
        "/api/v1/auth/me",
        json={"name": "Ana"},
        headers=auth_headers(token),
    )
    assert reverted.status_code == 200, reverted.text
    assert reverted.json()["name"] == "Ana"
    assert reverted.json()["name_tag"] == 0

    aliases = client.get("/api/v1/auth/me/aliases", headers=auth_headers(token))
    assert aliases.status_code == 200, aliases.text
    display_names = [(h["name"], h["name_tag"]) for h in aliases.json()["display_names"]]
    assert display_names[0] == ("Ana", 0)
    assert ("Maria", 0) in display_names

    bad = client.patch("/api/v1/auth/me", json={"name": "   "}, headers=auth_headers(token))
    assert bad.status_code == 400
