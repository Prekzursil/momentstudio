from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
import math
from pathlib import Path, PurePosixPath
from types import SimpleNamespace
from uuid import uuid4

from fastapi import HTTPException
import pytest

from app.models.media import MediaJobType, MediaVisibility
from app.services import auth as auth_service
from app.services import content as content_service
from app.services import media_dam
from app.services import order as order_service
from app.services import paypal as paypal_service
from app.services import receipts
from app.services import storage as storage_service


def test_backend_wave_b_content_markdown_target_edges() -> None:
    broken = "[Broken"
    assert content_service._parse_markdown_target_span(broken, start=0, text_len=len(broken)) is None

    no_target = "[Label] trailing text"
    parsed = content_service._parse_markdown_target_span(no_target, start=0, text_len=len(no_target))
    assert parsed == (-1, -1, len("[Label]"))

    product_slugs: set[str] = set()
    category_slugs: set[str] = set()
    page_keys: set[str] = set()
    blog_keys: set[str] = set()
    media_urls: set[str] = set()

    content_service._register_content_target_url(
        "https://example.com/products/external",
        product_slugs=product_slugs,
        category_slugs=category_slugs,
        page_keys=page_keys,
        blog_keys=blog_keys,
        media_urls=media_urls,
    )
    assert product_slugs == set()

    content_service._register_content_target_url(
        "/media/home/hero.png",
        product_slugs=product_slugs,
        category_slugs=category_slugs,
        page_keys=page_keys,
        blog_keys=blog_keys,
        media_urls=media_urls,
    )
    content_service._register_content_target_url(
        "/products/ring-01",
        product_slugs=product_slugs,
        category_slugs=category_slugs,
        page_keys=page_keys,
        blog_keys=blog_keys,
        media_urls=media_urls,
    )
    content_service._register_content_target_url(
        "/pages/About Us",
        product_slugs=product_slugs,
        category_slugs=category_slugs,
        page_keys=page_keys,
        blog_keys=blog_keys,
        media_urls=media_urls,
    )
    content_service._register_content_target_url(
        "/blog/New Post",
        product_slugs=product_slugs,
        category_slugs=category_slugs,
        page_keys=page_keys,
        blog_keys=blog_keys,
        media_urls=media_urls,
    )
    content_service._register_content_target_url(
        "/shop?category=Rings&sub=Wedding Bands",
        product_slugs=product_slugs,
        category_slugs=category_slugs,
        page_keys=page_keys,
        blog_keys=blog_keys,
        media_urls=media_urls,
    )

    assert "/media/home/hero.png" in media_urls
    assert "ring-01" in product_slugs
    assert "page.about-us" in page_keys
    assert "blog.new-post" in blog_keys
    assert {"rings", "wedding-bands"} <= category_slugs


def test_backend_wave_b_auth_refresh_helper_edges(monkeypatch: pytest.MonkeyPatch) -> None:
    assert auth_service._truncate("  hello  ", 3) == "hel"
    assert auth_service._truncate("   ", 10) is None

    monkeypatch.setattr(auth_service.security, "decode_token", lambda _token: {"type": "access"})
    with pytest.raises(HTTPException, match="Invalid refresh token"):
        auth_service._extract_refresh_jti("token-1")

    monkeypatch.setattr(auth_service.security, "decode_token", lambda _token: {"type": "refresh", "sub": "u-1"})
    with pytest.raises(HTTPException, match="Invalid refresh token"):
        auth_service._extract_refresh_jti("token-2")

    monkeypatch.setattr(auth_service.security, "decode_token", lambda _token: {"type": "refresh", "sub": "u-1", "jti": "jti-1"})
    assert auth_service._extract_refresh_jti("token-3") == "jti-1"

    assert auth_service._is_refresh_session_valid(None) is False
    assert auth_service._is_refresh_session_valid(SimpleNamespace(revoked=True, expires_at=datetime.now(timezone.utc))) is False
    assert (
        auth_service._is_refresh_session_valid(
            SimpleNamespace(revoked=False, expires_at=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=1))
        )
        is True
    )
    assert (
        auth_service._is_refresh_session_valid(
            SimpleNamespace(revoked=False, expires_at=datetime.now(timezone.utc) - timedelta(hours=1))
        )
        is False
    )


