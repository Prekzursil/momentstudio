import { ProductComponent } from './product.component';

/** Golden WU product-select-image — setActiveImage. */
describe('ProductComponent setActiveImage (golden WU tip)', () => {
  it('updates activeImageIndex', () => {
    const cmp = Object.create(ProductComponent.prototype) as ProductComponent;
    (cmp as any).activeImageIndex = 0;
    cmp.setActiveImage(3);
    expect((cmp as any).activeImageIndex).toBe(3);
    cmp.setActiveImage(0);
    expect((cmp as any).activeImageIndex).toBe(0);
  });
});
