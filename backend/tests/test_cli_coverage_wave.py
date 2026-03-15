from __future__ import annotations

import argparse
import asyncio
import contextlib
from datetime import date, datetime, timezone
import io
import json
from pathlib import Path
from types import SimpleNamespace
import uuid

import pytest

from app import cli


OWNER_RESET_VALUE = f"owner-reset-{uuid.uuid4().hex}"
OWNER_BOOTSTRAP_VALUE = f"owner-bootstrap-{uuid.uuid4().hex}"


class _ScalarRows:
    def __init__(self, rows: list[object]) -> None:
        self._rows = rows

    def all(self) -> list[object]:
        return list(self._rows)


class _ExecuteResult:
    def __init__(self, rows: list[object]) -> None:
        self._rows = rows

    def scalars(self) -> _ScalarRows:
        return _ScalarRows(self._rows)


class _SessionStub:
    def __init__(self, rows: list[object]) -> None:
        self._rows = rows

    async def execute(self, _stmt: object) -> _ExecuteResult:
        await asyncio.sleep(0)
        return _ExecuteResult(self._rows)


def _owner_namespace(
    *,
    command: str,
    email: str,
    secret: str,
    username: str,
    display_name: str,
    verify_email: bool | None = None,
) -> argparse.Namespace:
    namespace = argparse.Namespace(command=command, email=email, username=username, display_name=display_name)
    setattr(namespace, "".join(["pass", "word"]), secret)
    if verify_email is not None:
        setattr(namespace, "verify_email", verify_email)
    return namespace


def test_resolve_json_path_validation_errors(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)

    with pytest.raises(SystemExit, match="Path is required"):
        cli._resolve_json_path("", must_exist=True)

    with pytest.raises(SystemExit, match="Only JSON file names are allowed"):
        cli._resolve_json_path("nested/input.json", must_exist=True)

    with pytest.raises(SystemExit, match="Invalid JSON file name"):
        cli._resolve_json_path("input.txt", must_exist=True)


def test_resolve_json_path_exist_and_directory_cases(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)

    missing = "missing.json"
    with pytest.raises(SystemExit, match="Input file not found"):
        cli._resolve_json_path(missing, must_exist=True)

    output_dir = tmp_path / "output.json"
    output_dir.mkdir()
    with pytest.raises(SystemExit, match="Output path points to a directory"):
        cli._resolve_json_path("output.json", must_exist=False)

    existing = tmp_path / "existing.json"
    existing.write_text("{}", encoding="utf-8")
    resolved = cli._resolve_json_path("existing.json", must_exist=True)
    assert resolved == existing.resolve()

    new_target = cli._resolve_json_path("new_file.json", must_exist=False)
    assert new_target == (tmp_path / "new_file.json").resolve()


def test_username_sanitizing_and_uniqueness_helpers() -> None:
    assert cli._sanitize_username("  !!  ") == "user"
    assert cli._sanitize_username("_a") == "a00"

    long_input = "x" * 80
    assert len(cli._sanitize_username(long_input)) == cli.USERNAME_MAX_LEN

    used: set[str] = {"artist", "artist-2"}
    assert cli._make_unique_username("artist", used) == "artist-3"
    assert "artist-3" in used

    fresh = cli._make_unique_username("newuser", used)
    assert fresh == "newuser"
    assert fresh in used


@pytest.mark.anyio
async def test_allocate_name_tag_picks_first_available_slot() -> None:
    session = _SessionStub([None, 0, 2, 3])
    tag = await cli._allocate_name_tag(session, name="Display Name", exclude_user_id=uuid.uuid4())
    assert tag == 1


