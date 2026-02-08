from __future__ import annotations

from app.core.config import settings


def _is_production() -> bool:
    env = (settings.environment or "").strip().lower()
    return env in {"prod", "production"}


def _looks_like_localhost(url: str | None) -> bool:
    value = (url or "").strip().lower()
    if not value:
        return False
    return "localhost" in value or "127.0.0.1" in value


def validate_production_settings() -> None:
    """
    Fail fast on insecure defaults when running in production.

    This prevents accidentally deploying with development secrets or insecure cookie settings.
    """
    if not _is_production():
        return

    problems: list[str] = []

    if (settings.secret_key or "").strip() in {"", "dev-secret-key"} or len((settings.secret_key or "").strip()) < 32:
        problems.append("SECRET_KEY must be set to a strong random value (not the dev default).")

    if (settings.maintenance_bypass_token or "").strip() in {"", "bypass-token"}:
        problems.append("MAINTENANCE_BYPASS_TOKEN must be changed from the default.")

    if (settings.content_preview_token or "").strip() in {"", "preview-token"}:
        problems.append("CONTENT_PREVIEW_TOKEN must be changed from the default.")

    if (settings.payments_provider or "").strip().lower() == "mock":
        problems.append("PAYMENTS_PROVIDER must not be 'mock' in production.")

    if not bool(settings.secure_cookies):
        problems.append("SECURE_COOKIES must be enabled in production.")

    samesite = (settings.cookie_samesite or "").strip().lower()
    if samesite not in {"lax", "strict", "none"}:
        problems.append("COOKIE_SAMESITE must be one of: lax | strict | none.")
    if samesite == "none" and not bool(settings.secure_cookies):
        problems.append("COOKIE_SAMESITE=none requires SECURE_COOKIES=1.")

    # External URLs should not point at localhost in production.
    if _looks_like_localhost(settings.frontend_origin):
        problems.append("FRONTEND_ORIGIN must be set to the public site origin (not localhost) in production.")

    # Email: avoid silent production deployments where emails can't be sent.
    if bool(getattr(settings, "smtp_enabled", False)):
        if not (getattr(settings, "smtp_host", "") or "").strip():
            problems.append("SMTP_HOST must be set when SMTP_ENABLED=1.")
        if not (getattr(settings, "smtp_from_email", "") or "").strip():
            problems.append("SMTP_FROM_EMAIL must be set when SMTP_ENABLED=1.")

    # CAPTCHA: ensure secret key is present when enabled.
    if bool(getattr(settings, "captcha_enabled", False)) and (settings.captcha_provider or "").strip().lower() == "turnstile":
        if not (getattr(settings, "turnstile_secret_key", "") or "").strip():
            problems.append("TURNSTILE_SECRET_KEY must be set when CAPTCHA_ENABLED=1.")

    # Netopia: if explicitly enabled, require configuration upfront.
    if bool(getattr(settings, "netopia_enabled", False)):
        try:
            from app.services import netopia as netopia_service

            configured, reason = netopia_service.netopia_configuration_status()
            if not configured:
                problems.append(reason or "Netopia is enabled but not configured.")
        except Exception:
            problems.append("Netopia is enabled but configuration could not be validated.")

    # Stripe: prevent accidentally pointing a production env at test credentials.
    try:
        from app.services import payments as stripe_payments

        stripe_env = (getattr(settings, "stripe_env", "") or "").strip().lower()
        if stripe_env in {"live", "prod", "production"}:
            key = (stripe_payments.stripe_secret_key() or "").strip()
            if key.startswith("sk_test"):
                problems.append("STRIPE_ENV=live but STRIPE secret key looks like a test key (sk_test...).")
    except Exception:
        # Never crash production checks due to optional Stripe library issues; missing Stripe config is handled elsewhere.
        pass

    if problems:
        raise RuntimeError("Production configuration checks failed:\n- " + "\n- ".join(problems))
