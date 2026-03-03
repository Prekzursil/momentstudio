from __future__ import annotations

import asyncio
import inspect
import math
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy.exc import IntegrityError
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


def _assert_close(actual: float | int | None, expected: float, *, abs_tol: float = 1e-9) -> None:
    assert actual is not None
    assert math.isclose(float(actual), expected, rel_tol=1e-9, abs_tol=abs_tol)


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
    _assert_close(payload['failed_payments_min_delta_pct'], 12.5)
    _assert_close(payload['refund_requests_min_rate_pct'], 8.4)

    assert admin_dashboard._decimal_or_none(None) is None
    assert str(admin_dashboard._decimal_or_none('3.75')) == '3.75'

    _assert_close(admin_dashboard._summary_delta_pct(20, 10), 100.0)
    assert admin_dashboard._summary_delta_pct(20, 0) is None
    _assert_close(admin_dashboard._summary_rate_pct(10, 20), 50.0)
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


@pytest.mark.anyio
async def test_admin_dashboard_get_alert_thresholds_create_and_retry_paths() -> None:
    class _ThresholdSession:
        def __init__(self, scalar_values: list[object | None], *, commit_error: Exception | None = None) -> None:
            self._scalar_values = list(scalar_values)
            self.commit_error = commit_error
            self.added: list[object] = []
            self.commits = 0
            self.rollbacks = 0

        async def scalar(self, _stmt: object) -> object | None:
            await asyncio.sleep(0)
            if not self._scalar_values:
                return None
            return self._scalar_values.pop(0)

        def add(self, value: object) -> None:
            self.added.append(value)

        async def commit(self) -> None:
            await asyncio.sleep(0)
            self.commits += 1
            if self.commits == 1 and self.commit_error is not None:
                raise self.commit_error

        async def rollback(self) -> None:
            await asyncio.sleep(0)
            self.rollbacks += 1

    existing = SimpleNamespace(key='default')
    session_existing = _ThresholdSession([existing])
    assert await admin_dashboard._get_dashboard_alert_thresholds(session_existing) is existing
    assert session_existing.added == []
    assert session_existing.commits == 0

    session_created = _ThresholdSession([None])
    created = await admin_dashboard._get_dashboard_alert_thresholds(session_created)
    assert created.key == 'default'
    assert len(session_created.added) == 1
    assert session_created.commits == 1

    recovered = SimpleNamespace(key='default')
    session_retry = _ThresholdSession(
        [None, recovered],
        commit_error=IntegrityError('insert', {'key': 'default'}, Exception('duplicate')),
    )
    assert await admin_dashboard._get_dashboard_alert_thresholds(session_retry) is recovered
    assert session_retry.rollbacks == 1
    assert session_retry.commits == 1


