"""Lean-gate unit coverage for ``pricing``, ``pii`` and ``captcha`` services.

``pricing`` and ``pii`` are pure logic. ``captcha`` performs an outbound
Turnstile verification; its HTTP client is replaced with an in-process fake so
every branch (disabled, misconfig, missing secret, missing token, transport
error, non-200, unsuccessful body, success) runs without network access.
"""

from __future__ import annotations

import asyncio
from decimal import Decimal
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException

from app.core.config import settings
from app.models.user import User, UserRole
from app.services import captcha, pii, pricing


D = Decimal


# --------------------------------------------------------------------------- #
# pricing                                                                      #
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    ("value", "rounding", "expected"),
    [
        (D("1.005"), "half_up", D("1.01")),
        (D("1.005"), "half_even", D("1.00")),
        (D("1.001"), "up", D("1.01")),
        (D("1.009"), "down", D("1.00")),
        (D("1.005"), "unknown-mode", D("1.01")),
    ],
)
def test_quantize_money_modes(value, rounding, expected) -> None:
    assert pricing.quantize_money(value, rounding=rounding) == expected


def test_compute_fee_disabled_and_zero() -> None:
    assert pricing.compute_fee(
        taxable_subtotal=D("100"), enabled=False, fee_type="flat", fee_value=D("5")
    ) == D("0.00")
    assert pricing.compute_fee(
        taxable_subtotal=D("100"), enabled=True, fee_type="flat", fee_value=D("0")
    ) == D("0.00")


def test_compute_fee_flat_and_percent() -> None:
    assert pricing.compute_fee(
        taxable_subtotal=D("100"), enabled=True, fee_type="flat", fee_value=D("5")
    ) == D("5.00")
    assert pricing.compute_fee(
        taxable_subtotal=D("200"), enabled=True, fee_type="percent", fee_value=D("10")
    ) == D("20.00")


def test_compute_vat_disabled_zero_and_nonpositive_base() -> None:
    assert pricing.compute_vat(
        taxable_subtotal=D("100"),
        shipping=D("0"),
        fee=D("0"),
        enabled=False,
        vat_rate_percent=D("19"),
        apply_to_shipping=False,
        apply_to_fee=False,
    ) == D("0.00")
    assert pricing.compute_vat(
        taxable_subtotal=D("100"),
        shipping=D("0"),
        fee=D("0"),
        enabled=True,
        vat_rate_percent=D("0"),
        apply_to_shipping=False,
        apply_to_fee=False,
    ) == D("0.00")
    # Base goes non-positive.
    assert pricing.compute_vat(
        taxable_subtotal=D("0"),
        shipping=D("0"),
        fee=D("0"),
        enabled=True,
        vat_rate_percent=D("19"),
        apply_to_shipping=False,
        apply_to_fee=False,
    ) == D("0.00")


def test_compute_vat_applies_to_shipping_and_fee() -> None:
    vat = pricing.compute_vat(
        taxable_subtotal=D("100"),
        shipping=D("10"),
        fee=D("5"),
        enabled=True,
        vat_rate_percent=D("10"),
        apply_to_shipping=True,
        apply_to_fee=True,
    )
    assert vat == D("11.50")


def test_compute_totals_full_path() -> None:
    bd = pricing.compute_totals(
        subtotal=D("100"),
        discount=D("10"),
        shipping=D("20"),
        fee_enabled=True,
        fee_type="percent",
        fee_value=D("5"),
        vat_enabled=True,
        vat_rate_percent=D("19"),
        vat_apply_to_shipping=True,
        vat_apply_to_fee=True,
    )
    assert bd.subtotal == D("100.00")
    assert bd.discount == D("10.00")
    assert bd.taxable_subtotal == D("90.00")
    assert bd.shipping == D("20.00")
    assert bd.fee == D("4.50")  # 5% of 90
    # vat = 19% of (90 + 20 + 4.50)
    assert bd.vat == D("21.76")
    assert bd.total == bd.taxable_subtotal + bd.shipping + bd.fee + bd.vat


