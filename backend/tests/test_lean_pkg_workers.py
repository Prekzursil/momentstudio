"""Lean coverage for the ``app.workers`` package marker module."""

import importlib


def test_workers_package_is_importable() -> None:
    module = importlib.import_module("app.workers")
    assert hasattr(module, "__path__")
    assert module.__name__ == "app.workers"
    assert module.__doc__ == "Background workers."
