from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from app.services import payments as payments_service


class _ExecuteResult:
    def __init__(self, value=None) -> None:
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _SessionStub:
    def __init__(self, execute_values=None) -> None:
        self._execute_values = list(execute_values or [])
        self.added = []
        self.commits = 0
        self.rollbacks = 0

    async def execute(self, _stmt):
        return _ExecuteResult(self._execute_values.pop(0) if self._execute_values else None)

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        self.rollbacks += 1

    async def refresh(self, _obj):
        return None


@pytest.mark.anyio('asyncio')
async def test_get_or_create_coupon_mapping_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _SessionStub()

    assert await payments_service._get_or_create_cached_amount_off_coupon(
        session,
        promo_code='   ',
        discount_cents=100,
    ) is None
    assert await payments_service._get_or_create_cached_amount_off_coupon(
        session,
        promo_code='SPRING',
        discount_cents=0,
    ) is None

    promo = SimpleNamespace(id='promo-1', currency='RON')

    async def _promo_and_currency(_session, *, promo_code: str, currency: str):
        assert promo_code == 'SPRING'
        assert currency == 'RON'
        return promo, 'RON'

    monkeypatch.setattr(payments_service, '_promo_and_currency', _promo_and_currency)
    async def _load_none(*_args, **_kwargs):
        return None

    monkeypatch.setattr(payments_service, '_load_existing_coupon_mapping', _load_none)
    monkeypatch.setattr(payments_service, '_create_stripe_discount_coupon_id', lambda **_k: 'coupon_123')

    async def _persist(_session, **_kwargs):
        return 'coupon_saved'

    monkeypatch.setattr(payments_service, '_persist_coupon_mapping', _persist)

    created = await payments_service._get_or_create_cached_amount_off_coupon(
        session,
        promo_code='spring',
        discount_cents=250,
        currency='RON',
    )
    assert created == 'coupon_saved'


@pytest.mark.anyio('asyncio')
async def test_discounts_param_fallback_coupon_creation(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _SessionStub()

    async def _cached_none(*_args, **_kwargs):
        return None

    monkeypatch.setattr(payments_service, '_get_or_create_cached_amount_off_coupon', _cached_none)
    monkeypatch.setattr(payments_service.stripe, 'Coupon', SimpleNamespace(create=lambda **_kwargs: {'id': 'fallback_coupon'}))

    discounts = await payments_service._discounts_param(session=session, discount_value=350, promo_code='PROMO')
    assert discounts == [{'coupon': 'fallback_coupon'}]

    monkeypatch.setattr(payments_service.stripe, 'Coupon', SimpleNamespace(create=lambda **_kwargs: {}))
    discounts_none = await payments_service._discounts_param(session=session, discount_value=350, promo_code='PROMO')
    assert discounts_none is None


@pytest.mark.anyio('asyncio')
async def test_create_checkout_session_and_payment_intent_matrix(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _SessionStub()

    monkeypatch.setattr(payments_service, 'is_mock_payments', lambda: True)
    mock_result = await payments_service.create_checkout_session(
        session=session,
        amount_cents=100,
        customer_email='buyer@example.test',
        success_url='https://ok',
        cancel_url='https://cancel',
    )
    assert mock_result['session_id'].startswith('cs_mock_')

    monkeypatch.setattr(payments_service, 'is_mock_payments', lambda: False)
    monkeypatch.setattr(payments_service, 'is_stripe_configured', lambda: True)
    monkeypatch.setattr(payments_service, 'init_stripe', lambda: None)

    async def _discounts_none(**_kwargs):
        return None

    monkeypatch.setattr(payments_service, '_discounts_param', _discounts_none)
    monkeypatch.setattr(payments_service, '_create_checkout_session_object', lambda _kwargs: {'id': 'cs_1', 'url': 'https://pay'})

    ok = await payments_service.create_checkout_session(
        session=session,
        amount_cents=500,
        customer_email='buyer@example.test',
        success_url='https://ok',
        cancel_url='https://cancel',
    )
    assert ok == {'session_id': 'cs_1', 'checkout_url': 'https://pay'}

    bad_items = [{'price_data': {'unit_amount': 200, 'currency': 'ron'}, 'quantity': 1}]
    with pytest.raises(HTTPException, match='Line items total mismatch'):
        await payments_service.create_checkout_session(
            session=session,
            amount_cents=500,
            customer_email='buyer@example.test',
            success_url='https://ok',
            cancel_url='https://cancel',
            line_items=bad_items,
        )

    cart = SimpleNamespace(id='cart-1', user_id='u1', items=[SimpleNamespace(unit_price_at_add=Decimal('12.50'), quantity=2)])

    class _Intent:
        client_secret = 'sec_1'
        id = 'pi_1'

    monkeypatch.setattr(payments_service.stripe, 'PaymentIntent', SimpleNamespace(create=lambda **_kwargs: _Intent()))
    intent = await payments_service.create_payment_intent(session, cart)
    assert intent == {'client_secret': 'sec_1', 'intent_id': 'pi_1'}


@pytest.mark.anyio('asyncio')
async def test_capture_void_refund_and_mapping_integrity_recovery(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(payments_service, 'is_stripe_configured', lambda: True)
    monkeypatch.setattr(payments_service, 'init_stripe', lambda: None)

    monkeypatch.setattr(payments_service.stripe, 'PaymentIntent', SimpleNamespace(
        capture=lambda _id: {'id': _id, 'status': 'captured'},
        cancel=lambda _id: {'id': _id, 'status': 'canceled'},
    ))
    monkeypatch.setattr(payments_service.stripe, 'Refund', SimpleNamespace(create=lambda **kwargs: {'id': 're_1', **kwargs}))

    captured = await payments_service.capture_payment_intent('pi_123')
    voided = await payments_service.void_payment_intent('pi_123')
    refunded = await payments_service.refund_payment_intent('pi_123', amount_cents=100)
    assert captured['status'] == 'captured'
    assert voided['status'] == 'canceled'
    assert refunded['payment_intent'] == 'pi_123'
    assert refunded['amount'] == 100

    session = _SessionStub(execute_values=[SimpleNamespace(stripe_coupon_id='recovered_coupon')])

    async def _commit_fail_once():
        if session.commits == 0:
            session.commits += 1
            raise IntegrityError('insert', params={}, orig=Exception('dup'))
        session.commits += 1

    session.commit = _commit_fail_once

    recovered = await payments_service._persist_coupon_mapping(
        session,
        promo_id='promo-1',
        discount_cents=120,
        currency='RON',
        coupon_id='coupon_new',
    )
    assert recovered == 'recovered_coupon'
    assert session.rollbacks == 1
