"""WCAG 2.x pairwise contrast maths + publish gate (P1a WU4b) — Python mirror.

The server-side twin of ``frontend/src/app/core/theme/contrast.ts``. Both sides
compute identical relative-luminance / contrast ratios so the admin client
guardrail and the server publish gate agree byte-for-byte.

The publish gate (:func:`evaluate_contrast`) runs over the DERIVED effective
token set — the primaries an admin submitted PLUS the shade/state tokens computed
from them (:mod:`app.services.theme_derive`). It gates the pairings among the
PRIMARY-editable surfaces (body/heading/muted/secondary text on background /
surface, accent as link text on background / surface). The on-colour pairings
(``--text-inverse`` on ``--surface-inverse``, ``--text-onmedia`` on ``--accent``)
are SAFE BY CONSTRUCTION — the on-colour is derived as black-or-white for maximum
contrast, always >= 4.58:1 — so they are asserted as always-pass rather than
gated, and documented here as why they cannot fail.

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


# The gated pairings — a byte-for-byte mirror of ``pairing-matrix.ts`` PAIRINGS
# (FE/BE parity). These place the PRIMARY-editable text colours on the
# PRIMARY-editable neutral surfaces; a hostile primary edit that collapses one of
# these (e.g. near-white --text on --background) is what the gate catches. The
# on-colour pairings are NOT listed: they are safe by construction (see module
# docstring). Derived text shades (--text-secondary / --text-strong) sit BETWEEN
# gated primary endpoints (--text and --text-muted / --text-heading), so they are
# bounded-safe once those endpoints pass — no separate gate row needed.
PRIMARY_PAIRINGS: tuple[Pairing, ...] = (
    Pairing("text-on-background", "--text", "--background", "body"),
    Pairing("heading-on-background", "--text-heading", "--background", "large"),
    Pairing("muted-on-background", "--text-muted", "--background", "body"),
    Pairing("text-on-surface", "--text", "--surface", "body"),
    Pairing("heading-on-surface", "--text-heading", "--surface", "large"),
    Pairing("accent-on-background", "--accent", "--background", "body"),
    Pairing("accent-on-surface", "--accent", "--surface", "body"),
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
    """Return the primary pairings that FAIL AA under ``tokens`` (empty = pass).

    ``tokens`` is the DERIVED effective set (primaries + computed shade/state
    tokens). Every gated pairing references a token present in that set; a
    failing pairing is returned actionably (measured ratio vs pinned target) so
    the publish path can reject with a 422 rather than a bare block.
    """

    failures: list[ContrastFailure] = []
    for pair in PRIMARY_PAIRINGS:
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
