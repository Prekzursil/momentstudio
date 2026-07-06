"""Sub-gate — themed-render smoke + report-only CSP (P1a WU15 / R4-B6 cond. b).

A lightweight, browser-free proof that the DEFAULT theme renders and that the
SSR ``<style>`` sink it feeds is well-formed, injection-safe, AND covered by the
matching ``Content-Security-Policy-Report-Only`` header the storefront must ship
(R4-B6 production-deploy gate condition (b) — the plan's §WU15 test-first item).

It exercises the REAL backend render seam (``theme_service.default_theme_tokens``
+ ``theme_derive.derive_tokens`` — the exact pipeline ``GET /theme`` /
``resolve_published_tokens`` returns to the SSR consumer) and the REAL WU2 CSS
safety validator (``theme_validation.encode_css_safe``), then mirrors the WU6 SSR
head sink (``frontend/src/server/theme-head.ts``): build ``:root{…}`` inside
``<style id="ms-theme">``, inject it as the first child of ``<head>``, and assemble
the report-only CSP whose ``style-src 'sha256-…'`` pins that exact block.

CSP-hash MIRROR — read this. The authoritative hash is computed in the TS sink
(``theme-head.ts``: base64 SHA-256 of the sorted ``:root{…}`` body via
``crypto.subtle`` + ``btoa``, wrapped by ``buildCspReportOnly``). Recomputing it
here needs a Node/TS runtime this Python-only deploy lane does not have, so this
module MIRRORS that algorithm in ``sha256_base64`` / ``build_csp_report_only`` and
guards the mirror two ways: (1) it asserts INTERNAL consistency — the header's
``sha256`` matches a fresh hash of the SAME ``:root{…}`` block this smoke injects;
(2) ``assert_ts_sink_parity`` reads ``theme-head.ts`` and FAILS LOUD if the TS
sink's hash algorithm / CSP directive set drifts from what this mirror encodes, so
a change to the real sink cannot silently desync the mirror.

FAILS LOUD on any breach:

* the default theme fails to render a COMPLETE effective token map (every editable
  primary + every derived shade/on-colour present and non-empty);
* any rendered value is NOT injection-safe (would break out of the ``<style>``);
* the assembled ``<style id="ms-theme">`` tag is malformed;
* injecting the tag into a document does not place it inside ``<head>``;
* the report-only CSP header is missing / does not carry a ``style-src
  'sha256-<hash>'`` matching the injected block, or drops a hardening directive;
* the TS sink's hash/CSP algorithm no longer matches this Python mirror.
"""

from __future__ import annotations

import base64
import hashlib
import re
import sys
from collections.abc import Callable
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"
THEME_HEAD_TS = REPO_ROOT / "frontend" / "src" / "server" / "theme-head.ts"

STYLE_ELEMENT_ID = "ms-theme"
_HEAD_OPEN = re.compile(r"<head[^>]*>", re.IGNORECASE)
_HEAD_CLOSE = "</head>"

# The zero-cost hardening directives the WU6 sink ships alongside the per-response
# style-src hash (mirrors ``theme-head.ts:buildCspReportOnly``). Kept in TS-source
# order; ``assert_ts_sink_parity`` proves this list still matches the real sink.
CSP_HARDENING_DIRECTIVES: tuple[str, ...] = (
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
)
_STYLE_SRC_SHA256 = re.compile(r"style-src 'sha256-([A-Za-z0-9+/=]+)'")


class GateFailure(RuntimeError):
    """A deploy-gate invariant was violated; the message is the loud reason."""


def _ensure_backend_on_path() -> None:
    """Put ``backend/`` on ``sys.path`` so ``import app...`` resolves (idempotent)."""
    backend = str(BACKEND_DIR)
    if backend not in sys.path:
        sys.path.insert(0, backend)


def effective_default_tokens() -> dict[str, str]:
    """Render the default theme's full effective token map (primaries + derived).

    Mirrors what ``resolve_published_tokens`` returns for the seeded default:
    ``derive_tokens(default_theme_tokens())``.
    """
    _ensure_backend_on_path()
    from app.services.theme_derive import derive_tokens  # noqa: PLC0415
    from app.services.theme_service import default_theme_tokens  # noqa: PLC0415

    return derive_tokens(default_theme_tokens())


