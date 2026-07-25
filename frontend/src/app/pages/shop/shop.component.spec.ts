import { DOCUMENT } from '@angular/common';
import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ShopComponent } from './shop.component';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Title, Meta } from '@angular/platform-browser';
import { of, Subject } from 'rxjs';
import { CatalogService, Category, Product } from '../../core/catalog.service';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { ToastService } from '../../core/toast.service';
import { AdminService } from '../../core/admin.service';
import { StorefrontAdminModeService } from '../../core/storefront-admin-mode.service';
import { SeoHeadLinksService } from '../../core/seo-head-links.service';
import { StructuredDataService } from '../../core/structured-data.service';

describe('ShopComponent i18n meta', () => {
  let meta: jasmine.SpyObj<Meta>;
  let title: jasmine.SpyObj<Title>;
  let doc: Document;

  beforeEach(() => {
    meta = jasmine.createSpyObj<Meta>('Meta', ['updateTag']);
    title = jasmine.createSpyObj<Title>('Title', ['setTitle']);
    doc = document.implementation.createHTMLDocument('shop-seo-test');

    TestBed.configureTestingModule({
      imports: [ShopComponent, TranslateModule.forRoot()],
      providers: [
        { provide: Title, useValue: title },
        { provide: Meta, useValue: meta },
        {
          provide: CatalogService,
          useValue: {
            listProducts: () => of({ items: [], meta: null }),
            listCategories: () => of([]),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { data: {}, queryParams: {} },
            paramMap: of(convertToParamMap({})),
            queryParams: of({}),
          },
        },
        { provide: Router, useValue: { navigate: () => {} } },
        { provide: ToastService, useValue: { error: () => {} } },
        { provide: DOCUMENT, useValue: doc },
      ],
    });
  });

  it('updates meta tags based on current language', () => {
    const fixture = TestBed.createComponent(ShopComponent);
    const cmp = fixture.componentInstance as any;
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation(
      'en',
      {
        shop: {
          metaTitle: 'EN title',
          metaDescription: 'EN desc',
          metaTitleCategory: 'EN title {{category}}',
          metaDescriptionCategory: 'EN desc {{category}}',
        },
      },
      true,
    );
    translate.setTranslation(
      'ro',
      {
        shop: {
          metaTitle: 'RO title',
          metaDescription: 'RO desc',
          metaTitleCategory: 'RO title {{category}}',
          metaDescriptionCategory: 'RO desc {{category}}',
        },
      },
      true,
    );
    translate.use('en');

    cmp.setMetaTags();
    expect(title.setTitle).toHaveBeenCalledWith('EN title');
    expect(meta.updateTag).toHaveBeenCalledWith({ name: 'description', content: 'EN desc' });
    const canonicalEn = doc.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    expect(canonicalEn?.getAttribute('href')).toContain('/shop');
    expect(canonicalEn?.getAttribute('href')).not.toContain('lang=en');
    expect(doc.querySelectorAll('link[rel="alternate"][data-seo-managed="true"]').length).toBe(3);
    expect(doc.querySelector('script#seo-route-schema-1')?.textContent || '').toContain(
      '"CollectionPage"',
    );

    meta.updateTag.calls.reset();
    title.setTitle.calls.reset();
    cmp.activeCategorySlug = 'featured';
    cmp.categoriesBySlug.set('featured', { slug: 'featured', name: 'Featured' } as any);
    cmp.setMetaTags();
    expect(title.setTitle).toHaveBeenCalledWith('EN title Featured');
    expect(meta.updateTag).toHaveBeenCalledWith({
      name: 'description',
      content: 'EN desc Featured',
    });

    meta.updateTag.calls.reset();
    title.setTitle.calls.reset();
    cmp.activeCategorySlug = null;
    translate.use('ro');
    cmp.setMetaTags();
    expect(title.setTitle).toHaveBeenCalledWith('RO title');
    expect(meta.updateTag).toHaveBeenCalledWith({ name: 'description', content: 'RO desc' });
    const canonicalRo = doc.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    expect(canonicalRo?.getAttribute('href')).toContain('/shop?lang=ro');
  });

  it('ignores stale product list responses when multiple loads overlap', () => {
    const first$ = new Subject<any>();
    const second$ = new Subject<any>();
    const listProducts = jasmine
      .createSpy('listProducts')
      .and.returnValues(first$.asObservable(), second$.asObservable());
    const catalog = {
      listCategories: () => of([]),
      listProducts,
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ShopComponent, TranslateModule.forRoot()],
      providers: [
        { provide: Title, useValue: title },
        { provide: Meta, useValue: meta },
        { provide: CatalogService, useValue: catalog },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { data: {}, queryParams: {} },
            paramMap: of(convertToParamMap({})),
            queryParams: of({}),
          },
        },
        { provide: Router, useValue: { navigate: () => {} } },
        { provide: ToastService, useValue: { error: () => {} } },
      ],
    });

    const fixture = TestBed.createComponent(ShopComponent);
    const cmp = fixture.componentInstance as any;

    // Force two sequential loads; only the last should win.
    cmp.loadProducts(false);
    cmp.loadProducts(false);

    second$.next({
      items: [{ id: 'new', slug: 'new', name: 'New', base_price: 1, currency: 'RON', tags: [] }],
      meta: { total_items: 1, total_pages: 1, page: 1, limit: 20 },
    });
    second$.complete();

    expect(cmp.products.length).toBe(1);
    expect(cmp.products[0].id).toBe('new');

    first$.next({
      items: [{ id: 'old', slug: 'old', name: 'Old', base_price: 1, currency: 'RON', tags: [] }],
      meta: { total_items: 1, total_pages: 1, page: 1, limit: 20 },
    });
    first$.complete();

    expect(cmp.products.length).toBe(1);
    expect(cmp.products[0].id).toBe('new');
  });
});

// ---------------------------------------------------------------------------
// Comprehensive behavioral coverage for ShopComponent.
// ---------------------------------------------------------------------------

interface SetupOpts {
  enabled?: boolean;
  snapshotData?: Record<string, unknown>;
  paramMap?: unknown;
  queryParams?: unknown;
  productResponse?: unknown;
  categories?: Category[];
  routerUrl?: string;
}

function emptyResponse() {
  return { items: [] as Product[], meta: null, bounds: undefined };
}

function product(id: string, extra: Partial<Product> = {}): Product {
  return {
    id,
    slug: id,
    name: `Product ${id}`,
    base_price: 10,
    currency: 'RON',
    tags: [],
    ...extra,
  } as Product;
}

function cat(slug: string, extra: Partial<Category> = {}): Category {
  return {
    id: `id-${slug}`,
    slug,
    name: `Cat ${slug}`,
    parent_id: null,
    sort_order: 0,
    ...extra,
  } as Category;
}

function setup(opts: SetupOpts = {}) {
  const enabled: WritableSignal<boolean> = signal(opts.enabled ?? false);
  const storefront = { enabled } as unknown as StorefrontAdminModeService;

  const toast = jasmine.createSpyObj<ToastService>('ToastService', [
    'success',
    'error',
    'action',
    'info',
  ]);
  const seo = jasmine.createSpyObj<SeoHeadLinksService>('SeoHeadLinksService', [
    'setLocalizedCanonical',
  ]);
  seo.setLocalizedCanonical.and.returnValue('https://example.test/shop');
  const structured = jasmine.createSpyObj<StructuredDataService>('StructuredDataService', [
    'setRouteSchemas',
    'clearRouteSchemas',
  ]);
  const title = jasmine.createSpyObj<Title>('Title', ['setTitle']);
  const meta = jasmine.createSpyObj<Meta>('Meta', ['updateTag']);
  const router = jasmine.createSpyObj<Router>('Router', ['navigate']);
  router.navigate.and.returnValue(Promise.resolve(true));
  (router as unknown as { url: string }).url = opts.routerUrl ?? '/shop';

  const catalog = {
    listProducts: jasmine
      .createSpy('listProducts')
      .and.returnValue(of(opts.productResponse ?? emptyResponse())),
    listCategories: jasmine.createSpy('listCategories').and.returnValue(of(opts.categories ?? [])),
  };

  const admin = jasmine.createSpyObj<AdminService>('AdminService', [
    'bulkUpdateProducts',
    'createCategory',
    'updateCategory',
    'uploadCategoryImage',
    'previewMergeCategory',
    'mergeCategory',
    'upsertCategoryTranslation',
    'reorderCategories',
    'getCategoryTranslations',
    'previewDeleteCategory',
    'deleteCategory',
  ]);
  admin.bulkUpdateProducts.and.returnValue(of([]) as any);
  admin.createCategory.and.returnValue(of({ slug: 'created' }) as any);
  admin.updateCategory.and.returnValue(of({}) as any);
  admin.uploadCategoryImage.and.returnValue(of({}) as any);
  admin.previewMergeCategory.and.returnValue(
    of({ can_merge: true, product_count: 0, child_count: 0 }) as any,
  );
  admin.mergeCategory.and.returnValue(of({}) as any);
  admin.upsertCategoryTranslation.and.returnValue(of({}) as any);
  admin.reorderCategories.and.returnValue(of([]) as any);
  admin.getCategoryTranslations.and.returnValue(of([]) as any);
  admin.previewDeleteCategory.and.returnValue(
    of({ can_delete: true, product_count: 0, child_count: 0 }) as any,
  );
  admin.deleteCategory.and.returnValue(of({}) as any);

  const route = {
    snapshot: { data: opts.snapshotData ?? {}, queryParams: {} },
    paramMap: opts.paramMap ?? of(convertToParamMap({})),
    queryParams: opts.queryParams ?? of({}),
  };

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [ShopComponent, TranslateModule.forRoot()],
    providers: [
      { provide: Title, useValue: title },
      { provide: Meta, useValue: meta },
      { provide: CatalogService, useValue: catalog },
      { provide: ActivatedRoute, useValue: route },
      { provide: Router, useValue: router },
      { provide: ToastService, useValue: toast },
      { provide: AdminService, useValue: admin },
      { provide: StorefrontAdminModeService, useValue: storefront },
      { provide: SeoHeadLinksService, useValue: seo },
      { provide: StructuredDataService, useValue: structured },
    ],
  });

  const fixture = TestBed.createComponent(ShopComponent);
  const cmp = fixture.componentInstance as any;
  return {
    fixture,
    cmp,
    enabled,
    toast,
    seo,
    structured,
    title,
    meta,
    router,
    catalog,
    admin,
    route,
  };
}

function setCategories(cmp: any, categories: Category[]): void {
  cmp.categories = categories;
  cmp.rebuildCategoryTree();
}

function dragEvent(dt?: unknown, target?: unknown): DragEvent {
  return {
    dataTransfer:
      dt === undefined
        ? { setData() {}, setDragImage() {}, effectAllowed: '', dropEffect: '' }
        : dt,
    target: target === undefined ? document.createElement('div') : target,
    preventDefault() {},
    stopPropagation() {},
  } as unknown as DragEvent;
}

function fileEvent(file: File | null): Event {
  return {
    target: file
      ? ({ files: [file], value: 'x' } as unknown as HTMLInputElement)
      : ({ files: [], value: '' } as unknown as HTMLInputElement),
    preventDefault() {},
    stopPropagation() {},
  } as unknown as Event;
}

function checkboxEvent(checked: boolean): Event {
  return {
    target: { checked } as unknown as HTMLInputElement,
    preventDefault() {},
    stopPropagation() {},
  } as unknown as Event;
}

