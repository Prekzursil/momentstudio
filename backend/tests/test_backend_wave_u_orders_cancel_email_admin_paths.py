from __future__ import annotations
import asyncio

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import BackgroundTasks, HTTPException

from app.api.v1 import orders as orders_api
from app.models.order import OrderStatus


class _RecorderSession:
    def __init__(self) -> None:
        self.added: list[object] = []
        self.commits = 0
        self.refreshed: list[tuple[object, tuple[str, ...] | None]] = []

    def add(self, obj: object) -> None:
        self.added.append(obj)

    async def commit(self) -> None:
        await asyncio.sleep(0)
        self.commits += 1

    async def refresh(self, obj: object, attribute_names=None) -> None:
        await asyncio.sleep(0)
        names = tuple(attribute_names) if attribute_names else None
        self.refreshed.append((obj, names))


def _verification_code() -> str:
    return str((uuid4().int % 900000) + 100000)


@pytest.mark.anyio
async def test_orders_guest_email_request_and_confirm_guard_matrix(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _RecorderSession()
    bg = BackgroundTasks()

    with pytest.raises(HTTPException, match="Missing guest session id"):
        await orders_api.request_guest_email_verification(
            payload=SimpleNamespace(email="guest@example.com"),
            background_tasks=bg,
            _=None,
            session=session,
            session_id=None,
            lang="en",
        )

    async def _email_taken(*_args, **_kwargs):
        await asyncio.sleep(0)
        return True

    monkeypatch.setattr(orders_api.auth_service, "is_email_taken", _email_taken)
    with pytest.raises(HTTPException) as taken_exc:
        await orders_api.request_guest_email_verification(
            payload=SimpleNamespace(email="guest@example.com"),
            background_tasks=bg,
            _=None,
            session=session,
            session_id="sid-1",
            lang="en",
        )
    assert taken_exc.value.status_code == 400

    verification_code = _verification_code()
    cart = SimpleNamespace(
        guest_email="guest@example.com",
        guest_email_verification_token=verification_code,
        guest_email_verification_expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
        guest_email_verification_attempts=orders_api.GUEST_EMAIL_TOKEN_MAX_ATTEMPTS,
    )
    with pytest.raises(HTTPException) as attempts_exc:
        orders_api._assert_guest_email_token_state(
            cart,
            email="guest@example.com",
            now=datetime.now(timezone.utc),
        )
    assert attempts_exc.value.status_code == 429

    with pytest.raises(HTTPException, match="Missing guest session id"):
        await orders_api.confirm_guest_email_verification(
            payload=SimpleNamespace(email="guest@example.com", token=verification_code),
            session=session,
            session_id=None,
        )


@pytest.mark.anyio
async def test_orders_admin_email_resend_endpoints_success_and_guard_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _RecorderSession()
    background_tasks = BackgroundTasks()
    order_id = uuid4()
    admin = SimpleNamespace(id=uuid4(), email="admin@example.com")

    async def _missing_order(*_args, **_kwargs):
        await asyncio.sleep(0)
        return None

    monkeypatch.setattr(orders_api.order_service, "get_order_by_id", _missing_order)
    with pytest.raises(HTTPException, match="Order not found"):
        await orders_api.admin_send_delivery_email(
            background_tasks=background_tasks,
            order_id=order_id,
            payload=SimpleNamespace(note="n/a"),
            session=session,
            admin=admin,
        )

    order_without_email = SimpleNamespace(id=order_id, customer_email=None, user=None, items=[])

    async def _order_no_email(*_args, **_kwargs):
        await asyncio.sleep(0)
        return order_without_email

    monkeypatch.setattr(orders_api.order_service, "get_order_by_id", _order_no_email)
    with pytest.raises(HTTPException, match="Order customer email missing"):
        await orders_api.admin_send_confirmation_email(
            background_tasks=BackgroundTasks(),
            order_id=order_id,
            payload=SimpleNamespace(note=""),
            session=session,
            admin=admin,
        )

    order = SimpleNamespace(
        id=order_id,
        customer_email="buyer@example.com",
        user=SimpleNamespace(preferred_language="ro"),
        items=[SimpleNamespace(id="item-1")],
    )

    async def _order_found(*_args, **_kwargs):
        await asyncio.sleep(0)
        return order

    async def _checkout_settings(*_args, **_kwargs):
        await asyncio.sleep(0)
        return SimpleNamespace(receipt_share_days=14)

    monkeypatch.setattr(orders_api.order_service, "get_order_by_id", _order_found)
    monkeypatch.setattr(orders_api.checkout_settings_service, "get_checkout_settings", _checkout_settings)

    delivery_result = await orders_api.admin_send_delivery_email(
        background_tasks=background_tasks,
        order_id=order_id,
        payload=SimpleNamespace(note="manual resend"),
        session=session,
        admin=admin,
    )
    assert delivery_result is order
    assert session.commits >= 1
    assert len(background_tasks.tasks) >= 1

    confirmation_tasks = BackgroundTasks()
    confirmation_result = await orders_api.admin_send_confirmation_email(
        background_tasks=confirmation_tasks,
        order_id=order_id,
        payload=SimpleNamespace(note="manual resend"),
        session=session,
        admin=admin,
    )
    assert confirmation_result is order
    assert len(confirmation_tasks.tasks) >= 1


@pytest.mark.anyio
async def test_orders_cancel_request_matrix(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _RecorderSession()
    order_id = uuid4()
    user = SimpleNamespace(id=uuid4(), email="buyer@example.com", preferred_language="en")
    background_tasks = BackgroundTasks()

    async def _order_missing(*_args, **_kwargs):
        await asyncio.sleep(0)
        return None

    monkeypatch.setattr(orders_api.order_service, "get_order", _order_missing)
    with pytest.raises(HTTPException, match="Order not found"):
        await orders_api.request_order_cancellation(
            order_id=order_id,
            payload=SimpleNamespace(reason="Please cancel"),
            background_tasks=background_tasks,
            session=session,
            current_user=user,
        )

    ineligible_order = SimpleNamespace(id=order_id, status=OrderStatus.shipped, events=[], reference_code="REF-1")

    async def _order_ineligible(*_args, **_kwargs):
        await asyncio.sleep(0)
        return ineligible_order

    monkeypatch.setattr(orders_api.order_service, "get_order", _order_ineligible)
    with pytest.raises(HTTPException, match="Cancel request not eligible"):
        await orders_api.request_order_cancellation(
            order_id=order_id,
            payload=SimpleNamespace(reason="Need cancel"),
            background_tasks=BackgroundTasks(),
            session=session,
            current_user=user,
        )

    duplicate_order = SimpleNamespace(
        id=order_id,
        status=OrderStatus.pending_payment,
        events=[SimpleNamespace(event="cancel_requested")],
        reference_code="REF-2",
    )

    async def _order_duplicate(*_args, **_kwargs):
        await asyncio.sleep(0)
        return duplicate_order

    monkeypatch.setattr(orders_api.order_service, "get_order", _order_duplicate)
    with pytest.raises(HTTPException) as duplicate_exc:
        await orders_api.request_order_cancellation(
            order_id=order_id,
            payload=SimpleNamespace(reason="Need cancel"),
            background_tasks=BackgroundTasks(),
            session=session,
            current_user=user,
        )
    assert duplicate_exc.value.status_code == 409

    success_order = SimpleNamespace(
        id=order_id,
        status=OrderStatus.pending_payment,
        events=[],
        reference_code="REF-3",
        user_id=user.id,
    )

    async def _order_success(*_args, **_kwargs):
        await asyncio.sleep(0)
        return success_order

    async def _owner_user(*_args, **_kwargs):
        await asyncio.sleep(0)
        return SimpleNamespace(id=uuid4(), email="owner@example.com", preferred_language="en")

    notifications: list[dict[str, object]] = []

    async def _create_notification(_session, **kwargs):
        await asyncio.sleep(0)
        notifications.append(kwargs)

    monkeypatch.setattr(orders_api.order_service, "get_order", _order_success)
    monkeypatch.setattr(orders_api.auth_service, "get_owner_user", _owner_user)
    monkeypatch.setattr(orders_api.notification_service, "create_notification", _create_notification)

    result = await orders_api.request_order_cancellation(
        order_id=order_id,
        payload=SimpleNamespace(reason="Changed my mind"),
        background_tasks=BackgroundTasks(),
        session=session,
        current_user=user,
    )
    assert result is success_order
    assert session.commits >= 1
    assert len(notifications) >= 2
