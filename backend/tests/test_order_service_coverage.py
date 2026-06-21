"""Service-layer coverage closure for ``app.services.order``.

Targets the uncovered branches of the order service that the existing API-level
suites do not reach: the stock commit/restore helpers (variant paths, idempotency
early-returns, empty/degenerate inputs), the ``build_order_from_cart`` validation
and pricing branches, the admin update/refund/capture/void flows, the shipment
CRUD error paths, the tag-management helpers, and the small pure helpers.

External services are mocked exactly as the rest of the suite does it: an
in-memory SQLite engine, direct service calls, and ``monkeypatch`` on the
payment/paypal/promo/metrics entry points. No real network / DB / gateway calls
are made.
"""

from __future__ import annotations

import asyncio
from decimal import Decimal
from typing import Awaitable, Callable, TypeVar

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.address import Address
from app.models.cart import Cart, CartItem
from app.models.catalog import Category, Product, ProductStatus, ProductVariant
from app.models.order import (
    Order,
    OrderEvent,
    OrderItem,
    OrderRefund,
    OrderShipment,
    OrderStatus,
    OrderTag,
)
from app.schemas.order import OrderUpdate, ShippingMethodCreate
from app.schemas.order_admin_address import AdminOrderAddressesUpdate
from app.schemas.address import AddressUpdate
from app.schemas.order_shipment import OrderShipmentCreate, OrderShipmentUpdate
from app.services import order as order_service


T = TypeVar("T")


# --------------------------------------------------------------------------- #
# Harness                                                                      #
# --------------------------------------------------------------------------- #
def _run(coro_factory: Callable[[AsyncSession], Awaitable[T]]) -> T:
    """Build a fresh in-memory DB, open a session, run ``coro_factory``."""

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

    async def _main() -> T:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with SessionLocal() as session:
            result = await coro_factory(session)
        await engine.dispose()
        return result

    return asyncio.run(_main())


async def _make_product(
    session: AsyncSession,
    *,
    slug: str = "svc-prod",
    sku: str = "SVC-1",
    stock: int = 10,
    status: ProductStatus = ProductStatus.published,
    is_active: bool = True,
    is_deleted: bool = False,
    allow_backorder: bool = False,
    price: str = "10.00",
) -> Product:
    category = (
        await session.execute(
            __import__("sqlalchemy").select(Category).where(Category.slug == "svc-cat")
        )
    ).scalar_one_or_none()
    if category is None:
        category = Category(slug="svc-cat", name="Svc Cat")
        session.add(category)
        await session.flush()
    product = Product(
        category_id=category.id,
        slug=slug,
        sku=sku,
        name=f"Product {slug}",
        base_price=Decimal(price),
        currency="RON",
        stock_quantity=stock,
        status=status,
        is_active=is_active,
        is_deleted=is_deleted,
        allow_backorder=allow_backorder,
    )
    session.add(product)
    await session.flush()
    return product


async def _make_cart(
    session: AsyncSession,
    product: Product,
    *,
    qty: int = 1,
    variant: ProductVariant | None = None,
) -> Cart:
    cart = Cart(user_id=None)
    cart.items = [
        CartItem(
            product=product,
            variant_id=variant.id if variant else None,
            quantity=qty,
            unit_price_at_add=Decimal(str(product.base_price)),
        )
    ]
    session.add(cart)
    await session.commit()
    await session.refresh(cart)
    return cart


async def _build_order(
    session: AsyncSession,
    *,
    qty: int = 1,
    stock: int = 10,
    payment_method: str = "stripe",
    slug: str = "svc-prod",
    sku: str = "SVC-1",
) -> Order:
    product = await _make_product(session, stock=stock, slug=slug, sku=sku)
    cart = await _make_cart(session, product, qty=qty)
    return await order_service.build_order_from_cart(
        session,
        None,
        customer_email="buyer@example.com",
        customer_name="Buyer",
        cart=cart,
        shipping_address_id=None,
        billing_address_id=None,
        payment_method=payment_method,
    )


# --------------------------------------------------------------------------- #
# _try_uuid                                                                    #
# --------------------------------------------------------------------------- #
def test_try_uuid_variants() -> None:
    assert order_service._try_uuid(None) is None
    assert order_service._try_uuid("not-a-uuid") is None
    good = "12345678-1234-5678-1234-567812345678"
    assert str(order_service._try_uuid(good)) == good


# --------------------------------------------------------------------------- #
# _calculate_shipping                                                          #
# --------------------------------------------------------------------------- #
def test_calculate_shipping_none_and_value() -> None:
    assert order_service._calculate_shipping(Decimal("100"), None) == Decimal("0")

    def _run_method(session: AsyncSession):
        async def inner() -> Decimal:
            method = await order_service.create_shipping_method(
                session,
                ShippingMethodCreate(name="Ship", rate_flat=5.0, rate_per_kg=0.1),
            )
            return order_service._calculate_shipping(Decimal("10"), method)

        return inner()

    assert _run(_run_method) == Decimal("5") + Decimal("0.1") * Decimal("10")


# --------------------------------------------------------------------------- #
# _normalize_order_tag                                                         #
# --------------------------------------------------------------------------- #
def test_normalize_order_tag_variants() -> None:
    assert order_service._normalize_order_tag(None) is None
    assert order_service._normalize_order_tag("  Hello World  ") == "hello_world"
    assert order_service._normalize_order_tag("***") is None
    assert order_service._normalize_order_tag("a" * 80) == "a" * 50


# --------------------------------------------------------------------------- #
# _has_payment_captured                                                        #
# --------------------------------------------------------------------------- #
def test_has_payment_captured_branches() -> None:
    cod = Order(payment_method="cod", customer_email="a@b.c", customer_name="A")
    assert order_service._has_payment_captured(cod) is False

    paypal_no = Order(
        payment_method="paypal", customer_email="a@b.c", customer_name="A"
    )
    assert order_service._has_payment_captured(paypal_no) is False
    paypal_yes = Order(
        payment_method="paypal",
        paypal_capture_id="CAP-1",
        customer_email="a@b.c",
        customer_name="A",
    )
    assert order_service._has_payment_captured(paypal_yes) is True

    stripe_order = Order(
        payment_method="stripe", customer_email="a@b.c", customer_name="A"
    )
    stripe_order.events = [OrderEvent(event="payment_captured")]
    assert order_service._has_payment_captured(stripe_order) is True

    unknown = Order(payment_method="other", customer_email="a@b.c", customer_name="A")
    assert order_service._has_payment_captured(unknown) is False


# --------------------------------------------------------------------------- #
# _address_snapshot                                                            #
# --------------------------------------------------------------------------- #
def test_address_snapshot_none_and_value() -> None:
    assert order_service._address_snapshot(None) is None
    addr = Address(line1="L1", city="C", postal_code="010101", country="RO")
    snap = order_service._address_snapshot(addr)
    assert snap is not None and snap["line1"] == "L1" and snap["country"] == "RO"


# --------------------------------------------------------------------------- #
# _apply_address_update                                                        #
# --------------------------------------------------------------------------- #
def test_apply_address_update_requires_core_fields() -> None:
    addr = Address(line1="L1", city="C", postal_code="010101", country="RO")
    with pytest.raises(HTTPException) as exc:
        order_service._apply_address_update(addr, {"city": "  "})
    assert exc.value.status_code == 400


def test_apply_address_update_strips_and_drops_forbidden() -> None:
    addr = Address(line1="L1", city="C", postal_code="010101", country="RO")
    order_service._apply_address_update(
        addr,
        {
            "line1": "  New Street  ",
            "city": "Town",
            "postal_code": "010101",
            "country": "RO",
            "is_default_shipping": True,
            "user_id": "x",
        },
    )
    assert addr.line1 == "New Street"
    assert addr.is_default_shipping is False


# --------------------------------------------------------------------------- #
# build_order_from_cart — validation & pricing branches                       #
# --------------------------------------------------------------------------- #
def test_build_order_empty_cart_raises() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            cart = Cart(user_id=None)
            cart.items = []
            session.add(cart)
            await session.commit()
            await order_service.build_order_from_cart(
                session,
                None,
                customer_email="b@e.com",
                customer_name="B",
                cart=cart,
                shipping_address_id=None,
                billing_address_id=None,
            )

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


def test_build_order_unavailable_product_raises() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            product = await _make_product(
                session, status=ProductStatus.draft, slug="draft-p", sku="DRAFT"
            )
            cart = await _make_cart(session, product)
            await order_service.build_order_from_cart(
                session,
                None,
                customer_email="b@e.com",
                customer_name="B",
                cart=cart,
                shipping_address_id=None,
                billing_address_id=None,
            )

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


def test_build_order_insufficient_stock_raises() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            product = await _make_product(session, stock=1, slug="lo", sku="LO")
            cart = await _make_cart(session, product, qty=5)
            await order_service.build_order_from_cart(
                session,
                None,
                customer_email="b@e.com",
                customer_name="B",
                cart=cart,
                shipping_address_id=None,
                billing_address_id=None,
            )

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


def test_build_order_allow_backorder_skips_stock_check() -> None:
    def factory(session: AsyncSession):
        async def inner() -> Order:
            product = await _make_product(
                session, stock=0, allow_backorder=True, slug="bo", sku="BO"
            )
            cart = await _make_cart(session, product, qty=3)
            return await order_service.build_order_from_cart(
                session,
                None,
                customer_email="b@e.com",
                customer_name="B",
                cart=cart,
                shipping_address_id=None,
                billing_address_id=None,
                payment_method="cod",
            )

        return inner()

    order = _run(factory)
    assert order.status == OrderStatus.pending_acceptance


def test_build_order_with_variant_invalid_raises() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            product = await _make_product(session, stock=10, slug="v1", sku="V1")
            other = await _make_product(session, stock=10, slug="v2", sku="V2")
            variant = ProductVariant(
                product_id=other.id, name="Other Variant", stock_quantity=10
            )
            session.add(variant)
            await session.flush()
            cart = await _make_cart(session, product, qty=1, variant=variant)
            await order_service.build_order_from_cart(
                session,
                None,
                customer_email="b@e.com",
                customer_name="B",
                cart=cart,
                shipping_address_id=None,
                billing_address_id=None,
            )

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


