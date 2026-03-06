from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from starlette.requests import Request

from app.api.v1 import auth as auth_api
from app.api.v1 import content as content_api
from app.services import email as email_service


def _make_request(*, headers: dict[str, str] | None = None, cookies: dict[str, str] | None = None) -> Request:
    raw_headers = [
        (key.lower().encode("latin-1"), value.encode("latin-1"))
        for key, value in (headers or {}).items()
    ]
    if cookies:
        cookie_value = "; ".join(f"{key}={value}" for key, value in cookies.items())
        raw_headers.append((b"cookie", cookie_value.encode("latin-1")))
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "GET",
        "scheme": "https",
        "path": "/",
        "query_string": b"",
        "headers": raw_headers,
        "client": ("127.0.0.1", 45123),
    }
    return Request(scope)


def test_email_reply_fallback_bodies_include_optional_lines() -> None:
    text_ro, text_en = email_service._contact_submission_reply_fallback_bodies(
        safe_name="Client",
        reply_message="Mersi pentru mesaj.",
        topic="shipping",
        order_reference="ORD-22",
        reference="REF-44",
        contact_url="/contact",
    )

    assert "Tip: shipping" in text_ro
    assert "Comandă: ORD-22" in text_ro
    assert "Referință: REF-44" in text_ro
    assert "Ajutor: /contact" in text_ro
    assert "Topic: shipping" in text_en
    assert "Order: ORD-22" in text_en
    assert "Reference: REF-44" in text_en
    assert "Help: /contact" in text_en


def test_email_reply_fallback_bodies_without_optional_lines() -> None:
    text_ro, text_en = email_service._contact_submission_reply_fallback_bodies(
        safe_name="Client",
        reply_message="Am primit.",
        topic=None,
        order_reference=None,
        reference=None,
        contact_url=None,
    )

    assert "Tip:" not in text_ro
    assert "Comandă:" not in text_ro
    assert "Referință:" not in text_ro
    assert "Ajutor:" not in text_ro
    assert "Topic:" not in text_en
    assert "Order:" not in text_en
    assert "Reference:" not in text_en
    assert "Help:" not in text_en


def test_email_return_item_rows_and_created_bodies() -> None:
    request_obj = SimpleNamespace(
        items=[
            SimpleNamespace(
                quantity=2,
                order_item=SimpleNamespace(product=SimpleNamespace(name="Ring")),
                order_item_id=uuid4(),
            ),
            SimpleNamespace(quantity=1, order_item=None, order_item_id=uuid4()),
        ]
    )

    rows = email_service._return_request_item_rows(request_obj)
    assert rows[0]["name"] == "Ring"
    assert rows[0]["quantity"] == 2
    assert rows[1]["quantity"] == 1

    text_ro, text_en = email_service._return_request_created_fallback_bodies(
        order_ref="ORD-7",
        customer_name="",
        items=rows,
        reason="Need a different size",
    )
    assert "Client:" not in text_ro
    assert "Customer:" not in text_en
    assert "Need a different size" in text_ro
    assert "Need a different size" in text_en


def test_email_return_status_fallback_bodies_optional_note() -> None:
    text_ro, text_en = email_service._return_request_status_fallback_bodies(
        order_ref="ORD-8",
        customer_name="Alex",
        previous_status="requested",
        next_status="approved",
        admin_note="Processed",
    )
    assert "Client: Alex" in text_ro
    assert "Customer: Alex" in text_en
    assert "Processed" in text_ro
    assert "Processed" in text_en

    text_ro2, text_en2 = email_service._return_request_status_fallback_bodies(
        order_ref="ORD-8",
        customer_name="",
        previous_status="requested",
        next_status="approved",
        admin_note=None,
    )
    assert "Client:" not in text_ro2
    assert "Customer:" not in text_en2


def test_email_admin_summary_lines_with_and_without_rows() -> None:
    top_empty = email_service._admin_summary_top_products_lines(products=None, is_ro=True, currency="RON")
    low_empty = email_service._admin_summary_low_stock_lines(low_stock=None, is_ro=False)
    assert top_empty[0] == "Top produse: —"
    assert low_empty[0] == "Low stock: —"

    top_rows = email_service._admin_summary_top_products_lines(
        products=[
            {"name": "Ring", "slug": "ring", "quantity": 3, "gross_sales": "120"},
            {"name": "", "slug": "bracelet", "quantity": 1, "gross_sales": "50"},
        ],
        is_ro=False,
        currency="RON",
    )
    low_rows = email_service._admin_summary_low_stock_lines(
        low_stock=[{"name": "Ring", "stock_quantity": 1, "threshold": 2, "is_critical": True}],
        is_ro=True,
    )
    assert any("Top products:" in line for line in top_rows)
    assert any("bracelet" in line for line in top_rows)
    assert any("CRITIC" in line for line in low_rows)


