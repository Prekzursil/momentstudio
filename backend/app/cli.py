import argparse
import asyncio
import json
import re
import uuid
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Dict

from sqlalchemy import func, select

from app.db.session import SessionLocal
from app.core import security
from app import seeds as app_seeds
from app.models.user import User, UserDisplayNameHistory, UserEmailHistory, UserRole, UserUsernameHistory
from app.models.address import Address
from app.models.catalog import Category, Product, ProductImage, ProductOption, ProductVariant, Tag
from app.models.order import Order, OrderItem, ShippingMethod


USERNAME_MAX_LEN = 30
USERNAME_MIN_LEN = 3
USERNAME_ALLOWED_RE = re.compile(r"[^A-Za-z0-9._-]+")
SAFE_JSON_FILENAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*\.json$")


def _normalize_json_filename(raw_path: str) -> str:
    raw = (raw_path or "").strip()
    if not raw:
        raise SystemExit("Path is required")
    if Path(raw).name != raw:
        raise SystemExit("Only JSON file names are allowed (no directories)")
    if not SAFE_JSON_FILENAME_RE.fullmatch(raw):
        raise SystemExit("Invalid JSON file name")
    return raw


def _validate_resolved_json_path(path: Path, *, must_exist: bool) -> None:
    if must_exist and not path.is_file():
        raise SystemExit(f"Input file not found: {path}")
    if not must_exist and path.exists() and path.is_dir():
        raise SystemExit(f"Output path points to a directory: {path}")


def _resolve_json_path(raw_path: str, *, must_exist: bool) -> Path:
    raw = _normalize_json_filename(raw_path)
    resolved = (Path.cwd().resolve() / raw).resolve(strict=False)
    _validate_resolved_json_path(resolved, must_exist=must_exist)
    return resolved


def _sanitize_username(raw: str) -> str:
    candidate = USERNAME_ALLOWED_RE.sub("-", (raw or "").strip())
    candidate = candidate.strip("._-")
    if not candidate:
        candidate = "user"
    if not candidate[0].isalnum():
        candidate = f"u{candidate}"
    candidate = candidate[:USERNAME_MAX_LEN]
    while len(candidate) < USERNAME_MIN_LEN:
        candidate = f"{candidate}0"
        candidate = candidate[:USERNAME_MAX_LEN]
    return candidate


def _make_unique_username(base: str, used: set[str]) -> str:
    base = base[:USERNAME_MAX_LEN]
    if base not in used:
        used.add(base)
        return base
    suffix_num = 2
    while True:
        suffix = f"-{suffix_num}"
        trimmed = base[: USERNAME_MAX_LEN - len(suffix)]
        candidate = f"{trimmed}{suffix}"
        if candidate not in used:
            used.add(candidate)
            return candidate
        suffix_num += 1


async def _allocate_name_tag(session, *, name: str, exclude_user_id: uuid.UUID | None = None) -> int:
    stmt = select(User.name_tag).where(User.name == name)
    if exclude_user_id:
        stmt = stmt.where(User.id != exclude_user_id)
    used = {int(x) for x in (await session.execute(stmt)).scalars().all() if x is not None}
    tag = 0
    while tag in used:
        tag += 1
    return tag


def _normalize_bootstrap_inputs(email: str, username: str, display_name: str) -> tuple[str, str, str]:
    email_norm = (email or "").strip().lower()
    username_norm = (username or "").strip()
    display_name_norm = (display_name or "").strip() or username_norm
    return email_norm, username_norm, display_name_norm


def _validate_bootstrap_inputs(email_norm: str, username_norm: str, password: str) -> None:
    if not email_norm or "@" not in email_norm:
        raise SystemExit("Invalid email")
    if not username_norm:
        raise SystemExit("Username is required")
    if len(password) < 6:
        print("WARNING: creating owner with a password shorter than 6 characters; change it immediately.")


async def _load_bootstrap_candidates(session, *, email_norm: str, username_norm: str) -> tuple[User | None, User | None, User | None]:
    existing_owner = (await session.execute(select(User).where(User.role == UserRole.owner))).scalar_one_or_none()
    existing_email_user = (
        await session.execute(select(User).where(func.lower(User.email) == email_norm))
    ).scalar_one_or_none()
    existing_username_user = (
        await session.execute(select(User).where(User.username == username_norm))
    ).scalar_one_or_none()
    return existing_owner, existing_email_user, existing_username_user


