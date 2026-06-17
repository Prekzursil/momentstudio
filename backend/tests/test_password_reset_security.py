import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.user import PasswordResetToken
from app.schemas.user import UserCreate
from app.services import auth as auth_service


@pytest.mark.anyio
async def test_password_reset_blacklist_old_tokens() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with SessionLocal() as session:
        user = await auth_service.create_user(
            session,
            UserCreate(email="reset2@example.com", password="password1", name="R"),
        )
        first = await auth_service.create_reset_token(session, user.email)
        # ensure first token exists
        assert isinstance(first, PasswordResetToken)
        second = await auth_service.create_reset_token(session, user.email)
        assert second.token != first.token
        # first should now be marked used
        refreshed = await session.get(PasswordResetToken, first.id)
        assert refreshed.used is True

        # using the first token should fail
        with pytest.raises(HTTPException):
            await auth_service.confirm_reset_token(session, first.token, "newpass")


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"