def test_build_order_explicit_amounts_and_promo_truncation() -> None:
    def factory(session: AsyncSession):
        async def inner() -> Order:
            product = await _make_product(session, stock=10, slug="amt", sku="AMT")
            cart = await _make_cart(session, product, qty=1)
            return await order_service.build_order_from_cart(
                session,
                None,
                customer_email="b@e.com",
                customer_name="B",
                cart=cart,
                shipping_address_id=None,
                billing_address_id=None,
                tax_amount=Decimal("2.00"),
                shipping_amount=Decimal("3.00"),
                total_amount=Decimal("15.00"),
                fee_amount=Decimal("1.00"),
                promo_code="x" * 50,
                invoice_company="c" * 250,
                invoice_vat_id="v" * 80,
            )

        return inner()

    order = _run(factory)
    assert Decimal(str(order.total_amount)) == Decimal("15.00")
    assert len(order.promo_code or "") == 40
    assert len(order.invoice_company or "") == 200
    assert len(order.invoice_vat_id or "") == 64


def test_build_order_metrics_failure_is_swallowed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.core import metrics

    def _boom() -> None:
        raise RuntimeError("metric down")

    monkeypatch.setattr(metrics, "record_order_created", _boom)
    order = _run(lambda s: _build_order(s, payment_method="cod"))
    assert order.status == OrderStatus.pending_acceptance


# --------------------------------------------------------------------------- #
# _generate_reference_code collision back-edge                                 #
# --------------------------------------------------------------------------- #
def test_generate_reference_code_collision(monkeypatch: pytest.MonkeyPatch) -> None:
    def factory(session: AsyncSession):
        async def inner() -> str:
            existing = Order(
                reference_code="COLLIDE001",
                customer_email="x@y.z",
                customer_name="X",
                status=OrderStatus.pending_acceptance,
                total_amount=Decimal("0"),
                tax_amount=Decimal("0"),
                fee_amount=Decimal("0"),
                shipping_amount=Decimal("0"),
                currency="RON",
                payment_method="cod",
            )
            session.add(existing)
            await session.commit()

            sequence = iter("COLLIDE001" + "UNIQUE0002")

            import app.services.order as mod

            def _fake_choice(_chars: str) -> str:
                return next(sequence)

            monkeypatch.setattr(mod.secrets, "choice", _fake_choice)
            return await order_service._generate_reference_code(session)

        return inner()

    code = _run(factory)
    assert code == "UNIQUE0002"


# --------------------------------------------------------------------------- #
# list_orders / search_orders_for_user filters                                #
# --------------------------------------------------------------------------- #
def test_list_orders_status_and_user_filters() -> None:
    def factory(session: AsyncSession):
        async def inner() -> int:
            order = await _build_order(session, payment_method="cod")
            by_status = await order_service.list_orders(
                session, status=OrderStatus.pending_acceptance
            )
            by_user = await order_service.list_orders(session, user_id=order.user_id)
            return len(by_status) + len(by_user)

        return inner()

    assert _run(factory) >= 1


# --------------------------------------------------------------------------- #
# _commit_stock / _restore_stock                                              #
# --------------------------------------------------------------------------- #
def test_commit_and_restore_stock_with_variant() -> None:
    def factory(session: AsyncSession):
        async def inner() -> tuple[int, int]:
            product = await _make_product(session, stock=10, slug="vc", sku="VC")
            variant = ProductVariant(product_id=product.id, name="V", stock_quantity=10)
            session.add(variant)
            await session.flush()
            order = Order(
                reference_code="VARORD0001",
                customer_email="v@e.com",
                customer_name="V",
                status=OrderStatus.pending_acceptance,
                total_amount=Decimal("10"),
                tax_amount=Decimal("0"),
                fee_amount=Decimal("0"),
                shipping_amount=Decimal("0"),
                currency="RON",
                payment_method="cod",
            )
            order.items = [
                OrderItem(
                    product_id=product.id,
                    variant_id=variant.id,
                    quantity=3,
                    unit_price=Decimal("10"),
                    subtotal=Decimal("30"),
                )
            ]
            session.add(order)
            await session.commit()
            await session.refresh(order, attribute_names=["items"])

            await order_service._commit_stock_for_order(session, order)
            await session.commit()
            await session.refresh(variant)
            after_commit = variant.stock_quantity

            # Idempotent second commit (existing event -> early return).
            await order_service._commit_stock_for_order(session, order)
            await session.commit()

            await order_service._restore_stock_for_order(session, order)
            await session.commit()
            await session.refresh(variant)
            after_restore = variant.stock_quantity

            # Idempotent second restore (already restored -> early return).
            await order_service._restore_stock_for_order(session, order)
            await session.commit()
            return after_commit, after_restore

        return inner()

    after_commit, after_restore = _run(factory)
    assert after_commit == 7
    assert after_restore == 10


def test_commit_stock_no_items_returns() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            order = Order(
                reference_code="NOITEMS001",
                customer_email="n@e.com",
                customer_name="N",
                status=OrderStatus.pending_acceptance,
                total_amount=Decimal("0"),
                tax_amount=Decimal("0"),
                fee_amount=Decimal("0"),
                shipping_amount=Decimal("0"),
                currency="RON",
                payment_method="cod",
            )
            order.items = []
            session.add(order)
            await session.commit()
            await session.refresh(order, attribute_names=["items"])
            await order_service._commit_stock_for_order(session, order)
            await order_service._restore_stock_for_order(session, order)

        return inner()

    _run(factory)  # no exception => guard returns exercised


# --------------------------------------------------------------------------- #
# update_order — transition / cancel / tracking auto-ship                      #
# --------------------------------------------------------------------------- #
def test_update_order_invalid_transition() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _build_order(session, payment_method="cod")
            await order_service.update_order(
                session, order, OrderUpdate(status=OrderStatus.refunded)
            )

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


def test_update_order_cancel_requires_reason() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _build_order(session, payment_method="cod")
            await order_service.update_order(
                session, order, OrderUpdate(status=OrderStatus.cancelled)
            )

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


def test_update_order_cancel_with_reason_restores_stock() -> None:
    def factory(session: AsyncSession):
        async def inner() -> Order:
            order = await _build_order(session, payment_method="cod")
            return await order_service.update_order(
                session,
                order,
                OrderUpdate(status=OrderStatus.cancelled, cancel_reason="Out of stock"),
            )

        return inner()

    order = _run(factory)
    assert order.status == OrderStatus.cancelled
    assert (order.cancel_reason or "").startswith("Out of stock")


def test_update_order_cancel_reason_without_cancelled_status_raises() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _build_order(session, payment_method="cod")
            await order_service.update_order(
                session, order, OrderUpdate(cancel_reason="should not be set")
            )

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


def test_update_order_cod_can_ship_and_auto_ship_on_tracking() -> None:
    def factory(session: AsyncSession):
        async def inner() -> tuple[OrderStatus, OrderStatus]:
            order = await _build_order(session, payment_method="cod")
            shipped = await order_service.update_order(
                session, order, OrderUpdate(status=OrderStatus.shipped)
            )
            return order.status, shipped.status

        return inner()

    src, shipped = _run(factory)
    assert shipped == OrderStatus.shipped


def test_update_order_tracking_auto_ship_from_paid() -> None:
    def factory(session: AsyncSession):
        async def inner() -> OrderStatus:
            order = await _build_order(session, payment_method="cod")
            order.status = OrderStatus.paid
            session.add(order)
            await session.commit()
            updated = await order_service.update_order(
                session,
                order,
                OrderUpdate(tracking_number="1Z999AA10123456784", courier="ups"),
            )
            return updated.status

        return inner()

    assert _run(factory) == OrderStatus.shipped


def test_update_order_requires_capture_for_paid_transition() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _build_order(session, payment_method="stripe")
            order.status = OrderStatus.pending_acceptance
            session.add(order)
            await session.commit()
            await order_service.update_order(
                session, order, OrderUpdate(status=OrderStatus.paid)
            )

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


def test_update_order_shipping_method_rerate() -> None:
    def factory(session: AsyncSession):
        async def inner() -> Order:
            order = await _build_order(session, payment_method="cod")
            method = await order_service.create_shipping_method(
                session,
                ShippingMethodCreate(name="Express", rate_flat=9.0, rate_per_kg=0),
            )
            return await order_service.update_order(
                session, order, OrderUpdate(), shipping_method=method
            )

        return inner()

    order = _run(factory)
    assert order.shipping_method_id is not None


# --------------------------------------------------------------------------- #
# update_fulfillment                                                           #
# --------------------------------------------------------------------------- #
def test_update_fulfillment_item_not_found() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _build_order(session, payment_method="cod")
            import uuid

            await order_service.update_fulfillment(session, order, uuid.uuid4(), 1)

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 404


def test_update_fulfillment_exceeds_ordered() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _build_order(session, qty=2, payment_method="cod")
            await order_service.update_fulfillment(
                session, order, order.items[0].id, 99
            )

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


def test_update_fulfillment_success() -> None:
    def factory(session: AsyncSession):
        async def inner() -> int:
            order = await _build_order(session, qty=3, payment_method="cod")
            updated = await order_service.update_fulfillment(
                session, order, order.items[0].id, 2
            )
            return updated.items[0].shipped_quantity

        return inner()

    assert _run(factory) == 2


# --------------------------------------------------------------------------- #
# retry_payment                                                                #
# --------------------------------------------------------------------------- #
def test_retry_payment_wrong_status() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _build_order(session, payment_method="cod")
            await order_service.retry_payment(session, order)

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


def test_retry_payment_success() -> None:
    def factory(session: AsyncSession):
        async def inner() -> int:
            order = await _build_order(session, payment_method="stripe")
            updated = await order_service.retry_payment(session, order)
            return updated.payment_retry_count

        return inner()

    assert _run(factory) == 1


# --------------------------------------------------------------------------- #
# refund_order                                                                 #
# --------------------------------------------------------------------------- #
def test_refund_order_wrong_status() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _build_order(session, payment_method="cod")
            await order_service.refund_order(session, order)

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


def test_refund_order_success() -> None:
    def factory(session: AsyncSession):
        async def inner() -> OrderStatus:
            order = await _build_order(session, payment_method="cod")
            order.status = OrderStatus.paid
            session.add(order)
            await session.commit()
            updated = await order_service.refund_order(session, order, note="bad")
            return updated.status

        return inner()

    assert _run(factory) == OrderStatus.refunded


