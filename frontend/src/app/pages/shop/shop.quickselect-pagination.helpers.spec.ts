import { ShopComponent } from './shop.component';

describe('ShopComponent quickSelectCategory / setPaginationMode (golden WU)', () => {
  function createCmp(overrides: Record<string, unknown> = {}) {
    const cmp = Object.create(ShopComponent.prototype) as ShopComponent;
    Object.assign(cmp as any, {
      categorySelection: '',
      onCategorySelected: jasmine.createSpy('onCategorySelected'),
      cancelFilterDebounce: jasmine.createSpy('cancelFilterDebounce'),
      loadProducts: jasmine.createSpy('loadProducts'),
      paginationMode: 'pages',
      filters: { page: 4 },
      ...overrides,
    });
    return cmp;
  }

  it('quickSelectCategory sets selection, notifies, scrolls', () => {
    const scrollTo = jasmine.createSpy('scrollTo');
    (window as any).scrollTo = scrollTo;
    const cmp = createCmp();
    cmp.quickSelectCategory('sale');
    expect((cmp as any).categorySelection).toBe('sale');
    expect((cmp as any).onCategorySelected).toHaveBeenCalled();
    expect(scrollTo).toHaveBeenCalled();
  });

  it('setPaginationMode no-ops when unchanged', () => {
    const cmp = createCmp({ paginationMode: 'pages' });
    cmp.setPaginationMode('pages');
    expect((cmp as any).cancelFilterDebounce).not.toHaveBeenCalled();
    expect((cmp as any).loadProducts).not.toHaveBeenCalled();
  });

  it('setPaginationMode switches mode and reloads page 1', () => {
    const cmp = createCmp({ paginationMode: 'pages' });
    cmp.setPaginationMode('load_more');
    expect((cmp as any).paginationMode).toBe('load_more');
    expect((cmp as any).filters.page).toBe(1);
    expect((cmp as any).loadProducts).toHaveBeenCalled();
  });
});