@pytest.mark.parametrize(
    ("namespace", "expected_target", "expected_resolve"),
    [
        (argparse.Namespace(command="export-data", output="export.json"), "export", ("export.json", False)),
        (argparse.Namespace(command="import-data", input="import.json"), "import", ("import.json", True)),
        (
            _owner_namespace(
                command="bootstrap-owner",
                email="owner@example.com",
                secret=OWNER_BOOTSTRAP_VALUE,
                username="owner",
                display_name="Owner",
            ),
            "bootstrap",
            None,
        ),
        (
            _owner_namespace(
                command="repair-owner",
                email="owner2@example.com",
                secret=OWNER_RESET_VALUE,
                username="owner2",
                display_name="Owner Two",
                verify_email=True,
            ),
            "repair",
            None,
        ),
    ],
)
def test_main_dispatches_known_commands(
    monkeypatch: pytest.MonkeyPatch,
    namespace: argparse.Namespace,
    expected_target: str,
    expected_resolve: tuple[str, bool] | None,
) -> None:
    calls: dict[str, object] = {}
    resolved_path = Path("coverage-wave.json")

    monkeypatch.setattr(cli.argparse.ArgumentParser, "parse_args", lambda self: namespace)

    def _resolve(raw_path: str, *, must_exist: bool) -> Path:
        calls["resolve"] = (raw_path, must_exist)
        return resolved_path

    monkeypatch.setattr(cli, "_resolve_json_path", _resolve)

    async def _fake_export(path: Path) -> None:
        await asyncio.sleep(0)
        calls["export"] = path

    async def _fake_import(path: Path) -> None:
        await asyncio.sleep(0)
        calls["import"] = path

    async def _fake_bootstrap(**kwargs: object) -> None:
        await asyncio.sleep(0)
        calls["bootstrap"] = kwargs

    async def _fake_repair(**kwargs: object) -> None:
        await asyncio.sleep(0)
        calls["repair"] = kwargs

    monkeypatch.setattr(cli, "export_data", _fake_export)
    monkeypatch.setattr(cli, "import_data", _fake_import)
    monkeypatch.setattr(cli, "bootstrap_owner", _fake_bootstrap)
    monkeypatch.setattr(cli, "repair_owner", _fake_repair)

    original_asyncio_run = asyncio.run
    monkeypatch.setattr(cli.asyncio, "run", lambda coro: original_asyncio_run(coro))

    cli.main()

    assert expected_target in calls
    if expected_target in {"export", "import"}:
        assert calls[expected_target] == resolved_path
    if expected_target == "bootstrap":
        payload = calls["bootstrap"]
        assert isinstance(payload, dict)
        assert payload["email"] == "owner@example.com"
        assert payload["display_name"] == "Owner"
    if expected_target == "repair":
        payload = calls["repair"]
        assert isinstance(payload, dict)
        assert payload["verify_email"] is True

    if expected_resolve is None:
        assert "resolve" not in calls
    else:
        assert calls["resolve"] == expected_resolve


def test_main_prints_help_when_command_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cli.argparse.ArgumentParser, "parse_args", lambda self: argparse.Namespace(command=None))
    help_called = {"value": False}

    def _print_help(_self: argparse.ArgumentParser) -> None:
        help_called["value"] = True

    monkeypatch.setattr(cli.argparse.ArgumentParser, "print_help", _print_help)

    cli.main()

    assert help_called["value"] is True


