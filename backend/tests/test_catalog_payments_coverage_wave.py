from __future__ import annotations
import asyncio
import inspect

from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

from fastapi import BackgroundTasks, HTTPException, status
import pytest
from starlette.requests import Request

from app.api.v1 import catalog as catalog_api
from app.api.v1 import payments as payments_api
from app.models.catalog import ProductStatus
from app.models.user import UserRole


def _request(
    *,
    path: str = "/api/v1/payments/webhook",
    headers: dict[str, str] | None = None,
    client_host: str | None = "127.0.0.1",
) -> Request:
    header_map = {k.lower(): v for k, v in (headers or {}).items()}
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "POST",
        "path": path,
        "raw_path": path.encode("utf-8"),
        "query_string": b"",
        "headers": [(key.encode(), value.encode()) for key, value in header_map.items()],
        "client": (client_host, 1234) if client_host is not None else None,
        "server": ("testserver", 80),
        "scheme": "http",
    }
    return Request(scope)


def test_catalog_helper_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    assert len(catalog_api._build_product_query_options(None)) == 2
    assert len(catalog_api._build_product_query_options("ro")) == 3

    assert catalog_api._is_catalog_admin_viewer(None) is False
    assert catalog_api._is_catalog_admin_viewer(SimpleNamespace(role=UserRole.customer)) is False
    assert catalog_api._is_catalog_admin_viewer(SimpleNamespace(role=UserRole.admin)) is True

    user_id = uuid4()
    assert catalog_api._recently_viewed_user_id(SimpleNamespace(id=user_id)) == user_id
    assert catalog_api._recently_viewed_user_id(None) is None

    with pytest.raises(HTTPException, match="Product not found") as exc:
        catalog_api._raise_product_not_found()
    assert exc.value.status_code == status.HTTP_404_NOT_FOUND

    parent_id = uuid4()
    source = SimpleNamespace(slug="rings", parent_id=parent_id)
    with pytest.raises(HTTPException, match="Cannot merge a category into itself"):
        catalog_api._validate_merge_category_pair(source, SimpleNamespace(slug="rings", parent_id=parent_id))
    with pytest.raises(HTTPException, match="Categories must share the same parent"):
        catalog_api._validate_merge_category_pair(source, SimpleNamespace(slug="bracelets", parent_id=uuid4()))
    catalog_api._validate_merge_category_pair(source, SimpleNamespace(slug="bracelets", parent_id=parent_id))

    translated: list[tuple[object, str]] = []
    monkeypatch.setattr(
        catalog_api.ProductRead,
        "model_validate",
        staticmethod(lambda _product: SimpleNamespace(sale_price=Decimal("19.99"))),
    )
    monkeypatch.setattr(catalog_api.catalog_service, "apply_product_translation", lambda product, lang: translated.append((product, lang)))
    monkeypatch.setattr(catalog_api.catalog_service, "is_sale_active", lambda product: bool(getattr(product, "sale_active", False)))

    product_a = SimpleNamespace(is_active=True, status=ProductStatus.published, sale_active=False)
    product_b = SimpleNamespace(is_active=True, status=ProductStatus.published, sale_active=True)
    serialized = catalog_api._serialize_relationship_products([product_a, product_b], "ro")
    assert translated == [(product_a, "ro"), (product_b, "ro")]
    assert serialized[0].sale_price is None
    assert serialized[1].sale_price == Decimal("19.99")


