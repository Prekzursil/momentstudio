from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse
from uuid import uuid4

import pytest

from app.models.catalog import ProductStatus
from app.models.content import ContentStatus
from app.services import catalog as catalog_service
from app.services import content as content_service
from app.services import email as email_service


class _RowsResult:
    def __init__(self, rows: list[tuple[object, object, object]]) -> None:
        self._rows = list(rows)

    def all(self) -> list[tuple[object, object, object]]:
        return list(self._rows)


class _CatalogSession:
    def __init__(self, rows: list[tuple[object, object, object]]) -> None:
        self._rows = list(rows)

    async def execute(self, _statement: object) -> _RowsResult:
        return _RowsResult(self._rows)


@pytest.mark.anyio
async def test_catalog_bulk_helper_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    category_a = uuid4()
    category_b = uuid4()
    category_c = uuid4()
    session = _CatalogSession(
        rows=[
            (category_a, 5, 2),
            (None, 99, 3),  # ignored branch when category id is missing
        ]
    )
    category_meta = await catalog_service._build_bulk_category_sort_meta(
        session,
        {category_a, category_b, category_c},
    )
    assert category_meta[category_a] == {"max": 5, "has_custom": True}
    assert category_meta[category_b] == {"max": 0, "has_custom": False}
    assert category_meta[category_c] == {"max": 0, "has_custom": False}

    product = SimpleNamespace(id=uuid4(), category_id=category_a, sort_order=9, stock_quantity=4)

    # Early-return branch when sort_order is already provided in payload.
    catalog_service._apply_bulk_sort_order_on_category_change(
        product,
        data={"category_id": category_b, "sort_order": 3},
        before_category_id=category_a,
        category_sort_meta=category_meta,
    )
    assert product.sort_order == 9

    # Category changed into a bucket with custom sort orders.
    product.category_id = category_a
    product.sort_order = 0
    catalog_service._apply_bulk_sort_order_on_category_change(
        product,
        data={"category_id": category_a},
        before_category_id=category_b,
        category_sort_meta=category_meta,
    )
    assert product.sort_order == 6
    assert category_meta[category_a]["max"] == 6

    # Category changed into a bucket without custom sort orders.
    product.category_id = category_c
    product.sort_order = 42
    catalog_service._apply_bulk_sort_order_on_category_change(
        product,
        data={"category_id": category_c},
        before_category_id=category_a,
        category_sort_meta=category_meta,
    )
    assert product.sort_order == 0

    queued_adjustments: list[dict[str, object]] = []

    def _record_adjustment(_session: object, **kwargs: object) -> None:
        queued_adjustments.append(kwargs)

    monkeypatch.setattr(catalog_service, "_queue_stock_adjustment", _record_adjustment)

    catalog_service._queue_bulk_stock_adjustment_if_changed(
        SimpleNamespace(),
        product=product,
        data={},
        before_stock_quantity=4,
        user_id=None,
    )
    product.stock_quantity = 4
    catalog_service._queue_bulk_stock_adjustment_if_changed(
        SimpleNamespace(),
        product=product,
        data={"stock_quantity": 4},
        before_stock_quantity=4,
        user_id=uuid4(),
    )
    assert queued_adjustments == []

    actor_id = uuid4()
    product.stock_quantity = 2
    catalog_service._queue_bulk_stock_adjustment_if_changed(
        SimpleNamespace(),
        product=product,
        data={"stock_quantity": 2},
        before_stock_quantity=4,
        user_id=actor_id,
    )
    assert len(queued_adjustments) == 1
    adjustment = queued_adjustments[0]
    assert adjustment["product_id"] == product.id
    assert adjustment["before_quantity"] == 4
    assert adjustment["after_quantity"] == 2
    assert adjustment["user_id"] == actor_id
    assert adjustment["reason"] == catalog_service.StockAdjustmentReason.manual_correction


