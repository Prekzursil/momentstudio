"""Worker-0 standalone coverage tests for ``app.api.v1.coupons_v2``.

Drives the route handler coroutines and module helpers directly (no TestClient)
so coverage reliably traces handler bodies, including the admin promotion /
coupon / bulk / segment-job paths.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.v1 import coupons_v2 as api
from app.db.base import Base
from app.models.catalog import Category, Product, ProductStatus
from app.models.coupons_v2 import (
    Coupon,
    CouponAssignment,
    CouponBulkJob,
    CouponBulkJobAction,
    CouponBulkJobStatus,
    CouponRedemption,
    CouponVisibility,
    Promotion,
    PromotionDiscountType,
    PromotionScope,
    PromotionScopeEntityType,
    PromotionScopeMode,
)
from app.models.order import Order, OrderItem, OrderStatus, ShippingMethod
from app.models.user import User, UserRole
from app.schemas.coupons_v2 import (
    CouponAssignRequest,
    CouponBulkAssignRequest,
    CouponBulkRevokeRequest,
    CouponBulkSegmentAssignRequest,
    CouponBulkSegmentRevokeRequest,
    CouponCodeGenerateRequest,
    CouponCreate,
    CouponIssueToUserRequest,
    CouponRevokeRequest,
    CouponUpdate,
    CouponValidateRequest,
    PromotionCreate,
    PromotionUpdate,
)
from app.services import email as email_service

UTC = timezone.utc


# --------------------------------------------------------------------------- #
# Infrastructure
# --------------------------------------------------------------------------- #


def _make_engine_and_local() -> tuple[object, async_sessionmaker]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    return engine, async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False, autoflush=False
    )


async def _init(engine) -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


class _Admin:
    def __init__(self) -> None:
        self.id = uuid.uuid4()


async def _seed_user(
    session: AsyncSession,
    *,
    email: str,
    notify_marketing: bool = True,
    email_verified: bool = True,
    deleted: bool = False,
) -> User:
    user = User(
        email=email,
        username=email.split("@")[0],
        hashed_password="x",
        role=UserRole.customer,
        notify_marketing=notify_marketing,
        email_verified=email_verified,
        preferred_language="en",
        deleted_at=datetime.now(UTC) if deleted else None,
    )
    session.add(user)
    await session.flush()
    return user


async def _seed_category_product(session: AsyncSession) -> tuple[Category, Product]:
    category = Category(slug="decor", name="Decor", sort_order=1)
    session.add(category)
    await session.flush()
    product = Product(
        category_id=category.id,
        slug="prod",
        sku="SKU-1",
        name="Prod",
        base_price=Decimal("50"),
        currency="RON",
        stock_quantity=10,
        status=ProductStatus.published,
    )
    session.add(product)
    await session.flush()
    return category, product


async def _seed_promo_coupon(
    session: AsyncSession,
    *,
    code: str = "SAVE10",
    visibility: CouponVisibility = CouponVisibility.public,
) -> tuple[Promotion, Coupon]:
    promo = Promotion(
        name="Promo",
        description="desc",
        discount_type=PromotionDiscountType.percent,
        percentage_off=Decimal("10"),
        is_active=True,
        is_automatic=False,
    )
    session.add(promo)
    await session.flush()
    coupon = Coupon(
        promotion_id=promo.id,
        code=code,
        visibility=visibility,
        is_active=True,
    )
    session.add(coupon)
    await session.flush()
    return promo, coupon


@pytest.fixture(autouse=True)
def _eager_defaults():
    """Make the SQLite test engine re-fetch server-computed defaults (e.g.
    ``onupdate`` columns) during flush, matching asyncpg/Postgres behaviour.

    Without this, an ``onupdate`` column such as ``updated_at`` is expired after
    an UPDATE and Pydantic's synchronous ``model_validate`` cannot async-reload
    it under aiosqlite (MissingGreenlet). This is environment parity only.
    """
    mappers = list(Base.registry.mappers)
    prev = {m: m.eager_defaults for m in mappers}
    for m in mappers:
        m.eager_defaults = True
    yield
    for m, value in prev.items():
        m.eager_defaults = value


@pytest.fixture(autouse=True)
def _mock_emails(monkeypatch):
    async def _ok(*args, **kwargs):
        return True

    monkeypatch.setattr(email_service, "send_coupon_assigned", _ok)
    monkeypatch.setattr(email_service, "send_coupon_revoked", _ok)


# --------------------------------------------------------------------------- #
# Pure / sync helpers
# --------------------------------------------------------------------------- #


def test_sanitize_coupon_prefix() -> None:
    assert api._sanitize_coupon_prefix("save-10!") == "SAVE10"
    assert api._sanitize_coupon_prefix("") == ""
    assert api._sanitize_coupon_prefix("a" * 40) == "A" * 20


def test_to_decimal() -> None:
    assert api._to_decimal(None) == Decimal("0.00")
    assert api._to_decimal("5.5") == Decimal("5.5")
    assert api._to_decimal(object()) == Decimal("0.00")  # except branch


def test_normalize_bulk_emails() -> None:
    emails, invalid = api._normalize_bulk_emails(
        [
            "A@Example.com",
            "a@example.com",  # dup
            " ",  # empty
            123,  # non-str
            "noatsign",  # invalid
            "no@dot",  # invalid domain
            "x" * 260 + "@a.com",  # too long
            "ok@valid.com",
        ]
    )
    assert emails == ["a@example.com", "ok@valid.com"]
    assert "noatsign" in invalid
    assert "no@dot" in invalid


def test_parse_bucket_config() -> None:
    assert (
        api._parse_bucket_config(bucket_total=None, bucket_index=None, bucket_seed=None)
        is None
    )
    cfg = api._parse_bucket_config(bucket_total=4, bucket_index=1, bucket_seed="s")
    assert cfg.total == 4 and cfg.index == 1 and cfg.seed == "s"
    with pytest.raises(ValueError, match="requires"):
        api._parse_bucket_config(bucket_total=4, bucket_index=None, bucket_seed="s")
    with pytest.raises(ValueError, match="between 2 and 100"):
        api._parse_bucket_config(bucket_total=1, bucket_index=0, bucket_seed="s")
    with pytest.raises(ValueError, match="within bucket_total"):
        api._parse_bucket_config(bucket_total=4, bucket_index=4, bucket_seed="s")


def test_bucket_index_for_user_deterministic() -> None:
    uid = uuid.uuid4()
    a = api._bucket_index_for_user(user_id=uid, seed="s", total=10)
    b = api._bucket_index_for_user(user_id=uid, seed="s", total=10)
    assert a == b
    assert 0 <= a < 10


def test_segment_user_filters() -> None:
    class _P:
        require_marketing_opt_in = True
        require_email_verified = True
        send_email = False

    assert len(api._segment_user_filters(_P())) == 3

    class _P2:
        require_marketing_opt_in = False
        require_email_verified = False
        send_email = True  # send_email implies marketing filter

    assert len(api._segment_user_filters(_P2())) == 2


def test_scopes_from_promotion_and_to_promotion_read() -> None:
    pid1, pid2 = uuid.uuid4(), uuid.uuid4()
    cid1, cid2 = uuid.uuid4(), uuid.uuid4()
    promo = Promotion(
        name="P",
        discount_type=PromotionDiscountType.percent,
        percentage_off=Decimal("5"),
        is_active=True,
        is_automatic=False,
        allow_on_sale_items=True,
        first_order_only=False,
    )
    promo.id = uuid.uuid4()
    promo.created_at = datetime.now(UTC)
    promo.updated_at = datetime.now(UTC)
    promo.scopes = [
        PromotionScope(
            promotion_id=promo.id,
            entity_type=PromotionScopeEntityType.product,
            entity_id=pid1,
            mode=PromotionScopeMode.include,
        ),
        PromotionScope(
            promotion_id=promo.id,
            entity_type=PromotionScopeEntityType.product,
            entity_id=pid2,
            mode=PromotionScopeMode.exclude,
        ),
        PromotionScope(
            promotion_id=promo.id,
            entity_type=PromotionScopeEntityType.category,
            entity_id=cid1,
            mode=PromotionScopeMode.include,
        ),
        PromotionScope(
            promotion_id=promo.id,
            entity_type=PromotionScopeEntityType.category,
            entity_id=cid2,
            mode=PromotionScopeMode.exclude,
        ),
    ]
    inp, exp, inc, exc = api._scopes_from_promotion(promo)
    assert inp == {pid1} and exp == {pid2}
    assert inc == {cid1} and exc == {cid2}

    read = api._to_promotion_read(promo)
    assert read.included_product_ids == [pid1]
    assert read.excluded_category_ids == [cid2]


# --------------------------------------------------------------------------- #
# Simple read/user handlers
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_eligibility_validate_my_coupons() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        user = await _seed_user(session, email="cust@a.com")
        promo, coupon = await _seed_promo_coupon(session)
        await session.commit()
        user_id = user.id

    async with local() as session:
        user = await session.get(User, user_id)
        # eligibility (empty cart -> returns response object)
        resp = await api.coupon_eligibility(
            session=session,
            current_user=user,
            shipping_method_id=None,
            session_id=None,
        )
        assert hasattr(resp, "eligible")

        # validate: not found
        with pytest.raises(HTTPException) as exc:
            await api.validate_coupon(
                CouponValidateRequest(code="NOPE"),
                session=session,
                current_user=user,
                shipping_method_id=None,
                session_id=None,
            )
        assert exc.value.status_code == 404

        # validate: found
        offer = await api.validate_coupon(
            CouponValidateRequest(code="save10"),
            session=session,
            current_user=user,
            shipping_method_id=None,
            session_id=None,
        )
        assert offer.coupon.code == "SAVE10"

        mine = await api.my_coupons(session=session, current_user=user)
        assert isinstance(mine, list)


@pytest.mark.anyio
async def test_get_shipping_method_not_found() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        assert await api._get_shipping_method(session, None) is None
        with pytest.raises(HTTPException) as exc:
            await api._get_shipping_method(session, uuid.uuid4())
        assert exc.value.status_code == 404


# --------------------------------------------------------------------------- #
# Admin promotion handlers
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_admin_create_promotion_validations() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    admin = _Admin()
    async with local() as session:
        _, product = await _seed_category_product(session)
        await session.commit()
        product_id = product.id

    async with local() as session:
        # percent without percentage_off
        with pytest.raises(HTTPException, match="percentage_off is required"):
            await api.admin_create_promotion(
                PromotionCreate(name="P", discount_type="percent"),
                session=session,
                _=admin,
            )
        # amount without amount_off
        with pytest.raises(HTTPException, match="amount_off is required"):
            await api.admin_create_promotion(
                PromotionCreate(name="P", discount_type="amount"),
                session=session,
                _=admin,
            )
        # free_shipping with amount set
        with pytest.raises(HTTPException, match="free_shipping"):
            await api.admin_create_promotion(
                PromotionCreate(
                    name="P",
                    discount_type="free_shipping",
                    amount_off=Decimal("5"),
                ),
                session=session,
                _=admin,
            )
        # both percentage and amount
        with pytest.raises(HTTPException, match="not both"):
            await api.admin_create_promotion(
                PromotionCreate(
                    name="P",
                    discount_type="percent",
                    percentage_off=Decimal("5"),
                    amount_off=Decimal("5"),
                ),
                session=session,
                _=admin,
            )

    async with local() as session:
        # happy path with key + scopes
        created = await api.admin_create_promotion(
            PromotionCreate(
                name="Promo",
                key="MYKEY",
                discount_type="percent",
                percentage_off=Decimal("10"),
                included_product_ids=[product_id],
            ),
            session=session,
            _=admin,
        )
        assert created.name == "Promo"
        assert created.included_product_ids == [product_id]

    async with local() as session:
        # duplicate key
        with pytest.raises(HTTPException, match="key already exists"):
            await api.admin_create_promotion(
                PromotionCreate(
                    name="P2",
                    key="MYKEY",
                    discount_type="percent",
                    percentage_off=Decimal("5"),
                ),
                session=session,
                _=admin,
            )


@pytest.mark.anyio
async def test_admin_list_and_update_promotion() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    admin = _Admin()
    async with local() as session:
        _, product = await _seed_category_product(session)
        promo, _ = await _seed_promo_coupon(session)
        await session.commit()
        promo_id = promo.id
        product_id = product.id

    async with local() as session:
        promos = await api.admin_list_promotions(session=session, _=admin)
        assert len(promos) == 1

    async with local() as session:
        # update not found
        with pytest.raises(HTTPException, match="Promotion not found"):
            await api.admin_update_promotion(
                uuid.uuid4(), PromotionUpdate(name="X"), session=session, _=admin
            )

    async with local() as session:
        updated = await api.admin_update_promotion(
            promo_id,
            PromotionUpdate(
                name="Updated",
                key="NEWKEY",
                discount_type="percent",
                percentage_off=Decimal("15"),
                included_product_ids=[product_id],
            ),
            session=session,
            _=admin,
        )
        assert updated.name == "Updated"
        assert updated.included_product_ids == [product_id]


@pytest.mark.anyio
async def test_admin_update_promotion_validation_errors() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    admin = _Admin()
    async with local() as session:
        promo, _ = await _seed_promo_coupon(session)
        await session.commit()
        promo_id = promo.id

    async with local() as session:
        # switch to amount type without amount_off -> error
        with pytest.raises(HTTPException, match="amount_off is required"):
            await api.admin_update_promotion(
                promo_id,
                PromotionUpdate(discount_type="amount", percentage_off=None),
                session=session,
                _=admin,
            )


# --------------------------------------------------------------------------- #
# Admin coupon handlers
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_admin_coupon_crud() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    admin = _Admin()
    async with local() as session:
        promo, coupon = await _seed_promo_coupon(session)
        await session.commit()
        promo_id, coupon_id = promo.id, coupon.id

    async with local() as session:
        listed = await api.admin_list_coupons(
            session=session, _=admin, promotion_id=promo_id, q="SAVE"
        )
        assert len(listed) == 1

    async with local() as session:
        # create coupon: promotion not found
        with pytest.raises(HTTPException, match="Promotion not found"):
            await api.admin_create_coupon(
                CouponCreate(promotion_id=uuid.uuid4(), code="NEW1"),
                session=session,
                _=admin,
            )

    async with local() as session:
        # create coupon: duplicate code
        with pytest.raises(HTTPException, match="already exists"):
            await api.admin_create_coupon(
                CouponCreate(promotion_id=promo_id, code="SAVE10"),
                session=session,
                _=admin,
            )

    async with local() as session:
        created = await api.admin_create_coupon(
            CouponCreate(promotion_id=promo_id, code="newcode"),
            session=session,
            _=admin,
        )
        assert created.code == "NEWCODE"

    async with local() as session:
        # update not found
        with pytest.raises(HTTPException, match="Coupon not found"):
            await api.admin_update_coupon(
                uuid.uuid4(), CouponUpdate(is_active=False), session=session, _=admin
            )

    async with local() as session:
        updated = await api.admin_update_coupon(
            coupon_id,
            CouponUpdate(is_active=False, global_max_redemptions=3),
            session=session,
            _=admin,
        )
        assert updated.is_active is False


@pytest.mark.anyio
async def test_admin_list_coupon_assignments() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    admin = _Admin()
    async with local() as session:
        user = await _seed_user(session, email="u@a.com")
        promo, coupon = await _seed_promo_coupon(session)
        session.add(CouponAssignment(coupon_id=coupon.id, user_id=user.id))
        await session.commit()
        coupon_id = coupon.id

    async with local() as session:
        with pytest.raises(HTTPException, match="Coupon not found"):
            await api.admin_list_coupon_assignments(
                uuid.uuid4(), session=session, _=admin
            )

    async with local() as session:
        out = await api.admin_list_coupon_assignments(
            coupon_id, session=session, _=admin
        )
        assert len(out) == 1
        assert out[0].user_email == "u@a.com"


@pytest.mark.anyio
async def test_admin_generate_coupon_code() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    admin = _Admin()
    async with local() as session:
        resp = await api.admin_generate_coupon_code(
            CouponCodeGenerateRequest(prefix="SALE", length=10),
            session=session,
            _=admin,
        )
        assert resp.code


@pytest.mark.anyio
async def test_admin_issue_coupon_to_user() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    admin = _Admin()
    bg = BackgroundTasks()
    async with local() as session:
        user = await _seed_user(session, email="iss@a.com", notify_marketing=True)
        promo, _ = await _seed_promo_coupon(session)
        await session.commit()
        user_id, promo_id = user.id, promo.id

    async with local() as session:
        # user not found
        with pytest.raises(HTTPException, match="User not found"):
            await api.admin_issue_coupon_to_user(
                CouponIssueToUserRequest(user_id=uuid.uuid4(), promotion_id=promo_id),
                bg,
                session=session,
                actor=admin,
            )

    async with local() as session:
        # promotion not found
        with pytest.raises(HTTPException, match="Promotion not found"):
            await api.admin_issue_coupon_to_user(
                CouponIssueToUserRequest(user_id=user_id, promotion_id=uuid.uuid4()),
                bg,
                session=session,
                actor=admin,
            )

    async with local() as session:
        out = await api.admin_issue_coupon_to_user(
            CouponIssueToUserRequest(
                user_id=user_id,
                promotion_id=promo_id,
                validity_days=30,
                send_email=True,
            ),
            bg,
            session=session,
            actor=admin,
        )
        assert out.visibility == CouponVisibility.assigned


@pytest.mark.anyio
async def test_admin_issue_coupon_marketing_optout_and_past_end() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    admin = _Admin()
    bg = BackgroundTasks()
    async with local() as session:
        user = await _seed_user(session, email="opt@a.com", notify_marketing=False)
        promo, _ = await _seed_promo_coupon(session)
        await session.commit()
        user_id, promo_id = user.id, promo.id

    async with local() as session:
        # ends_at in the past -> 400
        with pytest.raises(HTTPException, match="must be in the future"):
            await api.admin_issue_coupon_to_user(
                CouponIssueToUserRequest(
                    user_id=user_id,
                    promotion_id=promo_id,
                    ends_at=datetime(2000, 1, 1),
                ),
                bg,
                session=session,
                actor=admin,
            )

    async with local() as session:
        # send_email but user opted out -> 400
        with pytest.raises(HTTPException, match="opted in"):
            await api.admin_issue_coupon_to_user(
                CouponIssueToUserRequest(
                    user_id=user_id,
                    promotion_id=promo_id,
                    send_email=True,
                ),
                bg,
                session=session,
                actor=admin,
            )


# --------------------------------------------------------------------------- #
# assign / revoke (single + bulk)
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_admin_assign_and_revoke_single() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    admin = _Admin()
    bg = BackgroundTasks()
    async with local() as session:
        user = await _seed_user(session, email="ar@a.com")
        promo, coupon = await _seed_promo_coupon(session)
        await session.commit()
        coupon_id, user_id = coupon.id, user.id

    async with local() as session:
        with pytest.raises(HTTPException, match="Coupon not found"):
            await api.admin_assign_coupon(
                uuid.uuid4(),
                CouponAssignRequest(user_id=user_id),
                bg,
                session=session,
                _=admin,
            )

    async with local() as session:
        # _find_user with neither user_id nor email -> 400
        with pytest.raises(HTTPException, match="Provide user_id or email"):
            await api.admin_assign_coupon(
                coupon_id,
                CouponAssignRequest(send_email=False),
                bg,
                session=session,
                _=admin,
            )

    async with local() as session:
        # assign (create)
        r = await api.admin_assign_coupon(
            coupon_id,
            CouponAssignRequest(user_id=user_id, send_email=True),
            bg,
            session=session,
            _=admin,
        )
        assert r.status_code == 204

    async with local() as session:
        # assign again -> already active short-circuit
        r = await api.admin_assign_coupon(
            coupon_id,
            CouponAssignRequest(user_id=user_id, send_email=False),
            bg,
            session=session,
            _=admin,
        )
        assert r.status_code == 204

    async with local() as session:
        # revoke (with email)
        r = await api.admin_revoke_coupon(
            coupon_id,
            CouponRevokeRequest(user_id=user_id, reason="bye", send_email=True),
            bg,
            session=session,
            _=admin,
        )
        assert r.status_code == 204

    async with local() as session:
        # revoke again -> already revoked short-circuit
        r = await api.admin_revoke_coupon(
            coupon_id,
            CouponRevokeRequest(user_id=user_id, send_email=False),
            bg,
            session=session,
            _=admin,
        )
        assert r.status_code == 204

    async with local() as session:
        # assign restores a revoked assignment
        r = await api.admin_assign_coupon(
            coupon_id,
            CouponAssignRequest(user_id=user_id, send_email=False),
            bg,
            session=session,
            _=admin,
        )
        assert r.status_code == 204

    async with local() as session:
        # revoke not found coupon
        with pytest.raises(HTTPException, match="Coupon not found"):
            await api.admin_revoke_coupon(
                uuid.uuid4(),
                CouponRevokeRequest(user_id=user_id),
                bg,
                session=session,
                _=admin,
            )


@pytest.mark.anyio
async def test_admin_assign_revoke_marketing_optout() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    admin = _Admin()
    bg = BackgroundTasks()
    async with local() as session:
        user = await _seed_user(session, email="no@a.com", notify_marketing=False)
        promo, coupon = await _seed_promo_coupon(session)
        session.add(CouponAssignment(coupon_id=coupon.id, user_id=user.id))
        await session.commit()
        coupon_id, user_id = coupon.id, user.id

    async with local() as session:
        # revoke send_email but opted-out -> 400
        with pytest.raises(HTTPException, match="opted in"):
            await api.admin_revoke_coupon(
                coupon_id,
                CouponRevokeRequest(user_id=user_id, send_email=True),
                bg,
                session=session,
                _=admin,
            )

    async with local() as session:
        # New opted-out user with no existing assignment, found via email branch.
        await _seed_user(session, email="no2@a.com", notify_marketing=False)
        await session.commit()
    async with local() as session:
        # assign send_email but opted-out -> 400 (find via email branch)
        with pytest.raises(HTTPException, match="opted in"):
            await api.admin_assign_coupon(
                coupon_id,
                CouponAssignRequest(email="no2@a.com", send_email=True),
                bg,
                session=session,
                _=admin,
            )


@pytest.mark.anyio
async def test_find_user_by_email_not_found() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        with pytest.raises(HTTPException, match="User not found"):
            await api._find_user(session, user_id=None, email="ghost@a.com")
        with pytest.raises(HTTPException, match="User not found"):
            await api._find_user(session, user_id=uuid.uuid4(), email=None)


@pytest.mark.anyio
async def test_bulk_assign_and_revoke() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    admin = _Admin()
    bg = BackgroundTasks()
    async with local() as session:
        await _seed_user(session, email="b1@a.com", notify_marketing=True)
        await _seed_user(session, email="b2@a.com", notify_marketing=True)
        promo, coupon = await _seed_promo_coupon(session)
        await session.commit()
        coupon_id = coupon.id

    async with local() as session:
        # empty emails -> early return
        res = await api.admin_bulk_assign_coupon(
            coupon_id,
            CouponBulkAssignRequest(emails=[]),
            bg,
            session=session,
            _=admin,
        )
        assert res.unique == 0

    async with local() as session:
        # coupon not found
        with pytest.raises(HTTPException, match="Coupon not found"):
            await api.admin_bulk_assign_coupon(
                uuid.uuid4(),
                CouponBulkAssignRequest(emails=["b1@a.com"]),
                bg,
                session=session,
                _=admin,
            )

    async with local() as session:
        res = await api.admin_bulk_assign_coupon(
            coupon_id,
            CouponBulkAssignRequest(
                emails=["b1@a.com", "b2@a.com", "ghost@a.com"], send_email=True
            ),
            bg,
            session=session,
            _=admin,
        )
        assert res.created == 2
        assert "ghost@a.com" in res.not_found_emails

    async with local() as session:
        # assign again -> already_active
        res = await api.admin_bulk_assign_coupon(
            coupon_id,
            CouponBulkAssignRequest(emails=["b1@a.com"], send_email=False),
            bg,
            session=session,
            _=admin,
        )
        assert res.already_active == 1

    async with local() as session:
        # bulk revoke
        res = await api.admin_bulk_revoke_coupon(
            coupon_id,
            CouponBulkRevokeRequest(
                emails=["b1@a.com", "b2@a.com"], reason="cleanup", send_email=True
            ),
            bg,
            session=session,
            _=admin,
        )
        assert res.revoked == 2

    async with local() as session:
        # revoke again -> already_revoked
        res = await api.admin_bulk_revoke_coupon(
            coupon_id,
            CouponBulkRevokeRequest(emails=["b1@a.com"], send_email=False),
            bg,
            session=session,
            _=admin,
        )
        assert res.already_revoked == 1

    async with local() as session:
        # bulk revoke empty + not found coupon
        res = await api.admin_bulk_revoke_coupon(
            coupon_id,
            CouponBulkRevokeRequest(emails=[]),
            bg,
            session=session,
            _=admin,
        )
        assert res.unique == 0
        with pytest.raises(HTTPException, match="Coupon not found"):
            await api.admin_bulk_revoke_coupon(
                uuid.uuid4(),
                CouponBulkRevokeRequest(emails=["b1@a.com"]),
                bg,
                session=session,
                _=admin,
            )

    async with local() as session:
        # bulk revoke an email never assigned -> not_assigned
        await _seed_user(session, email="b3@a.com")
        await session.commit()
    async with local() as session:
        res = await api.admin_bulk_revoke_coupon(
            coupon_id,
            CouponBulkRevokeRequest(emails=["b3@a.com"], send_email=False),
            bg,
            session=session,
            _=admin,
        )
        assert res.not_assigned == 1


@pytest.mark.anyio
async def test_bulk_assign_too_many() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    admin = _Admin()
    bg = BackgroundTasks()
    async with local() as session:
        promo, coupon = await _seed_promo_coupon(session)
        await session.commit()
        coupon_id = coupon.id

    too_many = [f"u{i}@a.com" for i in range(501)]
    async with local() as session:
        with pytest.raises(HTTPException, match="Too many"):
            await api.admin_bulk_assign_coupon(
                coupon_id,
                CouponBulkAssignRequest(emails=too_many),
                bg,
                session=session,
                _=admin,
            )
        with pytest.raises(HTTPException, match="Too many"):
            await api.admin_bulk_revoke_coupon(
                coupon_id,
                CouponBulkRevokeRequest(emails=too_many),
                bg,
                session=session,
                _=admin,
            )


# --------------------------------------------------------------------------- #
# Segment preview + jobs + background runner
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_segment_preview_assign_revoke() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    admin = _Admin()
    async with local() as session:
        u1 = await _seed_user(session, email="s1@a.com")
        await _seed_user(session, email="s2@a.com")
        promo, coupon = await _seed_promo_coupon(session)
        session.add(CouponAssignment(coupon_id=coupon.id, user_id=u1.id))
        await session.commit()
        coupon_id = coupon.id

    async with local() as session:
        # coupon not found
        with pytest.raises(HTTPException, match="Coupon not found"):
            await api.admin_preview_segment_assign(
                uuid.uuid4(),
                CouponBulkSegmentAssignRequest(),
                session=session,
                _=admin,
            )

    async with local() as session:
        # bad bucket config -> 400
        with pytest.raises(HTTPException, match="within bucket_total"):
            await api.admin_preview_segment_assign(
                coupon_id,
                CouponBulkSegmentAssignRequest(
                    bucket_total=2, bucket_index=5, bucket_seed="s"
                ),
                session=session,
                _=admin,
            )

    async with local() as session:
        # non-bucket preview assign
        prev = await api.admin_preview_segment_assign(
            coupon_id,
            CouponBulkSegmentAssignRequest(),
            session=session,
            _=admin,
        )
        assert prev.total_candidates == 2
        assert prev.already_active == 1

    async with local() as session:
        # bucket preview assign
        prev = await api.admin_preview_segment_assign(
            coupon_id,
            CouponBulkSegmentAssignRequest(
                bucket_total=2, bucket_index=0, bucket_seed="seed"
            ),
            session=session,
            _=admin,
        )
        assert prev.total_candidates >= 0

    async with local() as session:
        # revoke preview not found
        with pytest.raises(HTTPException, match="Coupon not found"):
            await api.admin_preview_segment_revoke(
                uuid.uuid4(),
                CouponBulkSegmentRevokeRequest(),
                session=session,
                _=admin,
            )

    async with local() as session:
        prev = await api.admin_preview_segment_revoke(
            coupon_id,
            CouponBulkSegmentRevokeRequest(),
            session=session,
            _=admin,
        )
        assert prev.revoked == 1

    async with local() as session:
        prev = await api.admin_preview_segment_revoke(
            coupon_id,
            CouponBulkSegmentRevokeRequest(
                bucket_total=2, bucket_index=0, bucket_seed="seed"
            ),
            session=session,
            _=admin,
        )
        assert prev.total_candidates >= 0


@pytest.mark.anyio
async def test_start_segment_jobs_and_run() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    admin = _Admin()
    bg = BackgroundTasks()
    async with local() as session:
        await _seed_user(session, email="j1@a.com", notify_marketing=True)
        await _seed_user(session, email="j2@a.com", notify_marketing=True)
        promo, coupon = await _seed_promo_coupon(session)
        await session.commit()
        coupon_id = coupon.id

    async with local() as session:
        # coupon not found
        with pytest.raises(HTTPException, match="Coupon not found"):
            await api.admin_start_segment_assign_job(
                uuid.uuid4(),
                CouponBulkSegmentAssignRequest(),
                bg,
                session=session,
                admin_user=admin,
            )
        # bad bucket config
        with pytest.raises(HTTPException, match="within bucket_total"):
            await api.admin_start_segment_assign_job(
                coupon_id,
                CouponBulkSegmentAssignRequest(
                    bucket_total=2, bucket_index=9, bucket_seed="s"
                ),
                bg,
                session=session,
                admin_user=admin,
            )

    async with local() as session:
        job = await api.admin_start_segment_assign_job(
            coupon_id,
            CouponBulkSegmentAssignRequest(send_email=True),
            bg,
            session=session,
            admin_user=admin,
        )
        assert job.status == CouponBulkJobStatus.pending
        assign_job_id = job.id

    async with local() as session:
        job = await api.admin_start_segment_revoke_job(
            coupon_id,
            CouponBulkSegmentRevokeRequest(reason="r"),
            bg,
            session=session,
            admin_user=admin,
        )
        revoke_job_id = job.id
        with pytest.raises(HTTPException, match="Coupon not found"):
            await api.admin_start_segment_revoke_job(
                uuid.uuid4(),
                CouponBulkSegmentRevokeRequest(),
                bg,
                session=session,
                admin_user=admin,
            )

    # Run the assign job end-to-end (background runner).
    await api._run_bulk_segment_job(engine, job_id=assign_job_id)
    async with local() as session:
        job = await session.get(CouponBulkJob, assign_job_id)
        assert job.status == CouponBulkJobStatus.succeeded
        assert job.created == 2

    # Run the revoke job (revokes the just-assigned users).
    await api._run_bulk_segment_job(engine, job_id=revoke_job_id)
    async with local() as session:
        job = await session.get(CouponBulkJob, revoke_job_id)
        assert job.status == CouponBulkJobStatus.succeeded


@pytest.mark.anyio
async def test_run_bulk_segment_job_edge_cases() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)

    # job not found -> early return
    await api._run_bulk_segment_job(engine, job_id=uuid.uuid4())

    async with local() as session:
        promo, coupon = await _seed_promo_coupon(session)
        # already-finished job -> early return on status guard
        done_job = CouponBulkJob(
            coupon_id=coupon.id,
            created_by_user_id=uuid.uuid4(),
            action=CouponBulkJobAction.assign,
            status=CouponBulkJobStatus.succeeded,
            send_email=False,
        )
        session.add(done_job)
        # cancelled-before-run job
        cancelled_job = CouponBulkJob(
            coupon_id=coupon.id,
            created_by_user_id=uuid.uuid4(),
            action=CouponBulkJobAction.assign,
            status=CouponBulkJobStatus.cancelled,
            send_email=False,
        )
        session.add(cancelled_job)
        await session.commit()
        done_id = done_job.id
        cancelled_id = cancelled_job.id

    await api._run_bulk_segment_job(engine, job_id=done_id)
    await api._run_bulk_segment_job(engine, job_id=cancelled_id)
    async with local() as session:
        assert (await session.get(CouponBulkJob, done_id)).status == (
            CouponBulkJobStatus.succeeded
        )


@pytest.mark.anyio
async def test_run_bulk_segment_job_cancelled_midway(monkeypatch, tmp_path) -> None:
    """Cancel the job after it starts running -> finished as cancelled.

    Uses a file-backed SQLite DB so a synchronous engine can flip the job status
    to cancelled from inside the (synchronous) ``_segment_user_filters`` seam,
    which the runner re-reads via ``session.refresh(job, ["status"])``.
    """
    from sqlalchemy import create_engine, update

    db_path = tmp_path / "cancel.db"
    url = f"sqlite+aiosqlite:///{db_path.as_posix()}"
    engine = create_async_engine(url, future=True)
    local = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False, autoflush=False
    )
    await _init(engine)
    async with local() as session:
        await _seed_user(session, email="c1@a.com", notify_marketing=True)
        promo, coupon = await _seed_promo_coupon(session)
        job = CouponBulkJob(
            coupon_id=coupon.id,
            created_by_user_id=uuid.uuid4(),
            action=CouponBulkJobAction.assign,
            status=CouponBulkJobStatus.pending,
            send_email=False,
        )
        session.add(job)
        await session.commit()
        job_id = job.id

    sync_engine = create_engine(f"sqlite:///{db_path.as_posix()}", future=True)
    original_filters = api._segment_user_filters

    def _cancel_then(payload):  # synchronous, matching the real signature
        with sync_engine.begin() as conn:
            conn.execute(
                update(CouponBulkJob)
                .where(CouponBulkJob.id == job_id)
                .values(status=CouponBulkJobStatus.cancelled)
            )
        return original_filters(payload)

    monkeypatch.setattr(api, "_segment_user_filters", _cancel_then)
    await api._run_bulk_segment_job(engine, job_id=job_id)
    sync_engine.dispose()
    await engine.dispose()
    engine2 = create_async_engine(url, future=True)
    local2 = async_sessionmaker(engine2, class_=AsyncSession, expire_on_commit=False)
    async with local2() as session:
        job = await session.get(CouponBulkJob, job_id)
        assert job.status == CouponBulkJobStatus.cancelled
    await engine2.dispose()


@pytest.mark.anyio
async def test_run_bulk_segment_job_failure(monkeypatch) -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        promo, coupon = await _seed_promo_coupon(session)
        job = CouponBulkJob(
            coupon_id=coupon.id,
            created_by_user_id=uuid.uuid4(),
            action=CouponBulkJobAction.assign,
            status=CouponBulkJobStatus.pending,
            send_email=False,
        )
        session.add(job)
        await session.commit()
        job_id = job.id

    def _boom(*args, **kwargs):
        raise RuntimeError("kaboom")

    monkeypatch.setattr(api, "_segment_user_filters", _boom)
    await api._run_bulk_segment_job(engine, job_id=job_id)
    async with local() as session:
        job = await session.get(CouponBulkJob, job_id)
        assert job.status == CouponBulkJobStatus.failed
        assert "kaboom" in (job.error_message or "")


# --------------------------------------------------------------------------- #
# bulk-job read / cancel / retry
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_bulk_job_get_list_cancel_retry() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    admin = _Admin()
    bg = BackgroundTasks()
    async with local() as session:
        await _seed_user(session, email="r1@a.com", notify_marketing=True)
        promo, coupon = await _seed_promo_coupon(session)
        job = CouponBulkJob(
            coupon_id=coupon.id,
            created_by_user_id=admin.id,
            action=CouponBulkJobAction.assign,
            status=CouponBulkJobStatus.pending,
            send_email=False,
        )
        session.add(job)
        await session.commit()
        coupon_id, job_id = coupon.id, job.id

    async with local() as session:
        with pytest.raises(HTTPException, match="Job not found"):
            await api.admin_get_bulk_job(uuid.uuid4(), session=session, _=admin)
        got = await api.admin_get_bulk_job(job_id, session=session, _=admin)
        assert got.id == job_id

    async with local() as session:
        glob = await api.admin_list_bulk_jobs_global(session=session, limit=10, _=admin)
        assert len(glob) == 1
        per = await api.admin_list_bulk_jobs(
            coupon_id, session=session, limit=10, _=admin
        )
        assert len(per) == 1

    async with local() as session:
        # cancel not found
        with pytest.raises(HTTPException, match="Job not found"):
            await api.admin_cancel_bulk_job(uuid.uuid4(), session=session, _=admin)
        # cancel pending job
        cancelled = await api.admin_cancel_bulk_job(job_id, session=session, _=admin)
        assert cancelled.status == CouponBulkJobStatus.cancelled
        # cancel an already-cancelled job -> short-circuit return
        again = await api.admin_cancel_bulk_job(job_id, session=session, _=admin)
        assert again.status == CouponBulkJobStatus.cancelled

    async with local() as session:
        # retry not found
        with pytest.raises(HTTPException, match="Job not found"):
            await api.admin_retry_bulk_job(
                uuid.uuid4(), bg, session=session, admin_user=admin
            )
        # retry a cancelled (finished) job -> creates new job
        new_job = await api.admin_retry_bulk_job(
            job_id, bg, session=session, admin_user=admin
        )
        assert new_job.status == CouponBulkJobStatus.pending


@pytest.mark.anyio
async def test_retry_in_progress_rejected() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    admin = _Admin()
    bg = BackgroundTasks()
    async with local() as session:
        promo, coupon = await _seed_promo_coupon(session)
        job = CouponBulkJob(
            coupon_id=coupon.id,
            created_by_user_id=admin.id,
            action=CouponBulkJobAction.revoke,
            status=CouponBulkJobStatus.running,
            send_email=False,
        )
        session.add(job)
        await session.commit()
        job_id = job.id

    async with local() as session:
        with pytest.raises(HTTPException, match="still in progress"):
            await api.admin_retry_bulk_job(
                job_id, bg, session=session, admin_user=admin
            )


@pytest.mark.anyio
async def test_retry_revoke_action_branch() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    admin = _Admin()
    bg = BackgroundTasks()
    async with local() as session:
        promo, coupon = await _seed_promo_coupon(session)
        job = CouponBulkJob(
            coupon_id=coupon.id,
            created_by_user_id=admin.id,
            action=CouponBulkJobAction.revoke,
            status=CouponBulkJobStatus.failed,
            send_email=False,
            revoke_reason="x",
        )
        session.add(job)
        await session.commit()
        job_id = job.id

    async with local() as session:
        new_job = await api.admin_retry_bulk_job(
            job_id, bg, session=session, admin_user=admin
        )
        assert new_job.action == CouponBulkJobAction.revoke


# --------------------------------------------------------------------------- #
# Analytics
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_admin_coupon_analytics() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    admin = _Admin()
    async with local() as session:
        category, product = await _seed_category_product(session)
        promo, coupon = await _seed_promo_coupon(session)
        order = Order(
            status=OrderStatus.paid,
            total_amount=Decimal("100"),
            currency="RON",
            tax_amount=0,
            shipping_amount=0,
            fee_amount=0,
            customer_email="o@a.com",
            customer_name="O",
            promo_code="SAVE10",
            created_at=datetime.now(UTC) - timedelta(days=1),
        )
        baseline = Order(
            status=OrderStatus.paid,
            total_amount=Decimal("80"),
            currency="RON",
            tax_amount=0,
            shipping_amount=0,
            fee_amount=0,
            customer_email="b@a.com",
            customer_name="B",
            promo_code=None,
            created_at=datetime.now(UTC) - timedelta(days=1),
        )
        session.add_all([order, baseline])
        await session.flush()
        session.add(
            OrderItem(
                order_id=order.id,
                product_id=product.id,
                quantity=2,
                shipped_quantity=0,
                unit_price=Decimal("50"),
                subtotal=Decimal("100"),
                created_at=datetime.now(UTC) - timedelta(days=1),
            )
        )
        redeemer = await _seed_user(session, email="redeemer@a.com")
        session.add(
            CouponRedemption(
                coupon_id=coupon.id,
                order_id=order.id,
                user_id=redeemer.id,
                discount_ron=Decimal("10"),
                shipping_discount_ron=Decimal("0"),
                redeemed_at=datetime.now(UTC) - timedelta(days=1),
            )
        )
        await session.commit()
        promo_id, coupon_id = promo.id, coupon.id

    async with local() as session:
        # promotion not found
        with pytest.raises(HTTPException, match="Promotion not found"):
            await api.admin_coupon_analytics(
                uuid.uuid4(),
                session=session,
                _=admin,
                coupon_id=None,
                days=30,
                top_limit=10,
            )

    async with local() as session:
        # coupon mismatch -> 404
        other_promo = Promotion(
            name="Other",
            discount_type=PromotionDiscountType.percent,
            percentage_off=Decimal("5"),
            is_active=True,
            is_automatic=False,
        )
        session.add(other_promo)
        await session.flush()
        with pytest.raises(HTTPException, match="Coupon not found"):
            await api.admin_coupon_analytics(
                other_promo.id,
                session=session,
                _=admin,
                coupon_id=coupon_id,
                days=30,
                top_limit=10,
            )

    async with local() as session:
        resp = await api.admin_coupon_analytics(
            promo_id,
            session=session,
            _=admin,
            coupon_id=coupon_id,
            days=30,
            top_limit=10,
        )
        assert resp.summary.redemptions == 1
        assert resp.summary.total_discount_ron == Decimal("10.00")
        assert len(resp.top_products) == 1
        assert resp.top_products[0].quantity == 2
        assert len(resp.daily) == 1


# --------------------------------------------------------------------------- #
# Gap-closing tests
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_create_promotion_scope_validation_errors() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    admin = _Admin()
    async with local() as session:
        with pytest.raises(HTTPException, match="products in scope do not exist"):
            await api.admin_create_promotion(
                PromotionCreate(
                    name="P",
                    discount_type="percent",
                    percentage_off=Decimal("5"),
                    included_product_ids=[uuid.uuid4()],
                ),
                session=session,
                _=admin,
            )

    async with local() as session:
        with pytest.raises(HTTPException, match="categories in scope do not exist"):
            await api.admin_create_promotion(
                PromotionCreate(
                    name="P",
                    discount_type="percent",
                    percentage_off=Decimal("5"),
                    included_category_ids=[uuid.uuid4()],
                ),
                session=session,
                _=admin,
            )


@pytest.mark.anyio
async def test_create_promotion_scope_overlap_errors() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    admin = _Admin()
    async with local() as session:
        category, product = await _seed_category_product(session)
        await session.commit()
        pid, cid = product.id, category.id

    async with local() as session:
        with pytest.raises(HTTPException, match="Products cannot be both"):
            await api.admin_create_promotion(
                PromotionCreate(
                    name="P",
                    discount_type="percent",
                    percentage_off=Decimal("5"),
                    included_product_ids=[pid],
                    excluded_product_ids=[pid],
                ),
                session=session,
                _=admin,
            )

    async with local() as session:
        with pytest.raises(HTTPException, match="Categories cannot be both"):
            await api.admin_create_promotion(
                PromotionCreate(
                    name="P",
                    discount_type="percent",
                    percentage_off=Decimal("5"),
                    included_category_ids=[cid],
                    excluded_category_ids=[cid],
                ),
                session=session,
                _=admin,
            )


@pytest.mark.anyio
async def test_create_promotion_all_scope_types() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    admin = _Admin()
    async with local() as session:
        cat_a = Category(slug="a", name="A", sort_order=1)
        cat_b = Category(slug="b", name="B", sort_order=2)
        session.add_all([cat_a, cat_b])
        await session.flush()
        p_in = Product(
            category_id=cat_a.id,
            slug="pin",
            sku="PIN",
            name="PIN",
            base_price=Decimal("10"),
            currency="RON",
            stock_quantity=5,
            status=ProductStatus.published,
        )
        p_ex = Product(
            category_id=cat_a.id,
            slug="pex",
            sku="PEX",
            name="PEX",
            base_price=Decimal("10"),
            currency="RON",
            stock_quantity=5,
            status=ProductStatus.published,
        )
        session.add_all([p_in, p_ex])
        await session.commit()
        ids = (p_in.id, p_ex.id, cat_a.id, cat_b.id)

    async with local() as session:
        created = await api.admin_create_promotion(
            PromotionCreate(
                name="Full",
                discount_type="percent",
                percentage_off=Decimal("5"),
                included_product_ids=[ids[0]],
                excluded_product_ids=[ids[1]],
                included_category_ids=[ids[2]],
                excluded_category_ids=[ids[3]],
            ),
            session=session,
            _=admin,
        )
        assert created.included_product_ids == [ids[0]]
        assert created.excluded_product_ids == [ids[1]]


@pytest.mark.anyio
async def test_update_promotion_free_shipping_and_key_dup() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    admin = _Admin()
    async with local() as session:
        other = Promotion(
            name="Other",
            key="TAKEN",
            discount_type=PromotionDiscountType.percent,
            percentage_off=Decimal("5"),
            is_active=True,
            is_automatic=False,
        )
        promo, _ = await _seed_promo_coupon(session)
        session.add(other)
        await session.commit()
        promo_id = promo.id

    async with local() as session:
        with pytest.raises(HTTPException, match="free_shipping promotions cannot"):
            await api.admin_update_promotion(
                promo_id,
                PromotionUpdate(discount_type="free_shipping"),
                session=session,
                _=admin,
            )

    async with local() as session:
        with pytest.raises(HTTPException, match="not both"):
            await api.admin_update_promotion(
                promo_id,
                PromotionUpdate(percentage_off=Decimal("5"), amount_off=Decimal("5")),
                session=session,
                _=admin,
            )

    async with local() as session:
        with pytest.raises(HTTPException, match="key already exists"):
            await api.admin_update_promotion(
                promo_id,
                PromotionUpdate(
                    key="TAKEN", discount_type="percent", percentage_off=Decimal("5")
                ),
                session=session,
                _=admin,
            )

    async with local() as session:
        updated = await api.admin_update_promotion(
            promo_id,
            PromotionUpdate(
                key="   ", discount_type="percent", percentage_off=Decimal("10")
            ),
            session=session,
            _=admin,
        )
        assert updated.key is None


@pytest.mark.anyio
async def test_create_coupon_code_validation() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    admin = _Admin()
    async with local() as session:
        promo, _ = await _seed_promo_coupon(session)
        await session.commit()
        promo_id = promo.id

    async with local() as session:
        # Whitespace-only code passes schema min_length but strips to empty -> 400.
        with pytest.raises(HTTPException, match="code is required"):
            await api.admin_create_coupon(
                CouponCreate(promotion_id=promo_id, code="   "),
                session=session,
                _=admin,
            )


@pytest.mark.anyio
async def test_bulk_job_runner_existing_assignments() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        active_user = await _seed_user(session, email="ra@a.com", notify_marketing=True)
        revoked_user = await _seed_user(
            session, email="rr@a.com", notify_marketing=True
        )
        await _seed_user(session, email="rf@a.com", notify_marketing=True)
        promo, coupon = await _seed_promo_coupon(session)
        session.add(CouponAssignment(coupon_id=coupon.id, user_id=active_user.id))
        session.add(
            CouponAssignment(
                coupon_id=coupon.id,
                user_id=revoked_user.id,
                revoked_at=datetime.now(UTC),
            )
        )
        assign_job = CouponBulkJob(
            coupon_id=coupon.id,
            created_by_user_id=uuid.uuid4(),
            action=CouponBulkJobAction.assign,
            status=CouponBulkJobStatus.pending,
            send_email=True,
        )
        session.add(assign_job)
        await session.commit()
        assign_job_id = assign_job.id
        coupon_id = coupon.id

    await api._run_bulk_segment_job(engine, job_id=assign_job_id)
    async with local() as session:
        job = await session.get(CouponBulkJob, assign_job_id)
        assert job.status == CouponBulkJobStatus.succeeded
        assert job.already_active == 1
        assert job.restored == 1
        assert job.created == 1

    async with local() as session:
        await _seed_user(session, email="rn@a.com", notify_marketing=True)
        revoke_job = CouponBulkJob(
            coupon_id=coupon_id,
            created_by_user_id=uuid.uuid4(),
            action=CouponBulkJobAction.revoke,
            status=CouponBulkJobStatus.pending,
            send_email=True,
            revoke_reason="cleanup",
        )
        session.add(revoke_job)
        await session.commit()
        revoke_job_id = revoke_job.id

    await api._run_bulk_segment_job(engine, job_id=revoke_job_id)
    async with local() as session:
        job = await session.get(CouponBulkJob, revoke_job_id)
        assert job.status == CouponBulkJobStatus.succeeded
        assert job.revoked >= 1
        assert job.not_assigned >= 1

    # Run the revoke job again -> already_revoked branch.
    async with local() as session:
        revoke_job2 = CouponBulkJob(
            coupon_id=coupon_id,
            created_by_user_id=uuid.uuid4(),
            action=CouponBulkJobAction.revoke,
            status=CouponBulkJobStatus.pending,
            send_email=False,
        )
        session.add(revoke_job2)
        await session.commit()
        revoke_job2_id = revoke_job2.id
    await api._run_bulk_segment_job(engine, job_id=revoke_job2_id)
    async with local() as session:
        job = await session.get(CouponBulkJob, revoke_job2_id)
        assert job.already_revoked >= 1


@pytest.mark.anyio
async def test_bulk_assign_revoke_send_email_paths() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    admin = _Admin()
    bg = BackgroundTasks()
    async with local() as session:
        await _seed_user(session, email="opt1@a.com", notify_marketing=False)
        await _seed_user(session, email="opt2@a.com", notify_marketing=True)
        promo, coupon = await _seed_promo_coupon(session)
        await session.commit()
        coupon_id = coupon.id

    async with local() as session:
        res = await api.admin_bulk_assign_coupon(
            coupon_id,
            CouponBulkAssignRequest(
                emails=["opt1@a.com", "opt2@a.com"], send_email=True
            ),
            bg,
            session=session,
            _=admin,
        )
        assert res.created == 2

    async with local() as session:
        res = await api.admin_bulk_revoke_coupon(
            coupon_id,
            CouponBulkRevokeRequest(
                emails=["opt1@a.com", "opt2@a.com"], send_email=True
            ),
            bg,
            session=session,
            _=admin,
        )
        assert res.revoked == 2


@pytest.mark.anyio
async def test_segment_jobs_bad_bucket_in_revoke_and_retry() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    admin = _Admin()
    bg = BackgroundTasks()
    async with local() as session:
        promo, coupon = await _seed_promo_coupon(session)
        bad_job = CouponBulkJob(
            coupon_id=coupon.id,
            created_by_user_id=admin.id,
            action=CouponBulkJobAction.assign,
            status=CouponBulkJobStatus.failed,
            send_email=False,
            bucket_total=2,
            bucket_index=5,
            bucket_seed="seed",
        )
        session.add(bad_job)
        await session.commit()
        coupon_id, bad_job_id = coupon.id, bad_job.id

    async with local() as session:
        with pytest.raises(HTTPException, match="within bucket_total"):
            await api.admin_start_segment_revoke_job(
                coupon_id,
                CouponBulkSegmentRevokeRequest(
                    bucket_total=2, bucket_index=9, bucket_seed="s"
                ),
                bg,
                session=session,
                admin_user=admin,
            )

    async with local() as session:
        with pytest.raises(HTTPException, match="within bucket_total"):
            await api.admin_retry_bulk_job(
                bad_job_id, bg, session=session, admin_user=admin
            )


@pytest.mark.anyio
async def test_eligibility_validate_with_shipping_method() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        user = await _seed_user(session, email="ship@a.com")
        await _seed_promo_coupon(session)
        sm = ShippingMethod(
            name="Courier", rate_flat=Decimal("15"), rate_per_kg=Decimal("2")
        )
        session.add(sm)
        await session.commit()
        user_id, sm_id = user.id, sm.id

    async with local() as session:
        user = await session.get(User, user_id)
        resp = await api.coupon_eligibility(
            session=session,
            current_user=user,
            shipping_method_id=sm_id,
            session_id=None,
        )
        assert hasattr(resp, "eligible")
        offer = await api.validate_coupon(
            CouponValidateRequest(code="SAVE10"),
            session=session,
            current_user=user,
            shipping_method_id=sm_id,
            session_id=None,
        )
        assert offer.coupon.code == "SAVE10"


@pytest.mark.anyio
async def test_analytics_without_coupon_id() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    admin = _Admin()
    async with local() as session:
        promo, _ = await _seed_promo_coupon(session)
        await session.commit()
        promo_id = promo.id

    async with local() as session:
        resp = await api.admin_coupon_analytics(
            promo_id, session=session, _=admin, coupon_id=None, days=7, top_limit=5
        )
        assert resp.summary.redemptions == 0
        assert resp.summary.avg_order_total_with_coupon is None
        assert resp.daily == []
        assert resp.top_products == []


@pytest.mark.anyio
async def test_update_promotion_switch_to_percent_missing_value() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    admin = _Admin()
    async with local() as session:
        promo = Promotion(
            name="FS",
            discount_type=PromotionDiscountType.free_shipping,
            is_active=True,
            is_automatic=False,
        )
        session.add(promo)
        await session.commit()
        promo_id = promo.id

    async with local() as session:
        # switch to percent without supplying percentage_off -> 400
        with pytest.raises(HTTPException, match="percentage_off is required"):
            await api.admin_update_promotion(
                promo_id,
                PromotionUpdate(discount_type="percent"),
                session=session,
                _=admin,
            )


@pytest.mark.anyio
async def test_issue_coupon_sends_email_for_optin_user() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    admin = _Admin()
    bg = BackgroundTasks()
    async with local() as session:
        user = await _seed_user(session, email="optin@a.com", notify_marketing=True)
        promo, _ = await _seed_promo_coupon(session)
        await session.commit()
        user_id, promo_id = user.id, promo.id

    async with local() as session:
        out = await api.admin_issue_coupon_to_user(
            CouponIssueToUserRequest(
                user_id=user_id, promotion_id=promo_id, send_email=True
            ),
            bg,
            session=session,
            actor=admin,
        )
        assert out.code
    # send_email branch queued a background task
    assert len(bg.tasks) >= 1


@pytest.mark.anyio
async def test_single_assign_restore_revoked() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    admin = _Admin()
    bg = BackgroundTasks()
    async with local() as session:
        user = await _seed_user(session, email="restore@a.com", notify_marketing=True)
        promo, coupon = await _seed_promo_coupon(session)
        session.add(
            CouponAssignment(
                coupon_id=coupon.id, user_id=user.id, revoked_at=datetime.now(UTC)
            )
        )
        await session.commit()
        coupon_id, user_id = coupon.id, user.id

    async with local() as session:
        r = await api.admin_assign_coupon(
            coupon_id,
            CouponAssignRequest(user_id=user_id, send_email=True),
            bg,
            session=session,
            _=admin,
        )
        assert r.status_code == 204
        assignment = (
            await session.execute(
                __import__("sqlalchemy")
                .select(CouponAssignment)
                .where(CouponAssignment.user_id == user_id)
            )
        ).scalar_one()
        assert assignment.revoked_at is None


@pytest.mark.anyio
async def test_bulk_revoke_user_not_in_map() -> None:
    """Bulk revoke where a normalized email has no matching user row."""
    engine, local = _make_engine_and_local()
    await _init(engine)
    admin = _Admin()
    bg = BackgroundTasks()
    async with local() as session:
        await _seed_user(session, email="present@a.com", notify_marketing=True)
        promo, coupon = await _seed_promo_coupon(session)
        session.add(
            CouponAssignment(
                coupon_id=coupon.id,
                user_id=(
                    await session.execute(__import__("sqlalchemy").select(User.id))
                ).scalar_one(),
            )
        )
        await session.commit()
        coupon_id = coupon.id

    async with local() as session:
        # "absent@a.com" is valid format but no user -> stays in not_found,
        # skipped inside the revoke loop (user is None -> continue).
        res = await api.admin_bulk_revoke_coupon(
            coupon_id,
            CouponBulkRevokeRequest(
                emails=["present@a.com", "absent@a.com"], send_email=False
            ),
            bg,
            session=session,
            _=admin,
        )
        assert "absent@a.com" in res.not_found_emails
        assert res.revoked == 1


@pytest.mark.anyio
async def test_bucket_preview_and_runner_with_assignments() -> None:
    """Bucket-mode preview + bucketed runner over users with mixed assignment
    states to hit the per-batch bucket branches."""
    engine, local = _make_engine_and_local()
    await _init(engine)
    admin = _Admin()
    seed = "bseed"
    total = 2

    async with local() as session:
        promo, coupon = await _seed_promo_coupon(session)
        coupon_id = coupon.id
        # Seed several users; figure out which fall in bucket index 0.
        users = []
        for i in range(12):
            u = await _seed_user(session, email=f"bk{i}@a.com", notify_marketing=True)
            users.append(u)
        await session.flush()
        # Give one in-bucket user an active assignment and one a revoked one.
        in_bucket = [
            u
            for u in users
            if api._bucket_index_for_user(user_id=u.id, seed=seed, total=total) == 0
        ]
        assert in_bucket, "need at least one user in bucket 0"
        session.add(CouponAssignment(coupon_id=coupon.id, user_id=in_bucket[0].id))
        if len(in_bucket) > 1:
            session.add(
                CouponAssignment(
                    coupon_id=coupon.id,
                    user_id=in_bucket[1].id,
                    revoked_at=datetime.now(UTC),
                )
            )
        await session.commit()

    async with local() as session:
        prev = await api.admin_preview_segment_assign(
            coupon_id,
            CouponBulkSegmentAssignRequest(
                bucket_total=total, bucket_index=0, bucket_seed=seed
            ),
            session=session,
            _=admin,
        )
        assert prev.already_active >= 1

    async with local() as session:
        prev = await api.admin_preview_segment_revoke(
            coupon_id,
            CouponBulkSegmentRevokeRequest(
                bucket_total=total, bucket_index=0, bucket_seed=seed
            ),
            session=session,
            _=admin,
        )
        assert prev.total_candidates >= 1

    # bucketed runner (assign) with send_email -> exercises bucket loop + notify
    async with local() as session:
        job = CouponBulkJob(
            coupon_id=coupon_id,
            created_by_user_id=uuid.uuid4(),
            action=CouponBulkJobAction.assign,
            status=CouponBulkJobStatus.pending,
            send_email=True,
            bucket_total=total,
            bucket_index=0,
            bucket_seed=seed,
            total_candidates=5,
        )
        session.add(job)
        await session.commit()
        job_id = job.id
    await api._run_bulk_segment_job(engine, job_id=job_id)
    async with local() as session:
        job = await session.get(CouponBulkJob, job_id)
        assert job.status == CouponBulkJobStatus.succeeded


@pytest.mark.anyio
async def test_bulk_assign_restores_revoked() -> None:
    """Bulk assign over a user with a revoked assignment hits the restored branch."""
    engine, local = _make_engine_and_local()
    await _init(engine)
    admin = _Admin()
    bg = BackgroundTasks()
    async with local() as session:
        user = await _seed_user(session, email="rev@a.com", notify_marketing=True)
        promo, coupon = await _seed_promo_coupon(session)
        session.add(
            CouponAssignment(
                coupon_id=coupon.id, user_id=user.id, revoked_at=datetime.now(UTC)
            )
        )
        await session.commit()
        coupon_id = coupon.id

    async with local() as session:
        res = await api.admin_bulk_assign_coupon(
            coupon_id,
            CouponBulkAssignRequest(emails=["rev@a.com"], send_email=True),
            bg,
            session=session,
            _=admin,
        )
        assert res.restored == 1


@pytest.mark.anyio
async def test_runner_no_email_bucket() -> None:
    """Bucketed runner with send_email False hits the false notify branch."""
    engine, local = _make_engine_and_local()
    await _init(engine)
    seed = "noemail"
    total = 100

    async with local() as session:
        promo, coupon = await _seed_promo_coupon(session)
        for i in range(6):
            await _seed_user(session, email=f"ne{i}@a.com", notify_marketing=True)
        await session.flush()
        users = (
            (await session.execute(__import__("sqlalchemy").select(User.id)))
            .scalars()
            .all()
        )
        idx = api._bucket_index_for_user(user_id=users[0], seed=seed, total=total)
        job = CouponBulkJob(
            coupon_id=coupon.id,
            created_by_user_id=uuid.uuid4(),
            action=CouponBulkJobAction.assign,
            status=CouponBulkJobStatus.pending,
            send_email=False,
            bucket_total=total,
            bucket_index=idx,
            bucket_seed=seed,
            total_candidates=1,
        )
        session.add(job)
        await session.commit()
        job_id = job.id

    await api._run_bulk_segment_job(engine, job_id=job_id)
    async with local() as session:
        job = await session.get(CouponBulkJob, job_id)
        assert job.status == CouponBulkJobStatus.succeeded
