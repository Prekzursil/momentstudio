from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import BackgroundTasks, HTTPException
from starlette.requests import Request
from starlette.responses import Response

from app.api.v1 import admin_dashboard
from app.api.v1 import auth as auth_api
from app.api.v1 import orders as orders_api
from app.models.user import UserRole
from app.schemas.auth import RefreshRequest


class _Rows:
    def __init__(self, rows: list[object] | None = None) -> None:
        self._rows = list(rows or [])

    def all(self) -> list[object]:
        return list(self._rows)

    def first(self):
        return self._rows[0] if self._rows else None

    def unique(self):
        return self


class _ExecResult:
    def __init__(
        self,
        *,
        rows: list[object] | None = None,
        scalar_one_or_none: object | None = None,
    ) -> None:
        self._rows = list(rows or [])
        self._scalar = scalar_one_or_none

    def all(self) -> list[object]:
        return list(self._rows)

    def scalars(self) -> _Rows:
        return _Rows(self._rows)

    def scalar_one_or_none(self):
        return self._scalar


class _Session:
    def __init__(
        self,
        *,
        execute_results: list[_ExecResult] | None = None,
        get_map: dict[object, object] | None = None,
    ) -> None:
        self.execute_results = list(execute_results or [])
        self.get_map = dict(get_map or {})
        self.added: list[object] = []
        self.commits = 0
        self.flushes = 0
        self.refreshed: list[object] = []

    async def execute(self, _stmt: object) -> _ExecResult:
        if not self.execute_results:
            raise AssertionError("Unexpected execute()")
        return self.execute_results.pop(0)

    async def get(self, _model: object, key: object):
        return self.get_map.get(key)

    def add(self, value: object) -> None:
        self.added.append(value)

    def add_all(self, values: list[object]) -> None:
        self.added.extend(values)

    async def commit(self) -> None:
        self.commits += 1

    async def flush(self) -> None:
        self.flushes += 1

    async def refresh(self, value: object) -> None:
        self.refreshed.append(value)


def _request(
    *,
    headers: dict[str, str] | None = None,
    cookies: dict[str, str] | None = None,
    client_host: str | None = "198.51.100.10",
) -> Request:
    normalized = {k.lower(): v for k, v in (headers or {}).items()}
    if cookies:
        normalized["cookie"] = "; ".join(f"{k}={v}" for k, v in cookies.items())
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "GET",
        "path": "/",
        "raw_path": b"/",
        "query_string": b"",
        "headers": [(k.encode("latin-1"), v.encode("latin-1")) for k, v in normalized.items()],
        "client": (client_host, 443) if client_host else None,
        "server": ("testserver", 80),
        "scheme": "https",
    }
    return Request(scope)


def _rows_result(rows: list[object] | None = None) -> _ExecResult:
    return _ExecResult(rows=rows or [])


@pytest.mark.anyio
async def test_orders_confirmation_lookup_helpers() -> None:
    order = SimpleNamespace(id=uuid4())
    session_found = _Session(execute_results=[_rows_result([order]), _rows_result([order]), _rows_result([order])])
    assert await orders_api._get_order_by_paypal_order_id_for_confirmation(session_found, "pp-1") is order
    assert await orders_api._get_order_by_stripe_session_id(session_found, "cs_test") is order
    assert await orders_api._get_order_by_id_for_confirmation(session_found, order.id) is order

    session_missing = _Session(execute_results=[_rows_result([]), _rows_result([]), _rows_result([])])
    with pytest.raises(HTTPException, match="Order not found"):
        await orders_api._get_order_by_paypal_order_id_for_confirmation(session_missing, "missing")
    with pytest.raises(HTTPException, match="Order not found"):
        await orders_api._get_order_by_stripe_session_id(session_missing, "missing")
    with pytest.raises(HTTPException, match="Order not found"):
        await orders_api._get_order_by_id_for_confirmation(session_missing, uuid4())


