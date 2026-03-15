from __future__ import annotations

import asyncio


from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from app.services import payments as payments_service


def _raise(exc: BaseException):
    raise exc

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
        await asyncio.sleep(0)
        return _ExecuteResult(self._execute_values.pop(0) if self._execute_values else None)

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        await asyncio.sleep(0)
        self.commits += 1

    async def rollback(self):
        await asyncio.sleep(0)
        self.rollbacks += 1

    async def refresh(self, _obj):
        await asyncio.sleep(0)
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
        await asyncio.sleep(0)
        assert promo_code == 'SPRING'
        assert currency == 'RON'
        return promo, 'RON'

    monkeypatch.setattr(payments_service, '_promo_and_currency', _promo_and_currency)
    async def _load_none(*_args, **_kwargs):
        await asyncio.sleep(0)
        return None

    monkeypatch.setattr(payments_service, '_load_existing_coupon_mapping', _load_none)
    monkeypatch.setattr(payments_service, '_create_stripe_discount_coupon_id', lambda **_k: 'coupon_123')

    async def _persist(_session, **_kwargs):
        await asyncio.sleep(0)
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
        await asyncio.sleep(0)
        return None

    monkeypatch.setattr(payments_service, '_get_or_create_cached_amount_off_coupon', _cached_none)
    monkeypatch.setattr(payments_service.stripe, 'Coupon', SimpleNamespace(create=lambda **_kwargs: {'id': 'fallback_coupon'}))

    discounts = await payments_service._discounts_param(session=session, discount_value=350, promo_code='PROMO')
    assert discounts == [{'coupon': 'fallback_coupon'}]

    monkeypatch.setattr(payments_service.stripe, 'Coupon', SimpleNamespace(create=lambda **_kwargs: {}))
    discounts_none = await payments_service._discounts_param(session=session, discount_value=350, promo_code='PROMO')
    assert discounts_none is None


@pytest.mark.anyio('asyncio')
async def test_create_checkout_session_matrix(monkeypatch: pytest.MonkeyPatch) -> None:
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
        await asyncio.sleep(0)
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


