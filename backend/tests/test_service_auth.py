from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

from fastapi import HTTPException
import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.schemas.user import UserCreate
from app.services import auth as auth_service


class _ExecuteResult:
    def __init__(
        self,
        *,
        first: object | None = None,
        scalar_one_or_none: object | None = None,
        scalars_all: list[object] | None = None,
    ) -> None:
        self._first = first
        self._scalar_one_or_none = scalar_one_or_none
        self._scalars_all = list(scalars_all or [])

    def scalars(self) -> "_ExecuteResult":
        return self

    def first(self) -> object | None:
        return self._first

    def all(self) -> list[object]:
        return list(self._scalars_all)

    def scalar_one_or_none(self) -> object | None:
        return self._scalar_one_or_none


class _SessionStub:
    def __init__(
        self,
        *,
        scalar_values: list[object | None] | None = None,
        get_values: list[object | None] | None = None,
        execute_results: list[_ExecuteResult] | None = None,
    ) -> None:
        self._scalar_values = list(scalar_values or [])
        self._get_values = list(get_values or [])
        self._execute_results = list(execute_results or [])
        self.added: list[object] = []
        self.deleted: list[object] = []
        self.commits = 0
        self.flushed = 0
        self.refreshed: list[object] = []

    async def scalar(self, _statement: object) -> object | None:
        await asyncio.sleep(0)
        return self._scalar_values.pop(0) if self._scalar_values else None

    async def get(self, _model: object, _id: object) -> object | None:
        await asyncio.sleep(0)
        return self._get_values.pop(0) if self._get_values else None

    async def execute(self, _statement: object) -> _ExecuteResult:
        await asyncio.sleep(0)
        if self._execute_results:
            return self._execute_results.pop(0)
        return _ExecuteResult()

    def add(self, value: object) -> None:
        self.added.append(value)

    def add_all(self, values: list[object]) -> None:
        self.added.extend(list(values))

    async def delete(self, value: object) -> None:
        await asyncio.sleep(0)
        self.deleted.append(value)

    async def flush(self) -> None:
        await asyncio.sleep(0)
        self.flushed += 1

    async def commit(self) -> None:
        await asyncio.sleep(0)
        self.commits += 1

    async def refresh(self, value: object) -> None:
        await asyncio.sleep(0)
        self.refreshed.append(value)


def test_auth_service_register_and_login():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

    async def run_flow():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with SessionLocal() as session:
            generated_credential = f"cred-{uuid4()}"
            user = await auth_service.create_user(
                session,
                UserCreate(email="svc@example.com", password=generated_credential, name="Svc"),
            )
            found = await auth_service.authenticate_user(session, "svc@example.com", generated_credential)
            assert found.id == user.id

    asyncio.run(run_flow())


def test_service_auth_email_guard_helpers() -> None:
    with pytest.raises(HTTPException, match="Email cannot be changed while Google is linked"):
        auth_service._require_email_change_allowed(SimpleNamespace(google_sub="google-sub"))

    assert auth_service._normalize_required_email("  User@Example.com  ") == "user@example.com"
    with pytest.raises(HTTPException, match="Email is required"):
        auth_service._normalize_required_email("   ")


@pytest.mark.anyio
async def test_service_auth_email_change_cooldown_matrix() -> None:
    user = SimpleNamespace(id=uuid4())
    await auth_service._enforce_email_change_cooldown(_SessionStub(scalar_values=[1]), user)
    await auth_service._enforce_email_change_cooldown(_SessionStub(scalar_values=[2, "not-a-datetime"]), user)
    await auth_service._enforce_email_change_cooldown(
        _SessionStub(scalar_values=[2, datetime.now(timezone.utc) - timedelta(days=31)]),
        user,
    )

    with pytest.raises(HTTPException, match="You can change your email once every 30 days") as exc:
        await auth_service._enforce_email_change_cooldown(
            _SessionStub(scalar_values=[2, datetime.now() - timedelta(days=1)]),
            user,
        )
    assert exc.value.status_code == 429


