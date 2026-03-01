from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
import uuid

from fastapi import HTTPException
import pytest

from app.api.v1 import coupons as coupons_api
from app.models.coupons import (
    CouponBulkJobAction,
    CouponBulkJobStatus,
    CouponVisibility,
    PromotionDiscountType,
    PromotionScope,
    PromotionScopeEntityType,
    PromotionScopeMode,
)
from app.schemas.cart import Totals
from app.services import coupons as coupons_service


class _Scalars:
    def __init__(self, rows: list[object]) -> None:
        self._rows = rows

    def all(self) -> list[object]:
        return list(self._rows)

    def first(self) -> object | None:
        return self._rows[0] if self._rows else None


class _Result:
    def __init__(self, *, scalar: object | None = None, scalars: list[object] | None = None) -> None:
        self._scalar = scalar
        self._scalars = scalars or []

    def scalar_one(self) -> object | None:
        return self._scalar

    def scalar_one_or_none(self) -> object | None:
        return self._scalar

    def scalars(self) -> _Scalars:
        return _Scalars(self._scalars)


class _SessionStub:
    def __init__(self, *results: _Result, users: dict[uuid.UUID, object] | None = None) -> None:
        self._results = list(results)
        self._users = users or {}
        self.added: list[object] = []
        self.execute_calls = 0

    async def execute(self, _stmt: object) -> _Result:
        await asyncio.sleep(0)
        self.execute_calls += 1
        if not self._results:
            raise AssertionError("Unexpected execute() call without queued result")
        return self._results.pop(0)

    async def get(self, _model: object, key: uuid.UUID) -> object | None:
        await asyncio.sleep(0)
        return self._users.get(key)

    def add(self, value: object) -> None:
        self.added.append(value)


def _checkout(*, shipping_fee: Decimal = Decimal("12.00"), threshold: Decimal | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        money_rounding="half_up",
        shipping_fee_ron=shipping_fee,
        free_shipping_threshold_ron=threshold,
        fee_enabled=False,
        fee_type="flat",
        fee_value=Decimal("0.00"),
        vat_enabled=False,
        vat_rate_percent=Decimal("19.00"),
        vat_apply_to_shipping=False,
        vat_apply_to_fee=False,
    )


def _promotion_with_scopes(scopes: list[object]) -> SimpleNamespace:
    now = datetime.now(timezone.utc)
    return SimpleNamespace(
        id=uuid.uuid4(),
        key="PROMO",
        name="Promo",
        description="Promo description",
        discount_type=PromotionDiscountType.percent,
        percentage_off=Decimal("10.00"),
        amount_off=None,
        max_discount_amount=None,
        min_subtotal=None,
        included_product_ids=[],
        excluded_product_ids=[],
        included_category_ids=[],
        excluded_category_ids=[],
        allow_on_sale_items=True,
        first_order_only=False,
        is_active=True,
        starts_at=None,
        ends_at=None,
        is_automatic=False,
        created_at=now,
        updated_at=now,
        scopes=scopes,
    )


def _coupon_for_promotion(promotion: SimpleNamespace) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        promotion_id=promotion.id,
        code="SAVE10",
        starts_at=None,
        ends_at=None,
        visibility=CouponVisibility.public,
        is_active=True,
        global_max_redemptions=None,
        per_customer_max_redemptions=None,
        created_at=promotion.created_at,
        promotion=promotion,
    )


@pytest.mark.anyio
async def test_coupon_api_shipping_method_and_key_validation_helpers() -> None:
    shipping_method_id = uuid.uuid4()
    shipping_method = SimpleNamespace(id=shipping_method_id)
    assert await coupons_api._get_shipping_method(_SessionStub(users={shipping_method_id: shipping_method}), None) is None
    assert (
        await coupons_api._get_shipping_method(
            _SessionStub(users={shipping_method_id: shipping_method}),
            shipping_method_id,
        )
        is shipping_method
    )
    with pytest.raises(HTTPException, match="Shipping method not found"):
        await coupons_api._get_shipping_method(_SessionStub(users={}), shipping_method_id)

    assert await coupons_api._clean_and_validate_promotion_key(_SessionStub(_Result(scalars=[])), raw_key="  ") is None
    cleaned = await coupons_api._clean_and_validate_promotion_key(
        _SessionStub(_Result(scalars=[])),
        raw_key="x" * 120,
    )
    assert cleaned == "x" * 80

    existing = SimpleNamespace(id=uuid.uuid4(), key="PROMO")
    with pytest.raises(HTTPException, match="Promotion key already exists"):
        await coupons_api._clean_and_validate_promotion_key(
            _SessionStub(_Result(scalars=[existing])),
            raw_key="PROMO",
        )
    assert (
        await coupons_api._clean_and_validate_promotion_key(
            _SessionStub(_Result(scalars=[])),
            raw_key="PROMO",
            promotion_id=existing.id,
        )
        == "PROMO"
    )


