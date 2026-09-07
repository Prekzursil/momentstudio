import { ProductComponent } from './product.component';

/** Golden WU tip orphan — showFallbackNavigationLinks. */
describe('ProductComponent showFallbackNavigationLinks (golden WU)', () => {
  function bare(overrides: Record<string, unknown> = {}): ProductComponent {
    const cmp = Object.create(ProductComponent.prototype) as ProductComponent;
    Object.assign(cmp as any, {
      upsellProducts: [],
      relatedProducts: [],
      recentlyViewed: [],
      ...overrides,
    });
    return cmp;
  }

  it('is true only when upsells, related, and recently viewed are empty', () => {
    expect(bare().showFallbackNavigationLinks()).toBe(true);
    expect(bare({ upsellProducts: [{ slug: 'a' }] }).showFallbackNavigationLinks()).toBe(false);
    expect(bare({ relatedProducts: [{ slug: 'b' }] }).showFallbackNavigationLinks()).toBe(false);
    expect(bare({ recentlyViewed: [{ slug: 'c' }] }).showFallbackNavigationLinks()).toBe(false);
  });
});