describe('ShopComponent behavior', () => {
  describe('constructor storefront edit-mode effect', () => {
    it('initializes, ignores no-op, reacts to enable and disable', () => {
      const { cmp, enabled, catalog } = setup({ enabled: false });
      TestBed.tick();
      expect(cmp.lastStorefrontEditMode).toBe(false);

      // Toggle to true then back to false within one flush -> effect re-runs once
      // with the value equal to the last recorded mode (early-return branch).
      enabled.set(true);
      enabled.set(false);
      TestBed.tick();
      expect(cmp.lastStorefrontEditMode).toBe(false);

      // Enable -> skips the !enabled reset block, still refreshes categories.
      catalog.listCategories.calls.reset();
      enabled.set(true);
      TestBed.tick();
      expect(cmp.lastStorefrontEditMode).toBe(true);
      expect(catalog.listCategories).toHaveBeenCalled();

      // Disable -> resets bulk state.
      cmp.bulkSelectMode.set(true);
      cmp.bulkStatus = 'draft';
      cmp.bulkSelectedProductIds.set(new Set(['x']));
      cmp.bulkEditError = 'err';
      enabled.set(false);
      TestBed.tick();
      expect(cmp.bulkSelectMode()).toBe(false);
      expect(cmp.bulkStatus).toBe('');
      expect(cmp.bulkSelectedCount()).toBe(0);
      expect(cmp.bulkEditError).toBe('');
    });
  });

  describe('ngOnInit / ngOnDestroy', () => {
    it('uses resolver category data when present', () => {
      const cats = [cat('a')];
      const { cmp, catalog } = setup({ snapshotData: { categories: cats } });
      cmp.ngOnInit();
      expect(cmp.categories).toBe(cats);
      // resolver path did not fetch categories on init
      expect(catalog.listCategories).not.toHaveBeenCalled();
      cmp.ngOnDestroy();
    });

    it('fetches categories when resolver provides none', () => {
      const { cmp, catalog } = setup();
      cmp.ngOnInit();
      expect(catalog.listCategories).toHaveBeenCalled();
      cmp.ngOnDestroy();
    });

    it('reloads meta and products on language change', () => {
      const { cmp, catalog } = setup();
      cmp.ngOnInit();
      const translate = TestBed.inject(TranslateService);
      catalog.listProducts.calls.reset();
      catalog.listCategories.calls.reset();
      translate.use('ro');
      expect(catalog.listCategories).toHaveBeenCalled();
      expect(catalog.listProducts).toHaveBeenCalled();
      cmp.ngOnDestroy();
    });

    it('honors suppressNextUrlSync, canonicalize, and normal url sync', () => {
      const paramMap = new Subject<any>();
      const queryParams = new Subject<any>();
      const { cmp, catalog } = setup({ paramMap, queryParams });
      setCategories(cmp, [cat('a')]);
      cmp.ngOnInit();

      // suppress branch
      cmp.suppressNextUrlSync = true;
      catalog.listProducts.calls.reset();
      paramMap.next(convertToParamMap({}));
      queryParams.next({});
      expect(cmp.suppressNextUrlSync).toBe(false);
      expect(catalog.listProducts).not.toHaveBeenCalled();

      // canonicalize branch (legacy ?cat= triggers canonicalization)
      catalog.listProducts.calls.reset();
      paramMap.next(convertToParamMap({}));
      queryParams.next({ cat: 'a' });
      expect(catalog.listProducts).toHaveBeenCalled();

      // normal branch
      catalog.listProducts.calls.reset();
      paramMap.next(convertToParamMap({ category: 'a' }));
      queryParams.next({});
      expect(catalog.listProducts).toHaveBeenCalled();
      cmp.ngOnDestroy();
    });
  });

  describe('quick view + product navigation', () => {
    it('opens and closes quick view, ignoring blank slugs', () => {
      const { cmp } = setup();
      cmp.openQuickView('  ');
      expect(cmp.quickViewOpen).toBe(false);
      cmp.openQuickView('abc');
      expect(cmp.quickViewOpen).toBe(true);
      expect(cmp.quickViewSlug).toBe('abc');
      cmp.closeQuickView();
      expect(cmp.quickViewOpen).toBe(false);
      expect(cmp.quickViewSlug).toBe('');
    });

    it('viewProduct ignores blanks and navigates otherwise', () => {
      const { cmp, router } = setup();
      cmp.viewProduct('');
      expect(router.navigate).not.toHaveBeenCalled();
      cmp.quickViewOpen = true;
      cmp.viewProduct('thing');
      expect(cmp.quickViewOpen).toBe(false);
      expect(router.navigate).toHaveBeenCalledWith(['/products', 'thing']);
    });
  });

  describe('canReorderProducts', () => {
    function reorderReady() {
      const ctx = setup({ enabled: true });
      const { cmp } = ctx;
      setCategories(cmp, [cat('leaf')]);
      cmp.activeCategorySlug = 'leaf';
      cmp.filters.sort = 'recommended';
      cmp.loading.set(false);
      cmp.hasError.set(false);
      cmp.products = [product('1'), product('2')];
      cmp.pageMeta = { total_items: 2, total_pages: 1, page: 1, limit: 12 };
      return ctx;
    }

    it('returns true when fully loaded single page', () => {
      const { cmp } = reorderReady();
      expect(cmp.canReorderProducts()).toBe(true);
    });

    it('false when admin mode disabled', () => {
      const { cmp, enabled } = reorderReady();
      enabled.set(false);
      expect(cmp.canReorderProducts()).toBe(false);
    });

    it('false in bulk select mode', () => {
      const { cmp } = reorderReady();
      cmp.bulkSelectMode.set(true);
      expect(cmp.canReorderProducts()).toBe(false);
    });

    it('false while reordering / loading / error / non-recommended sort', () => {
      let ctx = reorderReady();
      ctx.cmp.productReorderSaving.set(true);
      expect(ctx.cmp.canReorderProducts()).toBe(false);

      ctx = reorderReady();
      ctx.cmp.loading.set(true);
      expect(ctx.cmp.canReorderProducts()).toBe(false);

      ctx = reorderReady();
      ctx.cmp.hasError.set(true);
      expect(ctx.cmp.canReorderProducts()).toBe(false);

      ctx = reorderReady();
      ctx.cmp.filters.sort = 'newest';
      expect(ctx.cmp.canReorderProducts()).toBe(false);
    });

    it('false without a leaf category', () => {
      const { cmp } = reorderReady();
      cmp.activeCategorySlug = '';
      expect(cmp.canReorderProducts()).toBe(false);
    });

    it('false without page meta', () => {
      const { cmp } = reorderReady();
      cmp.pageMeta = null;
      expect(cmp.canReorderProducts()).toBe(false);
    });

    it('false for invalid pagination numbers', () => {
      let ctx = reorderReady();
      ctx.cmp.pageMeta = { total_items: 2, total_pages: 0, page: 1, limit: 12 };
      expect(ctx.cmp.canReorderProducts()).toBe(false);

      ctx = reorderReady();
      ctx.cmp.pageMeta = { total_items: 2, total_pages: 2, page: 0, limit: 12 };
      expect(ctx.cmp.canReorderProducts()).toBe(false);

      ctx = reorderReady();
      ctx.cmp.pageMeta = { total_items: -1, total_pages: 1, page: 1, limit: 12 };
      expect(ctx.cmp.canReorderProducts()).toBe(false);
    });

    it('false when not all pages loaded; true via load_more completion', () => {
      const { cmp } = reorderReady();
      cmp.pageMeta = { total_items: 4, total_pages: 2, page: 1, limit: 2 };
      expect(cmp.canReorderProducts()).toBe(false);

      cmp.paginationMode = 'load_more';
      cmp.products = [product('1'), product('2'), product('3'), product('4')];
      cmp.pageMeta = { total_items: 4, total_pages: 2, page: 2, limit: 2 };
      expect(cmp.canReorderProducts()).toBe(true);
    });

    it('false with a single product', () => {
      const { cmp } = reorderReady();
      cmp.products = [product('1')];
      cmp.pageMeta = { total_items: 1, total_pages: 1, page: 1, limit: 12 };
      expect(cmp.canReorderProducts()).toBe(false);
    });

    it('activeLeafCategorySlug variants', () => {
      const { cmp } = setup({ enabled: true });
      expect(cmp.activeLeafCategorySlug()).toBeNull();
      cmp.activeCategorySlug = 'sale';
      expect(cmp.activeLeafCategorySlug()).toBeNull();

      setCategories(cmp, [cat('parent'), cat('child', { parent_id: 'id-parent' })]);
      cmp.activeCategorySlug = 'parent';
      cmp.activeSubcategorySlug = 'child';
      expect(cmp.activeLeafCategorySlug()).toBe('child');

      cmp.activeSubcategorySlug = '';
      cmp.activeCategorySlug = 'missing';
      expect(cmp.activeLeafCategorySlug()).toBeNull();

      cmp.activeCategorySlug = 'parent';
      expect(cmp.activeLeafCategorySlug()).toBeNull(); // has children

      setCategories(cmp, [cat('solo')]);
      cmp.activeCategorySlug = 'solo';
      expect(cmp.activeLeafCategorySlug()).toBe('solo');
    });
  });

  describe('product drag & drop reorder', () => {
    function ready() {
      const ctx = setup({ enabled: true });
      const { cmp } = ctx;
      setCategories(cmp, [cat('leaf')]);
      cmp.activeCategorySlug = 'leaf';
      cmp.filters.sort = 'recommended';
      cmp.loading.set(false);
      cmp.hasError.set(false);
      cmp.products = [product('1'), product('2'), product('3')];
      cmp.pageMeta = { total_items: 3, total_pages: 1, page: 1, limit: 12 };
      return ctx;
    }

    it('dragstart guards and success + catch', () => {
      const { cmp } = ready();
      cmp.draggingProductId = null;
      // not reorderable
      cmp.loading.set(true);
      cmp.onProductDragStart(dragEvent(), '1');
      expect(cmp.draggingProductId).toBeNull();
      cmp.loading.set(false);
      // blank id
      cmp.onProductDragStart(dragEvent(), '   ');
      expect(cmp.draggingProductId).toBeNull();
      // success
      cmp.onProductDragStart(dragEvent(), '1');
      expect(cmp.draggingProductId).toBe('1');
      // catch path (null dataTransfer throws on effectAllowed set)
      cmp.draggingProductId = null;
      cmp.onProductDragStart(dragEvent(null), '2');
      expect(cmp.draggingProductId).toBe('2');
    });

    it('dragover guards and success', () => {
      const { cmp } = ready();
      cmp.draggingProductId = '1';
      // not reorderable
      cmp.loading.set(true);
      cmp.onProductDragOver(dragEvent(), '2');
      expect(cmp.dragOverProductId).toBeNull();
      cmp.loading.set(false);
      // no dragging
      cmp.draggingProductId = null;
      cmp.onProductDragOver(dragEvent(), '2');
      expect(cmp.dragOverProductId).toBeNull();
      // over blank / same
      cmp.draggingProductId = '1';
      cmp.onProductDragOver(dragEvent(), '   ');
      cmp.onProductDragOver(dragEvent(), '1');
      expect(cmp.dragOverProductId).toBeNull();
      // success
      cmp.onProductDragOver(dragEvent(), '2');
      expect(cmp.dragOverProductId).toBe('2');
      // dataTransfer present without exception still fine
      cmp.onProductDragOver(dragEvent({ dropEffect: '' }), '3');
      expect(cmp.dragOverProductId).toBe('3');
    });

    it('drop reorders and persists (success)', () => {
      const { cmp, admin, toast } = ready();
      cmp.draggingProductId = '1';
      cmp.onProductDrop(dragEvent(), '3');
      expect(admin.bulkUpdateProducts).toHaveBeenCalled();
      expect(cmp.products.map((p: Product) => p.id)).toEqual(['2', '3', '1']);
      // success toast with undo action
      expect(toast.action).toHaveBeenCalled();
      const undo = toast.action.calls.mostRecent().args[2];
      undo();
      expect(admin.bulkUpdateProducts).toHaveBeenCalledTimes(2);
    });

    it('drop error restores order', () => {
      const { cmp, admin, toast } = ready();
      admin.bulkUpdateProducts.and.returnValue(new Subject<any>().asObservable().pipe() as any);
      admin.bulkUpdateProducts.and.callFake(() => {
        return { subscribe: (h: any) => h.error(new Error('x')) } as any;
      });
      cmp.draggingProductId = '1';
      cmp.onProductDrop(dragEvent(), '2');
      expect(toast.error).toHaveBeenCalled();
      expect(cmp.products.map((p: Product) => p.id)).toEqual(['1', '2', '3']);
    });

    it('drop guards: not reorderable / no from / saving / same / no move', () => {
      const { cmp, admin } = ready();
      cmp.loading.set(true);
      cmp.onProductDrop(dragEvent(), '2');
      cmp.loading.set(false);

      cmp.draggingProductId = null;
      cmp.onProductDrop(dragEvent(), '2');

      cmp.draggingProductId = '1';
      cmp.productReorderSaving.set(true);
      cmp.onProductDrop(dragEvent(), '2');
      cmp.productReorderSaving.set(false);

      cmp.draggingProductId = '1';
      cmp.onProductDrop(dragEvent(), '1'); // same -> return
      cmp.onProductDrop(dragEvent(), '   '); // blank -> return

      cmp.draggingProductId = 'nope';
      cmp.onProductDrop(dragEvent(), '2'); // reorder returns false
      expect(admin.bulkUpdateProducts).not.toHaveBeenCalled();
    });

    it('pinProductToTop success, guards and error', () => {
      const { cmp, admin, toast } = ready();
      // guards
      cmp.loading.set(true);
      cmp.pinProductToTop('3');
      cmp.loading.set(false);
      cmp.productReorderSaving.set(true);
      cmp.pinProductToTop('3');
      cmp.productReorderSaving.set(false);
      cmp.pinProductToTop('   ');
      cmp.pinProductToTop('1'); // already first
      expect(admin.bulkUpdateProducts).not.toHaveBeenCalled();

      // success
      cmp.pinProductToTop('3');
      expect(cmp.products[0].id).toBe('3');
      const undo = toast.action.calls.mostRecent().args[2];
      undo();

      // error
      admin.bulkUpdateProducts.and.callFake(
        () => ({ subscribe: (h: any) => h.error(new Error('x')) }) as any,
      );
      const before = cmp.products.map((p: Product) => p.id);
      cmp.pinProductToTop(before[2]);
      expect(toast.error).toHaveBeenCalled();
    });

    it('pinProductToTop returns when reorder makes no move (missing id)', () => {
      const { cmp, admin } = ready();
      cmp.pinProductToTop('ghost');
      expect(admin.bulkUpdateProducts).not.toHaveBeenCalled();
    });

    it('dragend clears state; restoreProductOrder handles empty', () => {
      const { cmp } = ready();
      cmp.draggingProductId = '1';
      cmp.dragOverProductId = '2';
      cmp.onProductDragEnd();
      expect(cmp.draggingProductId).toBeNull();
      expect(cmp.dragOverProductId).toBeNull();
      cmp.restoreProductOrder([]); // no-op branch
    });
  });

  describe('bulk product editing', () => {
    function ready() {
      const ctx = setup({ enabled: true });
      ctx.cmp.products = [product('1'), product('2')];
      ctx.cmp.bulkSelectMode.set(true);
      return ctx;
    }

    it('toggle mode guards and resets on close', () => {
      const { cmp, enabled } = setup({ enabled: false });
      cmp.toggleBulkSelectMode();
      expect(cmp.bulkSelectMode()).toBe(false);
      enabled.set(true);
      cmp.toggleBulkSelectMode();
      expect(cmp.bulkSelectMode()).toBe(true);
      cmp.bulkSelectedProductIds.set(new Set(['1']));
      cmp.toggleBulkSelectMode();
      expect(cmp.bulkSelectMode()).toBe(false);
      expect(cmp.bulkSelectedCount()).toBe(0);
    });

    it('bulkHasPendingEdits reflects fields', () => {
      const { cmp } = ready();
      expect(cmp.bulkHasPendingEdits()).toBe(false);
      cmp.bulkStatus = 'draft';
      expect(cmp.bulkHasPendingEdits()).toBe(true);
      cmp.bulkStatus = '';
      cmp.bulkCategoryId = 'c';
      expect(cmp.bulkHasPendingEdits()).toBe(true);
      cmp.bulkCategoryId = '';
      cmp.bulkFeatured = 'true';
      expect(cmp.bulkHasPendingEdits()).toBe(true);
    });

    it('select / toggle / clear / select all', () => {
      const { cmp } = ready();
      // toggle off when not in mode
      cmp.bulkSelectMode.set(false);
      cmp.toggleBulkSelected(checkboxEvent(true), '1');
      expect(cmp.bulkIsSelected('1')).toBe(false);
      cmp.bulkSelectMode.set(true);
      // saving guard
      cmp.bulkSaving.set(true);
      cmp.toggleBulkSelected(checkboxEvent(true), '1');
      expect(cmp.bulkIsSelected('1')).toBe(false);
      cmp.bulkSaving.set(false);
      // add then remove
      cmp.toggleBulkSelected(checkboxEvent(true), '1');
      expect(cmp.bulkIsSelected('1')).toBe(true);
      cmp.toggleBulkSelected(checkboxEvent(false), '1');
      expect(cmp.bulkIsSelected('1')).toBe(false);
      // select all (with a product missing id)
      cmp.products = [product('1'), { id: '' } as Product, product('2')];
      cmp.selectAllProductsOnPage();
      expect(cmp.bulkSelectedCount()).toBe(2);
      cmp.clearBulkSelection();
      expect(cmp.bulkSelectedCount()).toBe(0);
      // select all guards
      cmp.bulkSelectMode.set(false);
      cmp.selectAllProductsOnPage();
      cmp.bulkSelectMode.set(true);
      cmp.products = [];
      cmp.selectAllProductsOnPage();
      expect(cmp.bulkSelectedCount()).toBe(0);
    });

    it('applyBulkProductEdits guard paths', () => {
      const { cmp, enabled, admin } = ready();
      // no selection
      cmp.applyBulkProductEdits();
      expect(cmp.bulkEditError).toBeTruthy();
      // no pending changes
      cmp.bulkSelectedProductIds.set(new Set(['1']));
      cmp.applyBulkProductEdits();
      expect(cmp.bulkEditError).toBeTruthy();
      expect(admin.bulkUpdateProducts).not.toHaveBeenCalled();
      // not editable
      enabled.set(false);
      cmp.applyBulkProductEdits();
      enabled.set(true);
      // not in mode
      cmp.bulkSelectMode.set(false);
      cmp.applyBulkProductEdits();
      cmp.bulkSelectMode.set(true);
      // saving
      cmp.bulkSaving.set(true);
      cmp.applyBulkProductEdits();
      cmp.bulkSaving.set(false);
      expect(admin.bulkUpdateProducts).not.toHaveBeenCalled();
    });

    it('applyBulkProductEdits success applies status + featured', () => {
      const { cmp, admin, toast } = ready();
      cmp.products = [product('1'), product('2'), { id: '' } as Product];
      cmp.bulkSelectedProductIds.set(new Set(['1']));
      cmp.bulkStatus = 'published';
      cmp.bulkCategoryId = 'cat-1';
      cmp.bulkFeatured = 'true';
      cmp.applyBulkProductEdits();
      const updates = admin.bulkUpdateProducts.calls.mostRecent().args[0] as any[];
      expect(updates[0]).toEqual(
        jasmine.objectContaining({
          product_id: '1',
          status: 'published',
          category_id: 'cat-1',
          is_featured: true,
        }),
      );
      expect(cmp.products[0].status).toBe('published');
      expect(cmp.products[0].is_featured).toBe(true);
      expect(toast.success).toHaveBeenCalled();
      expect(cmp.bulkSelectedCount()).toBe(0);
    });

    it('applyBulkProductEdits featured=false branch', () => {
      const { cmp, admin } = ready();
      cmp.bulkSelectedProductIds.set(new Set(['1']));
      cmp.bulkFeatured = 'false';
      cmp.applyBulkProductEdits();
      const updates = admin.bulkUpdateProducts.calls.mostRecent().args[0] as any[];
      expect(updates[0].is_featured).toBe(false);
    });

    it('applyBulkProductEdits invalid featured token -> null', () => {
      const { cmp, admin } = ready();
      cmp.bulkSelectedProductIds.set(new Set(['1']));
      cmp.bulkStatus = 'draft';
      cmp.bulkFeatured = 'weird';
      cmp.applyBulkProductEdits();
      const updates = admin.bulkUpdateProducts.calls.mostRecent().args[0] as any[];
      expect('is_featured' in updates[0]).toBe(false);
    });

    it('applyBulkProductEdits error toast', () => {
      const { cmp, admin, toast } = ready();
      admin.bulkUpdateProducts.and.callFake(
        () => ({ subscribe: (h: any) => h.error(new Error('x')) }) as any,
      );
      cmp.bulkSelectedProductIds.set(new Set(['1']));
      cmp.bulkStatus = 'draft';
      cmp.applyBulkProductEdits();
      expect(toast.error).toHaveBeenCalled();
      expect(cmp.bulkSaving()).toBe(false);
    });

    it('bulkCategoryOptions and bulkCategoryLabel build hierarchy', () => {
      const { cmp } = ready();
      setCategories(cmp, [
        cat('root'),
        cat('child', { parent_id: 'id-root' }),
        cat('grand', { parent_id: 'id-child' }),
      ]);
      const options = cmp.bulkCategoryOptions();
      expect(options.length).toBe(3);
      const grand = options.find((c: Category) => c.slug === 'grand');
      expect(cmp.bulkCategoryLabel(grand)).toBe('Cat root / Cat child / Cat grand');
    });

    it('bulkCategoryLabel handles cyclic parent ids safely', () => {
      const { cmp } = ready();
      const a = cat('a', { parent_id: 'id-b' });
      const b = cat('b', { parent_id: 'id-a' });
      cmp.categoriesById.set('id-a', a);
      cmp.categoriesById.set('id-b', b);
      expect(cmp.bulkCategoryLabel(a)).toBe('Cat b / Cat a');
    });
  });

  describe('root category drag reorder', () => {
    function ready() {
      const ctx = setup({ enabled: true });
      setCategories(ctx.cmp, [cat('a'), cat('b'), cat('c')]);
      return ctx;
    }

    it('dragstart guards', () => {
      const { cmp, enabled } = ready();
      enabled.set(false);
      cmp.onRootCategoryDragStart(dragEvent(), 'a');
      expect(cmp.draggingRootCategorySlug).toBeNull();
      enabled.set(true);
      cmp.reorderSaving.set(true);
      cmp.onRootCategoryDragStart(dragEvent(), 'a');
      cmp.reorderSaving.set(false);
      cmp.renameSaving = true;
      cmp.onRootCategoryDragStart(dragEvent(), 'a');
      cmp.renameSaving = false;
      cmp.creatingCategoryParentSlug = '';
      cmp.onRootCategoryDragStart(dragEvent(), 'a');
      cmp.creatingCategoryParentSlug = null;
      cmp.editingCategorySlug = 'a';
      cmp.onRootCategoryDragStart(dragEvent(), 'a');
      cmp.editingCategorySlug = '';
      cmp.onRootCategoryDragStart(dragEvent(), '   ');
      expect(cmp.draggingRootCategorySlug).toBeNull();
    });

    it('dragstart success variants + catch', () => {
      const { cmp } = ready();
      cmp.onRootCategoryDragStart(dragEvent(), 'a');
      expect(cmp.draggingRootCategorySlug).toBe('a');
      // target null -> new Image() fallback
      cmp.onRootCategoryDragStart(dragEvent(undefined, null), 'b');
      expect(cmp.draggingRootCategorySlug).toBe('b');
      // dataTransfer without setDragImage -> optional-call short circuit
      cmp.onRootCategoryDragStart(dragEvent({ setData() {}, effectAllowed: '' }), 'c');
      expect(cmp.draggingRootCategorySlug).toBe('c');
      // catch
      cmp.onRootCategoryDragStart(dragEvent(null), 'a');
      expect(cmp.draggingRootCategorySlug).toBe('a');
    });

    it('dragover guards and success', () => {
      const { cmp } = ready();
      cmp.draggingRootCategorySlug = 'a';
      // no dragging
      cmp.draggingRootCategorySlug = null;
      cmp.onRootCategoryDragOver(dragEvent(), 'b');
      expect(cmp.dragOverRootCategorySlug).toBeNull();
      cmp.draggingRootCategorySlug = 'a';
      // saving
      cmp.reorderSaving.set(true);
      cmp.onRootCategoryDragOver(dragEvent(), 'b');
      cmp.reorderSaving.set(false);
      // blank / same
      cmp.onRootCategoryDragOver(dragEvent(), '  ');
      cmp.onRootCategoryDragOver(dragEvent(), 'a');
      expect(cmp.dragOverRootCategorySlug).toBeNull();
      // success
      cmp.onRootCategoryDragOver(dragEvent(), 'b');
      expect(cmp.dragOverRootCategorySlug).toBe('b');
      // no dataTransfer branch
      cmp.onRootCategoryDragOver(dragEvent(null), 'c');
      expect(cmp.dragOverRootCategorySlug).toBe('c');
    });

    it('dragover disabled guard', () => {
      const { cmp, enabled } = ready();
      cmp.draggingRootCategorySlug = 'a';
      enabled.set(false);
      cmp.onRootCategoryDragOver(dragEvent(), 'b');
      expect(cmp.dragOverRootCategorySlug).toBeNull();
    });

    it('drop guards and success persistence', () => {
      const { cmp, enabled, admin, toast } = ready();
      enabled.set(false);
      cmp.onRootCategoryDrop(dragEvent(), 'b');
      enabled.set(true);
      cmp.draggingRootCategorySlug = null;
      cmp.onRootCategoryDrop(dragEvent(), 'b');
      cmp.draggingRootCategorySlug = 'a';
      cmp.reorderSaving.set(true);
      cmp.onRootCategoryDrop(dragEvent(), 'b');
      cmp.reorderSaving.set(false);
      cmp.onRootCategoryDrop(dragEvent(), 'a'); // same
      cmp.onRootCategoryDrop(dragEvent(), '  '); // blank
      cmp.draggingRootCategorySlug = 'ghost';
      cmp.onRootCategoryDrop(dragEvent(), 'b'); // no move
      expect(admin.reorderCategories).not.toHaveBeenCalled();

      cmp.draggingRootCategorySlug = 'a';
      admin.reorderCategories.and.returnValue(
        of([{ slug: 'a', sort_order: 2 }, { slug: 'no-order' }]) as any,
      );
      cmp.onRootCategoryDrop(dragEvent(), 'c');
      expect(admin.reorderCategories).toHaveBeenCalled();
      expect(toast.action).toHaveBeenCalled();
      const undo = toast.action.calls.mostRecent().args[2];
      undo();
    });

    it('drop persistence error restores order', () => {
      const { cmp, admin, toast } = ready();
      admin.reorderCategories.and.callFake(
        () => ({ subscribe: (h: any) => h.error(new Error('x')) }) as any,
      );
      cmp.draggingRootCategorySlug = 'a';
      cmp.onRootCategoryDrop(dragEvent(), 'b');
      expect(toast.error).toHaveBeenCalled();
    });

    it('dragend resets', () => {
      const { cmp } = ready();
      cmp.draggingRootCategorySlug = 'a';
      cmp.dragOverRootCategorySlug = 'b';
      cmp.onRootCategoryDragEnd();
      expect(cmp.draggingRootCategorySlug).toBeNull();
      expect(cmp.dragOverRootCategorySlug).toBeNull();
    });

    it('persistRootCategoryOrder guards (saving, empty)', () => {
      const { cmp, admin } = ready();
      cmp.reorderSaving.set(true);
      cmp.persistRootCategoryOrder(['a']);
      cmp.reorderSaving.set(false);
      cmp.rootCategories = [];
      cmp.persistRootCategoryOrder([]);
      expect(admin.reorderCategories).not.toHaveBeenCalled();
    });

    it('undoRootCategoryOrder success/guards/error', () => {
      const { cmp, admin, toast } = ready();
      cmp.reorderSaving.set(true);
      cmp.undoRootCategoryOrder(['a'], ['b']);
      cmp.reorderSaving.set(false);
      cmp.undoRootCategoryOrder([], []); // empty payload
      expect(admin.reorderCategories).not.toHaveBeenCalled();

      admin.reorderCategories.and.returnValue(
        of([{ slug: 'a', sort_order: 0 }, { slug: 'x' }]) as any,
      );
      cmp.undoRootCategoryOrder(['a', 'b'], ['b', 'a']);
      expect(toast.success).toHaveBeenCalled();

      admin.reorderCategories.and.callFake(
        () => ({ subscribe: (h: any) => h.error(new Error('x')) }) as any,
      );
      cmp.undoRootCategoryOrder(['a', 'b'], ['b', 'a']);
      expect(toast.error).toHaveBeenCalled();
    });

    it('undoProductOrder success/guards/error', () => {
      const { cmp, admin, toast } = ready();
      cmp.products = [product('1'), product('2')];
      cmp.productReorderSaving.set(true);
      cmp.undoProductOrder(['1'], ['2']);
      cmp.productReorderSaving.set(false);
      cmp.undoProductOrder([], []);
      expect(admin.bulkUpdateProducts).not.toHaveBeenCalled();

      cmp.undoProductOrder(['2', '1'], ['1', '2']);
      expect(toast.success).toHaveBeenCalled();

      admin.bulkUpdateProducts.and.callFake(
        () => ({ subscribe: (h: any) => h.error(new Error('x')) }) as any,
      );
      cmp.undoProductOrder(['1', '2'], ['2', '1']);
      expect(toast.error).toHaveBeenCalled();
    });
  });

  describe('category visibility / rename / create / image', () => {
    function ready() {
      const ctx = setup({ enabled: true });
      setCategories(ctx.cmp, [cat('a'), cat('b')]);
      return ctx;
    }

    it('toggleCategoryVisibility guards', () => {
      const { cmp, enabled, admin } = ready();
      enabled.set(false);
      cmp.toggleCategoryVisibility(dragEvent(), cat('a'));
      enabled.set(true);
      cmp.reorderSaving.set(true);
      cmp.toggleCategoryVisibility(dragEvent(), cat('a'));
      cmp.reorderSaving.set(false);
      cmp.renameSaving = true;
      cmp.toggleCategoryVisibility(dragEvent(), cat('a'));
      cmp.renameSaving = false;
      cmp.createSaving = true;
      cmp.toggleCategoryVisibility(dragEvent(), cat('a'));
      cmp.createSaving = false;
      cmp.visibilitySavingSlug = 'a';
      cmp.toggleCategoryVisibility(dragEvent(), cat('a'));
      cmp.visibilitySavingSlug = null;
      cmp.toggleCategoryVisibility(dragEvent(), cat(''));
      expect(admin.updateCategory).not.toHaveBeenCalled();
    });

    it('toggleCategoryVisibility success (visible->hidden) and error', () => {
      const { cmp, admin, toast } = ready();
      cmp.toggleCategoryVisibility(dragEvent(), cat('a', { is_visible: true }));
      expect(admin.updateCategory).toHaveBeenCalledWith(
        'a',
        { is_visible: false },
        { source: 'storefront' },
      );
      expect(toast.success).toHaveBeenCalled();

      admin.updateCategory.and.callFake(
        () => ({ subscribe: (h: any) => h.error(new Error('x')) }) as any,
      );
      cmp.toggleCategoryVisibility(dragEvent(), cat('b', { is_visible: false }));
      expect(toast.error).toHaveBeenCalled();
    });

    it('startRenameCategory guards and toggle-off', () => {
      const { cmp, enabled, admin } = ready();
      enabled.set(false);
      cmp.startRenameCategory(dragEvent(), cat('a'));
      enabled.set(true);
      cmp.reorderSaving.set(true);
      cmp.startRenameCategory(dragEvent(), cat('a'));
      cmp.reorderSaving.set(false);
      cmp.startRenameCategory(dragEvent(), cat('')); // blank slug
      expect(admin.getCategoryTranslations).not.toHaveBeenCalled();
      // open then toggle off
      cmp.startRenameCategory(dragEvent(), cat('a'));
      expect(cmp.editingCategorySlug).toBe('a');
      cmp.startRenameCategory(dragEvent(), cat('a'));
      expect(cmp.editingCategorySlug).toBe('');
    });

    it('startRenameCategory loads translations (found)', () => {
      const { cmp, admin } = ready();
      admin.getCategoryTranslations.and.returnValue(
        of([
          { lang: 'ro', name: 'Nume' },
          { lang: 'en', name: 'Name' },
        ]) as any,
      );
      cmp.startRenameCategory(dragEvent(), cat('a'));
      expect(cmp.renameNameRo).toBe('Nume');
      expect(cmp.renameNameEn).toBe('Name');
      expect(cmp.renameLoading).toBe(false);
    });

    it('startRenameCategory fallback to category name (ro lang)', () => {
      const { cmp, admin } = ready();
      TestBed.inject(TranslateService).use('ro');
      admin.getCategoryTranslations.and.returnValue(of([]) as any);
      cmp.startRenameCategory(dragEvent(), cat('a', { name: 'Doar Ro' }));
      expect(cmp.renameNameRo).toBe('Doar Ro');
      expect(cmp.renameNameEn).toBe('');
    });

    it('startRenameCategory fallback when both empty defaults to RO', () => {
      const { cmp, admin } = ready();
      TestBed.inject(TranslateService).use('en');
      admin.getCategoryTranslations.and.returnValue(of([]) as any);
      cmp.startRenameCategory(dragEvent(), cat('a', { name: '' }));
      expect(cmp.renameNameRo).toBe('');
      expect(cmp.renameNameEn).toBe('');
    });

    it('startRenameCategory error path sets error + en lang', () => {
      const { cmp, admin } = ready();
      TestBed.inject(TranslateService).use('en');
      admin.getCategoryTranslations.and.callFake(
        () => ({ subscribe: (h: any) => h.error(new Error('x')) }) as any,
      );
      cmp.startRenameCategory(dragEvent(), cat('a', { name: 'Fallback' }));
      expect(cmp.renameNameEn).toBe('Fallback');
      expect(cmp.renameError).toBeTruthy();
    });

    it('canSaveRename', () => {
      const { cmp } = ready();
      cmp.renameLoading = true;
      expect(cmp.canSaveRename()).toBe(false);
      cmp.renameLoading = false;
      cmp.renameNameRo = 'a';
      cmp.renameNameEn = '';
      expect(cmp.canSaveRename()).toBe(false);
      cmp.renameNameEn = 'b';
      expect(cmp.canSaveRename()).toBe(true);
    });

    it('saveRenameCategory guards + validation + success + error', () => {
      const { cmp, enabled, admin, toast } = ready();
      enabled.set(false);
      cmp.saveRenameCategory();
      enabled.set(true);
      cmp.renameSaving = true;
      cmp.saveRenameCategory();
      cmp.renameSaving = false;
      cmp.editingCategorySlug = '';
      cmp.saveRenameCategory(); // blank slug
      cmp.editingCategorySlug = 'a';
      cmp.renameNameRo = '';
      cmp.renameNameEn = '';
      cmp.saveRenameCategory();
      expect(cmp.renameError).toBeTruthy();
      expect(admin.updateCategory).not.toHaveBeenCalled();

      cmp.renameNameRo = 'Ro';
      cmp.renameNameEn = 'En';
      cmp.saveRenameCategory();
      expect(admin.updateCategory).toHaveBeenCalled();
      expect(admin.upsertCategoryTranslation).toHaveBeenCalledTimes(2);
      expect(toast.success).toHaveBeenCalled();

      cmp.editingCategorySlug = 'a';
      cmp.renameNameRo = 'Ro';
      cmp.renameNameEn = 'En';
      admin.updateCategory.and.callFake(
        () =>
          ({
            pipe: () => ({ subscribe: (h: any) => h.error(new Error('x')) }),
          }) as any,
      );
      cmp.saveRenameCategory();
      expect(cmp.renameError).toBeTruthy();
    });

    it('onCategoryImageSelected guards / success / error', () => {
      const { cmp, enabled, admin, toast } = ready();
      // no file
      cmp.onCategoryImageSelected(fileEvent(null), 'a', 'thumbnail');
      expect(admin.uploadCategoryImage).not.toHaveBeenCalled();
      const file = new File(['x'], 'x.png', { type: 'image/png' });
      enabled.set(false);
      cmp.onCategoryImageSelected(fileEvent(file), 'a', 'thumbnail');
      enabled.set(true);
      cmp.reorderSaving.set(true);
      cmp.onCategoryImageSelected(fileEvent(file), 'a', 'thumbnail');
      cmp.reorderSaving.set(false);
      cmp.renameSaving = true;
      cmp.onCategoryImageSelected(fileEvent(file), 'a', 'thumbnail');
      cmp.renameSaving = false;
      cmp.createSaving = true;
      cmp.onCategoryImageSelected(fileEvent(file), 'a', 'thumbnail');
      cmp.createSaving = false;
      cmp.onCategoryImageSelected(fileEvent(file), '   ', 'thumbnail');
      cmp.categoryImageSavingSlug = 'busy';
      cmp.onCategoryImageSelected(fileEvent(file), 'a', 'thumbnail');
      cmp.categoryImageSavingSlug = null;
      expect(admin.uploadCategoryImage).not.toHaveBeenCalled();

      cmp.onCategoryImageSelected(fileEvent(file), 'a', 'banner');
      expect(admin.uploadCategoryImage).toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalled();

      admin.uploadCategoryImage.and.callFake(
        () => ({ subscribe: (h: any) => h.error(new Error('x')) }) as any,
      );
      cmp.onCategoryImageSelected(fileEvent(file), 'a', 'thumbnail');
      expect(cmp.categoryImageError).toBeTruthy();
    });
  });

  describe('category merge / delete', () => {
    function ready() {
      const ctx = setup({ enabled: true });
      setCategories(ctx.cmp, [cat('a'), cat('b')]);
      return ctx;
    }

    it('onMergeTargetChange clears preview', () => {
      const { cmp } = ready();
      cmp.mergePreview = { can_merge: true } as any;
      cmp.mergeError = 'x';
      cmp.onMergeTargetChange();
      expect(cmp.mergePreview).toBeNull();
      expect(cmp.mergeError).toBe('');
    });

    it('previewCategoryMerge guards / success can_merge true & false / error', () => {
      const { cmp, enabled, admin } = ready();
      enabled.set(false);
      cmp.previewCategoryMerge(cat('a'));
      enabled.set(true);
      cmp.mergePreviewLoading = true;
      cmp.previewCategoryMerge(cat('a'));
      cmp.mergePreviewLoading = false;
      cmp.mergeTargetSlug = '';
      cmp.previewCategoryMerge(cat('a'));
      expect(cmp.mergeError).toBeTruthy();
      expect(admin.previewMergeCategory).not.toHaveBeenCalled();

      cmp.mergeTargetSlug = 'b';
      cmp.previewCategoryMerge(cat('a'));
      expect(cmp.mergePreview).toBeTruthy();

      admin.previewMergeCategory.and.returnValue(
        of({
          can_merge: false,
          reason: 'different_parent',
          product_count: 0,
          child_count: 0,
        }) as any,
      );
      cmp.previewCategoryMerge(cat('a'));
      expect(cmp.mergeError).toBeTruthy();

      admin.previewMergeCategory.and.callFake(
        () => ({ subscribe: (h: any) => h.error(new Error('x')) }) as any,
      );
      cmp.previewCategoryMerge(cat('a'));
      expect(cmp.mergeError).toBeTruthy();
    });

    it('mergeReasonKey variants', () => {
      const { cmp } = ready();
      expect(cmp.mergeReasonKey('same_category')).toContain('ReasonSame');
      expect(cmp.mergeReasonKey('different_parent')).toContain('ReasonParent');
      expect(cmp.mergeReasonKey('source_has_children')).toContain('ReasonChildren');
      expect(cmp.mergeReasonKey('other')).toContain('mergeNotAllowed');
    });

    it('mergeCategory guards / confirm / success / cancel / error', () => {
      const { cmp, enabled, admin, toast, router } = ready();
      enabled.set(false);
      cmp.mergeCategory(cat('a'));
      enabled.set(true);
      cmp.mergeSaving = true;
      cmp.mergeCategory(cat('a'));
      cmp.mergeSaving = false;
      cmp.mergeTargetSlug = '';
      cmp.mergeCategory(cat('a')); // blank target
      cmp.mergeTargetSlug = 'b';
      cmp.mergePreview = null;
      cmp.mergeCategory(cat('a'));
      expect(cmp.mergeError).toBeTruthy();
      expect(admin.mergeCategory).not.toHaveBeenCalled();

      cmp.mergePreview = { can_merge: true, product_count: 3 } as any;
      spyOn(window, 'confirm').and.returnValues(false, true, true);
      cmp.mergeCategory(cat('a', { name: 'Alpha' })); // cancelled
      expect(admin.mergeCategory).not.toHaveBeenCalled();
      cmp.mergeCategory(cat('a', { name: 'Alpha' })); // confirmed
      expect(admin.mergeCategory).toHaveBeenCalled();
      expect(router.navigate).toHaveBeenCalledWith(['/shop', 'b']);
      expect(toast.success).toHaveBeenCalled();

      cmp.mergeTargetSlug = 'b';
      cmp.mergePreview = { can_merge: true, product_count: 0 } as any;
      admin.mergeCategory.and.callFake(
        () => ({ subscribe: (h: any) => h.error(new Error('x')) }) as any,
      );
      cmp.mergeCategory(cat('a'));
      expect(cmp.mergeError).toBeTruthy();
    });

    it('mergeCategory uses target slug name fallback when not found', () => {
      const { cmp, admin } = ready();
      cmp.mergeTargetSlug = 'ghost';
      cmp.mergePreview = { can_merge: true, product_count: 0 } as any;
      spyOn(window, 'confirm').and.returnValue(true);
      cmp.mergeCategory({ slug: 'a' } as any); // no name -> sourceSlug fallback
      expect(admin.mergeCategory).toHaveBeenCalledWith('a', 'ghost', { source: 'storefront' });
    });

    it('previewCategoryDelete guards / can_delete true & false / error', () => {
      const { cmp, enabled, admin } = ready();
      enabled.set(false);
      cmp.previewCategoryDelete(cat('a'));
      enabled.set(true);
      cmp.deletePreviewLoading = true;
      cmp.previewCategoryDelete(cat('a'));
      cmp.deletePreviewLoading = false;
      cmp.previewCategoryDelete(cat('')); // blank
      expect(admin.previewDeleteCategory).not.toHaveBeenCalled();

      cmp.previewCategoryDelete(cat('a'));
      expect(cmp.deletePreview).toBeTruthy();

      admin.previewDeleteCategory.and.returnValue(
        of({ can_delete: false, product_count: 2, child_count: 1 }) as any,
      );
      cmp.previewCategoryDelete(cat('a'));
      expect(cmp.deleteError).toBeTruthy();

      admin.previewDeleteCategory.and.callFake(
        () => ({ subscribe: (h: any) => h.error(new Error('x')) }) as any,
      );
      cmp.previewCategoryDelete(cat('a'));
      expect(cmp.deleteError).toBeTruthy();
    });

    it('deleteCategorySafe guards / confirm / success / cancel / error', () => {
      const { cmp, enabled, admin, toast, router } = ready();
      enabled.set(false);
      cmp.deleteCategorySafe(cat('a'));
      enabled.set(true);
      cmp.deleteSaving = true;
      cmp.deleteCategorySafe(cat('a'));
      cmp.deleteSaving = false;
      cmp.deletePreview = null;
      cmp.deleteCategorySafe(cat('a'));
      expect(cmp.deleteError).toBeTruthy();

      cmp.deletePreview = { can_delete: true } as any;
      cmp.deleteCategorySafe(cat('')); // blank slug
      expect(admin.deleteCategory).not.toHaveBeenCalled();

      spyOn(window, 'confirm').and.returnValues(false, true, true);
      cmp.deleteCategorySafe({ slug: 'a' } as any); // cancelled (no name -> slug fallback)
      expect(admin.deleteCategory).not.toHaveBeenCalled();
      cmp.deleteCategorySafe(cat('a', { name: 'Alpha' })); // confirmed
      expect(admin.deleteCategory).toHaveBeenCalled();
      expect(router.navigate).toHaveBeenCalledWith(['/shop']);
      expect(toast.success).toHaveBeenCalled();

      cmp.deletePreview = { can_delete: true } as any;
      admin.deleteCategory.and.callFake(
        () => ({ subscribe: (h: any) => h.error(new Error('x')) }) as any,
      );
      cmp.deleteCategorySafe(cat('a'));
      expect(cmp.deleteError).toBeTruthy();
    });
  });

  describe('category create', () => {
    function ready() {
      const ctx = setup({ enabled: true });
      setCategories(ctx.cmp, [cat('a', { sort_order: 2 })]);
      return ctx;
    }

    it('isCreating helpers + toggles', () => {
      const { cmp, enabled } = ready();
      expect(cmp.isCreatingAnyCategory()).toBe(false);
      // toggleCreateRootCategory guards
      enabled.set(false);
      cmp.toggleCreateRootCategory();
      enabled.set(true);
      cmp.reorderSaving.set(true);
      cmp.toggleCreateRootCategory();
      cmp.reorderSaving.set(false);
      cmp.renameSaving = true;
      cmp.toggleCreateRootCategory();
      cmp.renameSaving = false;
      expect(cmp.isCreatingRootCategory()).toBe(false);
      // open root
      cmp.toggleCreateRootCategory();
      expect(cmp.isCreatingRootCategory()).toBe(true);
      // toggle off
      cmp.toggleCreateRootCategory();
      expect(cmp.isCreatingRootCategory()).toBe(false);
    });

    it('toggleCreateSubcategory guards + toggle', () => {
      const { cmp, enabled } = ready();
      enabled.set(false);
      cmp.toggleCreateSubcategory(dragEvent(), cat('a'));
      enabled.set(true);
      cmp.reorderSaving.set(true);
      cmp.toggleCreateSubcategory(dragEvent(), cat('a'));
      cmp.reorderSaving.set(false);
      cmp.renameSaving = true;
      cmp.toggleCreateSubcategory(dragEvent(), cat('a'));
      cmp.renameSaving = false;
      cmp.toggleCreateSubcategory(dragEvent(), cat('')); // blank
      expect(cmp.isCreatingAnyCategory()).toBe(false);
      cmp.toggleCreateSubcategory(dragEvent(), cat('a'));
      expect(cmp.isCreatingSubcategory('a')).toBe(true);
      cmp.toggleCreateSubcategory(dragEvent(), cat('a'));
      expect(cmp.isCreatingSubcategory('a')).toBe(false);
    });

    it('canSaveCreateCategory', () => {
      const { cmp } = ready();
      cmp.createSaving = true;
      expect(cmp.canSaveCreateCategory()).toBe(false);
      cmp.createSaving = false;
      cmp.createNameRo = 'a';
      cmp.createNameEn = '';
      expect(cmp.canSaveCreateCategory()).toBe(false);
      cmp.createNameEn = 'b';
      expect(cmp.canSaveCreateCategory()).toBe(true);
    });

    it('saveCreateCategory guards + validation', () => {
      const { cmp, enabled, admin } = ready();
      enabled.set(false);
      cmp.saveCreateCategory();
      enabled.set(true);
      cmp.createSaving = true;
      cmp.saveCreateCategory();
      cmp.createSaving = false;
      cmp.creatingCategoryParentSlug = null;
      cmp.saveCreateCategory(); // null parent -> return
      cmp.creatingCategoryParentSlug = '';
      cmp.createNameRo = '';
      cmp.createNameEn = '';
      cmp.saveCreateCategory();
      expect(cmp.createError).toBeTruthy();
      expect(admin.createCategory).not.toHaveBeenCalled();
    });

    it('saveCreateCategory root success + error', () => {
      const { cmp, admin, toast } = ready();
      cmp.creatingCategoryParentSlug = '';
      cmp.createNameRo = 'Ro';
      cmp.createNameEn = 'En';
      cmp.saveCreateCategory();
      expect(admin.createCategory).toHaveBeenCalled();
      const payload = admin.createCategory.calls.mostRecent().args[0] as any;
      expect(payload.sort_order).toBe(3); // max(2) + 1
      expect(payload.parent_id).toBeNull();
      expect(toast.success).toHaveBeenCalled();

      cmp.creatingCategoryParentSlug = '';
      cmp.createNameRo = 'Ro';
      cmp.createNameEn = 'En';
      admin.createCategory.and.callFake(
        () =>
          ({
            pipe: () => ({ subscribe: (h: any) => h.error(new Error('x')) }),
          }) as any,
      );
      cmp.saveCreateCategory();
      expect(cmp.createError).toBeTruthy();
    });

    it('saveCreateCategory subcategory: parent missing then found', () => {
      const { cmp, admin } = ready();
      setCategories(cmp, [cat('a', { sort_order: 0 })]);
      cmp.creatingCategoryParentSlug = 'missing';
      cmp.createNameRo = 'Ro';
      cmp.createNameEn = 'En';
      cmp.saveCreateCategory();
      expect(cmp.createError).toBeTruthy();
      expect(admin.createCategory).not.toHaveBeenCalled();

      setCategories(cmp, [
        cat('a', { sort_order: 0 }),
        cat('child', { parent_id: 'id-a', sort_order: 5 }),
      ]);
      cmp.creatingCategoryParentSlug = 'a';
      cmp.createNameRo = 'Ro';
      cmp.createNameEn = 'En';
      cmp.saveCreateCategory();
      const payload = admin.createCategory.calls.mostRecent().args[0] as any;
      expect(payload.parent_id).toBe('id-a');
      expect(payload.sort_order).toBe(6); // max(5)+1
    });
  });

  describe('pagination, filters and url state', () => {
    it('setPaginationMode same -> noop; change -> reload', () => {
      const { cmp, catalog } = setup();
      cmp.paginationMode = 'pages';
      cmp.setPaginationMode('pages');
      expect(catalog.listProducts).not.toHaveBeenCalled();
      cmp.setPaginationMode('load_more');
      expect(cmp.paginationMode).toBe('load_more');
      expect(catalog.listProducts).toHaveBeenCalled();
    });

    it('loadMore guards and success', () => {
      const { cmp, catalog } = setup();
      cmp.paginationMode = 'pages';
      cmp.loadMore();
      cmp.paginationMode = 'load_more';
      cmp.loadingMore.set(true);
      cmp.loadMore();
      cmp.loadingMore.set(false);
      cmp.pageMeta = null;
      cmp.loadMore();
      cmp.pageMeta = { page: 2, total_pages: 2, total_items: 10, limit: 5 };
      cmp.loadMore(); // nextPage 3 > total_pages
      expect(catalog.listProducts).not.toHaveBeenCalled();
      cmp.pageMeta = { page: 1, total_pages: 3, total_items: 30, limit: 10 };
      cmp.products = [product('1')];
      cmp.loadMore();
      expect(catalog.listProducts).toHaveBeenCalled();
      expect(cmp.filters.page).toBe(2);
    });

    it('fetchCategories success + error', () => {
      const { cmp, catalog } = setup();
      catalog.listCategories.and.returnValue(of([cat('x')]));
      cmp.fetchCategories();
      expect(cmp.categories.length).toBe(1);
      catalog.listCategories.and.callFake(
        () => ({ subscribe: (h: any) => h.error(new Error('x')) }) as any,
      );
      cmp.fetchCategories();
      expect(cmp.categories.length).toBe(0);
    });

    it('applyFilters / onSearch reset page and load', () => {
      const { cmp, catalog } = setup();
      cmp.filters.page = 3;
      cmp.applyFilters();
      expect(cmp.filters.page).toBe(1);
      expect(catalog.listProducts).toHaveBeenCalled();
      cmp.onSearch();
    });

    it('scheduleFilterApply debounces and applies', (done) => {
      const { cmp, catalog } = setup();
      cmp.onSidebarSearchChange('abc');
      cmp.onSidebarSearchChange('abcd'); // clears prior debounce
      expect(cmp.filters.search).toBe('abcd');
      setTimeout(() => {
        expect(catalog.listProducts).toHaveBeenCalled();
        done();
      }, 400);
    });

    it('onPriceCommit and onPriceTextChange', () => {
      const { cmp } = setup();
      cmp.priceMaxBound = 500;
      cmp.onPriceTextChange('min', '50');
      expect(cmp.filters.min_price).toBe(50);
      cmp.onPriceTextChange('max', 'not-a-number');
      expect(cmp.filters.max_price).toBe(500);
      cmp.cancelFilterDebounce();
      cmp.onPriceCommit('min');
      cmp.onPriceCommit('max');
    });

    it('cancelFilterDebounce no-op when nothing scheduled', () => {
      const { cmp } = setup();
      cmp.cancelFilterDebounce();
      expect(cmp.filterDebounce).toBeUndefined();
    });

    it('changePage guards and success', () => {
      const { cmp, catalog } = setup();
      cmp.paginationMode = 'load_more';
      cmp.changePage(1);
      cmp.paginationMode = 'pages';
      cmp.pageMeta = null;
      cmp.changePage(1);
      cmp.pageMeta = { page: 1, total_pages: 2, total_items: 20, limit: 10 };
      cmp.changePage(-1); // < 1
      cmp.changePage(5); // > total_pages
      expect(catalog.listProducts).not.toHaveBeenCalled();
      cmp.changePage(1);
      expect(cmp.filters.page).toBe(2);
    });

    it('toggleTag adds and removes', () => {
      const { cmp } = setup();
      cmp.toggleTag('red');
      expect(cmp.filters.tags.has('red')).toBe(true);
      cmp.toggleTag('red');
      expect(cmp.filters.tags.has('red')).toBe(false);
    });

    it('resetFilters resets everything', () => {
      const { cmp } = setup();
      cmp.filters.search = 'x';
      cmp.activeCategorySlug = 'a';
      cmp.activeSubcategorySlug = 'b';
      cmp.filters.tags = new Set(['t']);
      cmp.resetFilters();
      expect(cmp.filters.search).toBe('');
      expect(cmp.activeCategorySlug).toBe('');
      expect(cmp.filters.sort).toBe('newest');
      expect(cmp.filters.tags.size).toBe(0);
    });

    it('quickSelectCategory selects and scrolls', () => {
      const { cmp, catalog } = setup();
      const scrollSpy = spyOn(window, 'scrollTo');
      cmp.quickSelectCategory('a');
      expect(cmp.categorySelection).toBe('a');
      expect(catalog.listProducts).toHaveBeenCalled();
      expect(scrollSpy).toHaveBeenCalled();
    });

    it('onCategorySelected and setSubcategory', () => {
      const { cmp, catalog } = setup();
      setCategories(cmp, [cat('p'), cat('c', { parent_id: 'id-p' })]);
      cmp.categorySelection = 'p';
      cmp.onCategorySelected();
      expect(cmp.activeCategorySlug).toBe('p');
      catalog.listProducts.calls.reset();
      // setSubcategory: no parent
      cmp.activeCategorySlug = 'missing';
      cmp.setSubcategory('c');
      expect(catalog.listProducts).not.toHaveBeenCalled();
      // not allowed sub
      cmp.activeCategorySlug = 'p';
      cmp.setSubcategory('notachild');
      expect(catalog.listProducts).not.toHaveBeenCalled();
      // allowed
      cmp.setSubcategory('c');
      expect(cmp.activeSubcategorySlug).toBe('c');
      // empty sub allowed
      cmp.setSubcategory('');
      expect(cmp.activeSubcategorySlug).toBe('');
    });
  });

  describe('fetchProducts behavior', () => {
    it('handles sale, bounds, tags and crumbs (sale)', () => {
      const { cmp, catalog } = setup();
      cmp.activeCategorySlug = 'sale';
      catalog.listProducts.and.returnValue(
        of({
          items: [
            product('1', { tags: [{ slug: 'b', name: 'Beta' }] }),
            product('2', { tags: [{ slug: 'a', name: 'Alpha' }] }),
          ],
          meta: { total_items: 2, total_pages: 1, page: 1, limit: 12 },
          bounds: { max_price: 250 },
        }),
      );
      cmp.loadProducts(false);
      const args = catalog.listProducts.calls.mostRecent().args[0];
      expect(args.on_sale).toBe(true);
      expect(args.category_slug).toBeUndefined();
      expect(cmp.allTags.map((t: any) => t.slug)).toEqual(['a', 'b']);
      expect(cmp.crumbs[cmp.crumbs.length - 1].label).toBe('shop.sale');
      expect(cmp.priceMaxBound).toBe(250);
    });

    it('category + subcategory crumbs and price filters', () => {
      const { cmp, catalog } = setup({ enabled: true });
      setCategories(cmp, [cat('p'), cat('c', { parent_id: 'id-p' })]);
      cmp.activeCategorySlug = 'p';
      cmp.activeSubcategorySlug = 'c';
      cmp.priceMaxBound = 500;
      cmp.filters.min_price = 50;
      cmp.filters.max_price = 200;
      catalog.listProducts.and.returnValue(
        of({
          items: [product('1')],
          meta: { total_items: 1, total_pages: 1, page: 1, limit: 12 },
        }),
      );
      cmp.loadProducts(false);
      const args = catalog.listProducts.calls.mostRecent().args[0];
      expect(args.category_slug).toBe('c');
      expect(args.include_unpublished).toBe(true);
      expect(args.min_price).toBe(50);
      expect(args.max_price).toBe(200);
      expect(cmp.crumbs.length).toBe(4);
    });

    it('category crumbs without resolved category name', () => {
      const { cmp, catalog } = setup();
      cmp.activeCategorySlug = 'unknown';
      catalog.listProducts.and.returnValue(
        of({
          items: [product('1')],
          meta: { total_items: 1, total_pages: 1, page: 1, limit: 12 },
        }),
      );
      cmp.loadProducts(false);
      expect(cmp.crumbs[2].label).toBe('unknown');
    });

    it('default crumbs when no category', () => {
      const { cmp, catalog } = setup();
      catalog.listProducts.and.returnValue(
        of({
          items: [],
          meta: { total_items: 0, total_pages: 1, page: 1, limit: 12 },
          bounds: { max_price: Infinity },
        }),
      );
      cmp.loadProducts(false);
      expect(cmp.crumbs.length).toBe(2);
    });

    it('append success concatenates products', () => {
      const { cmp, catalog } = setup();
      cmp.products = [product('1')];
      cmp.paginationMode = 'load_more';
      cmp.pageMeta = { page: 1, total_pages: 2, total_items: 4, limit: 2 };
      catalog.listProducts.and.returnValue(
        of({
          items: [product('2'), product('3')],
          meta: { total_items: 4, total_pages: 2, page: 2, limit: 2 },
        }),
      );
      cmp.loadMore();
      expect(cmp.products.map((p: Product) => p.id)).toEqual(['1', '2', '3']);
    });

    it('append error decrements page and toasts', () => {
      const { cmp, catalog, toast } = setup();
      cmp.products = [product('1')];
      cmp.paginationMode = 'load_more';
      cmp.pageMeta = { page: 1, total_pages: 3, total_items: 30, limit: 10 };
      catalog.listProducts.and.callFake(
        () => ({ subscribe: (h: any) => h.error(new Error('x')) }) as any,
      );
      cmp.loadMore();
      expect(toast.error).toHaveBeenCalled();
      expect(cmp.filters.page).toBe(1);
    });

    it('non-append error resets state', () => {
      const { cmp, catalog, toast } = setup();
      catalog.listProducts.and.callFake(
        () => ({ subscribe: (h: any) => h.error(new Error('x')) }) as any,
      );
      cmp.loadProducts(false);
      expect(cmp.hasError()).toBe(true);
      expect(cmp.products.length).toBe(0);
      expect(toast.error).toHaveBeenCalled();
    });

    it('ignores stale error responses', () => {
      const { cmp } = setup();
      const first = new Subject<any>();
      const catalog = TestBed.inject(CatalogService) as any;
      catalog.listProducts.and.returnValue(first.asObservable());
      cmp.fetchProducts();
      cmp.productsLoadSeq = 999; // make the in-flight response stale
      first.error(new Error('x'));
      expect(cmp.hasError()).toBe(false);
    });

    it('loadProducts pushes url state when requested', () => {
      const { cmp, router } = setup();
      cmp.activeCategorySlug = 'a';
      cmp.loadProducts(true, true);
      expect(router.navigate).toHaveBeenCalled();
      expect(cmp.suppressNextUrlSync).toBe(true);
    });
  });

  describe('session scroll restore', () => {
    afterEach(() => {
      sessionStorage.clear();
    });

    it('remembers shop return context', () => {
      const { cmp } = setup();
      history.replaceState({}, '', '/shop?x=1');
      cmp.viewProduct('thing');
      expect(sessionStorage.getItem('shop_return_pending')).toBe('1');
    });

    it('rememberShopReturnContext ignores non-shop urls', () => {
      const { cmp } = setup();
      history.replaceState({}, '', '/other');
      cmp.rememberShopReturnContext();
      expect(sessionStorage.getItem('shop_return_pending')).toBeNull();
      history.replaceState({}, '', '/shop');
    });

    it('initScrollRestoreFromSession success then restores on load', () => {
      const { cmp, catalog, router } = setup({ routerUrl: '/shop' });
      (router as any).url = '/shop';
      sessionStorage.setItem('shop_return_pending', '1');
      sessionStorage.setItem('shop_return_url', '/shop');
      sessionStorage.setItem('shop_return_scroll_y', '120');
      sessionStorage.setItem('shop_return_at', String(Date.now()));
      cmp.initScrollRestoreFromSession();
      expect(cmp.restoreScrollY).toBe(120);
      const scrollSpy = spyOn(window, 'scrollTo');
      const rafSpy = spyOn(window, 'requestAnimationFrame').and.callFake((cb: any) => {
        cb(0);
        return 0;
      });
      catalog.listProducts.and.returnValue(
        of({ items: [], meta: { total_items: 0, total_pages: 1, page: 1, limit: 12 } }),
      );
      cmp.loadProducts(false);
      expect(rafSpy).toHaveBeenCalled();
      expect(scrollSpy).toHaveBeenCalled();
    });

    it('initScrollRestoreFromSession bails on stale/url/scroll/pending', () => {
      const { cmp } = setup({ routerUrl: '/shop' });
      // not pending
      cmp.initScrollRestoreFromSession();
      expect(cmp.restoreScrollY).toBeNull();
      // stale
      sessionStorage.setItem('shop_return_pending', '1');
      sessionStorage.setItem('shop_return_at', String(Date.now() - 20 * 60 * 1000));
      cmp.initScrollRestoreFromSession();
      expect(cmp.restoreScrollY).toBeNull();
      // url mismatch
      sessionStorage.setItem('shop_return_pending', '1');
      sessionStorage.setItem('shop_return_url', '/shop/other');
      sessionStorage.setItem('shop_return_at', String(Date.now()));
      cmp.initScrollRestoreFromSession();
      expect(cmp.restoreScrollY).toBeNull();
      // invalid scroll
      sessionStorage.setItem('shop_return_pending', '1');
      sessionStorage.setItem('shop_return_url', '/shop');
      sessionStorage.setItem('shop_return_scroll_y', '-5');
      sessionStorage.setItem('shop_return_at', String(Date.now()));
      cmp.initScrollRestoreFromSession();
      expect(cmp.restoreScrollY).toBeNull();
    });

    it('restoreScrollIfNeeded no-op when nothing stored', () => {
      const { cmp } = setup();
      cmp.restoreScrollY = null;
      cmp.restoreScrollIfNeeded();
      expect(cmp.restoreScrollY).toBeNull();
    });
  });

  describe('scroll helpers', () => {
    it('scrollToFilters scrolls when element exists', () => {
      const { cmp } = setup();
      const el = document.createElement('div');
      spyOn(document, 'getElementById').and.returnValue(el);
      const scrollSpy = spyOn(el, 'scrollIntoView');
      cmp.scrollToFilters();
      expect(scrollSpy).toHaveBeenCalled();
    });

    it('scrollToFilters no-op when element missing', () => {
      const { cmp } = setup();
      spyOn(document, 'getElementById').and.returnValue(null);
      const scrollSpy = spyOn(Element.prototype, 'scrollIntoView');
      cmp.scrollToFilters();
      expect(scrollSpy).not.toHaveBeenCalled();
    });

    it('scrollToSort scrolls and focuses select', (done) => {
      const { cmp } = setup();
      const actions = document.createElement('div');
      const select = document.createElement('select');
      spyOn(document, 'getElementById').and.callFake((id: string) =>
        id === 'shop-actions' ? actions : id === 'shop-sort-select' ? select : null,
      );
      const scrollSpy = spyOn(actions, 'scrollIntoView');
      const focusSpy = spyOn(select, 'focus');
      cmp.scrollToSort();
      expect(scrollSpy).toHaveBeenCalled();
      setTimeout(() => {
        expect(focusSpy).toHaveBeenCalled();
        done();
      }, 400);
    });

    it('scrollToSort tolerates a missing sort select', (done) => {
      const { cmp } = setup();
      const actions = document.createElement('div');
      spyOn(document, 'getElementById').and.callFake((id: string) =>
        id === 'shop-actions' ? actions : null,
      );
      spyOn(actions, 'scrollIntoView');
      cmp.scrollToSort();
      setTimeout(() => {
        done();
      }, 400);
    });

    it('scrollToSort no-op when actions element missing', () => {
      const { cmp } = setup();
      spyOn(document, 'getElementById').and.returnValue(null);
      const scrollSpy = spyOn(Element.prototype, 'scrollIntoView');
      cmp.scrollToSort();
      expect(scrollSpy).not.toHaveBeenCalled();
    });
  });

  describe('url parsing & building', () => {
    it('syncFiltersFromQuery parses params', () => {
      const { cmp } = setup();
      cmp.priceMaxBound = 500;
      cmp.syncFiltersFromQuery({
        q: 'shoes',
        min: '20',
        max: '300',
        sort: 'price_asc',
        page: '2',
        tags: 'a,b',
      });
      expect(cmp.filters.search).toBe('shoes');
      expect(cmp.filters.min_price).toBe(20);
      expect(cmp.filters.sort).toBe('price_asc');
      expect(cmp.filters.page).toBe(2);
      expect(cmp.filters.tags.size).toBe(2);
      // defaults / invalid sort -> recommended, no tags
      cmp.syncFiltersFromQuery({ sort: 'bogus' });
      expect(cmp.filters.sort).toBe('recommended');
      expect(cmp.filters.page).toBe(1);
      expect(cmp.filters.tags.size).toBe(0);
    });

    it('parseBoolean variants', () => {
      const { cmp } = setup();
      expect(cmp.parseBoolean(true)).toBe(true);
      expect(cmp.parseBoolean(false)).toBe(false);
      expect(cmp.parseBoolean(null)).toBe(false);
      expect(cmp.parseBoolean(1)).toBe(true);
      expect(cmp.parseBoolean(0)).toBe(false);
      expect(cmp.parseBoolean(['yes'])).toBe(true);
      expect(cmp.parseBoolean({})).toBe(false);
      expect(cmp.parseBoolean('TRUE')).toBe(true);
      expect(cmp.parseBoolean('no')).toBe(false);
    });

    it('parsePrice variants', () => {
      const { cmp } = setup();
      expect(cmp.parsePrice(null)).toBeUndefined();
      expect(cmp.parsePrice(undefined)).toBeUndefined();
      expect(cmp.parsePrice(42)).toBe(42);
      expect(cmp.parsePrice(Infinity)).toBeUndefined();
      expect(cmp.parsePrice({})).toBeUndefined();
      expect(cmp.parsePrice('   ')).toBeUndefined();
      expect(cmp.parsePrice('abc')).toBeUndefined();
      expect(cmp.parsePrice('15')).toBe(15);
    });

    it('normalizePriceRange swaps based on changed side', () => {
      const { cmp } = setup();
      cmp.priceMinBound = 1;
      cmp.priceMaxBound = 500;
      cmp.filters.min_price = 300;
      cmp.filters.max_price = 100;
      cmp.normalizePriceRange('min');
      expect(cmp.filters.max_price).toBe(300);

      cmp.filters.min_price = 300;
      cmp.filters.max_price = 100;
      cmp.normalizePriceRange('max');
      expect(cmp.filters.min_price).toBe(100);

      cmp.filters.min_price = 300;
      cmp.filters.max_price = 100;
      cmp.normalizePriceRange();
      expect(cmp.filters.max_price).toBe(300);
    });

    it('clampPrice handles non-finite', () => {
      const { cmp } = setup();
      cmp.priceMinBound = 1;
      cmp.priceMaxBound = 500;
      expect(cmp.clampPrice(NaN)).toBe(1);
      expect(cmp.clampPrice(9999)).toBe(500);
      expect(cmp.clampPrice(0)).toBe(1);
    });

    it('syncStateFromUrl: legacy cat', () => {
      const { cmp } = setup();
      setCategories(cmp, [cat('shoes')]);
      const canon = cmp.syncStateFromUrl(null, { cat: 'shoes' });
      expect(canon).toBe(true);
      expect(cmp.activeCategorySlug).toBe('shoes');
    });

    it('syncStateFromUrl: legacy on_sale', () => {
      const { cmp } = setup();
      const canon = cmp.syncStateFromUrl(null, { on_sale: '1' });
      expect(canon).toBe(true);
      expect(cmp.activeCategorySlug).toBe('sale');
      expect(cmp.activeSubcategorySlug).toBe('');
    });

    it('syncStateFromUrl: child slug resolves to parent + sub', () => {
      const { cmp } = setup();
      setCategories(cmp, [cat('p'), cat('c', { parent_id: 'id-p' })]);
      const canon = cmp.syncStateFromUrl('c', {});
      expect(canon).toBe(true);
      expect(cmp.activeCategorySlug).toBe('p');
      expect(cmp.activeSubcategorySlug).toBe('c');
    });

    it('syncStateFromUrl: invalid sub cleared', () => {
      const { cmp } = setup();
      setCategories(cmp, [cat('p'), cat('c', { parent_id: 'id-p' })]);
      const canon = cmp.syncStateFromUrl('p', { sub: 'notchild' });
      expect(canon).toBe(true);
      expect(cmp.activeSubcategorySlug).toBe('');
    });

    it('syncStateFromUrl: sub without category cleared', () => {
      const { cmp } = setup();
      const canon = cmp.syncStateFromUrl(null, { sub: 'orphan' });
      expect(canon).toBe(true);
      expect(cmp.activeSubcategorySlug).toBe('');
    });

    it('syncStateFromUrl: clean category + valid sub (no canonicalize)', () => {
      const { cmp } = setup();
      setCategories(cmp, [cat('p'), cat('c', { parent_id: 'id-p' })]);
      const canon = cmp.syncStateFromUrl('p', { sub: 'c' });
      expect(canon).toBe(false);
      expect(cmp.activeCategorySlug).toBe('p');
      expect(cmp.activeSubcategorySlug).toBe('c');
    });

    it('syncStateFromUrl: child slug whose parent is missing stays put', () => {
      const { cmp } = setup();
      setCategories(cmp, [cat('c', { parent_id: 'id-missing' })]);
      const canon = cmp.syncStateFromUrl('c', {});
      expect(cmp.activeCategorySlug).toBe('c');
      void canon;
    });

    it('buildQueryParams reflects active filters', () => {
      const { cmp } = setup();
      cmp.priceMinBound = 1;
      cmp.priceMaxBound = 500;
      cmp.filters.search = 'q';
      cmp.activeCategorySlug = 'p';
      cmp.activeSubcategorySlug = 's';
      cmp.filters.min_price = 50;
      cmp.filters.max_price = 200;
      cmp.filters.sort = 'price_asc';
      cmp.filters.page = 3;
      cmp.filters.tags = new Set(['a', 'b']);
      const params = cmp.buildQueryParams();
      expect(params.q).toBe('q');
      expect(params.sub).toBe('s');
      expect(params.min).toBe(50);
      expect(params.max).toBe(200);
      expect(params.sort).toBe('price_asc');
      expect(params.page).toBe(3);
      expect(params.tags).toBe('a,b');
    });

    it('buildQueryParams omits defaults / sub for sale', () => {
      const { cmp } = setup();
      cmp.priceMinBound = 1;
      cmp.priceMaxBound = 500;
      cmp.filters.search = '';
      cmp.activeCategorySlug = 'sale';
      cmp.activeSubcategorySlug = 's';
      cmp.filters.min_price = 1;
      cmp.filters.max_price = 500;
      cmp.filters.sort = 'recommended';
      cmp.filters.page = 1;
      cmp.filters.tags = new Set();
      const params = cmp.buildQueryParams();
      expect(params.q).toBeUndefined();
      expect(params.sub).toBeUndefined();
      expect(params.min).toBeUndefined();
      expect(params.sort).toBeUndefined();
      expect(params.page).toBeUndefined();
      expect(params.tags).toBeUndefined();
    });

    it('pushUrlState with and without category', () => {
      const { cmp, router } = setup();
      cmp.activeCategorySlug = 'p';
      cmp.pushUrlState(false);
      expect(router.navigate.calls.mostRecent().args[0]).toEqual(['/shop', 'p']);
      cmp.activeCategorySlug = '';
      cmp.pushUrlState(true);
      expect(router.navigate.calls.mostRecent().args[0]).toEqual(['/shop']);
    });
  });

  describe('filter chips & results meta', () => {
    it('filterChips builds chips for all filter types', () => {
      const { cmp } = setup();
      setCategories(cmp, [cat('p'), cat('c', { parent_id: 'id-p' })]);
      cmp.priceMinBound = 1;
      cmp.priceMaxBound = 500;
      cmp.activeCategorySlug = 'p';
      cmp.activeSubcategorySlug = 'c';
      cmp.filters.min_price = 50;
      cmp.filters.max_price = 200;
      cmp.filters.search = 'shoes';
      cmp.filters.tags = new Set(['red']);
      cmp.allTags = [{ slug: 'red', name: 'Red' }];
      const chips = cmp.filterChips();
      expect(chips.map((c: any) => c.type)).toEqual([
        'category',
        'subcategory',
        'price',
        'search',
        'tag',
      ]);
      expect(cmp.trackChip(0, chips[0])).toBe(chips[0].id);
    });

    it('filterChips sale + unknown subcategory + tag fallback', () => {
      const { cmp } = setup();
      cmp.activeCategorySlug = 'sale';
      cmp.activeSubcategorySlug = 'x';
      cmp.filters.tags = new Set(['unknown']);
      cmp.allTags = [];
      const chips = cmp.filterChips();
      expect(chips.find((c: any) => c.type === 'category').label).toBe('shop.sale');
      expect(chips.find((c: any) => c.type === 'subcategory').label).toBe('x');
      expect(chips.find((c: any) => c.type === 'tag').label).toBe('unknown');
    });

    it('filterChips category fallback to slug', () => {
      const { cmp } = setup();
      cmp.activeCategorySlug = 'mystery';
      const chips = cmp.filterChips();
      expect(chips.find((c: any) => c.type === 'category').label).toBe('mystery');
    });

    it('removeChip handles every type', () => {
      const { cmp, catalog } = setup();
      cmp.activeCategorySlug = 'p';
      cmp.activeSubcategorySlug = 'c';
      cmp.removeChip({ id: 'x', type: 'category', label: '' });
      expect(cmp.activeCategorySlug).toBe('');

      cmp.activeSubcategorySlug = 'c';
      cmp.removeChip({ id: 'x', type: 'subcategory', label: '' });
      expect(cmp.activeSubcategorySlug).toBe('');

      cmp.removeChip({ id: 'x', type: 'price', label: '' });
      cmp.removeChip({ id: 'x', type: 'search', label: '' });
      cmp.filters.tags = new Set(['t']);
      cmp.removeChip({ id: 'x', type: 'tag', label: '', value: 't' });
      expect(cmp.filters.tags.has('t')).toBe(false);
      // tag without value -> falls through
      cmp.removeChip({ id: 'x', type: 'tag', label: '' });
      void catalog;
    });

    it('resultsMetaParams variants', () => {
      const { cmp } = setup();
      expect(cmp.resultsMetaParams()).toBeNull();
      cmp.pageMeta = { total_items: 0, total_pages: 1, page: 1, limit: 0 };
      expect(cmp.resultsMetaParams()).toBeNull();
      cmp.pageMeta = { total_items: 0, total_pages: 1, page: 1, limit: 10 };
      expect(cmp.resultsMetaParams()).toEqual({ total: 0, from: 0, to: 0 });

      cmp.pageMeta = { total_items: 30, total_pages: 3, page: 2, limit: 10 };
      cmp.paginationMode = 'pages';
      expect(cmp.resultsMetaParams()).toEqual({ total: 30, from: 11, to: 20 });

      cmp.paginationMode = 'load_more';
      cmp.products = [product('1'), product('2')];
      expect(cmp.resultsMetaParams()).toEqual({ total: 30, from: 1, to: 2 });
      cmp.products = [];
      expect(cmp.resultsMetaParams()).toEqual({ total: 30, from: 0, to: 0 });
    });
  });

  describe('meta tag resolution helpers', () => {
    it('resolveActiveCategoryLabel variants', () => {
      const { cmp } = setup();
      expect(cmp.resolveActiveCategoryLabel()).toBeNull();
      cmp.activeCategorySlug = 'sale';
      expect(cmp.resolveActiveCategoryLabel()).toBe('shop.sale');
      setCategories(cmp, [cat('named', { name: 'Named Cat' })]);
      cmp.activeCategorySlug = 'named';
      expect(cmp.resolveActiveCategoryLabel()).toBe('Named Cat');
      cmp.activeCategorySlug = 'multi-word_slug';
      expect(cmp.resolveActiveCategoryLabel()).toBe('Multi Word Slug');
    });

    it('shouldKeepSubcategoryInCanonical variants', () => {
      const { cmp } = setup();
      expect(cmp.shouldKeepSubcategoryInCanonical()).toBe(false);
      cmp.activeCategorySlug = 'sale';
      expect(cmp.shouldKeepSubcategoryInCanonical()).toBe(false);
      setCategories(cmp, [cat('p'), cat('c', { parent_id: 'id-p' }), cat('other')]);
      cmp.activeCategorySlug = 'p';
      cmp.activeSubcategorySlug = '';
      expect(cmp.shouldKeepSubcategoryInCanonical()).toBe(false);
      cmp.activeSubcategorySlug = 'missing';
      expect(cmp.shouldKeepSubcategoryInCanonical()).toBe(false);
      cmp.activeSubcategorySlug = 'other'; // not a child of p
      expect(cmp.shouldKeepSubcategoryInCanonical()).toBe(false);
      cmp.activeSubcategorySlug = 'c';
      expect(cmp.shouldKeepSubcategoryInCanonical()).toBe(true);
    });

    it('setMetaTags keeps subcategory in canonical when valid', () => {
      const { cmp, seo } = setup();
      setCategories(cmp, [cat('p'), cat('c', { parent_id: 'id-p' })]);
      cmp.activeCategorySlug = 'p';
      cmp.activeSubcategorySlug = 'c';
      cmp.setMetaTags();
      const opts = seo.setLocalizedCanonical.calls.mostRecent().args[2] as any;
      expect(opts.sub).toBe('c');
    });
  });

  describe('rebuildCategoryTree sorting', () => {
    it('sorts roots and children by order then name', () => {
      const { cmp } = setup();
      setCategories(cmp, [
        cat('b', { sort_order: 1, name: 'B' }),
        cat('a', { sort_order: 1, name: 'A' }),
        cat('child2', { parent_id: 'id-a', sort_order: 2, name: 'C2' }),
        cat('child1', { parent_id: 'id-a', sort_order: 1, name: 'C1' }),
        cat('childx', { parent_id: 'id-a', name: 'CX', sort_order: undefined }),
      ]);
      expect(cmp.rootCategories.map((c: Category) => c.slug)).toEqual(['a', 'b']);
      const kids = cmp.getSubcategories(cat('a'));
      expect(kids.map((c: Category) => c.slug)).toEqual(['childx', 'child1', 'child2']);
    });

    it('getSubcategories returns empty for unknown category', () => {
      const { cmp } = setup();
      expect(cmp.getSubcategories(cat('none'))).toEqual([]);
    });
  });

  describe('branch completeness (alternate operand arms)', () => {
    function reorderReady() {
      const ctx = setup({ enabled: true });
      const { cmp } = ctx;
      setCategories(cmp, [cat('leaf')]);
      cmp.activeCategorySlug = 'leaf';
      cmp.filters.sort = 'recommended';
      cmp.loading.set(false);
      cmp.hasError.set(false);
      cmp.products = [product('1'), product('2'), product('3')];
      cmp.pageMeta = { total_items: 3, total_pages: 1, page: 1, limit: 12 };
      return ctx;
    }

    it('openQuickView with falsy slug uses default', () => {
      const { cmp } = setup();
      cmp.openQuickView('');
      expect(cmp.quickViewOpen).toBe(false);
    });

    it('canReorderProducts handles nullish meta fields', () => {
      const { cmp } = reorderReady();
      cmp.pageMeta = {} as any; // total_pages/page/total_items all undefined -> ?? defaults
      cmp.products = [product('1'), product('2')];
      expect(cmp.canReorderProducts()).toBe(true);
    });

    it('product drag handlers tolerate falsy ids', () => {
      const { cmp } = reorderReady();
      cmp.draggingProductId = null;
      cmp.onProductDragStart(dragEvent(), ''); // falsy id arm
      expect(cmp.draggingProductId).toBeNull();
      cmp.draggingProductId = '1';
      cmp.onProductDragOver(dragEvent(), ''); // falsy id arm
      cmp.onProductDrop(dragEvent(), ''); // falsy id arm
      cmp.pinProductToTop(''); // falsy id arm
      expect(cmp.dragOverProductId).toBeNull();
    });

    it('redundant saving guards inside drop/pin (gate stubbed open)', () => {
      const { cmp, admin } = reorderReady();
      spyOn(cmp, 'canReorderProducts').and.returnValue(true);
      cmp.productReorderSaving.set(true);
      cmp.draggingProductId = '1';
      cmp.onProductDrop(dragEvent(), '2');
      cmp.pinProductToTop('2');
      expect(admin.bulkUpdateProducts).not.toHaveBeenCalled();
    });

    it('empty update list short-circuits drop and pin', () => {
      const { cmp, admin } = reorderReady();
      spyOn(cmp, 'canReorderProducts').and.returnValue(true);
      spyOn(cmp as any, 'reorderProducts').and.returnValue(true);
      cmp.products = [{ id: '' } as Product];
      cmp.draggingProductId = 'x';
      cmp.onProductDrop(dragEvent(), 'y');
      expect(admin.bulkUpdateProducts).not.toHaveBeenCalled();

      (cmp.reorderProducts as jasmine.Spy).and.callFake(() => {
        cmp.products = [{ id: '' } as Product];
        return true;
      });
      cmp.products = [product('a')];
      cmp.pinProductToTop('b');
      expect(admin.bulkUpdateProducts).not.toHaveBeenCalled();
    });

    it('reorderProducts returns false for identical index', () => {
      const { cmp } = reorderReady();
      cmp.products = [product('a')];
      expect((cmp as any).reorderProducts('a', 'a')).toBe(false);
    });

    it('getDescendants returns empty for id-less root', () => {
      const { cmp } = setup({ enabled: true });
      expect((cmp as any).getDescendants({} as Category)).toEqual([]);
    });

    it('root drag handlers tolerate falsy slugs', () => {
      const { cmp } = setup({ enabled: true });
      setCategories(cmp, [cat('a'), cat('b')]);
      cmp.onRootCategoryDragStart(dragEvent(), ''); // falsy slug
      expect(cmp.draggingRootCategorySlug).toBeNull();
      cmp.draggingRootCategorySlug = 'a';
      cmp.onRootCategoryDragOver(dragEvent(), ''); // falsy slug
      cmp.onRootCategoryDrop(dragEvent(), ''); // falsy slug
      expect(cmp.dragOverRootCategorySlug).toBeNull();
    });

    it('startRenameCategory error path covers ro lang with and without name', () => {
      const make = () => {
        const ctx = setup({ enabled: true });
        setCategories(ctx.cmp, [cat('a')]);
        ctx.admin.getCategoryTranslations.and.callFake(
          () => ({ subscribe: (h: any) => h.error(new Error('x')) }) as any,
        );
        return ctx;
      };
      // en + empty name
      let ctx = make();
      TestBed.inject(TranslateService).use('en');
      ctx.cmp.startRenameCategory(dragEvent(), cat('a', { name: '' }));
      expect(ctx.cmp.renameError).toBeTruthy();
      // ro + name
      ctx = make();
      TestBed.inject(TranslateService).use('ro');
      ctx.cmp.startRenameCategory(dragEvent(), cat('a', { name: 'RoName' }));
      expect(ctx.cmp.renameNameRo).toBe('RoName');
      // ro + empty name
      ctx = make();
      TestBed.inject(TranslateService).use('ro');
      ctx.cmp.startRenameCategory(dragEvent(), cat('a', { name: '' }));
      expect(ctx.cmp.renameNameRo).toBe('');
    });

    it('startRenameCategory success fallback to category name (en, ro empty)', () => {
      const ctx = setup({ enabled: true });
      setCategories(ctx.cmp, [cat('a')]);
      TestBed.inject(TranslateService).use('en');
      ctx.admin.getCategoryTranslations.and.returnValue(of([]) as any);
      ctx.cmp.startRenameCategory(dragEvent(), cat('a', { name: 'OnlyEn' }));
      expect(ctx.cmp.renameNameEn).toBe('OnlyEn');
    });

    it('canSaveRename false when RO name blank', () => {
      const { cmp } = setup();
      cmp.renameLoading = false;
      cmp.renameSaving = false;
      cmp.renameNameRo = '';
      cmp.renameNameEn = 'x';
      expect(cmp.canSaveRename()).toBe(false);
    });

    it('canSaveCreateCategory false when RO name blank', () => {
      const { cmp } = setup();
      cmp.createSaving = false;
      cmp.createNameRo = '';
      cmp.createNameEn = 'x';
      expect(cmp.canSaveCreateCategory()).toBe(false);
    });

    it('onCategoryImageSelected tolerates falsy slug', () => {
      const { cmp, admin } = setup({ enabled: true });
      const file = new File(['x'], 'x.png', { type: 'image/png' });
      cmp.onCategoryImageSelected(fileEvent(file), '', 'thumbnail');
      expect(admin.uploadCategoryImage).not.toHaveBeenCalled();
    });

    it('previewCategoryMerge / mergeCategory tolerate falsy source slug', () => {
      const { cmp, admin } = setup({ enabled: true });
      setCategories(cmp, [cat('a'), cat('b')]);
      cmp.mergeTargetSlug = 'b';
      cmp.previewCategoryMerge(cat(''));
      expect(admin.previewMergeCategory).not.toHaveBeenCalled();
      cmp.mergePreview = { can_merge: true } as any;
      cmp.mergeCategory(cat(''));
      expect(admin.mergeCategory).not.toHaveBeenCalled();
    });

    it('loadMore uses filters.page when meta.page missing', () => {
      const { cmp, catalog } = setup();
      cmp.paginationMode = 'load_more';
      cmp.filters.page = 1;
      cmp.pageMeta = { total_pages: 3, total_items: 30, limit: 10 } as any;
      cmp.products = [product('1')];
      cmp.loadMore();
      expect(catalog.listProducts).toHaveBeenCalled();
      expect(cmp.filters.page).toBe(2);
    });

    it('saveCreateCategory root with non-numeric sort_order', () => {
      const { cmp, admin } = setup({ enabled: true });
      setCategories(cmp, [cat('a', { sort_order: undefined as any })]);
      cmp.creatingCategoryParentSlug = '';
      cmp.createNameRo = 'R';
      cmp.createNameEn = 'E';
      cmp.saveCreateCategory();
      // invalid sort_order coerced to 0, so next root order = max(-1, 0) + 1 = 1
      expect((admin.createCategory.calls.mostRecent().args[0] as any).sort_order).toBe(1);
    });

    it('saveCreateCategory subcategory with numeric + non-numeric siblings', () => {
      const { cmp, admin } = setup({ enabled: true });
      setCategories(cmp, [
        cat('a', { sort_order: 0 }),
        cat('s1', { parent_id: 'id-a', sort_order: 3 }),
        cat('s2', { parent_id: 'id-a', sort_order: undefined as any }),
      ]);
      cmp.creatingCategoryParentSlug = 'a';
      cmp.createNameRo = 'R';
      cmp.createNameEn = 'E';
      cmp.saveCreateCategory();
      expect((admin.createCategory.calls.mostRecent().args[0] as any).sort_order).toBe(4);
    });

    it('quickSelectCategory tolerates falsy slug', () => {
      const { cmp } = setup();
      spyOn(window, 'scrollTo');
      cmp.quickSelectCategory('');
      expect(cmp.categorySelection).toBe('');
    });

    it('restoreRootCategoryOrder skips child categories', () => {
      const { cmp } = setup({ enabled: true });
      setCategories(cmp, [cat('a'), cat('b'), cat('child', { parent_id: 'id-a' })]);
      (cmp as any).restoreRootCategoryOrder(['b', 'a']);
      expect(cmp.rootCategories.map((c: Category) => c.slug)).toEqual(['b', 'a']);
    });

    it('startRenameCategory success ro lang with empty category name', () => {
      const { cmp, admin } = setup({ enabled: true });
      setCategories(cmp, [cat('a')]);
      TestBed.inject(TranslateService).use('ro');
      admin.getCategoryTranslations.and.returnValue(of([]) as any);
      cmp.startRenameCategory(dragEvent(), cat('a', { name: '' }));
      expect(cmp.renameNameRo).toBe('');
      expect(cmp.renameLoading).toBe(false);
    });

    it('reorderRootCategories skips children and unknown roots', () => {
      const { cmp } = setup({ enabled: true });
      setCategories(cmp, [cat('a'), cat('b'), cat('child', { parent_id: 'id-a' })]);
      cmp.categories.push(cat('extra')); // root not present in rootCategories list
      expect((cmp as any).reorderRootCategories('a', 'b')).toBe(true);
    });

    it('persist/undo reorder tolerate empty server response', () => {
      const { cmp, admin, toast } = setup({ enabled: true });
      setCategories(cmp, [cat('a'), cat('b')]);
      admin.reorderCategories.and.returnValue(of(null) as any);
      cmp.draggingRootCategorySlug = 'a';
      cmp.onRootCategoryDrop(dragEvent(), 'b');
      expect(toast.action).toHaveBeenCalled();

      admin.reorderCategories.and.returnValue(of(undefined) as any);
      (cmp as any).undoRootCategoryOrder(['a', 'b'], ['b', 'a']);
      expect(toast.success).toHaveBeenCalled();
    });

    it('fetchProducts tolerates missing items and tag-less products', () => {
      const { cmp, catalog } = setup();
      catalog.listProducts.and.returnValue(
        of({
          meta: { total_items: 1, total_pages: 1, page: 1, limit: 12 },
        }) as any,
      );
      cmp.loadProducts(false);
      expect(cmp.products).toEqual([]);

      catalog.listProducts.and.returnValue(
        of({
          items: [{ id: '1', slug: '1', name: 'X', base_price: 1, currency: 'RON' } as Product],
          meta: { total_items: 1, total_pages: 1, page: 1, limit: 12 },
        }),
      );
      cmp.loadProducts(false);
      expect(cmp.allTags).toEqual([]);
    });

    it('fetchProducts subcategory crumb falls back to slug', () => {
      const { cmp, catalog } = setup();
      cmp.categories = [
        { id: 'id-p', slug: 'p', name: 'Parent' } as Category,
        { id: 'id-c', slug: 'c', name: undefined as any, parent_id: 'id-p' } as Category,
      ];
      (cmp as any).rebuildCategoryTree();
      cmp.activeCategorySlug = 'p';
      cmp.activeSubcategorySlug = 'c';
      catalog.listProducts.and.returnValue(
        of({
          items: [product('1')],
          meta: { total_items: 1, total_pages: 1, page: 1, limit: 12 },
        }),
      );
      cmp.loadProducts(false);
      expect(cmp.crumbs[cmp.crumbs.length - 1].label).toBe('c');
    });

    it('onSidebarSearchChange / onPriceTextChange handle nullish inputs', () => {
      const { cmp } = setup();
      cmp.onSidebarSearchChange(null as any);
      expect(cmp.filters.search).toBe('');
      cmp.cancelFilterDebounce();
      cmp.onPriceTextChange('min', 'abc'); // parsed undefined -> min bound
      expect(cmp.filters.min_price).toBe(cmp.priceMinBound);
      cmp.cancelFilterDebounce();
    });

    it('resolveActiveCategoryLabel returns null for separator-only slug', () => {
      const { cmp } = setup();
      cmp.activeCategorySlug = '---';
      expect(cmp.resolveActiveCategoryLabel()).toBeNull();
    });

    it('onCategorySelected handles empty selection', () => {
      const { cmp } = setup();
      cmp.categorySelection = '';
      cmp.onCategorySelected();
      expect(cmp.activeCategorySlug).toBe('');
    });

    it('rebuildCategoryTree comparator handles nullish names and sort orders', () => {
      const { cmp } = setup();
      cmp.categories = [
        { id: 'id-a', slug: 'a', name: undefined as any, sort_order: undefined as any },
        { id: 'id-b', slug: 'b', name: undefined as any, sort_order: undefined as any },
      ];
      (cmp as any).rebuildCategoryTree();
      expect(cmp.rootCategories.length).toBe(2);
    });

    it('resultsMetaParams uses nullish meta defaults', () => {
      const { cmp } = setup();
      cmp.paginationMode = 'pages';
      cmp.pageMeta = { total_pages: 1 } as any; // total_items/page/limit missing
      expect(cmp.resultsMetaParams()).toEqual({ total: 0, from: 0, to: 0 });
    });

    it('initScrollRestoreFromSession bails when timestamp missing', () => {
      sessionStorage.clear();
      const { cmp } = setup({ routerUrl: '/shop' });
      sessionStorage.setItem('shop_return_pending', '1');
      sessionStorage.setItem('shop_return_url', '/shop');
      sessionStorage.setItem('shop_return_scroll_y', '50');
      // no shop_return_at -> getItem null -> '' -> stale
      cmp.initScrollRestoreFromSession();
      expect(cmp.restoreScrollY).toBeNull();
      sessionStorage.clear();
    });
  });
});
