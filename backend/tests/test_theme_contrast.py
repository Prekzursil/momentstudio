"""Tests for the server-side contrast maths + publish gate (P1a WU4b).

The maths mirrors ``frontend/src/app/core/theme/contrast.ts``; the gate
(:func:`evaluate_contrast`) runs over the DERIVED effective token set and catches
a hostile PRIMARY edit that collapses a gated pairing — the 422 path.
"""

from __future__ import annotations

import json
import random
from pathlib import Path

import pytest

from app.services.theme_contrast import (
    AA_BODY,
    AA_LARGE,
    CANVAS_BACKGROUNDS,
    ON_COLORS,
    PRIMARY_PAIRINGS,
    RENDER_PAIRINGS,
    bare_capable_foregrounds,
    contrast_ratio,
    evaluate_contrast,
    is_foreground_color_token,
    meets_aa,
    passes_aa,
    relative_luminance,
)
from app.services.theme_derive import (
    DERIVED_COLOR_NAMES,
    PRIMARY_COLOR_NAMES,
    PRIMARY_DEFAULTS,
    derive_tokens,
    parse_triplet,
)
from app.services.theme_service import default_theme_tokens

# The complete colour-token model — the SSOT is theme_derive (nine primaries + the
# fourteen derived tokens). The bare-capable foreground set is DERIVED from it, so a
# NEW foreground token flows into the obligations automatically (the anti-drift fix).
_ALL_COLOR_TOKENS: tuple[str, ...] = (*PRIMARY_COLOR_NAMES, *DERIVED_COLOR_NAMES)
_BARE_CAPABLE: tuple[str, ...] = bare_capable_foregrounds(_ALL_COLOR_TOKENS)

# The exact dark canvas-gradient theme (the 10th bypass): --accent-strong renders
# bare on the app-shell gradient and passes on --background but fails on the derived
# --background-subtle midpoint.
_DARK_10TH: dict[str, str] = {
    "--background": "34 0 6",
    "--surface": "106 39 154",
    "--accent": "18 217 97",
    "--surface-inverse": "129 132 214",
    "--text": "97 214 202",
    "--text-heading": "39 237 160",
    "--text-muted": "235 170 242",
    "--border": "230 170 186",
    "--overlay": "51 148 228",
}


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


def test_gate_catches_on_color_state_shade_bypass() -> None:
    # Contrast bypass #6: --surface-inverse=117 passes the BASE on-colour pairing
    # (white on 117 = 4.61) but its derived hover shade (127) renders white at
    # 4.00. The render-complete gate must catch the STATE-SHADE pair.
    tokens = derive_tokens({**default_theme_tokens(), "--surface-inverse": "117 117 117"})
    failures = evaluate_contrast(tokens)
    ids = {f.id for f in failures}
    assert "text-inverse-on-surface-inverse-hover" in ids
    # ...but the BASE on-colour pairing still passes (safe by construction).
    assert "text-inverse-on-surface-inverse" not in ids
    hover = next(f for f in failures if f.id == "text-inverse-on-surface-inverse-hover")
    assert hover.ratio < hover.target == AA_BODY


def test_gate_targets_heading_at_body_on_every_neutral_surface() -> None:
    # Contrast bypass #7: --text-heading=137 clears large (3.0) but colours BODY
    # text on --background/--surface/--field/--surface-muted. Every heading pairing
    # in the render-complete gate targets body (4.5) and fires.
    tokens = derive_tokens({**default_theme_tokens(), "--text-heading": "137 137 137"})
    failures = evaluate_contrast(tokens)
    heading = {f.id: f for f in failures if f.id.startswith("heading-on-")}
    assert "heading-on-background" in heading
    assert "heading-on-field" in heading
    assert "heading-on-surface" in heading
    for f in heading.values():
        assert f.size == "body"
        assert f.target == AA_BODY
        assert f.ratio < AA_BODY


def test_render_pairings_cover_every_rendered_derived_surface() -> None:
    # Render-completeness backstop (prevents bypass #8): every DERIVED surface the
    # storefront renders TEXT on MUST appear as a gated background, so a future
    # ungated state shade cannot silently reappear. Provenance: the audited
    # frontend/src render map (see RENDER_PAIRINGS docstring).
    gated_bg = {p.background for p in RENDER_PAIRINGS}
    rendered_text_surfaces = {
        "--background",
        "--surface",
        "--surface-muted",
        "--field",
        "--background-subtle",
        "--surface-inverse",
        "--surface-inverse-hover",
        "--accent",
        "--accent-subtle",
    }
    missing = rendered_text_surfaces - gated_bg
    assert not missing, f"ungated rendered surfaces (bypass #8 risk): {missing}"


