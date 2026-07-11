"""Shared theme-token validation core (P1a WU2) — Python mirror.

This is the server-side twin of the TypeScript validator trio
(``frontend/src/app/core/theme/{token-registry,token-validation,css-safe-encode}.ts``).
Both sides share one allowlist and one corpus (``test-fixtures/theme-token-corpus.json``)
so a value accepted on the client is accepted identically on save, and a value
rejected on the client is rejected identically on save.

Design (see the WU0 spike memo §4 frozen wire format):

* A **closed property-NAME registry** — an admin may supply a value for a known
  key but may never introduce a key. Names are validated against
  ``^--[a-zA-Z0-9-]+$``; anything else hard-rejects.
* **Per-token-type value validators** — Tailwind-consumed color is a bare
  space-separated ``R G B`` triplet; non-Tailwind literal color is a
  hex/``rgb()``/``hsl()`` literal; ``font-family`` is a curated enum; sizes and
  spacing are numeric+unit (optionally a safe ``clamp()/min()/max()/calc()``).
* A **CSS-safe encoder** that decodes CSS unicode escapes FIRST (so an escaped
  payload cannot slip past) and then hard-rejects rule/selector breakouts,
  ``</style>``/``<``, control characters, ``@import``/``expression()`` and any
  ``url()`` outside an ``https:``/self allowlist.

Every rejection degrades to a compiled default rather than emitting a tainted
value.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass
from urllib.parse import urlsplit

TOKEN_NAME_PATTERN = re.compile(r"^--[a-zA-Z0-9-]+$")

# Curated font-family enum — never free text (blocks arbitrary @font-face / URLs).
FONT_FAMILY_ALLOWLIST: tuple[str, ...] = (
    "Inter, system-ui, -apple-system, sans-serif",
    "Cinzel, ui-serif, Georgia, serif",
    "system-ui, sans-serif",
    "ui-serif, Georgia, serif",
    "ui-monospace, SFMono-Regular, Menlo, monospace",
)

_CHANNEL = r"(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)"
_TRIPLET = re.compile(rf"^{_CHANNEL}(?: {_CHANNEL}){{2}}$")

_HEX = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
_RGB_FN = re.compile(r"^rgba?\(\s*[0-9.,%\s/]+\)$", re.IGNORECASE)
_HSL_FN = re.compile(r"^hsla?\(\s*[0-9.,%\s/deg]+\)$", re.IGNORECASE)

_SIMPLE_LENGTH = re.compile(
    r"^-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|vw|vh|vmin|vmax|%|ch|ex|pt)$",
)
_MATH_PREFIX = re.compile(r"^(?:clamp|min|max|calc)\(.+\)$")
_MATH_FUNC_NAMES = re.compile(r"\b(?:clamp|min|max|calc)\b")
_MATH_UNITS = re.compile(r"(?:px|rem|em|vw|vh|vmin|vmax|ch|ex|pt|%)")
_MATH_BODY = re.compile(r"^[-0-9.\s,+*/()]+$")

_SCHEME = re.compile(r"^[a-z][a-z0-9+.-]*:", re.IGNORECASE)

_HEX_ESCAPE = re.compile(r"\\([0-9a-fA-F]{1,6})[ \t\n\f\r]?")
_LITERAL_ESCAPE = re.compile(r"\\([^0-9a-fA-F])")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
# URL-target class excludes quotes, ``)``, ``(`` AND whitespace, matched
# possessively (``*+``). Two guarantees flow from this:
#   1. Linear time — the scan stops at the next ``(`` instead of running to
#      end-of-input and then backtracking, so ``url(`` followed by many ``url(!``
#      repetitions can no longer drive polynomial backtracking (CodeQL
#      py/polynomial-redos). The possessive ``*+`` additionally forbids ALL
#      backtracking into the class (its followers ``\1``/``\s*``/``\)`` are
#      disjoint from it, so this never changes what is matched).
#   2. Correctness — an unquoted ``url()`` value cannot contain an unescaped
#      ``(`` per the CSS url-token grammar, so excluding it only ever rejects
#      values that were already invalid CSS; every legitimate (spec-valid) value
#      classifies identically to before.
# Mirrors the frontend css-safe-encode URL_CALL (same class; JS has no possessive
# quantifier, but excluding ``(`` alone is linear and match-equivalent there).
_URL_CALL = re.compile(r"url\(\s*(['\"]?)([^'\")(\s]*+)\1\s*\)", re.IGNORECASE)


@dataclass(frozen=True)
class ValidationResult:
    """Outcome of validating a single token: accepted value or compiled default."""

    ok: bool
    value: str


@dataclass(frozen=True)
class EncodeResult:
    """Outcome of the CSS-safe encoder: safe (decoded) value or a rejection."""

    ok: bool
    value: str


@dataclass(frozen=True)
class TokenEntry:
    """A registry entry: the token's type, its value validator and safe default."""

    kind: str
    validate: Callable[[str], bool]
    fallback: str
    allow_url: bool


