from __future__ import annotations
import asyncio

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4
import zipfile

import pytest
from starlette.requests import Request

from app.api.v1 import admin_dashboard as admin_dashboard_api
from app.api.v1 import auth as auth_api
from app.api.v1 import orders as orders_api
from app.models.order import OrderStatus
from app.schemas.catalog import CategoryReorderItem, ProductRelationshipsUpdate
from app.services import catalog as catalog_service


class _SessionRecorder:
    def __init__(self) -> None:
        self.added: list[object] = []
        self.committed = False
        self.refreshed: list[object] = []

    def add(self, obj: object) -> None:
        self.added.append(obj)

    async def commit(self) -> None:
        await asyncio.sleep(0)
        self.committed = True

    async def refresh(self, obj: object) -> None:
        await asyncio.sleep(0)
        self.refreshed.append(obj)


class _BackgroundTasksRecorder:
    def __init__(self) -> None:
        self.calls: list[tuple[object, tuple[object, ...], dict[str, object]]] = []

    def add_task(self, func, *args, **kwargs) -> None:
        self.calls.append((func, args, kwargs))


class _ResultScalars:
    def __init__(self, values: list[object]) -> None:
        self._values = values

    def unique(self) -> "_ResultScalars":
        return self

    def __iter__(self):
        return iter(self._values)


class _ExecuteResult:
    def __init__(self, values: list[object]) -> None:
        self._values = values

    def scalars(self) -> _ResultScalars:
        return _ResultScalars(self._values)


class _BatchSession:
    def __init__(self, values: list[object]) -> None:
        self._values = values

    async def execute(self, _stmt):
        await asyncio.sleep(0)
        return _ExecuteResult(self._values)


def _make_request(*, headers: dict[str, str] | None = None, client_host: str | None = "127.0.0.1") -> Request:
    raw_headers = [
        (key.lower().encode("latin-1"), value.encode("latin-1"))
        for key, value in (headers or {}).items()
    ]
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "GET",
        "scheme": "https",
        "path": "/",
        "query_string": b"",
        "headers": raw_headers,
        "client": (client_host, 44321) if client_host is not None else None,
    }
    return Request(scope)


def test_orders_stripe_and_paypal_line_item_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(orders_api.pricing, "quantize_money", lambda value: Decimal(str(value)).quantize(Decimal("0.01")))

    item = SimpleNamespace(
        product=SimpleNamespace(name="Ring", sku="sku-1", category=SimpleNamespace(name="Jewelry")),
        variant=SimpleNamespace(name="Blue"),
        quantity=2,
        unit_price_at_add=Decimal("12.50"),
        subtotal=Decimal("25.00"),
    )
    empty = SimpleNamespace(product=SimpleNamespace(name="Ignored"), variant=None, quantity=0, unit_price_at_add=Decimal("1.00"))

    stripe_item = orders_api._stripe_cart_line_item(item, lang="en")
    assert stripe_item is not None
    assert stripe_item["quantity"] == 2
    assert stripe_item["price_data"]["unit_amount"] == 1250
    assert orders_api._stripe_cart_line_item(empty, lang="en") is None

    cart = SimpleNamespace(items=[item, empty])
    paypal_items = orders_api._build_paypal_items(cart, lang="en")
    assert len(paypal_items) == 1
    assert paypal_items[0]["sku"] == "sku-1"

    lines: list[dict[str, object]] = []
    orders_api._append_stripe_charge_line_item(lines, amount_cents=0, charge_kind="fee", lang="en")
    orders_api._append_stripe_charge_line_item(lines, amount_cents=500, charge_kind="fee", lang="en")
    assert len(lines) == 1
    assert lines[0]["price_data"]["product_data"]["name"] == "Fee"