def test_render_pairings_reference_present_tokens_and_pass_defaults() -> None:
    tokens = derive_tokens(default_theme_tokens())
    for pair in RENDER_PAIRINGS:
        assert pair.foreground in tokens, pair.id
        assert pair.background in tokens, pair.id
        assert pair.size in {"body", "large"}
    # The known-safe compiled defaults clear every render pairing.
    assert evaluate_contrast(tokens) == []


_CONTRAST_FIXTURE = json.loads(
    (
        Path(__file__).parent.parent.parent / "test-fixtures" / "theme-contrast-fixture.json"
    ).read_text()
)


def test_render_pairings_match_shared_parity_fixture() -> None:
    # TS<->Python parity: the Python gate list MUST equal the shared fixture (which
    # pairing-matrix.spec.ts asserts the TS list against), in order — a divergence
    # means the server gates one thing and the browser renders another.
    got = [
        {"id": p.id, "foreground": p.foreground, "background": p.background, "size": p.size}
        for p in RENDER_PAIRINGS
    ]
    assert got == _CONTRAST_FIXTURE["pairings"]


def test_gate_matches_shared_parity_fixture_cases() -> None:
    for case in _CONTRAST_FIXTURE["cases"]:
        effective = derive_tokens({**default_theme_tokens(), **case["primaries"]})
        got = sorted(f.id for f in evaluate_contrast(effective))
        assert got == case["failures"], case["name"]


# --------------------------------------------------------------------------- #
# BARE-CAPABLE FOREGROUND DERIVATION — the anti-drift backstop (root-cause fix)
# --------------------------------------------------------------------------- #
def test_is_foreground_color_token_classifies_the_model() -> None:
    # The --text* / --accent* family is ink; tinted surfaces and non-text tokens
    # are not. Exercises both name-prefix branches and the surface exclusion.
    assert is_foreground_color_token("--text") is True
    assert is_foreground_color_token("--accent") is True
    assert is_foreground_color_token("--text-inverse") is True  # foreground on-colour
    assert is_foreground_color_token("--accent-subtle") is False  # tinted SURFACE
    assert is_foreground_color_token("--background") is False  # not text/accent
    assert is_foreground_color_token("--border-inverse") is False  # edge, not ink


def test_bare_capable_foregrounds_derived_from_model_minus_on_colors() -> None:
    # DERIVED, not hand-listed: bare-capable = (every foreground colour token) −
    # (the on-colours), computed from the theme_derive model. A NEW foreground token
    # would appear here automatically.
    foregrounds = {c for c in _ALL_COLOR_TOKENS if is_foreground_color_token(c)}
    expected = foregrounds - ON_COLORS
    assert set(_BARE_CAPABLE) == expected
    # The concrete seven (pinned so the set is legible in review).
    assert set(_BARE_CAPABLE) == {
        "--text",
        "--text-heading",
        "--text-muted",
        "--text-secondary",
        "--text-strong",
        "--accent",
        "--accent-strong",
    }
    # On-colours (rendered only on their own surface) and the tinted --accent-subtle
    # surface are excluded — they never render bare on the page canvas.
    assert ON_COLORS.isdisjoint(_BARE_CAPABLE)
    assert "--accent-subtle" not in _BARE_CAPABLE


def _gated_pairs() -> set[tuple[str, str]]:
    return {(p.foreground, p.background) for p in RENDER_PAIRINGS}


def _canvas_obligations() -> set[tuple[str, str]]:
    return {(fg, bg) for fg in _BARE_CAPABLE for bg in CANVAS_BACKGROUNDS}


def test_render_gate_covers_every_bare_capable_foreground_on_both_endpoints() -> None:
    # THE BACKSTOP: every bare-capable foreground MUST be gated on BOTH canvas
    # gradient endpoints (--background AND --background-subtle). Derived from the
    # SAME taxonomy set, so if a foreground is un-gated on either endpoint this FAILS
    # — the exact defence the hand-maintained list kept forgetting (10 times).
    missing = _canvas_obligations() - _gated_pairs()
    assert not missing, f"un-gated canvas obligations (bypass-class risk): {missing}"


