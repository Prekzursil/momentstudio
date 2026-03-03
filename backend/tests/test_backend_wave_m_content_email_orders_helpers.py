from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1 import auth as auth_api
from app.api.v1 import content as content_api
from app.api.v1 import orders as orders_api
from app.services import email as email_service


def test_content_image_tag_normalization_limits_and_dedupes() -> None:
    assert content_api._normalize_image_tag("  Hero Banner  ") == "hero-banner"
    assert content_api._normalize_image_tag("$$$") is None
    assert content_api._normalize_image_tag("a" * 70) is None

    tags = content_api._normalize_image_tags(
        ["Hero", "hero", " alt tag ", "###", "x"] + [f"tag-{idx}" for idx in range(20)]
    )
    assert "hero" in tags
    assert "alt-tag" in tags
    assert len(tags) == 10


def test_content_redirect_value_conversion_roundtrip() -> None:
    assert content_api._redirect_key_to_display_value("page.about-us") == "/pages/about-us"
    assert content_api._redirect_key_to_display_value("site.legal") == "site.legal"

    assert content_api._redirect_display_value_to_key("/pages/About Us") == "page.about-us"
    assert content_api._redirect_display_value_to_key("plain.key") == "plain.key"


def test_content_redirect_chain_detection() -> None:
    assert content_api._redirect_chain_error("a", {"a": "b", "b": "c"}) is None
    assert content_api._redirect_chain_error("a", {"a": "b", "b": "a"}) == "loop"
    assert content_api._redirect_chain_error("a", {"a": "b", "b": "c"}, max_hops=1) == "too_deep"


def test_content_pagination_and_scheduling_window_helpers() -> None:
    meta = content_api._build_pagination_meta(total_items=21, page=2, limit=10)
    assert meta == {"total_items": 21, "total_pages": 3, "page": 2, "limit": 10}

    now = datetime(2026, 3, 3, 12, 0, tzinfo=timezone.utc)
    normalized = content_api._normalize_scheduling_window_start(datetime(2026, 3, 3, 1, 0), now)
    assert normalized.tzinfo == timezone.utc
    assert normalized.hour == 1


def test_content_redirect_csv_row_predicates() -> None:
    assert content_api._is_blank_redirect_import_row(["", " "]) is True
    assert content_api._is_comment_redirect_import_row(["# note", "value"]) is True
    assert content_api._is_header_redirect_import_row(1, ["from", "to"]) is True
    assert content_api._should_skip_redirect_import_row(1, ["from_key", "to_key"]) is True


def test_content_csv_value_helpers() -> None:
    row = [" from ", None]
    assert content_api._csv_row_value(row, 0) == " from "
    assert content_api._csv_row_value(row, 1) is None
    assert content_api._csv_row_value(row, 5) is None
    assert content_api._stripped_csv_row_value(row, 0) == "from"
    assert content_api._stripped_csv_row_value(row, 1) == ""
    assert content_api._none_if_empty("") is None
    assert content_api._none_if_empty("value") == "value"


def test_content_extract_redirect_import_pair_validation() -> None:
    missing_cols = content_api._extract_redirect_import_pair(2, ["only-one"])
    assert isinstance(missing_cols, content_api.ContentRedirectImportError)

    missing_from = content_api._extract_redirect_import_pair(3, [" ", "/pages/a"])
    assert isinstance(missing_from, content_api.ContentRedirectImportError)

    ok_pair = content_api._extract_redirect_import_pair(4, ["/pages/a", "/pages/b"])
    assert ok_pair == ("/pages/a", "/pages/b")


def test_content_validate_redirect_import_pair_paths() -> None:
    invalid = content_api._validate_redirect_import_pair(2, "/pages/a", "/pages/a")
    assert isinstance(invalid, content_api.ContentRedirectImportError)
    assert "must differ" in invalid.error

    good = content_api._validate_redirect_import_pair(3, "/pages/a", "/pages/b")
    assert good == ("page.a", "page.b")


def test_content_collect_redirect_rows_and_dedupe() -> None:
    text = "from,to\n/pages/a,/pages/b\n#note,\n/pages/a,/pages/c\n"
    rows, errors = content_api._collect_redirect_import_rows(text)
    assert errors == []
    assert rows == [(2, "page.a", "page.b"), (4, "page.a", "page.c")]

    deduped = content_api._dedupe_redirect_import_rows(rows)
    assert deduped == {"page.a": "page.c"}


def test_content_build_redirect_map_and_chain_error_raiser() -> None:
    mapped = content_api._build_redirect_map([("page.a", "page.b")], [(2, "page.b", "page.c")])
    assert mapped["page.a"] == "page.b"
    assert mapped["page.b"] == "page.c"

    content_api._raise_for_redirect_import_chain_errors({"page.a": "page.b", "page.b": "page.c"})
    with pytest.raises(HTTPException):
        content_api._raise_for_redirect_import_chain_errors({"page.a": "page.b", "page.b": "page.a"})