@pytest.mark.anyio('asyncio')
async def test_create_payment_intent_happy_path(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _SessionStub()
    monkeypatch.setattr(payments_service, 'is_stripe_configured', lambda: True)
    monkeypatch.setattr(payments_service, 'init_stripe', lambda: None)

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
        await asyncio.sleep(0)
        if session.commits == 0:
            session.commits += 1
            raise IntegrityError('insert', params={}, orig=ValueError('dup'))
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


def test_stripe_webhook_secret_env_selection(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(payments_service.settings, 'stripe_env', 'live')
    monkeypatch.setattr(payments_service.settings, 'stripe_webhook_secret_live', 'live-hook')
    monkeypatch.setattr(payments_service.settings, 'stripe_webhook_secret', 'fallback-hook')
    assert payments_service.stripe_webhook_secret() == 'live-hook'

    monkeypatch.setattr(payments_service.settings, 'stripe_env', 'sandbox')
    monkeypatch.setattr(payments_service.settings, 'stripe_webhook_secret_sandbox', 'sandbox-hook')
    monkeypatch.setattr(payments_service.settings, 'stripe_webhook_secret_test', 'test-hook')
    assert payments_service.stripe_webhook_secret() == 'sandbox-hook'


@pytest.mark.anyio('asyncio')
async def test_coupon_mapping_and_coupon_generation_error_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _SessionStub(execute_values=[None])

    async def _commit_fail_once_no_recovery():
        await asyncio.sleep(0)
        if session.commits == 0:
            session.commits += 1
            raise IntegrityError('insert', params={}, orig=ValueError('dup'))
        session.commits += 1

    session.commit = _commit_fail_once_no_recovery
    coupon_id = await payments_service._persist_coupon_mapping(
        session,
        promo_id='promo-2',
        discount_cents=100,
        currency='RON',
        coupon_id='coupon_fallback',
    )
    assert coupon_id == 'coupon_fallback'

    monkeypatch.setattr(payments_service.stripe, 'Coupon', SimpleNamespace(create=lambda **_kwargs: _raise(RuntimeError('boom'))))
    assert payments_service._create_stripe_discount_coupon_id(
        promo_code='PROMO',
        discount_cents=100,
        currency='RON',
    ) is None


@pytest.mark.anyio('asyncio')
async def test_get_or_create_coupon_short_circuit_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _SessionStub()

    async def _promo_and_currency(_session, *, promo_code: str, currency: str):
        await asyncio.sleep(0)
        return SimpleNamespace(id='promo-1', currency=''), 'RON'

    monkeypatch.setattr(payments_service, '_promo_and_currency', _promo_and_currency)
    monkeypatch.setattr(
        payments_service,
        '_load_existing_coupon_mapping',
        lambda *_args, **_kwargs: asyncio.sleep(0, result=SimpleNamespace(stripe_coupon_id='existing_coupon')),
    )

    existing = await payments_service._get_or_create_cached_amount_off_coupon(
        session,
        promo_code='promo',
        discount_cents=100,
    )
    assert existing == 'existing_coupon'

    monkeypatch.setattr(payments_service, '_load_existing_coupon_mapping', lambda *_args, **_kwargs: asyncio.sleep(0, result=None))
    monkeypatch.setattr(payments_service, '_create_stripe_discount_coupon_id', lambda **_kwargs: None)
    missing = await payments_service._get_or_create_cached_amount_off_coupon(
        session,
        promo_code='promo',
        discount_cents=100,
    )
    assert missing is None


@pytest.mark.anyio('asyncio')
async def test_promo_and_currency_and_payment_intent_error_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _SessionStub()

    monkeypatch.setattr(payments_service, '_load_promo', lambda *_args, **_kwargs: asyncio.sleep(0, result=None))
    assert await payments_service._promo_and_currency(session, promo_code='NONE', currency='RON') is None

    promo = SimpleNamespace(id='promo-1', currency='')
    monkeypatch.setattr(payments_service, '_load_promo', lambda *_args, **_kwargs: asyncio.sleep(0, result=promo))
    resolved = await payments_service._promo_and_currency(session, promo_code='X', currency='eur')
    assert resolved == (promo, 'EUR')

    monkeypatch.setattr(payments_service, 'is_stripe_configured', lambda: False)
    with pytest.raises(HTTPException, match='not configured'):
        await payments_service.create_payment_intent(session, SimpleNamespace(items=[SimpleNamespace(unit_price_at_add=Decimal('1.00'), quantity=1)]))

    monkeypatch.setattr(payments_service, 'is_stripe_configured', lambda: True)
    with pytest.raises(HTTPException, match='Cart is empty'):
        await payments_service.create_payment_intent(session, SimpleNamespace(items=[]))

    monkeypatch.setattr(payments_service, 'init_stripe', lambda: None)
    monkeypatch.setattr(
        payments_service.stripe,
        'PaymentIntent',
        SimpleNamespace(create=lambda **_kwargs: _raise(RuntimeError('intent-fail'))),
    )
    cart = SimpleNamespace(id='c-1', user_id='u-1', items=[SimpleNamespace(unit_price_at_add=Decimal('5.00'), quantity=2)])
    with pytest.raises(HTTPException, match='intent-fail'):
        await payments_service.create_payment_intent(session, cart)


def test_checkout_helper_error_paths() -> None:
    items = payments_service._normalized_checkout_line_items(500, [{'quantity': 1, 'price_data': {'unit_amount': 500}}])
    assert items[0]['price_data']['unit_amount'] == 500

    with pytest.raises(HTTPException, match='quantity'):
        payments_service._line_item_total([{'quantity': 'bad', 'price_data': {'unit_amount': 10}}])
    with pytest.raises(HTTPException, match='price'):
        payments_service._line_item_total([{'quantity': 1, 'price_data': 'bad'}])
    with pytest.raises(HTTPException, match='amount'):
        payments_service._line_item_total([{'quantity': 1, 'price_data': {'unit_amount': 'bad'}}])

    with pytest.raises(HTTPException, match='Invalid discount'):
        payments_service._resolve_discount_value(-1)

    with pytest.raises(HTTPException, match='not configured'):
        payments_service._assert_checkout_enabled(100)


def test_session_result_and_webhook_event_id_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(payments_service, 'is_stripe_configured', lambda: False)
    with pytest.raises(HTTPException, match='not configured'):
        payments_service._assert_checkout_enabled(100)

    monkeypatch.setattr(payments_service, 'is_stripe_configured', lambda: True)
    with pytest.raises(HTTPException, match='Invalid amount'):
        payments_service._assert_checkout_enabled(0)

    with pytest.raises(HTTPException, match='missing url'):
        payments_service._session_result({'id': 'cs_only'})

    with pytest.raises(HTTPException, match='Missing event id'):
        payments_service._webhook_event_id({})


@pytest.mark.anyio('asyncio')
async def test_discounts_and_checkout_session_missing_url(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _SessionStub()

    assert await payments_service._discounts_param(session=session, discount_value=0, promo_code=None) is None

    async def _cached_coupon(*_args, **_kwargs):
        await asyncio.sleep(0)
        return None

    monkeypatch.setattr(payments_service, '_get_or_create_cached_amount_off_coupon', _cached_coupon)
    monkeypatch.setattr(payments_service.stripe, 'Coupon', SimpleNamespace(create=lambda **_kwargs: {}))
    assert await payments_service._discounts_param(session=session, discount_value=100, promo_code='PROMO') is None

    monkeypatch.setattr(payments_service, 'is_mock_payments', lambda: False)
    monkeypatch.setattr(payments_service, 'is_stripe_configured', lambda: True)
    monkeypatch.setattr(payments_service, 'init_stripe', lambda: None)

    async def _discounts_ok(**_kwargs):
        await asyncio.sleep(0)
        return [{'coupon': 'cp_1'}]

    monkeypatch.setattr(payments_service, '_discounts_param', _discounts_ok)
    monkeypatch.setattr(payments_service, '_create_checkout_session_object', lambda _kwargs: {'id': 'cs_1'})

    with pytest.raises(HTTPException, match='missing url'):
        await payments_service.create_checkout_session(
            session=session,
            amount_cents=200,
            customer_email='buyer@example.test',
            success_url='https://ok',
            cancel_url='https://cancel',
            line_items=[{'price_data': {'unit_amount': 200, 'currency': 'ron'}, 'quantity': 1}],
            discount_cents=0,
        )


@pytest.mark.anyio('asyncio')
async def test_capture_void_refund_not_configured_and_gateway_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(payments_service, 'is_stripe_configured', lambda: False)

    with pytest.raises(HTTPException, match='not configured'):
        await payments_service.capture_payment_intent('pi_bad')
    with pytest.raises(HTTPException, match='not configured'):
        await payments_service.void_payment_intent('pi_bad')
    with pytest.raises(HTTPException, match='not configured'):
        await payments_service.refund_payment_intent('pi_bad')

    monkeypatch.setattr(payments_service, 'is_stripe_configured', lambda: True)
    monkeypatch.setattr(payments_service, 'init_stripe', lambda: None)
    monkeypatch.setattr(
        payments_service.stripe,
        'PaymentIntent',
        SimpleNamespace(
            capture=lambda _id: _raise(RuntimeError('cap-fail')),
            cancel=lambda _id: _raise(RuntimeError('void-fail')),
        ),
    )
    monkeypatch.setattr(
        payments_service.stripe,
        'Refund',
        SimpleNamespace(create=lambda **_kwargs: _raise(RuntimeError('refund-fail'))),
    )

    with pytest.raises(HTTPException, match='cap-fail'):
        await payments_service.capture_payment_intent('pi_bad')
    with pytest.raises(HTTPException, match='void-fail'):
        await payments_service.void_payment_intent('pi_bad')
    with pytest.raises(HTTPException, match='refund-fail'):
        await payments_service.refund_payment_intent('pi_bad', amount_cents=50)
