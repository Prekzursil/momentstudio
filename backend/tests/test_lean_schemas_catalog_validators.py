"""Lean-gate unit coverage for the validators/helpers in ``app.schemas.catalog``.

The catalog schema module is mostly declarative pydantic models (covered by
import), but it also carries hand-written validation logic:

* the ``_normalize_courier`` / ``_validate_disallowed_couriers`` helpers,
* ``ProductFields`` validators (long_description, shipping couriers, currency),
* ``ProductUpdate`` validators (currency/couriers/long_description, incl. the
  ``None`` short-circuits unique to the partial-update model),
* ``ProductTranslationUpsert.validate_long_description``.

This file drives every branch of those code paths directly through the public
schema constructors and helper functions.
"""

from __future__ import annotations

from decimal import Decimal
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.catalog import (
    ProductFields,
    ProductTranslationUpsert,
    ProductUpdate,
    _normalize_courier,
    _validate_disallowed_couriers,
)


# --- helper functions --------------------------------------------------------


def test_normalize_courier_strips_and_lowercases() -> None:
    assert _normalize_courier("  SameDay  ") == "sameday"
    assert _normalize_courier(None) == ""
    assert _normalize_courier(0) == ""


def test_validate_disallowed_couriers_none_returns_empty() -> None:
    assert _validate_disallowed_couriers(None) == []


def test_validate_disallowed_couriers_rejects_non_list() -> None:
    with pytest.raises(ValueError, match="Invalid couriers list"):
        _validate_disallowed_couriers("sameday")


def test_validate_disallowed_couriers_rejects_unknown_code() -> None:
    with pytest.raises(ValueError, match="Invalid courier"):
        _validate_disallowed_couriers(["dhl"])


def test_validate_disallowed_couriers_dedupes_and_skips_blanks() -> None:
    # Blank entries are skipped; duplicates collapse but order is preserved.
    result = _validate_disallowed_couriers(
        ["fan_courier", "", "  SAMEDAY ", "fan_courier"]
    )
    assert result == ["fan_courier", "sameday"]


# --- ProductFields validators ------------------------------------------------


def _product_fields(**overrides: object) -> ProductFields:
    base: dict[str, object] = {
        "category_id": uuid4(),
        "name": "Product",
        "base_price": Decimal("1.00"),
        "stock_quantity": 0,
    }
    base.update(overrides)
    return ProductFields(**base)


def test_product_fields_long_description_rejects_script() -> None:
    with pytest.raises(ValidationError, match="Invalid rich text content"):
        _product_fields(long_description="<SCRIPT>alert(1)</script>")


def test_product_fields_long_description_allows_clean_and_none() -> None:
    assert _product_fields(long_description="hello").long_description == "hello"
    assert _product_fields(long_description=None).long_description is None


def test_product_fields_shipping_couriers_normalized() -> None:
    pf = _product_fields(shipping_disallowed_couriers=["SameDay", "fan_courier"])
    assert pf.shipping_disallowed_couriers == ["sameday", "fan_courier"]


def test_product_fields_currency_normalizes_and_rejects() -> None:
    assert _product_fields(currency="ron").currency == "RON"
    with pytest.raises(ValidationError, match="Only RON currency is supported"):
        _product_fields(currency="usd")


# --- ProductUpdate validators (with their None short-circuits) ----------------


def test_product_update_currency_none_passthrough() -> None:
    assert ProductUpdate(currency=None).currency is None


def test_product_update_currency_normalizes_and_rejects() -> None:
    assert ProductUpdate(currency="ron").currency == "RON"
    with pytest.raises(ValidationError, match="Only RON currency is supported"):
        ProductUpdate(currency="eur")


def test_product_update_couriers_none_passthrough() -> None:
    assert (
        ProductUpdate(shipping_disallowed_couriers=None).shipping_disallowed_couriers
        is None
    )


def test_product_update_couriers_validated() -> None:
    pu = ProductUpdate(shipping_disallowed_couriers=["sameday", "sameday"])
    assert pu.shipping_disallowed_couriers == ["sameday"]
    with pytest.raises(ValidationError, match="Invalid courier"):
        ProductUpdate(shipping_disallowed_couriers=["nope"])


def test_product_update_long_description_validator() -> None:
    assert ProductUpdate(long_description=None).long_description is None
    assert ProductUpdate(long_description="ok").long_description == "ok"
    with pytest.raises(ValidationError, match="Invalid rich text content"):
        ProductUpdate(long_description="<script>x</script>")


# --- ProductTranslationUpsert validator --------------------------------------


def test_translation_long_description_validator() -> None:
    assert (
        ProductTranslationUpsert(name="N", long_description=None).long_description
        is None
    )
    assert (
        ProductTranslationUpsert(name="N", long_description="fine").long_description
        == "fine"
    )
    with pytest.raises(ValidationError, match="Invalid rich text content"):
        ProductTranslationUpsert(name="N", long_description="<ScRiPt>bad")
