from app.services import blog as blog_service
from app.services import catalog as catalog_service


def test_catalog_search_normalization_strips_diacritics() -> None:
    assert catalog_service._normalize_search_text("Broșă Țesută") == "brosa tesuta"
    assert catalog_service._normalize_search_text("Şnur Împletit") == "snur impletit"
    assert catalog_service._normalize_search_text("  ") == ""


def test_blog_search_normalization_strips_diacritics() -> None:
    assert blog_service._normalize_search_text("Broșă artizanală") == "brosa artizanala"
    assert blog_service._normalize_search_text("Țară și știri") == "tara si stiri"
    assert blog_service._normalize_search_text(None) == ""
