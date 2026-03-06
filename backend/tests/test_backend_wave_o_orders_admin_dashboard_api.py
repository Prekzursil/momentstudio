from __future__ import annotations
import asyncio

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import BackgroundTasks, HTTPException, Response
from starlette.requests import Request
from starlette.responses import StreamingResponse

from app.api.v1 import admin_dashboard as admin_dashboard_api
from app.api.v1 import orders as orders_api
from app.models.order import OrderStatus


def _make_request(*, headers: dict[str, str] | None = None) -> Request:
    raw_headers = [
        (key.lower().encode("latin-1"), value.encode("latin-1"))
        for key, value in (headers or {}).items()
    ]
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "GET",
        "scheme": "https",
        "path": "/",
        "query_string": b"",
        "headers": raw_headers,
        "client": ("127.0.0.1", 44321),
    }
    return Request(scope)


class _EmailRowsResult:
    def __init__(self, rows: list[object]) -> None:
        self._rows = rows

    def scalars(self) -> "_EmailRowsResult":
        return self

    def all(self) -> list[object]:
        return self._rows


class _EmailSession:
    def __init__(self, rows: list[object]) -> None:
        self._rows = rows

    async def execute(self, _stmt):
        await asyncio.sleep(0)
        return _EmailRowsResult(self._rows)


class _RecorderSession:
    def __init__(self) -> None:
        self.added: list[object] = []
        self.commits = 0
        self.refreshed: list[object] = []

    def add(self, obj: object) -> None:
        self.added.append(obj)

    async def commit(self) -> None:
        await asyncio.sleep(0)
        self.commits += 1

    async def refresh(self, obj: object) -> None:
        await asyncio.sleep(0)
        self.refreshed.append(obj)


@pytest.mark.anyio
async def test_orders_create_order_checkout_and_refresh_existing_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    cart = SimpleNamespace(id=uuid4(), items=[SimpleNamespace(id="item-1")])
    existing_order = SimpleNamespace(id=uuid4(), reference_code="REF-1")
    response = Response()

    async def _load_cart(*_args, **_kwargs):
        await asyncio.sleep(0)
        return cart

    async def _existing_order(*_args, **_kwargs):
        await asyncio.sleep(0)
        return existing_order

    monkeypatch.setattr(orders_api, "_load_user_cart_for_create_order", _load_cart)
    monkeypatch.setattr(orders_api, "_resolve_existing_cart_order", _existing_order)
    result = await orders_api.create_order(
        response=response,
        background_tasks=BackgroundTasks(),
        payload=SimpleNamespace(shipping_method_id=None),
        session=SimpleNamespace(),
        current_user=SimpleNamespace(id=uuid4(), email="user@example.com"),
    )
    assert result is existing_order
    assert response.status_code == 200

    # Cover `_refresh_existing_order_netopia_payment` commit/refresh branch.
    session = _RecorderSession()
    order = SimpleNamespace(netopia_ntp_id=None, netopia_payment_url=None)
    monkeypatch.setattr(orders_api, "_can_restart_existing_netopia_payment", lambda _order: True)

    async def _start_payment(*_args, **_kwargs):
        await asyncio.sleep(0)
        return ("ntp-1", "https://pay.example/ntp-1")

    monkeypatch.setattr(orders_api, "_start_netopia_payment_for_order", _start_payment)
    await orders_api._refresh_existing_order_netopia_payment(
        session,
        order,
        email="customer@example.com",
        phone="+40123",
        lang="en",
        base="https://shop.example",
    )
    assert order.netopia_ntp_id == "ntp-1"
    assert order.netopia_payment_url == "https://pay.example/ntp-1"
    assert session.commits == 1
    assert session.refreshed == [order]

    # Cover `/checkout` consent + existing response short-circuit.
    async def _required_versions(*_args, **_kwargs):
        await asyncio.sleep(0)
        return {"terms": 1}

    async def _accepted_versions(*_args, **_kwargs):
        await asyncio.sleep(0)
        return {}

    monkeypatch.setattr(orders_api.legal_consents_service, "required_doc_versions", _required_versions)
    monkeypatch.setattr(orders_api.legal_consents_service, "latest_accepted_versions", _accepted_versions)
    monkeypatch.setattr(orders_api.legal_consents_service, "is_satisfied", lambda *_args, **_kwargs: False)

    with pytest.raises(HTTPException) as consent_exc:
        await orders_api.checkout(
            payload=SimpleNamespace(accept_terms=False, accept_privacy=False),
            request=_make_request(headers={"origin": "https://shop.example"}),
            response=Response(),
            background_tasks=BackgroundTasks(),
            session=SimpleNamespace(),
            current_user=SimpleNamespace(id=uuid4(), email="user@example.com", preferred_language="en"),
            session_id="sid-1",
        )
    assert consent_exc.value.status_code == 400

    monkeypatch.setattr(orders_api.legal_consents_service, "is_satisfied", lambda *_args, **_kwargs: True)

    async def _get_cart(*_args, **_kwargs):
        await asyncio.sleep(0)
        return cart

    async def _existing_checkout(*_args, **_kwargs):
        await asyncio.sleep(0)
        return SimpleNamespace(order_id=uuid4(), reference_code="REF-X")

    monkeypatch.setattr(orders_api.cart_service, "get_cart", _get_cart)
    monkeypatch.setattr(orders_api, "_resolve_existing_checkout_response", _existing_checkout)
    checkout_response = Response()
    checkout_result = await orders_api.checkout(
        payload=SimpleNamespace(accept_terms=True, accept_privacy=True),
        request=_make_request(headers={"origin": "https://shop.example"}),
        response=checkout_response,
        background_tasks=BackgroundTasks(),
        session=SimpleNamespace(),
        current_user=SimpleNamespace(id=uuid4(), email="user@example.com", preferred_language="en"),
        session_id="sid-2",
    )
    assert checkout_response.status_code == 200
    assert checkout_result.reference_code == "REF-X"


