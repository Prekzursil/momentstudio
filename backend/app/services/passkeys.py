from __future__ import annotations

import dataclasses
from datetime import datetime, timezone
from typing import cast
from urllib.parse import urlsplit

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.passkeys import UserPasskey
from app.models.user import User

from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    PublicKeyCredentialType,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)


def rp_id() -> str:
    if settings.webauthn_rp_id:
        return settings.webauthn_rp_id.strip()
    host = urlsplit(settings.frontend_origin).hostname
    return host or "localhost"


def rp_name() -> str:
    if settings.webauthn_rp_name and settings.webauthn_rp_name.strip():
        return settings.webauthn_rp_name.strip()
    return settings.app_name.replace(" API", "").strip() or settings.app_name


def allowed_origins() -> list[str]:
    origins = [o.rstrip("/") for o in (settings.webauthn_allowed_origins or []) if isinstance(o, str) and o.strip()]
    front = (settings.frontend_origin or "").rstrip("/")
    if front and front not in origins:
        origins.append(front)
    return origins


def _as_camel_registration_options(opts: dict) -> dict:
    user = dict(opts.get("user") or {})
    auth_sel = dict(opts.get("authenticator_selection") or {})
    return {
        "rp": opts.get("rp"),
        "user": {
            "id": user.get("id"),
            "name": user.get("name"),
            "displayName": user.get("display_name"),
        },
        "challenge": opts.get("challenge"),
        "pubKeyCredParams": opts.get("pub_key_cred_params"),
        "timeout": opts.get("timeout"),
        "excludeCredentials": opts.get("exclude_credentials"),
        "authenticatorSelection": {
            "authenticatorAttachment": auth_sel.get("authenticator_attachment"),
            "residentKey": auth_sel.get("resident_key"),
            "requireResidentKey": auth_sel.get("require_resident_key"),
            "userVerification": auth_sel.get("user_verification"),
        },
        "attestation": opts.get("attestation"),
    }


def _as_camel_authentication_options(opts: dict) -> dict:
    return {
        "challenge": opts.get("challenge"),
        "timeout": opts.get("timeout"),
        "rpId": opts.get("rp_id"),
        "allowCredentials": opts.get("allow_credentials"),
        "userVerification": opts.get("user_verification"),
    }


def _jsonify_webauthn_options(value: object) -> object:
    if isinstance(value, (bytes, bytearray)):
        return bytes_to_base64url(bytes(value))
    if isinstance(value, dict):
        return {key: _jsonify_webauthn_options(val) for key, val in value.items()}
    if isinstance(value, list):
        return [_jsonify_webauthn_options(item) for item in value]
    return value


async def list_passkeys(session: AsyncSession, user_id) -> list[UserPasskey]:
    result = await session.execute(
        select(UserPasskey).where(UserPasskey.user_id == user_id).order_by(UserPasskey.created_at.desc())
    )
    return list(result.scalars().all())


async def generate_registration_options_for_user(session: AsyncSession, user: User) -> tuple[dict, bytes]:
    existing = await list_passkeys(session, user.id)
    exclude = [
        PublicKeyCredentialDescriptor(type=PublicKeyCredentialType.PUBLIC_KEY, id=base64url_to_bytes(p.credential_id))
        for p in existing
    ]

    selection = AuthenticatorSelectionCriteria(
        resident_key=ResidentKeyRequirement.PREFERRED,
        user_verification=UserVerificationRequirement.REQUIRED,
    )

    options = generate_registration_options(
        rp_id=rp_id(),
        rp_name=rp_name(),
        user_id=user.id.bytes,
        user_name=user.email,
        user_display_name=getattr(user, "name", None) or user.email,
        authenticator_selection=selection,
        exclude_credentials=exclude,
    )
    challenge = options.challenge
    payload = dataclasses.asdict(options)
    payload = cast(dict, _jsonify_webauthn_options(payload))
    return _as_camel_registration_options(payload), challenge


