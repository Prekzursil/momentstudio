"""WU13 security lane — the SINK / gate / derive regression net.

A black-box adversarial suite over the EXISTING theme system, driven by the
shared WU2 corpus (``test-fixtures/theme-token-corpus.json``). It is the
regression net for the whole 6-bypass saga: each historical bypass gets an
explicit test that turns RED if its fix is reverted. Nothing here mocks the gate
— it exercises the real validators, the real derivation, and the real
``/api/v1/theme`` endpoints.

Invariants asserted here (task items 1-4 + 6):

* **Defense in depth (item 1):** every corpus ``reject`` value is blocked at the
  strict draft-save gate (``validate_admin_editable``) AND re-blocked at the
  broad SSR-sink revalidator (``validate_token``); a malicious value on a real
  primary key is also rejected end-to-end through ``PUT /theme/draft``.
* **The ramp-gate (item 2):** a derived-token / numeric-ramp / wider-spacing key
  is NOT admin-settable — draft-save of any of them is 422. The numeric-ramp
  subset carries teeth: it is well-formed for its type, so ONLY the name-gate can
  reject it; if the ramp-gate were reverted to the broad sink resolver those keys
  would be accepted and reach the published ``:root`` (the latent white-on-white
  vector). A companion derive-guard test proves a smuggled derived value is
  recomputed, not trusted.
* **On-colors always meet AA (item 3):** the derived ``--text-inverse`` /
  ``--text-onmedia`` clear AA against any adversarial primary; a white
  ``--surface-inverse`` flips its on-color to black end-to-end.
* **Publish contrast gate (item 4):** a hostile primary that collapses a gated
  pairing is rejected 422 and does NOT flip the live theme.
* **No draft leak to unauth (item 6, backend half):** the public ``GET /theme``
  returns only the published document and never the saved-but-unpublished draft.
  (The hash-pinned ``<style>`` emission itself is the frontend SSR sink's job and
  is proven in ``frontend/src/server/theme-head.spec.ts``.)
"""

from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import select

from app.models.theme import Theme
from app.services.theme_contrast import contrast_ratio
from app.services.theme_derive import (
    DERIVED_COLOR_NAMES,
    PRIMARY_DEFAULTS,
    derive_tokens,
    parse_triplet,
)
from app.services.theme_validation import (
    ADMIN_EDITABLE_NAMES,
    validate_admin_editable,
    validate_token,
)

# The suite CONSUMES the WU2-owned corpus (it does not define it). Repo-root path
# is four parents up: security -> tests -> backend -> <repo root>.
_CORPUS_PATH = (
    Path(__file__).resolve().parents[3] / "test-fixtures" / "theme-token-corpus.json"
)
_CORPUS = json.loads(_CORPUS_PATH.read_text(encoding="utf-8"))
_CASES = _CORPUS["cases"]
_REJECT_CASES = [c for c in _CASES if c["expect"] == "reject"]
# Value-driven rejects whose NAME is itself admin-editable — these exercise the
# encoder / per-type validator END-TO-END through the real draft-save path.
_ADMIN_KEY_VALUE_REJECTS = [
    c for c in _REJECT_CASES if c["name"] in ADMIN_EDITABLE_NAMES
]

# Non-editable keys the ramp-gate must reject. Each value is WELL-FORMED for its
# type, so only the admin-name gate can reject it. The numeric-ramp / wider-space
# rows are the teeth: the broad sink resolver ACCEPTS them (SSR forward-compat),
# so they would slip through if draft-save stopped using the strict admin gate.
_RAMP_GATE_CASES: tuple[tuple[str, str], ...] = (
    ("--surface-inverse-hover", "255 255 255"),  # derived on-surface (WoW vector)
    ("--text-inverse", "255 255 255"),  # derived on-color
    ("--text-onmedia", "255 255 255"),  # derived on-color
    ("--border-inverse", "255 255 255"),  # derived
    ("--background-subtle", "255 255 255"),  # derived shade
    ("--field", "255 255 255"),  # derived
    ("--accent-strong", "0 0 0"),  # derived
    ("--background-50", "255 255 255"),  # numeric colour ramp step (teeth)
    ("--surface-800", "30 41 59"),  # numeric colour ramp step (teeth)
    ("--text-500", "100 116 139"),  # numeric colour ramp step (teeth)
    ("--border-200", "226 232 240"),  # numeric colour ramp step (teeth)
    ("--space-2xl", "3rem"),  # wider spacing ramp, not an anchor (teeth)
    ("--space-3xs", "0.125rem"),  # wider spacing ramp, not an anchor (teeth)
)


