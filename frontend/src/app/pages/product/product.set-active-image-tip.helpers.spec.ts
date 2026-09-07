import { ProductComponent } from './product.component';
describe('ProductComponent setActiveImage tip (golden WU)', () => {
  function bare(): ProductComponent {
    const cmp = Object.create(ProductComponent.prototype) as ProductComponent;
    (cmp as any).activeImageIndex = 0;
    return cmp;
  }
  it('assigns activeImageIndex', () => {
    const cmp = bare();
    cmp.setActiveImage(3);
    expect((cmp as any).activeImageIndex).toBe(3);
  });
});
