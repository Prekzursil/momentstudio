"""Unit tests for the BNR FX-rate parser, fetcher and in-process cache.

These exercise the real ``app.services.fx_rates`` logic (parser branches,
HTTP fetch, double-checked cache, force-refresh and the test-reset helper).
The existing ``test_fx_api.py`` stubs ``get_fx_rates`` wholesale, so none of
this module's own code was previously executed.
"""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone

import httpx
import pytest

from app.services import fx_rates


def _xml(rates: str, *, cube_date: str | None = "2024-01-15") -> str:
    date_attr = f' date="{cube_date}"' if cube_date is not None else ""
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<DataSet xmlns="http://www.bnr.ro/xsd">'
        f"<Body><Cube{date_attr}>{rates}</Cube></Body>"
        "</DataSet>"
    )


_VALID = _xml(
    '<Rate currency="EUR">4.9700</Rate>'
    '<Rate currency="USD" multiplier="1">4.5500</Rate>'
)


@pytest.fixture(autouse=True)
def _clean_cache():
    fx_rates._reset_cache_for_tests()
    yield
    fx_rates._reset_cache_for_tests()


def test_parse_valid_rates_inverts_and_keeps_cube_date() -> None:
    parsed = fx_rates._parse_bnr_rates(_VALID)

    assert parsed.base == "RON"
    assert parsed.source == fx_rates.BNR_SOURCE
    assert parsed.as_of == date(2024, 1, 15)
    assert parsed.eur_per_ron == pytest.approx(1.0 / 4.97)
    assert parsed.usd_per_ron == pytest.approx(1.0 / 4.55)
    assert parsed.fetched_at.tzinfo is timezone.utc


def test_parse_applies_multiplier() -> None:
    xml = _xml(
        '<Rate currency="EUR">4.9700</Rate>'
        '<Rate currency="USD" multiplier="100">455.0000</Rate>'
    )
    parsed = fx_rates._parse_bnr_rates(xml)
    # 455.0 / 100 = 4.55 RON per USD -> inverted.
    assert parsed.usd_per_ron == pytest.approx(1.0 / 4.55)


def test_parse_skips_blank_currency_blank_value_and_nonpositive_multiplier() -> None:
    xml = _xml(
        '<Rate currency="">9.9</Rate>'  # blank currency -> skipped
        '<Rate currency="GBP"></Rate>'  # blank value -> skipped
        '<Rate currency="JPY" multiplier="0">3.0</Rate>'  # multiplier<=0 -> skipped
        '<Rate currency="EUR">4.9700</Rate>'
        '<Rate currency="USD">4.5500</Rate>'
    )
    parsed = fx_rates._parse_bnr_rates(xml)
    assert parsed.eur_per_ron == pytest.approx(1.0 / 4.97)
    assert parsed.usd_per_ron == pytest.approx(1.0 / 4.55)


def test_parse_missing_cube_raises() -> None:
    xml = '<DataSet xmlns="http://www.bnr.ro/xsd"><Body/></DataSet>'
    with pytest.raises(ValueError, match="Missing Cube element"):
        fx_rates._parse_bnr_rates(xml)


def test_parse_missing_cube_date_raises() -> None:
    xml = _xml(
        '<Rate currency="EUR">4.9700</Rate>'
        '<Rate currency="USD">4.5500</Rate>',
        cube_date=None,
    )
    with pytest.raises(ValueError, match="Missing Cube date"):
        fx_rates._parse_bnr_rates(xml)


def test_parse_missing_eur_or_usd_raises() -> None:
    xml = _xml('<Rate currency="EUR">4.9700</Rate>')
    with pytest.raises(ValueError, match="Missing EUR/USD rates"):
        fx_rates._parse_bnr_rates(xml)


def test_parse_nonpositive_rate_raises() -> None:
    xml = _xml(
        '<Rate currency="EUR">0.0000</Rate>'
        '<Rate currency="USD">4.5500</Rate>'
    )
    with pytest.raises(ValueError, match="Non-positive EUR/USD rates"):
        fx_rates._parse_bnr_rates(xml)


def test_fetch_bnr_xml_uses_settings_url(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, str] = {}

    class _Resp:
        text = _VALID

        def raise_for_status(self) -> None:
            return None

    class _Client:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self) -> "_Client":
            return self

        async def __aexit__(self, *exc) -> None:
            return None

        async def get(self, url: str) -> _Resp:
            captured["url"] = url
            return _Resp()

    monkeypatch.setattr(httpx, "AsyncClient", _Client)
    monkeypatch.setattr(fx_rates.settings, "fx_rates_url", "https://example.test/fx.xml")

    text = asyncio.run(fx_rates._fetch_bnr_xml())
    assert text == _VALID
    assert captured["url"] == "https://example.test/fx.xml"


