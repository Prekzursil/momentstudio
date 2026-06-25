"""Final-pass coverage completion (worker 1) for ``app.services.cart``.

Targets the service-layer branches not exercised by ``test_service_cart.py`` /
``test_cart_api.py`` / ``test_w5_cart.py`` / ``test_cart_decimal.py``:

* log sanitizers (``_sanitize_log_text`` / ``_sanitize_log_value`` / ``_log_cart``)
* ``_get_or_create_cart`` IntegrityError race recovery (both arcs)
* ``_validate_stock`` backorder skip + insufficient-stock raise
* ``delivery_constraints`` locker + courier intersection branches
* ``calculate_totals`` (sync wrapper) and the async line-rounding adjustment
* ``serialize_cart`` totals_override currency-injection branch
* ``add_item`` not-found / invalid-variant / variant-price / max-quantity arcs
* ``update_item`` / ``delete_item`` not-found arcs
* ``sync_cart`` round-trip, ``merge_guest_cart`` edge arcs
* ``cleanup_stale_guest_carts`` / ``create_promo`` / ``validate_promo`` errors
* ``run_abandoned_cart_job`` and ``reorder_from_order``
"""

import asyncio
from decimal import Decimal
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.cart import Cart, CartItem
from app.models.catalog import (
    Category,
    Product,
    ProductImage,
    ProductStatus,
    ProductVariant,
)
from app.models.order import Order, OrderItem, OrderStatus, ShippingMethod
from app.models.promo import PromoCode
from app.models.user import User
from app.schemas.cart import CartItemCreate, CartItemUpdate, Totals
from app.schemas.cart_sync import CartSyncItem
from app.schemas.promo import PromoCodeCreate, PromoCodeRead
from app.services import cart as cart_service


def _make_factory() -> async_sessionmaker:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def _init() -> None:
        import app.models  # noqa: F401

        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_init())
    return factory


def _new_product(
    *,
    slug: str = "p1",
    sku: str = "SKU-P1",
    stock: int = 5,
    base_price: str = "10.00",
    status: ProductStatus = ProductStatus.published,
    is_active: bool = True,
    allow_backorder: bool = False,
    sale_price: str | None = None,
    sale_active: bool = False,
    allow_locker: bool = True,
    disallowed_couriers: list[str] | None = None,
    with_image: bool = True,
) -> Product:
    category = Category(slug=f"cat-{slug}", name=f"Cat {slug}")
    kwargs: dict = dict(
        category=category,
        slug=slug,
        sku=sku,
        name=f"Product {slug}",
        base_price=Decimal(base_price),
        currency="RON",
        stock_quantity=stock,
        status=status,
        is_active=is_active,
        allow_backorder=allow_backorder,
        shipping_allow_locker=allow_locker,
        shipping_disallowed_couriers=disallowed_couriers or [],
    )
    if sale_price is not None:
        kwargs["sale_price"] = Decimal(sale_price)
        if sale_active:
            now = datetime.now(timezone.utc)
            kwargs["sale_start_at"] = now - timedelta(days=1)
            kwargs["sale_end_at"] = now + timedelta(days=1)
    if with_image:
        kwargs["images"] = [
            ProductImage(url=f"/media/{slug}.png", alt_text=slug, sort_order=0)
        ]
    return Product(**kwargs)


_USER_SEQ = [0]


def _new_user(email: str, *, name: str = "U", notify_marketing: bool = False) -> User:
    _USER_SEQ[0] += 1
    return User(
        email=email,
        username=f"user{_USER_SEQ[0]}",
        hashed_password="x",
        name=name,
        notify_marketing=notify_marketing,
    )


def _promo_read(**kwargs) -> PromoCodeRead:
    base: dict = dict(
        id=uuid4(),
        code="CODE",
        times_used=0,
        active=True,
        created_at=datetime.now(timezone.utc),
    )
    base.update(kwargs)
    return PromoCodeRead(**base)


# --------------------------------------------------------------------------- #
# Log sanitizers
# --------------------------------------------------------------------------- #
def test_sanitize_log_text_none_and_truncation_and_newlines():
    assert cart_service._sanitize_log_text(None) is None
    cleaned = cart_service._sanitize_log_text("a\r\nb")
    assert cleaned == "a\\r\\nb"
    long = cart_service._sanitize_log_text("x" * 300, max_len=10)
    assert long is not None and long.endswith("…") and len(long) == 11


def test_sanitize_log_value_all_branches():
    out = cart_service._sanitize_log_value(
        {
            "k\ney": ["a", 1, True, None, {"nested": "v"}, 3.5, object()],
            "plain": "string",
            "num": 7,
        }
    )
    assert isinstance(out, dict)
    # dict key sanitized (newline escaped)
    assert "k\\ney" in out
    inner = out["k\\ney"]
    assert isinstance(inner, list)
    assert inner[0] == "a"
    assert inner[1] == 1
    assert inner[2] is True
    assert inner[3] is None
    assert inner[4] == {"nested": "v"}
    assert inner[5] == 3.5
    # object() falls through to str-sanitize branch
    assert isinstance(inner[6], str)
    assert out["plain"] == "string"
    assert out["num"] == 7


