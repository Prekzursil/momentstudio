"""Direct-call unit coverage for ``app.services.blog`` to 100% line+branch.

These tests drive the blog service layer through an in-memory SQLite session
(no HTTP) so every helper, query branch, and error path is exercised
deterministically. ORM rows are seeded via the real models and
``app.services.auth.create_user`` (mirroring the existing API tests).
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import settings
from app.db.base import Base
from app.models.blog import (
    BlogComment,
    BlogCommentFlag,
    BlogCommentSubscription,
)
from app.models.content import (
    ContentBlock,
    ContentBlockTranslation,
    ContentImage,
    ContentStatus,
)
from app.models.user import User, UserRole
from app.schemas.user import UserCreate
from app.services import blog
from app.services.auth import create_user


# ---------------------------------------------------------------------------
# Session / seeding helpers
# ---------------------------------------------------------------------------


@pytest.fixture
def session_factory() -> async_sessionmaker:
    import app.models  # noqa: F401  (register all tables on Base.metadata)

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def _init() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_init())
    return factory


def run(factory: async_sessionmaker, coro_fn: Callable[[Any], Any]) -> Any:
    async def _wrapped() -> Any:
        async with factory() as session:
            return await coro_fn(session)

    return asyncio.run(_wrapped())


async def _make_user(
    session: Any,
    *,
    email: str,
    role: UserRole = UserRole.customer,
    name: str = "User",
) -> User:
    user = await create_user(
        session, UserCreate(email=email, password="password123", name=name)
    )
    user.role = role
    await session.commit()
    return user


async def _make_post(
    session: Any,
    *,
    slug: str,
    title: str = "Title",
    body: str = "Body text",
    status: ContentStatus = ContentStatus.published,
    meta: dict | None = None,
    published_at: datetime | None = None,
    published_until: datetime | None = None,
    author_id: Any = None,
    view_count: int = 0,
    lang: str | None = None,
) -> ContentBlock:
    block = ContentBlock(
        key=f"{blog.BLOG_KEY_PREFIX}{slug}",
        title=title,
        body_markdown=body,
        status=status,
        meta=meta,
        published_at=published_at,
        published_until=published_until,
        author_id=author_id,
        view_count=view_count,
        lang=lang,
    )
    session.add(block)
    await session.commit()
    await session.refresh(block)
    return block


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


def test_extract_slug() -> None:
    assert blog._extract_slug("blog.my-post") == "my-post"
    assert blog._extract_slug("other.key") == "other.key"


def test_apply_translation_no_lang() -> None:
    block = ContentBlock(key="blog.x", title="T", body_markdown="B")
    blog._apply_translation(block, None)  # no-op
    blog._apply_translation(block, "en")  # no translations attr -> no-op


def test_apply_translation_match_and_miss() -> None:
    block = ContentBlock(key="blog.x", title="T", body_markdown="B")
    tr_en = ContentBlockTranslation(lang="en", title="EN", body_markdown="EN body")
    block.translations = [tr_en]
    blog._apply_translation(block, "fr")  # no match -> unchanged
    assert block.title == "T"
    blog._apply_translation(block, "en")  # match
    assert block.title == "EN"


def test_plain_text_from_markdown() -> None:
    md = "# Heading\n```code```\n`inline` ![alt](img.png) [link](http://x) text"
    result = blog._plain_text_from_markdown(md)
    assert "Heading" in result
    assert "code" not in result


def test_author_display_variants() -> None:
    assert blog._author_display(None) is None
    full = User(name="Ana", username="ana", name_tag=7)
    assert blog._author_display(full) == "Ana#7 (ana)"
    only_name = User(name="Bob", username=None, name_tag=None)
    assert blog._author_display(only_name) == "Bob"
    only_username = User(name="", username="carol", name_tag=None)
    assert blog._author_display(only_username) == "carol"
    nothing = User(name="", username=None, name_tag=None)
    assert blog._author_display(nothing) is None


def test_author_public_name() -> None:
    assert blog._author_public_name(None) is None
    assert blog._author_public_name(User(name="Ana", username="ana")) == "Ana"
    assert blog._author_public_name(User(name="", username="bob")) == "bob"
    assert blog._author_public_name(User(name="", username=None)) is None


def test_author_payload() -> None:
    assert blog._author_payload(None) is None
    user = User(
        name="Ana",
        username="ana",
        name_tag=3,
        avatar_url=None,
        google_picture_url="http://g/pic",
    )
    payload = blog._author_payload(user)
    assert payload is not None
    assert payload["avatar_url"] == "http://g/pic"


def test_excerpt_and_snippet() -> None:
    assert blog._excerpt("short") == "short"
    long_body = "word " * 100
    assert blog._excerpt(long_body).endswith("…")
    assert blog._snippet("hi") == "hi"
    assert blog._snippet("x" * 200).endswith("…")


def test_normalize_tags() -> None:
    assert blog._normalize_tags(None) == []
    assert blog._normalize_tags(123) == []
    assert blog._normalize_tags(["a", "A", "", "b"]) == ["a", "b"]
    assert blog._normalize_tags("a, b ,a") == ["a", "b"]


def test_coerce_positive_int() -> None:
    assert blog._coerce_positive_int(None) is None
    assert blog._coerce_positive_int(True) is None
    assert blog._coerce_positive_int(5) == 5
    assert blog._coerce_positive_int(0) is None
    assert blog._coerce_positive_int("7") == 7
    assert blog._coerce_positive_int("0") is None
    assert blog._coerce_positive_int("abc") is None
    assert blog._coerce_positive_int(1.5) is None


def test_compute_reading_time_minutes() -> None:
    assert blog._compute_reading_time_minutes("") is None
    assert blog._compute_reading_time_minutes("one two three") == 1
    assert blog._compute_reading_time_minutes("word " * 500) == 3


def test_meta_cover_image_url() -> None:
    assert blog._meta_cover_image_url(None) is None
    assert blog._meta_cover_image_url({}) is None
    assert blog._meta_cover_image_url({"cover_image_url": "  u  "}) == "u"
    assert blog._meta_cover_image_url({"cover_image": "v"}) == "v"
    assert blog._meta_cover_image_url({"cover_image_url": 5}) is None


def test_meta_cover_fit() -> None:
    assert blog._meta_cover_fit(None) == "cover"
    assert blog._meta_cover_fit({}) == "cover"
    assert blog._meta_cover_fit({"cover_fit": "CONTAIN"}) == "contain"
    assert blog._meta_cover_fit({"cover_fit": "weird"}) == "cover"
    assert blog._meta_cover_fit({"cover_fit": 9}) == "cover"


def test_meta_summary() -> None:
    assert blog._meta_summary(None, lang="en", base_lang="ro") is None
    assert blog._meta_summary({}, lang="en", base_lang="ro") is None
    # dict summary with matching lang
    meta = {"summary": {"en": " EN summary "}}
    assert blog._meta_summary(meta, lang="en", base_lang="ro") == "EN summary"
    # dict summary, no lang -> None
    assert blog._meta_summary(meta, lang=None, base_lang="ro") is None
    # dict summary, lang present but empty value -> falls through to None
    assert (
        blog._meta_summary({"summary": {"en": "  "}}, lang="en", base_lang="ro") is None
    )
    # string summary, base lang same as requested lang
    assert (
        blog._meta_summary({"summary": " S "}, lang="ro", base_lang="ro") == "S"
    )
    # string summary, different lang -> None
    assert blog._meta_summary({"summary": "S"}, lang="en", base_lang="ro") is None
    # string summary, no lang at all -> returned
    assert blog._meta_summary({"summary": " S "}, lang=None, base_lang=None) == "S"
    # non-str non-dict summary
    assert blog._meta_summary({"summary": 5}, lang="en", base_lang="ro") is None


def test_normalize_blog_sort() -> None:
    assert blog._normalize_blog_sort(None) == "newest"
    assert blog._normalize_blog_sort("MOST_VIEWED") == "most_viewed"
    assert blog._normalize_blog_sort("bogus") == "newest"


def test_normalize_search_text() -> None:
    assert blog._normalize_search_text(None) == ""
    assert blog._normalize_search_text("  ") == ""
    assert blog._normalize_search_text("Café") == "cafe"


# ---------------------------------------------------------------------------
# to_list_item / to_read
# ---------------------------------------------------------------------------


def test_to_list_item_with_cover_and_meta(session_factory: async_sessionmaker) -> None:
    async def scenario(session: Any) -> None:
        author = await _make_user(session, email="a@x.com", name="Ana")
        block = await _make_post(
            session,
            slug="post1",
            body="word " * 50,
            meta={
                "cover_image_url": "http://img/cover.png",
                "tags": ["t1", "t2"],
                "series": " Series ",
                "reading_time_minutes": 9,
            },
            author_id=author.id,
        )
        img = ContentImage(
            content_block_id=block.id,
            url="http://img/cover.png",
            sort_order=1,
            focal_x=10,
            focal_y=20,
        )
        session.add(img)
        await session.commit()
        await session.refresh(block)
        item = blog.to_list_item(block, lang=None)
        assert item.cover_image_url == "http://img/cover.png"
        assert item.cover_focal_x == 10
        assert item.series == "Series"
        assert item.reading_time_minutes == 9
        assert item.author_name == "Ana"

    run(session_factory, scenario)


def test_to_list_item_default_cover_from_images(
    session_factory: async_sessionmaker,
) -> None:
    async def scenario(session: Any) -> None:
        block = await _make_post(session, slug="post2", meta={})
        img = ContentImage(
            content_block_id=block.id, url="http://img/first.png", sort_order=1
        )
        session.add(img)
        await session.commit()
        await session.refresh(block)
        item = blog.to_list_item(block)
        assert item.cover_image_url == "http://img/first.png"

    run(session_factory, scenario)


def test_to_list_item_no_images_no_meta(session_factory: async_sessionmaker) -> None:
    async def scenario(session: Any) -> None:
        block = await _make_post(session, slug="post3", meta=None, body="")
        item = blog.to_list_item(block)
        assert item.cover_image_url is None
        assert item.reading_time_minutes is None
        assert item.series is None

    run(session_factory, scenario)


def test_to_read(session_factory: async_sessionmaker) -> None:
    async def scenario(session: Any) -> None:
        author = await _make_user(session, email="r@x.com", name="Reader")
        block = await _make_post(
            session,
            slug="readpost",
            body="content",
            meta={"summary": "A summary", "series": "Saga"},
            author_id=author.id,
            lang="ro",
        )
        img = ContentImage(
            content_block_id=block.id, url="http://img/c.png", sort_order=1
        )
        session.add(img)
        await session.commit()
        await session.refresh(block)
        data = blog.to_read(block, lang="ro")
        assert data["summary"] == "A summary"
        assert data["cover_image_url"] == "http://img/c.png"
        assert data["author"]["name"] == "Reader"

    run(session_factory, scenario)


def test_to_read_no_cover_no_author(session_factory: async_sessionmaker) -> None:
    async def scenario(session: Any) -> None:
        block = await _make_post(session, slug="bare", meta={"series": 5})
        data = blog.to_read(block)
        assert data["cover_image_url"] is None
        assert data["author"] is None
        assert data["series"] is None

    run(session_factory, scenario)


# ---------------------------------------------------------------------------
# list_published_posts
# ---------------------------------------------------------------------------


def test_list_published_posts_sorts_and_pagination(
    session_factory: async_sessionmaker,
) -> None:
    async def scenario(session: Any) -> None:
        now = datetime.now(timezone.utc)
        await _make_post(
            session,
            slug="p-old",
            published_at=now - timedelta(days=5),
            view_count=1,
        )
        await _make_post(
            session,
            slug="p-new",
            published_at=now - timedelta(days=1),
            view_count=50,
            meta={"pinned": True, "pin_order": 1},
        )
        # A draft and a future/expired post that must be filtered out.
        await _make_post(session, slug="p-draft", status=ContentStatus.draft)
        await _make_post(
            session,
            slug="p-future",
            published_at=now + timedelta(days=1),
        )
        await _make_post(
            session,
            slug="p-expired",
            published_at=now - timedelta(days=2),
            published_until=now - timedelta(days=1),
        )

        for sort in ("newest", "oldest", "most_viewed", "most_commented"):
            blocks, total = await blog.list_published_posts(
                session, lang=None, page=1, limit=10, sort=sort
            )
            assert total == 2

        # pagination clamps and lang option
        blocks, total = await blog.list_published_posts(
            session, lang="en", page=0, limit=999
        )
        assert total == 2

    run(session_factory, scenario)


def test_list_published_posts_with_comment_sort_and_author(
    session_factory: async_sessionmaker,
) -> None:
    async def scenario(session: Any) -> None:
        now = datetime.now(timezone.utc)
        author = await _make_user(session, email="auth@x.com")
        block = await _make_post(
            session,
            slug="authored",
            published_at=now - timedelta(days=1),
            author_id=author.id,
        )
        commenter = await _make_user(session, email="c@x.com")
        session.add(
            BlogComment(
                content_block_id=block.id, user_id=commenter.id, body="nice"
            )
        )
        await session.commit()
        blocks, total = await blog.list_published_posts(
            session,
            lang=None,
            page=1,
            limit=10,
            sort="most_commented",
            author_id=author.id,
        )
        assert total == 1

    run(session_factory, scenario)


def test_list_published_posts_text_filters(
    session_factory: async_sessionmaker,
) -> None:
    async def scenario(session: Any) -> None:
        now = datetime.now(timezone.utc)
        await _make_post(
            session,
            slug="match",
            title="Romania travel",
            body="Visiting Bucharest",
            published_at=now - timedelta(days=1),
            meta={"tags": ["Travel"], "series": "Europe"},
        )
        await _make_post(
            session,
            slug="nomatch",
            title="Cooking",
            body="recipes",
            published_at=now - timedelta(days=1),
            meta={"tags": ["food"], "series": "Kitchen"},
        )

        # query match
        items, total = await blog.list_published_posts(
            session, lang="en", page=1, limit=10, q="bucharest"
        )
        assert total == 1
        # tag filter excludes non-matching
        items, total = await blog.list_published_posts(
            session, lang=None, page=1, limit=10, tag="travel"
        )
        assert total == 1
        # series filter
        items, total = await blog.list_published_posts(
            session, lang=None, page=1, limit=10, series="europe"
        )
        assert total == 1
        # series filter on a post whose meta series is missing/non-str
        items, total = await blog.list_published_posts(
            session, lang=None, page=1, limit=10, series="nonexistent"
        )
        assert total == 0
        # query that matches nothing
        items, total = await blog.list_published_posts(
            session, lang=None, page=1, limit=10, q="zzzznope"
        )
        assert total == 0
        # tag that matches nothing
        items, total = await blog.list_published_posts(
            session, lang=None, page=1, limit=10, tag="zzzz"
        )
        assert total == 0
        # most_commented sort WITH a text filter -> exercises the comment_counts
        # outerjoin on the search-text query path (line 315) and lang option.
        items, total = await blog.list_published_posts(
            session,
            lang="en",
            page=1,
            limit=10,
            tag="travel",
            sort="most_commented",
        )
        assert total == 1

    run(session_factory, scenario)


# ---------------------------------------------------------------------------
# get_published_post / get_post_neighbors
# ---------------------------------------------------------------------------


def test_get_published_post(session_factory: async_sessionmaker) -> None:
    async def scenario(session: Any) -> None:
        now = datetime.now(timezone.utc)
        block = await _make_post(
            session, slug="found", published_at=now - timedelta(days=1)
        )
        tr = ContentBlockTranslation(
            content_block_id=block.id, lang="en", title="EN", body_markdown="EN"
        )
        session.add(tr)
        await session.commit()
        session.expire_all()
        result = await blog.get_published_post(session, slug="found", lang="en")
        assert result is not None
        assert result.title == "EN"
        missing = await blog.get_published_post(session, slug="ghost", lang=None)
        assert missing is None

    run(session_factory, scenario)


def test_get_post_neighbors(session_factory: async_sessionmaker) -> None:
    async def scenario(session: Any) -> None:
        now = datetime.now(timezone.utc)
        await _make_post(
            session, slug="older", published_at=now - timedelta(days=3)
        )
        current = await _make_post(
            session, slug="current", published_at=now - timedelta(days=2)
        )
        await _make_post(
            session, slug="newer", published_at=now - timedelta(days=1)
        )
        tr = ContentBlockTranslation(
            content_block_id=current.id, lang="en", title="C", body_markdown="C"
        )
        session.add(tr)
        await session.commit()
        session.expire_all()
        newer, older = await blog.get_post_neighbors(
            session, slug="current", lang="en"
        )
        assert newer is not None and older is not None
        assert blog._extract_slug(newer.key) == "newer"
        assert blog._extract_slug(older.key) == "older"

    run(session_factory, scenario)


def test_get_post_neighbors_missing(session_factory: async_sessionmaker) -> None:
    async def scenario(session: Any) -> None:
        newer, older = await blog.get_post_neighbors(
            session, slug="ghost", lang=None
        )
        assert newer is None and older is None

    run(session_factory, scenario)


def test_get_post_neighbors_no_lang_and_edges(
    session_factory: async_sessionmaker,
) -> None:
    async def scenario(session: Any) -> None:
        now = datetime.now(timezone.utc)
        # Only one post: current is both the newest and oldest -> no neighbors.
        await _make_post(
            session, slug="solo", published_at=now - timedelta(days=2)
        )
        # lang=None -> skips translation branches (408->411, 430->435).
        newer, older = await blog.get_post_neighbors(
            session, slug="solo", lang=None
        )
        assert newer is None and older is None

        # Two posts: an older neighbor exists but no newer one, with lang set
        # so the newer-None / older-present sub-branches are taken (431->433).
        await _make_post(
            session, slug="prev", published_at=now - timedelta(days=3)
        )
        newer, older = await blog.get_post_neighbors(
            session, slug="solo", lang="en"
        )
        assert newer is None
        assert older is not None

        # Now query from the oldest post: a newer neighbor exists but no older
        # one, with lang set so the older-None sub-branch is taken (433->435).
        newer2, older2 = await blog.get_post_neighbors(
            session, slug="prev", lang="en"
        )
        assert newer2 is not None
        assert older2 is None

    run(session_factory, scenario)


# ---------------------------------------------------------------------------
# Comments: list / threads / user comments
# ---------------------------------------------------------------------------


def test_list_comments(session_factory: async_sessionmaker) -> None:
    async def scenario(session: Any) -> None:
        author = await _make_user(session, email="cu@x.com")
        block = await _make_post(session, slug="cpost")
        session.add(
            BlogComment(content_block_id=block.id, user_id=author.id, body="one")
        )
        await session.commit()
        items, total = await blog.list_comments(
            session, content_block_id=block.id, page=0, limit=999
        )
        assert total == 1
        assert items[0].body == "one"

    run(session_factory, scenario)


def test_list_comment_threads_all_sorts(
    session_factory: async_sessionmaker,
) -> None:
    async def scenario(session: Any) -> None:
        author = await _make_user(session, email="t@x.com")
        block = await _make_post(session, slug="tpost")
        root = BlogComment(
            content_block_id=block.id, user_id=author.id, body="root"
        )
        session.add(root)
        await session.commit()
        await session.refresh(root)
        reply = BlogComment(
            content_block_id=block.id,
            user_id=author.id,
            body="reply",
            parent_id=root.id,
        )
        session.add(reply)
        await session.commit()
        for sort in ("newest", "oldest", "top"):
            threads, total_threads, total_comments = (
                await blog.list_comment_threads(
                    session,
                    content_block_id=block.id,
                    page=1,
                    limit=10,
                    sort=sort,
                )
            )
            assert total_threads == 1
            assert total_comments == 2
            assert threads[0][1][0].body == "reply"

    run(session_factory, scenario)


def test_list_comment_threads_empty(session_factory: async_sessionmaker) -> None:
    async def scenario(session: Any) -> None:
        block = await _make_post(session, slug="emptythreads")
        threads, t_threads, t_comments = await blog.list_comment_threads(
            session, content_block_id=block.id, page=1, limit=10
        )
        assert threads == []

    run(session_factory, scenario)


def test_list_user_comments(session_factory: async_sessionmaker) -> None:
    async def scenario(session: Any) -> None:
        commenter = await _make_user(session, email="uc@x.com", name="Carl")
        other = await _make_user(session, email="other@x.com", name="Otto")
        block = await _make_post(session, slug="ucpost", lang="ro")
        tr = ContentBlockTranslation(
            content_block_id=block.id, lang="en", title="EN", body_markdown="EN"
        )
        session.add(tr)
        # A parent comment by `other`, replied to by `commenter`.
        parent = BlogComment(
            content_block_id=block.id, user_id=other.id, body="parent text"
        )
        session.add(parent)
        await session.commit()
        await session.refresh(parent)
        my_comment = BlogComment(
            content_block_id=block.id,
            user_id=commenter.id,
            body="my reply",
            parent_id=parent.id,
        )
        session.add(my_comment)
        await session.commit()
        await session.refresh(my_comment)
        # Two replies to my_comment: reply_counts > 1 and the second reply hits
        # the ``parent_id in last_replies`` short-circuit (710->708 false branch).
        session.add(
            BlogComment(
                content_block_id=block.id,
                user_id=other.id,
                body="reply to mine",
                parent_id=my_comment.id,
            )
        )
        session.add(
            BlogComment(
                content_block_id=block.id,
                user_id=other.id,
                body="another reply to mine",
                parent_id=my_comment.id,
            )
        )
        # A deleted comment by commenter (status branch).
        deleted = BlogComment(
            content_block_id=block.id,
            user_id=commenter.id,
            body="gone",
            is_deleted=True,
        )
        session.add(deleted)
        await session.commit()

        items, total = await blog.list_user_comments(
            session, user_id=commenter.id, lang="en", page=1, limit=10
        )
        assert total == 2
        statuses = {i["status"] for i in items}
        assert "deleted" in statuses
        my_item = next(i for i in items if i["body"] == "my reply")
        assert my_item["parent"]["author_name"] is not None
        assert my_item["last_reply"] is not None
        assert my_item["reply_count"] == 2

    run(session_factory, scenario)


def test_list_user_comments_hidden_status_and_no_lang(
    session_factory: async_sessionmaker,
) -> None:
    async def scenario(session: Any) -> None:
        commenter = await _make_user(session, email="hc@x.com")
        block = await _make_post(session, slug="hcpost")
        hidden = BlogComment(
            content_block_id=block.id,
            user_id=commenter.id,
            body="secret",
            is_hidden=True,
        )
        session.add(hidden)
        await session.commit()
        items, total = await blog.list_user_comments(
            session, user_id=commenter.id, lang=None, page=1, limit=10
        )
        assert total == 1
        assert items[0]["status"] == "hidden"
        assert items[0]["body"] == ""

    run(session_factory, scenario)


def test_list_user_comments_empty(session_factory: async_sessionmaker) -> None:
    async def scenario(session: Any) -> None:
        user = await _make_user(session, email="none@x.com")
        items, total = await blog.list_user_comments(
            session, user_id=user.id, lang="en", page=1, limit=10
        )
        assert total == 0
        assert items == []

    run(session_factory, scenario)


# ---------------------------------------------------------------------------
# create_comment
# ---------------------------------------------------------------------------


def test_create_comment_empty_body(session_factory: async_sessionmaker) -> None:
    async def scenario(session: Any) -> None:
        user = await _make_user(session, email="e@x.com")
        block = await _make_post(session, slug="cc1")
        with pytest.raises(HTTPException) as exc:
            await blog.create_comment(
                session, content_block_id=block.id, user=user, body="   "
            )
        assert exc.value.status_code == 400

    run(session_factory, scenario)


def test_create_comment_invalid_parent(
    session_factory: async_sessionmaker,
) -> None:
    async def scenario(session: Any) -> None:
        import uuid

        user = await _make_user(session, email="ip@x.com")
        block = await _make_post(session, slug="cc2")
        with pytest.raises(HTTPException) as exc:
            await blog.create_comment(
                session,
                content_block_id=block.id,
                user=user,
                body="hi",
                parent_id=uuid.uuid4(),
            )
        assert "parent" in str(exc.value.detail)

    run(session_factory, scenario)


def test_create_comment_too_many_links(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def scenario(session: Any) -> None:
        monkeypatch.setattr(settings, "blog_comments_max_links", 1)
        user = await _make_user(session, email="lk@x.com")
        block = await _make_post(session, slug="cc3")
        with pytest.raises(HTTPException) as exc:
            await blog.create_comment(
                session,
                content_block_id=block.id,
                user=user,
                body="http://a.com http://b.com",
            )
        assert "links" in str(exc.value.detail)

    run(session_factory, scenario)


def test_create_comment_rate_limited(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def scenario(session: Any) -> None:
        monkeypatch.setattr(settings, "blog_comments_rate_limit_count", 1)
        monkeypatch.setattr(settings, "blog_comments_rate_limit_window_seconds", 3600)
        user = await _make_user(session, email="rl@x.com", role=UserRole.customer)
        block = await _make_post(session, slug="cc4")
        await blog.create_comment(
            session, content_block_id=block.id, user=user, body="first"
        )
        with pytest.raises(HTTPException) as exc:
            await blog.create_comment(
                session, content_block_id=block.id, user=user, body="second"
            )
        assert exc.value.status_code == 429

    run(session_factory, scenario)


def test_create_comment_admin_bypasses_rate_limit(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def scenario(session: Any) -> None:
        monkeypatch.setattr(settings, "blog_comments_rate_limit_count", 1)
        monkeypatch.setattr(settings, "blog_comments_rate_limit_window_seconds", 3600)
        admin = await _make_user(session, email="ad@x.com", role=UserRole.admin)
        block = await _make_post(session, slug="cc5")
        root = await blog.create_comment(
            session, content_block_id=block.id, user=admin, body="root"
        )
        # valid parent path + admin bypass
        reply = await blog.create_comment(
            session,
            content_block_id=block.id,
            user=admin,
            body="reply",
            parent_id=root.id,
        )
        assert reply.parent_id == root.id

    run(session_factory, scenario)


def test_create_comment_rate_limit_disabled(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def scenario(session: Any) -> None:
        # window/count zero -> rate limit block skipped entirely
        monkeypatch.setattr(settings, "blog_comments_rate_limit_count", 0)
        monkeypatch.setattr(settings, "blog_comments_rate_limit_window_seconds", 0)
        user = await _make_user(session, email="off@x.com")
        block = await _make_post(session, slug="cc6")
        c = await blog.create_comment(
            session, content_block_id=block.id, user=user, body="ok"
        )
        assert c.body == "ok"

    run(session_factory, scenario)


# ---------------------------------------------------------------------------
# soft_delete_comment
# ---------------------------------------------------------------------------


def test_soft_delete_comment_not_found(
    session_factory: async_sessionmaker,
) -> None:
    async def scenario(session: Any) -> None:
        import uuid

        actor = await _make_user(session, email="sd@x.com")
        with pytest.raises(HTTPException) as exc:
            await blog.soft_delete_comment(
                session, comment_id=uuid.uuid4(), actor=actor
            )
        assert exc.value.status_code == 404

    run(session_factory, scenario)


def test_soft_delete_comment_forbidden(
    session_factory: async_sessionmaker,
) -> None:
    async def scenario(session: Any) -> None:
        owner = await _make_user(session, email="o@x.com")
        other = await _make_user(session, email="oo@x.com")
        block = await _make_post(session, slug="sd2")
        comment = BlogComment(
            content_block_id=block.id, user_id=owner.id, body="mine"
        )
        session.add(comment)
        await session.commit()
        await session.refresh(comment)
        with pytest.raises(HTTPException) as exc:
            await blog.soft_delete_comment(
                session, comment_id=comment.id, actor=other
            )
        assert exc.value.status_code == 403

    run(session_factory, scenario)


def test_soft_delete_comment_owner_and_idempotent(
    session_factory: async_sessionmaker,
) -> None:
    async def scenario(session: Any) -> None:
        owner = await _make_user(session, email="own@x.com")
        block = await _make_post(session, slug="sd3")
        comment = BlogComment(
            content_block_id=block.id, user_id=owner.id, body="mine"
        )
        session.add(comment)
        await session.commit()
        await session.refresh(comment)
        await blog.soft_delete_comment(
            session, comment_id=comment.id, actor=owner
        )
        await session.refresh(comment)
        assert comment.is_deleted is True
        # second call returns early (already deleted)
        await blog.soft_delete_comment(
            session, comment_id=comment.id, actor=owner
        )

    run(session_factory, scenario)


# ---------------------------------------------------------------------------
# to_comment_read / to_flag_read / to_comment_admin_read
# ---------------------------------------------------------------------------


def test_to_comment_read(session_factory: async_sessionmaker) -> None:
    async def scenario(session: Any) -> None:
        author = await _make_user(session, email="cr@x.com", name="Cara")
        block = await _make_post(session, slug="cr1")
        comment = BlogComment(
            content_block_id=block.id, user_id=author.id, body="visible"
        )
        session.add(comment)
        await session.commit()
        await session.refresh(comment, attribute_names=["author"])
        data = blog.to_comment_read(comment)
        assert data["body"] == "visible"
        assert data["author"]["name"] == "Cara"

    run(session_factory, scenario)


def test_to_comment_read_hidden_no_author() -> None:
    comment = BlogComment(
        content_block_id=None,
        user_id=None,
        body="secret",
        is_hidden=True,
    )
    comment.author = None
    data = blog.to_comment_read(comment)
    assert data["body"] == ""
    assert data["author"]["name"] is None


def test_to_flag_read() -> None:
    flag = BlogCommentFlag(reason="spam")
    data = blog.to_flag_read(flag)
    assert data["reason"] == "spam"


def test_to_comment_admin_read(session_factory: async_sessionmaker) -> None:
    async def scenario(session: Any) -> None:
        author = await _make_user(session, email="ar@x.com", name="Ada")
        block = await _make_post(session, slug="ar1")
        comment = BlogComment(
            content_block_id=block.id,
            user_id=author.id,
            body="visible",
            is_deleted=True,
        )
        session.add(comment)
        await session.commit()
        await session.refresh(comment, attribute_names=["author"])
        flag = BlogCommentFlag(comment_id=comment.id, user_id=author.id, reason="x")
        data = blog.to_comment_admin_read(
            comment, post_key="blog.ar1", flags=[flag], flag_count=1
        )
        assert data["post_slug"] == "ar1"
        assert data["body"] == ""  # deleted -> empty
        assert data["flag_count"] == 1
        assert len(data["flags"]) == 1

    run(session_factory, scenario)


# ---------------------------------------------------------------------------
# flag_comment
# ---------------------------------------------------------------------------


def test_flag_comment_not_found(session_factory: async_sessionmaker) -> None:
    async def scenario(session: Any) -> None:
        import uuid

        actor = await _make_user(session, email="fn@x.com")
        with pytest.raises(HTTPException) as exc:
            await blog.flag_comment(session, comment_id=uuid.uuid4(), actor=actor)
        assert exc.value.status_code == 404

    run(session_factory, scenario)


def test_flag_comment_own(session_factory: async_sessionmaker) -> None:
    async def scenario(session: Any) -> None:
        actor = await _make_user(session, email="fo@x.com")
        block = await _make_post(session, slug="fo1")
        comment = BlogComment(
            content_block_id=block.id, user_id=actor.id, body="mine"
        )
        session.add(comment)
        await session.commit()
        await session.refresh(comment)
        with pytest.raises(HTTPException) as exc:
            await blog.flag_comment(session, comment_id=comment.id, actor=actor)
        assert "own comment" in str(exc.value.detail)

    run(session_factory, scenario)


def test_flag_comment_new_and_existing(
    session_factory: async_sessionmaker,
) -> None:
    async def scenario(session: Any) -> None:
        owner = await _make_user(session, email="fco@x.com")
        flagger = await _make_user(session, email="fcf@x.com")
        block = await _make_post(session, slug="fc1")
        comment = BlogComment(
            content_block_id=block.id, user_id=owner.id, body="post"
        )
        session.add(comment)
        await session.commit()
        await session.refresh(comment)
        first = await blog.flag_comment(
            session, comment_id=comment.id, actor=flagger, reason="  spam  "
        )
        assert first.reason == "spam"
        # second flag by same user returns existing
        second = await blog.flag_comment(
            session, comment_id=comment.id, actor=flagger
        )
        assert second.id == first.id

    run(session_factory, scenario)


# ---------------------------------------------------------------------------
# list_flagged_comments
# ---------------------------------------------------------------------------


def test_list_flagged_comments_empty(session_factory: async_sessionmaker) -> None:
    async def scenario(session: Any) -> None:
        items, total = await blog.list_flagged_comments(
            session, page=1, limit=10
        )
        assert items == []
        assert total == 0

    run(session_factory, scenario)


def test_list_flagged_comments_populated(
    session_factory: async_sessionmaker,
) -> None:
    async def scenario(session: Any) -> None:
        owner = await _make_user(session, email="lfo@x.com")
        flagger = await _make_user(session, email="lff@x.com")
        block = await _make_post(session, slug="lf1")
        comment = BlogComment(
            content_block_id=block.id, user_id=owner.id, body="bad"
        )
        session.add(comment)
        await session.commit()
        await session.refresh(comment)
        session.add(
            BlogCommentFlag(
                comment_id=comment.id, user_id=flagger.id, reason="spam"
            )
        )
        await session.commit()
        items, total = await blog.list_flagged_comments(
            session, page=0, limit=999
        )
        assert total == 1
        assert items[0]["flag_count"] == 1

    run(session_factory, scenario)


# ---------------------------------------------------------------------------
# set_comment_hidden
# ---------------------------------------------------------------------------


def test_set_comment_hidden_forbidden(
    session_factory: async_sessionmaker,
) -> None:
    async def scenario(session: Any) -> None:
        import uuid

        actor = await _make_user(session, email="sh@x.com", role=UserRole.customer)
        with pytest.raises(HTTPException) as exc:
            await blog.set_comment_hidden(
                session, comment_id=uuid.uuid4(), actor=actor, hidden=True
            )
        assert exc.value.status_code == 403

    run(session_factory, scenario)


def test_set_comment_hidden_not_found(
    session_factory: async_sessionmaker,
) -> None:
    async def scenario(session: Any) -> None:
        import uuid

        actor = await _make_user(session, email="shn@x.com", role=UserRole.admin)
        with pytest.raises(HTTPException) as exc:
            await blog.set_comment_hidden(
                session, comment_id=uuid.uuid4(), actor=actor, hidden=True
            )
        assert exc.value.status_code == 404

    run(session_factory, scenario)


def test_set_comment_hidden_toggle(session_factory: async_sessionmaker) -> None:
    async def scenario(session: Any) -> None:
        admin = await _make_user(session, email="sht@x.com", role=UserRole.admin)
        owner = await _make_user(session, email="shto@x.com")
        block = await _make_post(session, slug="sh1")
        comment = BlogComment(
            content_block_id=block.id, user_id=owner.id, body="x"
        )
        session.add(comment)
        await session.commit()
        await session.refresh(comment)
        flagger = await _make_user(session, email="shtf@x.com")
        session.add(
            BlogCommentFlag(
                comment_id=comment.id, user_id=flagger.id, reason="r"
            )
        )
        await session.commit()

        hidden = await blog.set_comment_hidden(
            session, comment_id=comment.id, actor=admin, hidden=True, reason=" why "
        )
        assert hidden.is_hidden is True
        assert hidden.hidden_reason == "why"
        shown = await blog.set_comment_hidden(
            session, comment_id=comment.id, actor=admin, hidden=False
        )
        assert shown.is_hidden is False

    run(session_factory, scenario)


# ---------------------------------------------------------------------------
# resolve_comment_flags
# ---------------------------------------------------------------------------


def test_resolve_comment_flags_forbidden(
    session_factory: async_sessionmaker,
) -> None:
    async def scenario(session: Any) -> None:
        import uuid

        actor = await _make_user(session, email="rf@x.com", role=UserRole.customer)
        with pytest.raises(HTTPException) as exc:
            await blog.resolve_comment_flags(
                session, comment_id=uuid.uuid4(), actor=actor
            )
        assert exc.value.status_code == 403

    run(session_factory, scenario)


def test_resolve_comment_flags_count(session_factory: async_sessionmaker) -> None:
    async def scenario(session: Any) -> None:
        admin = await _make_user(session, email="rfa@x.com", role=UserRole.admin)
        owner = await _make_user(session, email="rfo@x.com")
        flagger = await _make_user(session, email="rff@x.com")
        block = await _make_post(session, slug="rf1")
        comment = BlogComment(
            content_block_id=block.id, user_id=owner.id, body="x"
        )
        session.add(comment)
        await session.commit()
        await session.refresh(comment)
        session.add(
            BlogCommentFlag(
                comment_id=comment.id, user_id=flagger.id, reason="r"
            )
        )
        await session.commit()
        count = await blog.resolve_comment_flags(
            session, comment_id=comment.id, actor=admin
        )
        assert count == 1

    run(session_factory, scenario)


# ---------------------------------------------------------------------------
# subscription helpers
# ---------------------------------------------------------------------------


def test_subscription_recipients(session_factory: async_sessionmaker) -> None:
    async def scenario(session: Any) -> None:
        block = await _make_post(session, slug="sub1")
        sub_user = await _make_user(session, email="subu@x.com")
        sub_user.email_verified = True
        await session.commit()
        session.add(
            BlogCommentSubscription(
                content_block_id=block.id, user_id=sub_user.id
            )
        )
        await session.commit()
        recipients = await blog.list_comment_subscription_recipients(
            session, content_block_id=block.id
        )
        assert len(recipients) == 1

    run(session_factory, scenario)


def test_is_comment_subscription_enabled(
    session_factory: async_sessionmaker,
) -> None:
    async def scenario(session: Any) -> None:
        block = await _make_post(session, slug="sub2")
        user = await _make_user(session, email="ise@x.com")
        assert (
            await blog.is_comment_subscription_enabled(
                session, content_block_id=block.id, user_id=user.id
            )
            is False
        )
        session.add(
            BlogCommentSubscription(
                content_block_id=block.id, user_id=user.id
            )
        )
        await session.commit()
        assert (
            await blog.is_comment_subscription_enabled(
                session, content_block_id=block.id, user_id=user.id
            )
            is True
        )

    run(session_factory, scenario)


def test_set_comment_subscription_full_cycle(
    session_factory: async_sessionmaker,
) -> None:
    async def scenario(session: Any) -> None:
        block = await _make_post(session, slug="sub3")
        user = await _make_user(session, email="scs@x.com")

        # enable: no existing -> create
        assert (
            await blog.set_comment_subscription(
                session,
                content_block_id=block.id,
                user_id=user.id,
                enabled=True,
            )
            is True
        )
        # enable again: existing & active -> early return True
        assert (
            await blog.set_comment_subscription(
                session,
                content_block_id=block.id,
                user_id=user.id,
                enabled=True,
            )
            is True
        )
        # disable: existing & active -> set unsubscribed
        assert (
            await blog.set_comment_subscription(
                session,
                content_block_id=block.id,
                user_id=user.id,
                enabled=False,
            )
            is False
        )
        # enable: existing but unsubscribed -> reactivate
        assert (
            await blog.set_comment_subscription(
                session,
                content_block_id=block.id,
                user_id=user.id,
                enabled=True,
            )
            is True
        )

    run(session_factory, scenario)


def test_set_comment_subscription_disable_when_absent(
    session_factory: async_sessionmaker,
) -> None:
    async def scenario(session: Any) -> None:
        block = await _make_post(session, slug="sub4")
        user = await _make_user(session, email="dna@x.com")
        # disable with no existing subscription -> returns False, no-op
        assert (
            await blog.set_comment_subscription(
                session,
                content_block_id=block.id,
                user_id=user.id,
                enabled=False,
            )
            is False
        )

    run(session_factory, scenario)
