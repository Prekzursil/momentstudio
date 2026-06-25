"""Unit coverage for ``app.services.netopia`` to 100% line+branch.

These tests exercise the NETOPIA payment helper module in isolation using
``monkeypatch`` on ``settings``, mocked ``httpx`` transports, and locally
generated RSA keys for the IPN/JWT verification paths. No real network or
database access is performed.
"""

from __future__ import annotations

import base64
import hashlib
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

import httpx
import jwt
import pytest
import simplejson
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from fastapi import HTTPException

from app.core.config import settings
from app.services import netopia as ns


# ---------------------------------------------------------------------------
# Key material helpers
# ---------------------------------------------------------------------------


def _rsa_keypair() -> tuple[rsa.RSAPrivateKey, str]:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_pem = (
        private_key.public_key()
        .public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        .decode("utf-8")
    )
    return private_key, public_pem


def _self_signed_cert(private_key: rsa.RSAPrivateKey) -> x509.Certificate:
    subject = issuer = x509.Name(
        [x509.NameAttribute(NameOID.COMMON_NAME, "netopia-test")]
    )
    return (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(private_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.now(timezone.utc))
        .not_valid_after(datetime.now(timezone.utc))
        .sign(private_key, hashes.SHA256())
    )


@pytest.fixture(autouse=True)
def _reset_netopia_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    """Start each test from a known-empty NETOPIA configuration baseline."""
    for attr in (
        "netopia_env",
        "netopia_api_key",
        "netopia_api_key_live",
        "netopia_api_key_sandbox",
        "netopia_pos_signature",
        "netopia_pos_signature_live",
        "netopia_pos_signature_sandbox",
        "netopia_public_key_pem",
        "netopia_public_key_pem_live",
        "netopia_public_key_pem_sandbox",
        "netopia_public_key_path",
        "netopia_public_key_path_live",
        "netopia_public_key_path_sandbox",
    ):
        monkeypatch.setattr(settings, attr, None, raising=False)
    monkeypatch.setattr(settings, "netopia_env", "sandbox", raising=False)
    monkeypatch.setattr(settings, "netopia_enabled", True, raising=False)


# ---------------------------------------------------------------------------
# Env / key / signature selection helpers
# ---------------------------------------------------------------------------


def test_netopia_env_defaults_to_sandbox(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "netopia_env", None, raising=False)
    assert ns._netopia_env() == "sandbox"


def test_netopia_env_live(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "netopia_env", "LIVE", raising=False)
    assert ns._netopia_env() == "live"


def test_api_key_prefers_env_specific(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "netopia_api_key_sandbox", "  SB-KEY  ")
    assert ns._netopia_api_key() == "SB-KEY"


def test_api_key_live_branch(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "netopia_env", "live")
    monkeypatch.setattr(settings, "netopia_api_key_live", "LIVE-KEY")
    assert ns._netopia_api_key() == "LIVE-KEY"


def test_api_key_falls_back_to_generic(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "netopia_api_key_sandbox", "")
    monkeypatch.setattr(settings, "netopia_api_key", "GENERIC")
    assert ns._netopia_api_key() == "GENERIC"


def test_pos_signature_prefers_env_specific(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "netopia_pos_signature_sandbox", "SB-SIG")
    assert ns._netopia_pos_signature() == "SB-SIG"


def test_pos_signature_live_branch(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "netopia_env", "live")
    monkeypatch.setattr(settings, "netopia_pos_signature_live", "LIVE-SIG")
    assert ns._netopia_pos_signature() == "LIVE-SIG"


def test_pos_signature_falls_back_to_generic(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "netopia_pos_signature", "GEN-SIG")
    assert ns._netopia_pos_signature() == "GEN-SIG"


def test_payload_hash_b64_matches_sha512() -> None:
    payload = b"hello"
    expected = base64.b64encode(hashlib.sha512(payload).digest()).decode("ascii")
    assert ns._payload_hash_b64(payload) == expected


def test_base_url_live_vs_sandbox(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "netopia_env", "live")
    assert ns._netopia_base_url() == ns.NETOPIA_BASE_URL_LIVE
    monkeypatch.setattr(settings, "netopia_env", "sandbox")
    assert ns._netopia_base_url() == ns.NETOPIA_BASE_URL_SANDBOX


def test_headers_require_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(HTTPException) as exc:
        ns._netopia_headers()
    assert exc.value.status_code == 500


def test_headers_present(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "netopia_api_key_sandbox", "K")
    headers = ns._netopia_headers()
    assert headers["Authorization"] == "K"
    assert headers["Content-Type"] == "application/json"