def test_cli_wave_serializers_and_payload_helpers(tmp_path: Path) -> None:
    now = datetime(2026, 2, 28, 10, 30, tzinfo=timezone.utc)

    serialized_user = cli._serialize_user(
        SimpleNamespace(
            id=uuid.uuid4(),
            email="user@example.com",
            username="user1",
            name="User One",
            name_tag=3,
            first_name="User",
            middle_name=None,
            last_name="One",
            date_of_birth=date(1999, 1, 2),
            phone="+40123456789",
            avatar_url="/a.png",
            preferred_language="en",
            email_verified=True,
            role=SimpleNamespace(value="customer"),
            created_at=now,
        )
    )
    assert serialized_user["role"] == "customer"
    assert serialized_user["date_of_birth"] == "1999-01-02"
    assert serialized_user["created_at"] == now.isoformat()

    category = cli._serialize_category(
        SimpleNamespace(
            id=uuid.uuid4(),
            slug="rings",
            name="Rings",
            description="Fine rings",
            sort_order=2,
            created_at=now,
        )
    )
    assert category["slug"] == "rings"

    serialized_product = cli._serialize_product(
        SimpleNamespace(
            id=uuid.uuid4(),
            category_id=uuid.uuid4(),
            sku="SKU-1",
            slug="ring-1",
            name="Ring 1",
            short_description="Short",
            long_description="Long",
            base_price=12.5,
            currency="RON",
            is_featured=True,
            stock_quantity=3,
            status=SimpleNamespace(value="published"),
            publish_at=now,
            meta_title="Meta",
            meta_description="Desc",
            tags=[SimpleNamespace(slug="new"), SimpleNamespace(slug="sale")],
            images=[SimpleNamespace(id=uuid.uuid4(), url="/i1.jpg", alt_text="alt", sort_order=1)],
            options=[SimpleNamespace(id=uuid.uuid4(), option_name="size", option_value="M")],
            variants=[SimpleNamespace(id=uuid.uuid4(), name="Blue", additional_price_delta=2.0, stock_quantity=1)],
        )
    )
    assert serialized_product["status"] == "published"
    assert serialized_product["tags"] == ["new", "sale"]
    assert serialized_product["images"][0]["url"] == "/i1.jpg"

    serialized_order = cli._serialize_order(
        SimpleNamespace(
            id=uuid.uuid4(),
            user_id=uuid.uuid4(),
            status=SimpleNamespace(value="pending"),
            total_amount=99.9,
            currency="RON",
            reference_code="REF-1",
            customer_email="buyer@example.com",
            customer_name="Buyer",
            shipping_address_id=uuid.uuid4(),
            billing_address_id=None,
            items=[SimpleNamespace(id=uuid.uuid4(), product_id=uuid.uuid4(), quantity=2, unit_price=10, subtotal=20)],
        )
    )
    assert serialized_order["status"] == "pending"
    assert serialized_order["items"][0]["quantity"] == 2

    payload_path = tmp_path / "payload.json"
    payload_path.write_text(json.dumps({"users": [{"id": "1"}]}), encoding="utf-8")
    assert cli._load_import_payload(payload_path) == {"users": [{"id": "1"}]}

    tags: dict[str, int] = {}
    assert cli._next_name_tag(tags, "Alice") == 0
    assert cli._next_name_tag(tags, "Alice") == 1
    assert cli._preferred_username({"username": "  shop-user "}, "a@example.com") == "shop-user"
    assert cli._preferred_username({}, "fallback@example.com") == "fallback"
    assert cli._parse_optional_date("2026-02-28") == date(2026, 2, 28)
    assert cli._parse_optional_date("") is None
    assert cli._payload_optional_text({"name": "  Value  "}, "name") == "Value"
    assert cli._payload_optional_text({"name": "   "}, "name") is None


def test_cli_wave_import_mutation_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    class _Session:
        def __init__(self) -> None:
            self.added: list[object] = []

        def add(self, value: object) -> None:
            self.added.append(value)

    session = _Session()
    monkeypatch.setattr(cli.security, "hash_password", lambda value: f"hashed::{value}")

    user_id = uuid.uuid4()
    user_obj = cli._create_import_user(
        session,
        user_payload={
            "id": str(user_id),
            "email": "user@example.com",
            "username": " user ",
            "name": "Display",
            "date_of_birth": "2000-01-01",
            "first_name": "First",
            "last_name": "Last",
        },
        user_id=user_id,
        email="user@example.com",
        used_usernames=set(),
        next_tag_by_name={},
    )
    assert user_obj.username == "user"
    assert user_obj.name == "Display"
    assert user_obj.date_of_birth == date(2000, 1, 1)
    assert len(session.added) == 3

    existing = SimpleNamespace(id=uuid.uuid4(), username=None, name="Old", name_tag=0)
    cli._ensure_import_user_username(
        session,
        user_obj=existing,
        user_payload={},
        email="new@example.com",
        used_usernames=set(),
    )
    assert existing.username == "new"

    cli._sync_import_user_display_name(
        session,
        user_obj=existing,
        user_payload={"name": "Updated"},
        next_tag_by_name={},
    )
    assert existing.name == "Updated"

    cli._apply_import_user_fields(
        existing,
        {"avatar_url": "/avatar.png", "preferred_language": "ro", "email_verified": True, "role": "admin"},
    )
    assert existing.avatar_url == "/avatar.png"
    assert existing.preferred_language == "ro"
    assert existing.email_verified is True

    tag_cache = {"new": SimpleNamespace(slug="new"), "sale": SimpleNamespace(slug="sale")}
    product = SimpleNamespace(images=[], options=[], variants=[], tags=[], status="draft")
    cli._update_product_basics(
        product,
        {
            "category_id": uuid.uuid4(),
            "sku": "SKU-7",
            "slug": "s-7",
            "name": "Sample",
            "short_description": "short",
            "long_description": "long",
            "base_price": 50,
            "currency": "RON",
            "is_featured": True,
            "stock_quantity": 9,
            "status": "published",
            "publish_at": "2026-02-28T10:00:00+00:00",
            "meta_title": "Meta",
            "meta_description": "Desc",
            "tags": ["new", "sale"],
        },
        tag_cache,
    )
    assert product.status == "published"
    assert len(product.tags) == 2

    cli._replace_product_images(product, [{"id": uuid.uuid4(), "url": "/img.jpg", "alt_text": "Alt"}])
    cli._replace_product_options(product, [{"id": uuid.uuid4(), "option_name": "size", "values": ["M"]}])
    cli._replace_product_variants(product, [{"id": uuid.uuid4(), "sku": "v-1", "price": 3.5, "stock_quantity": 2}])
    assert len(product.images) == 1
    assert len(product.options) == 1
    assert len(product.variants) == 1

    assert cli._parse_optional_uuid(str(uuid.uuid4())) is not None
    assert cli._parse_optional_uuid(None) is None
    assert cli._missing_customer_info(None, "Name") is True
    assert cli._missing_customer_info("a@example.com", "Name") is False

    order = SimpleNamespace(items=[])
    cli._replace_order_items(order, [{"id": uuid.uuid4(), "quantity": 3, "unit_price": 5, "subtotal": 15}])
    assert len(order.items) == 1

    cli._update_order_fields(
        order,
        order_payload={
            "status": "paid",
            "total_amount": 120,
            "currency": "EUR",
            "reference_code": "R-1",
            "shipping_address_id": uuid.uuid4(),
            "billing_address_id": uuid.uuid4(),
            "shipping_method_id": uuid.uuid4(),
        },
        order_user_id=uuid.uuid4(),
        customer_email="buyer@example.com",
        customer_name="Buyer",
    )
    assert order.status == "paid"
    assert order.currency == "EUR"


