from __future__ import annotations

from app.core.config import settings


def _is_production() -> bool:
    env = (settings.environment or "").strip().lower()
    return env in {"prod", "production"}


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

    if problems:
        raise RuntimeError("Production configuration checks failed:\n- " + "\n- ".join(problems))

