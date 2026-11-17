import { signal } from '@angular/core';
import { ShopComponent } from './shop.component';

/** Golden WU shop-pagination-nav — loadMore / changePage. */
describe('ShopComponent pagination-nav helpers (golden WU)', () => {
  function createCmp(overrides: Record<string, unknown> = {}) {
    const cmp = Object.create(ShopComponent.prototype) as ShopComponent;
    Object.assign(cmp as any, {
      paginationMode: 'pages',
      pageMeta: { page: 2, total_pages: 5 },
      filters: { page: 2 },
      loadingMore: signal(false),
      hasError: signal(false),
      cancelFilterDebounce: jasmine.createSpy('cancelFilterDebounce'),
      loadProducts: jasmine.createSpy('loadProducts'),
      fetchProducts: jasmine.createSpy('fetchProducts'),
      ...overrides,
    });
    return cmp;
  }

  it('changePage advances only in pages mode and respects bounds', () => {
    const cmp = createCmp();
    cmp.changePage(1);
    expect((cmp as any).filters.page).toBe(3);
    expect((cmp as any).loadProducts).toHaveBeenCalled();

    const denied = createCmp({ paginationMode: 'load_more' });
    denied.changePage(1);
    expect((denied as any).loadProducts).not.toHaveBeenCalled();

    const atEnd = createCmp({ pageMeta: { page: 5, total_pages: 5 }, filters: { page: 5 } });
    atEnd.changePage(1);
    expect((atEnd as any).loadProducts).not.toHaveBeenCalled();
  });

  it('loadMore advances page and append-fetches only in load_more mode', () => {
    const cmp = createCmp({
      paginationMode: 'load_more',
      pageMeta: { page: 1, total_pages: 3 },
      filters: { page: 1 },
    });
    cmp.loadMore();
    expect((cmp as any).filters.page).toBe(2);
    expect((cmp as any).loadingMore()).toBe(true);
    expect((cmp as any).fetchProducts).toHaveBeenCalledWith(true);

    const pages = createCmp({ paginationMode: 'pages' });
    pages.loadMore();
    expect((pages as any).fetchProducts).not.toHaveBeenCalled();
  });
});
