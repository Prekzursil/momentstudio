import { ShopComponent } from './shop.component';

describe('ShopComponent canEditCategories / canEditProducts (golden WU)', () => {
  function createCmp(enabled: boolean) {
    const cmp = Object.create(ShopComponent.prototype) as ShopComponent;
    Object.assign(cmp as any, {
      storefrontAdminMode: { enabled: () => enabled },
    });
    return cmp;
  }

  it('mirrors storefrontAdminMode.enabled for categories and products', () => {
    expect(createCmp(true).canEditCategories()).toBe(true);
    expect(createCmp(true).canEditProducts()).toBe(true);
    expect(createCmp(false).canEditCategories()).toBe(false);
    expect(createCmp(false).canEditProducts()).toBe(false);
  });
});