def test_admin_dashboard_summary_and_audit_payload_helpers() -> None:
    assert admin_dashboard._summary_failed_payments_is_alert(1, 200.0, threshold_min_count=2, threshold_min_delta_pct=10.0) is False
    assert admin_dashboard._summary_failed_payments_is_alert(3, None, threshold_min_count=2, threshold_min_delta_pct=10.0) is True
    assert admin_dashboard._summary_failed_payments_is_alert(3, 5.0, threshold_min_count=2, threshold_min_delta_pct=10.0) is False
    assert admin_dashboard._summary_failed_payments_is_alert(3, 15.0, threshold_min_count=2, threshold_min_delta_pct=10.0) is True

    assert admin_dashboard._summary_refund_requests_is_alert(1, 30.0, threshold_min_count=2, threshold_min_rate_pct=10.0) is False
    assert admin_dashboard._summary_refund_requests_is_alert(3, None, threshold_min_count=2, threshold_min_rate_pct=10.0) is True
    assert admin_dashboard._summary_refund_requests_is_alert(3, 8.0, threshold_min_count=2, threshold_min_rate_pct=10.0) is False
    assert admin_dashboard._summary_refund_requests_is_alert(3, 12.0, threshold_min_count=2, threshold_min_rate_pct=10.0) is True

    failed_payload = admin_dashboard._summary_failed_payments_payload(
        failed_payments=4,
        failed_payments_prev=2,
        threshold_min_count=2,
        threshold_min_delta_pct=50.0,
    )
    _assert_close(failed_payload['delta_pct'], 100.0)
    assert failed_payload['is_alert'] is True

    refund_payload = admin_dashboard._summary_refund_requests_payload(
        refund_requests=4,
        refund_requests_prev=2,
        refund_window_orders=20,
        refund_window_orders_prev=10,
        threshold_min_count=2,
        threshold_min_rate_pct=15.0,
    )
    _assert_close(refund_payload['current_rate_pct'], 20.0)
    _assert_close(refund_payload['rate_delta_pct'], 0.0)
    assert refund_payload['is_alert'] is True

    anomalies = admin_dashboard._summary_anomalies_payload(
        anomaly_inputs={
            'failed_payments': 4,
            'failed_payments_prev': 2,
            'refund_requests': 3,
            'refund_requests_prev': 1,
            'refund_window_orders': 15,
            'refund_window_orders_prev': 10,
            'stockouts': 5,
        },
        thresholds_payload={
            'failed_payments_min_count': 2,
            'failed_payments_min_delta_pct': 20.0,
            'refund_requests_min_count': 2,
            'refund_requests_min_rate_pct': 10.0,
            'stockouts_min_count': 4,
        },
    )
    assert anomalies['failed_payments']['is_alert'] is True
    assert anomalies['refund_requests']['is_alert'] is True
    assert anomalies['stockouts']['is_alert'] is True

    start = datetime(2026, 2, 1, tzinfo=timezone.utc)
    end = datetime(2026, 2, 8, tzinfo=timezone.utc)
    overview = admin_dashboard._summary_overview_payload(
        totals={'products': 1, 'orders': 2, 'users': 3, 'low_stock': 4},
        sales_30d_metrics={'sales': 100.0, 'gross_sales': 120.0, 'net_sales': 90.0, 'orders': 5},
        range_metrics={'sales': 40.0, 'gross_sales': 50.0, 'net_sales': 35.0, 'orders': 2},
        effective_range_days=7,
        start=start,
        end=end,
    )
    assert overview['range_from'] == '2026-02-01'
    assert overview['range_to'] == '2026-02-07'

    day_payload = admin_dashboard._summary_day_payload(
        {
            'today_orders': 3,
            'yesterday_orders': 2,
            'orders_delta_pct': 50.0,
            'today_sales': 60.0,
            'yesterday_sales': 40.0,
            'sales_delta_pct': 50.0,
            'gross_today_sales': 70.0,
            'gross_yesterday_sales': 50.0,
            'gross_sales_delta_pct': 40.0,
            'net_today_sales': 55.0,
            'net_yesterday_sales': 35.0,
            'net_sales_delta_pct': 57.0,
            'today_refunds': 1,
            'yesterday_refunds': 0,
            'refunds_delta_pct': None,
        }
    )
    assert day_payload['today_orders'] == 3
    assert day_payload['today_refunds'] == 1

    long_agent = 'A' * 300
    request = _request_with_scope(headers=[(b'user-agent', long_agent.encode('ascii'))], client=('203.0.113.11', 443))
    admin_meta = admin_dashboard._admin_request_metadata(request)
    assert admin_meta['ip_address'] == '203.0.113.11'
    assert admin_meta['user_agent'] == 'A' * 255

    audit_data = admin_dashboard._admin_send_report_audit_data(
        kind='weekly',
        force=True,
        request_meta={'user_agent': 'Agent/1.0', 'ip_address': '203.0.113.11'},
        result={'attempted': 2},
        error=RuntimeError('x' * 600),
    )
    assert audit_data['kind'] == 'weekly'
    assert audit_data['result'] == {'attempted': 2}
    assert len(str(audit_data['error'])) == 500

    assert admin_dashboard._funnel_rate(1, 0) is None
    _assert_close(admin_dashboard._funnel_rate(2, 4), 0.5)


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
    await asyncio.sleep(0)
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


