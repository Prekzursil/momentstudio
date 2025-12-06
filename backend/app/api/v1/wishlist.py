import uuid
from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user
from app.db.session import get_session
from app.models.user import User
from app.schemas.catalog import ProductRead
from app.services import wishlist as wishlist_service

router = APIRouter(prefix="/wishlist", tags=["wishlist"])


@router.get("", response_model=list[ProductRead])
async def list_wishlist(current_user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)) -> list[ProductRead]:
    products = await wishlist_service.list_wishlist(session, current_user.id)
    return products


@router.post("/{product_id}", response_model=ProductRead, status_code=status.HTTP_201_CREATED)
async def add_wishlist_item(
    product_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ProductRead:
    product = await wishlist_service.add_to_wishlist(session, current_user.id, product_id)
    return product


@router.delete("/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_wishlist_item(
    product_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    await wishlist_service.remove_from_wishlist(session, current_user.id, product_id)
    return None
