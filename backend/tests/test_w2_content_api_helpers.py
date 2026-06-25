"""Unit coverage for the pure helper functions in ``app.api.v1.content``.

These helpers (auth/hidden flags, image-tag normalisation, redirect key/value
conversion, redirect-chain detection, owner/admin guard) are pure and tested
directly here. Disjoint from the endpoint-level integration suites
(``test_content_api`` / ``test_content_admin_scheduling`` /
``test_content_page_redirects``).
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.v1 import content as content_api
from app.models.user import UserRole


# --------------------------------------------------------------------------- #
# _requires_auth / _is_hidden                                                  #
# --------------------------------------------------------------------------- #
def test_requires_auth_true_false_and_non_dict_meta() -> None:
    assert content_api._requires_auth(SimpleNamespace(meta={"requires_auth": True}))
    assert not content_api._requires_auth(
        SimpleNamespace(meta={"requires_auth": False})
    )
    assert not content_api._requires_auth(SimpleNamespace(meta=None))
    assert not content_api._requires_auth(SimpleNamespace(meta=["not", "a", "dict"]))


def test_is_hidden_true_false_and_non_dict_meta() -> None:
    assert content_api._is_hidden(SimpleNamespace(meta={"hidden": True}))
    assert not content_api._is_hidden(SimpleNamespace(meta={"hidden": False}))
    assert not content_api._is_hidden(SimpleNamespace(meta=None))
    assert not content_api._is_hidden(SimpleNamespace(meta="string-meta"))


# --------------------------------------------------------------------------- #
# _normalize_image_tags                                                        #
# --------------------------------------------------------------------------- #
def test_normalize_image_tags_empty_input() -> None:
    assert content_api._normalize_image_tags([]) == []
    assert content_api._normalize_image_tags(None) == []  # type: ignore[arg-type]


def test_normalize_image_tags_lowercases_spaces_and_strips() -> None:
    assert content_api._normalize_image_tags([" Hello World "]) == ["hello-world"]


def test_normalize_image_tags_drops_blank_and_symbol_only() -> None:
    # entry that becomes empty after sanitising (symbols stripped) is dropped
    assert content_api._normalize_image_tags(["", "   ", "***", "--"]) == []


def test_normalize_image_tags_drops_too_long() -> None:
    assert content_api._normalize_image_tags(["a" * 65]) == []
    assert content_api._normalize_image_tags(["a" * 64]) == ["a" * 64]


def test_normalize_image_tags_dedupes() -> None:
    assert content_api._normalize_image_tags(["tag", "tag", "TAG"]) == ["tag"]


def test_normalize_image_tags_caps_at_ten() -> None:
    result = content_api._normalize_image_tags([f"tag{i}" for i in range(15)])
    assert len(result) == 10


def test_normalize_image_tags_keeps_alnum_dash_underscore() -> None:
    assert content_api._normalize_image_tags(["a_b-c!@#d"]) == ["a_b-cd"]


# --------------------------------------------------------------------------- #
# _require_owner_or_admin                                                      #
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("role", [UserRole.owner, UserRole.admin])
def test_require_owner_or_admin_allows(role: UserRole) -> None:
    content_api._require_owner_or_admin(SimpleNamespace(role=role))


def test_require_owner_or_admin_blocks_customer() -> None:
    with pytest.raises(HTTPException) as exc:
        content_api._require_owner_or_admin(SimpleNamespace(role=UserRole.customer))
    assert exc.value.status_code == 403


# --------------------------------------------------------------------------- #
# _redirect_key_to_display_value / _redirect_display_value_to_key             #
# --------------------------------------------------------------------------- #
def test_redirect_key_to_display_value_page_key() -> None:
    assert content_api._redirect_key_to_display_value("page.about") == "/pages/about"


def test_redirect_key_to_display_value_page_key_without_slug() -> None:
    assert content_api._redirect_key_to_display_value("page.") == "/pages/"


def test_redirect_key_to_display_value_non_page_passthrough() -> None:
    assert content_api._redirect_key_to_display_value("home") == "home"
    assert content_api._redirect_key_to_display_value("") == ""


def test_redirect_display_value_to_key_pages_path() -> None:
    assert content_api._redirect_display_value_to_key("/pages/About") == "page.about"


def test_redirect_display_value_to_key_pages_path_no_slug() -> None:
    # ``pages/`` with an empty slug -> slugify yields "" -> empty key
    assert content_api._redirect_display_value_to_key("/pages/") == ""


def test_redirect_display_value_to_key_non_pages_passthrough() -> None:
    assert content_api._redirect_display_value_to_key("home") == "home"
    assert content_api._redirect_display_value_to_key("/contact") == "/contact"


# --------------------------------------------------------------------------- #
# _redirect_chain_error                                                        #
# --------------------------------------------------------------------------- #
def test_redirect_chain_error_empty_from_key() -> None:
    assert content_api._redirect_chain_error("", {}) is None


def test_redirect_chain_error_no_chain() -> None:
    assert content_api._redirect_chain_error("a", {}) is None


def test_redirect_chain_error_simple_chain_resolves() -> None:
    assert content_api._redirect_chain_error("a", {"a": "b", "b": "c"}) is None


def test_redirect_chain_error_detects_loop() -> None:
    assert content_api._redirect_chain_error("a", {"a": "b", "b": "a"}) == "loop"


def test_redirect_chain_error_detects_too_deep() -> None:
    chain = {f"k{i}": f"k{i + 1}" for i in range(60)}
    assert content_api._redirect_chain_error("k0", chain, max_hops=5) == "too_deep"
