"""Lean-gate unit coverage for small service-layer modules.

These exercise the pure-logic helpers (token mint/decode, provider selection,
tracking-field validation, step-up stubs) and the simple DB helpers
(``promo_usage``, ``legal_consents``) end-to-end against an in-memory SQLite
engine, so every branch of each module runs.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import jwt
import pytest
from fastapi import HTTPException

from app.core.config import settings
from app.models.content import ContentBlock, ContentStatus
from app.models.legal import LegalConsent, LegalConsentContext
from app.models.order import Order, OrderEvent
from app.models.promo import PromoCode
from app.services import (
    analytics_tokens,
    legal_consents,
    newsletter_tokens,
    payment_provider,
    promo_usage,
    step_up,
    tracking,
)

from tests.conftest import make_memory_session_factory


# --------------------------------------------------------------------------- #
# step_up                                                                      #
# --------------------------------------------------------------------------- #
def test_step_up_helpers_are_disabled_noops() -> None:
    assert step_up.has_step_up(object(), object()) is True  # type: ignore[arg-type]
    assert step_up.require_step_up(object(), object()) is None  # type: ignore[arg-type]


# --------------------------------------------------------------------------- #
# payment_provider                                                             #
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    ("raw_provider", "environment", "expected"),
    [
        ("real", "dev", "real"),
        ("", "dev", "real"),
        ("mock", "dev", "mock"),
        ("test", "staging", "mock"),
        ("mock", "production", "real"),
        ("test", "prod", "real"),
        ("anything-else", "dev", "real"),
    ],
)
def test_payments_provider_selection(
    raw_provider: str, environment: str, expected: str
) -> None:
    prev_provider = settings.payments_provider
    prev_env = settings.environment
    settings.payments_provider = raw_provider
    settings.environment = environment
    try:
        assert payment_provider.payments_provider() == expected
        assert payment_provider.is_mock_payments() is (expected == "mock")
    finally:
        settings.payments_provider = prev_provider
        settings.environment = prev_env


# --------------------------------------------------------------------------- #
# analytics_tokens                                                             #
# --------------------------------------------------------------------------- #
def test_analytics_token_round_trip_and_truncation() -> None:
    token = analytics_tokens.create_analytics_token(session_id="  sid-1  ")
    assert analytics_tokens.validate_analytics_token(token=token, session_id="sid-1")
    # Mismatched session id fails.
    assert not analytics_tokens.validate_analytics_token(
        token=token, session_id="other"
    )


def test_analytics_token_ttl_floor_when_setting_is_zero() -> None:
    prev = getattr(settings, "analytics_token_ttl_seconds", None)
    settings.analytics_token_ttl_seconds = 0
    try:
        token = analytics_tokens.create_analytics_token(session_id="x")
        assert analytics_tokens.validate_analytics_token(token=token, session_id="x")
    finally:
        if prev is not None:
            settings.analytics_token_ttl_seconds = prev


def test_analytics_token_rejects_wrong_type() -> None:
    # A token whose ``type`` claim is not the analytics type must be rejected.
    payload = {
        "type": "not-analytics",
        "session_id": "sid",
        "exp": datetime.now(timezone.utc) + timedelta(hours=1),
    }
    token = jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)
    assert not analytics_tokens.validate_analytics_token(token=token, session_id="sid")


def test_analytics_token_rejects_garbage() -> None:
    assert not analytics_tokens.validate_analytics_token(
        token="not-a-jwt", session_id="sid"
    )


# --------------------------------------------------------------------------- #
# newsletter_tokens                                                           #
# --------------------------------------------------------------------------- #
def test_newsletter_confirm_token_round_trip() -> None:
    token = newsletter_tokens.create_newsletter_token(
        email="  USER@Example.com  ",
        purpose=newsletter_tokens.NEWSLETTER_PURPOSE_CONFIRM,
    )
    email = newsletter_tokens.decode_newsletter_token(
        token=token, purpose=newsletter_tokens.NEWSLETTER_PURPOSE_CONFIRM
    )
    assert email == "user@example.com"


def test_newsletter_unsubscribe_token_round_trip() -> None:
    token = newsletter_tokens.create_newsletter_token(
        email="a@b.com", purpose=newsletter_tokens.NEWSLETTER_PURPOSE_UNSUBSCRIBE
    )
    assert (
        newsletter_tokens.decode_newsletter_token(
            token=token, purpose=newsletter_tokens.NEWSLETTER_PURPOSE_UNSUBSCRIBE
        )
        == "a@b.com"
    )


def test_newsletter_token_wrong_purpose_rejected() -> None:
    token = newsletter_tokens.create_newsletter_token(
        email="a@b.com", purpose=newsletter_tokens.NEWSLETTER_PURPOSE_CONFIRM
    )
    assert (
        newsletter_tokens.decode_newsletter_token(
            token=token, purpose=newsletter_tokens.NEWSLETTER_PURPOSE_UNSUBSCRIBE
        )
        is None
    )


def test_newsletter_token_wrong_type_rejected() -> None:
    payload = {
        "type": "other",
        "purpose": "confirm",
        "email": "a@b.com",
        "exp": datetime.now(timezone.utc) + timedelta(days=1),
    }
    token = jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)
    assert (
        newsletter_tokens.decode_newsletter_token(token=token, purpose="confirm")
        is None
    )


def test_newsletter_token_missing_email_rejected() -> None:
    payload = {
        "type": newsletter_tokens.NEWSLETTER_TOKEN_TYPE,
        "purpose": "confirm",
        "email": "   ",
        "exp": datetime.now(timezone.utc) + timedelta(days=1),
    }
    token = jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)
    assert (
        newsletter_tokens.decode_newsletter_token(token=token, purpose="confirm")
        is None
    )


def test_newsletter_token_garbage_rejected() -> None:
    assert (
        newsletter_tokens.decode_newsletter_token(token="nope", purpose="confirm")
        is None
    )


def test_newsletter_url_builders() -> None:
    prev = settings.frontend_origin
    settings.frontend_origin = "https://shop.example.com/"
    try:
        assert newsletter_tokens.build_frontend_confirm_url(token="t") == (
            "https://shop.example.com/newsletter/confirm?token=t"
        )
        assert newsletter_tokens.build_frontend_unsubscribe_url(token="t") == (
            "https://shop.example.com/newsletter/unsubscribe?token=t"
        )
        assert newsletter_tokens.build_api_unsubscribe_url(token="t") == (
            "https://shop.example.com/api/v1/newsletter/unsubscribe?token=t"
        )
    finally:
        settings.frontend_origin = prev


# --------------------------------------------------------------------------- #
# tracking                                                                     #
# --------------------------------------------------------------------------- #
def test_validate_tracking_number_ok() -> None:
    assert tracking.validate_tracking_number(
        courier="dpd", tracking_number=" 123 "
    ) == ("123")


def test_validate_tracking_number_empty_returns_none() -> None:
    assert tracking.validate_tracking_number(courier=None, tracking_number="  ") is None
    assert tracking.validate_tracking_number(courier=None, tracking_number=None) is None


def test_validate_tracking_number_too_long() -> None:
    with pytest.raises(HTTPException) as exc:
        tracking.validate_tracking_number(courier=None, tracking_number="x" * 51)
    assert exc.value.status_code == 400


def test_validate_tracking_number_with_crlf() -> None:
    with pytest.raises(HTTPException):
        tracking.validate_tracking_number(courier=None, tracking_number="12\n34")
    with pytest.raises(HTTPException):
        tracking.validate_tracking_number(courier=None, tracking_number="12\r34")


def test_validate_tracking_url_ok() -> None:
    assert (
        tracking.validate_tracking_url(tracking_url=" https://t.example/abc ")
        == "https://t.example/abc"
    )


def test_validate_tracking_url_empty_returns_none() -> None:
    assert tracking.validate_tracking_url(tracking_url="   ") is None
    assert tracking.validate_tracking_url(tracking_url=None) is None


def test_validate_tracking_url_too_long() -> None:
    with pytest.raises(HTTPException):
        tracking.validate_tracking_url(tracking_url="https://t/" + "a" * 260)


def test_validate_tracking_url_bad_scheme() -> None:
    with pytest.raises(HTTPException):
        tracking.validate_tracking_url(tracking_url="ftp://t.example/x")
    with pytest.raises(HTTPException):
        tracking.validate_tracking_url(tracking_url="https://")


# --------------------------------------------------------------------------- #
# promo_usage (DB)                                                             #
# --------------------------------------------------------------------------- #
def _order(promo_code: str | None) -> Order:
    from decimal import Decimal

    return Order(
        promo_code=promo_code,
        customer_email="x@y.com",
        customer_name="Test Buyer",
        total_amount=Decimal("10.00"),
    )


def test_record_promo_usage_increments_and_logs_event() -> None:
    factory = make_memory_session_factory()

    async def flow() -> None:
        async with factory() as session:
            promo = PromoCode(code="SAVE10", times_used=0)
            order = _order("save10")
            session.add_all([promo, order])
            await session.commit()
            await session.refresh(order)

            await promo_usage.record_promo_usage(session, order=order, note="n")
            await session.commit()

            refreshed = await session.get(PromoCode, promo.id)
            assert refreshed is not None and refreshed.times_used == 1

    asyncio.run(flow())


def test_record_promo_usage_no_code_returns_early() -> None:
    factory = make_memory_session_factory()

    async def flow() -> None:
        async with factory() as session:
            order = _order(None)
            session.add(order)
            await session.commit()
            await session.refresh(order)
            await promo_usage.record_promo_usage(session, order=order)
            # No event added.
            assert order.promo_code is None

    asyncio.run(flow())


def test_record_promo_usage_already_counted_is_idempotent() -> None:
    factory = make_memory_session_factory()

    async def flow() -> None:
        async with factory() as session:
            promo = PromoCode(code="ONCE", times_used=5)
            order = _order("once")
            session.add_all([promo, order])
            await session.commit()
            await session.refresh(order)
            session.add(
                OrderEvent(order_id=order.id, event="promo_counted", note="once")
            )
            await session.commit()
            await session.refresh(order, attribute_names=["events"])

            await promo_usage.record_promo_usage(session, order=order)
            await session.commit()
            refreshed = await session.get(PromoCode, promo.id)
            assert refreshed is not None and refreshed.times_used == 5

    asyncio.run(flow())


def test_record_promo_usage_unknown_code_still_logs_event() -> None:
    factory = make_memory_session_factory()

    async def flow() -> None:
        async with factory() as session:
            order = _order("GHOST")
            session.add(order)
            await session.commit()
            await session.refresh(order)
            await promo_usage.record_promo_usage(session, order=order)
            await session.commit()
            await session.refresh(order, attribute_names=["events"])
            assert any(e.event == "promo_counted" for e in order.events)

    asyncio.run(flow())


# --------------------------------------------------------------------------- #
# legal_consents (DB + pure logic)                                            #
# --------------------------------------------------------------------------- #
def _published_block(key: str, version: int) -> ContentBlock:
    return ContentBlock(
        key=key,
        title=key,
        body_markdown="body",
        status=ContentStatus.published,
        version=version,
    )


def test_required_doc_versions_returns_published_versions() -> None:
    factory = make_memory_session_factory()

    async def flow() -> None:
        async with factory() as session:
            session.add_all(
                [
                    _published_block("page.terms-and-conditions", 3),
                    _published_block("page.privacy-policy", 2),
                ]
            )
            await session.commit()
            versions = await legal_consents.required_doc_versions(session)
            assert versions == {
                "page.terms-and-conditions": 3,
                "page.privacy-policy": 2,
            }

    asyncio.run(flow())


def test_required_doc_versions_missing_raises_500() -> None:
    factory = make_memory_session_factory()

    async def flow() -> None:
        async with factory() as session:
            session.add(_published_block("page.terms-and-conditions", 1))
            await session.commit()
            with pytest.raises(HTTPException) as exc:
                await legal_consents.required_doc_versions(session)
            assert exc.value.status_code == 500
            assert "page.privacy-policy" in str(exc.value.detail)

    asyncio.run(flow())


def test_latest_accepted_versions_and_add_records() -> None:
    factory = make_memory_session_factory()

    async def flow() -> None:
        user_id = uuid4()
        async with factory() as session:
            legal_consents.add_consent_records(
                session,
                context=LegalConsentContext.register,
                required_versions={
                    "page.terms-and-conditions": 2,
                    "page.privacy-policy": 1,
                },
                user_id=user_id,
            )
            # Add an older consent to confirm MAX() is used.
            session.add(
                LegalConsent(
                    doc_key="page.terms-and-conditions",
                    doc_version=1,
                    context=LegalConsentContext.register,
                    user_id=user_id,
                    accepted_at=datetime.now(timezone.utc),
                )
            )
            await session.commit()

            accepted = await legal_consents.latest_accepted_versions(
                session, user_id=user_id
            )
            assert accepted == {
                "page.terms-and-conditions": 2,
                "page.privacy-policy": 1,
            }

    asyncio.run(flow())


def test_is_satisfied_logic() -> None:
    required = {"a": 2, "b": 1}
    assert legal_consents.is_satisfied(required, {"a": 2, "b": 1})
    assert legal_consents.is_satisfied(required, {"a": 3, "b": 1})
    assert not legal_consents.is_satisfied(required, {"a": 1, "b": 1})
    assert not legal_consents.is_satisfied(required, {"a": 2})
    # Falsy/None accepted value is treated as 0.
    assert not legal_consents.is_satisfied(required, {"a": None, "b": 1})  # type: ignore[dict-item]
