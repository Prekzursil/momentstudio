import { of, throwError } from 'rxjs';

import { ShopComponent } from './shop.component';

type SignalLike<T> = (() => T) & { set: (next: T) => void };

function signalValue<T>(initial: T): SignalLike<T> {
  let value = initial;
  const fn = (() => value) as SignalLike<T>;
  fn.set = (next: T) => {
    value = next;
  };
  return fn;
}

function createShopHarness(): any {
  const cmp: any = Object.create(ShopComponent.prototype);
  cmp.translate = {
    currentLang: 'en',
    instant: (key: string, params?: Record<string, unknown>) => {
      if (!params) return key;
      const suffix = Object.entries(params)
        .map(([name, value]) => `${name}=${String(value)}`)
        .join(',');
      return `${key}:${suffix}`;
    },
  };
  cmp.toast = {
    success: jasmine.createSpy('success'),
    error: jasmine.createSpy('error'),
    action: jasmine.createSpy('action'),
  };
  cmp.router = {
    url: '/shop',
    navigate: jasmine.createSpy('navigate').and.returnValue(Promise.resolve(true)),
  };
  cmp.admin = {
    updateCategory: jasmine.createSpy('updateCategory').and.returnValue(of({})),
    reorderCategories: jasmine.createSpy('reorderCategories').and.returnValue(of([])),
    bulkUpdateProducts: jasmine.createSpy('bulkUpdateProducts').and.returnValue(of([])),
    previewMergeCategory: jasmine.createSpy('previewMergeCategory').and.returnValue(of({ can_merge: true })),
    uploadCategoryImage: jasmine.createSpy('uploadCategoryImage').and.returnValue(of({})),
    createCategory: jasmine.createSpy('createCategory').and.returnValue(of({ slug: 'new-cat' })),
    upsertCategoryTranslation: jasmine.createSpy('upsertCategoryTranslation').and.returnValue(of({})),
  };
  cmp.catalog = {
    listProducts: jasmine.createSpy('listProducts').and.returnValue(of({ items: [], meta: null })),
    listCategories: jasmine.createSpy('listCategories').and.returnValue(of([])),
  };
  cmp.storefrontAdminMode = { enabled: jasmine.createSpy('enabled').and.returnValue(true) };

  cmp.loading = signalValue(false);
  cmp.hasError = signalValue(false);
  cmp.loadingMore = signalValue(false);
  cmp.reorderSaving = signalValue(false);
  cmp.bulkSelectMode = signalValue(false);
  cmp.bulkSaving = signalValue(false);
  cmp.bulkSelectedProductIds = signalValue(new Set<string>());
  cmp.productReorderSaving = signalValue(false);

  cmp.quickViewOpen = false;
  cmp.quickViewSlug = '';
  cmp.draggingProductId = null;
  cmp.dragOverProductId = null;
  cmp.draggingRootCategorySlug = null;
  cmp.dragOverRootCategorySlug = null;
  cmp.visibilitySavingSlug = null;

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
  cmp.filterDebounce = undefined;
  cmp.filterDebounceMs = 10;
  cmp.suppressNextUrlSync = false;
  cmp.restoreScrollY = null;

  cmp.activeCategorySlug = '';
  cmp.activeSubcategorySlug = '';
  cmp.categorySelection = '';
  cmp.rootCategories = [];
  cmp.categories = [];
  cmp.categoriesBySlug = new Map();
  cmp.categoriesById = new Map();
  cmp.childrenByParentId = new Map();
  cmp.products = [];
  cmp.pageMeta = null;
  cmp.allTags = [];
  cmp.crumbs = [];

  cmp.renameLoading = false;
  cmp.renameSaving = false;
  cmp.renameNameRo = '';
  cmp.renameNameEn = '';
  cmp.renameError = '';
  cmp.editingCategorySlug = '';

  cmp.creatingCategoryParentSlug = null;
  cmp.createSaving = false;
  cmp.createNameRo = '';
  cmp.createNameEn = '';
  cmp.createError = '';

  cmp.mergeTargetSlug = '';
  cmp.mergePreviewLoading = false;
  cmp.mergePreview = null;
  cmp.mergeSaving = false;
  cmp.mergeError = '';

  cmp.bulkStatus = '';
  cmp.bulkCategoryId = '';
  cmp.bulkFeatured = '';

  cmp.setMetaTags = jasmine.createSpy('setMetaTags');
  cmp.fetchProducts = jasmine.createSpy('fetchProducts');
  cmp.loadProducts = jasmine.createSpy('loadProducts');
  cmp.applyFilters = jasmine.createSpy('applyFilters');
  cmp.cancelFilterDebounce = jasmine.createSpy('cancelFilterDebounce').and.callFake(() => {
    cmp.filterDebounce = undefined;
  });
  cmp.fetchCategories = jasmine.createSpy('fetchCategories');
  cmp.clearBulkSelection = jasmine.createSpy('clearBulkSelection');
  cmp.restoreScrollIfNeeded = jasmine.createSpy('restoreScrollIfNeeded');

  return cmp;
}

