import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { ShopComponent } from './shop.component';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Title, Meta } from '@angular/platform-browser';
import { of, Subject, throwError } from 'rxjs';
import { CatalogService } from '../../core/catalog.service';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { AdminService } from '../../core/admin.service';
import { StorefrontAdminModeService } from '../../core/storefront-admin-mode.service';
import { ToastService } from '../../core/toast.service';

describe('ShopComponent i18n meta', () => {
  let meta: jasmine.SpyObj<Meta>;
  let title: jasmine.SpyObj<Title>;
  let admin: jasmine.SpyObj<AdminService>;
  let storefrontAdminMode: { enabled: jasmine.Spy };
  let toast: jasmine.SpyObj<ToastService>;
  let router: jasmine.SpyObj<Router>;
  let doc: Document;

  beforeEach(() => {
    meta = jasmine.createSpyObj<Meta>('Meta', ['updateTag']);
    title = jasmine.createSpyObj<Title>('Title', ['setTitle']);
    admin = jasmine.createSpyObj<AdminService>('AdminService', ['bulkUpdateProducts']);
    admin.bulkUpdateProducts.and.returnValue(of([]));
    storefrontAdminMode = { enabled: jasmine.createSpy('enabled').and.returnValue(false) };
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['error', 'success', 'action']);
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    router.navigate.and.returnValue(Promise.resolve(true));
    doc = document.implementation.createHTMLDocument('shop-seo-test');

    TestBed.configureTestingModule({
      imports: [ShopComponent, TranslateModule.forRoot()],
      providers: [
        { provide: Title, useValue: title },
        { provide: Meta, useValue: meta },
        { provide: CatalogService, useValue: { listProducts: () => of({ items: [], meta: null }), listCategories: () => of([]) } },
        { provide: ActivatedRoute, useValue: { snapshot: { data: {}, queryParams: {} }, paramMap: of(convertToParamMap({})), queryParams: of({}) } },
        { provide: Router, useValue: router },
        { provide: AdminService, useValue: admin },
        { provide: StorefrontAdminModeService, useValue: storefrontAdminMode },
        { provide: ToastService, useValue: toast },
        { provide: DOCUMENT, useValue: doc }
      ]
    });
  });

  it('updates english meta tags and category variants', () => {
    const fixture = TestBed.createComponent(ShopComponent);
    const cmp = fixture.componentInstance as any;
    const translate = TestBed.inject(TranslateService);
    seedShopTranslations(translate);
    translate.use('en');

    cmp.setMetaTags();
    expect(title.setTitle).toHaveBeenCalledWith('EN title');
    expect(meta.updateTag).toHaveBeenCalledWith({ name: 'description', content: 'EN desc' });
    const canonicalEn = doc.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    expect(canonicalEn?.getAttribute('href')).toContain('/shop');
    expect(canonicalEn?.getAttribute('href')).not.toContain('lang=en');
    expect(doc.querySelectorAll('link[rel="alternate"][data-seo-managed="true"]').length).toBe(3);
    expect((doc.querySelector('script#seo-route-schema-1')?.textContent || '')).toContain('"CollectionPage"');

    meta.updateTag.calls.reset();
    title.setTitle.calls.reset();
    cmp.activeCategorySlug = 'featured';
    cmp.categoriesBySlug.set('featured', { slug: 'featured', name: 'Featured' } as any);
    cmp.setMetaTags();
    expect(title.setTitle).toHaveBeenCalledWith('EN title Featured');
    expect(meta.updateTag).toHaveBeenCalledWith({ name: 'description', content: 'EN desc Featured' });
  });

  it('updates romanian meta tags when language changes', () => {
    const fixture = TestBed.createComponent(ShopComponent);
    const cmp = fixture.componentInstance as any;
    const translate = TestBed.inject(TranslateService);
    seedShopTranslations(translate);

    meta.updateTag.calls.reset();
    title.setTitle.calls.reset();
    translate.use('ro');
    cmp.activeCategorySlug = null;
    cmp.setMetaTags();
    expect(title.setTitle).toHaveBeenCalledWith('RO title');
    expect(meta.updateTag).toHaveBeenCalledWith({ name: 'description', content: 'RO desc' });
    const canonicalRo = doc.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    expect(canonicalRo?.getAttribute('href')).toContain('/shop?lang=ro');
  });

  it('ignores stale product list responses when multiple loads overlap', () => {
    const first$ = new Subject<any>();
    const second$ = new Subject<any>();
    const listProducts = jasmine.createSpy('listProducts').and.returnValues(first$.asObservable(), second$.asObservable());
    const catalog = {
      listCategories: () => of([]),
      listProducts
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ShopComponent, TranslateModule.forRoot()],
      providers: [
        { provide: Title, useValue: title },
        { provide: Meta, useValue: meta },
        { provide: CatalogService, useValue: catalog },
        { provide: ActivatedRoute, useValue: { snapshot: { data: {}, queryParams: {} }, paramMap: of(convertToParamMap({})), queryParams: of({}) } },
        { provide: Router, useValue: router },
        { provide: AdminService, useValue: admin },
        { provide: StorefrontAdminModeService, useValue: storefrontAdminMode },
        { provide: ToastService, useValue: toast },
        { provide: DOCUMENT, useValue: doc }
      ]
    });

    const fixture = TestBed.createComponent(ShopComponent);
    const cmp = fixture.componentInstance as any;

    // Force two sequential loads; only the last should win.
    cmp.loadProducts(false);
    cmp.loadProducts(false);

    second$.next({
      items: [{ id: 'new', slug: 'new', name: 'New', base_price: 1, currency: 'RON', tags: [] }],
      meta: { total_items: 1, total_pages: 1, page: 1, limit: 20 }
    });
    second$.complete();

    expect(cmp.products.length).toBe(1);
    expect(cmp.products[0].id).toBe('new');

    first$.next({
      items: [{ id: 'old', slug: 'old', name: 'Old', base_price: 1, currency: 'RON', tags: [] }],
      meta: { total_items: 1, total_pages: 1, page: 1, limit: 20 }
    });
    first$.complete();

    expect(cmp.products.length).toBe(1);
    expect(cmp.products[0].id).toBe('new');
  });

  it('evaluates reorder eligibility with guard clauses and valid leaf-category conditions', () => {
    const fixture = TestBed.createComponent(ShopComponent);
    const cmp = fixture.componentInstance as any;

    cmp.products = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }];
    cmp.loading.set(false);
    cmp.hasError.set(false);
    cmp.bulkSelectMode.set(false);
    cmp.productReorderSaving.set(false);
    cmp.filters.sort = 'recommended';
    cmp.activeCategorySlug = 'root';
    cmp.activeSubcategorySlug = '';
    cmp.categoriesBySlug.set('root', { id: 'root', slug: 'root', name: 'Root' });
    cmp.childrenByParentId.set('root', []);
    cmp.paginationMode = 'load_more';
    cmp.pageMeta = { total_pages: 2, page: 2, total_items: 3, limit: 12 };

    storefrontAdminMode.enabled.and.returnValue(false);
    expect(cmp.canReorderProducts()).toBeFalse();

    storefrontAdminMode.enabled.and.returnValue(true);
    expect(cmp.canReorderProducts()).toBeTrue();

    cmp.filters.sort = 'price_asc';
    expect(cmp.canReorderProducts()).toBeFalse();
  });

  it('reorders products on drop and restores order when API update fails', () => {
    const fixture = TestBed.createComponent(ShopComponent);
    const cmp = fixture.componentInstance as any;
    storefrontAdminMode.enabled.and.returnValue(true);
    cmp.loading.set(false);
    cmp.hasError.set(false);
    cmp.bulkSelectMode.set(false);
    cmp.productReorderSaving.set(false);
    cmp.filters.sort = 'recommended';
    cmp.activeCategorySlug = 'root';
    cmp.categoriesBySlug.set('root', { id: 'root', slug: 'root', name: 'Root' });
    cmp.childrenByParentId.set('root', []);
    cmp.paginationMode = 'load_more';
    cmp.pageMeta = { total_pages: 1, page: 1, total_items: 3, limit: 12 };
    cmp.products = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    cmp.draggingProductId = 'c';

    const event = { preventDefault: jasmine.createSpy('preventDefault') } as any;
    cmp.onProductDrop(event, 'a');

    expect(event.preventDefault).toHaveBeenCalled();
    expect(cmp.products.map((p: any) => p.id)).toEqual(['c', 'a', 'b']);
    expect(admin.bulkUpdateProducts).toHaveBeenCalledWith(
      [
        { product_id: 'c', sort_order: 0 },
        { product_id: 'a', sort_order: 1 },
        { product_id: 'b', sort_order: 2 }
      ],
      { source: 'storefront' }
    );
    expect(toast.action).toHaveBeenCalled();

    admin.bulkUpdateProducts.and.returnValue(throwError(() => new Error('reorder failed')));
    cmp.products = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    cmp.draggingProductId = 'c';
    cmp.onProductDrop(event, 'a');

    expect(cmp.products.map((p: any) => p.id)).toEqual(['a', 'b', 'c']);
    expect(toast.error).toHaveBeenCalledWith('adminUi.storefront.products.reorderError');
  });

  it('builds/removes filter chips for category, price, search and tag states', () => {
    const fixture = TestBed.createComponent(ShopComponent);
    const cmp = fixture.componentInstance as any;
    cmp.activeCategorySlug = 'sale';
    cmp.activeSubcategorySlug = '';
    cmp.filters.min_price = 25;
    cmp.filters.max_price = 150;
    cmp.filters.search = '  lens  ';
    cmp.filters.tags = new Set(['vip']);
    cmp.allTags = [{ slug: 'vip', name: 'VIP' }];

    const chips = cmp.filterChips();
    expect(chips.map((chip: any) => chip.type)).toEqual(['category', 'price', 'search', 'tag']);
    expect(chips.find((chip: any) => chip.type === 'tag')?.label).toBe('VIP');

    const loadProducts = spyOn(cmp, 'loadProducts').and.stub();
    const applyFilters = spyOn(cmp, 'applyFilters').and.stub();

    cmp.removeChip({ id: 'category:sale', type: 'category', label: 'Sale' });
    expect(cmp.activeCategorySlug).toBe('');
    expect(loadProducts).toHaveBeenCalled();

    cmp.activeSubcategorySlug = 'kids';
    cmp.removeChip({ id: 'subcategory:kids', type: 'subcategory', label: 'Kids' });
    expect(cmp.activeSubcategorySlug).toBe('');

    cmp.removeChip({ id: 'price:25-150', type: 'price', label: '25-150' });
    expect(cmp.filters.min_price).toBe(cmp.priceMinBound);
    expect(cmp.filters.max_price).toBe(cmp.priceMaxBound);
    expect(applyFilters).toHaveBeenCalled();

    cmp.filters.search = 'camera';
    cmp.removeChip({ id: 'search:camera', type: 'search', label: 'camera' });
    expect(cmp.filters.search).toBe('');

    cmp.filters.tags = new Set(['vip']);
    cmp.removeChip({ id: 'tag:vip', type: 'tag', label: 'VIP', value: 'vip' });
    expect(cmp.filters.tags.has('vip')).toBeFalse();
  });

  it('canonicalizes URL state from legacy params and parent-child category slugs', () => {
    const fixture = TestBed.createComponent(ShopComponent);
    const cmp = fixture.componentInstance as any;
    cmp.categories = [
      { id: 'root', slug: 'root', name: 'Root', parent_id: null },
      { id: 'child', slug: 'child', name: 'Child', parent_id: 'root' }
    ];
    cmp.rebuildCategoryTree();

    const fromLegacyCat = cmp.syncStateFromUrl(null, { cat: 'child', q: 'query' });
    expect(fromLegacyCat).toBeTrue();
    expect(cmp.activeCategorySlug).toBe('root');
    expect(cmp.activeSubcategorySlug).toBe('child');
    expect(cmp.categorySelection).toBe('root');

    const fromInvalidSub = cmp.syncStateFromUrl('root', { sub: 'missing' });
    expect(fromInvalidSub).toBeTrue();
    expect(cmp.activeSubcategorySlug).toBe('');

    const fromLegacySale = cmp.syncStateFromUrl(null, { on_sale: 'yes', sub: 'child' });
    expect(fromLegacySale).toBeTrue();
    expect(cmp.activeCategorySlug).toBe('sale');
    expect(cmp.activeSubcategorySlug).toBe('');
    expect(cmp.categorySelection).toBe('sale');
  });

  it('parses query primitives and normalizes price ranges', () => {
    const fixture = TestBed.createComponent(ShopComponent);
    const cmp = fixture.componentInstance as any;

    expect(cmp.parseBoolean(true)).toBeTrue();
    expect(cmp.parseBoolean(1)).toBeTrue();
    expect(cmp.parseBoolean(' yes ')).toBeTrue();
    expect(cmp.parseBoolean(['true'])).toBeTrue();
    expect(cmp.parseBoolean('0')).toBeFalse();
    expect(cmp.parseBoolean(0)).toBeFalse();
    expect(cmp.parseBoolean('no')).toBeFalse();

    expect(cmp.parsePrice(25)).toBe(25);
    expect(cmp.parsePrice(' 12.5 ')).toBe(12.5);
    expect(cmp.parsePrice('')).toBeUndefined();
    expect(cmp.parsePrice('abc')).toBeUndefined();

    cmp.priceMinBound = 0;
    cmp.priceMaxBound = 200;
    cmp.priceStep = 5;

    cmp.filters.min_price = 210;
    cmp.filters.max_price = -10;
    cmp.normalizePriceRange();
    expect(cmp.filters.min_price).toBe(200);
    expect(cmp.filters.max_price).toBe(200);

    cmp.filters.min_price = 150;
    cmp.filters.max_price = 100;
    cmp.normalizePriceRange('max');
    expect(cmp.filters.min_price).toBe(100);
    expect(cmp.filters.max_price).toBe(100);
  });

  it('builds normalized query params and resolves catalog slugs', () => {
    const fixture = TestBed.createComponent(ShopComponent);
    const cmp = fixture.componentInstance as any;

    cmp.priceMinBound = 0;
    cmp.priceMaxBound = 200;
    cmp.priceStep = 5;

    cmp.activeCategorySlug = 'root';
    cmp.activeSubcategorySlug = 'child';
    cmp.filters.search = 'lens';
    cmp.filters.min_price = 25;
    cmp.filters.max_price = 180;
    cmp.filters.sort = 'price_desc';
    cmp.filters.page = 2;
    cmp.filters.tags = new Set(['vip', 'new']);

    const query = cmp.buildQueryParams();
    expect(query).toEqual(
      jasmine.objectContaining({
        q: 'lens',
        sub: 'child',
        min: 25,
        max: 180,
        sort: 'price_desc',
        page: 2,
        tags: 'vip,new',
      })
    );

    expect(cmp.resolveCatalogCategorySlug(false)).toBe('child');
    expect(cmp.resolveCatalogCategorySlug(true)).toBeUndefined();

    cmp.activeCategorySlug = 'sale';
    expect(cmp.buildQueryParams().sub).toBeUndefined();
  });

  it('handles product load errors for append/full paths and ignores stale responses', () => {
    const fixture = TestBed.createComponent(ShopComponent);
    const cmp = fixture.componentInstance as any;

    cmp.productsLoadSeq = 3;
    cmp.filters.page = 4;
    cmp.loading.set(true);
    cmp.loadingMore.set(true);
    cmp.handleProductsLoadError(2, false);
    expect(cmp.loading()).toBeTrue();
    expect(cmp.loadingMore()).toBeTrue();

    cmp.handleProductsLoadError(3, true);
    expect(cmp.filters.page).toBe(3);
    expect(cmp.loading()).toBeFalse();
    expect(cmp.loadingMore()).toBeFalse();
    expect(toast.error).toHaveBeenCalledWith('shop.errorTitle', 'shop.errorCopy');

    const clearBulkSelection = spyOn(cmp, 'clearBulkSelection').and.callThrough();
    cmp.products = [{ id: 'keep' }];
    cmp.pageMeta = { page: 1, total_pages: 2, total_items: 20, limit: 10 };
    cmp.bulkEditError = 'bad state';
    cmp.hasError.set(false);
    cmp.loading.set(true);
    cmp.loadingMore.set(true);
    cmp.handleProductsLoadError(3, false);

    expect(cmp.products).toEqual([]);
    expect(cmp.pageMeta).toBeNull();
    expect(cmp.bulkEditError).toBe('');
    expect(clearBulkSelection).toHaveBeenCalled();
    expect(cmp.hasError()).toBeTrue();
  });
});

function seedShopTranslations(translate: TranslateService): void {
  translate.setTranslation(
    'en',
    {
      shop: {
        metaTitle: 'EN title',
        metaDescription: 'EN desc',
        metaTitleCategory: 'EN title {{category}}',
        metaDescriptionCategory: 'EN desc {{category}}'
      }
    },
    true
  );
  translate.setTranslation(
    'ro',
    {
      shop: {
        metaTitle: 'RO title',
        metaDescription: 'RO desc',
        metaTitleCategory: 'RO title {{category}}',
        metaDescriptionCategory: 'RO desc {{category}}'
      }
    },
    true
  );
}