def test_coupon_api_scalar_update_rate_and_partition_helpers() -> None:
    promo = SimpleNamespace(
        name="Old name",
        description="Old description",
        discount_type=PromotionDiscountType.percent,
        percentage_off=Decimal("5.00"),
        amount_off=None,
        max_discount_amount=None,
        min_subtotal=None,
        allow_on_sale_items=False,
        first_order_only=False,
        is_active=True,
        starts_at=None,
        ends_at=None,
        is_automatic=False,
    )
    coupons_api._apply_promotion_scalar_updates(
        promo,
        {
            "name": "New name",
            "description": "New description",
            "percentage_off": Decimal("12.50"),
            "is_active": False,
        },
    )
    assert promo.name == "New name"
    assert promo.description == "New description"
    assert promo.percentage_off == Decimal("12.50")
    assert promo.is_active is False

    assert coupons_api._shipping_method_rates(None) == (None, None)
    assert coupons_api._shipping_method_rates(SimpleNamespace(rate_flat="7.50", rate_per_kg="1.25")) == (
        Decimal("7.50"),
        Decimal("1.25"),
    )

    promotion = _promotion_with_scopes([])
    coupon = _coupon_for_promotion(promotion)
    eligible_result = SimpleNamespace(
        coupon=coupon,
        estimated_discount_ron=Decimal("3.00"),
        estimated_shipping_discount_ron=Decimal("0.00"),
        eligible=True,
        reasons=["ok"],
        global_remaining=5,
        customer_remaining=1,
    )
    ineligible_result = SimpleNamespace(
        coupon=coupon,
        estimated_discount_ron=Decimal("0.00"),
        estimated_shipping_discount_ron=Decimal("0.00"),
        eligible=False,
        reasons=["inactive"],
        global_remaining=5,
        customer_remaining=1,
    )
    eligible, ineligible = coupons_api._partition_coupon_offers([eligible_result, ineligible_result])
    assert len(eligible) == 1
    assert len(ineligible) == 1
    assert eligible[0].eligible is True
    assert ineligible[0].eligible is False


def test_coupon_api_helper_normalization_and_bucket_parsing() -> None:
    assert coupons_api._sanitize_coupon_prefix(" hello---*promo_2026 ") == "HELLOPROMO2026"
    assert coupons_api._sanitize_coupon_prefix("x" * 200) == "X" * 20

    assert coupons_api._to_decimal(None) == Decimal("0.00")
    assert coupons_api._to_decimal("19.95") == Decimal("19.95")
    assert coupons_api._to_decimal(object()) == Decimal("0.00")

    emails, invalid = coupons_api._normalize_bulk_emails(
        ["USER@Example.com", "user@example.com", "bad", "also@bad", "ok@site.ro", 123]  # type: ignore[list-item]
    )
    assert emails == ["user@example.com", "ok@site.ro"]
    assert invalid == ["bad", "also@bad"]

    assert coupons_api._parse_bucket_config(bucket_total=None, bucket_index=None, bucket_seed=None) is None
    bucket = coupons_api._parse_bucket_config(bucket_total=5, bucket_index=2, bucket_seed=" segment-seed ")
    assert bucket is not None
    assert bucket.total == 5
    assert bucket.index == 2
    assert bucket.seed == "segment-seed"

    with pytest.raises(ValueError, match="requires bucket_total"):
        coupons_api._parse_bucket_config(bucket_total=4, bucket_index=None, bucket_seed="seed")
    with pytest.raises(ValueError, match="between 2 and 100"):
        coupons_api._parse_bucket_config(bucket_total=1, bucket_index=0, bucket_seed="seed")
    with pytest.raises(ValueError, match="within bucket_total range"):
        coupons_api._parse_bucket_config(bucket_total=3, bucket_index=3, bucket_seed="seed")

    user_id = uuid.uuid4()
    idx_a = coupons_api._bucket_index_for_user(user_id=user_id, seed="seed", total=7)
    idx_b = coupons_api._bucket_index_for_user(user_id=user_id, seed="seed", total=7)
    assert idx_a == idx_b
    assert 0 <= idx_a < 7