def test_orders_retrieve_paid_stripe_session_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    assert orders_api._retrieve_paid_stripe_session("cs_1", mock_mode=True) is None

    monkeypatch.setattr(orders_api.payments, "is_stripe_configured", lambda: False)
    with pytest.raises(HTTPException, match="Stripe not configured"):
        orders_api._retrieve_paid_stripe_session("cs_1", mock_mode=False)

    monkeypatch.setattr(orders_api.payments, "is_stripe_configured", lambda: True)
    monkeypatch.setattr(orders_api.payments, "init_stripe", lambda: None)

    class _StripeSession:
        @staticmethod
        def retrieve(_sid: str):
            raise RuntimeError("boom")

    monkeypatch.setattr(orders_api.payments, "stripe", SimpleNamespace(checkout=SimpleNamespace(Session=_StripeSession)))
    with pytest.raises(HTTPException, match="Stripe session lookup failed"):
        orders_api._retrieve_paid_stripe_session("cs_1", mock_mode=False)

    class _StripeUnpaid:
        @staticmethod
        def retrieve(_sid: str):
            return {"payment_status": "open"}

    monkeypatch.setattr(orders_api.payments, "stripe", SimpleNamespace(checkout=SimpleNamespace(Session=_StripeUnpaid)))
    with pytest.raises(HTTPException, match="Payment not completed"):
        orders_api._retrieve_paid_stripe_session("cs_1", mock_mode=False)

    class _StripePaid:
        @staticmethod
        def retrieve(_sid: str):
            return {"payment_status": "paid", "payment_intent": "pi_1"}

    monkeypatch.setattr(orders_api.payments, "stripe", SimpleNamespace(checkout=SimpleNamespace(Session=_StripePaid)))
    session = orders_api._retrieve_paid_stripe_session("cs_paid", mock_mode=False)
    assert session["payment_status"] == "paid"