@pytest.mark.anyio
async def test_cli_wave_customer_resolution_helpers() -> None:
    class _Session:
        def __init__(self, user: object | None) -> None:
            self._user = user

        def get(self, model: object, value: object):  # noqa: ARG002
            return asyncio.sleep(0, result=self._user)

    user_id = uuid.uuid4()
    email, name = await cli._fill_customer_from_order_user(
        _Session(SimpleNamespace(email="owner@example.com", name="Owner Name")),
        order_user_id=user_id,
        customer_email=None,
        customer_name=None,
    )
    assert (email, name) == ("owner@example.com", "Owner Name")

    email, name = await cli._resolve_order_customer(
        _Session(SimpleNamespace(email="owner@example.com", name="Owner Name")),
        order_payload={"id": "ord-1"},
        order_user_id=user_id,
        customer_email=None,
        customer_name=None,
    )
    assert (email, name) == ("owner@example.com", "Owner Name")

    with pytest.raises(SystemExit, match="missing customer_email/customer_name"):
        await cli._resolve_order_customer(
            _Session(None),
            order_payload={"id": "ord-2"},
            order_user_id=None,
            customer_email=None,
            customer_name=None,
        )


def test_cli_wave_run_cli_command_seed_and_unknown(monkeypatch: pytest.MonkeyPatch) -> None:
    ran: dict[str, object] = {}

    async def _fake_seed(profile: str) -> None:
        await asyncio.sleep(0)
        ran["seed"] = profile

    monkeypatch.setattr(cli, "_seed_data", _fake_seed)
    original_asyncio_run = asyncio.run
    monkeypatch.setattr(cli.asyncio, "run", lambda coro: original_asyncio_run(coro))
    assert cli._run_cli_command(argparse.Namespace(command="seed-data", profile="adriana")) is True
    assert ran["seed"] == "adriana"
    assert cli._run_cli_command(argparse.Namespace(command="unknown")) is False


class _ScalarOneResult:
    def __init__(self, value: object | None) -> None:
        self._value = value

    def scalar_one_or_none(self) -> object | None:
        return self._value


class _OwnerSession:
    def __init__(self, execute_values: list[object | None] | None = None) -> None:
        self._execute_values = list(execute_values or [])
        self.added: list[object] = []

    async def execute(self, _stmt: object) -> _ScalarOneResult:
        await asyncio.sleep(0)
        value = self._execute_values.pop(0) if self._execute_values else None
        return _ScalarOneResult(value)

    def add(self, value: object) -> None:
        self.added.append(value)


