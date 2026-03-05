from __future__ import annotations

import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import BackgroundTasks, HTTPException, status

from app.api.v1 import coupons as coupons_api


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one(self):
        return self._value


class _Session:
    def __init__(self, *, coupon=None, promotion=None, bind=object()):
        self._coupon = coupon
        self._promotion = promotion
        self.bind = bind
        self.added: list[object] = []

    async def get(self, model, _id):
        if model is coupons_api.Coupon:
            return self._coupon
        if model is coupons_api.Promotion:
            return self._promotion
        return None

    async def execute(self, _stmt):
        await asyncio.sleep(0)
        return _ScalarResult(5)

    async def commit(self):
        await asyncio.sleep(0)

    async def refresh(self, obj, attribute_names=None):
        await asyncio.sleep(0)
        return obj

    def add(self, obj):
        self.added.append(obj)


@pytest.mark.anyio
async def test_admin_list_assignments_and_create_coupon_guard_branches() -> None:
    missing_session = _Session(coupon=None)
    with pytest.raises(HTTPException) as list_err:
        await coupons_api.admin_list_coupon_assignments(uuid4(), missing_session, object())
    assert list_err.value.status_code == status.HTTP_404_NOT_FOUND

    missing_promo_session = _Session(coupon=SimpleNamespace(id=uuid4()), promotion=None)
    payload = SimpleNamespace(
        promotion_id=uuid4(),
        code='x' * 60,
        visibility='private',
        is_active=True,
        starts_at=None,
        ends_at=None,
        global_max_redemptions=None,
        per_customer_max_redemptions=None,
    )
    with pytest.raises(HTTPException) as create_err:
        await coupons_api.admin_create_coupon(payload, missing_promo_session, object())
    assert create_err.value.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.anyio
async def test_preview_segment_revoke_bucketed_tracks_not_assigned_and_already_revoked(monkeypatch: pytest.MonkeyPatch) -> None:
    user_a = uuid4()
    user_b = uuid4()
    rows_round_1 = [(user_a, 'a@example.com'), (user_b, 'b@example.com')]
    calls = {'n': 0}

    async def _batch(_session, *, filters, last_id):
        await asyncio.sleep(0)
        calls['n'] += 1
        if calls['n'] == 1:
            return rows_round_1
        return []

    monkeypatch.setattr(coupons_api, '_segment_user_batch', _batch)
    monkeypatch.setattr(coupons_api, '_bucket_preview_rows', lambda rows, *, bucket: rows)

    async def _status(*_args, **_kwargs):
        await asyncio.sleep(0)
        return {user_b: object()}

    monkeypatch.setattr(coupons_api, '_coupon_assignment_status_by_user_id', _status)

    preview = await coupons_api._preview_segment_revoke_bucketed(
        _Session(coupon=SimpleNamespace(id=uuid4())),
        coupon_id=uuid4(),
        filters=[],
        bucket=SimpleNamespace(total=2, index=0, seed='seed'),
    )
    assert preview.total_candidates == 2
    assert preview.not_assigned == 1
    assert preview.already_revoked == 1


@pytest.mark.anyio
async def test_initialize_counters_and_enqueue_assign_notifications_branching(monkeypatch: pytest.MonkeyPatch) -> None:
    job = SimpleNamespace(total_candidates=0, processed=9, created=9, restored=9, already_active=9, revoked=9, already_revoked=9, not_assigned=9)
    await coupons_api._initialize_bulk_job_counters(_Session(), job=job, filters=[], bucket=None)
    assert job.total_candidates == 5
    assert (job.processed, job.created, job.restored, job.already_active) == (0, 0, 0, 0)

    tasks = BackgroundTasks()
    coupon = SimpleNamespace(
        code='SAVE10',
        promotion=SimpleNamespace(name='Promo', description='Desc'),
        ends_at=None,
    )
    user = SimpleNamespace(id=uuid4(), email='ok@example.com', notify_marketing=True, preferred_language='ro')
    coupons_api._enqueue_bulk_assign_notifications(
        background_tasks=tasks,
        coupon=coupon,
        users_by_email={'ok@example.com': user},
        notify_user_ids={user.id},
    )
    assert len(tasks.tasks) == 1


@pytest.mark.anyio
async def test_run_bulk_segment_batches_continue_then_stop(monkeypatch: pytest.MonkeyPatch) -> None:
    job = SimpleNamespace(coupon_id=uuid4())
    calls = {'n': 0}

    async def _finish(_session, *, job):
        await asyncio.sleep(0)
        return False

    async def _rows(_session, *, filters, last_id):
        await asyncio.sleep(0)
        calls['n'] += 1
        if calls['n'] == 1:
            return [(uuid4(), 'a@example.com', 'en')]
        return [(uuid4(), 'b@example.com', 'en')]

    monkeypatch.setattr(coupons_api, '_finish_bulk_job_if_cancelled', _finish)
    monkeypatch.setattr(coupons_api, '_segment_user_batch_with_language', _rows)
    monkeypatch.setattr(coupons_api, '_bucket_job_rows', lambda rows, *, bucket: [] if calls['n'] == 1 else rows)

    async def _process(*_args, **_kwargs):
        await asyncio.sleep(0)
        return True

    monkeypatch.setattr(coupons_api, '_process_bulk_segment_batch', _process)

    stopped = await coupons_api._run_bulk_segment_batches(
        _Session(),
        job=job,
        bucket=SimpleNamespace(total=2, index=0, seed='x'),
        filters=[],
        context=SimpleNamespace(),
        now=coupons_api.datetime.now(coupons_api.timezone.utc),
        revoke_reason=None,
        revoke_notify_reason=None,
    )
    assert stopped is True


