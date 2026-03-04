from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

from fastapi import HTTPException
import pytest

from app.models.order import OrderStatus
from app.services import order as order_service


class _SessionStub:
    def __init__(self) -> None:
        self.added: list[object] = []
        self.deleted: list[object] = []
        self.flush_calls = 0

    def add(self, value: object) -> None:
        self.added.append(value)

    async def delete(self, value: object) -> None:
        self.deleted.append(value)

    async def flush(self) -> None:
        self.flush_calls += 1


def test_admin_filters_and_restore_helpers() -> None:
    filters: list[object] = []
    now = datetime.now(timezone.utc)

    order_service._apply_admin_sla_filter(
        filters,
        sla_clean='accept_overdue',
        accept_started_at=now,
        ship_started_at=now,
        accept_cutoff=now,
        ship_cutoff=now,
    )
    order_service._apply_admin_sla_filter(
        filters,
        sla_clean='ship_overdue',
        accept_started_at=now,
        ship_started_at=now,
        accept_cutoff=now,
        ship_cutoff=now,
    )
    order_service._apply_admin_sla_filter(
        filters,
        sla_clean='any_overdue',
        accept_started_at=now,
        ship_started_at=now,
        accept_cutoff=now,
        ship_cutoff=now,
    )

    fraud_expr = SimpleNamespace(name='fraud-flag')
    order_service._apply_admin_fraud_filter(filters, fraud_clean='queue', fraud_flagged_expr=fraud_expr)
    order_service._apply_admin_fraud_filter(filters, fraud_clean='flagged', fraud_flagged_expr=fraud_expr)
    order_service._apply_admin_fraud_filter(filters, fraud_clean='approved', fraud_flagged_expr=fraud_expr)
    order_service._apply_admin_fraud_filter(filters, fraud_clean='denied', fraud_flagged_expr=fraud_expr)

    assert len(filters) >= 10

    product_id = uuid4()
    variant_id = uuid4()
    assert order_service._restore_delta_from_row({'product_id': str(product_id), 'variant_id': str(variant_id), 'deducted_qty': '3'}) == (
        product_id,
        variant_id,
        3,
    )
    assert order_service._restore_delta_from_row({'product_id': 'bad', 'deducted_qty': 1}) is None
    assert order_service._restore_delta_from_row({'product_id': str(product_id), 'deducted_qty': 0}) is None


def test_apply_stock_restore_and_stock_validation_paths() -> None:
    session = _SessionStub()
    product_id = uuid4()
    variant_id = uuid4()

    product = SimpleNamespace(id=product_id, stock_quantity=2)
    variant = SimpleNamespace(id=variant_id, product_id=product_id, stock_quantity=4)

    lines = order_service._apply_stock_restore(
        session=session,
        restore_by_key={(product_id, None): 3, (product_id, variant_id): 2},
        products={product_id: product},
        variants={variant_id: variant},
    )
    assert len(lines) == 2
    assert product.stock_quantity == 5
    assert variant.stock_quantity == 6

    stock_variant = order_service._stock_qty_for_order_key(
        product_id=product_id,
        variant_id=variant_id,
        products_by_id={product_id: product},
        variants_by_id={variant_id: variant},
    )
    assert stock_variant == 6

    with pytest.raises(HTTPException, match='Invalid variant'):
        order_service._stock_qty_for_order_key(
            product_id=uuid4(),
            variant_id=variant_id,
            products_by_id={product_id: product},
            variants_by_id={variant_id: variant},
        )

    with pytest.raises(HTTPException, match='Insufficient stock'):
        order_service._validate_stock_for_cart_targets(
            qty_by_key={(product_id, None): 10},
            products_by_id={product_id: SimpleNamespace(allow_backorder=False, stock_quantity=2)},
            variants_by_id={},
            reserved_by_key={(product_id, None): 1},
        )


