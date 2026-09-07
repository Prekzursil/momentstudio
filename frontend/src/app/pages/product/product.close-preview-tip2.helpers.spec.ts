import { ProductComponent } from './product.component';
describe('ProductComponent closePreview tip2 (golden WU)', () => {
  it('sets previewOpen false', () => {
    const cmp = Object.create(ProductComponent.prototype) as ProductComponent;
    (cmp as any).previewOpen = true;
    cmp.closePreview();
    expect((cmp as any).previewOpen).toBe(false);
  });
});
