import { ProductComponent } from './product.component';

/** Golden WU product-close-preview-only — closePreview. */
describe('ProductComponent closePreview (golden WU tip)', () => {
  it('sets previewOpen false', () => {
    const cmp = Object.create(ProductComponent.prototype) as ProductComponent;
    (cmp as any).previewOpen = true;
    cmp.closePreview();
    expect((cmp as any).previewOpen).toBe(false);
  });
});
