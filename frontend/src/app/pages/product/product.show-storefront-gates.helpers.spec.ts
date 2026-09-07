import { ProductComponent } from './product.component';

/** Golden WU product-show-storefront-gates — showStorefrontEdit. */
describe('ProductComponent showStorefrontEdit (golden WU tip)', () => {
  function bare(overrides: Record<string, unknown> = {}): ProductComponent {
    const cmp = Object.create(ProductComponent.prototype) as ProductComponent;
    Object.assign(cmp as any, {
      storefrontAdminMode: { enabled: () => true },
      auth: { isAdmin: () => true, isImpersonating: () => false },
      product: { slug: 'ring' },
      ...overrides,
    });
    return cmp;
  }

  it('requires admin mode, admin auth, no impersonation, and slug', () => {
    expect(bare().showStorefrontEdit()).toBe(true);
    expect(bare({ storefrontAdminMode: { enabled: () => false } }).showStorefrontEdit()).toBe(false);
    expect(bare({ auth: { isAdmin: () => false, isImpersonating: () => false } }).showStorefrontEdit()).toBe(false);
    expect(bare({ auth: { isAdmin: () => true, isImpersonating: () => true } }).showStorefrontEdit()).toBe(false);
    expect(bare({ product: { slug: '' } }).showStorefrontEdit()).toBe(false);
    expect(bare({ product: null }).showStorefrontEdit()).toBe(false);
  });
});
