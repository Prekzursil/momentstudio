"""Shade / state token DERIVATION (P1a WU4b-derive) — Python mirror.

The server-side twin of ``frontend/src/app/core/theme/theme-derive.ts``. Only the
NINE primary colour tokens are admin-editable; the fourteen shade / state tokens
are COMPUTED from those primaries here and can never be set by an admin — the fix
that eliminates the white-on-white bypass class.

The ON-COLOURS (``--text-inverse``, ``--text-onmedia``, ``--border-inverse``) are
derived to CONTRAST their background, so a failing pairing on those surfaces is
impossible by construction: ``max(contrast(black), contrast(white))`` against any
colour is always >= 4.58:1.

Colour maths runs in sRGB with per-channel linear interpolation and round-half-up
(``floor(x + 0.5)``), byte-identical to the TS ``Math.round`` for the 0-255
domain. The shared fixture (``test-fixtures/theme-derive-fixture.json``) proves
both sides emit the same output.
"""

from __future__ import annotations

import math

from app.services.theme_contrast import RgbTriplet, contrast_ratio

# The nine admin-editable primary colour tokens + their compiled-default R G B
# (source of truth). Each default equals the frozen WU2 registry fallback (a test
# asserts that parity) but is duplicated here so the pure derivation stays
# branch-free (no defensive "missing from registry" path to leave uncovered).
PRIMARY_DEFAULTS: dict[str, str] = {
    "--background": "255 255 255",
    "--surface": "241 245 249",
    "--surface-inverse": "15 23 42",
    "--text": "51 65 85",
    "--text-heading": "15 23 42",
    "--text-muted": "100 116 139",
    "--accent": "79 70 229",
    "--border": "226 232 240",
    "--overlay": "0 0 0",
}

# The nine admin-editable primary colour token names (source of truth).
PRIMARY_COLOR_NAMES: tuple[str, ...] = tuple(PRIMARY_DEFAULTS)

# The fourteen derived (computed, non-editable) colour token names.
DERIVED_COLOR_NAMES: tuple[str, ...] = (
    "--background-subtle",
    "--surface-muted",
    "--surface-raised",
    "--surface-inverse-hover",
    "--field",
    "--text-strong",
    "--text-secondary",
    "--accent-strong",
    "--accent-subtle",
    "--border-muted",
    "--border-strong",
    "--border-inverse",
    "--text-inverse",
    "--text-onmedia",
)

_BLACK: RgbTriplet = (0, 0, 0)
_WHITE: RgbTriplet = (255, 255, 255)


def _round_channel(value: float) -> int:
    """Round-half-up (matches TS ``Math.round`` for the non-negative domain)."""
    return math.floor(value + 0.5)


def parse_triplet(value: str) -> RgbTriplet:
    """Parse a frozen ``R G B`` triplet string into an sRGB tuple."""
    parts = value.split(" ")
    return (int(parts[0]), int(parts[1]), int(parts[2]))


def format_triplet(color: RgbTriplet) -> str:
    """Render an sRGB tuple back to the frozen ``R G B`` wire format."""
    return f"{color[0]} {color[1]} {color[2]}"


def _mix(a: RgbTriplet, b: RgbTriplet, t: float) -> RgbTriplet:
    """Per-channel linear interpolation a fraction ``t`` from ``a`` to ``b``."""
    return (
        _round_channel(a[0] + t * (b[0] - a[0])),
        _round_channel(a[1] + t * (b[1] - a[1])),
        _round_channel(a[2] + t * (b[2] - a[2])),
    )


def best_on_color(bg: RgbTriplet) -> RgbTriplet:
    """Black-or-white, whichever has greater WCAG contrast against ``bg``.

    Ties go to white. The chosen extreme always clears >= 4.58:1 (the black/white
    crossover minimum), so an on-colour is AA against ANY background.
    """
    return _WHITE if contrast_ratio(_WHITE, bg) >= contrast_ratio(_BLACK, bg) else _BLACK


# The frozen derivation table (mirror of ``DERIVATIONS`` in theme-derive.ts).
# Each value is (op, *args). Fractions reproduce today's styles.css :root values
# within a small tolerance (<= 4 / 255 per channel).
_DERIVATIONS: dict[str, tuple] = {
    "--background-subtle": ("mix", "--background", "--surface", 0.5),
    "--surface-muted": ("mix", "--surface", "--background", 0.5),
    "--surface-raised": ("mix", "--surface", "--border", 0.85),
    "--surface-inverse-hover": ("mix", "--surface-inverse", "--background", 0.07),
    "--field": ("mix", "--surface", "--background", 0.9),
    "--text-strong": ("mix", "--text", "--text-heading", 0.6),
    "--text-secondary": ("mix", "--text", "--text-muted", 0.4),
    "--accent-strong": ("mixblack", "--accent", 0.3),
    "--accent-subtle": ("mix", "--accent", "--background", 0.92),
    "--border-muted": ("mix", "--border", "--surface", 0.25),
    "--border-strong": ("mix", "--border", "--text", 0.114),
    "--border-inverse": ("copy", "--surface-inverse"),
    "--text-inverse": ("oncolor", "--surface-inverse"),
    "--text-onmedia": ("oncolor", "--accent"),
}


def _primary_value(primaries: dict[str, str], name: str) -> RgbTriplet:
    """Resolve a primary's current triplet, else its compiled default."""
    raw = primaries[name] if name in primaries else PRIMARY_DEFAULTS[name]
    return parse_triplet(raw)


def _compute_derived(derivation: tuple, primaries: dict[str, str]) -> RgbTriplet:
    op = derivation[0]
    if op == "mix":
        return _mix(
            _primary_value(primaries, derivation[1]),
            _primary_value(primaries, derivation[2]),
            derivation[3],
        )
    if op == "mixblack":
        return _mix(_primary_value(primaries, derivation[1]), _BLACK, derivation[2])
    if op == "copy":
        return _primary_value(primaries, derivation[1])
    # op == "oncolor"
    return best_on_color(_primary_value(primaries, derivation[1]))


def derive_color_tokens(primaries: dict[str, str]) -> dict[str, str]:
    """The ``name -> R G B`` map of ONLY the fourteen derived tokens."""
    out: dict[str, str] = {}
    for name in DERIVED_COLOR_NAMES:
        out[name] = format_triplet(_compute_derived(_DERIVATIONS[name], primaries))
    return out


def derive_tokens(input_tokens: dict[str, str]) -> dict[str, str]:
    """The full effective token map: editable tokens (primaries + fonts + spacing
    pass through) with the fourteen derived colour tokens COMPUTED and overlaid.

    Any derived key present in ``input_tokens`` is IGNORED and recomputed — a doc
    that tries to smuggle a derived value can never win; the source of truth is
    always the primaries.
    """
    derived_names = set(DERIVED_COLOR_NAMES)
    passthrough = {
        name: value for name, value in input_tokens.items() if name not in derived_names
    }
    return {**passthrough, **derive_color_tokens(input_tokens)}
