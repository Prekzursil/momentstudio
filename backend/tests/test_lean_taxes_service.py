"""Lean-gate unit coverage for ``app.services.taxes``.

Drives every public helper and branch against an in-memory SQLite engine:
country/group-code normalization, default-group resolution (default flag vs
``standard`` fallback vs none), per-country VAT lookups, group CRUD (incl. all
guard rails), rate upsert/delete, multi-product rate resolution, proportional
discount allocation (incl. penny remainder), and the full cart-VAT engine for
the disabled / no-country / per-rate / shipping+fee paths.
"""

from __future__ import annotations

import asyncio
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.models.catalog import Category, Product, ProductStatus
from app.models.taxes import TaxGroup, TaxRate
from app.services import taxes
from app.services.checkout_settings import CheckoutSettings
from app.services.taxes import (
    TaxableProductLine,
    _allocate_discount,
    _normalize_country_code,
    _normalize_group_code,
)

from tests.conftest import make_memory_session_factory


# --------------------------------------------------------------------------- #
# pure helpers                                                                 #
# --------------------------------------------------------------------------- #
def test_normalize_country_code_branches() -> None:
    assert _normalize_country_code(None) is None
    assert _normalize_country_code("  ") is None
    assert _normalize_country_code("ro") == "RO"
    with pytest.raises(HTTPException):
        _normalize_country_code("ROU")
    with pytest.raises(HTTPException):
        _normalize_country_code("R1")


def test_normalize_group_code_branches() -> None:
    assert _normalize_group_code("  Standard Rate ") == "standard-rate"
    with pytest.raises(HTTPException):
        _normalize_group_code("   ")
    long_code = _normalize_group_code("a" * 60)
    assert len(long_code) == 40


def test_allocate_discount_branches() -> None:
    assert _allocate_discount([], Decimal("5")) == []

    lines = [
        TaxableProductLine(product_id=uuid4(), subtotal=Decimal("10.00")),
        TaxableProductLine(product_id=uuid4(), subtotal=Decimal("20.00")),
    ]
    # Non-positive discount -> all zero.
    assert _allocate_discount(lines, Decimal("0")) == [
        Decimal("0.00"),
        Decimal("0.00"),
    ]
    # Discount rounding to zero pennies -> all zero.
    assert _allocate_discount(lines, Decimal("0.004")) == [
        Decimal("0.00"),
        Decimal("0.00"),
    ]
    # Discount larger than subtotal is capped to subtotal and fully allocated.
    capped = _allocate_discount(lines, Decimal("100.00"))
    assert sum(capped) == Decimal("30.00")
    # A discount that requires penny remainder distribution.
    pennied = _allocate_discount(lines, Decimal("10.00"))
    assert sum(pennied) == Decimal("10.00")


# --------------------------------------------------------------------------- #
# DB-backed helpers                                                            #
# --------------------------------------------------------------------------- #
def _category(**kw) -> Category:
    defaults = dict(slug=f"cat-{uuid4().hex[:8]}", name="Cat")
    defaults.update(kw)
    return Category(**defaults)


def _product(category: Category, **kw) -> Product:
    defaults = dict(
        category=category,
        slug=f"p-{uuid4().hex[:8]}",
        sku=f"SKU-{uuid4().hex[:8]}",
        name="Product",
        base_price=Decimal("10.00"),
        currency="RON",
        status=ProductStatus.published,
    )
    defaults.update(kw)
    return Product(**defaults)


def test_default_group_resolution_and_country_rate() -> None:
    factory = make_memory_session_factory()

    async def run() -> None:
        async with factory() as session:
            # No groups: default resolution returns None, rate falls back.
            assert await taxes._get_default_group_id(session) is None
            assert await taxes.default_country_vat_rate_percent(
                session, country_code="RO", fallback_rate_percent=Decimal("19")
            ) == Decimal("19")
            # No country -> fallback regardless of groups.
            assert await taxes.default_country_vat_rate_percent(
                session, country_code=None, fallback_rate_percent=Decimal("5")
            ) == Decimal("5")

            # A ``standard``-coded (non-default) group is used as fallback.
            standard = TaxGroup(code="standard", name="Standard", is_default=False)
            session.add(standard)
            await session.commit()
            await session.refresh(standard)
            assert await taxes._get_default_group_id(session) == standard.id

            # default group present with no matching rate -> fallback.
            assert await taxes.default_country_vat_rate_percent(
                session, country_code="RO", fallback_rate_percent=Decimal("7")
            ) == Decimal("7")

            # Add a matching rate -> returned.
            session.add(
                TaxRate(
                    group_id=standard.id,
                    country_code="RO",
                    vat_rate_percent=Decimal("11.00"),
                )
            )
            await session.commit()
            assert await taxes.default_country_vat_rate_percent(
                session, country_code="RO", fallback_rate_percent=Decimal("7")
            ) == Decimal("11.00")

            # An explicit default flag wins over the ``standard`` fallback.
            flagged = TaxGroup(code="reduced", name="Reduced", is_default=True)
            session.add(flagged)
            await session.commit()
            await session.refresh(flagged)
            assert await taxes._get_default_group_id(session) == flagged.id

    asyncio.run(run())


