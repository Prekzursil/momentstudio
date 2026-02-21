from decimal import Decimal

import pytest

from app import seeds


def test_load_profile_default_parses_catalog_and_content() -> None:
    categories, products, blocks = seeds._load_profile("default")

    assert categories
    assert products
    assert blocks
    assert isinstance(products[0]["base_price"], Decimal)

    legal_block = next(b for b in blocks if b["key"] == "page.terms-and-conditions")
    assert legal_block["translations"]
    assert "##" in legal_block["body_markdown"]


def test_load_profile_unknown_raises() -> None:
    with pytest.raises(SystemExit, match="Unknown seed profile"):
        seeds._load_profile("missing-profile")