def test_coupon_api_scope_conversion_and_offer_mapping() -> None:
    product_in = uuid.uuid4()
    product_out = uuid.uuid4()
    category_in = uuid.uuid4()
    category_out = uuid.uuid4()
    promotion = _promotion_with_scopes(
        [
            SimpleNamespace(entity_type=PromotionScopeEntityType.product, mode=PromotionScopeMode.include, entity_id=product_in),
            SimpleNamespace(entity_type=PromotionScopeEntityType.product, mode=PromotionScopeMode.exclude, entity_id=product_out),
            SimpleNamespace(entity_type=PromotionScopeEntityType.category, mode=PromotionScopeMode.include, entity_id=category_in),
            SimpleNamespace(entity_type=PromotionScopeEntityType.category, mode=PromotionScopeMode.exclude, entity_id=category_out),
        ]
    )

    include_p, exclude_p, include_c, exclude_c = coupons_api._scopes_from_promotion(promotion)
    assert include_p == {product_in}
    assert exclude_p == {product_out}
    assert include_c == {category_in}
    assert exclude_c == {category_out}

    promotion_read = coupons_api._to_promotion_read(promotion)
    assert promotion_read.included_product_ids == [product_in]
    assert promotion_read.excluded_product_ids == [product_out]
    assert promotion_read.included_category_ids == [category_in]
    assert promotion_read.excluded_category_ids == [category_out]

    coupon = _coupon_for_promotion(promotion)
    result = SimpleNamespace(
        coupon=coupon,
        estimated_discount_ron=Decimal("7.00"),
        estimated_shipping_discount_ron=Decimal("0.00"),
        eligible=True,
        reasons=["ok"],
        global_remaining=10,
        customer_remaining=2,
    )
    offer = coupons_api._to_offer(result)
    assert offer.coupon.code == "SAVE10"
    assert offer.coupon.promotion is not None
    assert offer.estimated_discount_ron == Decimal("7.00")
    assert offer.reasons == ["ok"]


def test_coupon_api_segment_filters_include_optional_clauses() -> None:
    default_filters = coupons_api._segment_user_filters(
        SimpleNamespace(require_marketing_opt_in=False, send_email=False, require_email_verified=False)
    )
    strict_filters = coupons_api._segment_user_filters(
        SimpleNamespace(require_marketing_opt_in=False, send_email=True, require_email_verified=True)
    )

    assert len(default_filters) == 1
    assert len(strict_filters) == 3


@pytest.mark.anyio
async def test_coupon_api_replace_scopes_overlap_and_success(monkeypatch: pytest.MonkeyPatch) -> None:
    promo_id = uuid.uuid4()
    overlap = uuid.uuid4()

    with pytest.raises(HTTPException, match="Products cannot be both included and excluded"):
        await coupons_api._replace_promotion_scopes(
            _SessionStub(_Result()),
            promotion_id=promo_id,
            include_product_ids={overlap},
            exclude_product_ids={overlap},
            include_category_ids=set(),
            exclude_category_ids=set(),
        )

    validated: dict[str, set[uuid.UUID]] = {}

    async def _validate(_session: object, *, product_ids: set[uuid.UUID], category_ids: set[uuid.UUID]) -> None:
        await asyncio.sleep(0)
        validated["products"] = set(product_ids)
        validated["categories"] = set(category_ids)

    monkeypatch.setattr(coupons_api, "_validate_scope_ids", _validate)

    in_product = uuid.uuid4()
    out_product = uuid.uuid4()
    in_category = uuid.uuid4()
    out_category = uuid.uuid4()
    session = _SessionStub(_Result())
    await coupons_api._replace_promotion_scopes(
        session,
        promotion_id=promo_id,
        include_product_ids={in_product},
        exclude_product_ids={out_product},
        include_category_ids={in_category},
        exclude_category_ids={out_category},
    )

    assert validated["products"] == {in_product, out_product}
    assert validated["categories"] == {in_category, out_category}
    assert session.execute_calls == 1
    assert len(session.added) == 4
    assert all(isinstance(scope, PromotionScope) for scope in session.added)


@pytest.mark.anyio
async def test_coupon_api_find_user_by_id_email_and_errors() -> None:
    user_id = uuid.uuid4()
    user = SimpleNamespace(id=user_id, email="user@example.com")

    session_by_id = _SessionStub(users={user_id: user})
    assert await coupons_api._find_user(session_by_id, user_id=user_id, email=None) is user

    session_by_email = _SessionStub(_Result(scalars=[user]))
    assert await coupons_api._find_user(session_by_email, user_id=None, email="USER@EXAMPLE.COM") is user

    with pytest.raises(HTTPException, match="Provide user_id or email"):
        await coupons_api._find_user(_SessionStub(), user_id=None, email=None)

    with pytest.raises(HTTPException, match="User not found"):
        await coupons_api._find_user(_SessionStub(users={}), user_id=uuid.uuid4(), email=None)

    with pytest.raises(HTTPException, match="User not found"):
        await coupons_api._find_user(_SessionStub(_Result(scalars=[])), user_id=None, email="missing@example.com")


