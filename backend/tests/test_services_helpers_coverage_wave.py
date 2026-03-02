from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

from fastapi import HTTPException
import pytest

from app.models.content import ContentStatus
from app.models.order import OrderStatus
from app.services import catalog as catalog_service
from app.services import content as content_service
from app.services import order as order_service
from app.services import paypal as paypal_service


def test_catalog_service_helper_branches() -> None:
    catalog_service._validate_price_currency(Decimal("0.00"), "RON")
    with pytest.raises(HTTPException, match="Base price must be non-negative"):
        catalog_service._validate_price_currency(Decimal("-1.00"), "RON")
    with pytest.raises(HTTPException, match="Currency must be a 3-letter code"):
        catalog_service._validate_price_currency(Decimal("1.00"), "EURO")
    with pytest.raises(HTTPException, match="Only RON currency is supported"):
        catalog_service._validate_price_currency(Decimal("1.00"), "USD")

    assert catalog_service._to_decimal(None) == Decimal("0.00")
    assert catalog_service._to_decimal("12.5") == Decimal("12.5")

    start = datetime(2026, 2, 1, tzinfo=timezone.utc)
    end = datetime(2026, 2, 2, tzinfo=timezone.utc)
    catalog_service._validate_sale_schedule(sale_start_at=start, sale_end_at=end, sale_auto_publish=False)
    with pytest.raises(HTTPException, match="Sale end must be after sale start"):
        catalog_service._validate_sale_schedule(
            sale_start_at=end,
            sale_end_at=start,
            sale_auto_publish=False,
        )
    with pytest.raises(HTTPException, match="Sale start is required"):
        catalog_service._validate_sale_schedule(
            sale_start_at=None,
            sale_end_at=end,
            sale_auto_publish=True,
        )

    assert catalog_service._resolve_sale_discount(
        Decimal("100.00"),
        "percent",
        Decimal("25.00"),
    ) == Decimal("25.00")
    assert catalog_service._resolve_sale_discount(
        Decimal("100.00"),
        "percent",
        Decimal("100.00"),
    ) == Decimal("100.00")
    assert catalog_service._resolve_sale_discount(
        Decimal("100.00"),
        "amount",
        Decimal("15.00"),
    ) == Decimal("15.00")
    assert catalog_service._resolve_sale_discount(
        Decimal("100.00"),
        "unknown",
        Decimal("15.00"),
    ) is None

    assert catalog_service._finalize_sale_price(Decimal("100.00"), Decimal("0.00")) is None
    assert catalog_service._finalize_sale_price(Decimal("100.00"), Decimal("120.00")) == Decimal("0.00")
    assert catalog_service._compute_sale_price(
        base_price=Decimal("100.00"),
        sale_type="percent",
        sale_value=Decimal("15.00"),
    ) == Decimal("85.00")

    assert catalog_service._adjusted_quantity_or_400(before_quantity=10, delta=-3) == 7
    with pytest.raises(HTTPException, match="Stock cannot be negative"):
        catalog_service._adjusted_quantity_or_400(before_quantity=1, delta=-2)

    product = SimpleNamespace(
        sale_auto_publish=True,
        category_id=uuid4(),
        publish_scheduled_for=None,
        unpublish_scheduled_for=None,
        sale_type=None,
    )
    catalog_service._apply_bulk_mutation_field_or_400(product, "sale_auto_publish", None)
    assert product.sale_auto_publish is False

    publish_at = datetime(2026, 2, 10, 8, 30)
    catalog_service._apply_bulk_mutation_field_or_400(product, "publish_scheduled_for", publish_at)
    assert product.publish_scheduled_for is not None
    assert product.publish_scheduled_for.tzinfo == timezone.utc

    with pytest.raises(HTTPException, match="category_id cannot be null"):
        catalog_service._apply_bulk_mutation_field_or_400(product, "category_id", None)

    assert catalog_service.slugify(" Șnur Împletit Premium ") == "șnur-împletit-premium"
    assert catalog_service._normalize_search_text("Broșă Țesută") == "brosa tesuta"


