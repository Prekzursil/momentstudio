import asyncio
from datetime import datetime, timezone
from typing import Dict

from fastapi.testclient import TestClient
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.content import ContentBlock, ContentRedirect, ContentStatus


def make_test_app() -> Dict[str, object]:
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
    return {"client": client, "session_factory": SessionLocal}


def seed_checkout_settings_redirect(session_factory) -> None:
    async def seed() -> None:
        async with session_factory() as session:
            await session.execute(delete(ContentRedirect))
            await session.execute(delete(ContentBlock))

            block = ContentBlock(
                key="site.checkout.v2",
                title="Checkout settings v2",
                body_markdown="Redirect target for checkout settings.",
                status=ContentStatus.published,
                version=1,
                published_at=datetime.now(timezone.utc),
                meta={
                    "version": 1,
                    "shipping_fee_ron": 20.0,
                    "free_shipping_threshold_ron": 300.0,
                    "phone_required_home": False,
                    "phone_required_locker": False,
                },
            )
            session.add(block)
            session.add(ContentRedirect(from_key="site.checkout", to_key="site.checkout.v2"))
            await session.commit()

    asyncio.run(seed())


def test_cart_totals_use_redirected_checkout_settings() -> None:
    test_app = make_test_app()
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    session_factory = test_app["session_factory"]  # type: ignore[assignment]
    try:
        seed_checkout_settings_redirect(session_factory)

        res = client.get("/api/v1/cart", headers={"X-Session-Id": "guest-test"})
        assert res.status_code == 200, res.text
        totals = res.json()["totals"]
        assert totals["phone_required_home"] is False
        assert totals["phone_required_locker"] is False
    finally:
        client.close()
        app.dependency_overrides.clear()

