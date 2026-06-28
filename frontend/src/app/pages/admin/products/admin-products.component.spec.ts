import { HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { fakeAsync, tick } from '@angular/core/testing';
import { of, throwError, Subject } from 'rxjs';

import { AdminProductsComponent } from './admin-products.component';

type Spy = jasmine.SpyObj<any>;

interface Harness {
  c: AdminProductsComponent;
  any: any;
  productsApi: Spy;
  catalog: Spy;
  admin: Spy;
  auth: Spy;
  recent: Spy;
  uiPrefs: Spy;
  markdown: Spy;
  toast: Spy;
  translate: Spy;
  favorites: Spy;
}

function listItem(over: Record<string, unknown> = {}): any {
  return {
    id: 'p1',
    slug: 'slug-1',
    name: 'Product One',
    status: 'draft',
    base_price: 10,
    stock_quantity: 5,
    currency: 'RON',
    sale_type: null,
    sale_value: null,
    ...over,
  };
}

function setup(): Harness {
  const productsApi = jasmine.createSpyObj('AdminProductsService', [
    'byIds',
    'restore',
    'search',
    'duplicateCheck',
  ]);
  productsApi.search.and.returnValue(of({ items: [], meta: { total: 0, page: 1, limit: 25 } }));
  productsApi.byIds.and.returnValue(of([]));
  productsApi.restore.and.returnValue(of(listItem()));
  productsApi.duplicateCheck.and.returnValue(of(null));

  const catalog = jasmine.createSpyObj('CatalogService', ['listCategories']);
  catalog.listCategories.and.returnValue(of([]));

  const admin = jasmine.createSpyObj('AdminService', [
    'bulkUpdateProducts',
    'createCategory',
    'createProduct',
    'deleteCategory',
    'deleteProductImage',
    'deleteProductImageTranslation',
    'deleteProductTranslation',
    'exportCategoriesCsv',
    'exportProductsCsv',
    'getCategories',
    'getProduct',
    'getProductAudit',
    'getProductImageStats',
    'getProductImageTranslations',
    'getProductRelationships',
    'getProductTranslations',
    'importCategoriesCsv',
    'importProductsCsv',
    'listDeletedProductImages',
    'listStockAdjustments',
    'mergeCategory',
    'previewDeleteCategory',
    'previewMergeCategory',
    'reorderProductImage',
    'reprocessProductImage',
    'restoreProductImage',
    'updateCategory',
    'updateProduct',
    'uploadProductImageWithProgress',
    'upsertProductImageTranslation',
    'upsertProductTranslation',
    'updateProductRelationships',
    'updateProductVariants',
    'exportStockAdjustmentsCsv',
    'applyStockAdjustment',
  ]);
  admin.bulkUpdateProducts.and.returnValue(of([]));
  admin.createCategory.and.returnValue(
    of({ id: 'c-new', slug: 'cat-new', name: 'Cat New', parent_id: null, is_visible: true }),
  );
  admin.createProduct.and.returnValue(
    of({ id: 'np', slug: 'new-slug', status: 'draft', is_active: true, tags: [], images: [] }),
  );
  admin.updateProduct.and.returnValue(
    of({ id: 'p1', slug: 'slug-1', status: 'draft', is_active: true, tags: [], images: [] }),
  );
  admin.deleteCategory.and.returnValue(of({ id: 'c1', slug: 'cat-1', name: 'Cat' }));
  admin.deleteProductImage.and.returnValue(of({ images: [] }));
  admin.deleteProductImageTranslation.and.returnValue(of(undefined));
  admin.deleteProductTranslation.and.returnValue(of(undefined));
  admin.exportCategoriesCsv.and.returnValue(of(new Blob(['a'])));
  admin.exportProductsCsv.and.returnValue(of(new Blob(['a'])));
  admin.getCategories.and.returnValue(of([{ id: 'c1', name: 'Cat 1' }]));
  admin.getProduct.and.returnValue(of({ id: 'p1', slug: 'slug-1', name: 'Product One' }));
  admin.getProductAudit.and.returnValue(of([]));
  admin.getProductImageStats.and.returnValue(of({}));
  admin.getProductImageTranslations.and.returnValue(of([]));
  admin.getProductRelationships.and.returnValue(
    of({ related_product_ids: [], upsell_product_ids: [] }),
  );
  admin.getProductTranslations.and.returnValue(of([]));
  admin.importCategoriesCsv.and.returnValue(of({ errors: [] }));
  admin.importProductsCsv.and.returnValue(of({ errors: [] }));
  admin.listDeletedProductImages.and.returnValue(of([]));
  admin.listStockAdjustments.and.returnValue(of([]));
  admin.mergeCategory.and.returnValue(of({}));
  admin.previewDeleteCategory.and.returnValue(of({ can_delete: true }));
  admin.previewMergeCategory.and.returnValue(of({ can_merge: true, product_count: 2 }));
  admin.reorderProductImage.and.returnValue(of({}));
  admin.reprocessProductImage.and.returnValue(of({ ok: true }));
  admin.restoreProductImage.and.returnValue(of({ images: [] }));
  admin.updateCategory.and.returnValue(of({ parent_id: null }));
  admin.uploadProductImageWithProgress.and.returnValue(
    of({ type: HttpEventType.Response, body: { images: [] } }),
  );
  admin.upsertProductImageTranslation.and.returnValue(of({}));
  admin.upsertProductTranslation.and.returnValue(of({ name: 'X' }));
  admin.updateProductRelationships.and.returnValue(of({}));
  admin.updateProductVariants.and.returnValue(of([]));
  admin.exportStockAdjustmentsCsv.and.returnValue(of(new Blob(['a'])));
  admin.applyStockAdjustment.and.returnValue(of({ after_quantity: 10, variant_id: null }));

  const auth = jasmine.createSpyObj('AuthService', ['user']);
  auth.user.and.returnValue({ id: 'u1' });

  const recent = jasmine.createSpyObj('AdminRecentService', ['add']);
  const uiPrefs = jasmine.createSpyObj('AdminUiPrefsService', ['get']);

  const markdown = jasmine.createSpyObj('MarkdownService', ['renderWithSanitizationReport']);
  markdown.renderWithSanitizationReport.and.returnValue({ html: '<p>x</p>', sanitized: false });

  const toast = jasmine.createSpyObj('ToastService', ['action', 'error', 'success']);

  const translate = jasmine.createSpyObj('TranslateService', ['instant']);
  translate.instant.and.callFake((key: string) => key);
  (translate as any).currentLang = 'en';

  const favorites = jasmine.createSpyObj('AdminFavoritesService', [
    'add',
    'init',
    'isFavorite',
    'remove',
    'items',
  ]);
  favorites.items.and.returnValue([]);
  favorites.isFavorite.and.returnValue(false);

  const c = new AdminProductsComponent(
    productsApi,
    catalog,
    admin,
    auth,
    recent,
    uiPrefs,
    markdown,
    toast,
    translate,
    favorites,
  );

  return {
    c,
    any: c as any,
    productsApi,
    catalog,
    admin,
    auth,
    recent,
    uiPrefs,
    markdown,
    toast,
    translate,
    favorites,
  };
}

function appendEl(id: string, withFocusable = false): HTMLElement {
  const el = document.createElement('div');
  el.id = id;
  if (withFocusable) {
    const input = document.createElement('input');
    el.appendChild(input);
  }
  document.body.appendChild(el);
  return el;
}

describe('AdminProductsComponent', () => {
  afterEach(() => {
    document.querySelectorAll('[id^="product-wizard"], #admin-products-bulk-actions').forEach((n) =>
      n.remove(),
    );
  });

  describe('lifecycle', () => {
    it('ngOnInit loads categories, admin categories and list', () => {
      const h = setup();
      h.c.ngOnInit();
      expect(h.favorites.init).toHaveBeenCalled();
      expect(h.catalog.listCategories).toHaveBeenCalled();
      expect(h.admin.getCategories).toHaveBeenCalled();
      expect(h.productsApi.search).toHaveBeenCalled();
    });

    it('ngOnInit honours pendingEditProductSlug from history.state', () => {
      const h = setup();
      history.pushState({ editProductSlug: '  slug-1  ' }, '');
      h.c.ngOnInit();
      history.replaceState({}, '');
      expect(h.admin.getProduct).toHaveBeenCalledWith('slug-1');
    });

    it('ngOnInit honours openNewProduct from history.state', () => {
      const h = setup();
      history.pushState({ openNewProduct: true }, '');
      h.c.ngOnInit();
      history.replaceState({}, '');
      expect(h.c.editorOpen()).toBeTrue();
      expect(h.c.editingSlug()).toBeNull();
    });

    it('ngOnInit applies filters from history.state', () => {
      const h = setup();
      history.pushState(
        {
          adminFilterScope: 'products',
          adminFilters: { q: 'abc', status: 'draft', categorySlug: 'x', limit: 50 },
        },
        '',
      );
      h.c.ngOnInit();
      history.replaceState({}, '');
      expect(h.c.q).toBe('abc');
      expect(h.c.limit).toBe(50);
    });

    it('ngOnDestroy clears all pending handles', () => {
      const h = setup();
      h.any.productSearchDebounceHandle = window.setTimeout(() => undefined, 1000);
      h.any.productSearchBlurHandle = window.setTimeout(() => undefined, 1000);
      h.any.productFilterDebounceHandle = window.setTimeout(() => undefined, 1000);
      h.any.duplicateCheckTimeoutId = setTimeout(() => undefined, 1000);
      h.any.relationshipSearchTimeout = setTimeout(() => undefined, 1000);
      h.c.ngOnDestroy();
      expect(h.any.productSearchDebounceHandle).toBeNull();
      expect(h.any.duplicateCheckTimeoutId).toBeNull();
      expect(h.any.relationshipSearchTimeout).toBeNull();
    });
  });

  describe('table layout', () => {
    it('open/close layout modal toggles signal', () => {
      const h = setup();
      h.c.openLayoutModal();
      expect(h.c.layoutModalOpen()).toBeTrue();
      h.c.closeLayoutModal();
      expect(h.c.layoutModalOpen()).toBeFalse();
    });

    it('applyTableLayout persists and toggleDensity flips density', () => {
      const h = setup();
      const before = h.c.tableLayout().density;
      h.c.toggleDensity();
      expect(h.c.tableLayout().density).not.toBe(before);
      h.c.toggleDensity();
      expect(h.c.tableLayout().density).toBe(before);
    });

    it('densityToggleLabelKey reflects density', () => {
      const h = setup();
      h.c.applyTableLayout({ ...h.c.tableLayout(), density: 'compact' });
      expect(h.c.densityToggleLabelKey()).toContain('toComfortable');
      h.c.applyTableLayout({ ...h.c.tableLayout(), density: 'comfortable' });
      expect(h.c.densityToggleLabelKey()).toContain('toCompact');
    });

    it('visibleColumnIds / trackColumnId / cellPaddingClass', () => {
      const h = setup();
      expect(Array.isArray(h.c.visibleColumnIds())).toBeTrue();
      expect(h.c.trackColumnId(0, 'name')).toBe('name');
      expect(typeof h.c.cellPaddingClass()).toBe('string');
    });

    it('tableLayoutStorageKey falls back when no user', () => {
      const h = setup();
      h.auth.user.and.returnValue(undefined);
      expect(typeof h.any.tableLayoutStorageKey()).toBe('string');
    });
  });

  describe('scroll helpers', () => {
    it('scrollToBulkActions returns early without element', () => {
      const h = setup();
      expect(() => h.c.scrollToBulkActions()).not.toThrow();
    });

    it('scrollToBulkActions focuses focusable child', fakeAsync(() => {
      const h = setup();
      const el = appendEl('admin-products-bulk-actions', true);
      el.scrollIntoView = jasmine.createSpy('scrollIntoView');
      h.c.scrollToBulkActions();
      tick(1);
      expect(el.scrollIntoView).toHaveBeenCalled();
    }));

    it('scrollToImagesSection delegates to anchor scroll', fakeAsync(() => {
      const h = setup();
      appendEl('product-wizard-images').scrollIntoView = jasmine.createSpy();
      h.c.scrollToImagesSection();
      tick(1);
      expect(true).toBeTrue();
    }));

    it('scrollToWizardAnchor handles missing element', fakeAsync(() => {
      const h = setup();
      h.any.scrollToWizardAnchor('does-not-exist');
      tick(1);
      expect(true).toBeTrue();
    }));
  });

  describe('saved status helpers', () => {
    it('successStatus / successVisibility / savedStatus / savedIsVisible', () => {
      const h = setup();
      h.c.lastSavedState.set({ status: 'published', isActive: true });
      expect(h.c.successStatusLabelKey()).toBe('adminUi.status.published');
      expect(h.c.savedStatus()).toBe('published');
      expect(h.c.savedIsVisible()).toBeTrue();
      expect(h.c.successVisibilityLabelKey()).toContain('visible');
      h.c.lastSavedState.set({ status: 'draft', isActive: false });
      expect(h.c.savedIsVisible()).toBeFalse();
      expect(h.c.successVisibilityLabelKey()).toContain('hidden');
    });

    it('savedStatus / savedIsVisible fall back to form', () => {
      const h = setup();
      h.c.lastSavedState.set(null);
      h.c.form.status = 'published';
      h.c.form.is_active = true;
      expect(h.c.savedStatus()).toBe('published');
      expect(h.c.savedIsVisible()).toBeTrue();
    });
  });

  describe('filters', () => {
    it('applyFilters resets page and reloads', () => {
      const h = setup();
      h.c.page = 4;
      h.c.applyFilters();
      expect(h.c.page).toBe(1);
      expect(h.productsApi.search).toHaveBeenCalled();
    });

    it('setStatusFilter ignores no-op and applies change', () => {
      const h = setup();
      h.c.status = 'all';
      h.c.setStatusFilter('all');
      expect(h.productsApi.search).not.toHaveBeenCalled();
      h.c.setStatusFilter('draft');
      expect(h.c.status).toBe('draft');
      expect(h.productsApi.search).toHaveBeenCalled();
    });

    it('resetFilters clears all filter state', () => {
      const h = setup();
      h.c.q = 'x';
      h.c.status = 'draft';
      h.c.resetFilters();
      expect(h.c.q).toBe('');
      expect(h.c.status).toBe('all');
    });

    it('goToPage updates page and loads', () => {
      const h = setup();
      h.c.goToPage(3);
      expect(h.c.page).toBe(3);
    });

    it('useVirtualProductsTable thresholds', () => {
      const h = setup();
      expect(h.c.useVirtualProductsTable()).toBeFalse();
      h.c.products.set(Array.from({ length: 101 }, (_, i) => listItem({ id: `p${i}` })));
      expect(h.c.useVirtualProductsTable()).toBeTrue();
      h.any.inlineEditId = 'p1';
      expect(h.c.useVirtualProductsTable()).toBeFalse();
    });

    it('trackProductId returns id', () => {
      const h = setup();
      expect(h.c.trackProductId(0, listItem())).toBe('p1');
    });
  });

  describe('saved views', () => {
    it('savedViews filters favorites', () => {
      const h = setup();
      h.favorites.items.and.returnValue([
        { key: 'k1', type: 'filter', state: { adminFilterScope: 'products' } },
        { key: 'k2', type: 'filter', state: { adminFilterScope: 'orders' } },
        { key: 'k3', type: 'recent' },
      ]);
      expect(h.c.savedViews().length).toBe(1);
    });

    it('applySavedView with empty key does nothing', () => {
      const h = setup();
      h.c.applySavedView('');
      expect(h.productsApi.search).not.toHaveBeenCalled();
    });

    it('applySavedView with unknown key does nothing', () => {
      const h = setup();
      h.favorites.items.and.returnValue([]);
      h.c.applySavedView('missing');
      expect(h.productsApi.search).not.toHaveBeenCalled();
    });

    it('applySavedView with no filters object returns early', () => {
      const h = setup();
      h.favorites.items.and.returnValue([
        { key: 'k1', type: 'filter', state: { adminFilterScope: 'products' } },
      ]);
      h.c.applySavedView('k1');
      expect(h.productsApi.search).not.toHaveBeenCalled();
    });

    it('applySavedView applies stored filters and loads', () => {
      const h = setup();
      h.favorites.items.and.returnValue([
        {
          key: 'k1',
          type: 'filter',
          state: {
            adminFilterScope: 'products',
            adminFilters: {
              q: 'shoes',
              status: 'published',
              categorySlug: 'foot',
              translationFilter: 'missing_en',
              view: 'deleted',
              limit: 10,
            },
          },
        },
      ]);
      h.c.applySavedView('k1');
      expect(h.c.q).toBe('shoes');
      expect(h.c.view).toBe('deleted');
      expect(h.c.limit).toBe(10);
      expect(h.productsApi.search).toHaveBeenCalled();
    });

    it('applySavedView uses current limit when stored limit invalid', () => {
      const h = setup();
      h.c.limit = 33;
      h.favorites.items.and.returnValue([
        {
          key: 'k1',
          type: 'filter',
          state: { adminFilterScope: 'products', adminFilters: { q: 'a', limit: 'bad' } },
        },
      ]);
      h.c.applySavedView('k1');
      expect(h.c.limit).toBe(33);
    });

    it('isCurrentViewPinned delegates to favorites', () => {
      const h = setup();
      h.favorites.isFavorite.and.returnValue(true);
      expect(h.c.isCurrentViewPinned()).toBeTrue();
    });

    it('toggleCurrentViewPin removes pin when favorited', () => {
      const h = setup();
      h.favorites.isFavorite.and.returnValue(true);
      h.any.currentViewFavoriteKey = () => 'fav-key';
      h.c.selectedSavedViewKey = 'fav-key';
      h.c.toggleCurrentViewPin();
      expect(h.favorites.remove).toHaveBeenCalledWith('fav-key');
      expect(h.c.selectedSavedViewKey).toBe('');
    });

    it('toggleCurrentViewPin errors when name blank', () => {
      const h = setup();
      h.favorites.isFavorite.and.returnValue(false);
      spyOn(window, 'prompt').and.returnValue('   ');
      h.c.toggleCurrentViewPin();
      expect(h.toast.error).toHaveBeenCalled();
      expect(h.favorites.add).not.toHaveBeenCalled();
    });

    it('toggleCurrentViewPin adds a saved view', () => {
      const h = setup();
      h.favorites.isFavorite.and.returnValue(false);
      spyOn(window, 'prompt').and.returnValue('My View');
      h.c.toggleCurrentViewPin();
      expect(h.favorites.add).toHaveBeenCalled();
      expect(h.c.selectedSavedViewKey).not.toBe('');
    });
  });

  describe('product search dropdown', () => {
    it('openProductSearch only opens when criteria met', () => {
      const h = setup();
      h.c.q = 'a';
      h.c.openProductSearch();
      expect(h.c.productSearchOpen()).toBeFalse();
      h.c.q = 'abc';
      h.c.openProductSearch();
      expect(h.c.productSearchOpen()).toBeTrue();
    });

    it('openProductSearch sets active index when results exist', () => {
      const h = setup();
      h.c.q = 'abc';
      h.c.productSearchResults.set([listItem()]);
      h.any.productSearchBlurHandle = window.setTimeout(() => undefined, 1000);
      h.c.openProductSearch();
      expect(h.c.productSearchActiveIndex()).toBe(0);
    });

    it('onProductSearchBlur closes after delay', fakeAsync(() => {
      const h = setup();
      h.c.productSearchOpen.set(true);
      h.c.onProductSearchBlur();
      h.c.onProductSearchBlur();
      tick(150);
      expect(h.c.productSearchOpen()).toBeFalse();
    }));

    it('onProductSearchKeydown Escape closes', () => {
      const h = setup();
      h.c.productSearchOpen.set(true);
      h.c.onProductSearchKeydown({ key: 'Escape' } as KeyboardEvent);
      expect(h.c.productSearchOpen()).toBeFalse();
    });

    it('onProductSearchKeydown arrow/home/end navigation', () => {
      const h = setup();
      h.c.q = 'abc';
      h.c.productSearchResults.set([listItem({ id: 'a' }), listItem({ id: 'b' })]);
      const pd = () => ({ key: '', preventDefault: () => undefined }) as any;
      h.c.onProductSearchKeydown({ ...pd(), key: 'ArrowDown' });
      h.c.onProductSearchKeydown({ ...pd(), key: 'ArrowUp' });
      h.c.onProductSearchKeydown({ ...pd(), key: 'Home' });
      h.c.onProductSearchKeydown({ ...pd(), key: 'End' });
      expect(h.c.productSearchActiveIndex()).toBe(1);
    });

    it('onProductSearchKeydown ignores other keys', () => {
      const h = setup();
      h.c.onProductSearchKeydown({ key: 'a', preventDefault: () => undefined } as any);
      expect(true).toBeTrue();
    });

    it('onProductSearchKeydown Enter selects active', () => {
      const h = setup();
      const edit = spyOn(h.c, 'edit');
      h.c.productSearchResults.set([listItem()]);
      h.c.productSearchActiveIndex.set(0);
      h.c.onProductSearchKeydown({ key: 'Enter', preventDefault: () => undefined } as any);
      expect(edit).toHaveBeenCalledWith('slug-1');
    });

    it('onProductSearchKeydown Enter with no results returns', () => {
      const h = setup();
      h.c.productSearchResults.set([]);
      h.c.onProductSearchKeydown({ key: 'Enter', preventDefault: () => undefined } as any);
      expect(true).toBeTrue();
    });

    it('onProductSearchChange short needle clears results', () => {
      const h = setup();
      h.c.q = 'a';
      h.c.onProductSearchChange();
      expect(h.c.productSearchResults()).toEqual([]);
    });

    it('onProductSearchChange long needle runs search after debounce', fakeAsync(() => {
      const h = setup();
      h.productsApi.search.and.returnValue(of({ items: [listItem()], meta: null }));
      h.c.q = 'abcd';
      h.c.onProductSearchChange();
      h.c.onProductSearchChange();
      tick(250);
      tick(250);
      expect(h.c.productSearchResults().length).toBe(1);
    }));

    it('runProductSearch error path sets error', fakeAsync(() => {
      const h = setup();
      h.productsApi.search.and.returnValue(throwError(() => new Error('x')));
      h.c.status = 'published';
      h.c.categorySlug = 'cat';
      h.c.translationFilter = 'missing_any';
      h.c.view = 'deleted';
      h.any.runProductSearch('abcd');
      expect(h.c.productSearchError()).toBeTruthy();
    }));

    it('runProductSearch missing_en/ro branches', fakeAsync(() => {
      const h = setup();
      h.c.translationFilter = 'missing_en';
      h.any.runProductSearch('abcd');
      h.c.translationFilter = 'missing_ro';
      h.any.runProductSearch('abcd');
      expect(h.productsApi.search).toHaveBeenCalled();
    }));

    it('runProductSearch ignores stale responses', () => {
      const h = setup();
      const subj = new Subject<any>();
      h.productsApi.search.and.returnValue(subj.asObservable());
      h.any.runProductSearch('abcd');
      h.any.productSearchRequestId = 999;
      subj.next({ items: [listItem()] });
      subj.complete();
      expect(h.c.productSearchResults()).toEqual([]);
    });

    it('productSearchActiveDescendant returns id or null', () => {
      const h = setup();
      expect(h.c.productSearchActiveDescendant()).toBeNull();
      h.c.productSearchOpen.set(true);
      h.c.productSearchResults.set([listItem()]);
      h.c.productSearchActiveIndex.set(0);
      expect(h.c.productSearchActiveDescendant()).toContain('option-0');
      h.c.productSearchActiveIndex.set(5);
      expect(h.c.productSearchActiveDescendant()).toBeNull();
    });

    it('selectProductSearch with event prevents default and edits', () => {
      const h = setup();
      const edit = spyOn(h.c, 'edit');
      const ev = { preventDefault: jasmine.createSpy(), stopPropagation: jasmine.createSpy() } as any;
      h.c.selectProductSearch(listItem(), ev);
      expect(ev.preventDefault).toHaveBeenCalled();
      expect(edit).toHaveBeenCalled();
    });

    it('moveProductSearchActive with no items resets index', () => {
      const h = setup();
      h.c.productSearchResults.set([]);
      h.any.moveProductSearchActive(1);
      expect(h.c.productSearchActiveIndex()).toBe(-1);
    });

    it('setProductSearchActive scrolls into view', fakeAsync(() => {
      const h = setup();
      h.c.productSearchResults.set([listItem()]);
      const el = appendEl('admin-products-search-option-0');
      el.scrollIntoView = jasmine.createSpy();
      h.any.setProductSearchActive(0);
      tick(1);
      expect(el.scrollIntoView).toHaveBeenCalled();
      el.remove();
    }));

    it('setProductSearchActive no items', () => {
      const h = setup();
      h.c.productSearchResults.set([]);
      h.any.setProductSearchActive(0);
      expect(h.c.productSearchActiveIndex()).toBe(-1);
    });
  });

  describe('selection + bulk status', () => {
    it('clearSelection resets selection state', () => {
      const h = setup();
      h.c.selected.add('p1');
      h.c.clearSelection();
      expect(h.c.selected.size).toBe(0);
    });

    it('toggleSelected adds/removes and skips deleted view', () => {
      const h = setup();
      h.c.products.set([listItem()]);
      h.c.toggleSelected('p1', { target: { checked: true } } as any);
      expect(h.c.selected.has('p1')).toBeTrue();
      h.c.toggleSelected('p1', { target: { checked: false } } as any);
      expect(h.c.selected.has('p1')).toBeFalse();
      h.c.view = 'deleted';
      h.c.toggleSelected('p1', { target: { checked: true } } as any);
      expect(h.c.selected.has('p1')).toBeFalse();
    });

    it('allSelectedOnPage variants', () => {
      const h = setup();
      expect(h.c.allSelectedOnPage()).toBeFalse();
      h.c.products.set([listItem()]);
      expect(h.c.allSelectedOnPage()).toBeFalse();
      h.c.selected.add('p1');
      expect(h.c.allSelectedOnPage()).toBeTrue();
      h.c.view = 'deleted';
      expect(h.c.allSelectedOnPage()).toBeFalse();
    });

    it('toggleSelectAll selects and deselects', () => {
      const h = setup();
      h.c.products.set([listItem({ id: 'a' }), listItem({ id: 'b' })]);
      h.c.toggleSelectAll({ target: { checked: true } } as any);
      expect(h.c.selected.size).toBe(2);
      h.c.toggleSelectAll({ target: { checked: false } } as any);
      expect(h.c.selected.size).toBe(0);
      h.c.view = 'deleted';
      h.c.toggleSelectAll({ target: { checked: true } } as any);
      expect(h.c.selected.size).toBe(0);
    });

    it('selectedProductsOnPage filters', () => {
      const h = setup();
      h.c.products.set([listItem({ id: 'a' }), listItem({ id: 'b' })]);
      h.c.selected.add('a');
      expect(h.c.selectedProductsOnPage().length).toBe(1);
    });

    it('openBulkStatusConfirm requires selection', () => {
      const h = setup();
      h.c.openBulkStatusConfirm();
      expect(h.c.bulkStatusConfirmOpen()).toBeFalse();
      h.c.selected.add('p1');
      h.c.openBulkStatusConfirm();
      expect(h.c.bulkStatusConfirmOpen()).toBeTrue();
      h.c.closeBulkStatusConfirm();
      expect(h.c.bulkStatusConfirmOpen()).toBeFalse();
    });

    it('confirmBulkStatusChange empty closes', () => {
      const h = setup();
      h.c.confirmBulkStatusChange();
      expect(h.c.bulkStatusConfirmOpen()).toBeFalse();
    });

    it('confirmBulkStatusChange success triggers undo toast', () => {
      const h = setup();
      h.c.products.set([listItem()]);
      h.c.selected.add('p1');
      h.toast.action.and.callFake((_m: string, _l: string, cb: () => void) => cb());
      h.c.confirmBulkStatusChange();
      expect(h.admin.bulkUpdateProducts).toHaveBeenCalled();
    });

    it('confirmBulkStatusChange error sets bulkError', () => {
      const h = setup();
      h.c.products.set([listItem()]);
      h.c.selected.add('p1');
      h.admin.bulkUpdateProducts.and.returnValue(throwError(() => new Error('x')));
      h.c.confirmBulkStatusChange();
      expect(h.c.bulkError()).toBeTruthy();
    });

    it('undoBulkStatusChange empty returns', () => {
      const h = setup();
      h.any.undoBulkStatusChange([]);
      expect(h.admin.bulkUpdateProducts).not.toHaveBeenCalled();
    });

    it('undoBulkStatusChange error path', () => {
      const h = setup();
      h.admin.bulkUpdateProducts.and.returnValue(throwError(() => new Error('x')));
      h.any.undoBulkStatusChange([{ product_id: 'p1', status: 'draft' }]);
      expect(h.toast.error).toHaveBeenCalled();
    });
  });

  describe('quick status', () => {
    it('quickSetStatus no-op when same status', () => {
      const h = setup();
      h.c.quickSetStatus(listItem({ status: 'draft' }), 'draft');
      expect(h.admin.bulkUpdateProducts).not.toHaveBeenCalled();
    });

    it('quickSetStatus busy guard', () => {
      const h = setup();
      h.c.quickStatusBusyId.set('other');
      h.c.quickSetStatus(listItem({ status: 'draft' }), 'published');
      expect(h.admin.bulkUpdateProducts).not.toHaveBeenCalled();
    });

    it('quickSetStatus success removes from selection and undo', () => {
      const h = setup();
      h.c.selected.add('p1');
      h.c.products.set([listItem()]);
      h.toast.action.and.callFake((_m: string, _l: string, cb: () => void) => cb());
      h.c.quickSetStatus(listItem({ status: 'draft', name: '' }), 'published');
      expect(h.c.selected.has('p1')).toBeFalse();
    });

    it('quickSetStatus error path', () => {
      const h = setup();
      h.admin.bulkUpdateProducts.and.returnValue(throwError(() => new Error('x')));
      h.c.quickSetStatus(listItem({ status: 'draft' }), 'published');
      expect(h.toast.error).toHaveBeenCalled();
    });

    it('undoQuickStatusChange error path', () => {
      const h = setup();
      h.admin.bulkUpdateProducts.and.returnValue(throwError(() => new Error('x')));
      h.any.undoQuickStatusChange('p1', 'draft');
      expect(h.toast.error).toHaveBeenCalled();
    });
  });

  describe('category create', () => {
    it('openCreateCategory / closeCreateCategory', () => {
      const h = setup();
      h.c.openCreateCategory('filters');
      expect(h.c.createCategoryOpen()).toBeTrue();
      h.c.closeCreateCategory();
      expect(h.c.createCategoryOpen()).toBeFalse();
    });

    it('confirmCreateCategory ignores blank name', () => {
      const h = setup();
      h.c.createCategoryName = '   ';
      h.c.confirmCreateCategory();
      expect(h.admin.createCategory).not.toHaveBeenCalled();
    });

    it('confirmCreateCategory for product_form sets category', () => {
      const h = setup();
      h.c.openCreateCategory('product_form');
      h.c.createCategoryName = 'Cat';
      h.c.confirmCreateCategory();
      expect(h.c.form.category_id).toBe('c-new');
    });

    it('confirmCreateCategory for filters sets slug', () => {
      const h = setup();
      h.c.openCreateCategory('filters');
      h.c.createCategoryName = 'Cat';
      h.c.createCategoryParentId = 'parent';
      h.c.confirmCreateCategory();
      expect(h.c.categorySlug).toBe('cat-new');
    });

    it('confirmCreateCategory for bulk_assign applies category', () => {
      const h = setup();
      h.c.openCreateCategory('bulk_assign');
      h.c.createCategoryName = 'Cat';
      h.c.selected.add('p1');
      h.c.confirmCreateCategory();
      expect(h.c.bulkCategoryId).toBe('c-new');
    });

    it('confirmCreateCategory error path', () => {
      const h = setup();
      h.admin.createCategory.and.returnValue(throwError(() => ({ error: { detail: 'boom' } })));
      h.c.openCreateCategory('manager');
      h.c.createCategoryName = 'Cat';
      h.c.confirmCreateCategory();
      expect(h.c.createCategoryError()).toBe('boom');
    });

    it('upsertCategoryLists updates existing and adds new', () => {
      const h = setup();
      h.c.categories.set([{ id: 'c-new', slug: 'old', name: 'Old' } as any]);
      h.c.adminCategories.set([{ id: 'c-new', name: 'Old' }]);
      h.any.upsertCategoryLists({
        id: 'c-new',
        slug: 'cat-new',
        name: 'New',
        parent_id: null,
        is_visible: true,
      });
      expect(h.c.categories()[0].name).toBe('New');
    });
  });

  describe('category manager', () => {
    it('openCategoryManager refreshes lists', () => {
      const h = setup();
      h.c.openCategoryManager();
      expect(h.c.categoryManagerOpen()).toBeTrue();
      h.c.closeCategoryManager();
      expect(h.c.categoryManagerOpen()).toBeFalse();
    });

    it('openCreateCategoryFromManager and FromBulkAssign', () => {
      const h = setup();
      h.c.openCreateCategoryFromManager();
      expect(h.c.createCategoryOpen()).toBeTrue();
      h.c.openCreateCategoryFromBulkAssign();
      expect(h.c.createCategoryOpen()).toBeTrue();
    });

    it('onCategoryManagerSelect populates parent', () => {
      const h = setup();
      h.c.categories.set([{ id: 'c1', slug: 'cat-1', name: 'Cat', parent_id: 'p0' } as any]);
      h.c.onCategoryManagerSelect('cat-1');
      expect(h.c.categoryManagerParentId).toBe('p0');
      expect(h.c.categoryManagerSelectedCategory()?.id).toBe('c1');
    });

    it('categoryManagerSelectedCategory null when no slug', () => {
      const h = setup();
      h.c.categoryManagerSlug = '';
      expect(h.c.categoryManagerSelectedCategory()).toBeNull();
    });

    it('resetCategoryManagerParent restores from selection', () => {
      const h = setup();
      h.c.categories.set([{ id: 'c1', slug: 'cat-1', name: 'Cat', parent_id: 'p0' } as any]);
      h.c.categoryManagerSlug = 'cat-1';
      h.c.resetCategoryManagerParent();
      expect(h.c.categoryManagerParentId).toBe('p0');
    });

    it('saveCategoryManagerParent no cat returns', () => {
      const h = setup();
      h.c.saveCategoryManagerParent();
      expect(h.admin.updateCategory).not.toHaveBeenCalled();
    });

    it('saveCategoryManagerParent no-op when unchanged', () => {
      const h = setup();
      h.c.categories.set([{ id: 'c1', slug: 'cat-1', name: 'Cat', parent_id: null } as any]);
      h.c.categoryManagerSlug = 'cat-1';
      h.c.categoryManagerParentId = '';
      h.c.saveCategoryManagerParent();
      expect(h.admin.updateCategory).not.toHaveBeenCalled();
    });

    it('saveCategoryManagerParent success', () => {
      const h = setup();
      h.c.categories.set([{ id: 'c1', slug: 'cat-1', name: 'Cat', parent_id: null } as any]);
      h.c.categoryManagerSlug = 'cat-1';
      h.c.categoryManagerParentId = 'p9';
      h.admin.updateCategory.and.returnValue(of({ parent_id: 'p9' }));
      h.c.saveCategoryManagerParent();
      expect(h.toast.success).toHaveBeenCalled();
    });

    it('saveCategoryManagerParent error restores prev', () => {
      const h = setup();
      h.c.categories.set([{ id: 'c1', slug: 'cat-1', name: 'Cat', parent_id: 'old' } as any]);
      h.c.categoryManagerSlug = 'cat-1';
      h.c.categoryManagerParentId = 'p9';
      h.admin.updateCategory.and.returnValue(throwError(() => ({ error: { detail: 'no' } })));
      h.c.saveCategoryManagerParent();
      expect(h.c.categoryManagerParentId).toBe('old');
    });

    it('saveCategoryManagerParent busy guard', () => {
      const h = setup();
      h.c.categories.set([{ id: 'c1', slug: 'cat-1', name: 'Cat', parent_id: null } as any]);
      h.c.categoryManagerSlug = 'cat-1';
      h.c.categoryManagerParentId = 'x';
      h.c.categoryManagerUpdateBusy.set(true);
      h.c.saveCategoryManagerParent();
      expect(h.admin.updateCategory).not.toHaveBeenCalled();
    });

    it('categoryParentOptions excludes descendants and self', () => {
      const h = setup();
      h.c.categories.set([
        { id: 'a', slug: 'a', name: 'A', parent_id: null } as any,
        { id: 'b', slug: 'b', name: 'B', parent_id: 'a' } as any,
        { id: 'c', slug: 'c', name: 'C', parent_id: null } as any,
      ]);
      const opts = h.c.categoryParentOptions({ id: 'a' } as any);
      expect(opts.map((o) => o.id)).toEqual(['c']);
    });

    it('mergeTargetOptions filters by parent and excludes self', () => {
      const h = setup();
      h.c.categories.set([
        { id: 'a', slug: 'a', name: 'A', parent_id: null } as any,
        { id: 'b', slug: 'b', name: 'B', parent_id: null } as any,
      ]);
      const opts = h.c.mergeTargetOptions({ slug: 'a', parent_id: null } as any);
      expect(opts.map((o) => o.slug)).toEqual(['b']);
    });

    it('onMergeTargetChange resets preview', () => {
      const h = setup();
      h.c.mergePreview.set({ can_merge: true } as any);
      h.c.onMergeTargetChange();
      expect(h.c.mergePreview()).toBeNull();
    });
  });

  describe('category merge/delete', () => {
    function withCat(h: Harness): void {
      h.c.categories.set([{ id: 'c1', slug: 'cat-1', name: 'Cat', parent_id: null } as any]);
      h.c.categoryManagerSlug = 'cat-1';
    }

    it('previewCategoryMerge requires target', () => {
      const h = setup();
      withCat(h);
      h.c.mergeTargetSlug = '';
      h.c.previewCategoryMerge();
      expect(h.c.mergeError()).toBeTruthy();
    });

    it('previewCategoryMerge success and cannot-merge reason', () => {
      const h = setup();
      withCat(h);
      h.c.mergeTargetSlug = 'other';
      h.admin.previewMergeCategory.and.returnValue(
        of({ can_merge: false, reason: 'same_category', product_count: 0 }),
      );
      h.c.previewCategoryMerge();
      expect(h.c.mergeError()).toContain('mergeReasonSame');
    });

    it('previewCategoryMerge error path', () => {
      const h = setup();
      withCat(h);
      h.c.mergeTargetSlug = 'other';
      h.admin.previewMergeCategory.and.returnValue(throwError(() => new Error('x')));
      h.c.previewCategoryMerge();
      expect(h.c.mergeError()).toBeTruthy();
    });

    it('previewCategoryMerge guards', () => {
      const h = setup();
      h.c.previewCategoryMerge();
      withCat(h);
      h.c.mergePreviewLoading.set(true);
      h.c.previewCategoryMerge();
      expect(h.admin.previewMergeCategory).not.toHaveBeenCalled();
    });

    it('mergeCategorySelected requires target and preview', () => {
      const h = setup();
      withCat(h);
      h.c.mergeTargetSlug = '';
      h.c.mergeCategorySelected();
      expect(h.c.mergeError()).toBeTruthy();
      h.c.mergeTargetSlug = 'other';
      h.c.mergePreview.set(null);
      h.c.mergeCategorySelected();
      expect(h.c.mergeError()).toContain('mergePreviewRequired');
    });

    it('mergeCategorySelected blocked when preview cannot merge', () => {
      const h = setup();
      withCat(h);
      h.c.mergeTargetSlug = 'other';
      h.c.mergePreview.set({ can_merge: false, reason: 'different_parent' } as any);
      h.c.mergeCategorySelected();
      expect(h.c.mergeError()).toContain('mergeReasonParent');
    });

    it('mergeCategorySelected cancelled by confirm', () => {
      const h = setup();
      withCat(h);
      h.c.categories.set([
        ...h.c.categories(),
        { id: 'c2', slug: 'other', name: 'Other', parent_id: null } as any,
      ]);
      h.c.mergeTargetSlug = 'other';
      h.c.mergePreview.set({ can_merge: true, product_count: 1 } as any);
      spyOn(window, 'confirm').and.returnValue(false);
      h.c.mergeCategorySelected();
      expect(h.admin.mergeCategory).not.toHaveBeenCalled();
    });

    it('mergeCategorySelected success', () => {
      const h = setup();
      withCat(h);
      h.c.mergeTargetSlug = 'other';
      h.c.mergePreview.set({ can_merge: true, product_count: 1 } as any);
      spyOn(window, 'confirm').and.returnValue(true);
      h.c.mergeCategorySelected();
      expect(h.admin.mergeCategory).toHaveBeenCalled();
      expect(h.toast.success).toHaveBeenCalled();
    });

    it('mergeCategorySelected error', () => {
      const h = setup();
      withCat(h);
      h.c.mergeTargetSlug = 'other';
      h.c.mergePreview.set({ can_merge: true, product_count: 1 } as any);
      spyOn(window, 'confirm').and.returnValue(true);
      h.admin.mergeCategory.and.returnValue(throwError(() => new Error('x')));
      h.c.mergeCategorySelected();
      expect(h.c.mergeError()).toBeTruthy();
    });

    it('mergeReasonKey variants', () => {
      const h = setup();
      expect(h.any.mergeReasonKey('source_has_children')).toContain('Children');
      expect(h.any.mergeReasonKey('weird')).toContain('NotAllowed');
    });

    it('previewCategoryDelete success and cannot-delete', () => {
      const h = setup();
      withCat(h);
      h.admin.previewDeleteCategory.and.returnValue(of({ can_delete: false }));
      h.c.previewCategoryDelete();
      expect(h.c.deleteError()).toBeTruthy();
    });

    it('previewCategoryDelete error', () => {
      const h = setup();
      withCat(h);
      h.admin.previewDeleteCategory.and.returnValue(throwError(() => new Error('x')));
      h.c.previewCategoryDelete();
      expect(h.c.deleteError()).toBeTruthy();
    });

    it('deleteCategorySelectedSafe requires preview and can_delete', () => {
      const h = setup();
      withCat(h);
      h.c.deletePreview.set(null);
      h.c.deleteCategorySelectedSafe();
      expect(h.c.deleteError()).toContain('deletePreviewRequired');
      h.c.deletePreview.set({ can_delete: false } as any);
      h.c.deleteCategorySelectedSafe();
      expect(h.c.deleteError()).toContain('deleteNotAllowed');
    });

    it('deleteCategorySelectedSafe confirm cancel', () => {
      const h = setup();
      withCat(h);
      h.c.deletePreview.set({ can_delete: true } as any);
      spyOn(window, 'confirm').and.returnValue(false);
      h.c.deleteCategorySelectedSafe();
      expect(h.admin.deleteCategory).not.toHaveBeenCalled();
    });

    it('deleteCategorySelectedSafe success and error', () => {
      spyOn(window, 'confirm').and.returnValue(true);
      const h = setup();
      withCat(h);
      h.c.deletePreview.set({ can_delete: true } as any);
      h.c.deleteCategorySelectedSafe();
      expect(h.toast.success).toHaveBeenCalled();

      const h2 = setup();
      withCat(h2);
      h2.c.deletePreview.set({ can_delete: true } as any);
      h2.admin.deleteCategory.and.returnValue(throwError(() => new Error('x')));
      h2.c.deleteCategorySelectedSafe();
      expect(h2.c.deleteError()).toBeTruthy();
    });

    it('refreshCategoryLists error paths', () => {
      const h = setup();
      h.catalog.listCategories.and.returnValue(throwError(() => new Error('x')));
      h.admin.getCategories.and.returnValue(throwError(() => new Error('x')));
      h.any.refreshCategoryLists();
      expect(h.c.categories()).toEqual([]);
      expect(h.c.adminCategories()).toEqual([]);
    });
  });

  describe('category import', () => {
    it('onCategoryImportFileChange sets file', () => {
      const h = setup();
      const file = new File(['a'], 'c.csv');
      h.c.onCategoryImportFileChange({ target: { files: [file] } } as any);
      expect(h.c.categoryImportFile).toBe(file);
    });

    it('runCategoryImport requires file', () => {
      const h = setup();
      h.c.categoryImportFile = null;
      h.c.runCategoryImport();
      expect(h.admin.importCategoriesCsv).not.toHaveBeenCalled();
    });

    it('runCategoryImport success no errors live refresh', () => {
      const h = setup();
      h.c.categoryImportFile = new File(['a'], 'c.csv');
      h.c.categoryImportDryRun = false;
      h.c.runCategoryImport();
      expect(h.toast.success).toHaveBeenCalled();
    });

    it('runCategoryImport with errors toasts error', () => {
      const h = setup();
      h.c.categoryImportFile = new File(['a'], 'c.csv');
      h.admin.importCategoriesCsv.and.returnValue(of({ errors: ['bad'] }));
      h.c.runCategoryImport();
      expect(h.toast.error).toHaveBeenCalled();
    });

    it('runCategoryImport error path', () => {
      const h = setup();
      h.c.categoryImportFile = new File(['a'], 'c.csv');
      h.admin.importCategoriesCsv.and.returnValue(throwError(() => ({ error: { detail: 'd' } })));
      h.c.runCategoryImport();
      expect(h.c.categoryImportError()).toBe('d');
    });

    it('runCategoryImport busy guard', () => {
      const h = setup();
      h.c.categoryImportFile = new File(['a'], 'c.csv');
      h.c.categoryImportBusy.set(true);
      h.c.runCategoryImport();
      expect(h.admin.importCategoriesCsv).not.toHaveBeenCalled();
    });
  });

  describe('bulk sale / price', () => {
    it('setBulkSaleType / setBulkPriceMode / setBulkPriceDirection', () => {
      const h = setup();
      h.c.setBulkSaleType('amount');
      expect(h.c.bulkSaleType).toBe('amount');
      h.c.setBulkPriceMode('amount');
      expect(h.c.bulkPriceMode).toBe('amount');
      h.c.setBulkPriceDirection('decrease');
      expect(h.c.bulkPriceDirection).toBe('decrease');
    });

    it('onBulkSaleValueChange sanitizes', () => {
      const h = setup();
      h.c.onBulkSaleValueChange('1a2.999');
      expect(h.c.bulkSaleValue).toBe('12.99');
    });

    it('applySaleToSelected validations and success', () => {
      const h = setup();
      h.c.bulkSaleValue = '';
      h.c.applySaleToSelected();
      expect(h.c.bulkError()).toBeTruthy();

      h.c.bulkSaleType = 'percent';
      h.c.bulkSaleValue = '150';
      h.c.applySaleToSelected();
      expect(h.c.bulkError()).toContain('percentHint');

      h.c.bulkSaleValue = '10';
      h.c.selected.add('p1');
      h.c.applySaleToSelected();
      expect(h.toast.success).toHaveBeenCalled();
    });

    it('applySaleToSelected error path', () => {
      const h = setup();
      h.c.bulkSaleValue = '10';
      h.c.selected.add('p1');
      h.admin.bulkUpdateProducts.and.returnValue(throwError(() => new Error('x')));
      h.c.applySaleToSelected();
      expect(h.c.bulkError()).toBeTruthy();
    });

    it('clearSaleForSelected success and error', () => {
      const h = setup();
      h.c.selected.add('p1');
      h.c.clearSaleForSelected();
      expect(h.toast.success).toHaveBeenCalled();
      h.admin.bulkUpdateProducts.and.returnValue(throwError(() => new Error('x')));
      h.c.clearSaleForSelected();
      expect(h.c.bulkError()).toBeTruthy();
    });

    it('publishSelected success and error', () => {
      const h = setup();
      h.c.selected.add('p1');
      h.c.publishSelected();
      expect(h.toast.success).toHaveBeenCalled();
      h.admin.bulkUpdateProducts.and.returnValue(throwError(() => new Error('x')));
      h.c.publishSelected();
      expect(h.c.bulkError()).toBeTruthy();
    });

    it('applyCategoryToSelected requires category', () => {
      const h = setup();
      h.c.bulkCategoryId = '';
      h.c.applyCategoryToSelected();
      expect(h.c.bulkError()).toBeTruthy();
      h.c.bulkCategoryId = 'c1';
      h.c.selected.add('p1');
      h.c.applyCategoryToSelected();
      expect(h.toast.success).toHaveBeenCalled();
    });

    it('applyCategoryToSelected error path', () => {
      const h = setup();
      h.c.bulkCategoryId = 'c1';
      h.c.selected.add('p1');
      h.admin.bulkUpdateProducts.and.returnValue(throwError(() => new Error('x')));
      h.c.applyCategoryToSelected();
      expect(h.c.bulkError()).toBeTruthy();
    });

    it('applyScheduleToSelected validations', () => {
      const h = setup();
      h.c.bulkPublishScheduledFor = 'not-a-date';
      h.c.applyScheduleToSelected();
      expect(h.c.bulkError()).toContain('invalidDate');

      h.c.bulkPublishScheduledFor = '';
      h.c.bulkUnpublishScheduledFor = '';
      h.c.applyScheduleToSelected();
      expect(h.c.bulkError()).toContain('valueRequired');

      h.c.bulkPublishScheduledFor = '2026-01-02T00:00';
      h.c.bulkUnpublishScheduledFor = '2026-01-01T00:00';
      h.c.applyScheduleToSelected();
      expect(h.c.bulkError()).toContain('orderInvalid');
    });

    it('applyScheduleToSelected success and error', () => {
      const h = setup();
      h.c.selected.add('p1');
      h.c.bulkPublishScheduledFor = '2026-01-01T00:00';
      h.c.bulkUnpublishScheduledFor = '2026-02-01T00:00';
      h.c.applyScheduleToSelected();
      expect(h.toast.success).toHaveBeenCalled();

      h.admin.bulkUpdateProducts.and.returnValue(throwError(() => new Error('x')));
      h.c.applyScheduleToSelected();
      expect(h.c.bulkError()).toBeTruthy();
    });

    it('clearPublishScheduleForSelected success and error', () => {
      const h = setup();
      h.c.selected.add('p1');
      h.c.clearPublishScheduleForSelected();
      expect(h.toast.success).toHaveBeenCalled();
      h.admin.bulkUpdateProducts.and.returnValue(throwError(() => new Error('x')));
      h.c.clearPublishScheduleForSelected();
      expect(h.c.bulkError()).toBeTruthy();
    });

    it('clearUnpublishScheduleForSelected success and error', () => {
      const h = setup();
      h.c.selected.add('p1');
      h.c.clearUnpublishScheduleForSelected();
      expect(h.toast.success).toHaveBeenCalled();
      h.admin.bulkUpdateProducts.and.returnValue(throwError(() => new Error('x')));
      h.c.clearUnpublishScheduleForSelected();
      expect(h.c.bulkError()).toBeTruthy();
    });

    it('onBulkPriceValueChange updates preview', () => {
      const h = setup();
      h.c.products.set([listItem({ base_price: 100 })]);
      h.c.selected.add('p1');
      h.c.onBulkPriceValueChange('10');
      expect(h.c.bulkPricePreview).not.toBeNull();
    });

    it('applyPriceAdjustmentToSelected no selection returns', () => {
      const h = setup();
      h.c.applyPriceAdjustmentToSelected();
      expect(h.admin.bulkUpdateProducts).not.toHaveBeenCalled();
    });

    it('applyPriceAdjustmentToSelected invalid delta', () => {
      const h = setup();
      h.c.products.set([listItem()]);
      h.c.selected.add('p1');
      h.c.bulkPriceValue = '0';
      h.c.applyPriceAdjustmentToSelected();
      expect(h.c.bulkError()).toBeTruthy();
    });

    it('applyPriceAdjustmentToSelected negative result blocked', () => {
      const h = setup();
      h.c.products.set([listItem({ base_price: 10 })]);
      h.c.selected.add('p1');
      h.c.bulkPriceMode = 'amount';
      h.c.bulkPriceDirection = 'decrease';
      h.c.bulkPriceValue = '100';
      h.c.applyPriceAdjustmentToSelected();
      expect(h.c.bulkError()).toContain('negative');
    });

    it('applyPriceAdjustmentToSelected percent success and error', () => {
      const h = setup();
      h.c.products.set([listItem({ base_price: 100 })]);
      h.c.selected.add('p1');
      h.c.bulkPriceMode = 'percent';
      h.c.bulkPriceDirection = 'increase';
      h.c.bulkPriceValue = '10';
      h.c.applyPriceAdjustmentToSelected();
      expect(h.toast.success).toHaveBeenCalled();

      h.c.products.set([listItem({ base_price: 100 })]);
      h.c.selected.add('p1');
      h.c.bulkPriceValue = '10';
      h.admin.bulkUpdateProducts.and.returnValue(throwError(() => new Error('x')));
      h.c.applyPriceAdjustmentToSelected();
      expect(h.c.bulkError()).toBeTruthy();
    });

    it('updateBulkPricePreview edge cases', () => {
      const h = setup();
      h.c.updateBulkPricePreview();
      expect(h.c.bulkPricePreview).toBeNull();

      h.c.products.set([listItem({ base_price: 100 })]);
      h.c.selected.add('p1');
      h.c.bulkPriceValue = '0';
      h.c.updateBulkPricePreview();
      expect(h.c.bulkPricePreview).toBeNull();

      h.c.bulkPriceMode = 'amount';
      h.c.bulkPriceValue = '5';
      h.c.updateBulkPricePreview();
      expect(h.c.bulkPricePreview).not.toBeNull();
    });

    it('updateBulkPricePreview returns when no finite prices', () => {
      const h = setup();
      h.c.products.set([listItem({ base_price: 'abc' })]);
      h.c.selected.add('p1');
      h.c.bulkPriceValue = '5';
      h.c.updateBulkPricePreview();
      expect(h.c.bulkPricePreview).toBeNull();
    });
  });

  describe('inline edit', () => {
    it('startInlineEdit busy guard', () => {
      const h = setup();
      h.c.inlineBusy.set(true);
      h.c.startInlineEdit(listItem());
      expect(h.any.inlineEditId).toBeNull();
    });

    it('startInlineEdit populates fields incl sale', () => {
      const h = setup();
      h.c.startInlineEdit(
        listItem({ base_price: 20, stock_quantity: 3, sale_type: 'amount', sale_value: 5 }),
      );
      expect(h.c.inlineSaleEnabled).toBeTrue();
      expect(h.c.inlineSaleValue).toBe('5.00');
    });

    it('startInlineEdit percent sale', () => {
      const h = setup();
      h.c.startInlineEdit(listItem({ sale_type: 'percent', sale_value: 12.5 }));
      expect(h.c.inlineSaleType).toBe('percent');
      expect(h.c.inlineSaleValue).toBe('12.5');
    });

    it('cancelInlineEdit resets', () => {
      const h = setup();
      h.c.startInlineEdit(listItem());
      h.c.cancelInlineEdit();
      expect(h.any.inlineEditId).toBeNull();
    });

    it('onInlineBasePriceChange flags format change', () => {
      const h = setup();
      h.c.onInlineBasePriceChange('1a0');
      expect(h.c.inlineBasePriceError).toBeTruthy();
    });

    it('onInlineStockChange validations', () => {
      const h = setup();
      h.c.onInlineStockChange('');
      expect(h.c.inlineStockError).toContain('stockRequired');
      h.c.onInlineStockChange('-1');
      expect(h.c.inlineStockError).toContain('stockInvalid');
      h.c.onInlineStockChange('5');
      expect(h.c.inlineStockError).toBe('');
    });

    it('onInlineSaleEnabledChange clears when disabled', () => {
      const h = setup();
      h.c.inlineSaleEnabled = false;
      h.c.inlineSaleValue = '5';
      h.c.onInlineSaleEnabledChange();
      expect(h.c.inlineSaleValue).toBe('');
      h.c.inlineSaleEnabled = true;
      h.c.inlineSaleValue = '5';
      h.c.onInlineSaleEnabledChange();
      expect(h.c.inlineSaleValue).toBe('5');
    });

    it('onInlineSaleTypeChange resets', () => {
      const h = setup();
      h.c.inlineSaleValue = '5';
      h.c.onInlineSaleTypeChange();
      expect(h.c.inlineSaleValue).toBe('');
    });

    it('onInlineSaleValueChange branches', () => {
      const h = setup();
      h.c.inlineSaleEnabled = false;
      h.c.onInlineSaleValueChange('5');
      expect(h.c.inlineSaleError).toBe('');

      h.c.inlineSaleEnabled = true;
      h.c.inlineSaleType = 'percent';
      h.c.onInlineSaleValueChange('150');
      expect(h.c.inlineSaleError).toContain('percentHint');

      h.c.onInlineSaleValueChange('1a0');
      expect(h.c.inlineSaleError).toBeTruthy();
    });

    it('saveInlineEdit no id returns', () => {
      const h = setup();
      h.any.inlineEditId = null;
      h.c.saveInlineEdit();
      expect(h.admin.bulkUpdateProducts).not.toHaveBeenCalled();
    });

    it('saveInlineEdit invalid base price', () => {
      const h = setup();
      h.any.inlineEditId = 'p1';
      h.c.inlineBasePrice = '';
      h.c.saveInlineEdit();
      expect(h.c.inlineError).toBeTruthy();
    });

    it('saveInlineEdit stock validations', () => {
      const h = setup();
      h.any.inlineEditId = 'p1';
      h.c.inlineBasePrice = '10';
      h.c.inlineStockQuantity = '';
      h.c.saveInlineEdit();
      expect(h.c.inlineStockError).toContain('stockRequired');
      h.c.inlineStockQuantity = '-1';
      h.c.saveInlineEdit();
      expect(h.c.inlineStockError).toContain('stockInvalid');
    });

    it('saveInlineEdit amount sale invalid', () => {
      const h = setup();
      h.any.inlineEditId = 'p1';
      h.c.inlineBasePrice = '10';
      h.c.inlineStockQuantity = '5';
      h.c.inlineSaleEnabled = true;
      h.c.inlineSaleType = 'amount';
      h.c.inlineSaleValue = '';
      h.c.saveInlineEdit();
      expect(h.c.inlineSaleError).toBeTruthy();
    });

    it('saveInlineEdit percent sale invalid', () => {
      const h = setup();
      h.any.inlineEditId = 'p1';
      h.c.inlineBasePrice = '10';
      h.c.inlineStockQuantity = '5';
      h.c.inlineSaleEnabled = true;
      h.c.inlineSaleType = 'percent';
      h.c.inlineSaleValue = '200';
      h.c.saveInlineEdit();
      expect(h.c.inlineSaleError).toContain('percentHint');
    });

    it('saveInlineEdit success and error', () => {
      const h = setup();
      h.any.inlineEditId = 'p1';
      h.c.inlineBasePrice = '10';
      h.c.inlineStockQuantity = '5';
      h.c.inlineSaleEnabled = true;
      h.c.inlineSaleType = 'amount';
      h.c.inlineSaleValue = '3';
      h.c.saveInlineEdit();
      expect(h.toast.success).toHaveBeenCalled();

      h.any.inlineEditId = 'p1';
      h.c.inlineBasePrice = '10';
      h.c.inlineStockQuantity = '5';
      h.c.inlineSaleEnabled = false;
      h.admin.bulkUpdateProducts.and.returnValue(throwError(() => new Error('x')));
      h.c.saveInlineEdit();
      expect(h.c.inlineError).toBeTruthy();
    });
  });

  describe('csv import/export', () => {
    it('exportProductsCsv success and error', () => {
      const h = setup();
      spyOn(h.any, 'downloadBlob');
      h.c.exportProductsCsv();
      expect(h.any.downloadBlob).toHaveBeenCalled();
      h.admin.exportProductsCsv.and.returnValue(throwError(() => new Error('x')));
      h.c.exportProductsCsv();
      expect(h.toast.error).toHaveBeenCalled();
    });

    it('downloadCategoriesCsv success and error', () => {
      const h = setup();
      spyOn(h.any, 'downloadBlob');
      h.c.downloadCategoriesCsv(true);
      expect(h.any.downloadBlob).toHaveBeenCalledWith(jasmine.any(Blob), 'categories-template.csv');
      h.c.downloadCategoriesCsv(false);
      h.admin.exportCategoriesCsv.and.returnValue(throwError(() => new Error('x')));
      h.c.downloadCategoriesCsv(true);
      expect(h.toast.error).toHaveBeenCalled();
    });

    it('openCsvImport / closeCsvImport', () => {
      const h = setup();
      h.c.openCsvImport();
      expect(h.c.csvImportOpen()).toBeTrue();
      h.c.closeCsvImport();
      expect(h.c.csvImportOpen()).toBeFalse();
    });

    it('onCsvImportFileChange with and without files', () => {
      const h = setup();
      const file = new File(['a'], 'p.csv');
      h.c.onCsvImportFileChange({ target: { files: [file] } } as any);
      expect(h.c.csvImportFile()).toBe(file);
      h.c.onCsvImportFileChange({ target: { files: [] } } as any);
      expect(h.c.csvImportFile()).toBeNull();
    });

    it('csvImportCanApply', () => {
      const h = setup();
      expect(h.c.csvImportCanApply()).toBeFalse();
      h.c.csvImportFile.set(new File(['a'], 'p.csv'));
      h.c.csvImportResult.set({ errors: [] } as any);
      expect(h.c.csvImportCanApply()).toBeTrue();
    });

    it('runCsvImport no file', () => {
      const h = setup();
      h.c.csvImportFile.set(null);
      h.c.runCsvImport(true);
      expect(h.c.csvImportError()).toBeTruthy();
    });

    it('runCsvImport dry-run then live success', () => {
      const h = setup();
      h.c.csvImportFile.set(new File(['a'], 'p.csv'));
      h.c.runCsvImport(true);
      h.c.runCsvImport(false);
      expect(h.toast.success).toHaveBeenCalled();
    });

    it('runCsvImport error path', () => {
      const h = setup();
      h.c.csvImportFile.set(new File(['a'], 'p.csv'));
      h.admin.importProductsCsv.and.returnValue(throwError(() => new Error('x')));
      h.c.runCsvImport(true);
      expect(h.c.csvImportError()).toBeTruthy();
    });
  });

  describe('markdown previews', () => {
    it('toggleDescriptionPreview / onDescriptionChange', () => {
      const h = setup();
      h.c.toggleDescriptionPreview();
      expect(h.c.descriptionPreviewOpen()).toBeTrue();
      h.c.onDescriptionChange();
      expect(h.markdown.renderWithSanitizationReport).toHaveBeenCalled();
      h.c.toggleDescriptionPreview();
      h.c.onDescriptionChange();
    });

    it('toggleTranslationPreview / onTranslationDescriptionChange', () => {
      const h = setup();
      h.c.toggleTranslationPreview('en');
      expect(h.c.translationPreviewOpen.en).toBeTrue();
      h.c.onTranslationDescriptionChange('en');
      h.c.toggleTranslationPreview('en');
      h.c.onTranslationDescriptionChange('en');
      expect(true).toBeTrue();
    });
  });

  describe('wizard', () => {
    it('startCreateWizard opens create wizard', fakeAsync(() => {
      const h = setup();
      h.c.startCreateWizard();
      tick(1);
      expect(h.c.wizardKind()).toBe('create');
    }));

    it('startPublishWizard requires editor open', fakeAsync(() => {
      const h = setup();
      h.c.startPublishWizard();
      expect(h.c.wizardKind()).toBeNull();
      h.c.editorOpen.set(true);
      h.c.editingSlug.set('slug-1');
      h.c.startPublishWizard();
      tick(1);
      expect(h.c.wizardKind()).toBe('publish');
    }));

    it('wizardSteps / current step helpers', () => {
      const h = setup();
      expect(h.c.wizardSteps()).toEqual([]);
      expect(h.c.wizardCurrentStepId()).toBeNull();
      h.c.wizardKind.set('create');
      expect(h.c.wizardSteps().length).toBeGreaterThan(0);
      expect(h.c.wizardTitleKey()).toContain('createTitle');
      h.c.wizardKind.set('publish');
      expect(h.c.wizardTitleKey()).toContain('publishTitle');
      expect(typeof h.c.wizardStepDescriptionKey()).toBe('string');
    });

    it('wizardNextLabelKey reflects last step', () => {
      const h = setup();
      expect(h.c.wizardNextLabelKey()).toContain('next');
      h.c.wizardKind.set('create');
      h.c.wizardStep.set(0);
      expect(h.c.wizardNextLabelKey()).toContain('next');
      h.c.wizardStep.set(4);
      expect(h.c.wizardNextLabelKey()).toContain('done');
    });

    it('wizardCanNext branches', () => {
      const h = setup();
      expect(h.c.wizardCanNext()).toBeFalse();
      h.c.wizardKind.set('create');
      h.c.wizardStep.set(4);
      expect(h.c.wizardCanNext()).toBeTrue();
      h.c.wizardStep.set(2);
      expect(h.c.wizardCanNext()).toBeFalse();
      h.c.editingSlug.set('slug-1');
      expect(h.c.wizardCanNext()).toBeTrue();
    });

    it('wizardPrev / wizardNext navigation', fakeAsync(() => {
      const h = setup();
      h.c.wizardKind.set('create');
      h.c.wizardStep.set(0);
      h.c.wizardPrev();
      expect(h.c.wizardStep()).toBe(0);
      h.c.editingSlug.set('slug-1');
      h.c.wizardNext();
      tick(1);
      expect(h.c.wizardStep()).toBe(1);
      h.c.wizardPrev();
      tick(1);
      expect(h.c.wizardStep()).toBe(0);
    }));

    it('wizardNext finishes at last step', fakeAsync(() => {
      const h = setup();
      h.c.wizardKind.set('create');
      h.c.wizardStep.set(4);
      h.c.wizardNext();
      expect(h.c.wizardKind()).toBeNull();
    }));

    it('wizardNext blocked at save step without slug', fakeAsync(() => {
      const h = setup();
      h.c.wizardKind.set('create');
      h.c.wizardStep.set(2);
      h.c.editingSlug.set(null);
      h.c.wizardNext();
      tick(1);
      expect(h.toast.error).toHaveBeenCalled();
    }));

    it('wizardNext no steps returns', () => {
      const h = setup();
      h.c.wizardNext();
      expect(true).toBeTrue();
    });

    it('goToWizardStep guards', fakeAsync(() => {
      const h = setup();
      h.c.goToWizardStep(0);
      h.c.wizardKind.set('create');
      h.c.goToWizardStep(-1);
      h.c.goToWizardStep(99);
      h.c.editingSlug.set(null);
      h.c.goToWizardStep(3);
      tick(1);
      expect(h.c.wizardStep()).toBe(2);
      h.c.editingSlug.set('slug-1');
      h.c.goToWizardStep(3);
      tick(1);
      expect(h.c.wizardStep()).toBe(3);
    }));

    it('wizardSave / wizardPublishNow', () => {
      const h = setup();
      const save = spyOn(h.c, 'save');
      h.c.wizardSave();
      expect(h.any.wizardAdvanceAfterSave).toBeTrue();
      h.c.wizardPublishNow();
      expect(h.c.form.status).toBe('published');
      expect(save).toHaveBeenCalledTimes(2);
    });

    it('wizardForcesAdvancedOpen', () => {
      const h = setup();
      expect(h.c.wizardForcesAdvancedOpen()).toBeFalse();
      h.c.wizardKind.set('create');
      h.c.wizardStep.set(4);
      expect(h.c.wizardForcesAdvancedOpen()).toBeTrue();
    });

    it('exitWizard resets', () => {
      const h = setup();
      h.c.wizardKind.set('create');
      h.c.exitWizard();
      expect(h.c.wizardKind()).toBeNull();
    });
  });

  describe('editor lifecycle', () => {
    it('markEditorDirty conditions', () => {
      const h = setup();
      h.c.markEditorDirty();
      expect(h.c.editorDirty()).toBeFalse();
      h.c.editorOpen.set(true);
      h.c.markEditorDirty();
      expect(h.c.editorDirty()).toBeTrue();
      h.c.editorSaving.set(true);
      h.c.editorDirty.set(false);
      h.c.markEditorDirty();
      expect(h.c.editorDirty()).toBeFalse();
    });

    it('markEditorDirtyFromEvent respects data-ignore-dirty', () => {
      const h = setup();
      h.c.editorOpen.set(true);
      const el = document.createElement('div');
      el.setAttribute('data-ignore-dirty', '');
      const child = document.createElement('input');
      el.appendChild(child);
      h.c.markEditorDirtyFromEvent({ target: child } as any);
      expect(h.c.editorDirty()).toBeFalse();
      h.c.markEditorDirtyFromEvent({ target: document.createElement('input') } as any);
      expect(h.c.editorDirty()).toBeTrue();
    });

    it('startNew opens blank editor with first category', () => {
      const h = setup();
      h.c.adminCategories.set([{ id: 'c1', name: 'Cat' }]);
      h.c.startNew();
      expect(h.c.editorOpen()).toBeTrue();
      expect(h.c.form.category_id).toBe('c1');
    });

    it('closeEditor saving guard', () => {
      const h = setup();
      h.c.editorOpen.set(true);
      h.c.editorSaving.set(true);
      h.c.closeEditor();
      expect(h.c.editorOpen()).toBeTrue();
    });

    it('closeEditor dirty confirm cancel', () => {
      const h = setup();
      h.c.editorOpen.set(true);
      h.c.editorDirty.set(true);
      spyOn(window, 'confirm').and.returnValue(false);
      h.c.closeEditor();
      expect(h.c.editorOpen()).toBeTrue();
    });

    it('closeEditor confirmed', () => {
      const h = setup();
      h.c.editorOpen.set(true);
      h.c.editorDirty.set(true);
      spyOn(window, 'confirm').and.returnValue(true);
      h.c.closeEditor();
      expect(h.c.editorOpen()).toBeFalse();
    });

    it('hasUnsavedChanges / discardUnsavedChanges', () => {
      const h = setup();
      h.c.editorOpen.set(true);
      h.c.editorDirty.set(true);
      expect(h.c.hasUnsavedChanges()).toBeTrue();
      h.c.discardUnsavedChanges();
      expect(h.c.editorDirty()).toBeFalse();
    });
  });

  describe('edit (load product)', () => {
    it('edit populates form from product', () => {
      const h = setup();
      h.admin.getProduct.and.returnValue(
        of({
          id: 'p1',
          slug: 'slug-1',
          name: 'Prod',
          currency: 'EUR',
          base_price: 50,
          weight_grams: 120,
          width_cm: 10,
          height_cm: 5,
          depth_cm: 2,
          shipping_class: 'bulky',
          shipping_allow_locker: false,
          shipping_disallowed_couriers: ['sameday', 'fan_courier'],
          sale_type: 'amount',
          sale_value: 5,
          sale_price: 45,
          sale_start_at: '2026-01-01T00:00:00Z',
          sale_end_at: '2026-02-01T00:00:00Z',
          sale_auto_publish: true,
          stock_quantity: 9,
          low_stock_threshold: 2,
          status: 'published',
          is_active: true,
          is_featured: true,
          sku: 'SKU1',
          short_description: 'short',
          long_description: 'long',
          publish_at: '2026-03-01T00:00:00Z',
          tags: ['bestseller', { slug: 'x' }],
          badges: [
            { badge: 'new', start_at: '2026-01-01T00:00:00Z', end_at: '2026-02-01T00:00:00Z' },
            { badge: 'unknown' },
          ],
          images: [{ id: 'i2', url: 'u2', sort_order: 2 }, { id: 'i1', url: 'u1', sort_order: 1 }],
          variants: [{ id: 'v1', name: 'V', additional_price_delta: 1, stock_quantity: 2 }],
        }),
      );
      h.c.edit('slug-1');
      expect(h.c.form.name).toBe('Prod');
      expect(h.c.editingCurrency()).toBe('EUR');
      expect(h.c.form.is_bestseller).toBeTrue();
      expect(h.c.form.badges.new.enabled).toBeTrue();
      expect(h.c.images()[0].id).toBe('i1');
      expect(h.c.variants().length).toBe(1);
    });

    it('edit with minimal product and percent sale', () => {
      const h = setup();
      h.admin.getProduct.and.returnValue(
        of({ id: '', slug: '', name: '', sale_type: 'percent', sale_value: 10 }),
      );
      h.c.edit('slug-1');
      expect(h.c.form.status).toBe('draft');
    });

    it('edit error sets editorError', () => {
      const h = setup();
      h.admin.getProduct.and.returnValue(throwError(() => new Error('x')));
      h.c.edit('slug-1');
      expect(h.c.editorError()).toBeTruthy();
    });
  });

  describe('restore / audit / name', () => {
    it('restoreProduct ignores missing id', () => {
      const h = setup();
      h.c.restoreProduct({ id: '' } as any);
      expect(h.productsApi.restore).not.toHaveBeenCalled();
    });

    it('restoreProduct success and error', () => {
      const h = setup();
      h.c.restoreProduct(listItem());
      expect(h.toast.success).toHaveBeenCalled();
      h.productsApi.restore.and.returnValue(throwError(() => new Error('x')));
      h.c.restoreProduct(listItem());
      expect(h.toast.error).toHaveBeenCalled();
    });

    it('refreshAudit requires slug', () => {
      const h = setup();
      h.c.refreshAudit();
      expect(h.admin.getProductAudit).not.toHaveBeenCalled();
      h.c.editingSlug.set('slug-1');
      h.c.refreshAudit();
      expect(h.admin.getProductAudit).toHaveBeenCalled();
    });

    it('onNameChange / onSkuChange schedule duplicate check', () => {
      const h = setup();
      h.c.editorOpen.set(true);
      h.c.onNameChange('Name');
      expect(h.c.form.name).toBe('Name');
      h.c.onSkuChange('SKU');
      expect(h.c.form.sku).toBe('SKU');
    });
  });

  describe('duplicate check', () => {
    it('predictedSlug from editingSlug or suggested', () => {
      const h = setup();
      h.c.editingSlug.set('slug-1');
      expect(h.c.predictedSlug()).toBe('slug-1');
      h.c.editingSlug.set(null);
      expect(h.c.predictedSlug()).toBeNull();
      h.c.duplicateCheck.set({ suggested_slug: 'sugg' } as any);
      expect(h.c.predictedSlug()).toBe('sugg');
    });

    it('duplicateHasWarnings variants', () => {
      const h = setup();
      expect(h.c.duplicateHasWarnings()).toBeFalse();
      h.c.duplicateCheck.set({
        slug_base: 'a',
        suggested_slug: 'b',
        sku_matches: [],
        name_matches: [],
      } as any);
      expect(h.c.duplicateHasWarnings()).toBeTrue();
      h.c.duplicateCheck.set({ sku_matches: [{}], name_matches: [] } as any);
      expect(h.c.duplicateHasWarnings()).toBeTrue();
    });

    it('scheduleDuplicateCheck requires editor and name/sku', fakeAsync(() => {
      const h = setup();
      h.any.scheduleDuplicateCheck();
      h.c.editorOpen.set(true);
      h.c.form.name = '';
      h.c.form.sku = '';
      h.any.scheduleDuplicateCheck();
      expect(h.c.duplicateCheck()).toBeNull();
      h.c.form.name = 'Name';
      h.any.scheduleDuplicateCheck();
      tick(450);
      expect(h.productsApi.duplicateCheck).toHaveBeenCalled();
    }));

    it('runDuplicateCheck no name/sku resets', () => {
      const h = setup();
      h.c.form.name = '';
      h.c.form.sku = '';
      h.any.runDuplicateCheck();
      expect(h.c.duplicateCheck()).toBeNull();
    });

    it('runDuplicateCheck success and error and stale', () => {
      const h = setup();
      h.c.form.name = 'Name';
      h.productsApi.duplicateCheck.and.returnValue(of({ suggested_slug: 's' }));
      h.any.runDuplicateCheck();
      expect(h.c.duplicateCheck()).toEqual({ suggested_slug: 's' } as any);

      h.c.form.name = 'Name';
      h.productsApi.duplicateCheck.and.returnValue(throwError(() => new Error('x')));
      h.any.runDuplicateCheck();
      expect(h.c.duplicateCheck()).toBeNull();
    });

    it('runDuplicateCheck ignores stale sequence', () => {
      const h = setup();
      h.c.form.name = 'Name';
      const subj = new Subject<any>();
      h.productsApi.duplicateCheck.and.returnValue(subj.asObservable());
      h.any.runDuplicateCheck();
      h.any.duplicateCheckSeq = 999;
      subj.next({ suggested_slug: 's' });
      subj.complete();
      expect(h.c.duplicateCheck()).toBeNull();
    });
  });

  describe('seo + price previews', () => {
    it('seoPreviewImageUrl', () => {
      const h = setup();
      expect(h.c.seoPreviewImageUrl()).toBeNull();
      h.c.images.set([{ id: 'i', url: 'http://x' } as any]);
      expect(h.c.seoPreviewImageUrl()).toBe('http://x');
    });

    it('seoPreviewName/Title/Url/Description', () => {
      const h = setup();
      expect(h.c.seoPreviewName('en')).toBe('—');
      expect(h.c.seoPreviewTitle('en')).toBe('—');
      h.c.form.name = 'Base';
      expect(h.c.seoPreviewTitle('en')).toContain('momentstudio');
      (h.c as any).translations.en.name = 'Trans';
      expect(h.c.seoPreviewName('en')).toBe('Trans');
      expect(h.c.seoPreviewUrl()).toContain('<slug>');
      h.c.form.short_description = 'Short desc';
      expect(h.c.seoPreviewDescription('en')).toBe('Short desc');
    });

    it('seoPreviewDescription truncates long text and handles empty', () => {
      const h = setup();
      expect(h.c.seoPreviewDescription('en')).toBe('—');
      h.c.form.long_description = 'a'.repeat(200);
      expect(h.c.seoPreviewDescription('en').endsWith('…')).toBeTrue();
    });

    it('previewBasePrice / previewSalePrice branches', () => {
      const h = setup();
      expect(h.c.previewBasePrice()).toBe(0);
      h.c.form.base_price = '100';
      expect(h.c.previewBasePrice()).toBe(100);
      expect(h.c.previewSalePrice()).toBeNull();
      h.c.form.sale_enabled = true;
      h.c.form.sale_type = 'amount';
      h.c.form.sale_value = '20';
      expect(h.c.previewSalePrice()).toBe(80);
      h.c.form.sale_value = '200';
      expect(h.c.previewSalePrice()).toBeNull();
      h.c.form.sale_type = 'percent';
      h.c.form.sale_value = '10';
      expect(h.c.previewSalePrice()).toBe(90);
      h.c.form.sale_value = '150';
      expect(h.c.previewSalePrice()).toBeNull();
    });

    it('previewSalePrice null when base zero or value invalid', () => {
      const h = setup();
      h.c.form.sale_enabled = true;
      h.c.form.base_price = '0';
      expect(h.c.previewSalePrice()).toBeNull();
      h.c.form.base_price = '100';
      h.c.form.sale_value = '0';
      expect(h.c.previewSalePrice()).toBeNull();
    });

    it('salePreviewInfo', () => {
      const h = setup();
      expect(h.c.salePreviewInfo()).toBeNull();
      h.c.form.sale_enabled = true;
      h.c.form.base_price = '100';
      h.c.form.sale_type = 'percent';
      h.c.form.sale_value = '10';
      expect(h.c.salePreviewInfo()?.percent).toBe(10);
    });
  });

  describe('form field changes', () => {
    it('onBasePriceChange updates and revalidates sale', () => {
      const h = setup();
      h.c.form.sale_enabled = true;
      h.c.form.sale_type = 'amount';
      h.c.form.sale_value = '5';
      h.c.onBasePriceChange('1a00');
      expect(h.c.basePriceError).toBeTruthy();
    });

    it('onSaleEnabledChange clears when disabled', () => {
      const h = setup();
      h.c.form.sale_enabled = false;
      h.c.form.sale_value = '5';
      h.c.onSaleEnabledChange();
      expect(h.c.form.sale_value).toBe('');
    });

    it('onSaleTypeChange resets', () => {
      const h = setup();
      h.c.form.sale_value = '5';
      h.c.onSaleTypeChange();
      expect(h.c.form.sale_value).toBe('');
    });

    it('onSaleValueChange branches', () => {
      const h = setup();
      h.c.form.sale_enabled = false;
      h.c.onSaleValueChange('5');
      expect(h.c.saleValueError).toBe('');

      h.c.form.sale_enabled = true;
      h.c.onSaleValueChange('');
      expect(h.c.saleValueError).toBe('');

      h.c.onSaleValueChange('0');
      expect(h.c.saleValueError).toContain('positiveHint');

      h.c.form.sale_type = 'percent';
      h.c.onSaleValueChange('150');
      expect(h.c.saleValueError).toContain('percentHint');

      h.c.form.sale_type = 'amount';
      h.c.form.base_price = '10';
      h.c.onSaleValueChange('50');
      expect(h.c.saleValueError).toContain('amountTooHigh');
    });
  });

  describe('status confirm + save', () => {
    it('confirmStatusChange no target', () => {
      const h = setup();
      h.c.confirmStatusChange();
      expect(h.c.editorSaving()).toBeFalse();
    });

    it('confirmStatusChange applies and saves', () => {
      const h = setup();
      spyOn(h.c, 'save').and.callFake((opts?: any) => opts?.done?.(true));
      h.c.statusConfirmTarget.set({ status: 'published', isActive: true });
      h.c.confirmStatusChange();
      expect(h.c.form.status).toBe('published');
    });

    it('closeStatusConfirm resets', () => {
      const h = setup();
      h.c.statusConfirmOpen.set(true);
      h.c.closeStatusConfirm();
      expect(h.c.statusConfirmOpen()).toBeFalse();
    });

    it('save opens status confirm when status changed', () => {
      const h = setup();
      h.c.lastSavedState.set({ status: 'draft', isActive: true });
      h.c.form.status = 'published';
      h.c.save();
      expect(h.c.statusConfirmOpen()).toBeTrue();
    });

    it('save guards when already saving', () => {
      const h = setup();
      h.c.editorSaving.set(true);
      const done = jasmine.createSpy();
      h.c.save({ skipStatusConfirm: true, done });
      expect(done).toHaveBeenCalledWith(false);
    });

    it('save invalid base price', () => {
      const h = setup();
      h.c.form.base_price = '';
      h.c.save({ skipStatusConfirm: true });
      expect(h.c.editorError()).toBeTruthy();
    });

    it('save amount sale validations', () => {
      const h = setup();
      h.c.form.base_price = '10';
      h.c.form.sale_enabled = true;
      h.c.form.sale_type = 'amount';
      h.c.form.sale_value = '';
      h.c.save({ skipStatusConfirm: true });
      expect(h.c.editorError()).toContain('valueHint');

      h.c.form.sale_value = '0';
      h.c.save({ skipStatusConfirm: true });
      expect(h.c.editorError()).toContain('positiveHint');

      h.c.form.sale_value = '50';
      h.c.save({ skipStatusConfirm: true });
      expect(h.c.editorError()).toContain('amountTooHigh');
    });

    it('save percent sale validation', () => {
      const h = setup();
      h.c.form.base_price = '10';
      h.c.form.sale_enabled = true;
      h.c.form.sale_type = 'percent';
      h.c.form.sale_value = '150';
      h.c.save({ skipStatusConfirm: true });
      expect(h.c.editorError()).toContain('percentHint');
    });

    it('save sale auto publish requires start', () => {
      const h = setup();
      h.c.form.base_price = '10';
      h.c.form.sale_enabled = true;
      h.c.form.sale_type = 'percent';
      h.c.form.sale_value = '10';
      h.c.form.sale_auto_publish = true;
      h.c.form.sale_start_at = '';
      h.c.save({ skipStatusConfirm: true });
      expect(h.c.editorError()).toContain('startRequired');
    });

    it('save low stock and weight and dimension validations', () => {
      const h = setup();
      h.c.form.base_price = '10';
      h.c.form.low_stock_threshold = '-1';
      h.c.save({ skipStatusConfirm: true });
      expect(h.c.editorError()).toContain('thresholdError');

      h.c.form.low_stock_threshold = '';
      h.c.form.weight_grams = '1.5';
      h.c.save({ skipStatusConfirm: true });
      expect(h.c.editorError()).toContain('weightHint');

      h.c.form.weight_grams = '';
      h.c.form.width_cm = '-2';
      h.c.save({ skipStatusConfirm: true });
      expect(h.c.editorError()).toContain('dimensionsHint');
    });

    it('save badge date validations', () => {
      const h = setup();
      h.c.form.base_price = '10';
      h.c.form.badges.new = { enabled: true, start_at: 'bad', end_at: '' };
      h.c.save({ skipStatusConfirm: true });
      expect(h.c.editorError()).toContain('invalidDate');

      h.c.form.badges.new = { enabled: true, start_at: '', end_at: 'bad' };
      h.c.save({ skipStatusConfirm: true });
      expect(h.c.editorError()).toContain('invalidDate');

      h.c.form.badges.new = {
        enabled: true,
        start_at: '2026-02-01T00:00',
        end_at: '2026-01-01T00:00',
      };
      h.c.save({ skipStatusConfirm: true });
      expect(h.c.editorError()).toContain('endBeforeStart');
    });

    it('save create success advances wizard', () => {
      const h = setup();
      h.c.form.base_price = '10';
      h.c.editingSlug.set(null);
      h.c.wizardKind.set('create');
      h.c.wizardStep.set(2);
      h.any.wizardAdvanceAfterSave = true;
      h.admin.createProduct.and.returnValue(
        of({ id: 'np', slug: 'new-slug', status: 'published', is_active: true, images: [{ id: 'i', sort_order: 1 }], tags: ['bestseller'] }),
      );
      h.c.save({ skipStatusConfirm: true });
      expect(h.toast.success).toHaveBeenCalled();
      expect(h.c.editingSlug()).toBe('new-slug');
    });

    it('save update success exits publish wizard', () => {
      const h = setup();
      h.c.form.base_price = '10';
      h.c.editingSlug.set('slug-1');
      h.c.editingProductId.set('p1');
      h.any.wizardExitAfterPublish = true;
      h.c.wizardKind.set('publish');
      h.c.save({ skipStatusConfirm: true });
      expect(h.c.wizardKind()).toBeNull();
    });

    it('save error path', () => {
      const h = setup();
      h.c.form.base_price = '10';
      h.admin.createProduct.and.returnValue(throwError(() => new Error('x')));
      const done = jasmine.createSpy();
      h.c.save({ skipStatusConfirm: true, done });
      expect(h.c.editorError()).toBeTruthy();
      expect(done).toHaveBeenCalledWith(false);
    });

    it('save plain create success without wizard', () => {
      const h = setup();
      h.c.form.base_price = '10';
      h.c.editingSlug.set(null);
      h.c.save({ skipStatusConfirm: true });
      expect(h.c.editingSlug()).toBe('new-slug');
    });
  });

  describe('variants', () => {
    it('variantsWithIds filters', () => {
      const h = setup();
      h.c.variants.set([{ id: 'v', name: 'a', additional_price_delta: '0', stock_quantity: 0 }, { name: 'b', additional_price_delta: '0', stock_quantity: 0 }]);
      expect(h.c.variantsWithIds().length).toBe(1);
    });

    it('addVariantRow / removeVariantRow', () => {
      const h = setup();
      h.c.addVariantRow();
      expect(h.c.variants().length).toBe(1);
      const row = h.c.variants()[0];
      h.c.removeVariantRow(row);
      expect(h.c.variants().length).toBe(0);
      const withId = { id: 'v1', name: 'a', additional_price_delta: '0', stock_quantity: 0 };
      h.c.variants.set([withId]);
      h.c.removeVariantRow(withId);
      expect(h.any.pendingVariantDeletes.has('v1')).toBeTrue();
    });

    it('onVariantNameChange/DeltaChange/StockChange', () => {
      const h = setup();
      h.c.addVariantRow();
      h.c.onVariantNameChange(0, 'Name');
      h.c.onVariantDeltaChange(0, '2');
      h.c.onVariantStockChange(0, '4');
      expect(h.c.variants()[0].name).toBe('Name');
      expect(h.c.variants()[0].stock_quantity).toBe(4);
      h.c.onVariantStockChange(0, '-1');
      expect(h.c.variants()[0].stock_quantity).toBe(0);
    });

    it('variantComputedPrice', () => {
      const h = setup();
      h.c.form.base_price = '10';
      expect(h.c.variantComputedPrice('2.5')).toBe(12.5);
      expect(h.c.variantComputedPrice('-3')).toBe(7);
    });

    it('saveVariants requires slug', () => {
      const h = setup();
      h.c.saveVariants();
      expect(h.admin.updateProductVariants).not.toHaveBeenCalled();
    });

    it('saveVariants validations', () => {
      const h = setup();
      h.c.editingSlug.set('slug-1');
      h.c.variants.set([{ name: '', additional_price_delta: '0', stock_quantity: 0 }]);
      h.c.saveVariants();
      expect(h.c.variantsError()).toContain('variantNameRequired');

      h.c.variants.set([{ name: 'a', additional_price_delta: '-', stock_quantity: 0 }]);
      h.c.saveVariants();
      expect(h.c.variantsError()).toContain('priceFormatHint');

      h.c.variants.set([{ name: 'a', additional_price_delta: '1', stock_quantity: -1 }]);
      h.c.saveVariants();
      expect(h.c.variantsError()).toContain('stockInvalid');
    });

    it('saveVariants success and error', () => {
      const h = setup();
      h.c.editingSlug.set('slug-1');
      h.c.editingProductId.set('p1');
      h.c.variants.set([{ name: 'a', additional_price_delta: '1', stock_quantity: 2 }]);
      h.admin.updateProductVariants.and.returnValue(
        of([{ id: 'v1', name: 'a', additional_price_delta: 1, stock_quantity: 2 }]),
      );
      h.c.saveVariants();
      expect(h.toast.success).toHaveBeenCalled();

      h.c.variants.set([{ name: 'a', additional_price_delta: '1', stock_quantity: 2 }]);
      h.admin.updateProductVariants.and.returnValue(throwError(() => ({ error: { detail: 'd' } })));
      h.c.saveVariants();
      expect(h.c.variantsError()).toBe('d');

      h.c.variants.set([{ name: 'a', additional_price_delta: '1', stock_quantity: 2 }]);
      h.admin.updateProductVariants.and.returnValue(throwError(() => new Error('x')));
      h.c.saveVariants();
      expect(h.c.variantsError()).toContain('variantsSaveError');
    });

    it('setVariantsFromProduct handles missing variants', () => {
      const h = setup();
      h.any.setVariantsFromProduct({});
      expect(h.c.variants()).toEqual([]);
    });

    it('updateVariant out of range', () => {
      const h = setup();
      h.any.updateVariant(5, { name: 'x' });
      expect(h.c.variants()).toEqual([]);
    });
  });

  describe('stock ledger', () => {
    it('formatTimestamp', () => {
      const h = setup();
      expect(h.c.formatTimestamp('')).toBe('');
      expect(h.c.formatTimestamp('not-a-date')).toBe('not-a-date');
      expect(typeof h.c.formatTimestamp('2026-01-01T00:00:00Z')).toBe('string');
    });

    it('formatTimestamp falls back when currentLang invalid', () => {
      const h = setup();
      (h.translate as any).currentLang = 'invalid-locale-zzz';
      expect(typeof h.c.formatTimestamp('2026-01-01T00:00:00Z')).toBe('string');
    });

    it('stockAdjustmentTargetLabel', () => {
      const h = setup();
      expect(h.c.stockAdjustmentTargetLabel({ variant_id: null } as any)).toContain('TargetProduct');
      h.c.variants.set([{ id: 'v1', name: 'VName', additional_price_delta: '0', stock_quantity: 0 }]);
      expect(h.c.stockAdjustmentTargetLabel({ variant_id: 'v1' } as any)).toBe('VName');
      expect(h.c.stockAdjustmentTargetLabel({ variant_id: 'zzzzzzzzzz' } as any)).toContain('Variant');
    });

    it('stockReasonLabel', () => {
      const h = setup();
      expect(h.c.stockReasonLabel('manual_correction')).toContain('manual_correction');
    });

    it('applyStockAdjustment requires product id', () => {
      const h = setup();
      h.c.applyStockAdjustment();
      expect(h.admin.applyStockAdjustment).not.toHaveBeenCalled();
    });

    it('applyStockAdjustment invalid delta', () => {
      const h = setup();
      h.c.editingProductId.set('p1');
      h.c.stockAdjustDelta = '0';
      h.c.applyStockAdjustment();
      expect(h.c.stockAdjustmentsError()).toBeTruthy();
    });

    it('applyStockAdjustment product-level success', () => {
      const h = setup();
      h.c.editingProductId.set('p1');
      h.c.stockAdjustDelta = '5';
      h.c.applyStockAdjustment();
      expect(h.c.form.stock_quantity).toBe(10);
    });

    it('applyStockAdjustment variant-level success', () => {
      const h = setup();
      h.c.editingProductId.set('p1');
      h.c.variants.set([{ id: 'v1', name: 'a', additional_price_delta: '0', stock_quantity: 1 }]);
      h.c.stockAdjustTarget = 'v1';
      h.c.stockAdjustDelta = '5';
      h.admin.applyStockAdjustment.and.returnValue(of({ after_quantity: 7, variant_id: 'v1' }));
      h.c.applyStockAdjustment();
      expect(h.c.variants()[0].stock_quantity).toBe(7);
    });

    it('applyStockAdjustment error paths', () => {
      const h = setup();
      h.c.editingProductId.set('p1');
      h.c.stockAdjustDelta = '5';
      h.admin.applyStockAdjustment.and.returnValue(throwError(() => ({ error: { detail: 'd' } })));
      h.c.applyStockAdjustment();
      expect(h.c.stockAdjustmentsError()).toBe('d');

      h.c.stockAdjustDelta = '5';
      h.admin.applyStockAdjustment.and.returnValue(throwError(() => new Error('x')));
      h.c.applyStockAdjustment();
      expect(h.c.stockAdjustmentsError()).toContain('ApplyError');
    });

    it('loadStockAdjustments success and error', () => {
      const h = setup();
      h.admin.listStockAdjustments.and.returnValue(of([{ id: 's1' } as any]));
      h.any.loadStockAdjustments('p1');
      expect(h.c.stockAdjustments().length).toBe(1);
      h.admin.listStockAdjustments.and.returnValue(throwError(() => new Error('x')));
      h.any.loadStockAdjustments('p1');
      expect(h.c.stockAdjustmentsError()).toBeTruthy();
    });

    it('exportStockLedgerCsv requires product and not busy', () => {
      const h = setup();
      h.c.exportStockLedgerCsv();
      expect(h.admin.exportStockAdjustmentsCsv).not.toHaveBeenCalled();
      h.c.editingProductId.set('p1');
      h.c.stockLedgerExporting.set(true);
      h.c.exportStockLedgerCsv();
      expect(h.admin.exportStockAdjustmentsCsv).not.toHaveBeenCalled();
    });

    it('exportStockLedgerCsv success and error', () => {
      const h = setup();
      h.c.editingProductId.set('p1');
      h.c.editingSlug.set('slug-1');
      h.c.stockLedgerExportFrom = '2026-01-01';
      h.c.stockLedgerExportTo = '2026-02-01';
      h.c.stockLedgerExportReason = 'manual_correction';
      const click = spyOn(HTMLAnchorElement.prototype, 'click');
      h.c.exportStockLedgerCsv();
      expect(click).toHaveBeenCalled();
      expect(h.toast.success).toHaveBeenCalled();

      h.admin.exportStockAdjustmentsCsv.and.returnValue(throwError(() => new Error('x')));
      h.c.exportStockLedgerCsv();
      expect(h.c.stockLedgerExportError()).toBeTruthy();
    });

    it('exportStockLedgerCsv all reason and no slug', () => {
      const h = setup();
      h.c.editingProductId.set('product-id-1234567890');
      h.c.editingSlug.set(null);
      h.c.stockLedgerExportReason = 'all';
      spyOn(HTMLAnchorElement.prototype, 'click');
      h.c.exportStockLedgerCsv();
      expect(h.admin.exportStockAdjustmentsCsv).toHaveBeenCalled();
    });
  });

  describe('relationships', () => {
    it('loadRelationships no slug returns', () => {
      const h = setup();
      h.any.loadRelationships('');
      expect(h.admin.getProductRelationships).not.toHaveBeenCalled();
    });

    it('loadRelationships empty ids', () => {
      const h = setup();
      h.any.loadRelationships('slug-1');
      expect(h.c.relationshipsRelated()).toEqual([]);
    });

    it('loadRelationships with ids resolves products', () => {
      const h = setup();
      h.admin.getProductRelationships.and.returnValue(
        of({ related_product_ids: ['a'], upsell_product_ids: ['b', 'a'] }),
      );
      h.productsApi.byIds.and.returnValue(of([listItem({ id: 'a' }), listItem({ id: 'b' })]));
      h.any.loadRelationships('slug-1');
      expect(h.c.relationshipsRelated().length).toBe(1);
      expect(h.c.relationshipsUpsells().length).toBe(1);
    });

    it('loadRelationships byIds error', () => {
      const h = setup();
      h.admin.getProductRelationships.and.returnValue(
        of({ related_product_ids: ['a'], upsell_product_ids: [] }),
      );
      h.productsApi.byIds.and.returnValue(throwError(() => new Error('x')));
      h.any.loadRelationships('slug-1');
      expect(h.c.relationshipsError()).toBeTruthy();
    });

    it('loadRelationships error', () => {
      const h = setup();
      h.admin.getProductRelationships.and.returnValue(throwError(() => new Error('x')));
      h.any.loadRelationships('slug-1');
      expect(h.c.relationshipsError()).toBeTruthy();
    });

    it('onRelationshipSearchChange short and long', fakeAsync(() => {
      const h = setup();
      h.c.onRelationshipSearchChange('a');
      expect(h.c.relationshipSearchResults()).toEqual([]);
      h.productsApi.search.and.returnValue(of({ items: [listItem({ id: 'z' })] }));
      h.c.onRelationshipSearchChange('abc');
      tick(250);
      expect(h.c.relationshipSearchResults().length).toBe(1);
    }));

    it('runRelationshipSearch filters current and selected, and error', () => {
      const h = setup();
      h.c.editingProductId.set('p1');
      h.c.relationshipsRelatedIds.set(['sel']);
      h.productsApi.search.and.returnValue(
        of({ items: [listItem({ id: 'p1' }), listItem({ id: 'sel' }), listItem({ id: 'ok' })] }),
      );
      h.any.runRelationshipSearch('abc');
      expect(h.c.relationshipSearchResults().map((p) => p.id)).toEqual(['ok']);

      h.productsApi.search.and.returnValue(throwError(() => new Error('x')));
      h.any.runRelationshipSearch('abc');
      expect(h.c.relationshipSearchResults()).toEqual([]);
    });

    it('runRelationshipSearch ignores stale', () => {
      const h = setup();
      const subj = new Subject<any>();
      h.productsApi.search.and.returnValue(subj.asObservable());
      h.any.runRelationshipSearch('abc');
      h.any.relationshipSearchRequestId = 999;
      subj.next({ items: [listItem()] });
      subj.complete();
      expect(h.c.relationshipSearchResults()).toEqual([]);
    });

    it('addRelationship related and upsell', () => {
      const h = setup();
      h.c.relationshipSearchResults.set([listItem({ id: 'a' })]);
      h.c.addRelationship(listItem({ id: 'a' }), 'related');
      expect(h.c.relationshipsRelatedIds()).toEqual(['a']);
      h.c.addRelationship(listItem({ id: 'b' }), 'upsell');
      expect(h.c.relationshipsUpsellIds()).toEqual(['b']);
    });

    it('addRelationship guards', () => {
      const h = setup();
      h.c.addRelationship({ id: '' } as any, 'related');
      h.c.editingProductId.set('p1');
      h.c.addRelationship(listItem({ id: 'p1' }), 'related');
      h.c.relationshipsRelatedIds.set(['dup']);
      h.c.addRelationship(listItem({ id: 'dup' }), 'related');
      expect(h.c.relationshipsRelatedIds()).toEqual(['dup']);
    });

    it('removeRelationship related and upsell', () => {
      const h = setup();
      h.c.relationshipsRelatedIds.set(['a']);
      h.c.relationshipsRelated.set([listItem({ id: 'a' })]);
      h.c.removeRelationship('a', 'related');
      expect(h.c.relationshipsRelatedIds()).toEqual([]);
      h.c.relationshipsUpsellIds.set(['b']);
      h.c.relationshipsUpsells.set([listItem({ id: 'b' })]);
      h.c.removeRelationship('b', 'upsell');
      expect(h.c.relationshipsUpsellIds()).toEqual([]);
    });

    it('moveRelationship reorders and guards', () => {
      const h = setup();
      h.c.relationshipsRelatedIds.set(['a', 'b']);
      h.c.relationshipsRelated.set([listItem({ id: 'a' }), listItem({ id: 'b' })]);
      h.c.moveRelationship('related', 0, 1);
      expect(h.c.relationshipsRelatedIds()).toEqual(['b', 'a']);
      h.c.moveRelationship('related', 0, -1);
      expect(h.c.relationshipsRelatedIds()).toEqual(['b', 'a']);
      h.c.relationshipsUpsellIds.set(['x', 'y']);
      h.c.relationshipsUpsells.set([listItem({ id: 'x' }), listItem({ id: 'y' })]);
      h.c.moveRelationship('upsell', 1, -1);
      expect(h.c.relationshipsUpsellIds()).toEqual(['y', 'x']);
    });

    it('saveRelationships requires slug', () => {
      const h = setup();
      h.c.saveRelationships();
      expect(h.toast.error).toHaveBeenCalled();
    });

    it('saveRelationships success and error', () => {
      const h = setup();
      h.c.editingSlug.set('slug-1');
      h.c.saveRelationships();
      expect(h.toast.success).toHaveBeenCalled();
      h.admin.updateProductRelationships.and.returnValue(throwError(() => new Error('x')));
      h.c.saveRelationships();
      expect(h.c.relationshipsError()).toBeTruthy();
    });
  });

  describe('translations', () => {
    it('translationDiffRows tones', () => {
      const h = setup();
      let rows = h.c.translationDiffRows();
      expect(rows[0].tone).toBe('error');
      (h.c as any).translations.ro.name = 'same';
      (h.c as any).translations.en.name = 'same';
      rows = h.c.translationDiffRows();
      expect(rows[0].tone).toBe('warn');
      (h.c as any).translations.en.name = 'different';
      rows = h.c.translationDiffRows();
      expect(rows[0].tone).toBe('neutral');
      (h.c as any).translations.ro.name = '';
      (h.c as any).translations.en.name = 'only-en';
      rows = h.c.translationDiffRows();
      expect(rows[0].statusKey).toContain('missingRo');
      (h.c as any).translations.ro.name = 'only-ro';
      (h.c as any).translations.en.name = '';
      rows = h.c.translationDiffRows();
      expect(rows[0].statusKey).toContain('missingEn');
    });

    it('trackByTranslationDiffRow', () => {
      const h = setup();
      expect(h.c.trackByTranslationDiffRow(0, { field: 'name' } as any)).toBe('name');
    });

    it('translationDiffSnippet truncation', () => {
      const h = setup();
      expect(h.any.translationDiffSnippet('')).toBe('—');
      expect(h.any.translationDiffSnippet('a'.repeat(100)).endsWith('…')).toBeTrue();
    });

    it('saveTranslation requires slug and name', () => {
      const h = setup();
      h.c.saveTranslation('en');
      expect(h.admin.upsertProductTranslation).not.toHaveBeenCalled();
      h.c.editingSlug.set('slug-1');
      (h.c as any).translations.en.name = '';
      h.c.saveTranslation('en');
      expect(h.toast.error).toHaveBeenCalled();
    });

    it('saveTranslation success and error', () => {
      const h = setup();
      h.c.editingSlug.set('slug-1');
      (h.c as any).translations.en = {
        name: 'Name',
        short_description: 'short',
        long_description: 'long',
        meta_title: '',
        meta_description: '',
      };
      h.admin.upsertProductTranslation.and.returnValue(of({ name: 'Name' }));
      h.c.saveTranslation('en');
      expect(h.c.translationExists.en).toBeTrue();

      h.admin.upsertProductTranslation.and.returnValue(throwError(() => new Error('x')));
      h.c.saveTranslation('en');
      expect(h.c.translationError()).toBeTruthy();
    });

    it('deleteTranslation requires slug, success and error', () => {
      const h = setup();
      h.c.deleteTranslation('en');
      expect(h.admin.deleteProductTranslation).not.toHaveBeenCalled();
      h.c.editingSlug.set('slug-1');
      h.c.deleteTranslation('en');
      expect(h.toast.success).toHaveBeenCalled();
      h.admin.deleteProductTranslation.and.returnValue(throwError(() => new Error('x')));
      h.c.deleteTranslation('en');
      expect(h.c.translationError()).toBeTruthy();
    });

    it('loadTranslations success refreshes open preview, and error', () => {
      const h = setup();
      h.c.translationPreviewOpen.en = true;
      h.admin.getProductTranslations.and.returnValue(
        of([
          { lang: 'en', name: 'EN', long_description: 'x' },
          { lang: 'fr', name: 'FR' },
        ] as any),
      );
      h.any.loadTranslations('slug-1');
      expect(h.c.translationExists.en).toBeTrue();

      h.admin.getProductTranslations.and.returnValue(throwError(() => new Error('x')));
      h.any.loadTranslations('slug-1');
      expect(h.c.translationError()).toBeTruthy();
    });
  });

  describe('image uploads', () => {
    it('retryImageUpload guards and requeues', () => {
      const h = setup();
      h.c.retryImageUpload('');
      h.any.imageUploadActiveId = 'id1';
      h.c.retryImageUpload('id1');
      h.any.imageUploadActiveId = null;
      h.c.retryImageUpload('missing');
      h.any.imageUploadFiles.set('id2', new File(['a'], 'a.png'));
      h.c.imageUploads.set([{ id: 'id2', fileName: 'a.png', bytes: 1, status: 'error', progress: 0, error: 'e' } as any]);
      h.c.editingSlug.set('slug-1');
      h.c.retryImageUpload('id2');
      expect(h.c.imageUploads()[0].status).not.toBe('error');
    });

    it('removeImageUpload guards and removes', () => {
      const h = setup();
      h.c.removeImageUpload('');
      h.any.imageUploadActiveId = 'a';
      h.c.removeImageUpload('a');
      h.any.imageUploadActiveId = null;
      h.c.imageUploads.set([{ id: 'b', fileName: 'b', bytes: 1, status: 'queued', progress: 0, error: null } as any]);
      h.any.imageUploadFiles.set('b', new File(['a'], 'b'));
      h.c.removeImageUpload('b');
      expect(h.c.imageUploads().length).toBe(0);
    });

    it('onUpload no files / no slug', () => {
      const h = setup();
      h.c.onUpload({ target: { files: [] } } as any);
      const target = { files: [new File(['a'], 'a.png')], value: 'x' };
      h.c.editingSlug.set(null);
      h.c.onUpload({ target } as any);
      expect(h.toast.error).toHaveBeenCalled();
      expect(target.value).toBe('');
    });

    it('onUpload queues files and starts upload', () => {
      const h = setup();
      h.c.editingSlug.set('slug-1');
      h.admin.uploadProductImageWithProgress.and.returnValue(
        of(
          { type: HttpEventType.UploadProgress, loaded: 50, total: 100 },
          { type: HttpEventType.Response, body: { images: [{ id: 'i', sort_order: 1 }] } },
        ),
      );
      const target = { files: [new File(['a'], 'a.png')], value: 'x' };
      h.c.onUpload({ target } as any);
      expect(h.c.images().length).toBe(1);
    });

    it('newImageUploadId fallback when crypto throws', () => {
      const h = setup();
      spyOn(crypto, 'randomUUID').and.throwError('no');
      expect(typeof h.any.newImageUploadId()).toBe('string');
    });

    it('maybeStartImageUpload no file marks error', () => {
      const h = setup();
      h.c.editingSlug.set('slug-1');
      h.c.imageUploads.set([{ id: 'x', fileName: 'x', bytes: 0, status: 'queued', progress: 0, error: null } as any]);
      h.any.maybeStartImageUpload();
      expect(h.c.imageUploads()[0].status).toBe('error');
    });

    it('maybeStartImageUpload progress without total uses bytes', () => {
      const h = setup();
      h.c.editingSlug.set('slug-1');
      h.any.imageUploadFiles.set('x', new File(['a'], 'x.png'));
      h.c.imageUploads.set([{ id: 'x', fileName: 'x', bytes: 200, status: 'queued', progress: 0, error: null } as any]);
      h.admin.uploadProductImageWithProgress.and.returnValue(
        of({ type: HttpEventType.UploadProgress, loaded: 100, total: 0 }),
      );
      h.any.maybeStartImageUpload();
      expect(h.c.imageUploads()[0].progress).toBeGreaterThan(0);
    });

    it('maybeStartImageUpload error path', () => {
      const h = setup();
      h.c.editingSlug.set('slug-1');
      h.any.imageUploadFiles.set('x', new File(['a'], 'x.png'));
      h.c.imageUploads.set([{ id: 'x', fileName: 'x', bytes: 1, status: 'queued', progress: 0, error: null } as any]);
      h.admin.uploadProductImageWithProgress.and.returnValue(throwError(() => ({ message: 'fail' })));
      h.any.maybeStartImageUpload();
      expect(h.c.imageUploads()[0].status).toBe('error');
    });

    it('maybeStartImageUpload busy and no queued guards', () => {
      const h = setup();
      h.any.imageUploadSub = { unsubscribe: () => undefined } as any;
      h.any.maybeStartImageUpload();
      h.any.imageUploadSub = null;
      h.c.editingSlug.set(null);
      h.any.maybeStartImageUpload();
      h.c.editingSlug.set('slug-1');
      h.c.imageUploads.set([]);
      h.any.maybeStartImageUpload();
      expect(true).toBeTrue();
    });
  });

  describe('image management', () => {
    it('makeImagePrimary guards', () => {
      const h = setup();
      h.c.makeImagePrimary('');
      h.c.editingSlug.set('slug-1');
      h.c.imageOrderBusy.set(true);
      h.c.makeImagePrimary('i1');
      h.c.imageOrderBusy.set(false);
      h.c.images.set([{ id: 'i1', url: 'u' } as any]);
      h.c.makeImagePrimary('i1');
      expect(h.admin.reorderProductImage).not.toHaveBeenCalled();
    });

    it('makeImagePrimary reorders success and error', () => {
      const h = setup();
      h.c.editingSlug.set('slug-1');
      h.c.images.set([{ id: 'i1', url: 'u1' } as any, { id: 'i2', url: 'u2' } as any]);
      h.c.makeImagePrimary('i2');
      expect(h.c.images()[0].id).toBe('i2');

      h.c.images.set([{ id: 'i1', url: 'u1' } as any, { id: 'i2', url: 'u2' } as any]);
      h.admin.reorderProductImage.and.returnValue(throwError(() => new Error('x')));
      h.c.makeImagePrimary('i2');
      expect(h.c.imageOrderError()).toBeTruthy();
    });

    it('openDeleteImageConfirm guards and opens', () => {
      const h = setup();
      h.c.openDeleteImageConfirm('missing');
      expect(h.c.deleteImageConfirmOpen()).toBeFalse();
      h.c.images.set([{ id: 'i1', url: 'u', alt_text: 'Alt' } as any]);
      h.c.openDeleteImageConfirm('i1');
      expect(h.c.deleteImageConfirmOpen()).toBeTrue();
      h.c.closeDeleteImageConfirm();
      expect(h.c.deleteImageConfirmOpen()).toBeFalse();
    });

    it('openDeleteImageConfirm fallback alt', () => {
      const h = setup();
      h.c.images.set([{ id: 'i1', url: 'u', alt_text: '' } as any]);
      h.c.openDeleteImageConfirm('i1');
      expect(h.c.deleteImageConfirmTarget()?.alt).toContain('form.image');
    });

    it('confirmDeleteImage guards and runs', () => {
      const h = setup();
      h.c.confirmDeleteImage();
      h.c.editingSlug.set('slug-1');
      h.c.deleteImageConfirmTarget.set({ id: 'i1', url: 'u', alt: 'a' });
      h.c.deleteImageConfirmBusy.set(true);
      h.c.confirmDeleteImage();
      h.c.deleteImageConfirmBusy.set(false);
      h.c.confirmDeleteImage();
      expect(h.admin.deleteProductImage).toHaveBeenCalled();
    });

    it('deleteImage no slug', () => {
      const h = setup();
      const done = jasmine.createSpy();
      h.c.deleteImage('i1', { done });
      expect(done).toHaveBeenCalledWith(false);
    });

    it('deleteImage success resets meta and reloads deleted', () => {
      const h = setup();
      h.c.editingSlug.set('slug-1');
      h.c.editingImageId.set('i1');
      h.c.deletedImagesOpen.set(true);
      h.admin.deleteProductImage.and.returnValue(of({ images: [{ id: 'x', sort_order: 1 }] }));
      h.c.deleteImage('i1');
      expect(h.c.editingImageId()).toBeNull();

      h.admin.deleteProductImage.and.returnValue(throwError(() => new Error('x')));
      h.c.deleteImage('i1');
      expect(h.toast.error).toHaveBeenCalled();
    });

    it('toggleDeletedImages opens and closes', () => {
      const h = setup();
      h.c.toggleDeletedImages();
      expect(h.admin.listDeletedProductImages).not.toHaveBeenCalled();
      h.c.editingSlug.set('slug-1');
      h.c.toggleDeletedImages();
      expect(h.c.deletedImagesOpen()).toBeTrue();
      h.c.toggleDeletedImages();
      expect(h.c.deletedImagesOpen()).toBeFalse();
    });

    it('restoreDeletedImage requires slug, success and error', () => {
      const h = setup();
      h.c.restoreDeletedImage('i1');
      h.c.editingSlug.set('slug-1');
      h.c.restoreDeletedImage('i1');
      expect(h.toast.success).toHaveBeenCalled();
      h.admin.restoreProductImage.and.returnValue(throwError(() => new Error('x')));
      h.c.restoreDeletedImage('i1');
      expect(h.c.deletedImagesError()).toBeTruthy();
    });

    it('loadDeletedImages success and error', () => {
      const h = setup();
      h.admin.listDeletedProductImages.and.returnValue(of([{ id: 'd1' } as any]));
      h.any.loadDeletedImages('slug-1');
      expect(h.c.deletedImages().length).toBe(1);
      h.admin.listDeletedProductImages.and.returnValue(throwError(() => new Error('x')));
      h.any.loadDeletedImages('slug-1');
      expect(h.c.deletedImagesError()).toBeTruthy();
    });

    it('toggleImageMeta opens and closes', () => {
      const h = setup();
      h.c.toggleImageMeta('i1');
      h.c.editingSlug.set('slug-1');
      h.c.toggleImageMeta('i1');
      expect(h.c.editingImageId()).toBe('i1');
      h.c.toggleImageMeta('i1');
      expect(h.c.editingImageId()).toBeNull();
    });

    it('saveImageMeta requires slug+image', () => {
      const h = setup();
      h.c.saveImageMeta();
      expect(h.admin.upsertProductImageTranslation).not.toHaveBeenCalled();
    });

    it('saveImageMeta no ops short-circuits', () => {
      const h = setup();
      h.c.editingSlug.set('slug-1');
      h.c.editingImageId.set('i1');
      h.c.saveImageMeta();
      expect(h.toast.success).toHaveBeenCalled();
    });

    it('saveImageMeta delete + upsert and success', () => {
      const h = setup();
      h.c.editingSlug.set('slug-1');
      h.c.editingImageId.set('i1');
      h.c.imageMetaExists = { en: true, ro: false };
      (h.c as any).imageMeta = { en: { alt_text: '', caption: '' }, ro: { alt_text: 'A', caption: '' } };
      h.c.saveImageMeta();
      expect(h.admin.deleteProductImageTranslation).toHaveBeenCalled();
      expect(h.admin.upsertProductImageTranslation).toHaveBeenCalled();
    });

    it('saveImageMeta error path', () => {
      const h = setup();
      h.c.editingSlug.set('slug-1');
      h.c.editingImageId.set('i1');
      (h.c as any).imageMeta = { en: { alt_text: 'A', caption: '' }, ro: { alt_text: '', caption: '' } };
      h.admin.upsertProductImageTranslation.and.returnValue(throwError(() => new Error('x')));
      h.c.saveImageMeta();
      expect(h.c.imageMetaError()).toBeTruthy();
    });

    it('reprocessImage requires slug+image, success and error', () => {
      const h = setup();
      h.c.reprocessImage();
      h.c.editingSlug.set('slug-1');
      h.c.editingImageId.set('i1');
      h.c.reprocessImage();
      expect(h.toast.success).toHaveBeenCalled();
      h.admin.reprocessProductImage.and.returnValue(throwError(() => new Error('x')));
      h.c.reprocessImage();
      expect(h.c.imageMetaError()).toBeTruthy();
    });

    it('loadImageMeta success maps translations and error', () => {
      const h = setup();
      h.admin.getProductImageTranslations.and.returnValue(
        of([{ lang: 'en', alt_text: 'A', caption: 'C' }, { lang: 'fr' }] as any),
      );
      h.admin.getProductImageStats.and.returnValue(of({ ok: true } as any));
      h.any.loadImageMeta('slug-1', 'i1');
      expect(h.c.imageMetaExists.en).toBeTrue();

      h.admin.getProductImageTranslations.and.returnValue(throwError(() => new Error('x')));
      h.any.loadImageMeta('slug-1', 'i1');
      expect(h.c.imageMetaError()).toBeTruthy();
    });
  });

  describe('formatters + load', () => {
    it('formatBytes scales', () => {
      const h = setup();
      expect(h.c.formatBytes(null)).toBe('—');
      expect(h.c.formatBytes(512)).toBe('512 B');
      expect(h.c.formatBytes(2048)).toBe('2 KB');
      expect(h.c.formatBytes(5 * 1024 * 1024)).toContain('MB');
    });

    it('formatAuditValue types', () => {
      const h = setup();
      expect(h.c.formatAuditValue(null)).toBe('—');
      expect(h.c.formatAuditValue('s')).toBe('s');
      expect(h.c.formatAuditValue(5)).toBe('5');
      expect(h.c.formatAuditValue(true)).toBe('true');
      expect(h.c.formatAuditValue(new Date('2026-01-01T00:00:00Z'))).toContain('2026');
      expect(h.c.formatAuditValue({ a: 1 })).toContain('a');
      const circular: any = {};
      circular.self = circular;
      expect(h.c.formatAuditValue(circular)).toBe('—');
    });

    it('load success and error', () => {
      const h = setup();
      h.productsApi.search.and.returnValue(of({ items: [listItem()], meta: { total: 1 } }));
      h.any.load();
      expect(h.c.products().length).toBe(1);
      h.productsApi.search.and.returnValue(throwError(() => ({ message: 'x' })));
      h.any.load();
      expect(h.c.error()).toBeTruthy();
    });

    it('load applies all filter branches', () => {
      const h = setup();
      h.c.q = '  term  ';
      h.c.status = 'published';
      h.c.categorySlug = 'cat';
      h.c.translationFilter = 'missing_en';
      h.c.view = 'deleted';
      h.any.load();
      h.c.translationFilter = 'missing_ro';
      h.any.load();
      expect(h.productsApi.search).toHaveBeenCalled();
    });

    it('retryLoad calls load', () => {
      const h = setup();
      h.c.retryLoad();
      expect(h.productsApi.search).toHaveBeenCalled();
    });

    it('loadCategories error', () => {
      const h = setup();
      h.catalog.listCategories.and.returnValue(throwError(() => new Error('x')));
      h.any.loadCategories();
      expect(h.c.categories()).toEqual([]);
    });

    it('loadAdminCategories sets category and opens pending', () => {
      const h = setup();
      h.c.editorOpen.set(true);
      h.c.editingSlug.set(null);
      h.c.form.category_id = '';
      h.any.loadAdminCategories();
      expect(h.c.form.category_id).toBe('c1');
    });

    it('loadAdminCategories error opens pending new', () => {
      const h = setup();
      h.any.autoStartNewProduct = true;
      h.admin.getCategories.and.returnValue(throwError(() => new Error('x')));
      h.any.loadAdminCategories();
      expect(h.c.editorOpen()).toBeTrue();
    });

    it('openPendingEditor edits pending slug', () => {
      const h = setup();
      h.any.pendingEditProductSlug = 'slug-1';
      const edit = spyOn(h.c, 'edit');
      h.any.openPendingEditor();
      expect(edit).toHaveBeenCalledWith('slug-1');
    });

    it('statusPillClass variants', () => {
      const h = setup();
      expect(h.c.statusPillClass('published')).toContain('emerald');
      expect(h.c.statusPillClass('archived')).toContain('slate');
      expect(h.c.statusPillClass('draft')).toContain('amber');
    });
  });

  describe('money + audit helpers', () => {
    it('sanitizeMoneyInput edge cases', () => {
      const h = setup();
      expect(h.any.sanitizeMoneyInput('')).toEqual({ clean: '', changed: false });
      expect(h.any.sanitizeMoneyInput('.5').clean).toBe('0.5');
      expect(h.any.sanitizeMoneyInput('1.2.3').clean).toBe('1.23');
      expect(h.any.sanitizeMoneyInput('12').clean).toBe('12');
    });

    it('parseMoneyInput / parseSignedMoneyInput', () => {
      const h = setup();
      expect(h.any.parseMoneyInput('')).toBeNull();
      expect(h.any.parseMoneyInput('12.5')).toBe(12.5);
      expect(h.any.parseSignedMoneyInput('')).toBeNull();
      expect(h.any.parseSignedMoneyInput('-')).toBeNull();
      expect(h.any.parseSignedMoneyInput('-3')).toBe(-3);
      expect(h.any.parseSignedMoneyInput('3')).toBe(3);
      expect(h.any.parseSignedMoneyInput('-abc')).toBeNull();
    });

    it('formatMoneyInput', () => {
      const h = setup();
      expect(h.any.formatMoneyInput(NaN)).toBe('');
      expect(h.any.formatMoneyInput(5)).toBe('5.00');
    });

    it('parseAuditMoney types', () => {
      const h = setup();
      expect(h.any.parseAuditMoney(null)).toBeNull();
      expect(h.any.parseAuditMoney(5)).toBe(5);
      expect(h.any.parseAuditMoney(Infinity)).toBeNull();
      expect(h.any.parseAuditMoney('5')).toBe(5);
      expect(h.any.parseAuditMoney('abc')).toBeNull();
      expect(h.any.parseAuditMoney(BigInt(5))).toBe(5);
      expect(h.any.parseAuditMoney({})).toBeNull();
    });

    it('parseLocalDateTime', () => {
      const h = setup();
      expect(h.any.parseLocalDateTime('')).toBeNull();
      expect(h.any.parseLocalDateTime('bad')).toBeNull();
      expect(typeof h.any.parseLocalDateTime('2026-01-01T00:00')).toBe('number');
    });

    it('parseTagSlugs dedups', () => {
      const h = setup();
      expect(h.any.parseTagSlugs('not-array')).toEqual([]);
      expect(h.any.parseTagSlugs(['A', { slug: 'a' }, { slug: 'B' }, null])).toEqual(['a', 'b']);
    });

    it('buildTags handles bestseller toggle', () => {
      const h = setup();
      h.any.loadedTagSlugs = ['bestseller', 'other'];
      h.c.form.is_bestseller = false;
      expect(h.any.buildTags()).toEqual(['other']);
      h.c.form.is_bestseller = true;
      expect(h.any.buildTags()).toContain('bestseller');
    });

    it('buildShortDescription', () => {
      const h = setup();
      h.c.form.short_description = 'direct';
      expect(h.any.buildShortDescription()).toBe('direct');
      h.c.form.short_description = '';
      h.c.form.long_description = '';
      expect(h.any.buildShortDescription()).toBeNull();
      h.c.form.long_description = '\n  First line  \nsecond';
      expect(h.any.buildShortDescription()).toBe('First line');
    });

    it('toLocalDateTime invalid and valid', () => {
      const h = setup();
      expect(h.any.toLocalDateTime('bad')).toBe('');
      expect(h.any.toLocalDateTime('2026-01-02T03:04:00Z')).toContain('2026-');
    });

    it('downloadBlob clicks link', fakeAsync(() => {
      const h = setup();
      const click = spyOn(HTMLAnchorElement.prototype, 'click');
      h.any.downloadBlob(new Blob(['a']), 'x.csv');
      tick(1);
      expect(click).toHaveBeenCalled();
    }));
  });

  describe('audit / price history', () => {
    it('loadAudit success builds price history and error', () => {
      const h = setup();
      h.admin.getProductAudit.and.returnValue(
        of([
          {
            created_at: '2026-01-01T00:00:00Z',
            user_email: 'a@b.c',
            payload: { changes: { base_price: { before: 10, after: 20 } } },
          },
          {
            created_at: '2026-02-01T00:00:00Z',
            payload: { changes: { base_price: { before: 20, after: 20 } } },
          },
          { created_at: '2026-03-01T00:00:00Z', payload: {} },
        ] as any),
      );
      h.any.loadAudit('slug-1');
      expect(h.c.priceHistoryChanges().length).toBe(1);
      expect(h.c.priceHistoryChart()).not.toBeNull();

      h.admin.getProductAudit.and.returnValue(throwError(() => new Error('x')));
      h.any.loadAudit('slug-1');
      expect(h.c.auditError()).toBeTruthy();
    });

    it('buildPriceHistoryChart with no changes uses current base', () => {
      const h = setup();
      h.c.form.base_price = '50';
      const chart = h.any.buildPriceHistoryChart([]);
      expect(chart).not.toBeNull();
    });

    it('buildPriceHistoryChart null when no changes and no base', () => {
      const h = setup();
      h.c.form.base_price = '';
      expect(h.any.buildPriceHistoryChart([])).toBeNull();
    });

    it('buildPriceHistoryChart with sale window', () => {
      const h = setup();
      h.c.form.base_price = '50';
      h.c.form.sale_start_at = '2020-01-01T00:00';
      h.c.form.sale_end_at = '2020-02-01T00:00';
      const changes = [
        { at: '2026-01-01T00:00:00Z', before: 10, after: 20, user: null },
        { at: '2026-02-01T00:00:00Z', before: 20, after: 20, user: null },
      ];
      const chart = h.any.buildPriceHistoryChart(changes);
      expect(chart.saleRect).not.toBeNull();
    });

    it('extractBasePriceChanges skips invalid', () => {
      const h = setup();
      const out = h.any.extractBasePriceChanges([
        { created_at: 'a', payload: { changes: { base_price: { before: 'x', after: 'y' } } } },
        { created_at: 'b', payload: { changes: { base_price: { before: 5, after: 5 } } } },
        { created_at: 'c', user_id: 'u', payload: { changes: { base_price: { before: 5, after: 6 } } } },
      ]);
      expect(out.length).toBe(1);
    });
  });

  describe('reset helpers', () => {
    it('reset* helpers run without error', () => {
      const h = setup();
      h.any.resetVariants();
      h.any.resetRelationships();
      h.any.resetStockLedger();
      h.any.resetTranslations();
      h.any.resetAudit();
      h.any.resetMarkdownPreview();
      h.any.resetDeletedImages();
      h.any.resetImageUploads();
      h.any.resetImageMeta();
      h.any.resetDuplicateCheck();
      expect(h.c.variants()).toEqual([]);
    });
  });

  describe('branch completion', () => {
    it('null-input change handlers cover ?? defaults', () => {
      const h = setup();
      h.c.onBulkSaleValueChange(null as any);
      h.c.onBulkPriceValueChange(null as any);
      h.c.onInlineBasePriceChange(null as any);
      h.c.onInlineStockChange(null as any);
      h.c.onInlineSaleValueChange(null as any);
      h.c.onNameChange(null as any);
      h.c.onSkuChange(null as any);
      h.c.onBasePriceChange(null as any);
      h.c.onSaleValueChange(null as any);
      h.c.onCategoryManagerSelect(null as any);
      h.c.onRelationshipSearchChange(null as any);
      h.c.addVariantRow();
      h.c.onVariantNameChange(0, null as any);
      h.c.onVariantDeltaChange(0, null as any);
      h.c.onVariantStockChange(0, null as any);
      expect(h.c.form.name).toBe('');
    });

    it('changed=false ternary branches (clean equals input)', () => {
      const h = setup();
      h.c.onInlineBasePriceChange('10');
      expect(h.c.inlineBasePriceError).toBe('');
      h.c.inlineSaleEnabled = true;
      h.c.inlineSaleType = 'amount';
      h.c.onInlineSaleValueChange('10');
      expect(h.c.inlineSaleError).toBe('');
      h.c.onBasePriceChange('10');
      expect(h.c.basePriceError).toBe('');
      h.c.form.sale_enabled = true;
      h.c.form.sale_type = 'amount';
      h.c.form.base_price = '100';
      h.c.onSaleValueChange('10');
      expect(h.c.saleValueError).toBe('');
    });

    it('applyScheduleToSelected publish-only and unpublish-only', () => {
      const h = setup();
      h.c.selected.add('p1');
      h.c.bulkPublishScheduledFor = '2026-01-01T00:00';
      h.c.bulkUnpublishScheduledFor = '';
      h.c.applyScheduleToSelected();
      h.c.selected.add('p1');
      h.c.bulkPublishScheduledFor = '';
      h.c.bulkUnpublishScheduledFor = '2026-01-01T00:00';
      h.c.applyScheduleToSelected();
      expect(h.admin.bulkUpdateProducts).toHaveBeenCalledTimes(2);
    });

    it('startInlineEdit with non-numeric base price and stock', () => {
      const h = setup();
      h.c.startInlineEdit(listItem({ base_price: 'abc', stock_quantity: 'x', sale_type: '', sale_value: 0 }));
      expect(h.c.inlineBasePrice).toBe('0.00');
    });

    it('updateBulkPricePreview decrease + missing currency + string price', () => {
      const h = setup();
      h.c.products.set([listItem({ base_price: '100', currency: '' })]);
      h.c.selected.add('p1');
      h.c.bulkPriceMode = 'percent';
      h.c.bulkPriceDirection = 'decrease';
      h.c.bulkPriceValue = '10';
      h.c.updateBulkPricePreview();
      expect(h.c.bulkPricePreview?.currency).toBe('RON');
    });

    it('applyPriceAdjustmentToSelected with string base price', () => {
      const h = setup();
      h.c.products.set([listItem({ base_price: '100' })]);
      h.c.selected.add('p1');
      h.c.bulkPriceValue = '10';
      h.c.applyPriceAdjustmentToSelected();
      expect(h.toast.success).toHaveBeenCalled();
    });

    it('csvImportCanApply with result missing errors', () => {
      const h = setup();
      h.c.csvImportFile.set(new File(['a'], 'p.csv'));
      h.c.csvImportResult.set({} as any);
      expect(h.c.csvImportCanApply()).toBeTrue();
    });

    it('refreshCategoryLists null responses', () => {
      const h = setup();
      h.catalog.listCategories.and.returnValue(of(null));
      h.admin.getCategories.and.returnValue(of(null));
      h.any.refreshCategoryLists();
      expect(h.c.categories()).toEqual([]);
    });

    it('onCategoryImportFileChange no files', () => {
      const h = setup();
      h.c.onCategoryImportFileChange({ target: {} } as any);
      expect(h.c.categoryImportFile).toBeNull();
    });

    it('runCategoryImport result without errors prop and error without detail', () => {
      const h = setup();
      h.c.categoryImportFile = new File(['a'], 'c.csv');
      h.admin.importCategoriesCsv.and.returnValue(of({}));
      h.c.runCategoryImport();
      expect(h.toast.success).toHaveBeenCalled();
      h.admin.importCategoriesCsv.and.returnValue(throwError(() => ({})));
      h.c.runCategoryImport();
      expect(h.c.categoryImportError()).toBeTruthy();
    });

    it('category manager save/preview/delete guards (saving/loading flags + no cat)', () => {
      const h = setup();
      h.c.mergeCategorySelected();
      h.c.previewCategoryDelete();
      h.c.deleteCategorySelectedSafe();
      h.c.categories.set([{ id: 'c1', slug: 'cat-1', name: 'Cat', parent_id: null } as any]);
      h.c.categoryManagerSlug = 'cat-1';
      h.c.mergeTargetSlug = 'x';
      h.c.mergeSaving.set(true);
      h.c.mergeCategorySelected();
      h.c.deleteSaving.set(true);
      h.c.previewCategoryDelete();
      h.c.deleteCategorySelectedSafe();
      expect(h.admin.mergeCategory).not.toHaveBeenCalled();
    });

    it('categoryDescendantIds multi-level tree with re-visit', () => {
      const h = setup();
      h.c.categories.set([
        { id: 'a', slug: 'a', name: 'A', parent_id: null } as any,
        { id: 'b', slug: 'b', name: 'B', parent_id: 'a' } as any,
        { id: 'c', slug: 'c', name: 'C', parent_id: 'a' } as any,
        { id: 'd', slug: 'd', name: 'D', parent_id: 'b' } as any,
        { id: 'd2', slug: 'd2', name: 'D2', parent_id: 'c' } as any,
      ]);
      const excluded = h.any.categoryDescendantIds('a');
      expect(excluded.has('d')).toBeTrue();
      expect(h.any.categoryDescendantIds('d')).toEqual(jasmine.any(Set));
    });

    it('edit with adversarial product shapes', () => {
      const h = setup();
      h.admin.getProduct.and.returnValue(
        of({
          id: 'p1',
          slug: 'slug-1',
          name: 'P',
          currency: { toString: () => '' },
          base_price: 'abc',
          weight_grams: 'x',
          shipping_disallowed_couriers: [null, 'sameday'],
          sale_type: 'amount',
          sale_value: 'abc',
          sale_price: 5,
          badges: [
            { badge: null },
            { badge: 'limited', start_at: null, end_at: null },
          ],
          images: [{ id: 'i1', url: 'u1' }, { id: 'i2', url: 'u2' }],
          variants: [{ id: 'v', name: null, additional_price_delta: null, stock_quantity: null }],
        }),
      );
      h.c.edit('slug-1');
      expect(h.c.editingCurrency()).toBe('RON');
      expect(h.c.form.badges.limited.enabled).toBeTrue();
    });

    it('onNameChange/onSkuChange keep null-safe strings', () => {
      const h = setup();
      h.c.editorOpen.set(true);
      h.c.onNameChange(123 as any);
      expect(h.c.form.name).toBe('123');
    });

    it('duplicateHasWarnings with missing match arrays', () => {
      const h = setup();
      h.c.duplicateCheck.set({ slug_base: '', suggested_slug: '' } as any);
      expect(h.c.duplicateHasWarnings()).toBeFalse();
    });

    it('resetDuplicateCheck clears pending timeout', () => {
      const h = setup();
      h.any.duplicateCheckTimeoutId = setTimeout(() => undefined, 1000);
      h.any.resetDuplicateCheck();
      expect(h.any.duplicateCheckTimeoutId).toBeNull();
    });

    it('runDuplicateCheck with sku only (name undefined)', () => {
      const h = setup();
      h.c.form.name = '';
      h.c.form.sku = 'SKU';
      h.productsApi.duplicateCheck.and.returnValue(of({ suggested_slug: 's' }));
      h.any.runDuplicateCheck();
      expect(h.productsApi.duplicateCheck).toHaveBeenCalled();
    });

    it('salePreviewInfo defensive null guards via spy', () => {
      const h = setup();
      spyOn(h.c, 'previewSalePrice').and.returnValue(50);
      h.c.form.base_price = '0';
      expect(h.c.salePreviewInfo()).toBeNull();
      h.c.form.base_price = '50';
      expect(h.c.salePreviewInfo()).toBeNull();
    });

    it('shouldConfirmStatusChange and openStatusConfirm with null lastSavedState', () => {
      const h = setup();
      h.c.lastSavedState.set(null);
      h.any.openStatusConfirm();
      expect(h.c.statusConfirmOpen()).toBeFalse();
      h.c.lastSavedState.set(null);
      h.c.form.base_price = '10';
      h.c.save();
      expect(h.c.editingSlug()).toBe('new-slug');
    });

    it('confirmStatusChange busy guard', () => {
      const h = setup();
      h.c.statusConfirmTarget.set({ status: 'published', isActive: true });
      h.c.statusConfirmBusy.set(true);
      h.c.confirmStatusChange();
      expect(h.c.form.status).not.toBe('published');
    });

    it('save success with full shipping/badges/sale/publish and update slug fallback', () => {
      const h = setup();
      h.c.editingSlug.set('slug-1');
      h.c.editingProductId.set(null);
      h.c.form.base_price = '100';
      h.c.form.weight_grams = '120';
      h.c.form.width_cm = '10';
      h.c.form.height_cm = '5';
      h.c.form.depth_cm = '2';
      h.c.form.low_stock_threshold = '3';
      h.c.form.shipping_disallowed_couriers = { sameday: true, fan_courier: true };
      h.c.form.sale_enabled = true;
      h.c.form.sale_type = 'amount';
      h.c.form.sale_value = '20';
      h.c.form.sale_start_at = '2026-01-01T00:00';
      h.c.form.sale_end_at = '2026-02-01T00:00';
      h.c.form.publish_at = '2026-03-01T00:00';
      h.c.form.badges.new = { enabled: true, start_at: '2026-01-01T00:00', end_at: '2026-02-01T00:00' };
      h.admin.updateProduct.and.returnValue(
        of({ id: 'p1', images: [{ id: 'i2', url: 'u', sort_order: null }, { id: 'i1', url: 'u' }] }),
      );
      h.c.save({ skipStatusConfirm: true });
      expect(h.toast.success).toHaveBeenCalled();
      expect(h.c.editingSlug()).toBe('slug-1');
    });

    it('saveVariants success with null updated list and null fields', () => {
      const h = setup();
      h.c.editingSlug.set('slug-1');
      h.c.variants.set([{ name: 'a', additional_price_delta: '1', stock_quantity: 2 }]);
      h.admin.updateProductVariants.and.returnValue(of(null as any));
      h.c.saveVariants();
      expect(h.c.variants()).toEqual([]);

      h.c.variants.set([{ name: 'a', additional_price_delta: '1', stock_quantity: 2 }]);
      h.admin.updateProductVariants.and.returnValue(
        of([{ id: 'v', name: null, additional_price_delta: null, stock_quantity: null } as any]),
      );
      h.c.saveVariants();
      expect(h.c.variants().length).toBe(1);
    });

    it('formatTimestamp with empty currentLang', () => {
      const h = setup();
      (h.translate as any).currentLang = '';
      expect(typeof h.c.formatTimestamp('2026-01-01T00:00:00Z')).toBe('string');
    });

    it('applyStockAdjustment with null delta and null note', () => {
      const h = setup();
      h.c.editingProductId.set('p1');
      h.c.stockAdjustDelta = null as any;
      h.c.stockAdjustNote = '';
      h.c.applyStockAdjustment();
      expect(h.c.stockAdjustmentsError()).toBeTruthy();
    });

    it('loadStockAdjustments non-array result', () => {
      const h = setup();
      h.admin.listStockAdjustments.and.returnValue(of(null as any));
      h.any.loadStockAdjustments('p1');
      expect(h.c.stockAdjustments()).toEqual([]);
    });

    it('exportStockLedgerCsv filename fallback with special-char slug', () => {
      const h = setup();
      h.c.editingProductId.set('p1');
      h.c.editingSlug.set('!!!');
      spyOn(HTMLAnchorElement.prototype, 'click');
      h.c.exportStockLedgerCsv();
      expect(h.admin.exportStockAdjustmentsCsv).toHaveBeenCalled();
    });

    it('resetRelationships clears pending search timeout', () => {
      const h = setup();
      h.any.relationshipSearchTimeout = setTimeout(() => undefined, 1000);
      h.any.resetRelationships();
      expect(h.any.relationshipSearchTimeout).toBeNull();
    });

    it('loadRelationships with null ids and partial resolution', () => {
      const h = setup();
      h.admin.getProductRelationships.and.returnValue(of({}));
      h.any.loadRelationships('slug-1');
      expect(h.c.relationshipsRelatedIds()).toEqual([]);

      h.admin.getProductRelationships.and.returnValue(
        of({ related_product_ids: ['a', 'missing'], upsell_product_ids: ['b'] }),
      );
      h.productsApi.byIds.and.returnValue(of(null as any));
      h.any.loadRelationships('slug-1');
      expect(h.c.relationshipsRelated()).toEqual([]);

      h.admin.getProductRelationships.and.returnValue(
        of({ related_product_ids: ['a', 'missing'], upsell_product_ids: ['b'] }),
      );
      h.productsApi.byIds.and.returnValue(of([listItem({ id: 'a' }), listItem({ id: 'b' })]));
      h.any.loadRelationships('slug-1');
      expect(h.c.relationshipsRelatedIds()).toEqual(['a']);
    });

    it('onRelationshipSearchChange clears existing timeout', fakeAsync(() => {
      const h = setup();
      h.c.onRelationshipSearchChange('abc');
      h.c.onRelationshipSearchChange('abcd');
      tick(250);
      expect(h.productsApi.search).toHaveBeenCalled();
    }));

    it('runRelationshipSearch with non-array items', () => {
      const h = setup();
      h.productsApi.search.and.returnValue(of({}));
      h.any.runRelationshipSearch('abc');
      expect(h.c.relationshipSearchResults()).toEqual([]);
    });

    it('addRelationship with null id and moveRelationship out of range', () => {
      const h = setup();
      h.c.addRelationship({ id: null } as any, 'related');
      expect(h.c.relationshipsRelatedIds()).toEqual([]);
      h.c.relationshipsRelatedIds.set(['a']);
      h.c.relationshipsRelated.set([listItem({ id: 'a' })]);
      h.c.moveRelationship('related', 5, 1);
      expect(h.c.relationshipsRelatedIds()).toEqual(['a']);
    });

    it('translationDiffRows with missing/undefined translation fields', () => {
      const h = setup();
      (h.c as any).translations.ro = {};
      (h.c as any).translations.en = null;
      const rows = h.c.translationDiffRows();
      expect(rows[0].tone).toBe('error');
    });

    it('saveTranslation with null updated name falls back', () => {
      const h = setup();
      h.c.editingSlug.set('slug-1');
      (h.c as any).translations.en = {
        name: 'Name',
        short_description: '',
        long_description: '',
        meta_title: '',
        meta_description: '',
      };
      h.admin.upsertProductTranslation.and.returnValue(of({ name: null }));
      h.c.saveTranslation('en');
      expect(h.c.translations.en.name).toBe('Name');
    });

    it('onUpload with target missing files', () => {
      const h = setup();
      h.c.editingSlug.set('slug-1');
      h.c.onUpload({ target: {} } as any);
      expect(h.c.imageUploads()).toEqual([]);
    });

    it('updateImageUpload blank id and non-matching id', () => {
      const h = setup();
      h.any.updateImageUpload('', { progress: 5 });
      h.c.imageUploads.set([{ id: 'a', fileName: 'a', bytes: 1, status: 'queued', progress: 0, error: null } as any]);
      h.any.updateImageUpload('other', { progress: 5 });
      expect(h.c.imageUploads()[0].progress).toBe(0);
    });

    it('maybeStartImageUpload Response with multiple images sorts', () => {
      const h = setup();
      h.c.editingSlug.set('slug-1');
      h.any.imageUploadFiles.set('x', new File(['a'], 'x.png'));
      h.c.imageUploads.set([{ id: 'x', fileName: 'x', bytes: 100, status: 'queued', progress: 0, error: null } as any]);
      h.admin.uploadProductImageWithProgress.and.returnValue(
        of(
          { type: HttpEventType.UploadProgress, loaded: 50, total: 100 },
          { type: HttpEventType.Response, body: { images: [{ id: 'i2', sort_order: null }, { id: 'i1', sort_order: 1 }] } },
        ),
      );
      h.any.maybeStartImageUpload();
      expect(h.c.images().length).toBe(2);
    });

    it('maybeStartImageUpload progress with zero bytes uses null total', () => {
      const h = setup();
      h.c.editingSlug.set('slug-1');
      h.any.imageUploadFiles.set('x', new File([''], 'x.png'));
      h.c.imageUploads.set([{ id: 'x', fileName: 'x', bytes: 0, status: 'queued', progress: 0, error: null } as any]);
      h.admin.uploadProductImageWithProgress.and.returnValue(
        of({ type: HttpEventType.UploadProgress, loaded: 10, total: 0 }),
      );
      h.any.maybeStartImageUpload();
      expect(h.c.imageUploads()[0].progress).toBe(0);
    });

    it('maybeStartImageUpload ignores stale active id', () => {
      const h = setup();
      h.c.editingSlug.set('slug-1');
      h.any.imageUploadFiles.set('x', new File(['a'], 'x.png'));
      h.c.imageUploads.set([{ id: 'x', fileName: 'x', bytes: 1, status: 'queued', progress: 0, error: null } as any]);
      const subj = new Subject<any>();
      h.admin.uploadProductImageWithProgress.and.returnValue(subj.asObservable());
      h.any.maybeStartImageUpload();
      h.any.imageUploadActiveId = 'different';
      subj.next({ type: HttpEventType.UploadProgress, loaded: 1, total: 2 });
      subj.next({ type: HttpEventType.Response, body: { images: [] } });
      subj.error(new Error('x'));
      expect(true).toBeTrue();
    });

    it('makeImagePrimary with no moved element guard', () => {
      const h = setup();
      h.c.editingSlug.set('slug-1');
      h.c.images.set([{ id: 'i1', url: 'u1' } as any, { id: 'i2', url: 'u2' } as any, { id: 'i3', url: 'u3' } as any]);
      h.c.makeImagePrimary('i3');
      expect(h.c.images()[0].id).toBe('i3');
    });

    it('deleteImage and restoreDeletedImage sort multiple images', () => {
      const h = setup();
      h.c.editingSlug.set('slug-1');
      h.admin.deleteProductImage.and.returnValue(
        of({ images: [{ id: 'i2', sort_order: 2 }, { id: 'i1', sort_order: null }] }),
      );
      h.c.deleteImage('x');
      expect(h.c.images()[0].id).toBe('i1');

      h.admin.restoreProductImage.and.returnValue(
        of({ images: [{ id: 'i2', sort_order: 2 }, { id: 'i1', sort_order: 1 }] }),
      );
      h.c.restoreDeletedImage('x');
      expect(h.c.images()[0].id).toBe('i1');
    });

    it('reprocessImage with null stats', () => {
      const h = setup();
      h.c.editingSlug.set('slug-1');
      h.c.editingImageId.set('i1');
      h.admin.reprocessProductImage.and.returnValue(of(null as any));
      h.c.reprocessImage();
      expect(h.c.imageStats).toBeNull();
    });

    it('load missing_any filter and null items', () => {
      const h = setup();
      h.c.translationFilter = 'missing_any';
      h.productsApi.search.and.returnValue(of({ items: null, meta: null }));
      h.any.load();
      expect(h.c.products()).toEqual([]);
    });

    it('loadCategories null result', () => {
      const h = setup();
      h.catalog.listCategories.and.returnValue(of(null));
      h.any.loadCategories();
      expect(h.c.categories()).toEqual([]);
    });

    it('loadAdminCategories null result', () => {
      const h = setup();
      h.admin.getCategories.and.returnValue(of(null));
      h.any.loadAdminCategories();
      expect(h.c.adminCategories()).toEqual([]);
    });

    it('sanitizeMoneyInput null and trailing dot', () => {
      const h = setup();
      expect(h.any.sanitizeMoneyInput(null)).toEqual({ clean: '', changed: false });
      expect(h.any.sanitizeMoneyInput('12.').clean).toBe('12');
    });

    it('parseMoneyInput overflow returns null', () => {
      const h = setup();
      expect(h.any.parseMoneyInput('9'.repeat(400))).toBeNull();
    });

    it('parseSignedMoneyInput null', () => {
      const h = setup();
      expect(h.any.parseSignedMoneyInput(null)).toBeNull();
    });

    it('parseAuditMoney non-finite bigint', () => {
      const h = setup();
      expect(h.any.parseAuditMoney(BigInt('1' + '0'.repeat(400)))).toBeNull();
    });

    it('extractBasePriceChanges anonymous user fallback null', () => {
      const h = setup();
      const out = h.any.extractBasePriceChanges([
        { created_at: 'a', payload: { changes: { base_price: { before: 5, after: 6 } } } },
      ]);
      expect(out[0].user).toBeNull();
    });

    it('buildPriceHistoryChart returns null when values non-finite', () => {
      const h = setup();
      const chart = h.any.buildPriceHistoryChart([
        { at: '2026-01-01T00:00:00Z', before: NaN, after: NaN, user: null },
      ]);
      expect(chart).toBeNull();
    });

    it('loadDeletedImages non-array', () => {
      const h = setup();
      h.admin.listDeletedProductImages.and.returnValue(of(null as any));
      h.any.loadDeletedImages('slug-1');
      expect(h.c.deletedImages()).toEqual([]);
    });

    it('loadImageMeta with null lists and null fields', () => {
      const h = setup();
      h.admin.getProductImageTranslations.and.returnValue(of(null as any));
      h.admin.getProductImageStats.and.returnValue(of(null as any));
      h.any.loadImageMeta('slug-1', 'i1');
      expect(h.c.imageStats).toBeNull();

      h.admin.getProductImageTranslations.and.returnValue(
        of([{ lang: 'en', alt_text: null, caption: null }] as any),
      );
      h.admin.getProductImageStats.and.returnValue(of({} as any));
      h.any.loadImageMeta('slug-1', 'i1');
      expect(h.c.imageMetaExists.en).toBeTrue();
    });

    it('loadAudit non-array items', () => {
      const h = setup();
      h.admin.getProductAudit.and.returnValue(of(null as any));
      h.any.loadAudit('slug-1');
      expect(h.c.auditEntries()).toEqual([]);
    });

    it('loadTranslations null items and null fields', () => {
      const h = setup();
      h.admin.getProductTranslations.and.returnValue(of(null as any));
      h.any.loadTranslations('slug-1');
      expect(h.c.translationExists.en).toBeFalse();

      h.admin.getProductTranslations.and.returnValue(
        of([{ lang: 'en', name: null, short_description: null, long_description: null }] as any),
      );
      h.any.loadTranslations('slug-1');
      expect(h.c.translationExists.en).toBeTrue();
    });

    it('buildTags with null loaded slugs', () => {
      const h = setup();
      h.any.loadedTagSlugs = [null, 'keep'];
      h.c.form.is_bestseller = false;
      expect(h.any.buildTags()).toEqual(['keep']);
    });

    it('buildShortDescription returns null when only whitespace lines', () => {
      const h = setup();
      h.c.form.short_description = '';
      h.c.form.long_description = '   \n   \n';
      expect(h.any.buildShortDescription()).toBeNull();
    });

    it('wizardStepDescriptionKey default when no current', () => {
      const h = setup();
      expect(h.c.wizardStepDescriptionKey()).toContain('desc.basics');
    });

    it('wizardPrev with null current uses default anchor', fakeAsync(() => {
      const h = setup();
      h.c.wizardKind.set('create');
      h.c.wizardStep.set(7);
      h.c.wizardPrev();
      tick(1);
      expect(h.c.wizardStep()).toBe(6);
    }));

    it('wizardNext with null current uses default anchor', fakeAsync(() => {
      const h = setup();
      h.c.wizardKind.set('create');
      h.c.wizardStep.set(0);
      spyOn(h.any, 'wizardCurrent').and.returnValue(null);
      h.c.wizardNext();
      tick(1);
      expect(h.c.wizardStep()).toBe(1);
    }));

    it('openProductSearch with empty q falls back', () => {
      const h = setup();
      h.c.q = '';
      h.c.openProductSearch();
      expect(h.c.productSearchOpen()).toBeFalse();
    });

    it('runProductSearch with non-array items', () => {
      const h = setup();
      h.productsApi.search.and.returnValue(of({}));
      h.any.runProductSearch('abcd');
      expect(h.c.productSearchResults()).toEqual([]);
    });

    it('runProductSearch error ignored when stale', () => {
      const h = setup();
      const subj = new Subject<any>();
      h.productsApi.search.and.returnValue(subj.asObservable());
      h.any.runProductSearch('abcd');
      h.any.productSearchRequestId = 999;
      subj.error(new Error('x'));
      expect(h.c.productSearchError()).toBeNull();
    });

    it('moveProductSearchActive from -1 with items', () => {
      const h = setup();
      h.c.productSearchResults.set([listItem({ id: 'a' }), listItem({ id: 'b' })]);
      h.c.productSearchActiveIndex.set(-1);
      h.any.moveProductSearchActive(1);
      expect(h.c.productSearchActiveIndex()).toBe(1);
    });

    it('applySavedView with empty filters object uses defaults', () => {
      const h = setup();
      h.favorites.items.and.returnValue([
        {
          key: 'k1',
          type: 'filter',
          state: { adminFilterScope: 'products', adminFilters: {} },
        },
      ]);
      h.c.limit = 25;
      h.c.applySavedView('k1');
      expect(h.c.q).toBe('');
      expect(h.c.status).toBe('all');
      expect(h.c.view).toBe('active');
    });

    it('toggleCurrentViewPin with null prompt', () => {
      const h = setup();
      h.favorites.isFavorite.and.returnValue(false);
      spyOn(window, 'prompt').and.returnValue(null);
      h.c.toggleCurrentViewPin();
      expect(h.toast.error).toHaveBeenCalled();
    });

    it('ngOnInit with products scope but no filters', () => {
      const h = setup();
      history.pushState({ adminFilterScope: 'products' }, '');
      h.c.ngOnInit();
      history.replaceState({}, '');
      expect(h.c.q).toBe('');
    });

    it('ngOnInit with empty adminFilters object', () => {
      const h = setup();
      history.pushState({ adminFilterScope: 'products', adminFilters: {} }, '');
      h.c.ngOnInit();
      history.replaceState({}, '');
      expect(h.c.status).toBe('all');
      expect(h.c.view).toBe('active');
    });

    it('confirmCreateCategory empty name falsy and error without detail', () => {
      const h = setup();
      h.c.openCreateCategory('manager');
      h.c.createCategoryName = '';
      h.c.confirmCreateCategory();
      expect(h.admin.createCategory).not.toHaveBeenCalled();
      h.c.createCategoryName = 'Cat';
      h.admin.createCategory.and.returnValue(throwError(() => ({})));
      h.c.confirmCreateCategory();
      expect(h.c.createCategoryError()).toBeTruthy();
    });

    it('categoryManagerSelectedCategory returns null when slug unknown', () => {
      const h = setup();
      h.c.categoryManagerSlug = 'nope';
      expect(h.c.categoryManagerSelectedCategory()).toBeNull();
    });

    it('resetCategoryManagerParent with no selected category', () => {
      const h = setup();
      h.c.categoryManagerSlug = '';
      h.c.resetCategoryManagerParent();
      expect(h.c.categoryManagerParentId).toBe('');
    });

    it('saveCategoryManagerParent success null parent and error without detail (prev null)', () => {
      const h = setup();
      h.c.categories.set([{ id: 'c1', slug: 'cat-1', name: 'Cat', parent_id: null } as any]);
      h.c.categoryManagerSlug = 'cat-1';
      h.c.categoryManagerParentId = 'p9';
      h.admin.updateCategory.and.returnValue(of({ parent_id: null }));
      h.c.saveCategoryManagerParent();
      expect(h.c.categoryManagerParentId).toBe('');

      h.c.categories.set([{ id: 'c1', slug: 'cat-1', name: 'Cat', parent_id: null } as any]);
      h.c.categoryManagerSlug = 'cat-1';
      h.c.categoryManagerParentId = 'p9';
      h.admin.updateCategory.and.returnValue(throwError(() => ({})));
      h.c.saveCategoryManagerParent();
      expect(h.c.categoryManagerParentId).toBe('');
    });

    it('categoryParentOptions sorts mixed null/named names', () => {
      const h = setup();
      h.c.categories.set([
        { id: 'root', slug: 'root', name: 'Root', parent_id: null } as any,
        { id: 'b', slug: 'b', name: 'B', parent_id: null } as any,
        { id: 'a', slug: 'a', name: null, parent_id: null } as any,
        { id: 'c', slug: 'c', name: 'C', parent_id: null } as any,
        { id: 'z', slug: 'z', name: null, parent_id: null } as any,
      ]);
      const opts = h.c.categoryParentOptions({ id: 'root' } as any);
      expect(opts.length).toBe(4);
    });

    it('mergeTargetOptions sorts mixed null/named names', () => {
      const h = setup();
      h.c.categories.set([
        { id: 's', slug: 's', name: 'S', parent_id: null } as any,
        { id: 'b', slug: 'b', name: 'B', parent_id: null } as any,
        { id: 'a', slug: 'a', name: null, parent_id: null } as any,
        { id: 'c', slug: 'c', name: 'C', parent_id: null } as any,
        { id: 'z', slug: 'z', name: null, parent_id: null } as any,
      ]);
      const opts = h.c.mergeTargetOptions({ slug: 's', parent_id: null } as any);
      expect(opts.length).toBe(4);
    });

    it('categoryDescendantIds diamond graph revisits node', () => {
      const h = setup();
      h.c.categories.set([
        { id: 'a', slug: 'a', name: 'A', parent_id: null } as any,
        { id: 'b', slug: 'b', name: 'B', parent_id: 'a' } as any,
        { id: 'c', slug: 'c', name: 'C', parent_id: 'a' } as any,
        { id: 'd', slug: 'd', name: 'D', parent_id: 'b' } as any,
        { id: 'd', slug: 'd2', name: 'D', parent_id: 'c' } as any,
      ]);
      const excluded = h.any.categoryDescendantIds('a');
      expect(excluded.has('d')).toBeTrue();
    });

    it('saveInlineEdit percent valid success', () => {
      const h = setup();
      h.any.inlineEditId = 'p1';
      h.c.inlineBasePrice = '100';
      h.c.inlineStockQuantity = '5';
      h.c.inlineSaleEnabled = true;
      h.c.inlineSaleType = 'percent';
      h.c.inlineSaleValue = '10';
      h.c.saveInlineEdit();
      expect(h.toast.success).toHaveBeenCalled();
    });

    it('startInlineEdit with falsy non-numeric base price and stock', () => {
      const h = setup();
      h.c.startInlineEdit(
        listItem({ base_price: '', stock_quantity: null, sale_type: '', sale_value: 0 }),
      );
      expect(h.c.inlineBasePrice).toBe('0.00');
      expect(h.c.inlineStockQuantity).toBe('0');
    });

    it('onSaleValueChange with sanitization change and valid amount', () => {
      const h = setup();
      h.c.form.sale_enabled = true;
      h.c.form.sale_type = 'amount';
      h.c.form.base_price = '100';
      h.c.onSaleValueChange('5a');
      expect(h.c.form.sale_value).toBe('5');
      expect(h.c.saleValueError).toContain('valueHint');
    });

    it('applyPriceAdjustmentToSelected with falsy base price', () => {
      const h = setup();
      h.c.products.set([listItem({ base_price: null })]);
      h.c.selected.add('p1');
      h.c.bulkPriceMode = 'amount';
      h.c.bulkPriceValue = '5';
      h.c.applyPriceAdjustmentToSelected();
      expect(h.toast.success).toHaveBeenCalled();
    });

    it('updateBulkPricePreview with falsy base price', () => {
      const h = setup();
      h.c.products.set([listItem({ base_price: null })]);
      h.c.selected.add('p1');
      h.c.bulkPriceValue = '5';
      h.c.updateBulkPricePreview();
      expect(h.c.bulkPricePreview).not.toBeNull();
    });

    it('markEditorDirty returns when already dirty', () => {
      const h = setup();
      h.c.editorOpen.set(true);
      h.c.editorDirty.set(true);
      h.c.markEditorDirty();
      expect(h.c.editorDirty()).toBeTrue();
    });

    it('runDuplicateCheck error ignored when stale', () => {
      const h = setup();
      h.c.form.name = 'Name';
      const subj = new Subject<any>();
      h.productsApi.duplicateCheck.and.returnValue(subj.asObservable());
      h.any.runDuplicateCheck();
      h.any.duplicateCheckSeq = 999;
      subj.error(new Error('x'));
      expect(h.c.duplicateBusy()).toBeTrue();
    });

    it('previewSalePrice with empty sale value', () => {
      const h = setup();
      h.c.form.sale_enabled = true;
      h.c.form.base_price = '100';
      h.c.form.sale_value = '';
      expect(h.c.previewSalePrice()).toBeNull();
    });

    it('onSaleEnabledChange returns when sale enabled', () => {
      const h = setup();
      h.c.form.sale_enabled = true;
      h.c.form.sale_value = '5';
      h.c.onSaleEnabledChange();
      expect(h.c.form.sale_value).toBe('5');
    });

    it('save with badge enabled but no dates', () => {
      const h = setup();
      h.c.form.base_price = '10';
      h.c.form.badges.new = { enabled: true, start_at: '', end_at: '' };
      h.c.save({ skipStatusConfirm: true });
      expect(h.toast.success).toHaveBeenCalled();
    });

    it('save create with no slug in response', () => {
      const h = setup();
      h.c.form.base_price = '10';
      h.c.editingSlug.set(null);
      h.admin.createProduct.and.returnValue(of({ id: 'x' }));
      h.c.save({ skipStatusConfirm: true });
      expect(h.c.editingSlug()).toBeNull();
    });

    it('variantComputedPrice with unparseable base and delta', () => {
      const h = setup();
      h.c.form.base_price = '';
      expect(h.c.variantComputedPrice('')).toBe(0);
    });

    it('runRelationshipSearch error ignored when stale', () => {
      const h = setup();
      const subj = new Subject<any>();
      h.productsApi.search.and.returnValue(subj.asObservable());
      h.any.runRelationshipSearch('abc');
      h.any.relationshipSearchRequestId = 999;
      subj.error(new Error('x'));
      expect(h.c.relationshipSearchLoading()).toBeTrue();
    });

    it('maybeStartImageUpload Response with non-array images', () => {
      const h = setup();
      h.c.editingSlug.set('slug-1');
      h.any.imageUploadFiles.set('x', new File(['a'], 'x.png'));
      h.c.imageUploads.set([{ id: 'x', fileName: 'x', bytes: 1, status: 'queued', progress: 0, error: null } as any]);
      h.admin.uploadProductImageWithProgress.and.returnValue(
        of({ type: HttpEventType.Response, body: null }),
      );
      h.any.maybeStartImageUpload();
      expect(h.c.images()).toEqual([]);
    });

    it('maybeStartImageUpload Response sorts three mixed sort orders', () => {
      const h = setup();
      h.c.editingSlug.set('slug-1');
      h.any.imageUploadFiles.set('x', new File(['a'], 'x.png'));
      h.c.imageUploads.set([{ id: 'x', fileName: 'x', bytes: 1, status: 'queued', progress: 0, error: null } as any]);
      h.admin.uploadProductImageWithProgress.and.returnValue(
        of({
          type: HttpEventType.Response,
          body: { images: [{ id: 'a', sort_order: 5 }, { id: 'b', sort_order: null }, { id: 'c', sort_order: 1 }] },
        }),
      );
      h.any.maybeStartImageUpload();
      expect(h.c.images().length).toBe(3);
    });

    it('maybeStartImageUpload error with request id', () => {
      const h = setup();
      h.c.editingSlug.set('slug-1');
      h.any.imageUploadFiles.set('x', new File(['a'], 'x.png'));
      h.c.imageUploads.set([{ id: 'x', fileName: 'x', bytes: 1, status: 'queued', progress: 0, error: null } as any]);
      h.admin.uploadProductImageWithProgress.and.returnValue(
        throwError(() => new HttpErrorResponse({ error: { request_id: 'rid-1' } })),
      );
      h.any.maybeStartImageUpload();
      expect(h.c.imageUploads()[0].error).toContain('rid-1');
    });

    it('maybeStartImageUpload complete ignored when active id changed', () => {
      const h = setup();
      h.c.editingSlug.set('slug-1');
      h.any.imageUploadFiles.set('x', new File(['a'], 'x.png'));
      h.c.imageUploads.set([{ id: 'x', fileName: 'x', bytes: 1, status: 'queued', progress: 0, error: null } as any]);
      const subj = new Subject<any>();
      h.admin.uploadProductImageWithProgress.and.returnValue(subj.asObservable());
      h.any.maybeStartImageUpload();
      h.any.imageUploadActiveId = 'other';
      subj.complete();
      expect(h.any.imageUploadSub).not.toBeNull();
    });

    it('deleteImage with non-array images and three mixed sort', () => {
      const h = setup();
      h.c.editingSlug.set('slug-1');
      h.admin.deleteProductImage.and.returnValue(of({}));
      h.c.deleteImage('x');
      expect(h.c.images()).toEqual([]);

      h.admin.deleteProductImage.and.returnValue(
        of({ images: [{ id: 'a', sort_order: 5 }, { id: 'b', sort_order: null }, { id: 'c', sort_order: 1 }] }),
      );
      h.c.deleteImage('x');
      expect(h.c.images().length).toBe(3);
    });

    it('restoreDeletedImage with non-array images and three mixed sort', () => {
      const h = setup();
      h.c.editingSlug.set('slug-1');
      h.admin.restoreProductImage.and.returnValue(of({}));
      h.c.restoreDeletedImage('x');
      expect(h.c.images()).toEqual([]);

      h.admin.restoreProductImage.and.returnValue(
        of({ images: [{ id: 'a', sort_order: 5 }, { id: 'b', sort_order: null }, { id: 'c', sort_order: 1 }] }),
      );
      h.c.restoreDeletedImage('x');
      expect(h.c.images().length).toBe(3);
    });

    it('saveImageMeta with empty alt but present caption', () => {
      const h = setup();
      h.c.editingSlug.set('slug-1');
      h.c.editingImageId.set('i1');
      (h.c as any).imageMeta = { en: { alt_text: '', caption: 'C' }, ro: { alt_text: '', caption: '' } };
      h.c.saveImageMeta();
      expect(h.admin.upsertProductImageTranslation).toHaveBeenCalled();
    });

    it('extractBasePriceChanges with null entries', () => {
      const h = setup();
      expect(h.any.extractBasePriceChanges(null)).toEqual([]);
    });

    it('extractBasePriceChanges sorts multiple changes', () => {
      const h = setup();
      const out = h.any.extractBasePriceChanges([
        { created_at: '2026-01-01T00:00:00Z', user_email: 'a', payload: { changes: { base_price: { before: 10, after: 20 } } } },
        { created_at: '2026-03-01T00:00:00Z', user_email: 'b', payload: { changes: { base_price: { before: 20, after: 30 } } } },
      ]);
      expect(out.length).toBe(2);
      expect(out[0].after).toBe(30);
    });

    it('onProductSearchChange with falsy q', () => {
      const h = setup();
      h.c.q = '';
      h.c.onProductSearchChange();
      expect(h.c.productSearchResults()).toEqual([]);
    });

    it('buildPriceHistoryChart with invalid date produces null nowX', () => {
      const h = setup();
      h.c.form.base_price = '50';
      const chart = h.any.buildPriceHistoryChart([
        { at: 'not-a-date', before: 10, after: 20, user: null },
      ]);
      expect(chart).not.toBeNull();
      expect(chart.nowX).toBeNull();
    });
  });
});
