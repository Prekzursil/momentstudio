import { ProductComponent } from './product.component';

/** Golden WU tip orphan — showStorefrontEdit. */
describe('ProductComponent showStorefrontEdit (golden WU)', () => {
  function bare(overrides: Record<string, unknown> = {}): ProductComponent {
    const cmp = Object.create(ProductComponent.prototype) as ProductComponent;
    Object.assign(cmp as any, {
      storefrontAdminMode: { enabled: () => true },
      auth: { isAdmin: () => true, isImpersonating: () => false },
      product: { slug: 'widget' },
      ...overrides,
    });
    return cmp;
  }

  it('requires admin mode, admin auth, no impersonation, and a product slug', () => {
    expect(bare().showStorefrontEdit()).toBe(true);
    expect(bare({ storefrontAdminMode: { enabled: () => false } }).showStorefrontEdit()).toBe(
      false,
    );
    expect(bare({ auth: { isAdmin: () => false, isImpersonating: () => false } }).showStorefrontEdit()).toBe(
      false,
    );
    expect(
      bare({ auth: { isAdmin: () => true, isImpersonating: () => true } }).showStorefrontEdit(),
    ).toBe(false);
    expect(bare({ product: { slug: '' } }).showStorefrontEdit()).toBe(false);
  });
});