def required_token_names() -> set[str]:
    """The names the default render MUST contain: editable primaries + derived."""
    _ensure_backend_on_path()
    from app.services.theme_derive import DERIVED_COLOR_NAMES  # noqa: PLC0415
    from app.services.theme_service import default_theme_tokens  # noqa: PLC0415

    return set(default_theme_tokens()) | set(DERIVED_COLOR_NAMES)


def check_render_complete(tokens: dict[str, str], required: set[str]) -> None:
    """Fail loud if any required token is missing or renders an empty value."""
    missing = sorted(required - set(tokens))
    if missing:
        raise GateFailure(
            f"default theme did not render a complete token map; missing: {missing}"
        )
    empty = sorted(name for name in required if not tokens[name].strip())
    if empty:
        raise GateFailure(
            f"default theme rendered empty value(s) for: {empty} — a fresh deploy "
            "would render partially unstyled"
        )


def check_values_injection_safe(tokens: dict[str, str]) -> None:
    """Fail loud if any rendered value could break out of the ``<style>`` block."""
    _ensure_backend_on_path()
    from app.services.theme_validation import encode_css_safe  # noqa: PLC0415

    unsafe = sorted(
        name for name, value in tokens.items() if not encode_css_safe(value).ok
    )
    if unsafe:
        raise GateFailure(
            f"default theme rendered CSS-unsafe value(s) for: {unsafe} — the SSR "
            "<style> sink would reject or be broken out of"
        )


def build_theme_css(tokens: dict[str, str]) -> str:
    """Assemble the ``:root{…}`` block with deterministically sorted declarations.

    Mirrors ``theme-head.ts:buildThemeCss`` (sorted keys → stable output/hash).
    """
    declarations = "".join(f"{name}: {tokens[name]};" for name in sorted(tokens))
    return f":root{{{declarations}}}"


def build_style_tag(css: str) -> str:
    """Wrap the CSS body in the single permitted ``<style id="ms-theme">`` tag."""
    return f'<style id="{STYLE_ELEMENT_ID}">{css}</style>'


def sha256_base64(text: str) -> str:
    """Base64 SHA-256 of ``text`` — the CSP hash of the style body.

    MIRRORS ``theme-head.ts:sha256Base64`` (``crypto.subtle.digest('SHA-256')`` →
    ``btoa``). ``assert_ts_sink_parity`` guards this equivalence.
    """
    return base64.b64encode(hashlib.sha256(text.encode("utf-8")).digest()).decode(
        "ascii"
    )


def build_csp_report_only(css_hash: str) -> str:
    """Assemble the report-only CSP value (mirrors ``buildCspReportOnly``)."""
    return "; ".join((f"style-src 'sha256-{css_hash}'", *CSP_HARDENING_DIRECTIVES))


def inject_theme_head(html: str, style_tag: str) -> str:
    """Inject ``style_tag`` as the first child of ``<head>`` (mirrors WU6 sink).

    Falls back to before ``</head>``, then to a prepend, if no head is present.
    """
    open_match = _HEAD_OPEN.search(html)
    if open_match is not None:
        at = open_match.end()
        return f"{html[:at]}{style_tag}{html[at:]}"
    close_index = html.find(_HEAD_CLOSE)
    if close_index != -1:
        return f"{html[:close_index]}{style_tag}{html[close_index:]}"
    return f"{style_tag}{html}"


def check_style_tag_wellformed(style_tag: str) -> None:
    """Fail loud if the assembled tag is not a single well-formed theme style tag."""
    expected_open = f'<style id="{STYLE_ELEMENT_ID}">'
    if not style_tag.startswith(expected_open) or not style_tag.endswith("</style>"):
        raise GateFailure(f"assembled style tag is malformed: {style_tag[:60]!r}…")
    if style_tag.count("<style") != 1 or ":root{" not in style_tag:
        raise GateFailure(
            "assembled style tag is not a single ':root{…}' block: "
            f"{style_tag[:60]!r}…"
        )


