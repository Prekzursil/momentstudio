"""Sub-gate — theme cache-posture check (P1a WU15 / R3-B1).

R3-B1 operational half: **no themeable route is served from a full-page cache
carrying a baked theme blob** — the theme must stay *request-time*. If a themed
HTML page were cached as a shared full-page entry (an intermediary/CDN cache, or
a prerendered/baked static shell served by ``express.static``), every visitor
would get one frozen theme and "re-theme with no rebuild" silently breaks; worse,
a stale hash-pinned ``<style>`` served from cache would trip its own CSP.

This gate encodes R3-B1 as three checkable source assertions over the SSR entry
(``frontend/src/server.ts``) and the static shell (``frontend/src/index.html``),
each FAILING LOUD (``GateFailure`` → exit 1 → CI red):

1. **Theme is NOT baked into the static shell.** ``server.ts`` serves
   ``dist/app/browser`` via ``express.static(..., { maxAge: '1y' })`` — a genuine
   full-page/asset cache. The themed ``<style id="ms-theme">`` / ``:root{…}`` theme
   block must therefore NEVER appear in the source ``index.html`` (which becomes
   that cached shell). If it is baked in, the theme is a cached blob, not
   request-time — FAIL. (The WU6 sink injects it per request in ``server.ts``.)
2. **The theme is injected at REQUEST TIME, express-side.** ``server.ts`` must
   render every route through the per-request ``CommonEngine`` handler and apply
   the theme AFTER render via ``applyThemeSsr``, resolving the doc express-side
   (``getThemeTokens``) — never via the Angular app (which would land it in the
   cached hydration / ``TransferState`` payload). Missing that seam → the theme is
   not provably request-time → FAIL.
3. **No shared full-page cache directive on the themed HTML response.** Within the
   SSR handler, the themed response must not carry a cacheable ``Cache-Control``
   (``public`` / ``max-age`` / ``s-maxage`` / ``immutable``) that would let an
   intermediary store the themed page as a shared full-page entry. The only
   ``Cache-Control`` the handler may set is the preview path's ``no-store``. A
   cacheable directive in the handler → FAIL. (The ``maxAge: '1y'`` on
   ``express.static`` is for hashed ASSETS and is excluded — checked only inside
   the render handler region, not the static middleware.)
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SERVER_TS = REPO_ROOT / "frontend" / "src" / "server.ts"
INDEX_HTML = REPO_ROOT / "frontend" / "src" / "index.html"

# Marker that begins the per-request SSR render handler in server.ts (everything
# from here to the end is the render path; the static-asset middleware — with its
# legitimate maxAge:'1y' on hashed assets — sits ABOVE it and is excluded).
_SSR_HANDLER_MARKER = "// All regular routes use the Angular engine"
# Directives that would make a THEMED full-page response a shared cache entry.
_SHARED_CACHE_DIRECTIVES: tuple[str, ...] = (
    "public",
    "max-age",
    "s-maxage",
    "immutable",
)
# Request-time-injection seam markers the SSR handler must carry.
_REQUEST_TIME_MARKERS: tuple[str, ...] = (
    "commonEngine",  # per-request CommonEngine.render — not a prerendered/baked page
    "applyThemeSsr",  # theme injected AFTER render, at request time
    "getThemeTokens",  # doc resolved express-side (never Angular HttpClient/TransferState)
)
# The baked-theme signatures that must NOT appear in the static shell.
_BAKED_THEME_SIGNATURES: tuple[str, ...] = ('id="ms-theme"', ":root{")
# Captures the VALUE of each ``res.setHeader('Cache-Control', '<value>')`` /
# ``res.set('Cache-Control', '<value>')`` in the handler — checked precisely so a
# substring like ``publicPath`` is never mistaken for a ``public`` cache directive.
_CACHE_CONTROL_VALUE = re.compile(r"""Cache-Control['"]\s*,\s*['"]([^'"]*)['"]""")


class GateFailure(RuntimeError):
    """A deploy-gate invariant was violated; the message is the loud reason."""


def read_source(path: Path) -> str:
    """Read a source file, failing loud if the expected file is missing."""
    if not path.exists():
        raise GateFailure(f"expected source file not found: {path}")
    return path.read_text(encoding="utf-8")


def extract_ssr_handler(server_ts: str) -> str:
    """Return the SSR render-handler region of ``server.ts`` (marker → end).

    Fails loud if the request-time render handler marker is absent — its removal
    would itself mean the request-time render path is gone.
    """
    idx = server_ts.find(_SSR_HANDLER_MARKER)
    if idx == -1:
        raise GateFailure(
            "server.ts has no per-request SSR render handler "
            f"({_SSR_HANDLER_MARKER!r} missing) — the request-time theme path is gone"
        )
    return server_ts[idx:]


def check_theme_not_baked_in_shell(index_html: str) -> None:
    """Fail loud if a baked theme block is present in the cached static shell."""
    baked = [sig for sig in _BAKED_THEME_SIGNATURES if sig in index_html]
    if baked:
        raise GateFailure(
            f"static index.html carries a baked theme block ({baked}) — it is served "
            "from express.static's full-page/asset cache (maxAge:'1y'), so the theme "
            "would be a frozen cached blob, not request-time (R3-B1)"
        )


def check_request_time_injection(ssr_handler: str) -> None:
    """Fail loud unless the SSR handler injects the theme express-side, per request."""
    missing = [m for m in _REQUEST_TIME_MARKERS if m not in ssr_handler]
    if missing:
        raise GateFailure(
            "SSR handler is missing request-time theme-injection seam(s): "
            f"{missing} — the theme is not provably resolved express-side at request "
            "time (risk: baked into the cached render / TransferState) (R3-B1)"
        )


def check_no_shared_full_page_cache(ssr_handler: str) -> None:
    """Fail loud if the themed HTML response carries a shared full-page cache hint.

    Inspects only the VALUE of each ``Cache-Control`` header the handler sets (via
    a precise regex), so a benign substring like ``publicPath`` is never mistaken
    for a ``public`` cache directive. No ``Cache-Control`` at all is fine (the
    request-time default); the only permitted value is the preview ``no-store``.
    """
    for value in _CACHE_CONTROL_VALUE.findall(ssr_handler):
        offending = [d for d in _SHARED_CACHE_DIRECTIVES if d in value.lower()]
        if offending:
            raise GateFailure(
                "SSR handler sets a shared full-page Cache-Control directive "
                f"({offending}) on a themeable route — a themed page could be cached "
                "as a shared entry, baking the theme (R3-B1). Themed routes stay "
                "request-time; only 'no-store' (preview) is permitted."
            )


def run() -> None:
    """Assert R3-B1 over the real SSR entry + static shell; raise on any breach."""
    server_ts = read_source(SERVER_TS)
    index_html = read_source(INDEX_HTML)
    ssr_handler = extract_ssr_handler(server_ts)

    check_theme_not_baked_in_shell(index_html)
    check_request_time_injection(ssr_handler)
    check_no_shared_full_page_cache(ssr_handler)


def main() -> int:
    """CLI entrypoint: 0 on success, 1 (loud stderr) on any invariant breach."""
    try:
        run()
    except GateFailure as exc:
        print(f"FAILED: theme-cache-posture\n{exc}", file=sys.stderr)
        return 1
    print(
        "SUCCESS: theme-cache-posture "
        "(themeable routes are request-time; no baked theme in a full-page cache)"
    )
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised via subprocess/CI
    raise SystemExit(main())
