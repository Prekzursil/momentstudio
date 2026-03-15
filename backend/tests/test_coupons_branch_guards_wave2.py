from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

from fastapi import BackgroundTasks, HTTPException, status
import pytest

from app.api.v1 import coupons as coupons_api


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one(self):
        return self._value


class _Session:
    def __init__(self, *, coupon=None, promotion=None, job=None, bind=object()):
        self._coupon = coupon
        self._promotion = promotion
        self._job = job
        self.bind = bind
        self.added: list[object] = []

    def get(self, model, _id):
        if model is coupons_api.Coupon:
            return self._coupon
        if model is coupons_api.Promotion:
            return self._promotion
        if model is coupons_api.CouponBulkJob:
            return self._job
        return None

    def execute(self, _stmt):
        return _ScalarResult(0)

    def commit(self):
        return None

    def refresh(self, obj, attribute_names=None):
        return obj

    def add(self, obj):
        self.added.append(obj)


@pytest.mark.anyio
async def test_coupon_admin_not_found_and_generate_code_response(monkeypatch: pytest.MonkeyPatch) -> None:
    missing = _Session(coupon=None, promotion=None)
    with pytest.raises(HTTPException) as list_err:
        await coupons_api.admin_list_coupon_assignments(uuid4(), missing, object())
    assert list_err.value.status_code == status.HTTP_404_NOT_FOUND

    payload_create = SimpleNamespace(
        promotion_id=uuid4(),
        code='x' * 64,
        visibility='private',
        is_active=True,
        starts_at=None,
        ends_at=None,
        global_max_redemptions=None,
        per_customer_max_redemptions=None,
    )
    with pytest.raises(HTTPException) as create_err:
        await coupons_api.admin_create_coupon(payload_create, missing, object())
    assert create_err.value.status_code == status.HTTP_404_NOT_FOUND

    def _gen_code(*_args, **_kwargs):
        return 'SAVE-WAVE2'

    monkeypatch.setattr(coupons_api.coupons_service, 'generate_unique_coupon_code', _gen_code)
    code_payload = SimpleNamespace(prefix='Save', pattern=None, length=12)
    generated = await coupons_api.admin_generate_coupon_code(code_payload, _Session(), object())
    assert generated.code == 'SAVE-WAVE2'


@pytest.mark.anyio
async def test_coupon_segment_preview_and_start_not_found_and_bad_bucket(monkeypatch: pytest.MonkeyPatch) -> None:
    assign_payload = SimpleNamespace(
        bucket_total=2,
        bucket_index=0,
        bucket_seed='seed',
        require_marketing_opt_in=False,
        require_email_verified=False,
        send_email=False,
    )
    revoke_payload = SimpleNamespace(
        bucket_total=2,
        bucket_index=0,
        bucket_seed='seed',
        require_marketing_opt_in=False,
        require_email_verified=False,
        send_email=False,
        reason='cleanup',
        notify_reason='cleanup',
    )

    missing = _Session(coupon=None)
    with pytest.raises(HTTPException) as preview_assign_missing:
        await coupons_api.admin_preview_segment_assign(uuid4(), assign_payload, missing, object())
    assert preview_assign_missing.value.status_code == status.HTTP_404_NOT_FOUND

    with pytest.raises(HTTPException) as preview_revoke_missing:
        await coupons_api.admin_preview_segment_revoke(uuid4(), revoke_payload, missing, object())
    assert preview_revoke_missing.value.status_code == status.HTTP_404_NOT_FOUND

    with pytest.raises(HTTPException) as start_assign_missing:
        await coupons_api.admin_start_segment_assign_job(uuid4(), assign_payload, BackgroundTasks(), missing, SimpleNamespace(id=uuid4()))
    assert start_assign_missing.value.status_code == status.HTTP_404_NOT_FOUND

    with pytest.raises(HTTPException) as start_revoke_missing:
        await coupons_api.admin_start_segment_revoke_job(uuid4(), revoke_payload, BackgroundTasks(), missing, SimpleNamespace(id=uuid4()))
    assert start_revoke_missing.value.status_code == status.HTTP_404_NOT_FOUND

    existing = _Session(coupon=SimpleNamespace(id=uuid4()), bind=object())
    monkeypatch.setattr(coupons_api, '_parse_bucket_config', lambda **_kwargs: (_ for _ in ()).throw(ValueError('bad-bucket')))

    with pytest.raises(HTTPException) as preview_assign_bad:
        await coupons_api.admin_preview_segment_assign(uuid4(), assign_payload, existing, object())
    assert preview_assign_bad.value.status_code == status.HTTP_400_BAD_REQUEST

    with pytest.raises(HTTPException) as preview_revoke_bad:
        await coupons_api.admin_preview_segment_revoke(uuid4(), revoke_payload, existing, object())
    assert preview_revoke_bad.value.status_code == status.HTTP_400_BAD_REQUEST

    with pytest.raises(HTTPException) as start_assign_bad:
        await coupons_api.admin_start_segment_assign_job(uuid4(), assign_payload, BackgroundTasks(), existing, SimpleNamespace(id=uuid4()))
    assert start_assign_bad.value.status_code == status.HTTP_400_BAD_REQUEST

    with pytest.raises(HTTPException) as start_revoke_bad:
        await coupons_api.admin_start_segment_revoke_job(uuid4(), revoke_payload, BackgroundTasks(), existing, SimpleNamespace(id=uuid4()))
    assert start_revoke_bad.value.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.anyio
