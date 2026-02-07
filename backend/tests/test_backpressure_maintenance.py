from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import get_application
from app.middleware.backpressure import BackpressureMiddleware
from app.middleware.request_log import RequestLoggingMiddleware


def test_maintenance_mode_returns_503(monkeypatch):
    monkeypatch.setattr(settings, "maintenance_mode", True)
    app = get_application()
    client = TestClient(app)
    res = client.get("/api/v1/catalog/products")
    assert res.status_code == 503
    monkeypatch.setattr(settings, "maintenance_mode", False)


def test_maintenance_mode_allows_payment_webhooks(monkeypatch):
    monkeypatch.setattr(settings, "maintenance_mode", True)
    app = get_application()
    client = TestClient(app)
    for path in (
        "/api/v1/payments/webhook",
        "/api/v1/payments/paypal/webhook",
        "/api/v1/payments/netopia/webhook",
    ):
        res = client.post(path, json={})
        assert res.status_code != 503, f"{path} should not be blocked by maintenance mode"
    monkeypatch.setattr(settings, "maintenance_mode", False)


def test_backpressure_zero_concurrency(monkeypatch):
    monkeypatch.setattr(settings, "max_concurrent_requests", 0)
    app = FastAPI()
    app.add_middleware(BackpressureMiddleware)
    app.add_middleware(RequestLoggingMiddleware)

    @app.get("/ok")
    async def ok() -> dict[str, bool]:
        return {"ok": True}

    client = TestClient(app)
    res = client.get("/ok")
    assert res.status_code == 200, res.text
