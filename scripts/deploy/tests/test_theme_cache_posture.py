"""Full-branch tests for the theme cache-posture (R3-B1) sub-gate.

Covers the real source happy path AND every FAIL-LOUD branch: a baked theme in the
static shell, a missing request-time-injection seam, a shared full-page
Cache-Control directive, a missing SSR handler marker, and a missing source file.
"""

from __future__ import annotations

import pytest

from scripts.deploy import theme_cache_posture as mod

# A minimal SSR handler that satisfies every request-time seam + a safe no-store.
_GOOD_HANDLER = (
    f"{mod._SSR_HANDLER_MARKER}\n"
    "server.use((req, res, next) => {\n"
    "  commonEngine.render({ publicPath: distFolder }).then(async (html) => {\n"
    "    const doc = await getThemeTokens(config, deps);\n"
    "    const themed = await applyThemeSsr(html, doc);\n"
    "    res.setHeader('Cache-Control', 'no-store');\n"
    "    res.send(themed.html);\n"
    "  });\n"
    "});\n"
)


# --- run() / main(): real end-to-end happy path -----------------------------


def test_run_happy_on_real_sources():
    mod.run()  # no raise — the real server.ts + index.html satisfy R3-B1


def test_main_success_returns_zero(capsys):
    assert mod.main() == 0
    assert "SUCCESS: theme-cache-posture" in capsys.readouterr().out


def test_main_failure_returns_one(monkeypatch, capsys):
    def _boom() -> None:
        raise mod.GateFailure("boom cache")

    monkeypatch.setattr(mod, "run", _boom)
    assert mod.main() == 1
    err = capsys.readouterr().err
    assert "FAILED: theme-cache-posture" in err
    assert "boom cache" in err


# --- read_source: happy + missing-file --------------------------------------


def test_read_source_happy():
    assert "server" in mod.read_source(mod.SERVER_TS).lower()


def test_read_source_missing(tmp_path):
    with pytest.raises(mod.GateFailure, match="source file not found"):
        mod.read_source(tmp_path / "nope.ts")


# --- extract_ssr_handler: happy + missing-marker ----------------------------


def test_extract_ssr_handler_happy():
    region = mod.extract_ssr_handler(_GOOD_HANDLER)
    assert region.startswith(mod._SSR_HANDLER_MARKER)


def test_extract_ssr_handler_missing_marker():
    with pytest.raises(mod.GateFailure, match="no per-request SSR render handler"):
        mod.extract_ssr_handler("const server = express();")


# --- check_theme_not_baked_in_shell: happy + baked --------------------------


def test_check_theme_not_baked_happy():
    mod.check_theme_not_baked_in_shell("<html><head><base href='/'></head></html>")


def test_check_theme_not_baked_detects_style_id():
    with pytest.raises(mod.GateFailure, match="baked theme block"):
        mod.check_theme_not_baked_in_shell('<head><style id="ms-theme"></style></head>')


def test_check_theme_not_baked_detects_root_block():
    with pytest.raises(mod.GateFailure, match="baked theme block"):
        mod.check_theme_not_baked_in_shell(
            "<head><style>:root{--brand: 1 2 3;}</style>"
        )


# --- check_request_time_injection: happy + missing-seam ---------------------


def test_check_request_time_injection_happy():
    mod.check_request_time_injection(_GOOD_HANDLER)


def test_check_request_time_injection_missing_seam():
    # A handler that renders but never calls applyThemeSsr / getThemeTokens.
    handler = f"{mod._SSR_HANDLER_MARKER}\ncommonEngine.render({{}});"
    with pytest.raises(mod.GateFailure, match="request-time theme-injection seam"):
        mod.check_request_time_injection(handler)


# --- check_no_shared_full_page_cache: none + safe + offending ----------------


def test_check_no_shared_cache_when_no_header():
    mod.check_no_shared_full_page_cache("res.send(html);")  # no Cache-Control at all


def test_check_no_shared_cache_allows_no_store():
    mod.check_no_shared_full_page_cache("res.setHeader('Cache-Control', 'no-store');")


def test_check_no_shared_cache_ignores_publicpath_substring():
    # `publicPath` must NOT be mistaken for a `public` cache directive.
    mod.check_no_shared_full_page_cache(
        "commonEngine.render({ publicPath: distFolder });"
        "res.setHeader('Cache-Control', 'no-store');"
    )


def test_check_no_shared_cache_detects_public():
    handler = "res.setHeader('Cache-Control', 'public, max-age=3600');"
    with pytest.raises(mod.GateFailure, match="shared full-page Cache-Control"):
        mod.check_no_shared_full_page_cache(handler)
