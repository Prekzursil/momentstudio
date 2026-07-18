"""Full-branch tests for the post-deploy HTTP smoke sub-gate.

Covers the real seeded-app happy path (``GET /theme`` + ``home.sections`` both 200)
AND every FAIL-LOUD branch: un-seeded theme (404), incomplete token payload,
un-seeded/unpublished home content (404), and a wrong home key.
"""

from __future__ import annotations

from typing import Any

import pytest

from scripts.deploy import theme_post_deploy_smoke as mod


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict[str, Any]) -> None:
        self.status_code = status_code
        self._payload = payload

    def json(self) -> dict[str, Any]:
        return self._payload


class _FakeClient:
    """A minimal client returning a canned response per endpoint (for pure branches)."""

    def __init__(self, responses: dict[str, _FakeResponse]) -> None:
        self._responses = responses

    def get(self, path: str) -> _FakeResponse:
        return self._responses[path]


# --- run() / main(): real end-to-end happy path -----------------------------


def test_run_happy_returns_token_count():
    count = mod.run()
    assert count == len(mod.required_token_names())


def test_run_clears_dependency_override():
    from app.db.session import get_session
    from app.main import app

    mod.run()
    assert get_session not in app.dependency_overrides


def test_main_success_returns_zero(capsys):
    assert mod.main() == 0
    assert "SUCCESS: theme-post-deploy-smoke" in capsys.readouterr().out


def test_main_failure_returns_one(monkeypatch, capsys):
    def _boom() -> int:
        raise mod.GateFailure("boom smoke")

    monkeypatch.setattr(mod, "run", _boom)
    assert mod.main() == 1
    err = capsys.readouterr().err
    assert "FAILED: theme-post-deploy-smoke" in err
    assert "boom smoke" in err


# --- _ensure_backend_on_path: both branches ---------------------------------


def test_ensure_backend_on_path_inserts_then_idempotent():
    import sys

    backend = str(mod.BACKEND_DIR)
    original = list(sys.path)
    try:
        sys.path[:] = [p for p in sys.path if p != backend]
        mod._ensure_backend_on_path()  # not-present branch: inserts
        assert backend in sys.path
        snapshot = list(sys.path)
        mod._ensure_backend_on_path()  # already-present branch: no change
        assert list(sys.path) == snapshot
    finally:
        sys.path[:] = original


# --- run() with an un-seeded app: the fail path via the real stack ----------


def test_run_unseeded_theme_raises():
    factory = mod.make_session_factory(seed_theme=False, seed_home=False)
    with pytest.raises(mod.GateFailure, match="the published theme is not being"):
        mod.run(factory)


def test_run_unseeded_home_raises():
    factory = mod.make_session_factory(seed_theme=True, seed_home=False)
    with pytest.raises(mod.GateFailure, match="home.sections content is not present"):
        mod.run(factory)


# --- check_theme_endpoint: 200-complete + non-200 + incomplete --------------


def test_check_theme_endpoint_non_200():
    client = _FakeClient({mod.THEME_ENDPOINT: _FakeResponse(404, {})})
    with pytest.raises(mod.GateFailure, match="returned 404"):
        mod.check_theme_endpoint(client)


def test_check_theme_endpoint_incomplete_payload():
    client = _FakeClient(
        {mod.THEME_ENDPOINT: _FakeResponse(200, {"tokens": {"--only": "1"}})}
    )
    with pytest.raises(mod.GateFailure, match="incomplete"):
        mod.check_theme_endpoint(client)


# --- check_home_sections_endpoint: non-200 + wrong-key ----------------------


def test_check_home_sections_endpoint_non_200():
    client = _FakeClient({mod.HOME_SECTIONS_ENDPOINT: _FakeResponse(404, {})})
    with pytest.raises(mod.GateFailure, match="returned 404"):
        mod.check_home_sections_endpoint(client)


def test_check_home_sections_endpoint_wrong_key():
    client = _FakeClient(
        {mod.HOME_SECTIONS_ENDPOINT: _FakeResponse(200, {"key": "page.about"})}
    )
    with pytest.raises(mod.GateFailure, match="expected 'home.sections'"):
        mod.check_home_sections_endpoint(client)
