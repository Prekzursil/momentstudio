"""Lean coverage for the ``app.db`` package re-export module.

``backend/app/db/__init__.py`` re-exports ``Base`` and ``get_session``.
The test imports the package and asserts those names resolve to the
underlying definitions so both import statements execute.
"""

import importlib

from app.db.base import Base as _Base
from app.db.session import get_session as _get_session


def test_db_package_reexports() -> None:
    module = importlib.import_module("app.db")
    assert module.Base is _Base
    assert module.get_session is _get_session
