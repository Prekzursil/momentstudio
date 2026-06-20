"""Coverage-completion tests (worker 5) for app.services.email.

The module is a thick set of ``send_*`` notification builders that all funnel
into ``send_email``. We exercise the full body of every builder by replacing
``send_email`` with a capturing stub (so text/html/subject/headers/attachments
are built for real and asserted), and we cover the lower-level helpers
(``_build_message``, ``_money_str``, ``_bilingual_*``, the rate limiter, the DB
event/failure recorders, etc.) directly.

Both jinja2-available and ``env is None`` fallback arcs are covered for the
template-backed builders.
"""

import asyncio
import logging
from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.services import email as e


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture
def capture_send(monkeypatch):
    """Replace ``send_email`` with a stub that records every call and returns True."""
    calls: list[dict] = []

    async def _stub(to_email, subject, text_body, html_body=None, **kwargs):
        calls.append(
            {
                "to_email": to_email,
                "subject": subject,
                "text_body": text_body,
                "html_body": html_body,
                "attachments": kwargs.get("attachments"),
                "headers": kwargs.get("headers"),
            }
        )
        return True

    monkeypatch.setattr(e, "send_email", _stub)
    return calls


# --------------------------------------------------------------------------- #
# Low-level message construction
# --------------------------------------------------------------------------- #


def test_build_message_full_branches():
    msg = e._build_message(
        "to@example.com",
        "Subject",
        "text body",
        "<p>html</p>",
        attachments=[
            {"filename": "a.pdf", "mime": "application/pdf", "content": b"%PDF"},
            {"filename": "noslash", "mime": "weirdmime", "content": b"x"},
            {"filename": "skip", "mime": "text/plain", "content": "not-bytes"},
        ],
        headers={
            "X-Custom": "yes",
            "": "blankkey",
            "X-Blank": "",
            "Subject": "must-be-ignored",
        },
    )
    assert msg["To"] == "to@example.com"
    assert msg["X-Custom"] == "yes"
    # Reserved/blank headers were filtered out, Subject not overridden.
    assert msg["Subject"] == "Subject"
    assert msg.get("X-Blank") is None


def test_build_message_default_from(monkeypatch):
    monkeypatch.setattr(e.settings, "smtp_from_email", None)
    msg = e._build_message("to@example.com", "S", "t")
    assert msg["From"] == "no-reply@momentstudio.local"


def test_build_message_no_html_no_attachments():
    msg = e._build_message("to@example.com", "S", "text only")
    assert msg["Subject"] == "S"


def test_html_pre_escapes():
    out = e._html_pre("<script>&")
    assert "&lt;script&gt;" in out
    assert "<pre" in out


def test_money_str_decimal_and_fallback():
    assert e._money_str(Decimal("1.5"), "RON") == "1.50 RON"
    # str input coerced to Decimal then quantized (ROUND_HALF_EVEN).
    assert e._money_str("12.344", "EUR") == "12.34 EUR"

    class Bad:
        def __str__(self):
            return "x" * 100

    out = e._money_str(Bad(), "USD")
    assert out.endswith(" USD")
    assert "..." in out

    class Empty:
        def __str__(self):
            return "   "

    assert e._money_str(Empty(), "RON") == "0 RON"


# --------------------------------------------------------------------------- #
# Language / bilingual helpers
# --------------------------------------------------------------------------- #


def test_lang_helpers():
    assert e._lang_or_default("ro") == "ro"
    assert e._lang_or_default("xx") == "en"
    assert e._lang_or_default(None) == "en"
    assert e._lang_order("ro") == ("ro", "en")
    assert e._lang_order("en") == ("en", "ro")
    assert e._bilingual_subject("RO", "EN", preferred_language="ro") == "RO / EN"
    assert e._bilingual_subject("RO", "EN", preferred_language="en") == "EN / RO"


def test_bilingual_sections_full_and_empty():
    text, html = e._bilingual_sections(
        text_ro="Salut",
        text_en="Hello",
        html_ro="<b>Salut</b>",
        html_en="<b>Hello</b>",
        preferred_language="en",
    )
    assert "[English]" in text and "[Română]" in text
    assert "<hr" in html

    # One language empty -> that section skipped (covers the falsy-body arcs).
    text2, html2 = e._bilingual_sections(
        text_ro="",
        text_en="Hello",
        html_ro="",
        html_en="",
        preferred_language="ro",
    )
    assert "English" in text2
    assert html2 is None


