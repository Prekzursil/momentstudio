import asyncio

from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.session import get_session
from app.main import app


def test_refresh_token_rotation() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

    async def init_models() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(init_models())

    async def override_get_session():
        async with SessionLocal() as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session
    client = TestClient(app)

    register_payload = {"email": "rotate@example.com", "username": "rotate", "password": "password1", "name": "Rotate"}
    res = client.post("/api/v1/auth/register", json=register_payload)
    assert res.status_code == 201, res.text
    refresh_token = res.json()["tokens"]["refresh_token"]

    first = client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})
    assert first.status_code == 200, first.text
    new_refresh = first.json()["refresh_token"]
    assert new_refresh != refresh_token

    # old token should now be rejected
    second = client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})
    assert second.status_code == 401

    client.close()
    app.dependency_overrides.clear()