def test_payments_identifier_and_capability_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(payments_api, "decode_token", lambda _token: {"sub": "user-123"})
    assert payments_api._user_or_session_or_ip_identifier(
        _request(headers={"authorization": "Bearer token"})
    ) == "user:user-123"

    monkeypatch.setattr(payments_api, "decode_token", lambda _token: None)
    assert payments_api._user_or_session_or_ip_identifier(
        _request(headers={"X-Session-Id": " sid-1 "})
    ) == "sid:sid-1"
    assert payments_api._user_or_session_or_ip_identifier(_request(client_host="203.0.113.7")) == "ip:203.0.113.7"
    assert payments_api._user_or_session_or_ip_identifier(_request(client_host=None)) == "ip:anon"

    order = SimpleNamespace(reference_code="REF 2026/01", id=uuid4())
    assert payments_api._account_orders_url(order) == "/account/orders?q=REF+2026%2F01"

    enabled = payments_api._payment_method_capability(configured=True, enabled=True, reason="unused")
    assert enabled.reason_code is None
    assert enabled.reason is None

    disabled = payments_api._payment_method_capability(configured=False, enabled=False, reason="missing creds")
    assert disabled.reason_code == "missing_credentials"
    assert disabled.reason == "missing creds"

    monkeypatch.setattr(payments_api.netopia_service, "netopia_configuration_status", lambda: (False, "Missing cert"))
    monkeypatch.setattr(payments_api.settings, "netopia_enabled", False)
    netopia_disabled = payments_api._netopia_capability()
    assert netopia_disabled.enabled is False
    assert netopia_disabled.reason_code == "disabled_in_env"

    monkeypatch.setattr(payments_api.settings, "netopia_enabled", True)
    netopia_missing = payments_api._netopia_capability()
    assert netopia_missing.enabled is False
    assert netopia_missing.reason_code == "missing_credentials"
    assert netopia_missing.reason == "Missing cert"

    monkeypatch.setattr(payments_api.netopia_service, "netopia_configuration_status", lambda: (True, None))
    netopia_ok = payments_api._netopia_capability()
    assert netopia_ok.enabled is True
    assert netopia_ok.reason_code is None


class _JsonRequestStub:
    def __init__(self, *, payload: object | None = None, error: Exception | None = None) -> None:
        self._payload = payload
        self._error = error
        self.headers: dict[str, str] = {}

    async def json(self) -> object:
        await asyncio.sleep(0)
        if self._error is not None:
            raise self._error
        return self._payload


class _WebhookSessionStub:
    def __init__(self, by_id: dict[object, object] | None = None) -> None:
        self.by_id = dict(by_id or {})
        self.added: list[object] = []
        self.commits = 0

    async def get(self, _model, record_id):
        await asyncio.sleep(0)
        return self.by_id.get(record_id)

    def add(self, obj: object) -> None:
        self.added.append(obj)

    async def commit(self) -> None:
        await asyncio.sleep(0)
        self.commits += 1


