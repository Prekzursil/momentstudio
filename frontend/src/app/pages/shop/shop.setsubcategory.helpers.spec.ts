import { ShopComponent } from './shop.component';

describe('ShopComponent setSubcategory allow/deny (golden WU)', () => {
  function createCmp(overrides: Record<string, unknown> = {}) {
    const parent = { id: 'p1', slug: 'root', name: 'Root' };
    const child = { id: 'c1', slug: 'child', name: 'Child' };
    const cmp = Object.create(ShopComponent.prototype) as ShopComponent;
    Object.assign(cmp as any, {
      cancelFilterDebounce: jasmine.createSpy('cancelFilterDebounce'),
      loadProducts: jasmine.createSpy('loadProducts'),
      activeCategorySlug: 'root',
      activeSubcategorySlug: '',
      filters: { page: 3 },
      categoriesBySlug: new Map([['root', parent]]),
      getSubcategories: jasmine.createSpy('getSubcategories').and.returnValue([child]),
      ...overrides,
    });
    return cmp;
  }

  it('denies when parent missing', () => {
    const cmp = createCmp({ categoriesBySlug: new Map() });
    cmp.setSubcategory('child');
    expect((cmp as any).loadProducts).not.toHaveBeenCalled();
  });

  it('denies slug outside parent children', () => {
    const cmp = createCmp();
    cmp.setSubcategory('nope');
    expect((cmp as any).loadProducts).not.toHaveBeenCalled();
  });

  it('allows valid child and clears with empty slug', () => {
    const cmp = createCmp();
    cmp.setSubcategory('child');
    expect((cmp as any).activeSubcategorySlug).toBe('child');
    expect((cmp as any).filters.page).toBe(1);
    expect((cmp as any).loadProducts).toHaveBeenCalled();
    cmp.setSubcategory('');
    expect((cmp as any).activeSubcategorySlug).toBe('');
  });
});