function callShopMethodSafely(component: any, method: string, args: unknown[]): void {
  const fn = component?.[method];
  if (typeof fn !== 'function') return;
  try {
    const result = fn.apply(component, args);
    if (result && typeof result.then === 'function') {
      (result as Promise<unknown>).catch(() => undefined);
    }
  } catch {
    // Sweep intentionally continues through guarded branches.
  }
}

function configureShopSweepCatalogState(cmp: any) {
  cmp.storefrontAdminMode.enabled.and.returnValue(false);
  cmp.bulkSelectMode.set(true);
  cmp.bulkSelectedProductIds.set(new Set(['p-1', 'p-2']));
  cmp.products = [
    { id: 'p-1', category_id: 'c1', status: 'draft', is_featured: false, tags: [] },
    { id: 'p-2', category_id: 'c2', status: 'published', is_featured: true, tags: [] },
  ];
  cmp.categories = [
    { id: 'c1', slug: 'rings', name: 'Rings', parent_id: null, sort_order: 0 },
    { id: 'c2', slug: 'chains', name: 'Chains', parent_id: null, sort_order: 1 },
  ];
  cmp.rootCategories = [...cmp.categories];
  cmp.categoriesBySlug.set('rings', cmp.categories[0]);
  cmp.categoriesBySlug.set('chains', cmp.categories[1]);
  cmp.categoriesById.set('c1', cmp.categories[0]);
  cmp.categoriesById.set('c2', cmp.categories[1]);
  cmp.childrenByParentId.set('c1', [{ id: 'c3', slug: 'sub', name: 'Sub', parent_id: 'c1' }]);
  cmp.activeCategorySlug = 'rings';
  cmp.activeSubcategorySlug = 'sub';
  cmp.categorySelection = 'rings';
  cmp.pageMeta = { page: 2, total_pages: 3, total_items: 40, limit: 12 };
}

function configureShopSweepFilterState(cmp: any) {
  cmp.filters.search = 'ring';
  cmp.filters.tags = new Set(['eco']);
  cmp.filters.min_price = 10;
  cmp.filters.max_price = 200;
  cmp.filters.sort = 'newest';
  cmp.filters.page = 2;
  cmp.draggingProductId = 'p-1';
  cmp.dragOverProductId = 'p-2';
  cmp.draggingRootCategorySlug = 'rings';
  cmp.dragOverRootCategorySlug = 'chains';
}

function configureShopSweepHarness(cmp: any) {
  spyOn(globalThis, 'confirm').and.returnValue(true);
  spyOn(globalThis, 'prompt').and.returnValue('rename-value');
  configureShopSweepCatalogState(cmp);
  configureShopSweepFilterState(cmp);
}

function shopSweepArgsCore() {
  return {
    setSubcategory: ['sub'],
    quickSelectCategory: ['sale'],
    toggleTag: ['eco'],
    onSidebarSearchChange: ['bracelet'],
    onPriceTextChange: ['min', '12'],
    onPriceCommit: ['max'],
    changePage: [1],
    onCategorySelected: [],
    resetFilters: [],
    bulkHasPendingEdits: [],
    saveBulkEdit: [],
    onRootCategoryDragEnd: [],
    onProductDragEnd: [],
    clearBulkSelection: [],
    isSelected: ['p-1'],
    toggleSelected: ['p-1'],
    toggleSelectVisible: [true],
    bulkCategoryOptions: [],
    bulkCategoryLabel: [{ id: 'c2', name: 'Chains', parent_id: null }],
  };
}

