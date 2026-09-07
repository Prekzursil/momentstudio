import { ProductComponent } from './product.component';

/** Golden WU tip orphan — retryLoad. */
describe('ProductComponent retryLoad (golden WU)', () => {
  it('delegates to load', () => {
    const cmp = Object.create(ProductComponent.prototype) as ProductComponent;
    const load = jasmine.createSpy('load');
    (cmp as any).load = load;
    cmp.retryLoad();
    expect(load).toHaveBeenCalled();
  });
});
