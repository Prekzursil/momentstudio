import pytest

from app.core.config import settings
from app.core.startup_checks import validate_production_settings


def _set_valid_production_baseline(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "secret_key", "x" * 48)
    monkeypatch.setattr(settings, "maintenance_bypass_token", "maintenance-token")
    monkeypatch.setattr(settings, "content_preview_token", "content-preview-token")
    monkeypatch.setattr(settings, "payments_provider", "real")
    monkeypatch.setattr(settings, "secure_cookies", True)
    monkeypatch.setattr(settings, "cookie_samesite", "lax")
    monkeypatch.setattr(settings, "frontend_origin", "https://momentstudio.ro")
    monkeypatch.setattr(settings, "smtp_enabled", False)
    monkeypatch.setattr(settings, "captcha_enabled", False)
    monkeypatch.setattr(settings, "netopia_enabled", False)
    monkeypatch.setattr(settings, "stripe_env", "sandbox")


def test_validate_production_settings_requires_sentry_dsn(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_valid_production_baseline(monkeypatch)
    monkeypatch.setattr(settings, "sentry_dsn", "")

    with pytest.raises(RuntimeError) as exc:
        validate_production_settings()

    assert "SENTRY_DSN must be configured in production." in str(exc.value)


def test_validate_production_settings_accepts_sentry_dsn(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_valid_production_baseline(monkeypatch)
    monkeypatch.setattr(settings, "sentry_dsn", "https://examplePublicKey@o0.ingest.sentry.io/0")

    validate_production_settings()


def test_validate_non_production_does_not_require_sentry_dsn(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "environment", "local")
    monkeypatch.setattr(settings, "sentry_dsn", "")

    validate_production_settings()
