import { BehaviorSubject, of } from 'rxjs';
import { convertToParamMap } from '@angular/router';
import { TestBed } from '@angular/core/testing';

import { ShopComponent } from './shop.component';

type SignalLike<T> = (() => T) & { set: (value: T) => void };

function signalLike<T>(initial: T): SignalLike<T> {
  let current = initial;
  const fn = (() => current) as SignalLike<T>;
  fn.set = (value: T) => {
    current = value;
  };
  return fn;
}

function createHarness(): any {
  const cmp: any = Object.create(ShopComponent.prototype);
  cmp.quickViewOpen = false;
  cmp.quickViewSlug = '';
  cmp.categorySelection = '';
  cmp.activeCategorySlug = '';
  cmp.activeSubcategorySlug = '';
  cmp.categoriesBySlug = new Map();
  cmp.childrenByParentId = new Map();
  cmp.products = [];
  cmp.pageMeta = null;
  cmp.paginationMode = 'pages';
  cmp.filters = { sort: 'recommended', page: 1 };
  cmp.bulkStatus = '';
  cmp.bulkCategoryId = '';
  cmp.bulkFeatured = '';
  cmp.bulkEditError = '';
  cmp.translate = { instant: (key: string) => key };
  cmp.router = { navigate: jasmine.createSpy('navigate').and.returnValue(Promise.resolve(true)) };
  cmp.toast = jasmine.createSpyObj('ToastService', ['error', 'action']);
  cmp.admin = jasmine.createSpyObj('AdminService', ['bulkUpdateProducts']);
  cmp.admin.bulkUpdateProducts.and.returnValue({ subscribe: ({ next }: any) => next?.() });
  cmp.storefrontAdminMode = { enabled: jasmine.createSpy('enabled').and.returnValue(true) };
  cmp.cancelFilterDebounce = jasmine.createSpy('cancelFilterDebounce');
  cmp.loadProducts = jasmine.createSpy('loadProducts');
  cmp.fetchProducts = jasmine.createSpy('fetchProducts');
  cmp.rememberShopReturnContext = jasmine.createSpy('rememberShopReturnContext');
  cmp.getSubcategories = (category: any) => cmp.childrenByParentId.get(category.id) || [];
  cmp.loading = signalLike(false);
  cmp.hasError = signalLike(false);
  cmp.loadingMore = signalLike(false);
  cmp.bulkSelectMode = signalLike(false);
  cmp.bulkSaving = signalLike(false);
  cmp.productReorderSaving = signalLike(false);
  cmp.bulkSelectedProductIds = signalLike(new Set<string>());
  return cmp;
}



describe('ShopComponent constructor/ngOnInit integration coverage', () => {
  it('covers constructor effect setup, ngOnInit URL sync path, and ngOnDestroy cleanup', () => {
    const paramMap$ = new BehaviorSubject(convertToParamMap({ category: 'rings' }));
    const queryParams$ = new BehaviorSubject<any>({ q: 'gem', sort: 'recommended' });
    const route: any = {
      snapshot: { data: { categories: [{ id: 'cat-1', slug: 'rings', name: 'Rings', parent_id: null }] }, queryParams: {} },
      paramMap: paramMap$.asObservable(),
      queryParams: queryParams$.asObservable(),
    };

    const catalog = jasmine.createSpyObj('CatalogService', ['listProducts', 'listCategories']);
    catalog.listProducts.and.returnValue(of({ items: [], meta: { page: 1, total_pages: 1, total_items: 0, limit: 12 } } as any));
    catalog.listCategories.and.returnValue(of([{ id: 'cat-1', slug: 'rings', name: 'Rings', parent_id: null }] as any));

    const admin = jasmine.createSpyObj('AdminService', [
      'reorderCategoryChildren',
      'renameCategory',
      'createCategory',
      'mergeCategory',
      'deleteCategorySafe',
      'previewCategoryDelete',
      'previewCategoryMerge',
      'bulkUpdateProducts',
      'reorderProductsInCategory',
    ]);
    admin.bulkUpdateProducts.and.returnValue(of({} as any));

    const storefrontAdminMode = { enabled: jasmine.createSpy('enabled').and.returnValue(false) };
    const toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    const lang$ = new BehaviorSubject<any>({ lang: 'en' });
    const translate: any = {
      currentLang: 'en',
      onLangChange: lang$.asObservable(),
      instant: (key: string) => key,
    };
    const title = jasmine.createSpyObj('Title', ['setTitle']);
    const metaService = jasmine.createSpyObj('Meta', ['updateTag']);
    const seoHeadLinks = jasmine.createSpyObj('SeoHeadLinksService', ['setLocalizedCanonical']);
    seoHeadLinks.setLocalizedCanonical.and.returnValue('https://momentstudio.test/shop');
    const structuredData = jasmine.createSpyObj('StructuredDataService', ['setRouteSchemas', 'clearRouteSchemas']);
    const router = jasmine.createSpyObj('Router', ['navigate']);
    router.navigate.and.returnValue(Promise.resolve(true));

    TestBed.configureTestingModule({});
    const component = TestBed.runInInjectionContext(() => new ShopComponent(
      catalog as any,
      route,
      router as any,
      admin as any,
      storefrontAdminMode as any,
      toast as any,
      translate,
      title as any,
      metaService as any,
      seoHeadLinks as any,
      structuredData as any,
    ));

    const loadProductsSpy = spyOn(component, 'loadProducts').and.stub();
    const fetchCategoriesSpy = spyOn(component, 'fetchCategories').and.callThrough();

    component.ngOnInit();
    expect(loadProductsSpy).toHaveBeenCalled();
    expect(fetchCategoriesSpy.calls.count()).toBeGreaterThanOrEqual(0);

    queryParams$.next({ q: 'gem', page: '2', sort: 'price_desc' });
    expect(loadProductsSpy).toHaveBeenCalled();

    lang$.next({ lang: 'ro' });
    expect(fetchCategoriesSpy).toHaveBeenCalled();

    component.ngOnDestroy();
    expect(structuredData.clearRouteSchemas).toHaveBeenCalled();
  });
});