@pytest.mark.anyio
async def test_orders_document_export_shipping_label_and_receipt_paths(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    admin = SimpleNamespace(id=uuid4())
    monkeypatch.setattr(orders_api.step_up_service, "require_step_up", lambda _request, _admin: None)

    async def _missing_export(_session: object, _export_id: object):
        return None, None

    monkeypatch.setattr(orders_api.order_exports_service, "get_export", _missing_export)
    with pytest.raises(HTTPException, match="Export not found"):
        await orders_api.admin_download_document_export(
            export_id=uuid4(),
            request=_request(),
            session=_Session(),
            admin=admin,
        )

    export_file = tmp_path / "orders.csv"
    export_file.write_text("id,ref\n1,ABC\n")
    export = SimpleNamespace(
        id=uuid4(),
        file_path="private/orders.csv",
        filename="orders.csv",
        mime_type="text/csv",
        expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
    )

    async def _get_export(_session: object, _export_id: object):
        return export, "R-1"

    monkeypatch.setattr(orders_api.order_exports_service, "get_export", _get_export)
    monkeypatch.setattr(orders_api.private_storage, "resolve_private_path", lambda _rel: export_file)

    file_response = await orders_api.admin_download_document_export(
        export_id=uuid4(),
        request=_request(),
        session=_Session(),
        admin=admin,
    )
    assert "orders.csv" in file_response.headers.get("content-disposition", "")

    order_id = uuid4()
    label_file = tmp_path / "label.pdf"
    label_file.write_bytes(b"%PDF-1.4")
    order = SimpleNamespace(
        id=order_id,
        shipping_label_path="private/label.pdf",
        shipping_label_filename="label.pdf",
        shipping_label_uploaded_at=datetime.now(timezone.utc),
        user_id=uuid4(),
    )
    session = _Session()

    async def _get_order_by_id(_session: object, oid):
        return order if oid == order_id else None

    monkeypatch.setattr(orders_api.order_service, "get_order_by_id", _get_order_by_id)
    monkeypatch.setattr(orders_api.private_storage, "resolve_private_path", lambda _rel: label_file)
    deleted_paths: list[str] = []
    monkeypatch.setattr(orders_api.private_storage, "delete_private_file", lambda rel: deleted_paths.append(rel))

    download_response = await orders_api.admin_download_shipping_label(
        order_id=order_id,
        request=_request(),
        action="download",
        session=session,
        admin=admin,
    )
    assert "label.pdf" in download_response.headers.get("content-disposition", "")
    assert session.commits == 1

    await orders_api.admin_delete_shipping_label(order_id=order_id, session=session, _=object())
    assert order.shipping_label_path is None
    assert deleted_paths == ["private/label.pdf"]

    async def _get_order_for_user(_session: object, _user_id: object, requested_order_id):
        return order if requested_order_id == order_id else None

    monkeypatch.setattr(orders_api.order_service, "get_order", _get_order_for_user)
    monkeypatch.setattr(orders_api.receipt_service, "render_order_receipt_pdf", lambda _order, _items: b"PDF")
    order.reference_code = "R-123"
    order.items = []

    receipt_response = await orders_api.download_receipt(
        order_id=order_id,
        current_user=SimpleNamespace(id=uuid4()),
        session=_Session(),
    )
    assert receipt_response.media_type == "application/pdf"

    with pytest.raises(HTTPException, match="Order not found"):
        await orders_api.download_receipt(
            order_id=uuid4(),
            current_user=SimpleNamespace(id=uuid4()),
            session=_Session(),
        )


@pytest.mark.anyio
async def test_orders_revoke_receipt_share_token(monkeypatch: pytest.MonkeyPatch) -> None:
    order_id = uuid4()
    order = SimpleNamespace(id=order_id, user_id=uuid4(), receipt_token_version=3)
    session = _Session()

    async def _get_order_by_id(_session: object, oid: object):
        return order if oid == order_id else None

    monkeypatch.setattr(orders_api.order_service, "get_order_by_id", _get_order_by_id)
    monkeypatch.setattr(orders_api, "_require_receipt_share_access", lambda _order, _user: None)
    async def _build_share(_session: object, _order: object):
        return SimpleNamespace(token="tok", version=_order.receipt_token_version)

    monkeypatch.setattr(orders_api, "_build_receipt_share_token_read", _build_share)

    result = await orders_api.revoke_receipt_share_token(
        order_id=order_id,
        session=session,
        current_user=SimpleNamespace(id=order.user_id),
    )
    assert result.version == 4
    assert session.commits == 1
    assert session.refreshed == [order]


@pytest.mark.anyio
async def test_admin_dashboard_channel_search_inventory_and_owner_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    class _ChannelSession(_Session):
        async def execute(self, _stmt: object) -> _ExecResult:
            return _rows_result(
                [
                    ("s-1", uuid4()),
                    ("s-1", uuid4()),
                    (None, uuid4()),
                    ("s-2", None),
                ]
            )

    order_to_session, session_ids = await admin_dashboard._channel_order_to_session_map(
        _ChannelSession(),
        start=datetime.now(timezone.utc),
        end=datetime.now(timezone.utc),
    )
    assert len(order_to_session) == 2
    assert session_ids == {"s-1"}

    payload_session = _Session(
        execute_results=[
            _rows_result(
                [
                    ("s-1", {"utm_source": "google"}, datetime.now(timezone.utc)),
                    ("s-1", {"utm_source": "ignored"}, datetime.now(timezone.utc)),
                    ("s-2", "bad-payload", datetime.now(timezone.utc)),
                ]
            )
        ]
    )
    session_payloads = await admin_dashboard._channel_session_payloads(payload_session, {"s-1", "s-2"})
    assert session_payloads["s-1"] == {"utm_source": "google"}
    assert session_payloads["s-2"] is None

    product_id = uuid4()
    user_id = uuid4()
    order_id = uuid4()
    fake_order = SimpleNamespace(id=order_id, reference_code="R-1", customer_email="buyer@example.com")
    fake_product = SimpleNamespace(id=product_id, slug="slug-1", name="Product", is_deleted=False)
    fake_deleted_product = SimpleNamespace(id=product_id, slug="slug-1", name="Product", is_deleted=True)
    fake_user = SimpleNamespace(id=user_id, email="user@example.com", username="u1", deleted_at=None)
    fake_deleted_user = SimpleNamespace(id=user_id, email="user@example.com", username="u1", deleted_at=datetime.now(timezone.utc))

    class _GetSession(_Session):
        def __init__(self, *, product: object, user: object) -> None:
            super().__init__()
            self._product = product
            self._user = user

        async def get(self, model: object, _key: object):
            model_name = getattr(model, "__name__", "")
            if model_name == "Order":
                return fake_order
            if model_name == "Product":
                return self._product
            if model_name == "User":
                return self._user
            return None

    found = await admin_dashboard._global_search_by_uuid(_GetSession(product=fake_product, user=fake_user), uuid4(), True)
    assert {entry.type for entry in found} == {"order", "product", "user"}

    filtered = await admin_dashboard._global_search_by_uuid(
        _GetSession(product=fake_deleted_product, user=fake_deleted_user), uuid4(), False
    )
    assert [entry.type for entry in filtered] == ["order"]

    stock_session = _Session(get_map={product_id: SimpleNamespace(id=product_id, is_deleted=False)})
    loaded_product = await admin_dashboard._stock_adjustments_product_or_404(stock_session, product_id=product_id)
    assert loaded_product.id == product_id

    with pytest.raises(HTTPException, match="Product not found"):
        await admin_dashboard._stock_adjustments_product_or_404(_Session(get_map={}), product_id=product_id)

    bad_variant_id = uuid4()
    resolve_session = _Session(
        get_map={
            product_id: SimpleNamespace(id=product_id, is_deleted=False),
            bad_variant_id: SimpleNamespace(id=bad_variant_id, product_id=uuid4()),
        }
    )
    with pytest.raises(HTTPException, match="Invalid variant"):
        await admin_dashboard._resolve_inventory_product_for_reservations(
            resolve_session,
            product_id=product_id,
            variant_id=bad_variant_id,
        )

    async def _by_any_email(_session: object, _identifier: str):
        return SimpleNamespace(id=uuid4())

    monkeypatch.setattr(admin_dashboard.auth_service, "get_user_by_any_email", _by_any_email)
    owner_target = await admin_dashboard._owner_transfer_target(_Session(), "owner@example.com")
    assert owner_target.id is not None

    async def _none_lookup(_session: object, _identifier: str):
        return None

    monkeypatch.setattr(admin_dashboard.auth_service, "get_user_by_any_email", _none_lookup)
    monkeypatch.setattr(admin_dashboard.auth_service, "get_user_by_username", _none_lookup)
    with pytest.raises(HTTPException, match="User not found"):
        await admin_dashboard._owner_transfer_target(_Session(), "missing")


@pytest.mark.anyio
async def test_admin_dashboard_session_and_user_update_endpoints(monkeypatch: pytest.MonkeyPatch) -> None:
    user_id = uuid4()
    session_id = uuid4()
    current_user = SimpleNamespace(id=uuid4(), role=UserRole.admin)
    now = datetime.now(timezone.utc)
    user = SimpleNamespace(
        id=user_id,
        email="user@example.com",
        username="user1",
        name="User One",
        name_tag=1,
        email_verified=True,
        created_at=now - timedelta(days=1),
        deleted_at=None,
        role=UserRole.customer,
        vip=False,
        admin_note=None,
        locked_until=None,
        locked_reason=None,
        password_reset_required=False,
    )
    active_row = SimpleNamespace(
        id=session_id,
        user_id=user_id,
        created_at=datetime.now(timezone.utc) - timedelta(hours=1),
        expires_at=datetime.now(timezone.utc) + timedelta(hours=2),
        persistent=True,
        revoked=False,
        user_agent="Browser",
        ip_address="203.0.113.10",
        country_code="RO",
    )
    expired_row = SimpleNamespace(
        id=uuid4(),
        user_id=user_id,
        created_at=datetime.now(timezone.utc) - timedelta(days=2),
        expires_at=datetime.now(timezone.utc) - timedelta(hours=1),
        persistent=False,
        revoked=False,
        user_agent=None,
        ip_address=None,
        country_code=None,
    )
    session = _Session(execute_results=[_rows_result([active_row, expired_row])], get_map={user_id: user, session_id: active_row})

    sessions = await admin_dashboard.admin_list_user_sessions(user_id=user_id, session=session, _=object())
    assert len(sessions) == 1
    assert sessions[0].id == session_id

    await admin_dashboard.admin_revoke_user_session(
        user_id=user_id,
        session_id=session_id,
        request=_request(headers={"user-agent": "Agent/1.0"}),
        session=session,
        current_user=current_user,
    )
    assert active_row.revoked is True
    assert session.commits >= 1

    payload_internal = SimpleNamespace(model_dump=lambda exclude_unset=True: {"vip": True, "admin_note": "needs review"})
    updated_internal = await admin_dashboard.update_user_internal(
        user_id=user_id,
        payload=payload_internal,
        session=session,
        current_user=current_user,
    )
    assert updated_internal.vip is True

    payload_security = SimpleNamespace(
        model_dump=lambda exclude_unset=True: {
            "locked_until": datetime.now(timezone.utc) + timedelta(hours=1),
            "locked_reason": "risk",
            "password_reset_required": True,
        }
    )
    updated_security = await admin_dashboard.update_user_security(
        user_id=user_id,
        payload=payload_security,
        request=_request(headers={"user-agent": "Admin/1.0"}),
        session=session,
        current_user=current_user,
    )
    assert updated_security.password_reset_required is True


@pytest.mark.anyio
async def test_auth_rotation_and_logout_helper_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    assert auth_api.ProfileUpdate._normalize_name_parts(None) is None
    assert auth_api.ProfileUpdate._normalize_name_parts("  Jane  ") == "Jane"
    assert auth_api.RegisterRequest._strip_optional_string(None) is None
    assert auth_api.RegisterRequest._strip_optional_string("   ") is None
    assert auth_api.RegisterRequest._strip_optional_string("  mid ") == "mid"

    today = datetime.now(timezone.utc).date()
    assert auth_api.ProfileUpdate._validate_dob(today) == today
    with pytest.raises(ValueError, match="future"):
        auth_api.ProfileUpdate._validate_dob(today + timedelta(days=1))

    user_id = uuid4()
    user = SimpleNamespace(id=user_id, locked_until=None, password_reset_required=False, deleted_at=None, deletion_scheduled_for=None)
    session = _Session(get_map={user_id: user})
    async def _ensure_active(_session: object, _user: object) -> None:
        return None

    monkeypatch.setattr(auth_api, "_ensure_user_account_active", _ensure_active)
    loaded = await auth_api._load_refresh_user_for_rotation(
        session,
        user_id=user_id,
        now=datetime.now(timezone.utc),
    )
    assert loaded is user

    user_locked = SimpleNamespace(
        id=user_id,
        locked_until=datetime.now(timezone.utc) + timedelta(hours=1),
        password_reset_required=False,
        deleted_at=None,
        deletion_scheduled_for=None,
    )
    with pytest.raises(HTTPException, match="temporarily locked"):
        await auth_api._load_refresh_user_for_rotation(
            _Session(get_map={user_id: user_locked}),
            user_id=user_id,
            now=datetime.now(timezone.utc),
        )

    user_reset = SimpleNamespace(
        id=user_id,
        locked_until=None,
        password_reset_required=True,
        deleted_at=None,
        deletion_scheduled_for=None,
    )
    with pytest.raises(HTTPException, match="Password reset required"):
        await auth_api._load_refresh_user_for_rotation(
            _Session(get_map={user_id: user_reset}),
            user_id=user_id,
            now=datetime.now(timezone.utc),
        )

    revoked: list[str] = []
    async def _revoke(_session: object, jti: str, reason: str):
        revoked.append(f"{jti}:{reason}")

    monkeypatch.setattr(auth_api.auth_service, "revoke_refresh_token", _revoke)
    monkeypatch.setattr(auth_api, "decode_token", lambda token: {"jti": "refresh-jti"} if token == "refresh-token" else None)

    response = Response()
    await auth_api.logout(
        payload=RefreshRequest(refresh_token="refresh-token"),
        request=_request(cookies={"refresh_token": "refresh-token"}),
        session=_Session(),
        response=response,
    )
    assert revoked == ["refresh-jti:logout"]


@pytest.mark.anyio
async def test_auth_start_export_job_reuse_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    now = datetime.now(timezone.utc)
    pending_job = SimpleNamespace(
        id=uuid4(),
        status=auth_api.UserDataExportStatus.pending,
        progress=0,
        error_message=None,
        started_at=None,
        finished_at=None,
        expires_at=None,
        created_at=now,
        updated_at=now,
    )
    succeeded_job = SimpleNamespace(
        id=uuid4(),
        status=auth_api.UserDataExportStatus.succeeded,
        file_path="x.json",
        progress=100,
        error_message=None,
        started_at=now - timedelta(minutes=5),
        finished_at=now - timedelta(minutes=1),
        expires_at=now + timedelta(days=1),
        created_at=now - timedelta(minutes=6),
        updated_at=now - timedelta(minutes=1),
    )
    created_job = SimpleNamespace(
        id=uuid4(),
        status=auth_api.UserDataExportStatus.pending,
        progress=0,
        error_message=None,
        started_at=None,
        finished_at=None,
        expires_at=None,
        created_at=now,
        updated_at=now,
    )

    background = BackgroundTasks()
    current_user = SimpleNamespace(id=uuid4())

    async def _latest_pending(_session: object, _uid: object):
        return pending_job

    monkeypatch.setattr(auth_api, "_latest_export_job_for_user", _latest_pending)
    scheduled: list[object] = []
    monkeypatch.setattr(auth_api, "_schedule_export_job", lambda _bg, _session, job_id: scheduled.append(job_id))
    result_pending = await auth_api.start_export_job(background_tasks=background, current_user=current_user, session=_Session())
    assert result_pending.id == pending_job.id
    assert scheduled[-1] == pending_job.id

    async def _latest_succeeded(_session: object, _uid: object):
        return succeeded_job

    monkeypatch.setattr(auth_api, "_latest_export_job_for_user", _latest_succeeded)
    monkeypatch.setattr(auth_api, "_is_reusable_succeeded_export_job", lambda job: bool(job and job.file_path))
    result_reused = await auth_api.start_export_job(background_tasks=background, current_user=current_user, session=_Session())
    assert result_reused.id == succeeded_job.id

    async def _latest_none(_session: object, _uid: object):
        return None

    async def _create_pending(_session: object, _uid: object):
        return created_job

    monkeypatch.setattr(auth_api, "_latest_export_job_for_user", _latest_none)
    monkeypatch.setattr(auth_api, "_create_pending_export_job", _create_pending)
    result_created = await auth_api.start_export_job(background_tasks=background, current_user=current_user, session=_Session())
    assert result_created.id == created_job.id
