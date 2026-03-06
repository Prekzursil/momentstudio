from __future__ import annotations

import asyncio
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException

from app.api.v1 import catalog as catalog_api
from app.schemas.catalog import CategoryMergeResult
from app.services import catalog as catalog_service


class _RowsResult:
    def __init__(self, rows: list[tuple[UUID, UUID | None]]) -> None:
        self._rows = list(rows)

    def all(self) -> list[tuple[UUID, UUID | None]]:
        return list(self._rows)


class _ScalarValueResult:
    def __init__(self, value: object) -> None:
        self._value = value

    def scalar_one(self) -> object:
        return self._value


class _ScalarRowsResult:
    def __init__(self, rows: list[UUID]) -> None:
        self._rows = list(rows)

    def scalars(self) -> list[UUID]:
        return list(self._rows)


class _ExecuteQueueSession:
    def __init__(self, execute_results: list[object] | None = None) -> None:
        self.execute_results = list(execute_results or [])
        self.execute_calls = 0
        self.commits = 0

    async def execute(self, _stmt: object) -> object:
        await asyncio.sleep(0)
        self.execute_calls += 1
        if not self.execute_results:
            raise AssertionError("Unexpected execute() call")
        return self.execute_results.pop(0)

    async def commit(self) -> None:
        await asyncio.sleep(0)
        self.commits += 1


@pytest.mark.anyio
async def test_catalog_service_get_category_descendant_ids_dedupes_frontier_nodes() -> None:
    root_id = uuid4()
    child_id = uuid4()
    session = _ExecuteQueueSession(
        execute_results=[
            _ScalarRowsResult([child_id, child_id]),
            _ScalarRowsResult([]),
        ]
    )

    resolved = await catalog_service._get_category_descendant_ids(session, root_id)

    assert resolved == [root_id, child_id]
    assert session.execute_calls == 2


@pytest.mark.anyio
async def test_catalog_service_validate_category_parent_assignment_branches() -> None:
    category_id = uuid4()

    no_parent_session = _ExecuteQueueSession()
    await catalog_service._validate_category_parent_assignment(
        no_parent_session,
        category_id=category_id,
        parent_id=None,
    )
    assert no_parent_session.execute_calls == 0

    with pytest.raises(HTTPException, match="Category cannot be its own parent"):
        await catalog_service._validate_category_parent_assignment(
            _ExecuteQueueSession(),
            category_id=category_id,
            parent_id=category_id,
        )

    missing_parent = uuid4()
    missing_parent_session = _ExecuteQueueSession(
        execute_results=[_RowsResult([(uuid4(), None)])]
    )
    with pytest.raises(HTTPException, match="Parent category not found"):
        await catalog_service._validate_category_parent_assignment(
            missing_parent_session,
            category_id=category_id,
            parent_id=missing_parent,
        )

    parent_id = uuid4()
    cycle_to_self_session = _ExecuteQueueSession(
        execute_results=[_RowsResult([(parent_id, category_id), (category_id, None)])]
    )
    with pytest.raises(HTTPException, match="Category parent would create a cycle"):
        await catalog_service._validate_category_parent_assignment(
            cycle_to_self_session,
            category_id=category_id,
            parent_id=parent_id,
        )

    loop_a = parent_id
    loop_b = uuid4()
    invalid_hierarchy_session = _ExecuteQueueSession(
        execute_results=[_RowsResult([(loop_a, loop_b), (loop_b, loop_a)])]
    )
    with pytest.raises(HTTPException, match="Invalid category hierarchy"):
        await catalog_service._validate_category_parent_assignment(
            invalid_hierarchy_session,
            category_id=category_id,
            parent_id=loop_a,
        )

    valid_parent = uuid4()
    valid_grandparent = uuid4()
    valid_session = _ExecuteQueueSession(
        execute_results=[_RowsResult([(valid_parent, valid_grandparent), (valid_grandparent, None)])]
    )
    await catalog_service._validate_category_parent_assignment(
        valid_session,
        category_id=category_id,
        parent_id=valid_parent,
    )
    assert valid_session.execute_calls == 1


@pytest.mark.anyio
async def test_catalog_api_merge_category_lookup_and_child_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    source = SimpleNamespace(id=uuid4(), slug="source", parent_id=uuid4())
    target = SimpleNamespace(id=uuid4(), slug="target", parent_id=source.parent_id)

    async def _source_missing(_session: object, _slug: str):
        await asyncio.sleep(0)
        return None

    monkeypatch.setattr(catalog_api.catalog_service, "get_category_by_slug", _source_missing)
    with pytest.raises(HTTPException, match="Category not found"):
        await catalog_api._get_merge_source_and_target_categories(object(), "source", "target")

    async def _target_missing(_session: object, slug: str):
        await asyncio.sleep(0)
        return source if slug == "source" else None

    monkeypatch.setattr(catalog_api.catalog_service, "get_category_by_slug", _target_missing)
    with pytest.raises(HTTPException, match="Target category not found"):
        await catalog_api._get_merge_source_and_target_categories(object(), "source", "target")

    async def _both_found(_session: object, slug: str):
        await asyncio.sleep(0)
        return source if slug == "source" else target

    monkeypatch.setattr(catalog_api.catalog_service, "get_category_by_slug", _both_found)
    resolved_source, resolved_target = await catalog_api._get_merge_source_and_target_categories(object(), "source", "target")
    assert resolved_source is source
    assert resolved_target is target

    with pytest.raises(HTTPException, match="Cannot merge a category with subcategories"):
        await catalog_api._ensure_category_has_no_children(
            _ExecuteQueueSession(execute_results=[_ScalarValueResult(2)]),
            source,
        )

    await catalog_api._ensure_category_has_no_children(
        _ExecuteQueueSession(execute_results=[_ScalarValueResult(0)]),
        source,
    )


@pytest.mark.anyio
async def test_catalog_api_audit_category_merge_optional_commit(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _ExecuteQueueSession()
    current_user = SimpleNamespace(id=uuid4())
    result_model = CategoryMergeResult(source_slug="source", target_slug="target", moved_products=3)

    calls: list[dict[str, object]] = []

    async def _audit(_session: object, **kwargs: object) -> None:
        await asyncio.sleep(0)
        calls.append(kwargs)

    monkeypatch.setattr(catalog_api.audit_chain_service, "add_admin_audit_log", _audit)

    await catalog_api._audit_category_merge_if_requested(
        session,
        audit_source=None,
        current_user=current_user,
        result_model=result_model,
    )
    assert calls == []
    assert session.commits == 0

    await catalog_api._audit_category_merge_if_requested(
        session,
        audit_source="storefront",
        current_user=current_user,
        result_model=result_model,
    )
    assert len(calls) == 1
    assert calls[0]["action"] == "catalog.category.merge"
    assert calls[0]["data"]["source_slug"] == "source"
    assert session.commits == 1
