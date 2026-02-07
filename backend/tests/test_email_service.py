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


def test_send_email_smoke(monkeypatch):
    class DummySMTP:
        def __init__(self, host, port, timeout=10):
            self.host = host
            self.port = port
            self.timeout = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def starttls(self):
            return None

        def login(self, username, password):
            return None

        def send_message(self, msg):
            return {}

    async def _noop(*args, **kwargs):
        return None

    monkeypatch.setattr(email_service.settings, "smtp_enabled", True)
    monkeypatch.setattr(email_service.settings, "smtp_host", "smtp.test")
    monkeypatch.setattr(email_service.settings, "smtp_port", 25)
    monkeypatch.setattr(email_service.settings, "smtp_use_tls", False)
    monkeypatch.setattr(email_service.settings, "smtp_username", None)
    monkeypatch.setattr(email_service.settings, "smtp_password", None)
    monkeypatch.setattr(email_service.settings, "smtp_from_email", "no-reply@example.com")
    monkeypatch.setattr(email_service, "_record_email_event", _noop)
    monkeypatch.setattr(email_service, "_record_email_failure", _noop)
    monkeypatch.setattr(email_service.smtplib, "SMTP", DummySMTP)
    email_service._rate_global.clear()
    email_service._rate_per_recipient.clear()

    ok = asyncio.run(
        email_service.send_email("a@example.com", "Subject", "Text", "<p>HTML</p>")
    )
    assert ok is True
