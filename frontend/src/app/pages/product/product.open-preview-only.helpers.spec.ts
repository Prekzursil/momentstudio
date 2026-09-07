import { ProductComponent } from './product.component';

/** Golden WU product-open-preview-only — openPreview. */
describe('ProductComponent openPreview (golden WU tip)', () => {
  it('sets previewOpen true', () => {
    const cmp = Object.create(ProductComponent.prototype) as ProductComponent;
    (cmp as any).previewOpen = false;
    cmp.openPreview();
    expect((cmp as any).previewOpen).toBe(true);
  });
});
