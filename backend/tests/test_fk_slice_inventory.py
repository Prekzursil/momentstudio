"""Unit tests for ``app.services.inventory`` (slice f-k).

These exercise the real reservation/restock-list/note logic against an
in-memory SQLite database created via the shared ``make_memory_session_factory``
conftest helper. Disjoint from ``test_admin_dashboard.py`` (which only drives
the API layer): here we call the service functions directly to cover the
branches the API tests miss (variant rows, restock-note upsert/clear/update,
404/400 validation, the cart-window fallback and pagination clamps).
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.models.cart import Cart, CartItem
from app.models.catalog import Category, Product, ProductStatus, ProductVariant
from app.models.order import Order, OrderItem, OrderStatus
from app.schemas.inventory import RestockNoteUpsert
from app.services import inventory
from tests.conftest import make_memory_session_factory


@pytest.fixture
def session_factory():
    return make_memory_session_factory()


def _run(coro):
    return asyncio.run(coro)


async def _make_category(session, *, threshold: int | None = 5) -> Category:
    cat = Category(
        slug=f"cat-{id(session)}",
        name="Inv Category",
        description="desc",
        sort_order=1,
        low_stock_threshold=threshold,
    )
    session.add(cat)
    await session.flush()
    return cat


async def _make_product(
    session,
    cat,
    *,
    slug,
    name="Product",
    stock=10,
    low_stock_threshold=None,
    is_active=True,
    is_deleted=False,
) -> Product:
    product = Product(
        slug=slug,
        name=name,
        base_price=Decimal("100.00"),
        currency="RON",
        category=cat,
        stock_quantity=stock,
        low_stock_threshold=low_stock_threshold,
        is_active=is_active,
        is_deleted=is_deleted,
        status=ProductStatus.published,
    )
    session.add(product)
    await session.flush()
    return product


def test_cart_reservation_cutoff_clamps_zero_window(monkeypatch) -> None:
    # A configured window of 0 is falsy -> the ``or DEFAULT`` falls back (line 43).
    monkeypatch.setattr(
        inventory.settings, "cart_reservation_window_minutes", 0, raising=False
    )
    now = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
    cutoff = inventory._cart_reservation_cutoff(now)
    assert (now - cutoff).total_seconds() == 120 * 60


def test_cart_reservation_cutoff_clamps_negative_window(monkeypatch) -> None:
    # A truthy-but-negative window survives the ``or`` and is re-clamped (line 47).
    monkeypatch.setattr(
        inventory.settings, "cart_reservation_window_minutes", -5, raising=False
    )
    now = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
    cutoff = inventory._cart_reservation_cutoff(now)
    assert (now - cutoff).total_seconds() == 120 * 60


def test_cart_reservation_cutoff_uses_configured_window(monkeypatch) -> None:
    monkeypatch.setattr(
        inventory.settings, "cart_reservation_window_minutes", 30, raising=False
    )
    now = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
    cutoff = inventory._cart_reservation_cutoff(now)
    assert (now - cutoff).total_seconds() == 30 * 60


def test_upsert_restock_note_product_not_found(session_factory) -> None:
    async def scenario() -> None:
        async with session_factory() as session:
            with pytest.raises(HTTPException) as exc:
                await inventory.upsert_restock_note(
                    session,
                    payload=RestockNoteUpsert(
                        product_id=__import__("uuid").uuid4(),
                        supplier="ACME",
                    ),
                    user_id=None,
                )
            assert exc.value.status_code == 404

    _run(scenario())


def test_upsert_restock_note_deleted_product(session_factory) -> None:
    async def scenario() -> None:
        async with session_factory() as session:
            cat = await _make_category(session)
            product = await _make_product(
                session, cat, slug="deleted-prod", is_deleted=True
            )
            await session.commit()
            with pytest.raises(HTTPException) as exc:
                await inventory.upsert_restock_note(
                    session,
                    payload=RestockNoteUpsert(product_id=product.id, supplier="ACME"),
                    user_id=None,
                )
            assert exc.value.status_code == 404

    _run(scenario())


def test_upsert_restock_note_invalid_variant(session_factory) -> None:
    import uuid

    async def scenario() -> None:
        async with session_factory() as session:
            cat = await _make_category(session)
            product = await _make_product(session, cat, slug="prod-variant")
            await session.commit()
            with pytest.raises(HTTPException) as exc:
                await inventory.upsert_restock_note(
                    session,
                    payload=RestockNoteUpsert(
                        product_id=product.id,
                        variant_id=uuid.uuid4(),  # not a real variant
                        supplier="ACME",
                    ),
                    user_id=None,
                )
            assert exc.value.status_code == 400

    _run(scenario())


def test_upsert_restock_note_variant_belongs_to_other_product(session_factory) -> None:
    async def scenario() -> None:
        async with session_factory() as session:
            cat = await _make_category(session)
            product_a = await _make_product(session, cat, slug="prod-a")
            product_b = await _make_product(session, cat, slug="prod-b")
            variant_b = ProductVariant(
                product_id=product_b.id, name="B-var", stock_quantity=1
            )
            session.add(variant_b)
            await session.commit()
            with pytest.raises(HTTPException) as exc:
                await inventory.upsert_restock_note(
                    session,
                    payload=RestockNoteUpsert(
                        product_id=product_a.id,
                        variant_id=variant_b.id,
                        supplier="ACME",
                    ),
                    user_id=None,
                )
            assert exc.value.status_code == 400

    _run(scenario())


def test_upsert_restock_note_valid_variant(session_factory) -> None:
    async def scenario() -> None:
        async with session_factory() as session:
            cat = await _make_category(session)
            product = await _make_product(session, cat, slug="prod-vv")
            variant = ProductVariant(
                product_id=product.id, name="OK", stock_quantity=3
            )
            session.add(variant)
            await session.commit()
            # Valid variant for the product passes the guard (line 242 -> 247).
            created = await inventory.upsert_restock_note(
                session,
                payload=RestockNoteUpsert(
                    product_id=product.id,
                    variant_id=variant.id,
                    supplier="ACME",
                ),
                user_id=None,
            )
            assert created is not None
            assert created.variant_id == variant.id

    _run(scenario())


def test_upsert_restock_note_create_clamp_negative_then_update_then_delete(
    session_factory,
) -> None:
    import uuid

    async def scenario() -> None:
        async with session_factory() as session:
            cat = await _make_category(session)
            product = await _make_product(session, cat, slug="prod-note")
            await session.commit()
            user_id = uuid.uuid4()

            # Create: negative desired_quantity is clamped to 0 (line 255).
            payload = RestockNoteUpsert(product_id=product.id, supplier="ACME")
            # bypass schema ge=0 validation to drive the service clamp directly
            object.__setattr__(payload, "desired_quantity", -7)
            created = await inventory.upsert_restock_note(
                session, payload=payload, user_id=user_id
            )
            assert created is not None
            assert created.desired_quantity == 0
            assert created.supplier == "ACME"

            # Update existing (lines 282-286): change supplier/note/qty.
            updated = await inventory.upsert_restock_note(
                session,
                payload=RestockNoteUpsert(
                    product_id=product.id,
                    supplier="NEWCO",
                    note="reorder soon",
                    desired_quantity=12,
                ),
                user_id=user_id,
            )
            assert updated is not None
            assert updated.supplier == "NEWCO"
            assert updated.note == "reorder soon"
            assert updated.desired_quantity == 12

            # should_delete path: empty values delete the existing note.
            deleted = await inventory.upsert_restock_note(
                session,
                payload=RestockNoteUpsert(
                    product_id=product.id, supplier="  ", note="   "
                ),
                user_id=user_id,
            )
            assert deleted is None

    _run(scenario())


def test_upsert_restock_note_delete_when_absent_returns_none(session_factory) -> None:
    async def scenario() -> None:
        async with session_factory() as session:
            cat = await _make_category(session)
            product = await _make_product(session, cat, slug="prod-empty")
            await session.commit()
            # No existing note + all-empty payload -> should_delete with existing None.
            result = await inventory.upsert_restock_note(
                session,
                payload=RestockNoteUpsert(product_id=product.id),
                user_id=None,
            )
            assert result is None

    _run(scenario())


def test_list_restock_list_with_variants_and_reservations(session_factory) -> None:
    async def scenario() -> None:
        async with session_factory() as session:
            cat = await _make_category(session, threshold=5)
            # low-stock product with a low-stock variant
            product = await _make_product(
                session, cat, slug="low-prod", name="Low Prod", stock=2
            )
            variant = ProductVariant(
                product_id=product.id, name="Small", stock_quantity=1
            )
            session.add(variant)
            await session.flush()

            # active cart reserving product + variant
            cart = Cart(session_id="s1", updated_at=datetime.now(timezone.utc))
            cart.items.append(
                CartItem(
                    product_id=product.id,
                    variant_id=None,
                    quantity=1,
                    unit_price_at_add=100.0,
                )
            )
            cart.items.append(
                CartItem(
                    product_id=product.id,
                    variant_id=variant.id,
                    quantity=1,
                    unit_price_at_add=100.0,
                )
            )
            session.add(cart)

            # open order reserving product
            order = Order(
                user_id=None,
                status=OrderStatus.pending_payment,
                total_amount=Decimal("0.00"),
                currency="RON",
                tax_amount=Decimal("0.00"),
                shipping_amount=Decimal("0.00"),
                customer_email="b@example.com",
                customer_name="B",
            )
            order.items.append(
                OrderItem(
                    product_id=product.id,
                    variant_id=None,
                    quantity=1,
                    shipped_quantity=0,
                    unit_price=Decimal("100.00"),
                    subtotal=Decimal("100.00"),
                )
            )
            session.add(order)
            await session.commit()

            rows = await inventory.list_restock_list(
                session, include_variants=True, default_threshold=5
            )
            kinds = {r.kind for r in rows}
            assert "product" in kinds
            assert "variant" in kinds  # variant branch (lines 383-433)
            prod_row = next(r for r in rows if r.kind == "product")
            # available = 2 stock - 1 cart - 1 order = 0 -> critical
            assert prod_row.available_quantity == 0
            assert prod_row.is_critical is True

    _run(scenario())


def test_list_restock_list_excludes_variants_when_disabled(session_factory) -> None:
    async def scenario() -> None:
        async with session_factory() as session:
            cat = await _make_category(session, threshold=5)
            product = await _make_product(
                session, cat, slug="nv-prod", stock=1
            )
            variant = ProductVariant(
                product_id=product.id, name="V", stock_quantity=0
            )
            session.add(variant)
            await session.commit()

            rows = await inventory.list_restock_list(
                session, include_variants=False, default_threshold=5
            )
            assert all(r.kind == "product" for r in rows)

    _run(scenario())


def test_list_restock_list_skips_well_stocked_product_and_variant(
    session_factory,
) -> None:
    async def scenario() -> None:
        async with session_factory() as session:
            cat = await _make_category(session, threshold=5)
            # Well-stocked product with no note: skip its product row (346 -> 381),
            # then iterate variants; a well-stocked variant with no note is also
            # skipped (line 400 `continue`).
            product = await _make_product(
                session, cat, slug="ws-variant-prod", stock=1000
            )
            variant = ProductVariant(
                product_id=product.id, name="Plenty", stock_quantity=1000
            )
            session.add(variant)
            await session.commit()

            rows = await inventory.list_restock_list(
                session, include_variants=True, default_threshold=5
            )
            assert all(r.product_id != product.id for r in rows)

    _run(scenario())


def test_list_restock_list_note_present_keeps_well_stocked_product(
    session_factory,
) -> None:
    async def scenario() -> None:
        async with session_factory() as session:
            cat = await _make_category(session, threshold=5)
            # well-stocked product (not low) but with a restock note -> still listed
            product = await _make_product(
                session, cat, slug="ws-prod", stock=1000
            )
            await session.commit()
            await inventory.upsert_restock_note(
                session,
                payload=RestockNoteUpsert(product_id=product.id, note="keep eye"),
                user_id=None,
            )
            rows = await inventory.list_restock_list(session, default_threshold=5)
            assert any(r.product_id == product.id for r in rows)

    _run(scenario())


def test_list_cart_and_order_reservations(session_factory) -> None:
    async def scenario() -> None:
        async with session_factory() as session:
            cat = await _make_category(session)
            product = await _make_product(session, cat, slug="resv-prod", stock=10)
            await session.flush()

            cart = Cart(session_id="cs", updated_at=datetime.now(timezone.utc))
            cart.items.append(
                CartItem(
                    product_id=product.id,
                    variant_id=None,
                    quantity=3,
                    unit_price_at_add=100.0,
                )
            )
            session.add(cart)

            order = Order(
                user_id=None,
                status=OrderStatus.pending_acceptance,
                total_amount=Decimal("0.00"),
                currency="RON",
                tax_amount=Decimal("0.00"),
                shipping_amount=Decimal("0.00"),
                customer_email="c@example.com",
                customer_name="C",
            )
            order.items.append(
                OrderItem(
                    product_id=product.id,
                    variant_id=None,
                    quantity=4,
                    shipped_quantity=1,
                    unit_price=Decimal("100.00"),
                    subtotal=Decimal("400.00"),
                )
            )
            session.add(order)
            await session.commit()

            cutoff, cart_items = await inventory.list_cart_reservations(
                session, product_id=product.id, variant_id=None
            )
            assert cart_items and cart_items[0]["quantity"] == 3
            assert cutoff is not None

            order_items = await inventory.list_order_reservations(
                session, product_id=product.id, variant_id=None
            )
            assert order_items and order_items[0]["quantity"] == 3  # 4 - 1 shipped

    _run(scenario())


def test_list_reservations_with_variant_filter(session_factory) -> None:
    async def scenario() -> None:
        async with session_factory() as session:
            cat = await _make_category(session)
            product = await _make_product(session, cat, slug="vf-prod", stock=10)
            variant = ProductVariant(
                product_id=product.id, name="VF", stock_quantity=5
            )
            session.add(variant)
            await session.flush()

            cart = Cart(session_id="vf", updated_at=datetime.now(timezone.utc))
            cart.items.append(
                CartItem(
                    product_id=product.id,
                    variant_id=variant.id,
                    quantity=2,
                    unit_price_at_add=100.0,
                )
            )
            session.add(cart)

            order = Order(
                user_id=None,
                status=OrderStatus.pending_payment,
                total_amount=Decimal("0.00"),
                currency="RON",
                tax_amount=Decimal("0.00"),
                shipping_amount=Decimal("0.00"),
                customer_email="vf@example.com",
                customer_name="VF",
            )
            order.items.append(
                OrderItem(
                    product_id=product.id,
                    variant_id=variant.id,
                    quantity=2,
                    shipped_quantity=0,
                    unit_price=Decimal("100.00"),
                    subtotal=Decimal("200.00"),
                )
            )
            session.add(order)
            await session.commit()

            _, cart_items = await inventory.list_cart_reservations(
                session, product_id=product.id, variant_id=variant.id
            )
            assert cart_items and cart_items[0]["quantity"] == 2

            order_items = await inventory.list_order_reservations(
                session, product_id=product.id, variant_id=variant.id
            )
            assert order_items and order_items[0]["quantity"] == 2

    _run(scenario())


def test_paginate_restock_list_clamps_overflow_page(session_factory) -> None:
    async def scenario() -> None:
        async with session_factory() as session:
            cat = await _make_category(session, threshold=5)
            await _make_product(session, cat, slug="p1", name="P1", stock=0)
            await _make_product(session, cat, slug="p2", name="P2", stock=0)
            await session.commit()

            # page far beyond total -> clamps to last page (line 464)
            resp = await inventory.paginate_restock_list(
                session, page=99, limit=1, default_threshold=5
            )
            assert resp.meta.page == resp.meta.total_pages
            assert len(resp.items) <= 1

    _run(scenario())


def test_paginate_restock_list_empty(session_factory) -> None:
    async def scenario() -> None:
        async with session_factory() as session:
            resp = await inventory.paginate_restock_list(session)
            assert resp.meta.total_items == 0
            assert resp.meta.total_pages == 1
            assert resp.items == []

    _run(scenario())