# --------------------------------------------------------------------------- #
# Label helpers
# --------------------------------------------------------------------------- #


def test_courier_label():
    assert e._courier_label(None, lang="en") is None
    assert e._courier_label("", lang="en") is None
    assert e._courier_label("sameday", lang="en") == "Sameday"
    assert e._courier_label("fan_courier", lang="en") == "Fan Courier"
    assert e._courier_label("other", lang="en") == "other"


def test_delivery_type_label():
    assert e._delivery_type_label(None, lang="en") is None
    assert e._delivery_type_label("home", lang="en") == "Home delivery"
    assert e._delivery_type_label("home", lang="ro") == "Livrare la adresă"
    assert e._delivery_type_label("locker", lang="en") == "Locker pickup"
    assert e._delivery_type_label("locker", lang="ro") == "Ridicare din locker"
    assert e._delivery_type_label("weird", lang="en") == "weird"


def test_payment_method_label():
    assert e._payment_method_label(None, lang="en") is None
    assert e._payment_method_label("stripe", lang="en") == "Stripe"
    assert e._payment_method_label("cod", lang="en") == "Cash"
    assert e._payment_method_label("cod", lang="ro") == "Numerar"
    assert e._payment_method_label("paypal", lang="en") == "PayPal"
    assert e._payment_method_label("netopia", lang="en") == "Netopia"
    assert e._payment_method_label("bank", lang="en") == "bank"


def test_delivery_lines_locker_and_none():
    order = SimpleNamespace(
        courier="sameday",
        delivery_type="locker",
        locker_name="Locker 1",
        locker_address="Str. X",
    )
    lines = e._delivery_lines(order, lang="en")
    assert any("Delivery" in ln for ln in lines)
    assert any("Locker" in ln for ln in lines)

    empty = SimpleNamespace(courier=None, delivery_type=None)
    assert e._delivery_lines(empty, lang="ro") == []

    # locker type but no locker name/address -> a Delivery line (from the
    # locker delivery-type label) but NO separate Locker detail line.
    locker_blank = SimpleNamespace(
        courier=None, delivery_type="locker", locker_name="", locker_address=""
    )
    blank_lines = e._delivery_lines(locker_blank, lang="en")
    assert blank_lines == ["Delivery: Locker pickup"]


def test_sanitize_next_path():
    assert e._sanitize_next_path(None) is None
    assert e._sanitize_next_path("   ") is None
    assert e._sanitize_next_path("/checkout") == "/checkout"
    assert e._sanitize_next_path("//evil.com") is None
    assert e._sanitize_next_path("http://evil") is None
    assert e._sanitize_next_path("relative") is None


# --------------------------------------------------------------------------- #
# render_bilingual_template / render_template (env present + env None)
# --------------------------------------------------------------------------- #


def test_render_bilingual_template_with_env():
    text, html = e.render_bilingual_template(
        "back_in_stock.txt.j2", {"product_name": "Cup"}, preferred_language="ro"
    )
    assert isinstance(text, str) and isinstance(html, str)


def test_render_bilingual_template_with_unsubscribe_url():
    text, html = e.render_bilingual_template(
        "cart_abandonment.txt.j2",
        {"cart_url": "http://x/cart", "unsubscribe_url": "http://x/unsub"},
        preferred_language="en",
    )
    assert "http://x/unsub" in html or "http://x/unsub" in text


def test_render_bilingual_template_blank_unsubscribe():
    # unsubscribe_url is blank -> normalized to None branch.
    text, html = e.render_bilingual_template(
        "cart_abandonment.txt.j2",
        {"cart_url": "http://x/cart", "unsubscribe_url": "   "},
        preferred_language="en",
    )
    assert isinstance(text, str)


def test_render_bilingual_template_env_none(monkeypatch):
    monkeypatch.setattr(e, "env", None)
    text, html = e.render_bilingual_template("whatever.txt.j2", {})
    assert "not available" in text
    assert "<pre" in html


def test_render_template_with_env_and_none(monkeypatch):
    text, html = e.render_template("back_in_stock.txt.j2", {"product_name": "Cup"})
    assert isinstance(text, str) and isinstance(html, str)
    monkeypatch.setattr(e, "env", None)
    text2, html2 = e.render_template("x.txt.j2", {})
    assert "not available" in text2


