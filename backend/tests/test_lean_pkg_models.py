"""Lean coverage for the ``app.models`` aggregate re-export module.

``backend/app/models/__init__.py`` imports every ORM model into one
namespace and declares ``__all__``. The test imports the package and
asserts that every name listed in ``__all__`` actually resolves on the
module, which exercises all of the import statements and the ``__all__``
assignment.
"""

import importlib


def test_models_package_exports_resolve() -> None:
    module = importlib.import_module("app.models")
    # __all__ must be a non-empty list of strings.
    assert isinstance(module.__all__, list)
    assert module.__all__
    # Every advertised name must resolve to a real attribute.
    for name in module.__all__:
        assert hasattr(module, name), name
        assert getattr(module, name) is not None


def test_models_package_exposes_base() -> None:
    from app.db.base import Base as _Base

    module = importlib.import_module("app.models")
    assert module.Base is _Base
    assert "Base" in module.__all__
