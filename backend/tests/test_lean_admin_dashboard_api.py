"""Direct-call unit coverage for ``app.api.v1.admin_dashboard``.

The dashboard router is exercised by calling the route handler coroutines
directly with an in-memory SQLite session and a constructed admin/owner
``User``, bypassing the ``require_admin*`` auth dependencies. This makes the
many aggregation queries and defensive error branches reachable without a full
HTTP request for each. External services (email, storage, exports, step-up)
are monkeypatched where the handler delegates to them.
"""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Callable

import pytest
from fastapi import HTTPException

from app.api.v1 import admin_dashboard as ad
from app.core.config import settings
from app.db.base import Base
from app.models.admin_dashboard_settings import AdminDashboardAlertThresholds
from app.models.user import User, UserRole
from app.schemas.user import UserCreate
from app.services.auth import create_user
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest.fixture
def session_factory() -> async_sessionmaker:
    import app.models  # noqa: F401

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def _init() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_init())
    return factory


def run(factory: async_sessionmaker, coro_fn: Callable[[Any], Any]) -> Any:
    async def _wrapped() -> Any:
        async with factory() as session:
            return await coro_fn(session)

    return asyncio.run(_wrapped())


async def _admin(session: Any, *, role: UserRole = UserRole.admin) -> User:
    user = await create_user(
        session,
        UserCreate(email=f"{role.value}@x.com", password="password123", name="Admin"),
    )
    user.role = role
    await session.commit()
    return user


class _FakeRequest:
    """Minimal stand-in for fastapi.Request used by audit-logging handlers."""

    def __init__(
        self, ua: str = "pytest-agent", host: str | None = "127.0.0.1"
    ) -> None:
        self.headers = {"user-agent": ua}
        self.client = type("C", (), {"host": host})() if host is not None else None


# ---------------------------------------------------------------------------
# alert thresholds (helpers + endpoints)
# ---------------------------------------------------------------------------


def test_get_dashboard_alert_thresholds_creates_then_reuses(
    session_factory: async_sessionmaker,
) -> None:
    async def scenario(session: Any) -> None:
        first = await ad._get_dashboard_alert_thresholds(session)
        assert first.key == "default"
        # Second call returns the existing record (early-return branch).
        second = await ad._get_dashboard_alert_thresholds(session)
        assert second.id == first.id

    run(session_factory, scenario)


def test_alert_thresholds_payload_with_and_without_pct(
    session_factory: async_sessionmaker,
) -> None:
    record = AdminDashboardAlertThresholds(
        key="default",
        failed_payments_min_count=2,
        failed_payments_min_delta_pct=Decimal("10.5"),
        refund_requests_min_count=3,
        refund_requests_min_rate_pct=Decimal("5.0"),
        stockouts_min_count=4,
    )
    payload = ad._dashboard_alert_thresholds_payload(record)
    assert payload["failed_payments_min_delta_pct"] == 10.5
    assert payload["refund_requests_min_rate_pct"] == 5.0

    bare = AdminDashboardAlertThresholds(key="default")
    bare.failed_payments_min_delta_pct = None
    bare.refund_requests_min_rate_pct = None
    payload2 = ad._dashboard_alert_thresholds_payload(bare)
    assert payload2["failed_payments_min_delta_pct"] is None
    assert payload2["refund_requests_min_rate_pct"] is None


def test_admin_get_alert_thresholds(session_factory: async_sessionmaker) -> None:
    async def scenario(session: Any) -> None:
        resp = await ad.admin_get_alert_thresholds(session=session, _=None)
        assert resp.failed_payments_min_count >= 1

    run(session_factory, scenario)


def test_admin_update_alert_thresholds(session_factory: async_sessionmaker) -> None:
    from app.schemas.admin_dashboard_alert_thresholds import (
        AdminDashboardAlertThresholdsUpdateRequest,
    )

    async def scenario(session: Any) -> None:
        owner = await _admin(session, role=UserRole.owner)
        payload = AdminDashboardAlertThresholdsUpdateRequest(
            failed_payments_min_count=5,
            failed_payments_min_delta_pct=12.0,
            refund_requests_min_count=6,
            refund_requests_min_rate_pct=7.5,
            stockouts_min_count=8,
        )
        resp = await ad.admin_update_alert_thresholds(
            payload=payload,
            request=_FakeRequest(),
            session=session,
            current_user=owner,
        )
        assert resp.failed_payments_min_count == 5
        assert resp.stockouts_min_count == 8

        # Null pct path
        payload2 = AdminDashboardAlertThresholdsUpdateRequest(
            failed_payments_min_count=1,
            failed_payments_min_delta_pct=None,
            refund_requests_min_count=1,
            refund_requests_min_rate_pct=None,
            stockouts_min_count=1,
        )
        resp2 = await ad.admin_update_alert_thresholds(
            payload=payload2,
            request=_FakeRequest(host=None),
            session=session,
            current_user=owner,
        )
        assert resp2.failed_payments_min_delta_pct is None

    run(session_factory, scenario)


# ---------------------------------------------------------------------------
# summary
# ---------------------------------------------------------------------------


def test_admin_summary_default_and_empty(
    session_factory: async_sessionmaker,
) -> None:
    async def scenario(session: Any) -> None:
        result = await ad.admin_summary(
            session=session, _=None, range_days=30, range_from=None, range_to=None
        )
        assert result["products"] == 0
        assert result["system"]["db_ready"] is True
        assert result["anomalies"]["stockouts"]["count"] == 0

    run(session_factory, scenario)


def test_admin_summary_range_validation(session_factory: async_sessionmaker) -> None:
    async def scenario(session: Any) -> None:
        # Only one of range_from/range_to provided.
        with pytest.raises(HTTPException) as exc:
            await ad.admin_summary(
                session=session,
                _=None,
                range_days=30,
                range_from=date(2024, 1, 1),
                range_to=None,
            )
        assert exc.value.status_code == 400
        # range_to before range_from.
        with pytest.raises(HTTPException) as exc2:
            await ad.admin_summary(
                session=session,
                _=None,
                range_days=30,
                range_from=date(2024, 2, 1),
                range_to=date(2024, 1, 1),
            )
        assert exc2.value.status_code == 400

    run(session_factory, scenario)


def test_admin_summary_explicit_range(session_factory: async_sessionmaker) -> None:
    async def scenario(session: Any) -> None:
        today = datetime.now(timezone.utc).date()
        result = await ad.admin_summary(
            session=session,
            _=None,
            range_days=30,
            range_from=today - timedelta(days=10),
            range_to=today,
        )
        assert result["range_days"] == 11

    run(session_factory, scenario)