def test_sanitize_log_value_list_cap():
    out = cart_service._sanitize_log_value(list(range(100)))
    assert isinstance(out, list)
    assert len(out) == 50


def test_sanitize_log_value_empty_string_and_dict_key_fallback():
    # empty string -> "" via the `or ""` fallback
    assert cart_service._sanitize_log_value("") == ""
    # dict key that sanitizes to empty -> "key" fallback
    out = cart_service._sanitize_log_value({"": "v"})
    assert "key" in out


def test_log_cart_with_and_without_ids(caplog):
    cart = Cart(user_id=None, session_id="sid")
    cart.id = uuid4()
    cart_service._log_cart("evt", cart, user_id=uuid4())
    # cart without id attribute path
    bare = Cart(user_id=None)
    bare.id = None
    cart_service._log_cart("evt2", bare)


# --------------------------------------------------------------------------- #
# _validate_stock
# --------------------------------------------------------------------------- #
def test_validate_stock_backorder_skips():
    product = _new_product(allow_backorder=True, stock=0, with_image=False)
    asyncio.run(cart_service._validate_stock(product, None, 999))


def test_validate_stock_insufficient_raises():
    product = _new_product(stock=1, with_image=False)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(cart_service._validate_stock(product, None, 5))
    assert exc.value.status_code == 400


def test_validate_stock_uses_variant_stock():
    product = _new_product(stock=100, with_image=False)
    variant = ProductVariant(product=product, name="V", stock_quantity=2)
    with pytest.raises(HTTPException):
        asyncio.run(cart_service._validate_stock(product, variant, 3))


# --------------------------------------------------------------------------- #
# _enforce_max_quantity / _get_first_image
# --------------------------------------------------------------------------- #
def test_enforce_max_quantity_branches():
    cart_service._enforce_max_quantity(5, None)  # limit None -> skip
    cart_service._enforce_max_quantity(2, 5)  # under limit -> ok
    with pytest.raises(HTTPException):
        cart_service._enforce_max_quantity(6, 5)


def test_get_first_image_none_and_empty_and_sorted():
    assert cart_service._get_first_image(None) is None
    p_no = _new_product(with_image=False)
    p_no.images = []
    assert cart_service._get_first_image(p_no) is None
    p = _new_product(with_image=False)
    p.images = [
        ProductImage(url="/b.png", sort_order=2),
        ProductImage(url="/a.png", sort_order=1),
    ]
    assert cart_service._get_first_image(p) == "/a.png"


# --------------------------------------------------------------------------- #
# delivery_constraints
# --------------------------------------------------------------------------- #
def test_delivery_constraints_default_all_allowed():
    cart = Cart(user_id=None)
    locker, couriers = cart_service.delivery_constraints(cart)
    assert locker is True
    assert couriers == sorted(cart_service.SUPPORTED_COURIERS)


def test_delivery_constraints_locker_blocked_and_courier_intersection():
    p1 = _new_product(
        slug="dc1", sku="DC1", allow_locker=False, disallowed_couriers=["sameday"]
    )
    p2 = _new_product(slug="dc2", sku="DC2", disallowed_couriers="fan_courier")
    cart = Cart(user_id=None)
    cart.items = [
        CartItem(product=p1, product_id=p1.id, quantity=1, unit_price_at_add=1),
        CartItem(product=p2, product_id=p2.id, quantity=1, unit_price_at_add=1),
    ]
    locker, couriers = cart_service.delivery_constraints(cart)
    assert locker is False
    assert couriers == []


def test_delivery_constraints_duplicate_courier_already_removed():
    # Two products both disallowing the SAME courier exercises the
    # `if code in allowed_couriers` False arc (198->196) on the second pass.
    p1 = _new_product(slug="dup1", sku="DUP1", disallowed_couriers=["sameday"])
    p2 = _new_product(slug="dup2", sku="DUP2", disallowed_couriers=["sameday"])
    cart = Cart(user_id=None)
    cart.items = [
        CartItem(product=p1, product_id=p1.id, quantity=1, unit_price_at_add=1),
        CartItem(product=p2, product_id=p2.id, quantity=1, unit_price_at_add=1),
    ]
    _, couriers = cart_service.delivery_constraints(cart)
    assert "sameday" not in couriers
    assert "fan_courier" in couriers


def test_delivery_constraints_skips_items_without_product():
    cart = Cart(user_id=None)
    item = CartItem(product=None, quantity=1, unit_price_at_add=1)
    cart.items = [item]
    locker, couriers = cart_service.delivery_constraints(cart)
    assert locker is True