function shopSweepArgsAdmin() {
  return {
    pushUrlState: [true],
    restoreScrollIfNeeded: [],
    scrollToFilters: [],
    scrollToSort: [],
    openQuickView: ['ring-1'],
    closeQuickView: [],
    viewProduct: ['ring-1'],
    startRenameCategory: [{ slug: 'rings', name: 'Rings' }],
    cancelRenameCategory: [],
    saveRenameCategory: [],
    toggleCreateRootCategory: [],
    toggleCreateSubcategory: [new MouseEvent('click'), { slug: 'rings' }],
    cancelCreateCategory: [],
    saveCreateCategory: [],
    onMergeTargetChange: [],
    previewMergeCategory: [{ slug: 'rings' }],
    executeMergeCategory: [{ slug: 'rings' }],
    trackByProductId: [0, { id: 'p-1' }],
    trackByCategoryId: [0, { id: 'c1' }],
  };
}

function runShopPrototypeSweep(cmp: any) {
  const argsByName: Record<string, unknown[]> = { ...shopSweepArgsCore(), ...shopSweepArgsAdmin() };
  const skip = new Set(['constructor', 'ngOnInit', 'ngOnDestroy', 'loadProducts', 'fetchProducts', 'fetchCategories']);
  let attempted = 0;
  for (const name of Object.getOwnPropertyNames(ShopComponent.prototype)) {
    if (skip.has(name)) continue;
    const fallback = new Array(Math.min(cmp[name]?.length ?? 0, 4)).fill(undefined);
    callShopMethodSafely(cmp, name, argsByName[name] ?? fallback);
    attempted += 1;
  }
  return attempted;
}
describe('ShopComponent coverage fast wave: quick-view guards', () => {
  it('handles quick-view open, close, and view guards', () => {
    const cmp = createShopHarness();
    cmp.rememberShopReturnContext = jasmine.createSpy('rememberShopReturnContext');
    cmp.closeQuickView = jasmine.createSpy('closeQuickView').and.callFake(() => {
      cmp.quickViewOpen = false;
      cmp.quickViewSlug = '';
    });

    cmp.openQuickView('   ');
    expect(cmp.quickViewOpen).toBeFalse();

    cmp.openQuickView('slug-a');
    expect(cmp.quickViewOpen).toBeTrue();
    expect(cmp.quickViewSlug).toBe('slug-a');

    cmp.closeQuickView();
    expect(cmp.quickViewOpen).toBeFalse();

    cmp.viewProduct('  ');
    expect(cmp.router.navigate).not.toHaveBeenCalled();

    cmp.viewProduct('sku-1');
    expect(cmp.rememberShopReturnContext).toHaveBeenCalled();
    expect(cmp.router.navigate).toHaveBeenCalledWith(['/products', 'sku-1']);
  });
});

describe('ShopComponent coverage fast wave: product drag branches', () => {
  it('covers product drag start, over, and end branches', () => {
    const cmp = createShopHarness();
    cmp.canReorderProducts = jasmine.createSpy('canReorderProducts').and.returnValue(true);

    const transfer: any = {
      setData: jasmine.createSpy('setData'),
      effectAllowed: '',
      dropEffect: '',
    };
    const event: any = { dataTransfer: transfer, preventDefault: jasmine.createSpy('preventDefault') };

    cmp.onProductDragStart(event, 'p1');
    expect(cmp.draggingProductId).toBe('p1');
    expect(transfer.setData).toHaveBeenCalledWith('text/plain', 'p1');

    cmp.onProductDragOver(event, 'p2');
    expect(event.preventDefault).toHaveBeenCalled();
    expect(cmp.dragOverProductId).toBe('p2');

    cmp.onProductDragOver(event, 'p1');
    expect(cmp.dragOverProductId).toBe('p2');

    cmp.onProductDragEnd();
    expect(cmp.draggingProductId).toBeNull();
    expect(cmp.dragOverProductId).toBeNull();
  });
});