def _primaries() -> dict[str, str]:
    """The nine primary colour tokens at their compiled defaults."""
    return dict(PRIMARY_DEFAULTS)


def _case_id(case: dict[str, str]) -> str:
    return f"{case['name']}={case['value']!r}"


def _live_version(factory: Any) -> int:
    import asyncio

    async def _run() -> int:
        async with factory() as session:
            theme = (await session.execute(select(Theme).limit(1))).scalar_one()
            return theme.version

    return asyncio.run(_run())


# --------------------------------------------------------------------------- #
# Item 1 — defense in depth over the WU2 corpus
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "case", _REJECT_CASES, ids=[_case_id(c) for c in _REJECT_CASES]
)
def test_corpus_reject_blocked_at_admin_gate(case: dict[str, str]) -> None:
    # Layer 1: the strict draft-save / publish gate rejects every malicious value.
    result = validate_admin_editable(case["name"], case["value"])
    assert result.ok is False, case.get("why", "")


@pytest.mark.parametrize(
    "case", _REJECT_CASES, ids=[_case_id(c) for c in _REJECT_CASES]
)
def test_corpus_reject_re_blocked_at_ssr_sink(case: dict[str, str]) -> None:
    # Layer 2 (defense in depth): the broad SSR-sink revalidator ALSO rejects it,
    # so a value that somehow reached the sink still never emits.
    result = validate_token(case["name"], case["value"])
    assert result.ok is False, case.get("why", "")


@pytest.mark.parametrize(
    "case",
    _ADMIN_KEY_VALUE_REJECTS,
    ids=[_case_id(c) for c in _ADMIN_KEY_VALUE_REJECTS],
)
def test_corpus_malicious_value_rejected_at_draft_save(
    seeded_app: Any, admin_headers: Any, case: dict[str, str]
) -> None:
    # End-to-end: the malicious VALUE on a real primary/font/size/space key is
    # rejected 422 by the live endpoint (CSS breakout, unicode-escaped '<',
    # out-of-range triplet, unit injection, expression(), ... all covered).
    client = seeded_app["client"]
    headers = admin_headers(seeded_app["factory"])
    tokens = {**_primaries(), case["name"]: case["value"]}
    resp = client.put("/api/v1/theme/draft", json={"tokens": tokens}, headers=headers)
    assert resp.status_code == 422, resp.text
    assert case["name"] in resp.json()["detail"]["invalid"]


# --------------------------------------------------------------------------- #
# Item 2 — the ramp-gate (derived + numeric-ramp + wider-spacing keys)
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("key,value", _RAMP_GATE_CASES)
def test_ramp_gate_rejects_non_editable_key_at_draft_save(
    seeded_app: Any, admin_headers: Any, key: str, value: str
) -> None:
    # The value is well-formed for its type, so ONLY the admin-name gate can
    # reject it. Reverting the ramp-gate (draft-save via the BROAD resolve_token
    # sink) would ACCEPT the numeric-ramp / wider-space rows -> this test goes RED,
    # exactly catching the return of the white-on-white / ramp-step bypass.
    client = seeded_app["client"]
    headers = admin_headers(seeded_app["factory"])
    resp = client.put(
        "/api/v1/theme/draft",
        json={"tokens": {**_primaries(), key: value}},
        headers=headers,
    )
    assert resp.status_code == 422, resp.text
    assert key in resp.json()["detail"]["invalid"]


@pytest.mark.parametrize("key,value", _RAMP_GATE_CASES)
def test_ramp_gate_key_absent_from_admin_registry(key: str, value: str) -> None:
    # The name-level contract behind the endpoint behaviour above.
    assert key not in ADMIN_EDITABLE_NAMES
    assert validate_admin_editable(key, value).ok is False


def test_derive_guard_recomputes_smuggled_derived_value() -> None:
    # Defense in depth beyond the gate: even if a derived key were present in a
    # token doc, derive_tokens RECOMPUTES it from the primaries and never trusts
    # the smuggled value. Here a dark --text-inverse is smuggled onto a dark
    # --surface-inverse (an attempt at low-contrast text); derivation flips it to
    # the contrast on-color (white). Reverting the passthrough filter that drops
    # derived keys would leave the smuggled dark value in place -> this goes RED.
    smuggled = {
        **_primaries(),
        "--surface-inverse": "15 23 42",
        "--text-inverse": "15 23 42",
    }
    effective = derive_tokens(smuggled)
    assert effective["--text-inverse"] == "255 255 255"
    assert effective["--text-inverse"] != smuggled["--text-inverse"]


