import { ProductComponent } from './product.component';

/** Golden WU tip orphan — wishlisted getter. */
describe('ProductComponent wishlisted (golden WU)', () => {
  function bare(overrides: Record<string, unknown> = {}): ProductComponent {
    const cmp = Object.create(ProductComponent.prototype) as ProductComponent;
    Object.assign(cmp as any, {
      product: null,
      wishlist: { isWishlisted: jasmine.createSpy('isWishlisted').and.returnValue(false) },
      ...overrides,
    });
    return cmp;
  }

  it('is false without a product', () => {
    expect(bare().wishlisted).toBe(false);
  });

  it('delegates to wishlist.isWishlisted when product is set', () => {
    const cmp = bare({
      product: { id: 'p1' },
      wishlist: { isWishlisted: jasmine.createSpy('isWishlisted').and.returnValue(true) },
    });
    expect(cmp.wishlisted).toBe(true);
    expect((cmp as any).wishlist.isWishlisted).toHaveBeenCalledWith('p1');
  });
});