def test_orders_netopia_and_address_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(orders_api.pricing, "quantize_money", lambda value: Decimal(str(value)).quantize(Decimal("0.01")))

    item = SimpleNamespace(
        product=SimpleNamespace(id="p1", name="", sku="", category=SimpleNamespace(name="")),
        subtotal=Decimal("10.00"),
    )
    no_subtotal = SimpleNamespace(product=SimpleNamespace(id="p2", name="N", sku="S"), subtotal=Decimal("0.00"))

    line = orders_api._netopia_order_item_line(item)
    assert line is not None
    assert line["name"] == "Item"
    assert line["code"] == "p1"
    assert line["category"] == "Product"
    assert orders_api._netopia_order_item_line(no_subtotal) is None

    lines = [
        {"name": "A", "code": "a", "category": "c", "price": Decimal("8.00"), "vat": Decimal("0.00")},
        {"name": "B", "code": "b", "category": "c", "price": Decimal("4.00"), "vat": Decimal("0.00")},
    ]
    orders_api._append_netopia_charge_line(lines, amount_value="2", charge_kind="shipping", code="ship", category="Shipping", lang="ro")
    assert any(row["name"] == "Livrare" for row in lines)
    orders_api._rebalance_netopia_lines_total(lines, target=Decimal("9.00"))
    assert sum(row["price"] for row in lines) == Decimal("9.00")

    serialized = orders_api._serialize_netopia_products(lines)
    assert isinstance(serialized[0]["price"], float)

    addr = SimpleNamespace(line1="Street 1", line2="Apt 3", city="Cluj", region="CJ", postal_code="400000", country="us")
    payload = orders_api._netopia_address_payload(
        email="  user@example.com ",
        phone=" +40123 ",
        first_name="",
        last_name="Last",
        addr=addr,
    )
    assert payload["email"] == "user@example.com"
    assert payload["country"] == 0
    assert payload["countryName"] == "US"
    assert payload["firstName"] == "Customer"
    assert payload["details"] == "Street 1, Apt 3"