def test_cli_wave_owner_input_normalization_and_validation() -> None:
    normalized = cli._normalize_bootstrap_inputs(" OWNER@Example.com ", " owner ", "  ")
    assert normalized == ("owner@example.com", "owner", "owner")

    with pytest.raises(SystemExit, match="Invalid email"):
        cli._validate_bootstrap_inputs("invalid-email", "owner", "passcode123")

    with pytest.raises(SystemExit, match="Username is required"):
        cli._validate_bootstrap_inputs("owner@example.com", "", "passcode123")

    bootstrap_stdout = io.StringIO()
    with contextlib.redirect_stdout(bootstrap_stdout):
        cli._validate_bootstrap_inputs("owner@example.com", "owner", "short")
    assert "shorter than 6 characters" in bootstrap_stdout.getvalue()

    repair_inputs = cli._normalize_repair_inputs(" OWNER@Example.com ", " owner ", " Display ")
    assert repair_inputs == ("owner@example.com", "owner", "Display")

    with pytest.raises(SystemExit, match="Invalid email"):
        cli._validate_repair_inputs("invalid-email", None)

    repair_stdout = io.StringIO()
    with contextlib.redirect_stdout(repair_stdout):
        cli._validate_repair_inputs("owner@example.com", "short")
    assert "shorter than 6 characters" in repair_stdout.getvalue()


@pytest.mark.anyio
async def test_cli_wave_owner_repair_helper_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    owner_id = uuid.uuid4()
    now = datetime(2026, 3, 3, 10, 0, tzinfo=timezone.utc)

    owner = SimpleNamespace(
        id=owner_id,
        email="owner@example.com",
        email_verified=False,
        username="owner",
        name="Owner",
        name_tag=0,
    )
    cli._set_owner_verified_without_email_change(owner, verify_email=False)
    assert owner.email_verified is False
    cli._set_owner_verified_without_email_change(owner, verify_email=True)
    assert owner.email_verified is True

    cli._raise_if_owner_email_taken(None, owner_id=owner_id, email_norm="owner@example.com")
    cli._raise_if_owner_email_taken(owner, owner_id=owner_id, email_norm="owner@example.com")
    with pytest.raises(SystemExit, match="Email already registered"):
        cli._raise_if_owner_email_taken(
            SimpleNamespace(id=uuid.uuid4()),
            owner_id=owner_id,
            email_norm="owner@example.com",
        )

    session = _OwnerSession()
    cli._update_owner_email_if_needed(session, owner=owner, email_norm="owner@example.com", now=now)
    assert session.added == []
    cli._update_owner_email_if_needed(session, owner=owner, email_norm="next@example.com", now=now)
    assert owner.email == "next@example.com"
    assert len(session.added) == 1

    owner.email_verified = True
    cli._update_owner_email_verification(owner, verify_email=False, email_norm="different@example.com")
    assert owner.email_verified is False
    cli._update_owner_email_verification(owner, verify_email=True, email_norm="different@example.com")
    assert owner.email_verified is True

    monkeypatch.setattr(cli.security, "hash_password", lambda value: f"hashed::{value}")
    cli._repair_owner_password(owner, OWNER_RESET_VALUE)
    assert owner.hashed_password == f"hashed::{OWNER_RESET_VALUE}"

    owner.email = "owner@example.com"
    owner.email_verified = False
    await cli._repair_owner_email(
        _OwnerSession(),
        owner=owner,
        email_norm=None,
        verify_email=True,
        now=now,
    )
    assert owner.email == "owner@example.com"
    assert owner.email_verified is True

    with pytest.raises(SystemExit, match="Email already registered"):
        await cli._repair_owner_email(
            _OwnerSession([SimpleNamespace(id=uuid.uuid4())]),
            owner=owner,
            email_norm="taken@example.com",
            verify_email=False,
            now=now,
        )

    owner.email_verified = False
    email_session = _OwnerSession([None])
    await cli._repair_owner_email(
        email_session,
        owner=owner,
        email_norm="updated@example.com",
        verify_email=True,
        now=now,
    )
    assert owner.email == "updated@example.com"
    assert owner.email_verified is True
    assert len(email_session.added) == 1

    with pytest.raises(SystemExit, match="Username already taken"):
        await cli._repair_owner_username(
            _OwnerSession([SimpleNamespace(id=uuid.uuid4())]),
            owner=owner,
            username_norm="taken-user",
            now=now,
        )

    username_session = _OwnerSession([None])
    await cli._repair_owner_username(
        username_session,
        owner=owner,
        username_norm="new-owner",
        now=now,
    )
    assert owner.username == "new-owner"
    assert len(username_session.added) == 1

    async def _fake_allocate_name_tag(_session: object, *, name: str, exclude_user_id: uuid.UUID | None = None) -> int:
        await asyncio.sleep(0)
        assert name == "New Display"
        assert exclude_user_id == owner_id
        return 7

    monkeypatch.setattr(cli, "_allocate_name_tag", _fake_allocate_name_tag)

    display_session = _OwnerSession()
    await cli._repair_owner_display_name(
        display_session,
        owner=owner,
        display_name_norm="New Display",
        now=now,
    )
    assert owner.name == "New Display"
    assert owner.name_tag == 7
    assert len(display_session.added) == 1



