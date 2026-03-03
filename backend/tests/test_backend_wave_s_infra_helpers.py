from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app import cli
from app.services import lockers as lockers_service
from app.services import media_dam as media_dam_service
from app.services import netopia as netopia_service
from app.services import payments as payments_service


def _fake_public_key_pem() -> str:
    return "-----BEGIN PUBLIC KEY-----\nFAKE\n-----END PUBLIC KEY-----"


class _FakePublicKey:
    def public_bytes(self, *, encoding, format):
        del encoding, format
        return _fake_public_key_pem().encode("utf-8")


class _FakeCert:
    def public_key(self):
        return _FakePublicKey()


def test_netopia_path_candidates_and_existing_read(tmp_path: Path) -> None:
    absolute = tmp_path / "absolute.pem"
    absolute.write_text("abc", encoding="utf-8")

    absolute_candidates = netopia_service._key_path_candidates(str(absolute))
    assert absolute_candidates == [absolute]

    relative_candidates = netopia_service._key_path_candidates("relative.pem")
    assert relative_candidates[0] == Path("relative.pem")
    assert len(relative_candidates) >= 2

    missing = tmp_path / "missing.pem"
    found = tmp_path / "found.pem"
    found.write_bytes(b"key-bytes")
    assert netopia_service._read_existing_candidate([missing, found]) == b"key-bytes"


def test_netopia_parse_pem_public_material_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(HTTPException):
        netopia_service._parse_pem_public_material(b"-----BEGIN PRIVATE KEY-----\nX")

    monkeypatch.setattr(netopia_service.x509, "load_pem_x509_certificate", lambda _raw: _FakeCert())
    assert "BEGIN PUBLIC KEY" in netopia_service._parse_pem_public_material(b"-----BEGIN CERTIFICATE-----\nX")

    monkeypatch.setattr(
        netopia_service.serialization,
        "load_pem_public_key",
        lambda _raw: _FakePublicKey(),
    )
    assert "BEGIN PUBLIC KEY" in netopia_service._parse_pem_public_material(b"-----BEGIN PUBLIC KEY-----\nX")


