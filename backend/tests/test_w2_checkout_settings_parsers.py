"""Coverage for ``app.services.checkout_settings`` parser helpers and the
``get_checkout_settings`` normalisation/clamp branches.

Disjoint from ``test_checkout_settings_redirects`` (which exercises the redirect
plumbing via cart totals): this module unit-tests the pure parsers directly and
drives ``get_checkout_settings`` with a stubbed content block so every clamp
branch is hit.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from app.services import checkout_settings as cs

# --------------------------------------------------------------------------- #
# _parse_decimal                                                               #
# --------------------------------------------------------------------------- #
FB_DEC = Decimal("9.99")


def test_parse_decimal_none_returns_fallback() -> None:
    assert cs._parse_decimal(None, fallback=FB_DEC) == FB_DEC


def test_parse_decimal_decimal_passthrough() -> None:
    assert cs._parse_decimal(Decimal("3.14"), fallback=FB_DEC) == Decimal("3.14")


def test_parse_decimal_numeric_int_and_float() -> None:
    assert cs._parse_decimal(5, fallback=FB_DEC) == Decimal("5")
    assert cs._parse_decimal(2.5, fallback=FB_DEC) == Decimal("2.5")


def test_parse_decimal_numeric_invalid_returns_fallback() -> None:
    # A float subclass whose ``__str__`` yields a non-numeric token still passes
    # the ``isinstance(value, (int, float))`` check, so ``Decimal(str(value))``
    # raises ``InvalidOperation`` and the numeric-branch fallback is returned.
    class _BadFloat(float):
        def __str__(self) -> str:
            return "not-a-decimal"

    assert cs._parse_decimal(_BadFloat(1.0), fallback=FB_DEC) == FB_DEC


def test_parse_decimal_blank_string_returns_fallback() -> None:
    assert cs._parse_decimal("   ", fallback=FB_DEC) == FB_DEC


def test_parse_decimal_valid_string() -> None:
    assert cs._parse_decimal("12.34", fallback=FB_DEC) == Decimal("12.34")


def test_parse_decimal_invalid_string_returns_fallback() -> None:
    assert cs._parse_decimal("not-a-number", fallback=FB_DEC) == FB_DEC


def test_parse_decimal_unsupported_type_returns_fallback() -> None:
    assert cs._parse_decimal(["x"], fallback=FB_DEC) == FB_DEC


# --------------------------------------------------------------------------- #
# _parse_bool                                                                  #
# --------------------------------------------------------------------------- #
def test_parse_bool_none_returns_fallback() -> None:
    assert cs._parse_bool(None, fallback=True) is True


def test_parse_bool_bool_passthrough() -> None:
    assert cs._parse_bool(False, fallback=True) is False


def test_parse_bool_numeric() -> None:
    assert cs._parse_bool(1, fallback=False) is True
    assert cs._parse_bool(0, fallback=True) is False


@pytest.mark.parametrize("truthy", ["1", "true", "YES", " on "])
def test_parse_bool_truthy_strings(truthy: str) -> None:
    assert cs._parse_bool(truthy, fallback=False) is True


@pytest.mark.parametrize("falsy", ["0", "false", "NO", " off "])
def test_parse_bool_falsy_strings(falsy: str) -> None:
    assert cs._parse_bool(falsy, fallback=True) is False


def test_parse_bool_unknown_string_returns_fallback() -> None:
    assert cs._parse_bool("maybe", fallback=True) is True


def test_parse_bool_unsupported_type_returns_fallback() -> None:
    assert cs._parse_bool(object(), fallback=False) is False


# --------------------------------------------------------------------------- #
# _parse_int                                                                   #
# --------------------------------------------------------------------------- #
def test_parse_int_none_returns_fallback() -> None:
    assert cs._parse_int(None, fallback=7) == 7


def test_parse_int_bool_returns_fallback() -> None:
    # bool is an int subclass and must be rejected.
    assert cs._parse_int(True, fallback=7) == 7


def test_parse_int_int_passthrough() -> None:
    assert cs._parse_int(42, fallback=7) == 42


def test_parse_int_float_truncates() -> None:
    assert cs._parse_int(3.9, fallback=7) == 3


def test_parse_int_float_invalid_returns_fallback() -> None:
    assert cs._parse_int(float("nan"), fallback=7) == 7


def test_parse_int_blank_string_returns_fallback() -> None:
    assert cs._parse_int("  ", fallback=7) == 7


def test_parse_int_valid_string() -> None:
    assert cs._parse_int("123", fallback=7) == 123


def test_parse_int_invalid_string_returns_fallback() -> None:
    assert cs._parse_int("12x", fallback=7) == 7


def test_parse_int_unsupported_type_returns_fallback() -> None:
    assert cs._parse_int(["x"], fallback=7) == 7


# --------------------------------------------------------------------------- #
# get_checkout_settings normalisation / clamps                                 #
# --------------------------------------------------------------------------- #
class _Block:
    def __init__(self, meta: dict) -> None:
        self.meta = meta


@pytest.mark.anyio
async def test_get_checkout_settings_no_block_uses_defaults(monkeypatch) -> None:
    async def fake(session, key):  # noqa: ANN001
        return None

    monkeypatch.setattr(
        cs.content_service, "get_published_by_key_following_redirects", fake
    )
    result = await cs.get_checkout_settings(session=object())
    assert result.shipping_fee_ron == cs.DEFAULT_SHIPPING_FEE_RON
    assert result.money_rounding == cs.DEFAULT_MONEY_ROUNDING
    assert result.fee_type == "flat"


@pytest.mark.anyio
async def test_get_checkout_settings_full_meta_and_percent_and_rounding(
    monkeypatch,
) -> None:
    meta = {
        "shipping_fee_ron": "15.00",
        "free_shipping_threshold_ron": "250",
        "phone_required_home": "false",
        "phone_required_locker": "true",
        "fee_enabled": "yes",
        "fee_type": "percent",
        "fee_value": "5",
        "vat_enabled": "no",
        "vat_rate_percent": "19",
        "vat_apply_to_shipping": "1",
        "vat_apply_to_fee": "0",
        "receipt_share_days": "100",
        "money_rounding": "half_even",
    }

    async def fake(session, key):  # noqa: ANN001
        return _Block(meta)

    monkeypatch.setattr(
        cs.content_service, "get_published_by_key_following_redirects", fake
    )
    result = await cs.get_checkout_settings(session=object())
    assert result.fee_type == "percent"
    assert result.money_rounding == "half_even"
    assert result.vat_rate_percent == Decimal("19")
    assert result.receipt_share_days == 100
    assert result.phone_required_home is False


@pytest.mark.anyio
async def test_get_checkout_settings_clamps_out_of_range(monkeypatch) -> None:
    meta = {
        "shipping_fee_ron": "-1",
        "free_shipping_threshold_ron": "-5",
        "fee_value": "-2",
        "vat_rate_percent": "-10",
        "receipt_share_days": "0",
        "money_rounding": "garbage",
    }

    async def fake(session, key):  # noqa: ANN001
        return _Block(meta)

    monkeypatch.setattr(
        cs.content_service, "get_published_by_key_following_redirects", fake
    )
    result = await cs.get_checkout_settings(session=object())
    assert result.shipping_fee_ron == cs.DEFAULT_SHIPPING_FEE_RON
    assert result.free_shipping_threshold_ron == cs.DEFAULT_FREE_SHIPPING_THRESHOLD_RON
    assert result.fee_value == cs.DEFAULT_FEE_VALUE
    assert result.vat_rate_percent == cs.DEFAULT_VAT_RATE_PERCENT
    assert result.receipt_share_days == cs.DEFAULT_RECEIPT_SHARE_DAYS
    # invalid money_rounding falls back to the default
    assert result.money_rounding == cs.DEFAULT_MONEY_ROUNDING


@pytest.mark.anyio
async def test_get_checkout_settings_clamps_upper_bounds(monkeypatch) -> None:
    meta = {
        "vat_rate_percent": "150",
        "receipt_share_days": "99999",
    }

    async def fake(session, key):  # noqa: ANN001
        return _Block(meta)

    monkeypatch.setattr(
        cs.content_service, "get_published_by_key_following_redirects", fake
    )
    result = await cs.get_checkout_settings(session=object())
    assert result.vat_rate_percent == Decimal("100.00")
    assert result.receipt_share_days == 3650
