"""Lean coverage for the ``app.api.v1`` package re-export module.

``backend/app/api/v1/__init__.py`` re-exports the aggregate ``api_router``
and declares ``__all__``. The test imports it and asserts the public
surface so both import statements and the ``__all__`` assignment run.
"""

import importlib

from fastapi import APIRouter


def test_api_v1_reexports_api_router() -> None:
    module = importlib.import_module("app.api.v1")
    assert module.__all__ == ["api_router"]
    assert isinstance(module.api_router, APIRouter)