def test_email_admin_report_lines_include_missing_refunds(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(email_service.settings, "frontend_origin", "https://shop.example/")
    context = email_service._AdminReportRenderContext(
        kind_label_ro="Săptămânal",
        kind_label_en="Weekly",
        start_label="2026-03-01",
        end_label="2026-03-07",
        gross="120",
        net="90",
        refunds="30",
        missing="7",
        currency="RON",
        orders_success=4,
        orders_total=5,
        orders_refunded=1,
        top_products=[{"name": "Ring", "slug": "ring", "quantity": 3, "gross_sales": "120"}],
        low_stock=[{"name": "Bracelet", "stock_quantity": 1, "threshold": 2, "is_critical": False}],
    )

    lines_ro = email_service._admin_report_lines_for_lang(lang="ro", context=context)
    lines_en = email_service._admin_report_lines_for_lang(lang="en", context=context)
    assert any("Rambursări lipsă" in line for line in lines_ro)
    assert any("Missing refunds" in line for line in lines_en)
    assert lines_ro[-1].endswith("/admin/dashboard")
    assert lines_en[-1].endswith("/admin/dashboard")


def test_email_rate_limit_helpers_prune_allow_record(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(email_service.settings, "email_rate_limit_per_minute", 2)
    monkeypatch.setattr(email_service.settings, "email_rate_limit_per_recipient_per_minute", 1)
    email_service._rate_global[:] = [1.0, 20.0, 80.0]
    email_service._rate_per_recipient.clear()
    email_service._rate_per_recipient["a@example.com"] = [1.0, 90.0]

    email_service._prune(100.0)
    assert email_service._rate_global == [80.0]
    assert email_service._rate_per_recipient["a@example.com"] == [90.0]

    allowed = email_service._allow_send(100.0, "b@example.com")
    assert allowed is True
    email_service._record_send(100.0, "b@example.com")
    assert email_service._rate_per_recipient["b@example.com"] == [100.0]

    blocked = email_service._allow_send(100.0, "b@example.com")
    assert blocked is False


def test_content_redirect_import_collects_rows_and_errors() -> None:
    csv_text = """from,to
# comment,skip
,missing
page.a,page.b
    page.same,page.same
    page.bad,###
"""
    rows, errors = content_api._collect_redirect_import_rows(csv_text)
    assert rows == [(4, "page.a", "page.b"), (6, "page.bad", "###")]
    assert len(errors) == 2
    assert any(err.error == "Missing from/to" for err in errors)
    assert any(err.error == "from and to must differ" for err in errors)


def test_content_redirect_chain_error_raises_combined_message() -> None:
    redirect_map = {"page.a": "page.b", "page.b": "page.a"}
    redirect_map.update({f"k{i}": f"k{i+1}" for i in range(60)})
    redirect_map["k60"] = "page.end"

    with pytest.raises(content_api.HTTPException) as exc:
        content_api._raise_for_redirect_import_chain_errors(redirect_map)

    detail = str(exc.value.detail)
    assert "Redirect loop detected" in detail
    assert "Redirect chain too deep" in detail


def test_auth_google_state_validation_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(auth_api.security, "decode_token", lambda _v: {"type": "link", "uid": "u-1"})
    auth_api._validate_google_state("payload", expected_type="link", expected_user_id="u-1")

    monkeypatch.setattr(auth_api.security, "decode_token", lambda _v: {"type": "other", "uid": "u-1"})
    with pytest.raises(auth_api.HTTPException):
        auth_api._validate_google_state("payload", expected_type="link", expected_user_id="u-1")

    monkeypatch.setattr(auth_api.security, "decode_token", lambda _v: {"type": "link", "uid": "u-2"})
    with pytest.raises(auth_api.HTTPException):
        auth_api._validate_google_state("payload", expected_type="link", expected_user_id="u-1")


def test_auth_extract_refresh_session_jti_prefers_refresh_then_access(monkeypatch: pytest.MonkeyPatch) -> None:
    mapping = {
        "refresh-jti": {"type": "refresh", "jti": "ref-1"},
        "access-jti": {"type": "access", "jti": "acc-1"},
        "wrong": {"type": "access", "jti": "acc-2"},
    }
    monkeypatch.setattr(auth_api.security, "decode_token", lambda token: mapping.get(token))

    request_refresh = _make_request(cookies={"refresh_token": "refresh-jti"})
    assert auth_api._extract_refresh_session_jti(request_refresh) == "ref-1"

    request_access = _make_request(headers={"authorization": "Bearer access-jti"})
    assert auth_api._extract_refresh_session_jti(request_access) == "acc-1"

    request_none = _make_request(cookies={"refresh_token": "wrong"})
    assert auth_api._extract_refresh_session_jti(request_none) is None


def test_auth_refresh_helpers_datetime_branches() -> None:
    now = datetime(2026, 3, 3, 12, 0, tzinfo=timezone.utc)
    naive = datetime(2026, 3, 3, 12, 0)
    aware = auth_api._ensure_utc_datetime(naive)
    assert aware is not None
    assert aware.tzinfo == timezone.utc

    session_obj = SimpleNamespace(
        expires_at=now + timedelta(minutes=10),
        revoked_at=None,
        replaced_by_jti=None,
        revoked_reason=None,
    )
    assert auth_api._active_refresh_session_expiry(session_obj, now=now) == session_obj.expires_at

    session_obj.expires_at = now - timedelta(seconds=1)
    assert auth_api._active_refresh_session_expiry(session_obj, now=now) is None
