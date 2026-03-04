from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app import cli


def test_json_filename_and_path_guards(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    assert cli._normalize_json_filename('snapshot.json') == 'snapshot.json'

    with pytest.raises(SystemExit):
        cli._normalize_json_filename('')
    with pytest.raises(SystemExit):
        cli._normalize_json_filename('../bad.json')
    with pytest.raises(SystemExit):
        cli._normalize_json_filename('bad.txt')

    file_path = tmp_path / 'ok.json'
    file_path.write_text('{}', encoding='utf-8')
    cli._validate_resolved_json_path(file_path, must_exist=True)

    with pytest.raises(SystemExit):
        cli._validate_resolved_json_path(tmp_path / 'missing.json', must_exist=True)

    dir_path = tmp_path / 'dir-out'
    dir_path.mkdir()
    with pytest.raises(SystemExit):
        cli._validate_resolved_json_path(dir_path, must_exist=False)

    monkeypatch.chdir(tmp_path)
    resolved = cli._resolve_json_path('export.json', must_exist=False)
    assert resolved == (tmp_path / 'export.json').resolve()


def test_username_and_bootstrap_normalizers() -> None:
    assert cli._sanitize_username(' User Name ') == 'User-Name'
    assert cli._sanitize_username('___') == 'user'
    assert cli._sanitize_username('a') == 'a00'

    used: set[str] = {'owner'}
    assert cli._make_unique_username('owner', used).startswith('owner-')
    assert cli._make_unique_username('new', used) == 'new'

    email_norm, username_norm, display_name_norm = cli._normalize_bootstrap_inputs(
        ' USER@example.com ',
        ' owner ',
        '',
    )
    assert email_norm == 'user@example.com'
    assert username_norm == 'owner'
    assert display_name_norm == 'owner'

    with pytest.raises(SystemExit):
        cli._validate_bootstrap_inputs('', 'owner', 'long-enough')
    with pytest.raises(SystemExit):
        cli._validate_bootstrap_inputs('owner@example.com', '', 'long-enough')

    cli._validate_bootstrap_inputs('owner@example.com', 'owner', '123')


def test_repair_normalizers_and_owner_email_helpers() -> None:
    email_norm, username_norm, display_name_norm = cli._normalize_repair_inputs(
        ' Owner@Example.com ',
        ' owner ',
        ' Owner Name ',
    )
    assert email_norm == 'owner@example.com'
    assert username_norm == 'owner'
    assert display_name_norm == 'Owner Name'

    with pytest.raises(SystemExit):
        cli._validate_repair_inputs('bad-email', None)

    cli._validate_repair_inputs('owner@example.com', '123')

    owner = SimpleNamespace(email=' Owner@Example.com ', email_verified=False)
    assert cli._owner_email_lower(owner) == 'owner@example.com'

    cli._set_owner_verified_without_email_change(owner, verify_email=True)
    assert owner.email_verified is True

    owner.email_verified = True
    cli._update_owner_email_verification(owner, verify_email=False, email_norm='other@example.com')
    assert owner.email_verified is False


def test_import_payload_and_simple_value_helpers(tmp_path: Path) -> None:
    payload_file = tmp_path / 'import.json'
    payload_file.write_text('{"users": []}', encoding='utf-8')
    assert cli._load_import_payload(payload_file) == {'users': []}

    next_tag_by_name: dict[str, int] = {}
    assert cli._next_name_tag(next_tag_by_name, 'Owner') == 0
    assert cli._next_name_tag(next_tag_by_name, 'Owner') == 1

    assert cli._preferred_username({'username': 'custom'}, 'owner@example.com') == 'custom'
    assert cli._preferred_username({}, 'owner@example.com') == 'owner'

    assert cli._parse_optional_date('2026-03-01') == date(2026, 3, 1)
    assert cli._parse_optional_date(None) is None

    assert cli._payload_optional_text({'name': '  Value  '}, 'name') == 'Value'
    assert cli._payload_optional_text({'name': '   '}, 'name') is None

    uid = uuid4()
    assert cli._parse_optional_uuid(str(uid)) == uid
    assert cli._parse_optional_uuid(None) is None

    assert cli._missing_customer_info(None, 'Jane') is True
    assert cli._missing_customer_info('owner@example.com', 'Jane') is False


def test_serialize_helpers_for_core_entities() -> None:
    user = SimpleNamespace(
        id=uuid4(),
        email='owner@example.com',
        username='owner',
        name='Owner Name',
        name_tag=0,
        first_name='Owner',
        middle_name=None,
        last_name='Name',
        date_of_birth=None,
        phone='+40700000000',
        avatar_url=None,
        preferred_language='en',
        email_verified=True,
        role=SimpleNamespace(value='owner'),
        created_at=datetime(2026, 3, 1, tzinfo=timezone.utc),
    )
    user_row = cli._serialize_user(user)
    assert user_row['email'] == 'owner@example.com'
    assert user_row['role'] == 'owner'

    category = SimpleNamespace(
        id=uuid4(),
        slug='rings',
        name='Rings',
        description='Category',
        sort_order=1,
        created_at=datetime(2026, 3, 1, tzinfo=timezone.utc),
    )
    category_row = cli._serialize_category(category)
    assert category_row['slug'] == 'rings'

    image = SimpleNamespace(id=uuid4(), url='https://cdn.test/image.jpg', alt_text='alt', sort_order=0)
    option = SimpleNamespace(id=uuid4(), option_name='Size', option_value='M')
    variant = SimpleNamespace(id=uuid4(), name='M', additional_price_delta=Decimal('2.00'), stock_quantity=3)
    product = SimpleNamespace(
        id=uuid4(),
        category_id=uuid4(),
        sku='SKU-1',
        slug='ring',
        name='Ring',
        short_description='Short',
        long_description='Long',
        base_price=Decimal('10.00'),
        currency='RON',
        is_featured=True,
        stock_quantity=4,
        status=SimpleNamespace(value='published'),
        publish_at=None,
        meta_title='Meta',
        meta_description='Meta desc',
        tags=[SimpleNamespace(slug='featured')],
        images=[image],
        options=[option],
        variants=[variant],
    )

    product_row = cli._serialize_product(product)
    assert product_row['sku'] == 'SKU-1'
    assert product_row['tags'] == ['featured']
    assert product_row['images'][0]['url'].startswith('https://')

    address = SimpleNamespace(
        id=uuid4(),
        user_id=uuid4(),
        line1='Street 1',
        line2='Apt 2',
        city='Bucharest',
        region='B',
        postal_code='010101',
        country='RO',
    )
    address_row = cli._serialize_address(address)
    assert address_row['city'] == 'Bucharest'

    item = SimpleNamespace(id=uuid4(), product_id=uuid4(), quantity=2, unit_price=Decimal('9.00'), subtotal=Decimal('18.00'))
    order = SimpleNamespace(
        id=uuid4(),
        user_id=uuid4(),
        status=SimpleNamespace(value='paid'),
        total_amount=Decimal('18.00'),
        currency='RON',
        reference_code='REF-1',
        customer_email='owner@example.com',
        customer_name='Owner',
        shipping_address_id=uuid4(),
        billing_address_id=uuid4(),
        items=[item],
    )

    order_row = cli._serialize_order(order)
    assert order_row['reference_code'] == 'REF-1'
    assert order_row['items'][0]['quantity'] == 2


def test_import_user_helper_paths() -> None:
    class DummySession:
        def __init__(self) -> None:
            self.added: list[object] = []

        def add(self, value: object) -> None:
            self.added.append(value)

    session = DummySession()
    user_id = uuid4()
    used_usernames: set[str] = set()
    next_tags: dict[str, int] = {}

    payload = {
        'email': 'owner@example.com',
        'username': 'owner',
        'name': 'Owner Name',
        'avatar_url': 'https://cdn.test/avatar.png',
        'preferred_language': 'en',
        'email_verified': True,
        'role': 'admin',
    }

    user_obj = cli._create_import_user(
        session,
        user_payload=payload,
        user_id=user_id,
        email='owner@example.com',
        used_usernames=used_usernames,
        next_tag_by_name=next_tags,
    )
    assert user_obj.username.startswith('owner')

    user_obj.username = None
    cli._ensure_import_user_username(
        session,
        user_obj=user_obj,
        user_payload=payload,
        email='owner@example.com',
        used_usernames=used_usernames,
    )
    assert user_obj.username is not None

    payload_update = {**payload, 'name': 'Updated Name'}
    cli._sync_import_user_display_name(
        session,
        user_obj=user_obj,
        user_payload=payload_update,
        next_tag_by_name=next_tags,
    )
    assert user_obj.name == 'Updated Name'

    cli._apply_import_user_fields(user_obj, payload)
    assert user_obj.email_verified is True