async def _demote_owner_if_needed(session, *, existing_owner: User | None, existing_email_user: User | None) -> None:
    if existing_owner and (not existing_email_user or existing_owner.id != existing_email_user.id):
        existing_owner.role = UserRole.admin
        session.add(existing_owner)
        await session.flush()


async def _create_owner_user(
    session,
    *,
    email_norm: str,
    username_norm: str,
    display_name_norm: str,
    password: str,
    now: datetime,
) -> User:
    name_tag = await _allocate_name_tag(session, name=display_name_norm)
    user = User(
        email=email_norm,
        username=username_norm,
        hashed_password=security.hash_password(password),
        name=display_name_norm,
        name_tag=name_tag,
        email_verified=True,
        role=UserRole.owner,
    )
    session.add(user)
    await session.flush()
    session.add(UserUsernameHistory(user_id=user.id, username=username_norm, created_at=now))
    session.add(UserDisplayNameHistory(user_id=user.id, name=display_name_norm, name_tag=name_tag, created_at=now))
    session.add(UserEmailHistory(user_id=user.id, email=email_norm, created_at=now))
    return user


async def _update_owner_user(
    session,
    *,
    user: User,
    existing_username_user: User | None,
    username_norm: str,
    display_name_norm: str,
    password: str,
    now: datetime,
) -> None:
    if existing_username_user and existing_username_user.id != user.id:
        raise SystemExit(f"Username already taken: {username_norm}")

    if user.username != username_norm:
        user.username = username_norm
        session.add(UserUsernameHistory(user_id=user.id, username=username_norm, created_at=now))

    if (user.name or "") != display_name_norm:
        tag = await _allocate_name_tag(session, name=display_name_norm, exclude_user_id=user.id)
        user.name = display_name_norm
        user.name_tag = tag
        session.add(UserDisplayNameHistory(user_id=user.id, name=display_name_norm, name_tag=tag, created_at=now))

    user.hashed_password = security.hash_password(password)
    user.email_verified = True
    user.role = UserRole.owner
    session.add(user)


async def bootstrap_owner(*, email: str, password: str, username: str, display_name: str) -> None:
    email_norm, username_norm, display_name_norm = _normalize_bootstrap_inputs(email, username, display_name)
    _validate_bootstrap_inputs(email_norm, username_norm, password)

    async with SessionLocal() as session:
        existing_owner, existing_email_user, existing_username_user = await _load_bootstrap_candidates(
            session,
            email_norm=email_norm,
            username_norm=username_norm,
        )
        await _demote_owner_if_needed(
            session,
            existing_owner=existing_owner,
            existing_email_user=existing_email_user,
        )

        now = datetime.now(timezone.utc)
        if not existing_email_user:
            if existing_username_user:
                raise SystemExit(f"Username already taken: {username_norm}")
            user = await _create_owner_user(
                session,
                email_norm=email_norm,
                username_norm=username_norm,
                display_name_norm=display_name_norm,
                password=password,
                now=now,
            )
            await session.commit()
            await session.refresh(user)
            print(f"Owner created: {user.email} ({user.username}) id={user.id}")
            return

        user = existing_email_user
        await _update_owner_user(
            session,
            user=user,
            existing_username_user=existing_username_user,
            username_norm=username_norm,
            display_name_norm=display_name_norm,
            password=password,
            now=now,
        )
        await session.commit()
        await session.refresh(user)
        print(f"Owner set: {user.email} ({user.username}) id={user.id}")


def _normalize_repair_inputs(
    email: str | None,
    username: str | None,
    display_name: str | None,
) -> tuple[str | None, str | None, str | None]:
    email_norm = (email or "").strip().lower() or None
    username_norm = (username or "").strip() or None
    display_name_norm = (display_name or "").strip() or None
    return email_norm, username_norm, display_name_norm


def _validate_repair_inputs(email_norm: str | None, password: str | None) -> None:
    if email_norm and "@" not in email_norm:
        raise SystemExit("Invalid email")
    if password is not None and len(password) < 6:
        print("WARNING: setting owner password shorter than 6 characters; change it immediately.")


async def _require_owner(session) -> User:
    owner = (await session.execute(select(User).where(User.role == UserRole.owner))).scalar_one_or_none()
    if not owner:
        raise SystemExit("No owner account found. Run bootstrap-owner first.")
    return owner


async def _repair_owner_email(
    session,
    *,
    owner: User,
    email_norm: str | None,
    verify_email: bool,
    now: datetime,
) -> None:
    if not email_norm:
        _set_owner_verified_without_email_change(owner, verify_email)
        return

    existing_email_user = (
        await session.execute(select(User).where(func.lower(User.email) == email_norm))
    ).scalar_one_or_none()
    _raise_if_owner_email_taken(existing_email_user, owner_id=owner.id, email_norm=email_norm)
    _update_owner_email_if_needed(session, owner=owner, email_norm=email_norm, now=now)
    _update_owner_email_verification(owner, verify_email=verify_email, email_norm=email_norm)


