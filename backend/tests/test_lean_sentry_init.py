"""Lean-gate unit coverage for ``app.core.sentry.init_sentry``.

The DSN-less early return is already exercised by the test bootstrap (conftest
forces ``SENTRY_DSN=""``); these tests drive the configured branches by
monkeypatching ``settings`` and stubbing ``sentry_sdk.init`` so no real SDK
client is created. Both the logs-enabled and logs-disabled integration paths
are covered.
"""

from __future__ import annotations

import logging

import sentry_sdk

from app.core import sentry as sentry_module
from app.core.sentry import init_sentry


def test_init_sentry_disabled_when_dsn_missing(monkeypatch, caplog) -> None:
    monkeypatch.setattr(sentry_module.settings, "sentry_dsn", None, raising=False)

    called: dict[str, object] = {}
    monkeypatch.setattr(
        sentry_sdk, "init", lambda **kw: called.update(kw), raising=True
    )

    with caplog.at_level(logging.INFO, logger=sentry_module.logger.name):
        init_sentry()

    assert called == {}
    assert any("sentry_disabled" in r.message for r in caplog.records)


def test_init_sentry_enabled_with_logs(monkeypatch) -> None:
    monkeypatch.setattr(
        sentry_module.settings, "sentry_dsn", "https://x@example.com/1", raising=False
    )
    monkeypatch.setattr(
        sentry_module.settings, "sentry_enable_logs", True, raising=False
    )
    monkeypatch.setattr(
        sentry_module.settings, "sentry_log_level", "warning", raising=False
    )

    captured: dict[str, object] = {}
    monkeypatch.setattr(
        sentry_sdk, "init", lambda **kw: captured.update(kw), raising=True
    )

    init_sentry()

    assert captured["dsn"] == "https://x@example.com/1"
    assert captured["enable_logs"] is True
    # FastApi + Sqlalchemy + Logging integrations when logs are on.
    assert len(captured["integrations"]) == 3


def test_init_sentry_enabled_without_logs_and_bad_level(monkeypatch) -> None:
    monkeypatch.setattr(
        sentry_module.settings, "sentry_dsn", "https://x@example.com/2", raising=False
    )
    monkeypatch.setattr(
        sentry_module.settings, "sentry_enable_logs", False, raising=False
    )
    # A bogus level name should fall back to ERROR (getattr default branch),
    # though with logs disabled the LoggingIntegration is never appended.
    monkeypatch.setattr(
        sentry_module.settings, "sentry_log_level", "not-a-level", raising=False
    )

    captured: dict[str, object] = {}
    monkeypatch.setattr(
        sentry_sdk, "init", lambda **kw: captured.update(kw), raising=True
    )

    init_sentry()

    assert captured["enable_logs"] is False
    # Only FastApi + Sqlalchemy integrations when logs are off.
    assert len(captured["integrations"]) == 2