def is_color_triplet(value: str) -> bool:
    """True for a bare space-separated ``R G B`` triplet, each channel 0-255."""
    return bool(_TRIPLET.match(value))


def is_color_literal(value: str) -> bool:
    """True for a hex, ``rgb()``/``rgba()`` or ``hsl()``/``hsla()`` literal color."""
    return bool(_HEX.match(value) or _RGB_FN.match(value) or _HSL_FN.match(value))


def is_font_family(value: str) -> bool:
    """True only for an exact member of the curated font-family allowlist."""
    return value in FONT_FAMILY_ALLOWLIST


def is_numeric_length(value: str) -> bool:
    """True for a numeric+unit length or a safe clamp/min/max/calc expression."""
    if _SIMPLE_LENGTH.match(value):
        return True
    if not _MATH_PREFIX.match(value):
        return False
    stripped = _MATH_UNITS.sub("", _MATH_FUNC_NAMES.sub("", value))
    return bool(_MATH_BODY.match(stripped))


def is_allowed_url(raw: str) -> bool:
    """True for a self/relative URL or an absolute ``https:`` URL (origin parse)."""
    candidate = raw.strip()
    if candidate == "":
        return False
    if not _SCHEME.match(candidate):
        return True
    try:
        return urlsplit(candidate).scheme.lower() == "https"
    except ValueError:
        return False


def _decode_hex_escape(match: re.Match[str]) -> str:
    codepoint = int(match.group(1), 16)
    if codepoint == 0 or codepoint > 0x10FFFF:
        return "�"
    return chr(codepoint)


def decode_css_escapes(value: str) -> str:
    """Decode CSS numeric (``\\3c``) and literal (``\\g``) escapes to plain text."""
    decoded = _HEX_ESCAPE.sub(_decode_hex_escape, value)
    return _LITERAL_ESCAPE.sub(r"\1", decoded)


def encode_css_safe(value: str, allow_url: bool = False) -> EncodeResult:
    """Decode escapes first, then hard-reject any CSS breakout / injection sink."""
    decoded = decode_css_escapes(value)
    if _CONTROL.search(decoded):
        return EncodeResult(False, "")
    if "<" in decoded:
        return EncodeResult(False, "")
    if "{" in decoded or "}" in decoded or ";" in decoded:
        return EncodeResult(False, "")
    lowered = decoded.lower()
    if "@import" in lowered:
        return EncodeResult(False, "")
    if "expression(" in lowered:
        return EncodeResult(False, "")
    if "javascript:" in lowered:
        return EncodeResult(False, "")
    if "url(" in lowered:
        if not allow_url:
            return EncodeResult(False, "")
        matches = list(_URL_CALL.finditer(decoded))
        if not matches:
            return EncodeResult(False, "")
        for match in matches:
            if not is_allowed_url(match.group(2)):
                return EncodeResult(False, "")
    return EncodeResult(True, decoded)