def _set_owner_verified_without_email_change(owner: User, verify_email: bool) -> None:
    if verify_email:
        owner.email_verified = True


def _raise_if_owner_email_taken(existing_email_user: User | None, *, owner_id: uuid.UUID, email_norm: str) -> None:
    if not existing_email_user:
        return
    if existing_email_user.id != owner_id:
        raise SystemExit(f"Email already registered: {email_norm}")


def _owner_email_lower(owner: User) -> str:
    return (owner.email or "").strip().lower()


def _update_owner_email_if_needed(session, *, owner: User, email_norm: str, now: datetime) -> None:
    if _owner_email_lower(owner) == email_norm:
        return
    owner.email = email_norm
    session.add(UserEmailHistory(user_id=owner.id, email=email_norm, created_at=now))


def _update_owner_email_verification(owner: User, *, verify_email: bool, email_norm: str) -> None:
    if verify_email:
        owner.email_verified = True
        return
    owner.email_verified = owner.email_verified and _owner_email_lower(owner) == email_norm


async def _repair_owner_username(
    session,
    *,
    owner: User,
    username_norm: str | None,
    now: datetime,
) -> None:
    if not username_norm:
        return
    existing_username_user = (
        await session.execute(select(User).where(User.username == username_norm))
    ).scalar_one_or_none()
    if existing_username_user and existing_username_user.id != owner.id:
        raise SystemExit(f"Username already taken: {username_norm}")
    if owner.username != username_norm:
        owner.username = username_norm
        session.add(UserUsernameHistory(user_id=owner.id, username=username_norm, created_at=now))


async def _repair_owner_display_name(
    session,
    *,
    owner: User,
    display_name_norm: str | None,
    now: datetime,
) -> None:
    if not display_name_norm or (owner.name or "") == display_name_norm:
        return
    tag = await _allocate_name_tag(session, name=display_name_norm, exclude_user_id=owner.id)
    owner.name = display_name_norm
    owner.name_tag = tag
    session.add(UserDisplayNameHistory(user_id=owner.id, name=display_name_norm, name_tag=tag, created_at=now))


def _repair_owner_password(owner: User, password: str | None) -> None:
    if password is not None:
        owner.hashed_password = security.hash_password(password)


async def repair_owner(
    *,
    email: str | None,
    password: str | None,
    username: str | None,
    display_name: str | None,
    verify_email: bool,
) -> None:
    email_norm, username_norm, display_name_norm = _normalize_repair_inputs(email, username, display_name)
    _validate_repair_inputs(email_norm, password)

    async with SessionLocal() as session:
        owner = await _require_owner(session)
        now = datetime.now(timezone.utc)

        await _repair_owner_email(
            session,
            owner=owner,
            email_norm=email_norm,
            verify_email=verify_email,
            now=now,
        )
        await _repair_owner_username(
            session,
            owner=owner,
            username_norm=username_norm,
            now=now,
        )
        await _repair_owner_display_name(
            session,
            owner=owner,
            display_name_norm=display_name_norm,
            now=now,
        )
        _repair_owner_password(owner, password)

        owner.role = UserRole.owner
        session.add(owner)
        await session.commit()
        await session.refresh(owner)
        print(f"Owner repaired: {owner.email} ({owner.username}) id={owner.id}")


def _serialize_user(user: User) -> Dict[str, Any]:
    return {
        "id": str(user.id),
        "email": user.email,
        "username": user.username,
        "name": user.name,
        "name_tag": user.name_tag,
        "first_name": getattr(user, "first_name", None),
        "middle_name": getattr(user, "middle_name", None),
        "last_name": getattr(user, "last_name", None),
        "date_of_birth": user.date_of_birth.isoformat() if user.date_of_birth else None,
        "phone": user.phone,
        "avatar_url": user.avatar_url,
        "preferred_language": user.preferred_language,
        "email_verified": user.email_verified,
        "role": user.role.value,
        "created_at": user.created_at.isoformat(),
    }


def _serialize_category(category: Category) -> Dict[str, Any]:
    return {
        "id": str(category.id),
        "slug": category.slug,
        "name": category.name,
        "description": category.description,
        "sort_order": category.sort_order,
        "created_at": category.created_at.isoformat(),
    }