def test_backend_wave_b_order_refund_helper_edges() -> None:
    item_id = uuid4()
    assert order_service._parse_refunded_qty_row("bad") is None
    assert order_service._parse_refunded_qty_row({"order_item_id": "not-uuid", "quantity": 1}) is None
    assert order_service._parse_refunded_qty_row({"order_item_id": str(item_id), "quantity": "bad"}) is None
    assert order_service._parse_refunded_qty_row({"order_item_id": str(item_id), "quantity": 0}) is None
    assert order_service._parse_refunded_qty_row({"order_item_id": str(item_id), "quantity": 2}) == (item_id, 2)

    requested = order_service._requested_refund_qty([(item_id, 1), (item_id, 2), (uuid4(), 0)])
    assert requested[item_id] == 3

    with pytest.raises(HTTPException, match="Refund note is required"):
        order_service._normalize_refund_note("   ")
    assert len(order_service._normalize_refund_note("x" * 2500)) == 2000

    with pytest.raises(HTTPException, match="Invalid refund amount"):
        order_service._normalize_refund_amount(Decimal("-1"), Decimal("10"))
    with pytest.raises(HTTPException, match="Refund amount exceeds remaining refundable"):
        order_service._normalize_refund_amount(Decimal("11"), Decimal("10"))
    assert order_service._normalize_refund_amount(Decimal("10.009"), Decimal("10.01")) == Decimal("10.01")


def test_backend_wave_b_media_retry_policy_payload_edges() -> None:
    assert media_dam._retry_policy_from_payload({}, job_type=MediaJobType.variant) is None
    assert media_dam._retry_policy_from_payload({media_dam.RETRY_POLICY_PAYLOAD_KEY: {"max_attempts": 0}}, job_type=MediaJobType.variant) is None

    policy = media_dam._retry_policy_from_payload(
        {
            media_dam.RETRY_POLICY_PAYLOAD_KEY: {
                "max_attempts": "4",
                "schedule": ["5", 10],
                "jitter_ratio": "0.25",
                "enabled": True,
                "version_ts": "wave-b",
            }
        },
        job_type=MediaJobType.variant,
    )
    assert policy is not None
    assert policy.max_attempts == 4
    assert policy.schedule == [5, 10]
    assert math.isclose(policy.jitter_ratio, 0.25, rel_tol=0.0, abs_tol=1e-9)

    assert media_dam.can_approve_or_purge("owner") is True
    assert media_dam.can_approve_or_purge("viewer") is False
    assert media_dam.coerce_visibility("public") == MediaVisibility.public
    assert media_dam.coerce_visibility("unknown", fallback=MediaVisibility.public) == MediaVisibility.public