def test_admin_dashboard_channel_shipping_and_refund_helper_branches() -> None:
    assert admin_dashboard._channel_normalize_value(123) == ''
    assert admin_dashboard._channel_extract(None) == ('direct', None, None)
    assert admin_dashboard._channel_extract({'utm_source': ' Google ', 'utm_medium': ' CPC ', 'utm_campaign': ' Spring '}) == (
        'google',
        'cpc',
        'Spring',
    )

    order_a = uuid4()
    order_b = uuid4()
    channel_rows, tracked_orders, tracked_sales = admin_dashboard._channel_aggregate(
        order_to_session={order_a: 'session-a', order_b: 'session-b'},
        order_amounts={order_a: 120.0, order_b: 30.0},
        session_payload={
            'session-a': {'utm_source': 'newsletter', 'utm_medium': 'email', 'utm_campaign': 'launch'},
            'session-b': None,
        },
    )
    assert tracked_orders == 2
    _assert_close(tracked_sales, 150.0)
    assert channel_rows[0]['source'] == 'newsletter'
    assert channel_rows[0]['orders'] == 1
    assert admin_dashboard._channel_coverage_pct(0, 0) is None
    _assert_close(admin_dashboard._channel_coverage_pct(1, 4), 0.25)

    start = datetime(2026, 2, 1, tzinfo=timezone.utc)
    end = datetime(2026, 2, 8, tzinfo=timezone.utc)
    empty_payload = admin_dashboard._channel_empty_response(
        effective_range_days=7,
        start=start,
        end=end,
        total_orders=2,
        total_gross_sales=99.0,
    )
    assert math.isclose(empty_payload['coverage_pct'], 0.0, rel_tol=0.0, abs_tol=1e-9)
    limited_payload = admin_dashboard._channel_limited_response(
        effective_range_days=7,
        start=start,
        end=end,
        total_orders=4,
        total_gross_sales=100.0,
        tracked_orders=2,
        tracked_gross_sales=50.0,
        channels=channel_rows,
        limit=1,
    )
    assert len(limited_payload['channels']) == 1
    _assert_close(limited_payload['coverage_pct'], 0.5)

    duration_rows = [
        ('sameday', start, start + timedelta(hours=5)),
        ('fan', None, start + timedelta(hours=2)),
        ('fan', start + timedelta(hours=2), start),
        ('fan', start, start + timedelta(days=400)),
    ]
    durations = admin_dashboard._shipping_duration_map(duration_rows, courier_idx=0, start_idx=1, end_idx=2)
    assert durations == {'sameday': [5.0]}

    shipping_rows = admin_dashboard._shipping_rows(
        current_durations={'sameday': [4.0, 6.0], 'fan': [3.0]},
        previous_durations={'sameday': [5.0]},
    )
    sameday = next(item for item in shipping_rows if item['courier'] == 'sameday')
    assert sameday['current']['count'] == 2
    _assert_close(sameday['delta_pct']['avg_hours'], 0.0)
    shipping_payload = admin_dashboard._shipping_response_payload(
        7,
        start,
        end,
        {'sameday': [4.0]},
        {'sameday': [5.0]},
        {'sameday': [24.0]},
        {'sameday': [30.0]},
    )
    assert shipping_payload['window_days'] == 7
    assert len(shipping_payload['time_to_ship']) == 1

    assert 'stricat' in admin_dashboard._normalize_refund_reason_text('  Ștricat ')
    assert admin_dashboard._refund_reason_category('Wrong product received') == 'wrong_item'
    assert admin_dashboard._refund_reason_category('') == 'other'

    providers = admin_dashboard._refund_provider_payload(
        current_provider=[('stripe', 2, 30.0), ('paypal', 1, 10.0)],
        previous_provider=[('stripe', 1, 15.0)],
    )
    assert providers[0]['provider'] == 'stripe'
    assert providers[1]['delta_pct']['count'] is None

    reasons = admin_dashboard._refund_reasons_payload(
        current_reasons={'damaged': 2, 'other': 1},
        previous_reasons={'damaged': 1},
    )
    assert reasons[0]['category'] == 'damaged'
    assert any(item['category'] == 'other' for item in reasons)


