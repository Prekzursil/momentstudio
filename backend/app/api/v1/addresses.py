from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import require_complete_profile
from app.db.session import get_session
from app.schemas.address import AddressCreate, AddressRead, AddressUpdate
from app.services import address as address_service

router = APIRouter(prefix="/me/addresses", tags=["addresses"])


@router.get("", response_model=list[AddressRead])
async def list_addresses(current_user=Depends(require_complete_profile), session: AsyncSession = Depends(get_session)):
    return await address_service.list_addresses(session, current_user.id)


@router.post("", response_model=AddressRead, status_code=status.HTTP_201_CREATED)
async def create_address(
    payload: AddressCreate,
    current_user=Depends(require_complete_profile),
    session: AsyncSession = Depends(get_session),
):
    return await address_service.create_address(session, current_user.id, payload)


@router.patch("/{address_id}", response_model=AddressRead)
async def update_address(
    address_id: UUID,
    payload: AddressUpdate,
    current_user=Depends(require_complete_profile),
    session: AsyncSession = Depends(get_session),
):
    address = await address_service.get_address(session, current_user.id, address_id)
    if not address:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Address not found")
    return await address_service.update_address(session, address, payload)


@router.delete("/{address_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_address(
    address_id: UUID,
    current_user=Depends(require_complete_profile),
    session: AsyncSession = Depends(get_session),
):
    address = await address_service.get_address(session, current_user.id, address_id)
    if not address:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Address not found")
    await address_service.delete_address(session, address)
    return None