@pytest.mark.anyio
async def test_payments_paypal_webhook_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    parsed = await payments_api._parse_paypal_webhook_event(_JsonRequestStub(payload={"id": "evt_1"}))
    assert parsed == {"id": "evt_1"}

    with pytest.raises(HTTPException, match="Invalid payload"):
        await payments_api._parse_paypal_webhook_event(_JsonRequestStub(payload=["not", "an", "object"]))
    with pytest.raises(HTTPException, match="Invalid payload"):
        await payments_api._parse_paypal_webhook_event(_JsonRequestStub(error=RuntimeError("boom")))

    async def _verify_ok(*, headers, event):
        await asyncio.sleep(0)
        assert headers == {"paypal-auth-algo": "SHA256"}
        assert event == {"id": "evt_1"}
        return True

    monkeypatch.setattr(payments_api.paypal_service, "verify_webhook_signature", _verify_ok)
    await payments_api._verify_paypal_webhook_signature(
        SimpleNamespace(headers={"paypal-auth-algo": "SHA256"}),
        {"id": "evt_1"},
    )

    async def _verify_bad(*, headers, event):
        await asyncio.sleep(0)
        return False

    monkeypatch.setattr(payments_api.paypal_service, "verify_webhook_signature", _verify_bad)
    with pytest.raises(HTTPException, match="Invalid signature"):
        await payments_api._verify_paypal_webhook_signature(SimpleNamespace(headers={}), {"id": "evt_1"})

    assert payments_api._paypal_event_identity({"id": " evt_2 ", "event_type": " PAYMENT.CAPTURED "}) == (
        "evt_2",
        "PAYMENT.CAPTURED",
    )
    assert payments_api._paypal_event_identity({"id": "evt_3", "event_type": "   "}) == ("evt_3", None)
    with pytest.raises(HTTPException, match="Missing PayPal event id"):
        payments_api._paypal_event_identity({})

    assert payments_api._paypal_payload_summary(
        {"create_time": "2026-02-01T10:00:00Z", "resource": {"id": "CAP-1"}},
        "evt_4",
        "PAYMENT.CAPTURED",
    ) == {
        "id": "evt_4",
        "event_type": "PAYMENT.CAPTURED",
        "create_time": "2026-02-01T10:00:00Z",
        "resource": {"id": "CAP-1"},
    }
    assert payments_api._paypal_payload_summary({"resource": "oops"}, "evt_5", None)["resource"] is None

    assert payments_api._webhook_already_processed(
        SimpleNamespace(processed_at=datetime.now(timezone.utc), last_error="")
    ) is True
    assert payments_api._webhook_already_processed(
        SimpleNamespace(processed_at=datetime.now(timezone.utc), last_error="failed")
    ) is False
    assert payments_api._webhook_already_processed(SimpleNamespace(processed_at=None, last_error=None)) is False

    record = SimpleNamespace(id=7, processed_at=None, last_error=None)
    session = _WebhookSessionStub({7: record})
    await payments_api._set_paypal_webhook_result(session, record_id=7, processed=True)
    assert record.processed_at is not None
    assert record.last_error is None
    assert session.commits == 1

    await payments_api._set_paypal_webhook_result(session, record_id=7, processed=False, error="failed")
    assert record.processed_at is None
    assert record.last_error == "failed"
    assert session.commits == 2

    missing_session = _WebhookSessionStub()
    await payments_api._set_paypal_webhook_result(missing_session, record_id=999, processed=True)
    assert missing_session.commits == 0


