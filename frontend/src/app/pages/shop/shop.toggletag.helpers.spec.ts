import { ShopComponent } from './shop.component';

/** Golden WU shop-toggletag — toggleTag add/remove. */
describe('ShopComponent toggleTag (golden WU)', () => {
  function createCmp(tags: string[] = []) {
    const cmp = Object.create(ShopComponent.prototype) as ShopComponent;
    Object.assign(cmp as any, {
      filters: { tags: new Set(tags) },
      cancelFilterDebounce: jasmine.createSpy('cancelFilterDebounce'),
      applyFilters: jasmine.createSpy('applyFilters'),
    });
    return cmp;
  }

  it('adds missing tag then removes existing tag', () => {
    const cmp = createCmp();
    cmp.toggleTag('new');
    expect((cmp as any).cancelFilterDebounce).toHaveBeenCalled();
    expect((cmp as any).filters.tags.has('new')).toBe(true);
    expect((cmp as any).applyFilters).toHaveBeenCalled();

    (cmp as any).applyFilters.calls.reset();
    cmp.toggleTag('new');
    expect((cmp as any).filters.tags.has('new')).toBe(false);
    expect((cmp as any).applyFilters).toHaveBeenCalled();
  });
});
