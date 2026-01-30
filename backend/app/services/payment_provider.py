from __future__ import annotations

from typing import Literal

from app.core.config import settings

PaymentsProvider = Literal["real", "mock"]


def payments_provider() -> PaymentsProvider:
    raw = (settings.payments_provider or "real").strip().lower()
    if raw in {"mock", "test"}:
        env = (settings.environment or "").strip().lower()
        if env in {"prod", "production"}:
            return "real"
        return "mock"
    return "real"


def is_mock_payments() -> bool:
    return payments_provider() == "mock"