@pytest.mark.anyio
async def test_preview_and_start_segment_jobs_validation_and_engine_guard(monkeypatch: pytest.MonkeyPatch) -> None:
    coupon = SimpleNamespace(id=uuid4())
    session = _Session(coupon=coupon, bind=None)

    payload = SimpleNamespace(
        bucket_total=2,
        bucket_index=0,
        bucket_seed='seed',
        require_marketing_opt_in=False,
        require_email_verified=False,
        send_email=False,
    )

    monkeypatch.setattr(coupons_api, '_parse_bucket_config', lambda **kwargs: SimpleNamespace(**kwargs))
    monkeypatch.setattr(coupons_api, '_segment_user_filters', lambda payload: [])

    async def _preview_assign(*_args, **_kwargs):
        await asyncio.sleep(0)
        return coupons_api.CouponBulkSegmentPreview(total_candidates=3, sample_emails=[], created=0, restored=0, already_active=0)

    async def _preview_revoke(*_args, **_kwargs):
        await asyncio.sleep(0)
        return coupons_api.CouponBulkSegmentPreview(total_candidates=3, sample_emails=[], revoked=0, already_revoked=0, not_assigned=0)

    monkeypatch.setattr(coupons_api, '_preview_segment_assign', _preview_assign)
    monkeypatch.setattr(coupons_api, '_preview_segment_revoke', _preview_revoke)

    assign_preview = await coupons_api.admin_preview_segment_assign(coupon.id, payload, session, object())
    revoke_preview = await coupons_api.admin_preview_segment_revoke(coupon.id, payload, session, object())
    assert assign_preview.total_candidates == 3
    assert revoke_preview.total_candidates == 3

    with pytest.raises(HTTPException) as no_engine:
        await coupons_api.admin_start_segment_assign_job(
            coupon.id,
            payload,
            BackgroundTasks(),
            session,
            SimpleNamespace(id=uuid4()),
        )
    assert no_engine.value.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR


@pytest.mark.anyio
async def test_run_bulk_segment_job_non_runnable_and_failure_path(monkeypatch: pytest.MonkeyPatch) -> None:
    class _SessionCtx:
        async def __aenter__(self):
            return _Session(coupon=SimpleNamespace(id=uuid4()), bind=object())

        async def __aexit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(coupons_api, 'async_sessionmaker', lambda *args, **kwargs: (lambda: _SessionCtx()))

    async def _load_none(*_args, **_kwargs):
        await asyncio.sleep(0)
        return None

    monkeypatch.setattr(coupons_api, '_load_bulk_job_for_run', _load_none)
    await coupons_api._run_bulk_segment_job(object(), job_id=uuid4())

    job = SimpleNamespace(
        coupon=SimpleNamespace(code='SAVE10', promotion=SimpleNamespace(name='Promo', description='Desc')),
        coupon_id=uuid4(),
        status=coupons_api.CouponBulkJobStatus.pending,
        revoke_reason=None,
        bucket_total=None,
        bucket_index=None,
        bucket_seed=None,
    )

    async def _load_job(*_args, **_kwargs):
        await asyncio.sleep(0)
        return job

    async def _mark_running(*_args, **_kwargs):
        await asyncio.sleep(0)

    async def _init_counters(*_args, **_kwargs):
        await asyncio.sleep(0)

    async def _run_batches(*_args, **_kwargs):
        await asyncio.sleep(0)
        raise RuntimeError('boom')

    failed = {'called': False}

    async def _mark_failed(*_args, **_kwargs):
        await asyncio.sleep(0)
        failed['called'] = True

    async def _finish_cancelled(*_args, **_kwargs):
        await asyncio.sleep(0)
        return False

    monkeypatch.setattr(coupons_api, '_load_bulk_job_for_run', _load_job)
    monkeypatch.setattr(coupons_api, '_mark_bulk_job_running', _mark_running)
    monkeypatch.setattr(coupons_api, '_initialize_bulk_job_counters', _init_counters)
    monkeypatch.setattr(coupons_api, '_run_bulk_segment_batches', _run_batches)
    monkeypatch.setattr(coupons_api, '_mark_bulk_job_failed', _mark_failed)
    monkeypatch.setattr(coupons_api, '_finish_bulk_job_if_cancelled', _finish_cancelled)

    await coupons_api._run_bulk_segment_job(object(), job_id=uuid4())
    assert failed['called'] is True