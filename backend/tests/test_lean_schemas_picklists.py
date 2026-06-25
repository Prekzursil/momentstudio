"""Lean-gate unit coverage for schema validators and the pick-list builder.

Covers the remaining validator branches in ``schemas.media`` /
``schemas.content`` and the full ``services.pick_lists`` builder + CSV/PDF
renderers (pure logic over duck-typed order objects).
"""

from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.schemas.content import (
    ContentBlockCreate,
    ContentBlockUpdate,
    ContentImageEditRequest,
)
from app.schemas.media import MediaRetryPolicyRollbackRequest
from app.services import pick_lists


# --------------------------------------------------------------------------- #
# schemas.media — rollback target xor                                          #
# --------------------------------------------------------------------------- #
def test_media_rollback_accepts_preset_only() -> None:
    req = MediaRetryPolicyRollbackRequest(preset_key="factory_default")
    assert req.preset_key == "factory_default"


def test_media_rollback_accepts_event_only() -> None:
    eid = uuid4()
    assert MediaRetryPolicyRollbackRequest(event_id=eid).event_id == eid


def test_media_rollback_rejects_both() -> None:
    with pytest.raises(ValueError, match="exactly one"):
        MediaRetryPolicyRollbackRequest(preset_key="known_good", event_id=uuid4())


def test_media_rollback_rejects_neither() -> None:
    with pytest.raises(ValueError, match="exactly one"):
        MediaRetryPolicyRollbackRequest()


# --------------------------------------------------------------------------- #
# schemas.content — markdown script-tag guard                                  #
# --------------------------------------------------------------------------- #
def test_content_create_rejects_script_tag() -> None:
    with pytest.raises(ValueError, match="Script tags are not allowed"):
        ContentBlockCreate(key="k", title="t", body_markdown="hi <SCRIPT>x</script>")


def test_content_create_allows_clean_markdown() -> None:
    block = ContentBlockCreate(key="k", title="t", body_markdown="# Hello")
    assert block.body_markdown == "# Hello"


def test_content_update_rejects_script_tag() -> None:
    with pytest.raises(ValueError, match="Script tags are not allowed"):
        ContentBlockUpdate(body_markdown="<script>evil()</script>")


def test_content_update_allows_none_and_clean_body() -> None:
    assert ContentBlockUpdate(body_markdown=None).body_markdown is None
    assert ContentBlockUpdate(body_markdown="ok").body_markdown == "ok"


# --------------------------------------------------------------------------- #
# schemas.content — image-edit validators                                      #
# --------------------------------------------------------------------------- #
def test_content_edit_valid_rotate() -> None:
    assert ContentImageEditRequest(rotate_cw=90).rotate_cw == 90


def test_content_edit_rejects_bad_rotate() -> None:
    with pytest.raises(ValueError, match="rotate_cw must be one of"):
        ContentImageEditRequest(rotate_cw=45)


def test_content_edit_crop_aspect_pair_required_together() -> None:
    with pytest.raises(ValueError, match="must be provided together"):
        ContentImageEditRequest(rotate_cw=0, crop_aspect_w=16)


def test_content_edit_requires_some_edit() -> None:
    with pytest.raises(ValueError, match="No edits requested"):
        ContentImageEditRequest(rotate_cw=0)


def test_content_edit_accepts_crop_pair() -> None:
    req = ContentImageEditRequest(crop_aspect_w=16, crop_aspect_h=9)
    assert req.crop_aspect_w == 16 and req.crop_aspect_h == 9


def test_content_edit_accepts_resize_only() -> None:
    assert ContentImageEditRequest(resize_max_width=800).resize_max_width == 800


# --------------------------------------------------------------------------- #
# services.pick_lists                                                          #
# --------------------------------------------------------------------------- #
def _item(*, sku, name, variant, qty, product_id=None):
    product = SimpleNamespace(sku=sku, name=name) if (sku or name) else None
    variant_obj = SimpleNamespace(name=variant) if variant else None
    return SimpleNamespace(
        product=product,
        variant=variant_obj,
        quantity=qty,
        product_id=product_id,
    )


def _order(*, ref, items, oid=None):
    return SimpleNamespace(reference_code=ref, id=oid, items=items)


