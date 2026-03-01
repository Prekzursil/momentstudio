from __future__ import annotations
import asyncio

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException

from app.api.v1 import coupons as coupons_api
from app.models.coupons import CouponVisibility, PromotionDiscountType
from app.schemas.coupons import CouponIssueToUserRequest, CouponValidateRequest


class _Scalars:
    def __init__(self, rows: list[object]) -> None:
        self._rows = list(rows)

    def all(self) -> list[object]:
        return list(self._rows)

    def first(self) -> object | None:
        return self._rows[0] if self._rows else None


class _ExecResult:
    def __init__(self, *, rows: list[object] | None = None, all_rows: list[object] | None = None) -> None:
        self._rows = list(rows or [])
        self._all_rows = list(all_rows or [])

    def scalars(self) -> _Scalars:
        return _Scalars(self._rows)

    def all(self) -> list[object]:
        return list(self._all_rows)


class _CouponsSession:
    def __init__(self, *, execute_results: list[_ExecResult] | None = None, get_map: dict[UUID, object] | None = None) -> None:
        self.execute_results = list(execute_results or [])
        self.get_map = dict(get_map or {})
        self.added: list[object] = []
        self.commits = 0

    async def execute(self, _stmt: object) -> _ExecResult:
        await asyncio.sleep(0)
        if not self.execute_results:
            raise AssertionError("Unexpected execute() call")
        return self.execute_results.pop(0)

    async def get(self, _model: object, key: UUID) -> object | None:
        await asyncio.sleep(0)
        return self.get_map.get(key)

    def add(self, value: object) -> None:
        self.added.append(value)

    async def commit(self) -> None:
        await asyncio.sleep(0)
        self.commits += 1


@pytest.mark.anyio
async def test_coupons_scope_validation_and_replace_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    product_id = uuid4()
    category_id = uuid4()

    missing_product_session = _CouponsSession(execute_results=[_ExecResult(rows=[])])
    with pytest.raises(HTTPException, match="products in scope"):
        await coupons_api._validate_scope_ids(
            missing_product_session,
            product_ids={product_id},
            category_ids=set(),
        )

    missing_category_session = _CouponsSession(
        execute_results=[_ExecResult(rows=[product_id]), _ExecResult(rows=[])]
    )
    with pytest.raises(HTTPException, match="categories in scope"):
        await coupons_api._validate_scope_ids(
            missing_category_session,
            product_ids={product_id},
            category_ids={category_id},
        )

    valid_session = _CouponsSession(
        execute_results=[_ExecResult(rows=[product_id]), _ExecResult(rows=[category_id])]
    )
    await coupons_api._validate_scope_ids(
        valid_session,
        product_ids={product_id},
        category_ids={category_id},
    )

    with pytest.raises(HTTPException, match="included and excluded"):
        await coupons_api._replace_promotion_scopes(
            _CouponsSession(),
            promotion_id=uuid4(),
            include_product_ids=set(),
            exclude_product_ids=set(),
            include_category_ids={category_id},
            exclude_category_ids={category_id},
        )

    replace_session = _CouponsSession(execute_results=[_ExecResult(all_rows=[])])
    validate_calls: list[tuple[set[UUID], set[UUID]]] = []
    added_batches: list[tuple[object, object, set[UUID]]] = []

    async def _validate_stub(_session: object, *, product_ids: set[UUID], category_ids: set[UUID]) -> None:
        await asyncio.sleep(0)
        validate_calls.append((set(product_ids), set(category_ids)))

    def _add_scopes_stub(
        _session: object,
        *,
        promotion_id: UUID,
        entity_type: object,
        mode: object,
        entity_ids: set[UUID],
    ) -> None:
        added_batches.append((entity_type, mode, set(entity_ids)))

    monkeypatch.setattr(coupons_api, "_validate_scope_ids", _validate_stub)
    monkeypatch.setattr(coupons_api, "_add_promotion_scopes", _add_scopes_stub)

    include_product = uuid4()
    exclude_product = uuid4()
    include_category = uuid4()
    exclude_category = uuid4()

    await coupons_api._replace_promotion_scopes(
        replace_session,
        promotion_id=uuid4(),
        include_product_ids={include_product},
        exclude_product_ids={exclude_product},
        include_category_ids={include_category},
        exclude_category_ids={exclude_category},
    )

    assert validate_calls == [({include_product, exclude_product}, {include_category, exclude_category})]
    assert len(added_batches) == 4


