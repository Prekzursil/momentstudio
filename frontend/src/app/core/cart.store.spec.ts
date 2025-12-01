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
        currency: 'EUR'
      }
    ],
    totals: { subtotal: '20.00', tax: '2.00', shipping: '5.00', total: '27.00', currency: 'EUR' }
  };

  const mockApi = {
    get: () => of(apiResponse),
    sync: () => of(apiResponse)
  } as any;

  it('maps backend cart response to store items', () => {
    const store = new CartStore(mockApi);
    store.loadFromBackend();
    const items = store.items();
    expect(items.length).toBe(1);
    const item = items[0];
    expect(item.name).toBe('Prod');
    expect(item.slug).toBe('prod');
    expect(item.currency).toBe('EUR');
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
        currency: 'USD',
        max_quantity: 5
      })
    );
    const deleteSpy = jasmine.createSpy().and.returnValue(throwError(() => new Error('fail')));
    const api = {
      get: () => of(apiResponse),
      sync: () => of(apiResponse),
      addItem: addSpy,
      deleteItem: deleteSpy
    } as any;

    const store = new CartStore(api);
    store.addFromProduct({ product_id: 'p1', quantity: 1, name: 'Cup', slug: 'cup', stock: 5, currency: 'USD' });
    store.addFromProduct({ product_id: 'p1', quantity: 1, name: 'Cup', slug: 'cup', stock: 5, currency: 'USD' });
    const items = store.items();
    expect(addSpy).toHaveBeenCalled();
    expect(items.length).toBe(1);
    expect(items[0].quantity).toBe(2);

    // delete failure should not drop item
    store.remove(items[0].id);
    expect(deleteSpy).toHaveBeenCalled();
    expect(store.items().length).toBe(1);
  });
});