def test_content_parse_optional_datetime_range() -> None:
    parsed_from, parsed_to = content_api._parse_optional_datetime_range(
        "2026-03-01T10:00:00",
        "2026-03-02T10:00:00",
    )
    assert parsed_from is not None
    assert parsed_to is not None

    with pytest.raises(HTTPException):
        content_api._parse_optional_datetime_range("bad", "2026-03-02T10:00:00")
    with pytest.raises(HTTPException):
        content_api._parse_optional_datetime_range("2026-03-03T10:00:00", "2026-03-02T10:00:00")


def test_email_string_and_language_helpers() -> None:
    assert email_service._first_non_empty_str("", "  x  ", default="z") == "x"
    assert email_service._first_non_empty_str(None, default="z") == "z"
    assert email_service._lang_or_default("ro") == "ro"
    assert email_service._lang_or_default("de") == "en"
    assert email_service._localized_text(lang="ro", ro="Salut", en="Hi") == "Salut"
    assert email_service._localized_text(lang="en", ro="Salut", en="Hi") == "Hi"


def test_email_optional_line_and_money_helpers() -> None:
    lines: list[str] = []
    email_service._append_optional_labeled_line(
        lines,
        value="value",
        label_ro="Etichetă",
        label_en="Label",
        lang="en",
    )
    email_service._append_optional_labeled_line(
        lines,
        value=" ",
        label_ro="Etichetă",
        label_en="Label",
        lang="en",
    )
    assert lines == ["Label: value"]
    assert email_service._money_str(Decimal("12.3"), "RON") == "12.30 RON"
    assert email_service._money_str("not-number", "RON").endswith(" RON")


def test_email_bilingual_helpers() -> None:
    assert email_service._lang_order("ro") == ("ro", "en")
    assert email_service._lang_order("en") == ("en", "ro")
    assert email_service._bilingual_subject("Subiect", "Subject", preferred_language="ro") == "Subiect / Subject"

    text, html = email_service._bilingual_sections(
        text_ro="Salut",
        text_en="Hi",
        html_ro="<p>Salut</p>",
        html_en="<p>Hi</p>",
        preferred_language="en",
    )
    assert "[English]" in text
    assert "[Română]" in text
    assert html is not None
    assert "English" in html


def test_email_delivery_and_payment_label_helpers() -> None:
    assert email_service._courier_label("fan_courier", lang="en") == "Fan Courier"
    assert email_service._courier_label("", lang="en") is None
    assert email_service._delivery_type_label("home", lang="ro") == "Livrare la adresă"
    assert email_service._delivery_type_label("locker", lang="en") == "Locker pickup"
    assert email_service._payment_method_label("cod", lang="ro") == "Numerar"
    assert email_service._payment_method_label("paypal", lang="en") == "PayPal"


def test_email_delivery_lines_and_item_lines() -> None:
    order = SimpleNamespace(courier="sameday", delivery_type="locker", locker_name="L1", locker_address="Street")
    lines = email_service._delivery_lines(order, lang="en")
    assert any("Delivery:" in line for line in lines)
    assert any("Locker:" in line for line in lines)

    item = SimpleNamespace(
        product=SimpleNamespace(name="Ring", slug="ring"),
        quantity=2,
        unit_price=Decimal("10"),
        product_id=uuid4(),
    )
    assert "Ring" in email_service._order_item_line(item, currency="RON")


def test_email_charge_and_summary_helpers() -> None:
    order = SimpleNamespace(shipping_amount=Decimal("8"), fee_amount=Decimal("0"), tax_amount=Decimal("1"))
    lines: list[str] = []
    email_service._append_order_charge_lines(lines, order=order, currency="RON", lang="en")
    assert any("Shipping:" in line for line in lines)
    assert any("VAT:" in line for line in lines)
    assert email_service._is_non_zero_amount("0") is False
    assert email_service._is_non_zero_amount("1.00") is True

    top_lines = email_service._admin_summary_top_products_lines(
        products=[{"name": "Ring", "slug": "ring", "quantity": 3, "gross_sales": Decimal("12")}],
        is_ro=False,
        currency="RON",
    )
    assert any("Ring" in line for line in top_lines)
    low_lines = email_service._admin_summary_low_stock_lines(
        low_stock=[{"name": "Item", "stock_quantity": 1, "threshold": 5, "is_critical": True}],
        is_ro=True,
    )
    assert any("CRITIC" in line for line in low_lines)


