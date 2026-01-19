import asyncio
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.catalog import Category, Product, ProductImage, ProductStatus
from app.models.coupons_v2 import (
    Coupon,
    CouponAssignment,
    CouponBulkJobStatus,
    CouponRedemption,
    CouponReservation,
    CouponVisibility,
    Promotion,
    PromotionDiscountType,
    PromotionScope,
    PromotionScopeEntityType,
    PromotionScopeMode,
)
from app.models.order import Order, OrderStatus
from app.models.user import User, UserRole
from app.schemas.user import UserCreate
from app.services import cart as cart_service
from app.services import checkout_settings as checkout_settings_service
from app.services.auth import create_user, issue_tokens_for_user
from app.services.coupons_v2 import (
    evaluate_coupon_for_cart,
    get_coupon_by_code,
    issue_first_order_reward_if_eligible,
    redeem_coupon_for_order,
    release_coupon_for_order,
    reserve_coupon_for_order,
)


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def make_test_client() -> tuple[TestClient, async_sessionmaker]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

    async def init_models() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(init_models())

    async def override_get_session():
        async with SessionLocal() as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session
    return TestClient(app), SessionLocal


def create_user_token(session_factory: async_sessionmaker, *, email: str, username: str) -> tuple[str, UUID]:
    async def _create() -> tuple[str, UUID]:
        async with session_factory() as session:
            user = await create_user(
                session,
                UserCreate(
                    email=email,
                    username=username,
                    password="password1",
                    name="User",
                    first_name="Test",
                    last_name="User",
                    date_of_birth="2000-01-01",
                    phone="+40723204204",
                ),
            )
            tokens = await issue_tokens_for_user(session, user)
            return tokens["access_token"], user.id

    return asyncio.run(_create())


def promote_user(session_factory: async_sessionmaker, *, user_id: UUID, role: UserRole) -> None:
    async def _promote() -> None:
        async with session_factory() as session:
            user = await session.get(User, user_id)
            assert user is not None
            user.role = role
            session.add(user)
            await session.commit()

    asyncio.run(_promote())


def set_user_flags(
    session_factory: async_sessionmaker,
    *,
    user_id: UUID,
    notify_marketing: bool | None = None,
    email_verified: bool | None = None,
) -> None:
    async def _update() -> None:
        async with session_factory() as session:
            user = await session.get(User, user_id)
            assert user is not None
            if notify_marketing is not None:
                user.notify_marketing = bool(notify_marketing)
            if email_verified is not None:
                user.email_verified = bool(email_verified)
            session.add(user)
            await session.commit()

    asyncio.run(_update())


def seed_product(
    session_factory: async_sessionmaker,
    *,
    slug: str,
    sku: str,
    base_price: Decimal,
    sale_price: Decimal | None = None,
    category_slug: str = "decor",
    category_name: str = "Decor",
) -> str:
    async def _seed() -> str:
        async with session_factory() as session:
            category = (await session.execute(select(Category).where(Category.slug == category_slug))).scalars().first()
            if not category:
                category = Category(slug=category_slug, name=category_name)
            now = datetime.now(timezone.utc)
            product = Product(
                category=category,
                slug=slug,
                sku=sku,
                name="Test product",
                base_price=base_price,
                sale_price=sale_price,
                sale_start_at=(now - timedelta(days=1)) if sale_price is not None else None,
                currency="RON",
                stock_quantity=50,
                status=ProductStatus.published,
                images=[ProductImage(url="/media/test.png", alt_text="test")],
            )
            session.add_all([category, product])
            await session.commit()
            await session.refresh(product)
            return str(product.id)

    return asyncio.run(_seed())