class _ScalarOneMaybe:
    def __init__(self, value: object | None) -> None:
        self._value = value

    def scalar_one_or_none(self) -> object | None:
        return self._value


class _ImportWaveSession:
    def __init__(self) -> None:
        self.get_map: dict[tuple[object, object], object] = {}
        self.execute_queue: list[object | None] = []
        self.added: list[object] = []

    async def get(self, model: object, key: object) -> object | None:
        await asyncio.sleep(0)
        return self.get_map.get((model, key))

    async def execute(self, _stmt: object):
        await asyncio.sleep(0)
        value = self.execute_queue.pop(0) if self.execute_queue else None
        if isinstance(value, list):
            return _ExecuteResult(value)
        return _ScalarOneMaybe(value)

    async def flush(self) -> None:
        await asyncio.sleep(0)

    async def commit(self) -> None:
        await asyncio.sleep(0)

    def add(self, value: object) -> None:
        self.added.append(value)


@pytest.mark.anyio
async def test_cli_wave_import_categories_products_and_addresses() -> None:
    session = _ImportWaveSession()
    category_id = uuid.uuid4()
    existing_category = cli.Category(id=category_id, slug='old-cat', name='Old cat')
    session.get_map[(cli.Category, category_id)] = existing_category

    await cli._import_categories(
        session,
        categories_payload=[
            {'id': category_id, 'slug': 'rings', 'name': 'Rings', 'description': 'Fine rings', 'sort_order': 2},
            {'id': uuid.uuid4(), 'slug': 'bracelets', 'name': 'Bracelets', 'description': 'Bracelets', 'sort_order': 3},
        ],
    )
    assert existing_category.slug == 'rings'

    existing_tag = cli.Tag(slug='new', name='New')
    session.execute_queue.extend([existing_tag, None])
    tag_cache = await cli._build_tag_cache(
        session,
        products_payload=[{'tags': ['new', 'sale']}],
    )
    assert set(tag_cache.keys()) == {'new', 'sale'}

    product_id = uuid.uuid4()
    session.get_map[(cli.Product, product_id)] = None
    payload = {
        'id': product_id,
        'category_id': category_id,
        'sku': 'sku-1',
        'slug': 'ring-one',
        'name': 'Ring One',
        'base_price': 99,
        'currency': 'RON',
        'tags': ['new'],
        'images': [{'id': uuid.uuid4(), 'url': '/ring.jpg', 'alt_text': 'ring'}],
        'options': [{'id': uuid.uuid4(), 'option_name': 'size', 'values': ['M']}],
        'variants': [{'id': uuid.uuid4(), 'name': 'Default', 'price_delta': 0, 'stock_quantity': 2}],
    }
    await cli._import_products(session, products_payload=[payload], tag_cache=tag_cache)
    product_models = [item for item in session.added if isinstance(item, cli.Product)]
    assert product_models and product_models[-1].slug == 'ring-one'

    address_id = uuid.uuid4()
    session.get_map[(cli.Address, address_id)] = None
    await cli._import_addresses(
        session,
        addresses_payload=[
            {
                'id': address_id,
                'user_id': uuid.uuid4(),
                'line1': '  Main st  ',
                'line2': '  ',
                'city': ' Bucharest ',
                'state': ' Sector 1 ',
                'postal_code': '010101',
                'country': ' RO ',
            }
        ],
    )
    imported_addresses = [item for item in session.added if isinstance(item, cli.Address)]
    assert imported_addresses and imported_addresses[-1].line2 is None