# --------------------------------------------------------------------------- #
# Item 3 — on-colors always meet AA for adversarial primaries
# --------------------------------------------------------------------------- #
def test_on_colors_always_meet_aa_for_adversarial_primaries() -> None:
    rng = random.Random(0xB1A5E)
    for _ in range(500):
        primaries = {
            name: f"{rng.randint(0, 255)} {rng.randint(0, 255)} {rng.randint(0, 255)}"
            for name in PRIMARY_DEFAULTS
        }
        effective = derive_tokens(primaries)
        for name in DERIVED_COLOR_NAMES:
            assert name in effective
        inverse = contrast_ratio(
            parse_triplet(effective["--text-inverse"]),
            parse_triplet(effective["--surface-inverse"]),
        )
        onmedia = contrast_ratio(
            parse_triplet(effective["--text-onmedia"]),
            parse_triplet(effective["--accent"]),
        )
        assert inverse >= 4.5, (effective["--surface-inverse"], inverse)
        assert onmedia >= 4.5, (effective["--accent"], onmedia)


def test_white_surface_inverse_flips_on_color_and_publishes(
    seeded_app: Any, admin_headers: Any
) -> None:
    # A white --surface-inverse is a legal PRIMARY edit; the derived --text-inverse
    # re-computes to BLACK for contrast (white-on-white unreachable), and because
    # --surface-inverse is in no GATED pairing the publish still passes.
    client = seeded_app["client"]
    headers = admin_headers(seeded_app["factory"])
    tokens = {**_primaries(), "--surface-inverse": "255 255 255"}
    save = client.put("/api/v1/theme/draft", json={"tokens": tokens}, headers=headers)
    assert save.status_code == 200, save.text
    effective = save.json()["tokens"]
    assert effective["--surface-inverse"] == "255 255 255"
    assert effective["--text-inverse"] == "0 0 0"
    publish = client.post("/api/v1/theme/publish", json={}, headers=headers)
    assert publish.status_code == 200, publish.text


# --------------------------------------------------------------------------- #
# Item 4 — the publish contrast gate
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "hostile,pairing",
    [
        ({"--text": "250 250 250"}, "text-on-background"),
        ({"--accent": "255 255 255"}, "accent-on-background"),
        ({"--text-heading": "252 252 252"}, "heading-on-background"),
    ],
)
def test_publish_rejects_hostile_primary_that_collapses_a_pairing(
    seeded_app: Any, admin_headers: Any, hostile: dict[str, str], pairing: str
) -> None:
    client = seeded_app["client"]
    factory = seeded_app["factory"]
    headers = admin_headers(factory)
    tokens = {**_primaries(), **hostile}
    # Individually a valid triplet, so the draft SAVES; the pairing collapse is
    # only visible over the DERIVED effective set at publish.
    save = client.put("/api/v1/theme/draft", json={"tokens": tokens}, headers=headers)
    assert save.status_code == 200, save.text
    publish = client.post("/api/v1/theme/publish", json={}, headers=headers)
    assert publish.status_code == 422, publish.text
    detail = publish.json()["detail"]
    assert detail["error"] == "contrast"
    assert pairing in {f["pairing"] for f in detail["failures"]}
    # Atomic all-or-nothing: the rejected publish left the live theme on v1.
    assert _live_version(factory) == 1


# --------------------------------------------------------------------------- #
# Item 6 (backend half) — the public read never leaks the unpublished draft
# --------------------------------------------------------------------------- #
def test_public_read_never_leaks_unpublished_draft(
    seeded_app: Any, admin_headers: Any
) -> None:
    client = seeded_app["client"]
    headers = admin_headers(seeded_app["factory"])
    # Save a draft with a distinctive accent but do NOT publish it.
    client.put(
        "/api/v1/theme/draft",
        json={"tokens": {**_primaries(), "--accent": "1 2 3"}},
        headers=headers,
    )
    # The public / SSR consumer (no auth) sees ONLY the published default.
    resp = client.get("/api/v1/theme")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "published"
    assert body["tokens"]["--accent"] == PRIMARY_DEFAULTS["--accent"]
    assert body["tokens"]["--accent"] != "1 2 3"