def test_preview_email():
    out = _run(e.preview_email("back_in_stock.txt.j2", {"product_name": "Cup"}))
    assert "text" in out and "html" in out


def test_marketing_unsubscribe_context(monkeypatch):
    monkeypatch.setattr(e.settings, "list_unsubscribe_mailto", "ml@example.com")
    url, headers = e._marketing_unsubscribe_context(to_email="User@Example.com")
    assert url
    assert "List-Unsubscribe" in headers
    assert "mailto:ml@example.com" in headers["List-Unsubscribe"]

    monkeypatch.setattr(e.settings, "list_unsubscribe_mailto", "mailto:already@x.com")
    _, headers2 = e._marketing_unsubscribe_context(to_email="u@x.com")
    assert "mailto:already@x.com" in headers2["List-Unsubscribe"]

    monkeypatch.setattr(e.settings, "list_unsubscribe_mailto", None)
    _, headers3 = e._marketing_unsubscribe_context(to_email="u@x.com")
    assert "List-Unsubscribe" in headers3


# --------------------------------------------------------------------------- #
# send_email body + DB recorders
# --------------------------------------------------------------------------- #


def test_send_email_disabled(monkeypatch):
    monkeypatch.setattr(e.settings, "smtp_enabled", False)
    assert _run(e.send_email("a@x.com", "S", "t")) is False


def test_send_email_rate_limited(monkeypatch, caplog):
    monkeypatch.setattr(e.settings, "smtp_enabled", True)
    monkeypatch.setattr(e, "_allow_send", lambda now, rec: False)
    caplog.set_level(logging.WARNING, logger="app.services.email")
    assert _run(e.send_email("a@x.com", "S", "t")) is False
    assert "email_rate_limited" in caplog.text


class _DummySMTP:
    def __init__(self, host, port, timeout=10):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def starttls(self):
        return None

    def login(self, u, p):
        return None

    def send_message(self, msg):
        return {}


def test_send_email_success_with_tls_and_auth(monkeypatch):
    monkeypatch.setattr(e.settings, "smtp_enabled", True)
    monkeypatch.setattr(e.settings, "smtp_host", "smtp.test")
    monkeypatch.setattr(e.settings, "smtp_port", 587)
    monkeypatch.setattr(e.settings, "smtp_use_tls", True)
    monkeypatch.setattr(e.settings, "smtp_username", "user")
    monkeypatch.setattr(e.settings, "smtp_password", "pass")
    monkeypatch.setattr(e.smtplib, "SMTP", _DummySMTP)

    async def _noop(**kwargs):
        return None

    monkeypatch.setattr(e, "_record_email_event", _noop)
    e._rate_global.clear()
    e._rate_per_recipient.clear()
    assert _run(e.send_email("a@x.com", "S", "t", "<p>h</p>")) is True


def test_send_email_failure(monkeypatch, caplog):
    monkeypatch.setattr(e.settings, "smtp_enabled", True)
    monkeypatch.setattr(e.settings, "smtp_use_tls", False)
    monkeypatch.setattr(e.settings, "smtp_username", None)
    monkeypatch.setattr(e.settings, "smtp_password", None)

    class _BoomSMTP(_DummySMTP):
        def send_message(self, msg):
            raise RuntimeError("smtp down")

    monkeypatch.setattr(e.smtplib, "SMTP", _BoomSMTP)
    recorded = {}

    async def _ev(**kwargs):
        recorded["event"] = kwargs

    async def _fail(**kwargs):
        recorded["failure"] = kwargs

    monkeypatch.setattr(e, "_record_email_event", _ev)
    monkeypatch.setattr(e, "_record_email_failure", _fail)
    caplog.set_level(logging.WARNING, logger="app.services.email")
    e._rate_global.clear()
    e._rate_per_recipient.clear()
    assert _run(e.send_email("a@x.com", "S", "t")) is False
    assert recorded["event"]["status"] == "failed"
    assert "failure" in recorded


def test_record_email_event_success_and_error(monkeypatch, caplog):
    _run(
        e._record_email_event(
            to_email="x@y.com", subject="s", status="sent", error_message=None
        )
    )

    class _BoomSession:
        async def __aenter__(self):
            raise RuntimeError("db down")

        async def __aexit__(self, *a):
            return False

    monkeypatch.setattr(e, "SessionLocal", lambda: _BoomSession())
    caplog.set_level(logging.ERROR, logger="app.services.email")
    _run(
        e._record_email_event(
            to_email="x@y.com", subject="s", status="failed", error_message="oops"
        )
    )
    assert "Failed to persist email delivery event" in caplog.text


