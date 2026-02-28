import { ShopComponent } from './shop.component';

function instantTranslate(key: string, params?: Record<string, unknown>): string {
  if (!params) return key;
  const rendered = Object.entries(params)
    .map(([name, value]) => `${name}=${String(value)}`)
    .join(',');
  return `${key}:${rendered}`;
}

function createShopHarness(): any {
  const cmp: any = Object.create(ShopComponent.prototype);
  cmp.translate = { instant: instantTranslate };
  cmp.filters = {
    search: '',
    min_price: 1,
    max_price: 500,
    tags: new Set<string>(),
    sort: 'recommended',
    page: 1,
    limit: 12,
  };
  cmp.priceMinBound = 1;
  cmp.priceMaxBound = 500;
  cmp.priceStep = 1;
  cmp.categorySelection = '';
  cmp.activeCategorySlug = '';
  cmp.activeSubcategorySlug = '';
  cmp.categoriesBySlug = new Map();
  cmp.allTags = [];
  cmp.paginationMode = 'pages';
  cmp.pageMeta = null;
  cmp.products = [];
  cmp.cancelFilterDebounce = jasmine.createSpy('cancelFilterDebounce');
  cmp.loadProducts = jasmine.createSpy('loadProducts');
  cmp.applyFilters = jasmine.createSpy('applyFilters');
  cmp.router = { url: '/shop', navigate: jasmine.createSpy('navigate').and.returnValue(Promise.resolve(true)) };
  return cmp;
}

describe('ShopComponent method harness', () => {
  it('parses booleans and numeric prices', () => {
    const cmp = createShopHarness();
    expect(cmp['parseBoolean'](true)).toBeTrue();
    expect(cmp['parseBoolean'](1)).toBeTrue();
    expect(cmp['parseBoolean']('yes')).toBeTrue();
    expect(cmp['parseBoolean'](['true'])).toBeTrue();
    expect(cmp['parseBoolean']('no')).toBeFalse();
    expect(cmp['parseBoolean'](null)).toBeFalse();

    expect(cmp['parsePrice'](42)).toBe(42);
    expect(cmp['parsePrice']('12.5')).toBe(12.5);
    expect(cmp['parsePrice']('')).toBeUndefined();
    expect(cmp['parsePrice']('abc')).toBeUndefined();
    expect(cmp['parsePrice'](Number.NaN)).toBeUndefined();
  });

  it('normalizes and clamps min/max price ranges', () => {
    const cmp = createShopHarness();
    cmp.filters.min_price = -5;
    cmp.filters.max_price = 9_999;
    cmp['normalizePriceRange']();
    expect(cmp.filters.min_price).toBe(1);
    expect(cmp.filters.max_price).toBe(500);

    cmp.filters.min_price = 300;
    cmp.filters.max_price = 250;
    cmp['normalizePriceRange']('min');
    expect(cmp.filters.max_price).toBe(300);

    cmp.filters.min_price = 320;
    cmp.filters.max_price = 250;
    cmp['normalizePriceRange']('max');
    expect(cmp.filters.min_price).toBe(250);

    expect(cmp['clampPrice'](Number.NaN)).toBe(1);
    expect(cmp['clampPrice'](550)).toBe(500);
  });

  it('syncs query filters and builds normalized query params', () => {
    const cmp = createShopHarness();
    cmp.priceMaxBound = 1_000;
    cmp.activeCategorySlug = 'chairs';
    cmp.activeSubcategorySlug = 'office';
    cmp.filters.search = 'desk';
    cmp.filters.min_price = 20;
    cmp.filters.max_price = 800;
    cmp.filters.sort = 'price_desc';
    cmp.filters.page = 2;
    cmp.filters.tags = new Set(['sale', 'new']);

    expect(cmp['buildQueryParams']()).toEqual({
      q: 'desk',
      sub: 'office',
      min: 20,
      max: 800,
      sort: 'price_desc',
      page: 2,
      tags: 'sale,new',
    });

    cmp['syncFiltersFromQuery']({
      q: 'lamp',
      min: '10',
      max: '90',
      sort: 'name_asc',
      page: '3',
      tags: 'eco,wood',
    });
    expect(cmp.filters.search).toBe('lamp');
    expect(cmp.filters.min_price).toBe(10);
    expect(cmp.filters.max_price).toBe(90);
    expect(cmp.filters.sort).toBe('name_asc');
    expect(cmp.filters.page).toBe(3);
    expect(Array.from(cmp.filters.tags)).toEqual(['eco', 'wood']);
  });

  it('builds filter chips and removes chip branches correctly', () => {
    const cmp = createShopHarness();
    cmp.activeCategorySlug = 'chairs';
    cmp.activeSubcategorySlug = 'office';
    cmp.categoriesBySlug.set('chairs', { slug: 'chairs', name: 'Chairs' });
    cmp.categoriesBySlug.set('office', { slug: 'office', name: 'Office' });
    cmp.filters.min_price = 20;
    cmp.filters.max_price = 120;
    cmp.filters.search = ' ergonomic ';
    cmp.filters.tags = new Set(['eco']);
    cmp.allTags = [{ slug: 'eco', name: 'Eco' }];

    const chips = cmp.filterChips();
    expect(chips.map((chip: any) => chip.type)).toEqual(['category', 'subcategory', 'price', 'search', 'tag']);

    cmp.removeChip({ id: 'category:chairs', type: 'category', label: 'Chairs' });
    expect(cmp.activeCategorySlug).toBe('');
    expect(cmp.activeSubcategorySlug).toBe('');
    expect(cmp.loadProducts).toHaveBeenCalled();

    cmp.removeChip({ id: 'price:20-120', type: 'price', label: 'price' });
    expect(cmp.filters.min_price).toBe(cmp.priceMinBound);
    expect(cmp.filters.max_price).toBe(cmp.priceMaxBound);
    expect(cmp.applyFilters).toHaveBeenCalled();

    cmp.filters.tags = new Set(['eco']);
    cmp.removeChip({ id: 'tag:eco', type: 'tag', label: 'Eco', value: 'eco' });
    expect(cmp.filters.tags.has('eco')).toBeFalse();
  });

  it('computes results meta and category slug resolution', () => {
    const cmp = createShopHarness();
    cmp.activeCategorySlug = 'chairs';
    cmp.activeSubcategorySlug = 'office';
    expect(cmp['resolveCatalogCategorySlug'](false)).toBe('office');
    expect(cmp['resolveCatalogCategorySlug'](true)).toBeUndefined();

    cmp.pageMeta = { total_items: 25, page: 2, limit: 10 } as any;
    expect(cmp.resultsMetaParams()).toEqual({ total: 25, from: 11, to: 20 });

    cmp.paginationMode = 'load_more';
    cmp.products = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }] as any[];
    expect(cmp.resultsMetaParams()).toEqual({ total: 25, from: 1, to: 3 });
  });
});
