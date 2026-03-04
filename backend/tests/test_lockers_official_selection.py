from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.schemas.shipping import LockerProvider
from app.services import lockers as lockers_service


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.mark.anyio("asyncio")
async def test_list_lockers_prefers_official_when_configured(monkeypatch) -> None:
    lockers_service._reset_cache_for_tests()

    monkeypatch.setattr(lockers_service.settings, "sameday_mirror_enabled", False)
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
    monkeypatch.setattr(lockers_service.settings, "sameday_mirror_enabled", False)
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


def test_parse_fan_locker_core_fields_rejects_missing_coordinates() -> None:
    payload = {"id": "123", "name": "Locker", "latitude": None, "longitude": "26.1"}
    assert lockers_service._parse_fan_locker_core_fields(payload) is None


def test_parse_fan_locker_core_fields_accepts_numeric_coordinates() -> None:
    payload = {"id": "123", "name": "Locker", "latitude": "44.4", "longitude": 26.1}
    parsed = lockers_service._parse_fan_locker_core_fields(payload)
    assert parsed == ("123", 44.4, 26.1, "Locker")


def test_overpass_format_helpers_and_parse_branches() -> None:
    tags = {'addr:street': 'Main', 'addr:housenumber': '10', 'addr:city': 'Bucharest', 'addr:postcode': '010101'}
    assert lockers_service._format_address(tags) == 'Main 10, Bucharest, 010101'
    assert lockers_service._format_address({'description': 'Fallback location'}) == 'Fallback location'

    assert lockers_service._format_name({'name': 'Named locker'}, LockerProvider.sameday) == 'Named locker'
    assert lockers_service._format_name({'brand': 'Brand locker'}, LockerProvider.fan_courier) == 'Brand locker'
    assert lockers_service._format_name({}, LockerProvider.sameday) == 'Easybox'
    assert lockers_service._format_name({}, LockerProvider.fan_courier) == 'FANbox'

    invalid = lockers_service._build_overpass_locker({'type': 'node'}, provider=LockerProvider.sameday, lat=44.4, lng=26.1)
    assert invalid is None

    parsed = lockers_service._build_overpass_locker(
        {
            'type': 'node',
            'id': 123,
            'lat': 44.41,
            'lon': 26.11,
            'tags': {'name': 'Locker 123', 'address': 'Road 1'},
        },
        provider=LockerProvider.sameday,
        lat=44.4,
        lng=26.1,
    )
    assert parsed is not None
    assert parsed.id == 'osm:node:123'


@pytest.mark.anyio('asyncio')
async def test_load_sameday_lockers_paginates_and_parses(monkeypatch) -> None:
    lockers_service._reset_cache_for_tests()
    async def _token_sameday():
        return 'token'
    monkeypatch.setattr(lockers_service, '_sameday_get_token', _token_sameday)
    monkeypatch.setattr(lockers_service, '_sameday_base_url', lambda: 'https://example.invalid')

    pages = [
        {
            'data': [{'lockerId': 'A1', 'name': 'A One', 'lat': '44.4', 'lng': '26.1', 'address': 'Addr 1'}],
            'pages': 2,
            'currentPage': 1,
        },
        {
            'data': [{'lockerId': 'B2', 'name': 'B Two', 'lat': 44.41, 'lng': 26.12, 'address': 'Addr 2'}],
            'pages': 2,
            'currentPage': 2,
        },
    ]

    class _Response:
        def __init__(self, payload):
            self.payload = payload

        def raise_for_status(self) -> None:
            return None

        def json(self):
            return self.payload

    class _Client:
        def __init__(self, *args, **kwargs) -> None:
            self.calls = 0

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, path: str, params=None):
            assert path == '/api/client/lockers'
            payload = pages[self.calls]
            self.calls += 1
            return _Response(payload)

    monkeypatch.setattr(lockers_service.httpx, 'AsyncClient', _Client)

    rows = await lockers_service._load_sameday_lockers()
    assert len(rows) == 2
    assert rows[0].id == 'sameday:A1'
    assert rows[1].id == 'sameday:B2'


