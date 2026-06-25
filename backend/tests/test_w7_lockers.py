"""Worker-7 coverage tests for ``app.services.lockers``.

Self-contained: this file alone drives ``app.services.lockers`` to 100% line and
branch coverage. External HTTP (Overpass / Sameday / FAN Courier) is mocked with
respx; the mirror path and ``SessionLocal`` are monkeypatched so no real network
or database access happens. ``_reset_cache_for_tests`` provides isolation between
tests that exercise the process-global caches.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import httpx
import pytest
import respx

from app.schemas.shipping import LockerProvider, LockerRead
from app.services import lockers as svc


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture(autouse=True)
def _reset() -> None:
    svc._reset_cache_for_tests()
    yield
    svc._reset_cache_for_tests()


def _point(**kw) -> svc._LockerPoint:  # type: ignore[name-defined]
    base = dict(
        id="sameday:1",
        provider=LockerProvider.sameday,
        name="Locker",
        address="Addr",
        lat=44.4,
        lng=26.1,
    )
    base.update(kw)
    return svc._LockerPoint(**base)  # type: ignore[arg-type]


# --------------------------------------------------------------------------- #
# pure helpers
# --------------------------------------------------------------------------- #
def test_round_coord() -> None:
    assert svc._round_coord(44.43678) == 44.44


def test_haversine_zero_and_positive() -> None:
    assert svc._haversine_km(44.0, 26.0, 44.0, 26.0) == 0.0
    assert svc._haversine_km(44.0, 26.0, 45.0, 26.0) > 100.0


def test_build_query_sameday_and_fan() -> None:
    q_sd = svc._build_query(LockerProvider.sameday, lat=44.0, lng=26.0, radius_m=5000)
    assert "easybox" in q_sd and "parcel_locker" in q_sd
    q_fan = svc._build_query(
        LockerProvider.fan_courier, lat=44.0, lng=26.0, radius_m=5000
    )
    assert "fanbox" in q_fan and "fan courier" in q_fan


def test_format_address_structured() -> None:
    addr = svc._format_address(
        {
            "addr:street": "Strada Mare",
            "addr:housenumber": "10",
            "addr:city": "Bucuresti",
            "addr:postcode": "010101",
        }
    )
    assert addr == "Strada Mare 10, Bucuresti, 010101"


def test_format_address_fallback_keys() -> None:
    assert svc._format_address({"description": "Near the mall"}) == "Near the mall"


def test_format_address_none() -> None:
    assert svc._format_address({}) is None


def test_format_name_prefers_name_then_brand_then_default() -> None:
    assert svc._format_name({"name": "X"}, LockerProvider.sameday) == "X"
    assert svc._format_name({"brand": "Easybox B"}, LockerProvider.sameday) == (
        "Easybox B"
    )
    assert svc._format_name({}, LockerProvider.sameday) == "Easybox"
    assert svc._format_name({}, LockerProvider.fan_courier) == "FANbox"


def test_format_fan_address_structured_and_none() -> None:
    addr = svc._format_fan_address(
        {
            "street": "Bd Unirii",
            "streetNo": "3",
            "locality": "Cluj",
            "county": "Cluj",
        }
    )
    assert addr == "Bd Unirii 3, Cluj, Cluj"
    assert svc._format_fan_address({}) is None


# --------------------------------------------------------------------------- #
# _parse_overpass_json
# --------------------------------------------------------------------------- #
def test_parse_overpass_node_way_skip_and_sort() -> None:
    data = {
        "elements": [
            # skipped: bad type
            {"type": "badtype", "id": 1, "lat": 44.0, "lon": 26.0},
            # skipped: missing id
            {"type": "node", "id": None, "lat": 44.0, "lon": 26.0},
            # node with direct lat/lon (further away)
            {
                "type": "node",
                "id": 2,
                "lat": 45.0,
                "lon": 26.0,
                "tags": {"name": "Far"},
            },
            # way using center fallback (closer)
            {
                "type": "way",
                "id": 3,
                "center": {"lat": 44.01, "lon": 26.0},
                "tags": {"name": "Near"},
            },
            # skipped: no lat/lon and no center coords
            {"type": "relation", "id": 4, "center": {}},
        ]
    }
    out = svc._parse_overpass_json(
        data, provider=LockerProvider.sameday, lat=44.0, lng=26.0
    )
    assert [o.name for o in out] == ["Near", "Far"]
    assert out[0].id == "osm:way:3"


def test_parse_overpass_empty_elements() -> None:
    assert (
        svc._parse_overpass_json(
            {}, provider=LockerProvider.sameday, lat=44.0, lng=26.0
        )
        == []
    )


# --------------------------------------------------------------------------- #
# configured / base url helpers
# --------------------------------------------------------------------------- #
def test_sameday_configured(monkeypatch) -> None:
    monkeypatch.setattr(svc.settings, "sameday_api_base_url", "https://x", False)
    monkeypatch.setattr(svc.settings, "sameday_api_username", "u", False)
    monkeypatch.setattr(svc.settings, "sameday_api_password", "p", False)
    assert svc._sameday_configured() is True
    monkeypatch.setattr(svc.settings, "sameday_api_username", "", False)
    assert svc._sameday_configured() is False


def test_fan_configured(monkeypatch) -> None:
    monkeypatch.setattr(svc.settings, "fan_api_base_url", "https://x", False)
    monkeypatch.setattr(svc.settings, "fan_api_username", "u", False)
    monkeypatch.setattr(svc.settings, "fan_api_password", "p", False)
    assert svc._fan_configured() is True
    monkeypatch.setattr(svc.settings, "fan_api_password", "", False)
    assert svc._fan_configured() is False


def test_sameday_base_url_ok_and_error(monkeypatch) -> None:
    monkeypatch.setattr(svc.settings, "sameday_api_base_url", "https://x/", False)
    assert svc._sameday_base_url() == "https://x"
    monkeypatch.setattr(svc.settings, "sameday_api_base_url", "", False)
    with pytest.raises(svc.LockersNotConfiguredError):
        svc._sameday_base_url()


def test_fan_base_url_default_and_custom(monkeypatch) -> None:
    monkeypatch.setattr(svc.settings, "fan_api_base_url", "", False)
    assert svc._fan_base_url() == "https://api.fancourier.ro"
    monkeypatch.setattr(svc.settings, "fan_api_base_url", "https://fan/", False)
    assert svc._fan_base_url() == "https://fan"


# --------------------------------------------------------------------------- #
# expire/expires parsing
# --------------------------------------------------------------------------- #
def test_parse_sameday_expire_at_variants() -> None:
    empty = svc._parse_sameday_expire_at("")
    assert empty > datetime.now(timezone.utc) + timedelta(hours=11)
    parsed = svc._parse_sameday_expire_at("2030-01-02 03:04")
    assert parsed.year == 2030 and parsed.tzinfo is timezone.utc
    parsed2 = svc._parse_sameday_expire_at("2030-01-02 03:04:05")
    assert parsed2.minute == 4
    bad = svc._parse_sameday_expire_at("not-a-date")
    assert bad <= datetime.now(timezone.utc) + timedelta(minutes=11)


def test_parse_fan_expires_at_variants() -> None:
    now = datetime(2030, 1, 1, tzinfo=timezone.utc)
    assert svc._parse_fan_expires_at("", now=now) == now + timedelta(hours=23)
    assert svc._parse_fan_expires_at("2031-05-06 07:08", now=now).year == 2031
    assert svc._parse_fan_expires_at("2031-05-06 07:08:09", now=now).second == 9
    assert svc._parse_fan_expires_at("garbage", now=now) == now + timedelta(hours=1)


# --------------------------------------------------------------------------- #
# _sameday_get_token
# --------------------------------------------------------------------------- #
@pytest.mark.anyio("asyncio")
async def test_sameday_get_token_cached(monkeypatch) -> None:
    svc._sameday_auth = svc._AuthToken(
        token="cached", expires_at=datetime.now(timezone.utc) + timedelta(hours=1)
    )
    assert await svc._sameday_get_token() == "cached"


@pytest.mark.anyio("asyncio")
async def test_sameday_get_token_not_configured(monkeypatch) -> None:
    svc._sameday_auth = None
    monkeypatch.setattr(svc.settings, "sameday_api_username", "", False)
    with pytest.raises(svc.LockersNotConfiguredError):
        await svc._sameday_get_token()


@pytest.mark.anyio("asyncio")
@respx.mock
async def test_sameday_get_token_fetch_and_empty(monkeypatch) -> None:
    svc._sameday_auth = None
    monkeypatch.setattr(
        svc.settings, "sameday_api_base_url", "https://sd.example", False
    )
    monkeypatch.setattr(svc.settings, "sameday_api_username", "u", False)
    monkeypatch.setattr(svc.settings, "sameday_api_password", "p", False)

    route = respx.post("https://sd.example/api/authenticate").mock(
        return_value=httpx.Response(
            200, json={"token": "tok", "expire_at": "2030-01-01 00:00"}
        )
    )
    assert await svc._sameday_get_token() == "tok"
    assert route.called

    # Empty token -> RuntimeError (force re-fetch by clearing cache).
    svc._sameday_auth = None
    respx.post("https://sd.example/api/authenticate").mock(
        return_value=httpx.Response(200, json={"token": ""})
    )
    with pytest.raises(RuntimeError):
        await svc._sameday_get_token()


# --------------------------------------------------------------------------- #
# _load_sameday_lockers
# --------------------------------------------------------------------------- #
@pytest.mark.anyio("asyncio")
@respx.mock
async def test_load_sameday_lockers_pagination_and_skips(monkeypatch) -> None:
    monkeypatch.setattr(svc, "_sameday_get_token", _fake_async("tok"))
    monkeypatch.setattr(
        svc.settings, "sameday_api_base_url", "https://sd.example", False
    )

    page1 = {
        "data": [
            {
                "lockerId": "A1",
                "lat": 44.0,
                "lng": 26.0,
                "name": "Loc A",
                "address": "Street A",
            },
            # skipped: missing name
            {"lockerId": "A2", "lat": 44.1, "lng": 26.1, "name": ""},
            # skipped: bad float -> exception path
            {"lockerId": "A3", "lat": "x", "lng": 26.1, "name": "Bad"},
        ],
        "pages": 2,
        "currentPage": 1,
    }
    page2 = {
        "data": [
            {
                "lockerId": "B1",
                "lat": 45.0,
                "lng": 27.0,
                "name": "Loc B",
                "address": "",  # falsy -> address None
            }
        ],
        "pages": 2,
        "currentPage": 2,
    }
    respx.get("https://sd.example/api/client/lockers").mock(
        side_effect=[
            httpx.Response(200, json=page1),
            httpx.Response(200, json=page2),
        ]
    )

    items = await svc._load_sameday_lockers()
    ids = [i.id for i in items]
    assert ids == ["sameday:A1", "sameday:B1"]
    assert items[1].address is None


# --------------------------------------------------------------------------- #
# _fan_get_token
# --------------------------------------------------------------------------- #
@pytest.mark.anyio("asyncio")
async def test_fan_get_token_cached() -> None:
    svc._fan_auth = svc._AuthToken(
        token="fc", expires_at=datetime.now(timezone.utc) + timedelta(hours=1)
    )
    assert await svc._fan_get_token() == "fc"


@pytest.mark.anyio("asyncio")
async def test_fan_get_token_not_configured(monkeypatch) -> None:
    svc._fan_auth = None
    monkeypatch.setattr(svc.settings, "fan_api_username", "", False)
    with pytest.raises(svc.LockersNotConfiguredError):
        await svc._fan_get_token()


@pytest.mark.anyio("asyncio")
@respx.mock
async def test_fan_get_token_data_dict_and_empty(monkeypatch) -> None:
    svc._fan_auth = None
    monkeypatch.setattr(svc.settings, "fan_api_base_url", "https://fan.example", False)
    monkeypatch.setattr(svc.settings, "fan_api_username", "u", False)
    monkeypatch.setattr(svc.settings, "fan_api_password", "p", False)

    respx.post("https://fan.example/login").mock(
        return_value=httpx.Response(
            200,
            json={"data": {"token": "ftok", "expiresAt": "2030-01-01 00:00"}},
        )
    )
    assert await svc._fan_get_token() == "ftok"

    # Non-dict data -> falls back to payload dict; empty token raises.
    svc._fan_auth = None
    respx.post("https://fan.example/login").mock(
        return_value=httpx.Response(200, json={"data": None})
    )
    with pytest.raises(RuntimeError):
        await svc._fan_get_token()


@pytest.mark.anyio("asyncio")
@respx.mock
async def test_fan_get_token_payload_not_dict(monkeypatch) -> None:
    """Top-level payload is a list -> data_obj becomes {} -> empty token."""
    svc._fan_auth = None
    monkeypatch.setattr(svc.settings, "fan_api_base_url", "https://fan.example", False)
    monkeypatch.setattr(svc.settings, "fan_api_username", "u", False)
    monkeypatch.setattr(svc.settings, "fan_api_password", "p", False)
    respx.post("https://fan.example/login").mock(
        return_value=httpx.Response(200, json=[])
    )
    with pytest.raises(RuntimeError):
        await svc._fan_get_token()


# --------------------------------------------------------------------------- #
# _load_fan_lockers
# --------------------------------------------------------------------------- #
@pytest.mark.anyio("asyncio")
@respx.mock
async def test_load_fan_lockers_skips_and_maps(monkeypatch) -> None:
    monkeypatch.setattr(svc, "_fan_get_token", _fake_async("tok"))
    monkeypatch.setattr(svc.settings, "fan_api_base_url", "https://fan.example", False)
    payload = {
        "data": [
            {
                "id": "F1",
                "latitude": 44.0,
                "longitude": 26.0,
                "name": "Fan A",
                "address": {"street": "S", "locality": "L"},
            },
            # skip: empty name
            {"id": "F2", "latitude": 44.1, "longitude": 26.1, "name": ""},
            # skip: bad float
            {"id": "F3", "latitude": "x", "longitude": 26.1, "name": "Bad"},
        ]
    }
    respx.get("https://fan.example/reports/pickup-points").mock(
        return_value=httpx.Response(200, json=payload)
    )
    items = await svc._load_fan_lockers()
    assert [i.id for i in items] == ["fan:F1"]
    assert items[0].provider == LockerProvider.fan_courier


# --------------------------------------------------------------------------- #
# _get_all_lockers
# --------------------------------------------------------------------------- #
@pytest.mark.anyio("asyncio")
async def test_get_all_lockers_cache_hit() -> None:
    pts = [_point()]
    svc._all_lockers[LockerProvider.sameday] = svc._AllLockersEntry(
        expires_at=datetime.now(timezone.utc) + timedelta(hours=1), items=pts
    )
    assert await svc._get_all_lockers(LockerProvider.sameday) is pts


@pytest.mark.anyio("asyncio")
async def test_get_all_lockers_sameday_refresh(monkeypatch) -> None:
    monkeypatch.setattr(svc, "_sameday_configured", lambda: True)
    monkeypatch.setattr(svc, "_load_sameday_lockers", _fake_async([_point()]))
    out = await svc._get_all_lockers(LockerProvider.sameday)
    assert len(out) == 1


@pytest.mark.anyio("asyncio")
async def test_get_all_lockers_fan_refresh(monkeypatch) -> None:
    monkeypatch.setattr(svc, "_fan_configured", lambda: True)
    monkeypatch.setattr(
        svc,
        "_load_fan_lockers",
        _fake_async([_point(id="fan:1", provider=LockerProvider.fan_courier)]),
    )
    out = await svc._get_all_lockers(LockerProvider.fan_courier)
    assert out[0].provider == LockerProvider.fan_courier


@pytest.mark.anyio("asyncio")
async def test_get_all_lockers_sameday_not_configured(monkeypatch) -> None:
    monkeypatch.setattr(svc, "_sameday_configured", lambda: False)
    with pytest.raises(svc.LockersNotConfiguredError):
        await svc._get_all_lockers(LockerProvider.sameday)


@pytest.mark.anyio("asyncio")
async def test_get_all_lockers_fan_not_configured(monkeypatch) -> None:
    monkeypatch.setattr(svc, "_fan_configured", lambda: False)
    with pytest.raises(svc.LockersNotConfiguredError):
        await svc._get_all_lockers(LockerProvider.fan_courier)


@pytest.mark.anyio("asyncio")
async def test_get_all_lockers_stale_fallback_on_error(monkeypatch) -> None:
    stale = [_point(name="stale")]
    svc._all_lockers[LockerProvider.sameday] = svc._AllLockersEntry(
        expires_at=datetime.now(timezone.utc) - timedelta(hours=1), items=stale
    )
    monkeypatch.setattr(svc, "_sameday_configured", lambda: True)

    async def boom() -> list:
        raise RuntimeError("down")

    monkeypatch.setattr(svc, "_load_sameday_lockers", boom)
    out = await svc._get_all_lockers(LockerProvider.sameday)
    assert out is stale


@pytest.mark.anyio("asyncio")
async def test_get_all_lockers_error_no_cache_reraises(monkeypatch) -> None:
    monkeypatch.setattr(svc, "_sameday_configured", lambda: True)

    async def boom() -> list:
        raise RuntimeError("down")

    monkeypatch.setattr(svc, "_load_sameday_lockers", boom)
    with pytest.raises(RuntimeError):
        await svc._get_all_lockers(LockerProvider.sameday)


# --------------------------------------------------------------------------- #
# _select_nearby_lockers
# --------------------------------------------------------------------------- #
def test_select_nearby_filters_sorts_caps() -> None:
    pts = [
        _point(id="a", name="A", lat=44.0, lng=26.0),  # ~0 km
        _point(id="b", name="B", lat=44.02, lng=26.0),  # close
        _point(id="c", name="C", lat=46.0, lng=26.0),  # far -> filtered
    ]
    out = svc._select_nearby_lockers(
        pts,
        lat=44.0,
        lng=26.0,
        radius_km=10.0,
        limit=1,
        provider=LockerProvider.sameday,
    )
    assert len(out) == 1
    assert out[0].id == "a"


# --------------------------------------------------------------------------- #
# list_lockers
# --------------------------------------------------------------------------- #
def _fake_async(value):  # type: ignore[no-untyped-def]
    async def _inner(*a, **k):  # type: ignore[no-untyped-def]
        return value

    return _inner


@pytest.mark.anyio("asyncio")
async def test_list_lockers_cache_hit(monkeypatch) -> None:
    monkeypatch.setattr(svc.settings, "sameday_mirror_enabled", True, False)
    cached_items = [
        LockerRead(
            id="x",
            provider=LockerProvider.sameday,
            name="X",
            lat=44.0,
            lng=26.0,
            distance_km=0.0,
        )
    ]
    # Prime the cache so the early-return branch fires.
    key = f"{LockerProvider.sameday}:mirror:{svc._round_coord(44.0)}:{svc._round_coord(26.0)}:{int(10.0)}:{int(60)}"
    svc._cache[key] = svc._CacheEntry(
        expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
        items=cached_items,
    )
    out = await svc.list_lockers(provider=LockerProvider.sameday, lat=44.0, lng=26.0)
    assert out is cached_items


@pytest.mark.anyio("asyncio")
async def test_list_lockers_mirror_with_session(monkeypatch) -> None:
    monkeypatch.setattr(svc.settings, "sameday_mirror_enabled", True, False)
    items = [
        LockerRead(
            id="m",
            provider=LockerProvider.sameday,
            name="M",
            lat=44.0,
            lng=26.0,
        )
    ]
    monkeypatch.setattr(
        svc.sameday_easybox_mirror, "list_nearby_lockers", _fake_async(items)
    )
    out = await svc.list_lockers(
        provider=LockerProvider.sameday,
        lat=44.0,
        lng=26.0,
        session=object(),
    )
    assert out == items


@pytest.mark.anyio("asyncio")
async def test_list_lockers_mirror_runtimeerror_maps(monkeypatch) -> None:
    monkeypatch.setattr(svc.settings, "sameday_mirror_enabled", True, False)

    async def boom(*a, **k):  # type: ignore[no-untyped-def]
        raise RuntimeError("mirror down")

    monkeypatch.setattr(svc.sameday_easybox_mirror, "list_nearby_lockers", boom)
    # No cache -> the LockersNotConfiguredError propagates out of except.
    with pytest.raises(svc.LockersNotConfiguredError):
        await svc.list_lockers(
            provider=LockerProvider.sameday,
            lat=44.0,
            lng=26.0,
            session=object(),
        )


@pytest.mark.anyio("asyncio")
async def test_list_lockers_mirror_without_session(monkeypatch) -> None:
    monkeypatch.setattr(svc.settings, "sameday_mirror_enabled", True, False)
    items = [
        LockerRead(
            id="m2",
            provider=LockerProvider.sameday,
            name="M2",
            lat=44.0,
            lng=26.0,
        )
    ]
    monkeypatch.setattr(
        svc.sameday_easybox_mirror, "list_nearby_lockers", _fake_async(items)
    )

    class _Sess:
        async def __aenter__(self):  # type: ignore[no-untyped-def]
            return self

        async def __aexit__(self, *a):  # type: ignore[no-untyped-def]
            return False

    monkeypatch.setattr(svc, "SessionLocal", lambda: _Sess())
    out = await svc.list_lockers(provider=LockerProvider.sameday, lat=44.0, lng=26.0)
    assert out == items


@pytest.mark.anyio("asyncio")
async def test_list_lockers_official_source(monkeypatch) -> None:
    # mirror disabled + sameday configured -> "official"
    monkeypatch.setattr(svc.settings, "sameday_mirror_enabled", False, False)
    monkeypatch.setattr(svc, "_sameday_configured", lambda: True)
    pts = [_point(lat=44.0, lng=26.0)]
    monkeypatch.setattr(svc, "_get_all_lockers", _fake_async(pts))
    out = await svc.list_lockers(provider=LockerProvider.sameday, lat=44.0, lng=26.0)
    assert out and out[0].id == "sameday:1"


@pytest.mark.anyio("asyncio")
async def test_list_lockers_overpass_disabled(monkeypatch) -> None:
    # mirror disabled + not configured -> "overpass", but fallback disabled.
    monkeypatch.setattr(svc.settings, "sameday_mirror_enabled", False, False)
    monkeypatch.setattr(svc, "_sameday_configured", lambda: False)
    monkeypatch.setattr(svc, "_fan_configured", lambda: False)
    monkeypatch.setattr(svc.settings, "lockers_use_overpass_fallback", False, False)
    with pytest.raises(svc.LockersNotConfiguredError):
        await svc.list_lockers(provider=LockerProvider.fan_courier, lat=44.0, lng=26.0)


@pytest.mark.anyio("asyncio")
@respx.mock
async def test_list_lockers_overpass_fetch(monkeypatch) -> None:
    monkeypatch.setattr(svc.settings, "sameday_mirror_enabled", False, False)
    monkeypatch.setattr(svc, "_fan_configured", lambda: False)
    monkeypatch.setattr(svc.settings, "lockers_use_overpass_fallback", True, False)
    respx.post(svc._OVERPASS_URL).mock(
        return_value=httpx.Response(
            200,
            json={
                "elements": [
                    {
                        "type": "node",
                        "id": 9,
                        "lat": 44.0,
                        "lon": 26.0,
                        "tags": {"name": "OP"},
                    }
                ]
            },
        )
    )
    out = await svc.list_lockers(
        provider=LockerProvider.fan_courier,
        lat=44.0,
        lng=26.0,
        radius_km=5.0,
        limit=10,
    )
    assert out and out[0].name == "OP"


@pytest.mark.anyio("asyncio")
async def test_list_lockers_force_refresh_skips_cache(monkeypatch) -> None:
    monkeypatch.setattr(svc.settings, "sameday_mirror_enabled", False, False)
    monkeypatch.setattr(svc, "_sameday_configured", lambda: True)
    pts = [_point(lat=44.0, lng=26.0)]
    monkeypatch.setattr(svc, "_get_all_lockers", _fake_async(pts))

    key = f"{LockerProvider.sameday}:official:{svc._round_coord(44.0)}:{svc._round_coord(26.0)}:{int(10.0)}:{int(60)}"
    svc._cache[key] = svc._CacheEntry(
        expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
        items=[],
    )
    out = await svc.list_lockers(
        provider=LockerProvider.sameday,
        lat=44.0,
        lng=26.0,
        force_refresh=True,
    )
    # force_refresh ignored the empty cache and recomputed a non-empty list.
    assert len(out) == 1


@pytest.mark.anyio("asyncio")
async def test_list_lockers_error_returns_stale_cache(monkeypatch) -> None:
    monkeypatch.setattr(svc.settings, "sameday_mirror_enabled", False, False)
    monkeypatch.setattr(svc, "_sameday_configured", lambda: True)

    async def boom(*a, **k):  # type: ignore[no-untyped-def]
        raise RuntimeError("down")

    monkeypatch.setattr(svc, "_get_all_lockers", boom)

    stale = [
        LockerRead(
            id="stale",
            provider=LockerProvider.sameday,
            name="S",
            lat=44.0,
            lng=26.0,
        )
    ]
    key = f"{LockerProvider.sameday}:official:{svc._round_coord(44.0)}:{svc._round_coord(26.0)}:{int(10.0)}:{int(60)}"
    svc._cache[key] = svc._CacheEntry(
        expires_at=datetime.now(timezone.utc) - timedelta(hours=1),
        items=stale,
    )
    out = await svc.list_lockers(provider=LockerProvider.sameday, lat=44.0, lng=26.0)
    assert out is stale
