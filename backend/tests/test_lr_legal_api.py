"""Lean-gate coverage for ``app.api.v1.legal`` consent-status endpoint."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Dict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.content import ContentBlock, ContentStatus
from app.models.legal import LegalConsent, LegalConsentContext
from app.schemas.user import UserCreate
from app.services.auth import create_user, issue_tokens_for_user


@pytest.fixture
def legal_app() -> Dict[str, object]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

    async def init_models() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with SessionLocal() as session:
            for key in ("page.terms-and-conditions", "page.privacy-policy"):
                session.add(
                    ContentBlock(
                        key=key,
                        title=key,
                        body_markdown="body",
                        status=ContentStatus.published,
                        version=2,
                        published_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
                    )
                )
            await session.commit()

    asyncio.run(init_models())

    async def override_get_session():
        async with SessionLocal() as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session
    client = TestClient(app)
    yield {"client": client, "session_factory": SessionLocal}
    client.close()
    app.dependency_overrides.clear()


def test_slug_from_key_strips_page_prefix() -> None:
    from app.api.v1.legal import _slug_from_key

    assert _slug_from_key("page.terms-and-conditions") == "terms-and-conditions"
    assert _slug_from_key("plain") == "plain"
    assert _slug_from_key("") == ""


def test_consent_status_anonymous(legal_app: Dict[str, object]) -> None:
    client: TestClient = legal_app["client"]  # type: ignore[assignment]
    res = client.get("/api/v1/legal/consents/status")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["satisfied"] is False
    assert len(body["docs"]) == 2
    for doc in body["docs"]:
        assert doc["required_version"] == 2
        assert doc["accepted_version"] == 0
        assert doc["accepted"] is False
        assert doc["slug"] == doc["doc_key"].removeprefix("page.")


def test_consent_status_authenticated_satisfied(legal_app: Dict[str, object]) -> None:
    client: TestClient = legal_app["client"]  # type: ignore[assignment]
    SessionLocal = legal_app["session_factory"]  # type: ignore[assignment]

    async def setup() -> str:
        async with SessionLocal() as session:
            user = await create_user(
                session,
                UserCreate(
                    email="legal@example.com", password="legalpass", name="Legal"
                ),
            )
            for key in ("page.terms-and-conditions", "page.privacy-policy"):
                session.add(
                    LegalConsent(
                        doc_key=key,
                        doc_version=2,
                        context=LegalConsentContext.register,
                        user_id=user.id,
                        accepted_at=datetime.now(timezone.utc),
                    )
                )
            await session.commit()
            tokens = await issue_tokens_for_user(session, user)
            return tokens["access_token"]

    token = asyncio.run(setup())
    res = client.get(
        "/api/v1/legal/consents/status",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["satisfied"] is True
    for doc in body["docs"]:
        assert doc["accepted_version"] == 2
        assert doc["accepted"] is True