async def register_passkey(
    session: AsyncSession,
    *,
    user: User,
    credential: dict,
    expected_challenge: bytes,
    name: str | None = None,
) -> UserPasskey:
    try:
        verified = verify_registration_response(
            credential=credential,
            expected_challenge=expected_challenge,
            expected_rp_id=rp_id(),
            expected_origin=allowed_origins(),
            require_user_verification=True,
        )
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid passkey registration") from exc

    credential_id = bytes_to_base64url(verified.credential_id)
    existing = (await session.execute(select(UserPasskey).where(UserPasskey.credential_id == credential_id))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Passkey already registered")

    passkey = UserPasskey(
        user_id=user.id,
        name=(name or "").strip()[:120] or None,
        credential_id=credential_id,
        public_key=verified.credential_public_key,
        sign_count=int(verified.sign_count),
        aaguid=(verified.aaguid or "").strip()[:64] or None,
        credential_type=str(getattr(verified.credential_type, "value", verified.credential_type)),
        device_type=str(getattr(verified.credential_device_type, "value", verified.credential_device_type)),
        backed_up=bool(getattr(verified, "credential_backed_up", False)),
    )
    session.add(passkey)
    await session.commit()
    await session.refresh(passkey)
    return passkey


async def generate_authentication_options_for_user(session: AsyncSession, user: User | None) -> tuple[dict, bytes]:
    allow = None
    if user is not None:
        creds = await list_passkeys(session, user.id)
        allow = [
            PublicKeyCredentialDescriptor(type=PublicKeyCredentialType.PUBLIC_KEY, id=base64url_to_bytes(p.credential_id))
            for p in creds
        ]

    options = generate_authentication_options(
        rp_id=rp_id(),
        allow_credentials=allow,
        user_verification=UserVerificationRequirement.REQUIRED,
    )
    challenge = options.challenge
    payload = dataclasses.asdict(options)
    payload = cast(dict, _jsonify_webauthn_options(payload))
    return _as_camel_authentication_options(payload), challenge


def _credential_id_from_payload(credential: dict) -> str:
    cred_id_b64 = (credential.get("rawId") or credential.get("id") or "").strip()
    if not cred_id_b64:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid credential")
    try:
        credential_id_bytes = base64url_to_bytes(cred_id_b64)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid credential") from exc
    if not credential_id_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid credential")
    return bytes_to_base64url(credential_id_bytes)


async def _load_passkey_for_authentication(
    session: AsyncSession, *, credential_id: str, user_id: str | None
) -> UserPasskey:
    passkey = (await session.execute(select(UserPasskey).where(UserPasskey.credential_id == credential_id))).scalar_one_or_none()
    if not passkey:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown passkey")
    if user_id and str(passkey.user_id) != str(user_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown passkey")
    return passkey


def _verify_passkey_assertion(*, credential: dict, expected_challenge: bytes, passkey: UserPasskey) -> object:
    try:
        return verify_authentication_response(
            credential=credential,
            expected_challenge=expected_challenge,
            expected_rp_id=rp_id(),
            expected_origin=allowed_origins(),
            credential_public_key=passkey.public_key,
            credential_current_sign_count=int(passkey.sign_count or 0),
            require_user_verification=True,
        )
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid passkey assertion") from exc


async def verify_passkey_authentication(
    session: AsyncSession,
    *,
    credential: dict,
    expected_challenge: bytes,
    user_id: str | None = None,
) -> tuple[User, UserPasskey]:
    credential_id = _credential_id_from_payload(credential)
    passkey = await _load_passkey_for_authentication(session, credential_id=credential_id, user_id=user_id)

    user = await session.get(User, passkey.user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown passkey")

    verified = _verify_passkey_assertion(credential=credential, expected_challenge=expected_challenge, passkey=passkey)

    passkey.sign_count = int(getattr(verified, "new_sign_count", passkey.sign_count or 0))
    passkey.last_used_at = datetime.now(timezone.utc)
    session.add(passkey)
    await session.commit()
    await session.refresh(passkey)
    return user, passkey


async def delete_passkey(session: AsyncSession, *, user_id, passkey_id) -> bool:
    passkey = await session.get(UserPasskey, passkey_id)
    if not passkey or passkey.user_id != user_id:
        return False
    await session.delete(passkey)
    await session.commit()
    return True
