from __future__ import annotations

from types import SimpleNamespace

from app.services import blog as blog_service


def _block(*, title: str = 'Title', body: str = 'Body text', meta: dict | None = None) -> SimpleNamespace:
    return SimpleNamespace(title=title, body_markdown=body, meta=meta or {})


def test_slug_and_markdown_helpers() -> None:
    assert blog_service._extract_slug('blog.hello-world') == 'hello-world'
    assert blog_service._extract_slug('plain-key') == 'plain-key'

    md = """
# Heading
Some `code` and [link](https://example.com)
![image](https://example.com/img.png)
- Bullet
```ts
const a = 1
```
"""
    plain = blog_service._plain_text_from_markdown(md)
    assert 'Heading' in plain
    assert '\\1' in plain


def test_author_and_text_shape_helpers() -> None:
    author = SimpleNamespace(id='u1', name='Jane', name_tag=2, username='jane', avatar_url=None, google_picture_url='pic')
    assert blog_service._author_display(author) == 'Jane#2 (jane)'
    assert blog_service._author_public_name(author) == 'Jane'

    payload = blog_service._author_payload(author)
    assert payload == {
        'id': 'u1',
        'name': 'Jane',
        'name_tag': 2,
        'username': 'jane',
        'avatar_url': 'pic',
    }

    assert blog_service._author_display(None) is None
    assert blog_service._author_public_name(None) is None
    assert blog_service._author_payload(None) is None

    assert blog_service._excerpt('a b c', max_len=10) == 'a b c'
    assert blog_service._snippet('x y z', max_len=10) == 'x y z'
    assert blog_service._excerpt('x' * 30, max_len=10).endswith('…')
    assert blog_service._snippet('y' * 30, max_len=10).endswith('…')


def test_tag_int_and_reading_time_helpers() -> None:
    assert blog_service._normalize_tags(None) == []
    assert blog_service._normalize_tags(['One', ' one ', 'Two']) == ['One', 'Two']
    assert blog_service._normalize_tags('a, b, A') == ['a', 'b']

    assert blog_service._coerce_positive_int(3) == 3
    assert blog_service._coerce_positive_int('4') == 4
    assert blog_service._coerce_positive_int('0') is None
    assert blog_service._coerce_positive_int(True) is None

    assert blog_service._compute_reading_time_minutes('') is None
    assert blog_service._compute_reading_time_minutes('one two three') == 1


def test_meta_and_sort_helpers() -> None:
    meta = {'cover_image_url': ' https://cdn.test/image.jpg ', 'cover_fit': 'contain', 'summary': {'en': 'Summary'}}
    assert blog_service._meta_cover_image_url(meta) == 'https://cdn.test/image.jpg'
    assert blog_service._meta_cover_fit(meta) == 'contain'
    assert blog_service._meta_summary(meta, lang='en', base_lang='en') == 'Summary'

    assert blog_service._meta_cover_image_url({'cover_image': 'https://cdn.test/alt.jpg'}) == 'https://cdn.test/alt.jpg'
    assert blog_service._meta_cover_fit({'cover_fit': 'invalid'}) == 'cover'
    assert blog_service._meta_summary({'summary': 'Plain'}, lang='ro', base_lang='en') is None
    assert blog_service._meta_summary({'summary': 'Plain'}, lang='en', base_lang='en') == 'Plain'

    assert blog_service._normalize_blog_sort(' newest ') == 'newest'
    assert blog_service._normalize_blog_sort('invalid') == 'newest'
    assert blog_service._normalize_search_text('ȘȚ îâ') == 'st ia'


def test_search_filter_helpers() -> None:
    block = _block(
        title='Golden Ring',
        body='A beautiful ring for special moments',
        meta={'tags': ['Featured', 'Gift'], 'series': 'Moments'},
    )

    assert blog_service._has_search_terms('', '', '') is False
    assert blog_service._has_search_terms('ring', '', '') is True

    assert blog_service._block_matches_tag(block.meta, 'featured') is True
    assert blog_service._block_matches_tag(block.meta, 'missing') is False

    assert blog_service._block_matches_series(block.meta, 'moments') is True
    assert blog_service._block_matches_series(block.meta, 'other') is False

    assert blog_service._block_matches_query(block, 'golden') is True
    assert blog_service._block_matches_query(block, 'missing') is False

    assert blog_service._block_matches_search(block, query_text='ring', tag_text='featured', series_text='moments') is True
    assert blog_service._block_matches_search(block, query_text='ring', tag_text='missing', series_text='moments') is False

    blocks = [
        block,
        _block(title='Silver Bracelet', body='Elegant accessory', meta={'tags': ['New'], 'series': 'Shine'}),
    ]
    filtered = blog_service._filter_published_blocks(blocks, query_text='ring', tag_text='featured', series_text='moments')
    assert len(filtered) == 1
    assert filtered[0].title == 'Golden Ring'
