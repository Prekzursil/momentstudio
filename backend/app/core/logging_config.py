from __future__ import annotations

import json
import logging
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any

request_id_ctx_var: ContextVar[str | None] = ContextVar("request_id", default=None)

_RESERVED_RECORD_KEYS = {
    "name",
    "msg",
    "args",
    "levelname",
    "levelno",
    "pathname",
    "filename",
    "module",
    "exc_info",
    "exc_text",
    "stack_info",
    "lineno",
    "funcName",
    "created",
    "msecs",
    "relativeCreated",
    "thread",
    "threadName",
    "processName",
    "process",
}


class RequestIdFilter(logging.Filter):
    """Attach request_id from contextvars to every log record."""

    def filter(self, record: logging.LogRecord) -> bool:  # pragma: no cover - trivial
        record.request_id = request_id_ctx_var.get() or "-"
        return True


def _json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        if isinstance(value, str) and len(value) > 5000:
            return value[:5000]
        return value
    if isinstance(value, dict):
        safe: dict[str, Any] = {}
        for idx, (k, v) in enumerate(value.items()):
            if idx >= 100:
                safe["..."] = "truncated"
                break
            safe[str(k)] = _json_safe(v)
        return safe
    if isinstance(value, (list, tuple, set)):
        items: list[Any] = []
        for idx, item in enumerate(value):
            if idx >= 200:
                items.append("...truncated")
                break
            items.append(_json_safe(item))
        return items
    try:
        text = str(value)
        return text[:5000] if len(text) > 5000 else text
    except Exception:  # pragma: no cover - defensive
        return "<unserializable>"


class JsonFormatter(logging.Formatter):
    """Minimal JSON formatter for structured logs."""

    def format(self, record: logging.LogRecord) -> str:  # pragma: no cover - simple serialization
        ts = datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat()
        base: dict[str, Any] = {
            "ts": ts,
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": getattr(record, "request_id", "-"),
        }
        for field in ("path", "method", "status_code", "duration_ms"):
            value = getattr(record, field, None)
            if value is not None:
                base[field] = value
        extras = getattr(record, "__dict__", {}) or {}
        for key, value in extras.items():
            if key in _RESERVED_RECORD_KEYS or key in base:
                continue
            if key.startswith("_"):
                continue
            base[key] = _json_safe(value)
        if record.exc_info:
            base["exception"] = self.formatException(record.exc_info)
        return json.dumps(base, ensure_ascii=False)


def configure_logging(json_logs: bool = False) -> None:
    """Configure root logger with request-id aware formatter."""
    handler = logging.StreamHandler()
    handler.addFilter(RequestIdFilter())
    if json_logs:
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(
            logging.Formatter("%(asctime)s [%(levelname)s] %(name)s [%(request_id)s] %(message)s")
        )

    logging.basicConfig(level=logging.INFO, handlers=[handler], force=True)
