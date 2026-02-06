from app.core.config import settings
from app.services import email as email_service


def test_marketing_unsubscribe_headers_include_http_url(monkeypatch) -> None:
    monkeypatch.setattr(settings, "frontend_origin", "https://example.com")
    monkeypatch.setattr(settings, "list_unsubscribe_mailto", None)

    _, headers = email_service._marketing_unsubscribe_context(to_email="user@example.com")

    assert headers["List-Unsubscribe"].startswith("<https://example.com/api/v1/newsletter/unsubscribe?token=")
    assert headers["List-Unsubscribe"].endswith(">")
    assert headers["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"


def test_marketing_unsubscribe_headers_include_optional_mailto(monkeypatch) -> None:
    monkeypatch.setattr(settings, "frontend_origin", "https://example.com")
    monkeypatch.setattr(settings, "list_unsubscribe_mailto", "unsubscribe@example.com")

    _, headers = email_service._marketing_unsubscribe_context(to_email="user@example.com")

    assert "<mailto:unsubscribe@example.com>" in headers["List-Unsubscribe"]
    assert headers["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