def create_promotion_and_coupon(
    session_factory: async_sessionmaker,
    *,
    name: str,
    discount_type: PromotionDiscountType,
    code: str,
    percentage_off: Decimal | None = None,
    amount_off: Decimal | None = None,
    min_subtotal: Decimal | None = None,
    allow_on_sale_items: bool = True,
    visibility: CouponVisibility = CouponVisibility.public,
    global_max_redemptions: int | None = None,
    per_customer_max_redemptions: int | None = None,
    included_product_ids: list[str] | None = None,
    excluded_product_ids: list[str] | None = None,
    included_category_ids: list[str] | None = None,
    excluded_category_ids: list[str] | None = None,
) -> str:
    async def _create() -> str:
        async with session_factory() as session:
            promo = Promotion(
                name=name,
                description=name,
                discount_type=discount_type,
                percentage_off=percentage_off,
                amount_off=amount_off,
                min_subtotal=min_subtotal,
                allow_on_sale_items=allow_on_sale_items,
                is_active=True,
                is_automatic=False,
            )
            session.add(promo)
            await session.commit()
            await session.refresh(promo)

            coupon = Coupon(
                promotion_id=promo.id,
                code=code.strip().upper(),
                visibility=visibility,
                is_active=True,
                global_max_redemptions=global_max_redemptions,
                per_customer_max_redemptions=per_customer_max_redemptions,
            )
            session.add(coupon)
            await session.flush()

            for pid in included_product_ids or []:
                session.add(
                    PromotionScope(
                        promotion_id=promo.id,
                        entity_type=PromotionScopeEntityType.product,
                        entity_id=UUID(pid),
                        mode=PromotionScopeMode.include,
                    )
                )
            for pid in excluded_product_ids or []:
                session.add(
                    PromotionScope(
                        promotion_id=promo.id,
                        entity_type=PromotionScopeEntityType.product,
                        entity_id=UUID(pid),
                        mode=PromotionScopeMode.exclude,
                    )
                )
            for cid in included_category_ids or []:
                session.add(
                    PromotionScope(
                        promotion_id=promo.id,
                        entity_type=PromotionScopeEntityType.category,
                        entity_id=UUID(cid),
                        mode=PromotionScopeMode.include,
                    )
                )
            for cid in excluded_category_ids or []:
                session.add(
                    PromotionScope(
                        promotion_id=promo.id,
                        entity_type=PromotionScopeEntityType.category,
                        entity_id=UUID(cid),
                        mode=PromotionScopeMode.exclude,
                    )
                )

            await session.commit()
            return coupon.code

    return asyncio.run(_create())


def get_product_category_id(session_factory: async_sessionmaker, product_id: str) -> str:
    async def _get() -> str:
        async with session_factory() as session:
            product = await session.get(Product, UUID(product_id))
            assert product is not None
            return str(product.category_id)

    return asyncio.run(_get())


def get_coupon_id(session_factory: async_sessionmaker, code: str) -> str:
    async def _get() -> str:
        async with session_factory() as session:
            coupon = (await session.execute(select(Coupon).where(Coupon.code == code.strip().upper()))).scalars().first()
            assert coupon is not None
            return str(coupon.id)

    return asyncio.run(_get())