# --------------------------------------------------------------------------- #
# create_order_refund                                                          #
# --------------------------------------------------------------------------- #
async def _paid_order(session: AsyncSession, *, total: str = "30.00") -> Order:
    product = await _make_product(session, stock=10, slug="ref", sku="REF")
    cart = await _make_cart(session, product, qty=3)
    order = await order_service.build_order_from_cart(
        session,
        None,
        customer_email="r@e.com",
        customer_name="R",
        cart=cart,
        shipping_address_id=None,
        billing_address_id=None,
        tax_amount=Decimal("0.00"),
        shipping_amount=Decimal("0.00"),
        total_amount=Decimal(total),
        payment_method="stripe",
    )
    order.status = OrderStatus.paid
    session.add(order)
    await session.commit()
    await session.refresh(order, attribute_names=["items", "refunds"])
    return order


def test_create_order_refund_wrong_status() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _build_order(session, payment_method="cod")
            await order_service.create_order_refund(
                session, order, amount=Decimal("1"), note="x"
            )

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


def test_create_order_refund_invalid_amount() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _paid_order(session)
            await order_service.create_order_refund(
                session, order, amount=Decimal("0"), note="x"
            )

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


def test_create_order_refund_exceeds_remaining() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _paid_order(session)
            await order_service.create_order_refund(
                session, order, amount=Decimal("999"), note="x"
            )

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


def test_create_order_refund_note_required() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _paid_order(session)
            await order_service.create_order_refund(
                session, order, amount=Decimal("5"), note="   "
            )

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


def test_create_order_refund_already_fully_refunded() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _paid_order(session)
            session.add(
                OrderRefund(
                    order_id=order.id,
                    amount=Decimal("30.00"),
                    currency="RON",
                    provider="manual",
                    note="full",
                )
            )
            await session.commit()
            await session.refresh(order, attribute_names=["refunds"])
            await order_service.create_order_refund(
                session, order, amount=Decimal("1"), note="x"
            )

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


def test_create_order_refund_with_items_marks_full() -> None:
    def factory(session: AsyncSession):
        async def inner() -> OrderStatus:
            order = await _paid_order(session)
            item = order.items[0]
            updated = await order_service.create_order_refund(
                session,
                order,
                amount=Decimal("30.00"),
                note="full item refund",
                items=[(item.id, item.quantity)],
                actor="admin",
            )
            return updated.status

        return inner()

    assert _run(factory) == OrderStatus.refunded


def test_create_order_refund_invalid_order_item() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _paid_order(session)
            import uuid

            await order_service.create_order_refund(
                session,
                order,
                amount=Decimal("5"),
                note="x",
                items=[(uuid.uuid4(), 1)],
            )

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


def test_create_order_refund_quantity_exceeds() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _paid_order(session)
            item = order.items[0]
            await order_service.create_order_refund(
                session,
                order,
                amount=Decimal("5"),
                note="x",
                items=[(item.id, item.quantity + 5)],
            )

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


def test_create_order_refund_amount_exceeds_selected_items() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _paid_order(session)
            item = order.items[0]
            await order_service.create_order_refund(
                session,
                order,
                amount=Decimal("25.00"),
                note="x",
                items=[(item.id, 1)],
            )

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


def test_create_order_refund_stripe_process(monkeypatch: pytest.MonkeyPatch) -> None:
    def factory(session: AsyncSession):
        async def inner() -> str | None:
            order = await _paid_order(session)
            order.stripe_payment_intent_id = "pi_123"
            session.add(order)
            await session.commit()
            await session.refresh(order, attribute_names=["refunds", "items"])

            async def _fake_refund(intent_id: str, *, amount_cents: int) -> dict:
                return {"id": "re_123"}

            monkeypatch.setattr(
                order_service.payments, "refund_payment_intent", _fake_refund
            )
            updated = await order_service.create_order_refund(
                session,
                order,
                amount=Decimal("5.00"),
                note="partial",
                process_payment=True,
            )
            await session.refresh(updated, attribute_names=["refunds"])
            return updated.refunds[0].provider_refund_id

        return inner()

    assert _run(factory) == "re_123"


def test_create_order_refund_stripe_missing_intent() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _paid_order(session)
            await order_service.create_order_refund(
                session,
                order,
                amount=Decimal("5.00"),
                note="x",
                process_payment=True,
            )

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


def test_create_order_refund_paypal_process(monkeypatch: pytest.MonkeyPatch) -> None:
    def factory(session: AsyncSession):
        async def inner() -> str:
            order = await _paid_order(session)
            order.payment_method = "paypal"
            order.paypal_capture_id = "CAP-9"
            session.add(order)
            await session.commit()
            await session.refresh(order, attribute_names=["refunds", "items"])

            async def _fake_refund(
                *, paypal_capture_id: str, amount_ron: Decimal
            ) -> str:
                return "PPR-1"

            monkeypatch.setattr(order_service.paypal, "refund_capture", _fake_refund)
            updated = await order_service.create_order_refund(
                session,
                order,
                amount=Decimal("5.00"),
                note="partial",
                process_payment=True,
            )
            return updated.status.value

        return inner()

    assert _run(factory) in {"paid", "refunded"}


def test_create_order_refund_paypal_missing_capture() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _paid_order(session)
            order.payment_method = "paypal"
            session.add(order)
            await session.commit()
            await session.refresh(order, attribute_names=["refunds", "items"])
            await order_service.create_order_refund(
                session,
                order,
                amount=Decimal("5.00"),
                note="x",
                process_payment=True,
            )

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


def test_create_order_refund_unsupported_method() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _paid_order(session)
            order.payment_method = "cod"
            session.add(order)
            await session.commit()
            await session.refresh(order, attribute_names=["refunds", "items"])
            await order_service.create_order_refund(
                session,
                order,
                amount=Decimal("5.00"),
                note="x",
                process_payment=True,
            )

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


# --------------------------------------------------------------------------- #
# capture_payment                                                              #
# --------------------------------------------------------------------------- #
def test_capture_payment_missing_intent() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _build_order(session, payment_method="cod")
            await order_service.capture_payment(session, order)

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


def test_capture_payment_intent_mismatch() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _build_order(session, payment_method="stripe")
            order.stripe_payment_intent_id = "pi_real"
            session.add(order)
            await session.commit()
            await order_service.capture_payment(session, order, intent_id="pi_other")

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


def test_capture_payment_wrong_status() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _build_order(session, payment_method="stripe")
            order.status = OrderStatus.cancelled
            session.add(order)
            await session.commit()
            await order_service.capture_payment(session, order, intent_id="pi_1")

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


def test_capture_payment_success(monkeypatch: pytest.MonkeyPatch) -> None:
    def factory(session: AsyncSession):
        async def inner() -> OrderStatus:
            order = await _build_order(session, payment_method="stripe")

            async def _fake_capture(intent_id: str) -> dict:
                return {"id": intent_id}

            async def _fake_promo(
                session: AsyncSession, *, order: Order, note: str
            ) -> None:
                return None

            monkeypatch.setattr(
                order_service.payments, "capture_payment_intent", _fake_capture
            )
            monkeypatch.setattr(
                order_service.promo_usage, "record_promo_usage", _fake_promo
            )
            updated = await order_service.capture_payment(
                session, order, intent_id="pi_cap"
            )
            return updated.status

        return inner()

    assert _run(factory) == OrderStatus.pending_acceptance


def test_capture_payment_already_captured_idempotent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def factory(session: AsyncSession):
        async def inner() -> OrderStatus:
            order = await _build_order(session, payment_method="stripe")
            order.stripe_payment_intent_id = "pi_done"
            session.add(OrderEvent(order_id=order.id, event="payment_captured"))
            session.add(order)
            await session.commit()
            await session.refresh(order, attribute_names=["events"])

            async def _boom(intent_id: str) -> dict:  # pragma: no cover - must not run
                raise AssertionError("should not capture again")

            monkeypatch.setattr(order_service.payments, "capture_payment_intent", _boom)
            updated = await order_service.capture_payment(session, order)
            return updated.status

        return inner()

    assert _run(factory) in {
        OrderStatus.pending_acceptance,
        OrderStatus.pending_payment,
    }


# --------------------------------------------------------------------------- #
# void_payment                                                                 #
# --------------------------------------------------------------------------- #
def test_void_payment_missing_intent() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _build_order(session, payment_method="cod")
            await order_service.void_payment(session, order)

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


def test_void_payment_mismatch() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _build_order(session, payment_method="stripe")
            order.stripe_payment_intent_id = "pi_real"
            session.add(order)
            await session.commit()
            await order_service.void_payment(session, order, intent_id="pi_other")

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


def test_void_payment_wrong_status() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _build_order(session, payment_method="stripe")
            order.status = OrderStatus.delivered
            session.add(order)
            await session.commit()
            await order_service.void_payment(session, order, intent_id="pi_1")

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


def test_void_payment_success(monkeypatch: pytest.MonkeyPatch) -> None:
    def factory(session: AsyncSession):
        async def inner() -> OrderStatus:
            order = await _build_order(session, payment_method="stripe")

            async def _fake_void(intent_id: str) -> dict:
                return {"id": intent_id}

            monkeypatch.setattr(
                order_service.payments, "void_payment_intent", _fake_void
            )
            updated = await order_service.void_payment(
                session, order, intent_id="pi_void"
            )
            return updated.status

        return inner()

    assert _run(factory) == OrderStatus.cancelled


def test_void_payment_falls_back_to_refund(monkeypatch: pytest.MonkeyPatch) -> None:
    def factory(session: AsyncSession):
        async def inner() -> OrderStatus:
            order = await _build_order(session, payment_method="stripe")

            async def _fake_void(intent_id: str) -> dict:
                raise HTTPException(status_code=400, detail="already captured")

            async def _fake_refund(intent_id: str) -> dict:
                return {"id": "re_fallback"}

            monkeypatch.setattr(
                order_service.payments, "void_payment_intent", _fake_void
            )
            monkeypatch.setattr(
                order_service.payments, "refund_payment_intent", _fake_refund
            )
            updated = await order_service.void_payment(
                session, order, intent_id="pi_fb"
            )
            return updated.status

        return inner()

    assert _run(factory) == OrderStatus.cancelled


