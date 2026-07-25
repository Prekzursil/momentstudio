import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { Observable, of, throwError } from 'rxjs';

import { NetopiaReturnComponent } from './netopia-return.component';
import { ApiService } from '../../core/api.service';
import { AnalyticsService } from '../../core/analytics.service';
import { CartStore } from '../../core/cart.store';

/**
 * Behavioral specs for NetopiaReturnComponent.
 *
 * The component confirms a Netopia payment on init, clears the cart and
 * navigates to the success page on success, and renders translated error
 * messages (including a dedicated timeout path that emits an analytics event)
 * on failure. These specs drive the real component logic: query-param parsing,
 * the confirm request lifecycle, the retry guard, and the error-message
 * resolution precedence — every assertion checks observable behavior.
 */
describe('NetopiaReturnComponent', () => {
  let api: jasmine.SpyObj<ApiService>;
  let cart: jasmine.SpyObj<CartStore>;
  let analytics: jasmine.SpyObj<AnalyticsService>;
  let router: jasmine.SpyObj<Router>;
  let translate: { instant: jasmine.Spy };

  /** Builds the component with a configurable query-param map. */
  function build(params: Record<string, string>): NetopiaReturnComponent {
    const queryParamMap = convertToParamMap(params);

    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        { provide: CartStore, useValue: cart },
        { provide: AnalyticsService, useValue: analytics },
        { provide: Router, useValue: router },
        { provide: TranslateService, useValue: translate },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap } },
        },
      ],
    }).overrideComponent(NetopiaReturnComponent, {
      set: { template: '', imports: [] },
    });

    return TestBed.createComponent(NetopiaReturnComponent).componentInstance;
  }

  beforeEach(() => {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['post']);
    api.post.and.returnValue(of({ order_id: 'order1', status: 'confirmed' }));

    cart = jasmine.createSpyObj<CartStore>('CartStore', ['clear']);

    analytics = jasmine.createSpyObj<AnalyticsService>('AnalyticsService', ['track']);

    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    router.navigate.and.returnValue(Promise.resolve(true));

    translate = { instant: jasmine.createSpy('instant').and.callFake((key: string) => `T:${key}`) };
  });

  it('creates', () => {
    const cmp = build({ order_id: 'order1' });
    expect(cmp).toBeTruthy();
  });

  describe('ngOnInit', () => {
    it('shows a missing-order error and does not call the API when order_id is absent', () => {
      const cmp = build({});
      cmp.ngOnInit();

      expect(cmp.loading).toBeFalse();
      expect(cmp.errorMessage).toBe('T:checkout.netopiaMissingOrder');
      expect(translate.instant).toHaveBeenCalledWith('checkout.netopiaMissingOrder');
      expect(api.post).not.toHaveBeenCalled();
    });

    it('confirms the payment, clears the cart and navigates on success', () => {
      const cmp = build({ order_id: 'order1', ntp_id: 'NTP-1' });
      cmp.ngOnInit();

      expect(api.post).toHaveBeenCalledWith('/orders/netopia/confirm', {
        order_id: 'order1',
        ntp_id: 'NTP-1',
      });
      expect(cart.clear).toHaveBeenCalledTimes(1);
      expect(router.navigate).toHaveBeenCalledWith(['/checkout/success']);
      // finalize() must have flipped loading back off.
      expect(cmp.loading).toBeFalse();
      expect(cmp.errorMessage).toBe('');
    });

    it('omits ntp_id from the payload when no Netopia id query param is present', () => {
      const cmp = build({ order_id: 'order1' });
      cmp.ngOnInit();

      expect(api.post).toHaveBeenCalledWith('/orders/netopia/confirm', { order_id: 'order1' });
    });

    it('reads the Netopia id from the ntpID query param alias', () => {
      const cmp = build({ order_id: 'order1', ntpID: 'NTP-ALIAS' });
      cmp.ngOnInit();

      expect(api.post).toHaveBeenCalledWith('/orders/netopia/confirm', {
        order_id: 'order1',
        ntp_id: 'NTP-ALIAS',
      });
    });

    it('reads the Netopia id from the ntpId query param alias', () => {
      const cmp = build({ order_id: 'order1', ntpId: 'NTP-CAMEL' });
      cmp.ngOnInit();

      expect(api.post).toHaveBeenCalledWith('/orders/netopia/confirm', {
        order_id: 'order1',
        ntp_id: 'NTP-CAMEL',
      });
    });
  });

  describe('confirmPayment error handling', () => {
    it('shows a timeout message and tracks a stuck-timeout event when the request times out', fakeAsync(() => {
      // An observable that never emits forces the rxjs timeout operator to fire.
      api.post.and.returnValue(new Observable(() => undefined));
      const cmp = build({ order_id: 'order1' });
      cmp.ngOnInit();

      expect(cmp.loading).toBeTrue();
      tick(30_000);

      expect(cmp.loading).toBeFalse();
      expect(cmp.errorMessage).toBe('T:checkout.paymentConfirmTimeout');
      expect(analytics.track).toHaveBeenCalledTimes(1);
      const [event, payload] = analytics.track.calls.mostRecent().args as [
        string,
        Record<string, unknown>,
      ];
      expect(event).toBe('confirm_stuck_timeout');
      expect(payload).toEqual(
        jasmine.objectContaining({
          provider: 'netopia',
          route: 'checkout/netopia/return',
          timeout_ms: 30_000,
        }),
      );
      expect(cart.clear).not.toHaveBeenCalled();
      expect(router.navigate).not.toHaveBeenCalled();
    }));

    it('prefers the server-provided error detail (trimmed)', () => {
      api.post.and.returnValue(throwError(() => ({ error: { detail: '  Order already paid  ' } })));
      const cmp = build({ order_id: 'order1' });
      cmp.ngOnInit();

      expect(cmp.errorMessage).toBe('Order already paid');
      expect(analytics.track).not.toHaveBeenCalled();
    });

    it('falls back to the error message when no detail is provided', () => {
      api.post.and.returnValue(throwError(() => ({ message: 'Network unreachable' })));
      const cmp = build({ order_id: 'order1' });
      cmp.ngOnInit();

      expect(cmp.errorMessage).toBe('Network unreachable');
    });

    it('ignores generic "Http failure response" messages and uses the fallback key', () => {
      api.post.and.returnValue(
        throwError(() => ({ message: 'Http failure response for /orders: 500 Server Error' })),
      );
      const cmp = build({ order_id: 'order1' });
      cmp.ngOnInit();

      expect(cmp.errorMessage).toBe('T:checkout.netopiaConfirmFailed');
    });

    it('uses the fallback key when neither detail nor message is present', () => {
      api.post.and.returnValue(throwError(() => ({})));
      const cmp = build({ order_id: 'order1' });
      cmp.ngOnInit();

      expect(cmp.errorMessage).toBe('T:checkout.netopiaConfirmFailed');
      expect(translate.instant).toHaveBeenCalledWith('checkout.netopiaConfirmFailed');
    });
  });

  describe('retry', () => {
    it('does nothing while a confirmation is still loading', () => {
      // A never-emitting request keeps the component in the loading state.
      api.post.and.returnValue(new Observable(() => undefined));
      const cmp = build({ order_id: 'order1' });
      cmp.ngOnInit();
      expect(api.post).toHaveBeenCalledTimes(1);
      expect(cmp.loading).toBeTrue();

      cmp.retry();

      expect(api.post).toHaveBeenCalledTimes(1);
    });

    it('does nothing when there is no order id', () => {
      const cmp = build({});
      cmp.ngOnInit();
      expect(api.post).not.toHaveBeenCalled();

      cmp.retry();

      expect(api.post).not.toHaveBeenCalled();
    });

    it('re-issues the confirmation request after a previous failure', () => {
      api.post.and.returnValue(throwError(() => ({})));
      const cmp = build({ order_id: 'order1' });
      cmp.ngOnInit();
      expect(api.post).toHaveBeenCalledTimes(1);
      expect(cmp.loading).toBeFalse();

      api.post.and.returnValue(of({ order_id: 'order1', status: 'confirmed' }));
      cmp.retry();

      expect(api.post).toHaveBeenCalledTimes(2);
      expect(cart.clear).toHaveBeenCalledTimes(1);
      expect(router.navigate).toHaveBeenCalledWith(['/checkout/success']);
    });
  });

  describe('ngOnDestroy', () => {
    it('unsubscribes from an in-flight confirmation', () => {
      let teardown = false;
      api.post.and.returnValue(new Observable(() => () => (teardown = true)));
      const cmp = build({ order_id: 'order1' });
      cmp.ngOnInit();

      cmp.ngOnDestroy();

      expect(teardown).toBeTrue();
    });

    it('is a no-op when there is no active subscription', () => {
      const cmp = build({});
      cmp.ngOnInit();

      expect(() => cmp.ngOnDestroy()).not.toThrow();
    });
  });
});
