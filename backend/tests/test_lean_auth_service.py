"""Lean coverage for service-layer flows in ``app.services.auth``.

Targets the secondary-email lifecycle, two-factor setup/enable/disable/verify,
email-verification + password-reset token helpers, refresh-session
revoke/validate and ``exchange_google_code`` error paths. Runs on in-memory
SQLite via the shared session factory; ``create_user`` builds real users.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.core import security
from app.core import totp as totp_core
from app.models.user import (
    EmailVerificationToken,
    PasswordResetToken,
    RefreshSession,
    SecondaryEmailVerificationToken,
)
from app.schemas.user import UserCreate
from app.services import auth as svc
from tests.conftest import make_memory_session_factory

pytestmark = pytest.mark.anyio


@pytest.fixture(scope="module")
def session_factory():
    return make_memory_session_factory()


_counter = {"n": 0}


async def _new_user(session, **overrides):
    _counter["n"] += 1
    n = _counter["n"]
    data = dict(
        email=f"u{n}-{uuid.uuid4().hex[:6]}@x.io",
        username=f"user{n}{uuid.uuid4().hex[:4]}",
        password="password1",
        name="User",
        first_name="Test",
        last_name="User",
        date_of_birth="2000-01-01",
        phone="+40723204204",
    )
    data.update(overrides)
    return await svc.create_user(session, UserCreate(**data))


def _valid_totp(secret: str) -> str:
    from app.core.config import settings

    key = totp_core._base32_decode(secret)
    counter = int(datetime.now(timezone.utc).timestamp()) // int(
        settings.two_factor_totp_period_seconds
    )
    return totp_core._totp(
        key, counter, digits=int(settings.two_factor_totp_digits)
    )


# --------------------------------------------------------------------------- #
# Secondary email lifecycle                                                    #
# --------------------------------------------------------------------------- #
async def test_add_secondary_email_validation(session_factory) -> None:
    async with session_factory() as session:
        user = await _new_user(session)

        with pytest.raises(HTTPException) as blank:
            await svc.add_secondary_email(session, user, "  ")
        assert blank.value.status_code == 400

        with pytest.raises(HTTPException) as same:
            await svc.add_secondary_email(session, user, user.email)
        assert same.value.status_code == 400

        other = await _new_user(session)
        with pytest.raises(HTTPException) as taken:
            await svc.add_secondary_email(session, user, other.email)
        assert taken.value.status_code == 400


async def test_secondary_email_full_flow(session_factory) -> None:
    async with session_factory() as session:
        user = await _new_user(session)
        secondary, token = await svc.add_secondary_email(
            session, user, "extra@x.io"
        )
        assert secondary.verified is False

        listed = await svc.list_secondary_emails(session, user.id)
        assert any(s.id == secondary.id for s in listed)

        # Request a new verification token (revokes the first).
        new_token = await svc.request_secondary_email_verification(
            session, user, secondary.id
        )
        assert new_token.id != token.id

        confirmed = await svc.confirm_secondary_email_verification(
            session, new_token.token
        )
        assert confirmed.verified is True

        # Confirming again with an already-verified email's token -> invalid.
        with pytest.raises(HTTPException):
            await svc.confirm_secondary_email_verification(session, new_token.token)


async def test_request_secondary_verification_guards(session_factory) -> None:
    async with session_factory() as session:
        user = await _new_user(session)

        with pytest.raises(HTTPException) as missing:
            await svc.request_secondary_email_verification(
                session, user, uuid.uuid4()
            )
        assert missing.value.status_code == 404

        secondary, _ = await svc.add_secondary_email(session, user, "v@x.io")
        await svc.confirm_secondary_email_verification(
            session,
            (
                await svc.request_secondary_email_verification(
                    session, user, secondary.id
                )
            ).token,
        )
        with pytest.raises(HTTPException) as already:
            await svc.request_secondary_email_verification(
                session, user, secondary.id
            )
        assert already.value.status_code == 400


async def test_confirm_secondary_invalid_and_expired(session_factory) -> None:
    async with session_factory() as session:
        user = await _new_user(session)

        with pytest.raises(HTTPException):
            await svc.confirm_secondary_email_verification(session, "   ")
        with pytest.raises(HTTPException):
            await svc.confirm_secondary_email_verification(session, "no-such-token")

        secondary, token = await svc.add_secondary_email(session, user, "exp@x.io")
        rec = await session.get(SecondaryEmailVerificationToken, token.id)
        rec.expires_at = datetime.now(timezone.utc) - timedelta(hours=1)
        session.add(rec)
        await session.commit()
        with pytest.raises(HTTPException):
            await svc.confirm_secondary_email_verification(session, token.token)


async def test_delete_secondary_email(session_factory) -> None:
    async with session_factory() as session:
        user = await _new_user(session)
        with pytest.raises(HTTPException) as missing:
            await svc.delete_secondary_email(session, user, uuid.uuid4())
        assert missing.value.status_code == 404

        secondary, _ = await svc.add_secondary_email(session, user, "del@x.io")
        await svc.delete_secondary_email(session, user, secondary.id)
        assert await svc.list_secondary_emails(session, user.id) == []


async def test_make_secondary_primary_guards_and_happy(session_factory) -> None:
    async with session_factory() as session:
        # Google-linked user cannot change primary.
        google_user = await _new_user(session)
        google_user.google_sub = "gsub-123"
        session.add(google_user)
        await session.commit()
        with pytest.raises(HTTPException) as g:
            await svc.make_secondary_email_primary(
                session, google_user, uuid.uuid4()
            )
        assert g.value.status_code == 400

        user = await _new_user(session)
        with pytest.raises(HTTPException) as missing:
            await svc.make_secondary_email_primary(session, user, uuid.uuid4())
        assert missing.value.status_code == 404

        secondary, token = await svc.add_secondary_email(
            session, user, "promote@x.io"
        )
        with pytest.raises(HTTPException) as unverified:
            await svc.make_secondary_email_primary(session, user, secondary.id)
        assert unverified.value.status_code == 400

        await svc.confirm_secondary_email_verification(session, token.token)
        old_primary = user.email
        updated = await svc.make_secondary_email_primary(
            session, user, secondary.id
        )
        assert updated.email == "promote@x.io"
        # The old primary becomes a secondary email.
        secondaries = await svc.list_secondary_emails(session, user.id)
        assert any(s.email == old_primary for s in secondaries)


# --------------------------------------------------------------------------- #
# authenticate_user                                                            #
# --------------------------------------------------------------------------- #
async def test_authenticate_user_paths(session_factory) -> None:
    async with session_factory() as session:
        user = await _new_user(session)

        # By username.
        ok = await svc.authenticate_user(session, user.username, "password1")
        assert ok.id == user.id
        # By email.
        ok2 = await svc.authenticate_user(session, user.email, "password1")
        assert ok2.id == user.id

        # Wrong password.
        with pytest.raises(HTTPException) as bad:
            await svc.authenticate_user(session, user.email, "wrong")
        assert bad.value.status_code == 401

        # Unknown identifier.
        with pytest.raises(HTTPException):
            await svc.authenticate_user(session, "ghost", "password1")


async def test_authenticate_user_locked_and_reset_required(session_factory) -> None:
    async with session_factory() as session:
        locked = await _new_user(session)
        locked.locked_until = datetime.now(timezone.utc) + timedelta(hours=1)
        session.add(locked)
        await session.commit()
        with pytest.raises(HTTPException) as lk:
            await svc.authenticate_user(session, locked.email, "password1")
        assert lk.value.status_code == 403

        reset = await _new_user(session)
        reset.password_reset_required = True
        session.add(reset)
        await session.commit()
        with pytest.raises(HTTPException) as rr:
            await svc.authenticate_user(session, reset.email, "password1")
        assert rr.value.status_code == 403


# --------------------------------------------------------------------------- #
# Username / display name updates                                              #
# --------------------------------------------------------------------------- #
async def test_update_username_paths(session_factory) -> None:
    async with session_factory() as session:
        user = await _new_user(session)

        # No-op (same username).
        same = await svc.update_username(session, user, user.username)
        assert same.username == user.username

        # A complete profile with recent history is rate-limited.
        with pytest.raises(HTTPException) as cooldown:
            await svc.update_username(session, user, "brandnewname")
        assert cooldown.value.status_code == 429

        # Incomplete profile skips the cooldown; clashing username -> 400.
        incomplete = await _new_user(session)
        incomplete.first_name = None  # makes _profile_is_complete() False
        session.add(incomplete)
        await session.commit()
        with pytest.raises(HTTPException) as taken:
            await svc.update_username(session, incomplete, user.username)
        assert taken.value.status_code == 400

        # Incomplete profile happy path (no clash, no cooldown).
        renamed = await svc.update_username(session, incomplete, "freshuniquename")
        assert renamed.username == "freshuniquename"


async def test_update_display_name_paths(session_factory) -> None:
    async with session_factory() as session:
        user = await _new_user(session)

        with pytest.raises(HTTPException) as blank:
            await svc.update_display_name(session, user, "   ")
        assert blank.value.status_code == 400

        # No-op (same name).
        same = await svc.update_display_name(session, user, user.name)
        assert same.name == user.name

        # Complete profile + recent history -> cooldown.
        with pytest.raises(HTTPException) as cooldown:
            await svc.update_display_name(session, user, "A Totally New Name")
        assert cooldown.value.status_code == 429

        history = await svc.list_display_name_history(session, user.id)
        assert history
        uname_history = await svc.list_username_history(session, user.id)
        assert uname_history


# --------------------------------------------------------------------------- #
# update_email                                                                 #
# --------------------------------------------------------------------------- #
async def test_update_email_paths(session_factory) -> None:
    async with session_factory() as session:
        user = await _new_user(session)

        with pytest.raises(HTTPException) as blank:
            await svc.update_email(session, user, "  ")
        assert blank.value.status_code == 400

        # No-op (same email).
        same = await svc.update_email(session, user, user.email)
        assert same.email == user.email

        # Google-linked user blocked.
        gu = await _new_user(session)
        gu.google_sub = "g-1"
        session.add(gu)
        await session.commit()
        with pytest.raises(HTTPException) as glinked:
            await svc.update_email(session, gu, "new@x.io")
        assert glinked.value.status_code == 400

        # Email attached as secondary -> blocked.
        await svc.add_secondary_email(session, user, "second@x.io")
        with pytest.raises(HTTPException) as sec:
            await svc.update_email(session, user, "second@x.io")
        assert sec.value.status_code == 400

        # Taken by another user.
        other = await _new_user(session)
        with pytest.raises(HTTPException) as taken:
            await svc.update_email(session, user, other.email)
        assert taken.value.status_code == 400

        # Happy path.
        updated = await svc.update_email(session, user, "fresh@x.io")
        assert updated.email == "fresh@x.io"
        assert updated.email_verified is False


# --------------------------------------------------------------------------- #
# Small helpers                                                                #
# --------------------------------------------------------------------------- #
def test_recovery_code_format_empty() -> None:
    assert svc._format_recovery_code("") == ""
    assert svc._format_recovery_code("abcd1234") == "ABCD-1234"


async def test_record_security_event_and_seen_device(session_factory) -> None:
    async with session_factory() as session:
        user = await _new_user(session)
        await svc.record_security_event(
            session,
            user.id,
            "login",
            user_agent="UA",
            ip_address="1.2.3.4",
        )

        # First time this device is seen -> False; afterwards -> True.
        seen_first = await svc.has_seen_refresh_device(
            session, user_id=user.id, user_agent="Mozilla/5.0"
        )
        assert seen_first is False
        await svc.issue_tokens_for_user(session, user, user_agent="Mozilla/5.0")
        seen_after = await svc.has_seen_refresh_device(
            session, user_id=user.id, user_agent="Mozilla/5.0"
        )
        assert seen_after is True


# --------------------------------------------------------------------------- #
# Two-factor                                                                   #
# --------------------------------------------------------------------------- #
async def test_two_factor_setup_enable_verify_disable(session_factory) -> None:
    async with session_factory() as session:
        user = await _new_user(session)

        secret, otpauth = await svc.start_two_factor_setup(session, user)
        assert otpauth.startswith("otpauth://")

        # Starting again while not yet enabled is allowed; enabling with a bad
        # code fails.
        with pytest.raises(HTTPException) as bad:
            await svc.enable_two_factor(session, user, "000000")
        assert bad.value.status_code == 400

        codes = await svc.enable_two_factor(session, user, _valid_totp(secret))
        assert codes and user.two_factor_enabled is True

        # Already enabled -> setup + enable both rejected.
        with pytest.raises(HTTPException):
            await svc.start_two_factor_setup(session, user)
        with pytest.raises(HTTPException):
            await svc.enable_two_factor(session, user, _valid_totp(secret))

        # Verify by TOTP and by a recovery code (which is then consumed).
        assert await svc.verify_two_factor_code(session, user, _valid_totp(secret))
        assert await svc.verify_two_factor_code(session, user, codes[0]) is True
        assert await svc.verify_two_factor_code(session, user, codes[0]) is False
        assert await svc.verify_two_factor_code(session, user, "") is False

        regenerated = await svc.regenerate_recovery_codes(session, user)
        assert regenerated

        await svc.disable_two_factor(session, user)
        assert user.two_factor_enabled is False


async def test_two_factor_enable_without_setup_and_regen_guard(
    session_factory,
) -> None:
    async with session_factory() as session:
        user = await _new_user(session)
        with pytest.raises(HTTPException) as no_setup:
            await svc.enable_two_factor(session, user, "123456")
        assert no_setup.value.status_code == 400

        with pytest.raises(HTTPException) as not_enabled:
            await svc.regenerate_recovery_codes(session, user)
        assert not_enabled.value.status_code == 400


# --------------------------------------------------------------------------- #
# Email verification                                                           #
# --------------------------------------------------------------------------- #
async def test_email_verification_flow(session_factory) -> None:
    async with session_factory() as session:
        user = await _new_user(session)
        record = await svc.create_email_verification(session, user)

        # Re-issuing revokes the prior token.
        record2 = await svc.create_email_verification(session, user)
        old = await session.get(EmailVerificationToken, record.id)
        assert old.used is True

        confirmed = await svc.confirm_email_verification(session, record2.token)
        assert confirmed.email_verified is True


async def test_confirm_email_verification_invalid_and_expired(
    session_factory,
) -> None:
    async with session_factory() as session:
        user = await _new_user(session)
        with pytest.raises(HTTPException):
            await svc.confirm_email_verification(session, "  ")
        with pytest.raises(HTTPException):
            await svc.confirm_email_verification(session, "missing")

        record = await svc.create_email_verification(session, user)
        rec = await session.get(EmailVerificationToken, record.id)
        rec.expires_at = datetime.now(timezone.utc) - timedelta(hours=1)
        session.add(rec)
        await session.commit()
        with pytest.raises(HTTPException):
            await svc.confirm_email_verification(session, record.token)


# --------------------------------------------------------------------------- #
# Password reset tokens                                                        #
# --------------------------------------------------------------------------- #
async def test_reset_token_create_and_confirm(session_factory) -> None:
    async with session_factory() as session:
        user = await _new_user(session)
        token = await svc.create_reset_token(session, user.email)
        assert token is not None

        # Unknown email -> None.
        assert await svc.create_reset_token(session, "ghost@nowhere.io") is None

        # Re-issuing revokes the prior token.
        token2 = await svc.create_reset_token(session, user.email)
        old = await session.get(PasswordResetToken, token.id)
        assert old.used is True

        confirmed = await svc.confirm_reset_token(
            session, token2.token, "NewPassword1"
        )
        assert confirmed.id == user.id

        # Used token no longer valid.
        with pytest.raises(HTTPException):
            await svc.confirm_reset_token(session, token2.token, "NewPassword2")


async def test_confirm_reset_token_invalid(session_factory) -> None:
    async with session_factory() as session:
        with pytest.raises(HTTPException):
            await svc.confirm_reset_token(session, "  ", "X")
        with pytest.raises(HTTPException):
            await svc.confirm_reset_token(session, "nope", "X")


# --------------------------------------------------------------------------- #
# Refresh sessions                                                             #
# --------------------------------------------------------------------------- #
async def test_refresh_token_validate_and_revoke(session_factory) -> None:
    async with session_factory() as session:
        user = await _new_user(session)
        tokens = await svc.issue_tokens_for_user(session, user)
        refresh = tokens["refresh_token"]

        stored = await svc.validate_refresh_token(session, refresh)
        assert stored.jti

        # Revoke a non-existent jti -> no error.
        await svc.revoke_refresh_token(session, "nope")
        # Revoke the real session.
        await svc.revoke_refresh_token(session, stored.jti, reason="logout")
        with pytest.raises(HTTPException):
            await svc.validate_refresh_token(session, refresh)


async def test_validate_refresh_token_rejects_bad_payloads(session_factory) -> None:
    async with session_factory() as session:
        # Non-refresh token type.
        access = security.create_access_token(subject="u")
        with pytest.raises(HTTPException):
            await svc.validate_refresh_token(session, access)

        # Garbage token.
        with pytest.raises(HTTPException):
            await svc.validate_refresh_token(session, "not.a.jwt")

        # Valid refresh token but no stored RefreshSession row.
        orphan = security.create_refresh_token(subject="ghost", jti=uuid.uuid4().hex)
        with pytest.raises(HTTPException):
            await svc.validate_refresh_token(session, orphan)

        # Stored but expired.
        user = await _new_user(session)
        tokens = await svc.issue_tokens_for_user(session, user)
        stored = await svc.validate_refresh_token(session, tokens["refresh_token"])
        row = await session.get(RefreshSession, stored.id)
        row.expires_at = datetime.now(timezone.utc) - timedelta(days=1)
        session.add(row)
        await session.commit()
        with pytest.raises(HTTPException):
            await svc.validate_refresh_token(session, tokens["refresh_token"])


# --------------------------------------------------------------------------- #
# Google code exchange                                                         #
# --------------------------------------------------------------------------- #
async def test_exchange_google_code_not_configured(monkeypatch) -> None:
    monkeypatch.setattr(svc.settings, "google_client_id", "", raising=False)
    with pytest.raises(HTTPException) as exc:
        await svc.exchange_google_code("code")
    assert exc.value.status_code == 400


async def test_exchange_google_code_success_and_failures(monkeypatch) -> None:
    monkeypatch.setattr(svc.settings, "google_client_id", "cid", raising=False)
    monkeypatch.setattr(
        svc.settings, "google_client_secret", "secret", raising=False
    )
    monkeypatch.setattr(
        svc.settings, "google_redirect_uri", "https://x/cb", raising=False
    )

    class _Resp:
        def __init__(self, status_code, payload):
            self.status_code = status_code
            self._payload = payload

        def json(self):
            return self._payload

    class _Client:
        def __init__(self, *, token, user):
            self._token = token
            self._user = user

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, data=None):
            return self._token

        async def get(self, url, headers=None):
            return self._user

    # Token endpoint non-200.
    monkeypatch.setattr(
        svc.httpx,
        "AsyncClient",
        lambda *a, **k: _Client(token=_Resp(400, {}), user=_Resp(200, {})),
    )
    with pytest.raises(HTTPException):
        await svc.exchange_google_code("code")

    # Missing access token.
    monkeypatch.setattr(
        svc.httpx,
        "AsyncClient",
        lambda *a, **k: _Client(token=_Resp(200, {}), user=_Resp(200, {})),
    )
    with pytest.raises(HTTPException):
        await svc.exchange_google_code("code")

    # Userinfo non-200.
    monkeypatch.setattr(
        svc.httpx,
        "AsyncClient",
        lambda *a, **k: _Client(
            token=_Resp(200, {"access_token": "at"}), user=_Resp(401, {})
        ),
    )
    with pytest.raises(HTTPException):
        await svc.exchange_google_code("code")

    # Happy path.
    monkeypatch.setattr(
        svc.httpx,
        "AsyncClient",
        lambda *a, **k: _Client(
            token=_Resp(200, {"access_token": "at"}),
            user=_Resp(200, {"email": "g@x.io", "sub": "123"}),
        ),
    )
    profile = await svc.exchange_google_code("code")
    assert profile["email"] == "g@x.io"
