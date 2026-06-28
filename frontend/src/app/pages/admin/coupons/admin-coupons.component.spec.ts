import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import { AdminCouponsV2Service } from '../../../core/admin-coupons-v2.service';
import { AdminProductsService } from '../../../core/admin-products.service';
import { AdminService } from '../../../core/admin.service';
import { ToastService } from '../../../core/toast.service';
import { AdminCouponsComponent } from './admin-coupons.component';

type AnySpy = jasmine.SpyObj<any>;

function makePromotion(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'promo-1',
    key: 'SUMMER',
    name: 'Summer Sale',
    description: 'Hot deals',
    discount_type: 'percent',
    percentage_off: '10',
    amount_off: null,
    max_discount_amount: null,
    min_subtotal: null,
    allow_on_sale_items: true,
    first_order_only: false,
    included_product_ids: [],
    excluded_product_ids: [],
    included_category_ids: [],
    excluded_category_ids: [],
    starts_at: null,
    ends_at: null,
    is_active: true,
    is_automatic: false,
    ...overrides,
  };
}

function makeCoupon(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'coupon-1',
    promotion_id: 'promo-1',
    code: 'SAVE10',
    visibility: 'assigned',
    is_active: true,
    starts_at: null,
    ends_at: null,
    global_max_redemptions: null,
    per_customer_max_redemptions: null,
    promotion: null,
    ...overrides,
  };
}

function makeJob(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'job-1',
    coupon_id: 'coupon-1',
    action: 'assign',
    status: 'pending',
    require_marketing_opt_in: false,
    require_email_verified: false,
    send_email: true,
    total_candidates: 5,
    processed: 0,
    created: 0,
    restored: 0,
    already_active: 0,
    revoked: 0,
    already_revoked: 0,
    not_assigned: 0,
    error_message: null,
    created_at: '2026-02-01T00:00:00Z',
    ...overrides,
  };
}

function makeAnalytics(overrides: Record<string, unknown> = {}): any {
  return {
    summary: {
      redemptions: 3,
      total_discount_ron: '12.50',
      total_shipping_discount_ron: '0',
      avg_order_total_with_coupon: '100',
      avg_order_total_without_coupon: '90',
      aov_lift: '10',
    },
    daily: [{ date: '2026-02-01', redemptions: 1, discount_ron: '5', shipping_discount_ron: '0' }],
    top_products: [
      {
        product_id: 'p1',
        product_slug: 'slug-1',
        product_name: 'Widget',
        orders_count: 2,
        quantity: 4,
        gross_sales_ron: '50',
        allocated_discount_ron: '5',
      },
    ],
    ...overrides,
  };
}

function makeBulkResult(overrides: Record<string, unknown> = {}): any {
  return {
    requested: 2,
    unique: 2,
    invalid_emails: [],
    not_found_emails: [],
    created: 1,
    restored: 0,
    already_active: 1,
    revoked: 0,
    already_revoked: 0,
    not_assigned: 0,
    ...overrides,
  };
}

function makePreview(overrides: Record<string, unknown> = {}): any {
  return {
    total_candidates: 4,
    sample_emails: ['a@x.com', 'b@x.com'],
    created: 2,
    restored: 0,
    already_active: 2,
    revoked: 0,
    already_revoked: 0,
    not_assigned: 0,
    ...overrides,
  };
}

