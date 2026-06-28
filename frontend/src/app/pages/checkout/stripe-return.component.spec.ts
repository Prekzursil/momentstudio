import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { NEVER, of, throwError } from 'rxjs';

import { StripeReturnComponent } from './stripe-return.component';
import { ApiService } from '../../core/api.service';
import { AnalyticsService } from '../../core/analytics.service';
import { CartStore } from '../../core/cart.store';

/**
 * StripeReturnComponent confirms a Stripe Checkout session when the customer is
 * redirected back from Stripe. These specs assert real behaviour across every
 * branch: query-param parsing (session_id + mock outcome), the confirm request
 * payload, the success navigation, timeout handling with analytics, the
 * error-message resolution ladder, retry guards, and subscription cleanup.
 */
describe('StripeReturnComponent', () => {
  let api: jasmine.SpyObj<ApiService>;
  let router: jasmine.SpyObj<Router>;
  let translate: jasmine.SpyObj<TranslateService>;
  let cart: jasmine.SpyObj<CartStore>;
  let analytics: jasmine.SpyObj<AnalyticsService>;

  function setup(params: Record<string, string>): {
    fixture: ReturnType<typeof TestBed.createComponent<StripeReturnComponent>>;
    cmp: StripeReturnComponent;
  } {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['post']);
    api.post.and.returnValue(of({ order_id: 'o1', reference_code: 'REF', status: 'paid' }));

    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    router.navigate.and.returnValue(Promise.resolve(true));

    translate = jasmine.createSpyObj<TranslateService>('TranslateService', ['instant']);
    translate.instant.and.callFake((key: string | string[]) => `t:${key as string}`);

    cart = jasmine.createSpyObj<CartStore>('CartStore', ['clear']);
    analytics = jasmine.createSpyObj<AnalyticsService>('AnalyticsService', ['track']);

    const activatedRoute = {
      snapshot: { queryParamMap: convertToParamMap(params) },
    } as unknown as ActivatedRoute;

    TestBed.configureTestingModule({
      imports: [StripeReturnComponent],
      providers: [
        { provide: ActivatedRoute, useValue: activatedRoute },
        { provide: ApiService, useValue: api },
        { provide: Router, useValue: router },
        { provide: TranslateService, useValue: translate },
        { provide: CartStore, useValue: cart },
        { provide: AnalyticsService, useValue: analytics },
      ],
    }).overrideComponent(StripeReturnComponent, { set: { template: '', imports: [] } });

    const fixture = TestBed.createComponent(StripeReturnComponent);
    return { fixture, cmp: fixture.componentInstance };
  }

  it('creates', () => {
    const { cmp } = setup({ session_id: 's1' });
    expect(cmp).toBeTruthy();
  });

  it('shows a missing-session error and does not confirm when session_id is absent', () => {
    const { fixture, cmp } = setup({});
    fixture.detectChanges();

    expect(api.post).not.toHaveBeenCalled();
    expect(cmp.loading).toBeFalse();
    expect(cmp.errorMessage).toBe('t:checkout.stripeMissingSession');
  });

  it('confirms a real session, clears the cart, and navigates to success', () => {
    const { fixture, cmp } = setup({ session_id: 's1' });
    fixture.detectChanges();

    expect(api.post).toHaveBeenCalledWith('/orders/stripe/confirm', { session_id: 's1' });
    expect(cart.clear).toHaveBeenCalledTimes(1);
    expect(router.navigate).toHaveBeenCalledWith(['/checkout/success']);
    expect(cmp.loading).toBeFalse();
    expect(cmp.errorMessage).toBe('');
  });

  it('forwards a normalized "success" mock outcome in the confirm payload', () => {
    const { fixture } = setup({ session_id: 's1', mock: 'SUCCESS' });
    fixture.detectChanges();

    expect(api.post).toHaveBeenCalledWith('/orders/stripe/confirm', {
      session_id: 's1',
      mock: 'success',
    });
  });

  it('forwards a "decline" mock outcome in the confirm payload', () => {
    const { fixture } = setup({ session_id: 's1', mock: 'decline' });
    fixture.detectChanges();

    expect(api.post).toHaveBeenCalledWith('/orders/stripe/confirm', {
      session_id: 's1',
      mock: 'decline',
    });
  });

  it('ignores an unrecognized mock outcome', () => {
    const { fixture } = setup({ session_id: 's1', mock: 'maybe' });
    fixture.detectChanges();

    expect(api.post).toHaveBeenCalledWith('/orders/stripe/confirm', { session_id: 's1' });
  });

  it('reports a timeout error and tracks a stuck-confirm analytics event', fakeAsync(() => {
    const { fixture, cmp } = setup({ session_id: 's1' });
    api.post.and.returnValue(NEVER);
    fixture.detectChanges();

    expect(cmp.loading).toBeTrue();
    tick(30_000);

    expect(cmp.loading).toBeFalse();
    expect(cmp.errorMessage).toBe('t:checkout.paymentConfirmTimeout');
    expect(cart.clear).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
    expect(analytics.track).toHaveBeenCalledTimes(1);
    const [event, payload] = analytics.track.calls.mostRecent().args as [
      string,
      Record<string, unknown>,
    ];
    expect(event).toBe('confirm_stuck_timeout');
    expect(payload).toEqual(
      jasmine.objectContaining({
        provider: 'stripe',
        route: 'checkout/stripe/return',
        timeout_ms: 30_000,
      }),
    );
    expect(typeof payload['elapsed_ms']).toBe('number');
  }));

  it('surfaces a trimmed server error detail when present', () => {
    const { fixture, cmp } = setup({ session_id: 's1' });
    api.post.and.returnValue(throwError(() => ({ error: { detail: '  Card declined  ' } })));
    fixture.detectChanges();

    expect(cmp.errorMessage).toBe('Card declined');
    expect(cmp.loading).toBeFalse();
  });

  it('falls back to the error message when there is no detail', () => {
    const { fixture, cmp } = setup({ session_id: 's1' });
    api.post.and.returnValue(throwError(() => ({ message: '  Network unreachable  ' })));
    fixture.detectChanges();

    expect(cmp.errorMessage).toBe('Network unreachable');
  });

  it('ignores a generic HttpClient failure message and uses the fallback key', () => {
    const { fixture, cmp } = setup({ session_id: 's1' });
    api.post.and.returnValue(
      throwError(() => ({ message: 'Http failure response for /x: 500 Server Error' })),
    );
    fixture.detectChanges();

    expect(cmp.errorMessage).toBe('t:checkout.stripeConfirmFailed');
  });

  it('uses the fallback key when the error carries no usable detail or message', () => {
    const { fixture, cmp } = setup({ session_id: 's1' });
    api.post.and.returnValue(throwError(() => ({})));
    fixture.detectChanges();

    expect(cmp.errorMessage).toBe('t:checkout.stripeConfirmFailed');
  });

  it('uses the fallback key when the error is nullish', () => {
    const { fixture, cmp } = setup({ session_id: 's1' });
    api.post.and.returnValue(throwError(() => null));
    fixture.detectChanges();

    expect(cmp.errorMessage).toBe('t:checkout.stripeConfirmFailed');
  });

  it('ignores retry while a confirmation is still loading', () => {
    const { fixture, cmp } = setup({ session_id: 's1' });
    api.post.and.returnValue(NEVER);
    fixture.detectChanges();

    expect(cmp.loading).toBeTrue();
    cmp.retry();

    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('ignores retry when there is no session id', () => {
    const { fixture, cmp } = setup({});
    fixture.detectChanges();

    cmp.retry();

    expect(api.post).not.toHaveBeenCalled();
  });

  it('re-runs the confirmation when retry is invoked after a failure', () => {
    const { fixture, cmp } = setup({ session_id: 's1' });
    api.post.and.returnValue(throwError(() => ({ error: { detail: 'Boom' } })));
    fixture.detectChanges();

    expect(cmp.errorMessage).toBe('Boom');
    expect(cmp.loading).toBeFalse();

    api.post.and.returnValue(of({ order_id: 'o2', status: 'paid' }));
    cmp.retry();

    expect(api.post).toHaveBeenCalledTimes(2);
    expect(cart.clear).toHaveBeenCalledTimes(1);
    expect(router.navigate).toHaveBeenCalledWith(['/checkout/success']);
  });

  it('cancels a still-pending confirmation before starting a new one', () => {
    const { cmp } = setup({ session_id: 's1' });
    api.post.and.returnValue(NEVER);

    const ref = cmp as unknown as {
      confirmPayment: () => void;
      confirmSubscription: { unsubscribe: () => void } | null;
    };
    ref.confirmPayment();
    const pending = ref.confirmSubscription;
    expect(pending).not.toBeNull();
    spyOn(pending as { unsubscribe: () => void }, 'unsubscribe').and.callThrough();

    ref.confirmPayment();

    expect((pending as { unsubscribe: jasmine.Spy }).unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes the active confirmation on destroy', () => {
    const { fixture, cmp } = setup({ session_id: 's1' });
    api.post.and.returnValue(NEVER);
    fixture.detectChanges();

    const ref = cmp as unknown as {
      confirmSubscription: { unsubscribe: () => void } | null;
    };
    const pending = ref.confirmSubscription;
    expect(pending).not.toBeNull();
    spyOn(pending as { unsubscribe: () => void }, 'unsubscribe').and.callThrough();

    cmp.ngOnDestroy();

    expect((pending as { unsubscribe: jasmine.Spy }).unsubscribe).toHaveBeenCalledTimes(1);
    expect(ref.confirmSubscription).toBeNull();
  });

  it('is a no-op on destroy when no confirmation is active', () => {
    const { fixture, cmp } = setup({});
    fixture.detectChanges();

    expect(() => cmp.ngOnDestroy()).not.toThrow();
  });
});