def _triplet_entry(fallback: str) -> TokenEntry:
    return TokenEntry("color-triplet", is_color_triplet, fallback, False)


def _font_entry(fallback: str) -> TokenEntry:
    return TokenEntry("font-family", is_font_family, fallback, False)


def _numeric_entry(fallback: str) -> TokenEntry:
    return TokenEntry("numeric", is_numeric_length, fallback, False)


# Closed base-token registry — the ADMIN-EDITABLE set ONLY. Mirrors
# ``token-registry.ts`` BASE_TOKENS. Fallbacks pin the LIGHT compiled default; the
# dark reassignment lives in styles.css :root.dark.
#
# COLOUR SPLIT (the fix for the white-on-white bypass class): ONLY the NINE
# primary colour tokens are editable. The fourteen shade / state tokens are
# DERIVED from these primaries by ``theme_derive.py`` and are DELIBERATELY ABSENT
# here — so ``resolve_admin_editable`` (the draft-save / publish gate) rejects them
# as an unknown editable key and a draft-save that tries to set a shade / on-colour
# hard-rejects (the client-visible 422 path). NB: ``resolve_token`` (the broad SSR
# sink resolver) still accepts the server-emitted ramp for forward-compat — the
# admin gate is the strict :data:`ADMIN_EDITABLE_NAMES` subset, NOT this base map
# alone (the admin surface additionally exposes the five ``--space-*`` anchors).
# Derived on-colours always contrast their background by construction; primary
# pairings are gated at publish (``theme_contrast.py``).
_BASE_TOKENS: dict[str, TokenEntry] = {
    "--background": _triplet_entry("255 255 255"),
    "--surface": _triplet_entry("241 245 249"),
    "--surface-inverse": _triplet_entry("15 23 42"),
    "--text": _triplet_entry("51 65 85"),
    "--text-heading": _triplet_entry("15 23 42"),
    "--text-muted": _triplet_entry("100 116 139"),
    "--border": _triplet_entry("226 232 240"),
    "--accent": _triplet_entry("79 70 229"),
    "--overlay": _triplet_entry("0 0 0"),
    "--font-body": _font_entry("Inter, system-ui, -apple-system, sans-serif"),
    "--font-heading": _font_entry("Cinzel, ui-serif, Georgia, serif"),
    "--font-size-base": _numeric_entry("1rem"),
}

# Server-emitted derived-ramp names (WU5/WU6 precomputed shade ramp + spacing).
_COLOR_RAMP = re.compile(
    r"^--(background|surface|text|border)-"
    r"(?:50|100|200|300|400|500|600|700|800|900|950)$",
)
_SPACE_RAMP = re.compile(r"^--space-(?:3xs|2xs|xs|sm|md|lg|xl|2xl|3xl)$")
_RAMP_FALLBACK: dict[str, str] = {
    "background": "255 255 255",
    "surface": "241 245 249",
    "text": "51 65 85",
    "border": "226 232 240",
}

# The admin-controllable spacing anchors — the CLOSED subset of the ``--space-*``
# family that ships as a P1a admin control (mirrors the normal-tier ``space(...)``
# entries in ``token-taxonomy.ts`` SEED_TOKENS). The WIDER ``_SPACE_RAMP`` (the
# ``2xs`` / ``3xs`` / ``2xl`` / ``3xl`` steps) is server-emitted only and is
# DELIBERATELY not admin-settable. Fallbacks mirror the taxonomy compiled defaults.
_SPACE_ANCHOR_DEFAULTS: dict[str, str] = {
    "--space-xs": "0.5rem",
    "--space-sm": "0.75rem",
    "--space-md": "1rem",
    "--space-lg": "1.5rem",
    "--space-xl": "2rem",
}

