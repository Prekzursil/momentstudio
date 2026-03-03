from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi import BackgroundTasks, HTTPException, Response

from app.api.v1 import admin_dashboard
from app.api.v1 import auth as auth_api
from app.api.v1 import orders as orders_api
from app.models.order import OrderStatus
from app.models.user import UserRole
from app.services import catalog as catalog_service


class _ScalarQueueSession:
    def __init__(self, values: list[object | None]) -> None:
        self._values = list(values)

    async def execute(self, _statement: object) -> object:
        value = self._values.pop(0) if self._values else None
        return SimpleNamespace(scalar_one_or_none=lambda: value)


class _ChildRowsSession:
    def __init__(self, batches: list[list[UUID]]) -> None:
        self._batches = list(batches)

    async def execute(self, _statement: object) -> object:
        rows = self._batches.pop(0) if self._batches else []
        return SimpleNamespace(scalars=lambda: rows)


def test_wave_i_admin_dashboard_helper_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    row_map = admin_dashboard._channel_rows_value_map([("web", Decimal("12.5")), (None, 3)])
    assert row_map["web"] == Decimal("12.5")
    assert row_map[None] == 3

    assert admin_dashboard._channel_number_or_zero(None) == 0
    assert admin_dashboard._channel_int_or_zero(None) == 0
    assert admin_dashboard._channel_int_or_zero(Decimal("4")) == 4

    assert admin_dashboard._refund_delta_pct(20.0, 0.0) is None
    assert admin_dashboard._refund_delta_pct(12.0, 8.0) == 50.0

    item_id = uuid4()
    assert admin_dashboard._global_search_parse_uuid(str(item_id)) == item_id
    assert admin_dashboard._global_search_parse_uuid("not-a-uuid") is None

    assert admin_dashboard._pagination_total_pages(0, 25) == 1
    assert admin_dashboard._pagination_total_pages(26, 25) == 2

    masked: dict[str, str] = {}

    def _mask_email(value: str | None) -> str | None:
        if value is None:
            return None
        masked["email"] = value
        return f"masked:{value}"

    def _mask_text(value: str | None, keep: int = 1) -> str | None:
        if value is None:
            return None
        masked["text"] = f"{value}:{keep}"
        return f"name:{value[:keep]}"

    monkeypatch.setattr(admin_dashboard.pii_service, "mask_email", _mask_email)
    monkeypatch.setattr(admin_dashboard.pii_service, "mask_text", _mask_text)

    user = SimpleNamespace(
        id=uuid4(),
        email="user@example.com",
        username="user",
        name="User Name",
        name_tag=7,
        role=UserRole.customer,
        email_verified=True,
        created_at=datetime.now(timezone.utc),
    )
    masked_item = admin_dashboard._admin_user_list_item_payload(user, include_pii=False)
    assert masked_item.email == "masked:user@example.com"
    assert masked_item.name == "name:U"
    full_item = admin_dashboard._admin_user_list_item_payload(user, include_pii=True)
    assert full_item.email == "user@example.com"
    assert full_item.name == "User Name"


@pytest.mark.anyio
async def test_wave_i_orders_notification_and_cancel_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    created_notifications: list[dict[str, object]] = []

    async def _fake_create_notification(_session: object, **kwargs: object) -> None:
        created_notifications.append(kwargs)

    monkeypatch.setattr(orders_api.notification_service, "create_notification", _fake_create_notification)
    monkeypatch.setattr(orders_api, "_order_has_payment_captured", lambda _order: True)

    owner = SimpleNamespace(id=uuid4(), email="owner@example.com", preferred_language="ro")

    async def _fake_owner(_session: object) -> object:
        return owner

    monkeypatch.setattr(orders_api.auth_service, "get_owner_user", _fake_owner)

    order = SimpleNamespace(
        id=uuid4(),
        status=OrderStatus.cancelled,
        payment_method="stripe",
        stripe_payment_intent_id="pi_123",
        paypal_capture_id=None,
        reference_code="ORD-42",
        user=SimpleNamespace(id=uuid4(), email="customer@example.com", preferred_language="en"),
        customer_email="customer@example.com",
        tracking_number="TRACK-1",
    )

    await orders_api._notify_owner_manual_refund_required(SimpleNamespace(), order)
    assert len(created_notifications) == 1
    assert created_notifications[0]["title"] == "Rambursare necesară"

    background_tasks = BackgroundTasks()
    orders_api._queue_order_processing_email(background_tasks, order)
    orders_api._queue_order_cancelled_email(background_tasks, order)
    task_names = [task.func.__name__ for task in background_tasks.tasks]
    assert "send_order_processing_update" in task_names
    assert "send_order_cancelled_update" in task_names

    owner_ro = SimpleNamespace(preferred_language="ro")
    assert orders_api._cancel_request_owner_title(owner_ro) == "Cerere anulare"
    assert "Cerere de anulare" in orders_api._cancel_request_owner_body(order, owner_ro)

    monkeypatch.setattr(orders_api.settings, "admin_alert_email", "alerts@example.com")
    owner_without_email = SimpleNamespace(email=None, preferred_language="en")
    queued = BackgroundTasks()
    orders_api._queue_admin_cancel_request_email(
        queued,
        owner_without_email,
        order,
        requested_by_email="client@example.com",
        reason="Need cancellation",
    )
    assert len(queued.tasks) == 1
    assert queued.tasks[0].args[0] == "alerts@example.com"