def test_coupon_eligibility_and_validation() -> None:
    client, SessionLocal = make_test_client()
    try:
        token, _ = create_user_token(SessionLocal, email="coupon@example.com", username="coupon_user")
        product_id = seed_product(
            SessionLocal,
            slug="sale-item",
            sku="SKU-SALE",
            base_price=Decimal("100.00"),
            sale_price=Decimal("80.00"),
        )

        res = client.post(
            "/api/v1/cart/items",
            json={"product_id": product_id, "quantity": 1},
            headers=auth_headers(token),
        )
        assert res.status_code == 201, res.text

        save10 = create_promotion_and_coupon(
            SessionLocal,
            name="Save 10%",
            discount_type=PromotionDiscountType.percent,
            percentage_off=Decimal("10.00"),
            code="SAVE10",
            allow_on_sale_items=True,
        )
        big_spend = create_promotion_and_coupon(
            SessionLocal,
            name="Big spend 10%",
            discount_type=PromotionDiscountType.percent,
            percentage_off=Decimal("10.00"),
            code="BIGSPEND",
            min_subtotal=Decimal("200.00"),
            allow_on_sale_items=True,
        )
        no_sale = create_promotion_and_coupon(
            SessionLocal,
            name="No-sale 10%",
            discount_type=PromotionDiscountType.percent,
            percentage_off=Decimal("10.00"),
            code="NOSALE",
            allow_on_sale_items=False,
        )

        eligibility = client.get("/api/v1/coupons/eligibility", headers=auth_headers(token))
        assert eligibility.status_code == 200, eligibility.text
        body = eligibility.json()

        eligible_codes = {offer["coupon"]["code"] for offer in body["eligible"]}
        ineligible_by_code = {offer["coupon"]["code"]: offer for offer in body["ineligible"]}

        assert save10 in eligible_codes
        assert big_spend in ineligible_by_code
        assert "min_subtotal_not_met" in set(ineligible_by_code[big_spend]["reasons"])
        assert no_sale in ineligible_by_code
        assert "no_eligible_items" in set(ineligible_by_code[no_sale]["reasons"])

        validate = client.post("/api/v1/coupons/validate", json={"code": "save10"}, headers=auth_headers(token))
        assert validate.status_code == 200, validate.text
        payload = validate.json()
        assert payload["coupon"]["code"] == "SAVE10"
        assert payload["eligible"] is True
        assert Decimal(str(payload["estimated_discount_ron"])) == Decimal("8.00")

        validate_missing = client.post(
            "/api/v1/coupons/validate",
            json={"code": "does-not-exist"},
            headers=auth_headers(token),
        )
        assert validate_missing.status_code == 404
    finally:
        client.close()
        app.dependency_overrides.clear()


def test_assigned_coupon_requires_assignment() -> None:
    client, SessionLocal = make_test_client()
    try:
        token, user_id = create_user_token(SessionLocal, email="assigned@example.com", username="assigned_user")
        product_id = seed_product(SessionLocal, slug="basic", sku="SKU-BASIC", base_price=Decimal("100.00"))
        res = client.post(
            "/api/v1/cart/items",
            json={"product_id": product_id, "quantity": 1},
            headers=auth_headers(token),
        )
        assert res.status_code == 201, res.text

        code = create_promotion_and_coupon(
            SessionLocal,
            name="Assigned 10%",
            discount_type=PromotionDiscountType.percent,
            percentage_off=Decimal("10.00"),
            code="ASSIGNED10",
            visibility=CouponVisibility.assigned,
        )

        validate = client.post("/api/v1/coupons/validate", json={"code": code}, headers=auth_headers(token))
        assert validate.status_code == 200, validate.text
        assert validate.json()["eligible"] is False
        assert "not_assigned" in set(validate.json()["reasons"])

        async def assign_coupon() -> None:
            async with SessionLocal() as session:
                coupon = await get_coupon_by_code(session, code=code)
                assert coupon
                session.add(CouponAssignment(coupon_id=coupon.id, user_id=user_id))
                await session.commit()

        asyncio.run(assign_coupon())

        validate2 = client.post("/api/v1/coupons/validate", json={"code": code}, headers=auth_headers(token))
        assert validate2.status_code == 200, validate2.text
        assert validate2.json()["eligible"] is True
    finally:
        client.close()
        app.dependency_overrides.clear()


