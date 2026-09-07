import { ProductComponent } from './product.component';

describe('ProductComponent openImageManager tip', () => {
  it('exposes openImageManager', () => {
    const c = Object.create(ProductComponent.prototype) as ProductComponent;
    expect(typeof c.openImageManager).toBe('function');
  });
});
