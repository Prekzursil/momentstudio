"""Lean coverage for the ``app.schemas`` package marker module."""

import importlib


def test_schemas_package_is_importable() -> None:
    module = importlib.import_module("app.schemas")
    assert hasattr(module, "__path__")
    assert module.__name__ == "app.schemas"
