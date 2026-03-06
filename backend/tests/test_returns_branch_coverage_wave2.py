from __future__ import annotations

import asyncio
import io
from datetime import datetime, timezone

from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException, UploadFile
from starlette.requests import Request

from app.api.v1 import returns as returns_api
from app.models.returns import ReturnRequestStatus


class _Session:
    def __init__(self):
        self.added = []
        self.commits = 0

    def add(self, item):
        self.added.append(item)

    async def commit(self):
        self.commits += 1


def _request() -> Request:
    return Request({'type': 'http', 'method': 'GET', 'path': '/', 'headers': []})


def _record(return_id=None, *, label_path: str | None = None):
    rid = return_id or uuid4()
    order_item = SimpleNamespace(product=SimpleNamespace(id=uuid4(), name='Product 1'))
    item = SimpleNamespace(id=uuid4(), order_item_id=uuid4(), quantity=1, order_item=order_item)
    now = datetime.now(timezone.utc)
    user = SimpleNamespace(preferred_language='en')
    return SimpleNamespace(
        id=rid,
        order_id=uuid4(),
        user_id=uuid4(),
        status=ReturnRequestStatus.requested,
        reason='reason',
        customer_message='message',
        admin_note=None,
        created_by=None,
        updated_by=None,
        created_at=now,
        updated_at=now,
        closed_at=None,
        order=SimpleNamespace(reference_code='ORD-1', customer_email='customer@example.com', customer_name='Customer Name'),
        user=user,
        items=[item],
        return_label_path=label_path,
        return_label_filename=' label.pdf ',
        return_label_uploaded_at=now,
    )


def test_return_serialization_and_filename_helpers_mask_branches(monkeypatch):
    monkeypatch.setattr(returns_api.pii_service, 'mask_email', lambda value: 'masked-email')
    monkeypatch.setattr(returns_api.pii_service, 'mask_text', lambda value, keep=1: 'masked-name')

    record = _record(label_path='labels/a.pdf')
    masked = returns_api._serialize_return_request(record, include_pii=False)
    assert masked.customer_email == 'masked-email'
    assert masked.customer_name == 'masked-name'
    assert masked.has_return_label is True
    assert masked.items[0].product_name == 'Product 1'

    unmasked = returns_api._serialize_return_request(record, include_pii=True)
    assert unmasked.customer_email == 'customer@example.com'
    assert unmasked.customer_name == 'Customer Name'

    assert returns_api._sanitize_filename(None) == 'return-label'
    assert returns_api._sanitize_filename('') == 'return-label'
    assert returns_api._sanitize_filename('  folder/sub/label.pdf  ') == 'label.pdf'
    assert len(returns_api._sanitize_filename('x' * 400)) == 255


def test_returns_admin_list_get_and_order_listing_paths(monkeypatch):
    async def _run():
        session = _Session()
        admin = SimpleNamespace(id=uuid4())
        req = _request()
        record = _record()

        pii_called = {'value': 0}

        def _pii(_admin, request=None):
            assert request is req
            pii_called['value'] += 1

        async def _list(*_args, **_kwargs):
            return [record], 1

        async def _get(_session, rid):
            if rid == record.id:
                return record
            return None

        monkeypatch.setattr(returns_api.pii_service, 'require_pii_reveal', _pii)
        monkeypatch.setattr(returns_api.returns_service, 'list_return_requests', _list)
        monkeypatch.setattr(returns_api.returns_service, 'get_return_request', _get)

        listed = await returns_api.admin_list_returns(req, session=session, admin=admin, q=None, status_filter=None, order_id=None, page=1, limit=25, include_pii=True)
        assert listed.meta.total_items == 1
        assert listed.items[0].customer_email == 'customer@example.com'

        with pytest.raises(HTTPException) as missing_exc:
            await returns_api.admin_get_return(uuid4(), req, include_pii=False, session=session, admin=admin)
        assert missing_exc.value.status_code == 404

        rows = [SimpleNamespace(id=record.id), SimpleNamespace(id=uuid4())]

        async def _list_rows(*_args, **_kwargs):
            return rows, len(rows)

        monkeypatch.setattr(returns_api.returns_service, 'list_return_requests', _list_rows)
        by_order = await returns_api.admin_list_returns_for_order(uuid4(), req, include_pii=False, session=session, admin=admin)
        assert len(by_order) == 1
        assert pii_called['value'] >= 1

    asyncio.run(_run())


def test_returns_label_upload_download_and_delete_paths(monkeypatch, tmp_path):
    async def _run():
        session = _Session()
        admin = SimpleNamespace(id=uuid4())
        req = _request()
        return_id = uuid4()
        record = _record(return_id, label_path='labels/old.pdf')
        refreshed = _record(return_id, label_path='labels/new.pdf')
        refreshed.return_label_filename = 'label.png'

        calls = {'get': 0, 'deleted': []}

        async def _get(_session, rid):
            assert rid == return_id
            calls['get'] += 1
            if calls['get'] == 1:
                return record
            if calls['get'] == 2:
                return refreshed
            return refreshed

        monkeypatch.setattr(returns_api.returns_service, 'get_return_request', _get)
        monkeypatch.setattr(returns_api.private_storage, 'save_private_upload', lambda *_args, **_kwargs: ('labels/new.pdf', '  label.png  '))
        monkeypatch.setattr(returns_api.private_storage, 'delete_private_file', lambda value: calls['deleted'].append(value))
        monkeypatch.setattr(returns_api.pii_service, 'require_pii_reveal', lambda *_args, **_kwargs: None)

        upload = UploadFile(filename='label.png', file=io.BytesIO(b'file-bytes'))
        uploaded = await returns_api.admin_upload_return_label(return_id, req, upload, include_pii=True, session=session, admin=admin)
        assert uploaded.return_label_filename == 'label.png'
        assert 'labels/old.pdf' in calls['deleted']
        assert session.commits == 1

        label_path = tmp_path / 'label.pdf'
        label_path.write_bytes(b'pdf-data')
        monkeypatch.setattr(returns_api.step_up_service, 'require_step_up', lambda *_args, **_kwargs: None)
        monkeypatch.setattr(returns_api.private_storage, 'resolve_private_path', lambda _rel: label_path)
        download = await returns_api.admin_download_return_label(return_id, req, session=session, admin=admin)
        assert download.filename == 'label.png'

        delete_record = _record(return_id, label_path='labels/new.pdf')

        async def _get_for_delete(_session, rid):
            assert rid == return_id
            return delete_record

        monkeypatch.setattr(returns_api.returns_service, 'get_return_request', _get_for_delete)
        await returns_api.admin_delete_return_label(return_id, session=session, _=admin)
        assert delete_record.return_label_path is None
        assert 'labels/new.pdf' in calls['deleted']

        async def _get_missing(_session, _rid):
            return None

        monkeypatch.setattr(returns_api.returns_service, 'get_return_request', _get_missing)
        with pytest.raises(HTTPException) as exc_missing:
            await returns_api.admin_download_return_label(return_id, req, session=session, admin=admin)
        assert exc_missing.value.status_code == 404

    asyncio.run(_run())

