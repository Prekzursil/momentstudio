import { TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule } from '@ngx-translate/core';
import { NEVER, of, throwError } from 'rxjs';

import { AccountCouponsComponent } from './account-coupons.component';
import {
  CouponsService,
  type CouponRead,
  type PromotionRead,
} from '../../core/coupons.service';
import { ToastService } from '../../core/toast.service';

function makePromotion(overrides: Partial<PromotionRead> = {}): PromotionRead {
  return {
    id: 'promo-1',
    name: 'Spring Sale',
    discount_type: 'percent',
    percentage_off: '10',
    allow_on_sale_items: true,
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
    visibility: 'public',
    is_active: true,
    ...overrides,
  };
}

describe('AccountCouponsComponent', () => {
  let couponsService: jasmine.SpyObj<CouponsService>;
  let toast: jasmine.SpyObj<ToastService>;

  beforeEach(() => {
    couponsService = jasmine.createSpyObj<CouponsService>('CouponsService', ['myCoupons']);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'info']);
    couponsService.myCoupons.and.returnValue(of([]));

    TestBed.configureTestingModule({
      imports: [RouterTestingModule, TranslateModule.forRoot(), AccountCouponsComponent],
      providers: [
        { provide: CouponsService, useValue: couponsService },
        { provide: ToastService, useValue: toast },
      ],
    });
  });

  function createComponent() {
    const fixture = TestBed.createComponent(AccountCouponsComponent);
    return { fixture, cmp: fixture.componentInstance };
  }

  describe('ngOnInit', () => {
    it('loads coupons and clears the loading flag', () => {
      const coupons = [makeCoupon()];
      couponsService.myCoupons.and.returnValue(of(coupons));
      const { fixture, cmp } = createComponent();
      fixture.detectChanges();

      expect(cmp['coupons']()).toEqual(coupons);
      expect(cmp['loading']()).toBeFalse();
      expect(cmp['error']()).toBeNull();
    });

    it('falls back to an empty array when the service yields null', () => {
      couponsService.myCoupons.and.returnValue(of(null as unknown as CouponRead[]));
      const { fixture, cmp } = createComponent();
      fixture.detectChanges();

      expect(cmp['coupons']()).toEqual([]);
      expect(cmp['loading']()).toBeFalse();
    });

    it('uses the backend error detail when loading fails', () => {
      couponsService.myCoupons.and.returnValue(
        throwError(() => ({ error: { detail: 'Backend down' } })),
      );
      const { fixture, cmp } = createComponent();
      fixture.detectChanges();

      expect(cmp['error']()).toBe('Backend down');
      expect(cmp['loading']()).toBeFalse();
    });

    it('falls back to a generic error message when no detail is provided', () => {
      couponsService.myCoupons.and.returnValue(throwError(() => ({ error: {} })));
      const { fixture, cmp } = createComponent();
      fixture.detectChanges();

      expect(cmp['error']()).toBe('account.coupons.loadError');
      expect(cmp['loading']()).toBeFalse();
    });
  });

  describe('describeDiscount', () => {
    it('returns the generic coupon label when there is no promotion', () => {
      const { cmp } = createComponent();
      expect(cmp.describeDiscount(makeCoupon({ promotion: null }))).toBe('account.coupons.coupon');
    });

    it('describes free shipping promotions', () => {
      const { cmp } = createComponent();
      const coupon = makeCoupon({
        promotion: makePromotion({ discount_type: 'free_shipping' }),
      });
      expect(cmp.describeDiscount(coupon)).toBe('account.coupons.freeShipping');
    });

    it('describes amount-off promotions using the amount value', () => {
      const { cmp } = createComponent();
      const coupon = makeCoupon({
        promotion: makePromotion({ discount_type: 'amount', amount_off: '25' }),
      });
      expect(cmp.describeDiscount(coupon)).toBe('account.coupons.amountOff');
    });

    it('falls back to 0 for amount-off promotions without an amount', () => {
      const { cmp } = createComponent();
      const coupon = makeCoupon({
        promotion: makePromotion({ discount_type: 'amount', amount_off: null }),
      });
      expect(cmp.describeDiscount(coupon)).toBe('account.coupons.amountOff');
    });

    it('describes percent-off promotions using the percentage value', () => {
      const { cmp } = createComponent();
      const coupon = makeCoupon({
        promotion: makePromotion({ discount_type: 'percent', percentage_off: '15' }),
      });
      expect(cmp.describeDiscount(coupon)).toBe('account.coupons.percentOff');
    });

    it('falls back to 0 for percent-off promotions without a percentage', () => {
      const { cmp } = createComponent();
      const coupon = makeCoupon({
        promotion: makePromotion({ discount_type: 'percent', percentage_off: null }),
      });
      expect(cmp.describeDiscount(coupon)).toBe('account.coupons.percentOff');
    });
  });

  describe('statusLabel', () => {
    it('returns the expired status when the end date is in the past', () => {
      const { cmp } = createComponent();
      const coupon = makeCoupon({ ends_at: '2000-01-01T00:00:00Z' });
      const status = cmp.statusLabel(coupon);
      expect(status?.label).toBe('account.coupons.expired');
      expect(status?.className).toContain('text-slate-700');
    });

    it('returns the inactive status when the coupon is inactive', () => {
      const { cmp } = createComponent();
      const coupon = makeCoupon({ is_active: false, promotion: makePromotion() });
      const status = cmp.statusLabel(coupon);
      expect(status?.label).toBe('account.coupons.inactive');
      expect(status?.className).toContain('text-amber-900');
    });

    it('returns the inactive status when the promotion is inactive', () => {
      const { cmp } = createComponent();
      const coupon = makeCoupon({
        is_active: true,
        promotion: makePromotion({ is_active: false }),
      });
      const status = cmp.statusLabel(coupon);
      expect(status?.label).toBe('account.coupons.inactive');
    });

    it('returns null for an active coupon with no end date', () => {
      const { cmp } = createComponent();
      const coupon = makeCoupon({ is_active: true, promotion: makePromotion() });
      expect(cmp.statusLabel(coupon)).toBeNull();
    });

    it('returns null for an active coupon whose end date is in the future', () => {
      const { cmp } = createComponent();
      const coupon = makeCoupon({
        is_active: true,
        promotion: makePromotion(),
        ends_at: '2999-01-01T00:00:00Z',
      });
      expect(cmp.statusLabel(coupon)).toBeNull();
    });

    it('does not flag an active coupon inactive when there is no promotion', () => {
      const { cmp } = createComponent();
      const coupon = makeCoupon({ is_active: true, promotion: null });
      expect(cmp.statusLabel(coupon)).toBeNull();
    });
  });

  describe('copyCode', () => {
    it('does nothing when the code is empty', async () => {
      const { cmp } = createComponent();
      const writeText = jasmine.createSpy('writeText');
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText },
      });

      await cmp.copyCode('   ');

      expect(writeText).not.toHaveBeenCalled();
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.info).not.toHaveBeenCalled();
    });

    it('does nothing when the code is null', async () => {
      const { cmp } = createComponent();
      const writeText = jasmine.createSpy('writeText');
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText },
      });

      await cmp.copyCode(null as unknown as string);

      expect(writeText).not.toHaveBeenCalled();
    });

    it('copies the normalized code and shows a success toast', async () => {
      const { cmp } = createComponent();
      const writeText = jasmine.createSpy('writeText').and.resolveTo(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText },
      });

      await cmp.copyCode(' save10 ');

      expect(writeText).toHaveBeenCalledWith('SAVE10');
      expect(toast.success).toHaveBeenCalledWith(
        'account.coupons.copiedTitle',
        'account.coupons.copiedCopy',
      );
    });

    it('shows the code via an info toast when clipboard write fails', async () => {
      const { cmp } = createComponent();
      const writeText = jasmine.createSpy('writeText').and.rejectWith(new Error('blocked'));
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText },
      });

      await cmp.copyCode('save10');

      expect(toast.info).toHaveBeenCalledWith('account.coupons.copy', 'SAVE10');
      expect(toast.success).not.toHaveBeenCalled();
    });
  });

  describe('template rendering', () => {
    it('shows skeletons while loading', () => {
      // A never-emitting observable keeps the component in its initial
      // loading state so the skeleton branch renders.
      couponsService.myCoupons.and.returnValue(NEVER);
      const { fixture } = createComponent();
      fixture.detectChanges();

      expect(fixture.componentInstance['loading']()).toBeTrue();
      expect(fixture.nativeElement.querySelectorAll('app-skeleton').length).toBe(3);
    });

    it('shows the error message when loading failed', () => {
      couponsService.myCoupons.and.returnValue(
        throwError(() => ({ error: { detail: 'Oops' } })),
      );
      const { fixture } = createComponent();
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain('Oops');
    });

    it('shows the empty state when there are no coupons', () => {
      couponsService.myCoupons.and.returnValue(of([]));
      const { fixture } = createComponent();
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain('account.coupons.empty');
    });

    it('renders a fully populated coupon card', () => {
      const coupon = makeCoupon({
        code: 'SAVE10',
        ends_at: '2999-01-01T00:00:00Z',
        is_active: false,
        promotion: makePromotion({
          name: 'Spring Sale',
          description: 'Save big this spring',
          min_subtotal: '100',
          allow_on_sale_items: true,
        }),
      });
      couponsService.myCoupons.and.returnValue(of([coupon]));
      const { fixture } = createComponent();
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Spring Sale');
      expect(text).toContain('Save big this spring');
      expect(text).toContain('account.coupons.minSubtotal');
      expect(text).toContain('account.coupons.allowOnSale');
      expect(text).toContain('SAVE10');
      expect(text).toContain('account.coupons.validUntil');
      // inactive coupon yields a status badge
      expect(text).toContain('account.coupons.inactive');
    });

    it('renders the exclude-on-sale label and falls back to a generic name', () => {
      const coupon = makeCoupon({
        code: 'NOSALE',
        is_active: true,
        ends_at: null,
        promotion: makePromotion({
          name: '',
          description: null,
          min_subtotal: null,
          allow_on_sale_items: false,
        }),
      });
      couponsService.myCoupons.and.returnValue(of([coupon]));
      const { fixture } = createComponent();
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('account.coupons.coupon');
      expect(text).toContain('account.coupons.excludeOnSale');
      expect(text).not.toContain('account.coupons.minSubtotal');
    });

    it('renders a coupon without a promotion and without an end date', () => {
      const coupon = makeCoupon({
        code: 'BARE',
        is_active: true,
        ends_at: null,
        promotion: null,
      });
      couponsService.myCoupons.and.returnValue(of([coupon]));
      const { fixture } = createComponent();
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('BARE');
      expect(text).not.toContain('account.coupons.allowOnSale');
      expect(text).not.toContain('account.coupons.excludeOnSale');
      expect(text).not.toContain('account.coupons.validUntil');
    });

    it('invokes copyCode when the copy button emits its action', () => {
      const writeText = jasmine.createSpy('writeText').and.resolveTo(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText },
      });
      const coupon = makeCoupon({ code: 'CLICKME', promotion: makePromotion() });
      couponsService.myCoupons.and.returnValue(of([coupon]));
      const { fixture, cmp } = createComponent();
      const spy = spyOn(cmp, 'copyCode').and.callThrough();
      fixture.detectChanges();

      // The only native <button> inside the card is the copy button (the
      // "use in checkout" action is a routerLink anchor). Clicking it drives
      // ButtonComponent.onClick -> action.emit() -> (action)="copyCode(c.code)".
      const card = fixture.nativeElement.querySelector('.shadow-sm') as HTMLElement;
      const copyButton = card.querySelector('button') as HTMLButtonElement;
      copyButton.click();

      expect(spy).toHaveBeenCalledWith('CLICKME');
      expect(writeText).toHaveBeenCalledWith('CLICKME');
    });
  });
});
