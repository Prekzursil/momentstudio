from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.address import Address
from app.schemas.address import AddressCreate, AddressUpdate


async def list_addresses(session: AsyncSession, user_id) -> list[Address]:
    result = await session.execute(select(Address).where(Address.user_id == user_id))
    return list(result.scalars())


async def create_address(session: AsyncSession, user_id, payload: AddressCreate) -> Address:
    address = Address(user_id=user_id, **payload.model_dump())
    session.add(address)
    if payload.is_default_shipping or payload.is_default_billing:
        await _clear_defaults(session, user_id, payload.is_default_shipping, payload.is_default_billing)
    await session.commit()
    await session.refresh(address)
    return address


async def update_address(session: AsyncSession, address: Address, payload: AddressUpdate) -> Address:
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(address, field, value)
    if payload.is_default_shipping or payload.is_default_billing:
        await _clear_defaults(
            session,
            address.user_id,
            payload.is_default_shipping if payload.is_default_shipping is not None else False,
            payload.is_default_billing if payload.is_default_billing is not None else False,
            exclude_id=address.id,
        )
    session.add(address)
    await session.commit()
    await session.refresh(address)
    return address


async def delete_address(session: AsyncSession, address: Address) -> None:
    await session.delete(address)
    await session.commit()


async def get_address(session: AsyncSession, user_id, address_id) -> Address | None:
    result = await session.execute(select(Address).where(Address.user_id == user_id, Address.id == address_id))
    return result.scalar_one_or_none()


async def _clear_defaults(session: AsyncSession, user_id, shipping: bool, billing: bool, exclude_id=None) -> None:
    if not shipping and not billing:
        return
    result = await session.execute(select(Address).where(Address.user_id == user_id))
    addresses = result.scalars().all()
    for addr in addresses:
        if exclude_id and addr.id == exclude_id:
            continue
        if shipping:
            addr.is_default_shipping = False
        if billing:
            addr.is_default_billing = False
        session.add(addr)
    await session.flush()
