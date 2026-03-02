from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
import math
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

from fastapi import HTTPException
import pytest

from app.models.content import ContentStatus
from app.models.media import MediaJobType, MediaVisibility
from app.models.order import OrderStatus
from app.services import auth as auth_service
from app.services import content as content_service
from app.services import media_dam
from app.services import order as order_service
from app.services import paypal as paypal_service


class _FakeSession:
    def __init__(self) -> None:
        self.added: list[object] = []

    def add(self, value: object) -> None:
        self.added.append(value)


def test_content_reference_and_target_helpers_more() -> None:
    assert content_service._normalize_md_url(" < /pages/about > ") == "/pages/about"
    assert content_service._normalize_md_url("mailto:owner@example.com") == ""
    assert content_service._normalize_md_url("#section") == ""

    body = "![Hero](/media/hero.png) [Shop](/shop?category=Rings) [Page](/pages/about)"
    image_urls = content_service._extract_markdown_target_urls(body, image_only=True)
    link_urls = content_service._extract_markdown_target_urls(body, image_only=False)
    assert image_urls == ["/media/hero.png"]
    assert "/shop?category=Rings" in link_urls
    assert "/pages/about" in link_urls

    refs = content_service._extract_block_refs(
        {
            "blocks": [
                {"type": "text", "body_markdown": "[Product](/products/ring)"},
                {"type": "image", "url": "/media/banner.png", "link_url": "/blog/new-drop"},
                {"type": "gallery", "images": [{"url": "/media/a.png"}]},
            ]
        }
    )
    product_slugs, category_slugs, page_keys, blog_keys, media_urls = content_service._collect_link_targets(
        refs,
        include_media_urls=True,
    )
    assert "ring" in product_slugs
    assert "blog.new-drop" in blog_keys
    assert media_urls is not None and "/media/banner.png" in media_urls
    assert category_slugs == set()
    assert page_keys == set()