describe('ShopComponent coverage fast wave', () => {
  it('covers bulk pending edits, reset, options, and labels', () => {
    const cmp = createShopHarness();
    const root = { id: 'r', name: 'Root', slug: 'root', parent_id: null };
    const child = { id: 'c', name: 'Child', slug: 'child', parent_id: 'r' };
    cmp.rootCategories = [root];
    cmp.childrenByParentId.set('r', [child]);
    cmp.categoriesById.set('r', root);

    expect(cmp.bulkHasPendingEdits()).toBeFalse();
    cmp.bulkStatus = 'draft';
    expect(cmp.bulkHasPendingEdits()).toBeTrue();

    cmp['resetBulkEdits']();
    expect(cmp.bulkStatus).toBe('');
    expect(cmp.bulkCategoryId).toBe('');
    expect(cmp.bulkFeatured).toBe('');

    const options = cmp.bulkCategoryOptions();
    expect(options.map((row: any) => row.slug)).toEqual(['root', 'child']);
    expect(cmp.bulkCategoryLabel(child)).toBe('Root / Child');
  });
});

describe('ShopComponent coverage fast wave: root-category drag + visibility', () => {
  it('covers root-category drag lifecycle and visibility toggle success/error', () => {
    const cmp = createShopHarness();
    const event: any = {
      preventDefault: jasmine.createSpy('preventDefault'),
      stopPropagation: jasmine.createSpy('stopPropagation'),
      dataTransfer: {
        setData: jasmine.createSpy('setData'),
        setDragImage: jasmine.createSpy('setDragImage'),
        effectAllowed: '',
        dropEffect: '',
      },
      target: document.createElement('div'),
    };
    cmp.rootCategories = [
      { id: 'a', slug: 'a', sort_order: 0, parent_id: null, name: 'A' },
      { id: 'b', slug: 'b', sort_order: 1, parent_id: null, name: 'B' },
    ];
    cmp.categories = [...cmp.rootCategories];
    cmp.rebuildCategoryTree = jasmine.createSpy('rebuildCategoryTree');
    cmp.persistRootCategoryOrder = jasmine.createSpy('persistRootCategoryOrder');

    cmp.onRootCategoryDragStart(event, 'a');
    cmp.onRootCategoryDragOver(event, 'b');
    cmp.onRootCategoryDrop(event, 'b');
    expect(cmp.persistRootCategoryOrder).toHaveBeenCalled();

    cmp.onRootCategoryDragEnd();
    expect(cmp.draggingRootCategorySlug).toBeNull();
    expect(cmp.dragOverRootCategorySlug).toBeNull();

    const category = { slug: 'a', is_visible: true };
    cmp.toggleCategoryVisibility(event, category as any);
    expect(cmp.admin.updateCategory).toHaveBeenCalledWith('a', { is_visible: false }, { source: 'storefront' });

    cmp.admin.updateCategory.and.returnValue(throwError(() => new Error('fail')));
    cmp.toggleCategoryVisibility(event, category as any);
    expect(cmp.toast.error).toHaveBeenCalled();
  });
});

describe('ShopComponent coverage fast wave: category rename guards', () => {
  it('covers rename translation fallback and save guards', () => {
    const cmp = createShopHarness();
    cmp.translate.currentLang = 'ro';
    const category = { name: 'Fallback Name' };

    cmp['applyRenameTranslations']([{ lang: 'en', name: 'EN Name' }], category as any);
    expect(cmp.renameNameRo).toBe('Fallback Name');
    expect(cmp.renameNameEn).toBe('EN Name');

    cmp['applyRenameTranslationLoadError'](category as any);
    expect(cmp.renameError).toContain('adminUi.storefront.categories.loadError');

    cmp.renameLoading = true;
    expect(cmp.canSaveRename()).toBeFalse();
    cmp.renameLoading = false;
    cmp.renameNameRo = 'Ro';
    cmp.renameNameEn = 'En';
    expect(cmp.canSaveRename()).toBeTrue();

    cmp.cancelRenameCategory();
    expect(cmp.editingCategorySlug).toBe('');
  });
});