def test_content_helper_branches_media_and_single_issue_dispatch(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    monkeypatch.setattr(content_service.settings, "media_root", str(tmp_path))

    media_file = tmp_path / "asset.png"
    media_file.write_bytes(b"png")
    assert content_service._media_url_exists("/media/asset.png") is True
    assert content_service._media_url_exists("media/asset.png") is True
    assert content_service._media_url_exists("/media/../outside.png") is False
    assert content_service._media_url_exists("/products/sample") is True

    assert content_service._resolve_content_link_key("/pages/") == ""
    assert content_service._resolve_content_link_key("/blog/new-post") == "blog.new-post"
    assert content_service._resolve_content_link_key("/account/profile") is None

    issues = []
    common_kwargs = {
        "issues": issues,
        "content_key": "page.home",
        "products_by_slug": {"private-product": (ProductStatus.draft, False)},
        "existing_categories": set(),
        "resolved_keys": {"page.loop": ("page.loop", "Redirect loop")},
        "blocks_by_key": {"page.published": (ContentStatus.published, None, None)},
        "is_public": lambda *_args: True,
    }

    content_service._build_single_link_issue(
        ref=("link", "markdown", "body_markdown", "https://example.com/products/private-product"),
        **common_kwargs,
    )
    content_service._build_single_link_issue(
        ref=("link", "markdown", "body_markdown", "/products/private-product"),
        **common_kwargs,
    )
    content_service._build_single_link_issue(
        ref=("link", "markdown", "body_markdown", "/shop/missing-category"),
        **common_kwargs,
    )
    content_service._build_single_link_issue(
        ref=("link", "markdown", "body_markdown", "/pages/loop"),
        **common_kwargs,
    )
    content_service._build_single_link_issue(
        ref=("link", "markdown", "body_markdown", "/pages/"),
        **common_kwargs,
    )

    reasons = [issue.reason for issue in issues]
    assert reasons.count("Product is not publicly visible") == 1
    assert reasons.count("Category not found") == 1
    assert reasons.count("Redirect loop") == 1
    assert len(issues) == 3


def test_email_next_path_and_context_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    assert email_service._sanitize_next_path(None) is None
    assert email_service._sanitize_next_path("   ") is None
    assert email_service._sanitize_next_path("//evil.example/path") is None
    assert email_service._sanitize_next_path("https://evil.example/path") is None
    assert email_service._sanitize_next_path("/account/orders") == "/account/orders"

    monkeypatch.setattr(email_service.settings, "frontend_origin", "https://shop.example/")

    context = email_service._admin_login_alert_context(
        admin_username="owner@example.com",
        admin_display_name="  ",
        admin_role=None,
        ip_address="198.51.100.10",
        country_code="RO",
        user_agent="",
        occurred_at=datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc),
    )
    assert context["admin_name"] == "owner@example.com"
    assert context["role_value"] == "admin"
    assert context["location"] == "198.51.100.10 (RO)"
    assert context["user_agent"] == "unknown"
    assert context["dashboard_url"] == "https://shop.example/admin"

    lines = email_service._cancel_request_lines(
        lang="en",
        order=SimpleNamespace(payment_method="stripe"),
        ref="ORD-7",
        requested_by=None,
        reason=None,
        status_value="pending_review",
        admin_url="https://shop.example/admin/orders",
    )
    assert "Payment: Stripe" in lines
    assert "Status: pending_review" in lines
    assert not any(line.startswith("Requested by: ") for line in lines)
    assert not any(line.startswith("Reason: ") for line in lines)


@pytest.mark.anyio
async def test_email_send_verification_email_query_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(email_service.settings, "frontend_origin", "https://shop.test/")
    sent_payloads: list[dict[str, str]] = []

    async def _fake_send_email(
        to_email: str,
        subject: str,
        text_body: str,
        html_body: str,
        headers: dict[str, str] | None = None,
        attachments: list[dict[str, object]] | None = None,
    ) -> bool:
        sent_payloads.append(
            {
                "to_email": to_email,
                "subject": subject,
                "text_body": text_body,
                "html_body": html_body,
                "headers_count": str(len(headers or {})),
                "attachments_count": str(len(attachments or [])),
            }
        )
        return True

    monkeypatch.setattr(email_service, "send_email", _fake_send_email)

    assert (
        await email_service.send_verification_email(
            "guest@example.com",
            "tok-guest",
            lang="en",
            kind="guest",
            next_path="https://evil.example/checkout",
        )
        is True
    )
    assert (
        await email_service.send_verification_email(
            "user@example.com",
            "tok-user",
            lang="ro",
            kind=" primary ",
            next_path="/account/orders",
        )
        is True
    )
    assert len(sent_payloads) == 2

    guest_url = next(
        part for part in sent_payloads[0]["text_body"].split() if part.startswith("https://shop.test/verify-email?")
    )
    guest_query = parse_qs(urlparse(guest_url).query)
    assert guest_query["token"] == ["tok-guest"]
    assert guest_query["kind"] == ["guest"]
    assert guest_query["email"] == ["guest@example.com"]
    assert guest_query["next"] == ["/checkout"]

    primary_url = next(
        part for part in sent_payloads[1]["text_body"].split() if part.startswith("https://shop.test/verify-email?")
    )
    primary_query = parse_qs(urlparse(primary_url).query)
    assert primary_query["token"] == ["tok-user"]
    assert primary_query["next"] == ["/account/orders"]
    assert "kind" not in primary_query
    assert "email" not in primary_query