def _serialize_product_image(image: ProductImage) -> Dict[str, Any]:
    return {
        "id": str(image.id),
        "url": image.url,
        "alt_text": image.alt_text,
        "sort_order": image.sort_order,
    }


def _serialize_product_option(option: ProductOption) -> Dict[str, Any]:
    return {
        "id": str(option.id),
        "name": option.option_name,
        "value": option.option_value,
    }


def _serialize_product_variant(variant: ProductVariant) -> Dict[str, Any]:
    return {
        "id": str(variant.id),
        "name": variant.name,
        "price_delta": float(variant.additional_price_delta),
        "stock_quantity": variant.stock_quantity,
    }


def _serialize_product(product: Product) -> Dict[str, Any]:
    return {
        "id": str(product.id),
        "category_id": str(product.category_id),
        "sku": product.sku,
        "slug": product.slug,
        "name": product.name,
        "short_description": product.short_description,
        "long_description": product.long_description,
        "base_price": float(product.base_price),
        "currency": product.currency,
        "is_featured": product.is_featured,
        "stock_quantity": product.stock_quantity,
        "status": product.status.value,
        "publish_at": product.publish_at.isoformat() if product.publish_at else None,
        "meta_title": product.meta_title,
        "meta_description": product.meta_description,
        "tags": [tag.slug for tag in product.tags],
        "images": [_serialize_product_image(image) for image in product.images],
        "options": [_serialize_product_option(option) for option in product.options],
        "variants": [_serialize_product_variant(variant) for variant in product.variants],
    }


def _serialize_address(address: Address) -> Dict[str, Any]:
    return {
        "id": str(address.id),
        "user_id": str(address.user_id) if address.user_id else None,
        "line1": address.line1,
        "line2": address.line2,
        "city": address.city,
        "region": address.region,
        "postal_code": address.postal_code,
        "country": address.country,
    }


def _serialize_order_item(item: OrderItem) -> Dict[str, Any]:
    return {
        "id": str(item.id),
        "product_id": str(item.product_id) if item.product_id else None,
        "quantity": item.quantity,
        "unit_price": float(item.unit_price),
        "subtotal": float(item.subtotal),
    }


def _serialize_order(order: Order) -> Dict[str, Any]:
    return {
        "id": str(order.id),
        "user_id": str(order.user_id) if order.user_id else None,
        "status": order.status.value,
        "total_amount": float(order.total_amount),
        "currency": order.currency,
        "reference_code": order.reference_code,
        "customer_email": getattr(order, "customer_email", None),
        "customer_name": getattr(order, "customer_name", None),
        "shipping_address_id": str(order.shipping_address_id) if order.shipping_address_id else None,
        "billing_address_id": str(order.billing_address_id) if order.billing_address_id else None,
        "items": [_serialize_order_item(item) for item in order.items],
    }


async def export_data(output: Path) -> None:
    data: Dict[str, Any] = {}
    async with SessionLocal() as session:
        users = (await session.execute(select(User))).scalars().all()
        categories = (await session.execute(select(Category))).scalars().all()
        products = (await session.execute(select(Product))).scalars().all()
        addresses = (await session.execute(select(Address))).scalars().all()
        orders = (await session.execute(select(Order))).scalars().all()

        data["users"] = [_serialize_user(user) for user in users]
        data["categories"] = [_serialize_category(category) for category in categories]
        data["products"] = [_serialize_product(product) for product in products]
        data["addresses"] = [_serialize_address(address) for address in addresses]
        data["orders"] = [_serialize_order(order) for order in orders]

    output.write_text(json.dumps(data, indent=2), encoding="utf-8")
    print(f"Exported data to {output}")


def _load_import_payload(input_path: Path) -> Dict[str, Any]:
    return json.loads(input_path.read_text(encoding="utf-8"))


def _next_name_tag(next_tag_by_name: Dict[str, int], display_name: str) -> int:
    name_tag = next_tag_by_name.get(display_name, 0)
    next_tag_by_name[display_name] = name_tag + 1
    return name_tag


def _preferred_username(user_payload: Dict[str, Any], email: str) -> str:
    return str(user_payload.get("username") or "").strip() or email.split("@")[0]


def _parse_optional_date(value: Any) -> date | None:
    if isinstance(value, str) and value:
        return date.fromisoformat(value)
    return None


def _payload_optional_text(payload: Dict[str, Any], key: str) -> str | None:
    value = str(payload.get(key) or "").strip()
    if value:
        return value
    return None