def test_admin_dashboard_audit_duplicate_and_gdpr_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    assert admin_dashboard._duplicate_value('  SKU-1  ') == 'SKU-1'
    assert admin_dashboard._duplicate_slug_base('Fancy Ring') == 'fancy-ring'
    assert admin_dashboard._duplicate_slug_base('') is None
    assert admin_dashboard._duplicate_suggested_slug('ring', {'ring', 'ring-2'}) == 'ring-3'

    assert admin_dashboard._audit_mask_email('john@example.com') == 'j***@example.com'
    assert admin_dashboard._audit_mask_email('x@example.com') == '*@example.com'
    redacted = admin_dashboard._audit_redact_text(
        'User john@example.com from 192.168.1.5 and 2001:db8::1'
    )
    assert 'j***@example.com' in redacted
    assert '***.***.***.***' in redacted
    assert '****:****:****:****' in redacted
    assert admin_dashboard._audit_csv_cell('=2+2').startswith("'=")
    assert admin_dashboard._audit_csv_cell('hello\nworld') == 'hello world'
    assert admin_dashboard._audit_total_pages(0, 25) == 1
    assert admin_dashboard._audit_total_pages(51, 25) == 3

    row = {
        'created_at': datetime(2026, 2, 20, tzinfo=timezone.utc),
        'entity': 'security',
        'action': 'login',
        'actor_email': 'admin@example.com',
        'subject_email': 'user@example.com',
        'ref_key': 'auth',
        'ref_id': '1',
        'actor_user_id': 'admin-id',
        'subject_user_id': 'user-id',
        'data': 'ip=127.0.0.1 email=user@example.com',
    }
    csv_content = admin_dashboard._audit_export_csv_content([row], redact=True)
    assert 'created_at,entity,action' in csv_content
    assert 'a****@example.com' in csv_content
    assert '***.***.***.***' in csv_content

    now = datetime(2026, 2, 20, tzinfo=timezone.utc)
    assert admin_dashboard._gdpr_deletion_status(None, now) == 'scheduled'
    assert admin_dashboard._gdpr_deletion_status(now - timedelta(seconds=1), now) == 'due'
    assert admin_dashboard._gdpr_deletion_status(now + timedelta(seconds=1), now) == 'cooldown'
    assert admin_dashboard._gdpr_export_sla_days() >= 1

    session_row = SimpleNamespace(
        id=uuid4(),
        created_at=datetime(2026, 2, 20, 8, 0),
        expires_at=datetime(2026, 2, 20, 9, 0),
        persistent=True,
        user_agent='Agent',
        ip_address='198.51.100.1',
        country_code='RO',
    )
    session_payload = admin_dashboard._refresh_session_to_response(session_row, now=datetime(2026, 2, 20, 8, 30, tzinfo=timezone.utc))
    assert session_payload is not None
    assert session_payload.created_at.tzinfo == timezone.utc
    assert session_payload.is_current is False
    assert (
        admin_dashboard._refresh_session_to_response(
            SimpleNamespace(
                id=uuid4(),
                created_at=datetime(2026, 2, 20, 8, 0, tzinfo=timezone.utc),
                expires_at=datetime(2026, 2, 20, 8, 15, tzinfo=timezone.utc),
                persistent=True,
                user_agent=None,
                ip_address=None,
                country_code=None,
            ),
            now=datetime(2026, 2, 20, 8, 30, tzinfo=timezone.utc),
        )
        is None
    )


class _ScalarSession:
    def __init__(self, values: list[object | None]) -> None:
        self.values = list(values)

    async def scalar(self, _stmt: object) -> object | None:
        return self.values.pop(0) if self.values else None


class _RowsResult:
    def __init__(self, rows: list[object] | None = None, *, one_row: tuple[object, object] | None = None) -> None:
        self._rows = list(rows or [])
        self._one_row = one_row or (0, 0.0)

    def all(self) -> list[object]:
        return list(self._rows)

    def one(self) -> tuple[object, object]:
        return self._one_row

    def scalars(self) -> "_RowsResultScalars":
        return _RowsResultScalars(self._rows)


class _RowsResultScalars:
    def __init__(self, rows: list[object]) -> None:
        self._rows = list(rows)

    def all(self) -> list[object]:
        return list(self._rows)


class _ExecuteQueueSession:
    def __init__(self, results: list[_RowsResult]) -> None:
        self._results = list(results)

    async def execute(self, _stmt: object) -> _RowsResult:
        if not self._results:
            raise AssertionError("Unexpected execute() call")
        return self._results.pop(0)