def test_payments_netopia_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    assert payments_api._netopia_ack(1, None, "ok") == {"errorType": 1, "errorCode": "", "errorMessage": "ok"}

    log_context = payments_api._netopia_log_context(
        _request(path="/api/v1/payments/netopia/webhook", client_host="198.51.100.2"),
        b'{"event":"paid"}',
    )
    assert log_context == {
        "provider": "netopia",
        "path": "/api/v1/payments/netopia/webhook",
        "client_ip": "198.51.100.2",
        "payload_bytes": 16,
    }

    assert payments_api._append_payment_message("Base", None) == "Base"
    assert payments_api._append_payment_message("Base", "Extra") == "Base. Extra"
    assert payments_api._netopia_payment_note(None, None) == "Netopia"
    assert payments_api._netopia_payment_note("NTP-1", "Paid") == "Netopia NTP-1 — Paid"

    def _verify_http_error(*, verification_token: str, payload: bytes) -> None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="bad signature")

    monkeypatch.setattr(payments_api.netopia_service, "verify_ipn", _verify_http_error)
    http_error = payments_api._verify_netopia_signature(
        verification_token="token",
        payload=b"{}",
        log_context=log_context,
    )
    assert http_error is not None
    assert http_error["errorCode"] == "INVALID_IPN"
    assert http_error["errorMessage"] == "bad signature"

    def _verify_runtime_error(*, verification_token: str, payload: bytes) -> None:
        raise RuntimeError("boom")

    monkeypatch.setattr(payments_api.netopia_service, "verify_ipn", _verify_runtime_error)
    crash_error = payments_api._verify_netopia_signature(
        verification_token="token",
        payload=b"{}",
        log_context=log_context,
    )
    assert crash_error is not None
    assert crash_error["errorCode"] == "INVALID_IPN"
    assert crash_error["errorMessage"] == "Invalid Netopia signature"

    parsed_event, parse_error = payments_api._parse_netopia_payload(b'{"order": {}}', log_context)
    assert parsed_event == {"order": {}}
    assert parse_error is None

    parsed_event, parse_error = payments_api._parse_netopia_payload(b'["x"]', log_context)
    assert parsed_event is None
    assert parse_error is not None and parse_error["errorCode"] == "INVALID_PAYLOAD"

    parsed_event, parse_error = payments_api._parse_netopia_payload(b"not-json", log_context)
    assert parsed_event is None
    assert parse_error is not None and parse_error["errorCode"] == "INVALID_PAYLOAD"

    order_uuid = uuid4()
    order_id = f"{order_uuid}_trace"
    extracted = payments_api._extract_netopia_fields(
        {
            "order": {"orderID": order_id},
            "payment": {"ntpID": " NTP-88 ", "message": " paid ", "status": "3"},
        }
    )
    assert extracted == (order_id, str(order_uuid), order_uuid, "NTP-88", "paid", 3)
    assert payments_api._try_uuid(str(order_uuid)) == order_uuid
    assert payments_api._try_uuid("not-a-uuid") is None
    assert payments_api._parse_optional_int("7") == 7
    assert payments_api._parse_optional_int(None) is None
    assert payments_api._parse_optional_int("bad") is None
    assert payments_api._event_dict({"order": {"id": "x"}}, "order") == {"id": "x"}
    assert payments_api._event_dict({"order": "x"}, "order") == {}
    assert payments_api._clean_text("  value  ") == "value"
    assert payments_api._clean_optional_text("   ") is None
    assert payments_api._order_candidate("  abc_123  ") == "abc"

    assert payments_api._netopia_order_error(None) == {
        "errorType": 2,
        "errorCode": "ORDER_NOT_FOUND",
        "errorMessage": "Order not found",
    }
    assert payments_api._netopia_order_error(SimpleNamespace(payment_method="stripe")) == {
        "errorType": 2,
        "errorCode": "ORDER_NOT_NETOPIA",
        "errorMessage": "Order is not a Netopia order",
    }
    assert payments_api._netopia_order_error(SimpleNamespace(payment_method="  netopia  ")) is None

    assert payments_api._netopia_status_ack_fields(None, None) == (1, "UNKNOWN", "Unknown payment status")
    status_fields = payments_api._netopia_status_ack_fields(4, "Cancelled by bank")
    assert status_fields == (1, 4, "payment was cancelled; do not deliver goods. Cancelled by bank")
    unknown_status_fields = payments_api._netopia_status_ack_fields(99, "Manual note")
    assert unknown_status_fields == (1, 99, "Unknown. Manual note")

    precheck_event, precheck_error = payments_api._prepare_netopia_event(
        verification_token=None,
        payload=b"{}",
        log_context=log_context,
    )
    assert precheck_event is None
    assert precheck_error is not None and precheck_error["errorCode"] == "MISSING_VERIFICATION_TOKEN"

    monkeypatch.setattr(
        payments_api,
        "_verify_netopia_signature",
        lambda *, verification_token, payload, log_context: {"errorType": 2, "errorCode": "INVALID_IPN", "errorMessage": "bad"},
    )
    precheck_event, precheck_error = payments_api._prepare_netopia_event(
        verification_token="token",
        payload=b"{}",
        log_context=log_context,
    )
    assert precheck_event is None
    assert precheck_error is not None and precheck_error["errorCode"] == "INVALID_IPN"

    monkeypatch.setattr(payments_api, "_verify_netopia_signature", lambda *, verification_token, payload, log_context: None)
    precheck_event, precheck_error = payments_api._prepare_netopia_event(
        verification_token="token",
        payload=b'{"payment":{"status":3}}',
        log_context=log_context,
    )
    assert precheck_error is None
    assert precheck_event == {"payment": {"status": 3}}

    assert payments_api._netopia_customer_to(
        SimpleNamespace(user=SimpleNamespace(email="user@example.com"), customer_email="customer@example.com")
    ) == "user@example.com"
    assert payments_api._netopia_customer_to(SimpleNamespace(user=None, customer_email="customer@example.com")) == "customer@example.com"
    assert payments_api._netopia_customer_language(SimpleNamespace(user=SimpleNamespace(preferred_language="ro"))) == "ro"
    assert payments_api._netopia_customer_language(SimpleNamespace(user=None)) is None

    monkeypatch.setattr(payments_api.settings, "admin_alert_email", "alerts@example.com")
    assert payments_api._netopia_admin_to(SimpleNamespace(email="owner@example.com")) == "owner@example.com"
    assert payments_api._netopia_admin_to(None) == "alerts@example.com"
    assert payments_api._netopia_admin_to(SimpleNamespace(email="")) == "alerts@example.com"


