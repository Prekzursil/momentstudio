import { CartStore } from './cart.store';
import { of } from 'rxjs';

describe('CartStore', () => {
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
});
