import json
from decimal import Decimal

import pytest

from app import seeds


def test_load_profile_default_parses_catalog_and_content() -> None:
    categories, products, blocks = seeds._load_profile("default")

    assert categories
    assert products
    assert blocks
    assert isinstance(products[0]["base_price"], Decimal)

    legal_block = next(b for b in blocks if b["key"] == "page.terms-and-conditions")
    assert legal_block["translations"]
    assert "##" in legal_block["body_markdown"]


def test_load_profile_unknown_raises() -> None:
    with pytest.raises(SystemExit, match="Unknown seed profile"):
        seeds._load_profile("missing-profile")


def test_load_profile_rejects_profile_path_traversal() -> None:
    with pytest.raises(SystemExit, match="Unknown seed profile"):
        seeds._load_profile("../default")


def test_load_profile_rejects_markdown_path_traversal(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    root = tmp_path / "seed_profiles"
    profile_dir = root / "safe"
    profile_dir.mkdir(parents=True)

    (profile_dir / "catalog.json").write_text(json.dumps({"categories": [], "products": []}), encoding="utf-8")
    (profile_dir / "content_blocks.json").write_text(
        json.dumps(
            {
                "content_blocks": [
                    {
                        "key": "page.test",
                        "title": "Unsafe",
                        "status": "published",
                        "body_markdown_file": "../outside.md",
                        "translations": [],
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    (root / "outside.md").write_text("outside", encoding="utf-8")

    monkeypatch.setattr(seeds, "SEED_PROFILES_ROOT", root.resolve())

    with pytest.raises(SystemExit, match="Invalid path"):
        seeds._load_profile("safe")
