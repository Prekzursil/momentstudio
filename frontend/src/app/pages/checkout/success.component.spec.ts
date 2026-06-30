import { TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule } from '@ngx-translate/core';

import { SuccessComponent } from './success.component';
import { CartStore } from '../../core/cart.store';
import { AnalyticsService } from '../../core/analytics.service';

/**
 * SuccessComponent reads the just-completed order from `history.state`
 * (set by the checkout flow during client-side navigation), resyncs the cart,
 * fires a `checkout_success` analytics event, and exposes derived label helpers
 * for the template. These specs assert that real behaviour for every branch.
 */
describe('SuccessComponent', () => {
  let cart: jasmine.SpyObj<CartStore>;
  let analytics: jasmine.SpyObj<AnalyticsService>;

  function setHistoryState(state: unknown): void {
    window.history.replaceState(state, '');
  }

  function create(): SuccessComponent {
    return TestBed.createComponent(SuccessComponent).componentInstance;
  }

  function fullSummary(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      order_id: 'ord-1',
      reference_code: 'REF-1',
      payment_method: 'stripe',
      courier: 'fan_courier',
      delivery_type: 'home',
      locker_name: null,
      locker_address: null,
      totals: {
        subtotal: 100,
        fee: 5,
        tax: 19,
        shipping: 15,
        total: 139,
        currency: 'RON',
        discount: 10,
      },
      items: [
        { name: 'A', slug: 'a', quantity: 2, unit_price: 30, currency: 'RON' },
        { name: 'B', slug: 'b', quantity: 1, unit_price: 40, currency: 'RON' },
      ],
      created_at: '2026-01-01T00:00:00Z',
      ...overrides,
    };
  }

  beforeEach(() => {
    cart = jasmine.createSpyObj<CartStore>('CartStore', ['loadFromBackend']);
    analytics = jasmine.createSpyObj<AnalyticsService>('AnalyticsService', ['track']);

    TestBed.configureTestingModule({
      imports: [SuccessComponent, RouterTestingModule, TranslateModule.forRoot()],
      providers: [
        { provide: CartStore, useValue: cart },
        { provide: AnalyticsService, useValue: analytics },
      ],
    });
  });

  afterEach(() => {
    window.history.replaceState({}, '');
  });

  it('resyncs the cart and skips tracking when no summary is in history state', () => {
    setHistoryState(null);

    const cmp = create();

    expect(cart.loadFromBackend).toHaveBeenCalledTimes(1);
    expect(cmp.summary).toBeNull();
    expect(analytics.track).not.toHaveBeenCalled();
    // With no summary, every derived label helper returns null.
    expect(cmp.courierLabel()).toBeNull();
    expect(cmp.deliveryTypeKey()).toBeNull();
    expect(cmp.lockerLabel()).toBeNull();
  });

  it('ignores a non-object summary value', () => {
    setHistoryState({ checkoutSummary: 'not-an-object' });

    const cmp = create();

    expect(cmp.summary).toBeNull();
    expect(analytics.track).not.toHaveBeenCalled();
  });

  it('ignores a summary that is missing an order_id', () => {
    setHistoryState({ checkoutSummary: { reference_code: 'X' } });

    const cmp = create();

    expect(cmp.summary).toBeNull();
    expect(analytics.track).not.toHaveBeenCalled();
  });

  it('keeps a valid summary and tracks the checkout_success event', () => {
    setHistoryState({ checkoutSummary: fullSummary() });

    const cmp = create();

    expect(cmp.summary).not.toBeNull();
    expect(analytics.track).toHaveBeenCalledTimes(1);
    const [event, payload] = analytics.track.calls.mostRecent().args as [string, Record<string, unknown>];
    expect(event).toBe('checkout_success');
    expect(payload).toEqual(
      jasmine.objectContaining({
        order_id: 'ord-1',
        payment_method: 'stripe',
        courier: 'fan_courier',
        delivery_type: 'home',
        line_items: 2,
        units: 3,
        subtotal: 100,
        discount: 10,
        fee: 5,
        tax: 19,
        shipping: 15,
        total: 139,
        currency: 'RON',
      }),
    );
  });

  it('defaults missing items and totals when tracking', () => {
    setHistoryState({
      checkoutSummary: {
        order_id: 'ord-2',
        payment_method: 'cod',
        courier: null,
        delivery_type: null,
      },
    });

    const cmp = create();

    expect(cmp.summary).not.toBeNull();
    const [, payload] = analytics.track.calls.mostRecent().args as [string, Record<string, unknown>];
    expect(payload['line_items']).toBe(0);
    expect(payload['units']).toBe(0);
    expect(payload['fee']).toBe(0);
    expect(payload['subtotal']).toBeUndefined();
    expect(payload['total']).toBeUndefined();
  });

  it('counts units treating a missing quantity as zero', () => {
    setHistoryState({
      checkoutSummary: fullSummary({
        items: [
          { name: 'A', slug: 'a', quantity: 4, unit_price: 10, currency: 'RON' },
          { name: 'B', slug: 'b', unit_price: 10, currency: 'RON' },
        ],
      }),
    });

    create();

    const [, payload] = analytics.track.calls.mostRecent().args as [string, Record<string, unknown>];
    expect(payload['line_items']).toBe(2);
    expect(payload['units']).toBe(4);
  });

  describe('courierLabel', () => {
    function withCourier(courier: unknown): SuccessComponent {
      setHistoryState({ checkoutSummary: fullSummary({ courier }) });
      return create();
    }

    it('maps the fan_courier code to a display name', () => {
      expect(withCourier('Fan_Courier').courierLabel()).toBe('Fan Courier');
    });

    it('maps the sameday code to a display name', () => {
      expect(withCourier('SAMEDAY').courierLabel()).toBe('Sameday');
    });

    it('trims and passes through an unknown courier name', () => {
      expect(withCourier('  DHL Express  ').courierLabel()).toBe('DHL Express');
    });

    it('returns null for a blank courier', () => {
      expect(withCourier('   ').courierLabel()).toBeNull();
    });

    it('returns null for a null courier', () => {
      expect(withCourier(null).courierLabel()).toBeNull();
    });
  });

  describe('deliveryTypeKey', () => {
    function withDelivery(delivery_type: unknown): SuccessComponent {
      setHistoryState({ checkoutSummary: fullSummary({ delivery_type }) });
      return create();
    }

    it('maps home delivery to its translation key', () => {
      expect(withDelivery('home').deliveryTypeKey()).toBe('checkout.deliveryHome');
    });

    it('maps locker delivery to its translation key', () => {
      expect(withDelivery('locker').deliveryTypeKey()).toBe('checkout.deliveryLocker');
    });

    it('returns null for an unset delivery type', () => {
      expect(withDelivery(null).deliveryTypeKey()).toBeNull();
    });
  });

  describe('lockerLabel', () => {
    function withSummary(overrides: Record<string, unknown>): SuccessComponent {
      setHistoryState({ checkoutSummary: fullSummary(overrides) });
      return create();
    }

    it('returns null when delivery is not to a locker', () => {
      expect(withSummary({ delivery_type: 'home' }).lockerLabel()).toBeNull();
    });

    it('joins the locker name and address when present', () => {
      expect(
        withSummary({
          delivery_type: 'locker',
          locker_name: 'Easybox Central',
          locker_address: 'Str. Exemplu 1',
        }).lockerLabel(),
      ).toBe('Easybox Central — Str. Exemplu 1');
    });

    it('uses only the populated part of the locker detail', () => {
      expect(
        withSummary({
          delivery_type: 'locker',
          locker_name: 'Easybox Central',
          locker_address: '   ',
        }).lockerLabel(),
      ).toBe('Easybox Central');
    });

    it('returns null when both locker parts are blank', () => {
      expect(
        withSummary({
          delivery_type: 'locker',
          locker_name: null,
          locker_address: '   ',
        }).lockerLabel(),
      ).toBeNull();
    });
  });
});