def test_backend_wave_b_storage_mime_and_svg_edges(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    fake_file = SimpleNamespace(content_type="image/png")
    destination = tmp_path / "upload.bin"
    destination.write_bytes(b"x")

    monkeypatch.setattr(storage_service, "_detect_image_mime_path", lambda _path: "image/png")
    sniff = storage_service._validated_upload_mime(fake_file, destination, ("image/png", "image/jpeg"))
    assert sniff == "image/png"

    with pytest.raises(HTTPException, match="Invalid file type"):
        storage_service._validated_upload_mime(SimpleNamespace(content_type="text/plain"), destination, ("image/png",))

    monkeypatch.setattr(storage_service, "_detect_image_mime_path", lambda _path: None)
    with pytest.raises(HTTPException, match="Invalid file type"):
        storage_service._validated_upload_mime(fake_file, destination, ("image/png",))

    base_root = (tmp_path / "media-root").resolve()
    base_root.mkdir(parents=True, exist_ok=True)
    resolved = storage_service._resolve_media_destination(base_root, PurePosixPath("social/a"))
    assert resolved == (base_root / "social" / "a").resolve()

    with pytest.raises(ValueError, match="Invalid relative path"):
        storage_service._resolve_media_destination(base_root, PurePosixPath("../escape"))

    sanitized = storage_service._sanitize_svg(
        b"""<svg xmlns='http://www.w3.org/2000/svg'>
            <script>alert(1)</script>
            <a href='invalid://bad.example/x'>bad</a>
            <a href='#ok'>ok</a>
            <rect onclick='evil()' style='fill:red; background:url(invalid://bad.example/bg)' />
            <style>@import url(https://bad.example/x.css); fill:#fff;</style>
        </svg>"""
    ).decode("utf-8", errors="ignore").lower()
    assert "<script" not in sanitized
    assert "onclick" not in sanitized
    assert "invalid://bad.example" not in sanitized
    assert "#ok" in sanitized

    with pytest.raises(HTTPException, match="Invalid SVG"):
        storage_service._sanitize_svg(b"<html><body>not-svg</body></html>")


def test_backend_wave_b_receipts_helpers_and_render_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    first_item_id = uuid4()
    second_item_id = uuid4()
    items = [
        SimpleNamespace(
            product_id=first_item_id,
            quantity=2,
            unit_price=Decimal("10.50"),
            subtotal=Decimal("21.00"),
            product=SimpleNamespace(slug="gold-ring", name="Gold Ring"),
        ),
        SimpleNamespace(
            product_id=second_item_id,
            quantity=1,
            unit_price=Decimal("7.00"),
            subtotal=Decimal("7.00"),
            product=SimpleNamespace(slug="", name=""),
        ),
    ]
    receipt_items = receipts._build_receipt_items(items, frontend_origin="https://shop.example")
    assert receipt_items[0].product_url == "https://shop.example/products/gold-ring"
    assert receipt_items[1].product_url is None
    assert receipt_items[1].name == str(second_item_id)

    order_with_refunds = SimpleNamespace(
        refunds=[
            SimpleNamespace(amount=Decimal("2.00"), currency="", provider="", note=" "),
            SimpleNamespace(amount=None, currency="EUR", provider="paypal", note="partial"),
        ]
    )
    refunds = receipts._build_receipt_refunds(order_with_refunds, currency="RON")
    assert refunds[0].currency == "RON"
    assert refunds[0].provider == "manual"
    assert refunds[0].note is None
    assert refunds[1].currency == "EUR"
    assert refunds[1].provider == "paypal"

    assert receipts._money(Decimal("12.3"), "RON", locale="ro") == "12,30 RON"
    assert receipts._money("bad-number", "EUR", locale="en") == "bad-number EUR"

    moment = datetime(2026, 2, 28, 15, 45, tzinfo=timezone.utc)
    assert receipts._format_date(moment, locale="ro") == "28.02.2026 15:45"
    assert receipts._format_date(moment, locale="en") == "2026-02-28 15:45"
    assert receipts._format_date("raw-value", locale="ro") == "raw-value"

    minimal_order = SimpleNamespace(
        id=uuid4(),
        status="paid",
        currency="EUR",
        items=[],
        refunds=[],
        shipping_address=None,
        billing_address=None,
    )
    minimal_receipt = receipts.build_order_receipt(minimal_order, items=[], redacted=False)
    assert receipts._reportlab_info_lines(minimal_receipt) == []

    def _raise_receipt_failure(*_args, **_kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(receipts, "_render_order_receipt_pdf_reportlab", _raise_receipt_failure)
    monkeypatch.setattr(receipts, "render_order_receipt_pdf_raster", lambda *_args, **_kwargs: b"fallback-pdf")
    assert receipts.render_order_receipt_pdf(minimal_order, items=[], redacted=False) == b"fallback-pdf"


def test_backend_wave_b_paypal_id_and_capture_helpers() -> None:
    assert paypal_service._sanitize_paypal_id("  ab12-cd34  ") == "AB12-CD34"
    with pytest.raises(HTTPException, match="Invalid PayPal order id"):
        paypal_service._sanitize_paypal_id("bad/id")

    assert paypal_service._first_dict_item(None) is None
    assert paypal_service._first_dict_item([]) is None
    assert paypal_service._first_dict_item(["bad"]) is None
    assert paypal_service._first_dict_item([{"id": "ok"}]) == {"id": "ok"}

    assert paypal_service._extract_capture_id({}) == ""
    capture_id = paypal_service._extract_capture_id(
        {"purchase_units": [{"payments": {"captures": [{"id": "CAPTURE-1"}]}}]}
    )
    assert capture_id == "CAPTURE-1"
    assert paypal_service._capture_path("order-1234") == "/v2/checkout/orders/ORDER-1234/capture"
    assert paypal_service._refund_path("capture-12") == "/v2/payments/captures/CAPTURE-12/refund"

    headers = {
        "paypal-auth-algo": "SHA256",
        "paypal-cert-url": "https://cert.example",
        "paypal-transmission-id": "tx-1",
        "paypal-transmission-sig": "sig-1",
        "paypal-transmission-time": "2026-02-28T12:00:00Z",
    }
    payload = paypal_service._webhook_verification_payload(headers=headers, event={"id": "evt-1"}, webhook_id="wh-1")
    assert payload["webhook_id"] == "wh-1"
    assert payload["webhook_event"] == {"id": "evt-1"}

    with pytest.raises(HTTPException, match="Missing PayPal signature headers"):
        paypal_service._webhook_verification_payload(headers={}, event={}, webhook_id="wh-1")
