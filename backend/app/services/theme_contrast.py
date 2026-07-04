"""WCAG 2.x pairwise contrast maths + publish gate (P1a WU4b) — Python mirror.

The server-side twin of ``frontend/src/app/core/theme/contrast.ts``. Both sides
compute identical relative-luminance / contrast ratios so the admin client
guardrail and the server publish gate agree byte-for-byte.

The publish gate (:func:`evaluate_contrast`) runs over the DERIVED effective
token set — the primaries an admin submitted PLUS the shade/state tokens computed
from them (:mod:`app.services.theme_derive`) — and iterates :data:`RENDER_PAIRINGS`:
the RENDER-COMPLETE set of every ``(foreground-token, background-token)`` the
storefront actually paints text for, INCLUDING derived STATE shades, each tagged
with the STRICTEST size it renders at.

This closes the contrast-bypass CLASS. The earlier gate checked only the
primary-on-primary pairings and trusted the on-colours as "safe by construction",
but the set that actually renders is WIDER than the set that was gated:

* an on-colour is derived to contrast its BASE surface, yet also renders on that
  surface's derived STATE shade (``--text-inverse`` on the 7%-lighter
  ``--surface-inverse-hover``), which a near-crossover grey pushes below AA; and
* ``--text-heading`` was gated at ``large`` (3.0) but also colours BODY-size
  ``text-sm`` / ``text-xs`` elements (and the derived ``--field`` / ``--surface-muted``
  surfaces) that need 4.5.

The on-colours are STILL derived safe-by-construction (:func:`theme_derive.best_on_color`
keeps a dark inverse surface bearing white text); the gate is the render-complete
DEFENCE-IN-DEPTH boundary that rejects a surface too light to bear its intended
on-colour across ALL its shades, rather than silently recolouring it. A grey band
(``--surface-inverse`` n ~= 109-117) is exactly such a case and is now a 422.

:data:`PRIMARY_PAIRINGS` is retained as the curated admin-guardrail matrix (the
byte-for-byte mirror of ``pairing-matrix.ts`` ``PAIRINGS`` — primary-on-primary,
body + large); the authoritative publish gate is :data:`RENDER_PAIRINGS`.

Channels are integers 0-255 (the frozen ``R G B`` triplet wire format). Values
are assumed pre-validated by the token validator (WU2); this module is
arithmetic + selection only.
"""

from __future__ import annotations

from dataclasses import dataclass

RgbTriplet = tuple[int, int, int]

# WCAG AA minimum contrast ratios, selected by text size.
AA_BODY = 4.5  # normal body text
AA_LARGE = 3.0  # large text (>=18pt, or >=14pt bold)
AA_THRESHOLDS: dict[str, float] = {"body": AA_BODY, "large": AA_LARGE}


def _linearize(channel: int) -> float:
    """Linearise a single sRGB channel (0-255) to its 0-1 light intensity."""
    c = channel / 255
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4


def relative_luminance(color: RgbTriplet) -> float:
    """WCAG relative luminance of a colour in 0-1 (0 = black, 1 = white)."""
    r, g, b = color
    return 0.2126 * _linearize(r) + 0.7152 * _linearize(g) + 0.0722 * _linearize(b)


def contrast_ratio(a: RgbTriplet, b: RgbTriplet) -> float:
    """WCAG contrast ratio between two colours (1:1 .. 21:1). Symmetric."""
    la = relative_luminance(a)
    lb = relative_luminance(b)
    lighter = max(la, lb)
    darker = min(la, lb)
    return (lighter + 0.05) / (darker + 0.05)


def meets_aa(ratio: float, size: str) -> bool:
    """Whether a raw ratio meets the AA threshold for ``size`` (inclusive)."""
    return ratio >= AA_THRESHOLDS[size]


def passes_aa(foreground: RgbTriplet, background: RgbTriplet, size: str) -> bool:
    """Whether a fg/bg pair meets AA contrast for ``size`` (order-independent)."""
    return meets_aa(contrast_ratio(foreground, background), size)


def _parse_triplet(value: str) -> RgbTriplet:
    parts = value.split(" ")
    return (int(parts[0]), int(parts[1]), int(parts[2]))


@dataclass(frozen=True)
class Pairing:
    """A curated foreground-on-background pairing among PRIMARY surfaces."""

    id: str
    foreground: str
    background: str
    size: str


# The CURATED admin-guardrail matrix — a byte-for-byte mirror of
# ``pairing-matrix.ts`` PAIRINGS (FE/BE parity). Primary-on-primary only, tagged
# body / large as the admin live guardrail (``pairing-validator.ts``) documents.
# It is NOT the authoritative publish gate (that is RENDER_PAIRINGS below); it is
# kept for the client guardrail mirror and its structural test.
PRIMARY_PAIRINGS: tuple[Pairing, ...] = (
    Pairing("text-on-background", "--text", "--background", "body"),
    Pairing("heading-on-background", "--text-heading", "--background", "large"),
    Pairing("muted-on-background", "--text-muted", "--background", "body"),
    Pairing("text-on-surface", "--text", "--surface", "body"),
    Pairing("heading-on-surface", "--text-heading", "--surface", "large"),
    Pairing("accent-on-background", "--accent", "--background", "body"),
    Pairing("accent-on-surface", "--accent", "--surface", "body"),
)