# The CLOSED admin-editable registry — the ONLY names a draft-save / publish may
# set (``resolve_admin_editable`` / ``validate_admin_editable``). It is a STRICT
# SUBSET of ``resolve_token``: the twelve primary / font / size base tokens PLUS
# the five spacing anchors. It DELIBERATELY excludes the numeric colour ramp
# (``--background-50`` ...), the wider ``--space-*`` ramp, and every derived shade
# / state token — those are computed (``theme_derive``) or server-emitted, so an
# admin has no key to set them. THIS is the guard that closes the white-on-white
# bypass class end-to-end (a numeric ramp step reaching the published ``:root``).
_ADMIN_EDITABLE_TOKENS: dict[str, TokenEntry] = {
    **_BASE_TOKENS,
    **{
        name: _numeric_entry(default)
        for name, default in _SPACE_ANCHOR_DEFAULTS.items()
    },
}

#: The exact admin-settable token-name set (the pinning-test contract). Adding or
#: removing a key here changes the admin surface and MUST fail the pinning test.
ADMIN_EDITABLE_NAMES: frozenset[str] = frozenset(_ADMIN_EDITABLE_TOKENS)


def resolve_token(name: str) -> TokenEntry | None:
    """Resolve a token NAME to its registry entry, or None to hard-reject it.

    The BROAD (sink-acceptable) resolver: accepts base tokens, the server-emitted
    numeric colour ramp and the full ``--space-*`` ramp for forward-compat with
    the WU5/WU6 SSR sink (``theme-head`` re-validation). It is NOT the admin gate
    — use :func:`resolve_admin_editable` for the draft-save / publish path.
    """
    if not TOKEN_NAME_PATTERN.match(name):
        return None
    base = _BASE_TOKENS.get(name)
    if base is not None:
        return base
    ramp = _COLOR_RAMP.match(name)
    if ramp:
        return _triplet_entry(_RAMP_FALLBACK[ramp.group(1)])
    if _SPACE_RAMP.match(name):
        return _numeric_entry("1rem")
    return None


def resolve_admin_editable(name: str) -> TokenEntry | None:
    """Resolve an ADMIN-SETTABLE token NAME (draft-save / publish path), else None.

    STRICT subset of :func:`resolve_token`: primaries + fonts + size + the five
    spacing anchors ONLY. A numeric colour-ramp step, a wider ``--space-*`` ramp
    step, or any derived shade / state token resolves to ``None`` and hard-rejects
    — the admin can never set a computed / server-emitted token (bypass-class fix).
    """
    if not TOKEN_NAME_PATTERN.match(name):
        return None
    return _ADMIN_EDITABLE_TOKENS.get(name)


def _validate_entry(entry: TokenEntry | None, value: str) -> ValidationResult:
    """Run the shared decode-first CSS-safe encode + per-type value validation."""
    if entry is None:
        return ValidationResult(False, "")
    encoded = encode_css_safe(value, entry.allow_url)
    if not encoded.ok:
        return ValidationResult(False, entry.fallback)
    if not entry.validate(encoded.value):
        return ValidationResult(False, entry.fallback)
    return ValidationResult(True, encoded.value)


def validate_token(name: str, value: str) -> ValidationResult:
    """Validate ``name``/``value`` against the BROAD (sink) registry.

    Used by the SSR sink re-validation (``theme-head`` mirror) — accepts the
    server-emitted ramp names. NOT the admin gate: see :func:`validate_admin_editable`.
    """
    return _validate_entry(resolve_token(name), value)


def validate_admin_editable(name: str, value: str) -> ValidationResult:
    """Validate ``name``/``value`` against the STRICT admin-editable registry.

    The draft-save / publish gate: accepts ONLY the primaries + fonts + size +
    spacing anchors; the numeric ramp, wider spacing ramp and every derived token
    hard-reject (``ok=False``), so an admin can never persist a computed value.
    """
    return _validate_entry(resolve_admin_editable(name), value)