def test_compute_totals_vat_override_and_clamps() -> None:
    # Discount larger than subtotal clamps taxable to 0; vat_override used.
    bd = pricing.compute_totals(
        subtotal=D("10"),
        discount=D("50"),
        shipping=D("0"),
        fee_enabled=False,
        fee_type="flat",
        fee_value=D("0"),
        vat_enabled=True,
        vat_rate_percent=D("19"),
        vat_apply_to_shipping=False,
        vat_apply_to_fee=False,
        vat_override=D("3.33"),
    )
    assert bd.taxable_subtotal == D("0.00")
    assert bd.vat == D("3.33")


def test_compute_totals_vat_disabled_and_negative_override() -> None:
    bd = pricing.compute_totals(
        subtotal=D("10"),
        discount=D("0"),
        shipping=D("0"),
        fee_enabled=False,
        fee_type="flat",
        fee_value=D("0"),
        vat_enabled=False,
        vat_rate_percent=D("19"),
        vat_apply_to_shipping=False,
        vat_apply_to_fee=False,
    )
    assert bd.vat == D("0.00")

    bd2 = pricing.compute_totals(
        subtotal=D("10"),
        discount=D("0"),
        shipping=D("0"),
        fee_enabled=False,
        fee_type="flat",
        fee_value=D("0"),
        vat_enabled=True,
        vat_rate_percent=D("19"),
        vat_apply_to_shipping=False,
        vat_apply_to_fee=False,
        vat_override=D("-5"),
    )
    assert bd2.vat == D("0.00")


# --------------------------------------------------------------------------- #
# pii                                                                          #
# --------------------------------------------------------------------------- #
def _user(role: UserRole) -> User:
    return User(email="a@b.com", role=role)


def test_can_reveal_pii() -> None:
    assert pii.can_reveal_pii(None) is False
    assert pii.can_reveal_pii(_user(UserRole.admin)) is True
    assert pii.can_reveal_pii(_user(UserRole.customer)) is False


def test_require_pii_reveal_allows_and_denies() -> None:
    req = SimpleNamespace()
    # Allowed role -> no raise.
    pii.require_pii_reveal(_user(UserRole.owner), request=req)  # type: ignore[arg-type]
    with pytest.raises(HTTPException) as exc:
        pii.require_pii_reveal(_user(UserRole.customer), request=req)  # type: ignore[arg-type]
    assert exc.value.status_code == 403


def test_mask_email_variants() -> None:
    assert pii.mask_email(None) is None
    assert pii.mask_email("noatsign") == "noatsign"
    assert pii.mask_email("@domain.com") == "@domain.com"
    assert pii.mask_email("a@b.com") == "*@b.com"
    assert pii.mask_email("alexander@example.com") == "a********@example.com"


def test_mask_phone_variants() -> None:
    assert pii.mask_phone(None) is None
    assert pii.mask_phone("   ") == "   "
    assert pii.mask_phone("not-a-phone") == "***"
    # Too few digits to satisfy the E.164-ish regex -> "***".
    assert pii.mask_phone("1234") == "***"
    # 11 digits -> 9 masked + last 2 kept.
    assert pii.mask_phone("+40723204204") == "+*********04"
    assert pii.mask_phone("0040723") == "+*****23"


def test_mask_text_variants() -> None:
    assert pii.mask_text(None) is None
    assert pii.mask_text("  ") == "  "
    assert pii.mask_text("secret", keep=0) == "***"
    assert pii.mask_text("secret", keep=2) == "se***"


def test_redact_emails_in_text() -> None:
    out = pii.redact_emails_in_text("ping john.doe@example.com now")
    assert "john.doe@example.com" not in out
    assert "@example.com" in out
    assert pii.redact_emails_in_text(None) == ""


