import { TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { AccountCouponsComponent } from './account-coupons.component';
import { CouponsService } from '../../core/coupons.service';
import { ToastService } from '../../core/toast.service';

describe('AccountCouponsComponent helpers (golden WU)', () => {
  let translate: jasmine.SpyObj<TranslateService>;

  beforeEach(() => {
    translate = jasmine.createSpyObj<TranslateService>('TranslateService', ['instant']);
    translate.instant.and.callFake((key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
    );

    TestBed.configureTestingModule({
      imports: [RouterTestingModule, AccountCouponsComponent],
      providers: [
        { provide: TranslateService, useValue: translate },
        { provide: CouponsService, useValue: { myCoupons: () => of([]) } },
        {
          provide: ToastService,
          useValue: {
            success: jasmine.createSpy('success'),
            info: jasmine.createSpy('info'),
          },
        },
      ],
    });
  });

  function create() {
    const fixture = TestBed.createComponent(AccountCouponsComponent);
    return { fixture, cmp: fixture.componentInstance };
  }

  it('describeDiscount covers free_shipping, amount, percent, and missing promo', () => {
    const { fixture, cmp } = create();
    expect(cmp.describeDiscount({ id: '1', code: 'X', is_active: true } as any)).toBe(
      'account.coupons.coupon',
    );
    expect(
      cmp.describeDiscount({
        id: '1',
        code: 'X',
        is_active: true,
        promotion: { discount_type: 'free_shipping', is_active: true },
      } as any),
    ).toBe('account.coupons.freeShipping');
    expect(
      cmp.describeDiscount({
        id: '1',
        code: 'X',
        is_active: true,
        promotion: { discount_type: 'amount', amount_off: '12', is_active: true },
      } as any),
    ).toBe('account.coupons.amountOff:{"value":"12"}');
    expect(
      cmp.describeDiscount({
        id: '1',
        code: 'X',
        is_active: true,
        promotion: { discount_type: 'percent', percentage_off: '15', is_active: true },
      } as any),
    ).toBe('account.coupons.percentOff:{"value":"15"}');
    fixture.destroy();
  });

  it('statusLabel marks expired coupons when ends_at is in the past', () => {
    const { fixture, cmp } = create();
    const past = new Date(Date.now() - 60_000).toISOString();
    const status = cmp.statusLabel({
      id: '1',
      code: 'OLD',
      is_active: true,
      ends_at: past,
    } as any);
    expect(status?.label).toBe('account.coupons.expired');
    expect(status?.className).toContain('border-slate-200');
    fixture.destroy();
  });

  it('statusLabel marks inactive coupons and returns null for active live ones', () => {
    const { fixture, cmp } = create();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const inactive = cmp.statusLabel({
      id: '1',
      code: 'OFF',
      is_active: false,
      ends_at: future,
    } as any);
    expect(inactive?.label).toBe('account.coupons.inactive');
    expect(inactive?.className).toContain('border-amber-200');

    const live = cmp.statusLabel({
      id: '2',
      code: 'ON',
      is_active: true,
      ends_at: future,
      promotion: { is_active: true, discount_type: 'percent', percentage_off: '10' },
    } as any);
    expect(live).toBeNull();
    fixture.destroy();
  });
});
