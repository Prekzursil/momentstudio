import re

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.address import Address
from app.schemas.address import AddressCreate, AddressUpdate

POSTAL_PATTERNS = {
    "US": r"^\d{5}(-\d{4})?$",
    "CA": r"^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$",
    "GB": r"^[A-Za-z]{1,2}\d[A-Za-z\d]? ?\d[A-Za-z]{2}$",
    "RO": r"^\d{6}$",
    "DE": r"^\d{5}$",
}


def _validate_address_fields(country: str, postal_code: str) -> tuple[str, str]:
    if not country or len(country) != 2 or not country.isalpha():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Country must be a 2-letter code")
    normalized_country = country.upper()
    if not postal_code or not postal_code.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Postal code is required")
    postal_code = postal_code.strip()
    pattern = POSTAL_PATTERNS.get(normalized_country)
    if pattern:
        if not re.match(pattern, postal_code):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid postal code for country")
    else:
        if not re.match(r"^[A-Za-z0-9 -]{3,12}$", postal_code):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid postal code format")
    return normalized_country, postal_code


async def list_addresses(session: AsyncSession, user_id) -> list[Address]:
    result = await session.execute(select(Address).where(Address.user_id == user_id))
    return list(result.scalars())


async def create_address(session: AsyncSession, user_id, payload: AddressCreate) -> Address:
    country, postal_code = _validate_address_fields(payload.country, payload.postal_code)
    data = payload.model_dump()
    data.update({"country": country, "postal_code": postal_code})
    address = Address(user_id=user_id, **data)
    if payload.is_default_shipping or payload.is_default_billing:
        await _clear_defaults(session, user_id, payload.is_default_shipping, payload.is_default_billing)
    session.add(address)
    await session.commit()
    await session.refresh(address)
    return address


async def update_address(session: AsyncSession, address: Address, payload: AddressUpdate) -> Address:
    updates = payload.model_dump(exclude_unset=True)
    target_country = updates.get("country", address.country)
    target_postal = updates.get("postal_code", address.postal_code)
    country, postal_code = _validate_address_fields(target_country, target_postal)
    updates["country"] = country
    updates["postal_code"] = postal_code
    for field, value in updates.items():
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