def test_scope_rules_include_product_only_discounts_matching_items() -> None:
    client, SessionLocal = make_test_client()
    try:
        token, _ = create_user_token(SessionLocal, email="scope1@example.com", username="scope1")
        product_a = seed_product(
            SessionLocal,
            slug="scope-a",
            sku="SKU-SCOPE-A",
            base_price=Decimal("100.00"),
            category_slug="decor",
            category_name="Decor",
        )
        product_b = seed_product(
            SessionLocal,
            slug="scope-b",
            sku="SKU-SCOPE-B",
            base_price=Decimal("50.00"),
            category_slug="prints",
            category_name="Prints",
        )

        assert (
            client.post("/api/v1/cart/items", json={"product_id": product_a, "quantity": 1}, headers=auth_headers(token)).status_code
            == 201
        )
        assert (
            client.post("/api/v1/cart/items", json={"product_id": product_b, "quantity": 1}, headers=auth_headers(token)).status_code
            == 201
        )

        code = create_promotion_and_coupon(
            SessionLocal,
            name="Scope product include",
            discount_type=PromotionDiscountType.percent,
            percentage_off=Decimal("10.00"),
            code="SCOPEPROD10",
            included_product_ids=[product_a],
        )

        validate = client.post("/api/v1/coupons/validate", json={"code": code}, headers=auth_headers(token))
        assert validate.status_code == 200, validate.text
        payload = validate.json()
        assert payload["eligible"] is True
        assert Decimal(str(payload["estimated_discount_ron"])) == Decimal("10.00")
    finally:
        client.close()
        app.dependency_overrides.clear()


def test_scope_rules_excluded_category_blocks_coupon() -> None:
    client, SessionLocal = make_test_client()
    try:
        token, _ = create_user_token(SessionLocal, email="scope2@example.com", username="scope2")
        product_id = seed_product(
            SessionLocal,
            slug="scope-excluded",
            sku="SKU-SCOPE-EX",
            base_price=Decimal("100.00"),
            category_slug="excluded",
            category_name="Excluded",
        )
        category_id = get_product_category_id(SessionLocal, product_id)

        assert (
            client.post("/api/v1/cart/items", json={"product_id": product_id, "quantity": 1}, headers=auth_headers(token)).status_code
            == 201
        )

        code = create_promotion_and_coupon(
            SessionLocal,
            name="Scope category exclude",
            discount_type=PromotionDiscountType.percent,
            percentage_off=Decimal("10.00"),
            code="SCOPECATEX",
            excluded_category_ids=[category_id],
        )

        validate = client.post("/api/v1/coupons/validate", json={"code": code}, headers=auth_headers(token))
        assert validate.status_code == 200, validate.text
        payload = validate.json()
        assert payload["eligible"] is False
        reasons = set(payload["reasons"])
        assert "scope_excluded" in reasons
        assert "no_eligible_items" in reasons
    finally:
        client.close()
        app.dependency_overrides.clear()