# --------------------------------------------------------------------------- #
# _calculate_shipping_amount / _to_decimal / _compute_discount
# --------------------------------------------------------------------------- #
def test_calculate_shipping_amount_branches():
    assert cart_service._calculate_shipping_amount(
        Decimal("0"), None, shipping_fee_ron=Decimal("9")
    ) == Decimal("9")
    assert cart_service._calculate_shipping_amount(Decimal("5"), None) == Decimal("0")
    method = ShippingMethod(
        name="Std", rate_flat=Decimal("5"), rate_per_kg=Decimal("2")
    )
    assert cart_service._calculate_shipping_amount(Decimal("3"), method) == Decimal(
        "11"
    )


def test_to_decimal_decimal_passthrough():
    out = cart_service._to_decimal(Decimal("3.005"))
    assert isinstance(out, Decimal)


def test_to_decimal_enforce_disabled(monkeypatch):
    # enforce_decimal_prices False -> skip str-cast and quantize (224->226 arc)
    monkeypatch.setattr(cart_service.settings, "enforce_decimal_prices", False)
    out = cart_service._to_decimal(3)
    assert out == Decimal("3")


def test_compute_discount_branches():
    assert cart_service._compute_discount(Decimal("10"), None) == Decimal("0")
    promo_amt = _promo_read(code="AAA", amount_off=Decimal("3"))
    assert cart_service._compute_discount(Decimal("10"), promo_amt) == Decimal("3")
    promo_pct = _promo_read(code="PPP", percentage_off=Decimal("10"))
    assert cart_service._compute_discount(Decimal("100"), promo_pct) == Decimal("10")
    promo_none = _promo_read(code="NNN")
    assert cart_service._compute_discount(Decimal("10"), promo_none) == Decimal("0")
    # discount capped at subtotal
    promo_big = _promo_read(code="BBB", amount_off=Decimal("999"))
    assert cart_service._compute_discount(Decimal("10"), promo_big) == Decimal("10")


# --------------------------------------------------------------------------- #
# calculate_totals (sync) + free-shipping threshold
# --------------------------------------------------------------------------- #
def test_calculate_totals_sync_and_free_shipping_threshold():
    factory = _make_factory()

    async def _run():
        async with factory() as session:
            product = _new_product(base_price="50.00")
            cart = Cart(user_id=None)
            session.add_all([product, cart])
            await session.commit()
            await session.refresh(cart)
            await cart_service.add_item(
                session, cart, CartItemCreate(product_id=product.id, quantity=2)
            )
            await session.refresh(cart, attribute_names=["items"])
            totals, discount = cart_service.calculate_totals(
                cart,
                shipping_fee_ron=Decimal("15"),
                free_shipping_threshold_ron=Decimal("50"),
            )
            # subtotal 100 >= 50 -> shipping waived
            assert totals.shipping == Decimal("0.00")
            assert discount == Decimal("0")

    asyncio.run(_run())


# --------------------------------------------------------------------------- #
# calculate_totals_async line-rounding adjustment
# --------------------------------------------------------------------------- #
def test_calculate_totals_async_line_adjustment_and_skip_no_product_id():
    factory = _make_factory()

    async def _run():
        async with factory() as session:
            p1 = _new_product(slug="ta1", sku="TA1", base_price="3.33")
            p2 = _new_product(slug="ta2", sku="TA2", base_price="3.33")
            cart = Cart(user_id=None)
            session.add_all([p1, p2, cart])
            await session.commit()
            await session.refresh(cart)
            await cart_service.add_item(
                session, cart, CartItemCreate(product_id=p1.id, quantity=1)
            )
            await cart_service.add_item(
                session, cart, CartItemCreate(product_id=p2.id, quantity=1)
            )
            await session.refresh(cart, attribute_names=["items"])
            totals, _ = await cart_service.calculate_totals_async(session, cart)
            assert totals.total > Decimal("0")

    asyncio.run(_run())


def test_calculate_totals_async_free_shipping_threshold_waiver():
    factory = _make_factory()

    async def _run():
        async with factory() as session:
            product = _new_product(base_price="60.00")
            cart = Cart(user_id=None)
            session.add_all([product, cart])
            await session.commit()
            await session.refresh(cart)
            await cart_service.add_item(
                session, cart, CartItemCreate(product_id=product.id, quantity=2)
            )
            await session.refresh(cart, attribute_names=["items"])
            totals, _ = await cart_service.calculate_totals_async(
                session,
                cart,
                shipping_fee_ron=Decimal("20"),
                free_shipping_threshold_ron=Decimal("50"),
            )
            # subtotal 120 >= 50 -> shipping waived (369 arc)
            assert totals.shipping == Decimal("0.00")

    asyncio.run(_run())