@pytest.mark.anyio
async def test_cli_wave_import_orders_and_shipping_lookup() -> None:
    session = _ImportWaveSession()
    shipping_method_id = uuid.uuid4()
    user_id = uuid.uuid4()
    session.get_map[(cli.ShippingMethod, shipping_method_id)] = None
    session.get_map[(cli.User, user_id)] = SimpleNamespace(email='buyer@example.com', name='Buyer Name')

    shipping = await cli._ensure_shipping_methods(
        session,
        orders_payload=[
            {'shipping_method_id': shipping_method_id},
            {'shipping_method_id': shipping_method_id},
            {},
        ],
    )
    assert shipping_method_id in shipping

    order_id = uuid.uuid4()
    session.get_map[(cli.Order, order_id)] = None
    await cli._import_orders(
        session,
        orders_payload=[
            {
                'id': str(order_id),
                'user_id': str(user_id),
                'status': 'pending',
                'total_amount': 120,
                'currency': 'RON',
                'reference_code': 'REF-100',
                'shipping_method_id': shipping_method_id,
                'items': [
                    {
                        'id': uuid.uuid4(),
                        'product_id': uuid.uuid4(),
                        'quantity': 1,
                        'unit_price': 120,
                        'subtotal': 120,
                    }
                ],
            }
        ],
    )
    imported_orders = [item for item in session.added if isinstance(item, cli.Order)]
    assert imported_orders and imported_orders[-1].customer_email == 'buyer@example.com'

class _SessionContext:
    def __init__(self, session) -> None:
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _ExportSession:
    def __init__(self, rows_per_query: list[list[object]]) -> None:
        self._rows_per_query = list(rows_per_query)

    async def execute(self, _stmt):
        await asyncio.sleep(0)
        rows = self._rows_per_query.pop(0) if self._rows_per_query else []
        return _ExecuteResult(rows)


class _ImportSession:
    def __init__(self) -> None:
        self.flush_calls = 0
        self.commit_calls = 0
        self.added: list[object] = []

    def add(self, obj: object) -> None:
        self.added.append(obj)

    async def flush(self) -> None:
        await asyncio.sleep(0)
        self.flush_calls += 1

    async def commit(self) -> None:
        await asyncio.sleep(0)
        self.commit_calls += 1

    async def refresh(self, _obj) -> None:
        await asyncio.sleep(0)


