"""Python mirror tests for the shared theme-token validation core (P1a WU2).

Parity contract: this module runs the SAME repo-root corpus
(``test-fixtures/theme-token-corpus.json``) that the TypeScript spec
(``frontend/src/app/core/theme/token-validation.spec.ts``) consumes, so the
Python validator (``app.services.theme_validation``) and the TS validator
classify every case identically. Direct unit tests below cover the branches the
corpus cannot reach because no P1a token is literal-color- or url-typed
(``is_color_literal``, ``is_allowed_url``, the ``allow_url`` encoder path) plus
the CSS-escape decoder edge cases.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import pytest

from app.services.theme_validation import (
    ADMIN_EDITABLE_NAMES,
    decode_css_escapes,
    encode_css_safe,
    is_allowed_url,
    is_color_literal,
    is_color_triplet,
    is_font_family,
    is_numeric_length,
    resolve_admin_editable,
    resolve_token,
    validate_admin_editable,
    validate_token,
)

_CORPUS_PATH = (
    Path(__file__).resolve().parents[2] / "test-fixtures" / "theme-token-corpus.json"
)
_CORPUS = json.loads(_CORPUS_PATH.read_text(encoding="utf-8"))
_CASES = _CORPUS["cases"]


def _case_id(case: dict[str, str]) -> str:
    return f"{case['expect']}:{case['name']}={case['value']!r}"


@pytest.mark.parametrize("case", _CASES, ids=[_case_id(c) for c in _CASES])
def test_corpus_classification(case: dict[str, str]) -> None:
    result = validate_token(case["name"], case["value"])
    assert result.ok is (case["expect"] == "ok"), case.get("why", "")
    if result.ok:
        # An accepted value is emitted verbatim (post decode-first pass).
        assert result.value == case["value"]
    else:
        # A rejected value is NEVER emitted; it degrades to a compiled default
        # (a per-token fallback, or empty for an unknown/invalid name).
        assert result.value != case["value"]


def test_unknown_name_emits_empty_default() -> None:
    result = validate_token("--not-a-real-token", "1 2 3")
    assert result.ok is False
    assert result.value == ""


def test_known_name_bad_value_falls_back_to_compiled_default() -> None:
    entry = resolve_token("--text")
    assert entry is not None
    result = validate_token("--text", "300 0 0")
    assert result.ok is False
    assert result.value == entry.fallback


def test_resolve_token_paths() -> None:
    # The BROAD (sink-acceptable) resolver still accepts the server-emitted ramp
    # — the SSR sink re-validation keeps forward-compat with WU5/WU6.
    assert resolve_token("--bad name") is None  # name regex reject
    assert resolve_token("--background") is not None  # base token
    ramp = resolve_token("--surface-300")  # color ramp (sink-acceptable)
    assert ramp is not None and ramp.validate is is_color_triplet
    space = resolve_token("--space-xl")  # spacing ramp (sink-acceptable)
    assert space is not None and space.validate is is_numeric_length
    assert resolve_token("--text-42") is None  # ramp shade not in enum


def test_resolve_admin_editable_split() -> None:
    # The STRICT admin gate accepts ONLY primaries + fonts + size + the five
    # spacing anchors; the numeric colour ramp, the wider --space-* ramp, and
    # every derived shade / state token are sink-acceptable but NOT admin-settable.
    assert resolve_admin_editable("--bad name") is None  # name regex reject
    primary = resolve_admin_editable("--background")  # primary colour
    assert primary is not None and primary.validate is is_color_triplet
    font = resolve_admin_editable("--font-body")
    assert font is not None and font.validate is is_font_family
    anchor = resolve_admin_editable("--space-md")  # admin-controllable anchor
    assert anchor is not None and anchor.validate is is_numeric_length
    # Sink-acceptable but rejected by the admin gate:
    assert resolve_token("--surface-300") is not None  # sink says yes
    assert resolve_admin_editable("--surface-300") is None  # admin says no (ramp)
    assert resolve_token("--space-2xl") is not None  # sink says yes
    assert resolve_admin_editable("--space-2xl") is None  # admin says no (ramp)
    assert resolve_admin_editable("--surface-muted") is None  # derived shade
    assert resolve_admin_editable("--surface-inverse-hover") is None  # derived state


def test_admin_editable_names_is_the_exact_pinned_set() -> None:
    # PINNING guard: the admin-settable key set is EXACTLY this list. Adding or
    # removing a control (widening the bypass surface, or dropping a real control)
    # must fail here. It is the guard that would have caught the ramp bypass.
    assert ADMIN_EDITABLE_NAMES == frozenset(
        {
            # 9 primary colours
            "--background",
            "--surface",
            "--surface-inverse",
            "--text",
            "--text-heading",
            "--text-muted",
            "--border",
            "--accent",
            "--overlay",
            # 3 font / size
            "--font-body",
            "--font-heading",
            "--font-size-base",
            # 5 spacing anchors (NOT the wider --space-* ramp)
            "--space-xs",
            "--space-sm",
            "--space-md",
            "--space-lg",
            "--space-xl",
        }
    )


@pytest.mark.parametrize(
    "name,value",
    [
        ("--background-50", "255 255 255"),  # numeric colour ramp step
        ("--surface-800", "30 41 59"),  # numeric colour ramp step
        ("--space-2xl", "3rem"),  # wider spacing ramp (not an anchor)
        ("--surface-muted", "248 250 252"),  # derived shade
        ("--surface-inverse-hover", "255 255 255"),  # derived state (bypass class)
        ("--text-inverse", "255 255 255"),  # derived on-colour
        ("--not-a-token", "1 2 3"),  # unknown
    ],
)
def test_validate_admin_editable_rejects_non_admin_keys(name: str, value: str) -> None:
    # The vector: each of these is accepted by the BROAD sink validator but MUST
    # be rejected by the admin draft-save / publish gate.
    assert validate_admin_editable(name, value).ok is False


@pytest.mark.parametrize(
    "name,value",
    [
        ("--background", "255 255 255"),  # primary colour
        ("--font-heading", "Cinzel, ui-serif, Georgia, serif"),  # font enum
        ("--font-size-base", "1rem"),  # size
        ("--space-lg", "1.5rem"),  # spacing anchor
    ],
)
def test_validate_admin_editable_accepts_editable_keys(name: str, value: str) -> None:
    result = validate_admin_editable(name, value)
    assert result.ok is True
    assert result.value == value


def test_validate_admin_editable_known_key_bad_value_falls_back() -> None:
    # A known editable key with an invalid value degrades to its compiled default
    # (the fallback branch), never emitting the tainted input.
    result = validate_admin_editable("--space-md", "16")  # missing unit
    assert result.ok is False
    assert result.value == resolve_admin_editable("--space-md").fallback


def test_color_triplet_validator() -> None:
    assert is_color_triplet("0 0 0") is True
    assert is_color_triplet("255 255 255") is True
    assert is_color_triplet("15 23 42") is True
    assert is_color_triplet("256 0 0") is False
    assert is_color_triplet("15 23") is False
    assert is_color_triplet("00 0 0") is False


def test_color_literal_validator() -> None:
    assert is_color_literal("#fff") is True
    assert is_color_literal("#ffff") is True
    assert is_color_literal("#0f172a") is True
    assert is_color_literal("#0f172aff") is True
    assert is_color_literal("rgb(15, 23, 42)") is True
    assert is_color_literal("rgba(15 23 42 / 8%)") is True
    assert is_color_literal("hsl(210 40% 20%)") is True
    assert is_color_literal("hsla(210deg 40% 20% / 50%)") is True
    assert is_color_literal("#12") is False
    assert is_color_literal("blue") is False
    assert is_color_literal("rgb()") is False


def test_font_family_validator() -> None:
    assert is_font_family("Inter, system-ui, -apple-system, sans-serif") is True
    assert is_font_family("Cinzel, ui-serif, Georgia, serif") is True
    assert is_font_family("Comic Sans MS") is False


def test_numeric_length_validator() -> None:
    assert is_numeric_length("16px") is True
    assert is_numeric_length("1.5rem") is True
    assert is_numeric_length(".5em") is True
    assert is_numeric_length("10%") is True
    assert is_numeric_length("clamp(15px, 1.2vw + 12px, 18px)") is True
    assert is_numeric_length("16") is False
    assert is_numeric_length("calc(16px + red)") is False
    assert is_numeric_length("rotate(1turn)") is False


def test_is_allowed_url() -> None:
    assert is_allowed_url("") is False
    assert is_allowed_url("/fonts/x.woff2") is True  # relative / self
    assert is_allowed_url("./x.woff2") is True
    assert is_allowed_url("https://cdn.example.com/f.woff2") is True
    assert is_allowed_url("http://cdn.example.com/f.woff2") is False
    assert is_allowed_url("data:text/css,x") is False
    assert is_allowed_url("javascript:alert(1)") is False
    assert is_allowed_url("https://[") is False  # malformed -> ValueError branch


def test_decode_css_escapes() -> None:
    assert decode_css_escapes("15 23 42") == "15 23 42"  # no escapes
    assert decode_css_escapes(r"\3c") == "<"  # hex escape
    assert decode_css_escapes("\\3c ") == "<"  # trailing whitespace consumed
    assert decode_css_escapes(r"\0") == "�"  # NULL -> replacement char
    assert decode_css_escapes(r"\ffffff") == "�"  # out of range -> replacement
    assert decode_css_escapes(r"\g") == "g"  # literal (non-hex) escape


def test_encode_css_safe_reject_branches() -> None:
    assert encode_css_safe("15 23\x0142").ok is False  # control char
    assert encode_css_safe("a<b").ok is False
    assert encode_css_safe("a{b").ok is False
    assert encode_css_safe("a}b").ok is False
    assert encode_css_safe("a;b").ok is False
    assert encode_css_safe("@import url(x)").ok is False
    assert encode_css_safe("expression(alert(1))").ok is False
    assert encode_css_safe("javascript:alert(1)").ok is False
    assert encode_css_safe("url(https://a.com)").ok is False  # allow_url defaults False


def test_encode_css_safe_url_allowlist() -> None:
    assert encode_css_safe("url(https://a.com/f.woff2)", allow_url=True).ok is True
    assert encode_css_safe("url('/self.woff2')", allow_url=True).ok is True
    assert encode_css_safe("url(data:text/css,x)", allow_url=True).ok is False
    assert encode_css_safe("url(unclosed", allow_url=True).ok is False  # no match
    ok_result = encode_css_safe("15 23 42", allow_url=True)
    assert ok_result.ok is True
    assert ok_result.value == "15 23 42"


def test_encode_css_safe_url_matching_is_linear_not_redos() -> None:
    # Regression for CodeQL py/polynomial-redos: a ``url(`` prefix followed by
    # many ``url(!`` repetitions previously drove polynomial backtracking in the
    # ``_URL_CALL`` scan (the greedy target class ran to end-of-input at every
    # ``url(`` start, then backtracked hunting for a closing ``)``). The hardened
    # pattern (possessive quantifier + a target class that also excludes ``(``)
    # is linear, so this ~100k-char pathological input resolves near-instantly and
    # still hard-rejects (no closing ``)`` -> no match -> reject). A generous 1s
    # budget flags a regression (the vulnerable form takes many seconds here)
    # without being flaky (the fixed form is single-digit milliseconds).
    pathological = "url(" + "url(!" * 20000
    start = time.perf_counter()
    result = encode_css_safe(pathological, allow_url=True)
    elapsed = time.perf_counter() - start
    assert result.ok is False
    assert elapsed < 1.0, f"url() scan took {elapsed:.3f}s — possible ReDoS regression"


def test_encode_css_safe_url_rejects_unescaped_paren_target() -> None:
    # The hardened target class excludes ``(`` to match the CSS url-token grammar
    # (an unquoted ``url()`` value cannot contain an unescaped ``(``), so such
    # already-invalid values hard-reject (the scan finds no complete ``url(...)``).
    # This is a strict tightening on invalid CSS only; spec-valid targets below
    # still validate exactly as before.
    assert encode_css_safe("url(https://a.com/a(b).png)", allow_url=True).ok is False
    assert encode_css_safe("url(a(b))", allow_url=True).ok is False
    assert encode_css_safe("url(https://a.com/a-b.png)", allow_url=True).ok is True
    assert encode_css_safe("url(/self/a-b.woff2)", allow_url=True).ok is True