def test_group_crud_lifecycle() -> None:
    factory = make_memory_session_factory()

    async def run() -> None:
        async with factory() as session:
            created = await taxes.create_tax_group(
                session,
                code="Standard",
                name="Standard Group",
                description="desc",
                is_default=True,
            )
            assert created.code == "standard"
            assert created.is_default is True

            # Duplicate code rejected.
            with pytest.raises(HTTPException):
                await taxes.create_tax_group(
                    session,
                    code="standard",
                    name="x",
                    description=None,
                    is_default=False,
                )

            # A second default unsets the first.
            second = await taxes.create_tax_group(
                session,
                code="reduced",
                name="Reduced",
                description=None,
                is_default=True,
            )
            assert second.is_default is True

            groups = await taxes.list_tax_groups(session)
            assert {g.code for g in groups} == {"standard", "reduced"}

            # Update: name/description and toggling default off.
            updated = await taxes.update_tax_group(
                session,
                group=second,
                name="Reduced Rate",
                description="new",
                is_default=False,
            )
            assert updated.name == "Reduced Rate"
            assert updated.is_default is False

            # Update: set this group default (unsets others) without name change.
            updated2 = await taxes.update_tax_group(
                session, group=second, name=None, description=None, is_default=True
            )
            assert updated2.is_default is True

            # Update with is_default=None leaves the flag untouched (falls
            # through both default branches to the name/description checks).
            updated3 = await taxes.update_tax_group(
                session, group=second, name="Renamed", description=None, is_default=None
            )
            assert updated3.name == "Renamed"
            assert updated3.is_default is True

            # Cannot delete a default group.
            with pytest.raises(HTTPException):
                await taxes.delete_tax_group(session, group=updated2)

            # Make a deletable group referenced by a category -> blocked.
            deletable = await taxes.create_tax_group(
                session, code="other", name="Other", description=None, is_default=False
            )
            cat = _category(tax_group_id=deletable.id)
            session.add(cat)
            await session.commit()
            with pytest.raises(HTTPException):
                await taxes.delete_tax_group(session, group=deletable)

            # Remove the reference and delete succeeds.
            cat.tax_group_id = None
            await session.commit()
            await taxes.delete_tax_group(session, group=deletable)

    asyncio.run(run())


def test_rate_upsert_and_delete() -> None:
    factory = make_memory_session_factory()

    async def run() -> None:
        async with factory() as session:
            group = TaxGroup(code="standard", name="Standard")
            session.add(group)
            await session.commit()
            await session.refresh(group)

            # Out-of-range rate rejected.
            with pytest.raises(HTTPException):
                await taxes.upsert_tax_rate(
                    session,
                    group=group,
                    country_code="RO",
                    vat_rate_percent=Decimal("150"),
                )

            created = await taxes.upsert_tax_rate(
                session, group=group, country_code="ro", vat_rate_percent=Decimal("19")
            )
            assert created.country_code == "RO"
            assert created.vat_rate_percent == Decimal("19.00")

            # Upsert existing -> updates in place.
            updated = await taxes.upsert_tax_rate(
                session, group=group, country_code="RO", vat_rate_percent=Decimal("21")
            )
            assert updated.id == created.id
            assert updated.vat_rate_percent == Decimal("21.00")

            # Delete the rate.
            await taxes.delete_tax_rate(session, group_id=group.id, country_code="RO")
            remaining = await taxes.upsert_tax_rate(
                session, group=group, country_code="RO", vat_rate_percent=Decimal("5")
            )
            # New row id (the old one was deleted).
            assert remaining.id != created.id

    asyncio.run(run())