# The RENDER-COMPLETE publish gate. Every row is a ``(foreground, background)``
# pair the storefront actually renders TEXT for — resolved over the DERIVED
# effective token set (so a DERIVED foreground such as ``--text-strong`` or a
# DERIVED background such as ``--surface-inverse-hover`` is a first-class endpoint)
# — tagged with the STRICTEST size it renders at. Mirrored byte-for-byte by
# ``pairing-matrix.ts`` RENDER_PAIRINGS. The audited render map (frontend/src/**)
# that grounds each row, with representative file:line:
#
#   --text            on --background (header:157) / --surface (product:278, hover
#                     header:180) / --surface-muted (product-card:138)              body
#   --text-muted      on --background (product-card:111)                            body
#   --text-secondary  on --background (footer:53) / --surface (shop:212) /
#                     --surface-muted (shop:280)                                    body
#   --text-strong     on --background (shop:93) / --surface (header:133) /
#                     --surface-muted (shop:706 hover)                              body
#   --text-heading    on --background (header:252, shop:999 text-sm) / --surface
#                     (header:180 hover) / --field (header:97, select styles.css:527)
#                     / --surface-muted (shop:1026 hover) / --background-subtle
#                     (app:40) — ALSO large (h1/h2 product:146); gated at BODY,
#                     the strictest, which subsumes large                           body
#   --accent          on --background (shop:75) / --surface                         body
#   --accent-strong   on --background (shop:715 hover) / --accent-subtle
#                     (header:696 maintenance banner)                               body
#   --text-inverse    on --surface-inverse (header:140/445, shop:536..) — safe by
#                     construction — AND on --surface-inverse-hover (shop:1019,
#                     file-input hover shop:293/310) — the STATE-SHADE bypass       body
#   --text-onmedia    on --accent (safe by construction; its gradient/scrim render
#                     surfaces are media-composited, not single-token gateable)     body
RENDER_PAIRINGS: tuple[Pairing, ...] = (
    Pairing("text-on-background", "--text", "--background", "body"),
    Pairing("text-on-surface", "--text", "--surface", "body"),
    Pairing("text-on-surface-muted", "--text", "--surface-muted", "body"),
    Pairing("muted-on-background", "--text-muted", "--background", "body"),
    Pairing("secondary-on-background", "--text-secondary", "--background", "body"),
    Pairing("secondary-on-surface", "--text-secondary", "--surface", "body"),
    Pairing("secondary-on-surface-muted", "--text-secondary", "--surface-muted", "body"),
    Pairing("strong-on-background", "--text-strong", "--background", "body"),
    Pairing("strong-on-surface", "--text-strong", "--surface", "body"),
    Pairing("strong-on-surface-muted", "--text-strong", "--surface-muted", "body"),
    Pairing("heading-on-background", "--text-heading", "--background", "body"),
    Pairing("heading-on-surface", "--text-heading", "--surface", "body"),
    Pairing("heading-on-field", "--text-heading", "--field", "body"),
    Pairing("heading-on-surface-muted", "--text-heading", "--surface-muted", "body"),
    Pairing("heading-on-background-subtle", "--text-heading", "--background-subtle", "body"),
    Pairing("accent-on-background", "--accent", "--background", "body"),
    Pairing("accent-on-surface", "--accent", "--surface", "body"),
    Pairing("accent-strong-on-background", "--accent-strong", "--background", "body"),
    Pairing("accent-strong-on-accent-subtle", "--accent-strong", "--accent-subtle", "body"),
    Pairing("text-inverse-on-surface-inverse", "--text-inverse", "--surface-inverse", "body"),
    Pairing(
        "text-inverse-on-surface-inverse-hover",
        "--text-inverse",
        "--surface-inverse-hover",
        "body",
    ),
    Pairing("text-onmedia-on-accent", "--text-onmedia", "--accent", "body"),
)


@dataclass(frozen=True)
class ContrastFailure:
    """One pairing that fails its AA target under the evaluated tokens."""

    id: str
    foreground: str
    background: str
    size: str
    ratio: float
    target: float


def evaluate_contrast(tokens: dict[str, str]) -> list[ContrastFailure]:
    """Return the render pairings that FAIL AA under ``tokens`` (empty = pass).

    ``tokens`` is the DERIVED effective set (primaries + computed shade/state
    tokens). Iterates the RENDER-COMPLETE :data:`RENDER_PAIRINGS`; every pairing
    references a token present in that set (primary OR derived); a failing pairing
    is returned actionably (measured ratio vs pinned target) so the publish path
    can reject with a 422 rather than a bare block.
    """

    failures: list[ContrastFailure] = []
    for pair in RENDER_PAIRINGS:
        fg = _parse_triplet(tokens[pair.foreground])
        bg = _parse_triplet(tokens[pair.background])
        ratio = contrast_ratio(fg, bg)
        target = AA_THRESHOLDS[pair.size]
        if not meets_aa(ratio, pair.size):
            failures.append(
                ContrastFailure(
                    id=pair.id,
                    foreground=pair.foreground,
                    background=pair.background,
                    size=pair.size,
                    ratio=ratio,
                    target=target,
                )
            )
    return failures