def test_coupon_service_scope_subtotals_and_reason_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    included_id = uuid.uuid4()
    excluded_id = uuid.uuid4()
    category = uuid.uuid4()
    promotion = SimpleNamespace(
        scopes=[
            SimpleNamespace(entity_id=included_id, entity_type=PromotionScopeEntityType.product, mode=PromotionScopeMode.include),
            SimpleNamespace(entity_id=excluded_id, entity_type=PromotionScopeEntityType.product, mode=PromotionScopeMode.exclude),
        ],
        allow_on_sale_items=False,
        discount_type=PromotionDiscountType.percent,
        percentage_off=Decimal("10.00"),
        amount_off=None,
        max_discount_amount=None,
        min_subtotal=None,
        is_active=False,
        starts_at=datetime.now(timezone.utc).replace(year=2099),
        ends_at=datetime.now(timezone.utc).replace(year=2000),
    )

    item_match = SimpleNamespace(
        product_id=included_id,
        product=SimpleNamespace(id=included_id, category_id=category),
        unit_price_at_add=Decimal("25.00"),
        quantity=2,
    )
    item_blocked = SimpleNamespace(
        product_id=excluded_id,
        product=SimpleNamespace(id=excluded_id, category_id=category),
        unit_price_at_add=Decimal("10.00"),
        quantity=1,
    )
    cart = SimpleNamespace(items=[item_match, item_blocked])

    monkeypatch.setattr(coupons_service, "is_sale_active", lambda _product: True)
    eligible, scoped, has_includes, has_excludes = coupons_service.cart_eligible_subtotals_for_promotion(
        cart,
        promotion=promotion,
    )
    assert eligible == Decimal("0.00")
    assert scoped == Decimal("50.00")
    assert has_includes is True
    assert has_excludes is True

    promotion.allow_on_sale_items = True
    eligible2, _, _, _ = coupons_service.cart_eligible_subtotals_for_promotion(cart, promotion=promotion)
    assert eligible2 == Decimal("50.00")

    now = datetime.now(timezone.utc)
    promotion_reasons = coupons_service._promotion_reasons(promotion, now)
    coupon_reasons = coupons_service._coupon_reasons(
        SimpleNamespace(
            is_active=False,
            starts_at=now.replace(year=2099),
            ends_at=now.replace(year=2000),
        ),
        now,
    )
    assert set(promotion_reasons) == {"inactive", "not_started", "expired"}
    assert set(coupon_reasons) == {"inactive", "not_started", "expired"}


def test_coupon_service_code_generation_and_savings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(coupons_service.secrets, "choice", lambda _alphabet: "Q")
    assert coupons_service.generate_coupon_code(prefix="vip", length=4).startswith("VIP-QQQQ")
    assert coupons_service.generate_coupon_code(pattern="SUMMER", length=3).startswith("SUMMER-")
    assert coupons_service.generate_coupon_code(pattern="VIP-{RAND:3}") == "VIP-QQQ"

    cart = SimpleNamespace(
        items=[SimpleNamespace(unit_price_at_add=Decimal("100.00"), quantity=1, product_id=uuid.uuid4(), product=None)]
    )
    coupon = SimpleNamespace()
    checkout = _checkout(shipping_fee=Decimal("15.00"), threshold=None)
    free_shipping_promo = SimpleNamespace(
        discount_type=PromotionDiscountType.free_shipping,
        percentage_off=None,
        amount_off=None,
        max_discount_amount=None,
        allow_on_sale_items=True,
        scopes=[],
        min_subtotal=None,
    )
    savings = coupons_service.compute_coupon_savings(
        promotion=free_shipping_promo,
        coupon=coupon,
        cart=cart,
        checkout=checkout,
        shipping_method_rate_flat=None,
        shipping_method_rate_per_kg=None,
    )
    assert savings.discount_ron == Decimal("0.00")
    assert savings.shipping_discount_ron == Decimal("15.00")


