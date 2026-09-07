import { ProductComponent } from './product.component';

/** Golden WU product-duplicate-storefront-gate — early returns. */
describe('ProductComponent duplicateFromStorefront gates (golden WU tip)', () => {
  function bare(overrides: Record<string, unknown> = {}): ProductComponent {
    const cmp = Object.create(ProductComponent.prototype) as ProductComponent;
    Object.assign(cmp as any, {
      showStorefrontEdit: () => true,
      duplicateSaving: false,
      product: { slug: 'vase' },
      admin: { duplicateProduct: jasmine.createSpy('dup') },
      toast: { success: jasmine.createSpy('s'), error: jasmine.createSpy('e') },
      translate: { instant: (k: string) => k },
      router: { navigate: jasmine.createSpy('nav') },
      ...overrides,
    });
    return cmp;
  }

  it('returns early when storefront edit is disabled', () => {
    const cmp = bare({ showStorefrontEdit: () => false });
    cmp.duplicateFromStorefront();
    expect((cmp as any).admin.duplicateProduct).not.toHaveBeenCalled();
    expect((cmp as any).duplicateSaving).toBe(false);
  });

  it('returns early when already saving', () => {
    const cmp = bare({ duplicateSaving: true });
    cmp.duplicateFromStorefront();
    expect((cmp as any).admin.duplicateProduct).not.toHaveBeenCalled();
  });
});