@pytest.mark.anyio
async def test_coupons_eligibility_and_validation_wrappers(monkeypatch: pytest.MonkeyPatch) -> None:
    now = datetime.now(timezone.utc)
    user = SimpleNamespace(id=uuid4())
    session = object()
    promotion_id = uuid4()

    coupon = SimpleNamespace(
        id=uuid4(),
        promotion_id=promotion_id,
        code="SAVE10",
        starts_at=None,
        ends_at=None,
        visibility=CouponVisibility.public,
        is_active=True,
        global_max_redemptions=None,
        per_customer_max_redemptions=None,
        created_at=now,
        promotion=None,
    )
    eligibility = SimpleNamespace(
        coupon=coupon,
        estimated_discount_ron=Decimal("5.00"),
        estimated_shipping_discount_ron=Decimal("0.00"),
        eligible=True,
        reasons=["ok"],
        global_remaining=10,
        customer_remaining=2,
    )

    async def _get_cart(_session: object, _user_id: UUID, _session_id: str | None):
        await asyncio.sleep(0)
        return SimpleNamespace(items=[SimpleNamespace()])

    async def _get_settings(_session: object):
        await asyncio.sleep(0)
        return SimpleNamespace()

    async def _get_shipping(_session: object, _shipping_id: UUID | None):
        await asyncio.sleep(0)
        return SimpleNamespace(rate_flat=Decimal("8.00"), rate_per_kg=Decimal("1.50"))

    async def _evaluate_for_cart(*_args, **_kwargs):
        await asyncio.sleep(0)
        return [eligibility]

    monkeypatch.setattr(coupons_api.cart_service, "get_cart", _get_cart)
    monkeypatch.setattr(coupons_api.checkout_settings_service, "get_checkout_settings", _get_settings)
    monkeypatch.setattr(coupons_api, "_get_shipping_method", _get_shipping)
    monkeypatch.setattr(coupons_api.coupons_service, "evaluate_coupons_for_user_cart", _evaluate_for_cart)

    eligibility_response = await coupons_api.coupon_eligibility(
        session=session,
        current_user=user,
        shipping_method_id=None,
        session_id="sid-1",
    )
    assert len(eligibility_response.eligible) == 1
    assert len(eligibility_response.ineligible) == 0
    assert eligibility_response.eligible[0].coupon.code == "SAVE10"

    async def _coupon_not_found(_session: object, *, code: str):
        await asyncio.sleep(0)
        assert code == "BAD"
        return None

    monkeypatch.setattr(coupons_api.coupons_service, "get_coupon_by_code", _coupon_not_found)
    with pytest.raises(HTTPException, match="Coupon not found"):
        await coupons_api.validate_coupon(
            payload=CouponValidateRequest(code="bad"),
            session=session,
            current_user=user,
            shipping_method_id=None,
            session_id="sid-1",
        )

    async def _coupon_found(_session: object, *, code: str):
        await asyncio.sleep(0)
        assert code == "SAVE10"
        return coupon

    async def _evaluate_single(*_args, **_kwargs):
        await asyncio.sleep(0)
        return eligibility

    monkeypatch.setattr(coupons_api.coupons_service, "get_coupon_by_code", _coupon_found)
    monkeypatch.setattr(coupons_api.coupons_service, "evaluate_coupon_for_cart", _evaluate_single)

    offer = await coupons_api.validate_coupon(
        payload=CouponValidateRequest(code="save10"),
        session=session,
        current_user=user,
        shipping_method_id=None,
        session_id="sid-1",
    )
    assert offer.eligible is True
    assert offer.coupon.code == "SAVE10"


def test_coupons_issue_and_bulk_helpers() -> None:
    user = SimpleNamespace(notify_marketing=False, email="user@example.com")
    with pytest.raises(HTTPException, match="opted in"):
        coupons_api._resolve_issue_coupon_should_email(send_email=True, user=user)

    assert coupons_api._resolve_issue_coupon_should_email(send_email=False, user=user) is False

    now = datetime.now(timezone.utc)
    naive_ends = datetime(2026, 1, 5, 10, 0)
    normalized = coupons_api._normalize_issue_coupon_ends_at(
        ends_at=naive_ends,
        validity_days=None,
        starts_at=now,
    )
    assert normalized is not None and normalized.tzinfo is not None

    payload = CouponIssueToUserRequest(
        user_id=uuid4(),
        promotion_id=uuid4(),
        ends_at=now - timedelta(days=1),
        send_email=False,
    )
    with pytest.raises(HTTPException, match="must be in the future"):
        coupons_api._resolve_issue_coupon_ends_at_or_400(payload=payload, starts_at=now)

    session = _CouponsSession()
    active_assignment = SimpleNamespace(revoked_at=None, revoked_reason=None)
    revoked_assignment = SimpleNamespace(revoked_at=now, revoked_reason="old")

    assert (
        coupons_api._activate_coupon_assignment(
            session,
            coupon_id=uuid4(),
            user_id=uuid4(),
            assignment=active_assignment,
        )
        is False
    )
    assert (
        coupons_api._activate_coupon_assignment(
            session,
            coupon_id=uuid4(),
            user_id=uuid4(),
            assignment=revoked_assignment,
        )
        is True
    )
    assert revoked_assignment.revoked_at is None
    assert revoked_assignment.revoked_reason is None

    assert (
        coupons_api._activate_coupon_assignment(
            session,
            coupon_id=uuid4(),
            user_id=uuid4(),
            assignment=None,
        )
        is True
    )

    assert coupons_api._revoke_coupon_assignment(session, assignment=None, now=now, reason="x") is False
    assert coupons_api._revoke_coupon_assignment(
        session,
        assignment=SimpleNamespace(revoked_at=now, revoked_reason="existing"),
        now=now,
        reason="x",
    ) is False

    to_revoke = SimpleNamespace(revoked_at=None, revoked_reason=None)
    assert coupons_api._revoke_coupon_assignment(session, assignment=to_revoke, now=now, reason="expired") is True
    assert to_revoke.revoked_reason == "expired"

    with pytest.raises(HTTPException, match="Too many emails"):
        coupons_api._normalize_bulk_email_request([f"u{i}@example.com" for i in range(501)])

    assert coupons_api._trimmed_revoke_reason("  abc  ") == "abc"
    assert coupons_api._notification_revoke_reason("  ") is None

    empty_context = coupons_api._coupon_email_context(None)
    assert empty_context.promotion_name == "Coupon"