def test_coupon_reservation_redeem_and_void_flow() -> None:
    client, SessionLocal = make_test_client()
    try:
        token1, user1_id = create_user_token(SessionLocal, email="cap1@example.com", username="cap1")
        token2, user2_id = create_user_token(SessionLocal, email="cap2@example.com", username="cap2")
        product_id = seed_product(SessionLocal, slug="cap-item", sku="SKU-CAP", base_price=Decimal("100.00"))

        assert (
            client.post("/api/v1/cart/items", json={"product_id": product_id, "quantity": 1}, headers=auth_headers(token1)).status_code
            == 201
        )
        assert (
            client.post("/api/v1/cart/items", json={"product_id": product_id, "quantity": 1}, headers=auth_headers(token2)).status_code
            == 201
        )

        code = create_promotion_and_coupon(
            SessionLocal,
            name="One use",
            discount_type=PromotionDiscountType.amount,
            amount_off=Decimal("15.00"),
            code="ONEUSE",
            global_max_redemptions=1,
        )

        async def reserve_for_user(order_code: str) -> UUID:
            async with SessionLocal() as session:
                user1 = await session.get(User, user1_id)
                assert user1

                coupon = await get_coupon_by_code(session, code=order_code)
                assert coupon

                cart1 = await cart_service.get_cart(session, user1_id, None)
                checkout = await checkout_settings_service.get_checkout_settings(session)
                eligibility = await evaluate_coupon_for_cart(
                    session,
                    user_id=user1_id,
                    coupon=coupon,
                    cart=cart1,
                    checkout=checkout,
                    shipping_method_rate_flat=None,
                    shipping_method_rate_per_kg=None,
                )
                assert eligibility.eligible is True
                assert eligibility.estimated_discount_ron == Decimal("15.00")

                order1 = Order(
                    user_id=user1_id,
                    status=OrderStatus.pending_payment,
                    customer_email=user1.email,
                    customer_name="Cap One",
                    promo_code=order_code,
                    total_amount=Decimal("0.00"),
                    payment_method="stripe",
                    currency="RON",
                )
                session.add(order1)
                await session.commit()
                await session.refresh(order1)

                reservation = await reserve_coupon_for_order(
                    session,
                    user=user1,
                    order=order1,
                    coupon=coupon,
                    discount_ron=eligibility.estimated_discount_ron,
                    shipping_discount_ron=eligibility.estimated_shipping_discount_ron,
                )
                assert reservation.order_id == order1.id
                return order1.id

        order_id = asyncio.run(reserve_for_user(code))

        # While reserved, other users should see it as sold out (cap=1).
        validate = client.post("/api/v1/coupons/validate", json={"code": code}, headers=auth_headers(token2))
        assert validate.status_code == 200, validate.text
        assert validate.json()["eligible"] is False
        assert "sold_out" in set(validate.json()["reasons"])

        async def redeem(order_id: UUID) -> None:
            async with SessionLocal() as session:
                order = await session.get(Order, order_id)
                assert order
                await redeem_coupon_for_order(session, order=order, note="payment_captured")

                res_count = int(
                    (
                        await session.execute(
                            select(func.count())
                            .select_from(CouponReservation)
                            .where(CouponReservation.order_id == order_id)
                        )
                    ).scalar_one()
                )
                assert res_count == 0

                redemption = (
                    (await session.execute(select(CouponRedemption).where(CouponRedemption.order_id == order_id)))
                    .scalars()
                    .first()
                )
                assert redemption is not None
                assert redemption.discount_ron == Decimal("15.00")
                assert redemption.voided_at is None

        asyncio.run(redeem(order_id))

        # Still sold out after redemption.
        validate2 = client.post("/api/v1/coupons/validate", json={"code": code}, headers=auth_headers(token2))
        assert validate2.status_code == 200, validate2.text
        assert validate2.json()["eligible"] is False
        assert "sold_out" in set(validate2.json()["reasons"])

        async def void_redemption(order_id: UUID) -> None:
            async with SessionLocal() as session:
                order = await session.get(Order, order_id)
                assert order
                await release_coupon_for_order(session, order=order, reason="refunded")
                redemption = (
                    (await session.execute(select(CouponRedemption).where(CouponRedemption.order_id == order_id)))
                    .scalars()
                    .first()
                )
                assert redemption is not None
                assert redemption.voided_at is not None

        asyncio.run(void_redemption(order_id))

        validate_final = client.post("/api/v1/coupons/validate", json={"code": code}, headers=auth_headers(token2))
        assert validate_final.status_code == 200, validate_final.text
        assert validate_final.json()["eligible"] is True
    finally:
        client.close()
        app.dependency_overrides.clear()