def test_vat_rates_for_products_branches() -> None:
    factory = make_memory_session_factory()

    async def run() -> None:
        async with factory() as session:
            # Empty inputs / no country -> empty.
            assert (
                await taxes.vat_rates_for_products(
                    session,
                    product_ids=set(),
                    country_code="RO",
                    fallback_rate_percent=Decimal("19"),
                )
                == {}
            )
            assert (
                await taxes.vat_rates_for_products(
                    session,
                    product_ids={uuid4()},
                    country_code=None,
                    fallback_rate_percent=Decimal("19"),
                )
                == {}
            )

            default_group = TaxGroup(code="standard", name="Standard", is_default=True)
            reduced = TaxGroup(code="reduced", name="Reduced")
            session.add_all([default_group, reduced])
            await session.commit()
            await session.refresh(default_group)
            await session.refresh(reduced)

            cat_default = _category()
            cat_reduced = _category(tax_group_id=reduced.id)
            p_default = _product(cat_default)
            p_reduced = _product(cat_reduced)
            session.add_all([cat_default, cat_reduced, p_default, p_reduced])
            await session.commit()
            await session.refresh(p_default)
            await session.refresh(p_reduced)

            # Rates: default group RO=19, reduced group has none -> falls to default.
            session.add(
                TaxRate(
                    group_id=default_group.id,
                    country_code="RO",
                    vat_rate_percent=Decimal("19.00"),
                )
            )
            await session.commit()

            resolved = await taxes.vat_rates_for_products(
                session,
                product_ids={p_default.id, p_reduced.id},
                country_code="RO",
                fallback_rate_percent=Decimal("5"),
            )
            assert resolved[p_default.id] == Decimal("19.00")
            # reduced group has no RO rate -> uses default_rate (19) per resolution.
            assert resolved[p_reduced.id] == Decimal("19.00")

    asyncio.run(run())


def test_vat_rates_for_products_no_groups_returns_fallback() -> None:
    factory = make_memory_session_factory()

    async def run() -> None:
        async with factory() as session:
            cat = _category()  # no tax_group_id, no default group exists
            prod = _product(cat)
            session.add_all([cat, prod])
            await session.commit()
            await session.refresh(prod)

            resolved = await taxes.vat_rates_for_products(
                session,
                product_ids={prod.id},
                country_code="RO",
                fallback_rate_percent=Decimal("8"),
            )
            assert resolved[prod.id] == Decimal("8")

    asyncio.run(run())


def test_vat_rates_mixed_grouped_and_ungrouped_no_default() -> None:
    factory = make_memory_session_factory()

    async def run() -> None:
        async with factory() as session:
            # A non-default, non-standard group so there is NO default group id.
            grouped = TaxGroup(code="reduced", name="Reduced")
            session.add(grouped)
            await session.commit()
            await session.refresh(grouped)
            session.add(
                TaxRate(
                    group_id=grouped.id,
                    country_code="RO",
                    vat_rate_percent=Decimal("9.00"),
                )
            )

            cat_grouped = _category(tax_group_id=grouped.id)
            cat_ungrouped = _category()  # no group, no default -> resolves to None
            p_grouped = _product(cat_grouped)
            p_ungrouped = _product(cat_ungrouped)
            session.add_all([cat_grouped, cat_ungrouped, p_grouped, p_ungrouped])
            await session.commit()
            await session.refresh(p_grouped)
            await session.refresh(p_ungrouped)

            resolved = await taxes.vat_rates_for_products(
                session,
                product_ids={p_grouped.id, p_ungrouped.id},
                country_code="RO",
                fallback_rate_percent=Decimal("4"),
            )
            assert resolved[p_grouped.id] == Decimal("9.00")
            # Ungrouped product with no default group -> fallback.
            assert resolved[p_ungrouped.id] == Decimal("4")

    asyncio.run(run())


def test_compute_cart_vat_disabled_and_no_country() -> None:
    factory = make_memory_session_factory()

    async def run() -> None:
        async with factory() as session:
            line = TaxableProductLine(product_id=uuid4(), subtotal=Decimal("100.00"))

            # VAT disabled -> zero.
            disabled = CheckoutSettings(vat_enabled=False)
            assert await taxes.compute_cart_vat_amount(
                session,
                country_code="RO",
                lines=[line],
                discount=Decimal("0"),
                shipping=Decimal("0"),
                fee=Decimal("0"),
                checkout=disabled,
            ) == Decimal("0.00")

            # No country -> flat compute_vat path (10% default of 100).
            flat = CheckoutSettings(vat_enabled=True, vat_rate_percent=Decimal("10"))
            amount = await taxes.compute_cart_vat_amount(
                session,
                country_code=None,
                lines=[line],
                discount=Decimal("0"),
                shipping=Decimal("0"),
                fee=Decimal("0"),
                checkout=flat,
            )
            assert amount > 0

    asyncio.run(run())