@pytest.mark.anyio
async def test_admin_dashboard_summary_metric_wrappers_high_yield(monkeypatch: pytest.MonkeyPatch) -> None:
    totals_session = _ScalarSession([5, 8, 3, 2])
    totals = await admin_dashboard._summary_totals(totals_session, exclude_test_orders=True)
    assert totals == {'products': 5, 'orders': 8, 'users': 3, 'low_stock': 2}

    sales_session = _ScalarSession([120.0, 150.0, 10.0, 5.0, 7])
    sales = await admin_dashboard._summary_sales_metrics(
        sales_session,
        datetime(2026, 2, 1, tzinfo=timezone.utc),
        datetime(2026, 2, 2, tzinfo=timezone.utc),
        (admin_dashboard.OrderStatus.paid,),
        (admin_dashboard.OrderStatus.paid, admin_dashboard.OrderStatus.refunded),
        True,
    )
    assert sales['orders'] == 7
    _assert_close(float(sales['gross_sales']), 150.0)
    _assert_close(float(sales['net_sales']), 135.0)

    refunded_session = _ScalarSession([4])
    assert (
        await admin_dashboard._summary_refunded_order_count(
            refunded_session,
            datetime(2026, 2, 1, tzinfo=timezone.utc),
            datetime(2026, 2, 2, tzinfo=timezone.utc),
            True,
        )
        == 4
    )

    async def _sales_metrics(*_args, **_kwargs):
        if _kwargs.get('start') and _kwargs.get('end'):
            raise AssertionError('unexpected kwargs style')
        start = _args[1]
        if start.hour == 0 and start.day == 20:
            return {'orders': 4, 'sales': 80.0, 'gross_sales': 100.0, 'net_sales': 70.0}
        return {'orders': 2, 'sales': 50.0, 'gross_sales': 60.0, 'net_sales': 40.0}

    async def _refund_count(*_args, **_kwargs):
        start = _args[1]
        return 3 if start.day == 20 else 1

    monkeypatch.setattr(admin_dashboard, '_summary_sales_metrics', _sales_metrics)
    monkeypatch.setattr(admin_dashboard, '_summary_refunded_order_count', _refund_count)
    day_metrics = await admin_dashboard._summary_day_metrics(
        SimpleNamespace(),
        datetime(2026, 2, 20, 12, 0, tzinfo=timezone.utc),
        (admin_dashboard.OrderStatus.paid,),
        (admin_dashboard.OrderStatus.paid,),
        True,
    )
    assert day_metrics['today_orders'] == 4
    assert day_metrics['today_refunds'] == 3

    failed_session = _ScalarSession([6, 2])
    assert await admin_dashboard._summary_failed_payment_counts(
        failed_session,
        datetime(2026, 2, 20, 12, 0, tzinfo=timezone.utc),
        True,
    ) == (6, 2)

    refund_session = _ScalarSession([5, 3, 40, 30])
    refund_counts = await admin_dashboard._summary_refund_request_counts(
        refund_session,
        datetime(2026, 2, 20, 12, 0, tzinfo=timezone.utc),
        True,
    )
    assert refund_counts['refund_requests'] == 5
    assert refund_counts['refund_window_orders_prev'] == 30

    async def _failed_counts(*_args, **_kwargs):
        return (9, 4)

    async def _refund_counts(*_args, **_kwargs):
        return {'refund_requests': 8, 'refund_requests_prev': 2, 'refund_window_orders': 50, 'refund_window_orders_prev': 40}

    async def _stockouts(*_args, **_kwargs):
        return 11

    monkeypatch.setattr(admin_dashboard, '_summary_failed_payment_counts', _failed_counts)
    monkeypatch.setattr(admin_dashboard, '_summary_refund_request_counts', _refund_counts)
    monkeypatch.setattr(admin_dashboard, '_summary_stockouts_count', _stockouts)
    anomaly_inputs = await admin_dashboard._summary_anomaly_inputs(
        SimpleNamespace(),
        datetime(2026, 2, 20, 12, 0, tzinfo=timezone.utc),
        True,
    )
    assert anomaly_inputs['failed_payments'] == 9
    assert anomaly_inputs['stockouts'] == 11