def test_per_customer_cap_blocks_reuse() -> None:
    client, SessionLocal = make_test_client()
    try:
        token1, user1_id = create_user_token(SessionLocal, email="percap1@example.com", username="percap1")
        token2, user2_id = create_user_token(SessionLocal, email="percap2@example.com", username="percap2")
        product_id = seed_product(SessionLocal, slug="percap-item", sku="SKU-PERCAP", base_price=Decimal("100.00"))

        assert (
            client.post("/api/v1/cart/items", json={"product_id": product_id, "quantity": 1}, headers=auth_headers(token1)).status_code
            == 201
        )
        assert (
            client.post("/api/v1/cart/items", json={"product_id": product_id, "quantity": 1}, headers=auth_headers(token2)).status_code
            == 201
        )

        code = create_promotion_and_coupon(
            SessionLocal,
            name="One per customer",
            discount_type=PromotionDiscountType.percent,
            percentage_off=Decimal("10.00"),
            code="ONEPERCUST",
            per_customer_max_redemptions=1,
        )

        async def redeem_once() -> None:
            async with SessionLocal() as session:
                user1 = await session.get(User, user1_id)
                assert user1
                coupon = await get_coupon_by_code(session, code=code)
                assert coupon

                cart1 = await cart_service.get_cart(session, user1_id, None)
                checkout = await checkout_settings_service.get_checkout_settings(session)
                eligibility = await evaluate_coupon_for_cart(
                    session,
                    user_id=user1_id,
                    coupon=coupon,
                    cart=cart1,
                    checkout=checkout,
                    shipping_method_rate_flat=None,
                    shipping_method_rate_per_kg=None,
                )
                assert eligibility.eligible is True

                order1 = Order(
                    user_id=user1_id,
                    status=OrderStatus.pending_payment,
                    customer_email=user1.email,
                    customer_name="Per Cap",
                    promo_code=code,
                    total_amount=Decimal("0.00"),
                    payment_method="stripe",
                    currency="RON",
                )
                session.add(order1)
                await session.commit()
                await session.refresh(order1)

                await reserve_coupon_for_order(
                    session,
                    user=user1,
                    order=order1,
                    coupon=coupon,
                    discount_ron=eligibility.estimated_discount_ron,
                    shipping_discount_ron=eligibility.estimated_shipping_discount_ron,
                )
                await redeem_coupon_for_order(session, order=order1, note="payment_captured")

        asyncio.run(redeem_once())

        # Same user should be blocked after a redemption.
        validate_user1 = client.post("/api/v1/coupons/validate", json={"code": code}, headers=auth_headers(token1))
        assert validate_user1.status_code == 200, validate_user1.text
        assert validate_user1.json()["eligible"] is False
        assert "per_customer_limit_reached" in set(validate_user1.json()["reasons"])

        # Another user can still use it.
        validate_user2 = client.post("/api/v1/coupons/validate", json={"code": code}, headers=auth_headers(token2))
        assert validate_user2.status_code == 200, validate_user2.text
        assert validate_user2.json()["eligible"] is True
    finally:
        client.close()
        app.dependency_overrides.clear()


def test_first_order_reward_issued_on_first_delivered_order() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

    async def init_models() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(init_models())

    async def run() -> None:
        async with SessionLocal() as session:
            user = await create_user(
                session,
                UserCreate(
                    email="reward@example.com",
                    username="reward_user",
                    password="password1",
                    name="Reward",
                    first_name="Reward",
                    last_name="User",
                    date_of_birth="2000-01-01",
                    phone="+40723204204",
                ),
            )

            order1 = Order(
                user_id=user.id,
                status=OrderStatus.delivered,
                customer_email=user.email,
                customer_name="Reward User",
                total_amount=Decimal("100.00"),
                payment_method="cod",
                currency="RON",
            )
            session.add(order1)
            await session.commit()
            await session.refresh(order1)

            coupon = await issue_first_order_reward_if_eligible(session, user=user, order=order1, validity_days=30)
            assert coupon is not None
            assert coupon.code.startswith("FIRST20-")
            assert coupon.visibility == CouponVisibility.assigned
            assert coupon.per_customer_max_redemptions == 1

            # Idempotent on repeated calls for the same delivered order.
            coupon2 = await issue_first_order_reward_if_eligible(session, user=user, order=order1, validity_days=30)
            assert coupon2 is None

            # Second delivered order should not issue another reward.
            order2 = Order(
                user_id=user.id,
                status=OrderStatus.delivered,
                customer_email=user.email,
                customer_name="Reward User 2",
                total_amount=Decimal("50.00"),
                payment_method="cod",
                currency="RON",
            )
            session.add(order2)
            await session.commit()
            await session.refresh(order2)

            coupon3 = await issue_first_order_reward_if_eligible(session, user=user, order=order2, validity_days=30)
            assert coupon3 is None

            assigned_count = int(
                (
                    await session.execute(
                        select(func.count()).select_from(CouponAssignment).where(CouponAssignment.user_id == user.id)
                    )
                ).scalar_one()
            )
            assert assigned_count == 1

    asyncio.run(run())