@pytest.mark.anyio
async def test_coupons_find_user_and_bulk_maps(monkeypatch: pytest.MonkeyPatch) -> None:
    user_id = uuid4()
    user = SimpleNamespace(id=user_id, email="x@example.com", notify_marketing=True, email_verified=True)

    with pytest.raises(HTTPException, match="Provide user_id or email"):
        await coupons_api._find_user(_CouponsSession(), user_id=None, email=None)

    not_found_session = _CouponsSession(get_map={})
    with pytest.raises(HTTPException, match="User not found"):
        await coupons_api._find_user(not_found_session, user_id=user_id, email=None)

    found_session = _CouponsSession(get_map={user_id: user})
    assert await coupons_api._find_user(found_session, user_id=user_id, email=None) is user

    email_found_session = _CouponsSession(execute_results=[_ExecResult(rows=[user])])
    assert await coupons_api._find_user(email_found_session, user_id=None, email="X@Example.com") is user

    email_missing_session = _CouponsSession(execute_results=[_ExecResult(rows=[])])
    with pytest.raises(HTTPException, match="User not found"):
        await coupons_api._find_user(email_missing_session, user_id=None, email="none@example.com")

    assert await coupons_api._users_by_email(_CouponsSession(), emails=[]) == {}
    assert await coupons_api._coupon_assignments_by_user_id(_CouponsSession(), coupon_id=uuid4(), user_ids=[]) == {}
    assert await coupons_api._coupon_assignment_status_by_user_id(_CouponsSession(), coupon_id=uuid4(), user_ids=[]) == {}

    payload = SimpleNamespace(require_marketing_opt_in=False, send_email=True, require_email_verified=True)
    filters = coupons_api._segment_user_filters(payload)
    assert len(filters) == 3

    bucket = coupons_api._parse_bucket_config(bucket_total=4, bucket_index=1, bucket_seed=" seed ")
    assert bucket is not None
    assert bucket.total == 4
    assert bucket.index == 1
    assert bucket.seed == "seed"

    rows_preview = [(uuid4(), "a@example.com"), (uuid4(), "b@example.com")]
    rows_job = [(uuid4(), "a@example.com", "en"), (uuid4(), "b@example.com", "ro")]

    monkeypatch.setattr(coupons_api, "_bucket_index_for_user", lambda **kwargs: 1 if kwargs["seed"] == "seed" else 0)

    filtered_preview = coupons_api._bucket_preview_rows(rows_preview, bucket=bucket)
    assert len(filtered_preview) == 2

    filtered_job = coupons_api._bucket_job_rows(rows_job, bucket=bucket)
    assert len(filtered_job) == 2

    sample: list[str] = []
    counts = coupons_api._preview_bucket_assignment_counts(
        bucketed=[(uuid4(), "new@example.com"), (uuid4(), "active@example.com"), (uuid4(), "restored@example.com")],
        status_by_user_id={},
        sample=sample,
    )
    assert counts[0] == 3
    assert sample[:2] == ["new@example.com", "active@example.com"]


@pytest.mark.anyio
async def test_coupons_analytics_top_products_paths() -> None:
    session_empty = _CouponsSession()
    assert await coupons_api._coupon_analytics_top_products(session_empty, order_discount_by_id={}, top_limit=5) == []

    product_id = uuid4()
    order_id = uuid4()
    session = _CouponsSession(
        execute_results=[
            _ExecResult(
                all_rows=[
                    (order_id, product_id, "slug-a", "Product A", 2, Decimal("40.00")),
                    (order_id, product_id, "slug-a", "Product A", 1, Decimal("20.00")),
                ]
            )
        ]
    )
    top = await coupons_api._coupon_analytics_top_products(
        session,
        order_discount_by_id={order_id: Decimal("12.00")},
        top_limit=5,
    )
    assert len(top) == 1
    assert top[0].product_id == product_id
    assert top[0].quantity == 3
    assert top[0].orders_count == 1

    session_no_aggregates = _CouponsSession(execute_results=[_ExecResult(all_rows=[(None, None, None, None, None, None)])])
    top_none = await coupons_api._coupon_analytics_top_products(
        session_no_aggregates,
        order_discount_by_id={uuid4(): Decimal("5.00")},
        top_limit=3,
    )
    assert top_none == []


def test_coupons_discount_validation_helper_edges() -> None:
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
            percentage_off=Decimal("10"),
            amount_off=Decimal("5"),
        )
