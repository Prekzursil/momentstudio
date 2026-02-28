from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.api.v1 import admin_dashboard
from app.services import admin_reports


def _ipv4(a: int, b: int, c: int, d: int) -> str:
    return '.'.join(str(part) for part in (a, b, c, d))


def _request_with_scope(headers: list[tuple[bytes, bytes]] | None = None, client: tuple[str, int] | None = None) -> Request:
    scope = {
        'type': 'http',
        'http_version': '1.1',
        'method': 'GET',
        'path': '/',
        'raw_path': b'/',
        'query_string': b'',
        'headers': headers or [],
        'client': client,
        'server': ('testserver', 80),
        'scheme': 'http',
    }
    return Request(scope)


def test_request_audit_metadata_extracts_user_agent_and_ip() -> None:
    client_ip = _ipv4(1, 2, 3, 4)
    request = _request_with_scope(headers=[(b'user-agent', b'Agent/1.0')], client=(client_ip, 1234))
    payload = admin_dashboard._request_audit_metadata(request)
    assert payload['user_agent'] == 'Agent/1.0'
    assert payload['ip_address'] == client_ip

    no_client_request = _request_with_scope()
    payload2 = admin_dashboard._request_audit_metadata(no_client_request)
    assert payload2['user_agent'] is None
    assert payload2['ip_address'] is None


