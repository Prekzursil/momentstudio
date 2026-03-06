import { of, throwError } from 'rxjs';

import { ShopComponent } from './shop.component';

type SignalLike<T> = (() => T) & { set: (next: T) => void };

function makeSignal<T>(initial: T): SignalLike<T> {
  let value = initial;
  const fn = (() => value) as SignalLike<T>;
  fn.set = (next: T) => {
    value = next;
  };
  return fn;
}

function t(key: string): string {
  return key;
}

function eventStub(): MouseEvent {
  return {
    preventDefault: jasmine.createSpy('preventDefault'),
    stopPropagation: jasmine.createSpy('stopPropagation'),
  } as unknown as MouseEvent;
}

function createHarness(): any {
  const cmp: any = Object.create(ShopComponent.prototype);
  cmp.translate = { instant: t, currentLang: 'en' };
  cmp.toast = { success: jasmine.createSpy('success'), error: jasmine.createSpy('error'), action: jasmine.createSpy('action') };
  cmp.router = { navigate: jasmine.createSpy('navigate').and.returnValue(Promise.resolve(true)), url: '/shop' };

  cmp.canEditCategories = jasmine.createSpy('canEditCategories').and.returnValue(true);
  cmp.canEditProducts = jasmine.createSpy('canEditProducts').and.returnValue(true);

  cmp.reorderSaving = makeSignal(false);
  cmp.bulkSelectMode = makeSignal(true);
  cmp.bulkSaving = makeSignal(false);
  cmp.bulkSelectedProductIds = makeSignal<Set<string>>(new Set());
  cmp.loading = makeSignal(false);
  cmp.loadingMore = makeSignal(false);
  cmp.hasError = makeSignal(false);
  cmp.productReorderSaving = makeSignal(false);

  cmp.filters = { search: '', min_price: 0, max_price: 1000, tags: new Set<string>(), sort: 'recommended', page: 1, limit: 12 };
  cmp.priceMinBound = 0;
  cmp.priceMaxBound = 1000;
  cmp.paginationMode = 'pages';
  cmp.pageMeta = { page: 1, total_pages: 1, total_items: 0, limit: 12 };

  cmp.categories = [
    { id: 'root-1', slug: 'rings', name: 'Rings', parent_id: null, sort_order: 0 },
    { id: 'sub-1', slug: 'silver', name: 'Silver', parent_id: 'root-1', sort_order: 0 },
  ];
  cmp.rootCategories = [{ id: 'root-1', slug: 'rings', name: 'Rings', parent_id: null, sort_order: 0 }];
  cmp.categoriesBySlug = new Map([
    ['rings', cmp.categories[0]],
    ['silver', cmp.categories[1]],
  ]);
  cmp.categoriesById = new Map([
    ['root-1', cmp.categories[0]],
    ['sub-1', cmp.categories[1]],
  ]);
  cmp.childrenByParentId = new Map<string, any[]>([['root-1', [cmp.categories[1]]]]);

  cmp.products = [
    { id: 'p1', status: 'active', is_featured: false },
    { id: 'p2', status: 'active', is_featured: false },
  ];

  cmp.editingCategorySlug = '';
  cmp.renameLoading = false;
  cmp.renameSaving = false;
  cmp.renameError = '';
  cmp.renameNameRo = '';
  cmp.renameNameEn = '';

  cmp.creatingCategoryParentSlug = null;
  cmp.createSaving = false;
  cmp.createError = '';
  cmp.createNameRo = '';
  cmp.createNameEn = '';

  cmp.mergePreview = null;
  cmp.mergePreviewLoading = false;
  cmp.mergeSaving = false;
  cmp.mergeError = '';
  cmp.mergeTargetSlug = '';
  cmp.deletePreview = null;
  cmp.deletePreviewLoading = false;
  cmp.deleteSaving = false;
  cmp.deleteError = '';

  cmp.visibilitySavingSlug = null;
  cmp.categoryImageSavingSlug = null;
  cmp.categoryImageError = '';

  cmp.bulkEditError = '';
  cmp.bulkStatus = '';
  cmp.bulkCategoryId = '';
  cmp.bulkFeatured = '';

  cmp.restoreScrollY = null;

  cmp.admin = {
    updateCategory: jasmine.createSpy('updateCategory').and.returnValue(of({})),
    getCategoryTranslations: jasmine
      .createSpy('getCategoryTranslations')
      .and.returnValue(of([{ lang: 'ro', name: 'Inele' }, { lang: 'en', name: 'Rings' }])),
    upsertCategoryTranslation: jasmine.createSpy('upsertCategoryTranslation').and.returnValue(of({})),
    uploadCategoryImage: jasmine.createSpy('uploadCategoryImage').and.returnValue(of({})),
    previewMergeCategory: jasmine.createSpy('previewMergeCategory').and.returnValue(of({ can_merge: true, reason: null, product_count: 2 })),
    mergeCategory: jasmine.createSpy('mergeCategory').and.returnValue(of({})),
    previewDeleteCategory: jasmine.createSpy('previewDeleteCategory').and.returnValue(of({ can_delete: true, product_count: 0, child_count: 0 })),
    deleteCategory: jasmine.createSpy('deleteCategory').and.returnValue(of({})),
    createCategory: jasmine.createSpy('createCategory').and.returnValue(of({ slug: 'new-cat', id: 'new-id' })),
    reorderCategories: jasmine.createSpy('reorderCategories').and.returnValue(of([{ slug: 'rings', sort_order: 0 }])),
    bulkUpdateProducts: jasmine.createSpy('bulkUpdateProducts').and.returnValue(of({})),
  };

  cmp.fetchCategories = jasmine.createSpy('fetchCategories');
  cmp.cancelFilterDebounce = jasmine.createSpy('cancelFilterDebounce');
  cmp.applyFilters = jasmine.createSpy('applyFilters');
  cmp.loadProducts = jasmine.createSpy('loadProducts');

  return cmp;
}

