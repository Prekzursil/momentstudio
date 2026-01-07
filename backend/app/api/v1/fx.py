from fastapi import APIRouter, HTTPException, status

from app.schemas.fx import FxRatesRead
from app.services import fx_rates

router = APIRouter(prefix="/fx", tags=["fx"])


@router.get("/rates", response_model=FxRatesRead)
async def read_fx_rates() -> FxRatesRead:
    try:
        rates = await fx_rates.get_fx_rates()
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="FX rates unavailable") from exc
    return FxRatesRead(
        base=rates.base,
        eur_per_ron=rates.eur_per_ron,
        usd_per_ron=rates.usd_per_ron,
        as_of=rates.as_of,
        source=rates.source,
        fetched_at=rates.fetched_at,
    )
