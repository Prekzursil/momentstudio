from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables or a .env file."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", case_sensitive=False)

    app_name: str = "momentstudio API"
    app_version: str = "0.1.0"
    environment: str = "local"

    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/adrianaart"
    backup_last_at: str | None = None
    secret_key: str = "dev-secret-key"
    # Payments provider mode used by our API endpoints.
    # - real: use Stripe/PayPal APIs (default)
    # - mock: deterministic local-only provider for CI/E2E (never use in production)
    payments_provider: str = "real"
    stripe_secret_key: str = "sk_test_placeholder"
    stripe_publishable_key: str | None = None
    stripe_webhook_secret: str | None = None
    # Stripe env toggle (similar to PayPal). Prefer *_SANDBOX/*_LIVE, with *_TEST as legacy aliases.
    stripe_env: str = "sandbox"  # sandbox | live
    stripe_secret_key_sandbox: str | None = None
    stripe_secret_key_test: str | None = None
    stripe_secret_key_live: str | None = None
    stripe_publishable_key_sandbox: str | None = None
    stripe_publishable_key_test: str | None = None
    stripe_publishable_key_live: str | None = None
    stripe_webhook_secret_sandbox: str | None = None
    stripe_webhook_secret_test: str | None = None
    stripe_webhook_secret_live: str | None = None
    paypal_client_id: str | None = None
    paypal_client_secret: str | None = None
    paypal_env: str = "sandbox"
    paypal_currency: str = "RON"
    paypal_webhook_id: str | None = None
    paypal_client_id_sandbox: str | None = None
    paypal_client_secret_sandbox: str | None = None
    paypal_webhook_id_sandbox: str | None = None
    paypal_client_id_live: str | None = None
    paypal_client_secret_live: str | None = None
    paypal_webhook_id_live: str | None = None
    netopia_enabled: bool = False
    # One of: sandbox | live
    netopia_env: str = "sandbox"
    # API key generated in NETOPIA Payments admin panel (required to start payments / check status).
    netopia_api_key: str | None = None
    netopia_pos_signature: str | None = None
    netopia_public_key_pem: str | None = None
    netopia_public_key_path: str | None = None
    netopia_jwt_alg: str = "RS512"
    netopia_ipn_max_age_seconds: int = 60 * 60 * 24
    jwt_algorithm: str = "HS256"
    access_token_exp_minutes: int = 30
    admin_impersonation_exp_minutes: int = 10
    refresh_token_exp_days: int = 7
    refresh_token_rotation: bool = True
    refresh_token_rotation_grace_seconds: int = 60
    two_factor_challenge_exp_minutes: int = 10
    two_factor_totp_period_seconds: int = 30
    two_factor_totp_window: int = 1
    two_factor_totp_digits: int = 6
    two_factor_recovery_codes_count: int = 10
    webauthn_challenge_exp_minutes: int = 10
    webauthn_rp_id: str | None = None
    webauthn_rp_name: str | None = None
    webauthn_allowed_origins: list[str] = []
    account_deletion_cooldown_hours: int = 24
    gdpr_export_sla_days: int = 30
    gdpr_deletion_sla_days: int = 30
    order_export_retention_days: int = 30
    audit_retention_days_product: int = 0
    audit_retention_days_content: int = 0
    audit_retention_days_security: int = 0
    audit_hash_chain_enabled: bool = False
    audit_hash_chain_secret: str | None = None
    audit_log_request_payload: bool = True
    audit_log_max_body_bytes: int = 4096
    secure_cookies: bool = False
    cookie_samesite: str = "lax"
    maintenance_mode: bool = False
    maintenance_bypass_token: str = "bypass-token"
    # Enforce 2FA/passkeys for owner/admin access to admin APIs.
    # In production, keep this enabled. For local dev/CI smoke tests, you can disable it.
    admin_mfa_required: bool = True
    admin_ip_allowlist: list[str] = []
    admin_ip_denylist: list[str] = []
    admin_ip_header: str | None = None
    admin_ip_bypass_token: str | None = None
    admin_ip_bypass_cookie_minutes: int = 30
    max_concurrent_requests: int = 100
    enforce_decimal_prices: bool = True
    coupon_reservation_ttl_minutes: int = 60 * 24
    cart_reservation_window_minutes: int = 60 * 2
    first_order_reward_coupon_validity_days: int = 30

    media_root: str = "uploads"
    private_media_root: str = "private_uploads"
    upload_image_max_width: int = 8192
    upload_image_max_height: int = 8192
    upload_image_max_pixels: int = 40_000_000
    cors_origins: list[str] = ["http://localhost:4200", "http://localhost:4201"]
    cors_allow_credentials: bool = True
    cors_allow_methods: list[str] = ["*"]
    cors_allow_headers: list[str] = ["*"]

    # Optional Redis (recommended for multi-replica deployments; used for shared rate limiting/caches)
    redis_url: str | None = None

    smtp_host: str = "localhost"
    smtp_port: int = 1025
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_enabled: bool = False
    smtp_use_tls: bool = False
    smtp_from_email: str | None = None
    email_rate_limit_per_minute: int = 60
    email_rate_limit_per_recipient_per_minute: int = 10
    auth_rate_limit_register: int = 10
    auth_rate_limit_login: int = 20
    auth_rate_limit_refresh: int = 60
    auth_rate_limit_reset_request: int = 30
    auth_rate_limit_reset_confirm: int = 60
    auth_rate_limit_google: int = 20

    frontend_origin: str = "http://localhost:4200"
    content_preview_token: str = "preview-token"
    error_alert_email: str | None = None
    admin_alert_email: str | None = None
    log_json: bool = False
    csp_enabled: bool = True
    csp_policy: str = "default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'"
    slow_query_threshold_ms: int = 500
    sentry_dsn: str | None = None
    sentry_traces_sample_rate: float = 0.0

    google_client_id: str | None = None
    google_client_secret: str | None = None
    google_redirect_uri: str | None = None
    google_allowed_domains: list[str] = []
    google_completion_token_exp_minutes: int = 30

    # CAPTCHA (used in auth + optional blog comment protection; Google OAuth is exempt)
    captcha_enabled: bool = False
    captcha_provider: str = "turnstile"
    turnstile_secret_key: str | None = None

    # Blog comments: spam controls
    blog_comments_rate_limit_count: int = 10
    blog_comments_rate_limit_window_seconds: int = 60
    blog_comments_max_links: int = 2
    analytics_rate_limit_events: int = 120
    analytics_require_token: bool = False
    analytics_token_ttl_seconds: int = 60 * 60 * 24

    # FX rates (used for display-only approximations; checkout remains in RON)
    fx_rates_url: str = "https://www.bnr.ro/nbrfxrates.xml"
    fx_rates_cache_ttl_seconds: int = 60 * 60 * 6
    fx_refresh_enabled: bool = False
    fx_refresh_interval_seconds: int = 60 * 60 * 6

    # Admin scheduled reports (email summaries)
    admin_reports_scheduler_enabled: bool = True
    admin_reports_poll_interval_seconds: int = 60

    # Locker lookup (Sameday/FANbox)
    # In production you should configure official courier credentials.
    # For local development, Overpass (OpenStreetMap) can be used as a best-effort fallback.
    lockers_use_overpass_fallback: bool = True
    sameday_api_base_url: str | None = None
    sameday_api_username: str | None = None
    sameday_api_password: str | None = None
    fan_api_base_url: str = "https://api.fancourier.ro"
    fan_api_username: str | None = None
    fan_api_password: str | None = None

    # Fraud/risk signals (admin-only; informational)
    fraud_velocity_window_minutes: int = 60 * 24
    fraud_velocity_threshold: int = 3
    fraud_payment_retry_threshold: int = 2


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