def test_catalog_translation_and_search_helper_branches() -> None:
    category = SimpleNamespace(
        name="Category EN",
        description="Category Desc EN",
        translations=[
            SimpleNamespace(lang="ro", name="Categorie RO", description="Categorie Desc RO"),
        ],
    )
    image = SimpleNamespace(
        alt_text="existing alt",
        caption="existing caption",
        translations=[SimpleNamespace(lang="ro", alt_text=None, caption="legendă")],
    )
    product = SimpleNamespace(
        name="Name EN",
        short_description="Short EN",
        long_description="Long EN",
        meta_title="Meta EN",
        meta_description="Meta Desc EN",
        translations=[
            SimpleNamespace(
                lang="ro",
                name="Nume RO",
                short_description="Scurt RO",
                long_description="Lung RO",
                meta_title="",
                meta_description=None,
            )
        ],
        category=category,
        images=[image],
    )

    catalog_service.apply_product_translation(product, "ro")
    assert product.name == "Nume RO"
    assert product.short_description == "Scurt RO"
    assert product.long_description == "Lung RO"
    # Empty translation meta keeps existing fallback values.
    assert product.meta_title == "Meta EN"
    assert product.meta_description == "Meta Desc EN"
    assert product.category.name == "Categorie RO"
    assert product.category.description == "Categorie Desc RO"
    # None alt text keeps previous value while caption updates.
    assert product.images[0].alt_text == "existing alt"
    assert product.images[0].caption == "legendă"

    unchanged = SimpleNamespace(name="No change", translations=[SimpleNamespace(lang="en", name="English")], category=None, images=None)
    catalog_service.apply_product_translation(unchanged, "ro")
    assert unchanged.name == "No change"
    catalog_service.apply_product_translation(unchanged, None)
    assert unchanged.name == "No change"

    assert catalog_service._find_translation_for_lang([], "ro") is None
    assert catalog_service._find_translation_for_lang([SimpleNamespace(lang="en")], "ro") is None
    assert catalog_service._normalize_search_text(None) == ""


def test_content_service_helper_branches() -> None:
    assert content_service.slugify_page_slug(" Știre Nouă! ") == "stire-noua"
    assert content_service._meta_changes_require_translation(
        {"hidden": False},
        {"hidden": True},
    ) is False
    assert content_service._meta_changes_require_translation(
        {"cta": "Buy"},
        {"cta": "Shop"},
    ) is True

    content_service.validate_page_key_for_create("page.about")
    with pytest.raises(HTTPException, match="Page slug is reserved"):
        content_service.validate_page_key_for_create("page.account")
    with pytest.raises(HTTPException, match="Invalid page slug"):
        content_service.validate_page_key_for_create("page.Invalid Slug!")

    with pytest.raises(HTTPException, match="Disallowed markup"):
        content_service._sanitize_markdown("<script>alert(1)</script>")
    with pytest.raises(HTTPException, match="Disallowed event handlers"):
        content_service._sanitize_markdown('<div onclick="alert(1)">X</div>')

    assert content_service._contains_inline_event_handler(' onclick = "x" ') is True
    assert content_service._contains_inline_event_handler("harmonyonline") is False

    updated_json, replacements = content_service._find_replace_in_json(
        {"title": "Summer Sale", "nested": ["sale", {"text": "SALE"}]},
        "sale",
        "deal",
        case_sensitive=False,
    )
    assert replacements == 3
    assert updated_json["title"] == "Summer deal"
    assert updated_json["nested"][0] == "deal"

    body = "![Cover](/media/image.png) and [Shop](/products/ring-one) and [Page](/pages/about-us)"
    assert content_service._extract_markdown_target_urls(body, image_only=True) == ["/media/image.png"]
    assert content_service._extract_markdown_target_urls(body, image_only=False) == [
        "/products/ring-one",
        "/pages/about-us",
    ]

    resolved, error = content_service._resolve_redirect_chain(
        "page.start",
        {"page.start": "page.middle", "page.middle": "page.final"},
    )
    assert resolved == "page.final"
    assert error is None

    _, error = content_service._resolve_redirect_chain(
        "page.a",
        {"page.a": "page.b", "page.b": "page.a"},
    )
    assert error == "Redirect loop"

    reason_missing = content_service._resolve_content_link_reason(
        "page.missing",
        resolved_keys={},
        blocks_by_key={},
        is_public=lambda *_args: True,
    )
    assert reason_missing == "Content not found"

    reason_private = content_service._resolve_content_link_reason(
        "page.private",
        resolved_keys={"page.private": ("page.private", None)},
        blocks_by_key={"page.private": (ContentStatus.review, None, None)},
        is_public=lambda *_args: False,
    )
    assert reason_private == "Content is not publicly visible"

    now = datetime(2026, 2, 1, tzinfo=timezone.utc)
    assert content_service._published_at_visible(None, now=now) is True
    assert content_service._published_at_visible(now + timedelta(seconds=1), now=now) is False
    assert content_service._published_until_visible(now, now=now, allow_until_equal=True) is True
    assert content_service._published_until_visible(now, now=now, allow_until_equal=False) is False
    assert content_service._is_content_public(
        ContentStatus.published,
        now - timedelta(days=1),
        now + timedelta(days=1),
        now=now,
        allow_until_equal=False,
    ) is True