def test_record_email_failure_success_and_error(monkeypatch, caplog):
    _run(e._record_email_failure(to_email="x@y.com", subject="s", error_message="boom"))

    class _BoomSession:
        async def __aenter__(self):
            raise RuntimeError("db down")

        async def __aexit__(self, *a):
            return False

    monkeypatch.setattr(e, "SessionLocal", lambda: _BoomSession())
    caplog.set_level(logging.ERROR, logger="app.services.email")
    _run(e._record_email_failure(to_email="x@y.com", subject="s", error_message="b"))
    assert "Failed to persist email failure" in caplog.text


# --------------------------------------------------------------------------- #
# Rate-limit internals
# --------------------------------------------------------------------------- #


def test_prune_and_allow_record(monkeypatch):
    e._rate_global.clear()
    e._rate_per_recipient.clear()
    monkeypatch.setattr(e.settings, "email_rate_limit_per_minute", 2)
    monkeypatch.setattr(e.settings, "email_rate_limit_per_recipient_per_minute", 1)
    now = 1000.0
    # old entries get pruned; a recent recipient entry survives (covers both the
    # list-becomes-empty arc AND the list-still-has-entries arc of _prune).
    e._rate_global.append(now - 120)
    e._rate_per_recipient["a@x.com"] = [now - 120]
    e._rate_per_recipient["recent@x.com"] = [now - 120, now - 1]
    e._prune(now)
    assert e._rate_global == []
    assert "a@x.com" not in e._rate_per_recipient
    assert e._rate_per_recipient["recent@x.com"] == [now - 1]
    e._rate_per_recipient.pop("recent@x.com", None)

    assert e._allow_send(now, "a@x.com") is True
    e._record_send(now, "a@x.com")
    # recipient limit (1) now reached
    assert e._allow_send(now, "a@x.com") is False
    # global limit reached after a second different recipient
    e._record_send(now, "b@x.com")
    assert e._allow_send(now, "c@x.com") is False


def test_allow_send_no_limits(monkeypatch):
    monkeypatch.setattr(e.settings, "email_rate_limit_per_minute", 0)
    monkeypatch.setattr(e.settings, "email_rate_limit_per_recipient_per_minute", 0)
    assert e._allow_send(1.0, "any@x.com") is True


# --------------------------------------------------------------------------- #
# Order/notification builders (full bodies via capture_send)
# --------------------------------------------------------------------------- #


def _order(**over):
    base = dict(
        id="oid-1",
        reference_code="REF123",
        currency="RON",
        payment_method="stripe",
        courier="sameday",
        delivery_type="home",
        shipping_amount=Decimal("10.00"),
        fee_amount=Decimal("2.00"),
        tax_amount=Decimal("3.00"),
        total_amount=Decimal("50.00"),
        receipt_token_version=1,
        tracking_url="http://track/1",
        cancel_reason="changed mind",
        status=SimpleNamespace(value="paid"),
    )
    base.update(over)
    return SimpleNamespace(**base)


def _item(**over):
    base = dict(
        product=SimpleNamespace(name="Cup", slug="cup"),
        product_id="pid-1",
        quantity=2,
        unit_price=Decimal("10.00"),
    )
    base.update(over)
    return SimpleNamespace(**base)


def test_send_order_confirmation_full(capture_send, monkeypatch):
    monkeypatch.setattr(
        e.receipt_service, "render_order_receipt_pdf", lambda order, items: b"%PDF-1.4"
    )
    items = [
        _item(),
        _item(unit_price=None, product=SimpleNamespace(name="NoPrice", slug="")),
    ]
    ok = _run(
        e.send_order_confirmation(
            "a@x.com", _order(), items=items, lang="ro", receipt_share_days=10
        )
    )
    assert ok is True
    call = capture_send[0]
    assert call["attachments"][0]["mime"] == "application/pdf"
    assert "REF123" in call["subject"]


def test_send_order_confirmation_minimal(capture_send, monkeypatch):
    monkeypatch.setattr(
        e.receipt_service, "render_order_receipt_pdf", lambda order, items: b"%PDF"
    )
    # No items, zero fee, missing optional amounts, no reference -> id fallback.
    order = _order(
        reference_code=None,
        payment_method=None,
        shipping_amount=None,
        fee_amount=None,
        tax_amount=None,
        courier=None,
        delivery_type=None,
    )
    ok = _run(e.send_order_confirmation("a@x.com", order, items=None, lang="en"))
    assert ok is True


