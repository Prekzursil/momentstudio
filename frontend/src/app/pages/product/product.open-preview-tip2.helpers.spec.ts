import { ProductComponent } from './product.component';
describe('ProductComponent openPreview tip2 (golden WU)', () => {
  it('sets previewOpen true', () => {
    const cmp = Object.create(ProductComponent.prototype) as ProductComponent;
    (cmp as any).previewOpen = false;
    cmp.openPreview();
    expect((cmp as any).previewOpen).toBe(true);
  });
});
