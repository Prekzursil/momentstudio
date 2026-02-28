from __future__ import annotations

import logging

from app.core.config import settings

logger = logging.getLogger(__name__)


def _is_production() -> bool:
    env = (settings.environment or "").strip().lower()
    return env in {"prod", "production"}


def _looks_like_localhost(url: str | None) -> bool:
    value = (url or "").strip().lower()
    if not value:
        return False
    return "localhost" in value or "127.0.0.1" in value


def _append_if(problems: list[str], *, condition: bool, message: str) -> None:
    if condition:
        problems.append(message)


def _validate_core_production_settings(problems: list[str]) -> None:
    secret = (settings.secret_key or "").strip()
    _append_if(
        problems,
        condition=secret in {"", "dev-secret-key"} or len(secret) < 32,
        message="SECRET_KEY must be set to a strong random value (not the dev default).",
    )
    _append_if(
        problems,
        condition=(settings.maintenance_bypass_token or "").strip() in {"", "bypass-token"},
        message="MAINTENANCE_BYPASS_TOKEN must be changed from the default.",
    )
    _append_if(
        problems,
        condition=(settings.content_preview_token or "").strip() in {"", "preview-token"},
        message="CONTENT_PREVIEW_TOKEN must be changed from the default.",
    )
    _append_if(
        problems,
        condition=(settings.payments_provider or "").strip().lower() == "mock",
        message="PAYMENTS_PROVIDER must not be 'mock' in production.",
    )
    _append_if(
        problems,
        condition=not bool(settings.secure_cookies),
        message="SECURE_COOKIES must be enabled in production.",
    )
    _append_if(
        problems,
        condition=not (settings.sentry_dsn or "").strip(),
        message="SENTRY_DSN must be configured in production.",
    )


def _validate_cookie_settings(problems: list[str]) -> None:
    samesite = (settings.cookie_samesite or "").strip().lower()
    _append_if(
        problems,
        condition=samesite not in {"lax", "strict", "none"},
        message="COOKIE_SAMESITE must be one of: lax | strict | none.",
    )
    _append_if(
        problems,
        condition=samesite == "none" and not bool(settings.secure_cookies),
        message="COOKIE_SAMESITE=none requires SECURE_COOKIES=1.",
    )
    _append_if(
        problems,
        condition=_looks_like_localhost(settings.frontend_origin),
        message="FRONTEND_ORIGIN must be set to the public site origin (not localhost) in production.",
    )


def _validate_smtp_settings(problems: list[str]) -> None:
    smtp_enabled = bool(getattr(settings, "smtp_enabled", False))
    _append_if(
        problems,
        condition=smtp_enabled and not (getattr(settings, "smtp_host", "") or "").strip(),
        message="SMTP_HOST must be set when SMTP_ENABLED=1.",
    )
    _append_if(
        problems,
        condition=smtp_enabled and not (getattr(settings, "smtp_from_email", "") or "").strip(),
        message="SMTP_FROM_EMAIL must be set when SMTP_ENABLED=1.",
    )


def _validate_turnstile_settings(problems: list[str]) -> None:
    turnstile_enabled = bool(getattr(settings, "captcha_enabled", False))
    turnstile_provider = (settings.captcha_provider or "").strip().lower() == "turnstile"
    _append_if(
        problems,
        condition=turnstile_enabled and turnstile_provider and not (getattr(settings, "turnstile_secret_key", "") or "").strip(),
        message="TURNSTILE_SECRET_KEY must be set when CAPTCHA_ENABLED=1.",
    )


def _validate_email_and_captcha_settings(problems: list[str]) -> None:
    _validate_smtp_settings(problems)
    _validate_turnstile_settings(problems)


def _validate_netopia_settings(problems: list[str]) -> None:
    if not bool(getattr(settings, "netopia_enabled", False)):
        return
    try:
        from app.services import netopia as netopia_service

        configured, reason = netopia_service.netopia_configuration_status()
        if not configured:
            problems.append(reason or "Netopia is enabled but not configured.")
    except Exception:
        problems.append("Netopia is enabled but configuration could not be validated.")


def _validate_stripe_live_key(problems: list[str]) -> None:
    try:
        from app.services import payments as stripe_payments

        stripe_env = (getattr(settings, "stripe_env", "") or "").strip().lower()
        if stripe_env not in {"live", "prod", "production"}:
            return
        key = (stripe_payments.stripe_secret_key() or "").strip()
        if key.startswith("sk_test"):
            problems.append("STRIPE_ENV=live but STRIPE secret key looks like a test key (sk_test...).")
    except Exception:
        # Never crash production checks due to optional Stripe library issues; missing Stripe config is handled elsewhere.
        logger.debug(
            "Skipping Stripe live-key validation because Stripe dependencies/config could not be loaded.",
            exc_info=True,
        )


def validate_production_settings() -> None:
    """
    Fail fast on insecure defaults when running in production.

    This prevents accidentally deploying with development secrets or insecure cookie settings.
    """
    if not _is_production():
        return

    problems: list[str] = []
    _validate_core_production_settings(problems)
    _validate_cookie_settings(problems)
    _validate_email_and_captcha_settings(problems)
    _validate_netopia_settings(problems)
    _validate_stripe_live_key(problems)

    if problems:
        raise RuntimeError("Production configuration checks failed:\n- " + "\n- ".join(problems))