def test_send_order_confirmation_zero_fee(capture_send, monkeypatch):
    monkeypatch.setattr(
        e.receipt_service, "render_order_receipt_pdf", lambda order, items: b"%PDF"
    )
    # fee present but zero -> the "additional cost" line is skipped.
    order = _order(fee_amount=Decimal("0.00"))
    ok = _run(e.send_order_confirmation("a@x.com", order, items=[], lang="ro"))
    assert ok is True


def test_send_order_confirmation_bad_fee(capture_send, monkeypatch):
    monkeypatch.setattr(
        e.receipt_service, "render_order_receipt_pdf", lambda order, items: b"%PDF"
    )
    order = _order(fee_amount="not-a-number")
    ok = _run(e.send_order_confirmation("a@x.com", order, items=[], lang="en"))
    assert ok is True


def test_send_order_processing_update(capture_send):
    assert _run(e.send_order_processing_update("a@x.com", _order(), lang="ro")) is True
    # payment_method None -> the "Payment:" line is skipped (False arc).
    assert (
        _run(
            e.send_order_processing_update(
                "a@x.com", _order(payment_method=None), lang="en"
            )
        )
        is True
    )


def test_send_order_cancelled_update_card(capture_send):
    assert (
        _run(
            e.send_order_cancelled_update(
                "a@x.com", _order(payment_method="stripe"), lang="en"
            )
        )
        is True
    )


def test_send_order_cancelled_update_no_reason_no_payment(capture_send):
    # no cancel reason, payment_method None -> Payment line skipped, no card note.
    order = _order(cancel_reason=None, payment_method=None)
    assert _run(e.send_order_cancelled_update("a@x.com", order, lang="ro")) is True
    # cod payment -> payment line present but no card-refund note.
    order2 = _order(cancel_reason=None, payment_method="cod")
    assert _run(e.send_order_cancelled_update("a@x.com", order2, lang="en")) is True


def test_send_order_cancel_request_notification(capture_send):
    assert (
        _run(
            e.send_order_cancel_request_notification(
                "a@x.com",
                _order(),
                requested_by_email="req@x.com",
                reason="dup order",
                lang="en",
            )
        )
        is True
    )


def test_send_order_cancel_request_minimal(capture_send):
    # status "" -> status line skipped; payment None -> payment line skipped.
    order = _order(status="", payment_method=None)
    assert (
        _run(
            e.send_order_cancel_request_notification(
                "a@x.com", order, requested_by_email=None, reason=None, lang="ro"
            )
        )
        is True
    )


def test_send_order_refunded_update(capture_send):
    assert _run(e.send_order_refunded_update("a@x.com", _order(), lang="ro")) is True
    # payment None -> payment line skipped (False arc).
    assert (
        _run(
            e.send_order_refunded_update(
                "a@x.com", _order(payment_method=None), lang="en"
            )
        )
        is True
    )


def test_send_order_partial_refund_update(capture_send):
    refund = SimpleNamespace(amount=Decimal("5.00"), note="partial", provider="stripe")
    assert (
        _run(e.send_order_partial_refund_update("a@x.com", _order(), refund, lang="en"))
        is True
    )
    refund2 = SimpleNamespace(amount=Decimal("5.00"), note=None, provider=None)
    assert (
        _run(
            e.send_order_partial_refund_update("a@x.com", _order(), refund2, lang="ro")
        )
        is True
    )


def test_send_new_order_notification(capture_send):
    assert (
        _run(
            e.send_new_order_notification(
                "a@x.com", _order(), customer_email="cust@x.com", lang="ro"
            )
        )
        is True
    )
    # no customer email and payment None -> both optional lines skipped.
    assert (
        _run(
            e.send_new_order_notification(
                "a@x.com", _order(payment_method=None), lang="en"
            )
        )
        is True
    )


def test_send_password_reset(capture_send):
    assert _run(e.send_password_reset("a@x.com", "tok123", lang="ro")) is True


