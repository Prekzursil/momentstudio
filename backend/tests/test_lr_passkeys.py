"""Lean-gate unit coverage for ``app.services.passkeys``."""

from __future__ import annotations

import asyncio
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.passkeys import UserPasskey
from app.models.user import User
from app.services import passkeys


def _memory_session_factory() -> async_sessionmaker:
    import app.models  # noqa: F401
    from app.db.base import Base

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def _init() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_init())
    return factory


@pytest.fixture
def session_factory():
    return _memory_session_factory()


async def _make_user(session) -> User:  # noqa: ANN001
    from app.core import security

    user = User(
        email="pk@example.com",
        username="pk",
        hashed_password=security.hash_password("Password123"),
        name="PK",
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


# --------------------------------------------------------------------------- #
# rp_id / rp_name / allowed_origins                                            #
# --------------------------------------------------------------------------- #
def test_rp_id_explicit(monkeypatch) -> None:
    monkeypatch.setattr(passkeys.settings, "webauthn_rp_id", " example.com ", raising=False)
    assert passkeys.rp_id() == "example.com"


def test_rp_id_from_frontend_origin(monkeypatch) -> None:
    monkeypatch.setattr(passkeys.settings, "webauthn_rp_id", "", raising=False)
    monkeypatch.setattr(
        passkeys.settings, "frontend_origin", "https://shop.test", raising=False
    )
    assert passkeys.rp_id() == "shop.test"


def test_rp_id_fallback_localhost(monkeypatch) -> None:
    monkeypatch.setattr(passkeys.settings, "webauthn_rp_id", "", raising=False)
    monkeypatch.setattr(passkeys.settings, "frontend_origin", "", raising=False)
    assert passkeys.rp_id() == "localhost"


def test_rp_name_explicit(monkeypatch) -> None:
    monkeypatch.setattr(
        passkeys.settings, "webauthn_rp_name", " My Shop ", raising=False
    )
    assert passkeys.rp_name() == "My Shop"


def test_rp_name_from_app_name(monkeypatch) -> None:
    monkeypatch.setattr(passkeys.settings, "webauthn_rp_name", "", raising=False)
    monkeypatch.setattr(passkeys.settings, "app_name", "Moment API", raising=False)
    assert passkeys.rp_name() == "Moment"


def test_allowed_origins_dedup_and_append(monkeypatch) -> None:
    monkeypatch.setattr(
        passkeys.settings,
        "webauthn_allowed_origins",
        ["https://a.test/", "", 123, "https://b.test"],
        raising=False,
    )
    monkeypatch.setattr(
        passkeys.settings, "frontend_origin", "https://front.test/", raising=False
    )
    out = passkeys.allowed_origins()
    assert out == ["https://a.test", "https://b.test", "https://front.test"]


def test_allowed_origins_skips_existing_front(monkeypatch) -> None:
    monkeypatch.setattr(
        passkeys.settings,
        "webauthn_allowed_origins",
        ["https://front.test"],
        raising=False,
    )
    monkeypatch.setattr(
        passkeys.settings, "frontend_origin", "https://front.test", raising=False
    )
    assert passkeys.allowed_origins() == ["https://front.test"]


# --------------------------------------------------------------------------- #
# _jsonify_webauthn_options                                                    #
# --------------------------------------------------------------------------- #
def test_jsonify_handles_bytes_dict_list_passthrough() -> None:
    out = passkeys._jsonify_webauthn_options(
        {"b": b"\x01\x02", "lst": [b"\x03", "x"], "n": 5}
    )
    assert isinstance(out["b"], str)
    assert isinstance(out["lst"][0], str)
    assert out["lst"][1] == "x"
    assert out["n"] == 5


# --------------------------------------------------------------------------- #
# list / generate options                                                      #
# --------------------------------------------------------------------------- #
@pytest.mark.anyio
async def test_generate_registration_options(session_factory, monkeypatch) -> None:
    async with session_factory() as session:
        user = await _make_user(session)
        # Seed an existing passkey so exclude_credentials is populated.
        session.add(
            UserPasskey(
                user_id=user.id,
                name="old",
                credential_id=passkeys.bytes_to_base64url(b"cred-old"),
                public_key=b"k",
                sign_count=0,
                backed_up=False,
            )
        )
        await session.commit()
        opts, challenge = await passkeys.generate_registration_options_for_user(
            session, user
        )
        assert isinstance(challenge, (bytes, bytearray))
        assert opts["rp"] is not None
        assert opts["user"]["name"] == user.email


@pytest.mark.anyio
async def test_generate_authentication_options_with_user(
    session_factory,
) -> None:
    async with session_factory() as session:
        user = await _make_user(session)
        session.add(
            UserPasskey(
                user_id=user.id,
                name="c",
                credential_id=passkeys.bytes_to_base64url(b"cred-x"),
                public_key=b"k",
                sign_count=0,
                backed_up=False,
            )
        )
        await session.commit()
        opts, challenge = await passkeys.generate_authentication_options_for_user(
            session, user
        )
        assert isinstance(challenge, (bytes, bytearray))
        assert opts["allowCredentials"] is not None


@pytest.mark.anyio
async def test_generate_authentication_options_no_user(session_factory) -> None:
    async with session_factory() as session:
        opts, challenge = await passkeys.generate_authentication_options_for_user(
            session, None
        )
        # webauthn normalises a None allow-list to an empty list.
        assert opts["allowCredentials"] in (None, [])
        assert isinstance(challenge, (bytes, bytearray))


# --------------------------------------------------------------------------- #
# register_passkey                                                             #
# --------------------------------------------------------------------------- #
class _Verified:
    credential_id = b"new-cred"
    credential_public_key = b"pub"
    sign_count = 1
    aaguid = "aaguid-1"
    credential_type = "public-key"
    credential_device_type = "single_device"
    credential_backed_up = True
    new_sign_count = 7


@pytest.mark.anyio
async def test_register_passkey_invalid_raises(session_factory, monkeypatch) -> None:
    def boom(**kw):  # noqa: ANN003
        raise ValueError("bad")

    monkeypatch.setattr(passkeys, "verify_registration_response", boom)
    async with session_factory() as session:
        user = await _make_user(session)
        with pytest.raises(HTTPException) as exc:
            await passkeys.register_passkey(
                session, user=user, credential={}, expected_challenge=b"c"
            )
        assert exc.value.status_code == 400


@pytest.mark.anyio
async def test_register_passkey_success(session_factory, monkeypatch) -> None:
    monkeypatch.setattr(
        passkeys, "verify_registration_response", lambda **kw: _Verified()
    )
    async with session_factory() as session:
        user = await _make_user(session)
        pk = await passkeys.register_passkey(
            session, user=user, credential={}, expected_challenge=b"c", name="My Key"
        )
        assert pk.name == "My Key"
        assert pk.sign_count == 1
        assert pk.backed_up is True


@pytest.mark.anyio
async def test_register_passkey_duplicate_raises(session_factory, monkeypatch) -> None:
    monkeypatch.setattr(
        passkeys, "verify_registration_response", lambda **kw: _Verified()
    )
    async with session_factory() as session:
        user = await _make_user(session)
        await passkeys.register_passkey(
            session, user=user, credential={}, expected_challenge=b"c"
        )
        with pytest.raises(HTTPException) as exc:
            await passkeys.register_passkey(
                session, user=user, credential={}, expected_challenge=b"c"
            )
        assert exc.value.detail == "Passkey already registered"


# --------------------------------------------------------------------------- #
# verify_passkey_authentication                                                #
# --------------------------------------------------------------------------- #
@pytest.mark.anyio
async def test_verify_auth_missing_cred_id(session_factory) -> None:
    async with session_factory() as session:
        with pytest.raises(HTTPException) as exc:
            await passkeys.verify_passkey_authentication(
                session, credential={}, expected_challenge=b"c"
            )
        assert exc.value.detail == "Invalid credential"


@pytest.mark.anyio
async def test_verify_auth_bad_base64(session_factory, monkeypatch) -> None:
    def boom(value):  # noqa: ANN001
        raise ValueError("nope")

    monkeypatch.setattr(passkeys, "base64url_to_bytes", boom)
    async with session_factory() as session:
        with pytest.raises(HTTPException):
            await passkeys.verify_passkey_authentication(
                session, credential={"rawId": "abc"}, expected_challenge=b"c"
            )


@pytest.mark.anyio
async def test_verify_auth_empty_bytes(session_factory, monkeypatch) -> None:
    monkeypatch.setattr(passkeys, "base64url_to_bytes", lambda v: b"")
    async with session_factory() as session:
        with pytest.raises(HTTPException) as exc:
            await passkeys.verify_passkey_authentication(
                session, credential={"rawId": "abc"}, expected_challenge=b"c"
            )
        assert exc.value.detail == "Invalid credential"


@pytest.mark.anyio
async def test_verify_auth_unknown_passkey(session_factory) -> None:
    async with session_factory() as session:
        with pytest.raises(HTTPException) as exc:
            await passkeys.verify_passkey_authentication(
                session,
                credential={"rawId": passkeys.bytes_to_base64url(b"ghost")},
                expected_challenge=b"c",
            )
        assert exc.value.detail == "Unknown passkey"


@pytest.mark.anyio
async def test_verify_auth_user_id_mismatch(session_factory) -> None:
    async with session_factory() as session:
        user = await _make_user(session)
        cred_id = passkeys.bytes_to_base64url(b"cred-z")
        session.add(
            UserPasskey(
                user_id=user.id,
                name="c",
                credential_id=cred_id,
                public_key=b"k",
                sign_count=0,
                backed_up=False,
            )
        )
        await session.commit()
        with pytest.raises(HTTPException) as exc:
            await passkeys.verify_passkey_authentication(
                session,
                credential={"rawId": cred_id},
                expected_challenge=b"c",
                user_id=str(uuid.uuid4()),
            )
        assert exc.value.detail == "Unknown passkey"


@pytest.mark.anyio
async def test_verify_auth_user_gone(session_factory, monkeypatch) -> None:
    async with session_factory() as session:
        user = await _make_user(session)
        cred_id = passkeys.bytes_to_base64url(b"cred-orphan")
        session.add(
            UserPasskey(
                user_id=user.id,
                name="c",
                credential_id=cred_id,
                public_key=b"k",
                sign_count=0,
                backed_up=False,
            )
        )
        await session.commit()

        async def fake_get(model, pk):  # noqa: ANN001
            if model is User:
                return None
            return await session.__class__.get(session, model, pk)

        # Patch only User lookups to simulate a deleted account.
        orig_get = session.get

        async def patched_get(model, pk):  # noqa: ANN001
            if model is User:
                return None
            return await orig_get(model, pk)

        monkeypatch.setattr(session, "get", patched_get)
        with pytest.raises(HTTPException) as exc:
            await passkeys.verify_passkey_authentication(
                session, credential={"rawId": cred_id}, expected_challenge=b"c"
            )
        assert exc.value.detail == "Unknown passkey"


@pytest.mark.anyio
async def test_verify_auth_invalid_assertion(session_factory, monkeypatch) -> None:
    async with session_factory() as session:
        user = await _make_user(session)
        cred_id = passkeys.bytes_to_base64url(b"cred-q")
        session.add(
            UserPasskey(
                user_id=user.id,
                name="c",
                credential_id=cred_id,
                public_key=b"k",
                sign_count=0,
                backed_up=False,
            )
        )
        await session.commit()

        def boom(**kw):  # noqa: ANN003
            raise ValueError("bad assertion")

        monkeypatch.setattr(passkeys, "verify_authentication_response", boom)
        with pytest.raises(HTTPException) as exc:
            await passkeys.verify_passkey_authentication(
                session, credential={"rawId": cred_id}, expected_challenge=b"c"
            )
        assert exc.value.detail == "Invalid passkey assertion"


@pytest.mark.anyio
async def test_verify_auth_success_with_id_field(session_factory, monkeypatch) -> None:
    async with session_factory() as session:
        user = await _make_user(session)
        cred_id = passkeys.bytes_to_base64url(b"cred-ok")
        session.add(
            UserPasskey(
                user_id=user.id,
                name="c",
                credential_id=cred_id,
                public_key=b"k",
                sign_count=0,
                backed_up=False,
            )
        )
        await session.commit()

        monkeypatch.setattr(
            passkeys, "verify_authentication_response", lambda **kw: _Verified()
        )
        # Use the `id` field (no rawId) for the compatibility path.
        got_user, pk = await passkeys.verify_passkey_authentication(
            session,
            credential={"id": cred_id},
            expected_challenge=b"c",
            user_id=str(user.id),
        )
        assert got_user.id == user.id
        assert pk.sign_count == 7
        assert pk.last_used_at is not None


# --------------------------------------------------------------------------- #
# delete_passkey                                                               #
# --------------------------------------------------------------------------- #
@pytest.mark.anyio
async def test_delete_passkey_success(session_factory) -> None:
    async with session_factory() as session:
        user = await _make_user(session)
        pk = UserPasskey(
            user_id=user.id,
            name="c",
            credential_id=passkeys.bytes_to_base64url(b"cred-del"),
            public_key=b"k",
            sign_count=0,
            backed_up=False,
        )
        session.add(pk)
        await session.commit()
        await session.refresh(pk)
        assert await passkeys.delete_passkey(
            session, user_id=user.id, passkey_id=pk.id
        )


@pytest.mark.anyio
async def test_delete_passkey_missing(session_factory) -> None:
    async with session_factory() as session:
        assert (
            await passkeys.delete_passkey(
                session, user_id=uuid.uuid4(), passkey_id=uuid.uuid4()
            )
            is False
        )


@pytest.mark.anyio
async def test_delete_passkey_wrong_owner(session_factory) -> None:
    async with session_factory() as session:
        user = await _make_user(session)
        pk = UserPasskey(
            user_id=user.id,
            name="c",
            credential_id=passkeys.bytes_to_base64url(b"cred-own"),
            public_key=b"k",
            sign_count=0,
            backed_up=False,
        )
        session.add(pk)
        await session.commit()
        await session.refresh(pk)
        assert (
            await passkeys.delete_passkey(
                session, user_id=uuid.uuid4(), passkey_id=pk.id
            )
            is False
        )