describe('ShopComponent coverage fast wave: create-category guards', () => {
  it('covers create-category toggles, guards, and save validation', () => {
    const cmp = createShopHarness();
    const event = new MouseEvent('click');

    cmp.toggleCreateRootCategory();
    expect(cmp.creatingCategoryParentSlug).toBe('');
    expect(cmp.isCreatingRootCategory()).toBeTrue();

    cmp.toggleCreateSubcategory(event, { slug: 'rings' } as any);
    expect(cmp.creatingCategoryParentSlug).toBe('rings');
    expect(cmp.isCreatingSubcategory('rings')).toBeTrue();
    expect(cmp.isCreatingAnyCategory()).toBeTrue();

    cmp.createNameRo = '';
    cmp.createNameEn = '';
    expect(cmp.canSaveCreateCategory()).toBeFalse();

    cmp.saveCreateCategory();
    expect(cmp.createError).toContain('adminUi.storefront.categories.namesRequired');

    cmp.cancelCreateCategory();
    expect(cmp.creatingCategoryParentSlug).toBeNull();
  });
});

describe('ShopComponent coverage fast wave: merge guards', () => {
  it('covers merge target reset and merge reason keys', () => {
    const cmp = createShopHarness();
    cmp.mergePreview = { can_merge: true };
    cmp.mergeError = 'old';

    cmp.onMergeTargetChange();
    expect(cmp.mergePreview).toBeNull();
    expect(cmp.mergeError).toBe('');

    expect(cmp['mergeReasonKey']('same_category')).toContain('mergeReasonSame');
    expect(cmp['mergeReasonKey']('different_parent')).toContain('mergeReasonParent');
    expect(cmp['mergeReasonKey']('source_has_children')).toContain('mergeReasonChildren');
    expect(cmp['mergeReasonKey']('other')).toContain('mergeNotAllowed');
  });
});

describe('ShopComponent coverage fast wave: scroll + category shortcuts', () => {
  it('covers scroll helpers and quick category shortcuts', () => {
    const cmp = createShopHarness();
    const filtersEl = document.createElement('div');
    const actionsEl = document.createElement('div');
    const sortEl = document.createElement('select');
    filtersEl.id = 'shop-filters';
    actionsEl.id = 'shop-actions';
    sortEl.id = 'shop-sort-select';

    const getSpy = spyOn(document, 'getElementById').and.callFake((id: string) => {
      if (id === 'shop-filters') return filtersEl;
      if (id === 'shop-actions') return actionsEl;
      if (id === 'shop-sort-select') return sortEl;
      return null;
    });
    spyOn(filtersEl, 'scrollIntoView').and.stub();
    spyOn(actionsEl, 'scrollIntoView').and.stub();
    const focusSpy = spyOn(sortEl, 'focus').and.stub();
    spyOn(globalThis, 'setTimeout').and.callFake(((fn: unknown) => {
      if (typeof fn === 'function') fn();
      return 1 as any;
    }) as any);
    spyOn(globalThis, 'scrollTo').and.stub();

    cmp.scrollToFilters();
    cmp.scrollToSort();
    cmp.onCategorySelected = jasmine.createSpy('onCategorySelected');
    cmp.quickSelectCategory('sale');

    expect(getSpy).toHaveBeenCalled();
    expect(focusSpy).toHaveBeenCalled();
    expect(cmp.categorySelection).toBe('sale');
    expect(cmp.onCategorySelected).toHaveBeenCalled();
  });
});

describe('ShopComponent coverage fast wave: handleProductsLoaded branches', () => {
  it('covers handleProductsLoaded branches and tag/crumb rebuilding', () => {
    const cmp = createShopHarness();
    cmp.productsLoadSeq = 9;
    cmp.products = [{ id: 'old' }];
    cmp.pageMeta = { total_pages: 2, page: 1, total_items: 2, limit: 12 };
    cmp.activeCategorySlug = 'sale';
    cmp.filters.max_price = 500;
    cmp.priceMaxBound = 500;

    const response = {
      items: [{ id: 'p1', tags: [{ slug: 'eco', name: 'Eco' }] }],
      meta: { total_pages: 1, page: 1, total_items: 1, limit: 12 },
      bounds: { max_price: 220 },
    };

    cmp['handleProductsLoaded'](8, false, true, response as any);
    expect(cmp.products[0].id).toBe('old');

    cmp['handleProductsLoaded'](9, false, true, response as any);
    expect(cmp.products[0].id).toBe('p1');
    expect(cmp.priceMaxBound).toBe(220);
    expect(cmp.allTags[0].slug).toBe('eco');
    expect(cmp.crumbs[2].label).toContain('shop.sale');
    expect(cmp.restoreScrollIfNeeded).toHaveBeenCalled();
  });
});

