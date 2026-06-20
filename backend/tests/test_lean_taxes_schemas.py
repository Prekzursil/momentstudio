"""Lean-gate unit coverage for ``app.schemas.taxes``.

Exercises the field validators end-to-end: country-code normalization (valid,
wrong length, non-alpha) and tax-group code normalization (slugified, empty).
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas.taxes import TaxGroupCreate, TaxRateUpsert
from app.schemas.taxes import _normalize_country_code


def test_normalize_country_code_valid() -> None:
    assert _normalize_country_code(" ro ") == "RO"


def test_normalize_country_code_wrong_length() -> None:
    # The 2-char Field constraint blocks this at model level, so the validator's
    # own length guard is exercised by calling the helper directly.
    with pytest.raises(ValueError):
        _normalize_country_code("ROU")


def test_tax_rate_upsert_normalizes_country_code() -> None:
    model = TaxRateUpsert(country_code="ro", vat_rate_percent=19)
    assert model.country_code == "RO"


def test_tax_rate_upsert_rejects_non_alpha_country_code() -> None:
    # 2 chars (passes the Field max_length) but non-alpha -> validator raises.
    with pytest.raises(ValidationError):
        TaxRateUpsert(country_code="R1", vat_rate_percent=19)


def test_tax_group_create_slugifies_code() -> None:
    model = TaxGroupCreate(code="  Standard Rate  ", name="Standard")
    assert model.code == "standard-rate"


def test_tax_group_create_rejects_blank_code() -> None:
    # A code that is all whitespace/length-passing but normalizes to empty.
    with pytest.raises(ValidationError):
        TaxGroupCreate(code="  ", name="Standard")
