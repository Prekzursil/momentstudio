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


def _truncate_text(value: str) -> str:
    return value[:5000] if len(value) > 5000 else value


def _json_safe_dict(value: dict[Any, Any]) -> dict[str, Any]:
    safe: dict[str, Any] = {}
    for idx, (key, item) in enumerate(value.items()):
        if idx >= 100:
            safe["..."] = "truncated"
            break
        safe[str(key)] = _json_safe(item)
    return safe


def _json_safe_iterable(value: list[Any] | tuple[Any, ...] | set[Any]) -> list[Any]:
    items: list[Any] = []
    for idx, item in enumerate(value):
        if idx >= 200:
            items.append("...truncated")
            break
        items.append(_json_safe(item))
    return items


def _json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (int, float, bool)):
        return value
    if isinstance(value, str):
        return _truncate_text(value)
    if isinstance(value, dict):
        return _json_safe_dict(value)
    if isinstance(value, (list, tuple, set)):
        return _json_safe_iterable(value)
    try:
        return _truncate_text(str(value))
    except Exception:  # pragma: no cover - defensive
        return "<unserializable>"


def _base_log_record_payload(record: logging.LogRecord) -> dict[str, Any]:
    ts = datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat()
    return {
        "ts": ts,
        "level": record.levelname,
        "logger": record.name,
        "message": record.getMessage(),
        "request_id": getattr(record, "request_id", "-"),
    }


def _append_http_fields(payload: dict[str, Any], record: logging.LogRecord) -> None:
    for field in ("path", "method", "status_code", "duration_ms"):
        value = getattr(record, field, None)
        if value is not None:
            payload[field] = value


def _append_non_reserved_extras(payload: dict[str, Any], record: logging.LogRecord) -> None:
    extras = getattr(record, "__dict__", {}) or {}
    for key, value in extras.items():
        if key in _RESERVED_RECORD_KEYS or key in payload:
            continue
        if key.startswith("_"):
            continue
        payload[key] = _json_safe(value)


class JsonFormatter(logging.Formatter):
    """Minimal JSON formatter for structured logs."""

    def format(self, record: logging.LogRecord) -> str:  # pragma: no cover - simple serialization
        base = _base_log_record_payload(record)
        _append_http_fields(base, record)
        _append_non_reserved_extras(base, record)
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