@pytest.mark.anyio
async def test_wave_i_orders_status_email_and_user_notification_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    reward_calls: list[OrderStatus] = []

    async def _fake_first_order_reward_email(
        _session: object,
        _background_tasks: BackgroundTasks,
        order: object,
        *,
        customer_lang: str | None,
    ) -> None:
        reward_calls.append(getattr(order, "status"))

    monkeypatch.setattr(orders_api, "_queue_first_order_reward_email", _fake_first_order_reward_email)

    status_calls: list[dict[str, object]] = []

    async def _fake_create_notification(_session: object, **kwargs: object) -> None:
        status_calls.append(kwargs)

    monkeypatch.setattr(orders_api.notification_service, "create_notification", _fake_create_notification)

    order = SimpleNamespace(
        id=uuid4(),
        status=OrderStatus.paid,
        reference_code="ORD-99",
        tracking_number="AWB-99",
        user=SimpleNamespace(id=uuid4(), email="buyer@example.com", preferred_language="en"),
        customer_email="buyer@example.com",
    )

    for status_value in (
        OrderStatus.paid,
        OrderStatus.shipped,
        OrderStatus.delivered,
        OrderStatus.cancelled,
        OrderStatus.refunded,
    ):
        order.status = status_value
        queue = BackgroundTasks()
        await orders_api._queue_customer_status_email(SimpleNamespace(), queue, order)
        assert len(queue.tasks) >= 1

    assert reward_calls == [OrderStatus.delivered]

    await orders_api._notify_owner_cancel_request(SimpleNamespace(), None, order)
    await orders_api._notify_owner_cancel_request(
        SimpleNamespace(),
        SimpleNamespace(id=uuid4(), preferred_language="en"),
        order,
    )
    await orders_api._notify_user_cancel_requested(
        SimpleNamespace(),
        SimpleNamespace(id=uuid4(), preferred_language="ro"),
        order,
    )
    assert len(status_calls) == 2


@pytest.mark.anyio
async def test_wave_i_auth_admin_device_and_silent_refresh_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    seen_device_calls: list[dict[str, object]] = []

    async def _fake_seen_refresh_device(_session: object, **kwargs: object) -> bool:
        seen_device_calls.append(kwargs)
        return False

    monkeypatch.setattr(auth_api.auth_service, "has_seen_refresh_device", _fake_seen_refresh_device)

    regular_user = SimpleNamespace(id=uuid4(), role=UserRole.customer)
    admin_user = SimpleNamespace(id=uuid4(), role=UserRole.admin)

    assert await auth_api._admin_login_known_device(SimpleNamespace(), regular_user, user_agent="ua") is True
    assert await auth_api._admin_login_known_device(SimpleNamespace(), admin_user, user_agent="ua") is False
    assert len(seen_device_calls) == 1

    async def _fake_get_owner(_session: object) -> object:
        return SimpleNamespace(email="owner@example.com", preferred_language="ro")

    monkeypatch.setattr(auth_api.auth_service, "get_owner_user", _fake_get_owner)

    queued = BackgroundTasks()
    await auth_api._maybe_queue_admin_login_alert(
        queued,
        SimpleNamespace(),
        user=SimpleNamespace(id=uuid4(), role=UserRole.owner, username="owner", name="Owner"),
        known_device=False,
        ip_address="198.51.100.10",
        country_code="RO",
        user_agent="CLI",
    )
    assert len(queued.tasks) == 1

    cleared: list[Response] = []
    monkeypatch.setattr(auth_api, "clear_refresh_cookie", lambda response: cleared.append(response))

    no_content = auth_api._silent_no_content_response(Response())
    assert no_content.status_code == 204
    assert len(cleared) == 1

    silent_invalid = auth_api._invalid_refresh_identity_response(silent_refresh_probe=True, response=Response())
    assert silent_invalid.status_code == 204

    with pytest.raises(HTTPException, match="Invalid refresh token"):
        auth_api._invalid_refresh_identity_response(silent_refresh_probe=False, response=None)


