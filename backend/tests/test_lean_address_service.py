"""Lean-gate unit coverage for the ``address`` service.

Exercises ``_validate_address_fields`` (all postal-code branches) and the full
CRUD surface (list/create/update/delete/get) plus the default-flag clearing
logic against an in-memory database.
"""

from __future__ import annotations

import asyncio
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.schemas.address import AddressCreate, AddressUpdate
from app.services import address as address_service

from tests.conftest import make_memory_session_factory


# --------------------------------------------------------------------------- #
# _validate_address_fields                                                     #
# --------------------------------------------------------------------------- #
def test_validate_rejects_bad_country() -> None:
    for bad in ("", "USA", "1U"):
        with pytest.raises(HTTPException) as exc:
            address_service._validate_address_fields(bad, "12345")
        assert exc.value.status_code == 400


def test_validate_rejects_missing_postal() -> None:
    with pytest.raises(HTTPException):
        address_service._validate_address_fields("US", "   ")


def test_validate_known_country_pattern() -> None:
    assert address_service._validate_address_fields("ro", " 010101 ") == (
        "RO",
        "010101",
    )
    with pytest.raises(HTTPException):
        address_service._validate_address_fields("RO", "ABC")


def test_validate_unknown_country_generic_pattern() -> None:
    # Unknown country falls back to the generic alnum pattern.
    assert address_service._validate_address_fields("FR", "75001") == ("FR", "75001")
    with pytest.raises(HTTPException):
        address_service._validate_address_fields("FR", "!!")


def _create_payload(**kw) -> AddressCreate:
    defaults = dict(
        line1="Str. Foo 1",
        city="Bucharest",
        postal_code="010101",
        country="RO",
    )
    defaults.update(kw)
    return AddressCreate(**defaults)


# --------------------------------------------------------------------------- #
# CRUD                                                                         #
# --------------------------------------------------------------------------- #
def test_create_list_get_delete_address() -> None:
    factory = make_memory_session_factory()

    async def flow() -> None:
        user_id = uuid4()
        async with factory() as session:
            created = await address_service.create_address(
                session, user_id, _create_payload()
            )
            assert created.country == "RO"

            listed = await address_service.list_addresses(session, user_id)
            assert len(listed) == 1

            got = await address_service.get_address(session, user_id, created.id)
            assert got is not None and got.id == created.id
            # Wrong user -> None.
            assert (
                await address_service.get_address(session, uuid4(), created.id) is None
            )

            await address_service.delete_address(session, created)
            assert await address_service.list_addresses(session, user_id) == []

    asyncio.run(flow())


def test_create_with_defaults_clears_siblings() -> None:
    factory = make_memory_session_factory()

    async def flow() -> None:
        user_id = uuid4()
        async with factory() as session:
            first = await address_service.create_address(
                session,
                user_id,
                _create_payload(is_default_shipping=True, is_default_billing=True),
            )
            assert first.is_default_shipping is True

            second = await address_service.create_address(
                session,
                user_id,
                _create_payload(line1="Str. Bar 2", is_default_shipping=True),
            )
            await session.refresh(first)
            # New default shipping clears the previous one; billing untouched.
            assert second.is_default_shipping is True
            assert first.is_default_shipping is False
            assert first.is_default_billing is True

    asyncio.run(flow())


def test_update_address_fields_and_defaults() -> None:
    factory = make_memory_session_factory()

    async def flow() -> None:
        user_id = uuid4()
        async with factory() as session:
            a = await address_service.create_address(
                session, user_id, _create_payload(is_default_billing=True)
            )
            b = await address_service.create_address(
                session, user_id, _create_payload(line1="Str. Baz 3")
            )

            # Update b to become the default billing -> clears a's billing.
            updated = await address_service.update_address(
                session,
                b,
                AddressUpdate(city="Cluj", is_default_billing=True),
            )
            await session.refresh(a)
            assert updated.city == "Cluj"
            assert updated.is_default_billing is True
            assert a.is_default_billing is False

    asyncio.run(flow())


def test_update_address_without_default_change() -> None:
    factory = make_memory_session_factory()

    async def flow() -> None:
        user_id = uuid4()
        async with factory() as session:
            a = await address_service.create_address(
                session, user_id, _create_payload()
            )
            updated = await address_service.update_address(
                session, a, AddressUpdate(label="Home")
            )
            assert updated.label == "Home"
            assert updated.country == "RO"  # re-validated from existing value

    asyncio.run(flow())


def test_clear_defaults_noop_when_no_flags() -> None:
    factory = make_memory_session_factory()

    async def flow() -> None:
        user_id = uuid4()
        async with factory() as session:
            await address_service._clear_defaults(
                session, user_id, shipping=False, billing=False
            )

    asyncio.run(flow())
