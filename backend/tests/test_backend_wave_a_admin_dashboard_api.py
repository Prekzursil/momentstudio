from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.api.v1 import admin_dashboard
from app.schemas.admin_dashboard_alert_thresholds import AdminDashboardAlertThresholdsUpdateRequest


class _DashboardSession:
    def __init__(self) -> None:
        self.added: list[object] = []
        self.commits = 0
        self.rollbacks = 0
        self.refresh_calls: list[object] = []

    def add(self, value: object) -> None:
        self.added.append(value)

    async def commit(self) -> None:
        self.commits += 1

    async def rollback(self) -> None:
        self.rollbacks += 1

    async def refresh(self, value: object) -> None:
        self.refresh_calls.append(value)


def _request(user_agent: str = "Agent/1.0", client_ip: str = "203.0.113.9") -> Request:
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "POST",
        "path": "/",
        "raw_path": b"/",
        "query_string": b"",
        "headers": [(b"user-agent", user_agent.encode("ascii"))],
        "client": (client_ip, 443),
        "server": ("testserver", 80),
        "scheme": "https",
    }
    return Request(scope)


@pytest.mark.anyio
async def test_admin_dashboard_alert_threshold_endpoint_wrappers(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _DashboardSession()
    record = SimpleNamespace(
        key="default",
        failed_payments_min_count=2,
        failed_payments_min_delta_pct=10.0,
        refund_requests_min_count=3,
        refund_requests_min_rate_pct=5.0,
        stockouts_min_count=4,
        updated_at=datetime.now(timezone.utc),
    )

    async def _get_thresholds(_session: object):
        return record

    monkeypatch.setattr(admin_dashboard, "_get_dashboard_alert_thresholds", _get_thresholds)

    result = await admin_dashboard.admin_get_alert_thresholds(session=session, _=object())
    assert result.failed_payments_min_count == 2
    assert result.stockouts_min_count == 4

    audit_calls: list[dict[str, object]] = []

    async def _audit(_session: object, **kwargs):
        audit_calls.append(kwargs)

    monkeypatch.setattr(admin_dashboard.audit_chain_service, "add_admin_audit_log", _audit)

    payload = AdminDashboardAlertThresholdsUpdateRequest(
        failed_payments_min_count=5,
        failed_payments_min_delta_pct=12.5,
        refund_requests_min_count=6,
        refund_requests_min_rate_pct=8.0,
        stockouts_min_count=9,
    )
    user = SimpleNamespace(id=uuid4())

    updated = await admin_dashboard.admin_update_alert_thresholds(
        payload=payload,
        request=_request(),
        session=session,
        current_user=user,
    )
    assert updated.failed_payments_min_count == 5
    assert updated.refund_requests_min_count == 6
    assert session.commits == 1
    assert session.refresh_calls == [record]
    assert audit_calls and audit_calls[0]["action"] == "dashboard.alert_thresholds.update"


@pytest.mark.anyio
async def test_admin_dashboard_summary_and_report_wrappers(monkeypatch: pytest.MonkeyPatch) -> None:
    start = datetime(2026, 2, 1, tzinfo=timezone.utc)
    end = datetime(2026, 2, 10, tzinfo=timezone.utc)

    monkeypatch.setattr(admin_dashboard, "_summary_resolve_range", lambda now, days, range_from, range_to: (start, end, 9))

    async def _summary_totals(*_args, **_kwargs):
        return {"products": 2, "orders": 3, "users": 4, "low_stock": 1}

    async def _sales_metrics(*_args, **_kwargs):
        return {"sales": 100.0, "gross_sales": 120.0, "net_sales": 90.0, "orders": 5}

    async def _day_metrics(*_args, **_kwargs):
        return {
            "today_orders": 2,
            "yesterday_orders": 1,
            "orders_delta_pct": 100.0,
            "today_sales": 20.0,
            "yesterday_sales": 10.0,
            "sales_delta_pct": 100.0,
            "gross_today_sales": 25.0,
            "gross_yesterday_sales": 10.0,
            "gross_sales_delta_pct": 150.0,
            "net_today_sales": 18.0,
            "net_yesterday_sales": 9.0,
            "net_sales_delta_pct": 100.0,
            "today_refunds": 0,
            "yesterday_refunds": 1,
            "refunds_delta_pct": -100.0,
        }

    async def _threshold_record(*_args, **_kwargs):
        return SimpleNamespace()

    async def _anomaly_inputs(*_args, **_kwargs):
        return {
            "failed_payments": 1,
            "failed_payments_prev": 1,
            "refund_requests": 0,
            "refund_requests_prev": 1,
            "refund_window_orders": 5,
            "refund_window_orders_prev": 4,
            "stockouts": 1,
        }

    monkeypatch.setattr(admin_dashboard, "_summary_totals", _summary_totals)
    monkeypatch.setattr(admin_dashboard, "_summary_sales_metrics", _sales_metrics)
    monkeypatch.setattr(admin_dashboard, "_summary_day_metrics", _day_metrics)
    monkeypatch.setattr(admin_dashboard, "_get_dashboard_alert_thresholds", _threshold_record)
    monkeypatch.setattr(
        admin_dashboard,
        "_dashboard_alert_thresholds_payload",
        lambda _record: {
            "failed_payments_min_count": 1,
            "failed_payments_min_delta_pct": None,
            "refund_requests_min_count": 1,
            "refund_requests_min_rate_pct": None,
            "stockouts_min_count": 1,
            "updated_at": None,
        },
    )
    monkeypatch.setattr(admin_dashboard, "_summary_anomaly_inputs", _anomaly_inputs)

    summary = await admin_dashboard.admin_summary(
        session=object(),
        _=object(),
        range_days=30,
        range_from=None,
        range_to=None,
    )
    assert summary["products"] == 2
    assert summary["orders_30d"] == 5
    assert summary["range_days"] == 9
    assert summary["system"]["db_ready"] is True
    assert "anomalies" in summary

    report_session = _DashboardSession()
    audit_actions: list[str] = []

    async def _audit_log(_session: object, *, action: str, **_kwargs) -> None:
        audit_actions.append(action)

    monkeypatch.setattr(admin_dashboard, "_admin_send_report_audit_log", _audit_log)

    async def _send_ok(_session: object, *, kind: str, force: bool):
        assert kind == "weekly"
        assert force is True
        return {"queued": True}

    monkeypatch.setattr(admin_dashboard.admin_reports_service, "send_report_now", _send_ok)
    response = await admin_dashboard.admin_send_scheduled_report(
        request=_request(),
        payload={"kind": "weekly", "force": True},
        session=report_session,
        current_user=SimpleNamespace(id=uuid4()),
    )
    assert response == {"queued": True}
    assert report_session.commits == 1
    assert "admin_reports.send_now" in audit_actions

    async def _send_bad(_session: object, *, kind: str, force: bool):
        raise ValueError("invalid kind")

    monkeypatch.setattr(admin_dashboard.admin_reports_service, "send_report_now", _send_bad)
    with pytest.raises(HTTPException, match="invalid kind"):
        await admin_dashboard.admin_send_scheduled_report(
            request=_request(),
            payload={"kind": "bad", "force": False},
            session=report_session,
            current_user=SimpleNamespace(id=uuid4()),
        )
    assert report_session.rollbacks >= 1
    assert "admin_reports.send_now_failed" in audit_actions

    async def _send_crash(_session: object, *, kind: str, force: bool):
        raise RuntimeError("boom")

    monkeypatch.setattr(admin_dashboard.admin_reports_service, "send_report_now", _send_crash)
    with pytest.raises(RuntimeError, match="boom"):
        await admin_dashboard.admin_send_scheduled_report(
            request=_request(),
            payload={"kind": "weekly", "force": False},
            session=report_session,
            current_user=SimpleNamespace(id=uuid4()),
        )
    assert "admin_reports.send_now_error" in audit_actions


@pytest.mark.anyio
async def test_admin_dashboard_channel_and_payments_wrappers(monkeypatch: pytest.MonkeyPatch) -> None:
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    end = datetime(2026, 1, 5, tzinfo=timezone.utc)
    monkeypatch.setattr(admin_dashboard, "_summary_resolve_range", lambda now, days, range_from, range_to: (start, end, 4))

    async def _channel_items(*_args, **_kwargs):
        return [{"key": "stripe", "orders": 2, "gross_sales": 100.0, "net_sales": 95.0}]

    monkeypatch.setattr(admin_dashboard, "_channel_breakdown_items", _channel_items)

    channel = await admin_dashboard.admin_channel_breakdown(
        session=object(),
        _=object(),
        range_days=30,
        range_from=None,
        range_to=None,
    )
    assert channel["range_days"] == 4
    assert len(channel["payment_methods"]) == 1
    assert len(channel["couriers"]) == 1
    assert len(channel["delivery_types"]) == 1

    async def _method_counts(*_args, **_kwargs):
        return {"stripe": 4, "paypal": 1}

    async def _webhook_counts(*_args, **_kwargs):
        return {"stripe": {"errors": 1, "backlog": 2}, "paypal": {"errors": 0, "backlog": 1}}

    async def _recent_rows(*_args, **_kwargs):
        return []

    monkeypatch.setattr(admin_dashboard, "_payments_method_counts", _method_counts)
    monkeypatch.setattr(admin_dashboard, "_payments_webhook_counts", _webhook_counts)
    monkeypatch.setattr(admin_dashboard, "_payments_recent_webhook_rows", _recent_rows)
    monkeypatch.setattr(admin_dashboard, "_payments_provider_rows", lambda *_args, **_kwargs: [{"provider": "stripe"}])
    monkeypatch.setattr(admin_dashboard, "_payments_recent_webhook_errors", lambda *_args, **_kwargs: [{"provider": "stripe"}])

    payments = await admin_dashboard.admin_payments_health(
        session=object(),
        _=object(),
        since_hours=12,
    )
    assert payments["window_hours"] == 12
    assert payments["providers"] == [{"provider": "stripe"}]
    assert payments["recent_webhook_errors"] == [{"provider": "stripe"}]


def test_admin_dashboard_payment_and_refund_helper_edges() -> None:
    methods = admin_dashboard._payments_sorted_methods(
        {"paypal": 1, "custom": 2},
        {"stripe": 3},
    )
    assert methods[:3] == ["stripe", "paypal", "netopia"]

    provider_rows = admin_dashboard._payments_provider_rows(
        success_map={"stripe": 4},
        pending_map={"stripe": 1, "paypal": 2},
        webhook_counts={"stripe": {"errors": 1, "backlog": 0}, "paypal": {"errors": 0, "backlog": 3}},
    )
    assert any(row["provider"] == "stripe" and row["success_rate"] == pytest.approx(0.8) for row in provider_rows)

    recent = admin_dashboard._payments_recent_webhook_errors(
        stripe_recent_rows=[
            SimpleNamespace(
                stripe_event_id="evt_s_1",
                event_type="payment",
                attempts=2,
                last_attempt_at=datetime(2026, 2, 1, tzinfo=timezone.utc),
                last_error="boom",
            )
        ],
        paypal_recent_rows=[
            SimpleNamespace(
                paypal_event_id="evt_p_1",
                event_type="capture",
                attempts=1,
                last_attempt_at=datetime(2026, 2, 2, tzinfo=timezone.utc),
                last_error="fail",
            )
        ],
    )
    assert recent[0]["provider"] == "paypal"
    assert recent[1]["provider"] == "stripe"

    payload = admin_dashboard._refund_breakdown_payload(
        window_days=7,
        window_start=datetime(2026, 2, 1, tzinfo=timezone.utc),
        window_end=datetime(2026, 2, 8, tzinfo=timezone.utc),
        current_provider=[("stripe", 2, 20.0)],
        previous_provider=[("stripe", 1, 10.0)],
        missing_current_count=1,
        missing_current_amount=8.0,
        missing_prev_count=0,
        missing_prev_amount=0.0,
        current_reasons={"other": 2},
        previous_reasons={"other": 1},
    )
    assert payload["window_days"] == 7
    assert payload["providers"][0]["provider"] == "stripe"
    assert any(item["category"] == "other" for item in payload["reasons"])
