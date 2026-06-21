"""Worker-2 gap-fill coverage for ``app.api.v1.coupons_v2``.

These tests target the residual line + branch gaps left by
``test_w0_coupons_v2.py`` and ``test_coupons_v2.py``: the not-taken sides of
several validation branches, the no-promotion read paths, the long-code
truncation, the segment-preview/runner bucket edge branches (empty bucket,
restore/revoke email notifications, mid-run cancellation checkpoints, and the
cancel-during-exception path), and the ``ValueError`` / engine-unavailable
guards on the segment endpoints. Handlers are driven directly with in-memory
(and, where a synchronous cross-engine flip is needed, file-backed) SQLite,
mirroring the established w0 harness.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.v1 import coupons_v2 as api
from app.db.base import Base
from app.models.coupons_v2 import (
    Coupon,
    CouponAssignment,
    CouponBulkJob,
    CouponBulkJobAction,
    CouponBulkJobStatus,
    CouponVisibility,
    Promotion,
    PromotionDiscountType,
)
from app.models.user import User, UserRole
from app.schemas.coupons_v2 import (
    CouponBulkSegmentAssignRequest,
    CouponBulkSegmentRevokeRequest,
    PromotionCreate,
    PromotionUpdate,
)
from app.services import email as email_service

UTC = timezone.utc

pytestmark = pytest.mark.anyio


# --------------------------------------------------------------------------- #
# Infrastructure (mirrors test_w0_coupons_v2)
# --------------------------------------------------------------------------- #


def _make_engine_and_local() -> tuple[object, async_sessionmaker]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    return engine, async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False, autoflush=False
    )


async def _init(engine) -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


class _Admin:
    def __init__(self) -> None:
        self.id = uuid.uuid4()


async def _seed_user(
    session: AsyncSession,
    *,
    email: str,
    notify_marketing: bool = True,
    email_verified: bool = True,
) -> User:
    user = User(
        email=email,
        username=email.split("@")[0],
        hashed_password="x",
        role=UserRole.customer,
        notify_marketing=notify_marketing,
        email_verified=email_verified,
        preferred_language="en",
    )
    session.add(user)
    await session.flush()
    return user


async def _seed_promo_coupon(
    session: AsyncSession,
    *,
    code: str = "SAVE10",
    visibility: CouponVisibility = CouponVisibility.public,
) -> tuple[Promotion, Coupon]:
    promo = Promotion(
        name="Promo",
        description="desc",
        discount_type=PromotionDiscountType.percent,
        percentage_off=Decimal("10"),
        is_active=True,
        is_automatic=False,
    )
    session.add(promo)
    await session.flush()
    coupon = Coupon(
        promotion_id=promo.id,
        code=code,
        visibility=visibility,
        is_active=True,
    )
    session.add(coupon)
    await session.flush()
    return promo, coupon


@pytest.fixture(autouse=True)
def _eager_defaults():
    mappers = list(Base.registry.mappers)
    prev = {m: m.eager_defaults for m in mappers}
    for m in mappers:
        m.eager_defaults = True
    yield
    for m, value in prev.items():
        m.eager_defaults = value


@pytest.fixture(autouse=True)
def _mock_emails(monkeypatch):
    calls: dict[str, list] = {"assigned": [], "revoked": []}

    async def _assigned(*args, **kwargs):
        calls["assigned"].append((args, kwargs))
        return True

    async def _revoked(*args, **kwargs):
        calls["revoked"].append((args, kwargs))
        return True

    monkeypatch.setattr(email_service, "send_coupon_assigned", _assigned)
    monkeypatch.setattr(email_service, "send_coupon_revoked", _revoked)
    return calls


# --------------------------------------------------------------------------- #
# admin_create_promotion: free_shipping with neither off-field set (417->422)
# --------------------------------------------------------------------------- #


async def test_create_promotion_free_shipping_no_offsets() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    admin = _Admin()
    async with local() as session:
        payload = PromotionCreate(
            name="FreeShip",
            description="d",
            discount_type="free_shipping",
            is_active=True,
        )
        read = await api.admin_create_promotion(payload, session=session, _=admin)
        assert read.discount_type == "free_shipping"
    await engine.dispose()


# --------------------------------------------------------------------------- #
# admin_update_promotion: key absent (521->544) and key unchanged (525->542),
# plus free_shipping with no offsets on the update path (510->515).
# --------------------------------------------------------------------------- #


async def test_update_promotion_key_unchanged_and_free_shipping() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    admin = _Admin()
    async with local() as session:
        promo = Promotion(
            name="P",
            description="d",
            discount_type=PromotionDiscountType.free_shipping,
            key="keep-key",
            is_active=True,
        )
        session.add(promo)
        await session.commit()
        promo_id = promo.id

    async with local() as session:
        # key present but identical to current -> 525->542 (skip the dup check)
        read = await api.admin_update_promotion(
            promo_id,
            PromotionUpdate(key="keep-key", name="P2"),
            session=session,
            _=admin,
        )
        assert read.name == "P2"
        assert read.key == "keep-key"

    async with local() as session:
        # no key in payload -> 521->544 (skip key block entirely)
        read = await api.admin_update_promotion(
            promo_id,
            PromotionUpdate(description="changed"),
            session=session,
            _=admin,
        )
        assert read.description == "changed"
    await engine.dispose()


# --------------------------------------------------------------------------- #
# admin_list_coupons: neither promotion_id nor q filters (621->623, 623->625).
# --------------------------------------------------------------------------- #


async def test_list_coupons_no_filters() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    admin = _Admin()
    async with local() as session:
        await _seed_promo_coupon(session, code="NOFILTER")
        await session.commit()

    async with local() as session:
        rows = await api.admin_list_coupons(
            session=session, _=admin, promotion_id=None, q=None
        )
        assert any(c.code == "NOFILTER" for c in rows)
    await engine.dispose()


# --------------------------------------------------------------------------- #
# Bucket segment preview: empty-bucket continue, len(sample)<10 guard
# (1281, 1298->1300, 1399, 1416->1418) and the revoke-preview ValueError on
# the endpoint (2107-2108).
# --------------------------------------------------------------------------- #


def _no_filter_payload():
    return type(
        "P",
        (),
        {
            "require_marketing_opt_in": False,
            "require_email_verified": False,
            "send_email": False,
        },
    )()


async def test_segment_preview_bucket_sample_cap_and_empty() -> None:
    """A populated target bucket (>10 users) exercises the ``len(sample) < 10``
    false side (1308->1310 / 1426->1428); an all-miss bucket index exercises the
    empty-batch ``continue`` (1291 / 1409)."""
    engine, local = _make_engine_and_local()
    await _init(engine)
    seed = "seed"
    total = 2
    user_ids: list[uuid.UUID] = []
    async with local() as session:
        promo, coupon = await _seed_promo_coupon(session)
        coupon_id = coupon.id
        # 30 users so at least one of two buckets exceeds the 10-sample cap.
        for i in range(30):
            u = await _seed_user(session, email=f"seg{i}@a.com")
            user_ids.append(u.id)
        await session.commit()

    counts = {0: 0, 1: 0}
    for uid in user_ids:
        counts[api._bucket_index_for_user(user_id=uid, seed=seed, total=total)] += 1
    populated_index = 0 if counts[0] >= counts[1] else 1
    assert counts[populated_index] > 10  # guarantees the sample-cap false side

    filters = api._segment_user_filters(_no_filter_payload())
    populated = api._BucketConfig(total=total, index=populated_index, seed=seed)
    async with local() as session:
        prev_assign = await api._preview_segment_assign(
            session, coupon_id=coupon_id, filters=filters, bucket=populated
        )
        assert len(prev_assign.sample_emails) == 10
        prev_revoke = await api._preview_segment_revoke(
            session, coupon_id=coupon_id, filters=filters, bucket=populated
        )
        assert len(prev_revoke.sample_emails) == 10

    # Find a high-total bucket index that NO user maps to -> empty batch.
    big_total = 97
    used = {
        api._bucket_index_for_user(user_id=uid, seed=seed, total=big_total)
        for uid in user_ids
    }
    empty_index = next(i for i in range(big_total) if i not in used)
    empty = api._BucketConfig(total=big_total, index=empty_index, seed=seed)
    async with local() as session:
        prev = await api._preview_segment_assign(
            session, coupon_id=coupon_id, filters=filters, bucket=empty
        )
        assert prev.total_candidates == 0
        prev_r = await api._preview_segment_revoke(
            session, coupon_id=coupon_id, filters=filters, bucket=empty
        )
        assert prev_r.total_candidates == 0
    await engine.dispose()


async def test_segment_preview_revoke_invalid_bucket() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    admin = _Admin()
    async with local() as session:
        promo, coupon = await _seed_promo_coupon(session)
        await session.commit()
        coupon_id = coupon.id

    async with local() as session:
        # bucket_index >= bucket_total -> _parse_bucket_config raises ValueError
        # (schema allows index with only ge=0, so this reaches the endpoint's
        # except ValueError handler at 2107-2108).
        payload = CouponBulkSegmentRevokeRequest(
            bucket_total=2, bucket_index=5, bucket_seed="s"
        )
        with pytest.raises(HTTPException, match="within bucket_total"):
            await api.admin_preview_segment_revoke(
                coupon_id, payload, session=session, _=admin
            )
    await engine.dispose()


# --------------------------------------------------------------------------- #
# _run_bulk_segment_job (bucketed): empty-bucket continue (1580-1581),
# restore + revoke email notifications (1610, 1633).
# --------------------------------------------------------------------------- #


async def _run_bucketed_job(
    action: CouponBulkJobAction,
    *,
    pre_assign: bool,
    pre_revoked: bool,
    send_email: bool = True,
    bucket_total: int = 2,
    bucket_index: int | None = None,
    n_users: int = 12,
):
    engine, local = _make_engine_and_local()
    await _init(engine)
    seed = "seed"
    user_ids: list[uuid.UUID] = []
    async with local() as session:
        promo, coupon = await _seed_promo_coupon(session)
        for i in range(n_users):
            u = await _seed_user(session, email=f"buck{uuid.uuid4().hex[:8]}@a.com")
            user_ids.append(u.id)
        await session.flush()
        if pre_assign:
            for uid in user_ids:
                session.add(
                    CouponAssignment(
                        coupon_id=coupon.id,
                        user_id=uid,
                        revoked_at=(datetime.now(UTC) if pre_revoked else None),
                        revoked_reason=("old" if pre_revoked else None),
                    )
                )
        # Default: pick a bucket index that at least one user lands in.
        if bucket_index is None:
            counts: dict[int, int] = {}
            for uid in user_ids:
                idx = api._bucket_index_for_user(
                    user_id=uid, seed=seed, total=bucket_total
                )
                counts[idx] = counts.get(idx, 0) + 1
            bucket_index = max(counts, key=counts.get)
        job = CouponBulkJob(
            coupon_id=coupon.id,
            created_by_user_id=uuid.uuid4(),
            action=action,
            status=CouponBulkJobStatus.pending,
            send_email=send_email,
            bucket_total=bucket_total,
            bucket_index=bucket_index,
            bucket_seed=seed,
            total_candidates=n_users,
            revoke_reason="cleanup" if action == CouponBulkJobAction.revoke else None,
        )
        session.add(job)
        await session.commit()
        job_id = job.id

    await api._run_bulk_segment_job(engine, job_id=job_id)
    async with local() as session:
        job = await session.get(CouponBulkJob, job_id)
        status, restored, revoked, created = (
            job.status,
            job.restored,
            job.revoked,
            job.created,
        )
    await engine.dispose()
    return status, restored, revoked, created


async def test_run_bucketed_assign_restore_emails() -> None:
    # pre-assigned but revoked -> restore path -> send_email notify (1620 true).
    status, restored, _, _ = await _run_bucketed_job(
        CouponBulkJobAction.assign, pre_assign=True, pre_revoked=True
    )
    assert status == CouponBulkJobStatus.succeeded
    assert restored > 0


async def test_run_bucketed_assign_restore_no_email() -> None:
    # restore path with send_email False -> 1620->1646 false side (no notify).
    status, restored, _, _ = await _run_bucketed_job(
        CouponBulkJobAction.assign,
        pre_assign=True,
        pre_revoked=True,
        send_email=False,
    )
    assert status == CouponBulkJobStatus.succeeded
    assert restored > 0


async def test_run_bucketed_revoke_emails() -> None:
    # pre-assigned active -> revoke path -> send_email notify (1633 true).
    status, _, revoked, _ = await _run_bucketed_job(
        CouponBulkJobAction.revoke, pre_assign=True, pre_revoked=False
    )
    assert status == CouponBulkJobStatus.succeeded
    assert revoked > 0


async def test_run_bucketed_assign_create_emails() -> None:
    # no prior assignment -> create path.
    status, _, _, created = await _run_bucketed_job(
        CouponBulkJobAction.assign, pre_assign=False, pre_revoked=False
    )
    assert status == CouponBulkJobStatus.succeeded
    assert created > 0


async def test_run_bucketed_empty_batch_continue() -> None:
    """A bucket index that no user maps to -> the single batch is all-miss, so
    the runner takes ``last_id = rows[-1][0]; continue`` (1590-1591) and ends
    with zero processed."""
    engine, local = _make_engine_and_local()
    await _init(engine)
    seed = "seed"
    big_total = 97
    user_ids: list[uuid.UUID] = []
    async with local() as session:
        promo, coupon = await _seed_promo_coupon(session)
        for _ in range(8):
            u = await _seed_user(session, email=f"e{uuid.uuid4().hex[:8]}@a.com")
            user_ids.append(u.id)
        await session.flush()
        used = {
            api._bucket_index_for_user(user_id=uid, seed=seed, total=big_total)
            for uid in user_ids
        }
        empty_index = next(i for i in range(big_total) if i not in used)
        job = CouponBulkJob(
            coupon_id=coupon.id,
            created_by_user_id=uuid.uuid4(),
            action=CouponBulkJobAction.assign,
            status=CouponBulkJobStatus.pending,
            send_email=False,
            bucket_total=big_total,
            bucket_index=empty_index,
            bucket_seed=seed,
            total_candidates=0,
        )
        session.add(job)
        await session.commit()
        job_id = job.id

    await api._run_bulk_segment_job(engine, job_id=job_id)
    async with local() as session:
        job = await session.get(CouponBulkJob, job_id)
        assert job.status == CouponBulkJobStatus.succeeded
        assert job.processed == 0
    await engine.dispose()


# --------------------------------------------------------------------------- #
# Mid-run cancellation checkpoints (1642-1644, 1671-1673) and the
# cancel-during-exception path (1681-1683) of _run_bulk_segment_job.
# --------------------------------------------------------------------------- #


async def _cancel_job(db_path, job_id) -> None:
    from sqlalchemy import create_engine

    sync_engine = create_engine(f"sqlite:///{db_path.as_posix()}", future=True)
    with sync_engine.begin() as conn:
        conn.execute(
            update(CouponBulkJob)
            .where(CouponBulkJob.id == job_id)
            .values(status=CouponBulkJobStatus.cancelled)
        )
    sync_engine.dispose()


async def test_run_job_cancel_after_first_batch(monkeypatch, tmp_path) -> None:
    """Cancel happens after the first batch commit -> the post-commit checkpoint
    (1640-1644) finalises as cancelled."""
    db_path = tmp_path / "cancel_mid.db"
    url = f"sqlite+aiosqlite:///{db_path.as_posix()}"
    engine = create_async_engine(url, future=True)
    local = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False, autoflush=False
    )
    await _init(engine)
    async with local() as session:
        await _seed_user(session, email="cm1@a.com")
        promo, coupon = await _seed_promo_coupon(session)
        job = CouponBulkJob(
            coupon_id=coupon.id,
            created_by_user_id=uuid.uuid4(),
            action=CouponBulkJobAction.assign,
            status=CouponBulkJobStatus.pending,
            send_email=False,
        )
        session.add(job)
        await session.commit()
        job_id = job.id

    # Flip to cancelled the first time send_coupon_assigned-free commit happens:
    # patch session.commit indirectly by cancelling inside email seam is not hit
    # (send_email False). Instead cancel right after the batch via the refresh
    # seam: monkeypatch datetime is fragile; use a commit counter via the email
    # service is unused here. Simplest: cancel by patching `func` is overkill --
    # cancel through the post-first-batch refresh by flipping status mid-run.
    original_commit = AsyncSession.commit
    state = {"n": 0}

    async def _counting_commit(self):  # type: ignore[no-untyped-def]
        await original_commit(self)
        state["n"] += 1
        # After the batch-processing commit (3rd commit: running, reset, batch),
        # flip the job to cancelled so the next checkpoint catches it.
        if state["n"] == 3:
            await _cancel_job(db_path, job_id)

    monkeypatch.setattr(AsyncSession, "commit", _counting_commit)
    await api._run_bulk_segment_job(engine, job_id=job_id)
    monkeypatch.undo()
    await engine.dispose()

    engine2 = create_async_engine(url, future=True)
    local2 = async_sessionmaker(engine2, class_=AsyncSession, expire_on_commit=False)
    async with local2() as session:
        job = await session.get(CouponBulkJob, job_id)
        assert job.status == CouponBulkJobStatus.cancelled
        assert job.finished_at is not None
    await engine2.dispose()


async def test_run_job_cancel_before_final_checkpoint(monkeypatch, tmp_path) -> None:
    """No users -> the while loop runs its top-of-loop status refresh (not yet
    cancelled), then the query returns no rows and breaks. We cancel right after
    that first ``["status"]`` refresh so the post-loop final checkpoint
    (1679-1683) is the branch that observes cancellation."""
    db_path = tmp_path / "cancel_final.db"
    url = f"sqlite+aiosqlite:///{db_path.as_posix()}"
    engine = create_async_engine(url, future=True)
    local = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False, autoflush=False
    )
    await _init(engine)
    async with local() as session:
        # No users seeded -> the while loop sees no rows and breaks.
        promo, coupon = await _seed_promo_coupon(session)
        job = CouponBulkJob(
            coupon_id=coupon.id,
            created_by_user_id=uuid.uuid4(),
            action=CouponBulkJobAction.assign,
            status=CouponBulkJobStatus.pending,
            send_email=False,
        )
        session.add(job)
        await session.commit()
        job_id = job.id

    original_refresh = AsyncSession.refresh
    state = {"status_refreshes": 0}

    async def _hooking_refresh(self, obj, *args, **kwargs):  # type: ignore[no-untyped-def]
        attrs = kwargs.get("attribute_names")
        if attrs is None and len(args) >= 1:
            attrs = args[0]
        await original_refresh(self, obj, *args, **kwargs)
        if attrs == ["status"]:
            state["status_refreshes"] += 1
            # After the first top-of-loop status refresh (which read pending),
            # cancel so the empty-loop break path's final refresh sees cancelled.
            if state["status_refreshes"] == 1:
                await _cancel_job(db_path, job_id)

    monkeypatch.setattr(AsyncSession, "refresh", _hooking_refresh)
    await api._run_bulk_segment_job(engine, job_id=job_id)
    monkeypatch.undo()
    await engine.dispose()

    engine2 = create_async_engine(url, future=True)
    local2 = async_sessionmaker(engine2, class_=AsyncSession, expire_on_commit=False)
    async with local2() as session:
        job = await session.get(CouponBulkJob, job_id)
        assert job.status == CouponBulkJobStatus.cancelled
        assert job.finished_at is not None
    await engine2.dispose()


async def test_run_job_cancel_during_exception(monkeypatch, tmp_path) -> None:
    """An exception is raised AFTER the job was cancelled -> the except block's
    cancellation short-circuit (1679-1683) finalises as cancelled, not failed."""
    db_path = tmp_path / "cancel_exc.db"
    url = f"sqlite+aiosqlite:///{db_path.as_posix()}"
    engine = create_async_engine(url, future=True)
    local = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False, autoflush=False
    )
    await _init(engine)
    async with local() as session:
        promo, coupon = await _seed_promo_coupon(session)
        job = CouponBulkJob(
            coupon_id=coupon.id,
            created_by_user_id=uuid.uuid4(),
            action=CouponBulkJobAction.assign,
            status=CouponBulkJobStatus.pending,
            send_email=False,
        )
        session.add(job)
        await session.commit()
        job_id = job.id

    def _cancel_then_boom(payload):
        # Synchronous seam: flip to cancelled, then raise so the except handler
        # runs while the DB row is already cancelled.
        import asyncio

        asyncio.get_event_loop()  # noqa: F841 (ensure we're inside the loop)
        raise RuntimeError("boom")

    # Flip to cancelled first (so the except handler's refresh reads cancelled),
    # then make the body raise.
    await _cancel_job(db_path, job_id)
    # But the runner early-returns if status not in (pending, running). Re-set to
    # running via sync engine so the body executes, raises, and the except sees
    # the (separately) cancelled flag. To do that, cancel must happen mid-body.
    from sqlalchemy import create_engine

    sync_engine = create_engine(f"sqlite:///{db_path.as_posix()}", future=True)
    with sync_engine.begin() as conn:
        conn.execute(
            update(CouponBulkJob)
            .where(CouponBulkJob.id == job_id)
            .values(status=CouponBulkJobStatus.pending)
        )

    def _boom_after_cancel(payload):
        with sync_engine.begin() as conn:
            conn.execute(
                update(CouponBulkJob)
                .where(CouponBulkJob.id == job_id)
                .values(status=CouponBulkJobStatus.cancelled)
            )
        raise RuntimeError("boom")

    monkeypatch.setattr(api, "_segment_user_filters", _boom_after_cancel)
    await api._run_bulk_segment_job(engine, job_id=job_id)
    monkeypatch.undo()
    sync_engine.dispose()
    await engine.dispose()

    engine2 = create_async_engine(url, future=True)
    local2 = async_sessionmaker(engine2, class_=AsyncSession, expire_on_commit=False)
    async with local2() as session:
        job = await session.get(CouponBulkJob, job_id)
        assert job.status == CouponBulkJobStatus.cancelled
        assert job.error_message is None
    await engine2.dispose()


# --------------------------------------------------------------------------- #
# Segment-job endpoints: engine-not-AsyncEngine guard (2169, 2230, 2384).
# A sync-bound session has ``session.bind`` that is not an AsyncEngine.
# --------------------------------------------------------------------------- #


class _FakeResult:
    def __init__(self, value):
        self._value = value

    def scalar_one(self):
        return self._value

    def scalars(self):
        return self

    def all(self):
        return []

    def first(self):
        return None


class _NonAsyncBoundSession:
    """Minimal async session stub whose ``bind`` is not an AsyncEngine, so the
    segment-job endpoints hit the 500 'Database engine unavailable' guard right
    after the preview + job persist succeed."""

    def __init__(self, coupon):
        self._coupon = coupon
        self.bind = object()  # not an AsyncEngine
        self.added: list = []

    async def get(self, model, pk):
        return self._coupon

    async def execute(self, *args, **kwargs):
        return _FakeResult(0)

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        return None

    async def refresh(self, obj, *args, **kwargs):
        if getattr(obj, "id", None) is None:
            obj.id = uuid.uuid4()
        return None


async def test_segment_assign_job_engine_unavailable(monkeypatch) -> None:
    admin = _Admin()
    coupon = Coupon(
        id=uuid.uuid4(),
        promotion_id=uuid.uuid4(),
        code="X",
        visibility=CouponVisibility.public,
        is_active=True,
    )

    async def _fake_preview(*args, **kwargs):
        return api.CouponBulkSegmentPreview(total_candidates=0, sample_emails=[])

    monkeypatch.setattr(api, "_preview_segment_assign", _fake_preview)
    monkeypatch.setattr(api, "_preview_segment_revoke", _fake_preview)

    session = _NonAsyncBoundSession(coupon)
    bg = BackgroundTasks()
    payload = CouponBulkSegmentAssignRequest()
    with pytest.raises(HTTPException, match="engine unavailable"):
        await api.admin_start_segment_assign_job(
            coupon.id, payload, bg, session=session, admin_user=admin
        )

    payload_r = CouponBulkSegmentRevokeRequest()
    with pytest.raises(HTTPException, match="engine unavailable"):
        await api.admin_start_segment_revoke_job(
            coupon.id, payload_r, bg, session=session, admin_user=admin
        )


async def test_retry_job_engine_unavailable(monkeypatch) -> None:
    admin = _Admin()
    coupon = Coupon(
        id=uuid.uuid4(),
        promotion_id=uuid.uuid4(),
        code="X",
        visibility=CouponVisibility.public,
        is_active=True,
    )
    job = CouponBulkJob(
        id=uuid.uuid4(),
        coupon_id=coupon.id,
        created_by_user_id=admin.id,
        action=CouponBulkJobAction.assign,
        status=CouponBulkJobStatus.failed,
        send_email=False,
    )

    async def _fake_preview(*args, **kwargs):
        return api.CouponBulkSegmentPreview(total_candidates=0, sample_emails=[])

    monkeypatch.setattr(api, "_preview_segment_assign", _fake_preview)

    class _RetrySession(_NonAsyncBoundSession):
        async def get(self, model, pk):
            return job

    session = _RetrySession(coupon)
    bg = BackgroundTasks()
    with pytest.raises(HTTPException, match="engine unavailable"):
        await api.admin_retry_bulk_job(job.id, bg, session=session, admin_user=admin)


# --------------------------------------------------------------------------- #
# admin_revoke_coupon: a real revoke with send_email False so the post-commit
# ``if should_email`` notification branch is skipped (1942->1951 false side).
# --------------------------------------------------------------------------- #


async def test_revoke_single_no_email() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    admin = _Admin()
    bg = BackgroundTasks()
    async with local() as session:
        user = await _seed_user(session, email="rv@a.com")
        promo, coupon = await _seed_promo_coupon(session)
        session.add(CouponAssignment(coupon_id=coupon.id, user_id=user.id))
        await session.commit()
        coupon_id, user_id = coupon.id, user.id

    from app.schemas.coupons_v2 import CouponRevokeRequest

    async with local() as session:
        resp = await api.admin_revoke_coupon(
            coupon_id,
            CouponRevokeRequest(user_id=user_id, reason="x", send_email=False),
            bg,
            session=session,
            _=admin,
        )
        assert resp.status_code == 204
        assignment = (
            await session.execute(
                select(CouponAssignment).where(
                    CouponAssignment.coupon_id == coupon_id,
                    CouponAssignment.user_id == user_id,
                )
            )
        ).scalar_one()
        assert assignment.revoked_at is not None
    await engine.dispose()


# --------------------------------------------------------------------------- #
# Bulk assign/revoke with valid (well-formed) emails that match NO users, so
# ``if user_ids:`` is False (1816->1831 / 1997->2012 skip the existing-lookup).
# --------------------------------------------------------------------------- #


async def test_bulk_assign_revoke_no_matching_users() -> None:
    from app.schemas.coupons_v2 import (
        CouponBulkAssignRequest,
        CouponBulkRevokeRequest,
    )

    engine, local = _make_engine_and_local()
    await _init(engine)
    admin = _Admin()
    bg = BackgroundTasks()
    async with local() as session:
        promo, coupon = await _seed_promo_coupon(session)
        await session.commit()
        coupon_id = coupon.id

    async with local() as session:
        res = await api.admin_bulk_assign_coupon(
            coupon_id,
            CouponBulkAssignRequest(emails=["ghost1@a.com", "ghost2@a.com"]),
            bg,
            session=session,
            _=admin,
        )
        assert res.created == 0
        assert sorted(res.not_found_emails) == ["ghost1@a.com", "ghost2@a.com"]

    async with local() as session:
        res = await api.admin_bulk_revoke_coupon(
            coupon_id,
            CouponBulkRevokeRequest(emails=["ghost3@a.com"]),
            bg,
            session=session,
            _=admin,
        )
        assert res.revoked == 0
        assert res.not_found_emails == ["ghost3@a.com"]
    await engine.dispose()


# --------------------------------------------------------------------------- #
# admin_coupon_analytics: a redemption with zero discount_ron so the
# per-item allocation guard (order_discount > 0 ...) is False (1083->1086).
# --------------------------------------------------------------------------- #


async def test_analytics_zero_discount_allocation() -> None:
    from app.models.catalog import Category, Product, ProductStatus
    from app.models.coupons_v2 import CouponRedemption
    from app.models.order import Order, OrderItem, OrderStatus

    engine, local = _make_engine_and_local()
    await _init(engine)
    admin = _Admin()
    async with local() as session:
        promo, coupon = await _seed_promo_coupon(session)
        user = await _seed_user(session, email="an@a.com")
        category = Category(slug="c", name="C", sort_order=1)
        session.add(category)
        await session.flush()
        product = Product(
            category_id=category.id,
            slug="p",
            sku="SKU-AN",
            name="P",
            base_price=Decimal("50"),
            currency="RON",
            stock_quantity=10,
            status=ProductStatus.published,
        )
        session.add(product)
        await session.flush()
        order = Order(
            user_id=user.id,
            status=OrderStatus.delivered,
            customer_email=user.email,
            customer_name="C",
            total_amount=Decimal("50.00"),
            payment_method="cod",
            currency="RON",
            promo_code=coupon.code,
        )
        session.add(order)
        await session.flush()
        session.add(
            OrderItem(
                order_id=order.id,
                product_id=product.id,
                quantity=1,
                unit_price=Decimal("50.00"),
                subtotal=Decimal("50.00"),
            )
        )
        session.add(
            CouponRedemption(
                coupon_id=coupon.id,
                order_id=order.id,
                user_id=user.id,
                discount_ron=Decimal("0"),  # zero -> allocation guard False
                shipping_discount_ron=Decimal("0"),
            )
        )
        await session.commit()
        promo_id, coupon_id = promo.id, coupon.id

    async with local() as session:
        resp = await api.admin_coupon_analytics(
            promo_id,
            session=session,
            _=admin,
            coupon_id=coupon_id,
            days=30,
            top_limit=10,
        )
        # Product appears but with zero allocated discount.
        assert resp.top_products
        assert resp.top_products[0].allocated_discount_ron == Decimal("0.00")
    await engine.dispose()
