from datetime import date, datetime, timezone

from fastapi.testclient import TestClient

from app.main import app
from app.services import fx_rates


def test_fx_rates_endpoint_uses_service(monkeypatch) -> None:
    async def fake_get_fx_rates(*, force_refresh: bool = False) -> fx_rates.FxRates:
        return fx_rates.FxRates(
            base="RON",
            eur_per_ron=0.2,
            usd_per_ron=0.22,
            as_of=date(2026, 1, 1),
            source="bnr",
            fetched_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        )

    monkeypatch.setattr(fx_rates, "_reset_cache_for_tests", lambda: None)
    monkeypatch.setattr(fx_rates, "get_fx_rates", fake_get_fx_rates)

    client = TestClient(app)
    resp = client.get("/api/v1/fx/rates")
    assert resp.status_code == 200
    data = resp.json()
    assert data["base"] == "RON"
    assert data["eur_per_ron"] == 0.2
    assert data["usd_per_ron"] == 0.22
    assert data["as_of"] == "2026-01-01"
    assert data["source"] == "bnr"