@pytest.mark.anyio
async def test_coupon_service_generate_unique_coupon_code_retries_and_failures(monkeypatch: pytest.MonkeyPatch) -> None:
    generated = iter(["TAKEN1", "TAKEN2", "FREE1"])
    monkeypatch.setattr(coupons_service, "generate_coupon_code", lambda **_kwargs: next(generated))

    session = _SessionStub(_Result(scalar=1), _Result(scalar=1), _Result(scalar=0))
    code = await coupons_service.generate_unique_coupon_code(session, prefix="promo", attempts=3)
    assert code == "FREE1"

    monkeypatch.setattr(coupons_service, "generate_coupon_code", lambda **_kwargs: "ALWAYS-TAKEN")
    with pytest.raises(HTTPException, match="Failed to generate coupon code"):
        await coupons_service.generate_unique_coupon_code(
            _SessionStub(_Result(scalar=1), _Result(scalar=1)),
            prefix="promo",
            attempts=2,
        )


@pytest.mark.anyio
async def test_coupon_service_evaluate_coupons_reuses_first_order_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    user = SimpleNamespace(id=uuid.uuid4())
    cart = SimpleNamespace(items=[])
    checkout = _checkout()
    first_order_coupon = SimpleNamespace(promotion=SimpleNamespace(first_order_only=True))
    regular_coupon = SimpleNamespace(promotion=SimpleNamespace(first_order_only=False))

    async def _visible_coupons(_session: object, *, user_id: uuid.UUID) -> list[object]:
        await asyncio.sleep(0)
        assert user_id == user.id
        return [first_order_coupon, regular_coupon]

    monkeypatch.setattr(coupons_service, "get_user_visible_coupons", _visible_coupons)
    delivered_calls = {"count": 0}

    async def _delivered(_session: object, *, user_id: uuid.UUID) -> bool:
        await asyncio.sleep(0)
        assert user_id == user.id
        delivered_calls["count"] += 1
        return True

    captured_flags: list[bool | None] = []

    async def _evaluate(
        _session: object,
        *,
        user_id: uuid.UUID,
        coupon: object,
        cart: object,
        checkout: object,
        shipping_method_rate_flat: Decimal | None,
        shipping_method_rate_per_kg: Decimal | None,
        user_has_delivered_orders: bool | None = None,
    ) -> object:
        await asyncio.sleep(0)
        assert user_id == user.id
        assert cart is not None and checkout is not None
        captured_flags.append(user_has_delivered_orders)
        return SimpleNamespace(coupon=coupon, eligible=True)

    monkeypatch.setattr(coupons_service, "_user_has_delivered_orders", _delivered)
    monkeypatch.setattr(coupons_service, "evaluate_coupon_for_cart", _evaluate)

    results = await coupons_service.evaluate_coupons_for_user_cart(
        _SessionStub(),
        user=user,
        cart=cart,
        checkout=checkout,
        shipping_method_rate_flat=None,
        shipping_method_rate_per_kg=None,
    )
    assert len(results) == 2
    assert delivered_calls["count"] == 1
    assert captured_flags == [True, True]


