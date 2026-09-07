import { ProductComponent } from './product.component';

/** Golden WU tip orphan — openPreview / closePreview. */
describe('ProductComponent openPreview / closePreview (golden WU)', () => {
  function bare(): ProductComponent {
    return Object.create(ProductComponent.prototype) as ProductComponent;
  }

  it('openPreview sets previewOpen true', () => {
    const cmp = bare();
    (cmp as any).previewOpen = false;
    cmp.openPreview();
    expect((cmp as any).previewOpen).toBe(true);
  });

  it('closePreview sets previewOpen false', () => {
    const cmp = bare();
    (cmp as any).previewOpen = true;
    cmp.closePreview();
    expect((cmp as any).previewOpen).toBe(false);
  });
});