def test_canvas_block_is_exactly_seven_foregrounds_times_two_endpoints() -> None:
    canvas_rows = [
        p
        for p in RENDER_PAIRINGS
        if p.foreground in _BARE_CAPABLE and p.background in CANVAS_BACKGROUNDS
    ]
    assert len(canvas_rows) == 14  # 7 bare-capable foregrounds x 2 endpoints
    assert {(p.foreground, p.background) for p in canvas_rows} == _canvas_obligations()


def test_backstop_detects_a_dropped_canvas_endpoint() -> None:
    # Prove the backstop is load-bearing: drop the 10th pairing
    # (accent-strong-on-background-subtle) and the SAME obligation check must now
    # report it missing — so a future silent omission cannot pass unnoticed.
    dropped = tuple(
        p for p in RENDER_PAIRINGS if p.id != "accent-strong-on-background-subtle"
    )
    gated = {(p.foreground, p.background) for p in dropped}
    missing = _canvas_obligations() - gated
    assert missing == {("--accent-strong", "--background-subtle")}


# --------------------------------------------------------------------------- #
# 8th / 9th / 10th canvas-gradient exploit vectors (RED pre-fix)
# --------------------------------------------------------------------------- #
def test_gate_rejects_accent_strong_canvas_gradient_dark_10th() -> None:
    # The 10th bypass: --accent-strong renders bare on the app-shell gradient. On
    # this dark theme it PASSES on --background (5.22) but FAILS on the derived
    # --background-subtle midpoint (3.79). Pre-fix the -subtle pairing did not exist,
    # so the theme published; now it is a 422.
    effective = derive_tokens({**default_theme_tokens(), **_DARK_10TH})
    failures = {f.id for f in evaluate_contrast(effective)}
    assert "accent-strong-on-background-subtle" in failures
    assert "accent-strong-on-background" not in failures  # the old gate passed it


def test_gate_rejects_muted_on_background_subtle_8th() -> None:
    # The 8th bypass: a mid-grey --text-muted clears the white --background (4.51)
    # but not the slightly-darker --background-subtle (< 4.5). Only the -subtle
    # pairing fires — a clean single-pairing regression.
    effective = derive_tokens({**default_theme_tokens(), "--text-muted": "117 117 117"})
    failures = {f.id for f in evaluate_contrast(effective)}
    assert "muted-on-background-subtle" in failures
    assert "muted-on-background" not in failures


def test_gate_rejects_accent_on_background_subtle_9th() -> None:
    # The 9th bypass: --accent renders bare on the app-shell gradient. A mid-grey
    # accent passes on the white --background but fails on --background-subtle; the
    # new -subtle endpoint catches it (a pairing absent from the pre-fix gate).
    effective = derive_tokens({**default_theme_tokens(), "--accent": "116 116 116"})
    failures = {f.id for f in evaluate_contrast(effective)}
    assert "accent-on-background-subtle" in failures
    assert "accent-on-background" not in failures


# --------------------------------------------------------------------------- #
# Property fuzz — the numeric proof over random admin primaries
# --------------------------------------------------------------------------- #
def test_every_bare_capable_foreground_gated_over_random_admin_primaries() -> None:
    # Sample random admin PRIMARY sets; for every bare-capable foreground on EACH
    # canvas endpoint, compute the contrast and assert the gate's verdict matches:
    # a sub-AA pair MUST be returned by evaluate_contrast (it cannot silently pass).
    # Deterministic (seeded), no wall-clock — mirrors the TS seeded-LCG property.
    rng = random.Random(20260705)
    id_by_pair = {(p.foreground, p.background): p.id for p in RENDER_PAIRINGS}

    def rand_triplet() -> str:
        return f"{rng.randint(0, 255)} {rng.randint(0, 255)} {rng.randint(0, 255)}"

    for _ in range(400):
        primaries = {name: rand_triplet() for name in PRIMARY_DEFAULTS}
        effective = derive_tokens(primaries)
        failures = {f.id for f in evaluate_contrast(effective)}
        for fg in _BARE_CAPABLE:
            fg_rgb = parse_triplet(effective[fg])
            for endpoint in CANVAS_BACKGROUNDS:
                ratio = contrast_ratio(fg_rgb, parse_triplet(effective[endpoint]))
                if not meets_aa(ratio, "body"):
                    assert id_by_pair[(fg, endpoint)] in failures, (fg, endpoint, ratio)
