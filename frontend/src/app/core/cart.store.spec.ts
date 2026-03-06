import { fakeAsync, tick } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { CartStore } from './cart.store';

describe('CartStore', () => {
  beforeEach(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('cart_cache');
    }
  });

  const apiResponse = {
    items: [
      {
        id: '1',
        product_id: 'p1',
        variant_id: null,
        quantity: 2,
        max_quantity: 5,
        unit_price_at_add: '10.00',
        name: 'Prod',
        slug: 'prod',
        image_url: '/media/img.png',
        currency: 'RON'
      }
    ],
    totals: {
      subtotal: '20.00',
      fee: '0.00',
      tax: '2.00',
      shipping: '5.00',
      total: '27.00',
      currency: 'RON',
      free_shipping_threshold_ron: '200.00'
    }
  };

  function createApi(overrides: Partial<any> = {}) {
    return {
      get: jasmine.createSpy('get').and.returnValue(of(apiResponse)),
      sync: jasmine.createSpy('sync').and.returnValue(of(apiResponse)),
      addItem: jasmine.createSpy('addItem').and.returnValue(of(apiResponse.items[0])),
      deleteItem: jasmine.createSpy('deleteItem').and.returnValue(of({ ok: true })),
      ...overrides
    } as any;
  }

  it('maps backend cart response and quote fields from API', () => {
    const store = new CartStore(createApi());
    store.loadFromBackend();

    const items = store.items();
    expect(items.length).toBe(1);
    expect(items[0].name).toBe('Prod');
    expect(items[0].slug).toBe('prod');
    expect(items[0].currency).toBe('RON');
    expect(items[0].image).toBe('/media/img.png');
    expect(items[0].price).toBe(10);

    expect(store.quote().currency).toBe('RON');
    expect(store.quote().freeShippingThresholdRon).toBe(200);
  });

  it('hydrates from backend and persists cart data', () => {
    const store = new CartStore(createApi());
    store.hydrateFromBackend(apiResponse as any);

    expect(store.items().length).toBe(1);
    const raw = localStorage.getItem('cart_cache');
    expect(raw).toContain('"product_id":"p1"');
  });

  it('falls back to cached cart when backend load fails', () => {
    localStorage.setItem(
      'cart_cache',
      JSON.stringify([
        {
          id: 'cached-1',
          product_id: 'cached-p1',
          variant_id: null,
          name: 'Cached',
          slug: 'cached',
          price: 22,
          currency: 'RON',
          quantity: 1,
          stock: 3,
          image: ''
        }
      ])
    );

    const api = createApi({ get: jasmine.createSpy('get').and.returnValue(throwError(() => new Error('offline'))) });
    const store = new CartStore(api);
    store.loadFromBackend();

    expect(store.items().length).toBe(1);
    expect(store.items()[0].product_id).toBe('cached-p1');
    expect(store.syncing()).toBeFalse();
  });

  it('adds and merges items and keeps state on add errors', () => {
    const addSpy = jasmine
      .createSpy('addItem')
      .and.returnValues(
        of({
          id: 'line-1',
          product_id: 'p1',
          variant_id: null,
          quantity: 1,
          unit_price_at_add: '12.00',
          name: 'Cup',
          slug: 'cup',
          image_url: '/img.png',
          currency: 'RON',
          max_quantity: 5
        }),
        of({
          id: 'line-1',
          product_id: 'p1',
          variant_id: null,
          quantity: 1,
          unit_price_at_add: '12.00',
          name: 'Cup',
          slug: 'cup',
          image_url: '/img.png',
          currency: 'RON',
          max_quantity: 5
        }),
        throwError(() => new Error('add failed'))
      );

    const store = new CartStore(createApi({ addItem: addSpy }));
    store.addFromProduct({ product_id: 'p1', quantity: 1, name: 'Cup', slug: 'cup', stock: 5, currency: 'RON' });
    store.addFromProduct({ product_id: 'p1', quantity: 1, name: 'Cup', slug: 'cup', stock: 5, currency: 'RON' });

    expect(store.items().length).toBe(1);
    expect(store.items()[0].quantity).toBe(2);

    store.addFromProduct({ product_id: 'p1', quantity: 1 });
    expect(store.items()[0].quantity).toBe(2);
  });

  it('validates updateQuantity boundaries and schedules sync when valid', fakeAsync(() => {
    const syncSpy = jasmine.createSpy('sync').and.returnValue(of(apiResponse));
    const store = new CartStore(createApi({ sync: syncSpy }));
    store.hydrateFromBackend(apiResponse as any);

    expect(store.updateQuantity('missing', 1).errorKey).toBe('cart.errors.notFound');
    expect(store.updateQuantity('1', 0).errorKey).toBe('cart.errors.minQty');
    expect(store.updateQuantity('1', 99).errorKey).toBe('cart.errors.insufficientStock');

    expect(store.updateQuantity('1', 3).errorKey).toBeUndefined();
    tick(360);
    expect(syncSpy).toHaveBeenCalled();
    expect(store.items()[0].quantity).toBe(2);
  }));

  it('removes line items on backend success and calls handlers', () => {
    const onSuccess = jasmine.createSpy('onSuccess');
    const onError = jasmine.createSpy('onError');
    const emptyResponse = {
      items: [],
      totals: { subtotal: '0.00', fee: '0.00', tax: '0.00', shipping: '0.00', total: '0.00', currency: 'RON' }
    };
    const syncSpy = jasmine.createSpy('sync').and.returnValue(of(emptyResponse));
    const store = new CartStore(createApi({ sync: syncSpy }));
    store.hydrateFromBackend(apiResponse as any);

    store.remove('1', { onSuccess, onError });

    expect(onSuccess).toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(store.items().length).toBe(0);
    expect(syncSpy).toHaveBeenCalled();
  });

  it('keeps state when remove fails and calls error handler', () => {
    const deleteSpy = jasmine.createSpy('deleteItem').and.returnValue(throwError(() => new Error('fail')));
    const onError = jasmine.createSpy('onError');
    const store = new CartStore(createApi({ deleteItem: deleteSpy }));
    store.hydrateFromBackend(apiResponse as any);

    store.remove('1', { onError });

    expect(store.items().length).toBe(1);
    expect(onError).toHaveBeenCalled();
  });

  it('clear and seed update local state and trigger sync', () => {
    const emptyResponse = {
      items: [],
      totals: { subtotal: '0.00', fee: '0.00', tax: '0.00', shipping: '0.00', total: '0.00', currency: 'RON' }
    };
    const syncSpy = jasmine.createSpy('sync').and.returnValue(of(emptyResponse));
    const store = new CartStore(createApi({ sync: syncSpy }));

    store.seed([
      {
        id: 'seed-1',
        product_id: 'seed-p1',
        variant_id: null,
        name: 'Seed',
        slug: 'seed',
        price: 11,
        currency: 'RON',
        quantity: 2,
        stock: 10,
        image: ''
      }
    ]);
    expect(store.items().length).toBe(0);

    store.clear();
    expect(store.items().length).toBe(0);
    expect(syncSpy).toHaveBeenCalledTimes(2);
  });

  it('returns empty cache safely when localStorage payload is invalid JSON', () => {
    localStorage.setItem('cart_cache', '{broken-json');
    const store = new CartStore(createApi());

    expect(store.items()).toEqual([]);
  });
});
