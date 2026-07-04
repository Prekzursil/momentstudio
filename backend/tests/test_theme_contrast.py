"""Tests for the server-side contrast maths + publish gate (P1a WU4b).

The maths mirrors ``frontend/src/app/core/theme/contrast.ts``; the gate
(:func:`evaluate_contrast`) runs over the DERIVED effective token set and catches
a hostile PRIMARY edit that collapses a gated pairing — the 422 path.
"""

from __future__ import annotations

import pytest

from app.services.theme_contrast import (
    AA_BODY,
    AA_LARGE,
    PRIMARY_PAIRINGS,
    contrast_ratio,
    evaluate_contrast,
    meets_aa,
    passes_aa,
    relative_luminance,
)
from app.services.theme_derive import derive_tokens
from app.services.theme_service import default_theme_tokens


def test_known_contrast_ratios() -> None:
    assert contrast_ratio((0, 0, 0), (255, 255, 255)) == pytest.approx(21.0, abs=1e-6)
    assert contrast_ratio((255, 255, 255), (255, 255, 255)) == pytest.approx(1.0, abs=1e-9)


def test_relative_luminance_extremes_cover_both_linearize_branches() -> None:
    # channel 0 hits the `<= 0.03928` branch; channel 255 hits the power branch.
    assert relative_luminance((0, 0, 0)) == pytest.approx(0.0, abs=1e-9)
    assert relative_luminance((255, 255, 255)) == pytest.approx(1.0, abs=1e-9)


def test_meets_and_passes_aa_thresholds() -> None:
    assert meets_aa(AA_BODY, "body") is True
    assert meets_aa(AA_BODY - 0.01, "body") is False
    assert meets_aa(AA_LARGE, "large") is True
    assert passes_aa((0, 0, 0), (255, 255, 255), "body") is True
    assert passes_aa((250, 250, 250), (255, 255, 255), "body") is False


def test_gate_passes_on_compiled_defaults() -> None:
    tokens = derive_tokens(default_theme_tokens())
    assert evaluate_contrast(tokens) == []


def test_gate_catches_hostile_primary_edit() -> None:
    # A hostile --text near-white on the white --background collapses body copy.
    tokens = derive_tokens({**default_theme_tokens(), "--text": "250 250 250"})
    failures = evaluate_contrast(tokens)
    ids = {f.id for f in failures}
    assert "text-on-background" in ids
    failure = next(f for f in failures if f.id == "text-on-background")
    assert failure.ratio < failure.target
    assert failure.target == AA_BODY


def test_gate_catches_low_contrast_accent() -> None:
    # Accent link colour too pale against the surfaces it links on.
    tokens = derive_tokens({**default_theme_tokens(), "--accent": "230 230 230"})
    ids = {f.id for f in evaluate_contrast(tokens)}
    assert "accent-on-background" in ids


def test_every_gated_pairing_references_present_tokens() -> None:
    tokens = derive_tokens(default_theme_tokens())
    for pair in PRIMARY_PAIRINGS:
        assert pair.foreground in tokens
        assert pair.background in tokens
        assert pair.size in {"body", "large"}
