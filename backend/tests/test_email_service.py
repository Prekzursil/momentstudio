import asyncio
import time

from app.services import email as email_service


def test_email_rate_limit(monkeypatch):
    monkeypatch.setattr(email_service.settings, "email_rate_limit_per_minute", 1)
    monkeypatch.setattr(email_service.settings, "email_rate_limit_per_recipient_per_minute", 1)
    email_service._rate_global.clear()
    email_service._rate_per_recipient.clear()
    now = time.time()
    assert email_service._allow_send(now, "a@example.com") is True
    email_service._record_send(now, "a@example.com")
    assert email_service._allow_send(now, "a@example.com") is False


def test_email_preview():
    preview = asyncio.run(email_service.preview_email("cart_abandonment.txt.j2", {}))
    assert "text" in preview and "html" in preview