def test_order_service_status_and_fraud_helpers() -> None:
    assert order_service._clean_optional_order_text("  ro-123  ", max_length=10, upper=True) == "RO-123"
    assert order_service._clean_optional_order_text("   ", max_length=10) is None

    assert order_service._initial_order_status("paypal") == OrderStatus.pending_payment
    assert order_service._initial_order_status("cod") == OrderStatus.pending_acceptance

    cod_allowed = order_service._allowed_next_order_statuses(
        current_status=OrderStatus.pending_acceptance,
        payment_method="cod",
    )
    assert OrderStatus.shipped in cod_allowed
    assert OrderStatus.delivered in cod_allowed

    stripe_allowed = order_service._allowed_next_order_statuses(
        current_status=OrderStatus.pending_acceptance,
        payment_method="stripe",
    )
    assert OrderStatus.shipped not in stripe_allowed

    assert order_service._status_requires_cancel_reason(
        current_status=OrderStatus.pending_payment,
        next_status=OrderStatus.cancelled,
    ) is True
    assert order_service._status_requires_cancel_reason(
        current_status=OrderStatus.shipped,
        next_status=OrderStatus.cancelled,
    ) is False

    assert order_service._normalize_order_tag("  Needs Review!!! ") == "needs_review"
    assert order_service._normalize_order_tag("___") is None

    assert order_service._velocity_signal(
        "velocity_email",
        5,
        threshold=3,
        window_minutes=60,
    )["severity"] == "high"
    assert order_service._payment_retry_signal(1, 2)["severity"] == "low"
    assert order_service._country_mismatch_signal("RO", "DE")["code"] == "country_mismatch"

    mismatch_order = SimpleNamespace(
        shipping_address=SimpleNamespace(country="RO"),
        billing_address=SimpleNamespace(country="DE"),
    )
    assert order_service._country_mismatch_signal_for_order(mismatch_order) is not None
    assert order_service._payment_retry_signal_for_order(SimpleNamespace(payment_retry_count=0), 2) is None

    assert order_service._normalize_fraud_decision(" approve ") == "approve"
    with pytest.raises(HTTPException, match="Invalid fraud review decision"):
        order_service._normalize_fraud_decision("hold")

    assert order_service._fraud_tags_for_decision("approve") == ("fraud_approved", "fraud_denied")
    assert order_service._fraud_tags_for_decision("deny") == ("fraud_denied", "fraud_approved")
    assert order_service._normalize_fraud_note("  " + ("x" * 700)) == "x" * 500


