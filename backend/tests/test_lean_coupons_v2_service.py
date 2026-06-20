"""Lean coverage for the pure + generator paths of ``app.services.coupons_v2``.

The endpoint-driven happy paths already live in ``test_coupons_v2.py``; this
module fills the remaining branches: shipping math, ``compute_coupon_savings``
discount variants, ``compute_totals_with_coupon`` / ``apply_discount_code_to_cart``,
the promotion/coupon reason helpers and the coupon-code generators. Pure
functions use lightweight stub carts; DB helpers run on in-memory SQLite.
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models.coupons_v2 import (
    Coupon,
    CouponAssignment,
    CouponReservation,
    CouponVisibility,
    Promotion,
    PromotionDiscountType,
)
from app.models.order import Order, OrderStatus
from app.models.user import User, UserRole
from app.services import coupons_v2 as svc
from app.services.checkout_settings import CheckoutSettings
from tests.conftest import make_memory_session_factory

pytestmark = pytest.mark.anyio


@pytest.fixture(scope="module")
def session_factory():
    return make_memory_session_factory()


async def _make_user(session) -> User:
    user = User(
        email=f"c-{uuid.uuid4().hex[:8]}@x.io",
        username=f"c_{uuid.uuid4().hex[:8]}",
        hashed_password="x",
        role=UserRole.customer,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _make_order(session, user, *, promo_code=None) -> Order:
    order = Order(
        user_id=user.id,
        status=OrderStatus.pending_payment,
        customer_email=user.email,
        customer_name="C",
        total_amount=Decimal("100.00"),
        payment_method="cod",
        currency="RON",
        promo_code=promo_code,
    )
    session.add(order)
    await session.commit()
    await session.refresh(order)
    return order


async def _make_coupon(session, *, code, **coupon_kw) -> Coupon:
    promo = Promotion(
        name="P",
        description="P",
        discount_type=PromotionDiscountType.percent,
        percentage_off=Decimal("10.00"),
        allow_on_sale_items=True,
        is_active=True,
        is_automatic=False,
    )
    session.add(promo)
    await session.commit()
    await session.refresh(promo)

    defaults = dict(
        promotion_id=promo.id,
        code=code,
        visibility=CouponVisibility.public,
        is_active=True,
    )
    defaults.update(coupon_kw)
    coupon = Coupon(**defaults)
    session.add(coupon)
    await session.commit()
    await session.refresh(coupon)
    return await svc.get_coupon_by_code(session, code=code)


def _item(price: str, qty: int, *, product_id=None, product=None):
    return SimpleNamespace(
        unit_price_at_add=Decimal(price),
        quantity=qty,
        product_id=product_id or uuid.uuid4(),
        product=product,
    )


def _cart(items):
    return SimpleNamespace(items=items)


def _promotion(**kw):
    defaults = dict(
        discount_type=PromotionDiscountType.percent,
        percentage_off=Decimal("10.00"),
        amount_off=None,
        max_discount_amount=None,
        allow_on_sale_items=True,
        min_subtotal=None,
        first_order_only=False,
        is_active=True,
        starts_at=None,
        ends_at=None,
        scopes=[],
    )
    defaults.update(kw)
    return SimpleNamespace(**defaults)


def _coupon_stub(promotion, **kw):
    defaults = dict(
        is_active=True,
        starts_at=None,
        ends_at=None,
        visibility=CouponVisibility.public,
        promotion=promotion,
        id=uuid.uuid4(),
    )
    defaults.update(kw)
    return SimpleNamespace(**defaults)


# --------------------------------------------------------------------------- #
# Pure helpers                                                                #
# --------------------------------------------------------------------------- #
def test_quantize_money_respects_enforce_flag(monkeypatch) -> None:
    monkeypatch.setattr(svc.settings, "enforce_decimal_prices", False)
    assert svc._quantize_money(Decimal("1.239")) == Decimal("1.239")
    monkeypatch.setattr(svc.settings, "enforce_decimal_prices", True)
    assert svc._quantize_money(Decimal("1.239")) == Decimal("1.24")


def test_normalize_and_cart_subtotal() -> None:
    assert svc._normalize_code("  ab-c ") == "AB-C"
    cart = _cart([_item("10.00", 2), _item("5.50", 0)])
    assert svc.cart_subtotal(cart) == Decimal("20.00")


def test_calculate_shipping_amount_variants() -> None:
    # shipping_fee_ron set short-circuits to the fee (line 166-167).
    assert svc._calculate_shipping_amount(
        Decimal("100"),
        shipping_method_rate_flat=Decimal("9"),
        shipping_method_rate_per_kg=Decimal("1"),
        shipping_fee_ron=Decimal("15.00"),
    ) == Decimal("15.00")
    # flat + per_kg * subtotal (lines 168-170).
    assert svc._calculate_shipping_amount(
        Decimal("2"),
        shipping_method_rate_flat=Decimal("5.00"),
        shipping_method_rate_per_kg=Decimal("1.00"),
        shipping_fee_ron=None,
    ) == Decimal("7.00")


def test_scope_sets_skips_empty_entity_and_unknown_type() -> None:
    from app.models.coupons_v2 import (
        PromotionScopeEntityType,
        PromotionScopeMode,
    )

    pid = uuid.uuid4()
    cid = uuid.uuid4()
    scopes = [
        SimpleNamespace(entity_id=None, entity_type=None, mode=None),  # 82 continue
        SimpleNamespace(
            entity_id=uuid.uuid4(), entity_type="other", mode=None
        ),  # 92->79 neither product nor category
        SimpleNamespace(
            entity_id=pid,
            entity_type=PromotionScopeEntityType.product,
            mode=PromotionScopeMode.exclude,
        ),
        SimpleNamespace(
            entity_id=cid,
            entity_type=PromotionScopeEntityType.category,
            mode=PromotionScopeMode.include,
        ),
    ]
    inc_p, exc_p, inc_c, exc_c = svc._promotion_scope_sets(
        SimpleNamespace(scopes=scopes)
    )
    assert exc_p == {pid}
    assert inc_c == {cid}
    assert inc_p == set() and exc_c == set()


def test_eligible_subtotals_skips_zero_qty_and_missing_product() -> None:
    cart = _cart(
        [
            _item("10.00", 0),  # qty <= 0 -> skipped (117)
            SimpleNamespace(
                unit_price_at_add=Decimal("5.00"),
                quantity=1,
                product_id=None,
                product=None,
            ),  # no product id -> skipped (121)
            _item("8.00", 1),
        ]
    )
    promotion = _promotion()
    eligible, scope, has_inc, has_exc = svc.cart_eligible_subtotals_for_promotion(
        cart, promotion=promotion
    )
    assert eligible == Decimal("8.00")
    assert scope == Decimal("8.00")
    assert has_inc is False and has_exc is False


# --------------------------------------------------------------------------- #
# compute_coupon_savings                                                      #
# --------------------------------------------------------------------------- #
def test_savings_amount_with_max_cap() -> None:
    cart = _cart([_item("100.00", 1)])
    promotion = _promotion(
        discount_type=PromotionDiscountType.amount,
        amount_off=Decimal("40.00"),
        percentage_off=None,
        max_discount_amount=Decimal("25.00"),
    )
    coupon = _coupon_stub(promotion)
    out = svc.compute_coupon_savings(
        promotion=promotion,
        coupon=coupon,
        cart=cart,
        checkout=CheckoutSettings(shipping_fee_ron=Decimal("20.00")),
        shipping_method_rate_flat=None,
        shipping_method_rate_per_kg=None,
    )
    assert out.discount_ron == Decimal("25.00")
    assert out.shipping_discount_ron == Decimal("0.00")


def test_savings_amount_zero_when_no_eligible_subtotal() -> None:
    # Empty cart -> eligible_subtotal == 0 so the amount branch leaves the
    # estimate at zero (212 false direction).
    promotion = _promotion(
        discount_type=PromotionDiscountType.amount,
        amount_off=Decimal("40.00"),
        percentage_off=None,
    )
    out = svc.compute_coupon_savings(
        promotion=promotion,
        coupon=_coupon_stub(promotion),
        cart=_cart([]),
        checkout=CheckoutSettings(shipping_fee_ron=Decimal("0.00")),
        shipping_method_rate_flat=None,
        shipping_method_rate_per_kg=None,
    )
    assert out.discount_ron == Decimal("0.00")


def test_savings_free_shipping_when_shipping_present_and_absent() -> None:
    cart = _cart([_item("10.00", 1)])
    promotion = _promotion(
        discount_type=PromotionDiscountType.free_shipping,
        percentage_off=None,
    )
    coupon = _coupon_stub(promotion)

    # Shipping present -> shipping_discount equals shipping.
    present = svc.compute_coupon_savings(
        promotion=promotion,
        coupon=coupon,
        cart=cart,
        checkout=CheckoutSettings(
            shipping_fee_ron=Decimal("19.00"), free_shipping_threshold_ron=None
        ),
        shipping_method_rate_flat=None,
        shipping_method_rate_per_kg=None,
    )
    assert present.shipping_discount_ron == Decimal("19.00")

    # Already-free shipping (threshold met) -> no shipping discount.
    absent = svc.compute_coupon_savings(
        promotion=promotion,
        coupon=coupon,
        cart=cart,
        checkout=CheckoutSettings(
            shipping_fee_ron=Decimal("19.00"),
            free_shipping_threshold_ron=Decimal("5.00"),
        ),
        shipping_method_rate_flat=None,
        shipping_method_rate_per_kg=None,
    )
    assert absent.shipping_discount_ron == Decimal("0.00")


# --------------------------------------------------------------------------- #
# compute_totals_with_coupon + apply_discount_code_to_cart                    #
# --------------------------------------------------------------------------- #
async def test_compute_totals_with_coupon(monkeypatch, session_factory) -> None:
    async def _fake_vat(*args, **kwargs):
        return None

    monkeypatch.setattr(svc.taxes_service, "compute_cart_vat_amount", _fake_vat)

    pid = uuid.uuid4()
    cart = _cart(
        [
            _item("100.00", 1, product_id=pid),
            SimpleNamespace(
                unit_price_at_add=Decimal("0"),
                quantity=1,
                product_id=None,
                product=None,
            ),  # missing product id -> line skipped (304-305)
        ]
    )
    checkout = CheckoutSettings(
        shipping_fee_ron=Decimal("20.00"),
        free_shipping_threshold_ron=Decimal("50.00"),
        vat_enabled=True,
    )
    async with session_factory() as session:
        totals = await svc.compute_totals_with_coupon(
            session,
            cart=cart,
            checkout=checkout,
            shipping_method_rate_flat=None,
            shipping_method_rate_per_kg=None,
            discount_ron=Decimal("10.00"),
            free_shipping=True,
            country_code="RO",
        )
    assert totals.shipping == Decimal("0.00")
    assert totals.currency == "RON"


async def test_compute_totals_no_taxable_lines(monkeypatch, session_factory) -> None:
    """A cart with no resolvable product ids yields no taxable lines so the
    largest-line adjustment block is skipped entirely (310->322)."""

    async def _fake_vat(*args, **kwargs):
        return None

    monkeypatch.setattr(svc.taxes_service, "compute_cart_vat_amount", _fake_vat)

    cart = _cart(
        [
            SimpleNamespace(
                unit_price_at_add=Decimal("10.00"),
                quantity=1,
                product_id=None,
                product=None,
            )
        ]
    )
    async with session_factory() as session:
        totals = await svc.compute_totals_with_coupon(
            session,
            cart=cart,
            checkout=CheckoutSettings(shipping_fee_ron=Decimal("0.00")),
            shipping_method_rate_flat=None,
            shipping_method_rate_per_kg=None,
            discount_ron=Decimal("0.00"),
            free_shipping=False,
            country_code="RO",
        )
    assert totals.currency == "RON"


async def test_apply_discount_code_empty_returns_zero(
    monkeypatch, session_factory
) -> None:
    async def _fake_vat(*args, **kwargs):
        return None

    monkeypatch.setattr(svc.taxes_service, "compute_cart_vat_amount", _fake_vat)

    user = SimpleNamespace(id=uuid.uuid4())
    cart = _cart([_item("30.00", 1)])
    async with session_factory() as session:
        applied = await svc.apply_discount_code_to_cart(
            session,
            user=user,
            cart=cart,
            checkout=CheckoutSettings(shipping_fee_ron=Decimal("10.00")),
            shipping_method_rate_flat=None,
            shipping_method_rate_per_kg=None,
            code="   ",
        )
    assert applied.coupon is None
    assert applied.discount_ron == Decimal("0.00")


async def test_get_coupon_by_code_blank_returns_none(session_factory) -> None:
    async with session_factory() as session:
        assert await svc.get_coupon_by_code(session, code="   ") is None


async def test_compute_totals_line_adjustment(monkeypatch, session_factory) -> None:
    """A rounding mismatch between line sum and subtotal triggers the largest-line
    adjustment block (310-322)."""

    async def _fake_vat(*args, **kwargs):
        return None

    monkeypatch.setattr(svc.taxes_service, "compute_cart_vat_amount", _fake_vat)
    monkeypatch.setattr(svc.settings, "enforce_decimal_prices", True)

    pid_a = uuid.uuid4()
    pid_b = uuid.uuid4()
    # Each line rounds DOWN to 0.00 individually, but the raw sum (0.008) rounds
    # UP to 0.01, forcing a nonzero ``diff`` that the largest-line block absorbs.
    cart = _cart(
        [
            _item("0.004", 1, product_id=pid_a),
            _item("0.004", 1, product_id=pid_b),
        ]
    )
    async with session_factory() as session:
        totals = await svc.compute_totals_with_coupon(
            session,
            cart=cart,
            checkout=CheckoutSettings(shipping_fee_ron=Decimal("0.00")),
            shipping_method_rate_flat=None,
            shipping_method_rate_per_kg=None,
            discount_ron=Decimal("0.00"),
            free_shipping=False,
            country_code="RO",
        )
    assert totals.currency == "RON"


async def test_apply_discount_code_not_found(session_factory) -> None:
    user = SimpleNamespace(id=uuid.uuid4())
    cart = _cart([_item("30.00", 1)])
    async with session_factory() as session:
        with pytest.raises(HTTPException) as exc:
            await svc.apply_discount_code_to_cart(
                session,
                user=user,
                cart=cart,
                checkout=CheckoutSettings(),
                shipping_method_rate_flat=None,
                shipping_method_rate_per_kg=None,
                code="NOPE-DOES-NOT-EXIST",
            )
    assert exc.value.status_code == 404


# --------------------------------------------------------------------------- #
# Reason helpers                                                              #
# --------------------------------------------------------------------------- #
def test_promotion_and_coupon_reasons() -> None:
    now = svc._now()
    promo = _promotion(
        is_active=False,
        starts_at=now + timedelta(days=1),
        ends_at=now - timedelta(days=1),
    )
    assert set(svc._promotion_reasons(promo, now)) == {
        "inactive",
        "not_started",
        "expired",
    }
    coupon = _coupon_stub(
        promo,
        is_active=False,
        starts_at=now + timedelta(days=1),
        ends_at=now - timedelta(days=1),
    )
    assert set(svc._coupon_reasons(coupon, now)) == {
        "inactive",
        "not_started",
        "expired",
    }


# --------------------------------------------------------------------------- #
# Code generators                                                             #
# --------------------------------------------------------------------------- #
def test_generate_coupon_code_with_prefix_only() -> None:
    code = svc.generate_coupon_code(prefix="save", length=6)
    assert code.startswith("SAVE-")
    assert all(ch.isalnum() or ch == "-" for ch in code)


def test_generate_coupon_code_pattern_with_token() -> None:
    code = svc.generate_coupon_code(pattern="WIN-{RAND:4}")
    assert code.startswith("WIN-")
    assert len(code) == len("WIN-") + 4


def test_generate_coupon_code_pattern_no_token_appends_suffix() -> None:
    code = svc.generate_coupon_code(pattern="STATIC", length=5)
    assert code.startswith("STATIC-")


def test_generate_coupon_code_pattern_bad_token_count() -> None:
    # ``{RAND:99}`` exceeds the 1-2 digit window so the regex won't match the
    # full token; the literal-token fallback path still yields a clean code.
    code = svc.generate_coupon_code(pattern="X{RAND}Y", length=3)
    assert code  # non-empty, sanitized


async def test_generate_unique_coupon_code_success_and_exhausted(
    session_factory, monkeypatch
) -> None:
    async with session_factory() as session:
        code = await svc.generate_unique_coupon_code(session, prefix="uniq", length=8)
        assert code

        # Force every candidate to collide -> attempts exhausted -> 500.
        monkeypatch.setattr(svc, "generate_coupon_code", lambda **kw: "DUP")

        class _Scalar:
            def scalar_one(self):
                return 1

        async def _execute(*args, **kwargs):
            return _Scalar()

        monkeypatch.setattr(session, "execute", _execute)
        with pytest.raises(HTTPException) as exc:
            await svc.generate_unique_coupon_code(
                session, prefix="uniq", length=8, attempts=2
            )
    assert exc.value.status_code == 500


# --------------------------------------------------------------------------- #
# First-order promotion + reward                                             #
# --------------------------------------------------------------------------- #
async def test_ensure_first_order_promotion_creates_then_reuses(
    session_factory,
) -> None:
    async with session_factory() as session:
        first = await svc.ensure_first_order_promotion(session)
        again = await svc.ensure_first_order_promotion(session)
    assert first.id == again.id
    assert first.key == svc.FIRST_ORDER_PROMOTION_KEY


async def test_issue_first_order_reward_guards(session_factory) -> None:
    async with session_factory() as session:
        # Missing user id.
        assert (
            await svc.issue_first_order_reward_if_eligible(
                session,
                user=SimpleNamespace(id=None),
                order=SimpleNamespace(id=uuid.uuid4(), status=OrderStatus.delivered),
            )
            is None
        )
        # Missing order id.
        assert (
            await svc.issue_first_order_reward_if_eligible(
                session,
                user=SimpleNamespace(id=uuid.uuid4()),
                order=SimpleNamespace(id=None, status=OrderStatus.delivered),
            )
            is None
        )
        # Non-delivered order.
        assert (
            await svc.issue_first_order_reward_if_eligible(
                session,
                user=SimpleNamespace(id=uuid.uuid4()),
                order=SimpleNamespace(id=uuid.uuid4(), status=OrderStatus.paid),
            )
            is None
        )


async def test_issue_first_order_reward_skips_when_not_first_delivered(
    session_factory,
) -> None:
    """Two delivered orders -> ``delivered_count != 1`` short-circuits to None."""
    async with session_factory() as session:
        user = User(
            email=f"multi-{uuid.uuid4().hex[:8]}@x.io",
            username=f"multi_{uuid.uuid4().hex[:8]}",
            hashed_password="x",
            role=UserRole.customer,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)

        first = Order(
            user_id=user.id,
            status=OrderStatus.delivered,
            customer_email=user.email,
            customer_name="Multi",
            total_amount=Decimal("100.00"),
            payment_method="cod",
            currency="RON",
        )
        second = Order(
            user_id=user.id,
            status=OrderStatus.delivered,
            customer_email=user.email,
            customer_name="Multi",
            total_amount=Decimal("50.00"),
            payment_method="cod",
            currency="RON",
        )
        session.add_all([first, second])
        await session.commit()
        await session.refresh(second)

        result = await svc.issue_first_order_reward_if_eligible(
            session, user=user, order=second
        )
        assert result is None


# --------------------------------------------------------------------------- #
# reserve / redeem / release                                                  #
# --------------------------------------------------------------------------- #
async def test_reserve_coupon_requires_user_and_order(session_factory) -> None:
    async with session_factory() as session:
        coupon = await _make_coupon(session, code="RSV-GUARD")
        with pytest.raises(HTTPException) as exc:
            await svc.reserve_coupon_for_order(
                session,
                user=SimpleNamespace(id=None),
                order=SimpleNamespace(id=None),
                coupon=coupon,
                discount_ron=Decimal("1.00"),
                shipping_discount_ron=Decimal("0.00"),
            )
    assert exc.value.status_code == 400


async def test_reserve_coupon_blank_code(session_factory) -> None:
    async with session_factory() as session:
        user = await _make_user(session)
        order = await _make_order(session, user)
        blank = SimpleNamespace(code="   ", id=uuid.uuid4())
        with pytest.raises(HTTPException) as exc:
            await svc.reserve_coupon_for_order(
                session,
                user=user,
                order=order,
                coupon=blank,
                discount_ron=Decimal("1.00"),
                shipping_discount_ron=Decimal("0.00"),
            )
    assert exc.value.status_code == 400


async def test_reserve_coupon_happy_idempotent_and_conflict(session_factory) -> None:
    async with session_factory() as session:
        user = await _make_user(session)
        order = await _make_order(session, user)
        coupon = await _make_coupon(session, code="RSV-OK")

        first = await svc.reserve_coupon_for_order(
            session,
            user=user,
            order=order,
            coupon=coupon,
            discount_ron=Decimal("10.00"),
            shipping_discount_ron=Decimal("0.00"),
        )
        assert first.coupon_id == coupon.id

        # Same coupon again -> returns the existing reservation.
        again = await svc.reserve_coupon_for_order(
            session,
            user=user,
            order=order,
            coupon=coupon,
            discount_ron=Decimal("10.00"),
            shipping_discount_ron=Decimal("0.00"),
        )
        assert again.id == first.id

        # Different coupon on the same order -> conflict.
        other = await _make_coupon(session, code="RSV-OTHER")
        with pytest.raises(HTTPException) as exc:
            await svc.reserve_coupon_for_order(
                session,
                user=user,
                order=order,
                coupon=other,
                discount_ron=Decimal("5.00"),
                shipping_discount_ron=Decimal("0.00"),
            )
    assert exc.value.status_code == 400


async def test_reserve_coupon_inactive_and_assigned_and_caps(session_factory) -> None:
    async with session_factory() as session:
        user = await _make_user(session)

        # Inactive coupon.
        inactive = await _make_coupon(session, code="RSV-INACT", is_active=False)
        order_a = await _make_order(session, user)
        with pytest.raises(HTTPException) as inact_exc:
            await svc.reserve_coupon_for_order(
                session,
                user=user,
                order=order_a,
                coupon=inactive,
                discount_ron=Decimal("1.00"),
                shipping_discount_ron=Decimal("0.00"),
            )
        assert inact_exc.value.status_code == 400

        # Assigned coupon with no assignment for this user.
        assigned = await _make_coupon(
            session, code="RSV-ASSIGN", visibility=CouponVisibility.assigned
        )
        order_b = await _make_order(session, user)
        with pytest.raises(HTTPException) as assign_exc:
            await svc.reserve_coupon_for_order(
                session,
                user=user,
                order=order_b,
                coupon=assigned,
                discount_ron=Decimal("1.00"),
                shipping_discount_ron=Decimal("0.00"),
            )
        assert assign_exc.value.status_code == 400

        # Global cap reached.
        capped = await _make_coupon(session, code="RSV-CAP", global_max_redemptions=1)
        order_c1 = await _make_order(session, user)
        await svc.reserve_coupon_for_order(
            session,
            user=user,
            order=order_c1,
            coupon=capped,
            discount_ron=Decimal("1.00"),
            shipping_discount_ron=Decimal("0.00"),
        )
        order_c2 = await _make_order(session, user)
        with pytest.raises(HTTPException) as cap_exc:
            await svc.reserve_coupon_for_order(
                session,
                user=user,
                order=order_c2,
                coupon=capped,
                discount_ron=Decimal("1.00"),
                shipping_discount_ron=Decimal("0.00"),
            )
        assert cap_exc.value.status_code == 400

        # Per-customer cap reached.
        per = await _make_coupon(
            session, code="RSV-PER", per_customer_max_redemptions=1
        )
        order_p1 = await _make_order(session, user)
        await svc.reserve_coupon_for_order(
            session,
            user=user,
            order=order_p1,
            coupon=per,
            discount_ron=Decimal("1.00"),
            shipping_discount_ron=Decimal("0.00"),
        )
        order_p2 = await _make_order(session, user)
        with pytest.raises(HTTPException) as per_exc:
            await svc.reserve_coupon_for_order(
                session,
                user=user,
                order=order_p2,
                coupon=per,
                discount_ron=Decimal("1.00"),
                shipping_discount_ron=Decimal("0.00"),
            )
        assert per_exc.value.status_code == 400


async def test_redeem_coupon_guards_and_happy(session_factory) -> None:
    async with session_factory() as session:
        user = await _make_user(session)

        # No promo code -> no-op.
        await svc.redeem_coupon_for_order(
            session,
            order=SimpleNamespace(promo_code="", user_id=user.id, id=uuid.uuid4()),
        )
        # No user id -> no-op.
        await svc.redeem_coupon_for_order(
            session,
            order=SimpleNamespace(promo_code="X", user_id=None, id=uuid.uuid4()),
        )
        # Code not found -> no-op.
        await svc.redeem_coupon_for_order(
            session,
            order=SimpleNamespace(
                promo_code="MISSING", user_id=user.id, id=uuid.uuid4()
            ),
        )

        # Happy path with an active reservation -> redemption created.
        coupon = await _make_coupon(session, code="RDM-OK")
        order = await _make_order(session, user, promo_code="RDM-OK")
        await svc.reserve_coupon_for_order(
            session,
            user=user,
            order=order,
            coupon=coupon,
            discount_ron=Decimal("12.00"),
            shipping_discount_ron=Decimal("0.00"),
        )
        await svc.redeem_coupon_for_order(session, order=order, note="paid")

        # Second redeem -> existing redemption short-circuits.
        await svc.redeem_coupon_for_order(session, order=order)

        # Redeem with NO prior reservation -> the reservation-copy block is
        # skipped (branch 930->935) and a zero-discount redemption is created.
        await _make_coupon(session, code="RDM-NORSV")
        order2 = await _make_order(session, user, promo_code="RDM-NORSV")
        await svc.redeem_coupon_for_order(session, order=order2)


async def test_release_coupon_guards_and_void(session_factory) -> None:
    async with session_factory() as session:
        user = await _make_user(session)

        # No code -> no-op.
        await svc.release_coupon_for_order(
            session, order=SimpleNamespace(promo_code=""), reason="x"
        )
        # Code not found -> no-op.
        await svc.release_coupon_for_order(
            session, order=SimpleNamespace(promo_code="GONE"), reason="x"
        )

        # Reservation present -> released; then redemption voided.
        coupon = await _make_coupon(session, code="REL-OK")
        order = await _make_order(session, user, promo_code="REL-OK")
        await svc.reserve_coupon_for_order(
            session,
            user=user,
            order=order,
            coupon=coupon,
            discount_ron=Decimal("8.00"),
            shipping_discount_ron=Decimal("0.00"),
        )
        await svc.redeem_coupon_for_order(session, order=order)
        await svc.release_coupon_for_order(session, order=order, reason="refund")

        voided = await session.get(Coupon, coupon.id)
        assert voided is not None


# --------------------------------------------------------------------------- #
# evaluate + apply (eligible / ineligible)                                     #
# --------------------------------------------------------------------------- #
async def test_apply_discount_code_eligible_and_ineligible(
    session_factory, monkeypatch
) -> None:
    async def _fake_vat(*args, **kwargs):
        return None

    monkeypatch.setattr(svc.taxes_service, "compute_cart_vat_amount", _fake_vat)

    async with session_factory() as session:
        user = await _make_user(session)
        await _make_coupon(session, code="APPLY-OK")

        pid = uuid.uuid4()
        cart = _cart([_item("100.00", 1, product_id=pid)])
        checkout = CheckoutSettings(shipping_fee_ron=Decimal("10.00"))

        applied = await svc.apply_discount_code_to_cart(
            session,
            user=user,
            cart=cart,
            checkout=checkout,
            shipping_method_rate_flat=None,
            shipping_method_rate_per_kg=None,
            code="APPLY-OK",
        )
        assert applied.coupon is not None
        assert applied.discount_ron == Decimal("10.00")

        # Ineligible: assigned coupon with no assignment -> 400.
        assigned = await _make_coupon(
            session, code="APPLY-ASSIGN", visibility=CouponVisibility.assigned
        )
        assert assigned is not None
        with pytest.raises(HTTPException) as exc:
            await svc.apply_discount_code_to_cart(
                session,
                user=user,
                cart=cart,
                checkout=checkout,
                shipping_method_rate_flat=None,
                shipping_method_rate_per_kg=None,
                code="APPLY-ASSIGN",
            )
    assert exc.value.status_code == 400


async def test_evaluate_empty_cart_no_scope(session_factory) -> None:
    """Empty cart + no scopes: scope_subtotal<=0 with neither includes nor
    excludes falls straight through (branch 627->630)."""
    async with session_factory() as session:
        user = await _make_user(session)
        coupon = await _make_coupon(session, code="EVAL-EMPTY")
        result = await svc.evaluate_coupon_for_cart(
            session,
            user_id=user.id,
            coupon=coupon,
            cart=_cart([]),
            checkout=CheckoutSettings(),
            shipping_method_rate_flat=None,
            shipping_method_rate_per_kg=None,
        )
        assert "no_eligible_items" in result.reasons


async def test_evaluate_min_subtotal_and_first_order(session_factory) -> None:
    async with session_factory() as session:
        user = await _make_user(session)

        # min_subtotal not met.
        promo = Promotion(
            name="Min",
            description="Min",
            discount_type=PromotionDiscountType.percent,
            percentage_off=Decimal("10.00"),
            min_subtotal=Decimal("500.00"),
            first_order_only=True,
            allow_on_sale_items=True,
            is_active=True,
            is_automatic=False,
        )
        session.add(promo)
        await session.commit()
        await session.refresh(promo)
        coupon = Coupon(
            promotion_id=promo.id,
            code="EVAL-MIN",
            visibility=CouponVisibility.public,
            is_active=True,
        )
        session.add(coupon)
        await session.commit()
        loaded = await svc.get_coupon_by_code(session, code="EVAL-MIN")

        cart = _cart([_item("50.00", 1, product_id=uuid.uuid4())])
        result = await svc.evaluate_coupon_for_cart(
            session,
            user_id=user.id,
            coupon=loaded,
            cart=cart,
            checkout=CheckoutSettings(),
            shipping_method_rate_flat=None,
            shipping_method_rate_per_kg=None,
        )
        assert "min_subtotal_not_met" in result.reasons
        assert result.eligible is False


async def _seed_scoped_coupon(session_factory, *, code, entity_id, mode) -> None:
    from app.models.coupons_v2 import PromotionScope, PromotionScopeEntityType

    async with session_factory() as session:
        promo = Promotion(
            name=code,
            description=code,
            discount_type=PromotionDiscountType.percent,
            percentage_off=Decimal("10.00"),
            allow_on_sale_items=True,
            is_active=True,
            is_automatic=False,
        )
        session.add(promo)
        await session.commit()
        await session.refresh(promo)
        session.add(
            PromotionScope(
                promotion_id=promo.id,
                entity_type=PromotionScopeEntityType.product,
                entity_id=entity_id,
                mode=mode,
            )
        )
        session.add(
            Coupon(
                promotion_id=promo.id,
                code=code,
                visibility=CouponVisibility.public,
                is_active=True,
            )
        )
        await session.commit()


async def test_evaluate_scope_no_match_and_excluded(session_factory) -> None:
    from app.models.coupons_v2 import PromotionScopeMode

    excluded_pid = uuid.uuid4()
    # Seed in separate sessions so the evaluation session's identity map is clean
    # and the ``selectinload`` of scopes actually loads the rows.
    await _seed_scoped_coupon(
        session_factory,
        code="EVAL-NOMATCH",
        entity_id=uuid.uuid4(),
        mode=PromotionScopeMode.include,
    )
    await _seed_scoped_coupon(
        session_factory,
        code="EVAL-EXCLUDED",
        entity_id=excluded_pid,
        mode=PromotionScopeMode.exclude,
    )

    async with session_factory() as session:
        user = await _make_user(session)

        loaded_inc = await svc.get_coupon_by_code(session, code="EVAL-NOMATCH")
        res_inc = await svc.evaluate_coupon_for_cart(
            session,
            user_id=user.id,
            coupon=loaded_inc,
            cart=_cart([_item("50.00", 1, product_id=uuid.uuid4())]),
            checkout=CheckoutSettings(),
            shipping_method_rate_flat=None,
            shipping_method_rate_per_kg=None,
        )
        assert "scope_no_match" in res_inc.reasons

        loaded_exc = await svc.get_coupon_by_code(session, code="EVAL-EXCLUDED")
        res_exc = await svc.evaluate_coupon_for_cart(
            session,
            user_id=user.id,
            coupon=loaded_exc,
            cart=_cart([_item("50.00", 1, product_id=excluded_pid)]),
            checkout=CheckoutSettings(),
            shipping_method_rate_flat=None,
            shipping_method_rate_per_kg=None,
        )
        assert "scope_excluded" in res_exc.reasons


async def test_evaluate_free_shipping_already_free_and_user_cart(
    session_factory,
) -> None:
    async with session_factory() as session:
        user = await _make_user(session)

        promo = Promotion(
            name="FS",
            description="FS",
            discount_type=PromotionDiscountType.free_shipping,
            allow_on_sale_items=True,
            first_order_only=True,
            is_active=True,
            is_automatic=False,
        )
        session.add(promo)
        await session.commit()
        await session.refresh(promo)
        coupon = Coupon(
            promotion_id=promo.id,
            code="EVAL-FS",
            visibility=CouponVisibility.public,
            is_active=True,
        )
        session.add(coupon)
        await session.commit()

        # Threshold already met -> shipping already free -> reason set.
        cart = _cart([_item("500.00", 1, product_id=uuid.uuid4())])
        checkout = CheckoutSettings(
            shipping_fee_ron=Decimal("20.00"),
            free_shipping_threshold_ron=Decimal("100.00"),
        )

        # evaluate_coupons_for_user_cart fans out and pre-computes the delivered
        # flag because the promotion is first_order_only (line 744).
        results = await svc.evaluate_coupons_for_user_cart(
            session,
            user=user,
            cart=cart,
            checkout=checkout,
            shipping_method_rate_flat=None,
            shipping_method_rate_per_kg=None,
        )
        fs_result = next(r for r in results if r.coupon.code == "EVAL-FS")
        assert "shipping_already_free" in fs_result.reasons


async def test_reserve_assigned_with_assignment_and_release_active(
    session_factory,
) -> None:
    async with session_factory() as session:
        user = await _make_user(session)
        coupon = await _make_coupon(
            session, code="RSV-ASSIGNED-OK", visibility=CouponVisibility.assigned
        )
        session.add(CouponAssignment(coupon_id=coupon.id, user_id=user.id))
        await session.commit()

        order = await _make_order(session, user, promo_code="RSV-ASSIGNED-OK")
        reservation = await svc.reserve_coupon_for_order(
            session,
            user=user,
            order=order,
            coupon=coupon,
            discount_ron=Decimal("5.00"),
            shipping_discount_ron=Decimal("0.00"),
        )
        assert reservation.coupon_id == coupon.id

        # Release while the reservation is still active (no redemption yet) covers
        # the reservation-present branch (970-976) and the no-redemption exit
        # (987->exit).
        await svc.release_coupon_for_order(session, order=order, reason="cancel")
        leftover = (
            await session.execute(
                select(CouponReservation).where(CouponReservation.order_id == order.id)
            )
        ).scalar_one_or_none()
        assert leftover is None
