"""Lean-gate unit coverage for ``app.services.payments`` (Stripe service layer).

Coverage worker [w3]. The Stripe SDK is never hit for real: every
``stripe.*`` entry point used by the module is monkeypatched on
``app.services.payments.stripe`` (the module-local alias), ``settings`` controls
the env/key-resolution branches, and DB-touching helpers run against the shared
in-memory SQLite engine. ``is_mock_payments`` is patched on the *payments*
namespace (the imported name) so the mock-checkout branch is deterministic.

The module has no ``# pragma: no cover`` lines: all branches (env resolution,
placeholder detection, every HTTP-error path, the cached-coupon
get/create/IntegrityError-recovery, the webhook insert vs. duplicate-replay
path, and the capture/void/refund wrappers) are reachable with stubs.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import settings
from app.models.cart import Cart, CartItem
from app.models.promo import PromoCode, StripeCouponMapping
from app.models.webhook import StripeWebhookEvent
from app.services import payments


# --------------------------------------------------------------------------- #
# Fixtures                                                                     #
# --------------------------------------------------------------------------- #
def _make_session_factory() -> async_sessionmaker:
    import app.models  # noqa: F401
    from app.db.base import Base

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def _init() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_init())
    return factory


@pytest.fixture()
def session_factory():
    return _make_session_factory()


@pytest.fixture()
def configured_stripe(monkeypatch):
    """Set sandbox keys/webhook so ``is_stripe_configured`` is True."""
    monkeypatch.setattr(settings, "stripe_env", "sandbox", raising=False)
    monkeypatch.setattr(
        settings, "stripe_secret_key_sandbox", "sk_test_real", raising=False
    )
    monkeypatch.setattr(settings, "stripe_secret_key_test", "", raising=False)
    monkeypatch.setattr(settings, "stripe_secret_key", "", raising=False)
    monkeypatch.setattr(
        settings, "stripe_webhook_secret_sandbox", "whsec_real", raising=False
    )
    monkeypatch.setattr(settings, "stripe_webhook_secret_test", "", raising=False)
    monkeypatch.setattr(settings, "stripe_webhook_secret", "", raising=False)


# --------------------------------------------------------------------------- #
# _stripe_env / _looks_configured / key + webhook resolution                  #
# --------------------------------------------------------------------------- #
def test_stripe_env_live_aliases(monkeypatch) -> None:
    for raw in ("live", "production", "prod"):
        monkeypatch.setattr(settings, "stripe_env", raw, raising=False)
        assert payments._stripe_env() == "live"


def test_stripe_env_defaults_to_sandbox(monkeypatch) -> None:
    monkeypatch.setattr(settings, "stripe_env", None, raising=False)
    assert payments._stripe_env() == "sandbox"
    monkeypatch.setattr(settings, "stripe_env", "anything", raising=False)
    assert payments._stripe_env() == "sandbox"


def test_looks_configured() -> None:
    assert payments._looks_configured("sk_live") is True
    assert payments._looks_configured("") is False
    assert payments._looks_configured(None) is False
    assert payments._looks_configured("sk_placeholder") is False


def test_stripe_secret_key_live_and_sandbox(monkeypatch) -> None:
    monkeypatch.setattr(settings, "stripe_env", "live", raising=False)
    monkeypatch.setattr(settings, "stripe_secret_key_live", "sk_live_x", raising=False)
    monkeypatch.setattr(settings, "stripe_secret_key", "fallback", raising=False)
    assert payments.stripe_secret_key() == "sk_live_x"

    # live with no live key -> falls back to the generic key.
    monkeypatch.setattr(settings, "stripe_secret_key_live", "", raising=False)
    assert payments.stripe_secret_key() == "fallback"

    # sandbox resolution prefers sandbox > test > generic.
    monkeypatch.setattr(settings, "stripe_env", "sandbox", raising=False)
    monkeypatch.setattr(settings, "stripe_secret_key_sandbox", "sk_sb", raising=False)
    assert payments.stripe_secret_key() == "sk_sb"


def test_stripe_webhook_secret_live_and_sandbox(monkeypatch) -> None:
    monkeypatch.setattr(settings, "stripe_env", "live", raising=False)
    monkeypatch.setattr(
        settings, "stripe_webhook_secret_live", "wh_live", raising=False
    )
    monkeypatch.setattr(settings, "stripe_webhook_secret", "wh_fallback", raising=False)
    assert payments.stripe_webhook_secret() == "wh_live"

    monkeypatch.setattr(settings, "stripe_webhook_secret_live", "", raising=False)
    assert payments.stripe_webhook_secret() == "wh_fallback"

    monkeypatch.setattr(settings, "stripe_env", "sandbox", raising=False)
    monkeypatch.setattr(
        settings, "stripe_webhook_secret_sandbox", "wh_sb", raising=False
    )
    assert payments.stripe_webhook_secret() == "wh_sb"


def test_is_stripe_configured_flags(monkeypatch, configured_stripe) -> None:
    assert payments.is_stripe_configured() is True
    assert payments.is_stripe_webhook_configured() is True


def test_init_stripe_sets_api_key(monkeypatch, configured_stripe) -> None:
    monkeypatch.setattr(payments.stripe, "api_key", None, raising=False)
    payments.init_stripe()
    assert payments.stripe.api_key == "sk_test_real"


# --------------------------------------------------------------------------- #
# _get_or_create_cached_amount_off_coupon                                      #
# --------------------------------------------------------------------------- #
def _add_promo(session_factory, *, code="SAVE10", currency=None) -> None:
    async def seed() -> None:
        async with session_factory() as session:
            session.add(PromoCode(code=code, currency=currency))
            await session.commit()

    asyncio.run(seed())


def test_cached_coupon_blank_code(session_factory) -> None:
    async def run() -> None:
        async with session_factory() as session:
            out = await payments._get_or_create_cached_amount_off_coupon(
                session, promo_code="  ", discount_cents=100
            )
            assert out is None

    asyncio.run(run())


def test_cached_coupon_non_positive_discount(session_factory) -> None:
    async def run() -> None:
        async with session_factory() as session:
            out = await payments._get_or_create_cached_amount_off_coupon(
                session, promo_code="X", discount_cents=0
            )
            assert out is None

    asyncio.run(run())


def test_cached_coupon_promo_not_found(session_factory) -> None:
    async def run() -> None:
        async with session_factory() as session:
            out = await payments._get_or_create_cached_amount_off_coupon(
                session, promo_code="NOPE", discount_cents=100
            )
            assert out is None

    asyncio.run(run())


def test_cached_coupon_existing_mapping(session_factory) -> None:
    _add_promo(session_factory, code="EXIST", currency="RON")

    async def run() -> None:
        async with session_factory() as session:
            promo = (
                await session.execute(
                    PromoCode.__table__.select().where(PromoCode.code == "EXIST")
                )
            ).first()
            promo_id = promo[0]
            session.add(
                StripeCouponMapping(
                    promo_code_id=promo_id,
                    discount_cents=100,
                    currency="RON",
                    stripe_coupon_id="cpn_existing",
                )
            )
            await session.commit()
            out = await payments._get_or_create_cached_amount_off_coupon(
                session, promo_code="exist", discount_cents=100, currency="RON"
            )
            assert out == "cpn_existing"

    asyncio.run(run())


def test_cached_coupon_creates_new(session_factory, monkeypatch) -> None:
    _add_promo(session_factory, code="NEW10", currency=None)
    monkeypatch.setattr(
        payments.stripe,
        "Coupon",
        SimpleNamespace(create=lambda **kw: SimpleNamespace(id="cpn_new")),
        raising=False,
    )

    async def run() -> None:
        async with session_factory() as session:
            out = await payments._get_or_create_cached_amount_off_coupon(
                session, promo_code="new10", discount_cents=250, currency="ron"
            )
            assert out == "cpn_new"

    asyncio.run(run())


def test_cached_coupon_stripe_create_raises(session_factory, monkeypatch) -> None:
    _add_promo(session_factory, code="ERR")

    def boom(**kw):
        raise RuntimeError("stripe down")

    monkeypatch.setattr(
        payments.stripe, "Coupon", SimpleNamespace(create=boom), raising=False
    )

    async def run() -> None:
        async with session_factory() as session:
            out = await payments._get_or_create_cached_amount_off_coupon(
                session, promo_code="ERR", discount_cents=100
            )
            assert out is None

    asyncio.run(run())


def test_cached_coupon_no_id_returned(session_factory, monkeypatch) -> None:
    _add_promo(session_factory, code="NOID")
    monkeypatch.setattr(
        payments.stripe,
        "Coupon",
        SimpleNamespace(create=lambda **kw: SimpleNamespace(id=None)),
        raising=False,
    )

    async def run() -> None:
        async with session_factory() as session:
            out = await payments._get_or_create_cached_amount_off_coupon(
                session, promo_code="NOID", discount_cents=100
            )
            assert out is None

    asyncio.run(run())


def _arm_integrity_path(session, monkeypatch, *, recovery_result):
    """Drive the ``except IntegrityError`` recovery block deterministically.

    The function issues two ``execute`` calls (promo lookup, mapping lookup)
    before ``commit``; here ``commit`` is forced to raise a real
    ``IntegrityError`` (simulating a concurrent insert that slipped past the
    pre-check), ``rollback`` is a no-op, and the recovery ``execute`` (the 3rd
    call) returns ``recovery_result``. This isolates the handler logic from
    aiosqlite's async-bridge error surfacing while still exercising the real
    source branches.
    """
    real_execute = session.execute
    state = {"calls": 0}

    async def selective_execute(*args, **kwargs):
        state["calls"] += 1
        if state["calls"] == 2:  # pre-create mapping lookup -> pretend miss
            return SimpleNamespace(scalar_one_or_none=lambda: None)
        if state["calls"] == 3:  # post-IntegrityError recovery lookup
            return SimpleNamespace(scalar_one_or_none=lambda: recovery_result)
        return await real_execute(*args, **kwargs)

    async def fake_commit():
        raise IntegrityError("dup", {}, Exception("unique"))

    async def fake_rollback():
        return None

    monkeypatch.setattr(session, "execute", selective_execute)
    monkeypatch.setattr(session, "commit", fake_commit)
    monkeypatch.setattr(session, "rollback", fake_rollback)


def test_cached_coupon_integrity_recovers(session_factory, monkeypatch) -> None:
    _add_promo(session_factory, code="RACE", currency="RON")
    monkeypatch.setattr(
        payments.stripe,
        "Coupon",
        SimpleNamespace(create=lambda **kw: SimpleNamespace(id="cpn_race")),
        raising=False,
    )

    async def run() -> None:
        async with session_factory() as session:
            recovered = SimpleNamespace(stripe_coupon_id="cpn_winner")
            _arm_integrity_path(session, monkeypatch, recovery_result=recovered)
            out = await payments._get_or_create_cached_amount_off_coupon(
                session, promo_code="RACE", discount_cents=100, currency="RON"
            )
            assert out == "cpn_winner"

    asyncio.run(run())


def test_cached_coupon_integrity_no_recovery(session_factory, monkeypatch) -> None:
    # IntegrityError on commit but the recovery re-query returns no row -> the
    # function falls through to the final ``return str(coupon_id)``.
    _add_promo(session_factory, code="RACE2", currency="RON")
    monkeypatch.setattr(
        payments.stripe,
        "Coupon",
        SimpleNamespace(create=lambda **kw: SimpleNamespace(id="cpn_made")),
        raising=False,
    )

    async def run() -> None:
        async with session_factory() as session:
            _arm_integrity_path(session, monkeypatch, recovery_result=None)
            out = await payments._get_or_create_cached_amount_off_coupon(
                session, promo_code="RACE2", discount_cents=100, currency="RON"
            )
            assert out == "cpn_made"

    asyncio.run(run())


# --------------------------------------------------------------------------- #
# create_payment_intent                                                        #
# --------------------------------------------------------------------------- #
def _cart_with_items(session_factory):
    cart_holder = {}

    async def seed() -> None:
        async with session_factory() as session:
            cart = Cart()
            cart.items = [
                CartItem(unit_price_at_add=10, quantity=2),
                CartItem(unit_price_at_add=5, quantity=1),
            ]
            session.add(cart)
            await session.commit()
            await session.refresh(cart)
            cart_holder["cart"] = cart

    asyncio.run(seed())
    return cart_holder["cart"]


def test_create_payment_intent_not_configured(session_factory) -> None:
    async def run() -> None:
        async with session_factory() as session:
            cart = Cart()
            cart.items = []
            with pytest.raises(HTTPException) as exc:
                await payments.create_payment_intent(session, cart)
            assert exc.value.status_code == 500

    asyncio.run(run())


def test_create_payment_intent_empty_cart(session_factory, configured_stripe) -> None:
    async def run() -> None:
        async with session_factory() as session:
            cart = Cart()
            cart.items = []
            with pytest.raises(HTTPException) as exc:
                await payments.create_payment_intent(session, cart)
            assert exc.value.status_code == 400

    asyncio.run(run())


def test_create_payment_intent_success_computed(
    session_factory, configured_stripe, monkeypatch
) -> None:
    monkeypatch.setattr(
        payments.stripe,
        "PaymentIntent",
        SimpleNamespace(
            create=lambda **kw: SimpleNamespace(client_secret="cs_1", id="pi_1")
        ),
        raising=False,
    )

    async def run() -> None:
        async with session_factory() as session:
            cart = Cart(user_id=None)
            cart.items = [CartItem(unit_price_at_add=10, quantity=2)]
            out = await payments.create_payment_intent(session, cart)
            assert out == {"client_secret": "cs_1", "intent_id": "pi_1"}

    asyncio.run(run())


def test_create_payment_intent_stripe_error(
    session_factory, configured_stripe, monkeypatch
) -> None:
    def boom(**kw):
        raise RuntimeError("api error")

    monkeypatch.setattr(
        payments.stripe, "PaymentIntent", SimpleNamespace(create=boom), raising=False
    )

    async def run() -> None:
        async with session_factory() as session:
            cart = Cart()
            cart.items = [CartItem(unit_price_at_add=10, quantity=1)]
            with pytest.raises(HTTPException) as exc:
                await payments.create_payment_intent(session, cart, amount_cents=1000)
            assert exc.value.status_code == 502

    asyncio.run(run())


def test_create_payment_intent_missing_secret(
    session_factory, configured_stripe, monkeypatch
) -> None:
    monkeypatch.setattr(
        payments.stripe,
        "PaymentIntent",
        SimpleNamespace(
            create=lambda **kw: SimpleNamespace(client_secret=None, id=None)
        ),
        raising=False,
    )

    async def run() -> None:
        async with session_factory() as session:
            cart = Cart()
            cart.items = [CartItem(unit_price_at_add=10, quantity=1)]
            with pytest.raises(HTTPException) as exc:
                await payments.create_payment_intent(session, cart, amount_cents=1000)
            assert exc.value.status_code == 502

    asyncio.run(run())


# --------------------------------------------------------------------------- #
# create_checkout_session                                                      #
# --------------------------------------------------------------------------- #
def test_checkout_session_mock_mode(session_factory, monkeypatch) -> None:
    monkeypatch.setattr(payments, "is_mock_payments", lambda: True)
    monkeypatch.setattr(
        settings, "frontend_origin", "https://shop.test/", raising=False
    )

    async def run() -> None:
        async with session_factory() as session:
            out = await payments.create_checkout_session(
                session=session,
                amount_cents=1000,
                customer_email="a@x.io",
                success_url="https://ok",
                cancel_url="https://no",
            )
            assert out["session_id"].startswith("cs_mock_")
            assert out["checkout_url"].startswith("https://shop.test/checkout/mock")

    asyncio.run(run())


def test_checkout_session_not_configured(session_factory, monkeypatch) -> None:
    monkeypatch.setattr(payments, "is_mock_payments", lambda: False)
    monkeypatch.setattr(payments, "is_stripe_configured", lambda: False)

    async def run() -> None:
        async with session_factory() as session:
            with pytest.raises(HTTPException) as exc:
                await payments.create_checkout_session(
                    session=session,
                    amount_cents=1000,
                    customer_email="a@x.io",
                    success_url="s",
                    cancel_url="c",
                )
            assert exc.value.status_code == 500

    asyncio.run(run())


def test_checkout_session_invalid_amount(session_factory, monkeypatch) -> None:
    monkeypatch.setattr(payments, "is_mock_payments", lambda: False)
    monkeypatch.setattr(payments, "is_stripe_configured", lambda: True)

    async def run() -> None:
        async with session_factory() as session:
            with pytest.raises(HTTPException) as exc:
                await payments.create_checkout_session(
                    session=session,
                    amount_cents=0,
                    customer_email="a@x.io",
                    success_url="s",
                    cancel_url="c",
                )
            assert exc.value.status_code == 400

    asyncio.run(run())


def test_checkout_session_negative_discount(session_factory, monkeypatch) -> None:
    monkeypatch.setattr(payments, "is_mock_payments", lambda: False)
    monkeypatch.setattr(payments, "is_stripe_configured", lambda: True)
    monkeypatch.setattr(payments, "init_stripe", lambda: None)

    async def run() -> None:
        async with session_factory() as session:
            with pytest.raises(HTTPException) as exc:
                await payments.create_checkout_session(
                    session=session,
                    amount_cents=1000,
                    customer_email="a@x.io",
                    success_url="s",
                    cancel_url="c",
                    discount_cents=-5,
                )
            assert exc.value.status_code == 400

    asyncio.run(run())


def _stub_checkout_session(monkeypatch, *, sid="cs_1", url="https://pay"):
    monkeypatch.setattr(payments, "is_mock_payments", lambda: False)
    monkeypatch.setattr(payments, "is_stripe_configured", lambda: True)
    monkeypatch.setattr(payments, "init_stripe", lambda: None)
    checkout_ns = SimpleNamespace(
        Session=SimpleNamespace(create=lambda **kw: SimpleNamespace(id=sid, url=url))
    )
    monkeypatch.setattr(payments.stripe, "checkout", checkout_ns, raising=False)


def test_checkout_session_success_default_line_items(
    session_factory, monkeypatch
) -> None:
    _stub_checkout_session(monkeypatch)

    async def run() -> None:
        async with session_factory() as session:
            out = await payments.create_checkout_session(
                session=session,
                amount_cents=1500,
                customer_email="a@x.io",
                success_url="s",
                cancel_url="c",
                lang="ro",
                metadata={"order": "1", "skip": None, "": "x"},
            )
            assert out == {"session_id": "cs_1", "checkout_url": "https://pay"}

    asyncio.run(run())


def test_checkout_session_line_items_valid(session_factory, monkeypatch) -> None:
    _stub_checkout_session(monkeypatch)
    items = [
        {"price_data": {"unit_amount": 500}, "quantity": 2},
        {"price_data": {"unit_amount": 100}, "quantity": 1},
    ]

    async def run() -> None:
        async with session_factory() as session:
            out = await payments.create_checkout_session(
                session=session,
                amount_cents=1100,
                customer_email="a@x.io",
                success_url="s",
                cancel_url="c",
                line_items=items,
            )
            assert out["session_id"] == "cs_1"

    asyncio.run(run())


@pytest.mark.parametrize(
    "items",
    [
        [{"price_data": {"unit_amount": 500}, "quantity": "two"}],  # bad qty
        [{"price_data": "nope", "quantity": 1}],  # bad price_data
        [{"price_data": {"unit_amount": "x"}, "quantity": 1}],  # bad unit_amount
    ],
)
def test_checkout_session_line_items_invalid(
    session_factory, monkeypatch, items
) -> None:
    _stub_checkout_session(monkeypatch)

    async def run() -> None:
        async with session_factory() as session:
            with pytest.raises(HTTPException) as exc:
                await payments.create_checkout_session(
                    session=session,
                    amount_cents=1000,
                    customer_email="a@x.io",
                    success_url="s",
                    cancel_url="c",
                    line_items=items,
                )
            assert exc.value.status_code == 400

    asyncio.run(run())


def test_checkout_session_line_items_total_mismatch(
    session_factory, monkeypatch
) -> None:
    _stub_checkout_session(monkeypatch)
    items = [{"price_data": {"unit_amount": 500}, "quantity": 1}]

    async def run() -> None:
        async with session_factory() as session:
            with pytest.raises(HTTPException) as exc:
                await payments.create_checkout_session(
                    session=session,
                    amount_cents=9999,
                    customer_email="a@x.io",
                    success_url="s",
                    cancel_url="c",
                    line_items=items,
                )
            assert "mismatch" in exc.value.detail

    asyncio.run(run())


def test_checkout_session_discount_with_cached_coupon(
    session_factory, monkeypatch
) -> None:
    _stub_checkout_session(monkeypatch)

    async def fake_cached(session, **kw):
        return "cpn_cached"

    monkeypatch.setattr(
        payments, "_get_or_create_cached_amount_off_coupon", fake_cached
    )

    async def run() -> None:
        async with session_factory() as session:
            out = await payments.create_checkout_session(
                session=session,
                amount_cents=1000,
                customer_email="a@x.io",
                success_url="s",
                cancel_url="c",
                discount_cents=200,
                promo_code="P",
            )
            assert out["session_id"] == "cs_1"

    asyncio.run(run())


def test_checkout_session_discount_fallback_coupon(
    session_factory, monkeypatch
) -> None:
    _stub_checkout_session(monkeypatch)

    async def fake_cached(session, **kw):
        return None  # forces the inline stripe.Coupon.create fallback

    monkeypatch.setattr(
        payments, "_get_or_create_cached_amount_off_coupon", fake_cached
    )
    monkeypatch.setattr(
        payments.stripe,
        "Coupon",
        SimpleNamespace(create=lambda **kw: SimpleNamespace(id="cpn_inline")),
        raising=False,
    )

    async def run() -> None:
        async with session_factory() as session:
            out = await payments.create_checkout_session(
                session=session,
                amount_cents=1000,
                customer_email="a@x.io",
                success_url="s",
                cancel_url="c",
                discount_cents=300,
            )
            assert out["session_id"] == "cs_1"

    asyncio.run(run())


def test_checkout_session_discount_no_coupon_id(session_factory, monkeypatch) -> None:
    # Cached returns None AND inline create returns no id -> discounts_param stays
    # None (covers the ``if coupon_id`` False arc inside the discount block).
    _stub_checkout_session(monkeypatch)

    async def fake_cached(session, **kw):
        return None

    monkeypatch.setattr(
        payments, "_get_or_create_cached_amount_off_coupon", fake_cached
    )
    monkeypatch.setattr(
        payments.stripe,
        "Coupon",
        SimpleNamespace(create=lambda **kw: SimpleNamespace(id=None)),
        raising=False,
    )

    async def run() -> None:
        async with session_factory() as session:
            out = await payments.create_checkout_session(
                session=session,
                amount_cents=1000,
                customer_email="a@x.io",
                success_url="s",
                cancel_url="c",
                discount_cents=300,
            )
            assert out["session_id"] == "cs_1"

    asyncio.run(run())


def test_checkout_session_stripe_create_error(session_factory, monkeypatch) -> None:
    monkeypatch.setattr(payments, "is_mock_payments", lambda: False)
    monkeypatch.setattr(payments, "is_stripe_configured", lambda: True)
    monkeypatch.setattr(payments, "init_stripe", lambda: None)

    def boom(**kw):
        raise RuntimeError("create failed")

    monkeypatch.setattr(
        payments.stripe,
        "checkout",
        SimpleNamespace(Session=SimpleNamespace(create=boom)),
        raising=False,
    )

    async def run() -> None:
        async with session_factory() as session:
            with pytest.raises(HTTPException) as exc:
                await payments.create_checkout_session(
                    session=session,
                    amount_cents=1000,
                    customer_email="a@x.io",
                    success_url="s",
                    cancel_url="c",
                )
            assert exc.value.status_code == 502

    asyncio.run(run())


def test_checkout_session_missing_url(session_factory, monkeypatch) -> None:
    _stub_checkout_session(monkeypatch, sid=None, url=None)

    async def run() -> None:
        async with session_factory() as session:
            with pytest.raises(HTTPException) as exc:
                await payments.create_checkout_session(
                    session=session,
                    amount_cents=1000,
                    customer_email="a@x.io",
                    success_url="s",
                    cancel_url="c",
                )
            assert exc.value.status_code == 502

    asyncio.run(run())


# --------------------------------------------------------------------------- #
# _stripe_event_payload_summary                                               #
# --------------------------------------------------------------------------- #
def test_event_payload_summary_with_object() -> None:
    event = {
        "id": "evt_1",
        "type": "payment_intent.succeeded",
        "created": 123,
        "data": {
            "object": {
                "id": "pi_1",
                "amount": 1000,
                "currency": "ron",
                "status": "succeeded",
                "ignored": "x",
            }
        },
    }
    summary = payments._stripe_event_payload_summary(event)
    assert summary["id"] == "evt_1"
    assert summary["data"]["object"]["amount"] == 1000
    assert "ignored" not in summary["data"]["object"]


def test_event_payload_summary_no_object() -> None:
    # data is not a dict -> obj is None -> get is not callable -> no "data" key.
    summary = payments._stripe_event_payload_summary(
        {"id": "evt_2", "type": "x", "data": "not-a-dict"}
    )
    assert "data" not in summary


def test_event_payload_summary_object_without_get() -> None:
    # data.object exists but has no callable ``get`` (e.g. a plain object).
    summary = payments._stripe_event_payload_summary(
        {"id": "evt_3", "type": "x", "data": {"object": 123}}
    )
    assert "data" not in summary


def test_event_payload_summary_empty_obj() -> None:
    # object is a dict-like but yields no recognised keys -> obj_summary empty.
    summary = payments._stripe_event_payload_summary(
        {"id": "evt_4", "type": "x", "data": {"object": {"nope": 1}}}
    )
    assert "data" not in summary


# --------------------------------------------------------------------------- #
# handle_webhook_event                                                         #
# --------------------------------------------------------------------------- #
def _stub_webhook(monkeypatch, event):
    monkeypatch.setattr(payments, "init_stripe", lambda: None)
    monkeypatch.setattr(
        payments.stripe,
        "Webhook",
        SimpleNamespace(construct_event=lambda payload, sig, secret: event),
        raising=False,
    )


def test_webhook_secret_not_configured(session_factory, monkeypatch) -> None:
    monkeypatch.setattr(payments, "stripe_webhook_secret", lambda: "")

    async def run() -> None:
        async with session_factory() as session:
            with pytest.raises(HTTPException) as exc:
                await payments.handle_webhook_event(session, b"{}", "sig")
            assert exc.value.status_code == 500

    asyncio.run(run())


def test_webhook_invalid_payload(session_factory, monkeypatch) -> None:
    monkeypatch.setattr(payments, "stripe_webhook_secret", lambda: "whsec_x")
    monkeypatch.setattr(payments, "init_stripe", lambda: None)

    def boom(payload, sig, secret):
        raise ValueError("bad sig")

    monkeypatch.setattr(
        payments.stripe,
        "Webhook",
        SimpleNamespace(construct_event=boom),
        raising=False,
    )

    async def run() -> None:
        async with session_factory() as session:
            with pytest.raises(HTTPException) as exc:
                await payments.handle_webhook_event(session, b"{}", "sig")
            assert exc.value.status_code == 400

    asyncio.run(run())


def test_webhook_missing_event_id(session_factory, monkeypatch) -> None:
    monkeypatch.setattr(payments, "stripe_webhook_secret", lambda: "whsec_x")
    _stub_webhook(monkeypatch, {"id": "", "type": "x"})

    async def run() -> None:
        async with session_factory() as session:
            with pytest.raises(HTTPException) as exc:
                await payments.handle_webhook_event(session, b"{}", "sig")
            assert exc.value.status_code == 400

    asyncio.run(run())


def test_webhook_inserts_new_event(session_factory, monkeypatch) -> None:
    monkeypatch.setattr(payments, "stripe_webhook_secret", lambda: "whsec_x")
    event = {"id": "evt_new", "type": "payment_intent.succeeded", "created": 1}
    _stub_webhook(monkeypatch, event)

    async def run() -> None:
        async with session_factory() as session:
            returned_event, record = await payments.handle_webhook_event(
                session, b"{}", "sig"
            )
            assert returned_event["id"] == "evt_new"
            assert record.stripe_event_id == "evt_new"
            assert record.attempts == 1

    asyncio.run(run())


def test_webhook_duplicate_replay(session_factory, monkeypatch) -> None:
    monkeypatch.setattr(payments, "stripe_webhook_secret", lambda: "whsec_x")
    event = {"id": "evt_dup", "type": "charge.refunded", "created": 2}
    _stub_webhook(monkeypatch, event)

    async def run() -> None:
        async with session_factory() as session:
            # Seed the existing event so the insert hits IntegrityError -> replay.
            session.add(
                StripeWebhookEvent(
                    stripe_event_id="evt_dup",
                    event_type="old",
                    attempts=1,
                    last_attempt_at=__import__("datetime").datetime.now(
                        __import__("datetime").timezone.utc
                    ),
                    payload={},
                )
            )
            await session.commit()

            returned_event, record = await payments.handle_webhook_event(
                session, b"{}", "sig"
            )
            assert returned_event["id"] == "evt_dup"
            assert record.attempts == 2
            assert record.event_type == "charge.refunded"

    asyncio.run(run())


def test_webhook_duplicate_replay_keeps_old_type(session_factory, monkeypatch) -> None:
    # event_type empty -> ``event_type or existing.event_type`` keeps the old
    # type. (The ``payload_summary or existing.payload`` fallback is unreachable
    # because the summary always contains at least the event id, so payload is
    # always replaced with the fresh summary.)
    monkeypatch.setattr(payments, "stripe_webhook_secret", lambda: "whsec_x")
    event = {"id": "evt_dup2", "type": "", "created": None}
    _stub_webhook(monkeypatch, event)

    async def run() -> None:
        async with session_factory() as session:
            import datetime as _dt

            session.add(
                StripeWebhookEvent(
                    stripe_event_id="evt_dup2",
                    event_type="kept_type",
                    attempts=3,
                    last_attempt_at=_dt.datetime.now(_dt.timezone.utc),
                    payload={"kept": True},
                )
            )
            await session.commit()

            _event, record = await payments.handle_webhook_event(session, b"{}", "sig")
            assert record.event_type == "kept_type"
            # Payload is replaced by the fresh summary (which carries the id).
            assert record.payload["id"] == "evt_dup2"
            assert record.attempts == 4

    asyncio.run(run())


# --------------------------------------------------------------------------- #
# capture / void / refund wrappers                                            #
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "fn",
    [payments.capture_payment_intent, payments.void_payment_intent],
)
def test_capture_void_not_configured(monkeypatch, fn) -> None:
    monkeypatch.setattr(payments, "is_stripe_configured", lambda: False)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(fn("pi_1"))
    assert exc.value.status_code == 500


def test_refund_not_configured(monkeypatch) -> None:
    monkeypatch.setattr(payments, "is_stripe_configured", lambda: False)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(payments.refund_payment_intent("pi_1"))
    assert exc.value.status_code == 500


def test_capture_success(monkeypatch) -> None:
    monkeypatch.setattr(payments, "is_stripe_configured", lambda: True)
    monkeypatch.setattr(payments, "init_stripe", lambda: None)
    monkeypatch.setattr(
        payments.stripe,
        "PaymentIntent",
        SimpleNamespace(capture=lambda pid: {"id": pid, "status": "succeeded"}),
        raising=False,
    )
    assert asyncio.run(payments.capture_payment_intent("pi_1"))["status"] == "succeeded"


def test_capture_error(monkeypatch) -> None:
    monkeypatch.setattr(payments, "is_stripe_configured", lambda: True)
    monkeypatch.setattr(payments, "init_stripe", lambda: None)

    def boom(pid):
        raise RuntimeError("cap fail")

    monkeypatch.setattr(
        payments.stripe, "PaymentIntent", SimpleNamespace(capture=boom), raising=False
    )
    with pytest.raises(HTTPException) as exc:
        asyncio.run(payments.capture_payment_intent("pi_1"))
    assert exc.value.status_code == 502


def test_void_success(monkeypatch) -> None:
    monkeypatch.setattr(payments, "is_stripe_configured", lambda: True)
    monkeypatch.setattr(payments, "init_stripe", lambda: None)
    monkeypatch.setattr(
        payments.stripe,
        "PaymentIntent",
        SimpleNamespace(cancel=lambda pid: {"id": pid, "status": "canceled"}),
        raising=False,
    )
    assert asyncio.run(payments.void_payment_intent("pi_1"))["status"] == "canceled"


def test_void_error(monkeypatch) -> None:
    monkeypatch.setattr(payments, "is_stripe_configured", lambda: True)
    monkeypatch.setattr(payments, "init_stripe", lambda: None)

    def boom(pid):
        raise RuntimeError("void fail")

    monkeypatch.setattr(
        payments.stripe, "PaymentIntent", SimpleNamespace(cancel=boom), raising=False
    )
    with pytest.raises(HTTPException) as exc:
        asyncio.run(payments.void_payment_intent("pi_1"))
    assert exc.value.status_code == 502


def test_refund_full_and_partial(monkeypatch) -> None:
    monkeypatch.setattr(payments, "is_stripe_configured", lambda: True)
    monkeypatch.setattr(payments, "init_stripe", lambda: None)
    captured = {}

    def fake_refund(**payload):
        captured.update(payload)
        return {"id": "re_1", **payload}

    monkeypatch.setattr(
        payments.stripe, "Refund", SimpleNamespace(create=fake_refund), raising=False
    )
    # Full refund (no amount).
    asyncio.run(payments.refund_payment_intent("pi_1"))
    assert "amount" not in captured
    # Partial refund.
    captured.clear()
    asyncio.run(payments.refund_payment_intent("pi_1", amount_cents=500))
    assert captured["amount"] == 500


def test_refund_error(monkeypatch) -> None:
    monkeypatch.setattr(payments, "is_stripe_configured", lambda: True)
    monkeypatch.setattr(payments, "init_stripe", lambda: None)

    def boom(**kw):
        raise RuntimeError("refund fail")

    monkeypatch.setattr(
        payments.stripe, "Refund", SimpleNamespace(create=boom), raising=False
    )
    with pytest.raises(HTTPException) as exc:
        asyncio.run(payments.refund_payment_intent("pi_1"))
    assert exc.value.status_code == 502