@pytest.mark.anyio
async def test_coupon_service_apply_discount_code_to_cart_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    user = SimpleNamespace(id=uuid.uuid4())
    cart = SimpleNamespace(items=[])
    checkout = _checkout()
    totals = Totals(
        subtotal=Decimal("100.00"),
        fee=Decimal("0.00"),
        tax=Decimal("0.00"),
        shipping=Decimal("10.00"),
        total=Decimal("110.00"),
        currency="RON",
    )

    async def _totals(*_args: object, **_kwargs: object) -> Totals:
        await asyncio.sleep(0)
        return totals

    monkeypatch.setattr(coupons_service, "compute_totals_with_coupon", _totals)

    no_code = await coupons_service.apply_discount_code_to_cart(
        _SessionStub(),
        user=user,
        cart=cart,
        checkout=checkout,
        shipping_method_rate_flat=None,
        shipping_method_rate_per_kg=None,
        code="",
    )
    assert no_code.coupon is None
    assert no_code.discount_ron == Decimal("0.00")
    assert no_code.totals.total == Decimal("110.00")

    async def _missing_coupon(_session: object, *, code: str) -> None:
        await asyncio.sleep(0)
        assert code == "MISSING"
        return None

    monkeypatch.setattr(coupons_service, "get_coupon_by_code", _missing_coupon)
    with pytest.raises(HTTPException, match="Coupon not found"):
        await coupons_service.apply_discount_code_to_cart(
            _SessionStub(),
            user=user,
            cart=cart,
            checkout=checkout,
            shipping_method_rate_flat=None,
            shipping_method_rate_per_kg=None,
            code="missing",
        )

    coupon = SimpleNamespace(promotion=SimpleNamespace(discount_type=PromotionDiscountType.percent), code="SAVE10")
    async def _coupon_lookup(_session: object, *, code: str) -> object | None:
        await asyncio.sleep(0)
        return coupon if code == "SAVE10" else None

    async def _ineligible(*_args: object, **_kwargs: object) -> object:
        await asyncio.sleep(0)
        return SimpleNamespace(eligible=False)

    monkeypatch.setattr(coupons_service, "get_coupon_by_code", _coupon_lookup)
    monkeypatch.setattr(coupons_service, "evaluate_coupon_for_cart", _ineligible)
    with pytest.raises(HTTPException, match="Coupon is not eligible"):
        await coupons_service.apply_discount_code_to_cart(
            _SessionStub(),
            user=user,
            cart=cart,
            checkout=checkout,
            shipping_method_rate_flat=None,
            shipping_method_rate_per_kg=None,
            code="SAVE10",
        )

    async def _eligible(*_args: object, **_kwargs: object) -> object:
        await asyncio.sleep(0)
        return SimpleNamespace(
            eligible=True,
            estimated_discount_ron=Decimal("7.00"),
            estimated_shipping_discount_ron=Decimal("0.00"),
        )

    monkeypatch.setattr(coupons_service, "evaluate_coupon_for_cart", _eligible)
    applied = await coupons_service.apply_discount_code_to_cart(
        _SessionStub(),
        user=user,
        cart=cart,
        checkout=checkout,
        shipping_method_rate_flat=None,
        shipping_method_rate_per_kg=None,
        code="SAVE10",
    )
    assert applied.coupon is coupon
    assert applied.discount_ron == Decimal("7.00")
    assert applied.shipping_discount_ron == Decimal("0.00")


def test_coupon_api_discount_issue_and_context_helpers() -> None:
    coupons_api._validate_promotion_discount_values(
        discount_type=PromotionDiscountType.percent,
        percentage_off=Decimal("10"),
        amount_off=None,
    )
    coupons_api._validate_promotion_discount_values(
        discount_type=PromotionDiscountType.amount,
        percentage_off=None,
        amount_off=Decimal("15"),
    )
    coupons_api._validate_promotion_discount_values(
        discount_type=PromotionDiscountType.free_shipping,
        percentage_off=None,
        amount_off=None,
    )

    with pytest.raises(HTTPException, match="percentage_off is required"):
        coupons_api._validate_promotion_discount_values(
            discount_type=PromotionDiscountType.percent,
            percentage_off=None,
            amount_off=None,
        )
    with pytest.raises(HTTPException, match="amount_off is required"):
        coupons_api._validate_promotion_discount_values(
            discount_type=PromotionDiscountType.amount,
            percentage_off=None,
            amount_off=None,
        )
    with pytest.raises(HTTPException, match="cannot set percentage_off/amount_off"):
        coupons_api._validate_promotion_discount_values(
            discount_type=PromotionDiscountType.free_shipping,
            percentage_off=Decimal("5"),
            amount_off=None,
        )
    with pytest.raises(HTTPException, match="Choose percentage_off or amount_off"):
        coupons_api._validate_promotion_discount_values(
            discount_type=PromotionDiscountType.percent,
            percentage_off=Decimal("5"),
            amount_off=Decimal("2"),
        )

    existing_product = uuid.uuid4()
    existing_category = uuid.uuid4()
    promo = _promotion_with_scopes(
        [
            SimpleNamespace(entity_type=PromotionScopeEntityType.product, mode=PromotionScopeMode.include, entity_id=existing_product),
            SimpleNamespace(entity_type=PromotionScopeEntityType.category, mode=PromotionScopeMode.exclude, entity_id=existing_category),
        ]
    )
    assert coupons_api._resolve_scope_updates(promo=promo, data={"name": "ignored"}) is None
    replacement_product = uuid.uuid4()
    scope_updates = coupons_api._resolve_scope_updates(
        promo=promo,
        data={"included_product_ids": [replacement_product]},
    )
    assert scope_updates is not None
    include_products, exclude_products, include_categories, exclude_categories = scope_updates
    assert include_products == {replacement_product}
    assert exclude_products == set()
    assert include_categories == set()
    assert exclude_categories == {existing_category}

    starts_at = datetime(2026, 2, 20, 12, 0, tzinfo=timezone.utc)
    normalized = coupons_api._normalize_issue_coupon_ends_at(
        ends_at=datetime(2026, 2, 21, 12, 0),
        validity_days=None,
        starts_at=starts_at,
    )
    assert normalized == datetime(2026, 2, 21, 12, 0, tzinfo=timezone.utc)
    assert coupons_api._normalize_issue_coupon_ends_at(ends_at=None, validity_days=5, starts_at=starts_at) == starts_at + timedelta(days=5)

    assert coupons_api._resolve_issue_coupon_should_email(send_email=False, user=SimpleNamespace(email="u@example.com")) is False
    assert (
        coupons_api._resolve_issue_coupon_should_email(
            send_email=True,
            user=SimpleNamespace(email="u@example.com", notify_marketing=True),
        )
        is True
    )
    with pytest.raises(HTTPException, match="marketing"):
        coupons_api._resolve_issue_coupon_should_email(
            send_email=True,
            user=SimpleNamespace(email="u@example.com", notify_marketing=False),
        )

    request_with_validity = coupons_api.CouponIssueToUserRequest(
        user_id=uuid.uuid4(),
        promotion_id=uuid.uuid4(),
        validity_days=2,
    )
    assert coupons_api._resolve_issue_coupon_ends_at_or_400(payload=request_with_validity, starts_at=starts_at) == starts_at + timedelta(days=2)

    request_with_past_end = coupons_api.CouponIssueToUserRequest(
        user_id=uuid.uuid4(),
        promotion_id=uuid.uuid4(),
        ends_at=starts_at - timedelta(days=1),
    )
    with pytest.raises(HTTPException, match="must be in the future"):
        coupons_api._resolve_issue_coupon_ends_at_or_400(payload=request_with_past_end, starts_at=starts_at)

    fallback_ctx = coupons_api._coupon_email_context(None)
    assert fallback_ctx.promotion_name
    assert fallback_ctx.coupon_code == ""
    coupon_ctx = coupons_api._coupon_email_context(
        SimpleNamespace(
            code="SAVE20",
            ends_at=starts_at,
            promotion=SimpleNamespace(name="Promo", description="Promo desc"),
        )
    )
    assert coupon_ctx.coupon_code == "SAVE20"
    assert coupon_ctx.promotion_name == "Promo"
    assert coupons_api._trimmed_revoke_reason("  " + ("x" * 400)) == "x" * 255
    assert coupons_api._notification_revoke_reason("  reason  ") == "reason"