def test_content_link_issue_builders_cover_missing_paths(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(content_service.settings, "media_root", str(tmp_path))

    refs = [
        ("image", "markdown", "body_markdown", "/media/missing.png"),
        ("link", "markdown", "body_markdown", "/products/missing"),
        ("link", "markdown", "body_markdown", "/shop/unknown"),
        ("link", "markdown", "body_markdown", "/pages/missing"),
        ("link", "markdown", "body_markdown", "/pages/loop"),
    ]

    issues = content_service._build_link_issues(
        refs,
        content_key="page.test",
        products_by_slug={},
        existing_categories=set(),
        resolved_keys={"page.missing": ("page.missing", None), "page.loop": ("page.loop", "Redirect loop")},
        blocks_by_key={},
        is_public=lambda *_args: False,
    )

    reasons = {issue.reason for issue in issues}
    assert "Media file not found" in reasons
    assert "Product not found" in reasons
    assert "Category not found" in reasons
    assert "Content not found" in reasons
    assert "Redirect loop" in reasons


def test_content_shop_and_visibility_helpers_more() -> None:
    assert content_service._shop_path_category_candidate("/shop/Bracelets") == "bracelets"
    assert content_service._shop_path_category_candidate("/pages/about") is None
    assert content_service._shop_query_category_candidates("category=Rings&sub=New+Arrivals") == ["rings", "new-arrivals"]
    assert content_service._shop_category_candidates("/shop/silk", "sub=Scarf") == ["silk", "scarf"]

    now = datetime(2026, 2, 28, tzinfo=timezone.utc)
    assert content_service._published_at_visible(now + timedelta(seconds=1), now=now) is False
    assert content_service._published_until_visible(now, now=now, allow_until_equal=True) is True
    assert content_service._published_until_visible(now, now=now, allow_until_equal=False) is False
    assert (
        content_service._is_content_public(ContentStatus.published, now - timedelta(days=1), now + timedelta(days=1), now=now, allow_until_equal=False)
        is True
    )


def test_auth_helper_branches_more(monkeypatch: pytest.MonkeyPatch) -> None:
    assert auth_service._normalize_token("  bearer-token  ") == "bearer-token"
    assert auth_service._normalize_email_value("  USER@Example.com ") == "user@example.com"
    assert auth_service._normalize_optional_text("  Name  ") == "Name"
    assert auth_service._normalize_optional_text("   ") is None
    assert auth_service._normalize_display_name("   ", "Fallback") == "Fallback"

    with pytest.raises(HTTPException, match="Invalid or expired token"):
        auth_service._require_valid_token("  ")

    future = datetime.now(timezone.utc) + timedelta(minutes=5)
    past = datetime.now(timezone.utc) - timedelta(minutes=5)
    assert auth_service._is_expired_timestamp(future) is False
    assert auth_service._is_expired_timestamp(past) is True

    assert auth_service._sanitize_username_from_email("@@")[:3].startswith("use")
    assert auth_service._device_key_from_user_agent("Mozilla/5.0 Version/123.4") == "Mozilla/x Version/x"

    calls = {"idx": -1}

    def _cycle_choice(alphabet: str) -> str:
        calls["idx"] = (calls["idx"] + 1) % len(alphabet)
        return alphabet[calls["idx"]]

    monkeypatch.setattr(auth_service.secrets, "choice", _cycle_choice)
    monkeypatch.setattr(auth_service.security, "hash_password", lambda value: f"hash::{value}")
    formatted, hashed = auth_service._generate_recovery_codes(count=2)
    assert len(formatted) == 2
    assert all("-" in code for code in formatted)
    assert all(item.startswith("hash::") for item in hashed)


def test_order_address_and_total_helpers_more(monkeypatch: pytest.MonkeyPatch) -> None:
    cleaned = order_service._clean_address_update_payload(
        {
            "line1": " Street ",
            "country": " ro ",
            "postal_code": " 010101 ",
            "id": "blocked",
            "user_id": "blocked",
        }
    )
    assert "id" not in cleaned and "user_id" not in cleaned

    with pytest.raises(HTTPException, match="line1 is required"):
        order_service._validate_required_address_fields({"line1": "  "})

    monkeypatch.setattr(order_service.address_service, "_validate_address_fields", lambda country, postal: (country.upper(), postal.strip()))
    addr = SimpleNamespace(country="ro", postal_code="010101", is_default_shipping=True, is_default_billing=True)
    order_service._apply_address_update(addr, {"line1": " Lane 1 ", "city": " Bucharest ", "country": "ro", "postal_code": "010101"})
    assert addr.line1 == "Lane 1"
    assert addr.city == "Bucharest"
    assert addr.country == "RO"
    assert addr.is_default_shipping is False and addr.is_default_billing is False

    order = SimpleNamespace(
        shipping_amount=Decimal("10.00"),
        tax_amount=Decimal("5.00"),
        total_amount=Decimal("95.00"),
        fee_amount=Decimal("0.00"),
        items=[SimpleNamespace(product_id=uuid4(), subtotal=Decimal("80.00"))],
    )
    shipping, tax, total = order_service._previous_order_amounts(order)
    assert (shipping, tax, total) == (Decimal("10.00"), Decimal("5.00"), Decimal("95.00"))
    taxable_subtotal = order_service._taxable_subtotal_for_order(order, Decimal("0.00"), "half_up")
    assert taxable_subtotal == Decimal("80.00")


def test_order_tracking_and_cancel_helpers_more(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(order_service.tracking_service, "validate_tracking_number", lambda courier, tracking_number: f"{courier}:{tracking_number}".strip(":"))
    monkeypatch.setattr(order_service.tracking_service, "validate_tracking_url", lambda tracking_url: str(tracking_url or "").strip())

    order = SimpleNamespace(
        id=uuid4(),
        status=OrderStatus.cancelled,
        payment_method=" Stripe ",
        tracking_number="ABC123",
        cancel_reason="old",
    )
    payload = {"courier": "sameday", "tracking_number": "XY9", "tracking_url": " https://carrier.example/xy9 "}
    order_service._validate_tracking_update_payload(order, payload)
    assert payload["tracking_number"] == "sameday:XY9"
    assert payload["tracking_url"] == "https://carrier.example/xy9"

    assert order_service._normalized_order_payment_method(order) == "stripe"
    assert order_service._compose_address_update_note(actor="admin", note="updated") == "admin: updated"
    assert order_service._compose_address_update_note(actor="admin", note="  ") == "admin"

    with pytest.raises(HTTPException, match="Order addresses cannot be edited"):
        order_service._ensure_order_addresses_are_editable(SimpleNamespace(status=OrderStatus.shipped))

    session = _FakeSession()
    order_service._apply_cancel_reason_update(session, order=order, cancel_reason_clean="new reason")
    assert order.cancel_reason == "new reason"
    assert len(session.added) == 2


def test_media_retry_policy_serialization_helpers_more() -> None:
    policy = media_dam.RetryPolicyResolved(max_attempts=4, schedule=[15, 30], jitter_ratio=0.5, enabled=True, version_ts="v1")
    snapshot = media_dam._resolved_policy_to_snapshot(policy)
    assert snapshot["max_attempts"] == 4

    serialized = media_dam._serialize_policy_snapshot_json(policy)
    restored = media_dam._deserialize_policy_snapshot_json(serialized, job_type=MediaJobType.variant)
    assert restored.max_attempts == 4
    assert restored.schedule == [15, 30]

    assert media_dam._parse_positive_int("12") == 12
    assert media_dam._parse_positive_int("-1") is None
    assert math.isclose(media_dam._parse_ratio("1.5"), 1.0, rel_tol=0.0, abs_tol=1e-9)
    assert math.isclose(media_dam._parse_ratio("-1"), 0.0, rel_tol=0.0, abs_tol=1e-9)
    assert media_dam._parse_retry_schedule(["5", "bad", 10]) == [5, 10]

    assert media_dam.can_approve_or_purge("owner") is True
    assert media_dam.can_approve_or_purge("staff") is False
    assert media_dam.coerce_visibility("public") == MediaVisibility.public
    assert media_dam.coerce_visibility("invalid", fallback=MediaVisibility.public) == MediaVisibility.public


def test_paypal_prepare_amount_and_payload_helpers_more() -> None:
    amount, converted_items = paypal_service._prepare_order_amount(
        currency="EUR",
        fx_per_ron=Decimal("0.2"),
        item_total_ron=Decimal("100.00"),
        shipping_ron=Decimal("10.00"),
        tax_ron=Decimal("5.00"),
        fee_ron=Decimal("0.00"),
        discount_ron=Decimal("0.00"),
        items=[{"quantity": "1", "unit_amount": {"value": "100.00", "currency_code": "RON"}, "name": "Item"}],
    )
    assert amount["currency_code"] == "EUR"
    assert amount["value"] == "23.00"
    assert converted_items is not None and len(converted_items) == 1

    payload = paypal_service._build_order_payload(
        amount=amount,
        reference="ORDER-1",
        return_url="https://app.example/return",
        cancel_url="https://app.example/cancel",
        converted_items=converted_items,
    )
    purchase_unit = payload["purchase_units"][0]
    assert purchase_unit["custom_id"] == "ORDER-1"
    assert purchase_unit["items"][0]["name"] == "Item"

    assert paypal_service._resolve_item_total(item_total_converted=None, item_total_ron=Decimal("10.00"), fx_per_ron=Decimal("0.2")) == Decimal("2.00")
    with pytest.raises(HTTPException, match="Invalid PayPal order total"):
        paypal_service._compute_total_converted(
            item_total_converted=Decimal("1.00"),
            shipping_converted=None,
            fee_converted=None,
            tax_converted=None,
            discount_converted=Decimal("2.00"),
        )