@pytest.mark.anyio
async def test_admin_dashboard_funnel_channel_and_payment_query_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _funnel_counts(*_args, **_kwargs):
        return (10, 7, 5, 3)

    monkeypatch.setattr(
        admin_dashboard,
        '_summary_resolve_range',
        lambda now, _range_days, _range_from, _range_to: (
            datetime(2026, 2, 1, tzinfo=timezone.utc),
            datetime(2026, 2, 8, tzinfo=timezone.utc),
            7,
        ),
    )
    monkeypatch.setattr(admin_dashboard, '_funnel_counts', _funnel_counts)
    funnel_payload = await admin_dashboard.admin_funnel_metrics(
        session=SimpleNamespace(),
        _=object(),
        range_days=7,
        range_from=None,
        range_to=None,
    )
    assert funnel_payload.counts.orders == 3
    _assert_close(funnel_payload.conversions.to_cart, 0.7)

    row_gross = [('stripe', 3, 100.0), ('paypal', 2, 30.0)]
    row_refunds = [('stripe', 10.0)]
    row_missing = [('paypal', 5.0)]
    channel_session = _ExecuteQueueSession(
        [_RowsResult(row_gross), _RowsResult(row_refunds), _RowsResult(row_missing)]
    )
    channel_items = await admin_dashboard._channel_breakdown_items(
        channel_session,
        datetime(2026, 2, 1, tzinfo=timezone.utc),
        datetime(2026, 2, 2, tzinfo=timezone.utc),
        (admin_dashboard.OrderStatus.paid,),
        True,
        col=admin_dashboard.Order.payment_method,
    )
    assert channel_items[0]['key'] == 'stripe'
    assert channel_items[1]['net_sales'] == 25.0

    payments_session = _ExecuteQueueSession([_RowsResult([('stripe', 4), (None, 1)])])
    payments_counts = await admin_dashboard._payments_method_counts(
        payments_session,
        since=datetime(2026, 2, 1, tzinfo=timezone.utc),
        now=datetime(2026, 2, 2, tzinfo=timezone.utc),
        exclude_test_orders=True,
        status_clause=True,
    )
    assert payments_counts == {'stripe': 4, 'unknown': 1}

    webhook_rows = [SimpleNamespace(id='e1'), SimpleNamespace(id='e2')]
    recent_session = _ExecuteQueueSession([_RowsResult(webhook_rows)])
    recent = await admin_dashboard._payments_recent_webhook_rows(
        recent_session,
        since=datetime(2026, 2, 1, tzinfo=timezone.utc),
        model=admin_dashboard.StripeWebhookEvent,
    )
    assert len(recent) == 2


