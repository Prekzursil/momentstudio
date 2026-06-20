"""Worker-0 standalone coverage tests for ``app.services.admin_reports``.

Covers every parsing helper, period calculator, cooldown logic, DB aggregation
query and both orchestration entrypoints (``send_due_reports`` /
``send_report_now``) across all of their branches.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core import security
from app.db.base import Base
from app.models.catalog import Category, Product, ProductStatus
from app.models.content import ContentBlock, ContentStatus
from app.models.order import (
    Order,
    OrderItem,
    OrderRefund,
    OrderStatus,
    OrderTag,
)
from app.models.user import User, UserRole
from app.services import admin_reports
from app.services import email as email_service

UTC = timezone.utc


# --------------------------------------------------------------------------- #
# Pure helpers
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "value,fallback,expected",
    [
        (None, True, True),
        (True, False, True),
        (0, True, False),
        (3.5, False, True),
        ("YES", False, True),
        ("off", True, False),
        ("maybe", True, True),  # unrecognised string -> fallback
        (object(), False, False),  # unrecognised type -> fallback
    ],
)
def test_parse_bool(value, fallback, expected) -> None:
    assert admin_reports._parse_bool(value, fallback=fallback) is expected


def test_parse_int_all_branches() -> None:
    pi = admin_reports._parse_int
    assert pi(None, fallback=5) == 5
    assert pi(True, fallback=7) == 7  # bool excluded -> fallback
    assert pi(9, fallback=0) == 9
    assert pi(3.9, fallback=0) == 3  # float -> int
    assert pi("12", fallback=0) == 12
    assert pi("", fallback=4) == 4  # empty string -> fallback
    assert pi("nope", fallback=2) == 2  # bad string -> fallback
    assert pi(1, fallback=0, min_value=5) == 5  # clamp to min
    assert pi(99, fallback=0, max_value=10) == 10  # clamp to max
    assert pi([1, 2], fallback=8) == 8  # unhandled type -> fallback


def test_parse_int_float_failure(monkeypatch) -> None:
    class _BadFloat(float):
        def __int__(self):
            raise ValueError("boom")

    # A float subclass whose int() raises -> falls back.
    assert admin_reports._parse_int(_BadFloat(1.0), fallback=42) == 42


def test_parse_iso_dt() -> None:
    pdt = admin_reports._parse_iso_dt
    assert pdt(None) is None
    naive = datetime(2025, 1, 1, 8, 0)
    assert pdt(naive).tzinfo == UTC  # naive datetime gets UTC
    aware = datetime(2025, 1, 1, 8, 0, tzinfo=UTC)
    assert pdt(aware) == aware
    assert pdt(123) is None  # non-str, non-datetime
    assert pdt("   ") is None  # blank string
    assert pdt("2025-01-01T08:00:00Z") == datetime(2025, 1, 1, 8, 0, tzinfo=UTC)
    assert pdt("2025-01-01T08:00:00+02:00").utcoffset() == timedelta(hours=2)
    assert pdt("not-a-date") is None  # parse failure


def test_parse_recipients() -> None:
    pr = admin_reports._parse_recipients
    assert pr(None) == []
    assert pr(["A@Example.com", " ", "bad", "a@example.com"]) == ["a@example.com"]
    assert pr("x@a.com; y@b.com, x@a.com\nz@c.com") == [
        "x@a.com",
        "y@b.com",
        "z@c.com",
    ]


def test_weekly_period_end_adjusts_when_candidate_future() -> None:
    # now is Monday 06:00; target hour 08:00 is in the future -> go back a week.
    now = datetime(2025, 1, 6, 6, 0, tzinfo=UTC)  # Monday
    pe = admin_reports._weekly_period_end(now, weekday=0, hour_utc=8)
    assert pe == datetime(2024, 12, 30, 8, 0, tzinfo=UTC)

    # now is later same day -> candidate is in the past, keep it.
    now2 = datetime(2025, 1, 6, 10, 0, tzinfo=UTC)
    pe2 = admin_reports._weekly_period_end(now2, weekday=0, hour_utc=8)
    assert pe2 == datetime(2025, 1, 6, 8, 0, tzinfo=UTC)


def test_previous_month() -> None:
    assert admin_reports._previous_month(2025, 1) == (2024, 12)
    assert admin_reports._previous_month(2025, 5) == (2025, 4)


def test_monthly_period_end() -> None:
    # candidate in the future -> roll to previous month.
    now = datetime(2025, 3, 1, 6, 0, tzinfo=UTC)
    pe = admin_reports._monthly_period_end(now, day=1, hour_utc=8)
    assert pe == datetime(2025, 2, 1, 8, 0, tzinfo=UTC)

    # candidate in the past -> keep current month.
    now2 = datetime(2025, 3, 5, 6, 0, tzinfo=UTC)
    pe2 = admin_reports._monthly_period_end(now2, day=1, hour_utc=8)
    assert pe2 == datetime(2025, 3, 1, 8, 0, tzinfo=UTC)


def test_subtract_one_month() -> None:
    assert admin_reports._subtract_one_month(
        datetime(2025, 3, 15, 8, 0, tzinfo=UTC)
    ) == datetime(2025, 2, 15, 8, 0, tzinfo=UTC)


def test_cooldown_active_branches() -> None:
    ca = admin_reports._cooldown_active
    now = datetime(2025, 1, 8, 10, 0, tzinfo=UTC)
    pe = datetime(2025, 1, 6, 8, 0, tzinfo=UTC)

    # no last attempt -> not active
    assert ca(now=now, period_end=pe, last_attempt_at=None,
              last_attempt_period_end=pe, cooldown_minutes=60) is False
    # no last attempt period -> not active
    assert ca(now=now, period_end=pe, last_attempt_at=now,
              last_attempt_period_end=None, cooldown_minutes=60) is False
    # different period -> not active
    assert ca(now=now, period_end=pe, last_attempt_at=now,
              last_attempt_period_end=pe - timedelta(days=7),
              cooldown_minutes=60) is False
    # within cooldown -> active
    assert ca(now=now, period_end=pe, last_attempt_at=now - timedelta(minutes=5),
              last_attempt_period_end=pe, cooldown_minutes=60) is True
    # cooldown elapsed -> not active
    assert ca(now=now, period_end=pe,
              last_attempt_at=now - timedelta(minutes=120),
              last_attempt_period_end=pe, cooldown_minutes=60) is False


def test_parse_settings_defaults_and_state() -> None:
    settings_obj, state_obj = admin_reports._parse_settings(None)
    assert settings_obj.weekly_enabled is admin_reports.DEFAULT_WEEKLY_ENABLED
    assert settings_obj.recipients is None
    assert state_obj.weekly_last_error is None

    meta = {
        "reports_weekly_enabled": "true",
        "reports_recipients": ["a@example.com"],
        "reports_weekly_last_error": "  oops  ",
        "reports_monthly_last_error": "",
        "reports_weekly_last_sent_period_end": "2025-01-06T08:00:00Z",
    }
    s2, st2 = admin_reports._parse_settings(meta)
    assert s2.weekly_enabled is True
    assert s2.recipients == ["a@example.com"]
    assert st2.weekly_last_error == "oops"
    assert st2.monthly_last_error is None
    assert st2.weekly_last_sent_period_end == datetime(2025, 1, 6, 8, 0, tzinfo=UTC)


# --------------------------------------------------------------------------- #
# DB-backed helpers and orchestration
# --------------------------------------------------------------------------- #


def _make_session_local() -> async_sessionmaker:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    return async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False, autoflush=False
    )


async def _init(session_local: async_sessionmaker) -> None:
    engine = session_local.kw["bind"]
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def _seed_owner(session: AsyncSession, *, email="owner@example.com",
                      preferred_language="en") -> User:
    owner = User(
        email=email,
        username="owner",
        hashed_password=security.hash_password("Password123"),
        role=UserRole.owner,
        preferred_language=preferred_language,
    )
    session.add(owner)
    await session.flush()
    return owner


async def _seed_catalog(session: AsyncSession) -> tuple[Category, Product]:
    category = Category(slug="cat", name="Cat", sort_order=1, low_stock_threshold=10)
    session.add(category)
    await session.flush()
    product = Product(
        slug="product",
        name="Product",
        sku="SKU-1",
        base_price=50,
        currency="RON",
        category_id=category.id,
        stock_quantity=0,
        low_stock_threshold=4,
        is_active=True,
        is_deleted=False,
        status=ProductStatus.published,
    )
    session.add(product)
    await session.flush()
    return category, product


def _content_block(meta: dict) -> ContentBlock:
    return ContentBlock(
        key=admin_reports.REPORT_SETTINGS_KEY,
        title="Reports settings",
        body_markdown="",
        status=ContentStatus.published,
        meta=meta,
    )


@pytest.mark.anyio
async def test_compute_summary_top_products_low_stock() -> None:
    session_local = _make_session_local()
    await _init(session_local)
    start = datetime(2025, 1, 1, 0, 0, tzinfo=UTC)
    end = datetime(2025, 1, 31, 0, 0, tzinfo=UTC)

    async with session_local() as session:
        await _seed_owner(session)
        category, product = await _seed_catalog(session)

        paid = Order(
            status=OrderStatus.paid, total_amount=100, currency="RON",
            tax_amount=0, shipping_amount=0, fee_amount=0,
            customer_email="c@example.com", customer_name="C",
            created_at=datetime(2025, 1, 5, 12, 0, tzinfo=UTC),
        )
        refunded = Order(
            status=OrderStatus.refunded, total_amount=40, currency="RON",
            tax_amount=0, shipping_amount=0, fee_amount=0,
            customer_email="c2@example.com", customer_name="C2",
            created_at=datetime(2025, 1, 6, 12, 0, tzinfo=UTC),
        )
        refunded_missing = Order(
            status=OrderStatus.refunded, total_amount=30, currency="RON",
            tax_amount=0, shipping_amount=0, fee_amount=0,
            customer_email="c3@example.com", customer_name="C3",
            created_at=datetime(2025, 1, 7, 12, 0, tzinfo=UTC),
        )
        # Test-tagged order must be excluded from every aggregate.
        tagged = Order(
            status=OrderStatus.paid, total_amount=999, currency="RON",
            tax_amount=0, shipping_amount=0, fee_amount=0,
            customer_email="t@example.com", customer_name="T",
            created_at=datetime(2025, 1, 8, 12, 0, tzinfo=UTC),
        )
        session.add_all([paid, refunded, refunded_missing, tagged])
        await session.flush()
        session.add(OrderTag(order_id=tagged.id, tag="test"))
        session.add(OrderRefund(order_id=refunded.id, amount=Decimal("10")))
        session.add(
            OrderItem(
                order_id=paid.id, product_id=product.id, quantity=2,
                shipped_quantity=0, unit_price=50, subtotal=100,
                created_at=datetime(2025, 1, 5, 12, 0, tzinfo=UTC),
            )
        )
        await session.commit()

    async with session_local() as session:
        summary = await admin_reports._compute_summary(
            session, period_start=start, period_end=end
        )
        # gross = 100 + 40 + 30 (tagged 999 excluded)
        assert summary["gross_sales"] == Decimal("170")
        assert summary["refunds"] == Decimal("10")
        assert summary["missing_refunds"] == Decimal("30")
        # net = 170 - 10 - 30
        assert summary["net_sales"] == Decimal("130")
        assert summary["orders_total"] == 3
        assert summary["orders_success"] == 1
        assert summary["orders_refunded"] == 2

        top = await admin_reports._top_products(
            session, period_start=start, period_end=end, limit=5
        )
        assert top[0]["quantity"] == 2
        assert top[0]["gross_sales"] == Decimal("100")
        assert top[0]["name"] == "Product"

        low = await admin_reports._low_stock(session, limit=20)
        assert len(low) == 1
        assert low[0]["sku"] == "SKU-1"
        assert low[0]["is_critical"] is True  # stock 0 -> critical


@pytest.mark.anyio
async def test_effective_recipients_branches(monkeypatch) -> None:
    session_local = _make_session_local()
    await _init(session_local)

    # Explicit recipients short-circuit.
    async with session_local() as session:
        assert await admin_reports._effective_recipients(
            session, ["x@a.com"]
        ) == ["x@a.com"]

    # Owner email fallback.
    async with session_local() as session:
        await _seed_owner(session, email="OWNER@Example.com")
        await session.commit()
    async with session_local() as session:
        assert await admin_reports._effective_recipients(session, None) == [
            "owner@example.com"
        ]

    # No owner, settings.admin_alert_email fallback.
    empty_local = _make_session_local()
    await _init(empty_local)
    monkeypatch.setattr(
        admin_reports.settings, "admin_alert_email", "alert@a.com"
    )
    async with empty_local() as session:
        assert await admin_reports._effective_recipients(session, None) == [
            "alert@a.com"
        ]

    # No owner, no valid fallback -> empty.
    monkeypatch.setattr(admin_reports.settings, "admin_alert_email", "not-an-email")
    async with empty_local() as session:
        assert await admin_reports._effective_recipients(session, None) == []


@pytest.mark.anyio
async def test_send_report_email_owner_none(monkeypatch) -> None:
    """_send_report_email with no owner -> preferred_language stays None and one
    recipient fails to deliver."""
    session_local = _make_session_local()
    await _init(session_local)

    captured = {}

    async def fake_send(to_email, **kwargs):
        captured["lang"] = kwargs.get("lang")
        return to_email == "ok@a.com"

    monkeypatch.setattr(email_service, "send_admin_report_summary", fake_send)

    async with session_local() as session:
        attempted, delivered = await admin_reports._send_report_email(
            session,
            kind="weekly",
            period_start=datetime(2025, 1, 1, tzinfo=UTC),
            period_end=datetime(2025, 1, 8, tzinfo=UTC),
            recipients=["ok@a.com", "fail@a.com"],
            top_products_limit=5,
            low_stock_limit=20,
        )
    assert attempted == 2
    assert delivered == 1
    assert captured["lang"] is None


@pytest.mark.anyio
async def test_send_due_reports_smtp_disabled(monkeypatch) -> None:
    monkeypatch.setattr(admin_reports.settings, "smtp_enabled", False)
    session_local = _make_session_local()
    await _init(session_local)
    async with session_local() as session:
        assert await admin_reports.send_due_reports(session) is None


@pytest.mark.anyio
async def test_send_due_reports_no_block(monkeypatch) -> None:
    monkeypatch.setattr(admin_reports.settings, "smtp_enabled", True)
    session_local = _make_session_local()
    await _init(session_local)
    async with session_local() as session:
        await _seed_owner(session)
        await session.commit()
    async with session_local() as session:
        assert await admin_reports.send_due_reports(session) is None


@pytest.mark.anyio
async def test_send_due_reports_no_recipients(monkeypatch) -> None:
    monkeypatch.setattr(admin_reports.settings, "smtp_enabled", True)
    monkeypatch.setattr(admin_reports.settings, "admin_alert_email", None)
    session_local = _make_session_local()
    await _init(session_local)
    async with session_local() as session:
        # block present but no owner, no recipients, no alert email
        session.add(_content_block({"reports_weekly_enabled": True}))
        await session.commit()
    async with session_local() as session:
        assert await admin_reports.send_due_reports(session) is None


@pytest.mark.anyio
async def test_send_due_reports_weekly_and_monthly_delivered(monkeypatch) -> None:
    monkeypatch.setattr(admin_reports.settings, "smtp_enabled", True)

    async def fake_send(*args, **kwargs):
        return True

    monkeypatch.setattr(email_service, "send_admin_report_summary", fake_send)

    session_local = _make_session_local()
    await _init(session_local)
    async with session_local() as session:
        await _seed_owner(session)
        session.add(
            _content_block(
                {
                    "reports_weekly_enabled": True,
                    "reports_weekly_weekday": 0,
                    "reports_weekly_hour_utc": 8,
                    "reports_monthly_enabled": True,
                    "reports_monthly_day": 1,
                    "reports_monthly_hour_utc": 8,
                    "reports_recipients": ["a@example.com"],
                }
            )
        )
        await session.commit()

    now = datetime(2025, 1, 8, 10, 0, tzinfo=UTC)
    async with session_local() as session:
        await admin_reports.send_due_reports(session, now=now)
        block = (
            await session.execute(
                select(ContentBlock).where(
                    ContentBlock.key == admin_reports.REPORT_SETTINGS_KEY
                )
            )
        ).scalar_one()
        assert block.meta.get("reports_weekly_last_sent_period_end")
        assert block.meta.get("reports_monthly_last_sent_period_end")


@pytest.mark.anyio
async def test_send_due_reports_already_sent_and_cooldown(monkeypatch) -> None:
    monkeypatch.setattr(admin_reports.settings, "smtp_enabled", True)

    sent_calls = {"n": 0}

    async def fake_send(*args, **kwargs):  # pragma: no cover -- must not be called
        sent_calls["n"] += 1
        return True

    monkeypatch.setattr(email_service, "send_admin_report_summary", fake_send)

    now = datetime(2025, 1, 8, 10, 0, tzinfo=UTC)
    weekly_pe = admin_reports._weekly_period_end(now, weekday=0, hour_utc=8)
    monthly_pe = admin_reports._monthly_period_end(now, day=1, hour_utc=8)

    session_local = _make_session_local()
    await _init(session_local)
    async with session_local() as session:
        await _seed_owner(session)
        session.add(
            _content_block(
                {
                    "reports_weekly_enabled": True,
                    "reports_monthly_enabled": True,
                    "reports_recipients": ["a@example.com"],
                    # weekly already sent for this period -> "pass" branch
                    "reports_weekly_last_sent_period_end": weekly_pe.isoformat(),
                    # monthly within cooldown -> "pass" branch
                    "reports_monthly_last_attempt_at": now.isoformat(),
                    "reports_monthly_last_attempt_period_end": monthly_pe.isoformat(),
                    "reports_retry_cooldown_minutes": 120,
                }
            )
        )
        await session.commit()

    async with session_local() as session:
        await admin_reports.send_due_reports(session, now=now)
    assert sent_calls["n"] == 0


@pytest.mark.anyio
async def test_send_due_reports_both_disabled(monkeypatch) -> None:
    """weekly_enabled False -> skip to monthly; monthly_enabled False -> exit."""
    monkeypatch.setattr(admin_reports.settings, "smtp_enabled", True)

    async def fake_send(*args, **kwargs):  # pragma: no cover -- must not be called
        return True

    monkeypatch.setattr(email_service, "send_admin_report_summary", fake_send)

    session_local = _make_session_local()
    await _init(session_local)
    async with session_local() as session:
        await _seed_owner(session)
        session.add(
            _content_block(
                {
                    "reports_weekly_enabled": False,
                    "reports_monthly_enabled": False,
                    "reports_recipients": ["a@example.com"],
                }
            )
        )
        await session.commit()

    now = datetime(2025, 1, 8, 10, 0, tzinfo=UTC)
    async with session_local() as session:
        assert await admin_reports.send_due_reports(session, now=now) is None


@pytest.mark.anyio
async def test_send_due_reports_weekly_cooldown_monthly_sent(monkeypatch) -> None:
    """weekly within cooldown -> pass (591); monthly already sent -> pass (635)."""
    monkeypatch.setattr(admin_reports.settings, "smtp_enabled", True)

    sent = {"n": 0}

    async def fake_send(*args, **kwargs):  # pragma: no cover -- must not be called
        sent["n"] += 1
        return True

    monkeypatch.setattr(email_service, "send_admin_report_summary", fake_send)

    now = datetime(2025, 1, 8, 10, 0, tzinfo=UTC)
    weekly_pe = admin_reports._weekly_period_end(now, weekday=0, hour_utc=8)
    monthly_pe = admin_reports._monthly_period_end(now, day=1, hour_utc=8)

    session_local = _make_session_local()
    await _init(session_local)
    async with session_local() as session:
        await _seed_owner(session)
        session.add(
            _content_block(
                {
                    "reports_weekly_enabled": True,
                    "reports_monthly_enabled": True,
                    "reports_recipients": ["a@example.com"],
                    # weekly within cooldown (attempted recently, not yet sent)
                    "reports_weekly_last_attempt_at": now.isoformat(),
                    "reports_weekly_last_attempt_period_end": weekly_pe.isoformat(),
                    "reports_retry_cooldown_minutes": 120,
                    # monthly already sent for this period
                    "reports_monthly_last_sent_period_end": monthly_pe.isoformat(),
                }
            )
        )
        await session.commit()

    async with session_local() as session:
        await admin_reports.send_due_reports(session, now=now)
    assert sent["n"] == 0


@pytest.mark.anyio
async def test_send_due_reports_delivery_failure_records_error(monkeypatch) -> None:
    monkeypatch.setattr(admin_reports.settings, "smtp_enabled", True)

    async def fake_send(*args, **kwargs):
        return False  # all deliveries fail

    monkeypatch.setattr(email_service, "send_admin_report_summary", fake_send)

    session_local = _make_session_local()
    await _init(session_local)
    async with session_local() as session:
        await _seed_owner(session)
        session.add(
            _content_block(
                {
                    "reports_weekly_enabled": True,
                    "reports_monthly_enabled": True,
                    "reports_recipients": ["a@example.com"],
                }
            )
        )
        await session.commit()

    now = datetime(2025, 1, 8, 10, 0, tzinfo=UTC)
    async with session_local() as session:
        await admin_reports.send_due_reports(session, now=now)
        block = (
            await session.execute(
                select(ContentBlock).where(
                    ContentBlock.key == admin_reports.REPORT_SETTINGS_KEY
                )
            )
        ).scalar_one()
        assert "Delivery failed" in block.meta.get("reports_weekly_last_error", "")
        assert "Delivery failed" in block.meta.get("reports_monthly_last_error", "")


# --- send_report_now branches --- #


@pytest.mark.anyio
async def test_send_report_now_smtp_disabled(monkeypatch) -> None:
    monkeypatch.setattr(admin_reports.settings, "smtp_enabled", False)
    session_local = _make_session_local()
    await _init(session_local)
    async with session_local() as session:
        with pytest.raises(ValueError, match="SMTP is disabled"):
            await admin_reports.send_report_now(session, kind="weekly")


@pytest.mark.anyio
async def test_send_report_now_no_block(monkeypatch) -> None:
    monkeypatch.setattr(admin_reports.settings, "smtp_enabled", True)
    session_local = _make_session_local()
    await _init(session_local)
    async with session_local() as session:
        with pytest.raises(ValueError, match="not configured"):
            await admin_reports.send_report_now(session, kind="weekly")


@pytest.mark.anyio
async def test_send_report_now_no_recipients(monkeypatch) -> None:
    monkeypatch.setattr(admin_reports.settings, "smtp_enabled", True)
    monkeypatch.setattr(admin_reports.settings, "admin_alert_email", None)
    session_local = _make_session_local()
    await _init(session_local)
    async with session_local() as session:
        session.add(_content_block({"reports_weekly_enabled": True}))
        await session.commit()
    async with session_local() as session:
        with pytest.raises(ValueError, match="No report recipients"):
            await admin_reports.send_report_now(session, kind="weekly")


@pytest.mark.anyio
async def test_send_report_now_invalid_kind(monkeypatch) -> None:
    monkeypatch.setattr(admin_reports.settings, "smtp_enabled", True)
    session_local = _make_session_local()
    await _init(session_local)
    async with session_local() as session:
        await _seed_owner(session)
        session.add(_content_block({"reports_recipients": ["a@example.com"]}))
        await session.commit()
    async with session_local() as session:
        with pytest.raises(ValueError, match="Invalid report kind"):
            await admin_reports.send_report_now(session, kind="daily")


@pytest.mark.anyio
async def test_send_report_now_weekly_skipped_and_forced(monkeypatch) -> None:
    monkeypatch.setattr(admin_reports.settings, "smtp_enabled", True)

    async def fake_send(*args, **kwargs):
        return True

    monkeypatch.setattr(email_service, "send_admin_report_summary", fake_send)

    now = datetime(2025, 1, 8, 10, 0, tzinfo=UTC)
    weekly_pe = admin_reports._weekly_period_end(now, weekday=0, hour_utc=8)

    session_local = _make_session_local()
    await _init(session_local)
    async with session_local() as session:
        await _seed_owner(session)
        session.add(
            _content_block(
                {
                    "reports_recipients": ["a@example.com"],
                    "reports_weekly_last_sent_period_end": weekly_pe.isoformat(),
                }
            )
        )
        await session.commit()

    # not forced + already sent -> skipped
    async with session_local() as session:
        res = await admin_reports.send_report_now(
            session, kind="weekly", force=False, now=now
        )
        assert res["skipped"] is True
        assert res["attempted"] == 0

    # forced -> sends and records last_sent
    async with session_local() as session:
        res = await admin_reports.send_report_now(
            session, kind="weekly", force=True, now=now
        )
        assert res["skipped"] is False
        assert res["delivered"] == 1


@pytest.mark.anyio
async def test_send_report_now_monthly_skipped_and_delivered(monkeypatch) -> None:
    monkeypatch.setattr(admin_reports.settings, "smtp_enabled", True)

    async def fake_send(*args, **kwargs):
        return True

    monkeypatch.setattr(email_service, "send_admin_report_summary", fake_send)

    now = datetime(2025, 1, 8, 10, 0, tzinfo=UTC)
    monthly_pe = admin_reports._monthly_period_end(now, day=1, hour_utc=8)

    session_local = _make_session_local()
    await _init(session_local)
    async with session_local() as session:
        await _seed_owner(session)
        session.add(
            _content_block(
                {
                    "reports_recipients": ["a@example.com"],
                    "reports_monthly_last_sent_period_end": monthly_pe.isoformat(),
                }
            )
        )
        await session.commit()

    # skipped path for monthly
    async with session_local() as session:
        res = await admin_reports.send_report_now(
            session, kind="monthly", force=False, now=now
        )
        assert res["skipped"] is True

    # delivered path for monthly (forced)
    async with session_local() as session:
        res = await admin_reports.send_report_now(
            session, kind="monthly", force=True, now=now
        )
        assert res["skipped"] is False
        assert res["delivered"] == 1


@pytest.mark.anyio
async def test_send_report_now_weekly_not_delivered(monkeypatch) -> None:
    """delivered == 0 -> last_sent NOT updated (else of the if delivered>0)."""
    monkeypatch.setattr(admin_reports.settings, "smtp_enabled", True)

    async def fake_send(*args, **kwargs):
        return False

    monkeypatch.setattr(email_service, "send_admin_report_summary", fake_send)

    session_local = _make_session_local()
    await _init(session_local)
    async with session_local() as session:
        await _seed_owner(session)
        session.add(_content_block({"reports_recipients": ["a@example.com"]}))
        await session.commit()

    now = datetime(2025, 1, 8, 10, 0, tzinfo=UTC)
    async with session_local() as session:
        res = await admin_reports.send_report_now(
            session, kind="monthly", force=True, now=now
        )
        assert res["delivered"] == 0
        block = (
            await session.execute(
                select(ContentBlock).where(
                    ContentBlock.key == admin_reports.REPORT_SETTINGS_KEY
                )
            )
        ).scalar_one()
        assert "reports_monthly_last_sent_period_end" not in (block.meta or {})

    # weekly path with delivered == 0 (733->739 false branch)
    async with session_local() as session:
        res = await admin_reports.send_report_now(
            session, kind="weekly", force=True, now=now
        )
        assert res["delivered"] == 0
        block = (
            await session.execute(
                select(ContentBlock).where(
                    ContentBlock.key == admin_reports.REPORT_SETTINGS_KEY
                )
            )
        ).scalar_one()
        assert "reports_weekly_last_sent_period_end" not in (block.meta or {})