def test_coupon_api_bulk_email_bucket_and_preview_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    requested, normalized, invalid = coupons_api._normalize_bulk_email_request(
        ["USER@example.com", "user@example.com", "bad", "ok@test.ro"]
    )
    assert requested == 4
    assert normalized == ["user@example.com", "ok@test.ro"]
    assert invalid == ["bad"]

    too_many = [f"user{i}@example.com" for i in range(501)]
    with pytest.raises(HTTPException, match="Too many emails"):
        coupons_api._normalize_bulk_email_request(too_many)

    users_by_email = {
        "user@example.com": SimpleNamespace(email="user@example.com"),
    }
    assert coupons_api._not_found_emails(["user@example.com", "missing@example.com"], users_by_email) == ["missing@example.com"]

    assert coupons_api._bucket_total_in_range(2) is True
    assert coupons_api._bucket_total_in_range(101) is False
    assert coupons_api._bucket_index_in_range(index=0, total=2) is True
    assert coupons_api._bucket_index_in_range(index=2, total=2) is False

    user_a = uuid.uuid4()
    user_b = uuid.uuid4()
    rows = [(user_a, "a@example.com"), (user_b, "b@example.com")]
    job_rows = [(user_a, "a@example.com", "en"), (user_b, "b@example.com", "ro")]
    bucket = coupons_api._BucketConfig(total=2, index=1, seed="segment")

    monkeypatch.setattr(
        coupons_api,
        "_bucket_index_for_user",
        lambda *, user_id, seed, total: 1 if user_id == user_b else 0,
    )
    assert coupons_api._bucket_preview_rows(rows, bucket=bucket) == [(user_b, "b@example.com")]
    assert coupons_api._bucket_job_rows(job_rows, bucket=bucket) == [(user_b, "b@example.com", "ro")]

    sample: list[str] = []
    total, already_active, restored = coupons_api._preview_bucket_assignment_counts(
        bucketed=[(user_a, "a@example.com"), (user_b, "b@example.com"), (uuid.uuid4(), None)],
        status_by_user_id={user_a: None, user_b: datetime(2026, 2, 20, tzinfo=timezone.utc)},
        sample=sample,
    )
    assert total == 3
    assert already_active == 1
    assert restored == 1
    assert sample == ["a@example.com", "b@example.com"]


