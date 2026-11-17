import { ShopComponent } from './shop.component';

/** Golden WU shop-viewproduct — viewProduct blank/navigate arms. */
describe('ShopComponent viewProduct (golden WU)', () => {
  function createCmp() {
    const cmp = Object.create(ShopComponent.prototype) as ShopComponent;
    Object.assign(cmp as any, {
      rememberShopReturnContext: jasmine.createSpy('rememberShopReturnContext'),
      closeQuickView: jasmine.createSpy('closeQuickView'),
      router: { navigate: jasmine.createSpy('navigate').and.returnValue(Promise.resolve(true)) },
    });
    return cmp;
  }

  it('no-ops on blank slug', () => {
    const cmp = createCmp();
    cmp.viewProduct('  ');
    expect((cmp as any).rememberShopReturnContext).not.toHaveBeenCalled();
    expect((cmp as any).router.navigate).not.toHaveBeenCalled();
  });

  it('remembers context, closes quick view, and navigates', () => {
    const cmp = createCmp();
    cmp.viewProduct('sku-1');
    expect((cmp as any).rememberShopReturnContext).toHaveBeenCalled();
    expect((cmp as any).closeQuickView).toHaveBeenCalled();
    expect((cmp as any).router.navigate).toHaveBeenCalledWith(['/products', 'sku-1']);
  });
});
