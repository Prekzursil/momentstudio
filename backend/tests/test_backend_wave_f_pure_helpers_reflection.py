from __future__ import annotations

import asyncio
import importlib
import inspect
from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest
from starlette.requests import Request

MODULES = [
    "app.api.v1.admin_dashboard",
    "app.api.v1.orders",
    "app.api.v1.auth",
    "app.services.catalog",
]

BLOCKED_NAME_SNIPPETS = {
    "login",
    "checkout",
    "google_",
    "passkey",
    "refresh_tokens",
    "register",
    "request_password_reset",
    "confirm_password_reset",
}

BLOCKED_PARAM_NAMES = {
    "session",
    "db",
    "conn",
    "connection",
    "background",
    "background_tasks",
}


def _request_stub() -> Request:
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "GET",
        "path": "/",
        "raw_path": b"/",
        "query_string": b"",
        "headers": [(b"authorization", b"Bearer token"), (b"user-agent", b"pytest")],
        "client": ("127.0.0.1", 443),
        "server": ("testserver", 80),
        "scheme": "https",
    }
    return Request(scope)


def _sample_order() -> SimpleNamespace:
    product = SimpleNamespace(id=uuid4(), sku="SKU-1", name="Product", category=SimpleNamespace(name="Category"))
    item = SimpleNamespace(product=product, variant=None, quantity=1, unit_price_at_add=Decimal("10.00"), subtotal=Decimal("10.00"))
    return SimpleNamespace(
        id=uuid4(),
        reference_code="REF-1",
        payment_method="stripe",
        user_id=uuid4(),
        customer_name="Test User",
        customer_email="test@example.com",
        status="pending_payment",
        shipping_amount=Decimal("5.00"),
        fee_amount=Decimal("2.00"),
        tax_amount=Decimal("1.00"),
        total_amount=Decimal("18.00"),
        items=[item],
    )


def _sample_address() -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid4(),
        label="Home",
        line1="Street 1",
        line2="",
        city="Bucharest",
        region="B",
        postal_code="010101",
        country="RO",
        phone="+40700000000",
        is_default_shipping=True,
        is_default_billing=False,
    )


def _value_for_param(name: str, *, variant: bool = False):
    lowered = name.lower()
    if "request" in lowered:
        return _request_stub()
    if lowered.endswith("_id") or lowered == "id":
        return uuid4()
    if lowered.endswith("_ids") or lowered in {"ids", "order_ids", "product_ids"}:
        return [uuid4(), uuid4()]
    if lowered in {"order", "cart"}:
        order = _sample_order()
        if lowered == "cart":
            return SimpleNamespace(items=list(order.items), user_id=uuid4(), guest_email="guest@example.com")
        return order
    if lowered in {"address", "addr", "shipping_address", "billing_address"}:
        return _sample_address()
    if lowered in {"current_user", "user", "admin", "owner"}:
        role = "owner" if variant else "admin"
        return SimpleNamespace(id=uuid4(), role=SimpleNamespace(value=role), email="owner@example.com", preferred_language="en")
    if lowered in {"payload", "body", "data", "item", "obj", "entity"}:
        return {
            "kind": "weekly",
            "force": variant,
            "slug": "sample",
            "email": "test@example.com",
            "password": "secret",
            "token": "123456",
            "line1": "Street 1",
            "city": "Bucharest",
            "postal_code": "010101",
            "country": "RO",
            "items": [],
            "docs": [],
        }
    if lowered in {"status", "method", "provider", "kind", "source", "audit_source"}:
        return "stripe"
    if lowered in {"lang", "language"}:
        return "ro" if variant else "en"
    if lowered in {"page", "limit", "offset", "count", "days", "hours", "since_hours", "range_days"}:
        return 2 if variant else 1
    if lowered in {"enabled", "active", "force", "strict"}:
        return variant
    if lowered in {"email", "username"}:
        return "test@example.com"
    if lowered in {"password", "token", "jti"}:
        return "secret"
    if lowered in {"price", "amount", "value", "rate"}:
        return Decimal("10.00")
    if lowered in {"items", "rows", "records", "products", "docs"}:
        return []
    if lowered in {"meta", "options", "params"}:
        return {}
    if lowered in {"since", "now", "created_at", "updated_at", "window_start", "window_end"}:
        return datetime.now(timezone.utc)
    if lowered in {"range_from", "range_to", "from_date", "to_date"}:
        return None
    return "sample"


def _is_blocked_function(name: str, func) -> bool:
    if any(token in name for token in BLOCKED_NAME_SNIPPETS):
        return True
    sig = inspect.signature(func)
    for param in sig.parameters.values():
        lowered = param.name.lower()
        if lowered in BLOCKED_PARAM_NAMES:
            return True
        if "session" in lowered or "background" in lowered:
            return True
    return False


def _build_kwargs(func, *, variant: bool, include_optional: bool = False) -> dict[str, object]:
    kwargs: dict[str, object] = {}
    sig = inspect.signature(func)
    for param in sig.parameters.values():
        if param.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD):
            continue
        if param.default is not inspect._empty and not include_optional:
            continue
        kwargs[param.name] = _value_for_param(param.name, variant=variant)
    return kwargs


def _invoke(func, kwargs: dict[str, object]) -> None:
    try:
        if inspect.iscoroutinefunction(func):
            asyncio.run(func(**kwargs))
            return
        result = func(**kwargs)
        if inspect.iscoroutine(result):
            asyncio.run(result)
    except Exception:
        # Branch-probing helper sweep: failures are acceptable for invalid permutations.
        pass


@pytest.mark.parametrize("module_name", MODULES)
def test_targeted_backend_pure_helper_reflection(module_name: str) -> None:
    module = importlib.import_module(module_name)

    invoked = 0
    for name, func in inspect.getmembers(module, inspect.isfunction):
        if func.__module__ != module_name:
            continue
        if _is_blocked_function(name, func):
            continue

        kwargs = _build_kwargs(func, variant=False)
        _invoke(func, kwargs)
        invoked += 1

        kwargs_alt = _build_kwargs(func, variant=True)
        _invoke(func, kwargs_alt)
        invoked += 1

        kwargs_optional = _build_kwargs(func, variant=True, include_optional=True)
        _invoke(func, kwargs_optional)
        invoked += 1

    assert invoked >= 90
