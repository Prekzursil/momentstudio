from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from app.models.order import OrderStatus
from app.services import order as order_service


class _ResultOne:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _ResultMany:
    def __init__(self, values):
        self._values = values

    def scalars(self):
        return SimpleNamespace(all=lambda: self._values)


class _SessionStub:
    def __init__(self, *, existing=None, tags=None, fail_commit: bool = False):
        self.existing = existing
        self.tags = tags or []
        self.fail_commit = fail_commit
        self.added = []
        self.rollback_calls = 0
        self.commit_calls = 0

    def add(self, value):
        self.added.append(value)

    def delete(self, value):
        self.added.append(('delete', value))

    def execute(self, *_args, **_kwargs):
        if self.tags:
            return _ResultMany(self.tags)
        return _ResultOne(self.existing)

    def commit(self):
        self.commit_calls += 1
        if self.fail_commit:
            raise IntegrityError('stmt', {}, Exception('dup'))

    def rollback(self):
        self.rollback_calls += 1


class _OrderLike:
    def __init__(self):
        self.id = uuid4()
        self.status = OrderStatus.paid
        self.events = []
        self.stripe_payment_intent_id = None
        self.cancel_reason = None


def test_order_stock_apply_and_restore_helpers_cover_variant_and_product_paths() -> None:
    product_id = uuid4()
    variant_id = uuid4()
    session = _SessionStub()
    product = SimpleNamespace(stock_quantity=7)
    variant = SimpleNamespace(stock_quantity=3)

    deducted = order_service._apply_stock_deduction(
        session=session,
        qty_by_key={(product_id, None): 5, (product_id, variant_id): 4},
        products={product_id: product},
        variants={variant_id: variant},
    )

    assert product.stock_quantity == 2
    assert variant.stock_quantity == 0
    assert len(deducted) == 2
    assert deducted[1]['shortage_qty'] == 1

    restored = order_service._apply_stock_restore(
        session=session,
        restore_by_key={(product_id, None): 2, (product_id, variant_id): 3},
        products={product_id: product},
        variants={variant_id: variant},
    )

    assert product.stock_quantity == 4
    assert variant.stock_quantity == 3
    assert len(restored) == 2


@pytest.mark.anyio
async def test_order_commit_helpers_raise_conflict_on_integrity_error() -> None:
    session = _SessionStub(fail_commit=True)

    with pytest.raises(HTTPException, match='Shipment already exists'):
        await order_service._commit_order_shipment(session, conflict_detail='Shipment already exists')

    with pytest.raises(HTTPException, match='Could not delete shipment'):
        await order_service._commit_deleted_shipment(session)

    assert session.rollback_calls == 2


@pytest.mark.anyio
async def test_order_auto_ship_tracking_update_branch(monkeypatch: pytest.MonkeyPatch) -> None:
    order = _OrderLike()
    session = _SessionStub()
    calls: list[str] = []

    def _commit(_session, _order):
        calls.append('commit_stock')

    def _log(_session, _order_id, _event, _note, data=None):
        del data
        calls.append(_event)

    monkeypatch.setattr(order_service, '_commit_stock_for_order', _commit)
    monkeypatch.setattr(order_service, '_log_event', _log)

    await order_service._maybe_auto_ship_on_tracking_update(
        session,
        order=order,
        data={'tracking_number': 'TRK-1'},
        explicit_status=False,
    )
    assert order.status == OrderStatus.shipped
    assert calls == ['commit_stock', 'status_auto_ship']

    order.status = OrderStatus.paid
    calls.clear()
    await order_service._maybe_auto_ship_on_tracking_update(
        session,
        order=order,
        data={'tracking_number': ''},
        explicit_status=False,
    )
    assert calls == []


@pytest.mark.anyio
async def test_order_void_or_refund_payment_intent_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    def _void_ok(_intent_id: str):
        return {'ok': True}

    monkeypatch.setattr(order_service.payments, 'void_payment_intent', _void_ok)
    event, note = await order_service._void_or_refund_payment_intent('pi_1')
    assert (event, note) == ('payment_voided', 'Intent pi_1')

    def _void_fail(_intent_id: str):
        raise HTTPException(status_code=400, detail='cannot void')

    def _refund_ok(_intent_id: str):
        return {'id': 're_2'}

    monkeypatch.setattr(order_service.payments, 'void_payment_intent', _void_fail)
    monkeypatch.setattr(order_service.payments, 'refund_payment_intent', _refund_ok)
    event, note = await order_service._void_or_refund_payment_intent('pi_2')
    assert event == 'payment_refunded'
    assert note == 'Stripe refund re_2'


@pytest.mark.anyio
async def test_order_add_tag_paths_and_review_fraud_audit(monkeypatch: pytest.MonkeyPatch) -> None:
    order = _OrderLike()
    session_existing = _SessionStub(existing=SimpleNamespace(tag='vip'))

    def _hydrate(_session, _order_id):
        return None

    monkeypatch.setattr(order_service, 'get_order_by_id_admin', _hydrate)

    hydrated = await order_service.add_order_tag(session_existing, order, tag='VIP')
    assert hydrated is order
    assert session_existing.commit_calls == 0

    session_new = _SessionStub(existing=None)
    await order_service.add_order_tag(session_new, order, tag='fraud_review')
    assert session_new.commit_calls == 1
    assert len(session_new.added) >= 2

    fraud_session = _SessionStub(tags=[SimpleNamespace(tag='fraud_approved')])

    def _sync(*_args, **_kwargs):
        return None

    monkeypatch.setattr(order_service, '_sync_fraud_decision_tags', _sync)
    reviewed = await order_service.review_order_fraud(
        fraud_session,
        order,
        decision='deny',
        note='needs manual check',
        actor_user_id=None,
    )

    assert reviewed is order
    assert fraud_session.commit_calls == 1
    assert any(getattr(item, 'event', '') == 'fraud_review' for item in fraud_session.added)