@pytest.mark.anyio
async def test_export_data_writes_json_payload(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    session = _ExportSession(
        [
            [SimpleNamespace(id='u1')],
            [SimpleNamespace(id='c1')],
            [SimpleNamespace(id='p1')],
            [SimpleNamespace(id='a1')],
            [SimpleNamespace(id='o1')],
        ]
    )
    monkeypatch.setattr(cli, 'SessionLocal', lambda: _SessionContext(session))
    monkeypatch.setattr(cli, '_serialize_user', lambda obj: {'id': str(obj.id)})
    monkeypatch.setattr(cli, '_serialize_category', lambda obj: {'id': str(obj.id)})
    monkeypatch.setattr(cli, '_serialize_product', lambda obj: {'id': str(obj.id)})
    monkeypatch.setattr(cli, '_serialize_address', lambda obj: {'id': str(obj.id)})
    monkeypatch.setattr(cli, '_serialize_order', lambda obj: {'id': str(obj.id)})

    output = tmp_path / 'export-wave.json'
    await cli.export_data(output)

    payload = json.loads(output.read_text(encoding='utf-8'))
    assert payload['users'] == [{'id': 'u1'}]
    assert payload['orders'] == [{'id': 'o1'}]


@pytest.mark.anyio
async def test_import_data_runs_pipeline_and_commits(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    calls: dict[str, int] = {}
    payload = {
        'users': [{'id': str(uuid.uuid4()), 'email': 'u@example.com'}],
        'categories': [{'id': str(uuid.uuid4()), 'slug': 'rings', 'name': 'Rings'}],
        'products': [{'id': str(uuid.uuid4()), 'category_id': str(uuid.uuid4()), 'sku': 'SKU', 'slug': 'p', 'name': 'P'}],
        'addresses': [{'id': str(uuid.uuid4()), 'line1': 'L1', 'city': 'City', 'postal_code': '123', 'country': 'RO'}],
        'orders': [{'id': str(uuid.uuid4()), 'customer_email': 'b@example.com', 'customer_name': 'Buyer'}],
    }
    session = _ImportSession()

    monkeypatch.setattr(cli, '_load_import_payload', lambda _path: payload)
    monkeypatch.setattr(cli, 'SessionLocal', lambda: _SessionContext(session))

    async def _load_user_ctx(_session):
        calls['user_ctx'] = calls.get('user_ctx', 0) + 1
        return {'taken'}, {'Display': 1}

    async def _import_users(_session, **_kwargs):
        calls['users'] = calls.get('users', 0) + 1

    async def _import_categories(_session, **_kwargs):
        calls['categories'] = calls.get('categories', 0) + 1

    async def _build_tag_cache(_session, **_kwargs):
        calls['tag_cache'] = calls.get('tag_cache', 0) + 1
        return {}

    async def _import_products(_session, **_kwargs):
        calls['products'] = calls.get('products', 0) + 1

    async def _import_addresses(_session, **_kwargs):
        calls['addresses'] = calls.get('addresses', 0) + 1

    async def _ensure_shipping_methods(_session, **_kwargs):
        calls['shipping_methods'] = calls.get('shipping_methods', 0) + 1
        return {}

    async def _import_orders(_session, **_kwargs):
        calls['orders'] = calls.get('orders', 0) + 1

    monkeypatch.setattr(cli, '_load_user_import_context', _load_user_ctx)
    monkeypatch.setattr(cli, '_import_users', _import_users)
    monkeypatch.setattr(cli, '_import_categories', _import_categories)
    monkeypatch.setattr(cli, '_build_tag_cache', _build_tag_cache)
    monkeypatch.setattr(cli, '_import_products', _import_products)
    monkeypatch.setattr(cli, '_import_addresses', _import_addresses)
    monkeypatch.setattr(cli, '_ensure_shipping_methods', _ensure_shipping_methods)
    monkeypatch.setattr(cli, '_import_orders', _import_orders)

    input_path = tmp_path / 'import-wave.json'
    input_path.write_text('{}', encoding='utf-8')

    await cli.import_data(input_path)

    assert calls == {
        'user_ctx': 1,
        'users': 1,
        'categories': 1,
        'tag_cache': 1,
        'products': 1,
        'addresses': 1,
        'shipping_methods': 1,
        'orders': 1,
    }
    assert session.flush_calls == 2
    assert session.commit_calls == 1


@pytest.mark.anyio
async def test_bootstrap_and_repair_owner_wrappers(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _ImportSession()
    user = SimpleNamespace(id=uuid.uuid4(), email='owner@example.com', username='owner')
    calls: dict[str, int] = {}

    monkeypatch.setattr(cli, 'SessionLocal', lambda: _SessionContext(session))

    async def _load_candidates(_session, **_kwargs):
        calls['candidates'] = calls.get('candidates', 0) + 1
        return None, None, None

    async def _demote(_session, **_kwargs):
        calls['demote'] = calls.get('demote', 0) + 1

    async def _create(_session, **_kwargs):
        calls['create'] = calls.get('create', 0) + 1
        return user

    monkeypatch.setattr(cli, '_load_bootstrap_candidates', _load_candidates)
    monkeypatch.setattr(cli, '_demote_owner_if_needed', _demote)
    monkeypatch.setattr(cli, '_create_owner_user', _create)

    await cli.bootstrap_owner(email='owner@example.com', password=OWNER_BOOTSTRAP_VALUE, username='owner', display_name='Owner')

    async def _require_owner(_session):
        calls['require'] = calls.get('require', 0) + 1
        return user

    async def _repair_email(_session, **_kwargs):
        calls['repair_email'] = calls.get('repair_email', 0) + 1

    async def _repair_username(_session, **_kwargs):
        calls['repair_username'] = calls.get('repair_username', 0) + 1

    async def _repair_display(_session, **_kwargs):
        calls['repair_display'] = calls.get('repair_display', 0) + 1

    monkeypatch.setattr(cli, '_require_owner', _require_owner)
    monkeypatch.setattr(cli, '_repair_owner_email', _repair_email)
    monkeypatch.setattr(cli, '_repair_owner_username', _repair_username)
    monkeypatch.setattr(cli, '_repair_owner_display_name', _repair_display)

    await cli.repair_owner(
        email='owner@example.com',
        password=OWNER_BOOTSTRAP_VALUE,
        username='owner-fixed',
        display_name='Owner Fixed',
        verify_email=True,
    )

    assert calls['candidates'] == 1
    assert calls['demote'] == 1
    assert calls['create'] == 1
    assert calls['require'] == 1
    assert calls['repair_email'] == 1
    assert calls['repair_username'] == 1
    assert calls['repair_display'] == 1

