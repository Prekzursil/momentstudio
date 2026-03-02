from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
import math
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

from fastapi import HTTPException
import pytest

from app.models.media import MediaAssetStatus, MediaAssetType, MediaVisibility
from app.services import media_dam
from app.services import paypal as paypal_service
from app.services import receipts
from app.services import storage


def test_media_dam_helper_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    assert media_dam._normalize_tag("  Hero Banner 2026!!! ") == "hero-banner-2026"
    assert media_dam._normalize_job_tag("___") == ""
    assert media_dam._optional_stripped("  value  ") == "value"
    assert media_dam._optional_stripped("   ") is None

    assert media_dam._coerce_triage_state("resolved", fallback="open") == "resolved"
    assert media_dam._coerce_triage_state("invalid", fallback="ignored") == "ignored"

    fallback = media_dam.RetryPolicyResolved(
        max_attempts=5,
        schedule=[30, 60],
        jitter_ratio=0.2,
        enabled=True,
        version_ts="v1",
    )
    normalized = media_dam._normalize_retry_policy_fields(
        max_attempts=500,
        schedule=[],
        jitter_ratio=-1.0,
        enabled=None,
        fallback=fallback,
    )
    assert normalized.max_attempts == media_dam.MAX_RETRY_POLICY_ATTEMPTS
    assert normalized.schedule == [30]
    assert math.isclose(normalized.jitter_ratio, 0.0, rel_tol=0.0, abs_tol=1e-9)
    assert normalized.enabled is True

    assert media_dam._retry_policy_from_raw({"max_attempts": 0, "schedule": [1]}) is None
    parsed = media_dam._retry_policy_from_raw(
        {
            "max_attempts": "4",
            "schedule": ["10", 20],
            "jitter_ratio": "2.5",
            "enabled": False,
            "version_ts": "snapshot-1",
        }
    )
    assert parsed is not None
    assert parsed.max_attempts == 4
    assert parsed.schedule == [10, 20]
    assert math.isclose(parsed.jitter_ratio, 1.0, rel_tol=0.0, abs_tol=1e-9)
    assert parsed.enabled is False
    assert parsed.version_ts == "snapshot-1"

    assert media_dam._retry_delay_seconds(attempt=5, max_attempts=5, schedule=[10], jitter_ratio=0.0) is None
    assert (
        media_dam._retry_delay_seconds(attempt=1, max_attempts=5, schedule=[], jitter_ratio=0.0)
        == media_dam.RETRY_BACKOFF_SECONDS[0]
    )
    monkeypatch.setattr(media_dam.random, "uniform", lambda _a, _b: 0.5)
    assert media_dam._retry_delay_seconds(attempt=1, max_attempts=5, schedule=[10], jitter_ratio=1.0) == 15

    assert media_dam._guess_asset_type("image/png", None) == MediaAssetType.image
    assert media_dam._guess_asset_type(None, "video.MP4") == MediaAssetType.video
    assert media_dam._guess_asset_type("application/pdf", "notes.txt") == MediaAssetType.document
    assert media_dam._safe_storage_name("../../unsafe file?.png") == "unsafe-file-.png"
    assert media_dam._public_url_from_storage_key("/folder/file.jpg") == "/media/folder/file.jpg"

    public_asset = SimpleNamespace(visibility=MediaVisibility.public, status=MediaAssetStatus.approved)
    assert media_dam._is_publicly_servable(public_asset) is True
    assert media_dam._is_publicly_servable(SimpleNamespace(visibility=MediaVisibility.private, status=MediaAssetStatus.approved)) is False
    assert media_dam._is_publicly_servable(SimpleNamespace(visibility=MediaVisibility.public, status=MediaAssetStatus.trashed)) is False

    assert media_dam._normalized_asset_tags(["Hero Banner", "hero-banner", "promo", "seasonal"], limit=2) == [
        "hero-banner",
        "promo",
    ]
    assert {"summer", "sale", "2026", "jpg"} <= media_dam._auto_tags_from_filename("Summer-Sale_2026.jpg")

    job = SimpleNamespace(triage_state="open", assigned_to_user_id=uuid4(), sla_due_at=None)
    meta: dict[str, object] = {}
    media_dam._apply_triage_state_update(job, triage_state="ignored", meta=meta)
    assert job.triage_state == "ignored"
    assert meta["triage_state"] == "ignored"

    meta = {}
    media_dam._apply_triage_state_update(job, triage_state="not-valid", meta=meta)
    assert job.triage_state == "ignored"
    assert meta["triage_state"] == "ignored"

    new_assignee = uuid4()
    meta = {}
    media_dam._apply_assignee_update(job, clear_assignee=False, assigned_to_user_id=new_assignee, meta=meta)
    assert job.assigned_to_user_id == new_assignee
    assert meta["assigned_to_user_id"] == str(new_assignee)

    meta = {}
    media_dam._apply_assignee_update(job, clear_assignee=True, assigned_to_user_id=None, meta=meta)
    assert job.assigned_to_user_id is None
    assert meta["assigned_to_user_id"] is None