def test_order_service_refund_and_payment_helpers() -> None:
    refundable_order = SimpleNamespace(status=OrderStatus.paid)
    order_service._ensure_refund_allowed(refundable_order)
    with pytest.raises(HTTPException, match="Refund allowed only"):
        order_service._ensure_refund_allowed(SimpleNamespace(status=OrderStatus.cancelled))

    order_with_balance = SimpleNamespace(
        total_amount=Decimal("120.00"),
        refunds=[SimpleNamespace(amount=Decimal("20.00")), SimpleNamespace(amount=Decimal("10.00"))],
    )
    already_refunded, total_amount, remaining = order_service._compute_refund_balance(order_with_balance)
    assert already_refunded == Decimal("30.00")
    assert total_amount == Decimal("120.00")
    assert remaining == Decimal("90.00")

    with pytest.raises(HTTPException, match="already fully refunded"):
        order_service._compute_refund_balance(
            SimpleNamespace(total_amount=Decimal("50.00"), refunds=[SimpleNamespace(amount=Decimal("50.00"))])
        )

    assert order_service._normalize_refund_amount(Decimal("25.00"), Decimal("30.00")) == Decimal("25.00")
    with pytest.raises(HTTPException, match="Invalid refund amount"):
        order_service._normalize_refund_amount(Decimal("0"), Decimal("30.00"))
    with pytest.raises(HTTPException, match="exceeds remaining refundable"):
        order_service._normalize_refund_amount(Decimal("31.00"), Decimal("30.00"))

    assert order_service._normalize_refund_note("  resolved  ") == "resolved"
    with pytest.raises(HTTPException, match="Refund note is required"):
        order_service._normalize_refund_note("   ")

    item_id = uuid4()
    assert order_service._parse_refunded_qty_row({"order_item_id": str(item_id), "quantity": 2}) == (item_id, 2)
    assert order_service._parse_refunded_qty_row({"order_item_id": str(item_id), "quantity": 0}) is None
    assert order_service._parse_refunded_qty_row({"order_item_id": "not-a-uuid", "quantity": 2}) is None

    requested = order_service._requested_refund_qty([(item_id, 1), (item_id, 2), (uuid4(), 0)])
    assert requested[item_id] == 3

    order_item = SimpleNamespace(quantity=2)
    with pytest.raises(HTTPException, match="already fully refunded"):
        order_service._validate_refund_quantity_bounds(
            order_item=order_item,
            requested_qty=1,
            already_refunded_qty=2,
        )
    with pytest.raises(HTTPException, match="exceeds remaining refundable quantity"):
        order_service._validate_refund_quantity_bounds(
            order_item=order_item,
            requested_qty=2,
            already_refunded_qty=1,
        )

    order_for_intent = SimpleNamespace(stripe_payment_intent_id="pi_current")
    assert order_service._resolve_payment_intent_id(order_for_intent, None) == "pi_current"
    with pytest.raises(HTTPException, match="Payment intent mismatch"):
        order_service._resolve_payment_intent_id(order_for_intent, "pi_other")
    with pytest.raises(HTTPException, match="Payment intent id required"):
        order_service._resolve_payment_intent_id(SimpleNamespace(stripe_payment_intent_id=""), None)

    order_service._require_payment_action_status(
        SimpleNamespace(status=OrderStatus.pending_acceptance),
        detail="blocked",
    )
    with pytest.raises(HTTPException, match="blocked"):
        order_service._require_payment_action_status(
            SimpleNamespace(status=OrderStatus.shipped),
            detail="blocked",
        )