def test_calculate_totals_async_line_rounding_residue_adjustment(monkeypatch):
    # With per-cent enforcement OFF, sub-cent unit prices make the per-line
    # rounded subtotals sum differently from the quantized cart subtotal,
    # exercising the residue-redistribution block (401-405).
    monkeypatch.setattr(cart_service.settings, "enforce_decimal_prices", False)
    factory = _make_factory()

    async def _run():
        async with factory() as session:
            p1 = _new_product(slug="rr1", sku="RR1", base_price="1.00")
            p2 = _new_product(slug="rr2", sku="RR2", base_price="1.00")
            session.add_all([p1, p2])
            await session.commit()
            # Build a detached cart whose items carry sub-cent unit prices
            # (a DB Numeric(10,2) column would truncate these). This drives the
            # per-line vs whole-cart rounding residue so the redistribution
            # block (401-405) executes.
            cart = Cart(user_id=None)
            cart.items = [
                CartItem(
                    product_id=p1.id,
                    quantity=1,
                    unit_price_at_add=Decimal("0.006"),
                ),
                CartItem(
                    product_id=p2.id,
                    quantity=1,
                    unit_price_at_add=Decimal("0.006"),
                ),
            ]
            totals, _ = await cart_service.calculate_totals_async(session, cart)
            # whole-cart subtotal 0.012 -> 0.01; each line 0.006 -> 0.01,
            # sum 0.02; residue -0.01 redistributed onto the largest line.
            assert totals.subtotal == Decimal("0.01")

    asyncio.run(_run())


def test_calculate_totals_async_residue_clamps_negative_line(monkeypatch):
    # A large negative residue (many lines each rounding UP while the whole-cart
    # subtotal rounds far down) drives the redistributed line below zero, so the
    # clamp-to-zero guard (404) executes.
    monkeypatch.setattr(cart_service.settings, "enforce_decimal_prices", False)
    factory = _make_factory()

    async def _run():
        async with factory() as session:
            products = []
            for n in range(5):
                p = _new_product(slug=f"nz{n}", sku=f"NZ{n}", base_price="1.00")
                products.append(p)
            session.add_all(products)
            await session.commit()
            cart = Cart(user_id=None)
            cart.items = [
                CartItem(
                    product_id=p.id,
                    quantity=1,
                    unit_price_at_add=Decimal("0.006"),
                )
                for p in products
            ]
            totals, _ = await cart_service.calculate_totals_async(session, cart)
            # whole-cart 0.030 -> 0.03; lines 5 x 0.01 = 0.05; residue -0.02
            # exceeds the 0.01 largest line, so it is clamped to 0.00.
            assert totals.subtotal == Decimal("0.03")

    asyncio.run(_run())


def test_calculate_totals_async_item_without_product_id_skipped():
    factory = _make_factory()

    async def _run():
        async with factory() as session:
            cart = Cart(user_id=None)
            session.add(cart)
            await session.commit()
            await session.refresh(cart)
            # detached item carrying no product_id exercises the `continue` arc
            cart.items = [
                CartItem(quantity=1, unit_price_at_add=Decimal("5.00"), product_id=None)
            ]
            totals, _ = await cart_service.calculate_totals_async(session, cart)
            assert totals.subtotal == Decimal("5.00")

    asyncio.run(_run())


# --------------------------------------------------------------------------- #
# serialize_cart override branches
# --------------------------------------------------------------------------- #
def test_serialize_cart_totals_override_injects_currency():
    factory = _make_factory()

    async def _run():
        async with factory() as session:
            product = _new_product()
            cart = Cart(user_id=None)
            session.add_all([product, cart])
            await session.commit()
            await session.refresh(cart)
            await cart_service.add_item(
                session, cart, CartItemCreate(product_id=product.id, quantity=1)
            )
            override = Totals(
                subtotal=Decimal("10.00"),
                fee=Decimal("0.00"),
                tax=Decimal("0.00"),
                shipping=Decimal("0.00"),
                total=Decimal("10.00"),
                currency=None,
            )
            read = await cart_service.serialize_cart(
                session, cart, totals_override=override
            )
            assert read.totals is not None
            assert read.totals.currency == "RON"
            # the non-currency fields must survive the currency injection
            assert read.totals.total == Decimal("10.00")
            assert read.totals.subtotal == Decimal("10.00")

    asyncio.run(_run())


def test_serialize_cart_empty_currency_fallback():
    factory = _make_factory()

    async def _run():
        async with factory() as session:
            cart = Cart(user_id=None)
            session.add(cart)
            await session.commit()
            await session.refresh(cart)
            read = await cart_service.serialize_cart(session, cart)
            assert read.totals is not None
            assert read.totals.currency == "RON"

    asyncio.run(_run())


# --------------------------------------------------------------------------- #
# add_item arcs
# --------------------------------------------------------------------------- #
def test_add_item_product_not_found():
    factory = _make_factory()

    async def _run():
        async with factory() as session:
            cart = Cart(user_id=None)
            session.add(cart)
            await session.commit()
            await session.refresh(cart)
            with pytest.raises(HTTPException) as exc:
                await cart_service.add_item(
                    session, cart, CartItemCreate(product_id=uuid4(), quantity=1)
                )
            assert exc.value.status_code == 404

    asyncio.run(_run())


