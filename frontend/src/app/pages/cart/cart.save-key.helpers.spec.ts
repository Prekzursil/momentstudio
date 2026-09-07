import { CartComponent } from './cart.component';

/** Golden WU tip orphan — saveKey. */
describe('CartComponent saveKey (golden WU)', () => {
  function bare(): CartComponent {
    return Object.create(CartComponent.prototype) as CartComponent;
  }

  it('joins product_id and variant_id with ::', () => {
    expect(bare().saveKey({ product_id: 'p1', variant_id: 'v1' } as any)).toBe(
      'p1::v1',
    );
    expect(bare().saveKey({ product_id: 'p1', variant_id: '' } as any)).toBe('p1::');
    expect(bare().saveKey({ product_id: 'p2' } as any)).toBe('p2::');
  });
});