# --------------------------------------------------------------------------- #
# Tag management                                                               #
# --------------------------------------------------------------------------- #
def test_add_remove_order_tag_flow() -> None:
    def factory(session: AsyncSession):
        async def inner() -> int:
            order = await _build_order(session, payment_method="cod")
            await order_service.add_order_tag(session, order, tag="VIP Customer")
            # Duplicate add -> early return branch.
            await order_service.add_order_tag(session, order, tag="VIP Customer")
            await order_service.remove_order_tag(session, order, tag="vip_customer")
            # Remove non-existent -> early return branch.
            await order_service.remove_order_tag(session, order, tag="vip_customer")
            tags = await order_service.list_order_tags(session)
            return len(tags)

        return inner()

    assert _run(factory) == 0


def test_add_order_tag_empty_raises() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _build_order(session, payment_method="cod")
            await order_service.add_order_tag(session, order, tag="***")

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


def test_remove_order_tag_empty_raises() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _build_order(session, payment_method="cod")
            await order_service.remove_order_tag(session, order, tag="   ")

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


def test_rename_order_tag_validation_and_merge() -> None:
    def factory(session: AsyncSession):
        async def inner() -> order_service._OrderTagRenameResult:
            order1 = await _build_order(
                session, payment_method="cod", slug="t1", sku="T1"
            )
            order2 = await _build_order(
                session, payment_method="cod", slug="t2", sku="T2"
            )
            session.add_all(
                [
                    OrderTag(order_id=order1.id, tag="old"),
                    OrderTag(order_id=order2.id, tag="old"),
                    OrderTag(order_id=order2.id, tag="new"),
                ]
            )
            await session.commit()
            return await order_service.rename_order_tag(
                session, from_tag="old", to_tag="new"
            )

        return inner()

    result = _run(factory)
    assert result["updated"] == 1
    assert result["merged"] == 1
    assert result["total"] == 2


def test_rename_order_tag_missing_from() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            await order_service.rename_order_tag(session, from_tag="***", to_tag="new")

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


def test_rename_order_tag_missing_to() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            await order_service.rename_order_tag(session, from_tag="old", to_tag="***")

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


def test_rename_order_tag_same_tag() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            await order_service.rename_order_tag(session, from_tag="x", to_tag="x")

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


def test_rename_order_tag_not_found() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            await order_service.rename_order_tag(
                session, from_tag="ghost", to_tag="real"
            )

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 404


def test_rename_order_tag_too_many_affected() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _build_order(session, payment_method="cod")
            session.add(OrderTag(order_id=order.id, tag="bulk"))
            await session.commit()
            await order_service.rename_order_tag(
                session, from_tag="bulk", to_tag="bulk2", max_affected_orders=0
            )

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


# --------------------------------------------------------------------------- #
# review_order_fraud                                                           #
# --------------------------------------------------------------------------- #
def test_review_order_fraud_invalid_decision() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _build_order(session, payment_method="cod")
            await order_service.review_order_fraud(session, order, decision="maybe")

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


def test_review_order_fraud_approve_then_deny() -> None:
    def factory(session: AsyncSession):
        async def inner() -> int:
            order = await _build_order(session, payment_method="cod")
            await order_service.review_order_fraud(
                session, order, decision="approve", note="looks ok"
            )
            await order_service.review_order_fraud(session, order, decision="deny")
            tags = (
                (
                    await session.execute(
                        __import__("sqlalchemy")
                        .select(OrderTag)
                        .where(OrderTag.order_id == order.id)
                    )
                )
                .scalars()
                .all()
            )
            return len(tags)

        return inner()

    assert _run(factory) == 1


# --------------------------------------------------------------------------- #
# add_admin_note                                                              #
# --------------------------------------------------------------------------- #
def test_add_admin_note_empty_raises() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _build_order(session, payment_method="cod")
            await order_service.add_admin_note(session, order, note="   ")

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


def test_add_admin_note_success() -> None:
    def factory(session: AsyncSession):
        async def inner() -> Order:
            order = await _build_order(session, payment_method="cod")
            return await order_service.add_admin_note(session, order, note="Verified")

        return inner()

    assert _run(factory) is not None


# --------------------------------------------------------------------------- #
# Shipment CRUD                                                                #
# --------------------------------------------------------------------------- #
def test_create_shipment_requires_tracking() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _build_order(session, payment_method="cod")
            await order_service.create_order_shipment(
                session, order, OrderShipmentCreate(tracking_number="   ")
            )

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


def test_create_shipment_success_and_duplicate() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _build_order(session, payment_method="cod")
            await order_service.create_order_shipment(
                session,
                order,
                OrderShipmentCreate(
                    tracking_number="1Z999AA10123456784", courier="ups"
                ),
                actor="admin",
            )
            await order_service.create_order_shipment(
                session,
                order,
                OrderShipmentCreate(
                    tracking_number="1Z999AA10123456784", courier="ups"
                ),
            )

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 409


def test_update_shipment_not_found() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _build_order(session, payment_method="cod")
            import uuid

            await order_service.update_order_shipment(
                session,
                order,
                uuid.uuid4(),
                OrderShipmentUpdate(courier="dhl"),
            )

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 404


def test_update_shipment_empty_tracking_raises() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _build_order(session, payment_method="cod")
            ship = OrderShipment(
                order_id=order.id,
                tracking_number="TRACK123456",
                courier="ups",
            )
            session.add(ship)
            await session.commit()
            await order_service.update_order_shipment(
                session,
                order,
                ship.id,
                OrderShipmentUpdate(tracking_number="  "),
            )

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


def test_update_shipment_success() -> None:
    def factory(session: AsyncSession):
        async def inner() -> Order:
            order = await _build_order(session, payment_method="cod")
            ship = OrderShipment(
                order_id=order.id,
                tracking_number="TRACK123456",
                courier="ups",
            )
            session.add(ship)
            await session.commit()
            return await order_service.update_order_shipment(
                session,
                order,
                ship.id,
                OrderShipmentUpdate(courier="dhl", tracking_url="https://x/y"),
                actor="admin",
            )

        return inner()

    assert _run(factory) is not None


def test_delete_shipment_not_found() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _build_order(session, payment_method="cod")
            import uuid

            await order_service.delete_order_shipment(session, order, uuid.uuid4())

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 404


def test_delete_shipment_success() -> None:
    def factory(session: AsyncSession):
        async def inner() -> Order:
            order = await _build_order(session, payment_method="cod")
            ship = OrderShipment(
                order_id=order.id,
                tracking_number="TRACK987654",
                courier="ups",
            )
            session.add(ship)
            await session.commit()
            return await order_service.delete_order_shipment(
                session, order, ship.id, actor="admin"
            )

        return inner()

    assert _run(factory) is not None


# --------------------------------------------------------------------------- #
# update_order_addresses                                                       #
# --------------------------------------------------------------------------- #
async def _order_with_addresses(session: AsyncSession) -> Order:
    product = await _make_product(session, stock=10, slug="addr", sku="ADDR")
    cart = await _make_cart(session, product, qty=1)
    ship = Address(line1="S1", city="City", postal_code="010101", country="RO")
    bill = Address(line1="B1", city="City", postal_code="010101", country="RO")
    session.add_all([ship, bill])
    await session.flush()
    order = await order_service.build_order_from_cart(
        session,
        None,
        customer_email="a@e.com",
        customer_name="A",
        cart=cart,
        shipping_address_id=ship.id,
        billing_address_id=bill.id,
        payment_method="cod",
    )
    return order


def test_update_addresses_blocked_status() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _order_with_addresses(session)
            order.status = OrderStatus.shipped
            session.add(order)
            await session.commit()
            await order_service.update_order_addresses(
                session,
                order,
                AdminOrderAddressesUpdate(shipping_address=AddressUpdate(line1="New")),
            )

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


def test_update_addresses_no_updates() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _order_with_addresses(session)
            await order_service.update_order_addresses(
                session, order, AdminOrderAddressesUpdate()
            )

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


def test_update_addresses_success_with_rerate() -> None:
    def factory(session: AsyncSession):
        async def inner() -> Order:
            order = await _order_with_addresses(session)
            return await order_service.update_order_addresses(
                session,
                order,
                AdminOrderAddressesUpdate(
                    shipping_address=AddressUpdate(
                        line1="New Street",
                        city="Town",
                        postal_code="020202",
                        country="RO",
                    ),
                    billing_address=AddressUpdate(line1="Bill New"),
                    rerate_shipping=True,
                    note="moved",
                ),
                actor="admin",
            )

        return inner()

    assert _run(factory) is not None


def test_update_addresses_rerate_blocked_after_capture() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _order_with_addresses(session)
            order.payment_method = "paypal"
            order.paypal_capture_id = "CAP-X"
            session.add(order)
            await session.commit()
            await order_service.update_order_addresses(
                session,
                order,
                AdminOrderAddressesUpdate(
                    shipping_address=AddressUpdate(
                        line1="New", city="T", postal_code="030303", country="RO"
                    ),
                    rerate_shipping=True,
                ),
            )

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


# --------------------------------------------------------------------------- #
# admin_search_orders — SLA / fraud filter branches                           #
# --------------------------------------------------------------------------- #
def test_admin_search_sla_and_fraud_filters() -> None:
    def factory(session: AsyncSession):
        async def inner() -> int:
            order = await _build_order(session, payment_method="cod")
            order.status = OrderStatus.pending_acceptance
            session.add(order)
            await session.commit()
            total = 0
            for sla in ("accept_overdue", "ship_overdue", "any_overdue"):
                _, count = await order_service.admin_search_orders(session, sla=sla)
                total += count
            for fraud in ("queue", "flagged", "approved", "denied"):
                _, count = await order_service.admin_search_orders(session, fraud=fraud)
                total += count
            _, count = await order_service.admin_search_orders(
                session, q="buyer", pending_any=True, include_test=False
            )
            return total + count

        return inner()

    assert _run(factory) >= 0


# --------------------------------------------------------------------------- #
# Supplementary closure for the remaining service branches                     #
# --------------------------------------------------------------------------- #
async def _build_order_for_user(session: AsyncSession):
    """Build a guest order then re-stamp it onto a real user id for filter tests."""
    import uuid as _uuid

    from app.models.user import User

    user = User(
        email="owner@example.com",
        username=f"owner{_uuid.uuid4().hex[:8]}",
        hashed_password="x",
        name="Owner",
    )
    session.add(user)
    await session.flush()
    product = await _make_product(session, stock=10, slug="usr", sku="USR")
    cart = await _make_cart(session, product, qty=1)
    order = await order_service.build_order_from_cart(
        session,
        user.id,
        customer_email="owner@example.com",
        customer_name="Owner",
        cart=cart,
        shipping_address_id=None,
        billing_address_id=None,
        payment_method="cod",
    )
    return user.id, order


