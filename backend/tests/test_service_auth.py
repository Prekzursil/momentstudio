import asyncio
from typing import Dict

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.services import auth as auth_service
from app.schemas.user import UserCreate


def test_auth_service_register_and_login():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

    async def run_flow():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with SessionLocal() as session:
            user = await auth_service.create_user(session, UserCreate(email="svc@example.com", password="svcpass1", name="Svc"))
            found = await auth_service.authenticate_user(session, "svc@example.com", "svcpass1")
            assert found.id == user.id

    asyncio.run(run_flow())