def test_add_item_unpublished_product_404():
    factory = _make_factory()

    async def _run():
        async with factory() as session:
            product = _new_product(status=ProductStatus.draft)
            cart = Cart(user_id=None)
            session.add_all([product, cart])
            await session.commit()
            await session.refresh(cart)
            with pytest.raises(HTTPException) as exc:
                await cart_service.add_item(
                    session, cart, CartItemCreate(product_id=product.id, quantity=1)
                )
            assert exc.value.status_code == 404

    asyncio.run(_run())


def test_add_item_invalid_variant():
    factory = _make_factory()

    async def _run():
        async with factory() as session:
            product = _new_product()
            other = _new_product(slug="ov", sku="OV")
            variant = ProductVariant(product=other, name="V", stock_quantity=5)
            cart = Cart(user_id=None)
            session.add_all([product, other, variant, cart])
            await session.commit()
            await session.refresh(cart)
            with pytest.raises(HTTPException) as exc:
                await cart_service.add_item(
                    session,
                    cart,
                    CartItemCreate(
                        product_id=product.id, variant_id=variant.id, quantity=1
                    ),
                )
            assert exc.value.status_code == 400

    asyncio.run(_run())


def test_add_item_with_variant_price_delta_and_sale_price():
    factory = _make_factory()

    async def _run():
        async with factory() as session:
            product = _new_product(
                base_price="20.00", sale_price="15.00", sale_active=True
            )
            variant = ProductVariant(
                product=product,
                name="Big",
                stock_quantity=10,
                additional_price_delta=Decimal("5.00"),
            )
            cart = Cart(user_id=None)
            session.add_all([product, variant, cart])
            await session.commit()
            await session.refresh(cart)
            item = await cart_service.add_item(
                session,
                cart,
                CartItemCreate(
                    product_id=product.id, variant_id=variant.id, quantity=1
                ),
            )
            # sale price 15 + variant delta 5 = 20
            assert Decimal(item.unit_price_at_add) == Decimal("20.00")

    asyncio.run(_run())


def test_add_item_max_quantity_enforced_from_stock():
    factory = _make_factory()

    async def _run():
        async with factory() as session:
            product = _new_product(stock=10)
            cart = Cart(user_id=None)
            session.add_all([product, cart])
            await session.commit()
            await session.refresh(cart)
            with pytest.raises(HTTPException) as exc:
                await cart_service.add_item(
                    session,
                    cart,
                    CartItemCreate(product_id=product.id, quantity=3, max_quantity=2),
                )
            assert exc.value.status_code == 400

    asyncio.run(_run())


def test_add_item_commit_false_uses_flush():
    factory = _make_factory()

    async def _run():
        async with factory() as session:
            product = _new_product()
            cart = Cart(user_id=None)
            session.add_all([product, cart])
            await session.commit()
            await session.refresh(cart)
            item = await cart_service.add_item(
                session,
                cart,
                CartItemCreate(product_id=product.id, quantity=1),
                commit=False,
            )
            assert item.id is not None

    asyncio.run(_run())


# --------------------------------------------------------------------------- #
# update_item / delete_item
# --------------------------------------------------------------------------- #
def test_update_item_not_found():
    factory = _make_factory()

    async def _run():
        async with factory() as session:
            cart = Cart(user_id=None)
            session.add(cart)
            await session.commit()
            await session.refresh(cart)
            with pytest.raises(HTTPException) as exc:
                await cart_service.update_item(
                    session, cart, uuid4(), CartItemUpdate(quantity=1)
                )
            assert exc.value.status_code == 404

    asyncio.run(_run())


def test_update_item_product_missing_after_item():
    factory = _make_factory()

    async def _run():
        async with factory() as session:
            product = _new_product()
            cart = Cart(user_id=None)
            session.add_all([product, cart])
            await session.commit()
            await session.refresh(cart)
            item = await cart_service.add_item(
                session, cart, CartItemCreate(product_id=product.id, quantity=1)
            )
            # remove product so the lookup in update_item fails
            await session.delete(await session.get(Product, product.id))
            await session.commit()
            with pytest.raises(HTTPException) as exc:
                await cart_service.update_item(
                    session, cart, item.id, CartItemUpdate(quantity=1)
                )
            assert exc.value.status_code == 404

    asyncio.run(_run())


def test_update_item_success_and_with_variant():
    factory = _make_factory()

    async def _run():
        async with factory() as session:
            product = _new_product(stock=20)
            variant = ProductVariant(product=product, name="V", stock_quantity=20)
            cart = Cart(user_id=None)
            session.add_all([product, variant, cart])
            await session.commit()
            await session.refresh(cart)
            item = await cart_service.add_item(
                session,
                cart,
                CartItemCreate(
                    product_id=product.id, variant_id=variant.id, quantity=1
                ),
            )
            updated = await cart_service.update_item(
                session, cart, item.id, CartItemUpdate(quantity=3)
            )
            assert updated.quantity == 3

    asyncio.run(_run())


