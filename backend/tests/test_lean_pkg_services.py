"""Lean coverage for the ``app.services`` package re-export module.

``backend/app/services/__init__.py`` imports the ``auth``, ``catalog`` and
``cart`` service submodules and declares ``__all__``. The test imports the
package and asserts those submodules are exposed so both the import and the
``__all__`` assignment run.
"""

import importlib
from types import ModuleType


def test_services_package_reexports_submodules() -> None:
    module = importlib.import_module("app.services")
    assert module.__all__ == ["auth", "catalog", "cart"]
    for name in module.__all__:
        submodule = getattr(module, name)
        assert isinstance(submodule, ModuleType)
        assert submodule.__name__ == f"app.services.{name}"