async def _create_import_user(
    session,
    *,
    user_payload: Dict[str, Any],
    user_id: uuid.UUID,
    email: str,
    used_usernames: set[str],
    next_tag_by_name: Dict[str, int],
) -> User:
    preferred = _preferred_username(user_payload, email)
    username = _make_unique_username(_sanitize_username(preferred), used_usernames)
    display_name = _payload_optional_text(user_payload, "name") or username
    name_tag = _next_name_tag(next_tag_by_name, display_name)
    dob = _parse_optional_date(user_payload.get("date_of_birth"))

    user_obj = User(
        id=user_id,
        email=email,
        username=username,
        hashed_password=security.hash_password("placeholder"),
        name=display_name,
        name_tag=name_tag,
        first_name=_payload_optional_text(user_payload, "first_name"),
        middle_name=_payload_optional_text(user_payload, "middle_name"),
        last_name=_payload_optional_text(user_payload, "last_name"),
        date_of_birth=dob,
        phone=_payload_optional_text(user_payload, "phone"),
        role=UserRole.customer,
    )
    session.add(user_obj)
    session.add(UserUsernameHistory(user_id=user_id, username=username))
    session.add(UserDisplayNameHistory(user_id=user_id, name=display_name, name_tag=name_tag))
    return user_obj


async def _ensure_import_user_username(
    session,
    *,
    user_obj: User,
    user_payload: Dict[str, Any],
    email: str,
    used_usernames: set[str],
) -> None:
    if getattr(user_obj, "username", None):
        return
    preferred = _preferred_username(user_payload, email)
    username = _make_unique_username(_sanitize_username(preferred), used_usernames)
    user_obj.username = username
    session.add(UserUsernameHistory(user_id=user_obj.id, username=username))


async def _sync_import_user_display_name(
    session,
    *,
    user_obj: User,
    user_payload: Dict[str, Any],
    next_tag_by_name: Dict[str, int],
) -> None:
    if not user_payload.get("name") or user_payload.get("name") == user_obj.name:
        return
    display_name = str(user_payload.get("name") or "").strip()
    name_tag = _next_name_tag(next_tag_by_name, display_name)
    user_obj.name = display_name
    user_obj.name_tag = name_tag
    session.add(UserDisplayNameHistory(user_id=user_obj.id, name=display_name, name_tag=name_tag))


def _apply_import_user_fields(user_obj: User, user_payload: Dict[str, Any]) -> None:
    user_obj.avatar_url = user_payload.get("avatar_url")
    user_obj.preferred_language = user_payload.get("preferred_language")
    user_obj.email_verified = user_payload.get("email_verified", False)

    role = user_payload.get("role")
    if role and role in UserRole._value2member_map_:
        user_obj.role = UserRole(role)


async def _import_users(
    session,
    *,
    users_payload: list[Dict[str, Any]],
    used_usernames: set[str],
    next_tag_by_name: Dict[str, int],
) -> None:
    for user_payload in users_payload:
        user_id = uuid.UUID(str(user_payload["id"]))
        email = str(user_payload["email"])
        user_obj: User | None = await session.get(User, user_id)

        if not user_obj:
            user_obj = await _create_import_user(
                session,
                user_payload=user_payload,
                user_id=user_id,
                email=email,
                used_usernames=used_usernames,
                next_tag_by_name=next_tag_by_name,
            )
        else:
            await _ensure_import_user_username(
                session,
                user_obj=user_obj,
                user_payload=user_payload,
                email=email,
                used_usernames=used_usernames,
            )

        await _sync_import_user_display_name(
            session,
            user_obj=user_obj,
            user_payload=user_payload,
            next_tag_by_name=next_tag_by_name,
        )
        _apply_import_user_fields(user_obj, user_payload)
        session.add(user_obj)


async def _import_categories(session, *, categories_payload: list[Dict[str, Any]]) -> None:
    for category_payload in categories_payload:
        category_obj: Category | None = await session.get(Category, category_payload["id"])
        if not category_obj:
            category_obj = Category(
                id=category_payload["id"],
                slug=category_payload["slug"],
                name=category_payload["name"],
            )

        category_obj.slug = category_payload["slug"]
        category_obj.name = category_payload["name"]
        category_obj.description = category_payload.get("description")
        category_obj.sort_order = category_payload.get("sort_order", 0)
        session.add(category_obj)