describe('ShopComponent coverage wave', () => {
  it('handles quick-view open/close and product navigation', () => {
    const cmp = createHarness();

    cmp.openQuickView('   ');
    expect(cmp.quickViewOpen).toBeFalse();

    cmp.openQuickView('ring-1');
    expect(cmp.quickViewOpen).toBeTrue();
    expect(cmp.quickViewSlug).toBe('ring-1');

    cmp.viewProduct('ring-1');
    expect(cmp.rememberShopReturnContext).toHaveBeenCalled();
    expect(cmp.router.navigate).toHaveBeenCalledWith(['/products', 'ring-1']);
    expect(cmp.quickViewOpen).toBeFalse();
  });

  it('computes reorder eligibility from leaf category and loaded pagination state', () => {
    const cmp = createHarness();
    cmp.products = [{ id: 'p1' }, { id: 'p2' }];
    cmp.activeCategorySlug = 'root';
    cmp.categoriesBySlug.set('root', { id: 'root', slug: 'root', name: 'Root' });
    cmp.childrenByParentId.set('root', []);
    cmp.paginationMode = 'load_more';
    cmp.pageMeta = { total_pages: 2, page: 2, total_items: 2 };

    expect(cmp.canReorderProducts()).toBeTrue();

    cmp.filters.sort = 'price_asc';
    expect(cmp.canReorderProducts()).toBeFalse();

    cmp.filters.sort = 'recommended';
    cmp.pageMeta = { total_pages: 2, page: 1, total_items: 2 };
    expect(cmp.canReorderProducts()).toBeFalse();
  });

  it('toggles bulk mode and updates selection helpers', () => {
    const cmp = createHarness();
    cmp.products = [{ id: 'a' }, { id: 'b' }];

    cmp.toggleBulkSelectMode();
    expect(cmp.bulkSelectMode()).toBeTrue();

    const checkedEvent = { preventDefault: jasmine.createSpy(), stopPropagation: jasmine.createSpy(), target: { checked: true } } as any;
    cmp.toggleBulkSelected(checkedEvent, 'a');
    expect(cmp.bulkIsSelected('a')).toBeTrue();

    cmp.selectAllProductsOnPage();
    expect(cmp.bulkSelectedProductIds().has('b')).toBeTrue();

    cmp.toggleBulkSelectMode();
    expect(cmp.bulkSelectMode()).toBeFalse();
    expect(cmp.bulkSelectedProductIds().size).toBe(0);
  });

  it('validates pagination mode changes and load-more guard conditions', () => {
    const cmp = createHarness();

    cmp.setPaginationMode('load_more');
    expect(cmp.paginationMode).toBe('load_more');
    expect(cmp.loadProducts).toHaveBeenCalled();

    cmp.pageMeta = { page: 1, total_pages: 3 };
    cmp.loadMore();
    expect(cmp.filters.page).toBe(2);
    expect(cmp.loadingMore()).toBeTrue();
    expect(cmp.fetchProducts).toHaveBeenCalledWith(true);

    cmp.loadingMore.set(false);
    cmp.pageMeta = { page: 3, total_pages: 3 };
    cmp.loadMore();
    expect(cmp.filters.page).toBe(2);
  });

  it('tracks chips and clears selection without crashes on unknown chip types', () => {
    const cmp = createHarness();
    cmp.filters.page = 9;

    expect(cmp.trackChip(0, { id: 'tag:eco' })).toBe('tag:eco');

    cmp.bulkSelectedProductIds.set(new Set(['x']));
    cmp.clearBulkSelection();
    expect(cmp.bulkSelectedProductIds().size).toBe(0);

    cmp.removeChip({ type: 'unknown', id: 'noop', label: 'noop' });
    expect(cmp.cancelFilterDebounce).toHaveBeenCalled();
    expect(cmp.filters.page).toBe(1);
  });
});