def test_admin_products_by_ids_endpoint() -> None:
    client, SessionLocal = make_test_client()
    try:
        token, user_id = create_user_token(SessionLocal, email="admin@example.com", username="admin_user")
        promote_user(SessionLocal, user_id=user_id, role=UserRole.admin)

        product1 = seed_product(SessionLocal, slug="p1", sku="SKU-P1", base_price=Decimal("10.00"), category_slug="decor")
        product2 = seed_product(SessionLocal, slug="p2", sku="SKU-P2", base_price=Decimal("20.00"), category_slug="sale", category_name="Sale")

        res = client.post(
            "/api/v1/admin/dashboard/products/by-ids",
            json={"ids": [product1, product2]},
            headers=auth_headers(token),
        )
        assert res.status_code == 200, res.text
        rows = res.json()
        ids = {row["id"] for row in rows}
        assert product1 in ids
        assert product2 in ids
    finally:
        app.dependency_overrides.clear()


def test_admin_bulk_assign_and_revoke_coupon() -> None:
    client, SessionLocal = make_test_client()
    try:
        admin_token, admin_id = create_user_token(SessionLocal, email="admin2@example.com", username="admin_user2")
        promote_user(SessionLocal, user_id=admin_id, role=UserRole.admin)

        user_token, _ = create_user_token(SessionLocal, email="bulk-user@example.com", username="bulk_user")
        # Ensure the user exists in DB before bulk operations.
        assert user_token

        code = create_promotion_and_coupon(
            SessionLocal,
            name="Bulk promo",
            discount_type=PromotionDiscountType.percent,
            percentage_off=Decimal("10"),
            code="BULK10",
        )
        coupon_id = get_coupon_id(SessionLocal, code)

        res = client.post(
            f"/api/v1/coupons/admin/coupons/{coupon_id}/assign/bulk",
            json={"emails": ["bulk-user@example.com", "missing@example.com", "not-an-email"], "send_email": False},
            headers=auth_headers(admin_token),
        )
        assert res.status_code == 200, res.text
        payload = res.json()
        assert payload["created"] == 1
        assert "missing@example.com" in payload["not_found_emails"]
        assert "not-an-email" in payload["invalid_emails"]

        res = client.post(
            f"/api/v1/coupons/admin/coupons/{coupon_id}/revoke/bulk",
            json={"emails": ["bulk-user@example.com"], "reason": "test revoke", "send_email": False},
            headers=auth_headers(admin_token),
        )
        assert res.status_code == 200, res.text
        payload = res.json()
        assert payload["revoked"] == 1

        # Revoking again is idempotent (counts as already revoked).
        res = client.post(
            f"/api/v1/coupons/admin/coupons/{coupon_id}/revoke/bulk",
            json={"emails": ["bulk-user@example.com"], "reason": "test revoke", "send_email": False},
            headers=auth_headers(admin_token),
        )
        assert res.status_code == 200, res.text
        payload = res.json()
        assert payload["already_revoked"] == 1
    finally:
        app.dependency_overrides.clear()