describe('AdminCouponsComponent', () => {
  let adminCoupons: AnySpy;
  let adminProducts: AnySpy;
  let admin: AnySpy;
  let toast: AnySpy;
  const live: AdminCouponsComponent[] = [];

  beforeEach(async () => {
    adminCoupons = jasmine.createSpyObj<AdminCouponsV2Service>('AdminCouponsV2Service', [
      'listPromotions',
      'createPromotion',
      'updatePromotion',
      'listCoupons',
      'createCoupon',
      'generateCouponCode',
      'updateCoupon',
      'listAssignments',
      'assignCoupon',
      'revokeCoupon',
      'bulkAssignCoupon',
      'bulkRevokeCoupon',
      'previewSegmentAssign',
      'previewSegmentRevoke',
      'startSegmentAssignJob',
      'startSegmentRevokeJob',
      'getBulkJob',
      'getAnalytics',
      'listBulkJobs',
      'cancelBulkJob',
      'retryBulkJob',
    ]);
    adminProducts = jasmine.createSpyObj<AdminProductsService>('AdminProductsService', [
      'search',
      'byIds',
    ]);
    admin = jasmine.createSpyObj<AdminService>('AdminService', ['getCategories']);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);

    admin.getCategories.and.returnValue(of([{ id: 'c1', name: 'Cat', slug: 'cat' } as any]));
    adminCoupons.listPromotions.and.returnValue(of([]));
    adminCoupons.listCoupons.and.returnValue(of([]));
    adminCoupons.getAnalytics.and.returnValue(of(makeAnalytics()));
    adminCoupons.listAssignments.and.returnValue(of([]));
    adminCoupons.listBulkJobs.and.returnValue(of([]));
    adminProducts.search.and.returnValue(of({ items: [], meta: { page: 1, limit: 20, total: 0 } }));
    adminProducts.byIds.and.returnValue(of([]));

    await TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), AdminCouponsComponent],
      providers: [
        provideRouter([]),
        { provide: AdminCouponsV2Service, useValue: adminCoupons },
        { provide: AdminProductsService, useValue: adminProducts },
        { provide: AdminService, useValue: admin },
        { provide: ToastService, useValue: toast },
      ],
    }).compileComponents();

    history.replaceState({}, '');
  });

  afterEach(() => {
    while (live.length) {
      const cmp = live.pop();
      try {
        cmp?.ngOnDestroy();
      } catch {
        /* ignore cleanup errors */
      }
    }
    history.replaceState({}, '');
  });

  function create(): AdminCouponsComponent {
    const cmp = TestBed.createComponent(AdminCouponsComponent).componentInstance;
    live.push(cmp);
    return cmp;
  }

  // ----- lifecycle / init -----

  it('ngOnInit loads categories and promotions, starting fresh when empty', () => {
    const cmp = create();
    cmp.ngOnInit();
    expect(admin.getCategories).toHaveBeenCalled();
    expect(adminCoupons.listPromotions).toHaveBeenCalled();
    expect(cmp.categories().length).toBe(1);
    expect(cmp.selectedPromotion()).toBeNull();
    expect(cmp.promotionsLoading()).toBeFalse();
  });

  it('loadPromotions auto-starts a new promotion when the flag is set', () => {
    adminCoupons.listPromotions.and.returnValue(of([makePromotion()]));
    const cmp = create();
    (cmp as any).autoStartNewPromotion = true;
    const spy = spyOn(cmp, 'startNewPromotion').and.callThrough();
    cmp.loadPromotions();
    expect(spy).toHaveBeenCalled();
    expect(cmp.selectedPromotion()).toBeNull();
  });

  it('loadPromotions selects the preselected promotion id when present', () => {
    adminCoupons.listPromotions.and.returnValue(
      of([makePromotion(), makePromotion({ id: 'promo-2', name: 'Winter' })]),
    );
    const cmp = create();
    (cmp as any).preselectPromotionId = 'promo-2';
    cmp.loadPromotions();
    expect(cmp.selectedPromotion()?.id).toBe('promo-2');
  });

  it('loadPromotions falls back to the first promotion when the preselect id is missing', () => {
    adminCoupons.listPromotions.and.returnValue(of([makePromotion({ id: 'promo-9' })]));
    const cmp = create();
    (cmp as any).preselectPromotionId = 'ghost';
    cmp.loadPromotions();
    expect(cmp.selectedPromotion()?.id).toBe('promo-9');
  });

  it('renders the promotions title once initialized', () => {
    const fixture = TestBed.createComponent(AdminCouponsComponent);
    live.push(fixture.componentInstance);
    fixture.detectChanges();
    const text = (fixture.nativeElement.textContent || '').replace(/\s+/g, ' ');
    expect(text).toContain('adminUi.couponsV2.promotions.title');
  });

  it('loadCategories tolerates errors and empties the list', () => {
    admin.getCategories.and.returnValue(throwError(() => new Error('x')));
    const cmp = create();
    cmp.loadCategories();
    expect(cmp.categories()).toEqual([]);
  });

  it('loadCategories defaults a null payload to an empty array', () => {
    admin.getCategories.and.returnValue(of(null as any));
    const cmp = create();
    cmp.loadCategories();
    expect(cmp.categories()).toEqual([]);
  });

  // ----- loadPromotions branches -----

  it('loadPromotions reselects the current promotion when it persists', () => {
    const promo = makePromotion();
    adminCoupons.listPromotions.and.returnValue(of([promo]));
    const cmp = create();
    cmp.selectedPromotion.set(promo);
    cmp.loadPromotions();
    expect(cmp.selectedPromotion()?.id).toBe('promo-1');
  });

  it('loadPromotions selects the first promotion when current id is gone', () => {
    adminCoupons.listPromotions.and.returnValue(of([makePromotion({ id: 'fresh' })]));
    const cmp = create();
    cmp.selectedPromotion.set(makePromotion({ id: 'stale' }));
    cmp.loadPromotions();
    expect(cmp.selectedPromotion()?.id).toBe('fresh');
  });

  it('loadPromotions normalizes a non-array payload and starts new', () => {
    adminCoupons.listPromotions.and.returnValue(of(null as any));
    const cmp = create();
    cmp.loadPromotions();
    expect(cmp.promotions()).toEqual([]);
    expect(cmp.selectedPromotion()).toBeNull();
  });

  it('loadPromotions surfaces the backend detail on error', () => {
    adminCoupons.listPromotions.and.returnValue(throwError(() => ({ error: { detail: 'boom' } })));
    const cmp = create();
    cmp.loadPromotions();
    expect(cmp.promotionsError()).toBe('boom');
    expect(cmp.promotionsLoading()).toBeFalse();
  });

  it('loadPromotions falls back to a translated error message', () => {
    adminCoupons.listPromotions.and.returnValue(throwError(() => ({})));
    const cmp = create();
    cmp.loadPromotions();
    expect(cmp.promotionsError()).toBe('adminUi.couponsV2.errors.loadPromotions');
  });

  // ----- selectPromotion / startNewPromotion -----

  it('selectPromotion populates the form and loads coupons + analytics', () => {
    const promo = makePromotion();
    adminCoupons.listCoupons.and.returnValue(of([makeCoupon()]));
    const cmp = create();
    cmp.selectPromotion(promo);
    expect(cmp.selectedPromotion()?.id).toBe('promo-1');
    expect(cmp.promotionForm.name).toBe('Summer Sale');
    expect(adminCoupons.listCoupons).toHaveBeenCalled();
    expect(adminCoupons.getAnalytics).toHaveBeenCalled();
  });

  it('startNewPromotion resets all selection state', () => {
    const cmp = create();
    cmp.coupons.set([makeCoupon()]);
    cmp.selectedCoupon.set(makeCoupon());
    cmp.startNewPromotion();
    expect(cmp.selectedPromotion()).toBeNull();
    expect(cmp.coupons()).toEqual([]);
    expect(cmp.selectedCoupon()).toBeNull();
    expect(cmp.analytics()).toBeNull();
  });

  // ----- discount type -----

  it('onDiscountTypeChange clears the unused value per type', () => {
    const cmp = create();
    cmp.promotionForm.discount_type = 'percent';
    cmp.promotionForm.amount_off = 5;
    cmp.onDiscountTypeChange();
    expect(`${cmp.promotionForm.amount_off}`).toBe('');

    cmp.promotionForm.discount_type = 'amount';
    cmp.promotionForm.percentage_off = 9;
    cmp.onDiscountTypeChange();
    expect(`${cmp.promotionForm.percentage_off}`).toBe('');

    cmp.promotionForm.discount_type = 'free_shipping';
    cmp.promotionForm.percentage_off = 1;
    cmp.promotionForm.amount_off = 2;
    cmp.onDiscountTypeChange();
    expect(`${cmp.promotionForm.percentage_off}`).toBe('');
    expect(`${cmp.promotionForm.amount_off}`).toBe('');
  });

  // ----- savePromotion / validation -----

  it('savePromotion blocks on a missing name', () => {
    const cmp = create();
    cmp.promotionForm.name = '';
    cmp.savePromotion();
    expect(toast.error).toHaveBeenCalled();
    expect(adminCoupons.createPromotion).not.toHaveBeenCalled();
  });

  it('savePromotion blocks an invalid date range', () => {
    const cmp = create();
    cmp.promotionForm.name = 'Promo';
    cmp.promotionForm.discount_type = 'free_shipping';
    cmp.promotionForm.starts_at = '2026-02-10T00:00';
    cmp.promotionForm.ends_at = '2026-02-01T00:00';
    cmp.savePromotion();
    expect(adminCoupons.createPromotion).not.toHaveBeenCalled();
  });

  it('savePromotion blocks an out-of-range percentage', () => {
    const cmp = create();
    cmp.promotionForm.name = 'Promo';
    cmp.promotionForm.discount_type = 'percent';
    cmp.promotionForm.percentage_off = 150;
    cmp.savePromotion();
    expect(adminCoupons.createPromotion).not.toHaveBeenCalled();
  });

  it('savePromotion blocks a non-positive amount', () => {
    const cmp = create();
    cmp.promotionForm.name = 'Promo';
    cmp.promotionForm.discount_type = 'amount';
    cmp.promotionForm.amount_off = 0;
    cmp.savePromotion();
    expect(adminCoupons.createPromotion).not.toHaveBeenCalled();
  });

  it('savePromotion creates a new promotion and reloads', () => {
    adminCoupons.createPromotion.and.returnValue(of(makePromotion({ id: 'new-promo' })));
    adminCoupons.listPromotions.and.returnValue(of([makePromotion({ id: 'new-promo' })]));
    const cmp = create();
    cmp.promotionForm.name = 'Promo';
    cmp.promotionForm.discount_type = 'amount';
    cmp.promotionForm.amount_off = 25;
    cmp.savePromotion();
    expect(adminCoupons.createPromotion).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
    expect(cmp.selectedPromotion()?.id).toBe('new-promo');
  });

  it('savePromotion updates an existing promotion', () => {
    const promo = makePromotion();
    adminCoupons.updatePromotion.and.returnValue(of(promo));
    adminCoupons.listPromotions.and.returnValue(of([promo]));
    const cmp = create();
    cmp.selectedPromotion.set(promo);
    cmp.promotionForm = (cmp as any).promotionToForm(promo);
    cmp.savePromotion();
    expect(adminCoupons.updatePromotion).toHaveBeenCalledWith('promo-1', jasmine.any(Object));
    expect(cmp.promotionSaving()).toBeFalse();
  });

  it('savePromotion shows an error toast when the save fails', () => {
    adminCoupons.createPromotion.and.returnValue(throwError(() => ({ error: { detail: 'nope' } })));
    const cmp = create();
    cmp.promotionForm.name = 'Promo';
    cmp.promotionForm.discount_type = 'free_shipping';
    cmp.savePromotion();
    expect(toast.error).toHaveBeenCalledWith('adminUi.couponsV2.errors.savePromotion', 'nope');
    expect(cmp.promotionSaving()).toBeFalse();
  });

  // ----- loadPromotionsAfterMutation -----

  it('loadPromotionsAfterMutation selects the requested id', () => {
    adminCoupons.listPromotions.and.returnValue(of([makePromotion({ id: 'x' })]));
    const cmp = create();
    cmp.loadPromotionsAfterMutation('x');
    expect(cmp.selectedPromotion()?.id).toBe('x');
  });

  it('loadPromotionsAfterMutation selects the first when id is absent', () => {
    adminCoupons.listPromotions.and.returnValue(of([makePromotion({ id: 'first' })]));
    const cmp = create();
    cmp.loadPromotionsAfterMutation('missing');
    expect(cmp.selectedPromotion()?.id).toBe('first');
  });

  it('loadPromotionsAfterMutation handles a null id and empty list', () => {
    adminCoupons.listPromotions.and.returnValue(of(null as any));
    const cmp = create();
    cmp.loadPromotionsAfterMutation(null);
    expect(cmp.promotions()).toEqual([]);
  });

  it('loadPromotionsAfterMutation reports errors', () => {
    adminCoupons.listPromotions.and.returnValue(throwError(() => ({})));
    const cmp = create();
    cmp.loadPromotionsAfterMutation('x');
    expect(cmp.promotionsError()).toBe('adminUi.couponsV2.errors.loadPromotions');
  });

  // ----- loadCoupons -----

  it('loadCoupons clears coupons when no promotion is selected', () => {
    const cmp = create();
    cmp.coupons.set([makeCoupon()]);
    cmp.loadCoupons();
    expect(cmp.coupons()).toEqual([]);
  });

  it('loadCoupons fetches and drops a stale selected coupon', () => {
    adminCoupons.listCoupons.and.returnValue(of([makeCoupon({ id: 'keep' })]));
    const cmp = create();
    cmp.selectedPromotion.set(makePromotion());
    cmp.selectedCoupon.set(makeCoupon({ id: 'gone' }));
    cmp.couponQuery = ' code ';
    cmp.loadCoupons();
    expect(cmp.coupons()[0].id).toBe('keep');
    expect(cmp.selectedCoupon()).toBeNull();
  });

  it('loadCoupons normalizes a non-array payload', () => {
    adminCoupons.listCoupons.and.returnValue(of(null as any));
    const cmp = create();
    cmp.selectedPromotion.set(makePromotion());
    cmp.loadCoupons();
    expect(cmp.coupons()).toEqual([]);
  });

  it('loadCoupons reports errors', () => {
    adminCoupons.listCoupons.and.returnValue(throwError(() => ({})));
    const cmp = create();
    cmp.selectedPromotion.set(makePromotion());
    cmp.loadCoupons();
    expect(cmp.couponsError()).toBe('adminUi.couponsV2.errors.loadCoupons');
  });

  // ----- loadAnalytics -----

  it('loadAnalytics clears state with no promotion', () => {
    const cmp = create();
    cmp.analytics.set(makeAnalytics());
    cmp.loadAnalytics();
    expect(cmp.analytics()).toBeNull();
  });

  it('loadAnalytics scopes to the selected coupon when requested', () => {
    const cmp = create();
    cmp.selectedPromotion.set(makePromotion());
    cmp.selectedCoupon.set(makeCoupon());
    cmp.analyticsOnlySelectedCoupon = true;
    cmp.loadAnalytics();
    const args = adminCoupons.getAnalytics.calls.mostRecent().args[0];
    expect(args.coupon_id).toBe('coupon-1');
    expect(cmp.analytics()).not.toBeNull();
  });

  it('loadAnalytics handles a null payload and errors', () => {
    adminCoupons.getAnalytics.and.returnValue(of(null as any));
    const cmp = create();
    cmp.selectedPromotion.set(makePromotion());
    cmp.loadAnalytics();
    expect(cmp.analytics()).toBeNull();

    adminCoupons.getAnalytics.and.returnValue(throwError(() => ({})));
    cmp.loadAnalytics();
    expect(cmp.analyticsError()).toBe('adminUi.couponsV2.errors.loadAnalytics');
  });

  // ----- A/B test gating -----

  it('abCanRun enforces assigned visibility for both coupons', () => {
    const cmp = create();
    expect(cmp.abCanRun()).toBeFalse();
    cmp.selectedCoupon.set(makeCoupon({ visibility: 'public' }));
    expect(cmp.abCanRun()).toBeFalse();
    cmp.selectedCoupon.set(makeCoupon({ visibility: 'assigned' }));
    cmp.abCouponB.set(makeCoupon({ id: 'b', visibility: 'public' }));
    expect(cmp.abCanRun()).toBeFalse();
    cmp.abCouponB.set(makeCoupon({ id: 'b', visibility: 'assigned' }));
    expect(cmp.abCanRun()).toBeTrue();
  });

  it('abSearchCoupons clears results for an empty query', () => {
    const cmp = create();
    cmp.abCouponResults.set([makeCoupon()]);
    cmp.abCouponQuery = '';
    cmp.abSearchCoupons();
    expect(cmp.abCouponResults()).toEqual([]);
  });

  it('abSearchCoupons filters out the current coupon and caps to 10', () => {
    const many = Array.from({ length: 12 }, (_, i) => makeCoupon({ id: `c${i}`, code: `C${i}` }));
    adminCoupons.listCoupons.and.returnValue(of([makeCoupon({ id: 'self' }), ...many]));
    const cmp = create();
    cmp.selectedCoupon.set(makeCoupon({ id: 'self' }));
    cmp.abCouponQuery = 'C';
    cmp.abSearchCoupons();
    expect(cmp.abCouponResults().length).toBe(10);
    expect(cmp.abCouponResults().some((c) => c.id === 'self')).toBeFalse();
  });

  it('abSearchCoupons handles a non-array payload and errors', () => {
    adminCoupons.listCoupons.and.returnValue(of(null as any));
    const cmp = create();
    cmp.abCouponQuery = 'C';
    cmp.abSearchCoupons();
    expect(cmp.abCouponResults()).toEqual([]);

    adminCoupons.listCoupons.and.returnValue(throwError(() => ({})));
    cmp.abSearchCoupons();
    expect(cmp.abCouponError()).toBe('adminUi.couponsV2.ab.searchError');
  });

  it('selectAbCouponB ignores invalid or self selections', () => {
    const cmp = create();
    cmp.selectAbCouponB({ id: '' } as any);
    expect(cmp.abCouponB()).toBeNull();
    cmp.selectedCoupon.set(makeCoupon({ id: 'same' }));
    cmp.selectAbCouponB(makeCoupon({ id: 'same' }));
    expect(cmp.abCouponB()).toBeNull();
  });

  it('selectAbCouponB stores B and seeds a default bucket', () => {
    const cmp = create();
    cmp.selectedCoupon.set(makeCoupon({ id: 'a' }));
    cmp.selectAbCouponB(makeCoupon({ id: 'b', code: 'BCODE' }));
    expect(cmp.abCouponB()?.id).toBe('b');
    expect(cmp.abBucketSeed).toBe('ab:a:b');
  });

  it('selectAbCouponB keeps an existing bucket seed', () => {
    const cmp = create();
    cmp.selectedCoupon.set(makeCoupon({ id: 'a' }));
    cmp.abBucketSeed = 'custom';
    cmp.selectAbCouponB(makeCoupon({ id: 'b', code: '' }));
    expect(cmp.abBucketSeed).toBe('custom');
  });

  it('startAbTest returns early without both coupons', () => {
    const cmp = create();
    cmp.startAbTest();
    expect(adminCoupons.startSegmentAssignJob).not.toHaveBeenCalled();
  });

  it('startAbTest blocks when the A/B gate fails', () => {
    const cmp = create();
    cmp.selectedCoupon.set(makeCoupon({ visibility: 'public' }));
    cmp.abCouponB.set(makeCoupon({ id: 'b', visibility: 'public' }));
    cmp.startAbTest();
    expect(toast.error).toHaveBeenCalled();
    expect(adminCoupons.startSegmentAssignJob).not.toHaveBeenCalled();
  });

  it('startAbTest launches both jobs and polls to completion', fakeAsync(() => {
    adminCoupons.startSegmentAssignJob.and.callFake((id: string) =>
      of(makeJob({ id: `${id}-job`, status: 'running' })),
    );
    adminCoupons.getBulkJob.and.returnValue(of(makeJob({ status: 'succeeded' })));
    const cmp = create();
    cmp.selectedCoupon.set(makeCoupon({ id: 'a', visibility: 'assigned' }));
    cmp.abCouponB.set(makeCoupon({ id: 'b', visibility: 'assigned' }));
    cmp.startAbTest();
    expect(cmp.abJobA()).not.toBeNull();
    expect(cmp.abJobB()).not.toBeNull();
    tick(2000);
    expect(adminCoupons.getBulkJob).toHaveBeenCalled();
    cmp.ngOnDestroy();
  }));

  it('startAbTest reports a launch error', () => {
    adminCoupons.startSegmentAssignJob.and.returnValue(
      throwError(() => ({ error: { detail: 'x' } })),
    );
    const cmp = create();
    cmp.selectedCoupon.set(makeCoupon({ id: 'a', visibility: 'assigned' }));
    cmp.abCouponB.set(makeCoupon({ id: 'b', visibility: 'assigned' }));
    cmp.abBucketSeed = 'seed';
    cmp.startAbTest();
    expect(toast.error).toHaveBeenCalledWith('adminUi.couponsV2.ab.startError', 'x');
    expect(cmp.abBusy()).toBeFalse();
  });

  it('loadAbAnalytics clears without both coupons', () => {
    const cmp = create();
    cmp.abAnalyticsA.set(makeAnalytics());
    cmp.loadAbAnalytics();
    expect(cmp.abAnalyticsA()).toBeNull();
  });

  it('loadAbAnalytics loads both sides', () => {
    const cmp = create();
    cmp.selectedCoupon.set(makeCoupon({ id: 'a' }));
    cmp.abCouponB.set(makeCoupon({ id: 'b' }));
    cmp.loadAbAnalytics();
    expect(cmp.abAnalyticsA()).not.toBeNull();
    expect(cmp.abAnalyticsB()).not.toBeNull();
  });

  it('loadAbAnalytics reports errors', () => {
    adminCoupons.getAnalytics.and.returnValue(throwError(() => ({})));
    const cmp = create();
    cmp.selectedCoupon.set(makeCoupon({ id: 'a' }));
    cmp.abCouponB.set(makeCoupon({ id: 'b' }));
    cmp.loadAbAnalytics();
    expect(cmp.abAnalyticsError()).toBe('adminUi.couponsV2.errors.loadAnalytics');
  });

  // ----- coupon selection / creation -----

  it('selectCoupon loads assignments and segment jobs', () => {
    const cmp = create();
    cmp.analyticsOnlySelectedCoupon = true;
    cmp.selectedPromotion.set(makePromotion());
    cmp.selectCoupon(makeCoupon());
    expect(cmp.selectedCoupon()?.id).toBe('coupon-1');
    expect(adminCoupons.listAssignments).toHaveBeenCalledWith('coupon-1');
    expect(adminCoupons.listBulkJobs).toHaveBeenCalled();
    expect(adminCoupons.getAnalytics).toHaveBeenCalled();
  });

  it('startNewCoupon prefills the promotion id and prefix', () => {
    const cmp = create();
    cmp.selectedPromotion.set(makePromotion());
    cmp.startNewCoupon();
    expect(cmp.couponForm.promotion_id).toBe('promo-1');
    expect(cmp.couponCodeGen.prefix).toBe('SUMMER');
  });

  it('startNewCoupon without a promotion leaves the id blank', () => {
    const cmp = create();
    cmp.startNewCoupon();
    expect(cmp.couponForm.promotion_id).toBe('');
    expect(cmp.couponCodeGen.prefix).toBe('COUPON');
  });

  it('suggestedCouponPrefix prefers key, then name, then COUPON', () => {
    const cmp = create();
    cmp.selectedPromotion.set(makePromotion({ key: 'KEYP' }));
    expect((cmp as any).suggestedCouponPrefix()).toBe('KEYP');
    cmp.selectedPromotion.set(makePromotion({ key: null, name: 'Named' }));
    expect((cmp as any).suggestedCouponPrefix()).toBe('Named');
    cmp.selectedPromotion.set(makePromotion({ key: '   ', name: '' }));
    expect((cmp as any).suggestedCouponPrefix()).toBe('COUPON');
  });

  it('generateCouponCode returns early when editing', () => {
    const cmp = create();
    cmp.selectedCoupon.set(makeCoupon());
    cmp.generateCouponCode();
    expect(adminCoupons.generateCouponCode).not.toHaveBeenCalled();
  });

  it('generateCouponCode applies a generated uppercased code', () => {
    adminCoupons.generateCouponCode.and.returnValue(of({ code: 'abc123' }));
    const cmp = create();
    cmp.couponCodeGen = { prefix: '', pattern: '', length: 'oops' as any };
    cmp.generateCouponCode();
    const args = adminCoupons.generateCouponCode.calls.mostRecent().args[0];
    expect(args.length).toBe(12);
    expect(args.pattern).toBeNull();
    expect(cmp.couponForm.code).toBe('ABC123');
    expect(toast.success).toHaveBeenCalled();
  });

  it('generateCouponCode skips the success toast for an empty code', () => {
    adminCoupons.generateCouponCode.and.returnValue(of({ code: '' }));
    const cmp = create();
    cmp.couponCodeGen = { prefix: 'P', pattern: 'XXXX', length: 8 };
    cmp.generateCouponCode();
    expect(cmp.couponForm.code).toBe('');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('generateCouponCode reports an error', () => {
    adminCoupons.generateCouponCode.and.returnValue(
      throwError(() => ({ error: { detail: 'bad' } })),
    );
    const cmp = create();
    cmp.generateCouponCode();
    expect(toast.error).toHaveBeenCalledWith('adminUi.couponsV2.errors.validation', 'bad');
    expect(cmp.couponCodeGenerating()).toBeFalse();
  });

  // ----- saveCoupon -----

  it('saveCoupon requires a promotion id', () => {
    const cmp = create();
    cmp.couponForm.promotion_id = '';
    cmp.saveCoupon();
    expect(toast.error).toHaveBeenCalled();
    expect(adminCoupons.createCoupon).not.toHaveBeenCalled();
  });

  it('saveCoupon requires a code when creating', () => {
    const cmp = create();
    cmp.couponForm.promotion_id = 'promo-1';
    cmp.couponForm.code = '';
    cmp.saveCoupon();
    expect(adminCoupons.createCoupon).not.toHaveBeenCalled();
  });

  it('saveCoupon creates a coupon and reloads', () => {
    adminCoupons.createCoupon.and.returnValue(of(makeCoupon({ id: 'c-new' })));
    adminCoupons.listCoupons.and.returnValue(of([makeCoupon({ id: 'c-new' })]));
    adminCoupons.listAssignments.and.returnValue(of([]));
    const cmp = create();
    cmp.selectedPromotion.set(makePromotion());
    cmp.couponForm.promotion_id = 'promo-1';
    cmp.couponForm.code = 'new10';
    cmp.couponForm.starts_at = '2026-02-01T00:00';
    cmp.couponForm.ends_at = '2026-03-01T00:00';
    cmp.couponForm.global_max_redemptions = 5;
    cmp.saveCoupon();
    expect(adminCoupons.createCoupon).toHaveBeenCalled();
    expect(cmp.selectedCoupon()?.id).toBe('c-new');
  });

  it('saveCoupon updates an existing coupon', () => {
    adminCoupons.updateCoupon.and.returnValue(of(makeCoupon()));
    adminCoupons.listCoupons.and.returnValue(of([makeCoupon()]));
    const cmp = create();
    cmp.selectedPromotion.set(makePromotion());
    cmp.selectedCoupon.set(makeCoupon());
    cmp.couponForm = (cmp as any).couponToForm(makeCoupon());
    cmp.saveCoupon();
    expect(adminCoupons.updateCoupon).toHaveBeenCalledWith('coupon-1', jasmine.any(Object));
  });

  it('saveCoupon reports a save error', () => {
    adminCoupons.createCoupon.and.returnValue(throwError(() => ({ error: { detail: 'fail' } })));
    const cmp = create();
    cmp.couponForm.promotion_id = 'promo-1';
    cmp.couponForm.code = 'X';
    cmp.saveCoupon();
    expect(toast.error).toHaveBeenCalledWith('adminUi.couponsV2.errors.saveCoupon', 'fail');
    expect(cmp.couponSaving()).toBeFalse();
  });

  // ----- loadCouponsAfterMutation -----

  it('loadCouponsAfterMutation clears coupons without a promotion', () => {
    const cmp = create();
    cmp.coupons.set([makeCoupon()]);
    cmp.loadCouponsAfterMutation('x');
    expect(cmp.coupons()).toEqual([]);
  });

  it('loadCouponsAfterMutation selects the requested coupon', () => {
    adminCoupons.listCoupons.and.returnValue(of([makeCoupon({ id: 'sel' })]));
    adminCoupons.listAssignments.and.returnValue(of([]));
    const cmp = create();
    cmp.selectedPromotion.set(makePromotion());
    cmp.loadCouponsAfterMutation('sel');
    expect(cmp.selectedCoupon()?.id).toBe('sel');
  });

  it('loadCouponsAfterMutation handles a null payload and errors', () => {
    adminCoupons.listCoupons.and.returnValue(of(null as any));
    const cmp = create();
    cmp.selectedPromotion.set(makePromotion());
    cmp.loadCouponsAfterMutation(null);
    expect(cmp.coupons()).toEqual([]);

    adminCoupons.listCoupons.and.returnValue(throwError(() => ({})));
    cmp.loadCouponsAfterMutation('x');
    expect(cmp.couponsError()).toBe('adminUi.couponsV2.errors.loadCoupons');
  });

  // ----- loadAssignments -----

  it('loadAssignments clears without a coupon', () => {
    const cmp = create();
    cmp.assignments.set([{ id: 'a' } as any]);
    cmp.loadAssignments();
    expect(cmp.assignments()).toEqual([]);
  });

  it('loadAssignments fetches and normalizes rows', () => {
    adminCoupons.listAssignments.and.returnValue(of(null as any));
    const cmp = create();
    cmp.selectedCoupon.set(makeCoupon());
    cmp.loadAssignments();
    expect(cmp.assignments()).toEqual([]);
    expect(cmp.assignmentsLoading()).toBeFalse();
  });

  it('loadAssignments reports errors', () => {
    adminCoupons.listAssignments.and.returnValue(throwError(() => ({})));
    const cmp = create();
    cmp.selectedCoupon.set(makeCoupon());
    cmp.loadAssignments();
    expect(cmp.assignmentsError()).toBe('adminUi.couponsV2.errors.loadAssignments');
  });

  // ----- assign / revoke -----

  it('assign requires a coupon and an email', () => {
    const cmp = create();
    cmp.assign();
    expect(adminCoupons.assignCoupon).not.toHaveBeenCalled();
    cmp.selectedCoupon.set(makeCoupon());
    cmp.assignEmail = '';
    cmp.assign();
    expect(toast.error).toHaveBeenCalled();
    expect(adminCoupons.assignCoupon).not.toHaveBeenCalled();
  });

  it('assign sends and refreshes on success', () => {
    adminCoupons.assignCoupon.and.returnValue(of(undefined));
    adminCoupons.listAssignments.and.returnValue(of([]));
    const cmp = create();
    cmp.selectedCoupon.set(makeCoupon());
    cmp.assignEmail = ' user@x.com ';
    cmp.assign();
    expect(adminCoupons.assignCoupon).toHaveBeenCalledWith('coupon-1', {
      email: 'user@x.com',
      send_email: true,
    });
    expect(cmp.assignEmail).toBe('');
  });

  it('assign reports an error', () => {
    adminCoupons.assignCoupon.and.returnValue(throwError(() => ({ error: { detail: 'e' } })));
    const cmp = create();
    cmp.selectedCoupon.set(makeCoupon());
    cmp.assignEmail = 'user@x.com';
    cmp.assign();
    expect(toast.error).toHaveBeenCalledWith('adminUi.couponsV2.errors.assign', 'e');
  });

  it('revoke requires a coupon and an email', () => {
    const cmp = create();
    cmp.revoke();
    expect(adminCoupons.revokeCoupon).not.toHaveBeenCalled();
    cmp.selectedCoupon.set(makeCoupon());
    cmp.revokeEmail = '';
    cmp.revoke();
    expect(toast.error).toHaveBeenCalled();
  });

  it('revoke sends with a reason and refreshes', () => {
    adminCoupons.revokeCoupon.and.returnValue(of(undefined));
    adminCoupons.listAssignments.and.returnValue(of([]));
    const cmp = create();
    cmp.selectedCoupon.set(makeCoupon());
    cmp.revokeEmail = 'user@x.com';
    cmp.revokeReason = ' abuse ';
    cmp.revoke();
    expect(adminCoupons.revokeCoupon).toHaveBeenCalledWith('coupon-1', {
      email: 'user@x.com',
      reason: 'abuse',
      send_email: true,
    });
    expect(cmp.revokeReason).toBe('');
  });

  it('revoke sends a null reason when blank and reports errors', () => {
    adminCoupons.revokeCoupon.and.returnValue(throwError(() => ({})));
    const cmp = create();
    cmp.selectedCoupon.set(makeCoupon());
    cmp.revokeEmail = 'user@x.com';
    cmp.revoke();
    const args = adminCoupons.revokeCoupon.calls.mostRecent().args[1];
    expect(args.reason).toBeNull();
    expect(toast.error).toHaveBeenCalledWith('adminUi.couponsV2.errors.revoke', undefined);
  });

  // ----- products -----

  it('searchProducts clears for an empty query', () => {
    const cmp = create();
    cmp.products.set([{ id: 'p' } as any]);
    cmp.productQuery = '';
    cmp.searchProducts();
    expect(cmp.products()).toEqual([]);
  });

  it('searchProducts loads and caches results', () => {
    adminProducts.search.and.returnValue(
      of({ items: [{ id: 'p1', name: 'Widget' }], meta: { page: 1, limit: 20, total: 1 } } as any),
    );
    const cmp = create();
    cmp.productQuery = 'wid';
    cmp.searchProducts();
    expect(cmp.products().length).toBe(1);
    expect(cmp.productLabel('p1')).toBe('Widget');
  });

  it('searchProducts handles a null items payload and errors', () => {
    adminProducts.search.and.returnValue(of({ items: null } as any));
    const cmp = create();
    cmp.productQuery = 'wid';
    cmp.searchProducts();
    expect(cmp.products()).toEqual([]);

    adminProducts.search.and.returnValue(throwError(() => ({})));
    cmp.searchProducts();
    expect(cmp.productsError()).toBe('adminUi.couponsV2.errors.searchProducts');
  });

  it('resetProductSearch clears query and results', () => {
    const cmp = create();
    cmp.productQuery = 'x';
    cmp.products.set([{ id: 'p' } as any]);
    cmp.resetProductSearch();
    expect(cmp.productQuery).toBe('');
    expect(cmp.products()).toEqual([]);
  });

  it('addScopeProduct ignores products without an id', () => {
    const cmp = create();
    cmp.addScopeProduct('include', { id: '' } as any);
    expect(cmp.promotionForm.included_product_ids).toEqual([]);
  });

  it('addScopeProduct includes and de-conflicts with exclude', () => {
    const cmp = create();
    cmp.promotionForm.excluded_product_ids = ['p1'];
    cmp.addScopeProduct('include', { id: 'p1', name: 'W' } as any);
    expect(cmp.promotionForm.included_product_ids).toEqual(['p1']);
    expect(cmp.promotionForm.excluded_product_ids).toEqual([]);
    // adding again does not duplicate
    cmp.addScopeProduct('include', { id: 'p1', name: 'W' } as any);
    expect(cmp.promotionForm.included_product_ids).toEqual(['p1']);
  });

  it('addScopeProduct excludes and de-conflicts with include', () => {
    const cmp = create();
    cmp.promotionForm.included_product_ids = ['p2'];
    cmp.addScopeProduct('exclude', { id: 'p2', name: 'X' } as any);
    expect(cmp.promotionForm.excluded_product_ids).toEqual(['p2']);
    expect(cmp.promotionForm.included_product_ids).toEqual([]);
    cmp.addScopeProduct('exclude', { id: 'p2', name: 'X' } as any);
    expect(cmp.promotionForm.excluded_product_ids).toEqual(['p2']);
  });

  it('removeScopeProduct removes from the right list', () => {
    const cmp = create();
    cmp.promotionForm.included_product_ids = ['a', 'b'];
    cmp.promotionForm.excluded_product_ids = ['c', 'd'];
    cmp.removeScopeProduct('include', 'a');
    expect(cmp.promotionForm.included_product_ids).toEqual(['b']);
    cmp.removeScopeProduct('exclude', 'c');
    expect(cmp.promotionForm.excluded_product_ids).toEqual(['d']);
  });

  it('syncCategoryScopes drops overlaps based on the changed side', () => {
    const cmp = create();
    cmp.promotionForm.included_category_ids = ['c1', 'c2', 'c2'];
    cmp.promotionForm.excluded_category_ids = ['c2', 'c3'];
    cmp.syncCategoryScopes('included');
    expect(cmp.promotionForm.included_category_ids).toEqual(['c1', 'c2']);
    expect(cmp.promotionForm.excluded_category_ids).toEqual(['c3']);

    cmp.promotionForm.included_category_ids = ['c4', 'c5'];
    cmp.promotionForm.excluded_category_ids = ['c5', 'c6'];
    cmp.syncCategoryScopes('excluded');
    expect(cmp.promotionForm.excluded_category_ids).toEqual(['c5', 'c6']);
    expect(cmp.promotionForm.included_category_ids).toEqual(['c4']);
  });

  it('productLabel returns the id when uncached', () => {
    const cmp = create();
    expect(cmp.productLabel('unknown')).toBe('unknown');
  });

  // ----- describePromotion -----

  it('describePromotion summarizes each discount type', () => {
    const cmp = create();
    expect(cmp.describePromotion(null as any)).toBe('');
    expect(cmp.describePromotion(makePromotion({ discount_type: 'free_shipping' }))).toBe(
      'adminUi.couponsV2.discountSummary.freeShipping',
    );
    expect(cmp.describePromotion(makePromotion({ discount_type: 'amount', amount_off: '5' }))).toBe(
      'adminUi.couponsV2.discountSummary.amountOff',
    );
    expect(
      cmp.describePromotion(makePromotion({ discount_type: 'amount', amount_off: null })),
    ).toBe('adminUi.couponsV2.discountSummary.amountOff');
    expect(
      cmp.describePromotion(makePromotion({ discount_type: 'percent', percentage_off: null })),
    ).toBe('adminUi.couponsV2.discountSummary.percentOff');
  });

  // ----- calendar / schedule -----

  it('promotionCalendarEndDate offsets the start by the window length', () => {
    const cmp = create();
    cmp.promotionCalendarDays = 30;
    const start = cmp.promotionCalendarStartDate();
    const end = cmp.promotionCalendarEndDate();
    expect(end.getTime() - start.getTime()).toBe(30 * 86_400_000);
  });

  it('promotionScheduleRows returns nothing without promotions', () => {
    const cmp = create();
    expect(cmp.promotionScheduleRows()).toEqual([]);
  });

  it('promotionScheduleRows skips out-of-window and invalid ranges', () => {
    const cmp = create();
    const iso = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
    cmp.promotions.set([
      makePromotion({
        id: 'past',
        starts_at: '2000-01-01T00:00:00Z',
        ends_at: '2000-02-01T00:00:00Z',
      }),
      makePromotion({ id: 'inverted', starts_at: iso(10), ends_at: iso(5) }),
    ]);
    expect(cmp.promotionScheduleRows()).toEqual([]);
  });

  it('promotionScheduleRows treats an unparseable date as an open bound', () => {
    const cmp = create();
    cmp.promotions.set([makePromotion({ id: 'weird', starts_at: 'not-a-date', ends_at: null })]);
    const rows = cmp.promotionScheduleRows();
    expect(rows.length).toBe(1);
    expect(rows[0].leftPct).toBe(0);
  });

  it('promotionScheduleRows keeps non-overlapping active promotions conflict-free', () => {
    const cmp = create();
    const iso = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
    cmp.promotions.set([
      makePromotion({ id: 'early', name: 'Early', starts_at: iso(1), ends_at: iso(5) }),
      makePromotion({ id: 'late', name: 'Late', starts_at: iso(20), ends_at: iso(30) }),
    ]);
    const rows = cmp.promotionScheduleRows();
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.conflictCount === 0)).toBeTrue();
  });

  it('promotionScheduleRows reports a single conflict pair', () => {
    const cmp = create();
    cmp.promotions.set([
      makePromotion({ id: 'a', name: 'A' }),
      makePromotion({ id: 'b', name: 'B' }),
      makePromotion({ id: 'inactive', name: 'I', is_active: false }),
    ]);
    const rows = cmp.promotionScheduleRows();
    const a = rows.find((r) => r.promotion.id === 'a')!;
    expect(a.conflictCount).toBe(1);
    expect(a.conflictNames).toContain('B');
    const inactive = rows.find((r) => r.promotion.id === 'inactive')!;
    expect(inactive.conflictCount).toBe(0);
  });

  it('promotionScheduleRows truncates conflict names beyond six', () => {
    const cmp = create();
    const promos = Array.from({ length: 8 }, (_, i) =>
      makePromotion({ id: `p${i}`, name: `Name${i}` }),
    );
    cmp.promotions.set(promos);
    const rows = cmp.promotionScheduleRows();
    const sample = rows[0];
    expect(sample.conflictCount).toBe(7);
    expect(sample.conflictNames).toContain('+1');
  });

  // ----- loadScopedProducts (via private) -----

  it('loadScopedProducts short-circuits when nothing is missing', () => {
    const cmp = create();
    cmp.promotionForm.included_product_ids = [];
    cmp.promotionForm.excluded_product_ids = [];
    (cmp as any).loadScopedProducts();
    expect(adminProducts.byIds).not.toHaveBeenCalled();
    expect(cmp.scopeProductsLoading()).toBeFalse();
  });

  it('loadScopedProducts resolves missing ids and caches them', () => {
    adminProducts.byIds.and.returnValue(of([{ id: 'pX', name: 'Resolved' }] as any));
    const cmp = create();
    cmp.promotionForm.included_product_ids = ['pX'];
    cmp.promotionForm.excluded_product_ids = [];
    (cmp as any).loadScopedProducts();
    expect(adminProducts.byIds).toHaveBeenCalledWith(['pX']);
    expect(cmp.productLabel('pX')).toBe('Resolved');
    expect(cmp.scopeProductsLoading()).toBeFalse();
  });

  it('loadScopedProducts reports a resolve error', () => {
    adminProducts.byIds.and.returnValue(throwError(() => ({})));
    const cmp = create();
    cmp.promotionForm.included_product_ids = ['pY'];
    cmp.promotionForm.excluded_product_ids = [];
    (cmp as any).loadScopedProducts();
    expect(cmp.scopeProductsError()).toBe('adminUi.couponsV2.errors.resolveProducts');
    expect(cmp.scopeProductsLoading()).toBeFalse();
  });

  // ----- promotionPayloadFromForm / forms -----

  it('promotionPayloadFromForm builds a percent payload with dates', () => {
    const cmp = create();
    cmp.promotionForm.name = 'P';
    cmp.promotionForm.discount_type = 'percent';
    cmp.promotionForm.percentage_off = 15;
    cmp.promotionForm.starts_at = '2026-02-01T00:00';
    cmp.promotionForm.ends_at = '2026-03-01T00:00';
    const payload = (cmp as any).promotionPayloadFromForm();
    expect(payload.percentage_off).toBe('15');
    expect(payload.amount_off).toBeNull();
    expect(payload.starts_at).toContain('2026');
    expect(payload.key).toBeNull();
    expect(payload.description).toBeNull();
  });

  it('promotionPayloadFromForm builds an amount payload and keeps key/description', () => {
    const cmp = create();
    cmp.promotionForm.name = 'P';
    cmp.promotionForm.key = 'K';
    cmp.promotionForm.description = 'desc';
    cmp.promotionForm.discount_type = 'amount';
    cmp.promotionForm.amount_off = 20;
    const payload = (cmp as any).promotionPayloadFromForm();
    expect(payload.amount_off).toBe('20');
    expect(payload.percentage_off).toBeNull();
    expect(payload.key).toBe('K');
    expect(payload.description).toBe('desc');
    expect(payload.starts_at).toBeNull();
  });

  it('promotionToForm normalizes nullable fields and arrays', () => {
    const cmp = create();
    const form = (cmp as any).promotionToForm(
      makePromotion({
        key: null,
        description: null,
        percentage_off: null,
        amount_off: null,
        allow_on_sale_items: false,
        first_order_only: true,
        starts_at: '2026-02-01T00:00:00Z',
        ends_at: null,
        is_active: false,
        name: null,
        included_product_ids: null,
        excluded_product_ids: null,
        included_category_ids: null,
        excluded_category_ids: null,
      }),
    );
    expect(form.key).toBe('');
    expect(form.name).toBe('');
    expect(form.allow_on_sale_items).toBeFalse();
    expect(form.first_order_only).toBeTrue();
    expect(form.is_active).toBeFalse();
    expect(form.starts_at).not.toBe('');
    expect(form.ends_at).toBe('');
    expect(form.included_product_ids).toEqual([]);
    expect(form.excluded_product_ids).toEqual([]);
    expect(form.included_category_ids).toEqual([]);
    expect(form.excluded_category_ids).toEqual([]);
  });

  it('promotionToForm keeps a populated end date and arrays', () => {
    const cmp = create();
    const form = (cmp as any).promotionToForm(
      makePromotion({
        starts_at: null,
        ends_at: '2026-03-01T00:00:00Z',
        included_product_ids: ['a'],
        excluded_product_ids: ['b'],
        included_category_ids: ['c'],
        excluded_category_ids: ['d'],
      }),
    );
    expect(form.starts_at).toBe('');
    expect(form.ends_at).not.toBe('');
    expect(form.included_product_ids).toEqual(['a']);
    expect(form.excluded_product_ids).toEqual(['b']);
    expect(form.included_category_ids).toEqual(['c']);
    expect(form.excluded_category_ids).toEqual(['d']);
  });

  it('couponToForm maps a coupon into form fields', () => {
    const cmp = create();
    const form = (cmp as any).couponToForm(
      makeCoupon({ starts_at: '2026-02-01T00:00:00Z', ends_at: null, global_max_redemptions: 3 }),
    );
    expect(form.code).toBe('SAVE10');
    expect(form.starts_at).not.toBe('');
    expect(form.ends_at).toBe('');
    expect(form.global_max_redemptions).toBe(3);
  });

  it('couponToForm keeps a populated end date and blank start', () => {
    const cmp = create();
    const form = (cmp as any).couponToForm(
      makeCoupon({ starts_at: null, ends_at: '2026-03-01T00:00:00Z' }),
    );
    expect(form.starts_at).toBe('');
    expect(form.ends_at).not.toBe('');
  });

  // ----- stacking preview -----

  it('stackingMinSubtotalBlocked reflects the min subtotal threshold', () => {
    const cmp = create();
    expect(cmp.stackingMinSubtotalBlocked()).toBeFalse();
    cmp.promotionForm.min_subtotal = 100;
    cmp.stackingSampleSubtotal = '';
    expect(cmp.stackingMinSubtotalBlocked()).toBeFalse();
    cmp.stackingSampleSubtotal = 50;
    expect(cmp.stackingMinSubtotalBlocked()).toBeTrue();
    cmp.stackingSampleSubtotal = 150;
    expect(cmp.stackingMinSubtotalBlocked()).toBeFalse();
  });

  it('stackingPreviewProductDiscount returns null for free shipping', () => {
    const cmp = create();
    cmp.promotionForm.discount_type = 'free_shipping';
    expect(cmp.stackingPreviewProductDiscount(false)).toBeNull();
  });

  it('stackingPreviewProductDiscount returns zero for non-positive subtotal', () => {
    const cmp = create();
    cmp.promotionForm.discount_type = 'percent';
    cmp.stackingSampleSubtotal = '';
    expect(cmp.stackingPreviewProductDiscount(false)).toBe(0);
    cmp.stackingSampleSubtotal = 0;
    expect(cmp.stackingPreviewProductDiscount(false)).toBe(0);
  });

  it('stackingPreviewProductDiscount returns zero when min subtotal blocks', () => {
    const cmp = create();
    cmp.promotionForm.discount_type = 'percent';
    cmp.promotionForm.percentage_off = 10;
    cmp.promotionForm.min_subtotal = 500;
    cmp.stackingSampleSubtotal = 100;
    expect(cmp.stackingPreviewProductDiscount(false)).toBe(0);
  });

  it('stackingPreviewProductDiscount zeroes ineligible on-sale items', () => {
    const cmp = create();
    cmp.promotionForm.discount_type = 'percent';
    cmp.promotionForm.percentage_off = 10;
    cmp.promotionForm.allow_on_sale_items = false;
    cmp.stackingSampleSubtotal = 100;
    expect(cmp.stackingPreviewProductDiscount(true)).toBe(0);
  });

  it('stackingPreviewProductDiscount computes a percent discount with a cap', () => {
    const cmp = create();
    cmp.promotionForm.discount_type = 'percent';
    cmp.promotionForm.percentage_off = 50;
    cmp.promotionForm.max_discount_amount = 30;
    cmp.stackingSampleSubtotal = 100;
    expect(cmp.stackingPreviewProductDiscount(false)).toBe(30);
  });

  it('stackingPreviewProductDiscount returns zero for an invalid percent', () => {
    const cmp = create();
    cmp.promotionForm.discount_type = 'percent';
    cmp.promotionForm.percentage_off = 0;
    cmp.stackingSampleSubtotal = 100;
    expect(cmp.stackingPreviewProductDiscount(false)).toBe(0);
  });

  it('stackingPreviewProductDiscount caps an amount discount to the subtotal', () => {
    const cmp = create();
    cmp.promotionForm.discount_type = 'amount';
    cmp.promotionForm.amount_off = 200;
    cmp.stackingSampleSubtotal = 80;
    expect(cmp.stackingPreviewProductDiscount(false)).toBe(80);
  });

  it('stackingPreviewProductDiscount returns zero for an invalid amount', () => {
    const cmp = create();
    cmp.promotionForm.discount_type = 'amount';
    cmp.promotionForm.amount_off = 0;
    cmp.stackingSampleSubtotal = 80;
    expect(cmp.stackingPreviewProductDiscount(false)).toBe(0);
  });

  // ----- formatting / numeric helpers -----

  it('formatRon and formatRonString handle valid and invalid values', () => {
    const cmp = create();
    expect(cmp.formatRon(null)).toBe('—');
    expect(cmp.formatRon(Infinity)).toBe('—');
    expect(cmp.formatRon(12.5)).toBe('12.50 RON');
    expect(cmp.formatRonString('7')).toBe('7.00 RON');
    expect(cmp.formatRonString(null)).toBe('—');
  });

  it('uniqueIds drops falsy values and duplicates', () => {
    const cmp = create();
    expect((cmp as any).uniqueIds(['a', '', 'a', 'b', null])).toEqual(['a', 'b']);
    expect((cmp as any).uniqueIds(null)).toEqual([]);
  });

  it('optionalDecimalString handles numbers, strings, and other types', () => {
    const cmp = create();
    expect((cmp as any).optionalDecimalString(5)).toBe('5');
    expect((cmp as any).optionalDecimalString(Infinity)).toBeNull();
    expect((cmp as any).optionalDecimalString('  7 ')).toBe('7');
    expect((cmp as any).optionalDecimalString('   ')).toBeNull();
    expect((cmp as any).optionalDecimalString(true)).toBeNull();
  });

  it('optionalNumber parses numbers and numeric strings', () => {
    const cmp = create();
    expect((cmp as any).optionalNumber(3)).toBe(3);
    expect((cmp as any).optionalNumber(Infinity)).toBeNull();
    expect((cmp as any).optionalNumber('4.5')).toBe(4.5);
    expect((cmp as any).optionalNumber('')).toBeNull();
    expect((cmp as any).optionalNumber('abc')).toBeNull();
    expect((cmp as any).optionalNumber(true)).toBeNull();
  });

  it('optionalInt truncates positive integers only', () => {
    const cmp = create();
    expect((cmp as any).optionalInt('x')).toBeNull();
    expect((cmp as any).optionalInt(5.9)).toBe(5);
    expect((cmp as any).optionalInt(-2)).toBeNull();
    expect((cmp as any).optionalInt(0)).toBeNull();
  });

  it('toLocalDateTime formats valid dates and rejects invalid ones', () => {
    const cmp = create();
    expect((cmp as any).toLocalDateTime('not-a-date')).toBe('');
    expect((cmp as any).toLocalDateTime('2026-02-03T04:05:00Z')).toMatch(
      /^2026-02-\d{2}T\d{2}:\d{2}$/,
    );
  });

  // ----- bulk CSV -----

  it('onBulkFileChange returns when no file is chosen', async () => {
    const cmp = create();
    await cmp.onBulkFileChange({ target: { files: [] } } as any);
    expect(cmp.bulkEmails).toEqual([]);
  });

  it('onBulkFileChange parses emails from a CSV file', async () => {
    const cmp = create();
    const file = {
      text: () => Promise.resolve('email\nuser@x.com\nuser@x.com\nbad\n"two@y.com"'),
    } as any;
    await cmp.onBulkFileChange({ target: { files: [file] } } as any);
    expect(cmp.bulkEmails).toEqual(['user@x.com', 'two@y.com']);
    expect(cmp.bulkDuplicates).toBe(1);
    expect(cmp.bulkInvalid).toEqual(['bad']);
  });

  it('onBulkFileChange captures a parse error', async () => {
    const cmp = create();
    const file = { text: () => Promise.reject(new Error('io')) } as any;
    await cmp.onBulkFileChange({ target: { files: [file] } } as any);
    expect(cmp.bulkParseError).toBe('adminUi.couponsV2.bulk.parseError');
  });

  it('clearBulkSelection clears the input and state', () => {
    const cmp = create();
    cmp.bulkEmails = ['a@x.com'];
    const input = { value: 'file.csv' } as HTMLInputElement;
    cmp.clearBulkSelection(input);
    expect(input.value).toBe('');
    expect(cmp.bulkEmails).toEqual([]);
    cmp.clearBulkSelection();
    expect(cmp.bulkEmails).toEqual([]);
  });

  it('bulkEmailsPreview shows a truncation suffix beyond six entries', () => {
    const cmp = create();
    expect(cmp.bulkEmailsPreview()).toBe('');
    cmp.bulkEmails = ['1@x.com', '2@x.com', '3@x.com'];
    expect(cmp.bulkEmailsPreview()).toBe('1@x.com, 2@x.com, 3@x.com');
    cmp.bulkEmails = Array.from({ length: 7 }, (_, i) => `${i}@x.com`);
    expect(cmp.bulkEmailsPreview().endsWith('…')).toBeTrue();
  });

  it('parseEmailsFromCsv truncates beyond the 500 cap', () => {
    const cmp = create();
    const rows = Array.from({ length: 600 }, (_, i) => `user${i}@x.com`).join('\n');
    const result = (cmp as any).parseEmailsFromCsv(rows);
    expect(result.emails.length).toBe(500);
    expect(result.truncated).toBe(100);
  });

  it('isValidEmail enforces basic shape constraints', () => {
    const cmp = create();
    const v = (e: string) => (cmp as any).isValidEmail(e);
    expect(v('')).toBeFalse();
    expect(v(`${'a'.repeat(256)}@x.com`)).toBeFalse();
    expect(v('nope')).toBeFalse();
    expect(v('@x.com')).toBeFalse();
    expect(v('user@')).toBeFalse();
    expect(v('user@localhost')).toBeFalse();
    expect(v('user@x.com')).toBeTrue();
  });

  // ----- bulk assign / revoke -----

  it('bulkAssign requires a coupon and emails', () => {
    const cmp = create();
    cmp.bulkAssign();
    expect(adminCoupons.bulkAssignCoupon).not.toHaveBeenCalled();
    cmp.selectedCoupon.set(makeCoupon());
    cmp.bulkEmails = [];
    cmp.bulkAssign();
    expect(toast.error).toHaveBeenCalled();
  });

  it('bulkAssign sends and stores the result', () => {
    adminCoupons.bulkAssignCoupon.and.returnValue(of(makeBulkResult()));
    adminCoupons.listAssignments.and.returnValue(of([]));
    const cmp = create();
    cmp.selectedCoupon.set(makeCoupon());
    cmp.bulkEmails = ['a@x.com'];
    cmp.bulkAssign();
    expect(cmp.bulkResult()?.created).toBe(1);
    expect(cmp.bulkBusy()).toBeFalse();
  });

  it('bulkAssign reports an error', () => {
    adminCoupons.bulkAssignCoupon.and.returnValue(throwError(() => ({})));
    const cmp = create();
    cmp.selectedCoupon.set(makeCoupon());
    cmp.bulkEmails = ['a@x.com'];
    cmp.bulkAssign();
    expect(toast.error).toHaveBeenCalledWith('adminUi.couponsV2.errors.assign', undefined);
  });

  it('bulkRevoke requires a coupon and emails', () => {
    const cmp = create();
    cmp.bulkRevoke();
    expect(adminCoupons.bulkRevokeCoupon).not.toHaveBeenCalled();
    cmp.selectedCoupon.set(makeCoupon());
    cmp.bulkEmails = [];
    cmp.bulkRevoke();
    expect(toast.error).toHaveBeenCalled();
  });

  it('bulkRevoke sends a reason and stores the result', () => {
    adminCoupons.bulkRevokeCoupon.and.returnValue(of(makeBulkResult({ revoked: 2 })));
    adminCoupons.listAssignments.and.returnValue(of([]));
    const cmp = create();
    cmp.selectedCoupon.set(makeCoupon());
    cmp.bulkEmails = ['a@x.com'];
    cmp.bulkRevokeReason = ' spam ';
    cmp.bulkRevoke();
    const args = adminCoupons.bulkRevokeCoupon.calls.mostRecent().args[1];
    expect(args.reason).toBe('spam');
    expect(cmp.bulkResult()?.revoked).toBe(2);
  });

  it('bulkRevoke reports an error and nulls a blank reason', () => {
    adminCoupons.bulkRevokeCoupon.and.returnValue(throwError(() => ({})));
    const cmp = create();
    cmp.selectedCoupon.set(makeCoupon());
    cmp.bulkEmails = ['a@x.com'];
    cmp.bulkRevoke();
    const args = adminCoupons.bulkRevokeCoupon.calls.mostRecent().args[1];
    expect(args.reason).toBeNull();
    expect(toast.error).toHaveBeenCalledWith('adminUi.couponsV2.errors.revoke', undefined);
  });

  // ----- segment helpers -----

  it('segmentJobInProgress tracks pending/running statuses', () => {
    const cmp = create();
    expect(cmp.segmentJobInProgress()).toBeFalse();
    cmp.segmentJob.set(makeJob({ status: 'running' }));
    expect(cmp.segmentJobInProgress()).toBeTrue();
    cmp.segmentJob.set(makeJob({ status: 'succeeded' }));
    expect(cmp.segmentJobInProgress()).toBeFalse();
  });

  it('segmentCandidatesCount prefers preview totals then the job', () => {
    const cmp = create();
    expect(cmp.segmentCandidatesCount()).toBe(0);
    cmp.segmentJob.set(makeJob({ total_candidates: 9 }));
    expect(cmp.segmentCandidatesCount()).toBe(9);
    cmp.segmentPreviewRevoke.set(makePreview({ total_candidates: 7 }));
    expect(cmp.segmentCandidatesCount()).toBe(7);
    cmp.segmentPreviewAssign.set(makePreview({ total_candidates: 4 }));
    expect(cmp.segmentCandidatesCount()).toBe(4);
  });

  it('segmentPreviewSample builds a sample string with suffix', () => {
    const cmp = create();
    expect(cmp.segmentPreviewSample()).toBe('');
    cmp.segmentPreviewRevoke.set(makePreview({ sample_emails: ['r@x.com'] }));
    expect(cmp.segmentPreviewSample()).toBe('r@x.com');
    cmp.segmentPreviewAssign.set(
      makePreview({ sample_emails: Array.from({ length: 7 }, (_, i) => `${i}@x.com`) }),
    );
    expect(cmp.segmentPreviewSample().endsWith('…')).toBeTrue();
  });

  it('loadSegmentJobs returns without a coupon', () => {
    const cmp = create();
    cmp.loadSegmentJobs();
    expect(adminCoupons.listBulkJobs).not.toHaveBeenCalled();
  });

  it('loadSegmentJobs loads and normalizes jobs', () => {
    adminCoupons.listBulkJobs.and.returnValue(of(null as any));
    const cmp = create();
    cmp.selectedCoupon.set(makeCoupon());
    cmp.loadSegmentJobs();
    expect(cmp.segmentJobs()).toEqual([]);
  });

  it('loadSegmentJobs reports an error', () => {
    adminCoupons.listBulkJobs.and.returnValue(throwError(() => ({})));
    const cmp = create();
    cmp.selectedCoupon.set(makeCoupon());
    cmp.loadSegmentJobs();
    expect(cmp.segmentJobsError()).toBe('adminUi.couponsV2.bulk.segment.jobsLoadError');
  });

  it('segmentPreview returns without a coupon', () => {
    const cmp = create();
    cmp.segmentPreview();
    expect(adminCoupons.previewSegmentAssign).not.toHaveBeenCalled();
  });

  it('segmentPreview loads both previews', () => {
    adminCoupons.previewSegmentAssign.and.returnValue(of(makePreview()));
    adminCoupons.previewSegmentRevoke.and.returnValue(of(makePreview({ revoked: 1 })));
    const cmp = create();
    cmp.selectedCoupon.set(makeCoupon());
    cmp.segmentRevokeReason = ' reason ';
    cmp.segmentPreview();
    expect(cmp.segmentPreviewAssign()).not.toBeNull();
    expect(cmp.segmentPreviewRevoke()?.revoked).toBe(1);
    const args = adminCoupons.previewSegmentRevoke.calls.mostRecent().args[1];
    expect(args.reason).toBe('reason');
  });

  it('segmentPreview reports an error', () => {
    adminCoupons.previewSegmentAssign.and.returnValue(throwError(() => ({})));
    adminCoupons.previewSegmentRevoke.and.returnValue(of(makePreview()));
    const cmp = create();
    cmp.selectedCoupon.set(makeCoupon());
    cmp.segmentPreview();
    expect(toast.error).toHaveBeenCalledWith(
      'adminUi.couponsV2.bulk.segment.previewError',
      undefined,
    );
    expect(cmp.segmentPreviewBusy()).toBeFalse();
  });

  it('segmentAssign returns without a coupon', () => {
    const cmp = create();
    cmp.segmentAssign();
    expect(adminCoupons.startSegmentAssignJob).not.toHaveBeenCalled();
  });

  it('segmentAssign starts a job and polls', fakeAsync(() => {
    adminCoupons.startSegmentAssignJob.and.returnValue(of(makeJob({ status: 'running' })));
    adminCoupons.getBulkJob.and.returnValue(of(makeJob({ status: 'running' })));
    const cmp = create();
    cmp.selectedCoupon.set(makeCoupon());
    cmp.segmentAssign();
    expect(cmp.segmentJob()?.id).toBe('job-1');
    expect(cmp.segmentJobs().length).toBe(1);
    tick(2000);
    expect(adminCoupons.getBulkJob).toHaveBeenCalled();
    cmp.ngOnDestroy();
  }));

  it('segmentAssign reports a start error', () => {
    adminCoupons.startSegmentAssignJob.and.returnValue(throwError(() => ({})));
    const cmp = create();
    cmp.selectedCoupon.set(makeCoupon());
    cmp.segmentAssign();
    expect(toast.error).toHaveBeenCalledWith('adminUi.couponsV2.errors.assign', undefined);
  });

  it('segmentRevoke returns without a coupon', () => {
    const cmp = create();
    cmp.segmentRevoke();
    expect(adminCoupons.startSegmentRevokeJob).not.toHaveBeenCalled();
  });

  it('segmentRevoke starts a job and polls', fakeAsync(() => {
    adminCoupons.startSegmentRevokeJob.and.returnValue(
      of(makeJob({ action: 'revoke', status: 'running' })),
    );
    adminCoupons.getBulkJob.and.returnValue(of(makeJob({ action: 'revoke', status: 'running' })));
    const cmp = create();
    cmp.selectedCoupon.set(makeCoupon());
    cmp.segmentRevokeReason = ' r ';
    cmp.segmentRevoke();
    expect(cmp.segmentJob()?.action).toBe('revoke');
    const args = adminCoupons.startSegmentRevokeJob.calls.mostRecent().args[1];
    expect(args.reason).toBe('r');
    tick(2000);
    cmp.ngOnDestroy();
  }));

  it('segmentRevoke reports a start error', () => {
    adminCoupons.startSegmentRevokeJob.and.returnValue(throwError(() => ({})));
    const cmp = create();
    cmp.selectedCoupon.set(makeCoupon());
    cmp.segmentRevoke();
    expect(toast.error).toHaveBeenCalledWith('adminUi.couponsV2.errors.revoke', undefined);
  });

  // ----- cancel / retry -----

  it('cancelSegmentJob ignores missing id or non-cancelable status', () => {
    const cmp = create();
    cmp.cancelSegmentJob({ id: '' } as any);
    cmp.cancelSegmentJob(makeJob({ status: 'succeeded' }));
    expect(adminCoupons.cancelBulkJob).not.toHaveBeenCalled();
  });

  it('cancelSegmentJob cancels and stops polling for the active job', () => {
    const cancelled = makeJob({ status: 'cancelled' });
    adminCoupons.cancelBulkJob.and.returnValue(of(cancelled));
    const cmp = create();
    cmp.segmentJob.set(makeJob({ status: 'running' }));
    cmp.segmentJobs.set([makeJob({ status: 'running' })]);
    cmp.cancelSegmentJob(makeJob({ status: 'running' }));
    expect(cmp.segmentJob()?.status).toBe('cancelled');
    expect(cmp.segmentJobsBusy()).toBeFalse();
  });

  it('cancelSegmentJob reports an error', () => {
    adminCoupons.cancelBulkJob.and.returnValue(throwError(() => ({})));
    const cmp = create();
    cmp.cancelSegmentJob(makeJob({ status: 'pending' }));
    expect(toast.error).toHaveBeenCalledWith(
      'adminUi.couponsV2.bulk.segment.cancelError',
      undefined,
    );
    expect(cmp.segmentJobsBusy()).toBeFalse();
  });

  it('retrySegmentJob ignores invalid states', () => {
    const cmp = create();
    cmp.retrySegmentJob({ id: '' } as any);
    cmp.retrySegmentJob(makeJob({ status: 'running' }));
    cmp.segmentJob.set(makeJob({ status: 'running' }));
    cmp.retrySegmentJob(makeJob({ status: 'failed' }));
    expect(adminCoupons.retryBulkJob).not.toHaveBeenCalled();
  });

  it('retrySegmentJob starts a new job and polls', fakeAsync(() => {
    adminCoupons.retryBulkJob.and.returnValue(of(makeJob({ id: 'retry', status: 'running' })));
    adminCoupons.getBulkJob.and.returnValue(of(makeJob({ id: 'retry', status: 'running' })));
    const cmp = create();
    cmp.retrySegmentJob(makeJob({ status: 'failed' }));
    expect(cmp.segmentJob()?.id).toBe('retry');
    tick(2000);
    cmp.ngOnDestroy();
  }));

  it('retrySegmentJob reports an error', () => {
    adminCoupons.retryBulkJob.and.returnValue(throwError(() => ({})));
    const cmp = create();
    cmp.retrySegmentJob(makeJob({ status: 'cancelled' }));
    expect(toast.error).toHaveBeenCalledWith(
      'adminUi.couponsV2.bulk.segment.retryError',
      undefined,
    );
    expect(cmp.segmentJobsBusy()).toBeFalse();
  });

  // ----- polling internals -----

  it('refreshSegmentJob toasts on transition to succeeded and stops', () => {
    adminCoupons.getBulkJob.and.returnValue(of(makeJob({ status: 'succeeded' })));
    adminCoupons.listAssignments.and.returnValue(of([]));
    const cmp = create();
    (cmp as any).segmentJobLastStatus = 'running';
    (cmp as any).refreshSegmentJob('job-1');
    expect(cmp.segmentJob()?.status).toBe('succeeded');
    expect(toast.success).toHaveBeenCalledWith('adminUi.couponsV2.bulk.segment.completed');
  });

  it('refreshSegmentJob stops polling on error', () => {
    adminCoupons.getBulkJob.and.returnValue(throwError(() => ({})));
    const cmp = create();
    (cmp as any).segmentJobPollHandle = 123;
    (cmp as any).refreshSegmentJob('job-1');
    expect((cmp as any).segmentJobPollHandle).toBeNull();
  });

  it('refreshAbJobs fetches non-terminal jobs and finishes on terminal', () => {
    adminCoupons.getBulkJob.and.returnValue(of(makeJob({ status: 'succeeded' })));
    adminCoupons.listAssignments.and.returnValue(of([]));
    const cmp = create();
    cmp.abJobA.set(makeJob({ id: 'a', status: 'running' }));
    cmp.abJobB.set(makeJob({ id: 'b', status: 'running' }));
    (cmp as any).refreshAbJobs();
    expect(cmp.abJobA()?.status).toBe('succeeded');
    expect(cmp.abJobB()?.status).toBe('succeeded');
  });

  it('refreshAbJobs stops immediately when both jobs are terminal', () => {
    const cmp = create();
    cmp.abJobA.set(makeJob({ id: 'a', status: 'succeeded' }));
    cmp.abJobB.set(makeJob({ id: 'b', status: 'failed' }));
    (cmp as any).refreshAbJobs();
    expect(adminCoupons.getBulkJob).not.toHaveBeenCalled();
  });

  it('refreshAbJobs stops polling on error', () => {
    adminCoupons.getBulkJob.and.returnValue(throwError(() => ({})));
    const cmp = create();
    cmp.abJobA.set(makeJob({ id: 'a', status: 'running' }));
    (cmp as any).abPollHandle = 99;
    (cmp as any).refreshAbJobs();
    expect((cmp as any).abPollHandle).toBeNull();
  });

  // ----- upsert / reset internals -----

  it('upsertSegmentJob inserts, appends, replaces, and promotes', () => {
    const cmp = create();
    (cmp as any).upsertSegmentJob(makeJob({ id: 'j1' }), { promote: true });
    expect(cmp.segmentJobs().map((j) => j.id)).toEqual(['j1']);
    (cmp as any).upsertSegmentJob(makeJob({ id: 'j2' }));
    expect(cmp.segmentJobs().map((j) => j.id)).toEqual(['j1', 'j2']);
    (cmp as any).upsertSegmentJob(makeJob({ id: 'j2', status: 'running' }));
    expect(cmp.segmentJobs().find((j) => j.id === 'j2')?.status).toBe('running');
    (cmp as any).upsertSegmentJob(makeJob({ id: 'j2' }), { promote: true });
    expect(cmp.segmentJobs()[0].id).toBe('j2');
    (cmp as any).upsertSegmentJob({ id: '' } as any);
    expect(cmp.segmentJobs().length).toBe(2);
  });

  it('defaultAbBucketSeed falls back without both coupons', () => {
    const cmp = create();
    expect((cmp as any).defaultAbBucketSeed()).toBe('ab-test');
    cmp.selectedCoupon.set(makeCoupon({ id: 'a' }));
    cmp.abCouponB.set(makeCoupon({ id: 'b' }));
    expect((cmp as any).defaultAbBucketSeed()).toBe('ab:a:b');
  });

  it('ngOnDestroy stops both pollers', () => {
    const cmp = create();
    (cmp as any).segmentJobPollHandle = window.setInterval(() => {}, 10_000);
    (cmp as any).abPollHandle = window.setInterval(() => {}, 10_000);
    cmp.ngOnDestroy();
    expect((cmp as any).segmentJobPollHandle).toBeNull();
    expect((cmp as any).abPollHandle).toBeNull();
  });

  // ----- remaining short-circuit / fallback branches -----

  it('savePromotion reloads with a null id when neither response nor selection has one', () => {
    adminCoupons.createPromotion.and.returnValue(of(null as any));
    adminCoupons.listPromotions.and.returnValue(of([]));
    const cmp = create();
    cmp.promotionForm.name = 'Promo';
    cmp.promotionForm.discount_type = 'free_shipping';
    const reload = spyOn(cmp, 'loadPromotionsAfterMutation').and.callThrough();
    cmp.savePromotion();
    expect(reload).toHaveBeenCalledWith(null);
  });

  it('savePromotion reloads with the existing id when the response lacks one', () => {
    const promo = makePromotion();
    adminCoupons.updatePromotion.and.returnValue(of({} as any));
    adminCoupons.listPromotions.and.returnValue(of([promo]));
    const cmp = create();
    cmp.selectedPromotion.set(promo);
    cmp.promotionForm = (cmp as any).promotionToForm(promo);
    const reload = spyOn(cmp, 'loadPromotionsAfterMutation').and.callThrough();
    cmp.savePromotion();
    expect(reload).toHaveBeenCalledWith('promo-1');
  });

  it('savePromotion error without a detail passes undefined to the toast', () => {
    adminCoupons.createPromotion.and.returnValue(throwError(() => ({})));
    const cmp = create();
    cmp.promotionForm.name = 'Promo';
    cmp.promotionForm.discount_type = 'free_shipping';
    cmp.savePromotion();
    expect(toast.error).toHaveBeenCalledWith('adminUi.couponsV2.errors.savePromotion', undefined);
  });

  it('startAbTest error without a detail passes undefined to the toast', () => {
    adminCoupons.startSegmentAssignJob.and.returnValue(throwError(() => ({})));
    const cmp = create();
    cmp.selectedCoupon.set(makeCoupon({ id: 'a', visibility: 'assigned' }));
    cmp.abCouponB.set(makeCoupon({ id: 'b', visibility: 'assigned' }));
    cmp.startAbTest();
    expect(toast.error).toHaveBeenCalledWith('adminUi.couponsV2.ab.startError', undefined);
  });

  it('generateCouponCode error without a detail uses the translated fallback', () => {
    adminCoupons.generateCouponCode.and.returnValue(throwError(() => ({})));
    const cmp = create();
    cmp.generateCouponCode();
    expect(toast.error).toHaveBeenCalledWith(
      'adminUi.couponsV2.errors.validation',
      'adminUi.couponsV2.errors.codeGenerate',
    );
  });

  it('saveCoupon reloads with the existing id when the response lacks one', () => {
    adminCoupons.updateCoupon.and.returnValue(of({} as any));
    adminCoupons.listCoupons.and.returnValue(of([makeCoupon()]));
    adminCoupons.listAssignments.and.returnValue(of([]));
    const cmp = create();
    cmp.selectedPromotion.set(makePromotion());
    cmp.selectedCoupon.set(makeCoupon());
    cmp.couponForm = (cmp as any).couponToForm(makeCoupon());
    const reload = spyOn(cmp, 'loadCouponsAfterMutation').and.callThrough();
    cmp.saveCoupon();
    expect(reload).toHaveBeenCalledWith('coupon-1');
  });

  it('saveCoupon error without a detail passes undefined to the toast', () => {
    adminCoupons.createCoupon.and.returnValue(throwError(() => ({})));
    const cmp = create();
    cmp.couponForm.promotion_id = 'promo-1';
    cmp.couponForm.code = 'X';
    cmp.saveCoupon();
    expect(toast.error).toHaveBeenCalledWith('adminUi.couponsV2.errors.saveCoupon', undefined);
  });

  it('assign error without a detail passes undefined to the toast', () => {
    adminCoupons.assignCoupon.and.returnValue(throwError(() => ({})));
    const cmp = create();
    cmp.selectedCoupon.set(makeCoupon());
    cmp.assignEmail = 'user@x.com';
    cmp.assign();
    expect(toast.error).toHaveBeenCalledWith('adminUi.couponsV2.errors.assign', undefined);
  });

  it('selectAbCouponB stores B with no current coupon and a default seed', () => {
    const cmp = create();
    cmp.selectAbCouponB(makeCoupon({ id: 'b', code: 'BB' }));
    expect(cmp.abCouponB()?.id).toBe('b');
    expect(cmp.abBucketSeed).toBe('ab-test');
  });

  it('loadScopedProducts tolerates a null byIds payload', () => {
    adminProducts.byIds.and.returnValue(of(null as any));
    const cmp = create();
    cmp.promotionForm.included_product_ids = ['pZ'];
    cmp.promotionForm.excluded_product_ids = [];
    (cmp as any).loadScopedProducts();
    expect(cmp.productLabel('pZ')).toBe('pZ');
    expect(cmp.scopeProductsLoading()).toBeFalse();
  });

  it('promotionPayloadFromForm tolerates a blank name', () => {
    const cmp = create();
    cmp.promotionForm.name = '';
    cmp.promotionForm.discount_type = 'free_shipping';
    const payload = (cmp as any).promotionPayloadFromForm();
    expect(payload.name).toBe('');
  });

  it('validatePromotionForm via savePromotion blocks a blank name', () => {
    const cmp = create();
    cmp.promotionForm.name = '';
    cmp.savePromotion();
    expect(adminCoupons.createPromotion).not.toHaveBeenCalled();
  });

  it('parseEmailsFromCsv tolerates empty input, blank lines, and empty cells', () => {
    const cmp = create();
    expect((cmp as any).parseEmailsFromCsv('').emails).toEqual([]);
    const result = (cmp as any).parseEmailsFromCsv('email\n\n,\nuser@x.com\n');
    expect(result.emails).toEqual(['user@x.com']);
  });
});
