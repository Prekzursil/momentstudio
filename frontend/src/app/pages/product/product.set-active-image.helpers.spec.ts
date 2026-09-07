import { ProductComponent } from './product.component';

/** Golden WU product-gallery-index-clamp — gallery index + preview arms. */
describe('ProductComponent gallery helpers (golden WU)', () => {
  function createCmp() {
    return Object.create(ProductComponent.prototype) as ProductComponent;
  }

  it('setActiveImage updates activeImageIndex', () => {
    const cmp = createCmp();
    cmp.activeImageIndex = 0;
    cmp.setActiveImage(3);
    expect(cmp.activeImageIndex).toBe(3);
  });

  it('openPreview sets previewOpen true', () => {
    const cmp = createCmp();
    cmp.previewOpen = false;
    cmp.openPreview();
    expect(cmp.previewOpen).toBeTrue();
  });
});
