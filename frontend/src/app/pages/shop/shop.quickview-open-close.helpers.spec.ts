import { ShopComponent } from './shop.component';

/** Golden WU shop-quickview-open-close — openQuickView / closeQuickView. */
describe('ShopComponent openQuickView / closeQuickView (golden WU)', () => {
  function createCmp() {
    const cmp = Object.create(ShopComponent.prototype) as ShopComponent;
    Object.assign(cmp as any, { quickViewSlug: '', quickViewOpen: false });
    return cmp;
  }

  it('openQuickView ignores blank and sets slug/open', () => {
    const cmp = createCmp();
    cmp.openQuickView('  ');
    expect((cmp as any).quickViewOpen).toBe(false);
    cmp.openQuickView('sku');
    expect((cmp as any).quickViewSlug).toBe('sku');
    expect((cmp as any).quickViewOpen).toBe(true);
  });

  it('closeQuickView clears open state and slug', () => {
    const cmp = createCmp();
    (cmp as any).quickViewOpen = true;
    (cmp as any).quickViewSlug = 'sku';
    cmp.closeQuickView();
    expect((cmp as any).quickViewOpen).toBe(false);
    expect((cmp as any).quickViewSlug).toBe('');
  });
});
