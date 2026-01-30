import asyncio
from datetime import datetime, timezone

from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.security import decode_token
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.content import ContentBlock, ContentStatus


def test_refresh_token_rotation() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

    async def init_models() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with SessionLocal() as session:
            session.add_all(
                [
                    ContentBlock(
                        key="page.terms-and-conditions",
                        title="Terms",
                        body_markdown="Terms",
                        status=ContentStatus.published,
                        version=1,
                        published_at=datetime.now(timezone.utc),
                    ),
                    ContentBlock(
                        key="page.privacy-policy",
                        title="Privacy",
                        body_markdown="Privacy",
                        status=ContentStatus.published,
                        version=1,
                        published_at=datetime.now(timezone.utc),
                    ),
                ]
            )
            await session.commit()

    asyncio.run(init_models())

    async def override_get_session():
        async with SessionLocal() as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session
    client = TestClient(app)

    register_payload = {
        "email": "rotate@example.com",
        "username": "rotate",
        "password": "password1",
        "name": "Rotate",
        "first_name": "Rotate",
        "last_name": "User",
        "date_of_birth": "2000-01-01",
        "phone": "+40723204204",
        "accept_terms": True,
        "accept_privacy": True,
    }
    res = client.post("/api/v1/auth/register", json=register_payload)
    assert res.status_code == 201, res.text
    refresh_token = res.json()["tokens"]["refresh_token"]

    first = client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})
    assert first.status_code == 200, first.text
    new_refresh = first.json()["refresh_token"]
    assert new_refresh != refresh_token

    new_payload = decode_token(new_refresh) or {}
    new_jti = new_payload.get("jti")
    assert new_jti

    # old token can be reused briefly (multi-tab refresh) and should resolve to the same replacement session
    second = client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})
    assert second.status_code == 200, second.text
    second_payload = decode_token(second.json()["refresh_token"]) or {}
    second_jti = second_payload.get("jti")
    assert second_jti == new_jti

    client.close()
    app.dependency_overrides.clear()