def test_send_verification_email_variants(capture_send):
    assert _run(e.send_verification_email("a@x.com", "tok", lang="en")) is True
    assert (
        _run(
            e.send_verification_email(
                "a@x.com", "tok", kind="guest", next_path="/checkout/pay"
            )
        )
        is True
    )
    assert (
        _run(
            e.send_verification_email(
                "a@x.com", "tok", kind="secondary", next_path="/account"
            )
        )
        is True
    )
    # guest with no/invalid next_path -> default /checkout
    assert (
        _run(
            e.send_verification_email("a@x.com", "tok", kind="guest", next_path="//bad")
        )
        is True
    )


def test_send_welcome_email(capture_send):
    assert _run(e.send_welcome_email("a@x.com", first_name="Ana", lang="ro")) is True
    assert _run(e.send_welcome_email("a@x.com", first_name="", lang="en")) is True


def test_send_password_changed(capture_send):
    assert _run(e.send_password_changed("a@x.com", lang="ro")) is True


def test_send_email_changed(capture_send):
    assert (
        _run(
            e.send_email_changed(
                "a@x.com", old_email="o@x.com", new_email="n@x.com", lang="en"
            )
        )
        is True
    )


def test_send_admin_login_alert(capture_send):
    assert (
        _run(
            e.send_admin_login_alert(
                "a@x.com",
                admin_username="root",
                admin_display_name="Root Admin",
                admin_role="superadmin",
                ip_address="1.2.3.4",
                country_code="RO",
                user_agent="curl",
                occurred_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
                lang="ro",
            )
        )
        is True
    )
    # minimal -> defaults (unknown ip/ua, no display name/role/cc)
    assert (
        _run(e.send_admin_login_alert("a@x.com", admin_username="root", lang="en"))
        is True
    )


def test_send_shipping_update(capture_send):
    assert (
        _run(
            e.send_shipping_update(
                "a@x.com", _order(), tracking_number="AWB1", lang="ro"
            )
        )
        is True
    )
    order = _order(tracking_url=None)
    assert _run(e.send_shipping_update("a@x.com", order, lang="en")) is True


def test_send_delivery_confirmation(capture_send):
    assert _run(e.send_delivery_confirmation("a@x.com", _order(), lang="ro")) is True


def test_send_refund_requested_notification(capture_send):
    assert (
        _run(
            e.send_refund_requested_notification(
                "a@x.com",
                _order(),
                customer_email="c@x.com",
                requested_by_email="r@x.com",
                note="please",
                lang="ro",
            )
        )
        is True
    )
    assert (
        _run(e.send_refund_requested_notification("a@x.com", _order(), lang="en"))
        is True
    )


# --------------------------------------------------------------------------- #
# Template/marketing builders
# --------------------------------------------------------------------------- #


def test_send_cart_abandonment(capture_send):
    assert _run(e.send_cart_abandonment("a@x.com", lang="ro")) is True
    assert capture_send[0]["headers"] is not None


def test_send_back_in_stock(capture_send):
    assert _run(e.send_back_in_stock("a@x.com", "Cup", lang="en")) is True


def test_send_low_stock_alert(capture_send):
    assert _run(e.send_low_stock_alert("a@x.com", "Cup", 3, lang="ro")) is True


def test_send_coupon_assigned(capture_send):
    assert (
        _run(
            e.send_coupon_assigned(
                "a@x.com",
                coupon_code="welcome10",
                promotion_name="Welcome",
                promotion_description="desc",
                ends_at=datetime(2026, 6, 1, tzinfo=timezone.utc),
                lang="en",
            )
        )
        is True
    )
    assert (
        _run(
            e.send_coupon_assigned(
                "a@x.com", coupon_code="x", promotion_name="P", ends_at=None
            )
        )
        is True
    )


def test_send_coupon_revoked(capture_send):
    assert (
        _run(
            e.send_coupon_revoked(
                "a@x.com", coupon_code="x", promotion_name="P", reason="abuse"
            )
        )
        is True
    )
    assert (
        _run(e.send_coupon_revoked("a@x.com", coupon_code="x", promotion_name="P"))
        is True
    )


def test_send_newsletter_confirmation(capture_send):
    assert (
        _run(e.send_newsletter_confirmation("a@x.com", confirm_url="http://x/c"))
        is True
    )


def test_send_error_alert(capture_send):
    assert _run(e.send_error_alert("a@x.com", "boom")) is True