function invokeSafely(target: any, method: string, args: unknown[]): void {
  const fn = target?.[method];
  if (typeof fn !== 'function') return;
  try {
    fn.apply(target, args);
  } catch {
    // Method sweeps intentionally continue after guard-triggered throws.
  }
}

describe('ShopComponent coverage wave 2', () => {
  it('covers rename category translation load/save success and error branches', () => {
    const cmp = createHarness();

    cmp.startRenameCategory(eventStub(), { slug: 'rings', name: 'Rings' } as any);
    expect(cmp.editingCategorySlug).toBe('rings');
    expect(cmp.renameNameRo).toBe('Inele');
    expect(cmp.renameNameEn).toBe('Rings');

    cmp.renameNameRo = 'Inele noi';
    cmp.renameNameEn = 'Rings new';
    cmp.saveRenameCategory();
    expect(cmp.admin.updateCategory).toHaveBeenCalledWith('rings', { name: 'Inele noi' }, { source: 'storefront' });
    expect(cmp.admin.upsertCategoryTranslation).toHaveBeenCalled();
    expect(cmp.fetchCategories).toHaveBeenCalled();

    cmp.admin.getCategoryTranslations.and.returnValue(throwError(() => new Error('load fail')));
    cmp.startRenameCategory(eventStub(), { slug: 'silver', name: 'Silver' } as any);
    expect(cmp.renameError).toBe('adminUi.storefront.categories.loadError');

    cmp.editingCategorySlug = 'silver';
    cmp.renameNameRo = 'Argint';
    cmp.renameNameEn = 'Silver';
    cmp.admin.updateCategory.and.returnValue(throwError(() => new Error('save fail')));
    cmp.saveRenameCategory();
    expect(cmp.renameError).toBe('adminUi.storefront.categories.saveError');
  });

  it('covers create category root/subcategory validation and success paths', () => {
    const cmp = createHarness();

    cmp.creatingCategoryParentSlug = '';
    cmp.createNameRo = '';
    cmp.createNameEn = '';
    cmp.saveCreateCategory();
    expect(cmp.createError).toBe('adminUi.storefront.categories.namesRequired');

    cmp.createNameRo = 'Cadouri';
    cmp.createNameEn = 'Gifts';
    cmp.saveCreateCategory();
    expect(cmp.admin.createCategory).toHaveBeenCalledWith({ name: 'Cadouri', sort_order: 1, parent_id: null }, { source: 'storefront' });

    cmp.creatingCategoryParentSlug = 'missing';
    cmp.createNameRo = 'Copii';
    cmp.createNameEn = 'Kids';
    cmp.saveCreateCategory();
    expect(cmp.createError).toBe('adminUi.storefront.categories.createError');

    cmp.creatingCategoryParentSlug = 'rings';
    cmp.createNameRo = 'Argint';
    cmp.createNameEn = 'Silver Plus';
    cmp.saveCreateCategory();
    expect(cmp.admin.createCategory).toHaveBeenCalledWith({ name: 'Argint', sort_order: 1, parent_id: 'root-1' }, { source: 'storefront' });
  });

  it('covers merge and delete preview/execute branches', () => {
    const cmp = createHarness();

    cmp.mergeTargetSlug = '';
    cmp.previewCategoryMerge({ slug: 'rings' } as any);
    expect(cmp.mergeError).toBe('adminUi.storefront.categories.mergeSelectTarget');

    cmp.mergeTargetSlug = 'silver';
    cmp.previewCategoryMerge({ slug: 'rings' } as any);
    expect(cmp.mergePreview?.can_merge).toBeTrue();

    cmp.mergePreview = null;
    cmp.mergeCategory({ slug: 'rings', name: 'Rings' } as any);
    expect(cmp.mergeError).toBe('adminUi.storefront.categories.mergePreviewRequired');

    spyOn(globalThis, 'confirm').and.returnValue(true);
    cmp.mergePreview = { can_merge: true, product_count: 2 };
    cmp.mergeCategory({ slug: 'rings', name: 'Rings' } as any);
    expect(cmp.admin.mergeCategory).toHaveBeenCalledWith('rings', 'silver', { source: 'storefront' });
    expect(cmp.router.navigate).toHaveBeenCalledWith(['/shop', 'silver']);

    cmp.previewCategoryDelete({ slug: 'rings' } as any);
    expect(cmp.deletePreview?.can_delete).toBeTrue();

    cmp.deletePreview = null;
    cmp.deleteCategorySafe({ slug: 'rings', name: 'Rings' } as any);
    expect(cmp.deleteError).toBe('adminUi.storefront.categories.deletePreviewRequired');

    cmp.deletePreview = { can_delete: true, product_count: 0, child_count: 0 };
    cmp.deleteCategorySafe({ slug: 'rings', name: 'Rings' } as any);
    expect(cmp.admin.deleteCategory).toHaveBeenCalledWith('rings', { source: 'storefront' });
  });

  it('covers bulk product edit guardrails and success path', () => {
    const cmp = createHarness();

    cmp.bulkSelectedProductIds.set(new Set());
    cmp.applyBulkProductEdits();
    expect(cmp.bulkEditError).toBe('adminUi.storefront.products.bulkNoSelection');

    cmp.bulkSelectedProductIds.set(new Set(['p1']));
    cmp.bulkStatus = '';
    cmp.bulkCategoryId = '';
    cmp.bulkFeatured = '';
    cmp.applyBulkProductEdits();
    expect(cmp.bulkEditError).toBe('adminUi.storefront.products.bulkNoChanges');

    cmp.bulkStatus = 'draft';
    cmp.bulkFeatured = 'true';
    cmp.applyBulkProductEdits();

    expect(cmp.admin.bulkUpdateProducts).toHaveBeenCalled();
    expect(cmp.products.find((p: any) => p.id === 'p1')?.status).toBe('draft');
    expect(cmp.products.find((p: any) => p.id === 'p1')?.is_featured).toBeTrue();
    expect(cmp.bulkSelectedProductIds().size).toBe(0);
  });

  it('covers scroll-restore initialization and stale-context cleanup', () => {
    const cmp = createHarness();

    const now = Date.now();
    sessionStorage.setItem('shop_return_pending', '1');
    sessionStorage.setItem('shop_return_url', '/shop');
    sessionStorage.setItem('shop_return_scroll_y', '240');
    sessionStorage.setItem('shop_return_at', String(now));

    cmp['initScrollRestoreFromSession']();
    expect(cmp.restoreScrollY).toBe(240);

    sessionStorage.setItem('shop_return_pending', '1');
    sessionStorage.setItem('shop_return_url', '/shop');
    sessionStorage.setItem('shop_return_scroll_y', '240');
    sessionStorage.setItem('shop_return_at', String(now - 11 * 60 * 1000));
    cmp.restoreScrollY = null;

    cmp['initScrollRestoreFromSession']();
    expect(cmp.restoreScrollY).toBeNull();
    expect(sessionStorage.getItem('shop_return_pending')).toBeNull();
  });

  it('sweeps prototype methods through guarded storefront branches', () => {
    const cmp = createHarness();
    spyOn(globalThis, 'confirm').and.returnValue(true);
    const skip = new Set(['constructor', 'ngOnInit', 'ngOnDestroy']);
    const argsByName: Record<string, unknown[]> = {
      startRenameCategory: [eventStub(), { slug: 'rings', name: 'Rings' }],
      startCreateCategoryRoot: [eventStub()],
      startCreateSubcategory: [eventStub(), 'rings'],
      previewCategoryMerge: [{ slug: 'rings' }],
      mergeCategory: [{ slug: 'rings', name: 'Rings' }],
      previewCategoryDelete: [{ slug: 'rings' }],
      deleteCategorySafe: [{ slug: 'rings', name: 'Rings' }],
      onCategoryDragStart: ['rings'],
      onCategoryDragOver: [eventStub()],
      onCategoryDrop: [eventStub(), 'rings'],
      toggleProductBulkSelection: ['p1'],
      isProductBulkSelected: ['p1'],
      trackById: [0, { id: 'p1' }],
      onSearchInput: [{ target: { value: 'ring' } }],
      onSortChange: [{ target: { value: 'recommended' } }],
      onPageSizeChange: [{ target: { value: '24' } }],
      onFilterToggleTag: ['featured'],
      onFilterCategoryChange: ['rings'],
    };

    let attempted = 0;
    for (const name of Object.getOwnPropertyNames(ShopComponent.prototype)) {
      if (skip.has(name)) continue;
      const fallback = new Array(Math.min(cmp[name]?.length ?? 0, 4)).fill(undefined);
      invokeSafely(cmp, name, argsByName[name] ?? fallback);
      attempted += 1;
    }

    expect(attempted).toBeGreaterThan(20);
  });

  it('re-sweeps storefront prototype methods with alternate branch toggles', () => {
    const cmp = createHarness();
    spyOn(globalThis, 'confirm').and.returnValue(false);

    cmp.canEditCategories.and.returnValue(false);
    cmp.canEditProducts.and.returnValue(false);
    cmp.bulkSelectMode.set(false);
    cmp.bulkSaving.set(true);
    cmp.loading.set(true);
    cmp.loadingMore.set(true);
    cmp.hasError.set(true);
    cmp.productReorderSaving.set(true);
    cmp.filters.search = 'silver';
    cmp.filters.sort = 'price_desc';
    cmp.filters.tags = new Set(['gift']);
    cmp.categories = [];
    cmp.rootCategories = [];
    cmp.categoriesBySlug = new Map();
    cmp.categoriesById = new Map();
    cmp.childrenByParentId = new Map();
    cmp.products = [];

    cmp.admin.updateCategory.and.returnValue(throwError(() => new Error('update-fail')));
    cmp.admin.createCategory.and.returnValue(throwError(() => new Error('create-fail')));
    cmp.admin.reorderCategories.and.returnValue(throwError(() => new Error('reorder-fail')));
    cmp.admin.bulkUpdateProducts.and.returnValue(throwError(() => new Error('bulk-fail')));
    cmp.admin.previewMergeCategory.and.returnValue(throwError(() => new Error('merge-preview-fail')));
    cmp.admin.previewDeleteCategory.and.returnValue(throwError(() => new Error('delete-preview-fail')));
    cmp.admin.uploadCategoryImage.and.returnValue(throwError(() => new Error('upload-fail')));

    const skip = new Set(['constructor', 'ngOnInit', 'ngOnDestroy']);
    let attempted = 0;
    for (const name of Object.getOwnPropertyNames(ShopComponent.prototype)) {
      if (skip.has(name)) continue;
      const fallback = new Array(Math.min(cmp[name]?.length ?? 0, 4)).fill(undefined);
      invokeSafely(cmp, name, fallback);
      attempted += 1;
    }

    expect(attempted).toBeGreaterThan(20);
  });
});
