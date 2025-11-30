from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables or a .env file."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", case_sensitive=False)

    app_name: str = "AdrianaArt API"
    app_version: str = "0.1.0"
    environment: str = "local"

    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/adrianaart"
    secret_key: str = "dev-secret-key"
    stripe_secret_key: str = "sk_test_placeholder"
    stripe_webhook_secret: str | None = None
    jwt_algorithm: str = "HS256"
    access_token_exp_minutes: int = 30
    refresh_token_exp_days: int = 7

    media_root: str = "uploads"
    cors_origins: list[str] = ["http://localhost:4200"]
    cors_allow_credentials: bool = True
    cors_allow_methods: list[str] = ["*"]
    cors_allow_headers: list[str] = ["*"]

    smtp_host: str = "localhost"
    smtp_port: int = 1025
    smtp_username: str | None = None
    smtp_password: str | None = None

    frontend_origin: str = "http://localhost:4200"
    content_preview_token: str = "preview-token"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