@pytest.mark.anyio('asyncio')
async def test_load_fan_lockers_filters_invalid_rows(monkeypatch) -> None:
    lockers_service._reset_cache_for_tests()
    async def _token_fan():
        return 'token'
    monkeypatch.setattr(lockers_service, '_fan_get_token', _token_fan)
    monkeypatch.setattr(lockers_service, '_fan_base_url', lambda: 'https://example.invalid')

    class _Response:
        def raise_for_status(self) -> None:
            return None

        def json(self):
            return {
                'data': [
                    {'id': '1', 'name': 'Valid Fan', 'latitude': '44.4', 'longitude': '26.1', 'address': {'street': 'Main'}},
                    {'id': '2', 'name': 'Missing coords', 'latitude': None, 'longitude': '26.1'},
                ]
            }

    class _Client:
        def __init__(self, *args, **kwargs) -> None:
            self.args = args
            self.kwargs = kwargs

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, path: str, params=None):
            assert path == '/reports/pickup-points'
            return _Response()

    monkeypatch.setattr(lockers_service.httpx, 'AsyncClient', _Client)

    rows = await lockers_service._load_fan_lockers()
    assert len(rows) == 1
    assert rows[0].id == 'fan:1'


@pytest.mark.anyio('asyncio')
async def test_get_all_lockers_reuses_stale_cache_when_refresh_fails(monkeypatch) -> None:
    lockers_service._reset_cache_for_tests()
    stale = [
        lockers_service._LockerPoint(
            id='sameday:stale',
            provider=LockerProvider.sameday,
            name='Stale Locker',
            address='Addr',
            lat=44.4,
            lng=26.1,
        )
    ]
    lockers_service._all_lockers[LockerProvider.sameday] = lockers_service._AllLockersEntry(
        expires_at=datetime.now(timezone.utc) - timedelta(hours=1),
        items=stale,
    )

    monkeypatch.setattr(lockers_service, '_sameday_configured', lambda: True)

    async def _raise_loader():
        raise RuntimeError('refresh failed')

    monkeypatch.setattr(lockers_service, '_load_sameday_lockers', _raise_loader)

    rows = await lockers_service._get_all_lockers(LockerProvider.sameday)
    assert rows == stale


@pytest.mark.anyio('asyncio')
async def test_query_mirror_and_list_lockers_cached_fallback(monkeypatch) -> None:
    lockers_service._reset_cache_for_tests()

    async def _nearby(_session, **_kwargs):
        return [
            lockers_service.LockerRead(
                id='mirror:1',
                provider=LockerProvider.sameday,
                name='Mirror',
                address='Addr',
                lat=44.4,
                lng=26.1,
                distance_km=0.2,
            )
        ]

    monkeypatch.setattr(lockers_service.sameday_easybox_mirror, 'list_nearby_lockers', _nearby)
    mirror_rows = await lockers_service._query_mirror_lockers(
        lat=44.4,
        lng=26.1,
        radius_km=5.0,
        limit=10,
        session=SimpleNamespace(),
    )
    assert len(mirror_rows) == 1

    cached_rows = [
        lockers_service.LockerRead(
            id='cached:1',
            provider=LockerProvider.fan_courier,
            name='Cached',
            address='Addr',
            lat=44.4,
            lng=26.1,
            distance_km=0.4,
        )
    ]
    key = lockers_service._locker_cache_key(
        LockerProvider.fan_courier,
        'official',
        lat=44.4,
        lng=26.1,
        radius_km=5.0,
        limit=10,
    )
    lockers_service._cache[key] = lockers_service._CacheEntry(
        expires_at=datetime.now(timezone.utc) - timedelta(minutes=5),
        items=cached_rows,
    )

    monkeypatch.setattr(lockers_service, '_locker_source', lambda _provider: 'official')

    async def _raise_query(*_args, **_kwargs):
        raise RuntimeError('source down')

    monkeypatch.setattr(lockers_service, '_query_source_lockers', _raise_query)

    out = await lockers_service.list_lockers(
        provider=LockerProvider.fan_courier,
        lat=44.4,
        lng=26.1,
        radius_km=5.0,
        limit=10,
        force_refresh=True,
    )
    assert out == cached_rows
