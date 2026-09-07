import { ProductComponent } from './product.component';

/** Golden WU product-open-image-manager-gate — openImageManager. */
describe('ProductComponent openImageManager gate (golden WU tip)', () => {
  it('opens only when showStorefrontEdit is true', () => {
    const cmp = Object.create(ProductComponent.prototype) as ProductComponent;
    (cmp as any).imageManagerOpen = false;
    (cmp as any).showStorefrontEdit = () => false;
    cmp.openImageManager();
    expect((cmp as any).imageManagerOpen).toBe(false);
    (cmp as any).showStorefrontEdit = () => true;
    cmp.openImageManager();
    expect((cmp as any).imageManagerOpen).toBe(true);
  });
});
