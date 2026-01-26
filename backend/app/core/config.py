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
    stripe_secret_key: str = "sk_test_placeholder"
    stripe_publishable_key: str | None = None
    stripe_webhook_secret: str | None = None
    paypal_client_id: str | None = None
    paypal_client_secret: str | None = None
    paypal_env: str = "sandbox"
    paypal_currency: str = "EUR"
    paypal_webhook_id: str | None = None
    paypal_client_id_sandbox: str | None = None
    paypal_client_secret_sandbox: str | None = None
    paypal_webhook_id_sandbox: str | None = None
    paypal_client_id_live: str | None = None
    paypal_client_secret_live: str | None = None
    paypal_webhook_id_live: str | None = None
    netopia_enabled: bool = False
    netopia_pos_signature: str | None = None
    netopia_public_key_pem: str | None = None
    netopia_public_key_path: str | None = None
    netopia_jwt_alg: str = "RS512"
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
    audit_retention_days_product: int = 0
    audit_retention_days_content: int = 0
    audit_retention_days_security: int = 0
    audit_hash_chain_enabled: bool = False
    audit_hash_chain_secret: str | None = None
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
    cors_origins: list[str] = ["http://localhost:4200"]
    cors_allow_credentials: bool = True
    cors_allow_methods: list[str] = ["*"]
    cors_allow_headers: list[str] = ["*"]

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

    # CAPTCHA (login/register only; Google OAuth is exempt)
    captcha_enabled: bool = False
    captcha_provider: str = "turnstile"
    turnstile_secret_key: str | None = None

    # FX rates (used for display-only approximations; checkout remains in RON)
    fx_rates_url: str = "https://www.bnr.ro/nbrfxrates.xml"
    fx_rates_cache_ttl_seconds: int = 60 * 60 * 6
    fx_refresh_enabled: bool = False
    fx_refresh_interval_seconds: int = 60 * 60 * 6

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