def test_media_dam_telemetry_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(media_dam.settings, "media_dam_telemetry_heartbeat_scan_limit", -3)
    assert media_dam._heartbeat_scan_limit() == 1
    monkeypatch.setattr(media_dam.settings, "media_dam_telemetry_heartbeat_scan_limit", 17)
    assert media_dam._heartbeat_scan_limit() == 17

    naive = media_dam._parse_heartbeat_timestamp("2026-02-01T10:30:00")
    assert naive is not None and naive.tzinfo == timezone.utc
    aware = media_dam._parse_heartbeat_timestamp("2026-02-01T10:30:00+02:00")
    assert aware is not None and aware.tzinfo is not None
    assert media_dam._parse_heartbeat_timestamp("invalid") is None

    assert media_dam._optional_int("42") == 42
    assert media_dam._optional_int("4.2") is None
    assert media_dam._optional_int("abc") is None

    assert media_dam._worker_id_from_payload({"worker_id": " worker-a "}, key="media:workers:heartbeat:key-x") == "worker-a"
    assert media_dam._worker_id_from_payload({}, key="media:workers:heartbeat:key-x") == "key-x"


def test_media_dam_path_and_preview_helpers(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    public_root = tmp_path / "public-media"
    private_root = tmp_path / "private-media"
    monkeypatch.setattr(media_dam.settings, "media_root", str(public_root))
    monkeypatch.setattr(media_dam.settings, "private_media_root", str(private_root))
    monkeypatch.setattr(media_dam.settings, "secret_key", "test-secret")

    key = "assets/example.jpg"
    assert media_dam._find_existing_storage_path("") is None

    private_path = (private_root / key).resolve()
    private_path.parent.mkdir(parents=True, exist_ok=True)
    private_path.write_bytes(b"private")
    assert media_dam._find_existing_storage_path(key) == private_path

    public_path = (public_root / key).resolve()
    public_path.parent.mkdir(parents=True, exist_ok=True)
    public_path.write_bytes(b"public")
    assert media_dam._find_existing_storage_path(key) == public_path

    public_asset = SimpleNamespace(
        storage_key=key,
        public_url=None,
        visibility=MediaVisibility.public,
        status=MediaAssetStatus.approved,
        variants=[],
    )
    assert media_dam._asset_file_path(public_asset) == public_path

    public_path.unlink()
    assert media_dam._asset_file_path(public_asset) == private_path

    private_path.unlink()
    fallback_rel = "fallback/from-url.jpg"
    fallback_public = (public_root / fallback_rel).resolve()
    fallback_public.parent.mkdir(parents=True, exist_ok=True)
    fallback_public.write_bytes(b"fallback")
    from_url_asset = SimpleNamespace(
        storage_key="missing/key.jpg",
        public_url=f"/media/{fallback_rel}",
        visibility=MediaVisibility.private,
        status=MediaAssetStatus.approved,
        variants=[],
    )
    assert media_dam._asset_file_path(from_url_asset) == fallback_public

    missing_asset = SimpleNamespace(
        storage_key="missing/again.jpg",
        public_url="/media/missing/url.jpg",
        visibility=MediaVisibility.private,
        status=MediaAssetStatus.approved,
        variants=[],
    )
    assert media_dam._asset_file_path(missing_asset) == (private_root / "missing/again.jpg").resolve()

    fixed_now = datetime(2026, 2, 1, 12, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(media_dam, "_now", lambda: fixed_now)
    asset_id = uuid4()
    preview_url = media_dam.build_preview_url(asset_id, variant_profile="web-640", ttl_seconds=5)
    query = parse_qs(urlsplit(preview_url).query)
    exp = int(query["exp"][0])
    sig = query["sig"][0]
    assert exp - int(fixed_now.timestamp()) >= 30
    assert media_dam.verify_preview_signature(asset_id, exp=exp, sig=sig, variant_profile="web-640") is True
    assert media_dam.verify_preview_signature(asset_id, exp=exp, sig="bad", variant_profile="web-640") is False
    assert media_dam.verify_preview_signature(asset_id, exp="oops", sig=sig, variant_profile="web-640") is False


def test_media_dam_move_file_falls_back_to_shutil(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    source = tmp_path / "source.bin"
    destination = tmp_path / "destination.bin"
    source.write_bytes(b"x")

    def _raise_replace(self: Path, _destination: Path) -> None:
        raise OSError("replace failed")

    moved: list[tuple[str, str]] = []
    monkeypatch.setattr(Path, "replace", _raise_replace)
    monkeypatch.setattr(media_dam.shutil, "move", lambda src, dst: moved.append((src, dst)))
    media_dam._move_file(source, destination)

    assert moved == [(str(source), str(destination))]


def test_storage_helper_branches(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    media_root = tmp_path / "media-root"
    monkeypatch.setattr(storage.settings, "media_root", str(media_root))

    base_root, dest_root = storage._resolve_upload_roots(media_root / "nested")
    assert base_root == media_root.resolve()
    assert dest_root == (media_root / "nested").resolve()

    with pytest.raises(HTTPException, match="Invalid upload destination"):
        storage._resolve_upload_roots(tmp_path / "outside")

    monkeypatch.setattr(storage.settings, "admin_upload_max_bytes", 0)
    assert storage._effective_upload_max_bytes(None) == 512 * 1024 * 1024
    monkeypatch.setattr(storage.settings, "admin_upload_max_bytes", 2048)
    assert storage._effective_upload_max_bytes(None) == 2048
    assert storage._effective_upload_max_bytes(1234) == 1234

    upload = SimpleNamespace(filename="source.PNG")
    stem, suffix = storage._initial_upload_name(upload, "../safe-name.jpg")
    assert stem == "safe-name"
    assert suffix == ".jpg"

    random_stem, random_suffix = storage._initial_upload_name(upload, None)
    assert len(random_stem) == 32
    assert random_suffix == ".png"

    empty_suffix_stem, empty_suffix = storage._initial_upload_name(SimpleNamespace(filename=None), None)
    assert len(empty_suffix_stem) == 32
    assert empty_suffix == ".bin"

    svg_path = tmp_path / "image.svg"
    svg_path.write_text("<svg></svg>", encoding="utf-8")
    monkeypatch.setattr(storage, "_sanitize_svg", lambda _raw: b"<svg sanitized='1'/>")
    assert storage._sanitize_uploaded_svg(svg_path, written=11, sniff_mime="image/svg+xml") is True
    assert svg_path.read_bytes() == b"<svg sanitized='1'/>"
    assert storage._sanitize_uploaded_svg(svg_path, written=11, sniff_mime="image/png") is False

    with pytest.raises(HTTPException, match="SVG file too large"):
        storage._sanitize_uploaded_svg(svg_path, written=storage._SVG_MAX_BYTES + 1, sniff_mime="image/svg+xml")

    destination = tmp_path / "photo.jpeg"
    destination.write_bytes(b"x")
    final_path = storage._canonical_upload_path(destination, "image/png")
    assert final_path.name == "photo.png"
    assert final_path.exists()
    assert not destination.exists()

    payload = storage._validated_image_payload(bytearray(b"abc"), max_bytes=5)
    assert payload == b"abc"
    with pytest.raises(ValueError, match="Invalid image payload"):
        storage._validated_image_payload("abc", max_bytes=5)  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="Empty image payload"):
        storage._validated_image_payload(b"", max_bytes=5)
    with pytest.raises(ValueError, match="Image payload too large"):
        storage._validated_image_payload(b"abcdef", max_bytes=5)

    assert str(storage._validated_relative_media_path("social/thumb")) == "social/thumb"
    with pytest.raises(ValueError, match="Invalid relative path"):
        storage._validated_relative_media_path("/absolute/path")
    with pytest.raises(ValueError, match="Invalid relative path"):
        storage._validated_relative_media_path("../escape")

    assert storage._is_invalid_media_relative_path("") is True
    assert storage._is_invalid_media_relative_path("\\windows\\path") is True
    assert storage._is_invalid_media_relative_path("folder/../file.png") is True
    assert storage._is_invalid_media_relative_path("folder/file.png") is False

    (media_root / "folder").mkdir(parents=True, exist_ok=True)
    valid_file = media_root / "folder" / "file.png"
    valid_file.write_bytes(b"ok")
    assert storage._media_url_to_path("/media/folder/file.png") == valid_file.resolve()

    with pytest.raises(ValueError, match="Invalid media URL"):
        storage._media_url_to_path("/uploads/file.png")
    with pytest.raises(ValueError, match="Invalid media URL"):
        storage._media_url_to_path("/media/../secret.txt")


def test_storage_svg_and_dimension_helpers(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    root = (tmp_path / "root").resolve()
    nested = (root / "nested").resolve()
    nested.mkdir(parents=True, exist_ok=True)
    assert storage._is_path_within_root(nested, root) is True
    assert storage._is_path_within_root(root, nested) is False

    monkeypatch.setattr(storage, "_detect_image_mime", lambda _payload: "image/svg+xml")
    assert storage._validated_image_suffix(b"<svg/>", ("image/svg+xml", "image/png")) == ".svg"

    monkeypatch.setattr(storage, "_detect_image_mime", lambda _payload: None)
    with pytest.raises(ValueError, match="Unsupported image type"):
        storage._validated_image_suffix(b"bad", ("image/png",))

    assert storage._suffix_for_mime("image/svg+xml") == ".svg"
    assert storage._suffix_for_mime("application/pdf") is None
    assert storage._is_over_limit(10, 0) is False
    assert storage._is_over_limit(11, 10) is True

    monkeypatch.setattr(storage.settings, "upload_image_max_width", 100)
    monkeypatch.setattr(storage.settings, "upload_image_max_height", 100)
    monkeypatch.setattr(storage.settings, "upload_image_max_pixels", 10_000)
    storage._validate_raster_dimensions(width=100, height=100)

    monkeypatch.setattr(storage.settings, "upload_image_max_width", 90)
    with pytest.raises(HTTPException, match="Image too large"):
        storage._validate_raster_dimensions(width=91, height=80)

    monkeypatch.setattr(storage.settings, "upload_image_max_width", 0)
    monkeypatch.setattr(storage.settings, "upload_image_max_height", 0)
    monkeypatch.setattr(storage.settings, "upload_image_max_pixels", 50)
    with pytest.raises(HTTPException, match="Image too large"):
        storage._validate_raster_dimensions(width=8, height=7)

    with pytest.raises(HTTPException, match="Unsupported SVG content"):
        storage._validated_svg_bytes(b"<!DOCTYPE svg>")
    with pytest.raises(HTTPException, match="Unsupported SVG content"):
        storage._validated_svg_bytes(b"<!ENTITY bad>")
    with pytest.raises(HTTPException, match="SVG file too large"):
        storage._validated_svg_bytes(b"x" * (storage._SVG_MAX_BYTES + 1))


def test_receipts_helper_branches() -> None:
    assert receipts._order_locale(SimpleNamespace(user=SimpleNamespace(preferred_language="ro"))) == "ro"
    assert receipts._order_locale(SimpleNamespace(user=None, currency="RON", shipping_address=None)) == "ro"
    assert receipts._order_locale(
        SimpleNamespace(user=None, currency="EUR", shipping_address=SimpleNamespace(country="RO"))
    ) == "ro"
    assert receipts._order_locale(
        SimpleNamespace(user=None, currency="EUR", shipping_address=SimpleNamespace(country="DE"))
    ) == "en"

    assert receipts._mask_email("alice@example.com") == "a***@example.com"
    assert receipts._mask_email("invalid") == "••••••"
    assert receipts._mask_text("") == "••••••"
    assert receipts._mask_text("A") == "•"
    assert receipts._mask_text("Alice") == "A••••"

    incomplete_address = SimpleNamespace(line1="Street", city="Bucharest", postal_code="", country="RO")
    assert receipts._build_receipt_address(incomplete_address, redacted=False) is None

    full_address = SimpleNamespace(
        line1="Street 1",
        line2="Apt 2",
        city="Bucharest",
        region="B",
        postal_code="010101",
        country="RO",
    )
    redacted_address = receipts._build_receipt_address(full_address, redacted=True)
    assert redacted_address is not None
    assert redacted_address.line1 == "••••••"
    assert redacted_address.postal_code == "•••••"
    assert redacted_address.line2 is None

    order = SimpleNamespace(
        id=uuid4(),
        reference_code="REF-2026-1",
        status="paid",
        created_at=datetime(2026, 2, 1, 10, 30, tzinfo=timezone.utc),
        currency="RON",
        payment_method="cod",
        courier="sameday",
        delivery_type="locker",
        locker_name="Main Locker",
        locker_address="Street 2",
        tracking_number="AWB123",
        customer_email="alice@example.com",
        customer_name="Alice",
        invoice_company="SC Example SRL",
        invoice_vat_id="RO123",
        shipping_amount=Decimal("10.00"),
        tax_amount=Decimal("5.00"),
        fee_amount=Decimal("0.00"),
        total_amount=Decimal("115.00"),
        shipping_address=full_address,
        billing_address=full_address,
        refunds=[
            SimpleNamespace(
                amount=Decimal("5.00"),
                currency="RON",
                provider="paypal",
                note="partial",
                created_at=datetime(2026, 2, 2, tzinfo=timezone.utc),
            )
        ],
    )
    receipt = receipts.build_order_receipt(order, items=[])
    email, name, company, vat_id = receipts._receipt_customer_invoice_fields(order, redacted=True)
    assert email == "a***@example.com"
    assert name == "A••••"
    assert company is None
    assert vat_id is None

    assert receipts._payment_method_bilingual_label("cod") == "Cash / Numerar"
    assert receipts._payment_method_bilingual_label("custom") == "CUSTOM"
    assert receipts._reportlab_payment_info_line(receipt) == "Payment / Plată: Cash / Numerar"
    assert receipts._reportlab_delivery_info_line(receipt) == "Delivery / Livrare: sameday · locker"
    assert receipts._reportlab_locker_info_line(receipt) == "Locker: Main Locker — Street 2"
    assert receipts._reportlab_tracking_info_line(receipt) == "AWB / Tracking: AWB123"
    assert len(receipts._reportlab_info_lines(receipt)) == 4
    assert receipts._reportlab_payment_info_line(receipt.model_copy(update={"payment_method": None})) is None

    base_style, small_muted, *_ = receipts._reportlab_styles("Helvetica", "Helvetica-Bold")
    totals_without_fee = receipts._reportlab_totals_rows(
        receipt,
        base_style=base_style,
        small_muted=small_muted,
        locale="ro",
    )
    assert len(totals_without_fee) == 3

    totals_with_fee = receipts._reportlab_totals_rows(
        receipt.model_copy(update={"fee_amount": Decimal("2.50")}),
        base_style=base_style,
        small_muted=small_muted,
        locale="en",
    )
    assert len(totals_with_fee) == 4

    redacted_lines = receipts._raster_address_lines(full_address, redacted=True)
    assert redacted_lines[0] == "••••••"
    assert any("•••••" in line for line in redacted_lines)
    assert receipts._raster_customer_values(order, redacted=True) == ("A••••", "a***@example.com")
    assert receipts._raster_invoice_values(order, redacted=True) == ("", "")


def test_receipts_font_and_address_helpers(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    existing = tmp_path / "font.ttf"
    existing.write_bytes(b"font")
    assert receipts._first_existing_path([str(tmp_path / "missing.ttf"), str(existing)]) == str(existing)
    assert receipts._first_existing_path([str(tmp_path / "missing.ttf")]) is None

    lookup = iter([None, "/fonts/bold.ttf"])
    monkeypatch.setattr(receipts, "_first_existing_path", lambda _paths: next(lookup))
    assert receipts._reportlab_font_paths() == ("/fonts/bold.ttf", "/fonts/bold.ttf")

    registered: list[tuple[str, str]] = []
    monkeypatch.setattr(receipts, "TTFont", lambda name, path: (name, path))
    monkeypatch.setattr(receipts.pdfmetrics, "registerFont", lambda font: registered.append(font))
    receipts._register_font_if_missing("MomentSans", "/fonts/main.ttf", set())
    assert registered == [("MomentSans", "/fonts/main.ttf")]
    receipts._register_font_if_missing("MomentSans", "/fonts/main.ttf", {"MomentSans"})
    assert registered == [("MomentSans", "/fonts/main.ttf")]

    monkeypatch.setattr(receipts, "_REPORTLAB_FONTS", None)
    monkeypatch.setattr(receipts, "_reportlab_font_paths", lambda: (None, None))
    assert receipts._register_reportlab_fonts() == ("Helvetica", "Helvetica-Bold")
    monkeypatch.setattr(receipts, "_REPORTLAB_FONTS", ("CachedRegular", "CachedBold"))
    assert receipts._register_reportlab_fonts() == ("CachedRegular", "CachedBold")

    assert receipts._reportlab_address_lines(None) == "—"
    escaped = receipts._reportlab_address_lines(
        SimpleNamespace(
            line1="A&B",
            line2=None,
            postal_code="010101",
            city="B<City>",
            region="",
            country="RO",
        )
    )
    assert "&amp;" in escaped
    assert "&lt;" in escaped


def test_paypal_service_cache_and_payload_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    paypal_service._token_cache.clear()
    now = datetime(2026, 2, 1, tzinfo=timezone.utc)

    monkeypatch.setattr(paypal_service.settings, "paypal_env", "sandbox")
    paypal_service._cache_access_token(access_token="sandbox-token", expires_in=120, now=now)
    assert paypal_service._cached_access_token(now + timedelta(seconds=20)) == "sandbox-token"
    assert paypal_service._cached_access_token(now + timedelta(seconds=95)) is None

    paypal_service._cache_access_token(access_token="fallback-token", expires_in="bad", now=now)
    assert paypal_service._cached_access_token(now + timedelta(seconds=200)) == "fallback-token"

    monkeypatch.setattr(paypal_service.settings, "paypal_env", "live")
    paypal_service._cache_access_token(access_token="live-token", expires_in=120, now=now)
    assert paypal_service._cached_access_token(now + timedelta(seconds=20)) == "live-token"

    monkeypatch.setattr(paypal_service.settings, "paypal_env", "sandbox")
    assert paypal_service._cached_access_token(now + timedelta(seconds=20)) == "fallback-token"

    assert paypal_service._extract_approval_url("not-a-list") is None
    assert paypal_service._extract_approval_url([{"rel": "self", "href": "https://example.com/self"}]) is None
    assert paypal_service._extract_approval_url(
        [{"rel": "approve", "href": "https://paypal.example/approve"}]
    ) == "https://paypal.example/approve"

    assert paypal_service._required_header({"paypal-auth-algo": "SHA256"}, "paypal-auth-algo") == "SHA256"
    with pytest.raises(HTTPException, match="Missing PayPal signature headers"):
        paypal_service._required_header({}, "paypal-auth-algo")

    amount = {"currency_code": "EUR", "value": "10.00"}
    payload = paypal_service._build_order_payload(
        amount=amount,
        reference="REF-1",
        return_url="https://example.com/return",
        cancel_url="https://example.com/cancel",
        converted_items=None,
    )
    purchase_unit = payload["purchase_units"][0]
    assert "items" not in purchase_unit

    payload_with_items = paypal_service._build_order_payload(
        amount=amount,
        reference="REF-1",
        return_url="https://example.com/return",
        cancel_url="https://example.com/cancel",
        converted_items=[{"name": "Ring", "quantity": "1", "unit_amount": amount}],
    )
    assert "items" in payload_with_items["purchase_units"][0]

    breakdown: dict[str, object] = {}
    paypal_service._set_breakdown_amount(
        breakdown=breakdown,
        key="shipping",
        currency="EUR",
        value=Decimal("0.00"),
        allow_zero=False,
    )
    assert breakdown == {}
    paypal_service._set_breakdown_amount(
        breakdown=breakdown,
        key="item_total",
        currency="EUR",
        value=Decimal("0.00"),
        allow_zero=True,
    )
    assert breakdown == {"item_total": {"currency_code": "EUR", "value": "0.00"}}

    assert paypal_service._resolve_item_total(
        item_total_converted=Decimal("1.50"),
        item_total_ron=Decimal("100.00"),
        fx_per_ron=Decimal("0.2"),
    ) == Decimal("1.50")
    assert paypal_service._resolve_item_total(
        item_total_converted=None,
        item_total_ron=Decimal("100.00"),
        fx_per_ron=Decimal("0.2"),
    ) == Decimal("20.00")


def test_paypal_service_env_and_amount_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    paypal_service._token_cache.clear()

    monkeypatch.setattr(paypal_service.settings, "paypal_env", "live")
    monkeypatch.setattr(paypal_service.settings, "paypal_client_id_live", "live-id")
    monkeypatch.setattr(paypal_service.settings, "paypal_client_secret_live", "live-secret")
    monkeypatch.setattr(paypal_service.settings, "paypal_webhook_id_live", "live-webhook")
    monkeypatch.setattr(paypal_service.settings, "paypal_client_id", "fallback-id")
    monkeypatch.setattr(paypal_service.settings, "paypal_client_secret", "fallback-secret")
    monkeypatch.setattr(paypal_service.settings, "paypal_webhook_id", "fallback-webhook")

    assert paypal_service._base_url() == "https://api-m.paypal.com"
    assert paypal_service.is_paypal_configured() is True
    assert paypal_service.is_paypal_webhook_configured() is True

    sandbox_bucket = paypal_service._cache_bucket()
    sandbox_bucket["access_token"] = "sandbox-token"
    monkeypatch.setattr(paypal_service.settings, "paypal_env", "sandbox")
    live_bucket = paypal_service._cache_bucket()
    assert live_bucket is not sandbox_bucket
    assert live_bucket["access_token"] is None

    monkeypatch.setattr(paypal_service.settings, "paypal_client_id_sandbox", "")
    monkeypatch.setattr(paypal_service.settings, "paypal_client_secret_sandbox", "")
    monkeypatch.setattr(paypal_service.settings, "paypal_webhook_id_sandbox", "")
    monkeypatch.setattr(paypal_service.settings, "paypal_client_id", "")
    monkeypatch.setattr(paypal_service.settings, "paypal_client_secret", "")
    monkeypatch.setattr(paypal_service.settings, "paypal_webhook_id", "")
    assert paypal_service._base_url() == "https://api-m.sandbox.paypal.com"
    assert paypal_service.is_paypal_configured() is False
    assert paypal_service.is_paypal_webhook_configured() is False

    assert paypal_service._parse_positive_int(" 3 ") == 3
    assert paypal_service._parse_positive_int("0") is None
    assert paypal_service._parse_positive_int("bad") is None
    assert paypal_service._parse_decimal("12.5") == Decimal("12.5")
    assert paypal_service._parse_decimal("bad") is None
    assert paypal_service._convert_optional_amount(None, Decimal("0.2")) is None

    amount, converted_items = paypal_service._prepare_order_amount(
        currency="EUR",
        fx_per_ron=Decimal("0.2"),
        item_total_ron=Decimal("50.00"),
        shipping_ron=None,
        tax_ron=Decimal("5.00"),
        fee_ron=None,
        discount_ron=Decimal("10.00"),
        items=[{"quantity": "bad", "unit_amount": {"value": "2.00"}}],
    )
    assert converted_items is None
    assert amount["value"] == "9.00"
    assert amount["breakdown"]["item_total"]["value"] == "10.00"
    assert amount["breakdown"]["tax_total"]["value"] == "1.00"
    assert amount["breakdown"]["discount"]["value"] == "2.00"