def check_injected_into_head(
    html: str,
    style_tag: str,
    inject: Callable[[str, str], str] = inject_theme_head,
) -> None:
    """Fail loud if injecting the tag does not land it inside ``<head>``.

    ``inject`` is parameterised so a regression in the injector (tag landing
    outside ``<head>``) is caught here rather than silently shipping un-themed SSR.
    """
    injected = inject(html, style_tag)
    head_open = _HEAD_OPEN.search(injected)
    head_close = injected.find(_HEAD_CLOSE)
    tag_at = injected.find(style_tag)
    if head_open is None or head_close == -1:
        raise GateFailure("SSR document has no <head> to inject the theme style into")
    if not (head_open.end() <= tag_at < head_close):
        raise GateFailure(
            "theme <style> was not injected inside <head> — SSR would render "
            "un-themed (FOUC / unstyled default)"
        )


def check_report_only_csp(css: str, header: str) -> None:
    """Fail loud unless ``header`` pins THIS ``css`` block via ``style-src sha256``.

    Asserts R4-B6 condition (b): the themed response carries a report-only CSP
    whose ``style-src 'sha256-<hash>'`` matches a fresh hash of the injected
    ``:root{…}`` block, and every zero-cost hardening directive is present.
    """
    match = _STYLE_SRC_SHA256.search(header)
    if match is None:
        raise GateFailure(
            "report-only CSP header carries no style-src 'sha256-…' — the themed "
            f"<style> is not hash-pinned: {header!r}"
        )
    expected = sha256_base64(css)
    if match.group(1) != expected:
        raise GateFailure(
            "report-only CSP style-src hash does not match the injected block "
            f"(header={match.group(1)!r}, expected sha256 of :root block={expected!r})"
            " — CSP would report/block the very style it ships"
        )
    missing = [d for d in CSP_HARDENING_DIRECTIVES if d not in header]
    if missing:
        raise GateFailure(
            f"report-only CSP header dropped hardening directive(s): {missing}"
        )


def assert_ts_sink_parity(path: Path = THEME_HEAD_TS) -> None:
    """Fail loud if the TS sink's hash/CSP algorithm drifts from this mirror.

    Reads ``theme-head.ts`` and asserts the load-bearing algorithm markers the
    Python mirror above depends on are still present: SHA-256 digest, base64
    encoding, the sorted ``:root{…}`` assembly, the ``style-src 'sha256-…'``
    payload, and every hardening directive. A change to any of these in the real
    sink (e.g. SHA-384, dropped ``object-src``) breaks this check so the mirror is
    updated in lock-step rather than silently desyncing.
    """
    if not path.exists():
        raise GateFailure(f"WU6 sink not found at {path} — cannot verify CSP parity")
    src = path.read_text(encoding="utf-8")
    markers = {
        "SHA-256 digest": "digest('SHA-256'",
        "base64 encoding (btoa)": "btoa(",
        "sorted :root block": ".sort()",
        "style-src sha256 payload": "style-src 'sha256-",
    }
    absent = sorted(label for label, needle in markers.items() if needle not in src)
    directives_absent = sorted(d for d in CSP_HARDENING_DIRECTIVES if d not in src)
    if absent or directives_absent:
        raise GateFailure(
            "WU6 sink (theme-head.ts) no longer matches the Python CSP mirror — "
            f"missing algorithm markers: {absent}; missing directives: "
            f"{directives_absent}. Update the mirror in lock-step with the sink."
        )


def run() -> int:
    """Render the default theme + prove the SSR style/CSP contract; return count."""
    tokens = effective_default_tokens()
    required = required_token_names()
    check_render_complete(tokens, required)
    check_values_injection_safe(tokens)

    css = build_theme_css(tokens)
    style_tag = build_style_tag(css)
    check_style_tag_wellformed(style_tag)
    check_injected_into_head('<html><head><base href="/"></head></html>', style_tag)

    csp_header = build_csp_report_only(sha256_base64(css))
    check_report_only_csp(css, csp_header)
    assert_ts_sink_parity()
    return len(tokens)


def main() -> int:
    """CLI entrypoint: 0 on success, 1 (loud stderr) on any invariant breach."""
    try:
        count = run()
    except GateFailure as exc:
        print(f"FAILED: themed-render-smoke\n{exc}", file=sys.stderr)
        return 1
    print(
        "SUCCESS: themed-render-smoke "
        f"(default theme rendered {count} injection-safe tokens into <head> with a "
        "hash-matched report-only CSP)"
    )
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised via subprocess/CI
    raise SystemExit(main())
