import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { NEVER, of, Subscription, throwError } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { AnalyticsService } from '../../core/analytics.service';
import { CartStore } from '../../core/cart.store';
import { PayPalReturnComponent } from './paypal-return.component';

/**
 * Behavioral specs for PayPalReturnComponent. The component captures a PayPal
 * order on return from the provider redirect, navigates to the success page on
 * a confirmed capture, and renders a translated error (with timeout analytics)
 * on failure. Tests assert real DOM-independent behavior: query-param parsing,
 * capture payloads, success navigation, the timeout/non-timeout error split,
 * retry guards, subscription lifecycle, and the error-message resolution chain.
 */
describe('PayPalReturnComponent', () => {
  interface SetupOptions {
    post?: ReturnType<ApiService['post']>;
  }

  interface Harness {
    component: PayPalReturnComponent;
    api: jasmine.SpyObj<ApiService>;
    router: jasmine.SpyObj<Router>;
    translate: TranslateService;
    cart: jasmine.SpyObj<CartStore>;
    analytics: jasmine.SpyObj<AnalyticsService>;
  }

  function setup(queryParams: Record<string, string>, opts: SetupOptions = {}): Harness {
    const route = {
      snapshot: { queryParamMap: convertToParamMap(queryParams) },
    };

    const api = jasmine.createSpyObj<ApiService>('ApiService', ['post']);
    api.post.and.returnValue(opts.post ?? (of({ order_id: 'order-1', status: 'paid' }) as never));

    const router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    router.navigate.and.returnValue(Promise.resolve(true));

    const cart = jasmine.createSpyObj<CartStore>('CartStore', ['clear']);
    const analytics = jasmine.createSpyObj<AnalyticsService>('AnalyticsService', ['track']);

    // Use the real TranslateModule so the component template's `| translate`
    // pipes (and those of the imported child components) render without error
    // under TestBed auto change-detection. We spy on `instant` — the only
    // TranslateService API the component itself invokes — so error-message
    // assertions stay deterministic.
    TestBed.configureTestingModule({
      imports: [PayPalReturnComponent, TranslateModule.forRoot()],
      providers: [
        { provide: ActivatedRoute, useValue: route },
        { provide: ApiService, useValue: api },
        { provide: Router, useValue: router },
        { provide: CartStore, useValue: cart },
        { provide: AnalyticsService, useValue: analytics },
      ],
    });

    const translate = TestBed.inject(TranslateService);
    spyOn(translate, 'instant').and.callFake(
      (key: string | string[]) => `T:${String(key)}` as never,
    );

    const fixture = TestBed.createComponent(PayPalReturnComponent);
    return {
      component: fixture.componentInstance,
      api,
      router,
      translate,
      cart,
      analytics,
    };
  }

  it('renders the missing-token error and skips capture when no token is present', () => {
    const h = setup({});

    h.component.ngOnInit();

    expect(h.api.post).not.toHaveBeenCalled();
    expect(h.component.loading).toBeFalse();
    expect(h.component.errorMessage).toBe('T:checkout.paypalMissingToken');
    expect(h.translate.instant).toHaveBeenCalledWith('checkout.paypalMissingToken');
  });

  it('captures the payment with a plain payload when no mock flag is supplied', () => {
    const h = setup({ token: 'tok-123' });

    h.component.ngOnInit();

    expect(h.api.post).toHaveBeenCalledOnceWith('/orders/paypal/capture', {
      paypal_order_id: 'tok-123',
    });
    expect(h.cart.clear).toHaveBeenCalledTimes(1);
    expect(h.router.navigate).toHaveBeenCalledOnceWith(['/checkout/success']);
    expect(h.component.loading).toBeFalse();
    expect(h.component.errorMessage).toBe('');
  });

  it('includes the success mock outcome in the capture payload', () => {
    const h = setup({ token: 'tok-s', mock: 'success' });

    h.component.ngOnInit();

    expect(h.api.post).toHaveBeenCalledOnceWith('/orders/paypal/capture', {
      paypal_order_id: 'tok-s',
      mock: 'success',
    });
  });

  it('normalizes an upper-case decline mock outcome to lower case', () => {
    const h = setup({ token: 'tok-d', mock: 'DECLINE' });

    h.component.ngOnInit();

    expect(h.api.post).toHaveBeenCalledOnceWith('/orders/paypal/capture', {
      paypal_order_id: 'tok-d',
      mock: 'decline',
    });
  });

  it('ignores an unrecognized mock value and omits it from the payload', () => {
    const h = setup({ token: 'tok-x', mock: 'bogus' });

    h.component.ngOnInit();

    expect(h.api.post).toHaveBeenCalledOnceWith('/orders/paypal/capture', {
      paypal_order_id: 'tok-x',
    });
  });

  it('shows the timeout message and emits stuck-timeout analytics on a slow capture', fakeAsync(() => {
    const h = setup({ token: 'tok-timeout' }, { post: NEVER as never });

    h.component.ngOnInit();
    expect(h.component.loading).toBeTrue();

    tick(30_001);

    expect(h.component.loading).toBeFalse();
    expect(h.component.errorMessage).toBe('T:checkout.paymentConfirmTimeout');
    expect(h.analytics.track).toHaveBeenCalledTimes(1);
    const [event, payload] = h.analytics.track.calls.mostRecent().args;
    expect(event).toBe('confirm_stuck_timeout');
    expect(payload).toEqual(
      jasmine.objectContaining({
        provider: 'paypal',
        route: 'checkout/paypal/return',
        timeout_ms: 30_000,
      }),
    );
    expect(h.router.navigate).not.toHaveBeenCalled();
    expect(h.cart.clear).not.toHaveBeenCalled();
  }));

  it('resolves a non-timeout capture error into a displayed message', () => {
    const h = setup(
      { token: 'tok-err' },
      { post: throwError(() => ({ error: { detail: 'Card declined' } })) as never },
    );

    h.component.ngOnInit();

    expect(h.component.loading).toBeFalse();
    expect(h.component.errorMessage).toBe('Card declined');
    expect(h.analytics.track).not.toHaveBeenCalled();
    expect(h.router.navigate).not.toHaveBeenCalled();
  });

  describe('retry', () => {
    it('does nothing while a capture is still in flight', fakeAsync(() => {
      const h = setup({ token: 'tok-pending' }, { post: NEVER as never });

      h.component.ngOnInit();
      expect(h.component.loading).toBeTrue();

      h.component.retry();

      expect(h.api.post).toHaveBeenCalledTimes(1);

      h.component.ngOnDestroy();
    }));

    it('does nothing when there is no token to capture', () => {
      const h = setup({});

      h.component.ngOnInit();
      h.api.post.calls.reset();

      h.component.retry();

      expect(h.api.post).not.toHaveBeenCalled();
    });

    it('re-runs the capture after a finished attempt', () => {
      const h = setup({ token: 'tok-retry' });

      h.component.ngOnInit();
      expect(h.api.post).toHaveBeenCalledTimes(1);

      h.component.retry();

      expect(h.api.post).toHaveBeenCalledTimes(2);
    });
  });

  describe('subscription lifecycle', () => {
    it('unsubscribes a pending capture on destroy', fakeAsync(() => {
      const h = setup({ token: 'tok-destroy' }, { post: NEVER as never });

      h.component.ngOnInit();
      const sub = (h.component as unknown as { confirmSubscription: Subscription })
        .confirmSubscription;
      expect(sub).not.toBeNull();
      const unsubscribeSpy = spyOn(sub, 'unsubscribe').and.callThrough();

      h.component.ngOnDestroy();

      expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
      expect(
        (h.component as unknown as { confirmSubscription: Subscription | null })
          .confirmSubscription,
      ).toBeNull();
    }));

    it('is a no-op on destroy when no capture is pending', () => {
      const h = setup({});

      h.component.ngOnInit();

      expect(() => h.component.ngOnDestroy()).not.toThrow();
    });

    it('tears down a prior subscription before starting a new capture', () => {
      const h = setup({ token: 'tok-prior' });
      const stale = new Subscription();
      const unsubscribeSpy = spyOn(stale, 'unsubscribe').and.callThrough();
      const internals = h.component as unknown as {
        token: string;
        confirmSubscription: Subscription | null;
        capturePayment: () => void;
      };
      internals.token = 'tok-prior';
      internals.confirmSubscription = stale;

      internals.capturePayment();

      expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('resolveErrorMessage', () => {
    function resolve(err: unknown, fallbackKey = 'checkout.paypalCaptureFailed'): string {
      const h = setup({});
      const internals = h.component as unknown as {
        resolveErrorMessage: (e: unknown, key: string) => string;
      };
      return internals.resolveErrorMessage(err, fallbackKey);
    }

    it('prefers a trimmed string detail from the error body', () => {
      expect(resolve({ error: { detail: '  Boom detail  ' } })).toBe('Boom detail');
    });

    it('falls back to the error message when the detail is blank', () => {
      expect(resolve({ error: { detail: '   ' }, message: 'Network unreachable' })).toBe(
        'Network unreachable',
      );
    });

    it('ignores a non-string detail and uses the message instead', () => {
      expect(resolve({ error: { detail: 42 }, message: 'Plain error' })).toBe('Plain error');
    });

    it('discards a generic HTTP failure message in favor of the fallback key', () => {
      expect(resolve({ message: 'Http failure response for /x: 500 Server Error' })).toBe(
        'T:checkout.paypalCaptureFailed',
      );
    });

    it('uses the fallback key when the message is blank', () => {
      expect(resolve({ message: '   ' })).toBe('T:checkout.paypalCaptureFailed');
    });

    it('uses the fallback key when the error is null', () => {
      expect(resolve(null)).toBe('T:checkout.paypalCaptureFailed');
    });
  });
});