def test_send_stripe_dispute_notification(capture_send):
    assert (
        _run(
            e.send_stripe_dispute_notification(
                "a@x.com",
                event_type="charge.dispute.created",
                dispute_id="dp_1",
                charge_id="ch_1",
                amount=1500,
                currency="ron",
                reason="fraud",
                dispute_status="needs_response",
                lang="ro",
            )
        )
        is True
    )
    # minimal: no optional fields
    assert (
        _run(
            e.send_stripe_dispute_notification(
                "a@x.com", event_type="charge.dispute.updated", lang="en"
            )
        )
        is True
    )


# --- blog comment builders: both env-present and env=None fallback --- #


def test_blog_comment_admin(capture_send, monkeypatch):
    assert (
        _run(
            e.send_blog_comment_admin_notification(
                "a@x.com",
                post_title="T",
                post_url="http://x/p",
                commenter_name="Joe",
                comment_body="hi",
                lang="ro",
            )
        )
        is True
    )
    monkeypatch.setattr(e, "env", None)
    assert (
        _run(
            e.send_blog_comment_admin_notification(
                "a@x.com",
                post_title="T",
                post_url="http://x/p",
                commenter_name="Joe",
                comment_body="hi",
                lang="en",
            )
        )
        is True
    )


def test_blog_comment_subscriber(capture_send, monkeypatch):
    assert (
        _run(
            e.send_blog_comment_subscriber_notification(
                "a@x.com",
                post_title="T",
                post_url="http://x/p",
                commenter_name="Joe",
                comment_body="hi",
            )
        )
        is True
    )
    monkeypatch.setattr(e, "env", None)
    assert (
        _run(
            e.send_blog_comment_subscriber_notification(
                "a@x.com",
                post_title="T",
                post_url="http://x/p",
                commenter_name="Joe",
                comment_body="hi",
            )
        )
        is True
    )


def test_blog_comment_reply(capture_send, monkeypatch):
    assert (
        _run(
            e.send_blog_comment_reply_notification(
                "a@x.com",
                post_title="T",
                post_url="http://x/p",
                replier_name="Joe",
                comment_body="hi",
            )
        )
        is True
    )
    monkeypatch.setattr(e, "env", None)
    assert (
        _run(
            e.send_blog_comment_reply_notification(
                "a@x.com",
                post_title="T",
                post_url="http://x/p",
                replier_name="Joe",
                comment_body="hi",
            )
        )
        is True
    )


def test_contact_submission_notification(capture_send, monkeypatch):
    assert (
        _run(
            e.send_contact_submission_notification(
                "a@x.com",
                topic="support",
                from_name="Joe",
                from_email="joe@x.com",
                message="help",
                order_reference="REF",
                admin_url="http://x/a",
                lang="ro",
            )
        )
        is True
    )
    monkeypatch.setattr(e, "env", None)
    # env None + with order_reference + admin_url
    assert (
        _run(
            e.send_contact_submission_notification(
                "a@x.com",
                topic="support",
                from_name="Joe",
                from_email="joe@x.com",
                message="help",
                order_reference="REF",
                admin_url="http://x/a",
                lang="en",
            )
        )
        is True
    )
    # env None + without optionals
    assert (
        _run(
            e.send_contact_submission_notification(
                "a@x.com",
                topic="support",
                from_name="Joe",
                from_email="joe@x.com",
                message="help",
            )
        )
        is True
    )


def test_contact_submission_reply(capture_send, monkeypatch):
    assert (
        _run(
            e.send_contact_submission_reply(
                "a@x.com",
                customer_name="Joe",
                reply_message="thanks",
                topic="support",
                order_reference="REF",
                reference="TCK1",
                contact_url="http://x/c",
                lang="ro",
            )
        )
        is True
    )
    monkeypatch.setattr(e, "env", None)
    # env None with all optionals
    assert (
        _run(
            e.send_contact_submission_reply(
                "a@x.com",
                customer_name="Joe",
                reply_message="thanks",
                topic="support",
                order_reference="REF",
                reference="TCK1",
                contact_url="http://x/c",
                lang="en",
            )
        )
        is True
    )
    # env None, no optionals, empty name -> "Customer" default
    assert (
        _run(
            e.send_contact_submission_reply(
                "a@x.com", customer_name="", reply_message="thanks"
            )
        )
        is True
    )


# --- return request builders: env present + env None --- #


