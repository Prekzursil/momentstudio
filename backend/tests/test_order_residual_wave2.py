from __future__ import annotations

import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.services import order as order_service


class _ScalarRows:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows

    def first(self):
        return self._rows[0] if self._rows else None


class _ExecResult:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return _ScalarRows(self._rows)


class _Session:
    def __init__(self, rows=None):
        self.rows = rows or []
        self.added: list[object] = []
        self.refresh_calls: list[tuple[object, object | None]] = []

    async def execute(self, _stmt):
        await asyncio.sleep(0)
        return _ExecResult(self.rows)

    def add(self, value: object):
        self.added.append(value)

    async def refresh(self, obj, attribute_names=None):
        await asyncio.sleep(0)
        self.refresh_calls.append((obj, attribute_names))


@pytest.mark.anyio
async def test_order_residual_wave2_lock_load_and_orderable_variant_paths() -> None:
    product_id = uuid4()
    variant_id = uuid4()
    product = SimpleNamespace(id=product_id, stock_quantity=8)
    variant = SimpleNamespace(id=variant_id, product_id=product_id, stock_quantity=4)

    loaded_products = await order_service._load_locked_products(_Session([product]), {product_id})
    assert loaded_products[product_id] is product
    assert await order_service._load_locked_products(_Session(), set()) == {}

    loaded_variants = await order_service._load_orderable_variants(_Session([variant]), {variant_id})
    assert loaded_variants[variant_id] is variant

    with pytest.raises(HTTPException) as invalid_variant:
        await order_service._load_orderable_variants(_Session([variant]), {variant_id, uuid4()})
    assert invalid_variant.value.status_code == 400


@pytest.mark.anyio
async def test_order_residual_wave2_commit_restore_and_stock_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    order_id = uuid4()
    product_id = uuid4()
    variant_id = uuid4()

    session = _Session()
    order = SimpleNamespace(id=order_id)

    async def _lock(*_args, **_kwargs):
        await asyncio.sleep(0)

    async def _has_event(*_args, **_kwargs):
        await asyncio.sleep(0)
        return False

    async def _load_items(*_args, **_kwargs):
        await asyncio.sleep(0)
        return [SimpleNamespace(product_id=product_id, variant_id=variant_id, quantity=3)]

    async def _load_products(*_args, **_kwargs):
        await asyncio.sleep(0)
        return {product_id: SimpleNamespace(id=product_id, stock_quantity=5)}

    async def _load_variants(*_args, **_kwargs):
        await asyncio.sleep(0)
        return {variant_id: SimpleNamespace(id=variant_id, product_id=product_id, stock_quantity=7)}

    monkeypatch.setattr(order_service, '_lock_order_stock_row', _lock)
    monkeypatch.setattr(order_service, '_order_has_event', _has_event)
    monkeypatch.setattr(order_service, '_load_order_items_for_stock', _load_items)
    monkeypatch.setattr(order_service, '_load_locked_products', _load_products)
    monkeypatch.setattr(order_service, '_load_locked_variants', _load_variants)

    await order_service._commit_stock_for_order(session, order)
    assert session.added, 'expected stock commit event to be added'

    committed_event = SimpleNamespace(
        id=uuid4(),
        data={
            'lines': [
                {'product_id': str(product_id), 'variant_id': str(variant_id), 'deducted_qty': 2},
                {'product_id': str(product_id), 'variant_id': None, 'deducted_qty': 1},
            ]
        },
    )

    async def _get_committed(*_args, **_kwargs):
        await asyncio.sleep(0)
        return committed_event

    monkeypatch.setattr(order_service, '_get_committed_stock_event', _get_committed)
    await order_service._restore_stock_for_order(session, order)
    assert len(session.added) >= 2


@pytest.mark.anyio
async def test_order_residual_wave2_post_create_hooks_metric_failure_and_uuid_parsers(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _Session()
    order = SimpleNamespace(id=uuid4(), reference_code='R-100')

    async def _log_event(*_args, **_kwargs):
        await asyncio.sleep(0)

    monkeypatch.setattr(order_service, '_log_event', _log_event)

    def _raise_metric() -> None:
        raise RuntimeError('metric-fail')

    monkeypatch.setattr('app.core.metrics.record_order_created', _raise_metric)

    await order_service._post_create_order_hooks(session, order)
    assert len(session.refresh_calls) == 3

    assert order_service._try_uuid(None) is None
    assert order_service._try_uuid('not-a-uuid') is None

    parsed = order_service._restore_delta_from_row({'product_id': str(uuid4()), 'variant_id': 'bad-uuid', 'deducted_qty': 'x'})
    assert parsed is None

    restored = order_service._restore_qty_by_key(SimpleNamespace(data={'lines': [{'product_id': str(uuid4()), 'deducted_qty': 0}]}))
    assert restored == {}


def test_order_residual_wave2_collect_cart_targets_and_restore_apply_paths() -> None:
    product_id = uuid4()
    variant_id = uuid4()

    cart = SimpleNamespace(
        items=[
            SimpleNamespace(product_id=product_id, variant_id=variant_id, quantity=2),
            SimpleNamespace(product_id=product_id, variant_id=None, quantity=1),
            SimpleNamespace(product_id=None, variant_id=None, quantity=4),
            SimpleNamespace(product_id=product_id, variant_id=None, quantity=0),
        ]
    )

    qty_by_key, product_ids, variant_ids = order_service._collect_cart_order_targets(cart)
    assert qty_by_key[(product_id, variant_id)] == 2
    assert qty_by_key[(product_id, None)] == 1
    assert product_id in product_ids
    assert variant_id in variant_ids

    session = _Session()
    product = SimpleNamespace(id=product_id, stock_quantity=1)
    variant = SimpleNamespace(id=variant_id, product_id=product_id, stock_quantity=3)
    lines = order_service._apply_stock_restore(
        session=session,
        restore_by_key={(product_id, variant_id): 1, (product_id, None): 2},
        products={product_id: product},
        variants={variant_id: variant},
    )
    assert len(lines) == 2
    assert product.stock_quantity == 3
    assert variant.stock_quantity == 4
