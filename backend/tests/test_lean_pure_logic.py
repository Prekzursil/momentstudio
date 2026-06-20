"""Lean-gate unit coverage for pure-logic modules with no DB/HTTP surface.

Covers ``core.metrics`` (thread-safe counters), the ``schemas.promo`` /
``schemas.user`` validators, and ``services.og_images`` (PIL rendering).
"""

from __future__ import annotations

import pytest

from app.core import metrics
from app.schemas.promo import PromoCodeCreate
from app.schemas.user import UserBase
from app.services import og_images


# --------------------------------------------------------------------------- #
# core.metrics                                                                 #
# --------------------------------------------------------------------------- #
def test_metrics_counters_and_snapshot() -> None:
    metrics.reset()
    metrics.record_signup()
    metrics.record_login_success()
    metrics.record_login_failure()
    metrics.record_order_created()
    metrics.record_payment_failure()
    metrics.record_signup()

    snap = metrics.snapshot()
    assert snap == {
        "signups": 2,
        "logins": 1,
        "login_failures": 1,
        "orders_created": 1,
        "payment_failures": 1,
    }

    metrics.reset()
    assert metrics.snapshot() == {}


# --------------------------------------------------------------------------- #
# schemas.promo                                                                #
# --------------------------------------------------------------------------- #
def test_promo_currency_validator_accepts_ron_uppercased() -> None:
    model = PromoCodeCreate(code="SAVE", percentage_off=10, currency="ron")
    assert model.currency == "RON"


def test_promo_currency_validator_allows_none() -> None:
    model = PromoCodeCreate(code="SAVE", amount_off=5)
    assert model.currency is None


def test_promo_currency_validator_none_branch_direct() -> None:
    # Pydantic skips validators for an unset default, so call the validator
    # directly to exercise its ``value is None -> return value`` branch.
    assert PromoCodeCreate.validate_currency(None) is None


def test_promo_currency_validator_rejects_other() -> None:
    with pytest.raises(ValueError, match="Only RON currency is supported"):
        PromoCodeCreate(code="SAVE", currency="USD")


def test_promo_currency_validator_empty_string_branch() -> None:
    # The field's min_length=3 blocks "" via the model, so exercise the
    # validator's defensive ``value or ""`` branch directly; an empty/blank
    # value is not "RON" and is rejected.
    with pytest.raises(ValueError, match="Only RON currency is supported"):
        PromoCodeCreate.validate_currency("")


# --------------------------------------------------------------------------- #
# schemas.user                                                                 #
# --------------------------------------------------------------------------- #
def test_user_phone_normalizer_accepts_e164() -> None:
    model = UserBase(email="a@b.com", phone="  +40723204204  ")
    assert model.phone == "+40723204204"


def test_user_phone_normalizer_none_passthrough() -> None:
    assert UserBase(email="a@b.com", phone=None).phone is None


def test_user_phone_normalizer_blank_becomes_none() -> None:
    assert UserBase(email="a@b.com", phone="   ").phone is None


def test_user_phone_normalizer_rejects_bad_format() -> None:
    with pytest.raises(ValueError, match="E.164"):
        UserBase(email="a@b.com", phone="0723-not-e164")


# --------------------------------------------------------------------------- #
# services.og_images                                                           #
# --------------------------------------------------------------------------- #
def _is_png(blob: bytes) -> bool:
    return blob[:8] == b"\x89PNG\r\n\x1a\n"


def test_og_image_basic_title_and_subtitle() -> None:
    blob = og_images.render_blog_post_og(
        title="A Short Title", subtitle="A helpful subtitle"
    )
    assert _is_png(blob) and len(blob) > 100


def test_og_image_defaults_when_blank() -> None:
    # Empty title falls back to "Blog"; empty subtitle skips the subtitle block.
    blob = og_images.render_blog_post_og(title="   ", subtitle="   ")
    assert _is_png(blob)


def test_og_image_long_title_triggers_font_shrink_and_wrap() -> None:
    # A very long title forces the while-loop that shrinks the font + re-wraps,
    # and clamps the rendered lines to the first three.
    long_title = " ".join(["LongWord"] * 40)
    blob = og_images.render_blog_post_og(title=long_title, subtitle=None)
    assert _is_png(blob)


def test_og_image_unbreakable_word_hits_fits_false_branch(monkeypatch) -> None:
    # ``fits`` returns False only when a line is wider than the text area. The
    # CI fonts (DejaVu TTF) scale with size; on hosts without them the module
    # falls back to PIL's non-scaling bitmap font, which never overflows. Pin a
    # real scalable font (PIL's sized default) so the early-return branch in
    # ``fits`` runs deterministically on every platform.
    from PIL import ImageFont

    def _scalable_font(size: int, *, bold: bool = False):
        return ImageFont.load_default(size=size)

    monkeypatch.setattr(og_images, "_load_font", _scalable_font)
    blob = og_images.render_blog_post_og(title="X" * 80, subtitle=None)
    assert _is_png(blob)
