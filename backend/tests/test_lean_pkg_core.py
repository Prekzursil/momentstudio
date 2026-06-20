"""Lean coverage for the ``app.core`` package marker module."""

import importlib


def test_core_package_is_importable() -> None:
    module = importlib.import_module("app.core")
    assert hasattr(module, "__path__")
    assert module.__name__ == "app.core"