def test_admin_segment_bulk_job_assign_and_revoke() -> None:
    client, SessionLocal = make_test_client()
    try:
        admin_token, admin_id = create_user_token(SessionLocal, email="admin-seg@example.com", username="admin_seg")
        promote_user(SessionLocal, user_id=admin_id, role=UserRole.admin)

        _, u1 = create_user_token(SessionLocal, email="seg1@example.com", username="seg1")
        _, u2 = create_user_token(SessionLocal, email="seg2@example.com", username="seg2")
        _, u3 = create_user_token(SessionLocal, email="seg3@example.com", username="seg3")

        set_user_flags(SessionLocal, user_id=u1, notify_marketing=True, email_verified=True)
        set_user_flags(SessionLocal, user_id=u2, notify_marketing=True, email_verified=False)
        set_user_flags(SessionLocal, user_id=u3, notify_marketing=False, email_verified=True)

        code = create_promotion_and_coupon(
            SessionLocal,
            name="Segment promo",
            discount_type=PromotionDiscountType.percent,
            percentage_off=Decimal("10"),
            code="SEG10",
        )
        coupon_id = get_coupon_id(SessionLocal, code)

        preview = client.post(
            f"/api/v1/coupons/admin/coupons/{coupon_id}/assign/segment/preview",
            json={"require_marketing_opt_in": True, "require_email_verified": True, "send_email": False},
            headers=auth_headers(admin_token),
        )
        assert preview.status_code == 200, preview.text
        body = preview.json()
        assert body["total_candidates"] == 1
        assert body["created"] == 1

        start = client.post(
            f"/api/v1/coupons/admin/coupons/{coupon_id}/assign/segment",
            json={"require_marketing_opt_in": True, "require_email_verified": True, "send_email": False},
            headers=auth_headers(admin_token),
        )
        assert start.status_code == 201, start.text
        job_id = start.json()["id"]

        for _ in range(20):
            job_res = client.get(
                f"/api/v1/coupons/admin/coupons/bulk-jobs/{job_id}",
                headers=auth_headers(admin_token),
            )
            assert job_res.status_code == 200, job_res.text
            status_val = job_res.json()["status"]
            if status_val == CouponBulkJobStatus.succeeded.value:
                break
        else:
            raise AssertionError(f"job did not finish: {job_res.json()}")

        async def _assert_assigned() -> None:
            async with SessionLocal() as session:
                assigned = (
                    (
                        await session.execute(
                            select(CouponAssignment).where(
                                CouponAssignment.coupon_id == UUID(str(coupon_id)),
                                CouponAssignment.user_id == UUID(str(u1)),
                            )
                        )
                    )
                    .scalars()
                    .first()
                )
                assert assigned is not None
                assert assigned.revoked_at is None
                other = (
                    (
                        await session.execute(
                            select(func.count())
                            .select_from(CouponAssignment)
                            .where(CouponAssignment.coupon_id == UUID(str(coupon_id)))
                        )
                    )
                    .scalar_one()
                )
                assert int(other) == 1

        asyncio.run(_assert_assigned())

        revoke = client.post(
            f"/api/v1/coupons/admin/coupons/{coupon_id}/revoke/segment",
            json={"require_marketing_opt_in": True, "require_email_verified": True, "send_email": False, "reason": "cleanup"},
            headers=auth_headers(admin_token),
        )
        assert revoke.status_code == 201, revoke.text
        revoke_job_id = revoke.json()["id"]

        for _ in range(20):
            job_res = client.get(
                f"/api/v1/coupons/admin/coupons/bulk-jobs/{revoke_job_id}",
                headers=auth_headers(admin_token),
            )
            assert job_res.status_code == 200, job_res.text
            status_val = job_res.json()["status"]
            if status_val == CouponBulkJobStatus.succeeded.value:
                break
        else:
            raise AssertionError(f"revoke job did not finish: {job_res.json()}")

        async def _assert_revoked() -> None:
            async with SessionLocal() as session:
                assigned = (
                    (
                        await session.execute(
                            select(CouponAssignment).where(
                                CouponAssignment.coupon_id == UUID(str(coupon_id)),
                                CouponAssignment.user_id == UUID(str(u1)),
                            )
                        )
                    )
                    .scalars()
                    .first()
                )
                assert assigned is not None
                assert assigned.revoked_at is not None
                assert (assigned.revoked_reason or "").startswith("cleanup")

        asyncio.run(_assert_revoked())
    finally:
        app.dependency_overrides.clear()