@pytest.mark.anyio
async def test_wave_i_catalog_translation_and_lookup_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    root_id = uuid4()
    child_id = uuid4()
    grandchild_id = uuid4()
    descendant_session = _ChildRowsSession([[child_id], [grandchild_id], []])
    resolved_ids = await catalog_service._get_category_descendant_ids(descendant_session, root_id)
    assert resolved_ids == [root_id, child_id, grandchild_id]

    async def _missing_category(_session: object, _slug: str) -> object:
        return None

    monkeypatch.setattr(catalog_service, "get_category_by_slug", _missing_category)
    assert await catalog_service._get_category_and_descendant_ids_by_slug(SimpleNamespace(), "missing") == []

    async def _fake_get_category(_session: object, _slug: str) -> object:
        return SimpleNamespace(id=root_id)

    async def _fake_descendants(_session: object, _root: UUID) -> list[UUID]:
        return [root_id, child_id]

    monkeypatch.setattr(catalog_service, "get_category_by_slug", _fake_get_category)
    monkeypatch.setattr(catalog_service, "_get_category_descendant_ids", _fake_descendants)
    assert await catalog_service._get_category_and_descendant_ids_by_slug(SimpleNamespace(), "present") == [root_id, child_id]

    category = SimpleNamespace(name="Default", description="Default", translations=[SimpleNamespace(lang="ro", name="Categorie", description="Descriere")])
    image = SimpleNamespace(alt_text="alt", caption="caption", translations=[SimpleNamespace(lang="ro", alt_text="alt-ro", caption=None)])
    product = SimpleNamespace(
        name="Default",
        short_description="S",
        long_description="L",
        meta_title="Meta",
        meta_description="Meta desc",
        translations=[
            SimpleNamespace(
                lang="ro",
                name="Produs",
                short_description="Scurt",
                long_description="Lung",
                meta_title=None,
                meta_description="Descriere",
            )
        ],
        category=category,
        images=[image],
    )
    catalog_service.apply_product_translation(product, "ro")
    assert product.name == "Produs"
    assert product.short_description == "Scurt"
    assert category.name == "Categorie"
    assert image.alt_text == "alt-ro"

    options = catalog_service._build_product_lookup_options(["existing"], "ro")
    assert options[0] == "existing"
    assert len(options) == 3

    class _Query:
        def __init__(self) -> None:
            self.applied: list[object] = []

        def options(self, option: object) -> "_Query":
            self.applied.append(option)
            return self

    query = _Query()
    returned = catalog_service._apply_lookup_options(query, ["a", "b"])
    assert returned is query
    assert query.applied == ["a", "b"]


@pytest.mark.anyio
async def test_wave_i_catalog_unique_slug_and_sku_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(HTTPException, match="Product slug already exists"):
        await catalog_service._ensure_slug_unique(_ScalarQueueSession([object()]), "taken")

    with pytest.raises(HTTPException, match="Product slug already exists in history"):
        await catalog_service._ensure_slug_unique(_ScalarQueueSession([None, object()]), "history")

    await catalog_service._ensure_slug_unique(_ScalarQueueSession([None, None]), "available")

    with pytest.raises(HTTPException, match="Product SKU already exists"):
        await catalog_service._ensure_sku_unique(_ScalarQueueSession([object()]), "sku-1")

    await catalog_service._ensure_sku_unique(_ScalarQueueSession([None]), "sku-2")

    digits = iter("00000001")
    monkeypatch.setattr(catalog_service.secrets, "choice", lambda _pool: next(digits))

    async def _fake_get_product_by_sku(_session: object, candidate: str) -> object | None:
        if candidate.endswith("0000"):
            return object()
        return None

    monkeypatch.setattr(catalog_service, "_get_product_by_sku", _fake_get_product_by_sku)
    generated = await catalog_service._generate_unique_sku(SimpleNamespace(), "my-product")
    assert generated == "MYPRODUC-0001"