@pytest.mark.anyio
async def test_paypal_service_currency_and_fx_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    assert paypal_service._paypal_currency("ron") == "RON"
    with pytest.raises(HTTPException, match="Unsupported PayPal currency"):
        paypal_service._paypal_currency("GBP")

    assert await paypal_service._fx_per_ron("RON", fx_eur_per_ron=None, fx_usd_per_ron=None) == Decimal("1.0")
    assert await paypal_service._fx_per_ron("EUR", fx_eur_per_ron=0.2, fx_usd_per_ron=None) == Decimal("0.2")

    def fake_rates():
        return asyncio.sleep(0, result=SimpleNamespace(usd_per_ron=Decimal("0.22"), eur_per_ron=Decimal("0.20")))

    monkeypatch.setattr(paypal_service.fx_rates, "get_fx_rates", fake_rates)
    assert await paypal_service._fx_per_ron("USD", fx_eur_per_ron=None, fx_usd_per_ron=None) == Decimal("0.22")


def test_paypal_service_payload_helpers() -> None:
    item, total = paypal_service._convert_order_item(
        raw_item={"quantity": "2", "unit_amount": {"value": "10.00", "currency_code": "RON"}, "name": "Ring"},
        currency="EUR",
        fx_per_ron=Decimal("0.2"),
    )
    assert item is not None
    assert item["quantity"] == "2"
    assert item["unit_amount"]["currency_code"] == "EUR"
    assert total == Decimal("4.00")

    invalid_item, invalid_total = paypal_service._convert_order_item(
        raw_item={"quantity": "0", "unit_amount": {"value": "10.00"}},
        currency="EUR",
        fx_per_ron=Decimal("0.2"),
    )
    assert invalid_item is None
    assert invalid_total == Decimal("0.00")

    converted, item_total = paypal_service._convert_items(
        items=[
            {"quantity": "1", "unit_amount": {"value": "10.00", "currency_code": "RON"}},
            {"quantity": "bad", "unit_amount": {"value": "5.00", "currency_code": "RON"}},
            "ignore",
        ],
        currency="USD",
        fx_per_ron=Decimal("0.25"),
    )
    assert converted is not None and len(converted) == 1
    assert item_total == Decimal("2.50")

    assert paypal_service._discount_requested(Decimal("0.00")) is False
    assert paypal_service._discount_requested(Decimal("1.00")) is True
    assert paypal_service._convert_discount(Decimal("0.00"), Decimal("0.2")) is None
    assert paypal_service._convert_discount(Decimal("10.00"), Decimal("0.2")) == Decimal("2.00")

    with pytest.raises(HTTPException, match="Invalid PayPal order total"):
        paypal_service._compute_total_converted(
            item_total_converted=Decimal("1.00"),
            shipping_converted=None,
            fee_converted=None,
            tax_converted=None,
            discount_converted=Decimal("2.00"),
        )

    amount = paypal_service._build_order_amount(
        currency="EUR",
        total_converted=Decimal("12.00"),
        item_total_converted=Decimal("10.00"),
        shipping_converted=Decimal("2.00"),
        fee_converted=None,
        tax_converted=None,
        discount_converted=None,
        item_total_ron=Decimal("50.00"),
        shipping_ron=Decimal("10.00"),
        tax_ron=None,
        fee_ron=None,
        discount_ron=None,
    )
    assert amount["value"] == "12.00"
    assert "breakdown" in amount

    amount_no_breakdown = paypal_service._build_order_amount(
        currency="EUR",
        total_converted=Decimal("5.00"),
        item_total_converted=Decimal("5.00"),
        shipping_converted=None,
        fee_converted=None,
        tax_converted=None,
        discount_converted=None,
        item_total_ron=None,
        shipping_ron=None,
        tax_ron=None,
        fee_ron=None,
        discount_ron=None,
    )
    assert "breakdown" not in amount_no_breakdown