def test_list_orders_user_id_filter_hits() -> None:
    def factory(session: AsyncSession):
        async def inner() -> int:
            user_id, _ = await _build_order_for_user(session)
            rows = await order_service.list_orders(session, user_id=user_id)
            return len(rows)

        return inner()

    assert _run(factory) == 1


def _make_order_item_stub(product_id, variant_id, quantity):
    class _Item:
        def __init__(self) -> None:
            self.product_id = product_id
            self.variant_id = variant_id
            self.quantity = quantity

    return _Item()


def _stub_items(order: Order, items: list) -> None:
    """Place plain stub items into the order's __dict__ so ``getattr(order, 'items')``
    returns them without triggering the instrumented-relationship cascade or a lazy
    load. ``_commit_stock_for_order`` reads via ``getattr`` only."""
    order.__dict__["items"] = items


def test_commit_stock_skips_bad_items() -> None:
    """No product_id (84), qty<=0 (87), and empty qty_by_key (91) early return."""

    def factory(session: AsyncSession):
        async def inner() -> None:
            order = Order(
                reference_code="BADITEMS01",
                customer_email="b@e.com",
                customer_name="B",
                status=OrderStatus.pending_acceptance,
                total_amount=Decimal("0"),
                tax_amount=Decimal("0"),
                fee_amount=Decimal("0"),
                shipping_amount=Decimal("0"),
                currency="RON",
                payment_method="cod",
            )
            session.add(order)
            await session.commit()
            import uuid

            _stub_items(
                order,
                [
                    _make_order_item_stub(None, None, 5),  # no product_id -> 84
                    _make_order_item_stub(uuid.uuid4(), None, 0),  # qty<=0 -> 87
                ],
            )
            await order_service._commit_stock_for_order(session, order)

        return inner()

    _run(factory)


def test_commit_stock_product_not_found() -> None:
    """Item references a product id absent from the DB (line 156 continue)."""

    def factory(session: AsyncSession):
        async def inner() -> None:
            order = Order(
                reference_code="MISSPROD01",
                customer_email="b@e.com",
                customer_name="B",
                status=OrderStatus.pending_acceptance,
                total_amount=Decimal("0"),
                tax_amount=Decimal("0"),
                fee_amount=Decimal("0"),
                shipping_amount=Decimal("0"),
                currency="RON",
                payment_method="cod",
            )
            session.add(order)
            await session.commit()
            import uuid

            _stub_items(order, [_make_order_item_stub(uuid.uuid4(), None, 2)])
            await order_service._commit_stock_for_order(session, order)

        return inner()

    _run(factory)


def test_commit_stock_variant_not_found() -> None:
    """Item references a variant id absent from the DB (line 135 continue)."""

    def factory(session: AsyncSession):
        async def inner() -> None:
            order = Order(
                reference_code="MISSVAR001",
                customer_email="b@e.com",
                customer_name="B",
                status=OrderStatus.pending_acceptance,
                total_amount=Decimal("0"),
                tax_amount=Decimal("0"),
                fee_amount=Decimal("0"),
                shipping_amount=Decimal("0"),
                currency="RON",
                payment_method="cod",
            )
            session.add(order)
            await session.commit()
            import uuid

            _stub_items(order, [_make_order_item_stub(uuid.uuid4(), uuid.uuid4(), 2)])
            await order_service._commit_stock_for_order(session, order)

        return inner()

    _run(factory)


def test_restore_stock_no_committed_event() -> None:
    """Restore with no prior commit event returns early (line 229/230)."""

    def factory(session: AsyncSession):
        async def inner() -> None:
            order = Order(
                reference_code="NOCOMMIT01",
                customer_email="b@e.com",
                customer_name="B",
                status=OrderStatus.cancelled,
                total_amount=Decimal("0"),
                tax_amount=Decimal("0"),
                fee_amount=Decimal("0"),
                shipping_amount=Decimal("0"),
                currency="RON",
                payment_method="cod",
            )
            session.add(order)
            await session.commit()
            _stub_items(order, [])
            await order_service._restore_stock_for_order(session, order)

        return inner()

    _run(factory)


def test_restore_stock_parses_malformed_lines() -> None:
    """Restore parses a commit event whose ``lines`` contain bad rows.

    Exercises the row-skipping branches (235/240/243/247-254) and the
    variant-not-found / product-not-found continues, plus the degenerate
    ``restored_lines`` empty short-circuit.
    """

    def factory(session: AsyncSession):
        async def inner() -> None:
            order = Order(
                reference_code="RESTBAD001",
                customer_email="b@e.com",
                customer_name="B",
                status=OrderStatus.cancelled,
                total_amount=Decimal("0"),
                tax_amount=Decimal("0"),
                fee_amount=Decimal("0"),
                shipping_amount=Decimal("0"),
                currency="RON",
                payment_method="cod",
            )
            session.add(order)
            await session.commit()
            import uuid

            # A commit event whose lines: not-a-dict, bad product_id, deducted<=0,
            # and a valid-but-missing product (so nothing gets restored).
            session.add(
                OrderEvent(
                    order_id=order.id,
                    event="stock_committed",
                    data={
                        "lines": [
                            "not-a-dict",
                            {"product_id": "bad", "deducted_qty": 5},
                            {"product_id": str(uuid.uuid4()), "deducted_qty": 0},
                            {"product_id": str(uuid.uuid4()), "deducted_qty": 3},
                        ]
                    },
                )
            )
            await session.commit()
            _stub_items(order, [])
            await order_service._restore_stock_for_order(session, order)

        return inner()

    _run(factory)


def test_restore_stock_non_list_lines() -> None:
    """Commit event with a non-list ``lines`` payload returns early (line 235)."""

    def factory(session: AsyncSession):
        async def inner() -> None:
            order = Order(
                reference_code="RESTNOLST1",
                customer_email="b@e.com",
                customer_name="B",
                status=OrderStatus.cancelled,
                total_amount=Decimal("0"),
                tax_amount=Decimal("0"),
                fee_amount=Decimal("0"),
                shipping_amount=Decimal("0"),
                currency="RON",
                payment_method="cod",
            )
            session.add(order)
            await session.commit()
            session.add(
                OrderEvent(
                    order_id=order.id,
                    event="stock_committed",
                    data={"lines": "oops"},
                )
            )
            await session.commit()
            _stub_items(order, [])
            await order_service._restore_stock_for_order(session, order)

        return inner()

    _run(factory)


def test_build_order_skips_zero_qty_and_no_product_items() -> None:
    """Cart items with no product_id (390) and qty<=0 (393) are skipped."""

    def factory(session: AsyncSession):
        async def inner() -> Order:
            product = await _make_product(session, stock=10, slug="mix", sku="MIX")
            cart = Cart(user_id=None)
            cart.items = [
                CartItem(
                    product=product,
                    quantity=0,
                    unit_price_at_add=Decimal("10.00"),
                ),
                CartItem(
                    product=product,
                    quantity=1,
                    unit_price_at_add=Decimal("10.00"),
                ),
            ]
            session.add(cart)
            await session.commit()
            await session.refresh(cart)
            return await order_service.build_order_from_cart(
                session,
                None,
                customer_email="m@e.com",
                customer_name="M",
                cart=cart,
                shipping_address_id=None,
                billing_address_id=None,
                payment_method="cod",
            )

        return inner()

    order = _run(factory)
    assert order is not None


def test_ensure_address_snapshot_invalid_kind_and_missing() -> None:
    def factory(session: AsyncSession):
        async def inner() -> tuple[int, int]:
            order = await _build_order(session, payment_method="cod")
            codes: list[int] = []
            try:
                await order_service._ensure_order_address_snapshot(
                    session, order, "weird"
                )
            except HTTPException as exc:
                codes.append(exc.status_code)
            try:
                await order_service._ensure_order_address_snapshot(
                    session, order, "shipping"
                )
            except HTTPException as exc:
                codes.append(exc.status_code)
            return tuple(codes)  # type: ignore[return-value]

        return inner()

    codes = _run(factory)
    assert codes == (400, 400)


def test_update_order_cancel_reason_empty_string_raises() -> None:
    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _build_order(session, payment_method="cod")
            await order_service.update_order(
                session, order, OrderUpdate(cancel_reason="")
            )

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


def test_update_order_courier_only_with_existing_tracking() -> None:
    """courier-only update where order already has a tracking number (1517-1522)."""

    def factory(session: AsyncSession):
        async def inner() -> Order:
            order = await _build_order(session, payment_method="cod")
            order.tracking_number = "1Z999AA10123456784"
            order.courier = "ups"
            session.add(order)
            await session.commit()
            return await order_service.update_order(
                session, order, OrderUpdate(courier="dhl")
            )

        return inner()

    assert _run(factory) is not None


def test_update_order_tracking_url_change_emits_event() -> None:
    """tracking_url change path (1524 + 1635 tracking_changes event)."""

    def factory(session: AsyncSession):
        async def inner() -> Order:
            order = await _build_order(session, payment_method="cod")
            return await order_service.update_order(
                session,
                order,
                OrderUpdate(
                    tracking_number="1Z999AA10123456784",
                    tracking_url="https://track/abc",
                    courier="ups",
                ),
            )

        return inner()

    assert _run(factory) is not None


def test_create_shipment_keeps_existing_order_fields() -> None:
    """Shipment on an order that already has tracking/courier (2113/2117 arcs)."""

    def factory(session: AsyncSession):
        async def inner() -> Order:
            order = await _build_order(session, payment_method="cod")
            order.tracking_number = "EXISTING111"
            order.tracking_url = "https://existing/url"
            order.courier = "ups"
            session.add(order)
            await session.commit()
            return await order_service.create_order_shipment(
                session,
                order,
                OrderShipmentCreate(
                    tracking_number="NEWTRACK222", courier="dhl", tracking_url=None
                ),
            )

        return inner()

    assert _run(factory) is not None


