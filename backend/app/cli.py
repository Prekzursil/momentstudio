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
from app.models.user import User, UserDisplayNameHistory, UserEmailHistory, UserRole, UserUsernameHistory
from app.models.address import Address
from app.models.catalog import Category, Product, ProductImage, ProductOption, ProductVariant, Tag
from app.models.order import Order, OrderItem, ShippingMethod


USERNAME_MAX_LEN = 30
USERNAME_MIN_LEN = 3
USERNAME_ALLOWED_RE = re.compile(r"[^A-Za-z0-9._-]+")


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


async def bootstrap_owner(*, email: str, password: str, username: str, display_name: str) -> None:
    email_norm = (email or "").strip().lower()
    username_norm = (username or "").strip()
    display_name_norm = (display_name or "").strip() or username_norm

    if not email_norm or "@" not in email_norm:
        raise SystemExit("Invalid email")
    if not username_norm:
        raise SystemExit("Username is required")
    if len(password) < 6:
        print("WARNING: creating owner with a password shorter than 6 characters; change it immediately.")

    async with SessionLocal() as session:
        existing_owner = (await session.execute(select(User).where(User.role == UserRole.owner))).scalar_one_or_none()

        existing_email_user = (
            await session.execute(select(User).where(func.lower(User.email) == email_norm))
        ).scalar_one_or_none()
        existing_username_user = (
            await session.execute(select(User).where(User.username == username_norm))
        ).scalar_one_or_none()

        # Prevent a unique-owner-role violation during flush/commit.
        if existing_owner:
            if not existing_email_user or existing_owner.id != existing_email_user.id:
                existing_owner.role = UserRole.admin
                session.add(existing_owner)
                await session.flush()

        now = datetime.now(timezone.utc)

        if not existing_email_user:
            if existing_username_user:
                raise SystemExit(f"Username already taken: {username_norm}")

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
            await session.commit()
            await session.refresh(user)
            print(f"Owner created: {user.email} ({user.username}) id={user.id}")
            return

        user = existing_email_user
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
        await session.commit()
        await session.refresh(user)
        print(f"Owner set: {user.email} ({user.username}) id={user.id}")


async def repair_owner(
    *,
    email: str | None,
    password: str | None,
    username: str | None,
    display_name: str | None,
    verify_email: bool,
) -> None:
    """Repair the existing owner account without transferring ownership.

    This is meant for local/dev recovery when an owner accidentally changes
    an email/username and gets blocked by cooldowns or unverified-email guards.
    """

    email_norm = (email or "").strip().lower() or None
    username_norm = (username or "").strip() or None
    display_name_norm = (display_name or "").strip() or None

    if email_norm and "@" not in email_norm:
        raise SystemExit("Invalid email")
    if password is not None and len(password) < 6:
        print("WARNING: setting owner password shorter than 6 characters; change it immediately.")

    async with SessionLocal() as session:
        owner = (await session.execute(select(User).where(User.role == UserRole.owner))).scalar_one_or_none()
        if not owner:
            raise SystemExit("No owner account found. Run bootstrap-owner first.")

        now = datetime.now(timezone.utc)

        if email_norm:
            existing_email_user = (
                await session.execute(select(User).where(func.lower(User.email) == email_norm))
            ).scalar_one_or_none()
            if existing_email_user and existing_email_user.id != owner.id:
                raise SystemExit(f"Email already registered: {email_norm}")
            if (owner.email or "").strip().lower() != email_norm:
                owner.email = email_norm
                session.add(UserEmailHistory(user_id=owner.id, email=email_norm, created_at=now))
            if verify_email:
                owner.email_verified = True
            else:
                owner.email_verified = owner.email_verified and (owner.email or "").strip().lower() == email_norm
        elif verify_email:
            owner.email_verified = True

        if username_norm:
            existing_username_user = (
                await session.execute(select(User).where(User.username == username_norm))
            ).scalar_one_or_none()
            if existing_username_user and existing_username_user.id != owner.id:
                raise SystemExit(f"Username already taken: {username_norm}")
            if owner.username != username_norm:
                owner.username = username_norm
                session.add(UserUsernameHistory(user_id=owner.id, username=username_norm, created_at=now))

        if display_name_norm and (owner.name or "") != display_name_norm:
            tag = await _allocate_name_tag(session, name=display_name_norm, exclude_user_id=owner.id)
            owner.name = display_name_norm
            owner.name_tag = tag
            session.add(UserDisplayNameHistory(user_id=owner.id, name=display_name_norm, name_tag=tag, created_at=now))

        if password is not None:
            owner.hashed_password = security.hash_password(password)

        owner.role = UserRole.owner
        session.add(owner)
        await session.commit()
        await session.refresh(owner)
        print(f"Owner repaired: {owner.email} ({owner.username}) id={owner.id}")