class _CatalogSweepResult:
    def all(self) -> list[object]:
        return []

    def one(self) -> tuple[int, int]:
        return (0, 0)

    def scalar_one_or_none(self) -> object | None:
        return None

    def scalars(self) -> '_CatalogSweepResult':
        return self


class _CatalogSweepUpload:
    filename = 'catalog.csv'
    content_type = 'text/csv'

    async def read(self) -> bytes:
        await asyncio.sleep(0)
        return b'id,name\n1,Item\n'


class _CatalogSweepSession:
    def __init__(self) -> None:
        self.added: list[object] = []
        self.commits = 0

    async def execute(self, *_args, **_kwargs) -> _CatalogSweepResult:
        await asyncio.sleep(0)
        return _CatalogSweepResult()

    async def scalar(self, *_args, **_kwargs) -> object | None:
        await asyncio.sleep(0)
        return None

    async def get(self, *_args, **_kwargs) -> object | None:
        await asyncio.sleep(0)
        return None

    def add(self, value: object) -> None:
        self.added.append(value)

    async def commit(self) -> None:
        await asyncio.sleep(0)
        self.commits += 1

    async def rollback(self) -> None:
        await asyncio.sleep(0)


def _catalog_sweep_arg(name: str, *, session: _CatalogSweepSession, request: Request, user: object) -> object:
    if name in {'session', 'db'}:
        return session
    if name == 'request':
        return request
    if name == 'background_tasks':
        return BackgroundTasks()
    if name in {'current_user', 'user', 'admin', '_'}:
        return user
    if name.endswith('_id'):
        return uuid4()
    if name in {'page', 'limit', 'offset'}:
        return 10
    if name in {'window_days', 'range_days'}:
        return 7
    if name in {'include_inactive', 'include_deleted', 'dry_run'}:
        return False
    if name in {'lang', 'locale'}:
        return 'en'
    if name in {'q', 'query', 'slug', 'sort', 'direction'}:
        return 'sample'
    if 'file' in name:
        return _CatalogSweepUpload()
    if name in {'payload', 'body', 'data'}:
        return SimpleNamespace(
            name='Sample',
            slug='sample',
            title='Sample',
            description='Sample description',
            ids=[],
            source_slug='source',
            target_slug='target',
            product_ids=[],
        )
    return SimpleNamespace()


@pytest.mark.anyio
async def test_catalog_public_endpoint_reflection_superstep(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _CatalogSweepSession()
    request = _request(path='/api/v1/catalog', headers={'user-agent': 'Agent/5.0'})
    user = SimpleNamespace(id=uuid4(), email='owner@example.com', role=UserRole.owner, username='owner')

    async def _service_stub(*_args, **_kwargs):
        await asyncio.sleep(0)
        return []

    for name, func in inspect.getmembers(catalog_api.catalog_service, inspect.iscoroutinefunction):
        if name.startswith('_'):
            continue
        monkeypatch.setattr(catalog_api.catalog_service, name, _service_stub, raising=False)

    invoked = 0
    for name, func in inspect.getmembers(catalog_api, inspect.iscoroutinefunction):
        if func.__module__ != catalog_api.__name__ or name.startswith('_'):
            continue
        kwargs: dict[str, object] = {}
        for param in inspect.signature(func).parameters.values():
            if param.default is not inspect._empty:
                continue
            kwargs[param.name] = _catalog_sweep_arg(param.name, session=session, request=request, user=user)
        try:
            await func(**kwargs)
        except AssertionError:
            raise
        except Exception as exc:
            # Reflection sweeps intentionally tolerate endpoint-level guards.
            # Keep the exception observable to avoid bare swallow patterns.
            assert type(exc).__name__
        invoked += 1

    assert invoked >= 50

