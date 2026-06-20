"""Lean coverage for the ``app.api`` package marker module."""

import importlib


def test_api_package_is_importable() -> None:
    module = importlib.import_module("app.api")
    assert hasattr(module, "__path__")
    assert module.__name__ == "app.api"
