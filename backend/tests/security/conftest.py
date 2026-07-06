"""Shared fixtures for the WU13 theme security lane.

The lane is a black-box adversarial suite over the EXISTING theme gate / SSR-sink
revalidator / authz — it never imports the internals it attacks except to assert
their public contracts. These fixtures stand up the same per-test in-memory
SQLite app the rest of the theme suite uses (``dependency_overrides[get_session]``
+ ``TestClient`` + admin auth via ``role=admin`` + ``UserPasskey`` +
``X-Admin-Step-Up``), seeding the WU1 default theme through
``ensure_default_theme``.

The parent ``backend/tests/conftest.py`` autouse fixtures still apply here (engine
disposal + auth-limiter reset); this conftest adds the THEME mutation-limiter
reset (the parent only clears the auth limiters) so a rate-limit test cannot leak
into a sibling.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1 import theme as theme_api
from app.core import security
from app.core.rate_limit import reset_buckets
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.passkeys import UserPasskey
from app.models.user import UserRole
from app.schemas.user import UserCreate
from app.services.auth import create_user, issue_tokens_for_user
from app.services.theme_service import ensure_default_theme

Headers = dict[str, str]
HeaderMaker = Callable[[async_sessionmaker], Headers]


def _build_factory(*, seed: bool) -> async_sessionmaker:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def _init() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        if seed:
            async with factory() as session:
                await ensure_default_theme(session)
                await session.commit()

    asyncio.run(_init())
    return factory


def _client_for(factory: async_sessionmaker) -> TestClient:
    async def override_get_session():  # type: ignore[no-untyped-def]
        async with factory() as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session
    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset_theme_rate_limit() -> Any:
    # The mutate limiter is a module-level singleton; clear its buckets before and
    # after each test so an earlier request never trips a later test's limit.
    reset_buckets([theme_api.theme_mutation_rate_limit.buckets])
    yield
    reset_buckets([theme_api.theme_mutation_rate_limit.buckets])


@pytest.fixture
def seeded_app() -> Any:
    factory = _build_factory(seed=True)
    client = _client_for(factory)
    yield {"client": client, "factory": factory}
    client.close()
    app.dependency_overrides.clear()


@pytest.fixture
def empty_app() -> Any:
    factory = _build_factory(seed=False)
    client = _client_for(factory)
    yield {"client": client, "factory": factory}
    client.close()
    app.dependency_overrides.clear()


def _headers(token: str) -> Headers:
    headers = {"Authorization": f"Bearer {token}"}
    payload = security.decode_token(token)
    if payload and payload.get("sub"):
        headers["X-Admin-Step-Up"] = security.create_step_up_token(str(payload["sub"]))
    return headers


def _mint(
    factory: async_sessionmaker,
    *,
    role: UserRole | None,
    email: str,
    name: str,
    with_passkey: bool,
) -> str:
    async def _run() -> str:
        async with factory() as session:
            user = await create_user(
                session,
                UserCreate(email=email, password="lane-password", name=name),
            )
            if role is not None:
                user.role = role
            if with_passkey:
                session.add(
                    UserPasskey(
                        user_id=user.id,
                        name="Lane Passkey",
                        credential_id=f"cred-{user.id}",
                        public_key=b"test",
                        sign_count=0,
                        backed_up=False,
                    )
                )
            await session.commit()
            tokens = await issue_tokens_for_user(session, user)
            return tokens["access_token"]

    return asyncio.run(_run())


@pytest.fixture
def admin_headers() -> HeaderMaker:
    """Return a factory -> admin auth-headers maker (fresh admin + step-up)."""

    def _make(factory: async_sessionmaker) -> Headers:
        return _headers(
            _mint(
                factory,
                role=UserRole.admin,
                email="lane-admin@example.com",
                name="Lane Admin",
                with_passkey=True,
            )
        )

    return _make


@pytest.fixture
def customer_headers() -> HeaderMaker:
    """Return a factory -> non-admin (customer) auth-headers maker."""

    def _make(factory: async_sessionmaker) -> Headers:
        return _headers(
            _mint(
                factory,
                role=None,
                email="lane-shopper@example.com",
                name="Lane Shopper",
                with_passkey=False,
            )
        )

    return _make