def test_email_sanitize_next_path_and_rate_limit_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    assert email_service._sanitize_next_path("/account") == "/account"
    assert email_service._sanitize_next_path("https://bad") is None
    assert email_service._sanitize_next_path("//bad") is None

    email_service._rate_global.clear()
    email_service._rate_per_recipient.clear()
    monkeypatch.setattr(email_service.settings, "email_rate_limit_per_minute", 2)
    monkeypatch.setattr(email_service.settings, "email_rate_limit_per_recipient_per_minute", 1)

    now = 100.0
    assert email_service._allow_send(now, "a@example.test") is True
    email_service._record_send(now, "a@example.test")
    assert email_service._allow_send(now + 1, "a@example.test") is False
    assert email_service._allow_send(now + 1, "b@example.test") is True
    email_service._record_send(now + 1, "b@example.test")
    assert email_service._allow_send(now + 2, "c@example.test") is False
    email_service._prune(now + 70)
    assert email_service._allow_send(now + 70, "a@example.test") is True


def test_orders_string_and_identity_helpers() -> None:
    assert orders_api._split_customer_name(" Jane Doe ") == ("Jane", "Doe")
    assert orders_api._split_customer_name("Jane") == ("Jane", "Jane")
    assert orders_api._split_customer_name(" ") == ("Customer", "Customer")
    assert orders_api._default_customer_name(" ") == "Customer"

    assert orders_api._resolve_country_payload("ro") == (642, "Romania")
    assert orders_api._resolve_country_payload("fr") == (0, "FR")

    admin = SimpleNamespace(email="admin@example.test", username="adm")
    assert orders_api._admin_actor_label(admin) == "admin@example.test"
    assert orders_api._order_email_event_note(admin, "sent") == "admin@example.test: sent"


def test_orders_netopia_and_filename_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    addr = SimpleNamespace(line1="Street", line2="2", city="City", country="RO", region="B", postal_code="123")
    payload = orders_api._netopia_address_payload(
        email="client@example.test",
        phone="071234",
        first_name="A",
        last_name="B",
        addr=addr,
    )
    assert payload["country"] == 642
    assert "Street" in payload["details"]

    product = SimpleNamespace(name="Ring", sku="SKU1", category=SimpleNamespace(name="Jewelry"), id=uuid4())
    assert orders_api._netopia_product_name(product) == "Ring"
    assert orders_api._netopia_product_code(product) == "SKU1"
    assert orders_api._netopia_product_category(product) == "Jewelry"

    item = SimpleNamespace(product=product, subtotal=Decimal("12.40"))
    line = orders_api._netopia_order_item_line(item)
    assert line is not None
    assert line["price"] == Decimal("12.40")

    assert orders_api._sanitize_filename("../../label.pdf") == "label.pdf"
    monkeypatch.setattr(orders_api.settings, "frontend_origin", "https://fallback.local")
    monkeypatch.setattr(orders_api.settings, "cors_origins", ["https://allowed.local"])
    request = SimpleNamespace(headers={"origin": "https://allowed.local"})
    assert orders_api._frontend_base_from_request(request) == "https://allowed.local"


def test_orders_batch_normalization_and_contact_helpers() -> None:
    first, second = uuid4(), uuid4()
    assert orders_api._normalize_batch_order_ids([first, second, first], max_selected=5) == [first, second]
    with pytest.raises(HTTPException):
        orders_api._normalize_batch_order_ids([], max_selected=5)
    with pytest.raises(HTTPException):
        orders_api._normalize_batch_order_ids([first, second], max_selected=1)

    user_order = SimpleNamespace(user=SimpleNamespace(email="user@example.test"), customer_email="client@example.test")
    guest_order = SimpleNamespace(user=None, customer_email="guest@example.test")
    assert orders_api._resolve_order_contact_email(user_order) == "user@example.test"
    assert orders_api._resolve_order_contact_email(guest_order) == "guest@example.test"


def test_orders_guest_and_auth_refresh_helpers() -> None:
    payload = SimpleNamespace(
        name="Client",
        accept_terms=True,
        accept_privacy=True,
        promo_code="",
        password="code",
        username="client",
        first_name="A",
        last_name="B",
        date_of_birth="2000-01-01",
        phone="0712",
    )
    assert orders_api._require_guest_customer_name(payload) == "Client"
    orders_api._assert_guest_checkout_consents(payload)
    orders_api._assert_guest_checkout_no_coupon(payload)
    orders_api._validate_guest_account_creation(payload)

    with pytest.raises(HTTPException):
        orders_api._assert_guest_checkout_consents(SimpleNamespace(accept_terms=True, accept_privacy=False))

    request = SimpleNamespace(headers={"X-Silent": "yes"}, cookies={"refresh_token": "cookie"})
    assert auth_api._is_silent_refresh_probe(request) is True
    assert auth_api._refresh_token_from_request(SimpleNamespace(refresh_token=""), request) == "cookie"

