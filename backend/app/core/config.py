from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables or a .env file."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", case_sensitive=False)

    app_name: str = "momentstudio API"
    app_version: str = "0.1.0"
    environment: str = "local"

    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/adrianaart"
    secret_key: str = "dev-secret-key"
    stripe_secret_key: str = "sk_test_placeholder"
    stripe_webhook_secret: str | None = None
    jwt_algorithm: str = "HS256"
    access_token_exp_minutes: int = 30
    refresh_token_exp_days: int = 7
    refresh_token_rotation: bool = True
    account_deletion_cooldown_hours: int = 24
    secure_cookies: bool = False
    cookie_samesite: str = "lax"
    maintenance_mode: bool = False
    maintenance_bypass_token: str = "bypass-token"
    max_concurrent_requests: int = 100
    enforce_decimal_prices: bool = True

    media_root: str = "uploads"
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


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
