"""Lean-gate unit coverage for ``app.services.webhook_handlers``.

Drives the Stripe dispute / checkout.session.completed / payment_intent
handlers and the PayPal CHECKOUT.ORDER.APPROVED handler against an in-memory DB
with the downstream services (coupons, promo usage, paypal capture, email,
checkout settings, owner lookup, notifications) stubbed, covering the order
state transitions, capture-idempotency, notification and email branches.
"""

from __future__ import annotations

import asyncio
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.core import security
from app.models.order import Order, OrderEvent, OrderStatus
from app.models.user import User, UserRole
from app.services import webhook_handlers as wh

from tests.conftest import make_memory_session_factory


class _BG:
    def __init__(self) -> None:
        self.tasks: list = []

    def add_task(self, func, *args, **kwargs) -> None:
        self.tasks.append((func, args, kwargs))


@pytest.fixture(autouse=True)
def _stub_services(monkeypatch):
    async def _noop(*a, **k):
        return None

    async def _owner(session):
        return None

    monkeypatch.setattr(wh.promo_usage, "record_promo_usage", _noop)
    monkeypatch.setattr(wh.coupons_service, "redeem_coupon_for_order", _noop)
    monkeypatch.setattr(wh.notification_service, "create_notification", _noop)
    monkeypatch.setattr(wh.auth_service, "get_owner_user", _owner)

    async def _settings(session):
        return SimpleNamespace(receipt_share_days=365)

    monkeypatch.setattr(
        wh.checkout_settings_service, "get_checkout_settings", _settings
    )
    monkeypatch.setattr(wh.settings, "admin_alert_email", "alerts@example.com", raising=False)
    yield


def _user(**kw) -> User:
    h = uuid4().hex
    defaults = dict(
        email=f"{h}@e.com",
        username=f"u_{h[:12]}",
        hashed_password=security.hash_password("pw123456"),
        role=UserRole.customer,
        preferred_language="ro",
    )
    defaults.update(kw)
    return User(**defaults)


def _order(**kw) -> Order:
    defaults = dict(
        status=OrderStatus.pending_payment,
        reference_code=f"REF{uuid4().hex[:6]}",
        customer_email="buyer@example.com",
        customer_name="Buyer",
        total_amount=Decimal("10.00"),
        tax_amount=Decimal("0.00"),
        shipping_amount=Decimal("0.00"),
        currency="RON",
    )
    defaults.update(kw)
    return Order(**defaults)


def test_process_stripe_dispute(monkeypatch) -> None:
    factory = make_memory_session_factory()
    bg = _BG()
    event = {
        "type": "charge.dispute.created",
        "data": {
            "object": {
                "id": "dp_1",
                "charge": "ch_1",
                "amount": 1000,
                "currency": "ron",
                "reason": "fraud",
                "status": "needs_response",
            }
        },
    }

    async def run() -> None:
        async with factory() as session:
            await wh.process_stripe_event(session, bg, event)

    asyncio.run(run())
    # admin_alert_email present -> a dispute notification task is queued.
    assert bg.tasks


def test_process_stripe_checkout_completed(monkeypatch) -> None:
    factory = make_memory_session_factory()
    bg = _BG()

    async def run() -> None:
        async with factory() as session:
            user = _user()
            order = _order(
                user=user,
                status=OrderStatus.pending_payment,
                stripe_checkout_session_id="cs_1",
            )
            session.add_all([user, order])
            await session.commit()

            event = {
                "type": "checkout.session.completed",
                "data": {
                    "object": {
                        "id": "cs_1",
                        "payment_intent": "pi_1",
                        "payment_status": "paid",
                    }
                },
            }
            await wh.process_stripe_event(session, bg, event)
            await session.refresh(order)
            assert order.status == OrderStatus.pending_acceptance
            assert order.stripe_payment_intent_id == "pi_1"

            # Re-running is idempotent (already captured -> no new capture event).
            await wh.process_stripe_event(session, bg, event)

    asyncio.run(run())
    # Customer confirmation + admin notification tasks queued.
    assert bg.tasks


def test_process_stripe_checkout_unpaid_ignored() -> None:
    factory = make_memory_session_factory()
    bg = _BG()

    async def run() -> None:
        async with factory() as session:
            order = _order(stripe_checkout_session_id="cs_2")
            session.add(order)
            await session.commit()
            event = {
                "type": "checkout.session.completed",
                "data": {
                    "object": {
                        "id": "cs_2",
                        "payment_intent": "pi_2",
                        "payment_status": "unpaid",
                    }
                },
            }
            await wh.process_stripe_event(session, bg, event)
            await session.refresh(order)
            assert order.status == OrderStatus.pending_payment

    asyncio.run(run())


