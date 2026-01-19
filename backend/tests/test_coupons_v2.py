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
from app.models.coupons_v2 import Coupon, CouponAssignment, CouponRedemption, CouponReservation, CouponVisibility, Promotion, PromotionDiscountType
from app.models.order import Order, OrderStatus
from app.models.user import User
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


def seed_product(
    session_factory: async_sessionmaker,
    *,
    slug: str,
    sku: str,
    base_price: Decimal,
    sale_price: Decimal | None = None,
) -> str:
    async def _seed() -> str:
        async with session_factory() as session:
            category = Category(slug="decor", name="Decor")
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
            await session.commit()
            return coupon.code

    return asyncio.run(_create())


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