# ---------------------------------------------------------------------------
# _read_netopia_key_bytes
# ---------------------------------------------------------------------------


def test_read_key_bytes_empty_path() -> None:
    assert ns._read_netopia_key_bytes("  ") == b""


def test_read_key_bytes_absolute(tmp_path: Path) -> None:
    target = tmp_path / "key.pem"
    target.write_bytes(b"DATA")
    assert ns._read_netopia_key_bytes(str(target)) == b"DATA"


def test_read_key_bytes_relative_to_private_root(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "priv"
    root.mkdir()
    (root / "rel.pem").write_bytes(b"RELDATA")
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(settings, "private_media_root", "priv", raising=False)
    assert ns._read_netopia_key_bytes("rel.pem") == b"RELDATA"


def test_read_key_bytes_module_root_index_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Force the ``parents[2]`` lookup to raise so module_root stays None."""

    class _BadPath(type(Path())):  # type: ignore[misc]
        def resolve(self, *a: Any, **k: Any) -> "_BadPath":  # noqa: D401
            return self

        @property
        def parents(self) -> list[Path]:
            raise IndexError("no parents")

    monkeypatch.setattr(ns, "Path", _BadPath)
    with pytest.raises(FileNotFoundError):
        ns._read_netopia_key_bytes("relative-missing.pem")


def test_read_key_bytes_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "private_media_root", "missing_root", raising=False)
    with pytest.raises(FileNotFoundError):
        ns._read_netopia_key_bytes("definitely-not-here-xyz.pem")


def test_read_key_bytes_reraises_oserror(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    target = tmp_path / "boom.pem"
    target.write_bytes(b"x")

    real_is_file = Path.is_file

    def fake_is_file(self: Path) -> bool:
        if self == target:
            raise OSError("permission denied")
        return real_is_file(self)

    monkeypatch.setattr(Path, "is_file", fake_is_file)
    with pytest.raises(OSError):
        ns._read_netopia_key_bytes(str(target))


# ---------------------------------------------------------------------------
# _public_key_pem
# ---------------------------------------------------------------------------


def test_public_key_pem_from_inline_pem(monkeypatch: pytest.MonkeyPatch) -> None:
    _, public_pem = _rsa_keypair()
    monkeypatch.setattr(settings, "netopia_public_key_pem_sandbox", public_pem)
    result = ns._public_key_pem()
    assert "PUBLIC KEY" in result


def test_public_key_pem_live_inline(monkeypatch: pytest.MonkeyPatch) -> None:
    _, public_pem = _rsa_keypair()
    monkeypatch.setattr(settings, "netopia_env", "live")
    monkeypatch.setattr(settings, "netopia_public_key_pem_live", public_pem)
    assert "PUBLIC KEY" in ns._public_key_pem()


def test_public_key_pem_not_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(HTTPException) as exc:
        ns._public_key_pem()
    assert exc.value.status_code == 500
    assert "not configured" in str(exc.value.detail)


def test_public_key_pem_read_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    target = tmp_path / "k.pem"
    target.write_bytes(b"x")
    monkeypatch.setattr(settings, "netopia_public_key_path_sandbox", str(target))

    def boom(_path: str) -> bytes:
        raise OSError("cannot read")

    monkeypatch.setattr(ns, "_read_netopia_key_bytes", boom)
    with pytest.raises(HTTPException) as exc:
        ns._public_key_pem()
    assert "could not be read" in str(exc.value.detail)


def test_public_key_pem_empty_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    target = tmp_path / "empty.pem"
    target.write_bytes(b"")
    monkeypatch.setattr(settings, "netopia_public_key_path_sandbox", str(target))
    # _read_netopia_key_bytes returns b"" for empty -> "file is empty" branch.
    monkeypatch.setattr(ns, "_read_netopia_key_bytes", lambda _p: b"")
    with pytest.raises(HTTPException) as exc:
        ns._public_key_pem()
    assert "empty" in str(exc.value.detail)


def test_public_key_pem_private_key_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    private_key, _ = _rsa_keypair()
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    monkeypatch.setattr(settings, "netopia_public_key_path_sandbox", "ignored")
    monkeypatch.setattr(ns, "_read_netopia_key_bytes", lambda _p: private_pem)
    with pytest.raises(HTTPException) as exc:
        ns._public_key_pem()
    assert "private key" in str(exc.value.detail)


def test_public_key_pem_certificate(monkeypatch: pytest.MonkeyPatch) -> None:
    private_key, _ = _rsa_keypair()
    cert = _self_signed_cert(private_key)
    cert_pem = cert.public_bytes(serialization.Encoding.PEM)
    monkeypatch.setattr(settings, "netopia_public_key_path_sandbox", "ignored")
    monkeypatch.setattr(ns, "_read_netopia_key_bytes", lambda _p: cert_pem)
    assert "PUBLIC KEY" in ns._public_key_pem()


def test_public_key_pem_certificate_parse_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bad_cert = b"-----BEGIN CERTIFICATE-----\nnotbase64!!!\n-----END CERTIFICATE-----\n"
    monkeypatch.setattr(settings, "netopia_public_key_path_sandbox", "ignored")
    monkeypatch.setattr(ns, "_read_netopia_key_bytes", lambda _p: bad_cert)
    with pytest.raises(HTTPException) as exc:
        ns._public_key_pem()
    assert "certificate could not be parsed" in str(exc.value.detail)


def test_public_key_pem_public_key_header(monkeypatch: pytest.MonkeyPatch) -> None:
    _, public_pem = _rsa_keypair()
    monkeypatch.setattr(settings, "netopia_public_key_path_sandbox", "ignored")
    monkeypatch.setattr(ns, "_read_netopia_key_bytes", lambda _p: public_pem.encode())
    assert "PUBLIC KEY" in ns._public_key_pem()


def test_public_key_pem_public_key_parse_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bad = b"-----BEGIN PUBLIC KEY-----\nnotbase64!!!\n-----END PUBLIC KEY-----\n"
    monkeypatch.setattr(settings, "netopia_public_key_path_sandbox", "ignored")
    monkeypatch.setattr(ns, "_read_netopia_key_bytes", lambda _p: bad)
    with pytest.raises(HTTPException) as exc:
        ns._public_key_pem()
    assert "key could not be parsed" in str(exc.value.detail)


def test_public_key_pem_fallback_verbatim(monkeypatch: pytest.MonkeyPatch) -> None:
    other = b"-----BEGIN RSA PARAMETERS-----\nZm9v\n-----END RSA PARAMETERS-----\n"
    monkeypatch.setattr(settings, "netopia_public_key_path_sandbox", "ignored")
    monkeypatch.setattr(ns, "_read_netopia_key_bytes", lambda _p: other)
    result = ns._public_key_pem()
    assert "RSA PARAMETERS" in result


def test_public_key_pem_fallback_decode_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    other = b"-----BEGIN RSA PARAMETERS-----\n\xff\xfe\n-----END RSA PARAMETERS-----\n"
    monkeypatch.setattr(settings, "netopia_public_key_path_sandbox", "ignored")
    monkeypatch.setattr(ns, "_read_netopia_key_bytes", lambda _p: other)
    with pytest.raises(HTTPException) as exc:
        ns._public_key_pem()
    assert "could not be decoded" in str(exc.value.detail)


def test_public_key_pem_der_certificate(monkeypatch: pytest.MonkeyPatch) -> None:
    private_key, _ = _rsa_keypair()
    cert = _self_signed_cert(private_key)
    der = cert.public_bytes(serialization.Encoding.DER)
    monkeypatch.setattr(settings, "netopia_public_key_path_sandbox", "ignored")
    monkeypatch.setattr(ns, "_read_netopia_key_bytes", lambda _p: der)
    assert "PUBLIC KEY" in ns._public_key_pem()


def test_public_key_pem_der_public_key(monkeypatch: pytest.MonkeyPatch) -> None:
    private_key, _ = _rsa_keypair()
    der = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    monkeypatch.setattr(settings, "netopia_public_key_path_sandbox", "ignored")
    monkeypatch.setattr(ns, "_read_netopia_key_bytes", lambda _p: der)
    assert "PUBLIC KEY" in ns._public_key_pem()


def test_public_key_pem_der_unparseable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "netopia_public_key_path_sandbox", "ignored")
    monkeypatch.setattr(ns, "_read_netopia_key_bytes", lambda _p: b"\x00\x01\x02junk")
    with pytest.raises(HTTPException) as exc:
        ns._public_key_pem()
    assert "could not be parsed" in str(exc.value.detail)


# ---------------------------------------------------------------------------
# configuration status helpers
# ---------------------------------------------------------------------------


def test_configuration_status_missing_all() -> None:
    configured, message = ns.netopia_configuration_status()
    assert configured is False
    assert "Missing Netopia configuration" in (message or "")


def test_is_netopia_configured_false() -> None:
    assert ns.is_netopia_configured() is False


def test_configuration_status_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    _, public_pem = _rsa_keypair()
    monkeypatch.setattr(settings, "netopia_api_key_sandbox", "K")
    monkeypatch.setattr(settings, "netopia_pos_signature_sandbox", "S")
    monkeypatch.setattr(settings, "netopia_public_key_pem_sandbox", public_pem)
    configured, message = ns.netopia_configuration_status()
    assert configured is True
    assert message is None
    assert ns.is_netopia_configured() is True


def test_configuration_status_key_load_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "netopia_api_key_sandbox", "K")
    monkeypatch.setattr(settings, "netopia_pos_signature_sandbox", "S")
    monkeypatch.setattr(settings, "netopia_public_key_path_sandbox", "/some/path")

    def boom() -> str:
        raise HTTPException(status_code=500, detail="boom-detail")

    monkeypatch.setattr(ns, "_public_key_pem", boom)
    configured, message = ns.netopia_configuration_status()
    assert configured is False
    assert message == "boom-detail"


def test_configuration_status_key_load_failure_no_detail(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "netopia_api_key_sandbox", "K")
    monkeypatch.setattr(settings, "netopia_pos_signature_sandbox", "S")
    monkeypatch.setattr(settings, "netopia_public_key_path_sandbox", "/some/path")

    def boom() -> str:
        raise HTTPException(status_code=500, detail="")

    monkeypatch.setattr(ns, "_public_key_pem", boom)
    configured, message = ns.netopia_configuration_status()
    assert configured is False
    assert message == "Netopia public key could not be loaded"


def test_configuration_status_live_branch(monkeypatch: pytest.MonkeyPatch) -> None:
    _, public_pem = _rsa_keypair()
    monkeypatch.setattr(settings, "netopia_env", "live")
    monkeypatch.setattr(settings, "netopia_api_key_live", "K")
    monkeypatch.setattr(settings, "netopia_pos_signature_live", "S")
    monkeypatch.setattr(settings, "netopia_public_key_pem_live", public_pem)
    configured, _ = ns.netopia_configuration_status()
    assert configured is True


# ---------------------------------------------------------------------------
# start_payment
# ---------------------------------------------------------------------------


def _configure_payment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "netopia_api_key_sandbox", "API-KEY")
    monkeypatch.setattr(settings, "netopia_pos_signature_sandbox", "SIG")


async def _call_start(**overrides: Any) -> tuple[str | None, str]:
    kwargs: dict[str, Any] = dict(
        order_id="order-1",
        amount_ron=Decimal("10.00"),
        description="desc",
        billing={},
        shipping={},
        products=[],
        language="ro",
        cancel_url="https://x/cancel",
        notify_url="https://x/notify",
        redirect_url="https://x/ok",
    )
    kwargs.update(overrides)
    return await ns.start_payment(**kwargs)


@pytest.mark.anyio
async def test_start_payment_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "netopia_enabled", False)
    with pytest.raises(HTTPException) as exc:
        await _call_start()
    assert exc.value.status_code == 404


@pytest.mark.anyio
async def test_start_payment_no_signature(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(HTTPException) as exc:
        await _call_start()
    assert exc.value.status_code == 500


@pytest.mark.anyio
async def test_start_payment_request_error(monkeypatch: pytest.MonkeyPatch) -> None:
    _configure_payment(monkeypatch)

    async def fake_post(self: Any, *a: Any, **k: Any) -> httpx.Response:
        raise httpx.ConnectError("boom")

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    with pytest.raises(HTTPException) as exc:
        await _call_start()
    assert exc.value.status_code == 502
    assert "request failed" in str(exc.value.detail)


@pytest.mark.anyio
async def test_start_payment_error_json_message(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_payment(monkeypatch)

    async def fake_post(self: Any, *a: Any, **k: Any) -> httpx.Response:
        return httpx.Response(400, json={"message": "bad request msg"})

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    with pytest.raises(HTTPException) as exc:
        await _call_start()
    assert exc.value.detail == "bad request msg"


@pytest.mark.anyio
async def test_start_payment_error_body_not_json(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_payment(monkeypatch)

    async def fake_post(self: Any, *a: Any, **k: Any) -> httpx.Response:
        return httpx.Response(500, text="not-json")

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    with pytest.raises(HTTPException) as exc:
        await _call_start()
    assert exc.value.detail == "Netopia start payment failed"


@pytest.mark.anyio
async def test_start_payment_invalid_success_json(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_payment(monkeypatch)

    async def fake_post(self: Any, *a: Any, **k: Any) -> httpx.Response:
        return httpx.Response(200, text="not-json")

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    with pytest.raises(HTTPException) as exc:
        await _call_start()
    assert "Invalid Netopia response" in str(exc.value.detail)


@pytest.mark.anyio
async def test_start_payment_no_url(monkeypatch: pytest.MonkeyPatch) -> None:
    _configure_payment(monkeypatch)

    async def fake_post(self: Any, *a: Any, **k: Any) -> httpx.Response:
        return httpx.Response(200, json={"payment": {"ntpID": "X"}})

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    with pytest.raises(HTTPException) as exc:
        await _call_start()
    assert "did not return a URL" in str(exc.value.detail)


@pytest.mark.anyio
async def test_start_payment_success_alt_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    _configure_payment(monkeypatch)

    async def fake_post(self: Any, *a: Any, **k: Any) -> httpx.Response:
        return httpx.Response(
            200,
            json={"payment": {"paymentUrl": "https://pay", "ntpId": "NTP"}},
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    ntp_id, url = await _call_start(description="", language="")
    assert ntp_id == "NTP"
    assert url == "https://pay"


@pytest.mark.anyio
async def test_start_payment_error_json_non_dict(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Error body is valid JSON but not a dict -> isinstance branch skipped."""
    _configure_payment(monkeypatch)

    async def fake_post(self: Any, *a: Any, **k: Any) -> httpx.Response:
        return httpx.Response(400, json=["just", "a", "list"])

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    with pytest.raises(HTTPException) as exc:
        await _call_start()
    assert exc.value.detail == "Netopia start payment failed"


@pytest.mark.anyio
async def test_start_payment_payment_not_dict(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_payment(monkeypatch)

    async def fake_post(self: Any, *a: Any, **k: Any) -> httpx.Response:
        return httpx.Response(200, json={"payment": "nope"})

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    with pytest.raises(HTTPException):
        await _call_start()


# ---------------------------------------------------------------------------
# get_status
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_get_status_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "netopia_enabled", False)
    with pytest.raises(HTTPException) as exc:
        await ns.get_status(ntp_id="N", order_id="O")
    assert exc.value.status_code == 404


@pytest.mark.anyio
async def test_get_status_no_signature(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(HTTPException) as exc:
        await ns.get_status(ntp_id="N", order_id="O")
    assert exc.value.status_code == 500


@pytest.mark.anyio
async def test_get_status_request_error(monkeypatch: pytest.MonkeyPatch) -> None:
    _configure_payment(monkeypatch)

    async def fake_post(self: Any, *a: Any, **k: Any) -> httpx.Response:
        raise httpx.ConnectError("boom")

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    with pytest.raises(HTTPException) as exc:
        await ns.get_status(ntp_id="N", order_id="O")
    assert "request failed" in str(exc.value.detail)


@pytest.mark.anyio
async def test_get_status_http_error(monkeypatch: pytest.MonkeyPatch) -> None:
    _configure_payment(monkeypatch)

    async def fake_post(self: Any, *a: Any, **k: Any) -> httpx.Response:
        return httpx.Response(500, text="err")

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    with pytest.raises(HTTPException) as exc:
        await ns.get_status(ntp_id="N", order_id="O")
    assert "status lookup failed" in str(exc.value.detail)


@pytest.mark.anyio
async def test_get_status_invalid_json(monkeypatch: pytest.MonkeyPatch) -> None:
    _configure_payment(monkeypatch)

    async def fake_post(self: Any, *a: Any, **k: Any) -> httpx.Response:
        return httpx.Response(200, text="not-json")

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    with pytest.raises(HTTPException) as exc:
        await ns.get_status(ntp_id="N", order_id="O")
    assert "Invalid Netopia response" in str(exc.value.detail)


@pytest.mark.anyio
async def test_get_status_not_dict(monkeypatch: pytest.MonkeyPatch) -> None:
    _configure_payment(monkeypatch)

    async def fake_post(self: Any, *a: Any, **k: Any) -> httpx.Response:
        return httpx.Response(200, json=["a", "b"])

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    with pytest.raises(HTTPException) as exc:
        await ns.get_status(ntp_id="N", order_id="O")
    assert "Invalid Netopia response" in str(exc.value.detail)


@pytest.mark.anyio
async def test_get_status_success(monkeypatch: pytest.MonkeyPatch) -> None:
    _configure_payment(monkeypatch)

    async def fake_post(self: Any, *a: Any, **k: Any) -> httpx.Response:
        return httpx.Response(200, json={"status": "paid"})

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    data = await ns.get_status(ntp_id=" N ", order_id="O")
    assert data == {"status": "paid"}


# ---------------------------------------------------------------------------
# verify_ipn
# ---------------------------------------------------------------------------


def _make_token(
    private_key: rsa.RSAPrivateKey,
    payload: bytes,
    *,
    alg: str = "RS512",
    pos_signature: str = "SIG",
    issuer: str = "NETOPIA Payments",
    sub: str | None = None,
    iat: Any = None,
    exp: Any = None,
    aud: Any = None,
    extra_claims: dict[str, Any] | None = None,
) -> str:
    now = int(datetime.now(timezone.utc).timestamp())
    digest = hashlib.sha512(payload).digest()
    claims: dict[str, Any] = {
        "sub": sub if sub is not None else base64.b64encode(digest).decode("ascii"),
        "aud": aud if aud is not None else pos_signature,
        "iss": issuer,
        "iat": iat if iat is not None else now,
    }
    if exp is not None:
        claims["exp"] = exp
    if extra_claims:
        claims.update(extra_claims)
    return jwt.encode(claims, private_key, algorithm=alg)


def _configure_ipn(
    monkeypatch: pytest.MonkeyPatch, public_pem: str, *, pos: str = "SIG"
) -> None:
    monkeypatch.setattr(settings, "netopia_pos_signature_sandbox", pos)
    monkeypatch.setattr(settings, "netopia_public_key_pem_sandbox", public_pem)
    monkeypatch.setattr(settings, "netopia_jwt_alg", "RS512", raising=False)
    monkeypatch.setattr(
        settings, "netopia_ipn_max_age_seconds", 60 * 60 * 24, raising=False
    )


def test_verify_ipn_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "netopia_enabled", False)
    with pytest.raises(HTTPException) as exc:
        ns.verify_ipn(verification_token="x", payload=b"{}")
    assert exc.value.status_code == 404


def test_verify_ipn_no_signature(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(HTTPException) as exc:
        ns.verify_ipn(verification_token="x", payload=b"{}")
    assert exc.value.status_code == 500


def test_verify_ipn_key_not_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "netopia_pos_signature_sandbox", "SIG")
    with pytest.raises(HTTPException) as exc:
        ns.verify_ipn(verification_token="x", payload=b"{}")
    assert exc.value.status_code == 500
    assert "not configured" in str(exc.value.detail)


def test_verify_ipn_success(monkeypatch: pytest.MonkeyPatch) -> None:
    private_key, public_pem = _rsa_keypair()
    payload = b'{"order":{"id":"1"}}'
    _configure_ipn(monkeypatch, public_pem)
    token = _make_token(private_key, payload)
    claims = ns.verify_ipn(verification_token=token, payload=payload)
    assert claims["iss"] == "NETOPIA Payments"


def test_verify_ipn_alg_fallback_default(monkeypatch: pytest.MonkeyPatch) -> None:
    """A non-allowed configured alg falls back to RS512 list."""
    private_key, public_pem = _rsa_keypair()
    payload = b"{}"
    _configure_ipn(monkeypatch, public_pem)
    monkeypatch.setattr(settings, "netopia_jwt_alg", "HS999", raising=False)
    token = _make_token(private_key, payload, alg="RS512")
    claims = ns.verify_ipn(verification_token=token, payload=payload)
    assert claims["iss"] == "NETOPIA Payments"


def test_verify_ipn_header_alg_appended(monkeypatch: pytest.MonkeyPatch) -> None:
    """Token signed RS256 while config defaults RS512 -> header alg appended."""
    private_key, public_pem = _rsa_keypair()
    payload = b"{}"
    _configure_ipn(monkeypatch, public_pem)
    token = _make_token(private_key, payload, alg="RS256")
    claims = ns.verify_ipn(verification_token=token, payload=payload)
    assert claims["iss"] == "NETOPIA Payments"


def test_verify_ipn_unverified_header_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A token whose header cannot be parsed hits the except branch, then decode fails."""
    private_key, public_pem = _rsa_keypair()
    _configure_ipn(monkeypatch, public_pem)
    with pytest.raises(HTTPException) as exc:
        ns.verify_ipn(verification_token="not-a-jwt", payload=b"{}")
    assert "Invalid Netopia signature" in str(exc.value.detail)


def test_verify_ipn_decode_error(monkeypatch: pytest.MonkeyPatch) -> None:
    other_key, _ = _rsa_keypair()
    _, public_pem = _rsa_keypair()
    payload = b"{}"
    _configure_ipn(monkeypatch, public_pem)
    # Sign with a DIFFERENT key so signature verification fails.
    token = _make_token(other_key, payload)
    with pytest.raises(HTTPException) as exc:
        ns.verify_ipn(verification_token=token, payload=payload)
    assert "Invalid Netopia signature" in str(exc.value.detail)


def test_verify_ipn_string_numeric_timestamps(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    private_key, public_pem = _rsa_keypair()
    payload = b"{}"
    _configure_ipn(monkeypatch, public_pem)
    now = int(datetime.now(timezone.utc).timestamp())
    token = _make_token(
        private_key,
        payload,
        iat=str(now),
        exp=str(now + 3600),
    )
    claims = ns.verify_ipn(verification_token=token, payload=payload)
    assert isinstance(claims["iat"], int)


def _stub_decode(monkeypatch: pytest.MonkeyPatch, claims: dict[str, Any]) -> None:
    """Bypass PyJWT's own time validation to exercise the manual time branches.

    ``verify_ipn`` re-checks iat/exp by hand after ``jwt.decode``; PyJWT's
    built-in exp/nbf validation would otherwise reject the token before those
    manual branches run, so we stub ``jwt.decode`` to return crafted claims.
    """

    def _fake_decode(*_a: Any, **_k: Any) -> dict[str, Any]:
        return dict(claims)

    monkeypatch.setattr(ns.jwt, "decode", _fake_decode)


def test_verify_ipn_future_iat(monkeypatch: pytest.MonkeyPatch) -> None:
    private_key, public_pem = _rsa_keypair()
    payload = b"{}"
    _configure_ipn(monkeypatch, public_pem)
    digest = base64.b64encode(hashlib.sha512(payload).digest()).decode("ascii")
    future = int(datetime.now(timezone.utc).timestamp()) + 100000
    _stub_decode(
        monkeypatch,
        {"sub": digest, "aud": "SIG", "iss": "NETOPIA Payments", "iat": future},
    )
    token = _make_token(private_key, payload, iat=future)
    with pytest.raises(HTTPException) as exc:
        ns.verify_ipn(verification_token=token, payload=payload)
    assert "token time" in str(exc.value.detail)


def test_verify_ipn_stale_iat(monkeypatch: pytest.MonkeyPatch) -> None:
    private_key, public_pem = _rsa_keypair()
    payload = b"{}"
    _configure_ipn(monkeypatch, public_pem)
    monkeypatch.setattr(settings, "netopia_ipn_max_age_seconds", 60, raising=False)
    digest = base64.b64encode(hashlib.sha512(payload).digest()).decode("ascii")
    old = int(datetime.now(timezone.utc).timestamp()) - 10000
    _stub_decode(
        monkeypatch,
        {"sub": digest, "aud": "SIG", "iss": "NETOPIA Payments", "iat": old},
    )
    token = _make_token(private_key, payload, iat=old)
    with pytest.raises(HTTPException) as exc:
        ns.verify_ipn(verification_token=token, payload=payload)
    assert "Stale Netopia token" in str(exc.value.detail)


def test_verify_ipn_expired(monkeypatch: pytest.MonkeyPatch) -> None:
    private_key, public_pem = _rsa_keypair()
    payload = b"{}"
    _configure_ipn(monkeypatch, public_pem)
    digest = base64.b64encode(hashlib.sha512(payload).digest()).decode("ascii")
    now = int(datetime.now(timezone.utc).timestamp())
    _stub_decode(
        monkeypatch,
        {
            "sub": digest,
            "aud": "SIG",
            "iss": "NETOPIA Payments",
            "iat": now - 10,
            "exp": now - 1000,
        },
    )
    token = _make_token(private_key, payload, iat=now - 10, exp=now - 1000)
    with pytest.raises(HTTPException) as exc:
        ns.verify_ipn(verification_token=token, payload=payload)
    assert "Expired Netopia token" in str(exc.value.detail)


def test_verify_ipn_non_numeric_iat_skipped(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A non-numeric iat is not int/float, so the iat time checks are skipped."""
    private_key, public_pem = _rsa_keypair()
    payload = b"{}"
    _configure_ipn(monkeypatch, public_pem)
    digest = base64.b64encode(hashlib.sha512(payload).digest()).decode("ascii")
    _stub_decode(
        monkeypatch,
        {
            "sub": digest,
            "aud": "SIG",
            "iss": "NETOPIA Payments",
            "iat": "not-a-number",
        },
    )
    token = _make_token(private_key, payload)
    claims = ns.verify_ipn(verification_token=token, payload=payload)
    assert claims["iat"] == "not-a-number"


def test_verify_ipn_bad_issuer(monkeypatch: pytest.MonkeyPatch) -> None:
    private_key, public_pem = _rsa_keypair()
    payload = b"{}"
    _configure_ipn(monkeypatch, public_pem)
    token = _make_token(private_key, payload, issuer="Someone Else")
    with pytest.raises(HTTPException) as exc:
        ns.verify_ipn(verification_token=token, payload=payload)
    assert "Invalid Netopia issuer" in str(exc.value.detail)


def test_verify_ipn_aud_list(monkeypatch: pytest.MonkeyPatch) -> None:
    private_key, public_pem = _rsa_keypair()
    payload = b"{}"
    _configure_ipn(monkeypatch, public_pem, pos="SIG")
    token = _make_token(private_key, payload, aud=["other", "SIG"])
    claims = ns.verify_ipn(verification_token=token, payload=payload)
    assert claims["iss"] == "NETOPIA Payments"


def test_verify_ipn_aud_numeric(monkeypatch: pytest.MonkeyPatch) -> None:
    """A non-str, non-list aud is coerced via str()."""
    private_key, public_pem = _rsa_keypair()
    payload = b"{}"
    _configure_ipn(monkeypatch, public_pem, pos="123")
    token = _make_token(private_key, payload, aud=123)
    claims = ns.verify_ipn(verification_token=token, payload=payload)
    assert claims["iss"] == "NETOPIA Payments"


def test_verify_ipn_aud_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    """An aud of 0/empty -> aud_values becomes empty -> audience mismatch."""
    private_key, public_pem = _rsa_keypair()
    payload = b"{}"
    _configure_ipn(monkeypatch, public_pem, pos="SIG")
    token = _make_token(private_key, payload, aud=0)
    with pytest.raises(HTTPException) as exc:
        ns.verify_ipn(verification_token=token, payload=payload)
    assert "audience" in str(exc.value.detail)


def test_verify_ipn_aud_mismatch(monkeypatch: pytest.MonkeyPatch) -> None:
    private_key, public_pem = _rsa_keypair()
    payload = b"{}"
    _configure_ipn(monkeypatch, public_pem, pos="SIG")
    token = _make_token(private_key, payload, aud="OTHER")
    with pytest.raises(HTTPException) as exc:
        ns.verify_ipn(verification_token=token, payload=payload)
    assert "audience" in str(exc.value.detail)


def test_verify_ipn_empty_sub(monkeypatch: pytest.MonkeyPatch) -> None:
    private_key, public_pem = _rsa_keypair()
    payload = b"{}"
    _configure_ipn(monkeypatch, public_pem)
    # require=["sub"...] forces sub presence; use whitespace so it parses but strips empty.
    token = _make_token(private_key, payload, sub="   ")
    with pytest.raises(HTTPException) as exc:
        ns.verify_ipn(verification_token=token, payload=payload)
    assert "payload hash mismatch" in str(exc.value.detail)


def test_verify_ipn_urlsafe_digest(monkeypatch: pytest.MonkeyPatch) -> None:
    private_key, public_pem = _rsa_keypair()
    payload = b'{"a":1}'
    _configure_ipn(monkeypatch, public_pem)
    digest = hashlib.sha512(payload).digest()
    url_sub = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")
    token = _make_token(private_key, payload, sub=url_sub)
    claims = ns.verify_ipn(verification_token=token, payload=payload)
    assert claims["sub"] == url_sub


def test_verify_ipn_canonical_json_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    private_key, public_pem = _rsa_keypair()
    # Non-canonical (extra spaces / unsorted) payload; sub hashes the canonical form.
    payload = b'{"b": 2, "a": 1}'
    parsed = simplejson.loads(payload)
    canonical = simplejson.dumps(
        parsed, use_decimal=True, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")
    canonical_sub = base64.b64encode(hashlib.sha512(canonical).digest()).decode("ascii")
    _configure_ipn(monkeypatch, public_pem)
    token = _make_token(private_key, payload, sub=canonical_sub)
    claims = ns.verify_ipn(verification_token=token, payload=payload)
    assert claims["sub"] == canonical_sub


def test_verify_ipn_canonical_parse_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Non-JSON payload makes the canonical fallback raise -> hash mismatch."""
    private_key, public_pem = _rsa_keypair()
    payload = b"not json at all"
    _configure_ipn(monkeypatch, public_pem)
    token = _make_token(private_key, payload, sub="deadbeef-not-matching")
    with pytest.raises(HTTPException) as exc:
        ns.verify_ipn(verification_token=token, payload=payload)
    assert "payload hash mismatch" in str(exc.value.detail)