def test_delete_item_not_found_and_success():
    factory = _make_factory()

    async def _run():
        async with factory() as session:
            product = _new_product()
            cart = Cart(user_id=None)
            session.add_all([product, cart])
            await session.commit()
            await session.refresh(cart)
            with pytest.raises(HTTPException) as exc:
                await cart_service.delete_item(session, cart, uuid4())
            assert exc.value.status_code == 404
            item = await cart_service.add_item(
                session, cart, CartItemCreate(product_id=product.id, quantity=1)
            )
            await cart_service.delete_item(session, cart, item.id)

    asyncio.run(_run())


# --------------------------------------------------------------------------- #
# sync_cart
# --------------------------------------------------------------------------- #
def test_sync_cart_replaces_items():
    factory = _make_factory()

    async def _run():
        async with factory() as session:
            product = _new_product(stock=20)
            cart = Cart(user_id=None)
            session.add_all([product, cart])
            await session.commit()
            await session.refresh(cart)
            await cart_service.add_item(
                session, cart, CartItemCreate(product_id=product.id, quantity=1)
            )
            await session.refresh(cart, attribute_names=["items"])
            await cart_service.sync_cart(
                session,
                cart,
                [CartSyncItem(product_id=product.id, quantity=4)],
            )
            await session.refresh(cart, attribute_names=["items"])
            assert len(cart.items) == 1
            assert cart.items[0].quantity == 4

    asyncio.run(_run())


# --------------------------------------------------------------------------- #
# merge_guest_cart
# --------------------------------------------------------------------------- #
def test_merge_guest_cart_no_session_id_returns_user_cart():
    factory = _make_factory()

    async def _run():
        async with factory() as session:
            user = _new_user("m1@example.com", name="M1")
            session.add(user)
            await session.commit()
            user_cart = await cart_service._get_or_create_cart(session, user.id, None)
            result = await cart_service.merge_guest_cart(session, user_cart, None)
            assert result.id == user_cart.id

    asyncio.run(_run())


def test_merge_guest_cart_same_cart_short_circuits():
    factory = _make_factory()

    async def _run():
        async with factory() as session:
            cart = await cart_service._get_or_create_cart(session, None, "shared-sid")
            result = await cart_service.merge_guest_cart(session, cart, "shared-sid")
            assert result.id == cart.id

    asyncio.run(_run())


def test_merge_guest_cart_merges_matching_and_new_and_skips_missing_product():
    factory = _make_factory()

    async def _run():
        async with factory() as session:
            user = _new_user("m2@example.com", name="M2")
            shared = _new_product(slug="ms", sku="MS", stock=50)
            only_guest = _new_product(slug="mg", sku="MG", stock=50)
            session.add_all([user, shared, only_guest])
            await session.commit()

            user_cart = await cart_service._get_or_create_cart(session, user.id, None)
            await cart_service.add_item(
                session, user_cart, CartItemCreate(product_id=shared.id, quantity=1)
            )

            guest_cart = await cart_service._get_or_create_cart(
                session, None, "guest-sid-merge"
            )
            await cart_service.add_item(
                session, guest_cart, CartItemCreate(product_id=shared.id, quantity=2)
            )
            await cart_service.add_item(
                session,
                guest_cart,
                CartItemCreate(product_id=only_guest.id, quantity=1),
            )
            # a guest item pointing at a now-missing product is skipped
            guest_cart.items.append(
                CartItem(
                    product_id=uuid4(),
                    quantity=1,
                    unit_price_at_add=Decimal("1.00"),
                )
            )
            session.add(guest_cart)
            await session.commit()

            await session.refresh(user_cart, attribute_names=["items"])
            await session.refresh(guest_cart, attribute_names=["items"])
            merged = await cart_service.merge_guest_cart(
                session, user_cart, "guest-sid-merge"
            )
            await session.refresh(merged, attribute_names=["items"])
            by_product = {i.product_id: i for i in merged.items}
            assert by_product[shared.id].quantity == 3
            assert only_guest.id in by_product

    asyncio.run(_run())