async def export_data(output: Path) -> None:
    data: Dict[str, Any] = {}
    async with SessionLocal() as session:
        users = (await session.execute(select(User))).scalars().all()
        data["users"] = [
            {
                "id": str(u.id),
                "email": u.email,
                "username": u.username,
                "name": u.name,
                "name_tag": u.name_tag,
                "first_name": getattr(u, "first_name", None),
                "middle_name": getattr(u, "middle_name", None),
                "last_name": getattr(u, "last_name", None),
                "date_of_birth": u.date_of_birth.isoformat() if u.date_of_birth else None,
                "phone": u.phone,
                "avatar_url": u.avatar_url,
                "preferred_language": u.preferred_language,
                "email_verified": u.email_verified,
                "role": u.role.value,
                "created_at": u.created_at.isoformat(),
            }
            for u in users
        ]
        categories = (await session.execute(select(Category))).scalars().all()
        data["categories"] = [
            {
                "id": str(c.id),
                "slug": c.slug,
                "name": c.name,
                "description": c.description,
                "sort_order": c.sort_order,
                "created_at": c.created_at.isoformat(),
            }
            for c in categories
        ]
        products = (await session.execute(select(Product))).scalars().all()
        data["products"] = []
        for p in products:
            data["products"].append(
                {
                    "id": str(p.id),
                    "category_id": str(p.category_id),
                    "sku": p.sku,
                    "slug": p.slug,
                    "name": p.name,
                    "short_description": p.short_description,
                    "long_description": p.long_description,
                    "base_price": float(p.base_price),
                    "currency": p.currency,
                    "is_featured": p.is_featured,
                    "stock_quantity": p.stock_quantity,
                    "status": p.status.value,
                    "publish_at": p.publish_at.isoformat() if p.publish_at else None,
                    "meta_title": p.meta_title,
                    "meta_description": p.meta_description,
                    "tags": [t.slug for t in p.tags],
                    "images": [
                        {"id": str(img.id), "url": img.url, "alt_text": img.alt_text, "sort_order": img.sort_order}
                        for img in p.images
                    ],
                    "options": [
                        {"id": str(opt.id), "name": opt.option_name, "value": opt.option_value} for opt in p.options
                    ],
                    "variants": [
                        {
                            "id": str(v.id),
                            "name": v.name,
                            "price_delta": float(v.additional_price_delta),
                            "stock_quantity": v.stock_quantity,
                        }
                        for v in p.variants
                    ],
                }
            )
        addresses = (await session.execute(select(Address))).scalars().all()
        data["addresses"] = [
            {
                "id": str(a.id),
                "user_id": str(a.user_id) if a.user_id else None,
                "line1": a.line1,
                "line2": a.line2,
                "city": a.city,
                "region": a.region,
                "postal_code": a.postal_code,
                "country": a.country,
            }
            for a in addresses
        ]
        orders = (await session.execute(select(Order))).scalars().all()
        data["orders"] = []
        for o in orders:
            data["orders"].append(
                {
                    "id": str(o.id),
                    "user_id": str(o.user_id) if o.user_id else None,
                    "status": o.status.value,
                    "total_amount": float(o.total_amount),
                    "currency": o.currency,
                    "reference_code": o.reference_code,
                    "customer_email": getattr(o, "customer_email", None),
                    "customer_name": getattr(o, "customer_name", None),
                    "shipping_address_id": str(o.shipping_address_id) if o.shipping_address_id else None,
                    "billing_address_id": str(o.billing_address_id) if o.billing_address_id else None,
                    "items": [
                        {
                            "id": str(oi.id),
                            "product_id": str(oi.product_id) if oi.product_id else None,
                            "quantity": oi.quantity,
                            "unit_price": float(oi.unit_price),
                            "subtotal": float(oi.subtotal),
                        }
                        for oi in o.items
                    ],
                }
            )
    output.write_text(json.dumps(data, indent=2), encoding="utf-8")
    print(f"Exported data to {output}")


