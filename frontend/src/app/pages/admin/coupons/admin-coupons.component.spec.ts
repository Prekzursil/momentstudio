import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import {
  AdminCouponsV2Service,
  type CouponAnalyticsResponse,
  type CouponBulkJobRead,
  type CouponBulkResult,
  type CouponBulkSegmentPreview,
} from '../../../core/admin-coupons-v2.service';
import { AdminProductsService } from '../../../core/admin-products.service';
import { AdminService } from '../../../core/admin.service';
import { ToastService } from '../../../core/toast.service';
import type { CouponRead, PromotionRead } from '../../../core/coupons.service';
import { AdminCouponsComponent } from './admin-coupons.component';

type AnyObj = Record<string, unknown>;

function makePromo(overrides: Partial<PromotionRead> = {}): PromotionRead {
  return {
    id: 'promo-1',
    key: 'KEY',
    name: 'Promo One',
    description: 'desc',
    discount_type: 'percent',
    percentage_off: '10',
    amount_off: null,
    max_discount_amount: null,
    allow_on_sale_items: true,
    first_order_only: false,
    min_subtotal: null,
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

function makeCoupon(overrides: Partial<CouponRead> = {}): CouponRead {
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
    ...overrides,
  };
}

function makeJob(overrides: Partial<CouponBulkJobRead> = {}): CouponBulkJobRead {
  return {
    id: 'job-1',
    coupon_id: 'coupon-1',
    action: 'assign',
    status: 'pending',
    require_marketing_opt_in: false,
    require_email_verified: false,
    send_email: true,
    total_candidates: 0,
    processed: 0,
    created: 0,
    restored: 0,
    already_active: 0,
    revoked: 0,
    already_revoked: 0,
    not_assigned: 0,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeAnalytics(overrides: Partial<CouponAnalyticsResponse> = {}): CouponAnalyticsResponse {
  return {
    summary: {
      redemptions: 5,
      total_discount_ron: '12.50',
      total_shipping_discount_ron: '3.00',
      avg_order_total_with_coupon: '100.00',
      avg_order_total_without_coupon: '90.00',
      aov_lift: '10.00',
    },
    daily: [
      { date: '2026-01-01', redemptions: 2, discount_ron: '5.00', shipping_discount_ron: '1.00' },
    ],
    top_products: [
      {
        product_id: 'p1',
        product_slug: 'slug',
        product_name: 'Prod',
        orders_count: 2,
        quantity: 3,
        gross_sales_ron: '50.00',
        allocated_discount_ron: '5.00',
      },
    ],
    ...overrides,
  };
}

function makeSegmentPreview(
  overrides: Partial<CouponBulkSegmentPreview> = {},
): CouponBulkSegmentPreview {
  return {
    total_candidates: 3,
    sample_emails: ['a@b.com', 'c@d.com'],
    created: 0,
    restored: 0,
    already_active: 0,
    revoked: 0,
    already_revoked: 0,
    not_assigned: 0,
    ...overrides,
  };
}

function makeBulkResult(): CouponBulkResult {
  return {
    requested: 1,
    unique: 1,
    invalid_emails: [],
    not_found_emails: [],
    created: 1,
    restored: 0,
    already_active: 0,
    revoked: 0,
    already_revoked: 0,
    not_assigned: 0,
  };
}

describe('AdminCouponsComponent', () => {
  let adminCoupons: jasmine.SpyObj<AdminCouponsV2Service>;
  let adminProducts: jasmine.SpyObj<AdminProductsService>;
  let admin: jasmine.SpyObj<AdminService>;
  let toast: jasmine.SpyObj<ToastService>;
  let component: AdminCouponsComponent;
  let intervalCallbacks: Array<() => void>;

  function build(): AdminCouponsComponent {
    const fixture = TestBed.createComponent(AdminCouponsComponent);
    component = fixture.componentInstance;
    return component;
  }

  beforeEach(async () => {
    adminCoupons = jasmine.createSpyObj<AdminCouponsV2Service>('AdminCouponsV2Service', [
      'listPromotions',
      'createPromotion',
      'updatePromotion',
      'listCoupons',
      'createCoupon',
      'updateCoupon',
      'generateCouponCode',
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
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'info']);

    admin.getCategories.and.returnValue(of([]));
    adminCoupons.listPromotions.and.returnValue(of([]));
    adminCoupons.listCoupons.and.returnValue(of([]));
    adminCoupons.getAnalytics.and.returnValue(of(makeAnalytics()));
    adminCoupons.listAssignments.and.returnValue(of([]));
    adminCoupons.listBulkJobs.and.returnValue(of([]));
    adminProducts.search.and.returnValue(of({ items: [] } as any));
    adminProducts.byIds.and.returnValue(of([]));

    intervalCallbacks = [];
    spyOn(window, 'setInterval').and.callFake(((cb: () => void) => {
      intervalCallbacks.push(cb);
      return intervalCallbacks.length as any;
    }) as any);
    spyOn(window, 'clearInterval');

    await TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), AdminCouponsComponent],
      providers: [
        { provide: AdminCouponsV2Service, useValue: adminCoupons },
        { provide: AdminProductsService, useValue: adminProducts },
        { provide: AdminService, useValue: admin },
        { provide: ToastService, useValue: toast },
        provideRouter([]),
      ],
    }).compileComponents();

    build();
  });

  afterEach(() => {
    component.ngOnDestroy();
  });

  it('renders the component template without error', () => {
    adminCoupons.listPromotions.and.returnValue(of([makePromo()]));
    const fixture = TestBed.createComponent(AdminCouponsComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-admin-page-header')).toBeTruthy();
    fixture.componentInstance.ngOnDestroy();
  });

  describe('ngOnInit', () => {
    it('reads history state and loads categories + promotions', () => {
      history.replaceState({ openNewPromotion: false, editPromotionId: '' }, '');
      adminCoupons.listPromotions.and.returnValue(of([makePromo()]));
      component.ngOnInit();
      expect(admin.getCategories).toHaveBeenCalled();
      expect(component.selectedPromotion()?.id).toBe('promo-1');
    });

    it('auto-starts a new promotion when openNewPromotion state flag is set', () => {
      history.replaceState({ openNewPromotion: true }, '');
      adminCoupons.listPromotions.and.returnValue(of([makePromo()]));
      component.ngOnInit();
      expect(component.selectedPromotion()).toBeNull();
      history.replaceState({}, '');
    });

    it('preselects promotion from editPromotionId state when found', () => {
      history.replaceState({ editPromotionId: 'promo-2' }, '');
      adminCoupons.listPromotions.and.returnValue(
        of([makePromo(), makePromo({ id: 'promo-2', name: 'Two' })]),
      );
      component.ngOnInit();
      expect(component.selectedPromotion()?.id).toBe('promo-2');
      history.replaceState({}, '');
    });

    it('falls back to first promotion when editPromotionId is not found', () => {
      history.replaceState({ editPromotionId: 'missing' }, '');
      adminCoupons.listPromotions.and.returnValue(of([makePromo()]));
      component.ngOnInit();
      expect(component.selectedPromotion()?.id).toBe('promo-1');
      history.replaceState({}, '');
    });
  });

  describe('loadCategories', () => {
    it('sets categories on success', () => {
      admin.getCategories.and.returnValue(of([{ id: 'c1', name: 'Cat', slug: 'cat' } as any]));
      component.loadCategories();
      expect(component.categories().length).toBe(1);
    });

    it('coerces nullish category payload to empty array', () => {
      admin.getCategories.and.returnValue(of(null as any));
      component.loadCategories();
      expect(component.categories()).toEqual([]);
    });

    it('clears categories on error', () => {
      admin.getCategories.and.returnValue(throwError(() => new Error('x')));
      component.loadCategories();
      expect(component.categories()).toEqual([]);
    });
  });

  describe('loadPromotions', () => {
    it('keeps current selection when still present', () => {
      component.selectedPromotion.set(makePromo({ id: 'promo-9' }));
      adminCoupons.listPromotions.and.returnValue(of([makePromo({ id: 'promo-9', name: 'Keep' })]));
      component.loadPromotions();
      expect(component.selectedPromotion()?.name).toBe('Keep');
    });

    it('selects first when previous selection is gone', () => {
      component.selectedPromotion.set(makePromo({ id: 'promo-gone' }));
      adminCoupons.listPromotions.and.returnValue(of([makePromo({ id: 'promo-a' })]));
      component.loadPromotions();
      expect(component.selectedPromotion()?.id).toBe('promo-a');
    });

    it('starts a new promotion when the list is empty', () => {
      adminCoupons.listPromotions.and.returnValue(of([]));
      component.loadPromotions();
      expect(component.selectedPromotion()).toBeNull();
      expect(component.promotionsLoading()).toBeFalse();
    });

    it('handles a non-array payload and error response', () => {
      adminCoupons.listPromotions.and.returnValue(of(null as any));
      component.loadPromotions();
      expect(component.promotions()).toEqual([]);

      adminCoupons.listPromotions.and.returnValue(
        throwError(() => ({ error: { detail: 'boom' } })),
      );
      component.loadPromotions();
      expect(component.promotionsError()).toBe('boom');

      adminCoupons.listPromotions.and.returnValue(throwError(() => ({})));
      component.loadPromotions();
      expect(component.promotionsError()).toBe('adminUi.couponsV2.errors.loadPromotions');
    });
  });

  describe('onDiscountTypeChange', () => {
    it('clears amount when percent', () => {
      component.promotionForm.discount_type = 'percent';
      component.promotionForm.amount_off = '5';
      component.onDiscountTypeChange();
      expect(component.promotionForm.amount_off).toBe('');
    });

    it('clears percentage when amount', () => {
      component.promotionForm.discount_type = 'amount';
      component.promotionForm.percentage_off = '5';
      component.onDiscountTypeChange();
      expect(component.promotionForm.percentage_off).toBe('');
    });

    it('clears both when free_shipping', () => {
      component.promotionForm.discount_type = 'free_shipping';
      component.promotionForm.percentage_off = '5';
      component.promotionForm.amount_off = '5';
      component.onDiscountTypeChange();
      expect(component.promotionForm.percentage_off).toBe('');
      expect(component.promotionForm.amount_off).toBe('');
    });
  });

  describe('savePromotion', () => {
    it('blocks save when validation fails', () => {
      component.promotionForm = (component as any).blankPromotionForm();
      component.promotionForm.name = '';
      component.savePromotion();
      expect(toast.error).toHaveBeenCalled();
      expect(adminCoupons.createPromotion).not.toHaveBeenCalled();
    });

    it('creates a new promotion and reloads', () => {
      component.selectedPromotion.set(null);
      component.promotionForm.name = 'New Promo';
      component.promotionForm.discount_type = 'percent';
      component.promotionForm.percentage_off = '10';
      adminCoupons.createPromotion.and.returnValue(of(makePromo({ id: 'created' })));
      adminCoupons.listPromotions.and.returnValue(of([makePromo({ id: 'created' })]));
      component.savePromotion();
      expect(adminCoupons.createPromotion).toHaveBeenCalled();
      expect(component.promotionSaving()).toBeFalse();
      expect(toast.success).toHaveBeenCalled();
    });

    it('updates an existing promotion', () => {
      component.selectedPromotion.set(makePromo({ id: 'existing' }));
      component.promotionForm.name = 'Edit';
      component.promotionForm.discount_type = 'amount';
      component.promotionForm.amount_off = '5';
      adminCoupons.updatePromotion.and.returnValue(of(makePromo({ id: 'existing' })));
      adminCoupons.listPromotions.and.returnValue(of([makePromo({ id: 'existing' })]));
      component.savePromotion();
      expect(adminCoupons.updatePromotion).toHaveBeenCalledWith('existing', jasmine.any(Object));
    });

    it('uses falling-back id when save response lacks one', () => {
      component.selectedPromotion.set(makePromo({ id: 'existing' }));
      component.promotionForm.name = 'Edit';
      component.promotionForm.discount_type = 'free_shipping';
      adminCoupons.updatePromotion.and.returnValue(of(null as any));
      const reload = spyOn(component, 'loadPromotionsAfterMutation');
      component.savePromotion();
      expect(reload).toHaveBeenCalledWith('existing');
    });

    it('shows an error toast when save fails', () => {
      component.selectedPromotion.set(null);
      component.promotionForm.name = 'New';
      component.promotionForm.discount_type = 'free_shipping';
      adminCoupons.createPromotion.and.returnValue(
        throwError(() => ({ error: { detail: 'nope' } })),
      );
      component.savePromotion();
      expect(component.promotionSaving()).toBeFalse();
      expect(toast.error).toHaveBeenCalledWith('adminUi.couponsV2.errors.savePromotion', 'nope');
    });
  });

  describe('loadPromotionsAfterMutation', () => {
    it('selects the requested id when present', () => {
      adminCoupons.listPromotions.and.returnValue(of([makePromo({ id: 'sel' })]));
      const sel = spyOn(component, 'selectPromotion').and.callThrough();
      component.loadPromotionsAfterMutation('sel');
      expect(sel).toHaveBeenCalled();
    });

    it('selects the first item when requested id is missing', () => {
      adminCoupons.listPromotions.and.returnValue(of([makePromo({ id: 'first' })]));
      component.loadPromotionsAfterMutation('absent');
      expect(component.selectedPromotion()?.id).toBe('first');
    });

    it('does nothing further when no id and empty list', () => {
      adminCoupons.listPromotions.and.returnValue(of([]));
      component.loadPromotionsAfterMutation(null);
      expect(component.promotionsLoading()).toBeFalse();
    });

    it('handles non-array payload and errors', () => {
      adminCoupons.listPromotions.and.returnValue(of(undefined as any));
      component.loadPromotionsAfterMutation(null);
      expect(component.promotions()).toEqual([]);

      adminCoupons.listPromotions.and.returnValue(throwError(() => ({ error: { detail: 'e1' } })));
      component.loadPromotionsAfterMutation(null);
      expect(component.promotionsError()).toBe('e1');

      adminCoupons.listPromotions.and.returnValue(throwError(() => ({})));
      component.loadPromotionsAfterMutation(null);
      expect(component.promotionsError()).toBe('adminUi.couponsV2.errors.loadPromotions');
    });
  });

  describe('loadCoupons', () => {
    it('clears coupons when no promotion is selected', () => {
      component.selectedPromotion.set(null);
      component.coupons.set([makeCoupon()]);
      component.loadCoupons();
      expect(component.coupons()).toEqual([]);
    });

    it('loads coupons with a query and keeps a still-present selection', () => {
      component.selectedPromotion.set(makePromo());
      component.selectedCoupon.set(makeCoupon({ id: 'coupon-1' }));
      component.couponQuery = '  abc  ';
      adminCoupons.listCoupons.and.returnValue(of([makeCoupon({ id: 'coupon-1' })]));
      component.loadCoupons();
      expect(adminCoupons.listCoupons).toHaveBeenCalledWith({ promotion_id: 'promo-1', q: 'abc' });
      expect(component.selectedCoupon()?.id).toBe('coupon-1');
    });

    it('drops the selected coupon when it disappears and handles non-array', () => {
      component.selectedPromotion.set(makePromo());
      component.selectedCoupon.set(makeCoupon({ id: 'gone' }));
      component.couponQuery = '';
      adminCoupons.listCoupons.and.returnValue(of(null as any));
      component.loadCoupons();
      expect(component.selectedCoupon()).toBeNull();
      expect(component.assignments()).toEqual([]);
    });

    it('reports load errors with and without detail', () => {
      component.selectedPromotion.set(makePromo());
      adminCoupons.listCoupons.and.returnValue(throwError(() => ({ error: { detail: 'le' } })));
      component.loadCoupons();
      expect(component.couponsError()).toBe('le');

      adminCoupons.listCoupons.and.returnValue(throwError(() => ({})));
      component.loadCoupons();
      expect(component.couponsError()).toBe('adminUi.couponsV2.errors.loadCoupons');
    });
  });

  describe('loadAnalytics', () => {
    it('clears analytics when no promotion is selected', () => {
      component.selectedPromotion.set(null);
      component.analytics.set(makeAnalytics());
      component.loadAnalytics();
      expect(component.analytics()).toBeNull();
    });

    it('requests coupon-scoped analytics when toggled', () => {
      component.selectedPromotion.set(makePromo());
      component.selectedCoupon.set(makeCoupon());
      component.analyticsOnlySelectedCoupon = true;
      adminCoupons.getAnalytics.and.returnValue(of(makeAnalytics()));
      component.loadAnalytics();
      expect(adminCoupons.getAnalytics).toHaveBeenCalledWith(
        jasmine.objectContaining({ coupon_id: 'coupon-1' }),
      );
      expect(component.analytics()).not.toBeNull();
    });

    it('handles null data and errors', () => {
      component.selectedPromotion.set(makePromo());
      component.analyticsOnlySelectedCoupon = false;
      adminCoupons.getAnalytics.and.returnValue(of(null as any));
      component.loadAnalytics();
      expect(component.analytics()).toBeNull();

      adminCoupons.getAnalytics.and.returnValue(throwError(() => ({ error: { detail: 'ae' } })));
      component.loadAnalytics();
      expect(component.analyticsError()).toBe('ae');

      adminCoupons.getAnalytics.and.returnValue(throwError(() => ({})));
      component.loadAnalytics();
      expect(component.analyticsError()).toBe('adminUi.couponsV2.errors.loadAnalytics');
    });
  });

  describe('abCanRun', () => {
    it('returns false without coupon A', () => {
      component.selectedCoupon.set(null);
      expect(component.abCanRun()).toBeFalse();
    });

    it('returns false when coupon A is not assigned', () => {
      component.selectedCoupon.set(makeCoupon({ visibility: 'public' }));
      expect(component.abCanRun()).toBeFalse();
    });

    it('returns false when coupon B is not assigned', () => {
      component.selectedCoupon.set(makeCoupon());
      component.abCouponB.set(makeCoupon({ id: 'b', visibility: 'public' }));
      expect(component.abCanRun()).toBeFalse();
    });

    it('returns true when both are assigned', () => {
      component.selectedCoupon.set(makeCoupon());
      component.abCouponB.set(makeCoupon({ id: 'b' }));
      expect(component.abCanRun()).toBeTrue();
    });
  });

  describe('abSearchCoupons', () => {
    it('clears results for an empty query', () => {
      component.abCouponQuery = '';
      component.abCouponResults.set([makeCoupon()]);
      component.abSearchCoupons();
      expect(component.abCouponResults()).toEqual([]);
    });

    it('filters out the currently selected coupon and limits results', () => {
      component.selectedCoupon.set(makeCoupon({ id: 'current' }));
      component.abCouponQuery = 'save';
      const many = Array.from({ length: 12 }, (_, i) => makeCoupon({ id: `c${i}` }));
      many.push(makeCoupon({ id: 'current' }));
      adminCoupons.listCoupons.and.returnValue(of(many));
      component.abSearchCoupons();
      expect(component.abCouponResults().length).toBe(10);
      expect(component.abCouponResults().some((c) => c.id === 'current')).toBeFalse();
    });

    it('handles non-array payload and errors', () => {
      component.abCouponQuery = 'x';
      adminCoupons.listCoupons.and.returnValue(of(null as any));
      component.abSearchCoupons();
      expect(component.abCouponResults()).toEqual([]);

      component.abCouponQuery = 'x';
      adminCoupons.listCoupons.and.returnValue(throwError(() => ({ error: { detail: 'se' } })));
      component.abSearchCoupons();
      expect(component.abCouponError()).toBe('se');

      component.abCouponQuery = 'x';
      adminCoupons.listCoupons.and.returnValue(throwError(() => ({})));
      component.abSearchCoupons();
      expect(component.abCouponError()).toBe('adminUi.couponsV2.ab.searchError');
    });
  });

  describe('selectAbCouponB', () => {
    it('ignores coupons without an id', () => {
      component.selectAbCouponB({ id: '' } as CouponRead);
      expect(component.abCouponB()).toBeNull();
    });

    it('ignores selecting the same coupon as A', () => {
      component.selectedCoupon.set(makeCoupon({ id: 'same' }));
      component.selectAbCouponB(makeCoupon({ id: 'same' }));
      expect(component.abCouponB()).toBeNull();
    });

    it('selects coupon B and seeds the bucket when empty', () => {
      component.selectedCoupon.set(makeCoupon({ id: 'a' }));
      component.abBucketSeed = '';
      adminCoupons.getAnalytics.and.returnValue(of(makeAnalytics()));
      component.selectAbCouponB(makeCoupon({ id: 'b', code: 'BCODE' }));
      expect(component.abCouponB()?.id).toBe('b');
      expect(component.abBucketSeed).toBe('ab:a:b');
      expect(component.abCouponQuery).toBe('BCODE');
    });

    it('keeps an existing bucket seed and existing query when blank code', () => {
      component.selectedCoupon.set(makeCoupon({ id: 'a' }));
      component.abBucketSeed = 'custom-seed';
      component.abCouponQuery = 'keep';
      adminCoupons.getAnalytics.and.returnValue(of(makeAnalytics()));
      component.selectAbCouponB(makeCoupon({ id: 'b', code: '' }));
      expect(component.abBucketSeed).toBe('custom-seed');
      expect(component.abCouponQuery).toBe('keep');
    });
  });

  describe('startAbTest', () => {
    it('returns early without both coupons', () => {
      component.selectedCoupon.set(null);
      component.startAbTest();
      expect(adminCoupons.startSegmentAssignJob).not.toHaveBeenCalled();
    });

    it('blocks when AB cannot run', () => {
      component.selectedCoupon.set(makeCoupon({ visibility: 'public' }));
      component.abCouponB.set(makeCoupon({ id: 'b', visibility: 'public' }));
      component.startAbTest();
      expect(toast.error).toHaveBeenCalled();
      expect(adminCoupons.startSegmentAssignJob).not.toHaveBeenCalled();
    });

    it('starts both jobs with a default seed when blank', () => {
      component.selectedCoupon.set(makeCoupon({ id: 'a' }));
      component.abCouponB.set(makeCoupon({ id: 'b' }));
      component.abBucketSeed = '';
      adminCoupons.startSegmentAssignJob.and.returnValues(
        of(makeJob({ id: 'ja' })),
        of(makeJob({ id: 'jb' })),
      );
      component.startAbTest();
      expect(component.abBucketSeed).toBe('ab:a:b');
      expect(component.abJobA()?.id).toBe('ja');
      expect(component.abJobB()?.id).toBe('jb');
      expect(window.setInterval).toHaveBeenCalled();
    });

    it('reports an error when starting fails', () => {
      component.selectedCoupon.set(makeCoupon({ id: 'a' }));
      component.abCouponB.set(makeCoupon({ id: 'b' }));
      component.abBucketSeed = 'seed';
      adminCoupons.startSegmentAssignJob.and.returnValue(
        throwError(() => ({ error: { detail: 'fail' } })),
      );
      component.startAbTest();
      expect(component.abBusy()).toBeFalse();
      expect(toast.error).toHaveBeenCalledWith('adminUi.couponsV2.ab.startError', 'fail');
    });
  });

  describe('loadAbAnalytics', () => {
    it('clears analytics without both coupons', () => {
      component.selectedCoupon.set(makeCoupon());
      component.abCouponB.set(null);
      component.abAnalyticsA.set(makeAnalytics());
      component.loadAbAnalytics();
      expect(component.abAnalyticsA()).toBeNull();
    });

    it('loads both analytics', () => {
      component.selectedCoupon.set(makeCoupon({ id: 'a' }));
      component.abCouponB.set(makeCoupon({ id: 'b' }));
      adminCoupons.getAnalytics.and.returnValues(of(makeAnalytics()), of(makeAnalytics()));
      component.loadAbAnalytics();
      expect(component.abAnalyticsA()).not.toBeNull();
      expect(component.abAnalyticsB()).not.toBeNull();
    });

    it('handles analytics errors', () => {
      component.selectedCoupon.set(makeCoupon({ id: 'a' }));
      component.abCouponB.set(makeCoupon({ id: 'b' }));
      adminCoupons.getAnalytics.and.returnValue(throwError(() => ({ error: { detail: 'abe' } })));
      component.loadAbAnalytics();
      expect(component.abAnalyticsError()).toBe('abe');

      adminCoupons.getAnalytics.and.returnValue(throwError(() => ({})));
      component.loadAbAnalytics();
      expect(component.abAnalyticsError()).toBe('adminUi.couponsV2.errors.loadAnalytics');
    });
  });

  describe('selectCoupon / startNewCoupon', () => {
    it('selects a coupon and refreshes analytics when scoped flag is on', () => {
      component.selectedPromotion.set(makePromo());
      component.analyticsOnlySelectedCoupon = true;
      const la = spyOn(component, 'loadAnalytics');
      component.selectCoupon(makeCoupon());
      expect(component.selectedCoupon()?.id).toBe('coupon-1');
      expect(adminCoupons.listAssignments).toHaveBeenCalled();
      expect(la).toHaveBeenCalled();
    });

    it('selects a coupon without analytics refresh when scoped flag is off', () => {
      component.analyticsOnlySelectedCoupon = false;
      component.selectCoupon(makeCoupon());
      expect(component.selectedCoupon()).not.toBeNull();
    });

    it('starts a new coupon and prefills promotion id', () => {
      component.selectedPromotion.set(makePromo({ id: 'promo-x', key: 'XK' }));
      component.startNewCoupon();
      expect(component.selectedCoupon()).toBeNull();
      expect(component.couponForm.promotion_id).toBe('promo-x');
      expect(component.couponCodeGen.prefix).toBe('XK');
    });

    it('starts a new coupon without a promotion', () => {
      component.selectedPromotion.set(null);
      component.startNewCoupon();
      expect(component.couponForm.promotion_id).toBe('');
      expect(component.couponCodeGen.prefix).toBe('COUPON');
    });
  });

  describe('suggestedCouponPrefix', () => {
    it('prefers key, then name, then default', () => {
      component.selectedPromotion.set(makePromo({ key: 'KK', name: 'NN' }));
      expect((component as any).suggestedCouponPrefix()).toBe('KK');
      component.selectedPromotion.set(makePromo({ key: '', name: 'NN' }));
      expect((component as any).suggestedCouponPrefix()).toBe('NN');
      component.selectedPromotion.set(makePromo({ key: '', name: '   ' }));
      expect((component as any).suggestedCouponPrefix()).toBe('COUPON');
      component.selectedPromotion.set(null);
      expect((component as any).suggestedCouponPrefix()).toBe('COUPON');
    });
  });

  describe('generateCouponCode', () => {
    it('does nothing when editing an existing coupon', () => {
      component.selectedCoupon.set(makeCoupon());
      component.generateCouponCode();
      expect(adminCoupons.generateCouponCode).not.toHaveBeenCalled();
    });

    it('generates a code with provided pattern and length', () => {
      component.selectedCoupon.set(null);
      component.couponCodeGen = { prefix: 'PX', pattern: 'AAA', length: 8 };
      adminCoupons.generateCouponCode.and.returnValue(of({ code: 'abc123' }));
      component.generateCouponCode();
      expect(adminCoupons.generateCouponCode).toHaveBeenCalledWith({
        prefix: 'PX',
        pattern: 'AAA',
        length: 8,
      });
      expect(component.couponForm.code).toBe('ABC123');
      expect(toast.success).toHaveBeenCalled();
    });

    it('uses fallbacks for blank prefix/pattern and invalid length, and skips toast on empty code', () => {
      component.selectedCoupon.set(null);
      component.selectedPromotion.set(makePromo({ key: 'FB' }));
      component.couponCodeGen = { prefix: '', pattern: '', length: 0 } as any;
      adminCoupons.generateCouponCode.and.returnValue(of({ code: '' }));
      component.generateCouponCode();
      expect(adminCoupons.generateCouponCode).toHaveBeenCalledWith({
        prefix: 'FB',
        pattern: null,
        length: 12,
      });
      expect(component.couponForm.code).toBe('');
      expect(toast.success).not.toHaveBeenCalled();
    });

    it('handles a non-finite length by falling back to 12', () => {
      component.selectedCoupon.set(null);
      component.couponCodeGen = { prefix: 'PX', pattern: '', length: 'oops' as any };
      adminCoupons.generateCouponCode.and.returnValue(of({ code: 'X' }));
      component.generateCouponCode();
      expect(adminCoupons.generateCouponCode).toHaveBeenCalledWith({
        prefix: 'PX',
        pattern: null,
        length: 12,
      });
    });

    it('reports generation errors with detail and fallback', () => {
      component.selectedCoupon.set(null);
      adminCoupons.generateCouponCode.and.returnValue(
        throwError(() => ({ error: { detail: 'ge' } })),
      );
      component.generateCouponCode();
      expect(toast.error).toHaveBeenCalledWith('adminUi.couponsV2.errors.validation', 'ge');

      adminCoupons.generateCouponCode.and.returnValue(throwError(() => ({})));
      component.generateCouponCode();
      expect(toast.error).toHaveBeenCalledWith(
        'adminUi.couponsV2.errors.validation',
        'adminUi.couponsV2.errors.codeGenerate',
      );
    });
  });

  describe('saveCoupon', () => {
    it('requires a promotion id', () => {
      component.couponForm = (component as any).blankCouponForm();
      component.couponForm.promotion_id = '';
      component.saveCoupon();
      expect(toast.error).toHaveBeenCalledWith(
        'adminUi.couponsV2.errors.validation',
        'adminUi.couponsV2.errors.couponPromotionRequired',
      );
    });

    it('requires a code for a new coupon', () => {
      component.selectedCoupon.set(null);
      component.couponForm = (component as any).blankCouponForm();
      component.couponForm.promotion_id = 'promo-1';
      component.couponForm.code = '';
      component.saveCoupon();
      expect(toast.error).toHaveBeenCalledWith(
        'adminUi.couponsV2.errors.validation',
        'adminUi.couponsV2.errors.couponCodeRequired',
      );
    });

    it('creates a coupon with normalized dates', () => {
      component.selectedCoupon.set(null);
      component.selectedPromotion.set(makePromo());
      component.couponForm = (component as any).blankCouponForm();
      component.couponForm.promotion_id = 'promo-1';
      component.couponForm.code = 'new10';
      component.couponForm.starts_at = '2026-01-01T10:00';
      component.couponForm.ends_at = '2026-02-01T10:00';
      adminCoupons.createCoupon.and.returnValue(of(makeCoupon({ id: 'created' })));
      adminCoupons.listCoupons.and.returnValue(of([makeCoupon({ id: 'created' })]));
      component.saveCoupon();
      const payload = adminCoupons.createCoupon.calls.mostRecent().args[0] as unknown as AnyObj;
      expect(payload['code']).toBe('NEW10');
      expect(payload['starts_at']).toContain('2026-01-01');
      expect(toast.success).toHaveBeenCalled();
    });

    it('updates an existing coupon with null dates', () => {
      component.selectedCoupon.set(makeCoupon({ id: 'existing' }));
      component.selectedPromotion.set(makePromo());
      component.couponForm = (component as any).couponToForm(makeCoupon({ id: 'existing' }));
      component.couponForm.promotion_id = 'promo-1';
      component.couponForm.starts_at = '';
      component.couponForm.ends_at = '';
      adminCoupons.updateCoupon.and.returnValue(of(makeCoupon({ id: 'existing' })));
      adminCoupons.listCoupons.and.returnValue(of([makeCoupon({ id: 'existing' })]));
      component.saveCoupon();
      const payload = adminCoupons.updateCoupon.calls.mostRecent().args[1] as unknown as AnyObj;
      expect(payload['starts_at']).toBeNull();
      expect(payload['ends_at']).toBeNull();
    });

    it('falls back to existing id when the create response lacks one', () => {
      component.selectedCoupon.set(makeCoupon({ id: 'existing' }));
      component.selectedPromotion.set(makePromo());
      component.couponForm = (component as any).couponToForm(makeCoupon({ id: 'existing' }));
      component.couponForm.promotion_id = 'promo-1';
      adminCoupons.updateCoupon.and.returnValue(of(null as any));
      const reload = spyOn(component, 'loadCouponsAfterMutation');
      component.saveCoupon();
      expect(reload).toHaveBeenCalledWith('existing');
    });

    it('shows an error toast on save failure', () => {
      component.selectedCoupon.set(null);
      component.couponForm = (component as any).blankCouponForm();
      component.couponForm.promotion_id = 'promo-1';
      component.couponForm.code = 'CODE';
      adminCoupons.createCoupon.and.returnValue(throwError(() => ({ error: { detail: 'sc' } })));
      component.saveCoupon();
      expect(component.couponSaving()).toBeFalse();
      expect(toast.error).toHaveBeenCalledWith('adminUi.couponsV2.errors.saveCoupon', 'sc');
    });
  });

  describe('loadCouponsAfterMutation', () => {
    it('clears coupons when no promotion', () => {
      component.selectedPromotion.set(null);
      component.coupons.set([makeCoupon()]);
      component.loadCouponsAfterMutation('x');
      expect(component.coupons()).toEqual([]);
    });

    it('selects the requested coupon when found', () => {
      component.selectedPromotion.set(makePromo());
      adminCoupons.listCoupons.and.returnValue(of([makeCoupon({ id: 'pick' })]));
      const sel = spyOn(component, 'selectCoupon');
      component.loadCouponsAfterMutation('pick');
      expect(sel).toHaveBeenCalled();
    });

    it('handles a missing id, non-array payload and errors', () => {
      component.selectedPromotion.set(makePromo());
      adminCoupons.listCoupons.and.returnValue(of(null as any));
      component.loadCouponsAfterMutation('missing');
      expect(component.coupons()).toEqual([]);

      adminCoupons.listCoupons.and.returnValue(throwError(() => ({ error: { detail: 'ce' } })));
      component.loadCouponsAfterMutation('x');
      expect(component.couponsError()).toBe('ce');

      adminCoupons.listCoupons.and.returnValue(throwError(() => ({})));
      component.loadCouponsAfterMutation('x');
      expect(component.couponsError()).toBe('adminUi.couponsV2.errors.loadCoupons');
    });
  });

  describe('loadAssignments', () => {
    it('clears assignments when no coupon', () => {
      component.selectedCoupon.set(null);
      component.assignments.set([{ id: 'a' } as any]);
      component.loadAssignments();
      expect(component.assignments()).toEqual([]);
    });

    it('loads assignments and coerces non-array', () => {
      component.selectedCoupon.set(makeCoupon());
      adminCoupons.listAssignments.and.returnValue(of(null as any));
      component.loadAssignments();
      expect(component.assignments()).toEqual([]);
    });

    it('reports load errors', () => {
      component.selectedCoupon.set(makeCoupon());
      adminCoupons.listAssignments.and.returnValue(throwError(() => ({ error: { detail: 'as' } })));
      component.loadAssignments();
      expect(component.assignmentsError()).toBe('as');

      adminCoupons.listAssignments.and.returnValue(throwError(() => ({})));
      component.loadAssignments();
      expect(component.assignmentsError()).toBe('adminUi.couponsV2.errors.loadAssignments');
    });
  });

  describe('assign', () => {
    it('does nothing without a coupon', () => {
      component.selectedCoupon.set(null);
      component.assign();
      expect(adminCoupons.assignCoupon).not.toHaveBeenCalled();
    });

    it('validates the email', () => {
      component.selectedCoupon.set(makeCoupon());
      component.assignEmail = '';
      component.assign();
      expect(toast.error).toHaveBeenCalledWith(
        'adminUi.couponsV2.errors.validation',
        'adminUi.couponsV2.errors.emailRequired',
      );
    });

    it('assigns the coupon on success', () => {
      component.selectedCoupon.set(makeCoupon());
      component.assignEmail = 'x@y.com';
      adminCoupons.assignCoupon.and.returnValue(of(undefined));
      component.assign();
      expect(component.assignEmail).toBe('');
      expect(toast.success).toHaveBeenCalled();
    });

    it('reports assign errors', () => {
      component.selectedCoupon.set(makeCoupon());
      component.assignEmail = 'x@y.com';
      adminCoupons.assignCoupon.and.returnValue(throwError(() => ({ error: { detail: 'ase' } })));
      component.assign();
      expect(toast.error).toHaveBeenCalledWith('adminUi.couponsV2.errors.assign', 'ase');
    });
  });

  describe('revoke', () => {
    it('does nothing without a coupon', () => {
      component.selectedCoupon.set(null);
      component.revoke();
      expect(adminCoupons.revokeCoupon).not.toHaveBeenCalled();
    });

    it('validates the email', () => {
      component.selectedCoupon.set(makeCoupon());
      component.revokeEmail = '';
      component.revoke();
      expect(toast.error).toHaveBeenCalledWith(
        'adminUi.couponsV2.errors.validation',
        'adminUi.couponsV2.errors.emailRequired',
      );
    });

    it('revokes with a reason on success', () => {
      component.selectedCoupon.set(makeCoupon());
      component.revokeEmail = 'x@y.com';
      component.revokeReason = '  spam  ';
      adminCoupons.revokeCoupon.and.returnValue(of(undefined));
      component.revoke();
      expect(adminCoupons.revokeCoupon).toHaveBeenCalledWith('coupon-1', {
        email: 'x@y.com',
        reason: 'spam',
        send_email: true,
      });
      expect(component.revokeEmail).toBe('');
    });

    it('revokes with a null reason and reports errors', () => {
      component.selectedCoupon.set(makeCoupon());
      component.revokeEmail = 'x@y.com';
      component.revokeReason = '';
      adminCoupons.revokeCoupon.and.returnValue(throwError(() => ({ error: { detail: 're' } })));
      component.revoke();
      expect(adminCoupons.revokeCoupon).toHaveBeenCalledWith('coupon-1', {
        email: 'x@y.com',
        reason: null,
        send_email: true,
      });
      expect(toast.error).toHaveBeenCalledWith('adminUi.couponsV2.errors.revoke', 're');
    });
  });

  describe('searchProducts', () => {
    it('clears products for an empty query', () => {
      component.productQuery = '';
      component.products.set([{ id: 'p' } as any]);
      component.searchProducts();
      expect(component.products()).toEqual([]);
    });

    it('searches and caches products', () => {
      component.productQuery = 'shirt';
      adminProducts.search.and.returnValue(
        of({ items: [{ id: 'p1', name: 'Shirt' }, { id: '' }] } as any),
      );
      component.searchProducts();
      expect(component.products().length).toBe(2);
      expect((component as any).productCache['p1']).toBeTruthy();
    });

    it('handles a nullish items field and errors', () => {
      component.productQuery = 'shirt';
      adminProducts.search.and.returnValue(of({} as any));
      component.searchProducts();
      expect(component.products()).toEqual([]);

      adminProducts.search.and.returnValue(throwError(() => ({ error: { detail: 'pe' } })));
      component.searchProducts();
      expect(component.productsError()).toBe('pe');

      adminProducts.search.and.returnValue(throwError(() => ({})));
      component.searchProducts();
      expect(component.productsError()).toBe('adminUi.couponsV2.errors.searchProducts');
    });
  });

  describe('scope products', () => {
    it('adds and removes include/exclude products', () => {
      component.promotionForm = (component as any).blankPromotionForm();
      component.addScopeProduct('include', { id: '' } as any);
      expect(component.promotionForm.included_product_ids).toEqual([]);

      component.promotionForm.excluded_product_ids = ['p1'];
      component.addScopeProduct('include', { id: 'p1', name: 'P1' } as any);
      expect(component.promotionForm.included_product_ids).toEqual(['p1']);
      expect(component.promotionForm.excluded_product_ids).toEqual([]);

      component.addScopeProduct('include', { id: 'p1', name: 'P1' } as any);
      expect(component.promotionForm.included_product_ids).toEqual(['p1']);

      component.promotionForm.included_product_ids = ['p2'];
      component.addScopeProduct('exclude', { id: 'p2', name: 'P2' } as any);
      expect(component.promotionForm.excluded_product_ids).toEqual(['p2']);
      expect(component.promotionForm.included_product_ids).toEqual([]);

      component.addScopeProduct('exclude', { id: 'p2', name: 'P2' } as any);
      expect(component.promotionForm.excluded_product_ids).toEqual(['p2']);

      component.removeScopeProduct('include', 'nope');
      component.promotionForm.included_product_ids = ['keep', 'drop'];
      component.removeScopeProduct('include', 'drop');
      expect(component.promotionForm.included_product_ids).toEqual(['keep']);

      component.promotionForm.excluded_product_ids = ['ek', 'ed'];
      component.removeScopeProduct('exclude', 'ed');
      expect(component.promotionForm.excluded_product_ids).toEqual(['ek']);
    });

    it('syncs category scopes both directions', () => {
      component.promotionForm = (component as any).blankPromotionForm();
      component.promotionForm.included_category_ids = ['c1', 'c1', 'c2'];
      component.promotionForm.excluded_category_ids = ['c2', 'c3'];
      component.syncCategoryScopes('included');
      expect(component.promotionForm.included_category_ids).toEqual(['c1', 'c2']);
      expect(component.promotionForm.excluded_category_ids).toEqual(['c3']);

      component.promotionForm.included_category_ids = ['c1', 'c4'];
      component.promotionForm.excluded_category_ids = ['c4', 'c4', 'c5'];
      component.syncCategoryScopes('excluded');
      expect(component.promotionForm.excluded_category_ids).toEqual(['c4', 'c5']);
      expect(component.promotionForm.included_category_ids).toEqual(['c1']);
    });

    it('labels products from cache or falls back to id', () => {
      (component as any).productCache = { p1: { id: 'p1', name: 'Named' } };
      expect(component.productLabel('p1')).toBe('Named');
      expect(component.productLabel('unknown')).toBe('unknown');
    });

    it('resolves scoped products that are missing from cache', () => {
      component.promotionForm = (component as any).blankPromotionForm();
      component.promotionForm.included_product_ids = ['p1'];
      component.promotionForm.excluded_product_ids = ['p2'];
      adminProducts.byIds.and.returnValue(of([{ id: 'p1', name: 'One' }, { id: '' }] as any));
      (component as any).loadScopedProducts();
      expect((component as any).productCache['p1']).toBeTruthy();
      expect(component.scopeProductsLoading()).toBeFalse();
    });

    it('skips resolving when all scoped products are cached', () => {
      component.promotionForm = (component as any).blankPromotionForm();
      component.promotionForm.included_product_ids = ['p1'];
      (component as any).productCache = { p1: { id: 'p1', name: 'One' } };
      (component as any).loadScopedProducts();
      expect(adminProducts.byIds).not.toHaveBeenCalled();
      expect(component.scopeProductsLoading()).toBeFalse();
    });

    it('reports errors while resolving scoped products', () => {
      component.promotionForm = (component as any).blankPromotionForm();
      component.promotionForm.included_product_ids = ['p1'];
      adminProducts.byIds.and.returnValue(throwError(() => new Error('x')));
      (component as any).loadScopedProducts();
      expect(component.scopeProductsError()).toBe('adminUi.couponsV2.errors.resolveProducts');
      expect(component.scopeProductsLoading()).toBeFalse();
    });
  });

  describe('describePromotion', () => {
    it('returns empty for a falsy promotion', () => {
      expect(component.describePromotion(null as any)).toBe('');
    });

    it('describes free shipping, amount and percent', () => {
      expect(component.describePromotion(makePromo({ discount_type: 'free_shipping' }))).toBe(
        'adminUi.couponsV2.discountSummary.freeShipping',
      );
      expect(
        component.describePromotion(makePromo({ discount_type: 'amount', amount_off: '5' })),
      ).toBe('adminUi.couponsV2.discountSummary.amountOff');
      expect(
        component.describePromotion(makePromo({ discount_type: 'amount', amount_off: null })),
      ).toBe('adminUi.couponsV2.discountSummary.amountOff');
      expect(
        component.describePromotion(makePromo({ discount_type: 'percent', percentage_off: '10' })),
      ).toBe('adminUi.couponsV2.discountSummary.percentOff');
      expect(
        component.describePromotion(makePromo({ discount_type: 'percent', percentage_off: null })),
      ).toBe('adminUi.couponsV2.discountSummary.percentOff');
    });
  });

  describe('promotion calendar + schedule rows', () => {
    it('computes calendar start/end dates', () => {
      component.promotionCalendarDays = 30;
      const start = component.promotionCalendarStartDate();
      const end = component.promotionCalendarEndDate();
      expect(end.getTime() - start.getTime()).toBe(30 * 86_400_000);
    });

    it('returns an empty schedule with no promotions', () => {
      component.promotions.set([]);
      expect(component.promotionScheduleRows()).toEqual([]);
    });

    it('returns empty when nothing is visible in the window', () => {
      const past = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const older = new Date(Date.now() - 20 * 86_400_000).toISOString();
      component.promotionCalendarDays = 5;
      component.promotions.set([makePromo({ id: 'old', starts_at: past, ends_at: older })]);
      expect(component.promotionScheduleRows()).toEqual([]);
    });

    it('skips inverted (zero-or-negative width) ranges that pass the window test', () => {
      const start = component.promotionCalendarStartDate().getTime();
      const startsAt = new Date(start + 5 * 86_400_000).toISOString();
      const endsAt = new Date(start + 2 * 86_400_000).toISOString();
      component.promotionCalendarDays = 90;
      component.promotions.set([makePromo({ id: 'inv', starts_at: startsAt, ends_at: endsAt })]);
      expect(component.promotionScheduleRows()).toEqual([]);
    });

    it('builds rows with conflict counts and overflow labels', () => {
      component.promotionCalendarDays = 90;
      const promos: PromotionRead[] = [];
      // 9 active promotions all spanning the entire window -> overlapping each other.
      for (let i = 0; i < 9; i += 1) {
        promos.push(
          makePromo({
            id: `o${i}`,
            name: `Overlap ${i}`,
            starts_at: null,
            ends_at: null,
            is_active: true,
          }),
        );
      }
      // one inactive promotion (covers the inactive branches)
      promos.push(makePromo({ id: 'inactive', name: 'Inactive', is_active: false }));
      // one with a NaN start date (covers the parseEpoch NaN fallback)
      promos.push(
        makePromo({
          id: 'nan',
          name: 'NaN',
          starts_at: 'not-a-date',
          ends_at: null,
          is_active: false,
        }),
      );
      component.promotions.set(promos);
      const rows = component.promotionScheduleRows();
      const overlapRow = rows.find((r) => r.promotion.id === 'o0');
      expect(overlapRow).toBeTruthy();
      // 8 other active overlapping promos -> > 6 preview -> "+N" overflow label
      expect(overlapRow!.conflictCount).toBe(8);
      expect(overlapRow!.conflictNames).toContain('+');
      const inactiveRow = rows.find((r) => r.promotion.id === 'inactive');
      expect(inactiveRow!.conflictCount).toBe(0);
    });

    it('builds a short conflict label without overflow', () => {
      component.promotionCalendarDays = 90;
      component.promotions.set([
        makePromo({ id: 'a', name: 'A', starts_at: null, ends_at: null }),
        makePromo({ id: 'b', name: 'B', starts_at: null, ends_at: null }),
      ]);
      const rows = component.promotionScheduleRows();
      const rowA = rows.find((r) => r.promotion.id === 'a')!;
      expect(rowA.conflictCount).toBe(1);
      expect(rowA.conflictNames).toBe('B');
      expect(rowA.widthPct).toBeGreaterThan(0);
    });
  });

  describe('stacking previews', () => {
    it('detects min-subtotal blocking', () => {
      component.promotionForm = (component as any).blankPromotionForm();
      component.promotionForm.min_subtotal = '';
      expect(component.stackingMinSubtotalBlocked()).toBeFalse();

      component.promotionForm.min_subtotal = '100';
      component.stackingSampleSubtotal = '';
      expect(component.stackingMinSubtotalBlocked()).toBeFalse();

      component.promotionForm.min_subtotal = '100';
      component.stackingSampleSubtotal = '50';
      expect(component.stackingMinSubtotalBlocked()).toBeTrue();

      component.stackingSampleSubtotal = '150';
      expect(component.stackingMinSubtotalBlocked()).toBeFalse();
    });

    it('returns null for free shipping previews', () => {
      component.promotionForm = (component as any).blankPromotionForm();
      component.promotionForm.discount_type = 'free_shipping';
      expect(component.stackingPreviewProductDiscount(false)).toBeNull();
    });

    it('returns zero for invalid subtotal or blocked min subtotal', () => {
      component.promotionForm = (component as any).blankPromotionForm();
      component.promotionForm.discount_type = 'percent';
      component.stackingSampleSubtotal = '';
      expect(component.stackingPreviewProductDiscount(false)).toBe(0);

      component.stackingSampleSubtotal = '100';
      component.promotionForm.min_subtotal = '200';
      expect(component.stackingPreviewProductDiscount(false)).toBe(0);
    });

    it('returns zero when on-sale items are excluded', () => {
      component.promotionForm = (component as any).blankPromotionForm();
      component.promotionForm.discount_type = 'percent';
      component.promotionForm.percentage_off = '10';
      component.promotionForm.allow_on_sale_items = false;
      component.promotionForm.min_subtotal = '';
      component.stackingSampleSubtotal = '100';
      expect(component.stackingPreviewProductDiscount(true)).toBe(0);
    });

    it('computes percent discount and applies the cap', () => {
      component.promotionForm = (component as any).blankPromotionForm();
      component.promotionForm.discount_type = 'percent';
      component.promotionForm.percentage_off = '50';
      component.promotionForm.min_subtotal = '';
      component.stackingSampleSubtotal = '100';
      expect(component.stackingPreviewProductDiscount(false)).toBe(50);

      component.promotionForm.max_discount_amount = '20';
      expect(component.stackingPreviewProductDiscount(false)).toBe(20);

      component.promotionForm.percentage_off = '';
      expect(component.stackingPreviewProductDiscount(false)).toBe(0);
    });

    it('computes amount discount clamped to subtotal', () => {
      component.promotionForm = (component as any).blankPromotionForm();
      component.promotionForm.discount_type = 'amount';
      component.promotionForm.min_subtotal = '';
      component.promotionForm.amount_off = '30';
      component.stackingSampleSubtotal = '100';
      expect(component.stackingPreviewProductDiscount(false)).toBe(30);

      component.promotionForm.amount_off = '';
      expect(component.stackingPreviewProductDiscount(false)).toBe(0);
    });
  });

  describe('formatting + helpers', () => {
    it('formats RON values and handles invalid input', () => {
      expect(component.formatRon(null)).toBe('—');
      expect(component.formatRon(Number.POSITIVE_INFINITY)).toBe('—');
      expect(component.formatRon(12.5)).toBe('12.50 RON');
      expect(component.formatRonString('7')).toBe('7.00 RON');
      expect(component.formatRonString(null)).toBe('—');
    });

    it('deduplicates ids and drops blanks', () => {
      expect((component as any).uniqueIds(['a', 'a', '', 'b', null as any])).toEqual(['a', 'b']);
      expect((component as any).uniqueIds(null as any)).toEqual([]);
    });

    it('converts optional decimal strings', () => {
      expect((component as any).optionalDecimalString(5)).toBe('5');
      expect((component as any).optionalDecimalString(Number.NaN)).toBeNull();
      expect((component as any).optionalDecimalString('  3 ')).toBe('3');
      expect((component as any).optionalDecimalString('   ')).toBeNull();
      expect((component as any).optionalDecimalString(true)).toBeNull();
    });

    it('converts optional numbers', () => {
      expect((component as any).optionalNumber(4)).toBe(4);
      expect((component as any).optionalNumber(Number.NaN)).toBeNull();
      expect((component as any).optionalNumber('  6 ')).toBe(6);
      expect((component as any).optionalNumber('  ')).toBeNull();
      expect((component as any).optionalNumber('abc')).toBeNull();
      expect((component as any).optionalNumber(true)).toBeNull();
    });

    it('converts optional positive integers', () => {
      expect((component as any).optionalInt('5.9')).toBe(5);
      expect((component as any).optionalInt('0')).toBeNull();
      expect((component as any).optionalInt('')).toBeNull();
    });

    it('formats and rejects local datetime values', () => {
      expect((component as any).toLocalDateTime('not-a-date')).toBe('');
      const formatted = (component as any).toLocalDateTime('2026-03-04T05:06:00Z');
      expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    });

    it('maps promotion and coupon read models to forms', () => {
      const form = (component as any).promotionToForm(
        makePromo({
          key: null as any,
          percentage_off: null,
          amount_off: '5',
          max_discount_amount: '10',
          min_subtotal: '20',
          allow_on_sale_items: false,
          first_order_only: true,
          starts_at: '2026-01-01T00:00:00Z',
          ends_at: '2026-02-01T00:00:00Z',
          is_active: false,
          is_automatic: true,
          included_product_ids: undefined,
          excluded_product_ids: ['e'],
          included_category_ids: undefined,
          excluded_category_ids: ['ec'],
        }),
      );
      expect(form.allow_on_sale_items).toBeFalse();
      expect(form.first_order_only).toBeTrue();
      expect(form.included_product_ids).toEqual([]);
      expect(form.excluded_product_ids).toEqual(['e']);
      expect(form.starts_at).not.toBe('');

      const couponForm = (component as any).couponToForm(
        makeCoupon({
          is_active: false,
          starts_at: '2026-01-01T00:00:00Z',
          ends_at: null,
          global_max_redemptions: 5,
          per_customer_max_redemptions: null,
        }),
      );
      expect(couponForm.is_active).toBeFalse();
      expect(couponForm.starts_at).not.toBe('');
      expect(couponForm.ends_at).toBe('');
      expect(couponForm.global_max_redemptions).toBe(5);
      expect(couponForm.per_customer_max_redemptions).toBe('');
    });
  });

  describe('validatePromotionForm + payload', () => {
    it('requires a name', () => {
      component.promotionForm = (component as any).blankPromotionForm();
      component.promotionForm.name = '';
      expect((component as any).validatePromotionForm()).toBe(
        'adminUi.couponsV2.errors.promotionNameRequired',
      );
    });

    it('rejects an inverted date range', () => {
      component.promotionForm = (component as any).blankPromotionForm();
      component.promotionForm.name = 'X';
      component.promotionForm.starts_at = '2026-02-01T00:00';
      component.promotionForm.ends_at = '2026-01-01T00:00';
      component.promotionForm.discount_type = 'free_shipping';
      expect((component as any).validatePromotionForm()).toBe(
        'adminUi.couponsV2.errors.invalidDateRange',
      );
    });

    it('validates percent and amount discount values', () => {
      component.promotionForm = (component as any).blankPromotionForm();
      component.promotionForm.name = 'X';
      component.promotionForm.discount_type = 'percent';
      component.promotionForm.percentage_off = '0';
      expect((component as any).validatePromotionForm()).toBe(
        'adminUi.couponsV2.errors.percentRequired',
      );
      component.promotionForm.percentage_off = '150';
      expect((component as any).validatePromotionForm()).toBe(
        'adminUi.couponsV2.errors.percentRequired',
      );

      component.promotionForm.discount_type = 'amount';
      component.promotionForm.amount_off = '0';
      expect((component as any).validatePromotionForm()).toBe(
        'adminUi.couponsV2.errors.amountRequired',
      );
    });

    it('passes a valid form', () => {
      component.promotionForm = (component as any).blankPromotionForm();
      component.promotionForm.name = 'Valid';
      component.promotionForm.discount_type = 'percent';
      component.promotionForm.percentage_off = '10';
      expect((component as any).validatePromotionForm()).toBeNull();
    });

    it('builds payloads for percent and amount with key/description present and absent', () => {
      component.promotionForm = (component as any).blankPromotionForm();
      component.promotionForm.key = ' K ';
      component.promotionForm.name = ' Name ';
      component.promotionForm.description = ' Desc ';
      component.promotionForm.discount_type = 'percent';
      component.promotionForm.percentage_off = '10';
      component.promotionForm.starts_at = '2026-01-01T00:00';
      component.promotionForm.ends_at = '2026-02-01T00:00';
      const p1 = (component as any).promotionPayloadFromForm();
      expect(p1.key).toBe('K');
      expect(p1.description).toBe('Desc');
      expect(p1.percentage_off).toBe('10');
      expect(p1.amount_off).toBeNull();
      expect(typeof p1.starts_at).toBe('string');

      component.promotionForm.key = '';
      component.promotionForm.description = '';
      component.promotionForm.discount_type = 'amount';
      component.promotionForm.amount_off = '5';
      component.promotionForm.starts_at = '';
      component.promotionForm.ends_at = '';
      const p2 = (component as any).promotionPayloadFromForm();
      expect(p2.key).toBeNull();
      expect(p2.description).toBeNull();
      expect(p2.amount_off).toBe('5');
      expect(p2.percentage_off).toBeNull();
      expect(p2.starts_at).toBeNull();
      expect(p2.ends_at).toBeNull();
    });
  });

  describe('bulk CSV handling', () => {
    it('ignores a change event without a file', async () => {
      await component.onBulkFileChange({ target: { files: [] } } as any);
      expect(component.bulkEmails).toEqual([]);
    });

    it('parses a CSV file with header, duplicates and invalid rows', async () => {
      const csv = 'email\nA@B.com\na@b.com\nbad-row\nc@d.com\n';
      const file = new File([csv], 'list.csv', { type: 'text/csv' });
      await component.onBulkFileChange({ target: { files: [file] } } as any);
      expect(component.bulkEmails).toEqual(['a@b.com', 'c@d.com']);
      expect(component.bulkDuplicates).toBe(1);
      expect(component.bulkInvalid).toEqual(['bad-row']);
    });

    it('captures a parse error when reading fails', async () => {
      const file = { text: () => Promise.reject(new Error('boom')) } as any;
      await component.onBulkFileChange({ target: { files: [file] } } as any);
      expect(component.bulkParseError).toBe('adminUi.couponsV2.bulk.parseError');
    });

    it('clears the selection and resets the file input', () => {
      const input = document.createElement('input');
      input.type = 'file';
      component.bulkEmails = ['a@b.com'];
      component.clearBulkSelection(input);
      expect(component.bulkEmails).toEqual([]);

      component.bulkEmails = ['a@b.com'];
      component.clearBulkSelection();
      expect(component.bulkEmails).toEqual([]);
    });

    it('previews bulk emails with and without overflow', () => {
      component.bulkEmails = [];
      expect(component.bulkEmailsPreview()).toBe('');
      component.bulkEmails = ['a@b.com', 'c@d.com'];
      expect(component.bulkEmailsPreview()).toBe('a@b.com, c@d.com');
      component.bulkEmails = Array.from({ length: 8 }, (_, i) => `u${i}@x.com`);
      expect(component.bulkEmailsPreview()).toContain('…');
    });

    it('parses csv with truncation beyond the cap', () => {
      const lines = Array.from({ length: 510 }, (_, i) => `u${i}@x.com`).join('\n');
      const result = (component as any).parseEmailsFromCsv(lines);
      expect(result.emails.length).toBe(500);
      expect(result.truncated).toBe(10);
    });

    it('validates emails', () => {
      expect((component as any).isValidEmail('')).toBeFalse();
      expect((component as any).isValidEmail(`a@${'x'.repeat(300)}.com`)).toBeFalse();
      expect((component as any).isValidEmail('@nope.com')).toBeFalse();
      expect((component as any).isValidEmail('nope@')).toBeFalse();
      expect((component as any).isValidEmail('nodot@domain')).toBeFalse();
      expect((component as any).isValidEmail('good@domain.com')).toBeTrue();
    });
  });

  describe('bulkAssign / bulkRevoke', () => {
    it('does nothing without a coupon', () => {
      component.selectedCoupon.set(null);
      component.bulkEmails = ['a@b.com'];
      component.bulkAssign();
      component.bulkRevoke();
      expect(adminCoupons.bulkAssignCoupon).not.toHaveBeenCalled();
    });

    it('validates that there are emails', () => {
      component.selectedCoupon.set(makeCoupon());
      component.bulkEmails = [];
      component.bulkAssign();
      component.bulkRevoke();
      expect(toast.error).toHaveBeenCalledTimes(2);
    });

    it('bulk assigns on success and reports errors', () => {
      component.selectedCoupon.set(makeCoupon());
      component.bulkEmails = ['a@b.com'];
      adminCoupons.bulkAssignCoupon.and.returnValue(of(makeBulkResult()));
      component.bulkAssign();
      expect(component.bulkResult()).not.toBeNull();
      expect(toast.success).toHaveBeenCalled();

      adminCoupons.bulkAssignCoupon.and.returnValue(
        throwError(() => ({ error: { detail: 'ba' } })),
      );
      component.bulkAssign();
      expect(toast.error).toHaveBeenCalledWith('adminUi.couponsV2.errors.assign', 'ba');
    });

    it('bulk revokes with a reason on success and reports errors', () => {
      component.selectedCoupon.set(makeCoupon());
      component.bulkEmails = ['a@b.com'];
      component.bulkRevokeReason = '  cleanup  ';
      adminCoupons.bulkRevokeCoupon.and.returnValue(of(makeBulkResult()));
      component.bulkRevoke();
      expect(adminCoupons.bulkRevokeCoupon).toHaveBeenCalledWith('coupon-1', {
        emails: ['a@b.com'],
        reason: 'cleanup',
        send_email: true,
      });

      component.bulkRevokeReason = '';
      adminCoupons.bulkRevokeCoupon.and.returnValue(
        throwError(() => ({ error: { detail: 'br' } })),
      );
      component.bulkRevoke();
      expect(toast.error).toHaveBeenCalledWith('adminUi.couponsV2.errors.revoke', 'br');
    });
  });

  describe('segment helpers', () => {
    it('reports in-progress status', () => {
      component.segmentJob.set(makeJob({ status: 'pending' }));
      expect(component.segmentJobInProgress()).toBeTrue();
      component.segmentJob.set(makeJob({ status: 'succeeded' }));
      expect(component.segmentJobInProgress()).toBeFalse();
    });

    it('counts candidates from previews then job', () => {
      component.segmentPreviewAssign.set(null);
      component.segmentPreviewRevoke.set(null);
      component.segmentJob.set(null);
      expect(component.segmentCandidatesCount()).toBe(0);

      component.segmentJob.set(makeJob({ total_candidates: 7 }));
      expect(component.segmentCandidatesCount()).toBe(7);

      component.segmentPreviewRevoke.set(makeSegmentPreview({ total_candidates: 4 }));
      expect(component.segmentCandidatesCount()).toBe(4);

      component.segmentPreviewAssign.set(makeSegmentPreview({ total_candidates: 9 }));
      expect(component.segmentCandidatesCount()).toBe(9);
    });

    it('samples preview emails from assign then revoke', () => {
      component.segmentPreviewAssign.set(null);
      component.segmentPreviewRevoke.set(null);
      expect(component.segmentPreviewSample()).toBe('');

      component.segmentPreviewRevoke.set(makeSegmentPreview({ sample_emails: ['r@x.com'] }));
      expect(component.segmentPreviewSample()).toBe('r@x.com');

      component.segmentPreviewAssign.set(
        makeSegmentPreview({ sample_emails: Array.from({ length: 8 }, (_, i) => `a${i}@x.com`) }),
      );
      expect(component.segmentPreviewSample()).toContain('…');
    });
  });

  describe('loadSegmentJobs', () => {
    it('does nothing without a coupon', () => {
      component.selectedCoupon.set(null);
      component.loadSegmentJobs();
      expect(adminCoupons.listBulkJobs).not.toHaveBeenCalled();
    });

    it('loads jobs and coerces non-array', () => {
      component.selectedCoupon.set(makeCoupon());
      adminCoupons.listBulkJobs.and.returnValue(of(null as any));
      component.loadSegmentJobs();
      expect(component.segmentJobs()).toEqual([]);
    });

    it('reports errors with detail and fallback', () => {
      component.selectedCoupon.set(makeCoupon());
      adminCoupons.listBulkJobs.and.returnValue(throwError(() => ({ error: { detail: 'je' } })));
      component.loadSegmentJobs();
      expect(component.segmentJobsError()).toBe('je');

      adminCoupons.listBulkJobs.and.returnValue(throwError(() => ({})));
      component.loadSegmentJobs();
      expect(component.segmentJobsError()).toBe('adminUi.couponsV2.bulk.segment.jobsLoadError');
    });
  });

  describe('segmentPreview', () => {
    it('does nothing without a coupon', () => {
      component.selectedCoupon.set(null);
      component.segmentPreview();
      expect(adminCoupons.previewSegmentAssign).not.toHaveBeenCalled();
    });

    it('previews assign and revoke with a trimmed reason', () => {
      component.selectedCoupon.set(makeCoupon());
      component.segmentRevokeReason = '  why  ';
      adminCoupons.previewSegmentAssign.and.returnValue(of(makeSegmentPreview()));
      adminCoupons.previewSegmentRevoke.and.returnValue(of(makeSegmentPreview()));
      component.segmentPreview();
      expect(component.segmentPreviewAssign()).not.toBeNull();
      expect(component.segmentPreviewRevoke()).not.toBeNull();
      const revokePayload = adminCoupons.previewSegmentRevoke.calls.mostRecent()
        .args[1] as unknown as AnyObj;
      expect(revokePayload['reason']).toBe('why');
    });

    it('reports preview errors', () => {
      component.selectedCoupon.set(makeCoupon());
      component.segmentRevokeReason = '';
      adminCoupons.previewSegmentAssign.and.returnValue(of(makeSegmentPreview()));
      adminCoupons.previewSegmentRevoke.and.returnValue(
        throwError(() => ({ error: { detail: 'pe' } })),
      );
      component.segmentPreview();
      expect(component.segmentPreviewBusy()).toBeFalse();
      expect(toast.error).toHaveBeenCalledWith('adminUi.couponsV2.bulk.segment.previewError', 'pe');
    });
  });

  describe('segmentAssign / segmentRevoke', () => {
    it('segmentAssign does nothing without a coupon', () => {
      component.selectedCoupon.set(null);
      component.segmentAssign();
      expect(adminCoupons.startSegmentAssignJob).not.toHaveBeenCalled();
    });

    it('segmentAssign starts a job and begins polling', () => {
      component.selectedCoupon.set(makeCoupon());
      adminCoupons.startSegmentAssignJob.and.returnValue(of(makeJob({ id: 'sj' })));
      adminCoupons.getBulkJob.and.returnValue(of(makeJob({ id: 'sj', status: 'running' })));
      component.segmentAssign();
      expect(component.segmentJob()?.id).toBe('sj');
      expect(window.setInterval).toHaveBeenCalled();
    });

    it('segmentAssign reports errors', () => {
      component.selectedCoupon.set(makeCoupon());
      adminCoupons.startSegmentAssignJob.and.returnValue(
        throwError(() => ({ error: { detail: 'sa' } })),
      );
      component.segmentAssign();
      expect(toast.error).toHaveBeenCalledWith('adminUi.couponsV2.errors.assign', 'sa');
    });

    it('segmentRevoke does nothing without a coupon', () => {
      component.selectedCoupon.set(null);
      component.segmentRevoke();
      expect(adminCoupons.startSegmentRevokeJob).not.toHaveBeenCalled();
    });

    it('segmentRevoke starts a job with a trimmed reason', () => {
      component.selectedCoupon.set(makeCoupon());
      component.segmentRevokeReason = '  cleanup  ';
      adminCoupons.startSegmentRevokeJob.and.returnValue(
        of(makeJob({ id: 'sr', action: 'revoke' })),
      );
      adminCoupons.getBulkJob.and.returnValue(of(makeJob({ id: 'sr', status: 'running' })));
      component.segmentRevoke();
      const payload = adminCoupons.startSegmentRevokeJob.calls.mostRecent()
        .args[1] as unknown as AnyObj;
      expect(payload['reason']).toBe('cleanup');
      expect(component.segmentJob()?.id).toBe('sr');
    });

    it('segmentRevoke reports errors and a null reason', () => {
      component.selectedCoupon.set(makeCoupon());
      component.segmentRevokeReason = '';
      adminCoupons.startSegmentRevokeJob.and.returnValue(
        throwError(() => ({ error: { detail: 'srv' } })),
      );
      component.segmentRevoke();
      const payload = adminCoupons.startSegmentRevokeJob.calls.mostRecent()
        .args[1] as unknown as AnyObj;
      expect(payload['reason']).toBeNull();
      expect(toast.error).toHaveBeenCalledWith('adminUi.couponsV2.errors.revoke', 'srv');
    });
  });

  describe('cancelSegmentJob', () => {
    it('ignores jobs without id or in a terminal state', () => {
      component.cancelSegmentJob({ id: '' } as any);
      component.cancelSegmentJob(makeJob({ status: 'succeeded' }));
      expect(adminCoupons.cancelBulkJob).not.toHaveBeenCalled();
    });

    it('cancels a running job and clears the active job when it matches', () => {
      const job = makeJob({ id: 'cj', status: 'running' });
      component.segmentJob.set(job);
      component.segmentJobs.set([job]);
      adminCoupons.cancelBulkJob.and.returnValue(of(makeJob({ id: 'cj', status: 'cancelled' })));
      component.cancelSegmentJob(job);
      expect(component.segmentJob()?.status).toBe('cancelled');
      expect(component.segmentJobsBusy()).toBeFalse();
      expect(toast.success).toHaveBeenCalled();
    });

    it('cancels a running job that is not the active one', () => {
      component.segmentJob.set(makeJob({ id: 'other', status: 'running' }));
      const job = makeJob({ id: 'cj', status: 'pending' });
      adminCoupons.cancelBulkJob.and.returnValue(of(makeJob({ id: 'cj', status: 'cancelled' })));
      component.cancelSegmentJob(job);
      expect(component.segmentJob()?.id).toBe('other');
    });

    it('reports cancel errors', () => {
      const job = makeJob({ id: 'cj', status: 'running' });
      adminCoupons.cancelBulkJob.and.returnValue(throwError(() => ({ error: { detail: 'ce' } })));
      component.cancelSegmentJob(job);
      expect(component.segmentJobsBusy()).toBeFalse();
      expect(toast.error).toHaveBeenCalledWith('adminUi.couponsV2.bulk.segment.cancelError', 'ce');
    });
  });

  describe('retrySegmentJob', () => {
    it('ignores invalid jobs and in-progress state', () => {
      component.retrySegmentJob({ id: '' } as any);
      component.retrySegmentJob(makeJob({ status: 'running' }));
      component.segmentJob.set(makeJob({ status: 'running' }));
      component.retrySegmentJob(makeJob({ id: 'r', status: 'failed' }));
      expect(adminCoupons.retryBulkJob).not.toHaveBeenCalled();
    });

    it('retries a failed job and starts polling', () => {
      component.segmentJob.set(null);
      adminCoupons.retryBulkJob.and.returnValue(of(makeJob({ id: 'rnew', status: 'pending' })));
      adminCoupons.getBulkJob.and.returnValue(of(makeJob({ id: 'rnew', status: 'running' })));
      component.retrySegmentJob(makeJob({ id: 'old', status: 'failed' }));
      expect(component.segmentJob()?.id).toBe('rnew');
      expect(window.setInterval).toHaveBeenCalled();
    });

    it('reports retry errors', () => {
      component.segmentJob.set(null);
      adminCoupons.retryBulkJob.and.returnValue(throwError(() => ({ error: { detail: 're' } })));
      component.retrySegmentJob(makeJob({ id: 'old', status: 'cancelled' }));
      expect(component.segmentJobsBusy()).toBeFalse();
      expect(toast.error).toHaveBeenCalledWith('adminUi.couponsV2.bulk.segment.retryError', 're');
    });
  });

  describe('polling internals', () => {
    it('refreshSegmentJob updates status, completes and reloads on success transition', () => {
      component.selectedCoupon.set(makeCoupon());
      (component as any).segmentJobLastStatus = 'running';
      (component as any).segmentJobPollHandle = 99;
      const la = spyOn(component, 'loadAssignments');
      adminCoupons.getBulkJob.and.returnValue(of(makeJob({ id: 'sj', status: 'succeeded' })));
      (component as any).refreshSegmentJob('sj');
      expect(component.segmentJob()?.status).toBe('succeeded');
      expect(la).toHaveBeenCalled();
      expect(window.clearInterval).toHaveBeenCalled();
    });

    it('refreshSegmentJob stops polling on error', () => {
      adminCoupons.getBulkJob.and.returnValue(throwError(() => new Error('x')));
      (component as any).startSegmentPolling('sj');
      // run the captured interval callback to exercise the arrow function
      intervalCallbacks[intervalCallbacks.length - 1]();
      expect(window.clearInterval).toHaveBeenCalled();
    });

    it('startSegmentPolling invokes the interval callback', () => {
      adminCoupons.getBulkJob.and.returnValue(of(makeJob({ id: 'sj', status: 'running' })));
      (component as any).startSegmentPolling('sj');
      const cb = intervalCallbacks[intervalCallbacks.length - 1];
      cb();
      expect(adminCoupons.getBulkJob).toHaveBeenCalled();
    });

    it('refreshAbJobs stops polling when there is nothing to poll', () => {
      (component as any).abPollHandle = 99;
      component.abJobA.set(makeJob({ id: 'a', status: 'succeeded' }));
      component.abJobB.set(makeJob({ id: 'b', status: 'failed' }));
      (component as any).refreshAbJobs();
      expect(window.clearInterval).toHaveBeenCalled();
    });

    it('refreshAbJobs updates jobs and reloads when both are terminal', () => {
      component.abJobA.set(makeJob({ id: 'a', status: 'running' }));
      component.abJobB.set(makeJob({ id: 'b', status: 'running' }));
      const la = spyOn(component, 'loadAssignments');
      adminCoupons.getBulkJob.and.returnValues(
        of(makeJob({ id: 'a', status: 'succeeded' })),
        of(makeJob({ id: 'b', status: 'succeeded' })),
      );
      (component as any).refreshAbJobs();
      expect(component.abJobA()?.status).toBe('succeeded');
      expect(la).toHaveBeenCalled();
    });

    it('refreshAbJobs keeps polling when jobs are still running', () => {
      component.abJobA.set(makeJob({ id: 'a', status: 'running' }));
      component.abJobB.set(makeJob({ id: 'b', status: 'running' }));
      adminCoupons.getBulkJob.and.returnValues(
        of(makeJob({ id: 'a', status: 'running' })),
        of(makeJob({ id: 'b', status: 'running' })),
      );
      (component as any).refreshAbJobs();
      expect(component.abJobA()?.status).toBe('running');
    });

    it('refreshAbJobs stops polling on error', () => {
      (component as any).abPollHandle = 99;
      component.abJobA.set(makeJob({ id: 'a', status: 'running' }));
      component.abJobB.set(null);
      adminCoupons.getBulkJob.and.returnValue(throwError(() => new Error('x')));
      (component as any).refreshAbJobs();
      expect(window.clearInterval).toHaveBeenCalled();
    });

    it('startAbPolling invokes the captured interval callback', () => {
      component.abJobA.set(makeJob({ id: 'a', status: 'running' }));
      component.abJobB.set(null);
      adminCoupons.getBulkJob.and.returnValue(of(makeJob({ id: 'a', status: 'running' })));
      (component as any).startAbPolling();
      const cb = intervalCallbacks[intervalCallbacks.length - 1];
      cb();
      expect(adminCoupons.getBulkJob).toHaveBeenCalled();
    });
  });

  describe('upsertSegmentJob', () => {
    it('ignores jobs without id', () => {
      component.segmentJobs.set([]);
      (component as any).upsertSegmentJob({ id: '' });
      expect(component.segmentJobs()).toEqual([]);
    });

    it('appends a new job and promotes when requested', () => {
      component.segmentJobs.set([makeJob({ id: 'old' })]);
      (component as any).upsertSegmentJob(makeJob({ id: 'new' }));
      expect(component.segmentJobs().map((j) => j.id)).toEqual(['old', 'new']);

      component.segmentJobs.set([makeJob({ id: 'old' })]);
      (component as any).upsertSegmentJob(makeJob({ id: 'newp' }), { promote: true });
      expect(component.segmentJobs()[0].id).toBe('newp');
    });

    it('updates an existing job and promotes it to the top', () => {
      component.segmentJobs.set([makeJob({ id: 'a' }), makeJob({ id: 'b' })]);
      (component as any).upsertSegmentJob(makeJob({ id: 'b', status: 'succeeded' }));
      expect(component.segmentJobs().find((j) => j.id === 'b')?.status).toBe('succeeded');

      component.segmentJobs.set([makeJob({ id: 'a' }), makeJob({ id: 'b' })]);
      (component as any).upsertSegmentJob(makeJob({ id: 'b' }), { promote: true });
      expect(component.segmentJobs()[0].id).toBe('b');
    });

    it('caps the list at ten jobs', () => {
      const list = Array.from({ length: 11 }, (_, i) => makeJob({ id: `j${i}` }));
      component.segmentJobs.set(list);
      (component as any).upsertSegmentJob(makeJob({ id: 'extra' }), { promote: true });
      expect(component.segmentJobs().length).toBe(10);
    });
  });

  describe('default bucket seed', () => {
    it('returns a default when either coupon is missing', () => {
      component.selectedCoupon.set(null);
      component.abCouponB.set(null);
      expect((component as any).defaultAbBucketSeed()).toBe('ab-test');
    });

    it('returns a composite seed when both are present', () => {
      component.selectedCoupon.set(makeCoupon({ id: 'a' }));
      component.abCouponB.set(makeCoupon({ id: 'b' }));
      expect((component as any).defaultAbBucketSeed()).toBe('ab:a:b');
    });
  });

  describe('ngOnDestroy', () => {
    it('stops polling timers', () => {
      (component as any).segmentJobPollHandle = 1;
      (component as any).abPollHandle = 2;
      component.ngOnDestroy();
      expect(window.clearInterval).toHaveBeenCalled();
    });
  });

  describe('branch completeness (fallbacks, falsy inputs, structural variants)', () => {
    it('savePromotion uses null id when neither response id nor selection exists', () => {
      component.selectedPromotion.set(null);
      component.promotionForm = (component as any).blankPromotionForm();
      component.promotionForm.name = 'New';
      component.promotionForm.discount_type = 'free_shipping';
      adminCoupons.createPromotion.and.returnValue(of(null as any));
      const reload = spyOn(component, 'loadPromotionsAfterMutation');
      component.savePromotion();
      expect(reload).toHaveBeenCalledWith(null);
    });

    it('reports save/start/assign/revoke errors without a detail (undefined fallback)', () => {
      component.selectedPromotion.set(null);
      component.promotionForm = (component as any).blankPromotionForm();
      component.promotionForm.name = 'N';
      component.promotionForm.discount_type = 'free_shipping';
      adminCoupons.createPromotion.and.returnValue(throwError(() => ({})));
      component.savePromotion();
      expect(toast.error).toHaveBeenCalledWith('adminUi.couponsV2.errors.savePromotion', undefined);

      component.selectedCoupon.set(makeCoupon({ id: 'a' }));
      component.abCouponB.set(makeCoupon({ id: 'b' }));
      component.abBucketSeed = 'seed';
      adminCoupons.startSegmentAssignJob.and.returnValue(throwError(() => ({})));
      component.startAbTest();
      expect(toast.error).toHaveBeenCalledWith('adminUi.couponsV2.ab.startError', undefined);

      component.selectedCoupon.set(null);
      component.couponForm = (component as any).blankCouponForm();
      component.couponForm.promotion_id = 'promo-1';
      component.couponForm.code = 'CODE';
      adminCoupons.createCoupon.and.returnValue(throwError(() => ({})));
      component.saveCoupon();
      expect(toast.error).toHaveBeenCalledWith('adminUi.couponsV2.errors.saveCoupon', undefined);

      component.selectedCoupon.set(makeCoupon());
      component.assignEmail = 'x@y.com';
      adminCoupons.assignCoupon.and.returnValue(throwError(() => ({})));
      component.assign();
      expect(toast.error).toHaveBeenCalledWith('adminUi.couponsV2.errors.assign', undefined);

      component.selectedCoupon.set(makeCoupon());
      component.revokeEmail = 'x@y.com';
      adminCoupons.revokeCoupon.and.returnValue(throwError(() => ({})));
      component.revoke();
      expect(toast.error).toHaveBeenCalledWith('adminUi.couponsV2.errors.revoke', undefined);
    });

    it('reports bulk/segment errors without a detail (undefined fallback)', () => {
      component.selectedCoupon.set(makeCoupon());
      component.bulkEmails = ['a@b.com'];
      adminCoupons.bulkAssignCoupon.and.returnValue(throwError(() => ({})));
      component.bulkAssign();
      expect(toast.error).toHaveBeenCalledWith('adminUi.couponsV2.errors.assign', undefined);

      component.bulkEmails = ['a@b.com'];
      adminCoupons.bulkRevokeCoupon.and.returnValue(throwError(() => ({})));
      component.bulkRevoke();
      expect(toast.error).toHaveBeenCalledWith('adminUi.couponsV2.errors.revoke', undefined);

      adminCoupons.previewSegmentAssign.and.returnValue(of(makeSegmentPreview()));
      adminCoupons.previewSegmentRevoke.and.returnValue(throwError(() => ({})));
      component.segmentPreview();
      expect(toast.error).toHaveBeenCalledWith(
        'adminUi.couponsV2.bulk.segment.previewError',
        undefined,
      );

      adminCoupons.startSegmentAssignJob.and.returnValue(throwError(() => ({})));
      component.segmentAssign();
      expect(toast.error).toHaveBeenCalledWith('adminUi.couponsV2.errors.assign', undefined);

      adminCoupons.startSegmentRevokeJob.and.returnValue(throwError(() => ({})));
      component.segmentRevoke();
      expect(toast.error).toHaveBeenCalledWith('adminUi.couponsV2.errors.revoke', undefined);

      adminCoupons.cancelBulkJob.and.returnValue(throwError(() => ({})));
      component.cancelSegmentJob(makeJob({ id: 'cj', status: 'running' }));
      expect(toast.error).toHaveBeenCalledWith(
        'adminUi.couponsV2.bulk.segment.cancelError',
        undefined,
      );

      component.segmentJob.set(null);
      adminCoupons.retryBulkJob.and.returnValue(throwError(() => ({})));
      component.retrySegmentJob(makeJob({ id: 'old', status: 'failed' }));
      expect(toast.error).toHaveBeenCalledWith(
        'adminUi.couponsV2.bulk.segment.retryError',
        undefined,
      );
    });

    it('selectAbCouponB falls back to null current id when no coupon A is selected', () => {
      component.selectedCoupon.set(null);
      adminCoupons.getAnalytics.and.returnValue(of(makeAnalytics()));
      component.selectAbCouponB(makeCoupon({ id: 'b', code: 'B' }));
      expect(component.abCouponB()?.id).toBe('b');
    });

    it('builds a payload from a blank-name promotion form', () => {
      component.promotionForm = (component as any).blankPromotionForm();
      component.promotionForm.name = '';
      component.promotionForm.discount_type = 'free_shipping';
      const payload = (component as any).promotionPayloadFromForm();
      expect(payload.name).toBe('');
    });

    it('maps a promotion with blank name/description and non-array scope ids', () => {
      const form = (component as any).promotionToForm(
        makePromo({
          name: '',
          description: null,
          included_product_ids: undefined,
          excluded_product_ids: undefined,
          included_category_ids: undefined,
          excluded_category_ids: undefined,
        }),
      );
      expect(form.name).toBe('');
      expect(form.description).toBe('');
      expect(form.excluded_product_ids).toEqual([]);
      expect(form.excluded_category_ids).toEqual([]);
    });

    it('maps a coupon with a populated ends_at into the form', () => {
      const form = (component as any).couponToForm(makeCoupon({ ends_at: '2026-05-01T00:00:00Z' }));
      expect(form.ends_at).not.toBe('');
    });

    it('resolves scoped products when byIds returns a nullish payload', () => {
      component.promotionForm = (component as any).blankPromotionForm();
      component.promotionForm.included_product_ids = ['p9'];
      adminProducts.byIds.and.returnValue(of(null as any));
      (component as any).loadScopedProducts();
      expect(component.scopeProductsLoading()).toBeFalse();
    });

    it('schedules non-overlapping active promotions without conflicts', () => {
      const start = component.promotionCalendarStartDate().getTime();
      component.promotionCalendarDays = 90;
      component.promotions.set([
        makePromo({
          id: 'early',
          name: 'Early',
          starts_at: new Date(start + 1 * 86_400_000).toISOString(),
          ends_at: new Date(start + 5 * 86_400_000).toISOString(),
        }),
        makePromo({
          id: 'late',
          name: 'Late',
          starts_at: new Date(start + 40 * 86_400_000).toISOString(),
          ends_at: new Date(start + 50 * 86_400_000).toISOString(),
        }),
      ]);
      const rows = component.promotionScheduleRows();
      expect(rows.length).toBe(2);
      expect(rows.every((r) => r.conflictCount === 0)).toBeTrue();
    });

    it('parses a nullish CSV payload and skips delimiter-only first cells', () => {
      const empty = (component as any).parseEmailsFromCsv(null);
      expect(empty.emails).toEqual([]);

      const result = (component as any).parseEmailsFromCsv(',leadingcomma\ngood@domain.com\n');
      expect(result.emails).toEqual(['good@domain.com']);
    });
  });
});
