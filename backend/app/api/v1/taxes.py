from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import require_admin
from app.db.session import get_session
from app.models.taxes import TaxGroup
from app.schemas.taxes import TaxGroupCreate, TaxGroupRead, TaxGroupUpdate, TaxRateRead, TaxRateUpsert
from app.services import taxes as taxes_service


router = APIRouter(prefix="/taxes", tags=["taxes"])


@router.get("/admin/groups", response_model=list[TaxGroupRead])
async def list_tax_groups(
    session: AsyncSession = Depends(get_session),
    _: object = Depends(require_admin),
) -> list[TaxGroup]:
    return await taxes_service.list_tax_groups(session)


@router.post("/admin/groups", response_model=TaxGroupRead, status_code=status.HTTP_201_CREATED)
async def create_tax_group(
    payload: TaxGroupCreate,
    session: AsyncSession = Depends(get_session),
    _: object = Depends(require_admin),
) -> TaxGroup:
    return await taxes_service.create_tax_group(
        session,
        code=payload.code,
        name=payload.name,
        description=payload.description,
        is_default=payload.is_default,
    )


@router.patch("/admin/groups/{group_id}", response_model=TaxGroupRead)
async def update_tax_group(
    group_id: UUID,
    payload: TaxGroupUpdate,
    session: AsyncSession = Depends(get_session),
    _: object = Depends(require_admin),
) -> TaxGroup:
    group = await session.get(TaxGroup, group_id)
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tax group not found")
    return await taxes_service.update_tax_group(
        session, group=group, name=payload.name, description=payload.description, is_default=payload.is_default
    )


@router.delete("/admin/groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tax_group(
    group_id: UUID,
    session: AsyncSession = Depends(get_session),
    _: object = Depends(require_admin),
) -> None:
    group = await session.get(TaxGroup, group_id)
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tax group not found")
    await taxes_service.delete_tax_group(session, group=group)
    return None


@router.put("/admin/groups/{group_id}/rates", response_model=TaxRateRead)
async def upsert_tax_rate(
    group_id: UUID,
    payload: TaxRateUpsert,
    session: AsyncSession = Depends(get_session),
    _: object = Depends(require_admin),
) -> TaxRateRead:
    group = await session.get(TaxGroup, group_id)
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tax group not found")
    return await taxes_service.upsert_tax_rate(
        session, group=group, country_code=payload.country_code, vat_rate_percent=payload.vat_rate_percent
    )


@router.delete("/admin/groups/{group_id}/rates/{country_code}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tax_rate(
    group_id: UUID,
    country_code: str,
    session: AsyncSession = Depends(get_session),
    _: object = Depends(require_admin),
) -> None:
    await taxes_service.delete_tax_rate(session, group_id=group_id, country_code=country_code)
    return None