# --------------------------------------------------------------------------- #
# _get_or_create_cart race recovery
# --------------------------------------------------------------------------- #
def test_get_or_create_cart_race_recovery(monkeypatch):
    """Initial lookup misses, commit collides, recovery lookup finds the winner.

    Simulates a concurrent insert: the first ``_load_by_session_id`` (line 116)
    returns ``None`` so the create path runs; ``session.commit`` raises
    ``IntegrityError`` (the row was inserted by a racing request); then the
    recovery ``_load_by_session_id`` (line 128) returns that winning row.
    """
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def _run():
        import app.models  # noqa: F401

        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        winner_id_box: dict = {}

        async with factory() as session:
            original_commit = session.commit
            state = {"raised": False}

            async def _boom():
                if not state["raised"]:
                    state["raised"] = True
                    # A racing request wins the insert on a *separate* session
                    # sharing the same engine, so it survives this session's
                    # rollback and is visible to the recovery SELECT.
                    async with factory() as racer:
                        winner = Cart(user_id=None, session_id="race-sid")
                        racer.add(winner)
                        await racer.commit()
                        await racer.refresh(winner)
                        winner_id_box["id"] = winner.id
                    raise IntegrityError("dup", None, Exception("dup"))
                return await original_commit()

            monkeypatch.setattr(session, "commit", _boom)
            recovered = await cart_service._get_or_create_cart(
                session, None, "race-sid"
            )
            assert recovered.id == winner_id_box["id"]

    asyncio.run(_run())


def test_get_or_create_cart_integrity_error_reraised_without_session(monkeypatch):
    factory = _make_factory()

    async def _run():
        async with factory() as session:

            async def _boom():
                raise IntegrityError("dup", None, Exception("dup"))

            monkeypatch.setattr(session, "commit", _boom)
            with pytest.raises(IntegrityError):
                await cart_service._get_or_create_cart(session, None, None)

    asyncio.run(_run())


def test_get_or_create_cart_integrity_error_recovery_misses_reraises(monkeypatch):
    # session_id is set, but no concurrent row exists, so the recovery lookup
    # returns None and the IntegrityError is re-raised (129->132 arc).
    factory = _make_factory()

    async def _run():
        async with factory() as session:

            async def _boom():
                raise IntegrityError("dup", None, Exception("dup"))

            monkeypatch.setattr(session, "commit", _boom)
            with pytest.raises(IntegrityError):
                await cart_service._get_or_create_cart(session, None, "ghost-sid")

    asyncio.run(_run())


def test_get_or_create_cart_returns_existing_user_cart():
    factory = _make_factory()

    async def _run():
        async with factory() as session:
            user = _new_user("u-exist@example.com", name="U")
            session.add(user)
            await session.commit()
            first = await cart_service._get_or_create_cart(session, user.id, None)
            second = await cart_service._get_or_create_cart(session, user.id, None)
            assert first.id == second.id

    asyncio.run(_run())


def test_get_cart_wrapper():
    factory = _make_factory()

    async def _run():
        async with factory() as session:
            cart = await cart_service.get_cart(session, None, "wrap-sid")
            assert cart.session_id == "wrap-sid"

    asyncio.run(_run())


# --------------------------------------------------------------------------- #
# cleanup_stale_guest_carts
# --------------------------------------------------------------------------- #
def test_cleanup_stale_guest_carts_deletes_old():
    factory = _make_factory()

    async def _run():
        async with factory() as session:
            stale = Cart(user_id=None, session_id="stale")
            session.add(stale)
            await session.commit()
            stale.updated_at = datetime.now(timezone.utc) - timedelta(hours=200)
            session.add(stale)
            await session.commit()
            deleted = await cart_service.cleanup_stale_guest_carts(
                session, max_age_hours=72
            )
            assert deleted == 1

    asyncio.run(_run())


def test_cleanup_stale_guest_carts_none():
    factory = _make_factory()

    async def _run():
        async with factory() as session:
            deleted = await cart_service.cleanup_stale_guest_carts(session)
            assert deleted == 0

    asyncio.run(_run())


# --------------------------------------------------------------------------- #
# create_promo / validate_promo
# --------------------------------------------------------------------------- #
def test_create_promo_success_and_duplicate_and_both_values():
    factory = _make_factory()

    async def _run():
        async with factory() as session:
            promo = await cart_service.create_promo(
                session, PromoCodeCreate(code="save10", percentage_off=Decimal("10"))
            )
            assert promo.code == "SAVE10"
            with pytest.raises(HTTPException) as dup:
                await cart_service.create_promo(
                    session, PromoCodeCreate(code="save10", amount_off=Decimal("1"))
                )
            assert dup.value.status_code == 400
            with pytest.raises(HTTPException) as both:
                await cart_service.create_promo(
                    session,
                    PromoCodeCreate(
                        code="both",
                        percentage_off=Decimal("5"),
                        amount_off=Decimal("5"),
                    ),
                )
            assert both.value.status_code == 400

    asyncio.run(_run())


def test_validate_promo_not_found():
    factory = _make_factory()

    async def _run():
        async with factory() as session:
            with pytest.raises(HTTPException) as exc:
                await cart_service.validate_promo(session, "missing")
            assert exc.value.status_code == 404

    asyncio.run(_run())