def test_admin_summary_with_seeded_orders_and_alerts(
    session_factory: async_sessionmaker,
) -> None:
    from app.models.order import (
        Order,
        OrderRefund,
        OrderStatus,
        OrderTag,
    )
    from app.models.catalog import Category, Product
    from app.models.returns import ReturnRequest, ReturnRequestStatus

    async def scenario(session: Any) -> None:
        now = datetime.now(timezone.utc)
        buyer = await create_user(
            session,
            UserCreate(email="buyer@x.com", password="password123", name="Buyer"),
        )
        cat = Category(name="Cat", slug="cat", low_stock_threshold=5)
        session.add(cat)
        await session.flush()
        # Low-stock + stockout product.
        session.add(
            Product(
                name="Low",
                slug="low",
                base_price=Decimal("10"),
                stock_quantity=0,
                category_id=cat.id,
                is_active=True,
            )
        )
        await session.flush()

        def _mk_order(status_val: OrderStatus, amount: str, created: datetime) -> Order:
            return Order(
                user_id=buyer.id,
                status=status_val,
                total_amount=Decimal(amount),
                created_at=created,
                updated_at=created,
                payment_method="stripe",
                courier="dhl",
                delivery_type="home",
                customer_email="buyer@x.com",
                customer_name="Buyer",
            )

        paid = _mk_order(OrderStatus.paid, "100", now - timedelta(hours=1))
        refunded = _mk_order(OrderStatus.refunded, "50", now - timedelta(hours=2))
        pending = _mk_order(OrderStatus.pending_payment, "30", now - timedelta(hours=3))
        test_order = _mk_order(OrderStatus.paid, "999", now - timedelta(hours=1))
        session.add_all([paid, refunded, pending, test_order])
        await session.flush()
        session.add(OrderTag(order_id=test_order.id, tag="test"))
        session.add(
            OrderRefund(order_id=refunded.id, amount=Decimal("20"), provider="stripe")
        )
        session.add(
            ReturnRequest(
                order_id=paid.id,
                user_id=buyer.id,
                status=ReturnRequestStatus.requested,
                reason="damaged",
                created_at=now - timedelta(days=1),
                updated_at=now - timedelta(days=1),
            )
        )
        # Tighten thresholds so alerts fire.
        thresholds = await ad._get_dashboard_alert_thresholds(session)
        thresholds.failed_payments_min_count = 1
        thresholds.failed_payments_min_delta_pct = None
        thresholds.refund_requests_min_count = 1
        thresholds.refund_requests_min_rate_pct = None
        thresholds.stockouts_min_count = 1
        await session.commit()

        result = await ad.admin_summary(
            session=session, _=None, range_days=30, range_from=None, range_to=None
        )
        assert result["anomalies"]["stockouts"]["is_alert"] is True
        assert result["anomalies"]["failed_payments"]["is_alert"] is True

    run(session_factory, scenario)


# ---------------------------------------------------------------------------
# Shared range-validation behaviour across range-taking endpoints.
# ---------------------------------------------------------------------------

_RANGE_ENDPOINTS = [
    ad.admin_summary,
    ad.admin_funnel_metrics,
    ad.admin_channel_breakdown,
    ad.admin_channel_attribution,
]


@pytest.mark.parametrize("handler", _RANGE_ENDPOINTS)
def test_range_endpoints_validation(
    session_factory: async_sessionmaker, handler: Any
) -> None:
    async def scenario(session: Any) -> None:
        # Only one bound provided.
        with pytest.raises(HTTPException) as exc:
            await handler(
                session=session,
                _=None,
                range_days=30,
                range_from=date(2024, 1, 1),
                range_to=None,
            )
        assert exc.value.status_code == 400
        # range_to before range_from.
        with pytest.raises(HTTPException) as exc2:
            await handler(
                session=session,
                _=None,
                range_days=30,
                range_from=date(2024, 2, 1),
                range_to=date(2024, 1, 1),
            )
        assert exc2.value.status_code == 400

    run(session_factory, scenario)


@pytest.mark.parametrize("handler", _RANGE_ENDPOINTS)
def test_range_endpoints_explicit_range(
    session_factory: async_sessionmaker, handler: Any
) -> None:
    async def scenario(session: Any) -> None:
        today = datetime.now(timezone.utc).date()
        result = await handler(
            session=session,
            _=None,
            range_days=30,
            range_from=today - timedelta(days=5),
            range_to=today,
        )
        # Response shape differs (dict vs pydantic) — just assert it returns.
        assert result is not None

    run(session_factory, scenario)


# ---------------------------------------------------------------------------
# reports/send
# ---------------------------------------------------------------------------


