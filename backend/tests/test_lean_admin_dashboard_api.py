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
from app.db.base import Base
from app.models.admin_dashboard_settings import AdminDashboardAlertThresholds
from app.models.user import User, UserRole
from app.schemas.user import UserCreate
from app.services.auth import create_user
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

    def __init__(self, ua: str = "pytest-agent", host: str | None = "127.0.0.1") -> None:
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
        pending = _mk_order(
            OrderStatus.pending_payment, "30", now - timedelta(hours=3)
        )
        test_order = _mk_order(OrderStatus.paid, "999", now - timedelta(hours=1))
        session.add_all([paid, refunded, pending, test_order])
        await session.flush()
        session.add(OrderTag(order_id=test_order.id, tag="test"))
        session.add(
            OrderRefund(
                order_id=refunded.id, amount=Decimal("20"), provider="stripe"
            )
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

        monkeypatch.setattr(
            ad.admin_reports_service, "send_report_now", fake_send
        )
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

        monkeypatch.setattr(
            ad.admin_reports_service, "send_report_now", fake_send
        )
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

        monkeypatch.setattr(
            ad.admin_reports_service, "send_report_now", fake_send
        )
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
                order_id=refunded.id, amount=Decimal("15"), provider="paypal",
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
        assert any(
            row["key"] == "stripe" for row in result["payment_methods"]
        )

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
        result = await ad.admin_payments_health(
            session=session, _=None, since_hours=24
        )
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
                payload={"utm_source": "Google", "utm_medium": "cpc", "utm_campaign": "spring"},
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