def test_validate_promo_expired_max_uses_currency_and_success():
    factory = _make_factory()

    async def _run():
        async with factory() as session:
            expired = PromoCode(
                code="EXP",
                amount_off=Decimal("1"),
                active=True,
                expires_at=datetime.now(timezone.utc) - timedelta(days=1),
            )
            maxed = PromoCode(
                code="MAX",
                amount_off=Decimal("1"),
                active=True,
                max_uses=1,
                times_used=1,
            )
            curr = PromoCode(
                code="CUR", amount_off=Decimal("1"), active=True, currency="USD"
            )
            ok = PromoCode(code="OKAY", amount_off=Decimal("1"), active=True)
            session.add_all([expired, maxed, curr, ok])
            await session.commit()

            with pytest.raises(HTTPException) as e1:
                await cart_service.validate_promo(session, "exp")
            assert e1.value.status_code == 400
            with pytest.raises(HTTPException) as e2:
                await cart_service.validate_promo(session, "max")
            assert e2.value.status_code == 400
            with pytest.raises(HTTPException) as e3:
                await cart_service.validate_promo(session, "cur", currency="RON")
            assert e3.value.status_code == 400
            valid = await cart_service.validate_promo(session, "okay", currency="RON")
            assert valid.code == "OKAY"

    asyncio.run(_run())


# --------------------------------------------------------------------------- #
# reserve_stock_for_checkout / record_cart_event
# --------------------------------------------------------------------------- #
def test_reserve_stock_and_record_event():
    factory = _make_factory()

    async def _run():
        async with factory() as session:
            cart = Cart(user_id=None)
            assert await cart_service.reserve_stock_for_checkout(session, cart) is True

    asyncio.run(_run())
    cart_service.record_cart_event("evt", {"x": 1})
    cart_service.record_cart_event("evt")


# --------------------------------------------------------------------------- #
# run_abandoned_cart_job
# --------------------------------------------------------------------------- #
def test_run_abandoned_cart_job_sends_for_opted_in_user(monkeypatch):
    factory = _make_factory()
    sent_to: list[str] = []

    async def _fake_send(email):
        sent_to.append(email)

    monkeypatch.setattr(cart_service.email_service, "send_cart_abandonment", _fake_send)

    async def _run():
        async with factory() as session:
            opted_in = _new_user("opt@example.com", name="Opt", notify_marketing=True)
            opted_out = _new_user(
                "noopt@example.com", name="NoOpt", notify_marketing=False
            )
            empty_user = _new_user("empty@example.com", name="Empty")
            product = _new_product(stock=50)
            session.add_all([opted_in, opted_out, empty_user, product])
            await session.commit()

            for user in (opted_in, opted_out):
                cart = await cart_service._get_or_create_cart(session, user.id, None)
                await cart_service.add_item(
                    session, cart, CartItemCreate(product_id=product.id, quantity=1)
                )
                cart.updated_at = datetime.now(timezone.utc) - timedelta(hours=48)
                session.add(cart)
            # A stale user cart with NO items exercises the False arc of
            # `if cart.items and cart.user_id` (830->829, skip to next).
            empty_cart = await cart_service._get_or_create_cart(
                session, empty_user.id, None
            )
            empty_cart.updated_at = datetime.now(timezone.utc) - timedelta(hours=48)
            session.add(empty_cart)
            await session.commit()

            sent = await cart_service.run_abandoned_cart_job(session, max_age_hours=24)
            assert sent == 1
            assert sent_to == ["opt@example.com"]

    asyncio.run(_run())


# --------------------------------------------------------------------------- #
# reorder_from_order
# --------------------------------------------------------------------------- #
def test_reorder_from_order_not_found():
    factory = _make_factory()

    async def _run():
        async with factory() as session:
            user = _new_user("ro1@example.com", name="RO1")
            session.add(user)
            await session.commit()
            with pytest.raises(HTTPException) as exc:
                await cart_service.reorder_from_order(session, user.id, uuid4())
            assert exc.value.status_code == 404

    asyncio.run(_run())


def test_reorder_from_order_replaces_cart_items():
    factory = _make_factory()

    async def _run():
        async with factory() as session:
            user = _new_user("ro2@example.com", name="RO2")
            product = _new_product(stock=50)
            other = _new_product(slug="rop", sku="ROP", stock=50)
            session.add_all([user, product, other])
            await session.commit()

            # existing cart with an item that should be cleared
            cart = await cart_service._get_or_create_cart(session, user.id, None)
            await cart_service.add_item(
                session, cart, CartItemCreate(product_id=other.id, quantity=1)
            )

            order = Order(
                user_id=user.id,
                customer_email=user.email,
                customer_name=user.name,
                total_amount=Decimal("20.00"),
                status=OrderStatus.paid,
            )
            order.items = [
                OrderItem(
                    product_id=product.id,
                    quantity=2,
                    unit_price=Decimal("10.00"),
                    subtotal=Decimal("20.00"),
                ),
            ]
            session.add(order)
            await session.commit()
            await session.refresh(order)

            result = await cart_service.reorder_from_order(session, user.id, order.id)
            await session.refresh(result, attribute_names=["items"])
            assert len(result.items) == 1
            assert result.items[0].product_id == product.id
            assert result.items[0].quantity == 2

    asyncio.run(_run())