def test_orders_batch_and_shipping_label_helpers(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    order_id = uuid4()
    other_id = uuid4()

    assert orders_api._sanitize_filename(None) == "shipping-label"
    assert orders_api._sanitize_filename("../a.pdf") == "a.pdf"

    normalized = orders_api._normalize_batch_order_ids([order_id, order_id, other_id], max_selected=5)
    assert normalized == [order_id, other_id]
    with pytest.raises(orders_api.HTTPException):
        orders_api._normalize_batch_order_ids([], max_selected=5)

    first = SimpleNamespace(id=order_id)
    second = SimpleNamespace(id=other_id)
    missing = orders_api._missing_batch_order_ids([order_id, other_id], [first])
    assert missing == [str(other_id)]
    assert orders_api._ordered_batch_orders([other_id, order_id], [first, second]) == [second, first]

    pdf_path = tmp_path / "shipping.pdf"
    pdf_path.write_bytes(b"pdf-data")
    monkeypatch.setattr(orders_api.private_storage, "resolve_private_path", lambda rel: tmp_path / rel)

    order_with_label = SimpleNamespace(
        id=order_id,
        reference_code="REF-1",
        shipping_label_path="shipping.pdf",
        shipping_label_filename=None,
    )
    order_missing_label = SimpleNamespace(
        id=other_id,
        reference_code="REF-2",
        shipping_label_path="missing.pdf",
        shipping_label_filename=None,
    )

    zip_entry = orders_api._order_shipping_label_zip_entry(order_with_label)
    assert zip_entry is not None
    files, missing_ids = orders_api._collect_batch_shipping_label_files([order_with_label, order_missing_label])
    assert len(files) == 1
    assert missing_ids == [str(other_id)]

    with pytest.raises(orders_api.HTTPException):
        orders_api._raise_for_missing_shipping_labels(missing_ids)

    zip_buffer = orders_api._build_shipping_labels_zip_buffer(files)
    with zipfile.ZipFile(zip_buffer, mode="r") as archive:
        names = archive.namelist()
    assert names
    zip_buffer.seek(0)
    chunks = list(orders_api._iter_bytes_buffer(zip_buffer, chunk_size=2))
    assert chunks and b"".join(chunks)


def test_orders_contact_checkout_and_export_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    order = SimpleNamespace(
        user=SimpleNamespace(email="user@example.com", preferred_language="ro"),
        customer_email="customer@example.com",
        reference_code="REF-100",
        id=uuid4(),
        status=OrderStatus.paid,
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        updated_at=None,
        user_id=uuid4(),
        shipping_method=SimpleNamespace(name="Locker"),
        total_amount=Decimal("10.00"),
        tax_amount=Decimal("1.00"),
        fee_amount=Decimal("0.50"),
        shipping_amount=Decimal("2.00"),
        currency="RON",
        payment_method="card",
        promo_code="PROMO",
        courier="fan",
        delivery_type="locker",
        tracking_number="TRK",
        tracking_url="http://example",
        invoice_company="Co",
        invoice_vat_id="RO123",
        locker_name="L",
        locker_address="A",
    )

    assert orders_api._resolve_order_contact_email(order) == "user@example.com"
    assert orders_api._order_email_event_note(SimpleNamespace(email="admin@example.com"), " noted ") == "admin@example.com: noted"
    assert orders_api._shipping_label_event_name("print") == "shipping_label_printed"
    assert orders_api._shipping_label_event_name("download") == "shipping_label_downloaded"
    assert orders_api._shipping_rate_tuple(None) == (None, None)
    assert orders_api._shipping_rate_tuple(SimpleNamespace(rate_flat="5", rate_per_kg="1.2")) == (Decimal("5"), Decimal("1.2"))
    assert orders_api._checkout_billing_label(save_address=False).endswith("One-time")
    assert orders_api._billing_line_present(" x ") is True
    assert orders_api._guest_default_billing(save_address=True, create_account=True, billing_same_as_shipping=True) is True
    assert orders_api._guest_default_shipping(save_address=False, create_account=True) is False

    monkeypatch.setattr(orders_api.pii_service, "mask_email", lambda value: f"MASK:{value}")
    monkeypatch.setattr(orders_api.pii_service, "mask_text", lambda value, keep=0: f"MASKTXT:{value}:{keep}")
    masked = orders_api._masked_order_export_columns()
    assert masked["customer_email"](order).startswith("MASK:")

    allowed = orders_api._order_export_allowed_columns(include_pii=True)
    csv_text = orders_api._render_orders_csv([order], selected_columns=["reference_code", "status"], allowed=allowed)
    assert "reference_code,status" in csv_text


def test_orders_refund_and_status_notification_helpers() -> None:
    order = SimpleNamespace(
        id=uuid4(),
        reference_code="REF-2",
        payment_method="paypal",
        paypal_capture_id="CAP-1",
        stripe_payment_intent_id=None,
        status=OrderStatus.cancelled,
        user=SimpleNamespace(id=uuid4(), email="buyer@example.com", preferred_language="ro"),
        customer_email="fallback@example.com",
    )
    assert orders_api._cancelled_order_refund_method(order) == "paypal"
    owner = SimpleNamespace(preferred_language="ro")
    assert orders_api._manual_refund_notification_title(owner) == "Rambursare necesară"
    assert "Comanda" in orders_api._manual_refund_notification_body(order, payment_method="paypal", owner=owner)
    assert orders_api._order_customer_contact(order)[0] == "buyer@example.com"
    assert orders_api._normalize_optional_note("  hello ") == "hello"


def test_orders_guest_email_token_state_helpers() -> None:
    now = datetime(2026, 3, 1, 10, 0, tzinfo=timezone.utc)
    cart = SimpleNamespace(
        guest_email="guest@example.com",
        guest_email_verification_token=" 123456 ",
        guest_email_verification_expires_at=datetime(2026, 3, 1, 11, 0),
        guest_email_verification_attempts=0,
        guest_email_verified_at=None,
        guest_email_verification_last_attempt_at=None,
    )

    assert orders_api._normalized_guest_email_token(" 123 ") == "123"
    assert orders_api._cart_guest_email_token_expiry(cart).tzinfo == timezone.utc
    token, attempts = orders_api._assert_guest_email_token_state(cart, email="guest@example.com", now=now)
    assert token == "123456"
    assert attempts == 0

    cart.guest_email_verification_attempts = orders_api.GUEST_EMAIL_TOKEN_MAX_ATTEMPTS
    with pytest.raises(orders_api.HTTPException):
        orders_api._assert_guest_email_token_state(cart, email="guest@example.com", now=now)


@pytest.mark.anyio
async def test_orders_guest_email_token_mutation_helpers() -> None:
    now = datetime(2026, 3, 1, 10, 0, tzinfo=timezone.utc)
    cart = SimpleNamespace(
        guest_email="guest@example.com",
        guest_email_verification_token="111111",
        guest_email_verification_expires_at=now + timedelta(hours=1),
        guest_email_verification_attempts=0,
        guest_email_verified_at=None,
        guest_email_verification_last_attempt_at=None,
    )
    session = _SessionRecorder()

    await orders_api._record_guest_email_token_failure(session, cart, attempts=0, now=now)
    assert cart.guest_email_verification_attempts == 1
    assert session.committed is True

    status_payload = await orders_api._mark_guest_email_verified(session, cart, now=now)
    assert status_payload.verified is True
    assert cart.guest_email_verification_token is None


@pytest.mark.anyio
async def test_orders_load_order_batch_or_404_helper() -> None:
    wanted = uuid4()
    found = SimpleNamespace(id=wanted)
    session = _BatchSession([found])
    loaded = await orders_api._load_order_batch_or_404(session, [wanted])
    assert loaded == [found]

    missing_id = uuid4()
    with pytest.raises(orders_api.HTTPException):
        await orders_api._load_order_batch_or_404(_BatchSession([found]), [wanted, missing_id])


def test_admin_dashboard_payload_and_channel_helpers() -> None:
    request = _make_request(headers={"user-agent": "x" * 300}, client_host="10.0.0.5")
    meta = admin_dashboard_api._request_audit_metadata(request)
    assert meta["ip_address"] == "10.0.0.5"
    assert len(meta["user_agent"] or "") == 255

    payload = admin_dashboard_api._dashboard_alert_thresholds_payload(
        SimpleNamespace(
            failed_payments_min_count=None,
            failed_payments_min_delta_pct=Decimal("120.5"),
            refund_requests_min_count=2,
            refund_requests_min_rate_pct=None,
            stockouts_min_count=3,
            updated_at="now",
        )
    )
    assert payload["failed_payments_min_count"] == 1
    assert payload["failed_payments_min_delta_pct"] == pytest.approx(120.5)
    assert admin_dashboard_api._decimal_or_none(None) is None
    assert admin_dashboard_api._decimal_or_none("1.25") == Decimal("1.25")

    audit = admin_dashboard_api._admin_send_report_audit_data(
        "daily",
        True,
        {"ip_address": "1.1.1.1"},
        result={"ok": True},
        error=RuntimeError("e" * 1000),
    )
    assert audit["kind"] == "daily"
    assert len(str(audit["error"])) == 500

    items = admin_dashboard_api._channel_items(
        [("x", 1, Decimal("10")), (None, 4, Decimal("8"))],
        refunds_map={"x": Decimal("1")},
        missing_map={"x": Decimal("2")},
        label_unknown="unknown",
    )
    assert items[0]["key"] == "unknown"
    assert items[1]["net_sales"] == pytest.approx(7.0)


def test_admin_dashboard_payment_and_shipping_math_helpers() -> None:
    assert admin_dashboard_api._payments_success_rate(0, 0) is None
    assert admin_dashboard_api._payments_success_rate(3, 1) == pytest.approx(0.75)

    sorted_methods = admin_dashboard_api._payments_sorted_methods({"paypal": 1}, {"stripe": 2})
    assert sorted_methods[:2] == ["stripe", "paypal"]

    provider = admin_dashboard_api._payments_provider_row(
        "stripe",
        {"stripe": 5},
        {"stripe": 5},
        {"stripe": {"errors": 2, "backlog": 1}},
    )
    assert provider["success_rate"] == pytest.approx(0.5)

    rows = admin_dashboard_api._payments_provider_rows({"paypal": 1}, {"paypal": 0}, {})
    assert any(row["provider"] == "paypal" for row in rows)

    assert admin_dashboard_api._refund_delta_pct(4.0, 2.0) == pytest.approx(100.0)
    assert admin_dashboard_api._refund_delta_pct(1.0, 0.0) is None
    assert admin_dashboard_api._shipping_delta_pct(4.0, 2.0) == pytest.approx(100.0)
    assert admin_dashboard_api._shipping_delta_pct(None, 2.0) is None
    assert admin_dashboard_api._shipping_avg([1.0, 3.0]) == pytest.approx(2.0)

    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    valid_end = start + timedelta(hours=3)
    durations = admin_dashboard_api._shipping_duration_map(
        [
            ("fan", start, valid_end),
            ("fan", start, start - timedelta(hours=1)),
            (None, None, valid_end),
        ],
        courier_idx=0,
        start_idx=1,
        end_idx=2,
    )
    assert durations == {"fan": [3.0]}


def test_auth_token_and_refresh_response_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    user_id = uuid4()
    monkeypatch.setattr(
        auth_api.security,
        "decode_token",
        lambda token: {
            "refresh-ok": {"type": "refresh", "jti": "j-1"},
            "wrong": {"type": "access", "jti": "j-2"},
            "two-factor": {"type": "two_factor", "sub": str(user_id), "remember": True, "method": "totp"},
        }.get(token),
    )

    assert auth_api._extract_token_jti("refresh-ok", token_type="refresh") == "j-1"
    assert auth_api._extract_token_jti("wrong", token_type="refresh") is None

    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    row = SimpleNamespace(
        id=uuid4(),
        jti="j-1",
        created_at=datetime(2026, 1, 1),
        expires_at=datetime(2026, 1, 1, 1, 0),
        persistent=True,
        user_agent="ua",
        ip_address="1.1.1.1",
        country_code="RO",
    )
    session_response = auth_api._build_refresh_session_response(row, now=now, current_jti="j-1")
    assert session_response is not None
    assert session_response.is_current is True

    expired = auth_api._active_refresh_session_expiry(SimpleNamespace(expires_at=datetime(2025, 1, 1, tzinfo=timezone.utc)), now=now)
    assert expired is None

    user_id_out, remember, method = auth_api._decode_two_factor_login_token("two-factor")
    assert user_id_out == user_id
    assert remember is True
    assert method == "totp"


def test_auth_registration_google_and_passkey_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(auth_api.HTTPException):
        auth_api._require_registration_consents(True, False)

    session = _SessionRecorder()
    auth_api._record_registration_consents(session, user_id=uuid4(), consent_versions={"terms": 1, "privacy": 2})
    assert len(session.added) == 2

    monkeypatch.setattr(auth_api.settings, "google_allowed_domains", ["example.com"])
    sub, _email, name, picture, email_verified = auth_api._extract_valid_google_profile(
        {"sub": "s1", "email": "user@example.com", "name": "User", "picture": "pic", "email_verified": True}
    )
    assert (sub, email_verified) == ("s1", True)
    assert name == "User"
    assert picture == "pic"

    with pytest.raises(auth_api.HTTPException):
        auth_api._extract_valid_google_profile({"sub": "s1", "email": "user@other.com"})

    user = SimpleNamespace(
        google_sub=None,
        google_email=None,
        google_picture_url=None,
        email_verified=False,
        name=None,
    )
    auth_api._apply_google_link(user, sub="sub", email="e@example.com", picture="pic", name="Full Name", email_verified=True)
    assert user.google_sub == "sub"
    assert user.name == "Full Name"

    with pytest.raises(auth_api.HTTPException):
        auth_api._validated_passkey_login_token_payload("missing")

    monkeypatch.setattr(auth_api.security, "decode_token", lambda _: {"type": "webauthn", "purpose": "login", "challenge": "AQI"})
    payload = auth_api._validated_passkey_login_token_payload("token")
    assert auth_api._challenge_from_passkey_login_token_payload(payload) == b"\x01\x02"


def test_catalog_translation_sale_and_badge_helpers() -> None:
    translation = SimpleNamespace(lang="ro", name="Nume", short_description="S", long_description="L", meta_title="T", meta_description="D")
    product = SimpleNamespace(
        translations=[translation],
        name="Name",
        short_description="old-s",
        long_description="old-l",
        meta_title="old-t",
        meta_description="old-d",
        images=[],
    )
    catalog_service._apply_product_text_translation(product, "ro")
    assert product.name == "Nume"
    assert catalog_service._find_translation_for_lang([translation], "ro") is translation

    image_translation = SimpleNamespace(lang="ro", alt_text="alt", caption="cap")
    image = SimpleNamespace(translations=[image_translation], alt_text=None, caption=None)
    catalog_service._apply_product_image_translation(image, "ro")
    assert image.alt_text == "alt"

    with pytest.raises(catalog_service.HTTPException):
        catalog_service._validate_price_currency(Decimal("-1"), "RON")
    with pytest.raises(catalog_service.HTTPException):
        catalog_service._validate_price_currency(Decimal("1"), "EURO")

    assert catalog_service._to_decimal(None) == Decimal("0.00")
    assert catalog_service._tz_aware(datetime(2026, 1, 1)).tzinfo == timezone.utc

    with pytest.raises(catalog_service.HTTPException):
        catalog_service._validate_sale_schedule(
            sale_start_at=datetime(2026, 1, 2),
            sale_end_at=datetime(2026, 1, 1),
            sale_auto_publish=False,
        )

    with pytest.raises(catalog_service.HTTPException):
        catalog_service._extract_badge_value({})

    with pytest.raises(catalog_service.HTTPException):
        catalog_service._parse_badge_schedule({"start_at": datetime(2026, 1, 2), "end_at": datetime(2026, 1, 1)})

    badges = catalog_service._build_product_badges([{"badge": "new", "start_at": datetime(2026, 1, 1)}])
    assert len(badges) == 1
    with pytest.raises(catalog_service.HTTPException):
        catalog_service._build_product_badges([{"badge": "new"}, {"badge": "new"}])


def test_catalog_sale_pricing_and_category_helpers() -> None:
    assert catalog_service._resolve_sale_discount(Decimal("100"), "percent", Decimal("10")) == Decimal("10.00")
    assert catalog_service._resolve_sale_discount(Decimal("100"), "amount", Decimal("5")) == Decimal("5")
    assert catalog_service._resolve_sale_discount(Decimal("100"), "bad", Decimal("5")) is None
    assert catalog_service._finalize_sale_price(Decimal("100"), Decimal("100")) == Decimal("0.00")
    assert catalog_service._finalize_sale_price(Decimal("100"), Decimal("0")) is None

    sale_price = catalog_service._compute_sale_price(base_price="100", sale_type="percent", sale_value="25")
    assert sale_price == Decimal("75.00")
    assert catalog_service._compute_sale_price(base_price="0", sale_type="percent", sale_value="25") is None

    category = SimpleNamespace(slug="rings", sort_order=1)
    sanitized = catalog_service._sanitize_category_update_data(category, {"slug": "rings", "sort_order": 2})
    assert "slug" not in sanitized
    with pytest.raises(catalog_service.HTTPException):
        catalog_service._sanitize_category_update_data(category, {"slug": "new-slug"})

    entity = SimpleNamespace(a=1, b=2)
    catalog_service._apply_field_updates(entity, {"a": 10, "b": 20})
    assert (entity.a, entity.b) == (10, 20)

    cat_a = SimpleNamespace(slug="rings", sort_order=0, updated_at=None)
    reordered = catalog_service._collect_category_reorder_updates(
        [CategoryReorderItem(slug="rings", sort_order=5), CategoryReorderItem(slug="missing", sort_order=3)],
        {"rings": cat_a},
    )
    assert reordered == [cat_a]
    assert cat_a.sort_order == 5


def test_catalog_relationship_and_import_parser_helpers() -> None:
    first = uuid4()
    second = uuid4()
    assert catalog_service._dedupe_uuid_list([first, second, first]) == [first, second]

    payload = ProductRelationshipsUpdate(related_product_ids=[first], upsell_product_ids=[first, second])
    related, upsells = catalog_service._normalized_relationship_ids(product_id=uuid4(), payload=payload)
    assert related == [first]
    assert upsells == [second]

    with pytest.raises(catalog_service.HTTPException):
        catalog_service._normalized_relationship_ids(
            product_id=first,
            payload=ProductRelationshipsUpdate(related_product_ids=[first], upsell_product_ids=[]),
        )

    assert catalog_service._parse_category_sort_order_or_error(1, "") == (0, None)
    assert catalog_service._parse_category_sort_order_or_error(2, "bad")[0] is None
    assert catalog_service._parse_category_is_visible(" no ") is False
    assert catalog_service._parse_category_is_visible(" yes ") is True
    assert catalog_service._parse_category_is_visible(" ") is None

    fields = catalog_service._category_translation_fields(
        {"name_ro": " RO ", "name_en": " EN ", "description_ro": " d1 ", "description_en": ""}
    )
    assert fields == ("RO", "EN", "d1", None)
    assert catalog_service._validate_category_translation_fields_or_error(
        3,
        name_ro="",
        name_en="EN",
        description_ro="desc",
        description_en=None,
    ) is not None
    assert catalog_service._csv_trimmed_value({"name": "  value  "}, "name") == "value"