def test_process_payment_intent_succeeded() -> None:
    factory = make_memory_session_factory()
    bg = _BG()

    async def run() -> None:
        async with factory() as session:
            user = _user(preferred_language="en")
            order = _order(
                user=user,
                status=OrderStatus.pending_payment,
                stripe_payment_intent_id="pi_x",
            )
            session.add_all([user, order])
            await session.commit()
            event = {
                "type": "payment_intent.succeeded",
                "data": {"object": {"id": "pi_x"}},
            }
            await wh.process_stripe_event(session, bg, event)
            await session.refresh(order)
            assert order.status == OrderStatus.pending_acceptance

    asyncio.run(run())


def test_process_paypal_approved(monkeypatch) -> None:
    factory = make_memory_session_factory()
    bg = _BG()

    async def _capture(*, paypal_order_id):
        return "CAPTURE123"

    monkeypatch.setattr(wh.paypal_service, "capture_order", _capture)

    async def run() -> None:
        async with factory() as session:
            user = _user()
            order = _order(
                user=user,
                status=OrderStatus.pending_payment,
                payment_method="paypal",
                paypal_order_id="PPO1",
            )
            session.add_all([user, order])
            await session.commit()
            event = {
                "event_type": "CHECKOUT.ORDER.APPROVED",
                "resource": {"id": "PPO1"},
            }
            await wh.process_paypal_event(session, bg, event)
            await session.refresh(order)
            assert order.status == OrderStatus.pending_acceptance
            assert order.paypal_capture_id == "CAPTURE123"

    asyncio.run(run())
    assert bg.tasks


def test_process_paypal_ignored_cases(monkeypatch) -> None:
    factory = make_memory_session_factory()
    bg = _BG()

    async def run() -> None:
        async with factory() as session:
            # Wrong event type -> early return.
            await wh.process_paypal_event(
                session, bg, {"event_type": "OTHER"}
            )
            # Approved but no resource id.
            await wh.process_paypal_event(
                session, bg, {"event_type": "CHECKOUT.ORDER.APPROVED", "resource": {}}
            )
            # Approved but no matching order.
            await wh.process_paypal_event(
                session,
                bg,
                {
                    "event_type": "CHECKOUT.ORDER.APPROVED",
                    "resource": {"id": "missing"},
                },
            )

            # Order exists but not a paypal order -> ignored.
            order = _order(payment_method="stripe", paypal_order_id="PPO2")
            session.add(order)
            await session.commit()
            await wh.process_paypal_event(
                session,
                bg,
                {
                    "event_type": "CHECKOUT.ORDER.APPROVED",
                    "resource": {"id": "PPO2"},
                },
            )
            await session.refresh(order)
            assert order.status == OrderStatus.pending_payment

            # Already-captured paypal order -> ignored.
            captured = _order(
                payment_method="paypal",
                paypal_order_id="PPO3",
                paypal_capture_id="CAP-EXISTING",
            )
            session.add(captured)
            await session.commit()
            await wh.process_paypal_event(
                session,
                bg,
                {
                    "event_type": "CHECKOUT.ORDER.APPROVED",
                    "resource": {"id": "PPO3"},
                },
            )

    asyncio.run(run())


def test_stripe_dispute_no_recipient(monkeypatch) -> None:
    # No owner and no admin alert email -> the notification branch is skipped.
    monkeypatch.setattr(wh.settings, "admin_alert_email", "", raising=False)
    factory = make_memory_session_factory()
    bg = _BG()
    event = {
        "type": "charge.dispute.closed",
        "data": {"object": {"id": "dp_2"}},
    }

    async def run() -> None:
        async with factory() as session:
            await wh.process_stripe_event(session, bg, event)

    asyncio.run(run())
    assert bg.tasks == []


def test_stripe_checkout_no_user_no_admin(monkeypatch) -> None:
    monkeypatch.setattr(wh.settings, "admin_alert_email", "", raising=False)
    factory = make_memory_session_factory()
    bg = _BG()

    async def run() -> None:
        async with factory() as session:
            # No user, no customer_email -> customer/admin email branches skipped.
            order = _order(
                stripe_checkout_session_id="cs_nu",
                customer_email="",
            )
            session.add(order)
            await session.commit()
            event = {
                "type": "checkout.session.completed",
                "data": {
                    "object": {
                        "id": "cs_nu",
                        "payment_intent": "pi_nu",
                        "payment_status": "paid",
                    }
                },
            }
            await wh.process_stripe_event(session, bg, event)
            await session.refresh(order)
            assert order.status == OrderStatus.pending_acceptance

    asyncio.run(run())


def test_stripe_checkout_order_not_found() -> None:
    factory = make_memory_session_factory()
    bg = _BG()

    async def run() -> None:
        async with factory() as session:
            event = {
                "type": "checkout.session.completed",
                "data": {
                    "object": {
                        "id": "cs_missing",
                        "payment_intent": "pi_m",
                        "payment_status": "paid",
                    }
                },
            }
            await wh.process_stripe_event(session, bg, event)

    asyncio.run(run())


def test_payment_intent_no_id_and_not_found() -> None:
    factory = make_memory_session_factory()
    bg = _BG()

    async def run() -> None:
        async with factory() as session:
            # No intent id -> skipped.
            await wh.process_stripe_event(
                session, bg, {"type": "payment_intent.succeeded", "data": {"object": {}}}
            )
            # Intent id with no matching order.
            await wh.process_stripe_event(
                session,
                bg,
                {
                    "type": "payment_intent.succeeded",
                    "data": {"object": {"id": "pi_none"}},
                },
            )

    asyncio.run(run())


