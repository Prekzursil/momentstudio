import pytest

from app.schemas.shipping import LockerProvider
from app.services import lockers as lockers_service


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.mark.anyio("asyncio")
async def test_list_lockers_prefers_official_when_configured(monkeypatch) -> None:
    lockers_service._reset_cache_for_tests()

    monkeypatch.setattr(lockers_service.settings, "sameday_api_base_url", "https://example.invalid")
    monkeypatch.setattr(lockers_service.settings, "sameday_api_username", "u")
    monkeypatch.setattr(lockers_service.settings, "sameday_api_password", "p")
    monkeypatch.setattr(lockers_service.settings, "lockers_use_overpass_fallback", False)

    async def fake_load() -> list[lockers_service._LockerPoint]:  # type: ignore[name-defined]
        return [
            lockers_service._LockerPoint(
                id="sameday:1",
                provider=LockerProvider.sameday,
                name="Locker 1",
                address="Addr",
                lat=44.4,
                lng=26.1,
            )
        ]

    monkeypatch.setattr(lockers_service, "_load_sameday_lockers", fake_load)
    monkeypatch.setattr(lockers_service, "_build_query", lambda *_a, **_kw: (_ for _ in ()).throw(AssertionError("Overpass used")))

    items = await lockers_service.list_lockers(provider=LockerProvider.sameday, lat=44.4, lng=26.1, radius_km=5.0, limit=10)
    assert items
    assert items[0].id == "sameday:1"
    assert items[0].provider == LockerProvider.sameday


@pytest.mark.anyio("asyncio")
async def test_list_lockers_raises_when_not_configured_and_no_overpass(monkeypatch) -> None:
    lockers_service._reset_cache_for_tests()
    monkeypatch.setattr(lockers_service.settings, "sameday_api_base_url", None)
    monkeypatch.setattr(lockers_service.settings, "sameday_api_username", None)
    monkeypatch.setattr(lockers_service.settings, "sameday_api_password", None)
    monkeypatch.setattr(lockers_service.settings, "lockers_use_overpass_fallback", False)

    with pytest.raises(lockers_service.LockersNotConfiguredError):
        await lockers_service.list_lockers(provider=LockerProvider.sameday, lat=44.4, lng=26.1, radius_km=5.0, limit=10)


@pytest.mark.anyio("asyncio")
async def test_list_lockers_fan_uses_official_when_configured(monkeypatch) -> None:
    lockers_service._reset_cache_for_tests()

    monkeypatch.setattr(lockers_service.settings, "fan_api_base_url", "https://example.invalid")
    monkeypatch.setattr(lockers_service.settings, "fan_api_username", "u")
    monkeypatch.setattr(lockers_service.settings, "fan_api_password", "p")
    monkeypatch.setattr(lockers_service.settings, "lockers_use_overpass_fallback", False)

    async def fake_load() -> list[lockers_service._LockerPoint]:  # type: ignore[name-defined]
        return [
            lockers_service._LockerPoint(
                id="fan:FAN0001",
                provider=LockerProvider.fan_courier,
                name="FANbox One",
                address="Addr",
                lat=44.4,
                lng=26.1,
            )
        ]

    monkeypatch.setattr(lockers_service, "_load_fan_lockers", fake_load)
    monkeypatch.setattr(lockers_service, "_build_query", lambda *_a, **_kw: (_ for _ in ()).throw(AssertionError("Overpass used")))

    items = await lockers_service.list_lockers(provider=LockerProvider.fan_courier, lat=44.4, lng=26.1, radius_km=5.0, limit=10)
    assert items
    assert items[0].id == "fan:FAN0001"
    assert items[0].provider == LockerProvider.fan_courier


@pytest.mark.anyio("asyncio")
async def test_fan_auth_token_parses_nested_response(monkeypatch) -> None:
    lockers_service._reset_cache_for_tests()

    monkeypatch.setattr(lockers_service.settings, "fan_api_base_url", "https://example.invalid")
    monkeypatch.setattr(lockers_service.settings, "fan_api_username", "u")
    monkeypatch.setattr(lockers_service.settings, "fan_api_password", "p")

    class DummyResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {"status": "success", "data": {"token": "tok", "expiresAt": "2099-01-01 00:00:00"}}

    class DummyClient:
        def __init__(self, *args, **kwargs) -> None:
            self.kwargs = kwargs

        async def __aenter__(self) -> "DummyClient":
            return self

        async def __aexit__(self, exc_type, exc, tb) -> bool:
            return False

        async def post(self, path: str, params: dict | None = None) -> DummyResponse:
            assert path == "/login"
            assert params == {"username": "u", "password": "p"}
            return DummyResponse()

    monkeypatch.setattr(lockers_service.httpx, "AsyncClient", DummyClient)

    token = await lockers_service._fan_get_token()
    assert token == "tok"
