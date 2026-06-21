"""Direct-call unit coverage for ``app.api.v1.payments``.

Coverage worker [w2]. The payments router is exercised by calling the route
handler coroutines directly with an in-memory SQLite session, bypassing the
HTTP/auth/rate-limit dependency wiring so every aggregation and defensive error
branch is reachable without a full HTTP request per case. The delegated service
layer (``payments``/``webhook_handlers``/``netopia``/``paypal``/``email``/
``coupons_v2``/``notifications``/``promo_usage``/``checkout_settings``/
``auth``) is monkeypatched on the *payments-api* namespace (the imported names)
so the branches in this module -- not the services -- are what's measured.

The module has no ``# pragma: no cover`` lines: all branches (rate-limit
identifier resolution, capabilities provider matrix, intent cart lookup, the
Stripe/PayPal/Netopia webhook insert/duplicate-replay/error-recording paths,
and the full Netopia IPN status decision tree) are reachable with stubs.
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Callable
from uuid import uuid4

import pytest
from fastapi import HTTPException, status

from app.api.v1 import payments as papi
from app.core.config import settings
from app.db.base import Base
from app.models.cart import Cart
from app.models.order import Order, OrderEvent, OrderStatus
from app.models.user import User, UserRole
from app.models.webhook import PayPalWebhookEvent, StripeWebhookEvent
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


# --------------------------------------------------------------------------- #
# Fixtures / helpers                                                          #
# --------------------------------------------------------------------------- #
@pytest.fixture
def session_factory() -> async_sessionmaker:
    import app.models  # noqa: F401  (register all ORM tables)

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


class _Req:
    """Minimal stand-in for ``starlette.Request``."""

    def __init__(
        self,
        *,
        headers: dict[str, str] | None = None,
        body: bytes = b"",
        json_obj: Any = ...,
        client_host: str | None = "1.2.3.4",
        path: str = "/api/v1/payments/x",
        raise_json: bool = False,
    ) -> None:
        self.headers = headers or {}
        self._body = body
        self._json = json_obj
        self._raise_json = raise_json
        self.client = type("C", (), {"host": client_host})() if client_host else None
        self.url = type("U", (), {"path": path})()

    async def body(self) -> bytes:
        return self._body

    async def json(self) -> Any:
        if self._raise_json:
            raise ValueError("bad json")
        return self._json


class _BG:
    """Records ``BackgroundTasks.add_task`` calls."""

    def __init__(self) -> None:
        self.tasks: list[tuple[Any, tuple, dict]] = []

    def add_task(self, fn: Any, *args: Any, **kwargs: Any) -> None:
        self.tasks.append((fn, args, kwargs))


async def _seed_order(session, **kwargs: Any) -> Order:
    defaults: dict[str, Any] = dict(
        id=uuid4(),
        status=OrderStatus.pending_payment,
        reference_code="REF1",
        customer_email="buyer@example.com",
        customer_name="Buyer",
        total_amount=Decimal("10.00"),
        tax_amount=Decimal("0.00"),
        shipping_amount=Decimal("0.00"),
        currency="RON",
        payment_method="netopia",
    )
    defaults.update(kwargs)
    order = Order(**defaults)
    session.add(order)
    await session.commit()
    await session.refresh(order)
    return order


# --------------------------------------------------------------------------- #
# _user_or_session_or_ip_identifier                                          #
# --------------------------------------------------------------------------- #
def test_identifier_from_bearer_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(papi, "decode_token", lambda tok: {"sub": "u-42"})
    req = _Req(headers={"authorization": "Bearer abc"})
    assert papi._user_or_session_or_ip_identifier(req) == "user:u-42"


def test_identifier_bearer_token_invalid_falls_through_to_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(papi, "decode_token", lambda tok: None)
    req = _Req(headers={"authorization": "Bearer abc", "X-Session-Id": "  sess-9 "})
    assert papi._user_or_session_or_ip_identifier(req) == "sid:sess-9"


def test_identifier_bearer_token_no_sub_falls_through_to_ip(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(papi, "decode_token", lambda tok: {"sub": ""})
    req = _Req(headers={"authorization": "Bearer abc"}, client_host="9.9.9.9")
    assert papi._user_or_session_or_ip_identifier(req) == "ip:9.9.9.9"


def test_identifier_falls_back_to_anon_when_no_client() -> None:
    req = _Req(headers={}, client_host=None)
    assert papi._user_or_session_or_ip_identifier(req) == "ip:anon"


# --------------------------------------------------------------------------- #
# _account_orders_url                                                        #
# --------------------------------------------------------------------------- #
def test_account_orders_url_prefers_reference_code() -> None:
    order = Order(reference_code="ABC 123", id=uuid4())
    url = papi._account_orders_url(order)
    assert url.startswith("/account/orders?q=")
    assert "ABC" in url and "+" in url  # quote_plus encodes the space


def test_account_orders_url_uses_id_when_no_reference() -> None:
    oid = uuid4()
    order = Order(reference_code=None, id=oid)
    assert papi._account_orders_url(order) == f"/account/orders?q={oid}"


# --------------------------------------------------------------------------- #
# payment_capabilities                                                       #
# --------------------------------------------------------------------------- #
def test_capabilities_all_enabled_in_mock_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(papi, "is_mock_payments", lambda: True)
    monkeypatch.setattr(papi.payments, "is_stripe_configured", lambda: False)
    monkeypatch.setattr(papi.paypal_service, "is_paypal_configured", lambda: False)
    monkeypatch.setattr(
        papi.netopia_service,
        "netopia_configuration_status",
        lambda: (True, None),
    )
    monkeypatch.setattr(settings, "netopia_enabled", True)

    resp = asyncio.run(papi.payment_capabilities())
    assert resp.stripe.enabled is True
    assert resp.paypal.enabled is True
    assert resp.netopia.enabled is True
    assert resp.cod.enabled is True


def test_capabilities_real_mode_unconfigured_reasons(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(papi, "is_mock_payments", lambda: False)
    monkeypatch.setattr(papi.payments, "is_stripe_configured", lambda: False)
    monkeypatch.setattr(papi.paypal_service, "is_paypal_configured", lambda: False)
    monkeypatch.setattr(
        papi.netopia_service,
        "netopia_configuration_status",
        lambda: (False, "no key"),
    )
    monkeypatch.setattr(settings, "netopia_enabled", True)

    resp = asyncio.run(papi.payment_capabilities())
    assert resp.stripe.enabled is False
    assert resp.stripe.reason_code == "missing_credentials"
    assert resp.paypal.reason == "PayPal is not configured"
    assert resp.netopia.enabled is False
    assert resp.netopia.reason == "no key"
    assert resp.netopia.reason_code == "missing_credentials"


def test_capabilities_netopia_disabled_branch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(papi, "is_mock_payments", lambda: False)
    monkeypatch.setattr(papi.payments, "is_stripe_configured", lambda: True)
    monkeypatch.setattr(papi.paypal_service, "is_paypal_configured", lambda: True)
    monkeypatch.setattr(
        papi.netopia_service,
        "netopia_configuration_status",
        lambda: (True, None),
    )
    monkeypatch.setattr(settings, "netopia_enabled", False)

    resp = asyncio.run(papi.payment_capabilities())
    assert resp.netopia.enabled is False
    assert resp.netopia.reason == "Netopia is disabled"
    assert resp.netopia.reason_code == "disabled_in_env"


def test_capabilities_netopia_unconfigured_default_reason(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(papi, "is_mock_payments", lambda: False)
    monkeypatch.setattr(papi.payments, "is_stripe_configured", lambda: True)
    monkeypatch.setattr(papi.paypal_service, "is_paypal_configured", lambda: True)
    monkeypatch.setattr(
        papi.netopia_service,
        "netopia_configuration_status",
        lambda: (False, ""),  # falsy reason -> default message
    )
    monkeypatch.setattr(settings, "netopia_enabled", True)

    resp = asyncio.run(papi.payment_capabilities())
    assert resp.netopia.reason == "Netopia is not configured"


# --------------------------------------------------------------------------- #
# create_payment_intent                                                      #
# --------------------------------------------------------------------------- #
def test_intent_user_cart_found(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    user_id = uuid4()

    async def _scenario(session) -> Any:
        cart = Cart(user_id=user_id, session_id=None)
        session.add(cart)
        await session.commit()

        async def _fake_intent(sess, c):
            return {"client_secret": "cs_1", "amount": 1000}

        monkeypatch.setattr(papi.payments, "create_payment_intent", _fake_intent)
        current_user = type("U", (), {"id": user_id})()
        return await papi.create_payment_intent(
            _=None, session=session, current_user=current_user, session_id=None
        )

    data = run(session_factory, _scenario)
    assert data == {"client_secret": "cs_1", "amount": 1000}


def test_intent_session_cart_found(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _scenario(session) -> Any:
        cart = Cart(user_id=None, session_id="anon-sid")
        session.add(cart)
        await session.commit()

        async def _fake_intent(sess, c):
            return {"client_secret": "cs_2"}

        monkeypatch.setattr(papi.payments, "create_payment_intent", _fake_intent)
        return await papi.create_payment_intent(
            _=None, session=session, current_user=None, session_id="anon-sid"
        )

    assert run(session_factory, _scenario) == {"client_secret": "cs_2"}


def test_intent_no_cart_raises_400(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        return await papi.create_payment_intent(
            _=None, session=session, current_user=None, session_id="missing"
        )

    with pytest.raises(HTTPException) as exc:
        run(session_factory, _scenario)
    assert exc.value.status_code == status.HTTP_400_BAD_REQUEST


# --------------------------------------------------------------------------- #
# stripe_webhook                                                             #
# --------------------------------------------------------------------------- #
def _patch_stripe_webhook(
    monkeypatch: pytest.MonkeyPatch, *, event: dict, record: StripeWebhookEvent
) -> None:
    async def _handle(session, payload, sig):
        return event, record

    monkeypatch.setattr(papi.payments, "handle_webhook_event", _handle)


def test_stripe_webhook_already_processed_short_circuits(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _scenario(session) -> Any:
        rec = StripeWebhookEvent(
            stripe_event_id="evt_done",
            processed_at=datetime.now(timezone.utc),
            last_error=None,
        )
        session.add(rec)
        await session.commit()
        await session.refresh(rec)
        _patch_stripe_webhook(
            monkeypatch, event={"type": "payment_intent.succeeded"}, record=rec
        )
        called = {"v": False}

        async def _proc(sess, bg, ev):
            called["v"] = True

        monkeypatch.setattr(papi.webhook_handlers, "process_stripe_event", _proc)
        out = await papi.stripe_webhook(
            request=_Req(),
            background_tasks=_BG(),
            stripe_signature="sig",
            session=session,
        )
        assert called["v"] is False
        return out

    out = run(session_factory, _scenario)
    assert out == {"received": True, "type": "payment_intent.succeeded"}


def test_stripe_webhook_processes_and_marks_done(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _scenario(session) -> Any:
        rec = StripeWebhookEvent(stripe_event_id="evt_new", processed_at=None)
        session.add(rec)
        await session.commit()
        await session.refresh(rec)
        _patch_stripe_webhook(
            monkeypatch, event={"type": "checkout.session.completed"}, record=rec
        )

        async def _proc(sess, bg, ev):
            return None

        monkeypatch.setattr(papi.webhook_handlers, "process_stripe_event", _proc)
        out = await papi.stripe_webhook(
            request=_Req(),
            background_tasks=_BG(),
            stripe_signature="sig",
            session=session,
        )
        updated = await session.get(StripeWebhookEvent, rec.id)
        assert updated.processed_at is not None
        return out

    assert run(session_factory, _scenario)["received"] is True


def test_stripe_webhook_handler_http_error_records_detail(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _scenario(session) -> Any:
        rec = StripeWebhookEvent(stripe_event_id="evt_err", processed_at=None)
        session.add(rec)
        await session.commit()
        await session.refresh(rec)
        # Detach so ``record.id`` reads from __dict__ after the handler's
        # rollback (mirrors production where the record came from another
        # commit context); an attached, rolled-back record would lazy-load.
        session.expunge(rec)
        _patch_stripe_webhook(monkeypatch, event={"type": "x"}, record=rec)

        async def _proc(sess, bg, ev):
            raise HTTPException(status_code=409, detail="conflict-detail")

        monkeypatch.setattr(papi.webhook_handlers, "process_stripe_event", _proc)
        with pytest.raises(HTTPException):
            await papi.stripe_webhook(
                request=_Req(),
                background_tasks=_BG(),
                stripe_signature="sig",
                session=session,
            )
        updated = await session.get(StripeWebhookEvent, rec.id)
        assert updated.last_error == "conflict-detail"
        assert updated.processed_at is None

    run(session_factory, _scenario)


def test_stripe_webhook_handler_generic_error_records_str(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _scenario(session) -> Any:
        rec = StripeWebhookEvent(stripe_event_id="evt_err2", processed_at=None)
        session.add(rec)
        await session.commit()
        await session.refresh(rec)
        session.expunge(rec)
        _patch_stripe_webhook(monkeypatch, event={"type": "x"}, record=rec)

        async def _proc(sess, bg, ev):
            raise RuntimeError("boom")

        monkeypatch.setattr(papi.webhook_handlers, "process_stripe_event", _proc)
        with pytest.raises(RuntimeError):
            await papi.stripe_webhook(
                request=_Req(),
                background_tasks=_BG(),
                stripe_signature="sig",
                session=session,
            )
        updated = await session.get(StripeWebhookEvent, rec.id)
        assert updated.last_error == "boom"

    run(session_factory, _scenario)


def test_stripe_webhook_record_vanishes_before_marking(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    """``session.get`` returns None when the record id never persisted."""

    async def _scenario(session) -> Any:
        rec = StripeWebhookEvent(id=uuid4(), stripe_event_id="ghost", processed_at=None)
        _patch_stripe_webhook(monkeypatch, event={"type": "y"}, record=rec)

        async def _proc(sess, bg, ev):
            return None

        monkeypatch.setattr(papi.webhook_handlers, "process_stripe_event", _proc)
        return await papi.stripe_webhook(
            request=_Req(),
            background_tasks=_BG(),
            stripe_signature="sig",
            session=session,
        )

    assert run(session_factory, _scenario)["received"] is True


def test_stripe_webhook_error_path_record_vanishes(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _scenario(session) -> Any:
        rec = StripeWebhookEvent(
            id=uuid4(), stripe_event_id="ghost2", processed_at=None
        )
        _patch_stripe_webhook(monkeypatch, event={"type": "z"}, record=rec)

        async def _proc(sess, bg, ev):
            raise RuntimeError("kaboom")

        monkeypatch.setattr(papi.webhook_handlers, "process_stripe_event", _proc)
        with pytest.raises(RuntimeError):
            await papi.stripe_webhook(
                request=_Req(),
                background_tasks=_BG(),
                stripe_signature="sig",
                session=session,
            )

    run(session_factory, _scenario)


# --------------------------------------------------------------------------- #
# paypal_webhook                                                             #
# --------------------------------------------------------------------------- #
def _patch_paypal_verify(monkeypatch: pytest.MonkeyPatch, verified: bool) -> None:
    async def _verify(*, headers, event):
        return verified

    monkeypatch.setattr(papi.paypal_service, "verify_webhook_signature", _verify)


def test_paypal_webhook_invalid_json_body(
    session_factory: async_sessionmaker,
) -> None:
    async def _scenario(session) -> Any:
        with pytest.raises(HTTPException) as exc:
            await papi.paypal_webhook(
                request=_Req(raise_json=True),
                background_tasks=_BG(),
                session=session,
            )
        assert exc.value.status_code == 400

    run(session_factory, _scenario)


def test_paypal_webhook_non_dict_event(
    session_factory: async_sessionmaker,
) -> None:
    async def _scenario(session) -> Any:
        with pytest.raises(HTTPException):
            await papi.paypal_webhook(
                request=_Req(json_obj=["not", "a", "dict"]),
                background_tasks=_BG(),
                session=session,
            )

    run(session_factory, _scenario)


def test_paypal_webhook_invalid_signature(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_paypal_verify(monkeypatch, False)

    async def _scenario(session) -> Any:
        with pytest.raises(HTTPException) as exc:
            await papi.paypal_webhook(
                request=_Req(json_obj={"id": "e1"}),
                background_tasks=_BG(),
                session=session,
            )
        assert exc.value.detail == "Invalid signature"

    run(session_factory, _scenario)


def test_paypal_webhook_missing_event_id(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_paypal_verify(monkeypatch, True)

    async def _scenario(session) -> Any:
        with pytest.raises(HTTPException) as exc:
            await papi.paypal_webhook(
                request=_Req(json_obj={"id": "   "}),
                background_tasks=_BG(),
                session=session,
            )
        assert "PayPal event id" in exc.value.detail

    run(session_factory, _scenario)


def test_paypal_webhook_inserts_and_processes(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_paypal_verify(monkeypatch, True)

    async def _scenario(session) -> Any:
        async def _proc(sess, bg, ev):
            return None

        monkeypatch.setattr(papi.webhook_handlers, "process_paypal_event", _proc)
        event = {
            "id": "pp_evt_1",
            "event_type": "PAYMENT.CAPTURE.COMPLETED",
            "create_time": "2024-01-01T00:00:00Z",
            "resource": {"id": "res-1"},
        }
        out = await papi.paypal_webhook(
            request=_Req(json_obj=event), background_tasks=_BG(), session=session
        )
        row = (
            await session.execute(
                select(PayPalWebhookEvent).where(
                    PayPalWebhookEvent.paypal_event_id == "pp_evt_1"
                )
            )
        ).scalar_one()
        assert row.processed_at is not None
        assert row.payload["resource"] == {"id": "res-1"}
        return out

    out = run(session_factory, _scenario)
    assert out == {"received": True, "type": "PAYMENT.CAPTURE.COMPLETED"}


def test_paypal_webhook_resource_without_id_summary_none(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_paypal_verify(monkeypatch, True)

    async def _scenario(session) -> Any:
        async def _proc(sess, bg, ev):
            return None

        monkeypatch.setattr(papi.webhook_handlers, "process_paypal_event", _proc)
        event = {"id": "pp_evt_nr", "resource": {"no_id": True}}
        await papi.paypal_webhook(
            request=_Req(json_obj=event), background_tasks=_BG(), session=session
        )
        row = (
            await session.execute(
                select(PayPalWebhookEvent).where(
                    PayPalWebhookEvent.paypal_event_id == "pp_evt_nr"
                )
            )
        ).scalar_one()
        assert row.payload["resource"] is None
        assert row.event_type is None

    run(session_factory, _scenario)


def test_paypal_webhook_duplicate_replay_increments(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_paypal_verify(monkeypatch, True)

    async def _scenario(session) -> Any:
        existing = PayPalWebhookEvent(
            paypal_event_id="dup_evt",
            event_type="OLD.TYPE",
            attempts=1,
            last_attempt_at=datetime.now(timezone.utc),
            payload={"id": "dup_evt"},
            processed_at=None,
        )
        session.add(existing)
        await session.commit()

        async def _proc(sess, bg, ev):
            return None

        monkeypatch.setattr(papi.webhook_handlers, "process_paypal_event", _proc)
        event = {"id": "dup_evt", "event_type": "NEW.TYPE", "resource": {"id": "r"}}
        out = await papi.paypal_webhook(
            request=_Req(json_obj=event), background_tasks=_BG(), session=session
        )
        rows = (
            (
                await session.execute(
                    select(PayPalWebhookEvent).where(
                        PayPalWebhookEvent.paypal_event_id == "dup_evt"
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 1
        assert rows[0].attempts == 2
        assert rows[0].event_type == "NEW.TYPE"
        return out

    assert run(session_factory, _scenario)["received"] is True


def test_paypal_webhook_already_processed_short_circuits(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_paypal_verify(monkeypatch, True)

    async def _scenario(session) -> Any:
        existing = PayPalWebhookEvent(
            paypal_event_id="proc_evt",
            attempts=1,
            last_attempt_at=datetime.now(timezone.utc),
            payload={"id": "proc_evt"},
            processed_at=datetime.now(timezone.utc),
            last_error=None,
        )
        session.add(existing)
        await session.commit()

        called = {"v": False}

        async def _proc(sess, bg, ev):
            called["v"] = True

        monkeypatch.setattr(papi.webhook_handlers, "process_paypal_event", _proc)
        event = {"id": "proc_evt", "event_type": "T"}
        out = await papi.paypal_webhook(
            request=_Req(json_obj=event), background_tasks=_BG(), session=session
        )
        assert called["v"] is False
        return out

    assert run(session_factory, _scenario)["received"] is True


def test_paypal_webhook_handler_http_error_records(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_paypal_verify(monkeypatch, True)

    async def _scenario(session) -> Any:
        async def _proc(sess, bg, ev):
            # Detach the committed record so the real rollback (covered) does not
            # expire it; record.id then reads from __dict__ instead of an async
            # lazy-load that has no greenlet context under aiosqlite.
            sess.expunge_all()
            raise HTTPException(status_code=502, detail="pp-bad")

        monkeypatch.setattr(papi.webhook_handlers, "process_paypal_event", _proc)
        event = {"id": "pp_err"}
        with pytest.raises(HTTPException):
            await papi.paypal_webhook(
                request=_Req(json_obj=event), background_tasks=_BG(), session=session
            )
        row = (
            await session.execute(
                select(PayPalWebhookEvent).where(
                    PayPalWebhookEvent.paypal_event_id == "pp_err"
                )
            )
        ).scalar_one()
        assert row.last_error == "pp-bad"
        assert row.processed_at is None

    run(session_factory, _scenario)


def test_paypal_webhook_handler_generic_error_records(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_paypal_verify(monkeypatch, True)

    async def _scenario(session) -> Any:
        async def _proc(sess, bg, ev):
            sess.expunge_all()
            raise RuntimeError("pp-boom")

        monkeypatch.setattr(papi.webhook_handlers, "process_paypal_event", _proc)
        event = {"id": "pp_err2"}
        with pytest.raises(RuntimeError):
            await papi.paypal_webhook(
                request=_Req(json_obj=event), background_tasks=_BG(), session=session
            )
        row = (
            await session.execute(
                select(PayPalWebhookEvent).where(
                    PayPalWebhookEvent.paypal_event_id == "pp_err2"
                )
            )
        ).scalar_one()
        assert row.last_error == "pp-boom"

    run(session_factory, _scenario)


# --------------------------------------------------------------------------- #
# netopia_webhook                                                            #
# --------------------------------------------------------------------------- #
def _netopia_req(event: dict, *, token_ok: bool = True) -> _Req:
    return _Req(
        headers={},
        body=json.dumps(event).encode("utf-8"),
    )


def _call_netopia(
    session, event: dict | bytes, *, token: str | None = "tok", bg: _BG | None = None
):
    body = event if isinstance(event, bytes) else json.dumps(event).encode("utf-8")
    return papi.netopia_webhook(
        request=_Req(body=body),
        background_tasks=bg or _BG(),
        verification_token=token,
        session=session,
    )


def test_netopia_missing_token(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        return await _call_netopia(session, {"order": {}}, token=None)

    out = run(session_factory, _scenario)
    assert out["errorCode"] == "MISSING_VERIFICATION_TOKEN"


def test_netopia_ipn_http_exception(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    def _verify(*, verification_token, payload):
        raise HTTPException(status_code=400, detail="hash mismatch")

    monkeypatch.setattr(papi.netopia_service, "verify_ipn", _verify)

    async def _scenario(session) -> Any:
        return await _call_netopia(session, {"order": {}})

    out = run(session_factory, _scenario)
    assert out["errorCode"] == "INVALID_IPN"
    assert out["errorMessage"] == "hash mismatch"


def test_netopia_ipn_http_exception_no_detail(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    def _verify(*, verification_token, payload):
        raise HTTPException(status_code=400, detail="")

    monkeypatch.setattr(papi.netopia_service, "verify_ipn", _verify)

    async def _scenario(session) -> Any:
        return await _call_netopia(session, {"order": {}})

    out = run(session_factory, _scenario)
    assert out["errorMessage"] == "Invalid Netopia signature"


def test_netopia_ipn_generic_exception(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    def _verify(*, verification_token, payload):
        raise RuntimeError("crash")

    monkeypatch.setattr(papi.netopia_service, "verify_ipn", _verify)

    async def _scenario(session) -> Any:
        return await _call_netopia(session, {"order": {}})

    out = run(session_factory, _scenario)
    assert out["errorMessage"] == "Invalid Netopia signature"


def _patch_netopia_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        papi.netopia_service, "verify_ipn", lambda *, verification_token, payload: None
    )


def test_netopia_invalid_json(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_netopia_ok(monkeypatch)

    async def _scenario(session) -> Any:
        return await _call_netopia(session, b"not-json{")

    out = run(session_factory, _scenario)
    assert out["errorCode"] == "INVALID_PAYLOAD"


def test_netopia_json_root_not_object(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_netopia_ok(monkeypatch)

    async def _scenario(session) -> Any:
        return await _call_netopia(session, b"[1,2,3]")

    out = run(session_factory, _scenario)
    assert out["errorMessage"] == "Invalid payload"


def test_netopia_missing_order_id(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_netopia_ok(monkeypatch)

    async def _scenario(session) -> Any:
        return await _call_netopia(session, {"order": {"orderID": "  "}})

    out = run(session_factory, _scenario)
    assert out["errorCode"] == "MISSING_ORDER_ID"


def test_netopia_order_not_found(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_netopia_ok(monkeypatch)

    async def _scenario(session) -> Any:
        return await _call_netopia(
            session,
            {"order": {"orderID": str(uuid4())}, "payment": {"status": 3}},
        )

    out = run(session_factory, _scenario)
    assert out["errorCode"] == "ORDER_NOT_FOUND"


def test_netopia_order_lookup_by_reference_code(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_netopia_ok(monkeypatch)

    async def _scenario(session) -> Any:
        # Non-UUID orderID -> looked up by reference_code candidate.
        await _seed_order(session, reference_code="REFCODE9", payment_method="cod")
        return await _call_netopia(
            session,
            {"order": {"orderID": "REFCODE9"}, "payment": {"status": 3}},
        )

    out = run(session_factory, _scenario)
    assert out["errorCode"] == "ORDER_NOT_NETOPIA"


def test_netopia_paid_marks_captured_and_notifies(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_netopia_ok(monkeypatch)

    async def _scenario(session) -> Any:
        user = User(
            email="cust@example.com",
            username="cust_ro",
            hashed_password="x",
            role=UserRole.customer,
            preferred_language="ro",
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        order = await _seed_order(
            session,
            user_id=user.id,
            reference_code="PAID1",
            payment_method="netopia",
            status=OrderStatus.pending_payment,
        )

        async def _record(sess, *, order, note):
            return None

        async def _redeem(sess, *, order, note):
            return None

        async def _notify(sess, **kw):
            return None

        async def _get_settings(sess):
            return type("S", (), {"receipt_share_days": 7})()

        async def _owner(sess):
            return type(
                "O", (), {"email": "owner@example.com", "preferred_language": "en"}
            )()

        monkeypatch.setattr(papi.promo_usage, "record_promo_usage", _record)
        monkeypatch.setattr(papi.coupons_service, "redeem_coupon_for_order", _redeem)
        monkeypatch.setattr(papi.notification_service, "create_notification", _notify)
        monkeypatch.setattr(
            papi.checkout_settings_service, "get_checkout_settings", _get_settings
        )
        monkeypatch.setattr(papi.auth_service, "get_owner_user", _owner)

        bg = _BG()
        event = {
            "order": {"orderID": str(order.id)},
            "payment": {"status": 3, "ntpID": "ntp1", "message": "OK"},
        }
        out = await papi.netopia_webhook(
            request=_Req(body=json.dumps(event).encode("utf-8")),
            background_tasks=bg,
            verification_token="tok",
            session=session,
        )
        await session.refresh(order)
        # confirmation + admin-notify queued
        assert len(bg.tasks) == 2
        return out, order.id

    out, oid = run(session_factory, _scenario)
    assert out["errorType"] == 0
    assert "deliver goods" in out["errorMessage"]


def test_netopia_paid_already_captured_skips(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_netopia_ok(monkeypatch)

    async def _scenario(session) -> Any:
        order = await _seed_order(
            session, reference_code="CAP1", status=OrderStatus.paid
        )
        session.add(
            OrderEvent(order_id=order.id, event="payment_captured", note="prior")
        )
        await session.commit()
        return await _call_netopia(
            session,
            {
                "order": {"orderID": str(order.id)},
                "payment": {"status": 5, "message": "all good"},
            },
        )

    out = run(session_factory, _scenario)
    assert out["errorType"] == 0
    assert "all good" in out["errorMessage"]


def test_netopia_paid_pending_acceptance_no_status_change_event(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_netopia_ok(monkeypatch)

    async def _scenario(session) -> Any:
        order = await _seed_order(
            session,
            reference_code="PA1",
            status=OrderStatus.pending_acceptance,
            customer_email="",  # falsy -> no customer confirmation task
        )

        async def _noop(*a, **k):
            return None

        monkeypatch.setattr(papi.promo_usage, "record_promo_usage", _noop)
        monkeypatch.setattr(papi.coupons_service, "redeem_coupon_for_order", _noop)

        async def _get_settings(sess):
            return type("S", (), {"receipt_share_days": 7})()

        async def _owner(sess):
            return None  # owner None -> falls back to admin_alert_email

        monkeypatch.setattr(
            papi.checkout_settings_service, "get_checkout_settings", _get_settings
        )
        monkeypatch.setattr(papi.auth_service, "get_owner_user", _owner)
        monkeypatch.setattr(settings, "admin_alert_email", "fallback@x.com")

        bg = _BG()
        event = {
            "order": {"orderID": str(order.id)},
            "payment": {"status": 3},
        }
        out = await papi.netopia_webhook(
            request=_Req(body=json.dumps(event).encode("utf-8")),
            background_tasks=bg,
            verification_token="tok",
            session=session,
        )
        # no customer email -> only admin notification queued
        assert len(bg.tasks) == 1
        return out

    out = run(session_factory, _scenario)
    assert out["errorType"] == 0


def test_netopia_status_unknown_none(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_netopia_ok(monkeypatch)

    async def _scenario(session) -> Any:
        order = await _seed_order(session, reference_code="U1")
        return await _call_netopia(
            session,
            {"order": {"orderID": str(order.id)}, "payment": {"status": "abc"}},
        )

    out = run(session_factory, _scenario)
    assert out["errorCode"] == "UNKNOWN"


@pytest.mark.parametrize(
    "code,fragment",
    [
        (4, "cancelled"),
        (12, "DECLINED"),
        (13, "reviewing"),
        (15, "3D AUTH"),
        (99, "Unknown"),
    ],
)
def test_netopia_non_paid_statuses(
    session_factory: async_sessionmaker,
    monkeypatch: pytest.MonkeyPatch,
    code: int,
    fragment: str,
) -> None:
    _patch_netopia_ok(monkeypatch)

    async def _scenario(session) -> Any:
        order = await _seed_order(session, reference_code=f"NS{code}")
        return await _call_netopia(
            session,
            {
                "order": {"orderID": str(order.id)},
                "payment": {"status": code, "message": "note-x"},
            },
        )

    out = run(session_factory, _scenario)
    assert out["errorType"] == 1
    assert fragment in out["errorMessage"]
    assert "note-x" in out["errorMessage"]


def test_netopia_processing_exception_acks_internal_error(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_netopia_ok(monkeypatch)

    async def _scenario(session) -> Any:
        order = await _seed_order(session, reference_code="EXC1")

        async def _boom(sess, *, order, note):
            raise RuntimeError("processing failure")

        monkeypatch.setattr(papi.promo_usage, "record_promo_usage", _boom)
        return await _call_netopia(
            session,
            {"order": {"orderID": str(order.id)}, "payment": {"status": 3}},
        )

    out = run(session_factory, _scenario)
    assert out["errorCode"] == "INTERNAL_ERROR"


def test_netopia_paid_non_ro_language_and_no_reference(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    """English title branch + missing reference_code body=None branch."""
    _patch_netopia_ok(monkeypatch)

    async def _scenario(session) -> Any:
        user = User(
            email="en@example.com",
            username="cust_en",
            hashed_password="x",
            role=UserRole.customer,
            preferred_language="en",
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        order = await _seed_order(
            session,
            user_id=user.id,
            reference_code=None,
            status=OrderStatus.pending_payment,
        )

        async def _noop(*a, **k):
            return None

        captured: dict = {}

        async def _notify(sess, **kw):
            captured.update(kw)

        monkeypatch.setattr(papi.promo_usage, "record_promo_usage", _noop)
        monkeypatch.setattr(papi.coupons_service, "redeem_coupon_for_order", _noop)
        monkeypatch.setattr(papi.notification_service, "create_notification", _notify)

        async def _get_settings(sess):
            return type("S", (), {"receipt_share_days": 7})()

        async def _owner(sess):
            return type("O", (), {"email": None, "preferred_language": None})()

        monkeypatch.setattr(
            papi.checkout_settings_service, "get_checkout_settings", _get_settings
        )
        monkeypatch.setattr(papi.auth_service, "get_owner_user", _owner)
        monkeypatch.setattr(settings, "admin_alert_email", None)

        bg = _BG()
        event = {
            "order": {"orderID": str(order.id)},
            "payment": {"status": 3},
        }
        out = await papi.netopia_webhook(
            request=_Req(body=json.dumps(event).encode("utf-8")),
            background_tasks=bg,
            verification_token="tok",
            session=session,
        )
        # English title chosen; body None because no reference_code
        assert captured["title"] == "Payment received"
        assert captured["body"] is None
        # owner email None + admin_alert_email None => no admin task;
        # customer email present => one confirmation task
        assert len(bg.tasks) == 1
        return out

    out = run(session_factory, _scenario)
    assert out["errorType"] == 0


# --------------------------------------------------------------------------- #
# Edge / branch-completion cases                                              #
# --------------------------------------------------------------------------- #
def test_intent_no_user_no_session_unfiltered_query(
    session_factory: async_sessionmaker,
) -> None:
    """Neither user_id nor session_id -> the cart query has no filter (146->148)."""

    async def _scenario(session) -> Any:
        with pytest.raises(HTTPException) as exc:
            await papi.create_payment_intent(
                _=None, session=session, current_user=None, session_id=None
            )
        assert exc.value.status_code == status.HTTP_400_BAD_REQUEST

    run(session_factory, _scenario)


def test_stripe_webhook_success_updated_vanished(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    """``session.get`` returns None on the success path (180->185)."""

    async def _scenario(session) -> Any:
        rec = StripeWebhookEvent(stripe_event_id="evt_van", processed_at=None)
        session.add(rec)
        await session.commit()
        await session.refresh(rec)
        session.expunge(rec)
        _patch_stripe_webhook(monkeypatch, event={"type": "t"}, record=rec)

        async def _proc(sess, bg, ev):
            return None

        monkeypatch.setattr(papi.webhook_handlers, "process_stripe_event", _proc)

        async def _none_get(model, ident):
            return None

        monkeypatch.setattr(session, "get", _none_get)
        return await papi.stripe_webhook(
            request=_Req(),
            background_tasks=_BG(),
            stripe_signature="sig",
            session=session,
        )

    assert run(session_factory, _scenario)["received"] is True


def test_paypal_webhook_success_updated_vanished(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    """PayPal success path with ``updated`` None (291->296)."""
    _patch_paypal_verify(monkeypatch, True)

    async def _scenario(session) -> Any:
        async def _proc(sess, bg, ev):
            # Make the post-process ``session.get`` return None (record gone).
            async def _none_get(model, ident):
                return None

            monkeypatch.setattr(sess, "get", _none_get)

        monkeypatch.setattr(papi.webhook_handlers, "process_paypal_event", _proc)
        return await papi.paypal_webhook(
            request=_Req(json_obj={"id": "pp_van"}),
            background_tasks=_BG(),
            session=session,
        )

    out = run(session_factory, _scenario)
    assert out["received"] is True


def test_paypal_webhook_error_updated_vanished(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    """PayPal error path with ``updated`` None (300->308)."""
    _patch_paypal_verify(monkeypatch, True)

    async def _scenario(session) -> Any:
        async def _proc(sess, bg, ev):
            # Detach so record.id survives the handler rollback, and force the
            # post-rollback ``session.get`` to return None (updated vanished).
            sess.expunge_all()

            async def _none_get(model, ident):
                return None

            monkeypatch.setattr(sess, "get", _none_get)
            raise RuntimeError("after-delete")

        monkeypatch.setattr(papi.webhook_handlers, "process_paypal_event", _proc)
        with pytest.raises(RuntimeError):
            await papi.paypal_webhook(
                request=_Req(json_obj={"id": "pp_van_err"}),
                background_tasks=_BG(),
                session=session,
            )

    run(session_factory, _scenario)


def test_paypal_webhook_integrity_error_no_existing_reraises(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    """IntegrityError on insert but no existing row found -> re-raise (270)."""
    _patch_paypal_verify(monkeypatch, True)
    from sqlalchemy.exc import IntegrityError as _IE

    async def _scenario(session) -> Any:
        original_commit = session.commit
        state = {"called": False}

        async def _commit_raises_once():
            if not state["called"]:
                state["called"] = True
                raise _IE("dup", None, Exception("dup"))
            return await original_commit()

        monkeypatch.setattr(session, "commit", _commit_raises_once)

        with pytest.raises(_IE):
            await papi.paypal_webhook(
                request=_Req(json_obj={"id": "pp_race"}),
                background_tasks=_BG(),
                session=session,
            )

    run(session_factory, _scenario)


def test_netopia_order_id_with_underscore_blank_candidate(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    """orderID ``_suffix`` -> candidate blank, _try_uuid returns None (417)."""
    _patch_netopia_ok(monkeypatch)

    async def _scenario(session) -> Any:
        return await _call_netopia(
            session,
            {"order": {"orderID": "_suffix"}, "payment": {"status": 3}},
        )

    out = run(session_factory, _scenario)
    assert out["errorCode"] == "ORDER_NOT_FOUND"


def test_netopia_paid_already_captured_no_message(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    """already_captured True -> skip capture block to ack(0); no message (452->528)."""
    _patch_netopia_ok(monkeypatch)

    async def _scenario(session) -> Any:
        order = await _seed_order(
            session, reference_code="ACAP", status=OrderStatus.paid
        )
        session.add(
            OrderEvent(order_id=order.id, event="payment_captured", note="already")
        )
        await session.commit()
        return await _call_netopia(
            session,
            {"order": {"orderID": str(order.id)}, "payment": {"status": 3}},
        )

    out = run(session_factory, _scenario)
    assert out["errorType"] == 0
    assert out["errorMessage"] == "payment was paid; deliver goods"


def test_netopia_paid_status_not_in_capture_set(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Paid status but order already shipped (status not in capture set) ->
    skip block to ack(0) (452->528 via the right-hand condition)."""
    _patch_netopia_ok(monkeypatch)

    async def _scenario(session) -> Any:
        order = await _seed_order(
            session, reference_code="SHIP1", status=OrderStatus.shipped
        )
        return await _call_netopia(
            session,
            {"order": {"orderID": str(order.id)}, "payment": {"status": 3}},
        )

    out = run(session_factory, _scenario)
    assert out["errorType"] == 0
    assert out["errorMessage"] == "payment was paid; deliver goods"


@pytest.mark.parametrize("code", [4, 12, 13, 15, 99])
def test_netopia_non_paid_statuses_without_message(
    session_factory: async_sessionmaker,
    monkeypatch: pytest.MonkeyPatch,
    code: int,
) -> None:
    """Non-paid statuses with no payment message (538->540 .. 558->560)."""
    _patch_netopia_ok(monkeypatch)

    async def _scenario(session) -> Any:
        order = await _seed_order(session, reference_code=f"NM{code}")
        return await _call_netopia(
            session,
            {"order": {"orderID": str(order.id)}, "payment": {"status": code}},
        )

    out = run(session_factory, _scenario)
    assert out["errorType"] == 1