@pytest.mark.anyio
async def test_orders_payment_confirmation_and_admin_export_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    # Cover `/paypal/capture` captured and non-captured branches.
    order_id = uuid4()
    current_user_id = uuid4()
    order = SimpleNamespace(
        id=order_id,
        user_id=current_user_id,
        reference_code="REF-CAP",
        payment_method="paypal",
        status=OrderStatus.pending_payment,
        paypal_capture_id="existing-capture",
    )

    async def _get_by_paypal(*_args, **_kwargs):
        await asyncio.sleep(0)
        return order

    monkeypatch.setattr(orders_api, "_get_order_by_paypal_order_id_for_confirmation", _get_by_paypal)
    capture_response = await orders_api.capture_paypal_order(
        payload=SimpleNamespace(paypal_order_id="paypal-1", order_id=order_id),
        background_tasks=BackgroundTasks(),
        session=SimpleNamespace(),
        current_user=SimpleNamespace(id=current_user_id),
    )
    assert capture_response.paypal_capture_id == "existing-capture"

    order.paypal_capture_id = None

    async def _resolve_capture(*_args, **_kwargs):
        await asyncio.sleep(0)
        return "capture-123"

    async def _noop_finalize(*_args, **_kwargs):
        await asyncio.sleep(0)
        return True

    async def _noop_redeem(*_args, **_kwargs):
        await asyncio.sleep(0)
        return None

    async def _noop_queue(*_args, **_kwargs):
        await asyncio.sleep(0)
        return None

    monkeypatch.setattr(orders_api, "_resolve_paypal_capture_id", _resolve_capture)
    monkeypatch.setattr(orders_api, "_finalize_order_after_payment_capture", _noop_finalize)
    monkeypatch.setattr(orders_api.coupons_service, "redeem_coupon_for_order", _noop_redeem)
    monkeypatch.setattr(orders_api, "_queue_payment_capture_notifications", _noop_queue)
    capture_response = await orders_api.capture_paypal_order(
        payload=SimpleNamespace(paypal_order_id="paypal-2", order_id=order_id),
        background_tasks=BackgroundTasks(),
        session=SimpleNamespace(),
        current_user=SimpleNamespace(id=current_user_id),
    )
    assert capture_response.paypal_capture_id == "capture-123"

    # Cover `/stripe/confirm` queue branch.
    stripe_order = SimpleNamespace(id=uuid4(), reference_code="REF-STR", status=OrderStatus.pending_payment)

    async def _get_by_stripe(*_args, **_kwargs):
        await asyncio.sleep(0)
        return stripe_order

    monkeypatch.setattr(orders_api, "is_mock_payments", lambda: False)
    monkeypatch.setattr(orders_api, "_retrieve_paid_stripe_session", lambda *_args, **_kwargs: {"id": "sess-1"})
    monkeypatch.setattr(orders_api, "_get_order_by_stripe_session_id", _get_by_stripe)
    monkeypatch.setattr(orders_api, "_assert_confirmation_order_match", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(orders_api, "_assert_confirmation_access", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(orders_api, "_apply_stripe_confirmation_outcome", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(orders_api, "_order_has_payment_captured", lambda *_args, **_kwargs: False)
    monkeypatch.setattr(orders_api, "_finalize_order_after_payment_capture", _noop_finalize)
    monkeypatch.setattr(orders_api.coupons_service, "redeem_coupon_for_order", _noop_redeem)
    monkeypatch.setattr(orders_api, "_queue_payment_capture_notifications", _noop_queue)
    stripe_response = await orders_api.confirm_stripe_checkout(
        payload=SimpleNamespace(session_id="sess-1", order_id=stripe_order.id),
        background_tasks=BackgroundTasks(),
        session=SimpleNamespace(),
        current_user=SimpleNamespace(id=current_user_id),
    )
    assert stripe_response.reference_code == "REF-STR"

    # Cover `/netopia/confirm` guard and success branch.
    async def _get_by_id_guard(*_args, **_kwargs):
        await asyncio.sleep(0)
        return SimpleNamespace(
            id=uuid4(),
            user_id=current_user_id,
            payment_method="paypal",
            status=OrderStatus.pending_payment,
            reference_code="REF-GUARD",
        )

    monkeypatch.setattr(orders_api, "_get_order_by_id_for_confirmation", _get_by_id_guard)
    with pytest.raises(HTTPException):
        await orders_api.confirm_netopia_payment(
            payload=SimpleNamespace(order_id=uuid4(), ntp_id="ntp-guard"),
            background_tasks=BackgroundTasks(),
            session=SimpleNamespace(),
            current_user=SimpleNamespace(id=current_user_id),
        )

    netopia_order = SimpleNamespace(
        id=uuid4(),
        reference_code="REF-NET",
        payment_method="netopia",
        status=OrderStatus.pending_payment,
    )

    async def _get_by_id(*_args, **_kwargs):
        await asyncio.sleep(0)
        return netopia_order

    async def _netopia_status(*_args, **_kwargs):
        await asyncio.sleep(0)
        return {"payment": {"status": 5}, "error": {"code": "00"}}

    monkeypatch.setattr(orders_api, "_get_order_by_id_for_confirmation", _get_by_id)
    monkeypatch.setattr(orders_api, "_assert_confirmation_access", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(orders_api, "_netopia_confirmation_transaction_id", lambda *_args, **_kwargs: "ntp-1")
    monkeypatch.setattr(orders_api, "_order_has_payment_captured", lambda *_args, **_kwargs: False)
    monkeypatch.setattr(orders_api.netopia_service, "get_status", _netopia_status)
    monkeypatch.setattr(orders_api, "_finalize_order_after_payment_capture", _noop_finalize)
    netopia_response = await orders_api.confirm_netopia_payment(
        payload=SimpleNamespace(order_id=netopia_order.id, ntp_id="ntp-1"),
        background_tasks=BackgroundTasks(),
        session=SimpleNamespace(),
        current_user=SimpleNamespace(id=current_user_id),
    )
    assert netopia_response.reference_code == "REF-NET"

    # Cover `/admin/export` and `/admin/exports`.
    async def _list_orders(*_args, **_kwargs):
        await asyncio.sleep(0)
        return [SimpleNamespace(reference_code="REF-CSV", id=uuid4())]

    monkeypatch.setattr(orders_api.step_up_service, "require_step_up", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(orders_api.order_service, "list_orders", _list_orders)
    export_response = await orders_api.admin_export_orders(
        request=_make_request(),
        columns=["reference_code"],
        include_pii=False,
        session=SimpleNamespace(),
        admin=SimpleNamespace(id=uuid4(), email="admin@example.com"),
    )
    assert isinstance(export_response, StreamingResponse)
    assert "orders.csv" in export_response.headers.get("content-disposition", "")

    async def _list_exports(*_args, **_kwargs):
        await asyncio.sleep(0)
        export = SimpleNamespace(
            id=uuid4(),
            kind=SimpleNamespace(value="packing_slips"),
            filename="packing-slips.pdf",
            mime_type="application/pdf",
            created_at=datetime.now(timezone.utc),
            expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
            order_id=uuid4(),
            order_ids=[uuid4(), uuid4()],
        )
        return [(export, "REF-LIST")], 1

    monkeypatch.setattr(orders_api.order_exports_service, "list_exports", _list_exports)
    exports_payload = await orders_api.admin_list_document_exports(
        page=1,
        limit=20,
        session=SimpleNamespace(),
        _=SimpleNamespace(id=uuid4()),
    )
    assert exports_payload.meta.total_items == 1
    assert exports_payload.items[0].order_count == 2


@pytest.mark.anyio
async def test_orders_email_verification_and_admin_email_events_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    # Cover `/admin/{order_id}/email-events` no-email and masked-email branches.
    order_id = uuid4()
    order_without_email = SimpleNamespace(customer_email=None, user=None, reference_code="REF-0")

    async def _order_by_id(*_args, **_kwargs):
        await asyncio.sleep(0)
        return order_without_email

    monkeypatch.setattr(orders_api.order_service, "get_order_by_id_admin", _order_by_id)
    empty_events = await orders_api.admin_list_order_email_events(
        order_id=order_id,
        request=_make_request(),
        include_pii=False,
        limit=10,
        since_hours=24,
        session=_EmailSession([]),
        admin=SimpleNamespace(id=uuid4(), email="admin@example.com"),
    )
    assert empty_events == []

    order_with_email = SimpleNamespace(
        customer_email="customer@example.com",
        user=SimpleNamespace(email="customer@example.com"),
        reference_code="REF-EMAIL",
    )

    async def _order_with_email_fn(*_args, **_kwargs):
        await asyncio.sleep(0)
        return order_with_email

    monkeypatch.setattr(orders_api.order_service, "get_order_by_id_admin", _order_with_email_fn)
    monkeypatch.setattr(orders_api.pii_service, "mask_email", lambda value: f"MASK:{value}")
    rows = [SimpleNamespace(id=uuid4(), subject="Subj", status="sent", error_message=None, created_at=datetime.now(timezone.utc))]
    masked_events = await orders_api.admin_list_order_email_events(
        order_id=order_id,
        request=_make_request(),
        include_pii=False,
        limit=10,
        since_hours=24,
        session=_EmailSession(rows),
        admin=SimpleNamespace(id=uuid4(), email="admin@example.com"),
    )
    assert masked_events[0].to_email.startswith("MASK:")

    # Cover guest email request/confirm/status guards and success.
    cart = SimpleNamespace(
        id=uuid4(),
        items=[SimpleNamespace(id="item-1")],
        guest_email=None,
        guest_email_verification_token=None,
        guest_email_verification_expires_at=None,
        guest_email_verified_at=None,
        guest_email_verification_attempts=0,
        guest_email_verification_last_attempt_at=None,
    )
    session = _RecorderSession()

    async def _cart_get(*_args, **_kwargs):
        await asyncio.sleep(0)
        return cart

    async def _email_taken(*_args, **_kwargs):
        await asyncio.sleep(0)
        return False

    monkeypatch.setattr(orders_api.cart_service, "get_cart", _cart_get)
    monkeypatch.setattr(orders_api.auth_service, "is_email_taken", _email_taken)
    monkeypatch.setattr(orders_api, "_generate_guest_email_token", lambda: "654321")
    request_result = await orders_api.request_guest_email_verification(
        payload=SimpleNamespace(email="guest@example.com"),
        background_tasks=BackgroundTasks(),
        session=session,
        session_id="sid-verify",
        lang="en",
    )
    assert request_result.sent is True
    assert cart.guest_email == "guest@example.com"

    # Confirm path with token mismatch.
    with pytest.raises(HTTPException):
        await orders_api.confirm_guest_email_verification(
            payload=SimpleNamespace(email="guest@example.com", token="000000"),
            session=session,
            session_id="sid-verify",
        )

    cart.guest_email_verification_token = "654321"
    cart.guest_email_verification_expires_at = datetime.now(timezone.utc) + timedelta(minutes=20)
    confirm_result = await orders_api.confirm_guest_email_verification(
        payload=SimpleNamespace(email="guest@example.com", token="654321"),
        session=session,
        session_id="sid-verify",
    )
    assert confirm_result.verified is True
    status_result = await orders_api.guest_email_verification_status(session=session, session_id="sid-verify")
    assert status_result.verified is True


@pytest.mark.anyio
async def test_admin_dashboard_summary_channel_and_search_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    # Cover `_summary_sales_metrics` and `_summary_day_metrics` late return fields.
    class _ScalarSession:
        def __init__(self, values: list[object]) -> None:
            self._values = list(values)

        async def scalar(self, _stmt):
            await asyncio.sleep(0)
            return self._values.pop(0)

    scalar_session = _ScalarSession([100, 120, 10, 5, 7])
    sales = await admin_dashboard_api._summary_sales_metrics(
        scalar_session,
        datetime.now(timezone.utc) - timedelta(days=1),
        datetime.now(timezone.utc),
        (OrderStatus.paid,),
        (OrderStatus.paid, OrderStatus.refunded),
        True,
    )
    assert sales["sales"] == pytest.approx(100.0)
    assert sales["net_sales"] == pytest.approx(105.0)
    assert sales["orders"] == 7

    async def _sales_metrics(*_args, **_kwargs):
        await asyncio.sleep(0)
        return {"orders": 4, "sales": 30.0, "gross_sales": 30.0, "net_sales": 26.0}

    async def _refund_counts(*_args, **_kwargs):
        await asyncio.sleep(0)
        return 2

    monkeypatch.setattr(admin_dashboard_api, "_summary_sales_metrics", _sales_metrics)
    monkeypatch.setattr(admin_dashboard_api, "_summary_refunded_order_count", _refund_counts)
    day_payload = await admin_dashboard_api._summary_day_metrics(
        SimpleNamespace(),
        datetime.now(timezone.utc),
        (OrderStatus.paid,),
        (OrderStatus.paid, OrderStatus.refunded),
        True,
    )
    assert day_payload["today_orders"] == 4
    assert day_payload["today_refunds"] == 2
    assert day_payload["net_today_sales"] == pytest.approx(26.0)

    # Cover `_channel_breakdown_items` return branch.
    async def _gross_rows(*_args, **_kwargs):
        await asyncio.sleep(0)
        return [("online", 3, 120)]

    async def _refund_rows(*_args, **_kwargs):
        await asyncio.sleep(0)
        return [("online", 20)]

    async def _missing_rows(*_args, **_kwargs):
        await asyncio.sleep(0)
        return [("online", 10)]

    monkeypatch.setattr(admin_dashboard_api, "_channel_gross_rows", _gross_rows)
    monkeypatch.setattr(admin_dashboard_api, "_channel_refunds_rows", _refund_rows)
    monkeypatch.setattr(admin_dashboard_api, "_channel_missing_refunds_rows", _missing_rows)
    breakdown = await admin_dashboard_api._channel_breakdown_items(
        SimpleNamespace(),
        datetime.now(timezone.utc) - timedelta(days=7),
        datetime.now(timezone.utc),
        (OrderStatus.paid,),
        True,
        col="channel",
    )
    assert breakdown[0]["key"] == "online"
    assert breakdown[0]["orders"] == 3

    # Cover `_global_search_by_text` aggregation.
    async def _orders_text(*_args, **_kwargs):
        await asyncio.sleep(0)
        return [SimpleNamespace(type="order", id="o1")]

    async def _products_text(*_args, **_kwargs):
        await asyncio.sleep(0)
        return [SimpleNamespace(type="product", id="p1")]

    async def _users_text(*_args, **_kwargs):
        await asyncio.sleep(0)
        return [SimpleNamespace(type="user", id="u1")]

    monkeypatch.setattr(admin_dashboard_api, "_global_search_orders_by_text", _orders_text)
    monkeypatch.setattr(admin_dashboard_api, "_global_search_products_by_text", _products_text)
    monkeypatch.setattr(admin_dashboard_api, "_global_search_users_by_text", _users_text)
    search_rows = await admin_dashboard_api._global_search_by_text(SimpleNamespace(), "needle", include_pii=False)
    assert [row.type for row in search_rows] == ["order", "product", "user"]

    # Cover `/products` endpoint branch in admin dashboard.
    class _ResultRows:
        def __init__(self, rows: list[tuple[object, str]]) -> None:
            self._rows = rows

        def all(self) -> list[tuple[object, str]]:
            return self._rows

    class _ExecuteSession:
        async def execute(self, _stmt):
            await asyncio.sleep(0)
            product = SimpleNamespace(
                id=uuid4(),
                name="Ring",
                slug="ring",
                base_price=10,
                currency="RON",
                stock_quantity=2,
                status=SimpleNamespace(value="active"),
            )
            return _ResultRows([(product, "Jewelry")])

    products = await admin_dashboard_api.admin_products(
        session=_ExecuteSession(),
        _=SimpleNamespace(id=uuid4()),
    )
    assert products[0]["name"] == "Ring"


def test_orders_confirmation_and_admin_filter_helpers() -> None:
    # Confirmation helpers around Stripe/Netopia branches.
    with pytest.raises(HTTPException):
        orders_api._assert_netopia_status_completed({"payment": {"status": "x"}})

    orders_api._assert_netopia_status_completed({"payment": {"status": "5"}})
    orders_api._assert_netopia_error_success({"error": {"code": "00", "message": "approved"}})

    with pytest.raises(HTTPException):
        orders_api._assert_netopia_error_success({"error": {"code": "12", "message": "denied"}})

    # Admin filter parsing helpers.
    assert orders_api._parse_admin_sla_filter(None) is None
    assert orders_api._parse_admin_sla_filter("accept_overdue") == "accept_overdue"
    assert orders_api._parse_admin_sla_filter("ship_overdue") == "ship_overdue"
    assert orders_api._parse_admin_sla_filter("any") == "any_overdue"
    with pytest.raises(HTTPException):
        orders_api._parse_admin_sla_filter("invalid")

    assert orders_api._parse_admin_fraud_filter(None) is None
    assert orders_api._parse_admin_fraud_filter("review") == "queue"
    assert orders_api._parse_admin_fraud_filter("risk") == "flagged"
    assert orders_api._parse_admin_fraud_filter("approved") == "approved"
    assert orders_api._parse_admin_fraud_filter("denied") == "denied"
    with pytest.raises(HTTPException):
        orders_api._parse_admin_fraud_filter("unknown")

    naive = datetime(2026, 3, 3, 12, 0, 0)
    aware = datetime(2026, 3, 3, 12, 0, 0, tzinfo=timezone.utc)
    assert orders_api._ensure_utc_datetime(naive).tzinfo == timezone.utc
    assert orders_api._ensure_utc_datetime(aware).tzinfo == timezone.utc
    assert orders_api._ensure_utc_datetime(None) is None


def test_orders_admin_list_item_and_response_builders(monkeypatch: pytest.MonkeyPatch) -> None:
    now = datetime.now(timezone.utc)
    order = SimpleNamespace(
        id=uuid4(),
        reference_code="REF-ADM",
        status=OrderStatus.pending_payment,
        total_amount=Decimal("125.00"),
        currency="RON",
        payment_method="card",
        created_at=now,
        tags=[SimpleNamespace(tag="vip"), SimpleNamespace(tag="gift")],
    )
    row = (order, "buyer@example.com", "buyer", "accept", now - timedelta(hours=25), 1, "high")
    monkeypatch.setattr(orders_api.pii_service, "mask_email", lambda value: f"MASK:{value}")

    item_masked = orders_api._admin_order_list_item_from_row(
        row,
        include_pii=False,
        now=now,
        accept_hours=24,
        ship_hours=48,
    )
    assert item_masked.customer_email.startswith("MASK:")
    assert item_masked.sla_overdue is True
    assert "vip" in item_masked.tags

    item_pii = orders_api._admin_order_list_item_from_row(
        row,
        include_pii=True,
        now=now,
        accept_hours=24,
        ship_hours=48,
    )
    assert item_pii.customer_email == "buyer@example.com"

    response = orders_api._admin_order_list_response(
        [row],
        include_pii=False,
        total_items=11,
        page=2,
        limit=5,
    )
    assert response.meta.total_items == 11
    assert response.meta.total_pages == 3
    assert response.items[0].reference_code == "REF-ADM"


@pytest.mark.anyio
async def test_orders_admin_search_and_my_orders_response_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    current_user_id = uuid4()
    with pytest.raises(HTTPException):
        await orders_api.list_my_orders(
            q=None,
            status=None,
            from_date=date(2026, 3, 5),
            to_date=date(2026, 3, 4),
            page=1,
            limit=10,
            current_user=SimpleNamespace(id=current_user_id),
            session=SimpleNamespace(),
        )

    async def _search_orders_for_user(*_args, **_kwargs):
        await asyncio.sleep(0)
        now = datetime.now(timezone.utc)
        order = SimpleNamespace(
            id=uuid4(),
            reference_code="ME-1",
            status=OrderStatus.pending_payment,
            payment_retry_count=0,
            total_amount=Decimal("19.99"),
            tax_amount=Decimal("3.80"),
            shipping_amount=Decimal("0.00"),
            currency="RON",
            payment_method="card",
            created_at=now,
            updated_at=now,
        )
        return [order], 1, 0

    monkeypatch.setattr(orders_api.order_service, "search_orders_for_user", _search_orders_for_user)
    me_payload = await orders_api.list_my_orders(
        q="needle",
        status=None,
        from_date=date(2026, 3, 1),
        to_date=date(2026, 3, 8),
        page=1,
        limit=10,
        current_user=SimpleNamespace(id=current_user_id),
        session=SimpleNamespace(),
    )
    assert me_payload.meta.total_items == 1
    assert me_payload.meta.total_pages == 1

    pii_calls: list[object] = []

    def _require_pii(admin, request):
        pii_calls.append((admin, request))

    async def _admin_search_orders(*_args, **_kwargs):
        await asyncio.sleep(0)
        order = SimpleNamespace(
            id=uuid4(),
            reference_code="ADM-1",
            status=OrderStatus.paid,
            total_amount=Decimal("9.99"),
            currency="RON",
            payment_method="card",
            created_at=datetime.now(timezone.utc),
            tags=[],
        )
        row = (order, "admin-buyer@example.com", "buyer", "ship", datetime.now(timezone.utc), 0, None)
        return [row], 1

    monkeypatch.setattr(orders_api.pii_service, "require_pii_reveal", _require_pii)
    monkeypatch.setattr(orders_api.pii_service, "mask_email", lambda value: f"MASK:{value}")
    monkeypatch.setattr(orders_api.order_service, "admin_search_orders", _admin_search_orders)

    search_payload = await orders_api.admin_search_orders(
        request=_make_request(),
        q="abc",
        user_id=None,
        status="pending",
        tag=None,
        sla="any",
        fraud="review",
        from_dt=None,
        to_dt=None,
        page=1,
        limit=20,
        include_pii=True,
        include_test=True,
        session=SimpleNamespace(),
        admin=SimpleNamespace(id=uuid4()),
    )
    assert pii_calls
    assert search_payload.meta.total_items == 1
    assert search_payload.items[0].reference_code == "ADM-1"

