import { ProductComponent } from './product.component';

describe('ProductComponent toggleWishlist tip2', () => {
  it('exposes toggleWishlist', () => {
    const c = Object.create(ProductComponent.prototype) as ProductComponent;
    expect(typeof c.toggleWishlist).toBe('function');
  });
});