def test_payment_intent_already_paid_no_user(monkeypatch) -> None:
    monkeypatch.setattr(wh.settings, "admin_alert_email", "", raising=False)
    factory = make_memory_session_factory()
    bg = _BG()

    async def run() -> None:
        async with factory() as session:
            # Already 'paid' status (not pending_payment) and no user.
            order = _order(
                status=OrderStatus.paid,
                stripe_payment_intent_id="pi_paid",
                customer_email="",
            )
            session.add(order)
            await session.commit()
            event = {
                "type": "payment_intent.succeeded",
                "data": {"object": {"id": "pi_paid"}},
            }
            await wh.process_stripe_event(session, bg, event)
            await session.refresh(order)
            assert order.status == OrderStatus.paid  # unchanged (was not pending)

    asyncio.run(run())


def test_payment_intent_rerun_idempotent() -> None:
    factory = make_memory_session_factory()
    bg = _BG()

    async def run() -> None:
        async with factory() as session:
            user = _user()
            order = _order(
                user=user,
                status=OrderStatus.pending_payment,
                stripe_payment_intent_id="pi_re",
            )
            session.add_all([user, order])
            await session.commit()
            event = {
                "type": "payment_intent.succeeded",
                "data": {"object": {"id": "pi_re"}},
            }
            # First run captures + transitions.
            await wh.process_stripe_event(session, bg, event)
            # Second run: already captured AND already accepted -> nothing
            # changes (242->246 / 268 captured_added False arcs).
            await wh.process_stripe_event(session, bg, event)
            await session.refresh(order)
            assert order.status == OrderStatus.pending_acceptance

    asyncio.run(run())


def test_payment_intent_already_captured_pending_payment() -> None:
    # already_captured True but status still pending_payment: capture block
    # skipped (217->231) while the status-change block runs.
    factory = make_memory_session_factory()
    bg = _BG()

    async def run() -> None:
        async with factory() as session:
            order = _order(
                status=OrderStatus.pending_payment,
                stripe_payment_intent_id="pi_pc",
                customer_email="",
            )
            session.add(order)
            await session.flush()
            session.add(
                OrderEvent(
                    order_id=order.id,
                    event="payment_captured",
                    note="prior",
                )
            )
            await session.commit()
            event = {
                "type": "payment_intent.succeeded",
                "data": {"object": {"id": "pi_pc"}},
            }
            await wh.process_stripe_event(session, bg, event)
            await session.refresh(order)
            assert order.status == OrderStatus.pending_acceptance

    asyncio.run(run())


def test_paypal_capture_returns_empty(monkeypatch) -> None:
    # capture_order returns an empty id -> the paypal_capture_id set branch is
    # skipped (357->360).
    async def _capture(*, paypal_order_id):
        return ""

    monkeypatch.setattr(wh.paypal_service, "capture_order", _capture)
    factory = make_memory_session_factory()
    bg = _BG()

    async def run() -> None:
        async with factory() as session:
            order = _order(
                status=OrderStatus.pending_payment,
                payment_method="paypal",
                paypal_order_id="PPO_EMPTY",
                customer_email="",
            )
            session.add(order)
            await session.commit()
            await wh.process_paypal_event(
                session,
                bg,
                {
                    "event_type": "CHECKOUT.ORDER.APPROVED",
                    "resource": {"id": "PPO_EMPTY"},
                },
            )
            await session.refresh(order)
            assert order.status == OrderStatus.pending_acceptance
            assert not (order.paypal_capture_id or "")

    asyncio.run(run())


def test_paypal_already_paid_status_no_user(monkeypatch) -> None:
    monkeypatch.setattr(wh.settings, "admin_alert_email", "", raising=False)

    async def _capture(*, paypal_order_id):
        return "CAP-NEW"

    monkeypatch.setattr(wh.paypal_service, "capture_order", _capture)
    factory = make_memory_session_factory()
    bg = _BG()

    async def run() -> None:
        async with factory() as session:
            # status 'paid' (not pending_payment) so the status-change branch is
            # skipped; no user so notification/email branches are skipped.
            order = _order(
                status=OrderStatus.paid,
                payment_method="paypal",
                paypal_order_id="PPO_PAID",
                customer_email="",
            )
            session.add(order)
            await session.commit()
            await wh.process_paypal_event(
                session,
                bg,
                {
                    "event_type": "CHECKOUT.ORDER.APPROVED",
                    "resource": {"id": "PPO_PAID"},
                },
            )
            await session.refresh(order)
            assert order.status == OrderStatus.paid

    asyncio.run(run())


def test_account_orders_url() -> None:
    order = SimpleNamespace(reference_code="REF 1", id=uuid4())
    assert wh._account_orders_url(order).startswith("/account/orders?q=")
