import { ProductComponent } from './product.component';

/** Golden WU tip orphan — activeImage getter. */
describe('ProductComponent activeImage (golden WU)', () => {
  function bare(overrides: Record<string, unknown> = {}): ProductComponent {
    const cmp = Object.create(ProductComponent.prototype) as ProductComponent;
    Object.assign(cmp as any, { activeImageIndex: 0, product: null, ...overrides });
    return cmp;
  }

  it('returns placeholder when product or images missing', () => {
    expect(bare().activeImage).toBe('assets/placeholder/product-placeholder.svg');
    expect(bare({ product: { images: [] } }).activeImage).toBe(
      'assets/placeholder/product-placeholder.svg',
    );
  });

  it('returns indexed image url or first image fallback', () => {
    const images = [{ url: 'a.jpg' }, { url: 'b.jpg' }];
    expect(bare({ product: { images }, activeImageIndex: 1 }).activeImage).toBe('b.jpg');
    expect(bare({ product: { images }, activeImageIndex: 99 }).activeImage).toBe('a.jpg');
  });
});
