"""Lean-gate unit coverage for ``app.services.sameday_easybox_mirror`` helpers.

Disjoint from ``test_sameday_easybox_mirror`` (which covers sync/snapshot/list
flows). This targets the pure transform helpers (utc/text/float/lat-lng/row
normalization/dedupe/hash/schema-signature/classify/haversine) and the network
helpers (``_fetch_json_url`` / known-endpoint / playwright / raw payload) with a
stubbed ``httpx``/subprocess, plus ``should_run_scheduled_sync``,
``list_sync_runs`` and ``validate_fetch_hosts``.
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone

import pytest

from app.core.config import settings
from app.services import sameday_easybox_mirror as m


class _FakePath:
    """Minimal stand-in for the Playwright-script Path with a controllable exists()."""

    def __init__(self, exists: bool) -> None:
        self._exists = exists

    def exists(self) -> bool:
        return self._exists

    def __str__(self) -> str:
        return "fake-playwright-script.js"


# --------------------------------------------------------------------------- #
# tiny pure helpers                                                            #
# --------------------------------------------------------------------------- #
def test_as_utc_variants() -> None:
    assert m._as_utc(None) is None
    naive = datetime(2024, 1, 1)
    assert m._as_utc(naive).tzinfo is timezone.utc
    aware = datetime(2024, 1, 1, tzinfo=timezone(timedelta(hours=3)))
    assert m._as_utc(aware).utcoffset() == timedelta(0)


def test_clean_text() -> None:
    assert m._clean_text("  a   b  ") == "a b"
    assert m._clean_text("") is None
    assert m._clean_text("x" * 300, max_len=10) == "x" * 10


def test_to_float() -> None:
    assert m._to_float("1,5") == 1.5
    assert m._to_float("notnum") is None
    assert m._to_float(10) == 10.0
    assert m._to_float(10**9) is None  # out of allowed range


def test_to_lat_lng_variants() -> None:
    assert m._to_lat_lng({"lat": 44.4, "lng": 26.1}) == (44.4, 26.1)
    assert m._to_lat_lng({"latitude": 44.4, "longitude": 26.1}) == (44.4, 26.1)
    assert m._to_lat_lng({"latitude": 44.4, "lon": 26.1}) == (44.4, 26.1)
    assert m._to_lat_lng({"geometry": {"coordinates": [26.1, 44.4]}}) == (44.4, 26.1)
    assert m._to_lat_lng({"location": {"lat": 44.4, "lng": 26.1}}) == (44.4, 26.1)
    assert m._to_lat_lng({}) is None
    # Out-of-range coordinates rejected.
    assert m._to_lat_lng({"lat": 999, "lng": 999}) is None


def test_collect_candidate_rows_walks_containers() -> None:
    # 'result'->'items' list of dicts collected; nested list-of-list collected;
    # a top-level 'data' key recurses into its list.
    payload = {
        "result": {"items": [{"id": 1}, {"id": 2}]},
        "nested": [[{"id": 3}]],
        "data": [{"id": 4}],
    }
    rows = m._collect_candidate_rows(payload)
    ids = sorted(r["id"] for r in rows if "id" in r)
    assert ids == [1, 2, 3, 4]

    # A dict whose non-special-key values are plain scalars (no recursion).
    assert m._collect_candidate_rows({"name": "x", "count": 3}) == []


def test_normalize_row_full_and_fallbacks() -> None:
    row = {
        "properties": {
            "lockerId": "L1",
            "name": "Easybox Center",
            "address": "Main St 1",
            "city": "Bucuresti",
            "county": "Ilfov",
            "postalCode": "012345",
            "lat": 44.4,
            "lng": 26.1,
        }
    }
    item = m._normalize_row(row)
    assert item and item.external_id == "L1"
    assert item.name == "Easybox Center"

    # No id / no name -> derived id + default name.
    row2 = {"lat": 45.0, "lng": 25.0}
    item2 = m._normalize_row(row2)
    assert item2 and item2.external_id and item2.name.startswith("Easybox ")

    # No coordinates -> None.
    assert m._normalize_row({"name": "x"}) is None


def test_normalize_row_payload_json_truncation() -> None:
    big = {"lat": 44.0, "lng": 26.0, "blob": "x" * 20000}
    item = m._normalize_row(big)
    assert item and item.source_payload_json is not None
    assert len(item.source_payload_json) <= 12000


def test_dedupe_lockers() -> None:
    a = m._NormalizedLocker(
        external_id="dup",
        name="A",
        address=None,
        city=None,
        county=None,
        postal_code=None,
        lat=1.0,
        lng=2.0,
        source_payload_json=None,
    )
    b = m._NormalizedLocker(
        external_id="dup",
        name="B",
        address=None,
        city=None,
        county=None,
        postal_code=None,
        lat=3.0,
        lng=4.0,
        source_payload_json=None,
    )
    out = m._dedupe_lockers([a, b])
    assert len(out) == 1 and out[0].name == "B"


def test_payload_hash_handles_unserializable() -> None:
    assert isinstance(m._payload_hash({"a": 1}), str)

    class _NoJson:
        pass

    # Non-serializable object falls back to str() without raising.
    assert isinstance(m._payload_hash(_NoJson()), str)


def test_schema_signature_from_rows() -> None:
    assert m._schema_signature_from_rows([]) is None
    rows = [
        {"a": 1, "properties": {"x": 1}},
        {"a": 2},
    ]
    sig = m._schema_signature_from_rows(rows)
    assert isinstance(sig, str) and len(sig) == 40


def test_classify_failure() -> None:
    assert m._classify_failure(RuntimeError("Cloudflare challenge")) == (
        "cloudflare_challenge",
        True,
    )
    assert m._classify_failure(RuntimeError("captcha needed"))[0] == "captcha_challenge"
    assert m._classify_failure(RuntimeError("Non-JSON response"))[0] == "non_json"
    assert m._classify_failure(RuntimeError("No locker rows found"))[0] == (
        "empty_payload"
    )
    assert m._classify_failure(RuntimeError("404 from https://x"))[0] == "upstream_http"
    assert m._classify_failure(RuntimeError("weird"))[0] == "unknown"


def test_haversine_km() -> None:
    assert m._haversine_km(44.4, 26.1, 44.4, 26.1) == pytest.approx(0.0)
    assert m._haversine_km(44.4, 26.1, 45.4, 26.1) > 100


def test_validate_fetch_hosts_ok() -> None:
    # The configured allow-list is valid -> no error.
    m.validate_fetch_hosts()


def test_validate_fetch_hosts_invalid(monkeypatch) -> None:
    monkeypatch.setattr(m, "_ALLOWED_HOSTS", ("badhost",), raising=False)
    with pytest.raises(RuntimeError):
        m.validate_fetch_hosts()


# --------------------------------------------------------------------------- #
# network helpers (stubbed httpx / subprocess)                                 #
# --------------------------------------------------------------------------- #
class _Resp:
    def __init__(self, *, status=200, headers=None, text="[]", json_data=None) -> None:
        self.status_code = status
        self.headers = headers or {"content-type": "application/json"}
        self.text = text
        self._json = json_data if json_data is not None else []

    def json(self):
        return self._json


class _Client:
    def __init__(self, resp) -> None:
        self._resp = resp

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url):
        if callable(self._resp):
            return self._resp(url)
        return self._resp


def test_fetch_json_url_paths(monkeypatch) -> None:
    client = _Client(None)

    # JSON content-type -> resp.json().
    monkeypatch.setattr(client, "_resp", _Resp(json_data=[{"a": 1}]))
    out = asyncio.run(m._fetch_json_url(client, "https://x"))
    assert out == [{"a": 1}]

    # Cloudflare challenge header -> raises.
    client._resp = _Resp(headers={"cf-mitigated": "challenge"})
    with pytest.raises(RuntimeError):
        asyncio.run(m._fetch_json_url(client, "https://x"))

    # HTTP error status -> raises.
    client._resp = _Resp(status=500, headers={"content-type": "text/plain"})
    with pytest.raises(RuntimeError):
        asyncio.run(m._fetch_json_url(client, "https://x"))

    # Non-JSON content-type but valid JSON body -> parsed.
    client._resp = _Resp(headers={"content-type": "text/plain"}, text='[{"b":2}]')
    out = asyncio.run(m._fetch_json_url(client, "https://x"))
    assert out == [{"b": 2}]

    # Non-JSON body -> raises.
    client._resp = _Resp(headers={"content-type": "text/plain"}, text="not json")
    with pytest.raises(RuntimeError):
        asyncio.run(m._fetch_json_url(client, "https://x"))


def test_fetch_via_known_endpoints_success(monkeypatch) -> None:
    resp = _Resp(json_data=[{"lockerId": "L", "lat": 44.4, "lng": 26.1}])
    monkeypatch.setattr(m.httpx, "AsyncClient", lambda **kw: _Client(resp))
    payload, source = asyncio.run(m._fetch_via_known_endpoints(10))
    assert isinstance(payload, list) and payload
    assert "{city}" in source


def test_fetch_via_known_endpoints_all_fail(monkeypatch) -> None:
    def _boom(url):
        raise RuntimeError("nope")

    monkeypatch.setattr(m.httpx, "AsyncClient", lambda **kw: _Client(_boom))
    with pytest.raises(RuntimeError):
        asyncio.run(m._fetch_via_known_endpoints(10))


def test_fetch_via_known_endpoints_list_of_non_dicts(monkeypatch) -> None:
    # A list payload of non-dict items yields no candidates from collect AND no
    # candidates from the list fallback -> the endpoint loop continues and the
    # function ultimately raises (352 / 353->344 arcs).
    resp = _Resp(json_data=[1, 2, 3])
    monkeypatch.setattr(m.httpx, "AsyncClient", lambda **kw: _Client(resp))
    with pytest.raises(RuntimeError):
        asyncio.run(m._fetch_via_known_endpoints(10))


def test_fetch_via_playwright_disabled(monkeypatch) -> None:
    monkeypatch.setattr(m, "_PLAYWRIGHT_SCRIPT", _FakePath(True))
    monkeypatch.setattr(
        settings, "sameday_mirror_playwright_enabled", False, raising=False
    )
    with pytest.raises(RuntimeError):
        asyncio.run(m._fetch_via_playwright(10))


def test_fetch_via_playwright_missing_script(monkeypatch) -> None:
    monkeypatch.setattr(m, "_PLAYWRIGHT_SCRIPT", _FakePath(False))
    with pytest.raises(RuntimeError):
        asyncio.run(m._fetch_via_playwright(10))


def test_fetch_via_playwright_success(monkeypatch) -> None:
    monkeypatch.setattr(m, "_PLAYWRIGHT_SCRIPT", _FakePath(True))
    monkeypatch.setattr(
        settings, "sameday_mirror_playwright_enabled", True, raising=False
    )

    payload_out = json.dumps(
        {"source_url": "https://sameday/x", "payload": [{"id": 1}]}
    ).encode()

    class _Proc:
        returncode = 0

        async def communicate(self):
            return payload_out, b""

        def kill(self):
            pass

    async def _fake_exec(*a, **k):
        return _Proc()

    monkeypatch.setattr(m.asyncio, "create_subprocess_exec", _fake_exec)
    data, src = asyncio.run(m._fetch_via_playwright(10))
    assert data == [{"id": 1}]
    assert src == "https://sameday/x"


def test_fetch_via_playwright_nonzero_exit(monkeypatch) -> None:
    monkeypatch.setattr(m, "_PLAYWRIGHT_SCRIPT", _FakePath(True))
    monkeypatch.setattr(
        settings, "sameday_mirror_playwright_enabled", True, raising=False
    )

    class _Proc:
        returncode = 1

        async def communicate(self):
            return b"", b"crashed"

        def kill(self):
            pass

    async def _fake_exec(*a, **k):
        return _Proc()

    monkeypatch.setattr(m.asyncio, "create_subprocess_exec", _fake_exec)
    with pytest.raises(RuntimeError):
        asyncio.run(m._fetch_via_playwright(10))


def test_fetch_via_playwright_empty_payload(monkeypatch) -> None:
    monkeypatch.setattr(m, "_PLAYWRIGHT_SCRIPT", _FakePath(True))
    monkeypatch.setattr(
        settings, "sameday_mirror_playwright_enabled", True, raising=False
    )

    class _Proc:
        returncode = 0

        async def communicate(self):
            return json.dumps({"source_url": "x", "payload": None}).encode(), b""

        def kill(self):
            pass

    async def _fake_exec(*a, **k):
        return _Proc()

    monkeypatch.setattr(m.asyncio, "create_subprocess_exec", _fake_exec)
    with pytest.raises(RuntimeError):
        asyncio.run(m._fetch_via_playwright(10))


def test_fetch_raw_payload_falls_back_to_playwright(monkeypatch) -> None:
    async def _direct_fail(timeout):
        raise RuntimeError("direct failed")

    async def _playwright(timeout):
        return [{"id": 1}], "playwright"

    monkeypatch.setattr(m, "_fetch_via_known_endpoints", _direct_fail)
    monkeypatch.setattr(m, "_fetch_via_playwright", _playwright)
    data, src = asyncio.run(m._fetch_raw_payload())
    assert data == [{"id": 1}] and src == "playwright"


def test_fetch_via_playwright_timeout(monkeypatch) -> None:
    monkeypatch.setattr(m, "_PLAYWRIGHT_SCRIPT", _FakePath(True))
    monkeypatch.setattr(
        settings, "sameday_mirror_playwright_enabled", True, raising=False
    )

    class _Proc:
        returncode = 0

        async def communicate(self):
            raise asyncio.TimeoutError()

        def kill(self):
            pass

    async def _fake_exec(*a, **k):
        return _Proc()

    monkeypatch.setattr(m.asyncio, "create_subprocess_exec", _fake_exec)

    async def _instant_wait_for(coro, timeout):
        return await coro

    monkeypatch.setattr(m.asyncio, "wait_for", _instant_wait_for)
    with pytest.raises(RuntimeError):
        asyncio.run(m._fetch_via_playwright(10))


def test_fetch_via_playwright_invalid_json(monkeypatch) -> None:
    monkeypatch.setattr(m, "_PLAYWRIGHT_SCRIPT", _FakePath(True))
    monkeypatch.setattr(
        settings, "sameday_mirror_playwright_enabled", True, raising=False
    )

    class _Proc:
        returncode = 0

        async def communicate(self):
            return b"not-json", b""

        def kill(self):
            pass

    async def _fake_exec(*a, **k):
        return _Proc()

    monkeypatch.setattr(m.asyncio, "create_subprocess_exec", _fake_exec)
    with pytest.raises(RuntimeError):
        asyncio.run(m._fetch_via_playwright(10))


def test_normalize_payload_list_and_cap(monkeypatch) -> None:
    # A bare list payload (no container keys) uses the list fallback path.
    payload = [
        {"lat": 44.4, "lng": 26.1, "id": "a"},
        {"lat": 45.0, "lng": 25.0, "id": "b"},
        {"no": "coords"},
    ]
    out = asyncio.run(m._normalize_payload(payload))
    assert len(out) == 2

    # The cap is applied.
    monkeypatch.setattr(settings, "sameday_mirror_max_lockers", 1, raising=False)
    capped = asyncio.run(m._normalize_payload(payload))
    assert len(capped) == 1


def test_candidate_rows_list_fallback() -> None:
    rows = m._candidate_rows([{"x": 1}, "skip", {"y": 2}])
    assert rows == [{"x": 1}, {"y": 2}]


def test_fetch_raw_payload_direct_success(monkeypatch) -> None:
    async def _direct(timeout):
        return [{"id": 9}], "direct"

    monkeypatch.setattr(m, "_fetch_via_known_endpoints", _direct)
    data, src = asyncio.run(m._fetch_raw_payload())
    assert data == [{"id": 9}] and src == "direct"


# --------------------------------------------------------------------------- #
# additional lat/lng + normalize edge cases                                    #
# --------------------------------------------------------------------------- #
def test_to_lat_lng_geometry_and_location_fallbacks() -> None:
    # lat/lng absent, latitude/longitude absent, latitude/lon absent ->
    # geometry coordinates used (exercises the chained fallbacks).
    assert m._to_lat_lng({"lat": None, "geometry": {"coordinates": [26.1, 44.4]}}) == (
        44.4,
        26.1,
    )
    # Out-of-range geometry -> falls through to location.
    assert m._to_lat_lng(
        {
            "geometry": {"coordinates": [999, 999]},
            "location": {"latitude": 44.4, "longitude": 26.1},
        }
    ) == (44.4, 26.1)
    # Geometry with too-few coordinates is ignored.
    assert m._to_lat_lng({"geometry": {"coordinates": [1]}}) is None
    # A location dict with no usable coordinates -> falls through to None.
    assert m._to_lat_lng({"location": {"foo": "bar"}}) is None


def test_normalize_row_payload_json_unserializable() -> None:
    class _Bad:
        pass

    # A non-JSON-serializable nested value forces json.dumps to fail -> None json.
    row = {"lat": 44.0, "lng": 26.0, "obj": _Bad()}
    item = m._normalize_row(row)
    assert item is not None and item.source_payload_json is None


# --------------------------------------------------------------------------- #
# DB-backed list / should-run / nearby                                         #
# --------------------------------------------------------------------------- #
def _mirror(**kw):
    from app.models.shipping_locker import (
        ShippingLockerMirror,
        ShippingLockerProvider,
    )

    defaults = dict(
        provider=ShippingLockerProvider.sameday,
        external_id=f"ext-{kw.get('external_id', id(kw))}",
        name="Locker",
        city="Bucuresti",
        county="Ilfov",
        lat=44.4,
        lng=26.1,
        is_active=True,
    )
    defaults.update(kw)
    return ShippingLockerMirror(**defaults)


def test_list_sync_runs_and_latest(monkeypatch):
    from tests.conftest import make_memory_session_factory
    from app.models.shipping_locker import (
        ShippingLockerProvider,
        ShippingLockerSyncRun,
        ShippingLockerSyncStatus,
    )

    factory = make_memory_session_factory()

    async def run():
        async with factory() as session:
            for i in range(3):
                session.add(
                    ShippingLockerSyncRun(
                        provider=ShippingLockerProvider.sameday,
                        status=ShippingLockerSyncStatus.success,
                        started_at=m._now() - timedelta(minutes=i),
                        finished_at=m._now() - timedelta(minutes=i),
                    )
                )
            await session.commit()

            rows, total = await m.list_sync_runs(session, page=1, limit=2)
            assert total == 3 and len(rows) == 2

            latest = await m.get_latest_run(session)
            assert latest is not None

    asyncio.run(run())


def test_should_run_scheduled_sync(monkeypatch):
    from tests.conftest import make_memory_session_factory
    from app.models.shipping_locker import (
        ShippingLockerProvider,
        ShippingLockerSyncRun,
        ShippingLockerSyncStatus,
    )

    factory = make_memory_session_factory()

    async def run():
        async with factory() as session:
            # Disabled -> False.
            monkeypatch.setattr(
                settings, "sameday_mirror_enabled", False, raising=False
            )
            assert await m.should_run_scheduled_sync(session) is False

            monkeypatch.setattr(settings, "sameday_mirror_enabled", True, raising=False)
            monkeypatch.setattr(
                settings, "sameday_mirror_sync_interval_seconds", 300, raising=False
            )
            # No prior success -> True.
            assert await m.should_run_scheduled_sync(session) is True

            # A very recent success -> False (interval not elapsed).
            session.add(
                ShippingLockerSyncRun(
                    provider=ShippingLockerProvider.sameday,
                    status=ShippingLockerSyncStatus.success,
                    started_at=m._now(),
                    finished_at=m._now(),
                )
            )
            await session.commit()
            assert await m.should_run_scheduled_sync(session) is False

    asyncio.run(run())


def test_list_nearby_lockers(monkeypatch):
    from tests.conftest import make_memory_session_factory

    factory = make_memory_session_factory()

    async def run():
        async with factory() as session:
            # No data at all -> raises (mirror not initialized).
            with pytest.raises(RuntimeError):
                await m.list_nearby_lockers(
                    session, lat=44.4, lng=26.1, radius_km=10, limit=5
                )

            session.add(_mirror(external_id="near", lat=44.41, lng=26.11))
            session.add(_mirror(external_id="far", lat=10.0, lng=10.0))
            await session.commit()

            near = await m.list_nearby_lockers(
                session, lat=44.4, lng=26.1, radius_km=10, limit=5
            )
            assert near and near[0].id == "sameday:near"

            # A point with data present but nothing inside the bounding box -> [].
            empty = await m.list_nearby_lockers(
                session, lat=0.0, lng=0.0, radius_km=1, limit=5
            )
            assert empty == []

    asyncio.run(run())


def test_sync_now_no_rows_marks_failed(monkeypatch):
    from tests.conftest import make_memory_session_factory
    from app.models.shipping_locker import ShippingLockerSyncStatus

    factory = make_memory_session_factory()

    async def _empty_fetch():
        return [], "test-source"  # no candidate rows -> "No locker rows found"

    monkeypatch.setattr(m, "_fetch_raw_payload", _empty_fetch)

    async def run():
        async with factory() as session:
            run_row = await m.sync_now(session, trigger="manual")
            assert run_row.status == ShippingLockerSyncStatus.failed
            assert "No locker rows" in (run_row.error_message or "")

    asyncio.run(run())


def test_fetch_via_known_endpoints_list_payload(monkeypatch) -> None:
    # A bare list payload with no container keys uses the list-fallback at the
    # endpoint level (candidates derived from list items).
    resp = _Resp(json_data=[{"lat": 44.4, "lng": 26.1}])
    monkeypatch.setattr(m.httpx, "AsyncClient", lambda **kw: _Client(resp))
    payload, source = asyncio.run(m._fetch_via_known_endpoints(10))
    assert payload and isinstance(payload, list)


def test_detect_schema_drift_paths():
    from app.models.shipping_locker import (
        ShippingLockerProvider,
        ShippingLockerSyncRun,
        ShippingLockerSyncStatus,
    )

    # No previous success -> no drift.
    assert (
        m._detect_schema_drift(
            previous_success=None, schema_signature="x", normalization_ratio=1.0
        )
        is False
    )

    prev = ShippingLockerSyncRun(
        provider=ShippingLockerProvider.sameday,
        status=ShippingLockerSyncStatus.success,
        schema_signature="old-sig",
        normalization_ratio=0.95,
    )
    # Signature change -> drift.
    assert (
        m._detect_schema_drift(
            previous_success=prev, schema_signature="new-sig", normalization_ratio=0.95
        )
        is True
    )
    # Large ratio drop below the min threshold -> drift.
    assert (
        m._detect_schema_drift(
            previous_success=prev, schema_signature="old-sig", normalization_ratio=0.10
        )
        is True
    )
    # Stable signature + ratio -> no drift.
    assert (
        m._detect_schema_drift(
            previous_success=prev, schema_signature="old-sig", normalization_ratio=0.95
        )
        is False
    )


def test_challenge_failure_streak_breaks_on_non_challenge(monkeypatch):
    from tests.conftest import make_memory_session_factory
    from app.models.shipping_locker import (
        ShippingLockerProvider,
        ShippingLockerSyncRun,
        ShippingLockerSyncStatus,
    )

    factory = make_memory_session_factory()

    async def run():
        async with factory() as session:
            # Newest first: a challenge failure, then a non-challenge failure
            # (breaks the streak at line 532).
            session.add(
                ShippingLockerSyncRun(
                    provider=ShippingLockerProvider.sameday,
                    status=ShippingLockerSyncStatus.failed,
                    challenge_failure=False,
                    started_at=m._now() - timedelta(minutes=2),
                )
            )
            session.add(
                ShippingLockerSyncRun(
                    provider=ShippingLockerProvider.sameday,
                    status=ShippingLockerSyncStatus.failed,
                    challenge_failure=True,
                    started_at=m._now(),
                )
            )
            await session.commit()
            streak = await m._get_challenge_failure_streak(session)
            assert streak == 1

    asyncio.run(run())


def test_list_city_suggestions_filters(monkeypatch):
    from tests.conftest import make_memory_session_factory

    factory = make_memory_session_factory()

    async def run():
        async with factory() as session:
            session.add(_mirror(external_id="c1", city="Bucuresti", county="Ilfov"))
            session.add(_mirror(external_id="c2", city="Bucuresti", county="Ilfov"))
            session.add(_mirror(external_id="c3", city="Cluj", county="Cluj"))
            session.add(_mirror(external_id="c4", city="   ", county=None))
            # A locker with a valid city but NO county (940->942 false arc).
            session.add(_mirror(external_id="c5", city="Iasi", county=None))
            await session.commit()

            # No query -> grouped cities, ordered by count desc.
            all_cities = await m.list_city_suggestions(session, q="", limit=10)
            names = [c.city for c in all_cities]
            assert "Bucuresti" in names and "Cluj" in names

            # Query filters out non-matching cities.
            filtered = await m.list_city_suggestions(session, q="cluj", limit=10)
            assert [c.city for c in filtered] == ["Cluj"]

    asyncio.run(run())


def test_upsert_snapshot_unchanged_and_inactive(monkeypatch):
    from tests.conftest import make_memory_session_factory

    factory = make_memory_session_factory()

    def _item(ext, **kw):
        defaults = dict(
            external_id=ext,
            name="L",
            address=None,
            city=None,
            county=None,
            postal_code=None,
            lat=44.4,
            lng=26.1,
            source_payload_json=None,
        )
        defaults.update(kw)
        return m._NormalizedLocker(**defaults)

    async def run():
        async with factory() as session:
            now = m._now()
            # Seed an already-inactive row that will NOT be in the next sync
            # (so it stays inactive -> 633->630 false arc) plus an active row.
            session.add(_mirror(external_id="stale", is_active=False))
            await session.commit()

            # First upsert inserts a fresh row.
            up1, deact1 = await m._upsert_snapshot(session, [_item("keep")], now=now)
            assert up1 == 1

            # Second upsert with the SAME unchanged item -> no change counted
            # (626->579 false arc); 'stale' remains inactive (not re-counted).
            up2, deact2 = await m._upsert_snapshot(session, [_item("keep")], now=now)
            assert up2 == 0

    asyncio.run(run())


def test_row_to_locker_read():
    from app.models.shipping_locker import ShippingLockerMirror, ShippingLockerProvider

    row = ShippingLockerMirror(
        provider=ShippingLockerProvider.sameday,
        external_id="r1",
        name="Locker R1",
        address="Str 1",
        city="Buc",
        county="If",
        lat=44.4,
        lng=26.1,
        is_active=True,
    )
    read = m._row_to_locker_read(row, lat=44.5, lng=26.2)
    assert read.id == "sameday:r1"
    assert read.distance_km is not None