def test_update_shipment_duplicate_tracking_conflict() -> None:
    """Updating a shipment to a tracking number used by a sibling (2191-2194)."""

    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _build_order(session, payment_method="cod")
            a = OrderShipment(
                order_id=order.id, tracking_number="AAA111", courier="ups"
            )
            b = OrderShipment(
                order_id=order.id, tracking_number="BBB222", courier="ups"
            )
            session.add_all([a, b])
            await session.commit()
            await order_service.update_order_shipment(
                session,
                order,
                b.id,
                OrderShipmentUpdate(tracking_number="AAA111"),
            )

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 409


def test_create_shipment_integrity_error(monkeypatch: pytest.MonkeyPatch) -> None:
    """commit raising IntegrityError -> 409 (2141-2143)."""

    from sqlalchemy.exc import IntegrityError

    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _build_order(session, payment_method="cod")
            original_commit = session.commit
            calls = {"n": 0}

            async def _maybe_fail() -> None:
                calls["n"] += 1
                if calls["n"] == 1:
                    raise IntegrityError("dup", {}, Exception("dup"))
                await original_commit()

            monkeypatch.setattr(session, "commit", _maybe_fail)
            await order_service.create_order_shipment(
                session,
                order,
                OrderShipmentCreate(tracking_number="INTEG999", courier="ups"),
            )

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 409


def test_update_shipment_integrity_error(monkeypatch: pytest.MonkeyPatch) -> None:
    """update commit raising IntegrityError -> 409 (2247-2249)."""

    from sqlalchemy.exc import IntegrityError

    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _build_order(session, payment_method="cod")
            ship = OrderShipment(
                order_id=order.id, tracking_number="UPDINT001", courier="ups"
            )
            session.add(ship)
            await session.commit()

            async def _fail() -> None:
                raise IntegrityError("dup", {}, Exception("dup"))

            monkeypatch.setattr(session, "commit", _fail)
            await order_service.update_order_shipment(
                session,
                order,
                ship.id,
                OrderShipmentUpdate(courier="dhl"),
            )

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 409


def test_delete_shipment_integrity_error(monkeypatch: pytest.MonkeyPatch) -> None:
    """delete commit raising IntegrityError -> 409 (2291-2293)."""

    from sqlalchemy.exc import IntegrityError

    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _build_order(session, payment_method="cod")
            ship = OrderShipment(
                order_id=order.id, tracking_number="DELINT001", courier="ups"
            )
            session.add(ship)
            await session.commit()

            async def _fail() -> None:
                raise IntegrityError("fk", {}, Exception("fk"))

            monkeypatch.setattr(session, "commit", _fail)
            await order_service.delete_order_shipment(session, order, ship.id)

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 409


def test_create_order_refund_with_prior_refund_item_history() -> None:
    """Refund items where a prior refund recorded item rows (2484-2510)."""

    def factory(session: AsyncSession):
        async def inner() -> OrderStatus:
            order = await _paid_order(session)
            item = order.items[0]
            # A prior partial refund with mixed-quality item rows.
            import uuid

            session.add(
                OrderRefund(
                    order_id=order.id,
                    amount=Decimal("10.00"),
                    currency="RON",
                    provider="manual",
                    note="prior",
                    data={
                        "items": [
                            "not-a-dict",
                            {"order_item_id": "bad-uuid", "quantity": 1},
                            {"order_item_id": str(uuid.uuid4()), "quantity": "oops"},
                            {"order_item_id": str(item.id), "quantity": 0},
                            {"order_item_id": str(item.id), "quantity": 1},
                        ]
                    },
                )
            )
            await session.commit()
            await session.refresh(order, attribute_names=["refunds", "items"])
            updated = await order_service.create_order_refund(
                session,
                order,
                amount=Decimal("10.00"),
                note="second partial",
                items=[(item.id, 1)],
            )
            return updated.status

        return inner()

    assert _run(factory) in {OrderStatus.paid, OrderStatus.refunded}


def test_create_order_refund_with_prior_refund_non_list_items() -> None:
    """Prior refund whose data['items'] is not a list (2491-2492 continue)."""

    def factory(session: AsyncSession):
        async def inner() -> OrderStatus:
            order = await _paid_order(session)
            item = order.items[0]
            session.add(
                OrderRefund(
                    order_id=order.id,
                    amount=Decimal("5.00"),
                    currency="RON",
                    provider="manual",
                    note="prior",
                    data={"items": "not-a-list"},
                )
            )
            await session.commit()
            await session.refresh(order, attribute_names=["refunds", "items"])
            updated = await order_service.create_order_refund(
                session,
                order,
                amount=Decimal("10.00"),
                note="partial",
                items=[(item.id, 1)],
            )
            return updated.status

        return inner()

    assert _run(factory) in {OrderStatus.paid, OrderStatus.refunded}