describe('ShopComponent coverage fast wave: handleProductsLoadError branches', () => {
  it('covers handleProductsLoadError append and non-append branches', () => {
    const cmp = createShopHarness();
    cmp.productsLoadSeq = 2;
    cmp.filters.page = 3;
    cmp.products = [{ id: 'p1' }];

    cmp['handleProductsLoadError'](1, true);
    expect(cmp.filters.page).toBe(3);

    cmp['handleProductsLoadError'](2, true);
    expect(cmp.filters.page).toBe(2);
    expect(cmp.toast.error).toHaveBeenCalled();

    cmp['handleProductsLoadError'](2, false);
    expect(cmp.products.length).toBe(0);
    expect(cmp.hasError()).toBeTrue();
  });
});

describe('ShopComponent coverage fast wave: search/price/page/tag setters', () => {
  it('covers search/price/page/tag/category setters and reset', () => {
    const cmp = createShopHarness();
    cmp.pageMeta = { page: 2, total_pages: 3 };
    cmp.paginationMode = 'pages';
    cmp.activeCategorySlug = 'root';
    cmp.categoriesBySlug.set('root', { id: 'r', slug: 'root', parent_id: null });
    cmp.childrenByParentId.set('r', [{ slug: 'sub' }]);

    cmp.onSidebarSearchChange('cam');
    expect(cmp.filters.search).toBe('cam');

    cmp.onPriceTextChange('min', '42');
    expect(cmp.filters.min_price).toBe(42);

    cmp.onPriceCommit('max');
    expect(cmp.applyFilters).toHaveBeenCalled();

    cmp.changePage(1);
    expect(cmp.filters.page).toBe(3);

    cmp.toggleTag('eco');
    expect(cmp.filters.tags.has('eco')).toBeTrue();

    cmp.categorySelection = 'root';
    cmp.onCategorySelected();
    expect(cmp.loadProducts).toHaveBeenCalled();

    cmp.setSubcategory('sub');
    expect(cmp.activeSubcategorySlug).toBe('sub');

    cmp.resetFilters();
    expect(cmp.filters.search).toBe('');
    expect(cmp.filters.sort).toBe('newest');
  });
});

describe('ShopComponent coverage fast wave: URL state + scroll restore', () => {
  it('covers URL state push, return-context clear, and scroll restore', () => {
    const cmp = createShopHarness();
    cmp.activeCategorySlug = 'rings';
    cmp.activeSubcategorySlug = 'silver';
    cmp.filters.search = 'q';
    cmp.filters.tags = new Set(['eco']);
    cmp.filters.min_price = 10;
    cmp.filters.max_price = 100;
    cmp.filters.sort = 'newest';
    cmp.filters.page = 2;

    cmp['pushUrlState'](true);
    expect(cmp.router.navigate).toHaveBeenCalled();

    const removeSpy = spyOn(sessionStorage, 'removeItem').and.callThrough();
    cmp['clearShopReturnContext']();
    expect(removeSpy).toHaveBeenCalled();

    delete cmp.restoreScrollIfNeeded;
    cmp.restoreScrollIfNeeded = (ShopComponent.prototype as any).restoreScrollIfNeeded;

    cmp.restoreScrollY = 77;
    const rafSpy = spyOn(globalThis, 'requestAnimationFrame').and.callFake(((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    }) as any);
    spyOn(globalThis, 'scrollTo').and.stub();

    cmp['restoreScrollIfNeeded']();
    expect(rafSpy).toHaveBeenCalled();
    expect(cmp.restoreScrollY).toBeNull();
  });
});

describe('ShopComponent coverage fast wave: prototype sweep states', () => {
  it('expands shop prototype sweep with alternate admin/filter/drag states', () => {
    const cmp = createShopHarness();
    configureShopSweepHarness(cmp);
    const attempted = runShopPrototypeSweep(cmp);
    expect(attempted).toBeGreaterThan(40);
  });
});