def test_compute_cart_vat_per_rate_with_shipping_fee_and_discount() -> None:
    factory = make_memory_session_factory()

    async def run() -> None:
        async with factory() as session:
            group = TaxGroup(code="standard", name="Standard", is_default=True)
            session.add(group)
            await session.commit()
            await session.refresh(group)
            session.add(
                TaxRate(
                    group_id=group.id,
                    country_code="RO",
                    vat_rate_percent=Decimal("19.00"),
                )
            )

            cat = _category()
            p1 = _product(cat)
            p2 = _product(cat)
            session.add_all([cat, p1, p2])
            await session.commit()
            await session.refresh(p1)
            await session.refresh(p2)

            lines = [
                TaxableProductLine(product_id=p1.id, subtotal=Decimal("100.00")),
                TaxableProductLine(product_id=p2.id, subtotal=Decimal("50.00")),
            ]
            checkout = CheckoutSettings(
                vat_enabled=True,
                vat_rate_percent=Decimal("19"),
                vat_apply_to_shipping=True,
                vat_apply_to_fee=True,
            )
            amount = await taxes.compute_cart_vat_amount(
                session,
                country_code="RO",
                lines=lines,
                discount=Decimal("30.00"),
                shipping=Decimal("20.00"),
                fee=Decimal("10.00"),
                checkout=checkout,
            )
            assert amount > 0

    asyncio.run(run())


def test_compute_cart_vat_line_fully_discounted_positive_rate() -> None:
    factory = make_memory_session_factory()

    async def run() -> None:
        async with factory() as session:
            group = TaxGroup(code="standard", name="Standard", is_default=True)
            session.add(group)
            await session.commit()
            await session.refresh(group)
            session.add(
                TaxRate(
                    group_id=group.id,
                    country_code="RO",
                    vat_rate_percent=Decimal("19.00"),
                )
            )
            cat = _category()
            p1 = _product(cat)
            p2 = _product(cat)
            session.add_all([cat, p1, p2])
            await session.commit()
            await session.refresh(p1)
            await session.refresh(p2)

            lines = [
                TaxableProductLine(product_id=p1.id, subtotal=Decimal("10.00")),
                TaxableProductLine(product_id=p2.id, subtotal=Decimal("10.00")),
            ]
            checkout = CheckoutSettings(
                vat_enabled=True, vat_rate_percent=Decimal("19")
            )
            # Discount equals the entire subtotal so every line's taxable base
            # is driven to <= 0 (exercises the per-line base<=0 continue) while
            # the configured rate stays positive.
            amount = await taxes.compute_cart_vat_amount(
                session,
                country_code="RO",
                lines=lines,
                discount=Decimal("20.00"),
                shipping=Decimal("0"),
                fee=Decimal("0"),
                checkout=checkout,
            )
            assert amount == Decimal("0.00")

    asyncio.run(run())


def test_compute_cart_vat_zero_rate_and_negative_taxable() -> None:
    factory = make_memory_session_factory()

    async def run() -> None:
        async with factory() as session:
            group = TaxGroup(code="standard", name="Standard", is_default=True)
            session.add(group)
            await session.commit()
            await session.refresh(group)
            # Zero rate for RO so the per-rate loop skips (rate <= 0).
            session.add(
                TaxRate(
                    group_id=group.id,
                    country_code="RO",
                    vat_rate_percent=Decimal("0.00"),
                )
            )
            cat = _category()
            prod = _product(cat)
            session.add_all([cat, prod])
            await session.commit()
            await session.refresh(prod)

            line = TaxableProductLine(product_id=prod.id, subtotal=Decimal("10.00"))
            checkout = CheckoutSettings(vat_enabled=True, vat_rate_percent=Decimal("0"))
            # Discount larger than subtotal -> taxable clamps to zero.
            amount = await taxes.compute_cart_vat_amount(
                session,
                country_code="RO",
                lines=[line],
                discount=Decimal("999.00"),
                shipping=Decimal("0"),
                fee=Decimal("0"),
                checkout=checkout,
            )
            assert amount == Decimal("0.00")

    asyncio.run(run())