def test_build_pick_list_rows_groups_and_sums() -> None:
    orders = [
        _order(
            ref="ORD-1",
            items=[
                _item(sku="A", name="Apple", variant="Red", qty=2),
                _item(sku="A", name="Apple", variant="Red", qty=3),
                _item(sku="B", name="Banana", variant=None, qty=1),
            ],
        ),
        _order(
            ref="ORD-2",
            items=[_item(sku="A", name="Apple", variant="Red", qty=5)],
        ),
    ]
    rows = pick_lists.build_pick_list_rows(orders)
    by_key = {(r.sku, r.variant_name): r for r in rows}
    assert by_key[("A", "Red")].quantity == 10
    assert set(by_key[("A", "Red")].order_refs) == {"ORD-1", "ORD-2"}
    assert by_key[("B", None)].quantity == 1


def test_build_pick_list_rows_handles_missing_product_and_no_ref() -> None:
    # Product is None -> sku/name fall back; order has no ref or id -> "" ref.
    item = _item(sku=None, name=None, variant=None, qty=4, product_id="pid-123")
    orders = [_order(ref=None, items=[item], oid=None)]
    rows = pick_lists.build_pick_list_rows(orders)
    assert len(rows) == 1
    assert rows[0].sku == "—"
    assert rows[0].product_name == "pid-123"
    assert rows[0].order_refs == ()


def test_build_pick_list_rows_order_without_items() -> None:
    rows = pick_lists.build_pick_list_rows([_order(ref="EMPTY", items=[])])
    assert rows == []


def test_build_pick_list_rows_uses_id_when_no_reference_code() -> None:
    item = _item(sku="C", name="Cherry", variant=None, qty=1)
    orders = [_order(ref=None, items=[item], oid="id-7")]
    rows = pick_lists.build_pick_list_rows(orders)
    assert rows[0].order_refs == ("id-7",)


def test_render_pick_list_csv_round_trip() -> None:
    rows = pick_lists.build_pick_list_rows(
        [_order(ref="ORD-9", items=[_item(sku="X", name="Xeon", variant="Big", qty=2)])]
    )
    blob = pick_lists.render_pick_list_csv(rows)
    text = blob.decode("utf-8")
    assert "sku,product_name,variant,quantity,orders" in text
    assert "X,Xeon,Big,2,ORD-9" in text


def test_render_pick_list_pdf_with_orders_header() -> None:
    orders = [
        _order(ref="ORD-10", items=[_item(sku="P", name="Pen", variant=None, qty=1)])
    ]
    rows = pick_lists.build_pick_list_rows(orders)
    pdf = pick_lists.render_pick_list_pdf(rows, orders=orders, title="My List")
    assert pdf[:4] == b"%PDF"


def test_render_pick_list_pdf_without_orders() -> None:
    rows = pick_lists.build_pick_list_rows(
        [
            _order(
                ref="ORD-11", items=[_item(sku="Q", name="Quill", variant=None, qty=1)]
            )
        ]
    )
    pdf = pick_lists.render_pick_list_pdf(rows)
    assert pdf[:4] == b"%PDF"


def test_render_pick_list_pdf_orders_with_unformattable_timestamp(monkeypatch) -> None:
    # When the generated-at timestamp formats to "" the "Generated:" line is
    # skipped (the ``if created_at:`` false branch). ``datetime.now()`` always
    # formats fine in practice, so stub ``_fmt_dt`` to exercise that guard.
    monkeypatch.setattr(pick_lists, "_fmt_dt", lambda value: "")
    orders = [
        _order(ref="ORD-13", items=[_item(sku="S", name="Sun", variant=None, qty=1)])
    ]
    rows = pick_lists.build_pick_list_rows(orders)
    pdf = pick_lists.render_pick_list_pdf(rows, orders=orders)
    assert pdf[:4] == b"%PDF"


def test_render_pick_list_pdf_orders_all_blank_refs() -> None:
    # ``orders`` present but every ref is blank -> the "Orders:" line is skipped.
    blank_orders = [_order(ref="", items=[], oid=None)]
    rows = pick_lists.build_pick_list_rows(
        [_order(ref="ORD-12", items=[_item(sku="R", name="Rose", variant=None, qty=1)])]
    )
    pdf = pick_lists.render_pick_list_pdf(rows, orders=blank_orders)
    assert pdf[:4] == b"%PDF"


def test_fmt_dt_branches() -> None:
    assert pick_lists._fmt_dt(None) == ""
    assert pick_lists._fmt_dt(datetime(2024, 1, 2, 3, 4)) == "2024-01-02 03:04"

    class _BadDt:
        def strftime(self, _fmt: str) -> str:
            raise ValueError("boom")

        def __str__(self) -> str:
            return "fallback-str"

    assert pick_lists._fmt_dt(_BadDt()) == "fallback-str"  # type: ignore[arg-type]