async def _build_tag_cache(session, *, products_payload: list[Dict[str, Any]]) -> Dict[str, Tag]:
    tag_cache: Dict[str, Tag] = {}
    for product_payload in products_payload:
        for slug in product_payload.get("tags", []) or []:
            if slug in tag_cache:
                continue
            existing: Tag | None = (await session.execute(select(Tag).where(Tag.slug == slug))).scalar_one_or_none()
            if existing:
                tag_cache[slug] = existing
            else:
                tag = Tag(slug=slug, name=slug.capitalize())
                session.add(tag)
                tag_cache[slug] = tag
    return tag_cache


def _update_product_basics(product_obj: Product, product_payload: Dict[str, Any], tag_cache: Dict[str, Tag]) -> None:
    product_obj.category_id = product_payload["category_id"]
    product_obj.sku = product_payload["sku"]
    product_obj.slug = product_payload["slug"]
    product_obj.name = product_payload["name"]
    product_obj.short_description = product_payload.get("short_description")
    product_obj.long_description = product_payload.get("long_description")
    product_obj.base_price = product_payload.get("base_price", 0)
    product_obj.currency = product_payload.get("currency", "RON")
    product_obj.is_featured = product_payload.get("is_featured", False)
    product_obj.stock_quantity = product_payload.get("stock_quantity", 0)
    if "status" in product_payload and product_payload["status"]:
        product_obj.status = product_payload["status"]
    product_obj.publish_at = product_payload.get("publish_at")
    product_obj.meta_title = product_payload.get("meta_title")
    product_obj.meta_description = product_payload.get("meta_description")
    product_obj.tags = [tag_cache[slug] for slug in product_payload.get("tags", []) or []]


def _replace_product_images(product_obj: Product, images_payload: list[Dict[str, Any]]) -> None:
    product_obj.images.clear()
    for image_payload in images_payload:
        product_obj.images.append(
            ProductImage(
                id=image_payload.get("id"),
                url=image_payload.get("url"),
                alt_text=image_payload.get("alt_text"),
                sort_order=image_payload.get("sort_order") or 0,
            )
        )


def _replace_product_options(product_obj: Product, options_payload: list[Dict[str, Any]]) -> None:
    product_obj.options.clear()
    for option_payload in options_payload:
        name = option_payload.get("name") or option_payload.get("option_name")
        value = option_payload.get("value") or option_payload.get("option_value") or (option_payload.get("values") or [None])[0]
        product_obj.options.append(
            ProductOption(id=option_payload.get("id"), option_name=name or "", option_value=value or "")
        )


def _replace_product_variants(product_obj: Product, variants_payload: list[Dict[str, Any]]) -> None:
    product_obj.variants.clear()
    for variant_payload in variants_payload:
        product_obj.variants.append(
            ProductVariant(
                id=variant_payload.get("id"),
                name=variant_payload.get("name") or variant_payload.get("sku") or "Variant",
                additional_price_delta=variant_payload.get("price_delta", variant_payload.get("price", 0)),
                stock_quantity=variant_payload.get("stock_quantity", 0),
            )
        )


async def _import_products(
    session,
    *,
    products_payload: list[Dict[str, Any]],
    tag_cache: Dict[str, Tag],
) -> None:
    for product_payload in products_payload:
        product_obj: Product | None = await session.get(Product, product_payload["id"])
        if not product_obj:
            product_obj = Product(
                id=product_payload["id"],
                category_id=product_payload["category_id"],
                sku=product_payload["sku"],
                slug=product_payload["slug"],
                name=product_payload["name"],
            )

        _update_product_basics(product_obj, product_payload, tag_cache)
        session.add(product_obj)

        if product_payload.get("images"):
            _replace_product_images(product_obj, product_payload["images"])
        if product_payload.get("options"):
            _replace_product_options(product_obj, product_payload["options"])
        if product_payload.get("variants"):
            _replace_product_variants(product_obj, product_payload["variants"])


async def _import_addresses(session, *, addresses_payload: list[Dict[str, Any]]) -> None:
    for address_payload in addresses_payload:
        address_obj: Address | None = await session.get(Address, address_payload["id"])
        if not address_obj:
            address_obj = Address(id=address_payload["id"], user_id=address_payload.get("user_id"))

        address_obj.user_id = address_payload.get("user_id")
        address_obj.line1 = str(address_payload.get("line1") or "").strip()
        address_obj.line2 = _payload_optional_text(address_payload, "line2")
        address_obj.city = str(address_payload.get("city") or "").strip()
        address_obj.region = _payload_optional_text(address_payload, "region") or _payload_optional_text(address_payload, "state")
        address_obj.postal_code = str(address_payload.get("postal_code") or "").strip()
        address_obj.country = str(address_payload.get("country") or "").strip()
        session.add(address_obj)