@pytest.mark.anyio
async def test_service_auth_secondary_email_error_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    user = SimpleNamespace(id=uuid4(), email="primary@example.com")

    with pytest.raises(HTTPException, match="Email is required"):
        await auth_service.add_secondary_email(_SessionStub(), user, "   ")
    with pytest.raises(HTTPException, match="already your primary email"):
        await auth_service.add_secondary_email(_SessionStub(), user, "primary@example.com")

    async def _always_taken(_session: object, _email: str, *, exclude_user_id: object | None = None) -> bool:
        await asyncio.sleep(0)
        _ = exclude_user_id
        return True

    monkeypatch.setattr(auth_service, "is_email_taken", _always_taken)
    with pytest.raises(HTTPException, match="Email already registered"):
        await auth_service.add_secondary_email(_SessionStub(), user, "alt@example.com")

    with pytest.raises(HTTPException, match="Secondary email not found"):
        await auth_service.request_secondary_email_verification(_SessionStub(get_values=[None]), user, uuid4())

    verified_secondary = SimpleNamespace(id=uuid4(), user_id=user.id, verified=True)
    with pytest.raises(HTTPException, match="already verified"):
        await auth_service.request_secondary_email_verification(
            _SessionStub(get_values=[verified_secondary]),
            user,
            verified_secondary.id,
        )

    with pytest.raises(HTTPException, match="Invalid or expired token"):
        await auth_service.confirm_secondary_email_verification(_SessionStub(), "   ")

    expired_record = SimpleNamespace(
        expires_at=datetime.now(timezone.utc) - timedelta(seconds=1),
        secondary_email_id=uuid4(),
        used=False,
    )
    expired_verification_id = str(uuid4())
    with pytest.raises(HTTPException, match="Invalid or expired token"):
        await auth_service.confirm_secondary_email_verification(
            _SessionStub(execute_results=[_ExecuteResult(first=expired_record)]),
            expired_verification_id,
        )

    valid_record = SimpleNamespace(
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
        secondary_email_id=uuid4(),
        used=False,
    )
    valid_verification_id = str(uuid4())
    with pytest.raises(HTTPException, match="Secondary email not found"):
        await auth_service.confirm_secondary_email_verification(
            _SessionStub(execute_results=[_ExecuteResult(first=valid_record)], get_values=[None]),
            valid_verification_id,
        )


@pytest.mark.anyio
async def test_service_auth_preserve_old_primary_matrix() -> None:
    user = SimpleNamespace(id=uuid4())
    now = datetime.now(timezone.utc)

    blank_session = _SessionStub()
    await auth_service._preserve_old_primary_as_secondary(
        blank_session,
        user=user,
        old_primary="",
        old_primary_verified=False,
        now=now,
    )
    assert blank_session.added == []

    existing_secondary = SimpleNamespace(verified=False, verified_at=None)
    existing_session = _SessionStub(scalar_values=[existing_secondary])
    await auth_service._preserve_old_primary_as_secondary(
        existing_session,
        user=user,
        old_primary="old@example.com",
        old_primary_verified=True,
        now=now,
    )
    assert existing_secondary.verified is True
    assert existing_secondary.verified_at == now
    assert existing_session.added == [existing_secondary]

    new_secondary_session = _SessionStub(scalar_values=[None])
    await auth_service._preserve_old_primary_as_secondary(
        new_secondary_session,
        user=user,
        old_primary="fresh@example.com",
        old_primary_verified=False,
        now=now,
    )
    assert len(new_secondary_session.added) == 1
    created = new_secondary_session.added[0]
    assert getattr(created, "email") == "fresh@example.com"
    assert getattr(created, "verified") is False
    assert getattr(created, "verified_at") is None


def test_service_auth_login_access_state_guards() -> None:
    with pytest.raises(HTTPException, match="Account temporarily locked"):
        auth_service._enforce_login_access_state(
            SimpleNamespace(locked_until=datetime.now() + timedelta(minutes=5), password_reset_required=False)
        )

    with pytest.raises(HTTPException, match="Password reset required"):
        auth_service._enforce_login_access_state(
            SimpleNamespace(locked_until=datetime.now(timezone.utc) - timedelta(minutes=5), password_reset_required=True)
        )

    auth_service._enforce_login_access_state(
        SimpleNamespace(locked_until=datetime.now(timezone.utc) - timedelta(minutes=5), password_reset_required=False)
    )


@pytest.mark.anyio
async def test_service_auth_deleted_login_guard_executes_due_deletion(monkeypatch: pytest.MonkeyPatch) -> None:
    called: list[object] = []

    async def _fake_execute_account_deletion(_session: object, user: object) -> None:
        await asyncio.sleep(0)
        called.append(user)

    monkeypatch.setattr(auth_service.self_service, "is_deletion_due", lambda _user: True)
    monkeypatch.setattr(auth_service.self_service, "execute_account_deletion", _fake_execute_account_deletion)

    pending_user = SimpleNamespace(deleted_at=None, deletion_scheduled_for=datetime.now(timezone.utc) - timedelta(minutes=1))
    with pytest.raises(HTTPException, match="Account deleted"):
        await auth_service._enforce_not_deleted_for_login(_SessionStub(), pending_user)
    assert called == [pending_user]

    deleted_user = SimpleNamespace(deleted_at=datetime.now(timezone.utc), deletion_scheduled_for=None)
    with pytest.raises(HTTPException, match="Account deleted"):
        await auth_service._enforce_not_deleted_for_login(_SessionStub(), deleted_user)