async def import_data(input_path: Path) -> None:
    payload = json.loads(input_path.read_text(encoding="utf-8"))
    async with SessionLocal() as session:
        used_usernames = set((await session.execute(select(User.username))).scalars().all())
        existing_max_tags = (
            await session.execute(
                select(User.name, func.max(User.name_tag)).where(User.name.is_not(None)).group_by(User.name)
            )
        ).all()
        next_tag_by_name = {
            str(name): int(max_tag if max_tag is not None else -1) + 1 for name, max_tag in existing_max_tags
        }

        # users
        for u in payload.get("users", []):
            user_id = uuid.UUID(str(u["id"]))
            email = str(u["email"])
            user_obj: User | None = await session.get(User, user_id)
            if not user_obj:
                preferred = str(u.get("username") or "").strip() or email.split("@")[0]
                username = _make_unique_username(_sanitize_username(preferred), used_usernames)
                display_name = str(u.get("name") or "").strip() or username
                name_tag = next_tag_by_name.get(display_name, 0)
                next_tag_by_name[display_name] = name_tag + 1
                dob_raw = u.get("date_of_birth")
                dob = date.fromisoformat(dob_raw) if isinstance(dob_raw, str) and dob_raw else None
                user_obj = User(
                    id=user_id,
                    email=email,
                    username=username,
                    hashed_password=security.hash_password("placeholder"),
                    name=display_name,
                    name_tag=name_tag,
                    first_name=str(u.get("first_name") or "").strip() or None,
                    middle_name=str(u.get("middle_name") or "").strip() or None,
                    last_name=str(u.get("last_name") or "").strip() or None,
                    date_of_birth=dob,
                    phone=str(u.get("phone") or "").strip() or None,
                    role=UserRole.customer,
                )
                session.add(user_obj)
                session.add(UserUsernameHistory(user_id=user_id, username=username))
                session.add(UserDisplayNameHistory(user_id=user_id, name=display_name, name_tag=name_tag))
            elif not getattr(user_obj, "username", None):
                preferred = str(u.get("username") or "").strip() or email.split("@")[0]
                username = _make_unique_username(_sanitize_username(preferred), used_usernames)
                user_obj.username = username
                session.add(UserUsernameHistory(user_id=user_obj.id, username=username))

            if u.get("name") and u.get("name") != user_obj.name:
                display_name = str(u.get("name") or "").strip()
                name_tag = next_tag_by_name.get(display_name, 0)
                next_tag_by_name[display_name] = name_tag + 1
                user_obj.name = display_name
                user_obj.name_tag = name_tag
                session.add(UserDisplayNameHistory(user_id=user_obj.id, name=display_name, name_tag=name_tag))

            user_obj.avatar_url = u.get("avatar_url")
            user_obj.preferred_language = u.get("preferred_language")
            user_obj.email_verified = u.get("email_verified", False)
            role = u.get("role")
            if role and role in UserRole._value2member_map_:
                user_obj.role = UserRole(role)
            session.add(user_obj)
        # categories
        for c in payload.get("categories", []):
            category_obj: Category | None = await session.get(Category, c["id"])
            if not category_obj:
                category_obj = Category(id=c["id"], slug=c["slug"], name=c["name"])
            category_obj.slug = c["slug"]
            category_obj.name = c["name"]
            category_obj.description = c.get("description")
            category_obj.sort_order = c.get("sort_order", 0)
            session.add(category_obj)
        # tags
        tag_cache: Dict[str, Tag] = {}
        for p in payload.get("products", []):
            for slug in p.get("tags", []) or []:
                if slug in tag_cache:
                    continue
                existing: Tag | None = (await session.execute(select(Tag).where(Tag.slug == slug))).scalar_one_or_none()
                if existing:
                    tag_cache[slug] = existing
                else:
                    tag = Tag(slug=slug, name=slug.capitalize())
                    session.add(tag)
                    tag_cache[slug] = tag
        await session.flush()
        # products
        for p in payload.get("products", []):
            product_obj: Product | None = await session.get(Product, p["id"])
            if not product_obj:
                product_obj = Product(
                    id=p["id"], category_id=p["category_id"], sku=p["sku"], slug=p["slug"], name=p["name"]
                )
            product_obj.category_id = p["category_id"]
            product_obj.sku = p["sku"]
            product_obj.slug = p["slug"]
            product_obj.name = p["name"]
            product_obj.short_description = p.get("short_description")
            product_obj.long_description = p.get("long_description")
            product_obj.base_price = p.get("base_price", 0)
            product_obj.currency = p.get("currency", "RON")
            product_obj.is_featured = p.get("is_featured", False)
            product_obj.stock_quantity = p.get("stock_quantity", 0)
            if "status" in p and p["status"]:
                product_obj.status = p["status"]
            product_obj.publish_at = p.get("publish_at")
            product_obj.meta_title = p.get("meta_title")
            product_obj.meta_description = p.get("meta_description")
            product_obj.tags = [tag_cache[slug] for slug in p.get("tags", []) or []]
            session.add(product_obj)
            # images
            if p.get("images"):
                product_obj.images.clear()
                for img in p["images"]:
                    product_obj.images.append(
                        ProductImage(
                            id=img.get("id"),
                            url=img.get("url"),
                            alt_text=img.get("alt_text"),
                            sort_order=img.get("sort_order") or 0,
                        )
                    )
            # options
            if p.get("options"):
                product_obj.options.clear()
                for opt in p["options"]:
                    name = opt.get("name") or opt.get("option_name")
                    value = opt.get("value") or opt.get("option_value") or (opt.get("values") or [None])[0]
                    product_obj.options.append(
                        ProductOption(id=opt.get("id"), option_name=name or "", option_value=value or "")
                    )
            # variants
            if p.get("variants"):
                product_obj.variants.clear()
                for v in p["variants"]:
                    product_obj.variants.append(
                        ProductVariant(
                            id=v.get("id"),
                            name=v.get("name") or v.get("sku") or "Variant",
                            additional_price_delta=v.get("price_delta", v.get("price", 0)),
                            stock_quantity=v.get("stock_quantity", 0),
                        )
                    )
        # addresses
        for a in payload.get("addresses", []):
            address_obj: Address | None = await session.get(Address, a["id"])
            if not address_obj:
                address_obj = Address(id=a["id"], user_id=a.get("user_id"))
            address_obj.user_id = a.get("user_id")
            address_obj.line1 = a.get("line1")
            address_obj.line2 = a.get("line2")
            address_obj.city = a.get("city")
            address_obj.region = a.get("region") or a.get("state")
            address_obj.postal_code = a.get("postal_code")
            address_obj.country = a.get("country")
            session.add(address_obj)
        # shipping methods
        sm_lookup: Dict[str, ShippingMethod] = {}
        for o in payload.get("orders", []):
            sid = o.get("shipping_method_id")
            if sid and sid not in sm_lookup:
                sm_existing: ShippingMethod | None = await session.get(ShippingMethod, sid)
                if sm_existing:
                    sm_lookup[sid] = sm_existing
                else:
                    sm = ShippingMethod(id=sid, name="Imported", rate_flat=0, rate_per_kg=0)
                    session.add(sm)
                    sm_lookup[sid] = sm
        await session.flush()
        # orders
        for o in payload.get("orders", []):
            order_id = uuid.UUID(str(o["id"]))
            order_obj: Order | None = await session.get(Order, order_id)
            order_user_id: uuid.UUID | None = uuid.UUID(str(o["user_id"])) if o.get("user_id") else None
            customer_email = o.get("customer_email")
            customer_name = o.get("customer_name")
            if not customer_email or not customer_name:
                if order_user_id:
                    order_user_obj: User | None = await session.get(User, order_user_id)
                    if order_user_obj:
                        customer_email = customer_email or order_user_obj.email
                        customer_name = customer_name or (order_user_obj.name or order_user_obj.email)
            if not customer_email or not customer_name:
                raise SystemExit(f"Order {o.get('id')} missing customer_email/customer_name")
            if not order_obj:
                order_obj = Order(
                    id=order_id,
                    user_id=order_user_id,
                    customer_email=customer_email,
                    customer_name=customer_name,
                    status=o.get("status"),
                )
            order_obj.user_id = order_user_id
            order_obj.customer_email = customer_email
            order_obj.customer_name = customer_name
            if o.get("status"):
                order_obj.status = o["status"]
            order_obj.total_amount = o.get("total_amount", 0)
            order_obj.currency = o.get("currency", "RON")
            order_obj.reference_code = o.get("reference_code")
            order_obj.shipping_address_id = o.get("shipping_address_id")
            order_obj.billing_address_id = o.get("billing_address_id")
            if o.get("shipping_method_id"):
                order_obj.shipping_method_id = o.get("shipping_method_id")
            order_obj.items.clear()
            for item in o.get("items", []):
                order_obj.items.append(
                    OrderItem(
                        id=item.get("id"),
                        product_id=item.get("product_id"),
                        variant_id=item.get("variant_id"),
                        quantity=item.get("quantity", 1),
                        unit_price=item.get("unit_price", 0),
                        subtotal=item.get("subtotal", 0),
                    )
                )
            session.add(order_obj)
        await session.commit()
    print("Import completed")


