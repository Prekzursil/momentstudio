"""Lean 100% coverage for ``app.services.ops``.

Covers the maintenance-banner CRUD, shipping simulation branches, webhook
listing/detail/retry (success + every error path) and the ``get_diagnostics``
matrix (SMTP / Redis / storage / Stripe / PayPal / Netopia checks). All DB work
runs against an in-memory SQLite engine; external collaborators are stubbed via
``monkeypatch`` so the assertions target the service logic itself.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from fastapi import BackgroundTasks, HTTPException

from app.models.email_event import EmailDeliveryEvent
from app.models.email_failure import EmailDeliveryFailure
from app.models.ops import MaintenanceBanner
from app.models.order import ShippingMethod
from app.models.webhook import PayPalWebhookEvent, StripeWebhookEvent
from app.services import ops as ops_service
from app.services.checkout_settings import CheckoutSettings
from tests.conftest import make_memory_session_factory

pytestmark = pytest.mark.anyio


@pytest.fixture(scope="module")
def session_factory():
    return make_memory_session_factory()


def _now() -> datetime:
    return datetime.now(timezone.utc)


# --------------------------------------------------------------------------- #
# Maintenance banners                                                         #
# --------------------------------------------------------------------------- #
async def test_maintenance_banner_crud_and_active_selection(session_factory) -> None:
    async with session_factory() as session:
        active = MaintenanceBanner(
            message_en="active",
            message_ro="activ",
            is_active=True,
            starts_at=_now() - timedelta(hours=1),
            ends_at=_now() + timedelta(hours=1),
        )
        created = await ops_service.create_maintenance_banner(session, active)
        assert created.id is not None

        created.message_en = "active-updated"
        updated = await ops_service.update_maintenance_banner(session, created)
        assert updated.message_en == "active-updated"

        listed = await ops_service.list_maintenance_banners(session)
        assert any(b.id == created.id for b in listed)

        current = await ops_service.get_active_maintenance_banner(session)
        assert current is not None and current.id == created.id

        await ops_service.delete_maintenance_banner(session, created)
        assert await ops_service.get_active_maintenance_banner(session) is None


# --------------------------------------------------------------------------- #
# Shipping simulation                                                          #
# --------------------------------------------------------------------------- #
async def test_simulate_shipping_uses_method_and_negative_taxable_clamps(
    session_factory, monkeypatch
) -> None:
    # shipping_fee_ron=None forces the order_service._calculate_shipping path
    # (lines 124-126 / 152) and a discount > subtotal clamps taxable to 0 (105).
    settings_obj = CheckoutSettings(
        shipping_fee_ron=None,  # type: ignore[arg-type]
        free_shipping_threshold_ron=None,  # type: ignore[arg-type]
    )

    async def _fake_settings(_session):
        return settings_obj

    monkeypatch.setattr(
        ops_service.checkout_settings_service, "get_checkout_settings", _fake_settings
    )

    async with session_factory() as session:
        method = ShippingMethod(
            name="Courier", rate_flat=Decimal("15.00"), rate_per_kg=None
        )
        session.add(method)
        await session.commit()
        await session.refresh(method)

        result = await ops_service.simulate_shipping_rates(
            session,
            subtotal_ron=Decimal("10.00"),
            discount_ron=Decimal("99.00"),
            shipping_method_id=method.id,
        )

    assert result.selected_shipping_method_id == method.id
    assert result.taxable_subtotal_ron == Decimal("0.00")
    assert any(row.id == method.id for row in result.methods)


async def test_simulate_shipping_missing_method_raises(
    session_factory, monkeypatch
) -> None:
    async def _fake_settings(_session):
        return CheckoutSettings()

    monkeypatch.setattr(
        ops_service.checkout_settings_service, "get_checkout_settings", _fake_settings
    )

    async with session_factory() as session:
        with pytest.raises(HTTPException) as exc:
            await ops_service.simulate_shipping_rates(
                session,
                subtotal_ron=Decimal("50.00"),
                discount_ron=Decimal("0"),
                shipping_method_id=uuid.uuid4(),
            )
    assert exc.value.status_code == 404


async def test_simulate_shipping_free_over_threshold(
    session_factory, monkeypatch
) -> None:
    # shipping_fee_ron set + taxable >= threshold => both free-shipping branches
    # (130 and 156-161) zero the shipping cost.
    settings_obj = CheckoutSettings(
        shipping_fee_ron=Decimal("20.00"),
        free_shipping_threshold_ron=Decimal("30.00"),
    )

    async def _fake_settings(_session):
        return settings_obj

    monkeypatch.setattr(
        ops_service.checkout_settings_service, "get_checkout_settings", _fake_settings
    )

    async with session_factory() as session:
        session.add(ShippingMethod(name="Std", rate_flat=Decimal("5.00")))
        await session.commit()

        result = await ops_service.simulate_shipping_rates(
            session,
            subtotal_ron=Decimal("100.00"),
            discount_ron=Decimal("0"),
            shipping_method_id=None,
        )

    assert result.shipping_ron == Decimal("0.00")
    assert result.methods[0].computed_shipping_ron == Decimal("0.00")


# --------------------------------------------------------------------------- #
# Webhook status helper + listing                                             #
# --------------------------------------------------------------------------- #
def test_webhook_status_helper() -> None:
    assert (
        ops_service._webhook_status(processed_at=None, last_error=" boom ") == "failed"
    )
    assert (
        ops_service._webhook_status(processed_at=_now(), last_error=None) == "processed"
    )
    assert ops_service._webhook_status(processed_at=None, last_error=None) == "received"


async def test_list_recent_webhooks_merges_and_sorts(session_factory) -> None:
    async with session_factory() as session:
        session.add(
            StripeWebhookEvent(
                stripe_event_id="evt_s1",
                event_type="charge",
                last_attempt_at=_now() - timedelta(minutes=5),
                processed_at=_now(),
            )
        )
        session.add(
            PayPalWebhookEvent(
                paypal_event_id="evt_p1",
                event_type="sale",
                last_attempt_at=_now(),
                last_error="oops",
            )
        )
        await session.commit()

        items = await ops_service.list_recent_webhooks(session, limit=10)

    providers = {item.provider for item in items}
    assert {"stripe", "paypal"} <= providers
    # Newest last_attempt_at first.
    assert items[0].last_attempt_at >= items[-1].last_attempt_at


# --------------------------------------------------------------------------- #
# Webhook detail                                                              #
# --------------------------------------------------------------------------- #
async def test_get_webhook_detail_validation_and_lookup(session_factory) -> None:
    async with session_factory() as session:
        with pytest.raises(HTTPException) as bad_provider:
            await ops_service.get_webhook_detail(
                session, provider="venmo", event_id="x"
            )
        assert bad_provider.value.status_code == 400

        with pytest.raises(HTTPException) as missing_id:
            await ops_service.get_webhook_detail(
                session, provider="stripe", event_id=" "
            )
        assert missing_id.value.status_code == 400

        with pytest.raises(HTTPException) as not_found_s:
            await ops_service.get_webhook_detail(
                session, provider="stripe", event_id="nope"
            )
        assert not_found_s.value.status_code == 404

        with pytest.raises(HTTPException) as not_found_p:
            await ops_service.get_webhook_detail(
                session, provider="paypal", event_id="nope"
            )
        assert not_found_p.value.status_code == 404


async def test_get_webhook_detail_returns_rows(session_factory) -> None:
    async with session_factory() as session:
        session.add(
            StripeWebhookEvent(
                stripe_event_id="evt_detail_s",
                event_type="charge",
                last_attempt_at=_now(),
                payload={"k": "v"},
            )
        )
        session.add(
            PayPalWebhookEvent(
                paypal_event_id="evt_detail_p",
                event_type="sale",
                last_attempt_at=_now(),
                payload={"k": "v"},
            )
        )
        await session.commit()

        s_detail = await ops_service.get_webhook_detail(
            session, provider="stripe", event_id="evt_detail_s"
        )
        p_detail = await ops_service.get_webhook_detail(
            session, provider="PayPal", event_id="evt_detail_p"
        )

    assert s_detail.provider == "stripe"
    assert p_detail.provider == "paypal"


# --------------------------------------------------------------------------- #
# Counts + email listings                                                     #
# --------------------------------------------------------------------------- #
async def test_counts_and_email_listings(session_factory) -> None:
    async with session_factory() as session:
        session.add(
            StripeWebhookEvent(
                stripe_event_id="evt_fail_s",
                last_attempt_at=_now(),
                last_error="boom",
            )
        )
        session.add(
            PayPalWebhookEvent(
                paypal_event_id="evt_pending_p",
                last_attempt_at=_now(),
                processed_at=None,
                last_error=None,
            )
        )
        session.add(
            EmailDeliveryFailure(to_email="USER@x.io", subject="s", error_message="e")
        )
        session.add(
            EmailDeliveryEvent(to_email="user@x.io", subject="s", status="sent")
        )
        session.add(
            EmailDeliveryEvent(to_email="user@x.io", subject="s", status="failed")
        )
        await session.commit()

        assert await ops_service.count_failed_webhooks(session, since_hours=24) >= 1
        assert await ops_service.count_webhook_backlog(session, since_hours=0) >= 1
        assert (
            await ops_service.count_recent_webhook_backlog(session, since_hours=24) >= 1
        )
        assert await ops_service.count_email_failures(session, since_hours=24) >= 1

        failures = await ops_service.list_email_failures(
            session, limit=10, to_email="user@x.io"
        )
        assert len(failures) >= 1

        events = await ops_service.list_email_events(
            session, limit=10, to_email="user@x.io", status="failed"
        )
        assert all(e.status == "failed" for e in events)

        # No email/status filters -> the optional ``where`` clauses are skipped.
        all_failures = await ops_service.list_email_failures(session, limit=10)
        assert len(all_failures) >= 1
        all_events = await ops_service.list_email_events(
            session, limit=10, status="unknown"
        )
        assert len(all_events) >= 2


# --------------------------------------------------------------------------- #
# Retry webhook                                                               #
# --------------------------------------------------------------------------- #
async def test_retry_webhook_validation(session_factory) -> None:
    bg = BackgroundTasks()
    async with session_factory() as session:
        with pytest.raises(HTTPException) as bad_provider:
            await ops_service.retry_webhook(session, bg, provider="nope", event_id="x")
        assert bad_provider.value.status_code == 400

        with pytest.raises(HTTPException) as missing_id:
            await ops_service.retry_webhook(
                session, bg, provider="stripe", event_id=" "
            )
        assert missing_id.value.status_code == 400

        for provider in ("stripe", "paypal"):
            with pytest.raises(HTTPException) as not_found:
                await ops_service.retry_webhook(
                    session, bg, provider=provider, event_id="ghost"
                )
            assert not_found.value.status_code == 404


@pytest.mark.parametrize("provider", ["stripe", "paypal"])
async def test_retry_webhook_already_processed_and_no_payload(
    session_factory, provider
) -> None:
    bg = BackgroundTasks()
    async with session_factory() as session:
        if provider == "stripe":
            processed = StripeWebhookEvent(
                stripe_event_id=f"evt_done_{provider}",
                last_attempt_at=_now(),
                processed_at=_now(),
                last_error=None,
                payload={"a": 1},
            )
            no_payload = StripeWebhookEvent(
                stripe_event_id=f"evt_nopay_{provider}",
                last_attempt_at=_now(),
                payload=None,
            )
            event_done = "evt_done_stripe"
            event_nopay = "evt_nopay_stripe"
        else:
            processed = PayPalWebhookEvent(
                paypal_event_id=f"evt_done_{provider}",
                last_attempt_at=_now(),
                processed_at=_now(),
                last_error=None,
                payload={"a": 1},
            )
            no_payload = PayPalWebhookEvent(
                paypal_event_id=f"evt_nopay_{provider}",
                last_attempt_at=_now(),
                payload=None,
            )
            event_done = "evt_done_paypal"
            event_nopay = "evt_nopay_paypal"
        session.add(processed)
        session.add(no_payload)
        await session.commit()

        with pytest.raises(HTTPException) as already:
            await ops_service.retry_webhook(
                session, bg, provider=provider, event_id=event_done
            )
        assert already.value.status_code == 400

        with pytest.raises(HTTPException) as nopay:
            await ops_service.retry_webhook(
                session, bg, provider=provider, event_id=event_nopay
            )
        assert nopay.value.status_code == 400


@pytest.mark.parametrize("provider", ["stripe", "paypal"])
async def test_retry_webhook_success(session_factory, monkeypatch, provider) -> None:
    bg = BackgroundTasks()

    async def _ok(_session, _bg, _payload):
        return None

    monkeypatch.setattr(ops_service.webhook_handlers, "process_stripe_event", _ok)
    monkeypatch.setattr(ops_service.webhook_handlers, "process_paypal_event", _ok)

    async with session_factory() as session:
        if provider == "stripe":
            row = StripeWebhookEvent(
                stripe_event_id="evt_ok_stripe",
                event_type="charge",
                last_attempt_at=_now(),
                last_error="prev",
                payload={"a": 1},
            )
            event_id = "evt_ok_stripe"
        else:
            row = PayPalWebhookEvent(
                paypal_event_id="evt_ok_paypal",
                event_type="sale",
                last_attempt_at=_now(),
                last_error="prev",
                payload={"a": 1},
            )
            event_id = "evt_ok_paypal"
        session.add(row)
        await session.commit()

        result = await ops_service.retry_webhook(
            session, bg, provider=provider, event_id=event_id
        )

    assert result.provider == provider
    assert result.status == "processed"


@pytest.mark.parametrize(
    "raised, expected_status",
    [
        (HTTPException(status_code=409, detail="conflict"), 409),
        (ValueError("kaboom"), 500),
    ],
)
@pytest.mark.parametrize("provider", ["stripe", "paypal"])
async def test_retry_webhook_handler_failures(
    session_factory, monkeypatch, provider, raised, expected_status
) -> None:
    bg = BackgroundTasks()

    async def _boom(_session, _bg, _payload):
        raise raised

    monkeypatch.setattr(ops_service.webhook_handlers, "process_stripe_event", _boom)
    monkeypatch.setattr(ops_service.webhook_handlers, "process_paypal_event", _boom)

    tag = f"{provider}_{expected_status}"
    async with session_factory() as session:
        if provider == "stripe":
            row = StripeWebhookEvent(
                stripe_event_id=f"evt_err_{tag}",
                last_attempt_at=_now(),
                payload={"a": 1},
            )
            event_id = f"evt_err_{tag}"
        else:
            row = PayPalWebhookEvent(
                paypal_event_id=f"evt_err_{tag}",
                last_attempt_at=_now(),
                payload={"a": 1},
            )
            event_id = f"evt_err_{tag}"
        session.add(row)
        await session.commit()

        with pytest.raises(HTTPException) as exc:
            await ops_service.retry_webhook(
                session, bg, provider=provider, event_id=event_id
            )
    assert exc.value.status_code == expected_status


@pytest.mark.parametrize("provider", ["stripe", "paypal"])
async def test_retry_webhook_row_vanishes_after_success(
    session_factory, monkeypatch, provider
) -> None:
    """If the row is gone post-handler, the success block falls through to 500."""
    bg = BackgroundTasks()

    async def _ok(_session, _bg, _payload):
        return None

    monkeypatch.setattr(ops_service.webhook_handlers, "process_stripe_event", _ok)
    monkeypatch.setattr(ops_service.webhook_handlers, "process_paypal_event", _ok)

    async with session_factory() as session:
        if provider == "stripe":
            row = StripeWebhookEvent(
                stripe_event_id="evt_vanish_stripe",
                last_attempt_at=_now(),
                payload={"a": 1},
            )
            event_id = "evt_vanish_stripe"
        else:
            row = PayPalWebhookEvent(
                paypal_event_id="evt_vanish_paypal",
                last_attempt_at=_now(),
                payload={"a": 1},
            )
            event_id = "evt_vanish_paypal"
        session.add(row)
        await session.commit()

        # The post-handler ``session.get`` reload returns None so the
        # ``if updated:`` block is skipped and the trailing 500 raise fires.
        async def _get(model, pk):
            return None

        monkeypatch.setattr(session, "get", _get)

        with pytest.raises(HTTPException) as exc:
            await ops_service.retry_webhook(
                session, bg, provider=provider, event_id=event_id
            )
    assert exc.value.status_code == 500


@pytest.mark.parametrize(
    "raised, expected_status",
    [
        (ValueError("kaboom"), 500),
        (HTTPException(status_code=409, detail="conflict"), 409),
    ],
)
@pytest.mark.parametrize("provider", ["stripe", "paypal"])
async def test_retry_webhook_row_vanishes_after_failure(
    session_factory, monkeypatch, provider, raised, expected_status
) -> None:
    """If the row is gone post-failure, the error path re-raises without update.

    Both the generic-exception (500) and HTTPException (re-raised) handler arms
    are exercised with ``session.get`` returning None so the ``if updated:``
    branch is taken in its falsy direction.
    """
    bg = BackgroundTasks()

    async def _boom(_session, _bg, _payload):
        raise raised

    monkeypatch.setattr(ops_service.webhook_handlers, "process_stripe_event", _boom)
    monkeypatch.setattr(ops_service.webhook_handlers, "process_paypal_event", _boom)

    tag = f"{provider}_{expected_status}"
    async with session_factory() as session:
        if provider == "stripe":
            row = StripeWebhookEvent(
                stripe_event_id=f"evt_vanish_err_{tag}",
                last_attempt_at=_now(),
                payload={"a": 1},
            )
            event_id = f"evt_vanish_err_{tag}"
        else:
            row = PayPalWebhookEvent(
                paypal_event_id=f"evt_vanish_err_{tag}",
                last_attempt_at=_now(),
                payload={"a": 1},
            )
            event_id = f"evt_vanish_err_{tag}"
        session.add(row)
        await session.commit()

        async def _get(model, pk):
            return None

        monkeypatch.setattr(session, "get", _get)

        with pytest.raises(HTTPException) as exc:
            await ops_service.retry_webhook(
                session, bg, provider=provider, event_id=event_id
            )
    assert exc.value.status_code == expected_status


# --------------------------------------------------------------------------- #
# Production-env helper + TCP check                                           #
# --------------------------------------------------------------------------- #
def test_is_production_env(monkeypatch) -> None:
    monkeypatch.setattr(ops_service.settings, "environment", "production")
    assert ops_service._is_production_env() is True
    monkeypatch.setattr(ops_service.settings, "environment", "local")
    assert ops_service._is_production_env() is False


async def test_tcp_connect_check_missing_host_and_bad_port() -> None:
    ok, err = await ops_service._tcp_connect_check("", 25, timeout_seconds=0.1)
    assert ok is False and err == "Missing host"

    ok, err = await ops_service._tcp_connect_check(
        "localhost",
        "not-an-int",
        timeout_seconds=0.1,  # type: ignore[arg-type]
    )
    assert ok is False and err == "Invalid port"


async def test_tcp_connect_check_success_and_failure(monkeypatch) -> None:
    class _Writer:
        def close(self):
            return None

        async def wait_closed(self):
            return None

    async def _open_ok(host, port):
        return object(), _Writer()

    monkeypatch.setattr(ops_service.asyncio, "open_connection", _open_ok)
    ok, err = await ops_service._tcp_connect_check("h", 1, timeout_seconds=0.5)
    assert ok is True and err is None

    async def _open_fail(host, port):
        raise OSError("refused")

    monkeypatch.setattr(ops_service.asyncio, "open_connection", _open_fail)
    ok, err = await ops_service._tcp_connect_check("h", 1, timeout_seconds=0.5)
    assert ok is False and "refused" in (err or "")


# --------------------------------------------------------------------------- #
# Diagnostics                                                                 #
# --------------------------------------------------------------------------- #
async def test_diagnostics_all_off(monkeypatch) -> None:
    monkeypatch.setattr(ops_service.settings, "environment", "local")
    monkeypatch.setattr(ops_service.settings, "smtp_enabled", False, raising=False)
    monkeypatch.setattr(ops_service.settings, "redis_url", "", raising=False)
    monkeypatch.setattr(ops_service.settings, "media_root", "", raising=False)
    monkeypatch.setattr(ops_service.settings, "private_media_root", "", raising=False)
    monkeypatch.setattr(ops_service.settings, "netopia_enabled", False, raising=False)
    monkeypatch.setattr(ops_service, "payments_provider", lambda: "fake")

    out = await ops_service.get_diagnostics()
    assert out.smtp.status == "off"
    assert out.redis.status == "off"
    assert out.storage.configured is False
    assert out.stripe.status == "off"
    assert out.paypal.status == "off"
    assert out.netopia.status == "off"


async def test_diagnostics_smtp_missing_from(monkeypatch) -> None:
    monkeypatch.setattr(ops_service.settings, "smtp_enabled", True, raising=False)
    monkeypatch.setattr(ops_service.settings, "smtp_from_email", "", raising=False)
    monkeypatch.setattr(ops_service.settings, "redis_url", "", raising=False)
    monkeypatch.setattr(ops_service.settings, "media_root", "", raising=False)
    monkeypatch.setattr(ops_service.settings, "private_media_root", "", raising=False)
    monkeypatch.setattr(ops_service.settings, "netopia_enabled", False, raising=False)
    monkeypatch.setattr(ops_service, "payments_provider", lambda: "fake")

    out = await ops_service.get_diagnostics()
    assert out.smtp.status == "error"
    assert "SMTP_FROM_EMAIL" in (out.smtp.message or "")


@pytest.mark.parametrize("tcp_ok", [True, False])
async def test_diagnostics_smtp_tcp(monkeypatch, tcp_ok) -> None:
    monkeypatch.setattr(ops_service.settings, "smtp_enabled", True, raising=False)
    monkeypatch.setattr(
        ops_service.settings, "smtp_from_email", "ops@x.io", raising=False
    )
    monkeypatch.setattr(ops_service.settings, "smtp_host", "smtp.x", raising=False)
    monkeypatch.setattr(ops_service.settings, "smtp_port", 587, raising=False)
    monkeypatch.setattr(ops_service.settings, "redis_url", "", raising=False)
    monkeypatch.setattr(ops_service.settings, "media_root", "", raising=False)
    monkeypatch.setattr(ops_service.settings, "private_media_root", "", raising=False)
    monkeypatch.setattr(ops_service.settings, "netopia_enabled", False, raising=False)
    monkeypatch.setattr(ops_service, "payments_provider", lambda: "fake")

    async def _tcp(host, port, *, timeout_seconds):
        return (tcp_ok, None if tcp_ok else "down")

    monkeypatch.setattr(ops_service, "_tcp_connect_check", _tcp)

    out = await ops_service.get_diagnostics()
    assert out.smtp.status == ("ok" if tcp_ok else "error")


async def test_diagnostics_redis_unavailable(monkeypatch) -> None:
    monkeypatch.setattr(ops_service.settings, "smtp_enabled", False, raising=False)
    monkeypatch.setattr(
        ops_service.settings, "redis_url", "redis://localhost", raising=False
    )
    monkeypatch.setattr(ops_service.settings, "media_root", "", raising=False)
    monkeypatch.setattr(ops_service.settings, "private_media_root", "", raising=False)
    monkeypatch.setattr(ops_service.settings, "netopia_enabled", False, raising=False)
    monkeypatch.setattr(ops_service, "payments_provider", lambda: "fake")
    monkeypatch.setattr(ops_service, "get_redis", lambda: None)

    out = await ops_service.get_diagnostics()
    assert out.redis.status == "error"
    assert "unavailable" in (out.redis.message or "")


@pytest.mark.parametrize("ping_ok", [True, False])
async def test_diagnostics_redis_ping(monkeypatch, ping_ok) -> None:
    monkeypatch.setattr(ops_service.settings, "smtp_enabled", False, raising=False)
    monkeypatch.setattr(
        ops_service.settings, "redis_url", "redis://localhost", raising=False
    )
    monkeypatch.setattr(ops_service.settings, "media_root", "", raising=False)
    monkeypatch.setattr(ops_service.settings, "private_media_root", "", raising=False)
    monkeypatch.setattr(ops_service.settings, "netopia_enabled", False, raising=False)
    monkeypatch.setattr(ops_service, "payments_provider", lambda: "fake")

    class _Client:
        async def ping(self):
            return ping_ok

    monkeypatch.setattr(ops_service, "get_redis", lambda: _Client())

    out = await ops_service.get_diagnostics()
    assert out.redis.status == "ok"
    assert out.redis.healthy is ping_ok


async def test_diagnostics_redis_ping_exception(monkeypatch) -> None:
    monkeypatch.setattr(ops_service.settings, "smtp_enabled", False, raising=False)
    monkeypatch.setattr(
        ops_service.settings, "redis_url", "redis://localhost", raising=False
    )
    monkeypatch.setattr(ops_service.settings, "media_root", "", raising=False)
    monkeypatch.setattr(ops_service.settings, "private_media_root", "", raising=False)
    monkeypatch.setattr(ops_service.settings, "netopia_enabled", False, raising=False)
    monkeypatch.setattr(ops_service, "payments_provider", lambda: "fake")

    class _Client:
        async def ping(self):
            raise RuntimeError("ping-fail")

    monkeypatch.setattr(ops_service, "get_redis", lambda: _Client())

    out = await ops_service.get_diagnostics()
    assert out.redis.status == "error"
    assert "ping-fail" in (out.redis.message or "")


async def test_diagnostics_storage_ok(monkeypatch, tmp_path) -> None:
    media = tmp_path / "media"
    private = tmp_path / "private"
    media.mkdir()
    private.mkdir()
    monkeypatch.setattr(ops_service.settings, "smtp_enabled", False, raising=False)
    monkeypatch.setattr(ops_service.settings, "redis_url", "", raising=False)
    monkeypatch.setattr(ops_service.settings, "media_root", str(media), raising=False)
    monkeypatch.setattr(
        ops_service.settings, "private_media_root", str(private), raising=False
    )
    monkeypatch.setattr(ops_service.settings, "netopia_enabled", False, raising=False)
    monkeypatch.setattr(ops_service, "payments_provider", lambda: "fake")

    out = await ops_service.get_diagnostics()
    assert out.storage.status == "ok"
    assert out.storage.healthy is True


async def test_diagnostics_storage_issues(monkeypatch, tmp_path) -> None:
    missing = tmp_path / "missing"
    a_file = tmp_path / "afile"
    a_file.write_text("x")
    monkeypatch.setattr(ops_service.settings, "smtp_enabled", False, raising=False)
    monkeypatch.setattr(ops_service.settings, "redis_url", "", raising=False)
    monkeypatch.setattr(ops_service.settings, "media_root", str(missing), raising=False)
    monkeypatch.setattr(
        ops_service.settings, "private_media_root", str(a_file), raising=False
    )
    monkeypatch.setattr(ops_service.settings, "netopia_enabled", False, raising=False)
    monkeypatch.setattr(ops_service, "payments_provider", lambda: "fake")

    out = await ops_service.get_diagnostics()
    assert out.storage.status == "warning"
    assert "missing" in (out.storage.message or "")
    assert "not a directory" in (out.storage.message or "")


async def test_diagnostics_storage_not_writable(monkeypatch, tmp_path) -> None:
    media = tmp_path / "m2"
    private = tmp_path / "p2"
    media.mkdir()
    private.mkdir()
    monkeypatch.setattr(ops_service.settings, "smtp_enabled", False, raising=False)
    monkeypatch.setattr(ops_service.settings, "redis_url", "", raising=False)
    monkeypatch.setattr(ops_service.settings, "media_root", str(media), raising=False)
    monkeypatch.setattr(
        ops_service.settings, "private_media_root", str(private), raising=False
    )
    monkeypatch.setattr(ops_service.settings, "netopia_enabled", False, raising=False)
    monkeypatch.setattr(ops_service, "payments_provider", lambda: "fake")

    # Force the os.access writability probe to report False for the not-writable branch.
    monkeypatch.setattr(ops_service.os, "access", lambda *a, **k: False)

    out = await ops_service.get_diagnostics()
    assert out.storage.status == "warning"
    assert "not writable" in (out.storage.message or "")


@pytest.mark.parametrize("configured", [True, False])
@pytest.mark.parametrize("prod", [True, False])
async def test_diagnostics_payment_providers(monkeypatch, configured, prod) -> None:
    monkeypatch.setattr(ops_service.settings, "smtp_enabled", False, raising=False)
    monkeypatch.setattr(ops_service.settings, "redis_url", "", raising=False)
    monkeypatch.setattr(ops_service.settings, "media_root", "", raising=False)
    monkeypatch.setattr(ops_service.settings, "private_media_root", "", raising=False)
    monkeypatch.setattr(ops_service.settings, "netopia_enabled", True, raising=False)
    monkeypatch.setattr(
        ops_service.settings,
        "environment",
        "production" if prod else "local",
    )
    monkeypatch.setattr(ops_service, "payments_provider", lambda: "real")

    monkeypatch.setattr(
        ops_service.stripe_payments, "is_stripe_configured", lambda: configured
    )
    monkeypatch.setattr(
        ops_service.stripe_payments,
        "is_stripe_webhook_configured",
        lambda: configured,
    )
    monkeypatch.setattr(
        ops_service.paypal_service, "is_paypal_configured", lambda: configured
    )
    monkeypatch.setattr(
        ops_service.paypal_service,
        "is_paypal_webhook_configured",
        lambda: configured,
    )
    monkeypatch.setattr(
        ops_service.netopia_service,
        "netopia_configuration_status",
        lambda: (configured, None if configured else "no keys"),
    )

    out = await ops_service.get_diagnostics()
    if configured:
        assert out.stripe.status == "ok"
        assert out.paypal.status == "ok"
        assert out.netopia.status == "ok"
    else:
        expected = "error" if prod else "warning"
        assert out.stripe.status == expected
        assert out.paypal.status == expected
        assert out.netopia.status == expected