def test_get_fx_rates_fetches_then_serves_from_cache(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = {"n": 0}

    async def _fake_fetch() -> str:
        calls["n"] += 1
        return _VALID

    monkeypatch.setattr(fx_rates, "_fetch_bnr_xml", _fake_fetch)
    monkeypatch.setattr(fx_rates.settings, "fx_rates_cache_ttl_seconds", 3600)

    first = asyncio.run(fx_rates.get_fx_rates())
    second = asyncio.run(fx_rates.get_fx_rates())

    assert calls["n"] == 1  # second call served from cache
    assert first is second


def test_get_fx_rates_force_refresh_refetches(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = {"n": 0}

    async def _fake_fetch() -> str:
        calls["n"] += 1
        return _VALID

    monkeypatch.setattr(fx_rates, "_fetch_bnr_xml", _fake_fetch)
    monkeypatch.setattr(fx_rates.settings, "fx_rates_cache_ttl_seconds", 3600)

    asyncio.run(fx_rates.get_fx_rates())
    asyncio.run(fx_rates.get_fx_rates(force_refresh=True))

    assert calls["n"] == 2


def test_get_fx_rates_clamps_ttl_minimum(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _fake_fetch() -> str:
        return _VALID

    monkeypatch.setattr(fx_rates, "_fetch_bnr_xml", _fake_fetch)
    # TTL below the 30s floor must be clamped up to 30s.
    monkeypatch.setattr(fx_rates.settings, "fx_rates_cache_ttl_seconds", 1)

    before = datetime.now(timezone.utc)
    asyncio.run(fx_rates.get_fx_rates())
    assert fx_rates._CACHE_EXPIRES_AT is not None
    assert fx_rates._CACHE_EXPIRES_AT >= before + timedelta(seconds=30)


def test_get_fx_rates_expired_cache_refetches(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = {"n": 0}

    async def _fake_fetch() -> str:
        calls["n"] += 1
        return _VALID

    monkeypatch.setattr(fx_rates, "_fetch_bnr_xml", _fake_fetch)
    monkeypatch.setattr(fx_rates.settings, "fx_rates_cache_ttl_seconds", 3600)

    asyncio.run(fx_rates.get_fx_rates())
    # Force the cache to look expired so the next call must re-fetch.
    fx_rates._CACHE_EXPIRES_AT = datetime.now(timezone.utc) - timedelta(seconds=1)
    asyncio.run(fx_rates.get_fx_rates())

    assert calls["n"] == 2


def test_get_fx_rates_concurrent_waiter_hits_inner_cache(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Two coroutines race past the lock-free check; the second must serve the
    cache populated by the first via the double-checked lock (inner return)."""

    started = asyncio.Event()
    release = asyncio.Event()
    calls = {"n": 0}

    async def _slow_fetch() -> str:
        calls["n"] += 1
        started.set()
        await release.wait()  # hold the lock until the waiter is queued
        return _VALID

    monkeypatch.setattr(fx_rates, "_fetch_bnr_xml", _slow_fetch)
    monkeypatch.setattr(fx_rates.settings, "fx_rates_cache_ttl_seconds", 3600)

    async def _scenario() -> tuple[fx_rates.FxRates, fx_rates.FxRates]:
        first = asyncio.create_task(fx_rates.get_fx_rates())
        await started.wait()  # first now holds the lock inside the fetch
        second = asyncio.create_task(fx_rates.get_fx_rates())
        await asyncio.sleep(0)  # let second pass the outer check and block on lock
        release.set()
        return await first, await second

    a, b = asyncio.run(_scenario())
    assert calls["n"] == 1  # the waiter never re-fetched
    assert a is b


def test_reset_cache_clears_state(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _fake_fetch() -> str:
        return _VALID

    monkeypatch.setattr(fx_rates, "_fetch_bnr_xml", _fake_fetch)
    asyncio.run(fx_rates.get_fx_rates())
    assert fx_rates._CACHE is not None

    fx_rates._reset_cache_for_tests()
    assert fx_rates._CACHE is None
    assert fx_rates._CACHE_EXPIRES_AT is None
