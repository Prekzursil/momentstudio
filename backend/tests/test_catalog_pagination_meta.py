from app.schemas.catalog import ProductListResponse, PaginationMeta


def test_product_list_response_meta_keys():
    meta = PaginationMeta(total_items=5, total_pages=1, page=1, limit=20)
    resp = ProductListResponse(items=[], meta=meta)
    assert resp.meta.total_items == 5
    assert resp.meta.page == 1