def test_admin_dashboard_threshold_and_summary_helpers() -> None:
    record = SimpleNamespace(
        failed_payments_min_count=2,
        failed_payments_min_delta_pct='12.5',
        refund_requests_min_count=3,
        refund_requests_min_rate_pct='8.4',
        stockouts_min_count=4,
        updated_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    payload = admin_dashboard._dashboard_alert_thresholds_payload(record)  # type: ignore[arg-type]
    assert payload['failed_payments_min_count'] == 2
    assert payload['failed_payments_min_delta_pct'] == pytest.approx(12.5)
    assert payload['refund_requests_min_rate_pct'] == pytest.approx(8.4)

    assert admin_dashboard._decimal_or_none(None) is None
    assert str(admin_dashboard._decimal_or_none('3.75')) == '3.75'

    assert admin_dashboard._summary_delta_pct(20, 10) == pytest.approx(100.0)
    assert admin_dashboard._summary_delta_pct(20, 0) is None
    assert admin_dashboard._summary_rate_pct(10, 20) == pytest.approx(50.0)
    assert admin_dashboard._summary_rate_pct(10, 0) is None


def test_summary_resolve_range_defaults_and_validations() -> None:
    now = datetime(2026, 2, 20, 12, 0, tzinfo=timezone.utc)

    start, end, days = admin_dashboard._summary_resolve_range(now, 7, None, None)
    assert end == now
    assert start == now - timedelta(days=7)
    assert days == 7

    explicit_start = date(2026, 2, 1)
    explicit_end = date(2026, 2, 3)
    start2, end2, days2 = admin_dashboard._summary_resolve_range(now, 30, explicit_start, explicit_end)
    assert start2 == datetime(2026, 2, 1, 0, 0, tzinfo=timezone.utc)
    assert end2 == datetime(2026, 2, 4, 0, 0, tzinfo=timezone.utc)
    assert days2 == 3

    with pytest.raises(HTTPException):
        admin_dashboard._summary_resolve_range(now, 7, explicit_start, None)

    with pytest.raises(HTTPException):
        admin_dashboard._summary_resolve_range(now, 7, date(2026, 2, 5), date(2026, 2, 1))


def test_admin_reports_parse_helpers() -> None:
    assert admin_reports._parse_bool(None, fallback=True) is True
    assert admin_reports._parse_bool('yes', fallback=False) is True
    assert admin_reports._parse_bool('off', fallback=True) is False

    assert admin_reports._coerce_int(True) is None
    assert admin_reports._coerce_int('12') == 12
    assert admin_reports._coerce_int('bad') is None

    assert admin_reports._parse_int('100', fallback=5, min_value=1, max_value=50) == 50
    assert admin_reports._parse_int(None, fallback=7, min_value=1, max_value=50) == 7

    assert admin_reports._parse_iso_dt('2026-02-01T10:00:00Z') == datetime(2026, 2, 1, 10, 0, tzinfo=timezone.utc)
    assert admin_reports._parse_iso_dt('') is None


def test_admin_reports_recipient_helpers() -> None:
    assert admin_reports._recipient_candidates('a@example.com;b@example.com') == ['a@example.com', 'b@example.com']
    assert admin_reports._normalize_recipient_email('INVALID') is None
    assert admin_reports._normalize_recipient_email(' A@EXAMPLE.COM ') == 'a@example.com'

    recipients = admin_reports._parse_recipients('A@example.com, a@example.com;bad;B@example.com')
    assert recipients == ['a@example.com', 'b@example.com']


def test_admin_reports_period_math_and_cooldown() -> None:
    now = datetime(2026, 2, 20, 10, 0, tzinfo=timezone.utc)

    weekly = admin_reports._weekly_period_end(now, weekday=4, hour_utc=8)
    assert weekly <= now

    monthly = admin_reports._monthly_period_end(now, day=28, hour_utc=8)
    assert monthly <= now

    assert admin_reports._previous_month(2026, 1) == (2025, 12)
    assert admin_reports._previous_month(2026, 3) == (2026, 2)

    assert admin_reports._subtract_one_month(datetime(2026, 3, 15, tzinfo=timezone.utc)) == datetime(
        2026, 2, 15, tzinfo=timezone.utc
    )

    period_end = datetime(2026, 2, 20, 8, 0, tzinfo=timezone.utc)
    recent_attempt = datetime(2026, 2, 20, 9, 30, tzinfo=timezone.utc)
    assert (
        admin_reports._cooldown_active(
            now=now,
            period_end=period_end,
            last_attempt_at=recent_attempt,
            last_attempt_period_end=period_end,
            cooldown_minutes=60,
        )
        is True
    )

    assert (
        admin_reports._cooldown_active(
            now=now,
            period_end=period_end,
            last_attempt_at=None,
            last_attempt_period_end=period_end,
            cooldown_minutes=60,
        )
        is False
    )


@pytest.mark.anyio
async def test_effective_recipients_prefers_explicit_list() -> None:
    recipients = await admin_reports._effective_recipients(SimpleNamespace(), ['a@example.com'])
    assert recipients == ['a@example.com']


@pytest.mark.anyio
async def test_effective_recipients_falls_back_to_owner_or_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_owner(_session: object) -> object:
        await asyncio.sleep(0)
        return SimpleNamespace(email='Owner@Example.com')

    monkeypatch.setattr(admin_reports.auth_service, 'get_owner_user', fake_owner)
    monkeypatch.setattr(admin_reports.settings, 'admin_alert_email', '')

    recipients = await admin_reports._effective_recipients(SimpleNamespace(), None)
    assert recipients == ['owner@example.com']

    async def no_owner(_session: object) -> object:
        await asyncio.sleep(0)
        return None

    monkeypatch.setattr(admin_reports.auth_service, 'get_owner_user', no_owner)
    monkeypatch.setattr(admin_reports.settings, 'admin_alert_email', 'ops@example.com')

    recipients2 = await admin_reports._effective_recipients(SimpleNamespace(), None)
    assert recipients2 == ['ops@example.com']


@pytest.mark.anyio
async def test_parse_settings_and_result_helpers() -> None:
    settings_obj, state_obj = admin_reports._parse_settings(
        {
            'reports_weekly_enabled': 'true',
            'reports_weekly_weekday': '2',
            'reports_weekly_hour_utc': 9,
            'reports_monthly_enabled': 1,
            'reports_monthly_day': '4',
            'reports_monthly_hour_utc': 7,
            'reports_recipients': 'A@example.com;B@example.com',
            'reports_top_products_limit': '7',
            'reports_low_stock_limit': '25',
            'reports_retry_cooldown_minutes': '90',
            'reports_weekly_last_error': 'x' * 600,
        }
    )

    assert settings_obj.weekly_enabled is True
    assert settings_obj.weekly_weekday == 2
    assert settings_obj.monthly_enabled is True
    assert settings_obj.recipients == ['a@example.com', 'b@example.com']
    assert settings_obj.top_products_limit == 7
    assert settings_obj.retry_cooldown_minutes == 90
    assert state_obj.weekly_last_error is not None
    assert len(state_obj.weekly_last_error) == 500

    with pytest.raises(ValueError):
        admin_reports._clean_report_kind('invalid')

    assert admin_reports._clean_report_kind(' WEEKLY ') == 'weekly'

    now = datetime(2026, 2, 20, 12, 0, tzinfo=timezone.utc)
    weekly_start, weekly_end = admin_reports._report_period('weekly', now, settings_obj)
    monthly_start, monthly_end = admin_reports._report_period('monthly', now, settings_obj)

    assert weekly_start < weekly_end
    assert monthly_start < monthly_end

    result = admin_reports._report_result(
        kind='weekly',
        period_start=weekly_start,
        period_end=weekly_end,
        attempted=2,
        delivered=1,
        skipped=False,
    )
    assert result['kind'] == 'weekly'
    assert result['attempted'] == 2


@pytest.mark.anyio
async def test_update_due_report_outcome_updates_success_and_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    updates: list[dict[str, object | None]] = []

    async def fake_update(_session: object, _block: object, payload: dict[str, object | None]) -> None:
        await asyncio.sleep(0)
        updates.append(payload)

    monkeypatch.setattr(admin_reports, '_update_block_meta', fake_update)

    spec = admin_reports._ScheduledReportSpec(
        kind='weekly',
        period_start=datetime(2026, 2, 1, tzinfo=timezone.utc),
        period_end=datetime(2026, 2, 8, tzinfo=timezone.utc),
        last_sent_period_end=None,
        last_attempt_at=None,
        last_attempt_period_end=None,
        attempt_at_key='reports_weekly_last_attempt_at',
        attempt_period_end_key='reports_weekly_last_attempt_period_end',
        sent_period_end_key='reports_weekly_last_sent_period_end',
        error_key='reports_weekly_last_error',
    )

    await admin_reports._update_due_report_outcome(SimpleNamespace(), SimpleNamespace(), spec=spec, attempted=2, delivered=1)
    await admin_reports._update_due_report_outcome(SimpleNamespace(), SimpleNamespace(), spec=spec, attempted=2, delivered=0)

    assert any('reports_weekly_last_sent_period_end' in item for item in updates)
    assert any(item.get('reports_weekly_last_error') for item in updates)


@pytest.mark.anyio
async def test_send_due_report_for_spec_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    updates: list[dict[str, object | None]] = []
    outcomes: list[tuple[int, int]] = []

    async def fake_update(_session: object, _block: object, payload: dict[str, object | None]) -> None:
        await asyncio.sleep(0)
        updates.append(payload)

    async def fake_send_report_email(_session: object, **_kwargs: object) -> tuple[int, int]:
        await asyncio.sleep(0)
        return (2, 1)

    async def fake_outcome(_session: object, _block: object, *, spec: object, attempted: int, delivered: int) -> None:
        await asyncio.sleep(0)
        outcomes.append((attempted, delivered))

    monkeypatch.setattr(admin_reports, '_update_block_meta', fake_update)
    monkeypatch.setattr(admin_reports, '_send_report_email', fake_send_report_email)
    monkeypatch.setattr(admin_reports, '_update_due_report_outcome', fake_outcome)

    now = datetime(2026, 2, 20, 10, 0, tzinfo=timezone.utc)
    settings_obj = admin_reports.ReportSettings(retry_cooldown_minutes=60)

    period_end = datetime(2026, 2, 20, 8, 0, tzinfo=timezone.utc)
    spec = admin_reports._ScheduledReportSpec(
        kind='weekly',
        period_start=period_end - timedelta(days=7),
        period_end=period_end,
        last_sent_period_end=period_end,
        last_attempt_at=None,
        last_attempt_period_end=None,
        attempt_at_key='attempt_at',
        attempt_period_end_key='attempt_period',
        sent_period_end_key='sent_period',
        error_key='error',
    )

    await admin_reports._send_due_report_for_spec(
        SimpleNamespace(),
        now=now,
        block=SimpleNamespace(),
        settings_obj=settings_obj,
        recipients=['a@example.com'],
        spec=spec,
    )
    assert updates == []

    spec2 = admin_reports._ScheduledReportSpec(
        kind='weekly',
        period_start=period_end - timedelta(days=7),
        period_end=period_end,
        last_sent_period_end=None,
        last_attempt_at=now - timedelta(minutes=5),
        last_attempt_period_end=period_end,
        attempt_at_key='attempt_at',
        attempt_period_end_key='attempt_period',
        sent_period_end_key='sent_period',
        error_key='error',
    )

    await admin_reports._send_due_report_for_spec(
        SimpleNamespace(),
        now=now,
        block=SimpleNamespace(),
        settings_obj=settings_obj,
        recipients=['a@example.com'],
        spec=spec2,
    )
    assert updates == []

    spec3 = admin_reports._ScheduledReportSpec(
        kind='weekly',
        period_start=period_end - timedelta(days=7),
        period_end=period_end,
        last_sent_period_end=None,
        last_attempt_at=None,
        last_attempt_period_end=None,
        attempt_at_key='attempt_at',
        attempt_period_end_key='attempt_period',
        sent_period_end_key='sent_period',
        error_key='error',
    )

    await admin_reports._send_due_report_for_spec(
        SimpleNamespace(),
        now=now,
        block=SimpleNamespace(),
        settings_obj=settings_obj,
        recipients=['a@example.com'],
        spec=spec3,
    )

    assert updates
    assert outcomes == [(2, 1)]


@pytest.mark.anyio
async def test_send_due_reports_early_returns_and_spec_dispatch(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_load_settings_block(_session: object) -> object:
        await asyncio.sleep(0)
        return SimpleNamespace(meta={})

    async def fake_effective_recipients(_session: object, _recipients: object) -> list[str]:
        await asyncio.sleep(0)
        return ['ops@example.com']

    dispatched: list[str] = []

    async def fake_send_due_for_spec(_session: object, **kwargs: object) -> None:
        await asyncio.sleep(0)
        spec = kwargs['spec']
        dispatched.append(spec.kind)

    monkeypatch.setattr(admin_reports.settings, 'smtp_enabled', False)
    await admin_reports.send_due_reports(SimpleNamespace(), now=datetime(2026, 2, 20, tzinfo=timezone.utc))

    monkeypatch.setattr(admin_reports.settings, 'smtp_enabled', True)
    monkeypatch.setattr(admin_reports, '_load_settings_block', fake_load_settings_block)
    monkeypatch.setattr(admin_reports, '_effective_recipients', fake_effective_recipients)
    monkeypatch.setattr(admin_reports, '_send_due_report_for_spec', fake_send_due_for_spec)
    monkeypatch.setattr(
        admin_reports,
        '_parse_settings',
        lambda _meta: (admin_reports.ReportSettings(weekly_enabled=True, monthly_enabled=True), admin_reports.ReportState()),
    )

    await admin_reports.send_due_reports(SimpleNamespace(), now=datetime(2026, 2, 20, tzinfo=timezone.utc))
    assert sorted(dispatched) == ['monthly', 'weekly']


@pytest.mark.anyio
async def test_send_report_now_error_and_success_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    now = datetime(2026, 2, 20, 10, 0, tzinfo=timezone.utc)

    monkeypatch.setattr(admin_reports.settings, 'smtp_enabled', False)
    with pytest.raises(ValueError, match='SMTP is disabled'):
        await admin_reports.send_report_now(SimpleNamespace(), kind='weekly', now=now)

    monkeypatch.setattr(admin_reports.settings, 'smtp_enabled', True)

    async def no_settings_block(_session: object) -> None:
        await asyncio.sleep(0)
        return None

    monkeypatch.setattr(admin_reports, '_load_settings_block', no_settings_block)
    with pytest.raises(ValueError, match='Reports settings not configured'):
        await admin_reports.send_report_now(SimpleNamespace(), kind='weekly', now=now)

    block = SimpleNamespace(meta={})

    async def fake_block(_session: object) -> object:
        await asyncio.sleep(0)
        return block

    async def no_recipients(_session: object, _recipients: object) -> list[str]:
        await asyncio.sleep(0)
        return []

    monkeypatch.setattr(admin_reports, '_load_settings_block', fake_block)
    monkeypatch.setattr(admin_reports, '_effective_recipients', no_recipients)
    monkeypatch.setattr(admin_reports, '_parse_settings', lambda _meta: (admin_reports.ReportSettings(), admin_reports.ReportState()))

    with pytest.raises(ValueError, match='No report recipients configured'):
        await admin_reports.send_report_now(SimpleNamespace(), kind='weekly', now=now)

    async def has_recipients(_session: object, _recipients: object) -> list[str]:
        await asyncio.sleep(0)
        return ['ops@example.com']

    monkeypatch.setattr(admin_reports, '_effective_recipients', has_recipients)

    with pytest.raises(ValueError, match='Invalid report kind'):
        await admin_reports.send_report_now(SimpleNamespace(), kind='bad', now=now)

    weekly_end = admin_reports._weekly_period_end(now, weekday=0, hour_utc=8)
    state_obj = admin_reports.ReportState(weekly_last_sent_period_end=weekly_end)
    monkeypatch.setattr(
        admin_reports,
        '_parse_settings',
        lambda _meta: (
            admin_reports.ReportSettings(weekly_enabled=True, weekly_weekday=0, weekly_hour_utc=8, recipients=['ops@example.com']),
            state_obj,
        ),
    )

    skipped = await admin_reports.send_report_now(SimpleNamespace(), kind='weekly', force=False, now=now)
    assert skipped['skipped'] is True

    updates: list[dict[str, object | None]] = []

    async def fake_send_email(_session: object, **_kwargs: object) -> tuple[int, int]:
        await asyncio.sleep(0)
        return (2, 1)

    async def fake_update_meta(_session: object, _block: object, payload: dict[str, object | None]) -> None:
        await asyncio.sleep(0)
        updates.append(payload)

    monkeypatch.setattr(admin_reports, '_send_report_email', fake_send_email)
    monkeypatch.setattr(admin_reports, '_update_block_meta', fake_update_meta)

    sent = await admin_reports.send_report_now(SimpleNamespace(), kind='weekly', force=True, now=now)
    assert sent['attempted'] == 2
    assert sent['delivered'] == 1
    assert sent['skipped'] is False
    assert any('reports_weekly_last_sent_period_end' in item for item in updates)
