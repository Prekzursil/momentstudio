from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.services import fx_rates


def test_bnr_cube_and_date_validation_errors() -> None:
    with pytest.raises(ValueError, match='Missing Cube element'):
        fx_rates._get_bnr_cube('<DataSet></DataSet>')

    with pytest.raises(ValueError, match='Missing Cube date'):
        fx_rates._get_cube_date(SimpleNamespace(attrib={}))


def test_rate_element_and_required_rates_validation() -> None:
    assert fx_rates._parse_rate_element(SimpleNamespace(attrib={}, text='4.9')) is None
    assert fx_rates._parse_rate_element(SimpleNamespace(attrib={'currency': 'EUR'}, text='   ')) is None
    assert fx_rates._parse_rate_element(SimpleNamespace(attrib={'currency': 'EUR', 'multiplier': '0'}, text='4.9')) is None

    with pytest.raises(ValueError, match='Missing EUR/USD rates'):
        fx_rates._extract_required_rates({'EUR': 4.9})

    with pytest.raises(ValueError, match='Non-positive EUR/USD rates'):
        fx_rates._extract_required_rates({'EUR': 4.9, 'USD': 0.0})


def test_extract_ron_per_currency_skips_invalid_rows() -> None:
    class _Cube:
        def findall(self, _pattern: str):
            return [
                SimpleNamespace(attrib={'currency': 'EUR'}, text='4.9'),
                SimpleNamespace(attrib={}, text='2.0'),
            ]

    rates = fx_rates._extract_ron_per_currency(_Cube())
    assert rates == {'EUR': 4.9}


def test_cached_rates_expiry_and_reset() -> None:
    now = datetime.now(timezone.utc)
    cached = fx_rates.FxRates(base='RON', eur_per_ron=0.2, usd_per_ron=0.21, as_of=now.date(), source='bnr', fetched_at=now)

    fx_rates._CACHE = cached
    fx_rates._CACHE_EXPIRES_AT = now - timedelta(seconds=1)
    assert fx_rates._get_cached_rates(now, force_refresh=False) is None

    fx_rates._reset_cache_for_tests()
    assert fx_rates._CACHE is None
    assert fx_rates._CACHE_EXPIRES_AT is None


@pytest.mark.anyio('asyncio')
async def test_get_fx_rates_returns_cached_inside_lock(monkeypatch: pytest.MonkeyPatch) -> None:
    fx_rates._reset_cache_for_tests()
    now = datetime.now(timezone.utc)
    cached = fx_rates.FxRates(base='RON', eur_per_ron=0.2, usd_per_ron=0.21, as_of=now.date(), source='bnr', fetched_at=now)

    calls = {'n': 0}

    def _cached_switch(_now: datetime, *, force_refresh: bool):
        calls['n'] += 1
        if calls['n'] == 1:
            return None
        return cached

    monkeypatch.setattr(fx_rates, '_get_cached_rates', _cached_switch)

    async def _fetch_should_not_run() -> str:
        raise AssertionError('network path should not execute when cache appears inside lock')

    monkeypatch.setattr(fx_rates, '_fetch_bnr_xml', _fetch_should_not_run)

    result = await fx_rates.get_fx_rates(force_refresh=False)
    assert result is cached
