from __future__ import annotations

import logging

from app.core.config import settings


def init_sentry() -> None:
    if not settings.sentry_dsn:
        return

    import sentry_sdk
    from sentry_sdk.integrations import Integration
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.logging import LoggingIntegration
    from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

    integrations: list[Integration] = [
        FastApiIntegration(),
        SqlalchemyIntegration(),
    ]
    if settings.sentry_enable_logs:
        log_level_name = str(settings.sentry_log_level or "error").strip().upper()
        event_level = getattr(logging, log_level_name, logging.ERROR)
        integrations.append(
            LoggingIntegration(
                level=event_level,
                event_level=event_level,
            )
        )

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.environment,
        release=settings.app_version,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        profiles_sample_rate=settings.sentry_profiles_sample_rate,
        integrations=integrations,
        enable_logs=settings.sentry_enable_logs,
        attach_stacktrace=True,
        send_default_pii=False,
    )
