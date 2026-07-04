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
_URL_CALL = re.compile(r"url\(\s*(['\"]?)([^'\")]*)\1\s*\)", re.IGNORECASE)


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


# Closed base-token registry. Fallbacks are the compiled defaults derived from
# today's styles.css (in the frozen R G B / curated-enum / numeric wire format).
# Mirrors ``token-registry.ts`` BASE_TOKENS. Fallbacks pin the LIGHT compiled
# default; the dark reassignment lives in styles.css :root.dark. The role+state
# set keeps distinct core-surface shades distinct (P1a WU5 / WU0 memo §1A, §2);
# a full numeric ramp stays deferred to P2.
_BASE_TOKENS: dict[str, TokenEntry] = {
    "--background": _triplet_entry("255 255 255"),
    "--background-subtle": _triplet_entry("248 250 252"),
    "--surface": _triplet_entry("241 245 249"),
    "--surface-muted": _triplet_entry("248 250 252"),
    "--surface-raised": _triplet_entry("226 232 240"),
    "--surface-inverse": _triplet_entry("15 23 42"),
    "--surface-inverse-hover": _triplet_entry("30 41 59"),
    "--field": _triplet_entry("255 255 255"),
    "--text": _triplet_entry("51 65 85"),
    "--text-secondary": _triplet_entry("71 85 105"),
    "--text-inverse": _triplet_entry("255 255 255"),
    "--text-onmedia": _triplet_entry("255 255 255"),
    "--text-heading": _triplet_entry("15 23 42"),
    "--text-strong": _triplet_entry("30 41 59"),
    "--text-muted": _triplet_entry("100 116 139"),
    "--border": _triplet_entry("226 232 240"),
    "--border-muted": _triplet_entry("226 232 240"),
    "--border-strong": _triplet_entry("203 213 225"),
    "--border-inverse": _triplet_entry("15 23 42"),
    "--accent": _triplet_entry("79 70 229"),
    "--accent-strong": _triplet_entry("55 48 163"),
    "--accent-subtle": _triplet_entry("238 242 255"),
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


def resolve_token(name: str) -> TokenEntry | None:
    """Resolve a token NAME to its registry entry, or None to hard-reject it."""
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


def validate_token(name: str, value: str) -> ValidationResult:
    """Validate ``name``/``value`` -> accepted value, or a compiled default."""
    entry = resolve_token(name)
    if entry is None:
        return ValidationResult(False, "")
    encoded = encode_css_safe(value, entry.allow_url)
    if not encoded.ok:
        return ValidationResult(False, entry.fallback)
    if not entry.validate(encoded.value):
        return ValidationResult(False, entry.fallback)
    return ValidationResult(True, encoded.value)