async def test_coupon_assign_revoke_noop_and_bulk_enqueue_guards(monkeypatch: pytest.MonkeyPatch) -> None:
    coupon = SimpleNamespace(id=uuid4(), promotion=SimpleNamespace(name='Promo', description='Desc'), code='SAVE10')
    user = SimpleNamespace(id=uuid4(), email='user@example.test', notify_marketing=True, preferred_language='en')

    def _coupon(_session, *, coupon_id):
        return coupon

    def _user_find(_session, *, user_id, email):
        return user

    def _assignment(_session, *, coupon_id, user_id):
        return SimpleNamespace(revoked_reason='cleanup')

    monkeypatch.setattr(coupons_api, '_get_coupon_with_promotion_or_404', _coupon)
    monkeypatch.setattr(coupons_api, '_find_user', _user_find)
    monkeypatch.setattr(coupons_api, '_coupon_assignment_for_user', _assignment)
    monkeypatch.setattr(coupons_api, '_activate_coupon_assignment', lambda *_args, **_kwargs: False)
    monkeypatch.setattr(coupons_api, '_revoke_coupon_assignment', lambda *_args, **_kwargs: False)

    assign_payload = SimpleNamespace(user_id=user.id, email=user.email, send_email=False)
    assign_response = await coupons_api.admin_assign_coupon(uuid4(), assign_payload, BackgroundTasks(), _Session(), object())
    assert assign_response.status_code == status.HTTP_204_NO_CONTENT

    revoke_payload = SimpleNamespace(user_id=user.id, email=user.email, reason='cleanup', send_email=False)
    revoke_response = await coupons_api.admin_revoke_coupon(uuid4(), revoke_payload, BackgroundTasks(), _Session(), object())
    assert revoke_response.status_code == status.HTTP_204_NO_CONTENT

    tasks = BackgroundTasks()
    coupons_api._enqueue_bulk_assign_notifications(
        background_tasks=tasks,
        coupon=coupon,
        users_by_email={user.email: user},
        notify_user_ids=set(),
    )
    assert len(tasks.tasks) == 0

    revoke_tasks = BackgroundTasks()
    coupons_api._enqueue_bulk_revoke_notifications(
        background_tasks=revoke_tasks,
        coupon=coupon,
        users_by_email={user.email: user},
        revoked_user_ids=set(),
        reason='cleanup',
    )
    assert len(revoke_tasks.tasks) == 0

    user_no_notify = SimpleNamespace(id=uuid4(), email='silent@example.test', notify_marketing=False, preferred_language='en')
    mixed_tasks = BackgroundTasks()
    coupons_api._enqueue_bulk_revoke_notifications(
        background_tasks=mixed_tasks,
        coupon=coupon,
        users_by_email={user.email: user, user_no_notify.email: user_no_notify},
        revoked_user_ids={user.id, user_no_notify.id},
        reason='cleanup',
    )
    assert len(mixed_tasks.tasks) == 1


@pytest.mark.anyio
async def test_coupon_misc_helpers_and_bulk_job_not_found_paths() -> None:
    assert coupons_api._is_valid_bulk_email('') is False
    assert coupons_api._is_valid_bulk_email('missing-at') is False

    rows = [(uuid4(), 'email@example.test')]
    assert coupons_api._bucket_preview_rows(rows, bucket=None) == rows
    assert coupons_api._bucket_job_rows(rows, bucket=None) == rows

    missing = _Session(job=None)
    with pytest.raises(HTTPException) as get_missing:
        await coupons_api.admin_get_bulk_job(uuid4(), missing, object())
    assert get_missing.value.status_code == status.HTTP_404_NOT_FOUND

    with pytest.raises(HTTPException) as cancel_missing:
        await coupons_api.admin_cancel_bulk_job(uuid4(), missing, object())
    assert cancel_missing.value.status_code == status.HTTP_404_NOT_FOUND

    with pytest.raises(HTTPException) as retry_missing:
        await coupons_api.admin_retry_bulk_job(uuid4(), BackgroundTasks(), missing, SimpleNamespace(id=uuid4()))
    assert retry_missing.value.status_code == status.HTTP_404_NOT_FOUND