def test_coupon_api_bulk_job_row_helpers() -> None:
    session = _SessionStub()
    coupon_id = uuid.uuid4()
    user_id = uuid.uuid4()
    now = datetime(2026, 2, 20, tzinfo=timezone.utc)

    assign_job = SimpleNamespace(
        action=CouponBulkJobAction.assign,
        coupon_id=coupon_id,
        send_email=True,
        processed=0,
        created=0,
        restored=0,
        already_active=0,
        revoked=0,
        already_revoked=0,
        not_assigned=0,
    )
    notify: list[tuple[str, str | None]] = []
    coupons_api._apply_bulk_job_assign_row(
        session=session,
        job=assign_job,
        assignment=SimpleNamespace(revoked_at=None),
        user_id=user_id,
        email="user@example.com",
        preferred_language="en",
        notify=notify,
    )
    assert assign_job.already_active == 1
    assert notify == []

    revoked_assignment = SimpleNamespace(revoked_at=now - timedelta(days=1), revoked_reason="old")
    coupons_api._apply_bulk_job_assign_row(
        session=session,
        job=assign_job,
        assignment=revoked_assignment,
        user_id=user_id,
        email="user@example.com",
        preferred_language="en",
        notify=notify,
    )
    assert assign_job.restored == 1
    assert revoked_assignment.revoked_at is None
    assert notify == [("user@example.com", "en")]

    coupons_api._apply_bulk_job_assign_row(
        session=session,
        job=assign_job,
        assignment=None,
        user_id=uuid.uuid4(),
        email="new@example.com",
        preferred_language="ro",
        notify=notify,
    )
    assert assign_job.created == 1
    assert any(getattr(item, "user_id", None) is not None for item in session.added)

    revoke_job = SimpleNamespace(
        action=CouponBulkJobAction.revoke,
        coupon_id=coupon_id,
        send_email=True,
        processed=0,
        created=0,
        restored=0,
        already_active=0,
        revoked=0,
        already_revoked=0,
        not_assigned=0,
    )
    revoke_notify: list[tuple[str, str | None]] = []
    coupons_api._apply_bulk_job_revoke_row(
        session=session,
        job=revoke_job,
        assignment=None,
        email="none@example.com",
        preferred_language="en",
        notify=revoke_notify,
        now=now,
        revoke_reason="cleanup",
    )
    assert revoke_job.not_assigned == 1

    already_revoked = SimpleNamespace(revoked_at=now - timedelta(days=1), revoked_reason="old")
    coupons_api._apply_bulk_job_revoke_row(
        session=session,
        job=revoke_job,
        assignment=already_revoked,
        email="revoked@example.com",
        preferred_language="en",
        notify=revoke_notify,
        now=now,
        revoke_reason="cleanup",
    )
    assert revoke_job.already_revoked == 1

    active_assignment = SimpleNamespace(revoked_at=None, revoked_reason=None)
    coupons_api._apply_bulk_job_revoke_row(
        session=session,
        job=revoke_job,
        assignment=active_assignment,
        email="active@example.com",
        preferred_language="ro",
        notify=revoke_notify,
        now=now,
        revoke_reason="cleanup",
    )
    assert revoke_job.revoked == 1
    assert active_assignment.revoked_reason == "cleanup"
    assert ("active@example.com", "ro") in revoke_notify

    assign_rows_notify = coupons_api._apply_bulk_job_rows(
        session=session,
        job=SimpleNamespace(**assign_job.__dict__),
        rows=[(user_id, "user@example.com", "en")],
        assignments_by_user_id={user_id: SimpleNamespace(revoked_at=None)},
        now=now,
        revoke_reason=None,
    )
    assert assign_rows_notify == []

    revoke_rows_notify = coupons_api._apply_bulk_job_rows(
        session=session,
        job=SimpleNamespace(**revoke_job.__dict__),
        rows=[(user_id, "user@example.com", "en")],
        assignments_by_user_id={user_id: SimpleNamespace(revoked_at=None, revoked_reason=None)},
        now=now,
        revoke_reason="cleanup",
    )
    assert revoke_rows_notify == [("user@example.com", "en")]

    assert coupons_api._is_bulk_job_runnable(SimpleNamespace(status=CouponBulkJobStatus.pending)) is True
    assert coupons_api._is_bulk_job_runnable(SimpleNamespace(status=CouponBulkJobStatus.running)) is True
    assert coupons_api._is_bulk_job_runnable(SimpleNamespace(status=CouponBulkJobStatus.succeeded)) is False