def main():
    parser = argparse.ArgumentParser(description="Data portability utilities")
    sub = parser.add_subparsers(dest="command")
    exp = sub.add_parser("export-data", help="Export data to JSON")
    exp.add_argument("--output", default="export.json", help="Output JSON path")
    imp = sub.add_parser("import-data", help="Import data from JSON")
    imp.add_argument("--input", required=True, help="Input JSON path")
    owner = sub.add_parser("bootstrap-owner", help="Create or transfer the unique owner account")
    owner.add_argument("--email", required=True, help="Owner email")
    owner.add_argument("--password", required=True, help="Owner password")
    owner.add_argument("--username", required=True, help="Owner username")
    owner.add_argument("--display-name", required=True, help="Owner display name")
    repair = sub.add_parser("repair-owner", help="Repair the existing owner account (local/dev recovery)")
    repair.add_argument("--email", help="Owner email (optional)")
    repair.add_argument("--password", help="Owner password (optional; if omitted, keep existing)")
    repair.add_argument("--username", help="Owner username (optional)")
    repair.add_argument("--display-name", help="Owner display name (optional)")
    repair.add_argument(
        "--verify-email",
        action="store_true",
        help="Mark the owner email as verified (useful when SMTP is disabled in local dev)",
    )
    args = parser.parse_args()

    if args.command == "export-data":
        asyncio.run(export_data(Path(args.output)))
    elif args.command == "import-data":
        asyncio.run(import_data(Path(args.input)))
    elif args.command == "bootstrap-owner":
        asyncio.run(
            bootstrap_owner(
                email=args.email,
                password=args.password,
                username=args.username,
                display_name=args.display_name,
            )
        )
    elif args.command == "repair-owner":
        asyncio.run(
            repair_owner(
                email=args.email,
                password=args.password,
                username=args.username,
                display_name=args.display_name,
                verify_email=bool(args.verify_email),
            )
        )
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