@pytest.mark.anyio
async def test_address_snapshot_rerate_and_cancel_reason_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _SessionStub()
    order = SimpleNamespace(
        id=uuid4(),
        status=OrderStatus.cancelled,
        cancel_reason='old',
        shipping_address=None,
        shipping_address_id=None,
    )

    with pytest.raises(HTTPException, match='Invalid address kind'):
        await order_service._ensure_order_address_snapshot(session, order, 'unknown')

    with pytest.raises(HTTPException, match='Order has no shipping address'):
        await order_service._ensure_order_address_snapshot(session, order, 'shipping')

    existing_snapshot = SimpleNamespace(user_id=None, label='home')
    order.shipping_address = existing_snapshot
    kept = await order_service._ensure_order_address_snapshot(session, order, 'shipping')
    assert kept is existing_snapshot

    order.shipping_address = SimpleNamespace(
        id=uuid4(),
        user_id=uuid4(),
        label='home',
        phone='123',
        line1='l1',
        line2='l2',
        city='city',
        region='region',
        postal_code='000',
        country='RO',
    )
    cloned = await order_service._ensure_order_address_snapshot(session, order, 'shipping')
    assert cloned.user_id is None
    assert session.flush_calls >= 2

    assert await order_service._maybe_rerate_for_address_update(session, order=order, should_rerate=False) is None

    monkeypatch.setattr(order_service, '_has_payment_captured', lambda _order: True)
    with pytest.raises(HTTPException, match='Cannot re-rate shipping'):
        await order_service._maybe_rerate_for_address_update(session, order=order, should_rerate=True)

    monkeypatch.setattr(order_service, '_has_payment_captured', lambda _order: False)

    async def _rerate(_session, _order):
        return {'shipping': {'from': '10', 'to': '12'}}

    monkeypatch.setattr(order_service, '_rerate_order_shipping', _rerate)
    rerated = await order_service._maybe_rerate_for_address_update(session, order=order, should_rerate=True)
    assert rerated == {'shipping': {'from': '10', 'to': '12'}}

    order_service._apply_cancel_reason_update(session, order=order, cancel_reason_clean=None)

    with pytest.raises(HTTPException, match='Cancel reason is required'):
        order_service._apply_cancel_reason_update(session, order=order, cancel_reason_clean='')

    order.status = OrderStatus.paid
    with pytest.raises(HTTPException, match='only be set for cancelled orders'):
        order_service._apply_cancel_reason_update(session, order=order, cancel_reason_clean='new')

    order.status = OrderStatus.cancelled
    order.cancel_reason = 'same'
    order_service._apply_cancel_reason_update(session, order=order, cancel_reason_clean='same')

    order.cancel_reason = 'old'
    order_service._apply_cancel_reason_update(session, order=order, cancel_reason_clean='new-reason')
    assert order.cancel_reason == 'new-reason'
    assert len(session.added) >= 2


@pytest.mark.anyio
async def test_apply_tag_rename_rows_and_update_shipment_not_found() -> None:
    session = _SessionStub()
    order_id_a = uuid4()
    order_id_b = uuid4()

    row_missing = SimpleNamespace(order_id=None, tag='legacy')
    row_merge = SimpleNamespace(order_id=order_id_a, tag='legacy')
    row_update = SimpleNamespace(order_id=order_id_b, tag='legacy')

    updated, merged = await order_service._apply_tag_rename_rows(
        session,
        tag_rows=[row_missing, row_merge, row_update],
        to_clean='modern',
        orders_with_target={order_id_a},
        from_clean='legacy',
        actor_value='actor-1',
    )
    assert updated == 1
    assert merged == 1
    assert row_update.tag == 'modern'
    assert len(session.deleted) == 1

    class _SessionGetNone:
        async def get(self, *_args, **_kwargs):
            return None

    class _Payload:
        def model_dump(self, *, exclude_unset: bool = True):
            return {}

    with pytest.raises(HTTPException, match='Shipment not found'):
        await order_service.update_order_shipment(
            _SessionGetNone(),
            SimpleNamespace(id=uuid4()),
            uuid4(),
            _Payload(),
        )


def test_calculate_shipping_helper_paths() -> None:
    assert order_service._calculate_shipping(Decimal('100'), None) == Decimal('0')
    method = SimpleNamespace(rate_flat=Decimal('5'), rate_per_kg=Decimal('0.5'))
    assert order_service._calculate_shipping(Decimal('10'), method) == Decimal('10')
