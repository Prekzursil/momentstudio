"""Lean coverage for the top-level ``app`` package marker module.

``backend/app/__init__.py`` only exists to make the backend directory
importable as a package. The test imports it and asserts it is a real
package so the (otherwise statement-free) module is exercised under the
coverage scope.
"""

import importlib


def test_app_package_is_importable() -> None:
    module = importlib.import_module("app")
    # A regular package exposes ``__path__``; a plain module would not.
    assert hasattr(module, "__path__")
    assert module.__name__ == "app"
