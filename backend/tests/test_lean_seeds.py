"""Lean-gate unit coverage for ``app.seeds``.

Covers the path-normalization / profile-resolution guards (each raising
SystemExit), a full ``seed`` run against an in-memory engine using the real
``default`` profile (then a second idempotent run to exercise the
already-exists ``continue`` branches), and ``main`` with a stubbed engine.
The ``__main__`` CLI entry is marked ``# pragma: no cover`` in source.
"""

from __future__ import annotations

import asyncio

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app import seeds
from app.models.catalog import Category


def test_normalize_profile_rel_path_guards() -> None:
    assert seeds._normalize_profile_rel_path("./content/a.md") == "content/a.md"
    with pytest.raises(SystemExit):
        seeds._normalize_profile_rel_path("./")  # empty after stripping
    with pytest.raises(SystemExit):
        seeds._normalize_profile_rel_path("../escape.md")  # traversal
    with pytest.raises(SystemExit):
        seeds._normalize_profile_rel_path("/abs/path.md")  # absolute
    with pytest.raises(SystemExit):
        # Passes traversal/absolute checks but fails the content-path pattern
        # (leading underscore is not allowed by PROFILE_CONTENT_PATH_PATTERN).
        seeds._normalize_profile_rel_path("_hidden.md")


def test_resolve_profile_file_guards() -> None:
    with pytest.raises(SystemExit):
        seeds._resolve_profile_file({}, "not/allowed.md", allowed_paths=set())
    with pytest.raises(SystemExit):
        seeds._resolve_profile_file(
            {}, "allowed.md", allowed_paths={"allowed.md"}
        )  # allowed but missing from file map


def test_resolve_profile_dir_guards() -> None:
    with pytest.raises(SystemExit):
        seeds._resolve_profile_dir("!!bad!!")  # invalid name pattern
    with pytest.raises(SystemExit):
        seeds._resolve_profile_dir("definitely-missing-profile")


def _make_engine():
    import app.models  # noqa: F401
    from app.db.base import Base

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)

    async def _init() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_init())
    return engine


def test_seed_default_profile_idempotent() -> None:
    engine = _make_engine()
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

    async def run() -> None:
        async with SessionLocal() as session:
            await seeds.seed(session, profile="default")
            from sqlalchemy import func, select

            cat_count = await session.scalar(select(func.count()).select_from(Category))
            assert cat_count and cat_count > 0

            # Second run is a no-op (exercises the already-exists continues).
            await seeds.seed(session, profile="default")
            cat_count2 = await session.scalar(
                select(func.count()).select_from(Category)
            )
            assert cat_count2 == cat_count

    asyncio.run(run())


def test_seed_custom_profile_inline_translation_and_nonmatching_file(
    monkeypatch, tmp_path
) -> None:
    import json as _json

    # Build a minimal custom profile to exercise:
    #  * a file whose name does NOT match the content-path pattern (skipped in
    #    the file-map build -> 114->110 arc);
    #  * a content block translation with an inline body_markdown (227->233 arc).
    profiles_root = tmp_path / "seed_profiles"
    prof = profiles_root / "custom"
    (prof / "legal").mkdir(parents=True)
    # Non-matching file name (leading underscore) -> excluded from the file map.
    (prof / "_ignore.md").write_text("ignored", encoding="utf-8")
    (prof / "legal" / "terms.md").write_text("# Terms", encoding="utf-8")

    catalog = {
        "categories": [{"slug": "mugs", "name": "Mugs", "description": "d"}],
        "products": [
            {
                "slug": "mug1",
                "name": "Mug",
                "category_slug": "mugs",
                "short_description": "s",
                "long_description": "l",
                "base_price": "10.00",
                "currency": "RON",
                "stock_quantity": 3,
                "is_featured": False,
                "images": [],
                "variants": [],
            }
        ],
    }
    content = {
        "content_blocks": [
            {
                "key": "page.terms",
                "title": "Terms",
                "status": "published",
                "body_markdown_file": "legal/terms.md",
                "meta": {"version": 1},
                "lang": "en",
                "translations": [
                    # Inline body -> the body_markdown_file load is skipped.
                    {"lang": "ro", "title": "Termeni", "body_markdown": "Inline RO"}
                ],
            }
        ]
    }
    (prof / "catalog.json").write_text(_json.dumps(catalog), encoding="utf-8")
    (prof / "content_blocks.json").write_text(_json.dumps(content), encoding="utf-8")

    monkeypatch.setattr(seeds, "SEED_PROFILES_ROOT", profiles_root.resolve())

    engine = _make_engine()
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

    async def run() -> None:
        async with SessionLocal() as session:
            await seeds.seed(session, profile="custom")
            from sqlalchemy import func, select

            from app.models.content import ContentBlock

            count = await session.scalar(select(func.count()).select_from(ContentBlock))
            assert count == 1

    asyncio.run(run())


def test_main_uses_seed(monkeypatch) -> None:
    engine = _make_engine()

    monkeypatch.setattr(seeds, "create_async_engine", lambda *a, **k: engine)

    called: dict[str, object] = {}

    async def _fake_seed(session, *, profile):
        called["profile"] = profile

    monkeypatch.setattr(seeds, "seed", _fake_seed)

    asyncio.run(seeds.main("default"))
    assert called["profile"] == "default"
