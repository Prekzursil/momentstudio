from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core import security
from app.models.user import User
from app.schemas.user import UserCreate


async def get_user_by_email(session: AsyncSession, email: str) -> User | None:
    result = await session.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()


async def create_user(session: AsyncSession, user_in: UserCreate) -> User:
    existing = await get_user_by_email(session, user_in.email)
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")

    db_user = User(
        email=user_in.email,
        hashed_password=security.hash_password(user_in.password),
        name=user_in.name,
    )
    session.add(db_user)
    await session.commit()
    await session.refresh(db_user)
    return db_user


async def authenticate_user(session: AsyncSession, email: str, password: str) -> User:
    user = await get_user_by_email(session, email)
    if not user or not security.verify_password(password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    return user


def issue_tokens_for_user(user: User) -> dict[str, str]:
    return {
        "access_token": security.create_access_token(str(user.id)),
        "refresh_token": security.create_refresh_token(str(user.id)),
    }