async def _ensure_shipping_methods(session, *, orders_payload: list[Dict[str, Any]]) -> Dict[str, ShippingMethod]:
    shipping_lookup: Dict[str, ShippingMethod] = {}
    for order_payload in orders_payload:
        shipping_method_id = order_payload.get("shipping_method_id")
        if not shipping_method_id or shipping_method_id in shipping_lookup:
            continue

        shipping_method: ShippingMethod | None = await session.get(ShippingMethod, shipping_method_id)
        if not shipping_method:
            shipping_method = ShippingMethod(id=shipping_method_id, name="Imported", rate_flat=0, rate_per_kg=0)
            session.add(shipping_method)
        shipping_lookup[shipping_method_id] = shipping_method
    return shipping_lookup


def _parse_optional_uuid(value: Any) -> uuid.UUID | None:
    if value:
        return uuid.UUID(str(value))
    return None


def _missing_customer_info(customer_email: Any, customer_name: Any) -> bool:
    return not customer_email or not customer_name


async def _fill_customer_from_order_user(
    session,
    *,
    order_user_id: uuid.UUID | None,
    customer_email: Any,
    customer_name: Any,
) -> tuple[Any, Any]:
    if not order_user_id:
        return customer_email, customer_name

    order_user: User | None = await session.get(User, order_user_id)
    if not order_user:
        return customer_email, customer_name

    if not customer_email:
        customer_email = order_user.email
    if not customer_name:
        customer_name = order_user.name or order_user.email
    return customer_email, customer_name


async def _resolve_order_customer(
    session,
    *,
    order_payload: Dict[str, Any],
    order_user_id: uuid.UUID | None,
    customer_email: Any,
    customer_name: Any,
) -> tuple[Any, Any]:
    if _missing_customer_info(customer_email, customer_name):
        customer_email, customer_name = await _fill_customer_from_order_user(
            session,
            order_user_id=order_user_id,
            customer_email=customer_email,
            customer_name=customer_name,
        )

    if _missing_customer_info(customer_email, customer_name):
        raise SystemExit(f"Order {order_payload.get('id')} missing customer_email/customer_name")
    return customer_email, customer_name


def _replace_order_items(order_obj: Order, items_payload: list[Dict[str, Any]]) -> None:
    order_obj.items.clear()
    for item_payload in items_payload:
        order_obj.items.append(
            OrderItem(
                id=item_payload.get("id"),
                product_id=item_payload.get("product_id"),
                variant_id=item_payload.get("variant_id"),
                quantity=item_payload.get("quantity", 1),
                unit_price=item_payload.get("unit_price", 0),
                subtotal=item_payload.get("subtotal", 0),
            )
        )


def _update_order_fields(
    order_obj: Order,
    *,
    order_payload: Dict[str, Any],
    order_user_id: uuid.UUID | None,
    customer_email: Any,
    customer_name: Any,
) -> None:
    order_obj.user_id = order_user_id
    order_obj.customer_email = customer_email
    order_obj.customer_name = customer_name
    if order_payload.get("status"):
        order_obj.status = order_payload["status"]
    order_obj.total_amount = order_payload.get("total_amount", 0)
    order_obj.currency = order_payload.get("currency", "RON")
    order_obj.reference_code = order_payload.get("reference_code")
    order_obj.shipping_address_id = order_payload.get("shipping_address_id")
    order_obj.billing_address_id = order_payload.get("billing_address_id")
    if order_payload.get("shipping_method_id"):
        order_obj.shipping_method_id = order_payload.get("shipping_method_id")


async def _import_orders(session, *, orders_payload: list[Dict[str, Any]]) -> None:
    for order_payload in orders_payload:
        order_id = uuid.UUID(str(order_payload["id"]))
        order_obj: Order | None = await session.get(Order, order_id)
        order_user_id = _parse_optional_uuid(order_payload.get("user_id"))
        customer_email, customer_name = await _resolve_order_customer(
            session,
            order_payload=order_payload,
            order_user_id=order_user_id,
            customer_email=order_payload.get("customer_email"),
            customer_name=order_payload.get("customer_name"),
        )

        if not order_obj:
            order_obj = Order(
                id=order_id,
                user_id=order_user_id,
                customer_email=customer_email,
                customer_name=customer_name,
                status=order_payload.get("status"),
            )

        _update_order_fields(
            order_obj,
            order_payload=order_payload,
            order_user_id=order_user_id,
            customer_email=customer_email,
            customer_name=customer_name,
        )
        _replace_order_items(order_obj, order_payload.get("items", []))
        session.add(order_obj)


