import { CartStore } from './cart.store';
import { of, throwError } from 'rxjs';

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
        currency: 'RON',
      },
    ],
    totals: { subtotal: '20.00', tax: '2.00', shipping: '5.00', total: '27.00', currency: 'RON' },
  };

  const mockApi = {
    get: () => of(apiResponse),
    sync: () => of(apiResponse),
  } as any;

  it('maps backend cart response to store items', () => {
    const store = new CartStore(mockApi);
    store.loadFromBackend();
    const items = store.items();
    expect(items.length).toBe(1);
    const item = items[0];
    expect(item.name).toBe('Prod');
    expect(item.slug).toBe('prod');
    expect(item.currency).toBe('RON');
    expect(item.image).toBe('/media/img.png');
    expect(item.price).toBe(10);
  });

  it('adds and merges items via backend addItem and handles delete errors', () => {
    const addSpy = jasmine.createSpy().and.returnValue(
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
        max_quantity: 5,
      }),
    );
    const deleteSpy = jasmine.createSpy().and.returnValue(throwError(() => new Error('fail')));
    const api = {
      get: () => of(apiResponse),
      sync: () => of(apiResponse),
      addItem: addSpy,
      deleteItem: deleteSpy,
    } as any;

    const store = new CartStore(api);
    store.addFromProduct({
      product_id: 'p1',
      quantity: 1,
      name: 'Cup',
      slug: 'cup',
      stock: 5,
      currency: 'RON',
    });
    store.addFromProduct({
      product_id: 'p1',
      quantity: 1,
      name: 'Cup',
      slug: 'cup',
      stock: 5,
      currency: 'RON',
    });
    const items = store.items();
    expect(addSpy).toHaveBeenCalled();
    expect(items.length).toBe(1);
    expect(items[0].quantity).toBe(2);

    // delete failure should not drop item
    store.remove(items[0].id);
    expect(deleteSpy).toHaveBeenCalled();
    expect(store.items().length).toBe(1);
  });

  function makeApi(overrides: Record<string, unknown> = {}): any {
    return {
      get: () => of(apiResponse),
      sync: () => of(apiResponse),
      addItem: () => of(apiResponse.items[0]),
      deleteItem: () => of(void 0),
      ...overrides,
    };
  }

  it('hydrates directly from a backend payload', () => {
    const store = new CartStore(makeApi());
    store.hydrateFromBackend(apiResponse);
    expect(store.items().length).toBe(1);
    expect(store.quote().total).toBe(27);
    expect(store.count()).toBe(2);
    expect(store.subtotal()).toBe(20);
  });

  it('falls back to cached items when loadFromBackend fails', () => {
    localStorage.setItem(
      'cart_cache',
      JSON.stringify([
        {
          id: 'c1',
          product_id: 'p9',
          name: 'Cached',
          slug: 'c',
          price: 5,
          currency: 'RON',
          quantity: 1,
          stock: 9,
        },
      ]),
    );
    const store = new CartStore(makeApi({ get: () => throwError(() => new Error('down')) }));
    store.loadFromBackend();
    expect(store.items()[0].name).toBe('Cached');
    expect(store.syncing()).toBeFalse();
  });

  it('marks unlimited stock when max_quantity is null and uses fallbacks', () => {
    const store = new CartStore(
      makeApi({
        addItem: () =>
          of({ id: 'l1', product_id: 'p1', variant_id: null, quantity: 1, max_quantity: null }),
      }),
    );
    store.addFromProduct({ product_id: 'p1', quantity: 1 });
    expect(store.items()[0].stock).toBe(9999);
    expect(store.items()[0].currency).toBe('RON');
    expect(store.items()[0].name).toBe('');
  });

  it('keeps local state when addFromProduct fails', () => {
    const store = new CartStore(makeApi({ addItem: () => throwError(() => new Error('x')) }));
    store.addFromProduct({ product_id: 'p1', quantity: 1 });
    expect(store.items().length).toBe(0);
  });

  it('syncs the backend and updates totals', () => {
    const syncSpy = jasmine.createSpy('sync').and.returnValue(of(apiResponse));
    const store = new CartStore(makeApi({ sync: syncSpy }));
    store.syncBackend();
    expect(syncSpy).toHaveBeenCalled();
    expect(store.quote().total).toBe(27);
  });

  it('keeps local state when syncBackend fails', () => {
    const store = new CartStore(makeApi({ sync: () => throwError(() => new Error('x')) }));
    store.hydrateFromBackend(apiResponse);
    store.syncBackend();
    expect(store.items().length).toBe(1);
    expect(store.syncing()).toBeFalse();
  });

  it('validates updateQuantity', () => {
    const store = new CartStore(makeApi());
    store.hydrateFromBackend(apiResponse);
    const id = store.items()[0].id;
    expect(store.updateQuantity('missing', 2).errorKey).toBe('cart.errors.notFound');
    expect(store.updateQuantity(id, 0).errorKey).toBe('cart.errors.minQty');
    expect(store.updateQuantity(id, 9999).errorKey).toBe('cart.errors.insufficientStock');
    expect(store.updateQuantity(id, 3).errorKey).toBeUndefined();
    expect(store.items()[0].quantity).toBe(3);
  });

  it('debounces the sync triggered by updateQuantity', (done) => {
    const syncSpy = jasmine.createSpy('sync').and.returnValue(of(apiResponse));
    const store = new CartStore(makeApi({ sync: syncSpy }));
    store.hydrateFromBackend(apiResponse);
    const id = store.items()[0].id;
    store.updateQuantity(id, 2);
    store.updateQuantity(id, 3); // clears the first timer
    setTimeout(() => {
      expect(syncSpy).toHaveBeenCalledTimes(1);
      done();
    }, 500);
  });

  it('removes an item on backend success and re-syncs', () => {
    const onSuccess = jasmine.createSpy('onSuccess');
    const emptyResponse = { items: [], totals: { currency: 'RON' } };
    const store = new CartStore(makeApi({ sync: () => of(emptyResponse) }));
    store.hydrateFromBackend(apiResponse);
    const id = store.items()[0].id;
    store.remove(id, { onSuccess });
    expect(store.items().length).toBe(0);
    expect(onSuccess).toHaveBeenCalled();
  });

  it('ignores remove for an unknown id', () => {
    const deleteSpy = jasmine.createSpy('deleteItem');
    const store = new CartStore(makeApi({ deleteItem: deleteSpy }));
    store.remove('nope');
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('clears the cart', () => {
    const emptyResponse = { items: [], totals: { currency: 'RON' } };
    const store = new CartStore(makeApi({ sync: () => of(emptyResponse) }));
    store.hydrateFromBackend(apiResponse);
    store.clear();
    expect(store.items()).toEqual([]);
  });

  it('seeds items', () => {
    const store = new CartStore(makeApi({ sync: () => throwError(() => new Error('skip')) }));
    store.seed([
      {
        id: 's1',
        product_id: 'p1',
        name: 'S',
        slug: 's',
        price: 3,
        currency: 'RON',
        quantity: 1,
        stock: 9,
      },
    ]);
    expect(store.items()[0].id).toBe('s1');
  });

  it('builds a null free-shipping threshold and reads currency from items', () => {
    const store = new CartStore(makeApi());
    store.hydrateFromBackend({ items: [], totals: { currency: 'EUR' } });
    expect(store.quote().freeShippingThresholdRon).toBeNull();
    expect(store.quote().currency).toBe('EUR');
  });

  it('reads a numeric free-shipping threshold', () => {
    const store = new CartStore(makeApi());
    store.hydrateFromBackend({
      items: [],
      totals: { currency: 'RON', free_shipping_threshold_ron: '200' },
    });
    expect(store.quote().freeShippingThresholdRon).toBe(200);
  });

  it('recovers from a corrupt cached payload', () => {
    localStorage.setItem('cart_cache', '{not json');
    const store = new CartStore(makeApi());
    expect(store.items()).toEqual([]);
  });

  it('applies field fallbacks when mapping a sparse backend response', () => {
    const sparse = {
      items: [{ id: 'x', product_id: 'p', quantity: 1, unit_price_at_add: '4', max_quantity: 3 }],
      totals: {},
    };
    const store = new CartStore(makeApi({ get: () => of(sparse) }));
    store.loadFromBackend();
    const item = store.items()[0];
    expect(item.name).toBe('');
    expect(item.slug).toBe('');
    expect(item.currency).toBe('RON');
    expect(item.stock).toBe(3);
    expect(item.image).toBe('');
  });

  it('defaults an empty currency string to RON in the quote', () => {
    const store = new CartStore(makeApi());
    store.hydrateFromBackend({ items: [], totals: { currency: '' } });
    expect(store.quote().currency).toBe('RON');
  });

  it('marks unlimited stock from the backend when max_quantity is missing', () => {
    const store = new CartStore(
      makeApi({
        get: () =>
          of({
            items: [{ id: 'u', product_id: 'p', quantity: 1, unit_price_at_add: '1' }],
            totals: {},
          }),
      }),
    );
    store.loadFromBackend();
    expect(store.items()[0].stock).toBe(9999);
  });

  it('builds default totals when the response has no totals', () => {
    const store = new CartStore(makeApi());
    store.hydrateFromBackend({ items: [], totals: undefined } as unknown as {
      items: unknown[];
      totals: unknown;
    });
    expect(store.quote().currency).toBe('RON');
    expect(store.quote().total).toBe(0);
  });

  it('uses the explicit max_quantity from addItem when present', () => {
    const store = new CartStore(
      makeApi({
        addItem: () =>
          of({ id: 'l1', product_id: 'p1', variant_id: null, quantity: 1, max_quantity: 7 }),
      }),
    );
    store.addFromProduct({ product_id: 'p1', quantity: 1 });
    expect(store.items()[0].stock).toBe(7);
  });

  it('keeps unrelated items unchanged when merging a duplicate', () => {
    const store = new CartStore(
      makeApi({
        addItem: (body: { product_id: string }) =>
          of({
            id: `line-${body.product_id}`,
            product_id: body.product_id,
            variant_id: null,
            quantity: 1,
            unit_price_at_add: '5',
            max_quantity: 9,
          }),
      }),
    );
    store.addFromProduct({ product_id: 'p1', quantity: 1 });
    store.addFromProduct({ product_id: 'p2', quantity: 1 });
    store.addFromProduct({ product_id: 'p1', quantity: 1 });
    expect(store.items().length).toBe(2);
    expect(store.items().find((i) => i.product_id === 'p1')?.quantity).toBe(2);
    expect(store.items().find((i) => i.product_id === 'p2')?.quantity).toBe(1);
  });
});