def _return_request(**over):
    base = dict(
        order=SimpleNamespace(reference_code="RR1", customer_name="Joe"),
        order_id="oid",
        items=[
            SimpleNamespace(
                order_item=SimpleNamespace(product=SimpleNamespace(name="Cup")),
                order_item_id="oi1",
                quantity=1,
            ),
            SimpleNamespace(order_item=None, order_item_id="oi2", quantity=2),
        ],
        reason="defective",
        customer_message="broke",
        status=SimpleNamespace(value="requested"),
        admin_note="looking into it",
    )
    base.update(over)
    return SimpleNamespace(**base)


def test_return_request_created(capture_send, monkeypatch):
    assert (
        _run(e.send_return_request_created("a@x.com", _return_request(), lang="ro"))
        is True
    )
    monkeypatch.setattr(e, "env", None)
    assert (
        _run(e.send_return_request_created("a@x.com", _return_request(), lang="en"))
        is True
    )
    # env None, no customer name
    rr = _return_request(order=SimpleNamespace(reference_code="RR2", customer_name=""))
    assert _run(e.send_return_request_created("a@x.com", rr, lang="en")) is True


def test_return_request_status_update(capture_send, monkeypatch):
    prev = SimpleNamespace(value="requested")
    assert (
        _run(
            e.send_return_request_status_update(
                "a@x.com", _return_request(), previous_status=prev, lang="ro"
            )
        )
        is True
    )
    monkeypatch.setattr(e, "env", None)
    assert (
        _run(
            e.send_return_request_status_update(
                "a@x.com", _return_request(), previous_status=prev, lang="en"
            )
        )
        is True
    )
    # env None, no customer name, no admin note
    rr = _return_request(
        order=SimpleNamespace(reference_code="RR3", customer_name=""), admin_note=None
    )
    assert (
        _run(
            e.send_return_request_status_update(
                "a@x.com", rr, previous_status="old_str", lang="en"
            )
        )
        is True
    )


# --------------------------------------------------------------------------- #
# Admin report summary + critical error
# --------------------------------------------------------------------------- #


def test_send_admin_report_summary_full(capture_send):
    assert (
        _run(
            e.send_admin_report_summary(
                "a@x.com",
                kind="weekly",
                period_start=datetime(2026, 1, 1, tzinfo=timezone.utc),
                period_end=datetime(2026, 1, 8, tzinfo=timezone.utc),
                currency="RON",
                summary={
                    "gross_sales": Decimal("100"),
                    "net_sales": Decimal("90"),
                    "refunds": Decimal("10"),
                    "missing_refunds": Decimal("5"),
                    "orders_total": 12,
                    "orders_success": 10,
                    "orders_refunded": 2,
                },
                top_products=[
                    {"name": "Cup", "slug": "cup", "quantity": 3, "gross_sales": 30},
                    {"name": "", "slug": "", "quantity": 0, "gross_sales": 0},
                ],
                low_stock=[
                    {
                        "name": "Cup",
                        "stock_quantity": 1,
                        "threshold": 5,
                        "is_critical": True,
                    },
                    {
                        "name": "",
                        "slug": "plate",
                        "stock_quantity": 2,
                        "threshold": 3,
                        "is_critical": False,
                    },
                ],
                lang="ro",
            )
        )
        is True
    )


def test_send_admin_report_summary_empty(capture_send):
    assert (
        _run(
            e.send_admin_report_summary(
                "a@x.com",
                kind="monthly",
                period_start=datetime(2026, 1, 1, tzinfo=timezone.utc),
                period_end=datetime(2026, 2, 1, tzinfo=timezone.utc),
                summary={
                    "gross_sales": 0,
                    "net_sales": 0,
                    "refunds": 0,
                    "missing_refunds": 0,
                },
                top_products=[],
                low_stock=[],
                lang="en",
            )
        )
        is True
    )


def test_notify_critical_error(monkeypatch):
    sent = {}

    async def _alert(email, message):
        sent["email"] = email
        return True

    monkeypatch.setattr(e, "send_error_alert", _alert)
    monkeypatch.setattr(e.settings, "error_alert_email", "alert@x.com")
    assert _run(e.notify_critical_error("boom")) is True
    assert sent["email"] == "alert@x.com"


def test_notify_critical_error_no_email(monkeypatch, caplog):
    monkeypatch.setattr(e.settings, "error_alert_email", None)
    caplog.set_level(logging.ERROR, logger="app.services.email")
    assert _run(e.notify_critical_error("boom")) is False
    assert "Critical error" in caplog.text