def test_mask_address_lines() -> None:
    masked = pii.mask_address_lines(
        line1="Str. Foo 1", line2="", postal_code="010101", phone="+40723204204"
    )
    assert masked["line1"] == "***"
    assert masked["line2"] == ""
    assert masked["postal_code"] == "***"
    assert masked["phone"] == "+*********04"
    # No phone -> None.
    assert (
        pii.mask_address_lines(line1=None, line2=None, postal_code=None)["phone"]
        is None
    )


def test_mask_many_emails() -> None:
    assert pii.mask_many_emails(["a@b.com", None]) == ["*@b.com", None]


# --------------------------------------------------------------------------- #
# captcha                                                                      #
# --------------------------------------------------------------------------- #
class _FakeResponse:
    def __init__(self, status_code: int, body: object) -> None:
        self.status_code = status_code
        self._body = body
        self.content = b"x" if body is not None else b""

    def json(self) -> object:
        return self._body


class _FakeClient:
    def __init__(self, *, response=None, error: Exception | None = None) -> None:
        self._response = response
        self._error = error

    async def __aenter__(self) -> "_FakeClient":
        return self

    async def __aexit__(self, *exc) -> None:
        return None

    async def post(self, url, data=None):  # noqa: ANN001
        if self._error is not None:
            raise self._error
        return self._response


def _patch_client(monkeypatch, **kwargs) -> None:
    monkeypatch.setattr(
        captcha.httpx, "AsyncClient", lambda *a, **k: _FakeClient(**kwargs)
    )


def _captcha_settings(monkeypatch, **overrides) -> None:
    defaults = {
        "captcha_enabled": True,
        "captcha_provider": "turnstile",
        "turnstile_secret_key": "secret",
    }
    defaults.update(overrides)
    for key, val in defaults.items():
        monkeypatch.setattr(settings, key, val)


def test_captcha_disabled_is_noop(monkeypatch) -> None:
    _captcha_settings(monkeypatch, captcha_enabled=False)
    asyncio.run(captcha.verify("any"))


def test_captcha_bad_provider(monkeypatch) -> None:
    _captcha_settings(monkeypatch, captcha_provider="hcaptcha")
    with pytest.raises(HTTPException) as exc:
        asyncio.run(captcha.verify("t"))
    assert exc.value.status_code == 500


def test_captcha_missing_secret(monkeypatch) -> None:
    _captcha_settings(monkeypatch, turnstile_secret_key="  ")
    with pytest.raises(HTTPException) as exc:
        asyncio.run(captcha.verify("t"))
    assert exc.value.status_code == 500


def test_captcha_missing_token(monkeypatch) -> None:
    _captcha_settings(monkeypatch)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(captcha.verify("   "))
    assert exc.value.status_code == 400


def test_captcha_transport_error(monkeypatch) -> None:
    _captcha_settings(monkeypatch)
    _patch_client(monkeypatch, error=httpx.ConnectError("down"))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(captcha.verify("t", remote_ip="1.2.3.4"))
    assert exc.value.status_code == 503


def test_captcha_non_200(monkeypatch) -> None:
    _captcha_settings(monkeypatch)
    _patch_client(monkeypatch, response=_FakeResponse(500, {"success": True}))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(captcha.verify("t"))
    assert exc.value.status_code == 503


def test_captcha_unsuccessful_body(monkeypatch) -> None:
    _captcha_settings(monkeypatch)
    _patch_client(monkeypatch, response=_FakeResponse(200, {"success": False}))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(captcha.verify("t"))
    assert exc.value.status_code == 400


def test_captcha_empty_body_is_unsuccessful(monkeypatch) -> None:
    _captcha_settings(monkeypatch)
    _patch_client(monkeypatch, response=_FakeResponse(200, None))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(captcha.verify("t"))
    assert exc.value.status_code == 400


def test_captcha_success(monkeypatch) -> None:
    _captcha_settings(monkeypatch)
    _patch_client(monkeypatch, response=_FakeResponse(200, {"success": True}))
    asyncio.run(captcha.verify("t", remote_ip="9.9.9.9"))
