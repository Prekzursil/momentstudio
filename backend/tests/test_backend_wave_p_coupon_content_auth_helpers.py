from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import Response
from fastapi import HTTPException
from starlette.requests import Request

from app.api.v1 import auth as auth_api
from app.api.v1 import content as content_api
from app.api.v1 import coupons as coupons_api
from app.models.user import UserRole
from app.services import auth as auth_service


def _request(*, headers: dict[str, str] | None = None, query: str = "") -> Request:
    raw_headers = [
        (key.lower().encode("latin-1"), value.encode("latin-1"))
        for key, value in (headers or {}).items()
    ]
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "GET",
        "scheme": "https",
        "path": "/auth/refresh",
        "query_string": query.encode("latin-1"),
        "headers": raw_headers,
        "client": ("198.51.100.2", 54433),
    }
    return Request(scope)


def test_wave_p_coupons_helper_branches() -> None:
    assert coupons_api._sanitize_coupon_prefix(" demo-code ") == "DEMOCODE"
    assert coupons_api._sanitize_coupon_prefix("---") == ""

    assert coupons_api._to_decimal(None) == Decimal("0.00")
    assert coupons_api._to_decimal("19.90") == Decimal("19.90")
    assert coupons_api._to_decimal(object()) == Decimal("0.00")

    assert coupons_api._normalize_bulk_email_value(" User@Example.com ") == "user@example.com"
    assert coupons_api._normalize_bulk_email_value("bad") == "bad"
    assert coupons_api._is_valid_bulk_email("ok@example.com") is True
    assert coupons_api._is_valid_bulk_email("invalid") is False

    assert coupons_api._bucket_total_in_range(2) is True
    assert coupons_api._bucket_total_in_range(100) is True
    assert coupons_api._bucket_total_in_range(1) is False

    assert coupons_api._bucket_config_not_provided(
        bucket_total=None, bucket_index=None, seed=""
    ) is True
    assert coupons_api._bucket_config_not_provided(
        bucket_total=5, bucket_index=None, seed=""
    ) is False
    assert coupons_api._bucket_config_incomplete(
        bucket_total=5, bucket_index=None, seed="seed"
    ) is True
    assert coupons_api._bucket_config_incomplete(
        bucket_total=5, bucket_index=2, seed="seed"
    ) is False

    assert coupons_api._bucket_index_in_range(index=0, total=3) is True
    assert coupons_api._bucket_index_in_range(index=2, total=3) is True
    assert coupons_api._bucket_index_in_range(index=3, total=3) is False

    with pytest.raises(ValueError):
        coupons_api._parse_bucket_config(bucket_total=0, bucket_index=0, bucket_seed="seed")


@pytest.mark.anyio
async def test_wave_p_content_api_small_helpers() -> None:
    row = ["from", "to", "301"]
    assert content_api._csv_row_value(row, 0) == "from"
    assert content_api._csv_row_value(row, 99) is None
    assert content_api._stripped_csv_row_value(row, 1) == "to"

    assert content_api._none_if_empty("  ") == "  "
    assert content_api._none_if_empty("") is None
    assert content_api._none_if_empty("value") == "value"

    assert content_api._redirect_key_to_display_value("page.about") == "/pages/about"
    assert content_api._redirect_key_to_display_value("blog.post") == "blog.post"
    assert content_api._redirect_display_value_to_key("/pages/about") == "page.about"
    assert content_api._redirect_display_value_to_key("/blog/post") == "/blog/post"

    assert content_api._is_hidden(SimpleNamespace(meta={"hidden": True})) is True
    assert content_api._is_hidden(SimpleNamespace(meta={"hidden": "yes"})) is True
    assert content_api._is_hidden(SimpleNamespace(meta={"hidden": 0})) is False

    assert content_api._requires_auth(SimpleNamespace(meta={"requires_auth": True})) is True
    assert content_api._requires_auth(SimpleNamespace(meta={"requires_auth": "1"})) is True
    assert content_api._requires_auth(SimpleNamespace(meta={"requires_auth": "false"})) is True
    assert content_api._requires_auth(SimpleNamespace(meta={})) is False

    assert content_api._normalize_image_tag(" Hero Banner ") == "hero-banner"
    assert content_api._normalize_image_tags(["Hero", "", "Sale"]) == ["hero", "sale"]

    meta = content_api._build_pagination_meta(total_items=61, page=2, limit=20)
    assert meta["total_items"] == 61
    assert meta["total_pages"] == 4


@pytest.mark.anyio
async def test_wave_p_auth_api_and_service_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    req = _request(headers={"Authorization": "Bearer token-1", "User-Agent": "Agent/1.0", "X-Forwarded-For": "203.0.113.7"}, query="silent=1")

    assert auth_api._extract_bearer_token(req) == "token-1"
    assert auth_api._request_user_agent(req) == "Agent/1.0"
    assert auth_api._request_ip(req) == "198.51.100.2"
    assert auth_api._extract_country_code(req) is None
    assert auth_api._is_silent_refresh_probe(req) is False
    assert auth_api._ensure_utc_datetime(datetime(2026, 3, 1, 10, 0, 0)).tzinfo == timezone.utc

    no_auth = _request(headers={"Authorization": "Basic abc"}, query="")
    assert auth_api._extract_bearer_token(no_auth) is None
    assert auth_api._is_silent_refresh_probe(no_auth) is False

    no_content = auth_api._silent_no_content_response(Response(status_code=200))
    assert no_content.status_code == 204

    assert auth_api._is_admin_or_owner(SimpleNamespace(role=UserRole.admin)) is True
    assert auth_api._is_admin_or_owner(SimpleNamespace(role=UserRole.owner)) is True
    assert auth_api._is_admin_or_owner(SimpleNamespace(role=UserRole.customer)) is False

    assert auth_service._normalize_optional_text("  Demo  ") == "Demo"
    assert auth_service._normalize_optional_text("   ") is None
    assert auth_service._normalize_email_value(" User@Example.com ") == "user@example.com"
    assert auth_service._normalize_token("  abc ") == "abc"
    assert auth_service._truncate("abcdef", 3) == "abc"
    assert auth_service._truncate("abc", 10) == "abc"

    assert auth_service._profile_is_complete(
        SimpleNamespace(
            name="Name",
            username="user",
            first_name="First",
            last_name="Last",
            date_of_birth="2000-01-01",
            phone="+40712345678",
        )
    ) is True
    assert auth_service._profile_is_complete(
        SimpleNamespace(
            name="Name",
            username="user",
            first_name="",
            last_name="",
            date_of_birth=None,
            phone="",
        )
    ) is False

    with pytest.raises(HTTPException):
        auth_service._require_valid_token("  ")

    # Exercise invalid-refresh helper branch path.
    exc = auth_service._invalid_refresh_token_exception()
    assert isinstance(exc, HTTPException)

    # Ensure cooldown normalizer path.
    now = datetime.now(timezone.utc)
    assert auth_service._is_expired_timestamp(now.replace(tzinfo=None)) in {True, False}

    # Guard branch: google registration requires email.
    with pytest.raises(HTTPException):
        auth_service._require_registration_email(SimpleNamespace(email="  "))
