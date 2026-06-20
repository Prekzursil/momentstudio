"""Lean-gate coverage worker [w3] for ``app.services.catalog`` — the pure
(non-DB) helper surface.

``catalog.py`` is a large service module already broadly exercised by the
catalog API + service siblings. This file closes the residual on the pure,
synchronous helpers that the sibling suite does not drive directly:
price/currency + sale-schedule validation, badge building, decimal/tz coercion,
sale-price computation + field sync, translation application, slugify / search
normalisation, and the image-stats wrappers (with their storage calls stubbed).

The two ``except Exception:`` arms in the image helpers are marked
``# pragma: no cover`` in source (defensive, generic), so they are not targeted.
DB-bound catalog service functions (full-text search, ``ON CONFLICT`` upserts,
``session.get(Model, str-uuid)``) are out of scope for this pure-helper file and
noted in the worker REMAINING summary.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.models.catalog import ProductBadge
from app.services import catalog


# --------------------------------------------------------------------------- #
# _validate_price_currency                                                     #
# --------------------------------------------------------------------------- #
def test_validate_price_currency_ok() -> None:
    catalog._validate_price_currency(Decimal("10.00"), "ron")
    catalog._validate_price_currency(None, "")  # blank currency allowed


def test_validate_price_currency_negative_price() -> None:
    with pytest.raises(HTTPException) as exc:
        catalog._validate_price_currency(Decimal("-1"), "RON")
    assert exc.value.status_code == 400


def test_validate_price_currency_bad_length() -> None:
    with pytest.raises(HTTPException) as exc:
        catalog._validate_price_currency(Decimal("1"), "RONN")
    assert "3-letter" in exc.value.detail


def test_validate_price_currency_unsupported() -> None:
    with pytest.raises(HTTPException) as exc:
        catalog._validate_price_currency(Decimal("1"), "EUR")
    assert "RON" in exc.value.detail


# --------------------------------------------------------------------------- #
# _to_decimal / _tz_aware                                                      #
# --------------------------------------------------------------------------- #
def test_to_decimal_branches() -> None:
    assert catalog._to_decimal(None) == Decimal("0.00")
    d = Decimal("3.50")
    assert catalog._to_decimal(d) is d
    assert catalog._to_decimal("2.25") == Decimal("2.25")
    assert catalog._to_decimal(5) == Decimal("5")


def test_tz_aware_branches() -> None:
    assert catalog._tz_aware(None) is None
    aware = datetime(2024, 1, 1, tzinfo=timezone.utc)
    assert catalog._tz_aware(aware) is aware
    naive = datetime(2024, 1, 1)
    assert catalog._tz_aware(naive).tzinfo is timezone.utc


# --------------------------------------------------------------------------- #
# _validate_sale_schedule                                                      #
# --------------------------------------------------------------------------- #
def test_validate_sale_schedule_ok() -> None:
    start = datetime(2024, 1, 1, tzinfo=timezone.utc)
    end = datetime(2024, 2, 1, tzinfo=timezone.utc)
    catalog._validate_sale_schedule(
        sale_start_at=start, sale_end_at=end, sale_auto_publish=True
    )


def test_validate_sale_schedule_end_before_start() -> None:
    start = datetime(2024, 2, 1, tzinfo=timezone.utc)
    end = datetime(2024, 1, 1, tzinfo=timezone.utc)
    with pytest.raises(HTTPException) as exc:
        catalog._validate_sale_schedule(
            sale_start_at=start, sale_end_at=end, sale_auto_publish=False
        )
    assert "after sale start" in exc.value.detail


def test_validate_sale_schedule_auto_publish_requires_start() -> None:
    with pytest.raises(HTTPException) as exc:
        catalog._validate_sale_schedule(
            sale_start_at=None, sale_end_at=None, sale_auto_publish=True
        )
    assert "auto-publish" in exc.value.detail


# --------------------------------------------------------------------------- #
# _build_product_badges                                                        #
# --------------------------------------------------------------------------- #
def test_build_product_badges_ok() -> None:
    start = datetime(2024, 1, 1, tzinfo=timezone.utc)
    end = datetime(2024, 2, 1, tzinfo=timezone.utc)
    badges = catalog._build_product_badges(
        [
            {"badge": "new", "start_at": start, "end_at": end},
            {"badge": "hot"},  # no dates -> None branches
        ]
    )
    assert [b.badge for b in badges] == ["new", "hot"]
    assert isinstance(badges[0], ProductBadge)


def test_build_product_badges_missing_badge() -> None:
    with pytest.raises(HTTPException) as exc:
        catalog._build_product_badges([{"badge": ""}])
    assert "Badge is required" in exc.value.detail


def test_build_product_badges_duplicate() -> None:
    with pytest.raises(HTTPException) as exc:
        catalog._build_product_badges([{"badge": "x"}, {"badge": "x"}])
    assert "Duplicate" in exc.value.detail


def test_build_product_badges_end_before_start() -> None:
    start = datetime(2024, 2, 1, tzinfo=timezone.utc)
    end = datetime(2024, 1, 1, tzinfo=timezone.utc)
    with pytest.raises(HTTPException) as exc:
        catalog._build_product_badges(
            [{"badge": "x", "start_at": start, "end_at": end}]
        )
    assert "Badge end must be after" in exc.value.detail


# --------------------------------------------------------------------------- #
# is_sale_active                                                               #
# --------------------------------------------------------------------------- #
def _product(**kw):
    base = {
        "sale_price": Decimal("5.00"),
        "sale_start_at": None,
        "sale_end_at": None,
    }
    base.update(kw)
    return SimpleNamespace(**base)


def test_is_sale_active_no_sale_price() -> None:
    assert catalog.is_sale_active(_product(sale_price=None)) is False


def test_is_sale_active_within_window() -> None:
    now = datetime(2024, 1, 15, tzinfo=timezone.utc)
    product = _product(
        sale_start_at=datetime(2024, 1, 1, tzinfo=timezone.utc),
        sale_end_at=datetime(2024, 2, 1, tzinfo=timezone.utc),
    )
    assert catalog.is_sale_active(product, now=now) is True


def test_is_sale_active_before_start() -> None:
    now = datetime(2023, 12, 1, tzinfo=timezone.utc)
    product = _product(sale_start_at=datetime(2024, 1, 1, tzinfo=timezone.utc))
    assert catalog.is_sale_active(product, now=now) is False


def test_is_sale_active_after_end() -> None:
    now = datetime(2024, 3, 1, tzinfo=timezone.utc)
    product = _product(sale_end_at=datetime(2024, 2, 1, tzinfo=timezone.utc))
    assert catalog.is_sale_active(product, now=now) is False


def test_is_sale_active_default_now() -> None:
    # No window + a sale price -> active, exercises the ``now or now()`` default.
    assert catalog.is_sale_active(_product()) is True


# --------------------------------------------------------------------------- #
# _compute_sale_price                                                          #
# --------------------------------------------------------------------------- #
def test_compute_sale_price_no_type_or_value() -> None:
    assert (
        catalog._compute_sale_price(base_price=10, sale_type=None, sale_value=5) is None
    )
    assert (
        catalog._compute_sale_price(base_price=10, sale_type="percent", sale_value=None)
        is None
    )


def test_compute_sale_price_non_positive_base_or_value() -> None:
    assert (
        catalog._compute_sale_price(base_price=0, sale_type="percent", sale_value=10)
        is None
    )
    assert (
        catalog._compute_sale_price(base_price=10, sale_type="percent", sale_value=0)
        is None
    )


def test_compute_sale_price_percent() -> None:
    price = catalog._compute_sale_price(
        base_price=Decimal("100"), sale_type="percent", sale_value=Decimal("10")
    )
    assert price == Decimal("90.00")


def test_compute_sale_price_percent_full_discount() -> None:
    # >= 100% discount -> discount == base -> price 0.00.
    price = catalog._compute_sale_price(
        base_price=Decimal("50"), sale_type="percent", sale_value=Decimal("100")
    )
    assert price == Decimal("0.00")


def test_compute_sale_price_amount() -> None:
    price = catalog._compute_sale_price(
        base_price=Decimal("20"), sale_type="amount", sale_value=Decimal("5")
    )
    assert price == Decimal("15.00")


def test_compute_sale_price_amount_exceeds_base() -> None:
    # discount > base -> price <= 0 -> returns 0.00.
    price = catalog._compute_sale_price(
        base_price=Decimal("10"), sale_type="amount", sale_value=Decimal("99")
    )
    assert price == Decimal("0.00")


def test_compute_sale_price_unknown_type() -> None:
    assert (
        catalog._compute_sale_price(
            base_price=Decimal("10"), sale_type="weird", sale_value=Decimal("1")
        )
        is None
    )


def test_compute_sale_price_not_below_base() -> None:
    # An amount discount that rounds to 0 keeps price >= base -> None.
    price = catalog._compute_sale_price(
        base_price=Decimal("10"), sale_type="amount", sale_value=Decimal("0.001")
    )
    assert price is None


# --------------------------------------------------------------------------- #
# _sync_sale_fields                                                            #
# --------------------------------------------------------------------------- #
def test_sync_sale_fields_clears_when_no_sale() -> None:
    product = SimpleNamespace(
        base_price=Decimal("10"),
        sale_type=None,
        sale_value=None,
        sale_price=Decimal("5"),
        sale_start_at=datetime(2024, 1, 1, tzinfo=timezone.utc),
        sale_end_at=datetime(2024, 2, 1, tzinfo=timezone.utc),
        sale_auto_publish=True,
    )
    catalog._sync_sale_fields(product)
    assert product.sale_price is None
    assert product.sale_type is None
    assert product.sale_start_at is None
    assert product.sale_auto_publish is False


def test_sync_sale_fields_sets_active_sale() -> None:
    product = SimpleNamespace(
        base_price=Decimal("100"),
        sale_type="percent",
        sale_value=Decimal("10"),
        sale_price=None,
        sale_start_at=datetime(2024, 1, 1),  # naive -> tz-normalised
        sale_end_at=None,
        sale_auto_publish=True,
    )
    catalog._sync_sale_fields(product)
    assert product.sale_price == Decimal("90.00")
    assert product.sale_start_at.tzinfo is timezone.utc
    assert product.sale_auto_publish is True


# --------------------------------------------------------------------------- #
# apply_category_translation / apply_product_translation                       #
# --------------------------------------------------------------------------- #
def test_apply_category_translation_match() -> None:
    cat = SimpleNamespace(
        name="EN",
        description="EN desc",
        translations=[SimpleNamespace(lang="ro", name="RO", description="RO desc")],
    )
    catalog.apply_category_translation(cat, "ro")
    assert cat.name == "RO"
    assert cat.description == "RO desc"


def test_apply_category_translation_no_op() -> None:
    cat = SimpleNamespace(name="EN", description="d", translations=[])
    catalog.apply_category_translation(cat, "ro")
    assert cat.name == "EN"
    # Missing lang / no category also short-circuit.
    catalog.apply_category_translation(cat, None)
    catalog.apply_category_translation(None, "ro")


def test_apply_category_translation_lang_not_found() -> None:
    cat = SimpleNamespace(
        name="EN",
        description="d",
        translations=[SimpleNamespace(lang="de", name="DE", description="x")],
    )
    catalog.apply_category_translation(cat, "ro")
    assert cat.name == "EN"


def test_apply_product_translation_full() -> None:
    image = SimpleNamespace(
        alt_text="EN alt",
        caption="EN cap",
        translations=[SimpleNamespace(lang="ro", alt_text="RO alt", caption="RO cap")],
    )
    category = SimpleNamespace(
        name="EN cat",
        description="d",
        translations=[SimpleNamespace(lang="ro", name="RO cat", description="rd")],
    )
    product = SimpleNamespace(
        name="EN",
        short_description="s",
        long_description="l",
        meta_title="mt",
        meta_description="md",
        translations=[
            SimpleNamespace(
                lang="ro",
                name="RO",
                short_description="rs",
                long_description="rl",
                meta_title="",  # falsy -> keep existing meta_title
                meta_description="rmd",
            )
        ],
        category=category,
        images=[image],
    )
    catalog.apply_product_translation(product, "ro")
    assert product.name == "RO"
    assert product.meta_title == "mt"  # kept because translation meta_title falsy
    assert product.meta_description == "rmd"
    assert product.category.name == "RO cat"
    assert image.alt_text == "RO alt"
    assert image.caption == "RO cap"


def test_apply_product_translation_short_circuits() -> None:
    product = SimpleNamespace(name="EN")
    catalog.apply_product_translation(product, None)  # no lang
    catalog.apply_product_translation(None, "ro")  # no product
    assert product.name == "EN"


def test_apply_product_translation_no_match_and_empty_images() -> None:
    product = SimpleNamespace(
        name="EN",
        short_description="s",
        long_description="l",
        meta_title="mt",
        meta_description="md",
        translations=[SimpleNamespace(lang="de", name="DE")],
        category=None,
        images=[
            SimpleNamespace(alt_text="a", caption="c", translations=None),
            SimpleNamespace(
                alt_text="a2",
                caption="c2",
                translations=[SimpleNamespace(lang="de", alt_text="x", caption="y")],
            ),
        ],
    )
    catalog.apply_product_translation(product, "ro")
    assert product.name == "EN"  # no ro translation -> unchanged
    assert product.images[0].alt_text == "a"
    assert product.images[1].alt_text == "a2"  # de match skipped for ro


def test_apply_product_translation_image_partial_fields() -> None:
    # Image translation with alt_text None but caption set -> only caption applied.
    product = SimpleNamespace(
        name="EN",
        short_description="s",
        long_description="l",
        meta_title="mt",
        meta_description="md",
        translations=None,
        category=None,
        images=[
            SimpleNamespace(
                alt_text="keep",
                caption="old",
                translations=[
                    SimpleNamespace(lang="ro", alt_text=None, caption="new cap")
                ],
            )
        ],
    )
    catalog.apply_product_translation(product, "ro")
    assert product.images[0].alt_text == "keep"
    assert product.images[0].caption == "new cap"


# --------------------------------------------------------------------------- #
# slugify / _normalize_search_text                                            #
# --------------------------------------------------------------------------- #
def test_slugify() -> None:
    assert catalog.slugify("Hello, World!") == "hello-world"
    assert catalog.slugify("  multiple   spaces  ") == "multiple-spaces"
    assert catalog.slugify("***") == ""


def test_normalize_search_text() -> None:
    assert catalog._normalize_search_text(None) == ""
    assert catalog._normalize_search_text("  ") == ""
    # Diacritics are stripped and lowercased.
    assert catalog._normalize_search_text("Țară") == "tara"


# --------------------------------------------------------------------------- #
# get_product_image_optimization_stats / reprocess_product_image_thumbnails    #
# --------------------------------------------------------------------------- #
def test_image_optimization_stats_ok(monkeypatch) -> None:
    monkeypatch.setattr(
        catalog, "get_media_image_stats", lambda url: {"width": 100, "height": 50}
    )
    image = SimpleNamespace(url="img.jpg")
    assert catalog.get_product_image_optimization_stats(image) == {
        "width": 100,
        "height": 50,
    }


def test_image_optimization_stats_value_error(monkeypatch) -> None:
    def boom(url):
        raise ValueError("bad image")

    monkeypatch.setattr(catalog, "get_media_image_stats", boom)
    with pytest.raises(HTTPException) as exc:
        catalog.get_product_image_optimization_stats(SimpleNamespace(url="x"))
    assert exc.value.status_code == 400


def test_reprocess_thumbnails_ok(monkeypatch) -> None:
    monkeypatch.setattr(
        catalog, "regenerate_media_thumbnails", lambda url: {"thumbs": 3}
    )
    assert catalog.reprocess_product_image_thumbnails(SimpleNamespace(url="x")) == {
        "thumbs": 3
    }


def test_reprocess_thumbnails_file_not_found(monkeypatch) -> None:
    def boom(url):
        raise FileNotFoundError

    monkeypatch.setattr(catalog, "regenerate_media_thumbnails", boom)
    with pytest.raises(HTTPException) as exc:
        catalog.reprocess_product_image_thumbnails(SimpleNamespace(url="x"))
    assert exc.value.status_code == 404


def test_reprocess_thumbnails_value_error(monkeypatch) -> None:
    def boom(url):
        raise ValueError("bad")

    monkeypatch.setattr(catalog, "regenerate_media_thumbnails", boom)
    with pytest.raises(HTTPException) as exc:
        catalog.reprocess_product_image_thumbnails(SimpleNamespace(url="x"))
    assert exc.value.status_code == 400