def test_netopia_parse_der_and_error_detail(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(netopia_service.x509, "load_der_x509_certificate", lambda _raw: _FakeCert())
    assert "BEGIN PUBLIC KEY" in netopia_service._parse_der_public_material(b"\x30\x82")

    monkeypatch.setattr(netopia_service.x509, "load_der_x509_certificate", lambda _raw: (_ for _ in ()).throw(ValueError("bad cert")))
    monkeypatch.setattr(netopia_service.serialization, "load_der_public_key", lambda _raw: _FakePublicKey())
    assert "BEGIN PUBLIC KEY" in netopia_service._parse_der_public_material(b"\x30\x82")

    class _Resp:
        status_code = 500

        def __init__(self, payload, raise_json: bool = False):
            self._payload = payload
            self._raise = raise_json

        def json(self):
            if self._raise:
                raise ValueError("not json")
            return self._payload

    detail = netopia_service._netopia_error_detail(_Resp({"message": "bad request"}), default="fallback")
    assert detail == "bad request"

    fallback = netopia_service._netopia_error_detail(_Resp({}, raise_json=True), default="fallback")
    assert fallback == "fallback"


def test_payments_line_item_total_coupon_and_stripe_selection(monkeypatch: pytest.MonkeyPatch) -> None:
    line_items = [{"quantity": 2, "price_data": {"unit_amount": 123}}]
    assert payments_service._line_item_total(line_items) == 246

    with pytest.raises(HTTPException):
        payments_service._line_item_total([{"quantity": "two", "price_data": {"unit_amount": 123}}])

    coupon_obj = SimpleNamespace(id="cpn_1")
    assert payments_service._coupon_id_from_object(coupon_obj) == "cpn_1"
    assert payments_service._coupon_id_from_object({"id": "cpn_2"}) == "cpn_2"
    assert payments_service._coupon_id_from_object({}) is None

    monkeypatch.setattr(payments_service.settings, "stripe_env", "live")
    monkeypatch.setattr(payments_service.settings, "stripe_secret_key_live", " live-key ")
    monkeypatch.setattr(payments_service.settings, "stripe_secret_key", "fallback-live")
    assert payments_service._stripe_env() == "live"
    assert payments_service.stripe_secret_key() == "live-key"

    monkeypatch.setattr(payments_service.settings, "stripe_env", "sandbox")
    monkeypatch.setattr(payments_service.settings, "stripe_secret_key_sandbox", "")
    monkeypatch.setattr(payments_service.settings, "stripe_secret_key_test", "test-key")
    assert payments_service._stripe_env() == "sandbox"
    assert payments_service.stripe_secret_key() == "test-key"


def test_lockers_pure_helpers_and_parsers(monkeypatch: pytest.MonkeyPatch) -> None:
    assert lockers_service._round_coord(44.4268) == 44.43
    assert lockers_service._haversine_km(44.4268, 26.1025, 44.4268, 26.1025) == pytest.approx(0.0)

    q_sameday = lockers_service._build_query(lockers_service.LockerProvider.sameday, lat=44.4, lng=26.1, radius_m=5000)
    q_fan = lockers_service._build_query(lockers_service.LockerProvider.fan_courier, lat=44.4, lng=26.1, radius_m=5000)
    assert "easybox" in q_sameday.lower()
    assert "fanbox" in q_fan.lower()

    assert lockers_service._element_coordinates({"lat": 1, "lon": 2}) == (1.0, 2.0)
    assert lockers_service._element_coordinates({"center": {"lat": 3, "lon": 4}}) == (3.0, 4.0)
    assert lockers_service._element_coordinates({}) is None

    valid_row = {"lockerId": "123", "name": "Locker", "lat": "44.4", "lng": "26.1", "address": "Street"}
    parsed = lockers_service._parse_sameday_row(valid_row)
    assert parsed is not None
    assert parsed.id == "sameday:123"
    assert lockers_service._parse_sameday_row({"lockerId": "", "name": "x"}) is None
    assert lockers_service._parse_sameday_row("not-a-dict") is None

    parsed_exp = lockers_service._parse_sameday_expire_at("2026-03-03 12:30")
    assert parsed_exp.tzinfo == timezone.utc
    fallback_exp = lockers_service._parse_sameday_expire_at("invalid")
    assert fallback_exp > datetime.now(timezone.utc)

    monkeypatch.setattr(
        lockers_service,
        "_build_overpass_locker",
        lambda element, **kwargs: None
        if element.get("id") == 2
        else SimpleNamespace(distance_km=float(element.get("id", 0)), name=f"L{element.get('id')}")
    )
    rows = lockers_service._parse_overpass_json({"elements": [{"id": 2}, {"id": 1}]}, provider=lockers_service.LockerProvider.sameday, lat=1, lng=2)
    assert len(rows) == 1


def test_cli_filename_username_and_uniqueness_helpers() -> None:
    with pytest.raises(SystemExit):
        cli._normalize_json_filename("")
    with pytest.raises(SystemExit):
        cli._normalize_json_filename("nested/path.json")
    with pytest.raises(SystemExit):
        cli._normalize_json_filename("bad.txt")

    assert cli._normalize_json_filename("ok-file.json") == "ok-file.json"
    assert cli._sanitize_username("  __--  ") == "user"
    assert cli._sanitize_username("!Ana Maria!").startswith("Ana-Maria")

    used = {"ana"}
    assert cli._make_unique_username("ana", used).startswith("ana-")
    assert "ana" in used


def test_media_dam_resolve_asset_preview_path_variants(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    variant_path = tmp_path / "variant.jpg"
    variant_path.write_bytes(b"x")
    asset_path = tmp_path / "asset.jpg"
    asset_path.write_bytes(b"y")

    asset = SimpleNamespace(
        variants=[SimpleNamespace(profile="thumb", storage_key="variant-key")],
        storage_key="asset-key",
        public_url="/media/asset.jpg",
    )

    monkeypatch.setattr(media_dam_service, "_find_existing_storage_path", lambda _k: variant_path)
    assert media_dam_service.resolve_asset_preview_path(asset, variant_profile="thumb") == variant_path

    with pytest.raises(ValueError):
        media_dam_service.resolve_asset_preview_path(asset, variant_profile="missing")

    monkeypatch.setattr(media_dam_service, "_find_existing_storage_path", lambda _k: None)
    with pytest.raises(FileNotFoundError):
        media_dam_service.resolve_asset_preview_path(asset, variant_profile="thumb")

    monkeypatch.setattr(media_dam_service, "_asset_file_path", lambda _a: asset_path)
    assert media_dam_service.resolve_asset_preview_path(asset) == asset_path

    missing_path = tmp_path / "missing.jpg"
    monkeypatch.setattr(media_dam_service, "_asset_file_path", lambda _a: missing_path)
    with pytest.raises(FileNotFoundError):
        media_dam_service.resolve_asset_preview_path(asset)
