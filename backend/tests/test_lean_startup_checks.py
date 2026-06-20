"""Lean-gate unit coverage for ``app.core.startup_checks``.

Covers the non-production short-circuit, the all-defaults-insecure production
case (every problem appended -> RuntimeError), and a fully-hardened production
configuration that passes every check (all problem branches take the safe
path), plus the helper guards.
"""

from __future__ import annotations

import pytest

from app.core import startup_checks
from app.core.config import settings
from app.core.startup_checks import (
    _is_production,
    _looks_like_localhost,
    validate_production_settings,
)


def test_is_production_and_localhost_helpers(monkeypatch) -> None:
    monkeypatch.setattr(settings, "environment", "production", raising=False)
    assert _is_production() is True
    monkeypatch.setattr(settings, "environment", "local", raising=False)
    assert _is_production() is False

    assert _looks_like_localhost("") is False
    assert _looks_like_localhost("http://localhost:3000") is True
    assert _looks_like_localhost("http://127.0.0.1") is True
    assert _looks_like_localhost("https://example.com") is False


def test_validate_skips_when_not_production(monkeypatch) -> None:
    monkeypatch.setattr(settings, "environment", "local", raising=False)
    # Should return without raising regardless of insecure values.
    validate_production_settings()


def _harden(monkeypatch) -> None:
    monkeypatch.setattr(settings, "environment", "production", raising=False)
    monkeypatch.setattr(settings, "secret_key", "x" * 40, raising=False)
    monkeypatch.setattr(
        settings, "maintenance_bypass_token", "strong-maint-token", raising=False
    )
    monkeypatch.setattr(
        settings, "content_preview_token", "strong-preview-token", raising=False
    )
    monkeypatch.setattr(settings, "payments_provider", "stripe", raising=False)
    monkeypatch.setattr(settings, "secure_cookies", True, raising=False)
    monkeypatch.setattr(settings, "sentry_dsn", "https://x@s.io/1", raising=False)
    monkeypatch.setattr(settings, "cookie_samesite", "lax", raising=False)
    monkeypatch.setattr(
        settings, "frontend_origin", "https://shop.example.com", raising=False
    )
    monkeypatch.setattr(settings, "smtp_enabled", False, raising=False)
    monkeypatch.setattr(settings, "captcha_enabled", False, raising=False)
    monkeypatch.setattr(settings, "netopia_enabled", False, raising=False)
    monkeypatch.setattr(settings, "stripe_env", "test", raising=False)


def test_validate_passes_for_hardened_production(monkeypatch) -> None:
    _harden(monkeypatch)
    # Every check passes -> no exception.
    validate_production_settings()


def test_validate_passes_with_optional_integrations_enabled(monkeypatch) -> None:
    _harden(monkeypatch)
    # Exercise the "enabled and configured" safe branches.
    monkeypatch.setattr(settings, "smtp_enabled", True, raising=False)
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.com", raising=False)
    monkeypatch.setattr(settings, "smtp_from_email", "no-reply@x.com", raising=False)
    monkeypatch.setattr(settings, "captcha_enabled", True, raising=False)
    monkeypatch.setattr(settings, "captcha_provider", "turnstile", raising=False)
    monkeypatch.setattr(settings, "turnstile_secret_key", "secret", raising=False)
    monkeypatch.setattr(settings, "netopia_enabled", True, raising=False)
    monkeypatch.setattr(startup_checks.settings, "stripe_env", "live", raising=False)

    # Netopia reports configured; stripe live key is not a test key.
    from app.services import netopia as netopia_service
    from app.services import payments as stripe_payments

    monkeypatch.setattr(
        netopia_service,
        "netopia_configuration_status",
        lambda: (True, None),
        raising=False,
    )
    monkeypatch.setattr(
        stripe_payments, "stripe_secret_key", lambda: "sk_live_realkey", raising=False
    )

    validate_production_settings()


def test_validate_collects_all_problems(monkeypatch) -> None:
    monkeypatch.setattr(settings, "environment", "production", raising=False)
    monkeypatch.setattr(settings, "secret_key", "dev-secret-key", raising=False)
    monkeypatch.setattr(settings, "maintenance_bypass_token", "", raising=False)
    monkeypatch.setattr(settings, "content_preview_token", "", raising=False)
    monkeypatch.setattr(settings, "payments_provider", "mock", raising=False)
    monkeypatch.setattr(settings, "secure_cookies", False, raising=False)
    monkeypatch.setattr(settings, "sentry_dsn", "", raising=False)
    monkeypatch.setattr(settings, "cookie_samesite", "none", raising=False)
    monkeypatch.setattr(settings, "frontend_origin", "http://localhost", raising=False)
    monkeypatch.setattr(settings, "smtp_enabled", True, raising=False)
    monkeypatch.setattr(settings, "smtp_host", "", raising=False)
    monkeypatch.setattr(settings, "smtp_from_email", "", raising=False)
    monkeypatch.setattr(settings, "captcha_enabled", True, raising=False)
    monkeypatch.setattr(settings, "captcha_provider", "turnstile", raising=False)
    monkeypatch.setattr(settings, "turnstile_secret_key", "", raising=False)
    monkeypatch.setattr(settings, "netopia_enabled", True, raising=False)
    monkeypatch.setattr(settings, "stripe_env", "live", raising=False)

    from app.services import netopia as netopia_service
    from app.services import payments as stripe_payments

    monkeypatch.setattr(
        netopia_service,
        "netopia_configuration_status",
        lambda: (False, "Netopia not configured"),
        raising=False,
    )
    monkeypatch.setattr(
        stripe_payments, "stripe_secret_key", lambda: "sk_test_xxx", raising=False
    )

    with pytest.raises(RuntimeError) as exc:
        validate_production_settings()
    msg = str(exc.value)
    assert "SECRET_KEY" in msg
    assert "Netopia not configured" in msg
    assert "sk_test" in msg


def test_validate_rejects_invalid_cookie_samesite(monkeypatch) -> None:
    _harden(monkeypatch)
    monkeypatch.setattr(settings, "cookie_samesite", "bogus", raising=False)
    with pytest.raises(RuntimeError) as exc:
        validate_production_settings()
    assert "COOKIE_SAMESITE must be one of" in str(exc.value)


def test_validate_handles_integration_exceptions(monkeypatch) -> None:
    _harden(monkeypatch)
    monkeypatch.setattr(settings, "netopia_enabled", True, raising=False)
    monkeypatch.setattr(settings, "stripe_env", "live", raising=False)

    from app.services import netopia as netopia_service
    from app.services import payments as stripe_payments

    def _boom(*_a, **_k):
        raise RuntimeError("nope")

    monkeypatch.setattr(
        netopia_service, "netopia_configuration_status", _boom, raising=False
    )
    monkeypatch.setattr(stripe_payments, "stripe_secret_key", _boom, raising=False)

    # Netopia exception appends a problem -> RuntimeError; Stripe exception is
    # swallowed silently.
    with pytest.raises(RuntimeError) as exc:
        validate_production_settings()
    assert "Netopia is enabled but configuration could not be validated" in str(
        exc.value
    )