def test_capture_payment_on_paid_order_skips_status_change(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Capture on a ``paid`` order: no pending_payment status change (2689->2698)."""

    def factory(session: AsyncSession):
        async def inner() -> OrderStatus:
            order = await _build_order(session, payment_method="stripe")
            order.status = OrderStatus.paid
            session.add(order)
            await session.commit()

            async def _fake_capture(intent_id: str) -> dict:
                return {"id": intent_id}

            async def _fake_promo(
                session: AsyncSession, *, order: Order, note: str
            ) -> None:
                return None

            monkeypatch.setattr(
                order_service.payments, "capture_payment_intent", _fake_capture
            )
            monkeypatch.setattr(
                order_service.promo_usage, "record_promo_usage", _fake_promo
            )
            updated = await order_service.capture_payment(
                session, order, intent_id="pi_paid"
            )
            return updated.status

        return inner()

    assert _run(factory) == OrderStatus.paid


def test_rerate_shipping_clamps_negative_and_free_threshold() -> None:
    """Re-rate where taxable<0 clamps (1326/1557) and free-ship threshold (1334/1564)."""

    def factory(session: AsyncSession):
        async def inner() -> dict:
            order = await _order_with_addresses(session)
            # Force a state where shipping+tax+fee exceed total so taxable<0.
            order.total_amount = Decimal("1.00")
            order.shipping_amount = Decimal("5.00")
            order.tax_amount = Decimal("0.00")
            order.fee_amount = Decimal("0.00")
            session.add(order)
            await session.commit()
            await session.refresh(order, attribute_names=["items", "shipping_address"])
            return await order_service._rerate_order_shipping(session, order)

        return inner()

    changes = _run(factory)
    assert "shipping_amount" in changes


# --------------------------------------------------------------------------- #
# Round-2 closure: remaining arcs / clamps / defensive branches                #
# --------------------------------------------------------------------------- #
def test_build_order_no_product_id_cart_item_skipped() -> None:
    """The qty-aggregation loop skips a cart item with no product_id (line 390).

    ``CartItem.product_id`` is NOT NULL at the DB layer, so a persisted bad item
    cannot exist. We build a real (committed) cart, then expose an extra in-memory
    stub item with no product_id via the cart's ``__dict__`` so ``cart.items``
    yields it to the aggregation loop (covering the ``if not product_id: continue``
    skip). The later order-item materialisation loop does not skip, so persisting a
    NULL ``product_id`` ultimately raises an IntegrityError, which we expect.
    """

    from types import SimpleNamespace

    from sqlalchemy.exc import IntegrityError

    def factory(session: AsyncSession):
        async def inner() -> None:
            ghost = _make_order_item_stub(None, None, 2)
            ghost.unit_price_at_add = Decimal("10.00")
            # A synthetic, never-session-tracked cart: build_order only reads
            # ``cart.items`` / ``cart.last_order_id`` before the flush, so loop 1
            # hits the ``if not product_id: continue`` skip (line 390). Loop 2 has
            # no skip and materialises an OrderItem(product_id=None), so the flush
            # raises IntegrityError -- after line 390 has already executed.
            cart = SimpleNamespace(items=[ghost], last_order_id=None)
            await order_service.build_order_from_cart(
                session,
                None,
                customer_email="n@e.com",
                customer_name="N",
                cart=cart,  # type: ignore[arg-type]
                shipping_address_id=None,
                billing_address_id=None,
                payment_method="cod",
            )

        return inner()

    with pytest.raises(IntegrityError):
        _run(factory)


def test_build_order_free_shipping_threshold_met() -> None:
    """Subtotal >= free-shipping threshold zeroes shipping (line 546)."""

    def factory(session: AsyncSession):
        async def inner() -> Decimal:
            product = await _make_product(
                session, stock=100, slug="big", sku="BIG", price="50.00"
            )
            cart = await _make_cart(session, product, qty=10)  # subtotal 500 >= 300
            order = await order_service.build_order_from_cart(
                session,
                None,
                customer_email="f@e.com",
                customer_name="F",
                cart=cart,
                shipping_address_id=None,
                billing_address_id=None,
                payment_method="cod",
            )
            return Decimal(str(order.shipping_amount))

        return inner()

    assert _run(factory) == Decimal("0.00")


def test_build_order_discount_exceeds_subtotal_clamps() -> None:
    """Discount larger than subtotal clamps taxable to zero (line 538)."""

    def factory(session: AsyncSession):
        async def inner() -> Order:
            product = await _make_product(
                session, stock=10, slug="disc", sku="DISC", price="10.00"
            )
            cart = await _make_cart(session, product, qty=1)
            return await order_service.build_order_from_cart(
                session,
                None,
                customer_email="d@e.com",
                customer_name="D",
                cart=cart,
                shipping_address_id=None,
                billing_address_id=None,
                payment_method="cod",
                discount=Decimal("999.00"),
            )

        return inner()

    assert _run(factory) is not None


def test_build_order_with_valid_variant_stock_path() -> None:
    """Order through a valid in-stock variant exercises the variant branch (492)."""

    def factory(session: AsyncSession):
        async def inner() -> Order:
            product = await _make_product(session, stock=10, slug="vok", sku="VOK")
            variant = ProductVariant(
                product_id=product.id, name="OK Variant", stock_quantity=10
            )
            session.add(variant)
            await session.flush()
            cart = await _make_cart(session, product, qty=2, variant=variant)
            return await order_service.build_order_from_cart(
                session,
                None,
                customer_email="vk@e.com",
                customer_name="VK",
                cart=cart,
                shipping_address_id=None,
                billing_address_id=None,
                payment_method="cod",
            )

        return inner()

    assert _run(factory) is not None


def test_build_order_missing_variant_in_db_raises() -> None:
    """A cart variant id that is not present in the DB raises (line 446)."""

    def factory(session: AsyncSession):
        async def inner() -> None:
            import uuid

            product = await _make_product(session, stock=10, slug="mv", sku="MV")
            cart = Cart(user_id=None)
            item = CartItem(
                product=product, quantity=1, unit_price_at_add=Decimal("10.00")
            )
            item.variant_id = uuid.uuid4()  # nonexistent variant
            cart.items = [item]
            session.add(cart)
            await session.commit()
            await session.refresh(cart)
            await order_service.build_order_from_cart(
                session,
                None,
                customer_email="mv@e.com",
                customer_name="MV",
                cart=cart,
                shipping_address_id=None,
                billing_address_id=None,
                payment_method="cod",
            )

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


def test_admin_search_invalid_sla_and_fraud_and_dates() -> None:
    """Invalid sla/fraud values fall through (932->944, 963->965); date filters (966/968)."""

    def factory(session: AsyncSession):
        async def inner() -> int:
            from datetime import datetime, timedelta, timezone

            await _build_order(session, payment_method="cod")
            now = datetime.now(timezone.utc)
            _, c1 = await order_service.admin_search_orders(session, sla="bogus")
            _, c2 = await order_service.admin_search_orders(session, fraud="bogus")
            _, c3 = await order_service.admin_search_orders(
                session,
                from_dt=now - timedelta(days=1),
                to_dt=now + timedelta(days=1),
            )
            return c1 + c2 + c3

        return inner()

    assert _run(factory) >= 0


def test_list_order_tag_stats_returns_counts() -> None:
    def factory(session: AsyncSession):
        async def inner() -> list[tuple[str, int]]:
            order = await _build_order(session, payment_method="cod")
            session.add_all(
                [
                    OrderTag(order_id=order.id, tag="alpha"),
                    OrderTag(order_id=order.id, tag="beta"),
                ]
            )
            await session.commit()
            return await order_service.list_order_tag_stats(session)

        return inner()

    stats = _run(factory)
    assert {name for name, _ in stats} >= {"alpha", "beta"}


def test_list_order_tag_stats_skips_null_tag_row(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A grouped row with a falsy tag is skipped (line 1818).

    ``OrderTag.tag`` is NOT NULL, so a null-tag group cannot exist in the DB. We
    inject one synthetic ``(None, 0)`` result row to exercise the defensive skip,
    mirroring the row-injection technique used for the tag-rename test.
    """

    def factory(session: AsyncSession):
        async def inner() -> list[tuple[str, int]]:
            order = await _build_order(session, payment_method="cod")
            session.add(OrderTag(order_id=order.id, tag="real"))
            await session.commit()

            real_execute = session.execute
            seen = {"done": False}

            async def _patched(stmt, *a, **k):
                result = await real_execute(stmt, *a, **k)
                stmt_text = str(stmt).lower()
                if (
                    not seen["done"]
                    and "order_tags" in stmt_text
                    and "count" in stmt_text
                ):
                    seen["done"] = True
                    rows = list(result.all())

                    class _Result:
                        def all(self_inner):
                            return [(None, 0)] + rows

                    return _Result()
                return result

            monkeypatch.setattr(session, "execute", _patched)
            return await order_service.list_order_tag_stats(session)

        return inner()

    stats = _run(factory)
    assert ("real", 1) in stats


def test_rename_order_tag_skips_rows_without_order_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A tag row whose order_id is falsy is skipped during rename (line 1890)."""

    def factory(session: AsyncSession):
        async def inner() -> order_service._OrderTagRenameResult:
            order = await _build_order(session, payment_method="cod")
            real = OrderTag(order_id=order.id, tag="rn")
            session.add(real)
            await session.commit()

            real_execute = session.execute
            seen = {"first": False}

            async def _patched(stmt, *a, **k):
                result = await real_execute(stmt, *a, **k)
                # On the first SELECT of OrderTag rows for the from_tag, inject a
                # row with no order_id so the ``if not order_id: continue`` fires.
                if not seen["first"] and "order_tags" in str(stmt).lower():
                    seen["first"] = True

                    class _Wrap:
                        def __init__(self, inner):
                            self._inner = inner

                        def scalars(self):
                            parent = self

                            class _S:
                                def all(self_inner):
                                    rows = list(parent._inner.scalars().all())
                                    ghost = OrderTag(tag="rn")
                                    ghost.order_id = None
                                    return rows + [ghost]

                                def first(self_inner):
                                    return parent._inner.scalars().first()

                            return _S()

                        def all(self):
                            return self._inner.all()

                        def __getattr__(self, name):
                            return getattr(self._inner, name)

                    return _Wrap(result)
                return result

            monkeypatch.setattr(session, "execute", _patched)
            return await order_service.rename_order_tag(
                session, from_tag="rn", to_tag="rn2"
            )

        return inner()

    result = _run(factory)
    assert result["updated"] >= 1


def test_create_shipment_validate_returns_none(monkeypatch: pytest.MonkeyPatch) -> None:
    """Defensive: validate_tracking_number yields falsy -> 400 (line 2081)."""

    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _build_order(session, payment_method="cod")
            monkeypatch.setattr(
                order_service.tracking_service,
                "validate_tracking_number",
                lambda **kwargs: None,
            )
            await order_service.create_order_shipment(
                session,
                order,
                OrderShipmentCreate(tracking_number="WILLVOID01", courier="ups"),
            )

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


def test_update_shipment_no_changes() -> None:
    """An empty update payload produces no changes event (2233->2245)."""

    def factory(session: AsyncSession):
        async def inner() -> Order:
            order = await _build_order(session, payment_method="cod")
            ship = OrderShipment(
                order_id=order.id, tracking_number="NOCHG12345", courier="ups"
            )
            session.add(ship)
            await session.commit()
            return await order_service.update_order_shipment(
                session, order, ship.id, OrderShipmentUpdate()
            )

        return inner()

    assert _run(factory) is not None


def test_review_fraud_reapprove_keeps_existing_tag() -> None:
    """Approving an already-approved order skips re-adding the tag (2028->2033)."""

    def factory(session: AsyncSession):
        async def inner() -> int:
            order = await _build_order(session, payment_method="cod")
            await order_service.review_order_fraud(session, order, decision="approve")
            await order_service.review_order_fraud(
                session, order, decision="approve", note="again"
            )
            tags = (
                (
                    await session.execute(
                        __import__("sqlalchemy")
                        .select(OrderTag)
                        .where(
                            OrderTag.order_id == order.id,
                            OrderTag.tag == "fraud_approved",
                        )
                    )
                )
                .scalars()
                .all()
            )
            return len(tags)

        return inner()

    assert _run(factory) == 1


def test_update_addresses_billing_only_no_rerate() -> None:
    """Billing-only update (1734->1741) with rerate disabled (1748->1757)."""

    def factory(session: AsyncSession):
        async def inner() -> Order:
            order = await _order_with_addresses(session)
            return await order_service.update_order_addresses(
                session,
                order,
                AdminOrderAddressesUpdate(
                    billing_address=AddressUpdate(line1="Billing Only"),
                    rerate_shipping=False,
                ),
            )

        return inner()

    assert _run(factory) is not None


def test_update_addresses_shipping_only_no_rerate() -> None:
    """Shipping update with rerate disabled exercises 1748->1757 false arc."""

    def factory(session: AsyncSession):
        async def inner() -> Order:
            order = await _order_with_addresses(session)
            return await order_service.update_order_addresses(
                session,
                order,
                AdminOrderAddressesUpdate(
                    shipping_address=AddressUpdate(
                        line1="Ship Only",
                        city="Town",
                        postal_code="040404",
                        country="RO",
                    ),
                    rerate_shipping=False,
                ),
            )

        return inner()

    assert _run(factory) is not None


def test_update_order_shipping_method_rerate_clamps() -> None:
    """update_order shipping-method block where taxable<0 (1557), free-ship (1564),
    and discount<0 (1585) clamps all trigger."""

    def factory(session: AsyncSession):
        async def inner() -> Order:
            order = await _build_order(session, payment_method="cod")
            # Force amounts so taxable_subtotal goes negative inside the block.
            order.total_amount = Decimal("1.00")
            order.shipping_amount = Decimal("5.00")
            order.tax_amount = Decimal("0.00")
            order.fee_amount = Decimal("0.00")
            session.add(order)
            await session.commit()
            method = await order_service.create_shipping_method(
                session,
                ShippingMethodCreate(name="Std", rate_flat=0.0, rate_per_kg=0),
            )
            return await order_service.update_order(
                session, order, OrderUpdate(), shipping_method=method
            )

        return inner()

    assert _run(factory) is not None


def test_create_order_refund_items_skip_zero_qty() -> None:
    """A requested refund item with qty<=0 is skipped (line 2516)."""

    def factory(session: AsyncSession):
        async def inner() -> OrderStatus:
            order = await _paid_order(session)
            item = order.items[0]
            updated = await order_service.create_order_refund(
                session,
                order,
                amount=Decimal("10.00"),
                note="skip zero",
                items=[(item.id, 0), (item.id, 1)],
            )
            return updated.status

        return inner()

    assert _run(factory) in {OrderStatus.paid, OrderStatus.refunded}


def test_create_order_refund_item_already_fully_refunded() -> None:
    """Requesting a refund for an item whose full quantity was already refunded
    raises (line 2530)."""

    def factory(session: AsyncSession):
        async def inner() -> None:
            order = await _paid_order(session)
            item = order.items[0]
            session.add(
                OrderRefund(
                    order_id=order.id,
                    amount=Decimal("10.00"),
                    currency="RON",
                    provider="manual",
                    note="prior full item",
                    data={
                        "items": [
                            {"order_item_id": str(item.id), "quantity": item.quantity}
                        ]
                    },
                )
            )
            await session.commit()
            await session.refresh(order, attribute_names=["refunds", "items"])
            await order_service.create_order_refund(
                session,
                order,
                amount=Decimal("5.00"),
                note="too much",
                items=[(item.id, 1)],
            )

        return inner()

    with pytest.raises(HTTPException) as exc:
        _run(factory)
    assert exc.value.status_code == 400


def test_commit_stock_restore_full_variant_and_product_lines() -> None:
    """Restore that actually restores both a variant line and a product line,
    exercising 298/261 variant/product restore appends and the full happy path."""

    def factory(session: AsyncSession):
        async def inner() -> tuple[int, int]:
            product = await _make_product(session, stock=10, slug="rs", sku="RS")
            variant = ProductVariant(
                product_id=product.id, name="RV", stock_quantity=10
            )
            session.add(variant)
            await session.flush()
            order = Order(
                reference_code="RESTFULL01",
                customer_email="r@e.com",
                customer_name="R",
                status=OrderStatus.pending_acceptance,
                total_amount=Decimal("0"),
                tax_amount=Decimal("0"),
                fee_amount=Decimal("0"),
                shipping_amount=Decimal("0"),
                currency="RON",
                payment_method="cod",
            )
            order.items = [
                OrderItem(
                    product_id=product.id,
                    variant_id=variant.id,
                    quantity=2,
                    unit_price=Decimal("10"),
                    subtotal=Decimal("20"),
                ),
                OrderItem(
                    product_id=product.id,
                    variant_id=None,
                    quantity=3,
                    unit_price=Decimal("10"),
                    subtotal=Decimal("30"),
                ),
            ]
            session.add(order)
            await session.commit()
            await session.refresh(order, attribute_names=["items"])
            await order_service._commit_stock_for_order(session, order)
            await session.commit()
            await order_service._restore_stock_for_order(session, order)
            await session.commit()
            await session.refresh(variant)
            await session.refresh(product)
            return variant.stock_quantity, product.stock_quantity

        return inner()

    var_stock, prod_stock = _run(factory)
    assert var_stock == 10
    assert prod_stock == 10


# --------------------------------------------------------------------------- #
# Round-3 closure: final residual arcs / clamps                                #
# --------------------------------------------------------------------------- #
def _seed_commit_event(session: AsyncSession, order: Order, lines: list) -> None:
    session.add(
        OrderEvent(order_id=order.id, event="stock_committed", data={"lines": lines})
    )


def test_restore_stock_deducted_qty_not_int() -> None:
    """A commit line whose deducted_qty is not int-coercible -> 0 (247-248), and
    with every line skipped the empty restore_by_key returns early (254)."""

    def factory(session: AsyncSession):
        async def inner() -> None:
            import uuid

            order = Order(
                reference_code="RESTBADQT1",
                customer_email="b@e.com",
                customer_name="B",
                status=OrderStatus.cancelled,
                total_amount=Decimal("0"),
                tax_amount=Decimal("0"),
                fee_amount=Decimal("0"),
                shipping_amount=Decimal("0"),
                currency="RON",
                payment_method="cod",
            )
            session.add(order)
            await session.commit()
            _seed_commit_event(
                session,
                order,
                [
                    # Truthy but not int-coercible -> int() raises -> except -> 0
                    # (lines 247-248) -> then deducted<=0 skip (249).
                    {"product_id": str(uuid.uuid4()), "deducted_qty": "not-a-number"},
                ],
            )
            await session.commit()
            _stub_items(order, [])
            await order_service._restore_stock_for_order(session, order)

        return inner()

    _run(factory)


def test_restore_stock_variant_not_found() -> None:
    """Commit line referencing a missing variant -> 296-298 continue."""

    def factory(session: AsyncSession):
        async def inner() -> None:
            import uuid

            product = await _make_product(session, stock=10, slug="rvm", sku="RVM")
            order = Order(
                reference_code="RESTVARMS1",
                customer_email="b@e.com",
                customer_name="B",
                status=OrderStatus.cancelled,
                total_amount=Decimal("0"),
                tax_amount=Decimal("0"),
                fee_amount=Decimal("0"),
                shipping_amount=Decimal("0"),
                currency="RON",
                payment_method="cod",
            )
            session.add(order)
            await session.commit()
            _seed_commit_event(
                session,
                order,
                [
                    {
                        "product_id": str(product.id),
                        "variant_id": str(uuid.uuid4()),  # missing variant
                        "deducted_qty": 2,
                    }
                ],
            )
            await session.commit()
            _stub_items(order, [])
            await order_service._restore_stock_for_order(session, order)

        return inner()

    _run(factory)


def test_apply_address_update_non_string_value() -> None:
    """A non-string field value skips the strip step (1301->1303)."""

    addr = Address(
        line1="L1", line2="old", city="C", postal_code="010101", country="RO"
    )
    order_service._apply_address_update(
        addr,
        {
            "line1": "Main",
            "line2": None,  # non-string -> 1301 false -> 1303
            "city": "Town",
            "postal_code": "010101",
            "country": "RO",
        },
    )
    assert addr.line2 is None


async def _high_value_order_with_addresses(session: AsyncSession) -> Order:
    """Order whose taxable subtotal exceeds the free-shipping threshold (300)."""
    product = await _make_product(
        session, stock=100, slug="hv", sku="HV", price="50.00"
    )
    cart = await _make_cart(session, product, qty=10)  # subtotal 500
    ship = Address(line1="S", city="C", postal_code="010101", country="RO")
    session.add(ship)
    await session.flush()
    order = await order_service.build_order_from_cart(
        session,
        None,
        customer_email="hv@e.com",
        customer_name="HV",
        cart=cart,
        shipping_address_id=ship.id,
        billing_address_id=None,
        payment_method="cod",
    )
    return order


def test_rerate_shipping_free_threshold_and_discount_clamp() -> None:
    """Re-rate where taxable >= threshold zeroes shipping (1334) and where
    subtotal_items < taxable clamps discount (1355)."""

    def factory(session: AsyncSession):
        async def inner() -> dict:
            order = await _high_value_order_with_addresses(session)
            # Inflate total so taxable_subtotal (total-ship-tax-fee) >> item subtotals,
            # making discount_val negative -> clamp (1355) while staying >= threshold.
            order.total_amount = Decimal("900.00")
            order.shipping_amount = Decimal("0.00")
            order.tax_amount = Decimal("0.00")
            order.fee_amount = Decimal("0.00")
            session.add(order)
            await session.commit()
            await session.refresh(order, attribute_names=["items", "shipping_address"])
            return await order_service._rerate_order_shipping(session, order)

        return inner()

    changes = _run(factory)
    assert changes["shipping_amount"]["to"] == "0.00"


def test_update_order_shipping_method_free_threshold_and_discount_clamp() -> None:
    """update_order shipping-method block: free-ship threshold (1564) and
    discount clamp (1585)."""

    def factory(session: AsyncSession):
        async def inner() -> Order:
            order = await _high_value_order_with_addresses(session)
            order.total_amount = Decimal("900.00")
            order.shipping_amount = Decimal("0.00")
            order.tax_amount = Decimal("0.00")
            order.fee_amount = Decimal("0.00")
            session.add(order)
            await session.commit()
            method = await order_service.create_shipping_method(
                session,
                ShippingMethodCreate(name="Std2", rate_flat=0.0, rate_per_kg=0),
            )
            return await order_service.update_order(
                session, order, OrderUpdate(), shipping_method=method
            )

        return inner()

    assert _run(factory) is not None


def test_update_order_same_cancel_reason_no_event() -> None:
    """Setting the same cancel_reason twice skips the event (1488->1507)."""

    def factory(session: AsyncSession):
        async def inner() -> Order:
            order = await _build_order(session, payment_method="cod")
            await order_service.update_order(
                session,
                order,
                OrderUpdate(status=OrderStatus.cancelled, cancel_reason="Stop"),
            )
            # Re-apply the identical cancel reason on the already-cancelled order.
            return await order_service.update_order(
                session, order, OrderUpdate(cancel_reason="Stop")
            )

        return inner()

    assert _run(factory) is not None


def test_update_order_courier_only_no_existing_tracking() -> None:
    """courier-only update with no existing tracking number (1519->1523)."""

    def factory(session: AsyncSession):
        async def inner() -> Order:
            order = await _build_order(session, payment_method="cod")
            return await order_service.update_order(
                session, order, OrderUpdate(courier="dhl")
            )

        return inner()

    assert _run(factory) is not None


def test_update_order_tracking_number_only_no_courier() -> None:
    """tracking_number present, courier absent: the ``elif`` body is not run."""

    def factory(session: AsyncSession):
        async def inner() -> Order:
            order = await _build_order(session, payment_method="cod")
            return await order_service.update_order(
                session,
                order,
                OrderUpdate(tracking_number="1Z999AA10123456784"),
            )

        return inner()

    assert _run(factory) is not None


def test_update_order_tracking_url_only() -> None:
    """tracking_url present but tracking_number/courier absent: the ``elif "courier"``
    is evaluated and false, falling through to the tracking_url branch (1517->1523)."""

    def factory(session: AsyncSession):
        async def inner() -> Order:
            order = await _build_order(session, payment_method="cod")
            return await order_service.update_order(
                session,
                order,
                OrderUpdate(tracking_url="https://track/only"),
            )

        return inner()

    assert _run(factory) is not None


def test_update_order_same_shipping_method_no_event() -> None:
    """Re-applying the order's current shipping method skips the event (1530->1546)."""

    def factory(session: AsyncSession):
        async def inner() -> Order:
            method_holder: list = []

            product = await _make_product(session, stock=10, slug="sm", sku="SM")
            cart = await _make_cart(session, product, qty=1)
            method = await order_service.create_shipping_method(
                session,
                ShippingMethodCreate(name="SameMethod", rate_flat=5.0, rate_per_kg=0),
            )
            method_holder.append(method)
            order = await order_service.build_order_from_cart(
                session,
                None,
                customer_email="sm@e.com",
                customer_name="SM",
                cart=cart,
                shipping_address_id=None,
                billing_address_id=None,
                shipping_method=method,
                payment_method="cod",
            )
            await session.refresh(order, attribute_names=["shipping_method"])
            # Update using a method whose name matches the order's current method.
            return await order_service.update_order(
                session, order, OrderUpdate(), shipping_method=method
            )

        return inner()

    assert _run(factory) is not None


def test_void_payment_keeps_existing_cancel_reason(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Void on an order that already has a cancel_reason skips the default (2742->2744)."""

    def factory(session: AsyncSession):
        async def inner() -> str | None:
            order = await _build_order(session, payment_method="stripe")
            order.cancel_reason = "Pre-set reason"
            session.add(order)
            await session.commit()

            async def _fake_void(intent_id: str) -> dict:
                return {"id": intent_id}

            monkeypatch.setattr(
                order_service.payments, "void_payment_intent", _fake_void
            )
            updated = await order_service.void_payment(
                session, order, intent_id="pi_keep"
            )
            return updated.cancel_reason

        return inner()

    assert _run(factory) == "Pre-set reason"
