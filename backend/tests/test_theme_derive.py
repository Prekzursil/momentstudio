"""Tests for the shade / state token derivation (P1a WU4b-derive).

Proves (1) TS<->Python parity against the shared fixture, (2) the derived
compiled defaults reproduce today's styles.css :root, (3) the on-colours ALWAYS
contrast their background (the property that kills the white-on-white bypass),
and (4) derived keys are never editable + never accepted from input.
"""

from __future__ import annotations

import json
from pathlib import Path

from app.services.theme_contrast import contrast_ratio
from app.services.theme_derive import (
    DERIVED_COLOR_NAMES,
    PRIMARY_COLOR_NAMES,
    PRIMARY_DEFAULTS,
    best_on_color,
    derive_color_tokens,
    derive_tokens,
    format_triplet,
    parse_triplet,
)
from app.services.theme_validation import resolve_token

_FIXTURE = json.loads(
    (
        Path(__file__).parent.parent.parent
        / "test-fixtures"
        / "theme-derive-fixture.json"
    ).read_text()
)


def test_primary_derived_split_sizes() -> None:
    assert len(PRIMARY_COLOR_NAMES) == 9
    assert len(DERIVED_COLOR_NAMES) == 14
    assert not (set(PRIMARY_COLOR_NAMES) & set(DERIVED_COLOR_NAMES))


def test_primary_defaults_match_registry_fallback() -> None:
    for name in PRIMARY_COLOR_NAMES:
        entry = resolve_token(name)
        assert entry is not None
        assert entry.fallback == PRIMARY_DEFAULTS[name]


def test_derived_tokens_are_not_editable_keys() -> None:
    # The core of the fix: an admin has no editable key for any derived token.
    for name in DERIVED_COLOR_NAMES:
        assert resolve_token(name) is None


def test_parity_with_shared_fixture() -> None:
    for case in _FIXTURE["cases"]:
        got = derive_tokens(case["primaries"])
        assert got == _FIXTURE["expected"][case["name"]], case["name"]


def test_reproduces_compiled_default_styles_css() -> None:
    targets = {
        "--background-subtle": "248 250 252",
        "--surface-muted": "248 250 252",
        "--surface-raised": "226 232 240",
        "--surface-inverse-hover": "30 41 59",
        "--field": "255 255 255",
        "--text-secondary": "71 85 105",
        "--text-strong": "30 41 59",
        "--text-inverse": "255 255 255",
        "--text-onmedia": "255 255 255",
        "--border-muted": "226 232 240",
        "--border-strong": "203 213 225",
        "--border-inverse": "15 23 42",
        "--accent-strong": "55 48 163",
        "--accent-subtle": "238 242 255",
    }
    derived = derive_color_tokens(PRIMARY_DEFAULTS)
    for name, want in targets.items():
        got = parse_triplet(derived[name])
        target = parse_triplet(want)
        for i in range(3):
            assert abs(got[i] - target[i]) <= 4, (
                f"{name} channel {i}: {derived[name]} vs {want}"
            )


def test_parse_format_round_trip() -> None:
    assert format_triplet(parse_triplet("12 34 56")) == "12 34 56"
    assert parse_triplet("0 128 255") == (0, 128, 255)


def test_derive_tokens_passthrough_and_ignore_derived() -> None:
    out = derive_tokens(
        {
            **PRIMARY_DEFAULTS,
            "--font-body": "system-ui, sans-serif",
            "--surface-inverse-hover": "255 255 255",  # smuggled derived key
        }
    )
    assert out["--font-body"] == "system-ui, sans-serif"  # passthrough
    clean = derive_color_tokens(PRIMARY_DEFAULTS)
    assert out["--surface-inverse-hover"] == clean["--surface-inverse-hover"]
    assert out["--surface-inverse-hover"] != "255 255 255"


def test_derive_falls_back_to_defaults_for_missing_primaries() -> None:
    assert derive_color_tokens({}) == derive_color_tokens(PRIMARY_DEFAULTS)


def test_derive_color_tokens_returns_only_the_fourteen() -> None:
    assert sorted(derive_color_tokens(PRIMARY_DEFAULTS)) == sorted(DERIVED_COLOR_NAMES)


def test_best_on_color_light_and_dark_and_tie() -> None:
    assert best_on_color((15, 23, 42)) == (255, 255, 255)  # dark bg -> white
    assert best_on_color((255, 255, 255)) == (0, 0, 0)  # light bg -> black
    # Crossover ties to white; whatever wins must clear AA.
    assert contrast_ratio(best_on_color((118, 118, 118)), (118, 118, 118)) >= 4.5


def test_property_on_colors_always_clear_aa() -> None:
    # For ANY primary an admin could set, the derived on-colours are >= AA.
    worst = 21.0
    for seed in range(1, 4096):
        si = (seed * 73 % 256, seed * 149 % 256, seed * 211 % 256)
        ac = (seed * 17 % 256, seed * 101 % 256, seed * 199 % 256)
        prim = {"--surface-inverse": format_triplet(si), "--accent": format_triplet(ac)}
        derived = derive_color_tokens(prim)
        ti = contrast_ratio(parse_triplet(derived["--text-inverse"]), si)
        om = contrast_ratio(parse_triplet(derived["--text-onmedia"]), ac)
        worst = min(worst, ti, om)
    assert worst >= 4.5
