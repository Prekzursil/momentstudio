import { AccountCouponsComponent } from './account-coupons.component';

/** Golden WU tip orphan — describeDiscount. */
describe('AccountCouponsComponent describeDiscount (golden WU)', () => {
  function bare(): AccountCouponsComponent {
    const cmp = Object.create(AccountCouponsComponent.prototype) as AccountCouponsComponent;
    Object.assign(cmp as any, {
      translate: {
        instant: (key: string, params?: Record<string, unknown>) =>
          params ? `${key}:${params['value']}` : key,
      },
    });
    return cmp;
  }

  it('maps promotion discount types to labels', () => {
    const cmp = bare();
    expect(cmp.describeDiscount({ promotion: null } as any)).toBe('account.coupons.coupon');
    expect(
      cmp.describeDiscount({ promotion: { discount_type: 'free_shipping' } } as any),
    ).toBe('account.coupons.freeShipping');
    expect(
      cmp.describeDiscount({ promotion: { discount_type: 'percent', percentage_off: '15' } } as any),
    ).toBe('account.coupons.percentOff:15');
  });
});