def test_paypal_service_id_and_webhook_helpers() -> None:
    assert paypal_service._sanitize_paypal_id("ab12-cd34") == "AB12-CD34"
    with pytest.raises(HTTPException, match="Invalid PayPal order id"):
        paypal_service._sanitize_paypal_id("../bad")

    assert paypal_service._capture_path("ab12-cd34").endswith("/AB12-CD34/capture")

    capture_id = paypal_service._extract_capture_id(
        {
            "purchase_units": [
                {"payments": {"captures": [{"id": "CAPTURE-123"}]}},
            ]
        }
    )
    assert capture_id == "CAPTURE-123"
    assert paypal_service._extract_capture_id({}) == ""

    headers = {
        "paypal-auth-algo": "SHA256",
        "paypal-cert-url": "https://example.com/cert",
        "paypal-transmission-id": "transmission-id",
        "paypal-transmission-sig": "signature",
        "paypal-transmission-time": "2026-02-01T10:00:00Z",
    }
    payload = paypal_service._webhook_verification_payload(headers=headers, event={"id": "evt"}, webhook_id="wh_1")
    assert payload["webhook_id"] == "wh_1"
    assert payload["transmission_id"] == "transmission-id"

    with pytest.raises(HTTPException, match="Missing PayPal signature headers"):
        paypal_service._webhook_verification_payload(
            headers={"paypal-auth-algo": "SHA256"},
            event={},
            webhook_id="wh_1",
        )


def test_order_service_additional_status_helpers() -> None:
    assert (
        order_service._status_requires_captured_payment(
            current_status=OrderStatus.pending_acceptance,
            next_status=OrderStatus.paid,
            payment_method="stripe",
        )
        is True
    )
    assert (
        order_service._status_requires_captured_payment(
            current_status=OrderStatus.pending_acceptance,
            next_status=OrderStatus.paid,
            payment_method="paypal",
        )
        is True
    )
    assert (
        order_service._status_requires_captured_payment(
            current_status=OrderStatus.pending_acceptance,
            next_status=OrderStatus.paid,
            payment_method="cod",
        )
        is False
    )

    assert order_service._clean_cancel_reason(None) is None
    assert order_service._clean_cancel_reason("   ") == ""
    assert len(order_service._clean_cancel_reason("x" * 3000) or "") == 2000


def test_paypal_service_environment_selection_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(paypal_service.settings, "paypal_env", "live")
    monkeypatch.setattr(paypal_service.settings, "paypal_client_id_live", "live-id")
    monkeypatch.setattr(paypal_service.settings, "paypal_client_secret_live", "live-secret")
    monkeypatch.setattr(paypal_service.settings, "paypal_webhook_id_live", "live-webhook")
    monkeypatch.setattr(paypal_service.settings, "paypal_client_id", "fallback-id")
    monkeypatch.setattr(paypal_service.settings, "paypal_client_secret", "fallback-secret")
    monkeypatch.setattr(paypal_service.settings, "paypal_webhook_id", "fallback-webhook")

    assert paypal_service._paypal_env() == "live"
    assert paypal_service._effective_client_id() == "live-id"
    assert paypal_service._effective_client_secret() == "live-secret"
    assert paypal_service._effective_webhook_id() == "live-webhook"

    monkeypatch.setattr(paypal_service.settings, "paypal_env", "sandbox")
    monkeypatch.setattr(paypal_service.settings, "paypal_client_id_sandbox", "sandbox-id")
    monkeypatch.setattr(paypal_service.settings, "paypal_client_secret_sandbox", "sandbox-secret")
    monkeypatch.setattr(paypal_service.settings, "paypal_webhook_id_sandbox", "sandbox-webhook")

    assert paypal_service._paypal_env() == "sandbox"
    assert paypal_service._effective_client_id() == "sandbox-id"
    assert paypal_service._effective_client_secret() == "sandbox-secret"
    assert paypal_service._effective_webhook_id() == "sandbox-webhook"