async def _load_user_import_context(session) -> tuple[set[str], Dict[str, int]]:
    used_usernames = set((await session.execute(select(User.username))).scalars().all())
    existing_max_tags = (
        await session.execute(
            select(User.name, func.max(User.name_tag)).where(User.name.is_not(None)).group_by(User.name)
        )
    ).all()
    next_tag_by_name = {
        str(name): int(max_tag if max_tag is not None else -1) + 1 for name, max_tag in existing_max_tags
    }
    return used_usernames, next_tag_by_name


async def import_data(input_path: Path) -> None:
    payload = _load_import_payload(input_path)
    users_payload = payload.get("users", [])
    categories_payload = payload.get("categories", [])
    products_payload = payload.get("products", [])
    addresses_payload = payload.get("addresses", [])
    orders_payload = payload.get("orders", [])

    async with SessionLocal() as session:
        used_usernames, next_tag_by_name = await _load_user_import_context(session)

        await _import_users(
            session,
            users_payload=users_payload,
            used_usernames=used_usernames,
            next_tag_by_name=next_tag_by_name,
        )
        await _import_categories(session, categories_payload=categories_payload)

        tag_cache = await _build_tag_cache(session, products_payload=products_payload)
        await session.flush()

        await _import_products(session, products_payload=products_payload, tag_cache=tag_cache)
        await _import_addresses(session, addresses_payload=addresses_payload)

        await _ensure_shipping_methods(session, orders_payload=orders_payload)
        await session.flush()

        await _import_orders(session, orders_payload=orders_payload)
        await session.commit()

    print("Import completed")


def _add_export_import_commands(subparsers) -> None:
    export_cmd = subparsers.add_parser("export-data", help="Export data to JSON")
    export_cmd.add_argument("--output", default="export.json", help="Output JSON path")

    import_cmd = subparsers.add_parser("import-data", help="Import data from JSON")
    import_cmd.add_argument("--input", required=True, help="Input JSON path")


def _add_owner_commands(subparsers) -> None:
    owner = subparsers.add_parser("bootstrap-owner", help="Create or transfer the unique owner account")
    owner.add_argument("--email", required=True, help="Owner email")
    owner.add_argument("--password", required=True, help="Owner password")
    owner.add_argument("--username", required=True, help="Owner username")
    owner.add_argument("--display-name", required=True, help="Owner display name")

    repair = subparsers.add_parser("repair-owner", help="Repair the existing owner account (local/dev recovery)")
    repair.add_argument("--email", help="Owner email (optional)")
    repair.add_argument("--password", help="Owner password (optional; if omitted, keep existing)")
    repair.add_argument("--username", help="Owner username (optional)")
    repair.add_argument("--display-name", help="Owner display name (optional)")
    repair.add_argument(
        "--verify-email",
        action="store_true",
        help="Mark the owner email as verified (useful when SMTP is disabled in local dev)",
    )


def _add_seed_command(subparsers) -> None:
    seed_data = subparsers.add_parser("seed-data", help="Seed bootstrap catalog/content data")
    seed_data.add_argument("--profile", default="default", help="Seed profile (e.g. default, adrianaart)")


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Data portability utilities")
    subparsers = parser.add_subparsers(dest="command")
    _add_export_import_commands(subparsers)
    _add_owner_commands(subparsers)
    _add_seed_command(subparsers)
    return parser


async def _seed_data(profile: str) -> None:
    async with SessionLocal() as session:
        await app_seeds.seed(session, profile=profile)


def _run_cli_command(args: argparse.Namespace) -> bool:
    if args.command == "export-data":
        output_path = _resolve_json_path(args.output, must_exist=False)
        asyncio.run(export_data(output_path))
        return True

    if args.command == "import-data":
        input_path = _resolve_json_path(args.input, must_exist=True)
        asyncio.run(import_data(input_path))
        return True

    if args.command == "bootstrap-owner":
        asyncio.run(
            bootstrap_owner(
                email=args.email,
                password=args.password,
                username=args.username,
                display_name=args.display_name,
            )
        )
        return True

    if args.command == "repair-owner":
        asyncio.run(
            repair_owner(
                email=args.email,
                password=args.password,
                username=args.username,
                display_name=args.display_name,
                verify_email=bool(args.verify_email),
            )
        )
        return True

    if args.command == "seed-data":
        asyncio.run(_seed_data(args.profile))
        return True

    return False


def main():
    parser = _build_parser()
    args = parser.parse_args()
    if not _run_cli_command(args):
        parser.print_help()


if __name__ == "__main__":
    main()
