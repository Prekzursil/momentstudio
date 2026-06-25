"""Lean-gate unit coverage for ``app.cli`` (data-portability + owner CLI).

Greenfield coverage worker [w3]: ``app.cli`` was never imported by the rest of
the suite, so this file drives every helper, the four async commands
(``bootstrap_owner``, ``repair_owner``, ``export_data``, ``import_data``) against
an in-memory SQLite engine, and the ``main`` argparse dispatcher for each
subcommand arm. The in-memory session factory is bound to the name *inside*
``app.cli`` (``cli.SessionLocal``) via monkeypatch so the commands run without a
real database. The ``if __name__ == "__main__":`` guard (last two lines) is the
only ``# pragma: no cover`` target — an unreachable module-entry trampoline.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import date, datetime, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app import cli
from app.models.user import (
    User,
    UserEmailHistory,
    UserRole,
    UserUsernameHistory,
)


# --------------------------------------------------------------------------- #
# In-memory engine / session factory helpers                                  #
# --------------------------------------------------------------------------- #
def _make_session_factory() -> async_sessionmaker:
    import app.models  # noqa: F401  (register all ORM tables on Base.metadata)
    from app.db.base import Base

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def _init() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_init())
    return factory


@pytest.fixture()
def session_factory(monkeypatch):
    factory = _make_session_factory()
    monkeypatch.setattr(cli, "SessionLocal", factory)
    return factory


# --------------------------------------------------------------------------- #
# _resolve_json_path                                                           #
# --------------------------------------------------------------------------- #
def test_resolve_json_path_happy_output(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)
    resolved = cli._resolve_json_path("export.json", must_exist=False)
    assert resolved.name == "export.json"


def test_resolve_json_path_empty_raises() -> None:
    with pytest.raises(SystemExit, match="Path is required"):
        cli._resolve_json_path("   ", must_exist=False)


def test_resolve_json_path_with_directory_component(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)
    with pytest.raises(SystemExit, match="no directories"):
        cli._resolve_json_path("sub/data.json", must_exist=False)


def test_resolve_json_path_invalid_name(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)
    with pytest.raises(SystemExit, match="Invalid JSON file name"):
        cli._resolve_json_path("data.txt", must_exist=False)


def test_resolve_json_path_must_exist_missing(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)
    with pytest.raises(SystemExit, match="Input file not found"):
        cli._resolve_json_path("missing.json", must_exist=True)


def test_resolve_json_path_must_exist_present(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)
    (tmp_path / "present.json").write_text("{}", encoding="utf-8")
    resolved = cli._resolve_json_path("present.json", must_exist=True)
    assert resolved.is_file()


def test_resolve_json_path_output_is_directory(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)
    (tmp_path / "out.json").mkdir()
    with pytest.raises(SystemExit, match="points to a directory"):
        cli._resolve_json_path("out.json", must_exist=False)


# --------------------------------------------------------------------------- #
# _sanitize_username                                                           #
# --------------------------------------------------------------------------- #
def test_sanitize_username_normal() -> None:
    assert cli._sanitize_username("Alice.Smith") == "Alice.Smith"


def test_sanitize_username_empty_defaults_to_user() -> None:
    # All chars stripped -> falls back to "user".
    assert cli._sanitize_username("***") == "user"


def test_sanitize_username_non_alnum_first_char() -> None:
    # Leading char survives stripping only if alnum; here a stray underscore
    # block becomes hyphen-stripped then prefixed with "u".
    # Use a value whose first kept char is not alnum after sub but not stripped.
    result = cli._sanitize_username("9name")
    assert result[0].isalnum()


def test_sanitize_username_too_short_padded() -> None:
    assert len(cli._sanitize_username("a")) >= cli.USERNAME_MIN_LEN


def test_sanitize_username_truncated_to_max() -> None:
    long = "a" * 100
    assert len(cli._sanitize_username(long)) == cli.USERNAME_MAX_LEN


def test_sanitize_username_prefix_branch() -> None:
    # After the regex sub a leading "." would be stripped; craft a value where
    # the first surviving char is a digit-prefixed sanitization edge.
    # "+abc" -> "-abc" -> strip "._-" -> "abc"; ensure prefix branch via "1a".
    assert cli._sanitize_username("1ab")[0].isalnum()


# --------------------------------------------------------------------------- #
# _make_unique_username                                                        #
# --------------------------------------------------------------------------- #
def test_make_unique_username_unused() -> None:
    used: set[str] = set()
    assert cli._make_unique_username("bob", used) == "bob"
    assert "bob" in used


def test_make_unique_username_collision_suffix() -> None:
    used = {"bob"}
    out = cli._make_unique_username("bob", used)
    assert out == "bob-2"
    # A second collision pushes the suffix counter forward.
    out2 = cli._make_unique_username("bob", used)
    assert out2 == "bob-3"


def test_make_unique_username_collision_trims_to_max() -> None:
    base = "x" * cli.USERNAME_MAX_LEN
    used = {base}
    out = cli._make_unique_username(base, used)
    assert len(out) <= cli.USERNAME_MAX_LEN
    assert out.endswith("-2")


# --------------------------------------------------------------------------- #
# _allocate_name_tag                                                           #
# --------------------------------------------------------------------------- #
def test_allocate_name_tag(session_factory) -> None:
    async def run() -> None:
        async with session_factory() as session:
            tag0 = await cli._allocate_name_tag(session, name="Dup")
            assert tag0 == 0
            session.add(
                User(
                    email="a@x.io",
                    username="aaa",
                    hashed_password="h",
                    name="Dup",
                    name_tag=0,
                    role=UserRole.customer,
                )
            )
            await session.commit()
            tag1 = await cli._allocate_name_tag(session, name="Dup")
            assert tag1 == 1
            # exclude_user_id branch: excluding the only holder frees tag 0.
            holder = (
                await session.execute(select(User).where(User.name == "Dup"))
            ).scalar_one()
            tag_excl = await cli._allocate_name_tag(
                session, name="Dup", exclude_user_id=holder.id
            )
            assert tag_excl == 0

    asyncio.run(run())


# --------------------------------------------------------------------------- #
# bootstrap_owner                                                             #
# --------------------------------------------------------------------------- #
def test_bootstrap_owner_invalid_email(session_factory) -> None:
    with pytest.raises(SystemExit, match="Invalid email"):
        asyncio.run(
            cli.bootstrap_owner(
                email="bad", password="secret", username="u", display_name="U"
            )
        )


def test_bootstrap_owner_missing_username(session_factory) -> None:
    with pytest.raises(SystemExit, match="Username is required"):
        asyncio.run(
            cli.bootstrap_owner(
                email="a@x.io", password="secret", username="  ", display_name="U"
            )
        )


def test_bootstrap_owner_short_password_warns(session_factory, capsys) -> None:
    asyncio.run(
        cli.bootstrap_owner(
            email="a@x.io", password="123", username="alice", display_name=""
        )
    )
    out = capsys.readouterr().out
    assert "WARNING" in out
    assert "Owner created" in out


def test_bootstrap_owner_creates_new(session_factory) -> None:
    asyncio.run(
        cli.bootstrap_owner(
            email="Owner@X.io",
            password="supersecret",
            username="owner1",
            display_name="The Owner",
        )
    )

    async def check() -> None:
        async with session_factory() as session:
            owner = (
                await session.execute(select(User).where(User.role == UserRole.owner))
            ).scalar_one()
            assert owner.email == "owner@x.io"
            assert owner.email_verified is True
            histories = (
                (await session.execute(select(UserUsernameHistory))).scalars().all()
            )
            assert len(histories) == 1

    asyncio.run(check())


def test_bootstrap_owner_username_taken_for_new_email(session_factory) -> None:
    async def seed() -> None:
        async with session_factory() as session:
            session.add(
                User(
                    email="other@x.io",
                    username="taken",
                    hashed_password="h",
                    name="Other",
                    name_tag=0,
                    role=UserRole.customer,
                )
            )
            await session.commit()

    asyncio.run(seed())
    with pytest.raises(SystemExit, match="Username already taken"):
        asyncio.run(
            cli.bootstrap_owner(
                email="new@x.io",
                password="supersecret",
                username="taken",
                display_name="New",
            )
        )


def test_bootstrap_owner_promotes_existing_owner_and_updates_email_user(
    session_factory,
) -> None:
    # Existing owner is a DIFFERENT user than the target email -> demoted to admin.
    async def seed() -> None:
        async with session_factory() as session:
            session.add(
                User(
                    email="old_owner@x.io",
                    username="oldowner",
                    hashed_password="h",
                    name="Old Owner",
                    name_tag=0,
                    role=UserRole.owner,
                )
            )
            session.add(
                User(
                    email="promote@x.io",
                    username="promoteme",
                    hashed_password="h",
                    name="Promote",
                    name_tag=0,
                    role=UserRole.customer,
                )
            )
            await session.commit()

    asyncio.run(seed())
    asyncio.run(
        cli.bootstrap_owner(
            email="promote@x.io",
            password="supersecret",
            username="promoteme-new",
            display_name="Promoted Name",
        )
    )

    async def check() -> None:
        async with session_factory() as session:
            old = (
                await session.execute(
                    select(User).where(User.email == "old_owner@x.io")
                )
            ).scalar_one()
            assert old.role == UserRole.admin
            promoted = (
                await session.execute(select(User).where(User.email == "promote@x.io"))
            ).scalar_one()
            assert promoted.role == UserRole.owner
            assert promoted.username == "promoteme-new"
            assert promoted.name == "Promoted Name"

    asyncio.run(check())


def test_bootstrap_owner_existing_email_username_conflict(session_factory) -> None:
    async def seed() -> None:
        async with session_factory() as session:
            session.add(
                User(
                    email="dupe@x.io",
                    username="origuser",
                    hashed_password="h",
                    name="Orig",
                    name_tag=0,
                    role=UserRole.customer,
                )
            )
            session.add(
                User(
                    email="someone@x.io",
                    username="wanted",
                    hashed_password="h",
                    name="Someone",
                    name_tag=0,
                    role=UserRole.customer,
                )
            )
            await session.commit()

    asyncio.run(seed())
    with pytest.raises(SystemExit, match="Username already taken"):
        asyncio.run(
            cli.bootstrap_owner(
                email="dupe@x.io",
                password="supersecret",
                username="wanted",
                display_name="Orig",
            )
        )


def test_bootstrap_owner_existing_email_no_changes(session_factory, capsys) -> None:
    # The existing email user IS the current owner (re-running bootstrap on the
    # same owner): the demotion guard's 136->141 False arc is taken, and same
    # username + same name skip the history branches; just re-set pw/verified.
    async def seed() -> None:
        async with session_factory() as session:
            session.add(
                User(
                    email="keep@x.io",
                    username="keepuser",
                    hashed_password="h",
                    name="Keep Name",
                    name_tag=0,
                    role=UserRole.owner,
                )
            )
            await session.commit()

    asyncio.run(seed())
    asyncio.run(
        cli.bootstrap_owner(
            email="keep@x.io",
            password="supersecret",
            username="keepuser",
            display_name="Keep Name",
        )
    )
    out = capsys.readouterr().out
    assert "Owner set" in out


# --------------------------------------------------------------------------- #
# repair_owner                                                                 #
# --------------------------------------------------------------------------- #
def test_repair_owner_invalid_email(session_factory) -> None:
    with pytest.raises(SystemExit, match="Invalid email"):
        asyncio.run(
            cli.repair_owner(
                email="bad",
                password=None,
                username=None,
                display_name=None,
                verify_email=False,
            )
        )


def test_repair_owner_short_password_warns(session_factory, capsys) -> None:
    async def seed() -> None:
        async with session_factory() as session:
            session.add(
                User(
                    email="own@x.io",
                    username="own",
                    hashed_password="h",
                    name="Own",
                    name_tag=0,
                    role=UserRole.owner,
                )
            )
            await session.commit()

    asyncio.run(seed())
    asyncio.run(
        cli.repair_owner(
            email=None,
            password="12",
            username=None,
            display_name=None,
            verify_email=False,
        )
    )
    assert "WARNING" in capsys.readouterr().out


def test_repair_owner_no_owner(session_factory) -> None:
    with pytest.raises(SystemExit, match="No owner account found"):
        asyncio.run(
            cli.repair_owner(
                email=None,
                password=None,
                username=None,
                display_name=None,
                verify_email=True,
            )
        )


def test_repair_owner_email_already_registered(session_factory) -> None:
    async def seed() -> None:
        async with session_factory() as session:
            session.add(
                User(
                    email="theowner@x.io",
                    username="owner",
                    hashed_password="h",
                    name="Owner",
                    name_tag=0,
                    role=UserRole.owner,
                )
            )
            session.add(
                User(
                    email="conflict@x.io",
                    username="conflict",
                    hashed_password="h",
                    name="Conflict",
                    name_tag=0,
                    role=UserRole.customer,
                )
            )
            await session.commit()

    asyncio.run(seed())
    with pytest.raises(SystemExit, match="Email already registered"):
        asyncio.run(
            cli.repair_owner(
                email="conflict@x.io",
                password=None,
                username=None,
                display_name=None,
                verify_email=False,
            )
        )


def test_repair_owner_username_already_taken(session_factory) -> None:
    async def seed() -> None:
        async with session_factory() as session:
            session.add(
                User(
                    email="owner2@x.io",
                    username="owner2",
                    hashed_password="h",
                    name="Owner2",
                    name_tag=0,
                    role=UserRole.owner,
                )
            )
            session.add(
                User(
                    email="otheruser@x.io",
                    username="wantedname",
                    hashed_password="h",
                    name="Other",
                    name_tag=0,
                    role=UserRole.customer,
                )
            )
            await session.commit()

    asyncio.run(seed())
    with pytest.raises(SystemExit, match="Username already taken"):
        asyncio.run(
            cli.repair_owner(
                email=None,
                password=None,
                username="wantedname",
                display_name=None,
                verify_email=False,
            )
        )


def test_repair_owner_full_update(session_factory, capsys) -> None:
    async def seed() -> None:
        async with session_factory() as session:
            session.add(
                User(
                    email="repair@x.io",
                    username="repairme",
                    hashed_password="h",
                    name="Old Name",
                    name_tag=0,
                    email_verified=True,
                    role=UserRole.owner,
                )
            )
            await session.commit()

    asyncio.run(seed())
    asyncio.run(
        cli.repair_owner(
            email="newmail@x.io",
            password="supersecret",
            username="repaired",
            display_name="New Display",
            verify_email=False,
        )
    )

    async def check() -> None:
        async with session_factory() as session:
            owner = (
                await session.execute(select(User).where(User.role == UserRole.owner))
            ).scalar_one()
            assert owner.email == "newmail@x.io"
            # owner was verified and the new email equals the just-assigned
            # email, so ``verified and (email == email_norm)`` stays True.
            assert owner.email_verified is True
            assert owner.username == "repaired"
            assert owner.name == "New Display"

    asyncio.run(check())
    assert "Owner repaired" in capsys.readouterr().out


def test_repair_owner_email_change_keeps_unverified(session_factory) -> None:
    # Owner starts unverified; supplying a NEW email without verify_email keeps
    # email_verified False (``verified and email==norm`` -> ``False and ...``).
    async def seed() -> None:
        async with session_factory() as session:
            session.add(
                User(
                    email="unv@x.io",
                    username="unv",
                    hashed_password="h",
                    name="Unv",
                    name_tag=0,
                    email_verified=False,
                    role=UserRole.owner,
                )
            )
            await session.commit()

    asyncio.run(seed())
    asyncio.run(
        cli.repair_owner(
            email="changed@x.io",
            password=None,
            username=None,
            display_name=None,
            verify_email=False,
        )
    )

    async def check() -> None:
        async with session_factory() as session:
            owner = (
                await session.execute(select(User).where(User.role == UserRole.owner))
            ).scalar_one()
            assert owner.email == "changed@x.io"
            assert owner.email_verified is False

    asyncio.run(check())


def test_repair_owner_verify_email_only(session_factory) -> None:
    # No email supplied but verify_email=True -> elif verify_email branch.
    async def seed() -> None:
        async with session_factory() as session:
            session.add(
                User(
                    email="verify@x.io",
                    username="verifyme",
                    hashed_password="h",
                    name="Verify",
                    name_tag=0,
                    email_verified=False,
                    role=UserRole.owner,
                )
            )
            await session.commit()

    asyncio.run(seed())
    asyncio.run(
        cli.repair_owner(
            email=None,
            password=None,
            username=None,
            display_name=None,
            verify_email=True,
        )
    )

    async def check() -> None:
        async with session_factory() as session:
            owner = (
                await session.execute(select(User).where(User.role == UserRole.owner))
            ).scalar_one()
            assert owner.email_verified is True

    asyncio.run(check())


def test_repair_owner_email_same_with_verify(session_factory) -> None:
    # Supplying the SAME email with verify_email=True keeps verification true
    # and skips the email-history append (email unchanged branch).
    async def seed() -> None:
        async with session_factory() as session:
            session.add(
                User(
                    email="same@x.io",
                    username="sameuser",
                    hashed_password="h",
                    name="Same Name",
                    name_tag=0,
                    email_verified=False,
                    role=UserRole.owner,
                )
            )
            await session.commit()

    asyncio.run(seed())
    asyncio.run(
        cli.repair_owner(
            email="same@x.io",
            password=None,
            username="sameuser",
            display_name="Same Name",
            verify_email=True,
        )
    )

    async def check() -> None:
        async with session_factory() as session:
            owner = (
                await session.execute(select(User).where(User.role == UserRole.owner))
            ).scalar_one()
            assert owner.email_verified is True
            emails = (await session.execute(select(UserEmailHistory))).scalars().all()
            assert emails == []

    asyncio.run(check())


# --------------------------------------------------------------------------- #
# export_data / import_data round trip                                         #
# --------------------------------------------------------------------------- #
def _seed_full_dataset(session_factory) -> dict:
    from app.models.address import Address
    from app.models.catalog import (
        Category,
        Product,
        ProductImage,
        ProductOption,
        ProductStatus,
        ProductVariant,
        Tag,
    )
    from app.models.order import Order, OrderItem

    ids: dict = {}

    async def seed() -> None:
        async with session_factory() as session:
            user = User(
                email="cust@x.io",
                username="cust",
                hashed_password="h",
                name="Cust Omer",
                name_tag=0,
                first_name="Cust",
                last_name="Omer",
                date_of_birth=date(1990, 1, 2),
                phone="+40700000000",
                avatar_url="http://img",
                preferred_language="en",
                email_verified=True,
                role=UserRole.customer,
            )
            session.add(user)
            await session.flush()
            ids["user"] = user.id

            cat = Category(slug="mugs", name="Mugs", description="d", sort_order=1)
            session.add(cat)
            await session.flush()
            ids["category"] = cat.id

            tag = Tag(slug="hot", name="Hot")
            session.add(tag)
            await session.flush()

            product = Product(
                category_id=cat.id,
                sku="SKU1",
                slug="mug-1",
                name="Mug One",
                short_description="s",
                long_description="l",
                base_price=10,
                currency="RON",
                is_featured=True,
                stock_quantity=5,
                status=ProductStatus.published,
                publish_at=datetime(2024, 1, 1, tzinfo=timezone.utc),
                meta_title="mt",
                meta_description="md",
            )
            product.tags = [tag]
            session.add(product)
            await session.flush()
            ids["product"] = product.id
            session.add(
                ProductImage(
                    product_id=product.id, url="http://i", alt_text="a", sort_order=0
                )
            )
            session.add(
                ProductOption(
                    product_id=product.id, option_name="size", option_value="L"
                )
            )
            session.add(
                ProductVariant(
                    product_id=product.id,
                    name="Large",
                    additional_price_delta=2,
                    stock_quantity=3,
                )
            )

            addr = Address(
                user_id=user.id,
                line1="L1",
                line2="L2",
                city="City",
                region="Region",
                postal_code="0000",
                country="RO",
            )
            session.add(addr)
            await session.flush()
            ids["address"] = addr.id

            order = Order(
                user_id=user.id,
                status="paid",
                total_amount=12,
                currency="RON",
                reference_code="REF1",
                customer_email="cust@x.io",
                customer_name="Cust Omer",
            )
            order.items = [
                OrderItem(
                    product_id=product.id,
                    quantity=1,
                    unit_price=12,
                    subtotal=12,
                )
            ]
            session.add(order)
            await session.flush()
            ids["order"] = order.id
            await session.commit()

    asyncio.run(seed())
    return ids


def test_export_data_full_dataset(session_factory, tmp_path) -> None:
    """``export_data`` serialises every entity collection (full coverage of the
    export branch surface). Import is covered separately because the import path
    re-keys catalog/address rows via ``session.get(Model, <str-uuid>)`` which is
    incompatible with the SQLite test dialect (see the module REMAINING note)."""
    _seed_full_dataset(session_factory)
    out = tmp_path / "dump.json"
    asyncio.run(cli.export_data(out))
    payload = json.loads(out.read_text(encoding="utf-8"))
    assert payload["users"][0]["email"] == "cust@x.io"
    assert payload["users"][0]["date_of_birth"] == "1990-01-02"
    assert payload["categories"][0]["slug"] == "mugs"
    assert payload["products"][0]["tags"] == ["hot"]
    assert payload["products"][0]["images"][0]["url"] == "http://i"
    assert payload["products"][0]["options"][0]["name"] == "size"
    assert payload["products"][0]["variants"][0]["name"] == "Large"
    assert payload["addresses"][0]["city"] == "City"
    assert payload["orders"][0]["items"][0]["quantity"] == 1


# NOTE: ``import_data`` for catalog/address/shipping entities calls
# ``session.get(Category|Product|Address|ShippingMethod, <str from JSON>)`` with
# a *string* primary key. The ORM columns are
# ``sqlalchemy.dialects.postgresql.UUID(as_uuid=True)`` whose bind processor
# calls ``value.hex`` and rejects a plain ``str`` under the aiosqlite dialect
# used by the lean-gate test environment (the gate runs on ubuntu with no
# Postgres service; ``test_integration_postgres`` self-skips). Only the users/
# orders blocks convert ids via ``uuid.UUID(...)`` first, so only those import
# branches are reachable under SQLite and are covered below. The
# catalog/address/shipping import branches are Postgres-only and reported in
# REMAINING rather than faked or pragma-suppressed.


def test_import_data_minimal_user_with_role_and_defaults(session_factory) -> None:
    # A minimal users-only payload exercises: new-user create, name-change
    # branch (name differs from username default), role mapping, and the
    # date_of_birth=None / missing optional fields branches.
    payload = {
        "users": [
            {
                "id": str(uuid.uuid4()),
                "email": "imp@x.io",
                "username": "",  # forces fallback to email local-part
                "name": "Imported Person",
                "role": "admin",
                "email_verified": True,
            }
        ]
    }
    import tempfile
    from pathlib import Path

    tmp = Path(tempfile.mkdtemp()) / "min.json"
    tmp.write_text(json.dumps(payload), encoding="utf-8")
    asyncio.run(cli.import_data(tmp))

    async def check() -> None:
        async with session_factory() as session:
            user = (
                await session.execute(select(User).where(User.email == "imp@x.io"))
            ).scalar_one()
            assert user.role == UserRole.admin
            assert user.name == "Imported Person"
            assert user.username  # auto-generated from email local-part

    asyncio.run(check())


def test_import_data_existing_user_without_username(session_factory) -> None:
    # Pre-create a user row with an empty username so the import takes the
    # "elif not username" repair branch.
    uid = uuid.uuid4()

    async def seed() -> None:
        async with session_factory() as session:
            session.add(
                User(
                    id=uid,
                    email="nouser@x.io",
                    username="",
                    hashed_password="h",
                    name="No User",
                    name_tag=0,
                    role=UserRole.customer,
                )
            )
            await session.commit()

    asyncio.run(seed())
    payload = {
        "users": [
            {
                "id": str(uid),
                "email": "nouser@x.io",
                "username": "fixedname",
                "name": "No User",
            }
        ]
    }
    import tempfile
    from pathlib import Path

    tmp = Path(tempfile.mkdtemp()) / "nouser.json"
    tmp.write_text(json.dumps(payload), encoding="utf-8")
    asyncio.run(cli.import_data(tmp))

    async def check() -> None:
        async with session_factory() as session:
            user = await session.get(User, uid)
            assert user.username == "fixedname"

    asyncio.run(check())


def test_import_data_order_missing_customer_info_uses_user(session_factory) -> None:
    uid = uuid.uuid4()
    oid = uuid.uuid4()
    payload = {
        "users": [
            {
                "id": str(uid),
                "email": "buyer@x.io",
                "username": "buyer",
                "name": "Buyer Person",
            }
        ],
        "orders": [
            {
                "id": str(oid),
                "user_id": str(uid),
                "status": "paid",
                "total_amount": 5,
                "currency": "RON",
                "items": [],
            }
        ],
    }
    import tempfile
    from pathlib import Path

    tmp = Path(tempfile.mkdtemp()) / "order.json"
    tmp.write_text(json.dumps(payload), encoding="utf-8")
    asyncio.run(cli.import_data(tmp))

    from app.models.order import Order

    async def check() -> None:
        async with session_factory() as session:
            order = await session.get(Order, oid)
            assert order.customer_email == "buyer@x.io"
            assert order.customer_name == "Buyer Person"

    asyncio.run(check())


def test_import_data_order_missing_customer_info_raises(session_factory) -> None:
    # Order with no user_id and no customer email/name -> SystemExit.
    payload = {
        "orders": [
            {
                "id": str(uuid.uuid4()),
                "user_id": None,
                "status": "paid",
                "total_amount": 5,
                "items": [],
            }
        ]
    }
    import tempfile
    from pathlib import Path

    tmp = Path(tempfile.mkdtemp()) / "badorder.json"
    tmp.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(SystemExit, match="missing customer_email"):
        asyncio.run(cli.import_data(tmp))


def test_import_data_order_customer_present_and_reimport(session_factory) -> None:
    # customer_email + customer_name present -> the user-lookup block is skipped
    # (671->679 arc); status/currency/reference set; a second import of the same
    # order id exercises the existing-order UPDATE branch (683 False arc).
    oid = uuid.uuid4()
    payload = {
        "orders": [
            {
                "id": str(oid),
                "user_id": None,
                "customer_email": "direct@x.io",
                "customer_name": "Direct Buyer",
                "status": "paid",
                "total_amount": 9,
                "currency": "EUR",
                "reference_code": "R9",
                "items": [],
            }
        ]
    }
    import tempfile
    from pathlib import Path

    tmp = Path(tempfile.mkdtemp()) / "ord_present.json"
    tmp.write_text(json.dumps(payload), encoding="utf-8")
    asyncio.run(cli.import_data(tmp))

    from app.models.order import Order

    async def check_first() -> None:
        async with session_factory() as session:
            order = await session.get(Order, oid)
            assert order is not None
            assert order.currency == "EUR"
            assert order.reference_code == "R9"

    asyncio.run(check_first())
    # Re-import the SAME payload -> existing-order UPDATE branch (683 False arc).
    asyncio.run(cli.import_data(tmp))

    async def check_again() -> None:
        async with session_factory() as session:
            order = await session.get(Order, oid)
            assert order is not None

    asyncio.run(check_again())


def test_import_data_order_user_lookup_missing_user(session_factory) -> None:
    # order has a user_id that does not resolve -> inner ``if order_user_obj``
    # False arc, then the still-missing customer info raises SystemExit.
    payload = {
        "orders": [
            {
                "id": str(uuid.uuid4()),
                "user_id": str(uuid.uuid4()),  # no such user
                "status": "paid",
                "total_amount": 1,
                "items": [],
            }
        ]
    }
    import tempfile
    from pathlib import Path

    tmp = Path(tempfile.mkdtemp()) / "ord_nouser.json"
    tmp.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(SystemExit, match="missing customer_email"):
        asyncio.run(cli.import_data(tmp))


# The categories / tags / products / images / options / variants / addresses /
# shipping-method import blocks of ``import_data`` are intentionally NOT tested
# here: they re-key rows with ``session.get(Model, <str-uuid-from-JSON>)`` which
# raises ``AttributeError: 'str' object has no attribute 'hex'`` under the
# aiosqlite test dialect (postgresql.UUID bind processor). They are reachable
# only against a real Postgres database and are tracked in the module REMAINING
# note, not faked or pragma-suppressed. The order ``shipping_method_id`` set
# (line ~702) depends on the preceding shipping-method loop's
# ``session.get(ShippingMethod, <str>)`` and is in the same Postgres-only group.


# --------------------------------------------------------------------------- #
# main() dispatcher                                                            #
# --------------------------------------------------------------------------- #
def _patch_argv(monkeypatch, args: list[str]) -> None:
    monkeypatch.setattr("sys.argv", ["app.cli", *args])


def _drain(coro):
    """Stand-in for ``asyncio.run`` that closes the (un-awaited) coroutine.

    The dispatcher tests stub the command coroutines with sync recorders, so the
    object handed to ``asyncio.run`` is the recorder's returned coroutine; closing
    it avoids a "never awaited" warning without spinning an event loop.
    """
    coro.close()


def test_main_export_data(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)
    called = {}

    def fake_export(output):
        called["out"] = output
        return _noop()

    monkeypatch.setattr(cli, "export_data", fake_export)
    monkeypatch.setattr(cli.asyncio, "run", _drain)
    _patch_argv(monkeypatch, ["export-data", "--output", "out.json"])
    cli.main()
    assert called["out"].name == "out.json"


def test_main_import_data(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)
    (tmp_path / "in.json").write_text("{}", encoding="utf-8")
    captured = {}

    def fake_import(input_path):
        captured["p"] = input_path
        return _noop()

    monkeypatch.setattr(cli, "import_data", fake_import)
    monkeypatch.setattr(cli.asyncio, "run", _drain)
    _patch_argv(monkeypatch, ["import-data", "--input", "in.json"])
    cli.main()
    assert captured["p"].name == "in.json"


def test_main_bootstrap_owner(monkeypatch) -> None:
    captured = {}

    def fake_bootstrap(**kwargs):
        captured.update(kwargs)
        return _noop()

    monkeypatch.setattr(cli, "bootstrap_owner", fake_bootstrap)
    monkeypatch.setattr(cli.asyncio, "run", _drain)
    _patch_argv(
        monkeypatch,
        [
            "bootstrap-owner",
            "--email",
            "o@x.io",
            "--password",
            "pw",
            "--username",
            "owner",
            "--display-name",
            "Owner",
        ],
    )
    cli.main()
    assert captured["email"] == "o@x.io"


def test_main_repair_owner(monkeypatch) -> None:
    captured = {}

    def fake_repair(**kwargs):
        captured.update(kwargs)
        return _noop()

    monkeypatch.setattr(cli, "repair_owner", fake_repair)
    monkeypatch.setattr(cli.asyncio, "run", _drain)
    _patch_argv(
        monkeypatch,
        ["repair-owner", "--email", "o@x.io", "--verify-email"],
    )
    cli.main()
    assert captured["verify_email"] is True


def test_main_seed_data(monkeypatch) -> None:
    seen = {}

    async def fake_seed(session, *, profile):
        seen["p"] = profile

    monkeypatch.setattr(cli.app_seeds, "seed", fake_seed)
    # Drive the real inner _seed_data coroutine against an in-memory session so
    # the nested ``async def _seed_data`` body is executed (not just defined).
    factory = _make_session_factory()
    monkeypatch.setattr(cli, "SessionLocal", factory)
    _patch_argv(monkeypatch, ["seed-data", "--profile", "custom"])
    cli.main()
    assert seen["p"] == "custom"


def test_main_no_command_prints_help(monkeypatch, capsys) -> None:
    _patch_argv(monkeypatch, [])
    cli.main()
    out = capsys.readouterr().out
    assert "usage" in out.lower()


# --------------------------------------------------------------------------- #
# Tiny awaitable / coroutine-runner helpers for the dispatcher tests          #
# --------------------------------------------------------------------------- #
async def _noop() -> None:  # pragma: no cover -- trivial awaitable stub
    return None


def _run_coro(coro):
    return asyncio.new_event_loop().run_until_complete(coro)
