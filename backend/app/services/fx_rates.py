from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Final
from defusedxml.ElementTree import fromstring

import httpx

from app.core.config import settings


BNR_SOURCE: Final[str] = "bnr"


@dataclass(frozen=True)
class FxRates:
    base: str
    eur_per_ron: float
    usd_per_ron: float
    as_of: date
    source: str
    fetched_at: datetime


_CACHE: FxRates | None = None
_CACHE_EXPIRES_AT: datetime | None = None
_LOCK = asyncio.Lock()


def _get_bnr_cube(xml_text: str):
    root = fromstring(xml_text)
    cube = root.find(".//{*}Cube")
    if cube is None:
        raise ValueError("Missing Cube element")
    return cube


def _get_cube_date(cube) -> date:
    cube_date_raw = cube.attrib.get("date")
    if not cube_date_raw:
        raise ValueError("Missing Cube date")
    return date.fromisoformat(cube_date_raw)


def _parse_rate_element(rate_el) -> tuple[str, float] | None:
    currency = (rate_el.attrib.get("currency") or "").strip().upper()
    if not currency:
        return None

    multiplier = int(rate_el.attrib.get("multiplier", "1") or "1")
    raw = (rate_el.text or "").strip()
    if not raw:
        return None

    value = float(raw)
    if multiplier <= 0:
        return None

    # BNR publishes RON per "multiplier" units of currency.
    return currency, value / multiplier


def _extract_ron_per_currency(cube) -> dict[str, float]:
    rates: dict[str, float] = {}
    for rate_el in cube.findall("{*}Rate"):
        parsed_rate = _parse_rate_element(rate_el)
        if parsed_rate is None:
            continue
        currency, ron_per_currency = parsed_rate
        rates[currency] = ron_per_currency
    return rates


def _extract_required_rates(rates: dict[str, float]) -> tuple[float, float]:
    ron_per_eur = rates.get("EUR")
    ron_per_usd = rates.get("USD")
    if ron_per_eur is None or ron_per_usd is None:
        raise ValueError("Missing EUR/USD rates")
    if ron_per_eur <= 0.0 or ron_per_usd <= 0.0:
        raise ValueError("Non-positive EUR/USD rates")
    return ron_per_eur, ron_per_usd


def _parse_bnr_rates(xml_text: str) -> FxRates:
    cube = _get_bnr_cube(xml_text)
    cube_date = _get_cube_date(cube)
    rates = _extract_ron_per_currency(cube)
    ron_per_eur, ron_per_usd = _extract_required_rates(rates)

    eur_per_ron = 1.0 / ron_per_eur
    usd_per_ron = 1.0 / ron_per_usd
    now = datetime.now(timezone.utc)
    return FxRates(
        base="RON",
        eur_per_ron=eur_per_ron,
        usd_per_ron=usd_per_ron,
        as_of=cube_date,
        source=BNR_SOURCE,
        fetched_at=now,
    )


async def _fetch_bnr_xml() -> str:
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(settings.fx_rates_url)
        resp.raise_for_status()
        return resp.text


def _get_cached_rates(now: datetime, *, force_refresh: bool) -> FxRates | None:
    if force_refresh or _CACHE is None or _CACHE_EXPIRES_AT is None:
        return None
    if _CACHE_EXPIRES_AT <= now:
        return None
    return _CACHE


async def get_fx_rates(*, force_refresh: bool = False) -> FxRates:
    global _CACHE, _CACHE_EXPIRES_AT

    now = datetime.now(timezone.utc)
    cached = _get_cached_rates(now, force_refresh=force_refresh)
    if cached is not None:
        return cached

    async with _LOCK:
        now = datetime.now(timezone.utc)
        cached = _get_cached_rates(now, force_refresh=force_refresh)
        if cached is not None:
            return cached

        xml_text = await _fetch_bnr_xml()
        parsed = _parse_bnr_rates(xml_text)
        ttl = max(30, int(settings.fx_rates_cache_ttl_seconds))
        _CACHE = parsed
        _CACHE_EXPIRES_AT = now + timedelta(seconds=ttl)
        return parsed


def _reset_cache_for_tests() -> None:
    global _CACHE, _CACHE_EXPIRES_AT
    _CACHE = None
    _CACHE_EXPIRES_AT = None