@pytest.mark.anyio
async def test_admin_dashboard_refunds_shipping_and_stockout_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    provider_rows_session = _ExecuteQueueSession([_RowsResult([(None, 2, 30.5), ('stripe', 1, 9.0)])])
    provider_rows = await admin_dashboard._refund_provider_rows(
        provider_rows_session,
        provider_col=admin_dashboard.Order.payment_method,
        exclude_test_orders=True,
        window_start=datetime(2026, 2, 1, tzinfo=timezone.utc),
        window_end=datetime(2026, 2, 2, tzinfo=timezone.utc),
    )
    assert provider_rows[0] == ('unknown', 2, 30.5)

    missing_session = _ExecuteQueueSession([_RowsResult([], one_row=(3, 44.0))])
    assert (
        await admin_dashboard._refund_missing_refunds(
            missing_session,
            exclude_test_orders=True,
            window_start=datetime(2026, 2, 1, tzinfo=timezone.utc),
            window_end=datetime(2026, 2, 2, tzinfo=timezone.utc),
        )
        == (3, 44.0)
    )

    reasons_session = _ExecuteQueueSession([_RowsResult(['Damaged item', '', 'Wrong product'])])
    reasons = await admin_dashboard._refund_reason_counts(
        reasons_session,
        exclude_test_orders=True,
        window_start=datetime(2026, 2, 1, tzinfo=timezone.utc),
        window_end=datetime(2026, 2, 2, tzinfo=timezone.utc),
    )
    assert reasons['damaged'] == 1
    assert reasons['other'] == 1

    async def _provider(*_args, **_kwargs):
        window_end = _kwargs.get('window_end') if _kwargs else None
        if window_end is None and len(_args) >= 5:
            window_end = _args[4]
        if window_end and window_end.day == 1:
            return [('stripe', 1, 10.0)]
        return [('stripe', 2, 30.0)]

    async def _missing(*_args, **_kwargs):
        return (2, 20.0)

    async def _reasons(*_args, **_kwargs):
        return {'damaged': 2}

    monkeypatch.setattr(admin_dashboard, '_refund_provider_rows', _provider)
    monkeypatch.setattr(admin_dashboard, '_refund_missing_refunds', _missing)
    monkeypatch.setattr(admin_dashboard, '_refund_reason_counts', _reasons)
    refund_payload = await admin_dashboard.admin_refunds_breakdown(
        session=SimpleNamespace(),
        _=object(),
        window_days=7,
    )
    assert refund_payload['window_days'] == 7
    assert refund_payload['providers'][0]['provider'] == 'stripe'

    ship_rows_session = _ExecuteQueueSession(
        [_RowsResult([(datetime(2026, 2, 1, tzinfo=timezone.utc), 'fan', datetime(2026, 2, 1, 4, tzinfo=timezone.utc))])]
    )
    ship_map = await admin_dashboard._shipping_collect_ship_durations(
        ship_rows_session,
        window_start=datetime(2026, 2, 1, tzinfo=timezone.utc),
        window_end=datetime(2026, 2, 2, tzinfo=timezone.utc),
        exclude_test_orders=True,
        courier_col=admin_dashboard.Order.courier,
        shipped_subq=admin_dashboard._shipping_shipped_subquery(),
    )
    assert ship_map == {'fan': [4.0]}

    delivery_rows_session = _ExecuteQueueSession(
        [_RowsResult([('fan', datetime(2026, 2, 1, tzinfo=timezone.utc), datetime(2026, 2, 2, tzinfo=timezone.utc))])]
    )
    delivery_map = await admin_dashboard._shipping_collect_delivery_durations(
        delivery_rows_session,
        window_start=datetime(2026, 2, 1, tzinfo=timezone.utc),
        window_end=datetime(2026, 2, 3, tzinfo=timezone.utc),
        exclude_test_orders=True,
        courier_col=admin_dashboard.Order.courier,
        shipped_subq=admin_dashboard._shipping_shipped_subquery(),
        delivered_subq=admin_dashboard._shipping_delivered_subquery(),
    )
    assert delivery_map == {'fan': [24.0]}

    async def _ship_collect(*_args, **_kwargs):
        return {'fan': [4.0]}

    async def _delivery_collect(*_args, **_kwargs):
        return {'fan': [20.0]}

    monkeypatch.setattr(admin_dashboard, '_shipping_collect_ship_durations', _ship_collect)
    monkeypatch.setattr(admin_dashboard, '_shipping_collect_delivery_durations', _delivery_collect)
    current_ship, previous_ship, current_delivery, previous_delivery = await admin_dashboard._shipping_period_durations(
        session=SimpleNamespace(),
        start=datetime(2026, 2, 10, tzinfo=timezone.utc),
        now=datetime(2026, 2, 20, tzinfo=timezone.utc),
        prev_start=datetime(2026, 2, 1, tzinfo=timezone.utc),
        exclude_test_orders=True,
        courier_col='fan',
        shipped_subq='ship',
        delivered_subq='delivered',
    )
    assert current_ship == {'fan': [4.0]}
    assert previous_delivery == {'fan': [20.0]}

    monkeypatch.setattr(
        admin_dashboard,
        '_shipping_window_bounds',
        lambda _window_days: (
            datetime(2026, 2, 20, tzinfo=timezone.utc),
            datetime(2026, 2, 10, tzinfo=timezone.utc),
            datetime(2026, 2, 1, tzinfo=timezone.utc),
        ),
    )
    monkeypatch.setattr(admin_dashboard, '_shipping_query_context', lambda: (True, 'ship', 'deliver', 'fan'))
    async def _period_durations(*_args, **_kwargs):
        return (
            {'fan': [4.0]},
            {'fan': [6.0]},
            {'fan': [20.0]},
            {'fan': [24.0]},
        )

    monkeypatch.setattr(admin_dashboard, '_shipping_period_durations', _period_durations)
    shipping_payload = await admin_dashboard.admin_shipping_performance(
        session=SimpleNamespace(),
        _=object(),
        window_days=10,
    )
    assert shipping_payload['window_days'] == 10
    assert shipping_payload['time_to_ship'][0]['courier'] == 'fan'

    demand_session = _ExecuteQueueSession([_RowsResult([(uuid4(), 3, 45.0)])])
    demand = await admin_dashboard._stockout_demand_map(
        demand_session,
        since=datetime(2026, 2, 1, tzinfo=timezone.utc),
        now=datetime(2026, 2, 2, tzinfo=timezone.utc),
        successful_statuses=(admin_dashboard.OrderStatus.paid,),
        product_ids=[uuid4()],
        exclude_test_orders=True,
    )
    assert next(iter(demand.values())) == (3, 45.0)
    assert admin_dashboard._stockout_avg_price(0, 0.0, 12.5) == 12.5

    async def _empty_restock(*_args, **_kwargs):
        return []

    monkeypatch.setattr(admin_dashboard.inventory_service, 'list_restock_list', _empty_restock)
    empty_stockout = await admin_dashboard.admin_stockout_impact(
        session=SimpleNamespace(),
        _=object(),
        window_days=7,
        limit=5,
    )
    assert empty_stockout['items'] == []

    restock_row = SimpleNamespace(
        product_id=uuid4(),
        product_slug='ring',
        product_name='Ring',
        available_quantity=0,
        reserved_in_carts=3,
        reserved_in_orders=1,
        stock_quantity=0,
    )

    async def _restock(*_args, **_kwargs):
        return [restock_row]

    async def _demand_map(*_args, **_kwargs):
        return {restock_row.product_id: (6, 180.0)}

    async def _product_map(*_args, **_kwargs):
        return {restock_row.product_id: {'base_price': 30.0, 'sale_price': None, 'currency': 'RON', 'allow_backorder': False}}

    monkeypatch.setattr(admin_dashboard.inventory_service, 'list_restock_list', _restock)
    monkeypatch.setattr(admin_dashboard, '_stockout_demand_map', _demand_map)
    monkeypatch.setattr(admin_dashboard, '_stockout_product_map', _product_map)
    stockout_payload = await admin_dashboard.admin_stockout_impact(
        session=SimpleNamespace(),
        _=object(),
        window_days=7,
        limit=5,
    )
    assert len(stockout_payload['items']) == 1
    assert stockout_payload['items'][0]['product_slug'] == 'ring'


