from __future__ import annotations

import pytest

from app.services import email as email_service


def test_jinja2_is_available() -> None:
    assert email_service.env is not None, "jinja2 must be installed so email templates render deterministically"


@pytest.mark.parametrize(
    ("template", "context", "expected"),
    [
        ("back_in_stock.txt.j2", {"product_name": "Test Product"}, ["Test Product"]),
        ("low_stock_alert.txt.j2", {"product_name": "Test Product", "stock": 2}, ["Test Product", "2"]),
        (
            "cart_abandonment.txt.j2",
            {"cart_url": "https://example.com/cart", "unsubscribe_url": "https://example.com/unsub"},
            ["https://example.com/cart", "https://example.com/unsub"],
        ),
        (
            "blog_comment_admin.txt.j2",
            {
                "post_title": "Hello",
                "commenter_name": "Alice",
                "comment_body": "Nice post!",
                "post_url": "https://example.com/blog/hello",
            },
            ["Hello", "Alice", "https://example.com/blog/hello"],
        ),
        (
            "blog_comment_reply.txt.j2",
            {
                "post_title": "Hello",
                "replier_name": "Bob",
                "comment_body": "Thanks!",
                "post_url": "https://example.com/blog/hello",
            },
            ["Hello", "Bob", "https://example.com/blog/hello"],
        ),
        (
            "blog_comment_subscriber.txt.j2",
            {
                "post_title": "Hello",
                "commenter_name": "Alice",
                "comment_body": "Nice post!",
                "post_url": "https://example.com/blog/hello",
            },
            ["Hello", "Alice", "https://example.com/blog/hello"],
        ),
        (
            "contact_submission_admin.txt.j2",
            {
                "topic": "Support",
                "from_name": "Alice",
                "from_email": "alice@example.com",
                "order_reference": "MS-123",
                "message": "Help me",
                "admin_url": "https://example.com/admin",
            },
            ["alice@example.com", "MS-123", "https://example.com/admin"],
        ),
        (
            "contact_submission_reply.txt.j2",
            {
                "customer_name": "Alice",
                "topic": "Support",
                "order_reference": "MS-123",
                "reference": "REF-1",
                "reply_message": "Sure",
                "contact_url": "https://example.com/contact",
            },
            ["Alice", "MS-123", "REF-1", "https://example.com/contact"],
        ),
        (
            "coupon_assigned.txt.j2",
            {
                "coupon_code": "PROMO10",
                "promotion_name": "Promo",
                "promotion_description": "10% off",
                "ends_at": "2026-01-01",
                "account_url": "https://example.com/account",
            },
            ["PROMO10", "Promo", "https://example.com/account"],
        ),
        (
            "coupon_revoked.txt.j2",
            {"coupon_code": "PROMO10", "promotion_name": "Promo", "reason": "Expired"},
            ["PROMO10", "Promo", "Expired"],
        ),
        (
            "return_request_created.txt.j2",
            {
                "order_reference": "MS-123",
                "customer_name": "Alice",
                "items": [{"name": "Test Product", "quantity": 1}],
                "reason": "Damaged",
                "customer_message": "Box was crushed",
                "account_url": "https://example.com/account",
            },
            ["MS-123", "Test Product", "https://example.com/account"],
        ),
        (
            "return_request_status_update.txt.j2",
            {
                "order_reference": "MS-123",
                "customer_name": "Alice",
                "previous_status": "created",
                "status": "approved",
                "admin_note": "OK",
                "account_url": "https://example.com/account",
            },
            ["MS-123", "created", "approved", "https://example.com/account"],
        ),
    ],
)
def test_email_template_renders(template: str, context: dict, expected: list[str]) -> None:
    text_body, html_body = email_service.render_bilingual_template(
        template, context, preferred_language="en"
    )
    assert text_body.strip()
    assert html_body.strip()
    assert "English" in text_body and "Română" in text_body
    for needle in expected:
        assert needle in text_body or needle in html_body

