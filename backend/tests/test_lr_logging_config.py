"""Lean-gate unit coverage for ``app.core.logging_config``.

Targets the non-pragma'd logic: ``_json_safe`` recursion/truncation branches,
the ``RequestIdFilter`` contextvar wiring, both ``configure_logging`` branches,
and the ``JsonFormatter`` serialisation paths.
"""

from __future__ import annotations

import json
import logging

from app.core import logging_config
from app.core.logging_config import (
    JsonFormatter,
    RequestIdFilter,
    _json_safe,
    configure_logging,
    request_id_ctx_var,
)


# --------------------------------------------------------------------------- #
# _json_safe                                                                   #
# --------------------------------------------------------------------------- #
def test_json_safe_passthrough_scalars() -> None:
    assert _json_safe(None) is None
    assert _json_safe(5) == 5
    assert _json_safe(1.5) == 1.5
    assert _json_safe(True) is True
    assert _json_safe("hi") == "hi"


def test_json_safe_truncates_long_string() -> None:
    long = "x" * 6000
    assert _json_safe(long) == "x" * 5000


def test_json_safe_dict_recursion_and_truncation() -> None:
    big = {f"k{i}": i for i in range(150)}
    out = _json_safe(big)
    assert out["..."] == "truncated"
    # First 100 entries preserved, then the truncation sentinel.
    assert out["k0"] == 0
    assert "k149" not in out


def test_json_safe_dict_nested() -> None:
    assert _json_safe({"a": {"b": 1}}) == {"a": {"b": 1}}


def test_json_safe_list_recursion_and_truncation() -> None:
    big = list(range(250))
    out = _json_safe(big)
    assert out[-1] == "...truncated"
    assert out[0] == 0
    assert len(out) == 201


def test_json_safe_tuple_and_set() -> None:
    assert _json_safe((1, 2)) == [1, 2]
    assert _json_safe({"only"}) == ["only"]


def test_json_safe_arbitrary_object_str_fallback() -> None:
    class Weird:
        def __str__(self) -> str:
            return "weird-repr"

    assert _json_safe(Weird()) == "weird-repr"


def test_json_safe_arbitrary_object_str_fallback_truncated() -> None:
    class LongStr:
        def __str__(self) -> str:
            return "y" * 6000

    assert _json_safe(LongStr()) == "y" * 5000


# --------------------------------------------------------------------------- #
# RequestIdFilter                                                              #
# --------------------------------------------------------------------------- #
def _make_record() -> logging.LogRecord:
    return logging.LogRecord(
        name="t",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="hello",
        args=(),
        exc_info=None,
    )


def test_request_id_filter_uses_default_dash() -> None:
    token = request_id_ctx_var.set(None)
    try:
        record = _make_record()
        assert RequestIdFilter().filter(record) is True
        assert record.request_id == "-"
    finally:
        request_id_ctx_var.reset(token)


def test_request_id_filter_uses_contextvar() -> None:
    token = request_id_ctx_var.set("req-123")
    try:
        record = _make_record()
        assert RequestIdFilter().filter(record) is True
        assert record.request_id == "req-123"
    finally:
        request_id_ctx_var.reset(token)


# --------------------------------------------------------------------------- #
# JsonFormatter                                                                #
# --------------------------------------------------------------------------- #
def test_json_formatter_emits_structured_fields() -> None:
    record = _make_record()
    record.request_id = "rid"
    record.path = "/x"
    record.method = "GET"
    record.status_code = 200
    record.duration_ms = 12
    record.custom_field = {"nested": 1}
    record._private = "skipped"
    payload = json.loads(JsonFormatter().format(record))
    assert payload["level"] == "INFO"
    assert payload["message"] == "hello"
    assert payload["request_id"] == "rid"
    assert payload["path"] == "/x"
    assert payload["custom_field"] == {"nested": 1}
    assert "_private" not in payload
    assert "name" not in payload  # reserved record key excluded


def test_json_formatter_includes_exception() -> None:
    try:
        raise ValueError("boom")
    except ValueError:
        import sys

        record = logging.LogRecord(
            name="t",
            level=logging.ERROR,
            pathname=__file__,
            lineno=1,
            msg="err",
            args=(),
            exc_info=sys.exc_info(),
        )
    payload = json.loads(JsonFormatter().format(record))
    assert "ValueError: boom" in payload["exception"]


# --------------------------------------------------------------------------- #
# configure_logging                                                            #
# --------------------------------------------------------------------------- #
def test_configure_logging_plain(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_basic_config(**kwargs):
        captured.update(kwargs)

    monkeypatch.setattr(logging_config.logging, "basicConfig", fake_basic_config)
    configure_logging(json_logs=False)
    handler = captured["handlers"][0]
    assert isinstance(handler.formatter, logging.Formatter)
    assert not isinstance(handler.formatter, JsonFormatter)


def test_configure_logging_json(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_basic_config(**kwargs):
        captured.update(kwargs)

    monkeypatch.setattr(logging_config.logging, "basicConfig", fake_basic_config)
    configure_logging(json_logs=True)
    handler = captured["handlers"][0]
    assert isinstance(handler.formatter, JsonFormatter)