class _AdminSweepSession:
    def __init__(self) -> None:
        self.added: list[object] = []
        self.commits = 0

    async def execute(self, *_args, **_kwargs) -> _RowsResult:
        return _RowsResult([])

    async def scalar(self, *_args, **_kwargs) -> object | None:
        return None

    async def get(self, *_args, **_kwargs) -> object | None:
        return None

    def add(self, value: object) -> None:
        self.added.append(value)

    async def commit(self) -> None:
        self.commits += 1

    async def refresh(self, *_args, **_kwargs) -> None:
        return None


def _dashboard_sweep_arg(name: str, *, session: _AdminSweepSession, request: Request, admin_user: object) -> object:
    if name == 'session':
        return session
    if name == 'request':
        return request
    if name in {'_', 'admin', 'current_user', 'actor'}:
        return admin_user
    if name == 'background_tasks':
        return BackgroundTasks()
    if name.endswith('_id'):
        return uuid4()
    if name in {'window_days', 'range_days', 'limit', 'page', 'page_size'}:
        return 7
    if name in {'range_from', 'range_to'}:
        return date(2026, 2, 1)
    if name in {'include_pii', 'redact', 'force'}:
        return False
    if name in {'kind', 'action', 'entity', 'decision'}:
        return 'weekly'
    if name in {'token', 'code'}:
        return '123456'
    if name in {'email', 'query', 'q', 'slug'}:
        return 'user@example.com'
    if name == 'payload':
        return SimpleNamespace(
            note='note',
            role='customer',
            amount='5.0',
            from_email='from@example.com',
            to_email='to@example.com',
            dry_run=False,
            reason='cleanup',
            target_user_id=str(uuid4()),
            keep_superuser=False,
            session_id=str(uuid4()),
            ids=[],
            retention_days=30,
            threshold=1,
            value='on',
        )
    return SimpleNamespace()


@pytest.mark.anyio
async def test_admin_dashboard_public_endpoint_reflection_superstep_a(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _AdminSweepSession()
    request = _request_with_scope(headers=[(b'user-agent', b'Agent/1.0')], client=('203.0.113.50', 443))
    admin_user = SimpleNamespace(id=uuid4(), email='admin@example.com', role='owner', preferred_language='en')

    async def _owner(*_args, **_kwargs):
        return admin_user

    monkeypatch.setattr(admin_dashboard.pii_service, 'require_pii_reveal', lambda *_args, **_kwargs: None)
    monkeypatch.setattr(admin_dashboard.step_up_service, 'require_step_up', lambda *_args, **_kwargs: None)
    monkeypatch.setattr(admin_dashboard.auth_service, 'get_owner_user', _owner)
    monkeypatch.setattr(admin_dashboard, '_get_dashboard_alert_thresholds', _owner)
    monkeypatch.setattr(admin_dashboard, '_dashboard_alert_thresholds_payload', lambda *_args, **_kwargs: {'ok': True})

    invoked = 0
    failed_calls: list[tuple[str, str]] = []
    for name, func in inspect.getmembers(admin_dashboard, inspect.iscoroutinefunction):
        if func.__module__ != admin_dashboard.__name__ or name.startswith('_'):
            continue
        kwargs: dict[str, object] = {}
        for param in inspect.signature(func).parameters.values():
            if param.default is not inspect._empty:
                continue
            kwargs[param.name] = _dashboard_sweep_arg(
                param.name,
                session=session,
                request=request,
                admin_user=admin_user,
            )
        try:
            await func(**kwargs)
        except Exception as exc:
            failed_calls.append((name, type(exc).__name__))
        invoked += 1

    assert invoked >= 40