def test_admin_send_scheduled_report_success(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def scenario(session: Any) -> None:
        admin = await _admin(session)

        async def fake_send(_session: Any, *, kind: str, force: bool) -> dict:
            return {"kind": kind, "force": force, "sent": True}

        monkeypatch.setattr(ad.admin_reports_service, "send_report_now", fake_send)
        result = await ad.admin_send_scheduled_report(
            request=_FakeRequest(),
            payload={"kind": "Daily", "force": True},
            session=session,
            current_user=admin,
        )
        assert result["sent"] is True

    run(session_factory, scenario)


def test_admin_send_scheduled_report_value_error(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def scenario(session: Any) -> None:
        admin = await _admin(session)

        async def fake_send(_session: Any, *, kind: str, force: bool) -> dict:
            raise ValueError("unknown kind")

        monkeypatch.setattr(ad.admin_reports_service, "send_report_now", fake_send)
        with pytest.raises(HTTPException) as exc:
            await ad.admin_send_scheduled_report(
                request=_FakeRequest(host=None),
                payload={"kind": "bad"},
                session=session,
                current_user=admin,
            )
        assert exc.value.status_code == 400

    run(session_factory, scenario)


def test_admin_send_scheduled_report_unexpected_error(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def scenario(session: Any) -> None:
        admin = await _admin(session)

        async def fake_send(_session: Any, *, kind: str, force: bool) -> dict:
            raise RuntimeError("boom")

        monkeypatch.setattr(ad.admin_reports_service, "send_report_now", fake_send)
        with pytest.raises(RuntimeError):
            await ad.admin_send_scheduled_report(
                request=_FakeRequest(),
                payload={"kind": "x", "force": False},
                session=session,
                current_user=admin,
            )

    run(session_factory, scenario)


# ---------------------------------------------------------------------------
# funnel / channel-breakdown / payments-health / refunds-breakdown
# ---------------------------------------------------------------------------


def test_admin_funnel_metrics_with_events(
    session_factory: async_sessionmaker,
) -> None:
    from app.models.analytics_event import AnalyticsEvent

    async def scenario(session: Any) -> None:
        now = datetime.now(timezone.utc)
        for event, sid in (
            ("session_start", "s1"),
            ("view_cart", "s1"),
            ("checkout_start", "s1"),
            ("checkout_success", "s1"),
        ):
            session.add(
                AnalyticsEvent(
                    event=event, session_id=sid, created_at=now - timedelta(hours=1)
                )
            )
        await session.commit()
        result = await ad.admin_funnel_metrics(
            session=session, _=None, range_days=30, range_from=None, range_to=None
        )
        assert result.counts.sessions == 1
        assert result.conversions.to_cart == 1.0

    run(session_factory, scenario)


def test_admin_funnel_metrics_empty_rates_none(
    session_factory: async_sessionmaker,
) -> None:
    async def scenario(session: Any) -> None:
        result = await ad.admin_funnel_metrics(
            session=session, _=None, range_days=30, range_from=None, range_to=None
        )
        assert result.conversions.to_cart is None

    run(session_factory, scenario)


def _seed_sales_orders(session: Any) -> Callable[[], Any]:
    """Returns a coroutine factory seeding orders/refunds for sales endpoints."""

    async def _seed() -> None:
        from app.models.order import Order, OrderRefund, OrderStatus

        now = datetime.now(timezone.utc)
        buyer = await create_user(
            session,
            UserCreate(email="sb@x.com", password="password123", name="SB"),
        )
        paid = Order(
            user_id=buyer.id,
            status=OrderStatus.paid,
            total_amount=Decimal("100"),
            created_at=now - timedelta(days=1),
            updated_at=now - timedelta(days=1),
            payment_method="stripe",
            courier="dhl",
            delivery_type="home",
            customer_email="sb@x.com",
            customer_name="SB",
        )
        refunded = Order(
            user_id=buyer.id,
            status=OrderStatus.refunded,
            total_amount=Decimal("40"),
            created_at=now - timedelta(days=1),
            updated_at=now - timedelta(days=1),
            payment_method="paypal",
            courier="fan",
            delivery_type="locker",
            customer_email="sb@x.com",
            customer_name="SB",
        )
        missing_refund = Order(
            user_id=buyer.id,
            status=OrderStatus.refunded,
            total_amount=Decimal("25"),
            created_at=now - timedelta(days=1),
            updated_at=now - timedelta(days=1),
            payment_method=None,
            customer_email="sb@x.com",
            customer_name="SB",
        )
        session.add_all([paid, refunded, missing_refund])
        await session.flush()
        session.add(
            OrderRefund(
                order_id=refunded.id,
                amount=Decimal("15"),
                provider="paypal",
                created_at=now - timedelta(days=1),
            )
        )
        await session.commit()

    return _seed


def test_admin_channel_breakdown_populated(
    session_factory: async_sessionmaker,
) -> None:
    async def scenario(session: Any) -> None:
        await _seed_sales_orders(session)()
        result = await ad.admin_channel_breakdown(
            session=session, _=None, range_days=30, range_from=None, range_to=None
        )
        assert any(row["key"] == "stripe" for row in result["payment_methods"])

    run(session_factory, scenario)


def test_admin_payments_health(session_factory: async_sessionmaker) -> None:
    from app.models.webhook import StripeWebhookEvent, PayPalWebhookEvent

    async def scenario(session: Any) -> None:
        await _seed_sales_orders(session)()
        now = datetime.now(timezone.utc)
        # Stripe error + backlog rows.
        session.add(
            StripeWebhookEvent(
                stripe_event_id="evt_err",
                event_type="payment_intent.failed",
                attempts=2,
                last_attempt_at=now - timedelta(hours=1),
                last_error="boom",
            )
        )
        session.add(
            StripeWebhookEvent(
                stripe_event_id="evt_backlog",
                event_type="x",
                attempts=1,
                last_attempt_at=now - timedelta(hours=1),
                last_error=None,
                processed_at=None,
            )
        )
        session.add(
            PayPalWebhookEvent(
                paypal_event_id="pp_err",
                event_type="y",
                attempts=1,
                last_attempt_at=now - timedelta(hours=1),
                last_error="bad",
            )
        )
        await session.commit()
        result = await ad.admin_payments_health(session=session, _=None, since_hours=24)
        providers = {p["provider"]: p for p in result["providers"]}
        assert providers["stripe"]["webhook_errors"] == 1
        assert providers["paypal"]["webhook_errors"] == 1
        assert len(result["recent_webhook_errors"]) >= 2

    run(session_factory, scenario)


def test_admin_refunds_breakdown(session_factory: async_sessionmaker) -> None:
    from app.models.order import Order, OrderRefund, OrderStatus
    from app.models.returns import ReturnRequest, ReturnRequestStatus

    async def scenario(session: Any) -> None:
        now = datetime.now(timezone.utc)
        buyer = await create_user(
            session,
            UserCreate(email="rb@x.com", password="password123", name="RB"),
        )
        order = Order(
            user_id=buyer.id,
            status=OrderStatus.refunded,
            total_amount=Decimal("100"),
            created_at=now - timedelta(days=2),
            updated_at=now - timedelta(days=2),
            payment_method="stripe",
            customer_email="rb@x.com",
            customer_name="RB",
        )
        session.add(order)
        await session.flush()
        session.add(
            OrderRefund(
                order_id=order.id,
                amount=Decimal("30"),
                provider="stripe",
                created_at=now - timedelta(days=2),
            )
        )
        # One refunded return for each reason category to exercise _reason_category.
        for reason in (
            "item was damaged",
            "wrong item sent",
            "not as described in picture",
            "size too big",
            "delivery was late",
            "changed my mind",
            "",
            "something else entirely",
        ):
            session.add(
                ReturnRequest(
                    order_id=order.id,
                    user_id=buyer.id,
                    status=ReturnRequestStatus.refunded,
                    reason=reason,
                    created_at=now - timedelta(days=2),
                    updated_at=now - timedelta(days=2),
                )
            )
        await session.commit()
        result = await ad.admin_refunds_breakdown(
            session=session, _=None, window_days=30
        )
        cats = {r["category"]: r["current"] for r in result["reasons"]}
        assert cats["damaged"] >= 1
        assert cats["wrong_item"] >= 1
        assert cats["changed_mind"] >= 1

    run(session_factory, scenario)


def test_admin_shipping_performance(session_factory: async_sessionmaker) -> None:
    from app.models.order import Order, OrderEvent, OrderStatus

    async def scenario(session: Any) -> None:
        now = datetime.now(timezone.utc)
        buyer = await create_user(
            session,
            UserCreate(email="sp@x.com", password="password123", name="SP"),
        )
        order = Order(
            user_id=buyer.id,
            status=OrderStatus.delivered,
            total_amount=Decimal("100"),
            created_at=now - timedelta(days=3),
            updated_at=now - timedelta(days=1),
            payment_method="stripe",
            courier="dhl",
            customer_email="sp@x.com",
            customer_name="SP",
        )
        session.add(order)
        await session.flush()
        session.add(
            OrderEvent(
                order_id=order.id,
                event="status_change",
                note="paid -> shipped",
                created_at=now - timedelta(days=2),
            )
        )
        session.add(
            OrderEvent(
                order_id=order.id,
                event="status_change",
                note="shipped -> delivered",
                created_at=now - timedelta(days=1),
            )
        )
        await session.commit()
        result = await ad.admin_shipping_performance(
            session=session, _=None, window_days=30
        )
        assert any(r["courier"] == "dhl" for r in result["time_to_ship"])
        assert any(r["courier"] == "dhl" for r in result["delivery_time"])

    run(session_factory, scenario)


def test_admin_stockout_impact_empty(session_factory: async_sessionmaker) -> None:
    async def scenario(session: Any) -> None:
        result = await ad.admin_stockout_impact(
            session=session, _=None, window_days=30, limit=8
        )
        assert result["items"] == []

    run(session_factory, scenario)


def test_admin_stockout_impact_populated(
    session_factory: async_sessionmaker,
) -> None:
    from app.models.catalog import Category, Product
    from app.models.order import Order, OrderItem, OrderStatus

    async def scenario(session: Any) -> None:
        now = datetime.now(timezone.utc)
        buyer = await create_user(
            session,
            UserCreate(email="si@x.com", password="password123", name="SI"),
        )
        cat = Category(name="C", slug="c", low_stock_threshold=5)
        session.add(cat)
        await session.flush()
        product = Product(
            name="Out",
            slug="out",
            base_price=Decimal("20"),
            stock_quantity=0,
            category_id=cat.id,
            is_active=True,
        )
        session.add(product)
        await session.flush()
        order = Order(
            user_id=buyer.id,
            status=OrderStatus.paid,
            total_amount=Decimal("40"),
            created_at=now - timedelta(days=1),
            updated_at=now - timedelta(days=1),
            payment_method="stripe",
            customer_email="si@x.com",
            customer_name="SI",
        )
        session.add(order)
        await session.flush()
        session.add(
            OrderItem(
                order_id=order.id,
                product_id=product.id,
                quantity=2,
                unit_price=Decimal("20"),
                subtotal=Decimal("40"),
            )
        )
        await session.commit()
        result = await ad.admin_stockout_impact(
            session=session, _=None, window_days=30, limit=8
        )
        assert len(result["items"]) >= 1
        assert result["items"][0]["demand_units"] == 2

    run(session_factory, scenario)


def test_admin_channel_attribution_empty(
    session_factory: async_sessionmaker,
) -> None:
    async def scenario(session: Any) -> None:
        result = await ad.admin_channel_attribution(
            session=session,
            _=None,
            range_days=30,
            range_from=None,
            range_to=None,
            limit=12,
        )
        assert result["channels"] == []
        assert result["coverage_pct"] is None

    run(session_factory, scenario)


def test_admin_channel_attribution_tracked(
    session_factory: async_sessionmaker,
) -> None:
    from app.models.analytics_event import AnalyticsEvent
    from app.models.order import Order, OrderStatus

    async def scenario(session: Any) -> None:
        now = datetime.now(timezone.utc)
        buyer = await create_user(
            session,
            UserCreate(email="ca@x.com", password="password123", name="CA"),
        )
        order = Order(
            user_id=buyer.id,
            status=OrderStatus.paid,
            total_amount=Decimal("100"),
            created_at=now - timedelta(days=1),
            updated_at=now - timedelta(days=1),
            payment_method="stripe",
            customer_email="ca@x.com",
            customer_name="CA",
        )
        session.add(order)
        await session.flush()
        session.add(
            AnalyticsEvent(
                event="checkout_success",
                session_id="sess-1",
                order_id=order.id,
                created_at=now - timedelta(days=1),
            )
        )
        session.add(
            AnalyticsEvent(
                event="session_start",
                session_id="sess-1",
                payload={
                    "utm_source": "Google",
                    "utm_medium": "cpc",
                    "utm_campaign": "spring",
                },
                created_at=now - timedelta(days=1, hours=1),
            )
        )
        await session.commit()
        result = await ad.admin_channel_attribution(
            session=session,
            _=None,
            range_days=30,
            range_from=None,
            range_to=None,
            limit=12,
        )
        assert result["tracked_orders"] == 1
        assert result["channels"][0]["source"] == "google"

    run(session_factory, scenario)


def test_admin_channel_attribution_direct(
    session_factory: async_sessionmaker,
) -> None:
    from app.models.analytics_event import AnalyticsEvent
    from app.models.order import Order, OrderStatus

    async def scenario(session: Any) -> None:
        now = datetime.now(timezone.utc)
        buyer = await create_user(
            session,
            UserCreate(email="cad@x.com", password="password123", name="CAD"),
        )
        order = Order(
            user_id=buyer.id,
            status=OrderStatus.paid,
            total_amount=Decimal("50"),
            created_at=now - timedelta(days=1),
            updated_at=now - timedelta(days=1),
            payment_method="stripe",
            customer_email="cad@x.com",
            customer_name="CAD",
        )
        session.add(order)
        await session.flush()
        session.add(
            AnalyticsEvent(
                event="checkout_success",
                session_id="sess-2",
                order_id=order.id,
                created_at=now - timedelta(days=1),
            )
        )
        # session_start with no utm payload -> "direct" channel branch.
        session.add(
            AnalyticsEvent(
                event="session_start",
                session_id="sess-2",
                payload={},
                created_at=now - timedelta(days=1, hours=1),
            )
        )
        await session.commit()
        result = await ad.admin_channel_attribution(
            session=session,
            _=None,
            range_days=30,
            range_from=None,
            range_to=None,
            limit=12,
        )
        assert result["channels"][0]["source"] == "direct"

    run(session_factory, scenario)


# ---------------------------------------------------------------------------
# global search / products / orders / users / segments / content / coupons
# ---------------------------------------------------------------------------


def _patch_pii_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    """Allow include_pii=True paths without real step-up/permission checks."""
    monkeypatch.setattr(ad.pii_service, "require_pii_reveal", lambda *a, **k: None)


async def _seed_product(session: Any, *, slug: str = "p1", name: str = "Prod") -> Any:
    from app.models.catalog import Category, Product

    cat = await session.scalar(select(Category).where(Category.slug == "cat"))
    if cat is None:
        cat = Category(name="Cat", slug="cat", low_stock_threshold=5)
        session.add(cat)
        await session.flush()
    product = Product(
        name=name,
        slug=slug,
        sku=f"SKU-{slug}",
        base_price=Decimal("20"),
        stock_quantity=3,
        category_id=cat.id,
        is_active=True,
    )
    session.add(product)
    await session.commit()
    await session.refresh(product)
    return product


def test_admin_global_search_blank(session_factory: async_sessionmaker) -> None:
    async def scenario(session: Any) -> None:
        admin = await _admin(session)
        resp = await ad.admin_global_search(
            request=_FakeRequest(),
            q="   ",
            include_pii=False,
            session=session,
            current_user=admin,
        )
        assert resp.items == []

    run(session_factory, scenario)


def test_admin_global_search_by_uuid(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.models.order import Order, OrderStatus

    async def scenario(session: Any) -> None:
        _patch_pii_ok(monkeypatch)
        admin = await _admin(session)
        product = await _seed_product(session)
        order = Order(
            user_id=admin.id,
            status=OrderStatus.paid,
            total_amount=Decimal("10"),
            payment_method="stripe",
            customer_email="admin@x.com",
            customer_name="Admin",
            reference_code="REF1",
        )
        session.add(order)
        await session.commit()
        resp = await ad.admin_global_search(
            request=_FakeRequest(),
            q=str(order.id),
            include_pii=True,
            session=session,
            current_user=admin,
        )
        assert any(i.type == "order" for i in resp.items)
        resp2 = await ad.admin_global_search(
            request=_FakeRequest(),
            q=str(product.id),
            include_pii=False,
            session=session,
            current_user=admin,
        )
        assert any(i.type == "product" for i in resp2.items)
        resp3 = await ad.admin_global_search(
            request=_FakeRequest(),
            q=str(admin.id),
            include_pii=False,
            session=session,
            current_user=admin,
        )
        assert any(i.type == "user" for i in resp3.items)

    run(session_factory, scenario)


def test_admin_global_search_by_text(session_factory: async_sessionmaker) -> None:
    from app.models.order import Order, OrderStatus

    async def scenario(session: Any) -> None:
        admin = await _admin(session)
        await _seed_product(session, slug="widget", name="Widget")
        order = Order(
            user_id=admin.id,
            status=OrderStatus.paid,
            total_amount=Decimal("10"),
            payment_method="stripe",
            customer_email="findme@x.com",
            customer_name="Find Me",
            reference_code="REFTEXT",
        )
        session.add(order)
        await session.commit()
        resp = await ad.admin_global_search(
            request=_FakeRequest(),
            q="widget",
            include_pii=False,
            session=session,
            current_user=admin,
        )
        assert any(i.type == "product" for i in resp.items)
        resp2 = await ad.admin_global_search(
            request=_FakeRequest(),
            q="findme",
            include_pii=False,
            session=session,
            current_user=admin,
        )
        assert any(i.type == "order" for i in resp2.items)
        resp3 = await ad.admin_global_search(
            request=_FakeRequest(),
            q="admin@x",
            include_pii=False,
            session=session,
            current_user=admin,
        )
        assert any(i.type == "user" for i in resp3.items)

    run(session_factory, scenario)


def test_admin_products_and_search(session_factory: async_sessionmaker) -> None:
    from app.models.catalog import ProductStatus

    async def scenario(session: Any) -> None:
        await _admin(session)
        await _seed_product(session, slug="prodx", name="ProdX")
        listing = await ad.admin_products(session=session, _=None)
        assert listing[0]["slug"] == "prodx"

        result = await ad.search_products(
            session=session,
            _=None,
            q="prodx",
            status=ProductStatus.draft,
            category_slug="cat",
            missing_translations=True,
            missing_translation_lang=None,
            deleted=False,
            page=1,
            limit=25,
        )
        assert result.meta.total_items >= 1
        result2 = await ad.search_products(
            session=session,
            _=None,
            q=None,
            status=None,
            category_slug=None,
            missing_translations=False,
            missing_translation_lang="en",
            deleted=False,
            page=1,
            limit=25,
        )
        assert result2.meta.page == 1

    run(session_factory, scenario)


def test_restore_product(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def scenario(session: Any) -> None:
        admin = await _admin(session)
        product = await _seed_product(session, slug="del", name="Del")
        with pytest.raises(HTTPException) as exc:
            await ad.restore_product(
                product_id=product.id, session=session, current_user=admin
            )
        assert exc.value.status_code == 404

        product.is_deleted = True
        await session.commit()

        async def fake_restore(_s: Any, prod: Any, *, user_id: Any) -> None:
            prod.is_deleted = False

        monkeypatch.setattr(
            ad.catalog_service, "restore_soft_deleted_product", fake_restore
        )
        restored = await ad.restore_product(
            product_id=product.id, session=session, current_user=admin
        )
        assert restored.slug == "del"

    run(session_factory, scenario)


def test_duplicate_check_products(session_factory: async_sessionmaker) -> None:
    async def scenario(session: Any) -> None:
        await _admin(session)
        await _seed_product(session, slug="dup-product", name="Dup Product")
        result = await ad.duplicate_check_products(
            session=session,
            _=None,
            name="Dup Product",
            sku="SKU-dup-product",
            exclude_slug="other-slug",
        )
        assert result.slug_base is not None
        assert result.suggested_slug is not None
        assert len(result.name_matches) >= 1
        empty = await ad.duplicate_check_products(
            session=session, _=None, name=None, sku=None, exclude_slug=None
        )
        assert empty.slug_base is None

    run(session_factory, scenario)


def test_duplicate_check_unique_name(session_factory: async_sessionmaker) -> None:
    async def scenario(session: Any) -> None:
        await _admin(session)
        result = await ad.duplicate_check_products(
            session=session,
            _=None,
            name="Totally Fresh Name",
            sku=None,
            exclude_slug=None,
        )
        assert result.suggested_slug == result.slug_base

    run(session_factory, scenario)


def test_products_by_ids(session_factory: async_sessionmaker) -> None:
    from app.schemas.catalog_admin import AdminProductByIdsRequest

    async def scenario(session: Any) -> None:
        await _admin(session)
        product = await _seed_product(session, slug="byid", name="ById")
        empty = await ad.products_by_ids(
            payload=AdminProductByIdsRequest(ids=[]), session=session, _=None
        )
        assert empty == []
        result = await ad.products_by_ids(
            payload=AdminProductByIdsRequest(ids=[product.id]),
            session=session,
            _=None,
        )
        assert result[0].slug == "byid"

    run(session_factory, scenario)


def test_products_by_ids_too_many(session_factory: async_sessionmaker) -> None:
    import uuid as _uuid

    from app.schemas.catalog_admin import AdminProductByIdsRequest

    async def scenario(session: Any) -> None:
        await _admin(session)
        ids = [_uuid.uuid4() for _ in range(201)]
        with pytest.raises(HTTPException) as exc:
            await ad.products_by_ids(
                payload=AdminProductByIdsRequest(ids=ids), session=session, _=None
            )
        assert exc.value.status_code == 400

    run(session_factory, scenario)


def test_admin_orders_and_users(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.models.order import Order, OrderStatus

    async def scenario(session: Any) -> None:
        admin = await _admin(session)
        order = Order(
            user_id=admin.id,
            status=OrderStatus.paid,
            total_amount=Decimal("10"),
            payment_method="stripe",
            customer_email="admin@x.com",
            customer_name="Admin",
        )
        guest = Order(
            user_id=None,
            status=OrderStatus.paid,
            total_amount=Decimal("5"),
            payment_method="stripe",
            customer_email="g@x.com",
            customer_name="Guest",
        )
        session.add_all([order, guest])
        await session.commit()
        masked = await ad.admin_orders(
            request=_FakeRequest(),
            include_pii=False,
            session=session,
            current_user=admin,
        )
        assert len(masked) == 2
        _patch_pii_ok(monkeypatch)
        revealed = await ad.admin_orders(
            request=_FakeRequest(),
            include_pii=True,
            session=session,
            current_user=admin,
        )
        assert len(revealed) == 2

        users_masked = await ad.admin_users(
            request=_FakeRequest(),
            include_pii=False,
            session=session,
            current_user=admin,
        )
        assert len(users_masked) >= 1
        users_revealed = await ad.admin_users(
            request=_FakeRequest(),
            include_pii=True,
            session=session,
            current_user=admin,
        )
        assert len(users_revealed) >= 1

    run(session_factory, scenario)


def test_search_users(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def scenario(session: Any) -> None:
        admin = await _admin(session)
        _patch_pii_ok(monkeypatch)
        result = await ad.search_users(
            request=_FakeRequest(),
            q="admin",
            role=UserRole.admin,
            page=1,
            limit=25,
            include_pii=True,
            session=session,
            current_user=admin,
        )
        assert result.meta.total_items >= 1

    run(session_factory, scenario)


def _seed_repeat_buyer(session: Any) -> Callable[[], Any]:
    async def _seed() -> Any:
        from app.models.order import Order, OrderStatus

        buyer = await create_user(
            session,
            UserCreate(email="rep@x.com", password="password123", name="Rep"),
        )
        buyer.role = UserRole.customer
        for _ in range(3):
            session.add(
                Order(
                    user_id=buyer.id,
                    status=OrderStatus.paid,
                    total_amount=Decimal("100"),
                    payment_method="stripe",
                    customer_email="rep@x.com",
                    customer_name="Rep",
                )
            )
        await session.commit()
        return buyer

    return _seed


def test_admin_user_segment_repeat_buyers(
    session_factory: async_sessionmaker,
) -> None:
    async def scenario(session: Any) -> None:
        owner = await _admin(session, role=UserRole.owner)
        await _seed_repeat_buyer(session)()
        result = await ad.admin_user_segment_repeat_buyers(
            request=_FakeRequest(),
            q="rep",
            min_orders=2,
            page=1,
            limit=25,
            include_pii=False,
            session=session,
            current_user=owner,
        )
        assert result.meta.total_items >= 1
        assert result.items[0].orders_count == 3

    run(session_factory, scenario)


def test_admin_user_segment_high_aov(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def scenario(session: Any) -> None:
        admin = await _admin(session)
        await _seed_repeat_buyer(session)()
        _patch_pii_ok(monkeypatch)
        result = await ad.admin_user_segment_high_aov(
            request=_FakeRequest(),
            q="rep",
            min_orders=1,
            min_aov=50.0,
            page=1,
            limit=25,
            include_pii=True,
            session=session,
            current_user=admin,
        )
        assert result.items[0].avg_order_value == 100.0

    run(session_factory, scenario)


def test_admin_user_aliases(session_factory: async_sessionmaker) -> None:
    import uuid as _uuid

    async def scenario(session: Any) -> None:
        admin = await _admin(session)
        target = await create_user(
            session,
            UserCreate(email="al@x.com", password="password123", name="Al"),
        )
        await session.commit()
        with pytest.raises(HTTPException) as exc:
            await ad.admin_user_aliases(
                user_id=_uuid.uuid4(),
                request=_FakeRequest(),
                include_pii=False,
                session=session,
                current_user=admin,
            )
        assert exc.value.status_code == 404
        result = await ad.admin_user_aliases(
            user_id=target.id,
            request=_FakeRequest(),
            include_pii=False,
            session=session,
            current_user=admin,
        )
        assert result["user"]["id"] == str(target.id)

    run(session_factory, scenario)


def test_admin_user_profile(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    import uuid as _uuid

    from app.models.address import Address
    from app.models.order import Order, OrderStatus

    async def scenario(session: Any) -> None:
        admin = await _admin(session)
        target = await create_user(
            session,
            UserCreate(email="pr@x.com", password="password123", name="Pr"),
        )
        await session.flush()
        session.add(
            Address(
                user_id=target.id,
                label="Home",
                phone="0712345678",
                line1="Str 1",
                line2="Ap 2",
                city="Buc",
                region="B",
                postal_code="010101",
                country="RO",
            )
        )
        session.add(
            Order(
                user_id=target.id,
                status=OrderStatus.paid,
                total_amount=Decimal("10"),
                payment_method="stripe",
                customer_email="pr@x.com",
                customer_name="Pr",
            )
        )
        await session.commit()
        with pytest.raises(HTTPException) as exc:
            await ad.admin_user_profile(
                user_id=_uuid.uuid4(),
                request=_FakeRequest(),
                include_pii=False,
                session=session,
                current_user=admin,
            )
        assert exc.value.status_code == 404
        masked = await ad.admin_user_profile(
            user_id=target.id,
            request=_FakeRequest(),
            include_pii=False,
            session=session,
            current_user=admin,
        )
        assert masked.user.id == target.id
        _patch_pii_ok(monkeypatch)
        revealed = await ad.admin_user_profile(
            user_id=target.id,
            request=_FakeRequest(),
            include_pii=True,
            session=session,
            current_user=admin,
        )
        assert revealed.user.email == "pr@x.com"

    run(session_factory, scenario)


def test_admin_content_and_coupons(session_factory: async_sessionmaker) -> None:
    from app.models.content import ContentBlock, ContentStatus
    from app.models.promo import PromoCode

    async def scenario(session: Any) -> None:
        author = await _admin(session)
        block = ContentBlock(
            key="blog.c1",
            title="C1",
            body_markdown="b",
            status=ContentStatus.published,
            author_id=author.id,
        )
        block_no_author = ContentBlock(
            key="blog.c2", title="C2", body_markdown="b", status=ContentStatus.draft
        )
        session.add_all([block, block_no_author])
        session.add(
            PromoCode(
                code="SAVE10",
                percentage_off=Decimal("10"),
                amount_off=None,
                active=True,
            )
        )
        session.add(
            PromoCode(
                code="OFF5",
                percentage_off=None,
                amount_off=Decimal("5"),
                active=True,
            )
        )
        await session.commit()
        content = await ad.admin_content(session=session, _=None)
        assert any(c["author"] is not None for c in content)
        assert any(c["author"] is None for c in content)
        coupons = await ad.admin_coupons(session=session, _=None)
        assert len(coupons) == 2

    run(session_factory, scenario)


# ---------------------------------------------------------------------------
# scheduled-tasks / coupon CRUD / audit / sessions
# ---------------------------------------------------------------------------


def test_scheduled_tasks_overview(session_factory: async_sessionmaker) -> None:
    from app.models.catalog import Category, Product, ProductStatus
    from app.models.coupons_v2 import Promotion, PromotionDiscountType

    async def scenario(session: Any) -> None:
        await _admin(session)
        now = datetime.now(timezone.utc)
        cat = Category(name="C", slug="c", low_stock_threshold=5)
        session.add(cat)
        await session.flush()
        session.add(
            Product(
                name="Sched",
                slug="sched",
                base_price=Decimal("20"),
                category_id=cat.id,
                is_active=True,
                status=ProductStatus.draft,
                sale_auto_publish=True,
                sale_start_at=now + timedelta(days=2),
                sale_end_at=now + timedelta(days=5),
            )
        )
        session.add(
            Promotion(
                name="Promo",
                discount_type=PromotionDiscountType.percent,
                percentage_off=Decimal("10"),
                is_active=True,
                starts_at=now + timedelta(days=1),
                ends_at=now + timedelta(days=10),
            )
        )
        await session.commit()
        result = await ad.scheduled_tasks_overview(session=session, _=None, limit=10)
        assert len(result.publish_schedules) >= 1
        assert len(result.promo_schedules) >= 1

    run(session_factory, scenario)


def test_admin_invalidate_coupon_stripe(
    session_factory: async_sessionmaker,
) -> None:
    import uuid as _uuid

    from app.models.promo import PromoCode, StripeCouponMapping

    async def scenario(session: Any) -> None:
        await _admin(session)
        with pytest.raises(HTTPException) as exc:
            await ad.admin_invalidate_coupon_stripe(
                coupon_id=_uuid.uuid4(), session=session, _=None
            )
        assert exc.value.status_code == 404

        promo = PromoCode(code="C1", active=True)
        session.add(promo)
        await session.flush()
        session.add(
            StripeCouponMapping(
                promo_code_id=promo.id,
                stripe_coupon_id="co_1",
                discount_cents=1000,
            )
        )
        await session.commit()
        result = await ad.admin_invalidate_coupon_stripe(
            coupon_id=promo.id, session=session, _=None
        )
        assert result["deleted_mappings"] == 1

    run(session_factory, scenario)


def test_admin_create_coupon(session_factory: async_sessionmaker) -> None:
    async def scenario(session: Any) -> None:
        await _admin(session)
        with pytest.raises(HTTPException) as exc:
            await ad.admin_create_coupon(payload={}, session=session, _=None)
        assert exc.value.status_code == 400
        with pytest.raises(HTTPException) as exc2:
            await ad.admin_create_coupon(
                payload={"code": "X", "currency": "usd"}, session=session, _=None
            )
        assert exc2.value.status_code == 400
        result = await ad.admin_create_coupon(
            payload={
                "code": "NEW10",
                "percentage_off": 10,
                "currency": "ron",
                "active": True,
            },
            session=session,
            _=None,
        )
        assert result["code"] == "NEW10"
        assert result["currency"] == "RON"

    run(session_factory, scenario)


def test_admin_update_coupon(session_factory: async_sessionmaker) -> None:
    import uuid as _uuid

    from app.models.promo import PromoCode

    async def scenario(session: Any) -> None:
        await _admin(session)
        with pytest.raises(HTTPException) as exc:
            await ad.admin_update_coupon(
                coupon_id=_uuid.uuid4(), payload={}, session=session, _=None
            )
        assert exc.value.status_code == 404

        promo = PromoCode(code="UPD", active=True)
        session.add(promo)
        await session.commit()
        # bad currency
        with pytest.raises(HTTPException) as exc2:
            await ad.admin_update_coupon(
                coupon_id=promo.id,
                payload={"currency": "usd"},
                session=session,
                _=None,
            )
        assert exc2.value.status_code == 400
        # valid update incl. currency=RON and fields, invalidate_stripe True
        result = await ad.admin_update_coupon(
            coupon_id=promo.id,
            payload={"percentage_off": 15, "active": False, "currency": "RON"},
            session=session,
            _=None,
        )
        assert result["currency"] == "RON"
        # currency cleared (falsy) branch
        result2 = await ad.admin_update_coupon(
            coupon_id=promo.id,
            payload={"currency": ""},
            session=session,
            _=None,
        )
        assert result2["currency"] is None

    run(session_factory, scenario)


def _seed_audit_rows(session: Any) -> Callable[[], Any]:
    async def _seed() -> Any:
        from app.models.catalog import Category, Product, ProductAuditLog
        from app.models.content import ContentAuditLog, ContentBlock, ContentStatus
        from app.models.user import AdminAuditLog

        actor = await create_user(
            session,
            UserCreate(email="actor@x.com", password="password123", name="Actor"),
        )
        cat = Category(name="C", slug="c", low_stock_threshold=5)
        session.add(cat)
        await session.flush()
        product = Product(
            name="P", slug="p", base_price=Decimal("10"), category_id=cat.id
        )
        block = ContentBlock(
            key="blog.b", title="B", body_markdown="x", status=ContentStatus.published
        )
        session.add_all([product, block])
        await session.flush()
        session.add(
            ProductAuditLog(
                product_id=product.id,
                action="update",
                user_id=actor.id,
                payload='{"ip": "192.168.1.1"}',
            )
        )
        session.add(
            ContentAuditLog(
                content_block_id=block.id,
                action="publish",
                version=1,
                user_id=actor.id,
            )
        )
        session.add(
            AdminAuditLog(
                action="user.update",
                actor_user_id=actor.id,
                subject_user_id=actor.id,
                data={"email": "actor@x.com", "ip": "10.0.0.1"},
            )
        )
        await session.commit()
        return actor

    return _seed


def test_admin_audit(session_factory: async_sessionmaker) -> None:
    async def scenario(session: Any) -> None:
        await _admin(session)
        await _seed_audit_rows(session)()
        result = await ad.admin_audit(session=session, _=None)
        assert len(result["products"]) >= 1
        assert len(result["content"]) >= 1
        assert len(result["security"]) >= 1

    run(session_factory, scenario)


def test_admin_audit_entries_filters(session_factory: async_sessionmaker) -> None:
    async def scenario(session: Any) -> None:
        await _admin(session)
        await _seed_audit_rows(session)()
        # entity=all, no filters
        result = await ad.admin_audit_entries(
            session=session,
            _=None,
            entity="all",
            action=None,
            user=None,
            page=1,
            limit=20,
        )
        assert result["meta"]["total_items"] >= 3
        # entity filter + single action token + user filter
        result2 = await ad.admin_audit_entries(
            session=session,
            _=None,
            entity="product",
            action="update",
            user="actor",
            page=1,
            limit=20,
        )
        assert result2["meta"]["total_items"] >= 1
        # multi-token action filter (the or_ branch)
        result3 = await ad.admin_audit_entries(
            session=session,
            _=None,
            entity="all",
            action="update|publish",
            user=None,
            page=1,
            limit=20,
        )
        assert result3["meta"]["total_items"] >= 2

    run(session_factory, scenario)


def test_audit_helpers() -> None:
    # _audit_mask_email
    assert ad._audit_mask_email("") == ""
    assert ad._audit_mask_email("noemail") == "noemail"
    assert ad._audit_mask_email("@domain.com") == "@domain.com"
    assert ad._audit_mask_email("a@x.com") == "*@x.com"
    masked = ad._audit_mask_email("alexander@example.com")
    assert masked.startswith("a") and masked.endswith("@example.com")
    # _audit_redact_text
    redacted = ad._audit_redact_text("mail a@b.com ip 1.2.3.4 v6 fe80::1")
    assert "a@b.com" not in redacted
    assert "***.***.***.***" in redacted
    # _audit_csv_cell formula injection
    assert ad._audit_csv_cell("=cmd()") == "'=cmd()"
    assert ad._audit_csv_cell("normal") == "normal"
    # _iso_to_dt
    assert ad._iso_to_dt(None) is None
    assert ad._iso_to_dt("not-a-date") is None
    assert ad._iso_to_dt("2024-01-01T00:00:00+00:00") is not None


def test_admin_audit_export_csv(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def scenario(session: Any) -> None:
        owner = await _admin(session, role=UserRole.owner)
        await _seed_audit_rows(session)()
        monkeypatch.setattr(ad.step_up_service, "require_step_up", lambda *a, **k: None)
        # redacted export
        resp = await ad.admin_audit_export_csv(
            request=_FakeRequest(),
            entity="all",
            action=None,
            user=None,
            redact=True,
            session=session,
            current_user=owner,
        )
        assert resp.media_type == "text/csv"
        assert "192.168" not in resp.body.decode()
        # unredacted as owner
        resp2 = await ad.admin_audit_export_csv(
            request=_FakeRequest(),
            entity="all",
            action=None,
            user=None,
            redact=False,
            session=session,
            current_user=owner,
        )
        assert resp2.media_type == "text/csv"

    run(session_factory, scenario)


def test_admin_audit_export_csv_forbidden(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def scenario(session: Any) -> None:
        admin = await _admin(session)
        monkeypatch.setattr(ad.step_up_service, "require_step_up", lambda *a, **k: None)
        with pytest.raises(HTTPException) as exc:
            await ad.admin_audit_export_csv(
                request=_FakeRequest(),
                entity="all",
                action=None,
                user=None,
                redact=False,
                session=session,
                current_user=admin,
            )
        assert exc.value.status_code == 403

    run(session_factory, scenario)


def test_admin_audit_retention(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def scenario(session: Any) -> None:
        await _admin(session)
        await _seed_audit_rows(session)()
        # Enable a retention policy so the cutoff branch runs.
        monkeypatch.setattr(settings, "audit_retention_days_product", 30, raising=False)
        monkeypatch.setattr(settings, "audit_retention_days_content", 0, raising=False)
        monkeypatch.setattr(settings, "audit_retention_days_security", 0, raising=False)
        result = await ad.admin_audit_retention(session=session, _=None)
        assert result["policies"]["product"]["enabled"] is True
        assert result["policies"]["content"]["enabled"] is False

    run(session_factory, scenario)


def test_admin_audit_retention_purge(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def scenario(session: Any) -> None:
        owner = await _admin(session, role=UserRole.owner)
        admin = await _admin(session)
        # not owner -> 403
        with pytest.raises(HTTPException) as exc:
            await ad.admin_audit_retention_purge(
                payload={"confirm": "PURGE"}, session=session, current_user=admin
            )
        assert exc.value.status_code == 403
        # missing confirm -> 400
        with pytest.raises(HTTPException) as exc2:
            await ad.admin_audit_retention_purge(
                payload={}, session=session, current_user=owner
            )
        assert exc2.value.status_code == 400
        # dry run -> no delete
        dry = await ad.admin_audit_retention_purge(
            payload={"confirm": "purge", "dry_run": True},
            session=session,
            current_user=owner,
        )
        assert dry["dry_run"] is True

    run(session_factory, scenario)


def test_admin_audit_retention_purge_executes(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.models.user import AdminAuditLog

    async def scenario(session: Any) -> None:
        owner = await _admin(session, role=UserRole.owner)
        old = datetime.now(timezone.utc) - timedelta(days=400)
        session.add(
            AdminAuditLog(action="old.event", actor_user_id=owner.id, created_at=old)
        )
        await session.commit()
        monkeypatch.setattr(
            settings, "audit_retention_days_security", 30, raising=False
        )
        monkeypatch.setattr(settings, "audit_retention_days_product", 0, raising=False)
        monkeypatch.setattr(settings, "audit_retention_days_content", 0, raising=False)
        result = await ad.admin_audit_retention_purge(
            payload={"confirm": "PURGE", "dry_run": False},
            session=session,
            current_user=owner,
        )
        assert result["deleted"]["security"] >= 1

    run(session_factory, scenario)


def test_revoke_sessions(session_factory: async_sessionmaker) -> None:
    import uuid as _uuid

    from app.models.user import RefreshSession

    async def scenario(session: Any) -> None:
        admin = await _admin(session)
        target = await create_user(
            session,
            UserCreate(email="rev@x.com", password="password123", name="Rev"),
        )
        await session.flush()
        session.add(
            RefreshSession(
                user_id=target.id,
                jti="jti-1",
                expires_at=datetime.now(timezone.utc) + timedelta(days=1),
                revoked=False,
            )
        )
        await session.commit()
        # not found
        with pytest.raises(HTTPException) as exc:
            await ad.revoke_sessions(
                user_id=_uuid.uuid4(),
                request=_FakeRequest(),
                session=session,
                current_user=admin,
            )
        assert exc.value.status_code == 404
        # revoke existing
        assert (
            await ad.revoke_sessions(
                user_id=target.id,
                request=_FakeRequest(),
                session=session,
                current_user=admin,
            )
            is None
        )

    run(session_factory, scenario)


def test_admin_list_user_sessions(session_factory: async_sessionmaker) -> None:
    import uuid as _uuid

    from app.models.user import RefreshSession

    async def scenario(session: Any) -> None:
        await _admin(session)
        target = await create_user(
            session,
            UserCreate(email="ls@x.com", password="password123", name="LS"),
        )
        await session.flush()
        # active + expired sessions
        session.add(
            RefreshSession(
                user_id=target.id,
                jti="jti-active",
                expires_at=datetime.now(timezone.utc) + timedelta(days=1),
                revoked=False,
            )
        )
        session.add(
            RefreshSession(
                user_id=target.id,
                jti="jti-expired",
                expires_at=datetime.now(timezone.utc) - timedelta(days=1),
                revoked=False,
            )
        )
        await session.commit()
        with pytest.raises(HTTPException) as exc:
            await ad.admin_list_user_sessions(
                user_id=_uuid.uuid4(), session=session, _=None
            )
        assert exc.value.status_code == 404
        result = await ad.admin_list_user_sessions(
            user_id=target.id, session=session, _=None
        )
        # Only the active one is returned (expired filtered out).
        assert len(result) == 1

    run(session_factory, scenario)


def test_admin_revoke_user_session(session_factory: async_sessionmaker) -> None:
    import uuid as _uuid

    from app.models.user import RefreshSession

    async def scenario(session: Any) -> None:
        admin = await _admin(session)
        target = await create_user(
            session,
            UserCreate(email="rs@x.com", password="password123", name="RS"),
        )
        await session.flush()
        refresh = RefreshSession(
            user_id=target.id,
            jti="jti-tok",
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
            revoked=False,
        )
        session.add(refresh)
        await session.commit()
        # user not found
        with pytest.raises(HTTPException) as exc:
            await ad.admin_revoke_user_session(
                user_id=_uuid.uuid4(),
                session_id=refresh.id,
                request=_FakeRequest(),
                session=session,
                current_user=admin,
            )
        assert exc.value.status_code == 404
        # session not found
        with pytest.raises(HTTPException) as exc2:
            await ad.admin_revoke_user_session(
                user_id=target.id,
                session_id=_uuid.uuid4(),
                request=_FakeRequest(),
                session=session,
                current_user=admin,
            )
        assert exc2.value.status_code == 404
        # revoke ok
        assert (
            await ad.admin_revoke_user_session(
                user_id=target.id,
                session_id=refresh.id,
                request=_FakeRequest(),
                session=session,
                current_user=admin,
            )
            is None
        )

    run(session_factory, scenario)
