"""Coverage for ``app.core.config`` settings validators and the dev-safety
database guard.

These are pure, side-effect-free helpers/validators exercised directly (no DB,
no network), disjoint from ``test_lr_logging_config`` which targets the logging
config module instead.
"""

import pytest

from app.core import config as config_mod
from app.core.config import Settings, _database_url_host, _validate_dev_safety

# --- field validator: db_pool_size / db_max_overflow empty-string-to-none ---


def test_db_pool_validator_blank_string_becomes_none() -> None:
    s = Settings(db_pool_size="   ", db_max_overflow="")  # type: ignore[arg-type]
    assert s.db_pool_size is None
    assert s.db_max_overflow is None


def test_db_pool_validator_none_passthrough() -> None:
    s = Settings(db_pool_size=None, db_max_overflow=None)
    assert s.db_pool_size is None
    assert s.db_max_overflow is None


def test_db_pool_validator_numeric_value_preserved() -> None:
    s = Settings(db_pool_size=7, db_max_overflow=3)
    assert s.db_pool_size == 7
    assert s.db_max_overflow == 3


# --- field validator: secret_key default behaviour ---


def test_secret_key_explicit_value_is_kept() -> None:
    s = Settings(secret_key="  explicit-key  ")
    assert s.secret_key == "explicit-key"


def test_secret_key_blank_in_prod_stays_empty() -> None:
    s = Settings(secret_key="", environment="production")
    assert s.secret_key == ""


def test_secret_key_blank_in_dev_gets_random_default() -> None:
    s = Settings(secret_key="", environment="local")
    assert s.secret_key != ""
    assert len(s.secret_key) >= 32


# --- field validator: content_preview_token default behaviour ---


def test_content_preview_token_explicit_value_is_kept() -> None:
    s = Settings(content_preview_token="  tok  ")
    assert s.content_preview_token == "tok"


def test_content_preview_token_blank_in_prod_stays_empty() -> None:
    s = Settings(content_preview_token="", environment="prod")
    assert s.content_preview_token == ""


def test_content_preview_token_blank_in_dev_gets_random_default() -> None:
    s = Settings(content_preview_token="", environment="development")
    assert s.content_preview_token != ""


# --- _database_url_host ---


def test_database_url_host_empty_returns_none() -> None:
    assert _database_url_host("") is None
    assert _database_url_host("   ") is None


def test_database_url_host_unparseable_returns_none() -> None:
    # ``make_url`` raises on garbage -> the ``except`` branch returns None.
    assert _database_url_host("::::not a url::::") is None


def test_database_url_host_sqlite_has_no_host_returns_none() -> None:
    # A sqlite URL parses but exposes no host -> the empty-host branch.
    assert _database_url_host("sqlite+aiosqlite:///./local.db") is None


def test_database_url_host_postgres_host_extracted() -> None:
    assert (
        _database_url_host("postgresql+asyncpg://u:p@db.internal:5432/app")
        == "db.internal"
    )


# --- _validate_dev_safety ---


def _make(**overrides):
    return Settings(secret_key="x", content_preview_token="y", **overrides)


def test_dev_safety_guard_disabled_is_noop() -> None:
    s = _make(
        dev_safety_database_guard_enabled=False,
        environment="local",
        database_url="postgresql+asyncpg://u:p@prod-host:5432/app",
    )
    _validate_dev_safety(s)  # must not raise


def test_dev_safety_non_local_env_is_noop() -> None:
    s = _make(
        environment="production",
        database_url="postgresql+asyncpg://u:p@prod-host:5432/app",
    )
    _validate_dev_safety(s)  # must not raise


def test_dev_safety_no_host_is_noop() -> None:
    s = _make(environment="local", database_url="sqlite+aiosqlite:///./x.db")
    _validate_dev_safety(s)  # must not raise


def test_dev_safety_allowlisted_host_is_noop() -> None:
    s = _make(
        environment="local",
        database_url="postgresql+asyncpg://u:p@localhost:5432/app",
        dev_safety_database_allow_hosts=["localhost"],
    )
    _validate_dev_safety(s)  # must not raise


def test_dev_safety_blank_allow_hosts_entries_filtered_then_blocks() -> None:
    s = _make(
        environment="dev",
        database_url="postgresql+asyncpg://u:p@prod-host:5432/app",
        dev_safety_database_allow_hosts=["", "  "],
    )
    with pytest.raises(RuntimeError, match="non-local host"):
        _validate_dev_safety(s)


def test_dev_safety_disallowed_host_raises() -> None:
    s = _make(
        environment="local",
        database_url="postgresql+asyncpg://u:p@prod-host:5432/app",
        dev_safety_database_allow_hosts=["localhost", "127.0.0.1"],
    )
    with pytest.raises(RuntimeError, match="prod-host"):
        _validate_dev_safety(s)


# --- get_settings (lru_cache + guard wiring) ---


def test_get_settings_is_cached_and_runs_guard() -> None:
    config_mod.get_settings.cache_clear()
    first = config_mod.get_settings()
    second = config_mod.get_settings()
    assert first is second
