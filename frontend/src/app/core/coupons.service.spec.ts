import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { ApiService } from './api.service';
import { CartApi } from './cart.api';
import {
  CouponEligibilityResponse,
  CouponOffer,
  CouponRead,
  CouponsService,
} from './coupons.service';

describe('CouponsService', () => {
  let service: CouponsService;
  let api: jasmine.SpyObj<ApiService>;
  let cartApi: jasmine.SpyObj<CartApi>;

  beforeEach(() => {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['get', 'post']);
    cartApi = jasmine.createSpyObj<CartApi>('CartApi', ['headers']);
    cartApi.headers.and.returnValue({ 'X-Cart': 'token' });
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        { provide: CartApi, useValue: cartApi },
        CouponsService,
      ],
    });
    service = TestBed.inject(CouponsService);
  });

  it('fetches eligibility without a shipping method', () => {
    const response = { eligible: [], ineligible: [] } as CouponEligibilityResponse;
    api.get.and.returnValue(of(response));

    let result: CouponEligibilityResponse | undefined;
    service.eligibility().subscribe((res) => (result = res));

    expect(api.get).toHaveBeenCalledWith('/coupons/eligibility', undefined, { 'X-Cart': 'token' });
    expect(result).toBe(response);
  });

  it('fetches eligibility with a shipping method', () => {
    api.get.and.returnValue(of({ eligible: [], ineligible: [] }));

    service.eligibility('ship-1').subscribe();

    expect(api.get).toHaveBeenCalledWith(
      '/coupons/eligibility',
      { shipping_method_id: 'ship-1' },
      { 'X-Cart': 'token' },
    );
  });

  it('validates a code without a shipping method', () => {
    const offer = { eligible: true } as CouponOffer;
    api.post.and.returnValue(of(offer));

    let result: CouponOffer | undefined;
    service.validate('SAVE10').subscribe((res) => (result = res));

    expect(api.post).toHaveBeenCalledWith(
      '/coupons/validate',
      { code: 'SAVE10' },
      { 'X-Cart': 'token' },
      undefined,
    );
    expect(result).toBe(offer);
  });

  it('validates a code with a shipping method', () => {
    api.post.and.returnValue(of({ eligible: true } as CouponOffer));

    service.validate('SAVE10', 'ship-2').subscribe();

    expect(api.post).toHaveBeenCalledWith(
      '/coupons/validate',
      { code: 'SAVE10' },
      { 'X-Cart': 'token' },
      { shipping_method_id: 'ship-2' },
    );
  });

  it('lists the current user coupons', () => {
    const coupons = [{ id: 'c1' } as CouponRead];
    api.get.and.returnValue(of(coupons));

    let result: CouponRead[] | undefined;
    service.myCoupons().subscribe((res) => (result = res));

    expect(api.get).toHaveBeenCalledWith('/coupons/me');
    expect(result).toBe(coupons);
  });
});
