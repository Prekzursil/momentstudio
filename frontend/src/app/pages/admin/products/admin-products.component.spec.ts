import { HttpErrorResponse, HttpEventType, HttpHeaders } from '@angular/common/http';
import { TestBed, fakeAsync, tick, flush } from '@angular/core/testing';
import { of, throwError, Subject } from 'rxjs';

import { AdminProductsComponent } from './admin-products.component';
import { AdminProductsService } from '../../../core/admin-products.service';
import { AdminService } from '../../../core/admin.service';
import { CatalogService } from '../../../core/catalog.service';
import { AuthService } from '../../../core/auth.service';
import { AdminRecentService } from '../../../core/admin-recent.service';
import { AdminUiPrefsService } from '../../../core/admin-ui-prefs.service';
import { MarkdownService } from '../../../core/markdown.service';
import { ToastService } from '../../../core/toast.service';
import { AdminFavoritesService } from '../../../core/admin-favorites.service';
import { TranslateService } from '@ngx-translate/core';

// Spec accesses private members/state directly to exercise every branch; `any` is intentional.
type AnyComponent = any;

interface Spies {
  productsApi: jasmine.SpyObj<AdminProductsService>;
  admin: jasmine.SpyObj<AdminService>;
  catalog: jasmine.SpyObj<CatalogService>;
  auth: jasmine.SpyObj<AuthService>;
  recent: jasmine.SpyObj<AdminRecentService>;
  uiPrefs: jasmine.SpyObj<AdminUiPrefsService>;
  markdown: jasmine.SpyObj<MarkdownService>;
  toast: jasmine.SpyObj<ToastService>;
  favorites: jasmine.SpyObj<AdminFavoritesService> & { items: jasmine.Spy };
  translate: jasmine.SpyObj<TranslateService>;
}

function listItem(overrides: Record<string, any> = {}): any {
  return {
    id: 'p1',
    slug: 'product-1',
    name: 'Product 1',
    status: 'draft',
    base_price: 10,
    currency: 'RON',
    stock_quantity: 5,
    sale_type: null,
    sale_value: null,
    ...overrides,
  };
}

function searchResponse(items: any[] = [], meta: any = null): any {
  return { items, meta: meta ?? { total: items.length, page: 1, limit: 25, pages: 1 } };
}

function makeSpies(): Spies {
  const productsApi = jasmine.createSpyObj<AdminProductsService>('AdminProductsService', [
    'search',
    'byIds',
    'restore',
    'duplicateCheck',
  ]);
  productsApi.search.and.returnValue(of(searchResponse()));
  productsApi.byIds.and.returnValue(of([]));
  productsApi.restore.and.returnValue(of(listItem()));
  productsApi.duplicateCheck.and.returnValue(
    of({ slug_base: '', suggested_slug: '', sku_matches: [], name_matches: [] } as any),
  );

  const admin = jasmine.createSpyObj<AdminService>('AdminService', [
    'getProduct',
    'createProduct',
    'updateProduct',
    'getCategories',
    'createCategory',
    'updateCategory',
    'deleteCategory',
    'mergeCategory',
    'previewMergeCategory',
    'previewDeleteCategory',
    'importCategoriesCsv',
    'exportCategoriesCsv',
    'importProductsCsv',
    'exportProductsCsv',
    'bulkUpdateProducts',
    'getProductRelationships',
    'updateProductRelationships',
    'getProductTranslations',
    'upsertProductTranslation',
    'deleteProductTranslation',
    'getProductImageTranslations',
    'upsertProductImageTranslation',
    'deleteProductImageTranslation',
    'getProductImageStats',
    'reprocessProductImage',
    'listDeletedProductImages',
    'restoreProductImage',
    'deleteProductImage',
    'reorderProductImage',
    'uploadProductImageWithProgress',
    'listStockAdjustments',
    'applyStockAdjustment',
    'exportStockAdjustmentsCsv',
    'updateProductVariants',
    'getProductAudit',
  ]);
  admin.getProduct.and.returnValue(of({ id: 'p1', slug: 'product-1' } as any));
  admin.createProduct.and.returnValue(
    of({ id: 'p1', slug: 'product-1', status: 'draft', is_active: true } as any),
  );
  admin.updateProduct.and.returnValue(
    of({ id: 'p1', slug: 'product-1', status: 'draft', is_active: true } as any),
  );
  admin.getCategories.and.returnValue(of([]));
  admin.createCategory.and.returnValue(
    of({ id: 'c1', slug: 'cat-1', name: 'Cat 1', is_visible: true } as any),
  );
  admin.updateCategory.and.returnValue(of({ parent_id: null } as any));
  admin.deleteCategory.and.returnValue(of({} as any));
  admin.mergeCategory.and.returnValue(of({} as any));
  admin.previewMergeCategory.and.returnValue(
    of({ can_merge: true, reason: null, product_count: 0 } as any),
  );
  admin.previewDeleteCategory.and.returnValue(of({ can_delete: true } as any));
  admin.importCategoriesCsv.and.returnValue(of({ errors: [] } as any));
  admin.exportCategoriesCsv.and.returnValue(of(new Blob(['a'])));
  admin.importProductsCsv.and.returnValue(of({ errors: [] } as any));
  admin.exportProductsCsv.and.returnValue(of(new Blob(['a'])));
  admin.bulkUpdateProducts.and.returnValue(of({} as any));
  admin.getProductRelationships.and.returnValue(
    of({ related_product_ids: [], upsell_product_ids: [] } as any),
  );
  admin.updateProductRelationships.and.returnValue(of({} as any));
  admin.getProductTranslations.and.returnValue(of([]));
  admin.upsertProductTranslation.and.returnValue(
    of({
      name: 'N',
      short_description: '',
      long_description: '',
      meta_title: '',
      meta_description: '',
    } as any),
  );
  admin.deleteProductTranslation.and.returnValue(of({} as any));
  admin.getProductImageTranslations.and.returnValue(of([]));
  admin.upsertProductImageTranslation.and.returnValue(of({} as any));
  admin.deleteProductImageTranslation.and.returnValue(of({} as any));
  admin.getProductImageStats.and.returnValue(of({} as any));
  admin.reprocessProductImage.and.returnValue(of({} as any));
  admin.listDeletedProductImages.and.returnValue(of([]));
  admin.restoreProductImage.and.returnValue(of({ images: [] } as any));
  admin.deleteProductImage.and.returnValue(of({ images: [] } as any));
  admin.reorderProductImage.and.returnValue(of({} as any));
  admin.uploadProductImageWithProgress.and.returnValue(
    of({ type: HttpEventType.Response, body: { images: [] } } as any),
  );
  admin.listStockAdjustments.and.returnValue(of([]));
  admin.applyStockAdjustment.and.returnValue(of({ after_quantity: 7, variant_id: null } as any));
  admin.exportStockAdjustmentsCsv.and.returnValue(of(new Blob(['a'])));
  admin.updateProductVariants.and.returnValue(of([]));
  admin.getProductAudit.and.returnValue(of([]));

  const catalog = jasmine.createSpyObj<CatalogService>('CatalogService', ['listCategories']);
  catalog.listCategories.and.returnValue(of([]));

  const auth = jasmine.createSpyObj<AuthService>('AuthService', ['user']);
  auth.user.and.returnValue({ id: 'u1' } as any);

  const recent = jasmine.createSpyObj<AdminRecentService>('AdminRecentService', ['add']);

  const uiPrefs = jasmine.createSpyObj<AdminUiPrefsService>('AdminUiPrefsService', ['setMode']);

  const markdown = jasmine.createSpyObj<MarkdownService>('MarkdownService', [
    'renderWithSanitizationReport',
  ]);
  markdown.renderWithSanitizationReport.and.returnValue({ html: '<p>x</p>', sanitized: false });

  const toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'action']);

  const favorites = jasmine.createSpyObj<AdminFavoritesService>('AdminFavoritesService', [
    'init',
    'isFavorite',
    'remove',
    'add',
    'items',
  ]) as Spies['favorites'];
  favorites.isFavorite.and.returnValue(false);
  favorites.items.and.returnValue([]);

  const translate = jasmine.createSpyObj<TranslateService>('TranslateService', ['instant']);
  translate.instant.and.callFake((key: string) => key);
  (translate as any).currentLang = 'en';

  return {
    productsApi,
    admin,
    catalog,
    auth,
    recent,
    uiPrefs,
    markdown,
    toast,
    favorites,
    translate,
  };
}

function setup(spies: Spies = makeSpies()): { component: AnyComponent; spies: Spies } {
  TestBed.configureTestingModule({
    imports: [AdminProductsComponent],
    providers: [
      { provide: AdminProductsService, useValue: spies.productsApi },
      { provide: AdminService, useValue: spies.admin },
      { provide: CatalogService, useValue: spies.catalog },
      { provide: AuthService, useValue: spies.auth },
      { provide: AdminRecentService, useValue: spies.recent },
      { provide: AdminUiPrefsService, useValue: spies.uiPrefs },
      { provide: MarkdownService, useValue: spies.markdown },
      { provide: ToastService, useValue: spies.toast },
      { provide: AdminFavoritesService, useValue: spies.favorites },
      { provide: TranslateService, useValue: spies.translate },
    ],
  }).overrideComponent(AdminProductsComponent, { set: { template: '' } });

  const fixture = TestBed.createComponent(AdminProductsComponent);
  const component = fixture.componentInstance as AnyComponent;
  return { component, spies };
}

function evt(target: Partial<HTMLInputElement> | null): Event {
  return { target, preventDefault: () => undefined, stopPropagation: () => undefined } as any;
}

describe('AdminProductsComponent', () => {
  let component: AnyComponent;
  let spies: Spies;

  beforeEach(() => {
    const created = setup();
    component = created.component;
    spies = created.spies;
  });

  it('creates with default state', () => {
    expect(component).toBeTruthy();
    expect(component.loading()).toBeTrue();
    expect(component.products()).toEqual([]);
  });

  describe('lifecycle', () => {
    it('ngOnInit loads data and applies pending edit slug from history state', () => {
      spyOnProperty(window.history, 'state', 'get').and.returnValue({
        editProductSlug: '  slug-x ',
      });
      component.ngOnInit();
      expect(spies.favorites.init).toHaveBeenCalled();
      expect(spies.catalog.listCategories).toHaveBeenCalled();
      expect(spies.admin.getCategories).toHaveBeenCalled();
      // pending editor opens after admin categories load
      expect(spies.admin.getProduct).toHaveBeenCalledWith('slug-x');
    });

    it('ngOnInit auto-starts a new product when openNewProduct is set', () => {
      spyOnProperty(window.history, 'state', 'get').and.returnValue({ openNewProduct: true });
      component.ngOnInit();
      expect(component.editorOpen()).toBeTrue();
      expect(component.editingSlug()).toBeNull();
    });

    it('ngOnInit ignores non-string editProductSlug', () => {
      spyOnProperty(window.history, 'state', 'get').and.returnValue({ editProductSlug: 123 });
      component.ngOnInit();
      expect(spies.admin.getProduct).not.toHaveBeenCalled();
    });

    it('ngOnDestroy clears timers and subscriptions', () => {
      component.productSearchDebounceHandle = 1;
      component.productSearchBlurHandle = 2;
      component.productFilterDebounceHandle = 3;
      component.duplicateCheckTimeoutId = setTimeout(() => undefined, 1000);
      component.relationshipSearchTimeout = setTimeout(() => undefined, 1000);
      component.productSearchSub = of(1).subscribe();
      component.ngOnDestroy();
      expect(component.productSearchDebounceHandle).toBeNull();
      expect(component.productSearchBlurHandle).toBeNull();
      expect(component.productFilterDebounceHandle).toBeNull();
      expect(component.duplicateCheckTimeoutId).toBeNull();
      expect(component.relationshipSearchTimeout).toBeNull();
    });
  });

  describe('table layout', () => {
    it('opens and closes the layout modal', () => {
      component.openLayoutModal();
      expect(component.layoutModalOpen()).toBeTrue();
      component.closeLayoutModal();
      expect(component.layoutModalOpen()).toBeFalse();
    });

    it('applies a table layout and toggles density both directions', () => {
      const layout = component.tableLayout();
      component.applyTableLayout({ ...layout, density: 'comfortable' });
      expect(component.tableLayout().density).toBe('comfortable');
      component.toggleDensity();
      expect(component.tableLayout().density).toBe('compact');
      expect(component.densityToggleLabelKey()).toBe(
        'adminUi.tableLayout.densityToggle.toComfortable',
      );
      component.toggleDensity();
      expect(component.tableLayout().density).toBe('comfortable');
      expect(component.densityToggleLabelKey()).toBe('adminUi.tableLayout.densityToggle.toCompact');
    });

    it('returns visible column ids, cell padding class and tracks columns', () => {
      expect(Array.isArray(component.visibleColumnIds())).toBeTrue();
      expect(typeof component.cellPaddingClass()).toBe('string');
      expect(component.trackColumnId(0, 'name')).toBe('name');
    });

    it('storage key uses auth user id, and falls back when no user', () => {
      expect(typeof component.tableLayoutStorageKey()).toBe('string');
      spies.auth.user.and.returnValue(null as any);
      expect(typeof component.tableLayoutStorageKey()).toBe('string');
    });
  });

  describe('scroll helpers', () => {
    it('scrollToBulkActions focuses the first control', fakeAsync(() => {
      const focusSpy = jasmine.createSpy('focus');
      const el = document.createElement('div');
      el.id = 'admin-products-bulk-actions';
      const button = document.createElement('button');
      (button as any).focus = focusSpy;
      el.appendChild(button);
      el.scrollIntoView = jasmine.createSpy('scrollIntoView');
      document.body.appendChild(el);
      component.scrollToBulkActions();
      tick(0);
      expect(el.scrollIntoView).toHaveBeenCalled();
      expect(focusSpy).toHaveBeenCalled();
      document.body.removeChild(el);
    }));

    it('scrollToBulkActions exits when element missing', () => {
      expect(() => component.scrollToBulkActions()).not.toThrow();
    });

    it('scrollToImagesSection scrolls to the images anchor', fakeAsync(() => {
      const el = document.createElement('div');
      el.id = 'product-wizard-images';
      el.scrollIntoView = jasmine.createSpy('scrollIntoView');
      document.body.appendChild(el);
      component.scrollToImagesSection();
      tick(0);
      expect(el.scrollIntoView).toHaveBeenCalled();
      document.body.removeChild(el);
    }));
  });

  describe('saved status helpers', () => {
    it('reflects last saved snapshot or live form', () => {
      component.lastSavedState.set({ status: 'published', isActive: true });
      expect(component.savedStatus()).toBe('published');
      expect(component.savedIsVisible()).toBeTrue();
      expect(component.successStatusLabelKey()).toBe('adminUi.status.published');
      expect(component.successVisibilityLabelKey()).toBe(
        'adminUi.products.successFeedback.visible',
      );
      component.lastSavedState.set(null);
      component.form.status = 'draft';
      component.form.is_active = false;
      expect(component.savedStatus()).toBe('draft');
      expect(component.savedIsVisible()).toBeFalse();
      expect(component.successVisibilityLabelKey()).toBe('adminUi.products.successFeedback.hidden');
    });
  });

  describe('filters', () => {
    it('applyFilters resets paging and reloads', () => {
      component.page = 4;
      component.selectedSavedViewKey = 'x';
      component.applyFilters();
      expect(component.page).toBe(1);
      expect(component.selectedSavedViewKey).toBe('');
      expect(spies.productsApi.search).toHaveBeenCalled();
    });

    it('setStatusFilter applies only when value changes', () => {
      spies.productsApi.search.calls.reset();
      component.setStatusFilter('all');
      expect(spies.productsApi.search).not.toHaveBeenCalled();
      component.setStatusFilter('draft');
      expect(component.status).toBe('draft');
      expect(spies.productsApi.search).toHaveBeenCalled();
    });

    it('resetFilters clears everything and reloads', () => {
      component.q = 'abc';
      component.status = 'draft';
      component.resetFilters();
      expect(component.q).toBe('');
      expect(component.status).toBe('all');
      expect(spies.productsApi.search).toHaveBeenCalled();
    });

    it('goToPage updates the page and reloads', () => {
      component.goToPage(3);
      expect(component.page).toBe(3);
    });
  });

  describe('saved views', () => {
    it('savedViews filters favorites scoped to products', () => {
      spies.favorites.items.and.returnValue([
        { key: 'a', type: 'filter', state: { adminFilterScope: 'products' } },
        { key: 'b', type: 'filter', state: { adminFilterScope: 'orders' } },
        { key: 'c', type: 'page' },
        null,
      ] as any);
      const views = component.savedViews();
      expect(views.length).toBe(1);
      expect(views[0].key).toBe('a');
    });

    it('applySavedView with empty key just records selection', () => {
      component.applySavedView('');
      expect(component.selectedSavedViewKey).toBe('');
    });

    it('applySavedView with missing view does nothing further', () => {
      spies.favorites.items.and.returnValue([]);
      component.applySavedView('missing');
      expect(component.selectedSavedViewKey).toBe('missing');
    });

    it('applySavedView ignores view without filters object', () => {
      spies.favorites.items.and.returnValue([
        { key: 'k', type: 'filter', state: { adminFilterScope: 'products', adminFilters: 5 } },
      ] as any);
      component.applySavedView('k');
      expect(component.q).toBe('');
    });

    it('applySavedView applies stored filters', () => {
      spies.favorites.items.and.returnValue([
        {
          key: 'k',
          type: 'filter',
          state: {
            adminFilterScope: 'products',
            adminFilters: {
              q: 'shoes',
              status: 'published',
              categorySlug: 'cat',
              translationFilter: 'missing_en',
              view: 'deleted',
              limit: 50,
            },
          },
        },
      ] as any);
      component.applySavedView('k');
      expect(component.q).toBe('shoes');
      expect(component.status).toBe('published');
      expect(component.limit).toBe(50);
      expect(component.view).toBe('deleted');
    });

    it('applySavedView keeps current limit when stored limit invalid', () => {
      component.limit = 25;
      spies.favorites.items.and.returnValue([
        {
          key: 'k',
          type: 'filter',
          state: { adminFilterScope: 'products', adminFilters: { limit: 'bad' } },
        },
      ] as any);
      component.applySavedView('k');
      expect(component.limit).toBe(25);
    });

    it('isCurrentViewPinned reflects favorites', () => {
      spies.favorites.isFavorite.and.returnValue(true);
      expect(component.isCurrentViewPinned()).toBeTrue();
    });

    it('toggleCurrentViewPin removes when already pinned', () => {
      spies.favorites.isFavorite.and.returnValue(true);
      component.selectedSavedViewKey = (component as any).currentViewFavoriteKey();
      component.toggleCurrentViewPin();
      expect(spies.favorites.remove).toHaveBeenCalled();
      expect(component.selectedSavedViewKey).toBe('');
    });

    it('toggleCurrentViewPin errors when name prompt empty', () => {
      spies.favorites.isFavorite.and.returnValue(false);
      spyOn(window, 'prompt').and.returnValue('   ');
      component.toggleCurrentViewPin();
      expect(spies.toast.error).toHaveBeenCalled();
      expect(spies.favorites.add).not.toHaveBeenCalled();
    });

    it('toggleCurrentViewPin adds a favorite when a name is provided', () => {
      spies.favorites.isFavorite.and.returnValue(false);
      spyOn(window, 'prompt').and.returnValue('My view');
      component.toggleCurrentViewPin();
      expect(spies.favorites.add).toHaveBeenCalled();
      expect(component.selectedSavedViewKey).not.toBe('');
    });

    it('toggleCurrentViewPin handles null prompt result', () => {
      spies.favorites.isFavorite.and.returnValue(false);
      spyOn(window, 'prompt').and.returnValue(null);
      component.toggleCurrentViewPin();
      expect(spies.toast.error).toHaveBeenCalled();
    });

    it('maybeApplyFiltersFromState ignores non-product scopes and bad filters', () => {
      (component as any).maybeApplyFiltersFromState({ adminFilterScope: 'orders' });
      expect(component.q).toBe('');
      (component as any).maybeApplyFiltersFromState({
        adminFilterScope: 'products',
        adminFilters: 1,
      });
      expect(component.q).toBe('');
    });

    it('maybeApplyFiltersFromState applies product filters', () => {
      (component as any).maybeApplyFiltersFromState({
        adminFilterScope: 'products',
        adminFilters: { q: 'x', status: 'draft', limit: 10 },
      });
      expect(component.q).toBe('x');
      expect(component.limit).toBe(10);
    });
  });

  describe('selection', () => {
    it('useVirtualProductsTable depends on inline edit and product count', () => {
      expect(component.useVirtualProductsTable()).toBeFalse();
      component.products.set(Array.from({ length: 101 }, (_, i) => listItem({ id: `p${i}` })));
      expect(component.useVirtualProductsTable()).toBeTrue();
      component.inlineEditId = 'p1';
      expect(component.useVirtualProductsTable()).toBeFalse();
    });

    it('trackProductId returns id', () => {
      expect(component.trackProductId(0, listItem({ id: 'z' }))).toBe('z');
    });

    it('toggleSelected adds and removes based on checkbox state', () => {
      component.products.set([listItem({ id: 'p1' })]);
      component.toggleSelected('p1', evt({ checked: true }));
      expect(component.selected.has('p1')).toBeTrue();
      component.toggleSelected('p1', evt({ checked: false }));
      expect(component.selected.has('p1')).toBeFalse();
    });

    it('toggleSelected is a no-op in deleted view', () => {
      component.view = 'deleted';
      component.toggleSelected('p1', evt({ checked: true }));
      expect(component.selected.has('p1')).toBeFalse();
    });

    it('allSelectedOnPage handles empty, deleted, and full selection', () => {
      expect(component.allSelectedOnPage()).toBeFalse();
      component.products.set([listItem({ id: 'p1' }), listItem({ id: 'p2' })]);
      expect(component.allSelectedOnPage()).toBeFalse();
      component.selected = new Set(['p1', 'p2']);
      expect(component.allSelectedOnPage()).toBeTrue();
      component.view = 'deleted';
      expect(component.allSelectedOnPage()).toBeFalse();
    });

    it('toggleSelectAll selects and clears all on the page', () => {
      component.products.set([listItem({ id: 'p1' }), listItem({ id: 'p2' })]);
      component.toggleSelectAll(evt({ checked: true }));
      expect(component.selected.size).toBe(2);
      component.toggleSelectAll(evt({ checked: false }));
      expect(component.selected.size).toBe(0);
    });

    it('toggleSelectAll is a no-op in deleted view', () => {
      component.view = 'deleted';
      component.products.set([listItem({ id: 'p1' })]);
      component.toggleSelectAll(evt({ checked: true }));
      expect(component.selected.size).toBe(0);
    });

    it('selectedProductsOnPage filters products by selection', () => {
      component.products.set([listItem({ id: 'p1' }), listItem({ id: 'p2' })]);
      component.selected = new Set(['p2']);
      expect(component.selectedProductsOnPage().map((p: any) => p.id)).toEqual(['p2']);
    });

    it('clearSelection resets selection state', () => {
      component.selected = new Set(['p1']);
      component.bulkPricePreview = { old_min: '1' } as any;
      component.clearSelection();
      expect(component.selected.size).toBe(0);
      expect(component.bulkPricePreview).toBeNull();
    });
  });
});

describe('AdminProductsComponent product search', () => {
  let component: AnyComponent;
  let spies: Spies;

  beforeEach(() => {
    const created = setup();
    component = created.component;
    spies = created.spies;
  });

  it('openProductSearch does nothing when nothing to show', () => {
    component.q = 'a';
    component.openProductSearch();
    expect(component.productSearchOpen()).toBeFalse();
  });

  it('openProductSearch opens and selects first result', () => {
    component.q = 'abc';
    component.productSearchResults.set([listItem()]);
    component.productSearchActiveIndex.set(-1);
    component.productSearchBlurHandle = 5;
    component.openProductSearch();
    expect(component.productSearchOpen()).toBeTrue();
    expect(component.productSearchActiveIndex()).toBe(0);
  });

  it('openProductSearch opens when loading even without query', () => {
    component.productSearchLoading.set(true);
    component.openProductSearch();
    expect(component.productSearchOpen()).toBeTrue();
  });

  it('onProductSearchBlur closes after delay', fakeAsync(() => {
    component.productSearchOpen.set(true);
    component.onProductSearchBlur();
    component.onProductSearchBlur();
    tick(150);
    expect(component.productSearchOpen()).toBeFalse();
    expect(component.productSearchBlurHandle).toBeNull();
  }));

  it('onProductSearchKeydown handles Escape', () => {
    component.productSearchOpen.set(true);
    component.onProductSearchKeydown({ key: 'Escape' } as KeyboardEvent);
    expect(component.productSearchOpen()).toBeFalse();
  });

  it('onProductSearchKeydown handles arrows, home, end', () => {
    component.q = 'abc';
    component.productSearchResults.set([listItem({ id: 'a' }), listItem({ id: 'b' })]);
    const prevent = () => undefined;
    component.onProductSearchKeydown({ key: 'ArrowDown', preventDefault: prevent } as any);
    expect(component.productSearchActiveIndex()).toBeGreaterThanOrEqual(0);
    component.onProductSearchKeydown({ key: 'ArrowUp', preventDefault: prevent } as any);
    component.onProductSearchKeydown({ key: 'End', preventDefault: prevent } as any);
    expect(component.productSearchActiveIndex()).toBe(1);
    component.onProductSearchKeydown({ key: 'Home', preventDefault: prevent } as any);
    expect(component.productSearchActiveIndex()).toBe(0);
  });

  it('onProductSearchKeydown ignores other keys', () => {
    component.onProductSearchKeydown({ key: 'a' } as KeyboardEvent);
    expect(component.productSearchOpen()).toBeFalse();
  });

  it('onProductSearchKeydown Enter selects active or first result', () => {
    const editSpy = spyOn(component, 'edit');
    component.productSearchResults.set([listItem({ slug: 's1' })]);
    component.productSearchActiveIndex.set(0);
    component.onProductSearchKeydown({ key: 'Enter', preventDefault: () => undefined } as any);
    expect(editSpy).toHaveBeenCalledWith('s1');
  });

  it('onProductSearchKeydown Enter with no result does nothing', () => {
    const editSpy = spyOn(component, 'edit');
    component.productSearchResults.set([]);
    component.onProductSearchKeydown({ key: 'Enter', preventDefault: () => undefined } as any);
    expect(editSpy).not.toHaveBeenCalled();
  });

  it('onProductSearchChange clears results for short query', fakeAsync(() => {
    component.q = 'a';
    component.productSearchDebounceHandle = 99;
    component.onProductSearchChange();
    tick(250);
    expect(component.productSearchResults()).toEqual([]);
    flush();
  }));

  it('onProductSearchChange schedules a search for long query', fakeAsync(() => {
    component.q = 'abcd';
    component.productSearchDebounceHandle = 5;
    component.onProductSearchChange();
    tick(250);
    expect(spies.productsApi.search).toHaveBeenCalled();
    tick(250);
    flush();
  }));

  it('runProductSearch populates results on success', fakeAsync(() => {
    component.q = 'abcd';
    spies.productsApi.search.and.returnValue(of(searchResponse([listItem()])));
    (component as any).runProductSearch('abcd');
    flush();
    expect(component.productSearchResults().length).toBe(1);
    expect(component.productSearchActiveIndex()).toBe(0);
  }));

  it('runProductSearch sets active index -1 when no items', fakeAsync(() => {
    component.q = 'abcd';
    spies.productsApi.search.and.returnValue(of({ items: null } as any));
    (component as any).runProductSearch('abcd');
    flush();
    expect(component.productSearchResults()).toEqual([]);
    expect(component.productSearchActiveIndex()).toBe(-1);
  }));

  it('runProductSearch maps translation and status filters', fakeAsync(() => {
    component.status = 'published';
    component.categorySlug = 'cat';
    component.translationFilter = 'missing_en';
    component.view = 'deleted';
    (component as any).runProductSearch('abcd');
    flush();
    const args = spies.productsApi.search.calls.mostRecent().args[0];
    expect(args.missing_translation_lang).toBe('en');
    expect(args.deleted).toBeTrue();
  }));

  it('runProductSearch handles missing_ro and missing_any', fakeAsync(() => {
    component.translationFilter = 'missing_ro';
    (component as any).runProductSearch('abcd');
    flush();
    expect(spies.productsApi.search.calls.mostRecent().args[0].missing_translation_lang).toBe('ro');
    component.translationFilter = 'missing_any';
    (component as any).runProductSearch('abcd');
    flush();
    expect(spies.productsApi.search.calls.mostRecent().args[0].missing_translations).toBeTrue();
  }));

  it('runProductSearch sets error on failure', fakeAsync(() => {
    spies.productsApi.search.and.returnValue(throwError(() => new Error('x')));
    (component as any).runProductSearch('abcd');
    flush();
    expect(component.productSearchError()).toBe('adminUi.products.errors.loadList');
  }));

  it('runProductSearch ignores stale responses', fakeAsync(() => {
    const subject = new Subject<any>();
    spies.productsApi.search.and.returnValue(subject.asObservable());
    (component as any).runProductSearch('abcd');
    (component as any).productSearchRequestId += 5;
    subject.next(searchResponse([listItem()]));
    subject.complete();
    flush();
    expect(component.productSearchResults()).toEqual([]);
  }));

  it('runProductSearch ignores stale errors', fakeAsync(() => {
    const subject = new Subject<any>();
    spies.productsApi.search.and.returnValue(subject.asObservable());
    (component as any).runProductSearch('abcd');
    (component as any).productSearchRequestId += 5;
    subject.error(new Error('x'));
    flush();
    expect(component.productSearchError()).toBeNull();
  }));

  it('productSearchActiveDescendant returns id only when open and valid', () => {
    expect(component.productSearchActiveDescendant()).toBeNull();
    component.productSearchOpen.set(true);
    component.productSearchActiveIndex.set(-1);
    expect(component.productSearchActiveDescendant()).toBeNull();
    component.productSearchResults.set([listItem()]);
    component.productSearchActiveIndex.set(0);
    expect(component.productSearchActiveDescendant()).toBe('admin-products-search-option-0');
  });

  it('selectProductSearch opens editor and stops the event', () => {
    const editSpy = spyOn(component, 'edit');
    const event = {
      preventDefault: jasmine.createSpy(),
      stopPropagation: jasmine.createSpy(),
    } as any;
    component.selectProductSearch(listItem({ slug: 's2' }), event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(editSpy).toHaveBeenCalledWith('s2');
  });

  it('selectProductSearch works without an event', () => {
    const editSpy = spyOn(component, 'edit');
    component.selectProductSearch(listItem({ slug: 's3' }));
    expect(editSpy).toHaveBeenCalledWith('s3');
  });

  it('moveProductSearchActive clamps to -1 when empty', () => {
    component.productSearchResults.set([]);
    (component as any).moveProductSearchActive(1);
    expect(component.productSearchActiveIndex()).toBe(-1);
  });

  it('setProductSearchActive scrolls active option into view', fakeAsync(() => {
    component.productSearchResults.set([listItem()]);
    const el = document.createElement('div');
    el.id = 'admin-products-search-option-0';
    el.scrollIntoView = jasmine.createSpy('scrollIntoView');
    document.body.appendChild(el);
    (component as any).setProductSearchActive(0);
    tick(0);
    expect(el.scrollIntoView).toHaveBeenCalled();
    document.body.removeChild(el);
  }));

  it('setProductSearchActive no-ops when empty', () => {
    component.productSearchResults.set([]);
    (component as any).setProductSearchActive(2);
    expect(component.productSearchActiveIndex()).toBe(-1);
  });

  it('cancelProductSearchRequest returns early without a subscription', () => {
    component.productSearchSub = null;
    expect(() => (component as any).cancelProductSearchRequest()).not.toThrow();
  });
});

describe('AdminProductsComponent bulk status and categories', () => {
  let component: AnyComponent;
  let spies: Spies;

  beforeEach(() => {
    const created = setup();
    component = created.component;
    spies = created.spies;
  });

  it('openBulkStatusConfirm requires a selection', () => {
    component.openBulkStatusConfirm();
    expect(component.bulkStatusConfirmOpen()).toBeFalse();
    component.selected = new Set(['p1']);
    component.openBulkStatusConfirm();
    expect(component.bulkStatusConfirmOpen()).toBeTrue();
    component.closeBulkStatusConfirm();
    expect(component.bulkStatusConfirmOpen()).toBeFalse();
  });

  it('confirmBulkStatusChange closes when nothing selected on page', () => {
    component.products.set([listItem({ id: 'p1' })]);
    component.selected = new Set(['other']);
    component.confirmBulkStatusChange();
    expect(spies.admin.bulkUpdateProducts).not.toHaveBeenCalled();
  });

  it('confirmBulkStatusChange succeeds and exposes undo', () => {
    component.products.set([listItem({ id: 'p1', status: 'draft' })]);
    component.selected = new Set(['p1']);
    component.bulkStatusTarget = 'published';
    let undo: () => void = () => undefined;
    spies.toast.action.and.callFake((_t: any, _l: any, cb: any) => {
      undo = cb;
    });
    component.confirmBulkStatusChange();
    expect(spies.admin.bulkUpdateProducts).toHaveBeenCalled();
    expect(component.selected.size).toBe(0);
    undo();
    expect(spies.admin.bulkUpdateProducts).toHaveBeenCalledTimes(2);
    expect(spies.toast.success).toHaveBeenCalled();
  });

  it('confirmBulkStatusChange surfaces an error', () => {
    component.products.set([listItem({ id: 'p1' })]);
    component.selected = new Set(['p1']);
    spies.admin.bulkUpdateProducts.and.returnValue(throwError(() => new Error('x')));
    component.confirmBulkStatusChange();
    expect(component.bulkError()).toBe('adminUi.products.bulk.error');
  });

  it('undoBulkStatusChange returns early for empty payload and errors', () => {
    (component as any).undoBulkStatusChange([]);
    expect(spies.admin.bulkUpdateProducts).not.toHaveBeenCalled();
    spies.admin.bulkUpdateProducts.and.returnValue(throwError(() => new Error('x')));
    (component as any).undoBulkStatusChange([{ product_id: 'p1', status: 'draft' }]);
    expect(spies.toast.error).toHaveBeenCalled();
  });

  it('openCreateCategory configures the modal and closeCreateCategory resets it', () => {
    component.openCreateCategory('filters');
    expect(component.createCategoryOpen()).toBeTrue();
    component.closeCreateCategory();
    expect(component.createCategoryOpen()).toBeFalse();
  });

  it('confirmCreateCategory ignores empty name or busy state', () => {
    component.createCategoryName = '   ';
    component.confirmCreateCategory();
    expect(spies.admin.createCategory).not.toHaveBeenCalled();
    component.createCategoryName = 'X';
    component.createCategoryBusy.set(true);
    component.confirmCreateCategory();
    expect(spies.admin.createCategory).not.toHaveBeenCalled();
  });

  it('confirmCreateCategory for product_form sets form category', () => {
    component.createCategoryName = 'New Cat';
    component.createCategoryParentId = ' parent ';
    (component as any).createCategoryContext = 'product_form';
    component.confirmCreateCategory();
    expect(component.form.category_id).toBe('c1');
    expect(spies.admin.createCategory).toHaveBeenCalledWith({
      name: 'New Cat',
      parent_id: 'parent',
    });
  });

  it('confirmCreateCategory for filters sets category slug', () => {
    component.createCategoryName = 'New Cat';
    (component as any).createCategoryContext = 'filters';
    component.confirmCreateCategory();
    expect(component.categorySlug).toBe('cat-1');
  });

  it('confirmCreateCategory for bulk_assign applies category to selection', () => {
    const applySpy = spyOn(component, 'applyCategoryToSelected');
    component.createCategoryName = 'New Cat';
    (component as any).createCategoryContext = 'bulk_assign';
    component.confirmCreateCategory();
    expect(component.bulkCategoryId).toBe('c1');
    expect(applySpy).toHaveBeenCalled();
  });

  it('confirmCreateCategory shows server error detail', () => {
    component.createCategoryName = 'New Cat';
    spies.admin.createCategory.and.returnValue(throwError(() => ({ error: { detail: 'taken' } })));
    component.confirmCreateCategory();
    expect(component.createCategoryError()).toBe('taken');
  });

  it('confirmCreateCategory shows fallback error', () => {
    component.createCategoryName = 'New Cat';
    spies.admin.createCategory.and.returnValue(throwError(() => ({})));
    component.confirmCreateCategory();
    expect(component.createCategoryError()).toBe('adminUi.categories.errors.add');
  });

  it('upsertCategoryLists adds then updates existing entries', () => {
    (component as any).upsertCategoryLists({ id: 'c1', slug: 's', name: 'A', is_visible: true });
    expect(component.categories().length).toBe(1);
    (component as any).upsertCategoryLists({ id: 'c1', slug: 's', name: 'A2', is_visible: true });
    expect(component.categories().length).toBe(1);
    expect(component.adminCategories()[0].name).toBe('A2');
  });

  it('openCategoryManager and closeCategoryManager toggle state', () => {
    component.openCategoryManager();
    expect(component.categoryManagerOpen()).toBeTrue();
    expect(spies.catalog.listCategories).toHaveBeenCalled();
    component.closeCategoryManager();
    expect(component.categoryManagerOpen()).toBeFalse();
  });

  it('openCreateCategoryFromManager closes manager then opens create', () => {
    component.openCreateCategoryFromManager();
    expect(component.categoryManagerOpen()).toBeFalse();
    expect(component.createCategoryOpen()).toBeTrue();
  });

  it('openCreateCategoryFromBulkAssign opens create modal', () => {
    component.openCreateCategoryFromBulkAssign();
    expect(component.createCategoryOpen()).toBeTrue();
  });

  it('onCategoryManagerSelect resolves the selected category parent', () => {
    component.categories.set([{ id: 'c1', slug: 'cat-1', name: 'Cat', parent_id: 'root' } as any]);
    component.onCategoryManagerSelect('cat-1');
    expect(component.categoryManagerParentId).toBe('root');
    expect(component.categoryManagerSelectedCategory()?.id).toBe('c1');
  });

  it('categoryManagerSelectedCategory returns null without a slug', () => {
    component.categoryManagerSlug = '';
    expect(component.categoryManagerSelectedCategory()).toBeNull();
  });

  it('resetCategoryManagerParent restores parent from the category', () => {
    component.categories.set([{ id: 'c1', slug: 'cat-1', name: 'Cat', parent_id: 'p' } as any]);
    component.categoryManagerSlug = 'cat-1';
    component.categoryManagerParentId = 'changed';
    component.resetCategoryManagerParent();
    expect(component.categoryManagerParentId).toBe('p');
  });

  it('saveCategoryManagerParent returns early when unchanged or no category', () => {
    component.saveCategoryManagerParent();
    expect(spies.admin.updateCategory).not.toHaveBeenCalled();
    component.categories.set([{ id: 'c1', slug: 'cat-1', name: 'Cat', parent_id: null } as any]);
    component.categoryManagerSlug = 'cat-1';
    component.categoryManagerParentId = '';
    component.saveCategoryManagerParent();
    expect(spies.admin.updateCategory).not.toHaveBeenCalled();
  });

  it('saveCategoryManagerParent updates the parent on success', () => {
    component.categories.set([{ id: 'c1', slug: 'cat-1', name: 'Cat', parent_id: null } as any]);
    component.categoryManagerSlug = 'cat-1';
    component.categoryManagerParentId = 'newparent';
    spies.admin.updateCategory.and.returnValue(of({ parent_id: 'newparent' } as any));
    component.saveCategoryManagerParent();
    expect(component.categoryManagerParentId).toBe('newparent');
    expect(spies.toast.success).toHaveBeenCalled();
  });

  it('saveCategoryManagerParent restores previous parent on error', () => {
    component.categories.set([{ id: 'c1', slug: 'cat-1', name: 'Cat', parent_id: 'old' } as any]);
    component.categoryManagerSlug = 'cat-1';
    component.categoryManagerParentId = 'newparent';
    spies.admin.updateCategory.and.returnValue(throwError(() => ({ error: { detail: 'no' } })));
    component.saveCategoryManagerParent();
    expect(component.categoryManagerUpdateError()).toBe('no');
    expect(component.categoryManagerParentId).toBe('old');
  });

  it('saveCategoryManagerParent does nothing while busy', () => {
    component.categories.set([{ id: 'c1', slug: 'cat-1', name: 'Cat', parent_id: null } as any]);
    component.categoryManagerSlug = 'cat-1';
    component.categoryManagerParentId = 'x';
    component.categoryManagerUpdateBusy.set(true);
    component.saveCategoryManagerParent();
    expect(spies.admin.updateCategory).not.toHaveBeenCalled();
  });

  it('categoryParentOptions excludes self and descendants', () => {
    component.categories.set([
      { id: 'root', slug: 'root', name: 'Root', parent_id: null } as any,
      { id: 'child', slug: 'child', name: 'Child', parent_id: 'root' } as any,
      { id: 'other', slug: 'other', name: 'Other', parent_id: null } as any,
    ]);
    const opts = component.categoryParentOptions({
      id: 'root',
      slug: 'root',
      name: 'Root',
      parent_id: null,
    } as any);
    expect(opts.map((c: any) => c.id)).toEqual(['other']);
  });

  it('mergeTargetOptions lists siblings with the same parent', () => {
    component.categories.set([
      { id: 'a', slug: 'a', name: 'A', parent_id: 'root' } as any,
      { id: 'b', slug: 'b', name: 'B', parent_id: 'root' } as any,
      { id: 'c', slug: 'c', name: 'C', parent_id: 'x' } as any,
    ]);
    const opts = component.mergeTargetOptions({
      id: 'a',
      slug: 'a',
      name: 'A',
      parent_id: 'root',
    } as any);
    expect(opts.map((c: any) => c.slug)).toEqual(['b']);
  });

  it('onMergeTargetChange clears preview and error', () => {
    component.mergePreview.set({ can_merge: true } as any);
    component.mergeError.set('x');
    component.onMergeTargetChange();
    expect(component.mergePreview()).toBeNull();
    expect(component.mergeError()).toBeNull();
  });

  it('previewCategoryMerge requires a category and target', () => {
    component.previewCategoryMerge();
    expect(spies.admin.previewMergeCategory).not.toHaveBeenCalled();
    component.categories.set([{ id: 'c1', slug: 'cat-1', name: 'Cat' } as any]);
    component.categoryManagerSlug = 'cat-1';
    component.mergeTargetSlug = '';
    component.previewCategoryMerge();
    expect(component.mergeError()).toBe('adminUi.storefront.categories.mergeSelectTarget');
  });

  it('previewCategoryMerge sets preview and reason when not allowed', () => {
    component.categories.set([{ id: 'c1', slug: 'cat-1', name: 'Cat' } as any]);
    component.categoryManagerSlug = 'cat-1';
    component.mergeTargetSlug = 'target';
    spies.admin.previewMergeCategory.and.returnValue(
      of({ can_merge: false, reason: 'same_category', product_count: 0 } as any),
    );
    component.previewCategoryMerge();
    expect(component.mergeError()).toBe('adminUi.storefront.categories.mergeReasonSame');
  });

  it('previewCategoryMerge handles request error', () => {
    component.categories.set([{ id: 'c1', slug: 'cat-1', name: 'Cat' } as any]);
    component.categoryManagerSlug = 'cat-1';
    component.mergeTargetSlug = 'target';
    spies.admin.previewMergeCategory.and.returnValue(throwError(() => new Error('x')));
    component.previewCategoryMerge();
    expect(component.mergeError()).toBe('adminUi.storefront.categories.mergePreviewError');
  });

  it('previewCategoryMerge skips while loading', () => {
    component.categories.set([{ id: 'c1', slug: 'cat-1', name: 'Cat' } as any]);
    component.categoryManagerSlug = 'cat-1';
    component.mergePreviewLoading.set(true);
    component.previewCategoryMerge();
    expect(spies.admin.previewMergeCategory).not.toHaveBeenCalled();
  });

  it('mergeCategorySelected validates target, preview and confirmation', () => {
    component.categories.set([
      { id: 'c1', slug: 'cat-1', name: 'Cat' } as any,
      { id: 'c2', slug: 'target', name: 'Target' } as any,
    ]);
    component.categoryManagerSlug = 'cat-1';
    component.mergeTargetSlug = '';
    component.mergeCategorySelected();
    expect(component.mergeError()).toBe('adminUi.storefront.categories.mergeSelectTarget');

    component.mergeTargetSlug = 'target';
    component.mergePreview.set(null);
    component.mergeCategorySelected();
    expect(component.mergeError()).toBe('adminUi.storefront.categories.mergePreviewRequired');

    component.mergePreview.set({ can_merge: false, reason: 'different_parent' } as any);
    component.mergeCategorySelected();
    expect(component.mergeError()).toBe('adminUi.storefront.categories.mergeReasonParent');

    component.mergePreview.set({ can_merge: true, product_count: 2 } as any);
    spyOn(window, 'confirm').and.returnValue(false);
    component.mergeCategorySelected();
    expect(spies.admin.mergeCategory).not.toHaveBeenCalled();
  });

  it('mergeCategorySelected merges on confirmation', () => {
    component.categories.set([
      { id: 'c1', slug: 'cat-1', name: 'Cat' } as any,
      { id: 'c2', slug: 'target', name: 'Target' } as any,
    ]);
    component.categoryManagerSlug = 'cat-1';
    component.mergeTargetSlug = 'target';
    component.mergePreview.set({ can_merge: true, product_count: 2 } as any);
    spyOn(window, 'confirm').and.returnValue(true);
    component.mergeCategorySelected();
    expect(spies.admin.mergeCategory).toHaveBeenCalledWith('cat-1', 'target');
    expect(spies.toast.success).toHaveBeenCalled();
  });

  it('mergeCategorySelected handles merge error', () => {
    component.categories.set([
      { id: 'c1', slug: 'cat-1', name: 'Cat' } as any,
      { id: 'c2', slug: 'target', name: 'Target' } as any,
    ]);
    component.categoryManagerSlug = 'cat-1';
    component.mergeTargetSlug = 'target';
    component.mergePreview.set({ can_merge: true, product_count: 1 } as any);
    spyOn(window, 'confirm').and.returnValue(true);
    spies.admin.mergeCategory.and.returnValue(throwError(() => new Error('x')));
    component.mergeCategorySelected();
    expect(component.mergeError()).toBe('adminUi.storefront.categories.mergeError');
  });

  it('mergeCategorySelected skips while saving', () => {
    component.categories.set([{ id: 'c1', slug: 'cat-1', name: 'Cat' } as any]);
    component.categoryManagerSlug = 'cat-1';
    component.mergeSaving.set(true);
    component.mergeCategorySelected();
    expect(spies.admin.mergeCategory).not.toHaveBeenCalled();
  });

  it('mergeReasonKey maps all reasons', () => {
    expect((component as any).mergeReasonKey('source_has_children')).toBe(
      'adminUi.storefront.categories.mergeReasonChildren',
    );
    expect((component as any).mergeReasonKey('other')).toBe(
      'adminUi.storefront.categories.mergeNotAllowed',
    );
  });

  it('previewCategoryDelete sets preview, not-allowed and errors', () => {
    component.previewCategoryDelete();
    expect(spies.admin.previewDeleteCategory).not.toHaveBeenCalled();
    component.categories.set([{ id: 'c1', slug: 'cat-1', name: 'Cat' } as any]);
    component.categoryManagerSlug = 'cat-1';
    spies.admin.previewDeleteCategory.and.returnValue(of({ can_delete: false } as any));
    component.previewCategoryDelete();
    expect(component.deleteError()).toBe('adminUi.storefront.categories.deleteNotAllowed');

    spies.admin.previewDeleteCategory.and.returnValue(throwError(() => new Error('x')));
    component.previewCategoryDelete();
    expect(component.deleteError()).toBe('adminUi.storefront.categories.deletePreviewError');
  });

  it('previewCategoryDelete skips while saving', () => {
    component.categories.set([{ id: 'c1', slug: 'cat-1', name: 'Cat' } as any]);
    component.categoryManagerSlug = 'cat-1';
    component.deleteSaving.set(true);
    component.previewCategoryDelete();
    expect(spies.admin.previewDeleteCategory).not.toHaveBeenCalled();
  });

  it('deleteCategorySelectedSafe validates preview and confirmation', () => {
    component.categories.set([{ id: 'c1', slug: 'cat-1', name: 'Cat' } as any]);
    component.categoryManagerSlug = 'cat-1';
    component.deletePreview.set(null);
    component.deleteCategorySelectedSafe();
    expect(component.deleteError()).toBe('adminUi.storefront.categories.deletePreviewRequired');

    component.deletePreview.set({ can_delete: false } as any);
    component.deleteCategorySelectedSafe();
    expect(component.deleteError()).toBe('adminUi.storefront.categories.deleteNotAllowed');

    component.deletePreview.set({ can_delete: true } as any);
    spyOn(window, 'confirm').and.returnValue(false);
    component.deleteCategorySelectedSafe();
    expect(spies.admin.deleteCategory).not.toHaveBeenCalled();
  });

  it('deleteCategorySelectedSafe deletes on confirmation', () => {
    component.categories.set([{ id: 'c1', slug: 'cat-1', name: 'Cat' } as any]);
    component.categoryManagerSlug = 'cat-1';
    component.deletePreview.set({ can_delete: true } as any);
    spyOn(window, 'confirm').and.returnValue(true);
    component.deleteCategorySelectedSafe();
    expect(spies.admin.deleteCategory).toHaveBeenCalledWith('cat-1');
    expect(spies.toast.success).toHaveBeenCalled();
  });

  it('deleteCategorySelectedSafe handles delete error', () => {
    component.categories.set([{ id: 'c1', slug: 'cat-1', name: 'Cat' } as any]);
    component.categoryManagerSlug = 'cat-1';
    component.deletePreview.set({ can_delete: true } as any);
    spyOn(window, 'confirm').and.returnValue(true);
    spies.admin.deleteCategory.and.returnValue(throwError(() => new Error('x')));
    component.deleteCategorySelectedSafe();
    expect(component.deleteError()).toBe('adminUi.storefront.categories.deleteError');
  });

  it('deleteCategorySelectedSafe skips when saving or no category', () => {
    component.deleteCategorySelectedSafe();
    expect(spies.admin.deleteCategory).not.toHaveBeenCalled();
    component.categories.set([{ id: 'c1', slug: 'cat-1', name: 'Cat' } as any]);
    component.categoryManagerSlug = 'cat-1';
    component.deleteSaving.set(true);
    component.deleteCategorySelectedSafe();
    expect(spies.admin.deleteCategory).not.toHaveBeenCalled();
  });

  it('refreshCategoryLists handles success and error', () => {
    spies.catalog.listCategories.and.returnValue(of([{ id: 'c1' } as any]));
    spies.admin.getCategories.and.returnValue(of([{ id: 'c1', name: 'C' } as any]));
    (component as any).refreshCategoryLists();
    expect(component.categories().length).toBe(1);
    expect(component.adminCategories().length).toBe(1);

    spies.catalog.listCategories.and.returnValue(throwError(() => new Error('x')));
    spies.admin.getCategories.and.returnValue(throwError(() => new Error('x')));
    (component as any).refreshCategoryLists();
    expect(component.categories()).toEqual([]);
    expect(component.adminCategories()).toEqual([]);
  });

  it('refreshCategoryLists tolerates nullish responses', () => {
    spies.catalog.listCategories.and.returnValue(of(null as any));
    spies.admin.getCategories.and.returnValue(of(null as any));
    (component as any).refreshCategoryLists();
    expect(component.categories()).toEqual([]);
    expect(component.adminCategories()).toEqual([]);
  });

  it('onCategoryImportFileChange picks the first file', () => {
    const file = new File(['a'], 'c.csv');
    component.onCategoryImportFileChange(evt({ files: [file] as any }));
    expect(component.categoryImportFile).toBe(file);
    component.onCategoryImportFileChange(evt({ files: [] as any }));
    expect(component.categoryImportFile).toBeNull();
  });

  it('runCategoryImport requires a file and respects busy', () => {
    component.categoryImportFile = null;
    component.runCategoryImport();
    expect(spies.admin.importCategoriesCsv).not.toHaveBeenCalled();
    component.categoryImportFile = new File(['a'], 'c.csv');
    component.categoryImportBusy.set(true);
    component.runCategoryImport();
    expect(spies.admin.importCategoriesCsv).not.toHaveBeenCalled();
  });

  it('runCategoryImport reports row errors', () => {
    component.categoryImportFile = new File(['a'], 'c.csv');
    spies.admin.importCategoriesCsv.and.returnValue(of({ errors: ['bad'] } as any));
    component.runCategoryImport();
    expect(spies.toast.error).toHaveBeenCalled();
  });

  it('runCategoryImport refreshes lists after a real import', () => {
    component.categoryImportFile = new File(['a'], 'c.csv');
    component.categoryImportDryRun = false;
    spies.admin.importCategoriesCsv.and.returnValue(of({ errors: [] } as any));
    component.runCategoryImport();
    expect(spies.toast.success).toHaveBeenCalled();
    expect(spies.catalog.listCategories).toHaveBeenCalled();
  });

  it('runCategoryImport surfaces a request error', () => {
    component.categoryImportFile = new File(['a'], 'c.csv');
    spies.admin.importCategoriesCsv.and.returnValue(
      throwError(() => ({ error: { detail: 'oops' } })),
    );
    component.runCategoryImport();
    expect(component.categoryImportError()).toBe('oops');
  });

  it('quickSetStatus skips when same status or busy', () => {
    component.quickSetStatus(listItem({ status: 'draft' }), 'draft');
    expect(spies.admin.bulkUpdateProducts).not.toHaveBeenCalled();
    component.quickStatusBusyId.set('busy');
    component.quickSetStatus(listItem({ status: 'draft' }), 'published');
    expect(spies.admin.bulkUpdateProducts).not.toHaveBeenCalled();
  });

  it('quickSetStatus updates status and offers undo', () => {
    component.selected = new Set(['p1']);
    let undo: () => void = () => undefined;
    spies.toast.action.and.callFake((_t: any, _l: any, cb: any) => {
      undo = cb;
    });
    component.quickSetStatus(listItem({ id: 'p1', status: 'draft' }), 'published');
    expect(component.selected.has('p1')).toBeFalse();
    undo();
    expect(spies.admin.bulkUpdateProducts).toHaveBeenCalledTimes(2);
  });

  it('quickSetStatus uses slug when name missing and reports error', () => {
    spies.admin.bulkUpdateProducts.and.returnValue(throwError(() => new Error('x')));
    component.quickSetStatus(listItem({ name: '', slug: 's' }), 'published');
    expect(spies.toast.error).toHaveBeenCalled();
    expect(component.quickStatusBusyId()).toBeNull();
  });

  it('undoQuickStatusChange handles success and error', () => {
    (component as any).undoQuickStatusChange('p1', 'draft');
    expect(spies.toast.success).toHaveBeenCalled();
    spies.admin.bulkUpdateProducts.and.returnValue(throwError(() => new Error('x')));
    (component as any).undoQuickStatusChange('p1', 'draft');
    expect(spies.toast.error).toHaveBeenCalled();
  });
});

describe('AdminProductsComponent bulk pricing, inline edit, csv', () => {
  let component: AnyComponent;
  let spies: Spies;

  beforeEach(() => {
    const created = setup();
    component = created.component;
    spies = created.spies;
  });

  it('setBulkSaleType/setBulkPriceMode/direction reset values', () => {
    component.setBulkSaleType('amount');
    expect(component.bulkSaleType).toBe('amount');
    expect(component.bulkSaleValue).toBe('');
    component.setBulkPriceMode('amount');
    expect(component.bulkPriceMode).toBe('amount');
    component.setBulkPriceDirection('decrease');
    expect(component.bulkPriceDirection).toBe('decrease');
  });

  it('onBulkSaleValueChange sanitizes input', () => {
    component.onBulkSaleValueChange('1a.999');
    expect(component.bulkSaleValue).toBe('1.99');
  });

  it('applySaleToSelected validates value and percent range', () => {
    component.bulkSaleValue = '';
    component.applySaleToSelected();
    expect(component.bulkError()).toBe('adminUi.products.bulk.valueRequired');
    component.bulkSaleType = 'percent';
    component.bulkSaleValue = '150';
    component.applySaleToSelected();
    expect(component.bulkError()).toBe('adminUi.products.sale.percentHint');
  });

  it('applySaleToSelected applies and reloads on success', () => {
    component.selected = new Set(['p1']);
    component.bulkSaleType = 'percent';
    component.bulkSaleValue = '10';
    component.applySaleToSelected();
    expect(spies.admin.bulkUpdateProducts).toHaveBeenCalled();
    expect(spies.toast.success).toHaveBeenCalled();
  });

  it('applySaleToSelected handles error', () => {
    component.selected = new Set(['p1']);
    component.bulkSaleValue = '10';
    spies.admin.bulkUpdateProducts.and.returnValue(throwError(() => new Error('x')));
    component.applySaleToSelected();
    expect(component.bulkError()).toBe('adminUi.products.bulk.error');
  });

  it('clearSaleForSelected succeeds and errors', () => {
    component.selected = new Set(['p1']);
    component.clearSaleForSelected();
    expect(spies.toast.success).toHaveBeenCalled();
    spies.admin.bulkUpdateProducts.and.returnValue(throwError(() => new Error('x')));
    component.clearSaleForSelected();
    expect(component.bulkError()).toBe('adminUi.products.bulk.error');
  });

  it('publishSelected succeeds and errors', () => {
    component.selected = new Set(['p1']);
    component.publishSelected();
    expect(spies.toast.success).toHaveBeenCalled();
    spies.admin.bulkUpdateProducts.and.returnValue(throwError(() => new Error('x')));
    component.publishSelected();
    expect(component.bulkError()).toBe('adminUi.products.bulk.error');
  });

  it('applyCategoryToSelected validates and applies', () => {
    component.bulkCategoryId = '';
    component.applyCategoryToSelected();
    expect(component.bulkError()).toBe('adminUi.products.bulk.category.valueRequired');
    component.selected = new Set(['p1']);
    component.bulkCategoryId = 'cat';
    component.applyCategoryToSelected();
    expect(spies.admin.bulkUpdateProducts).toHaveBeenCalled();
    spies.admin.bulkUpdateProducts.and.returnValue(throwError(() => new Error('x')));
    component.applyCategoryToSelected();
    expect(component.bulkError()).toBe('adminUi.products.bulk.error');
  });

  it('applyScheduleToSelected validates dates and ordering', () => {
    component.bulkPublishScheduledFor = 'not-a-date';
    component.applyScheduleToSelected();
    expect(component.bulkError()).toBe('adminUi.products.bulk.schedule.invalidDate');

    component.bulkPublishScheduledFor = '';
    component.bulkUnpublishScheduledFor = '';
    component.applyScheduleToSelected();
    expect(component.bulkError()).toBe('adminUi.products.bulk.schedule.valueRequired');

    component.bulkPublishScheduledFor = '2030-01-02T10:00';
    component.bulkUnpublishScheduledFor = '2030-01-01T10:00';
    component.applyScheduleToSelected();
    expect(component.bulkError()).toBe('adminUi.products.bulk.schedule.orderInvalid');
  });

  it('applyScheduleToSelected applies a valid schedule', () => {
    component.selected = new Set(['p1']);
    component.bulkPublishScheduledFor = '2030-01-01T10:00';
    component.bulkUnpublishScheduledFor = '2030-01-02T10:00';
    component.applyScheduleToSelected();
    expect(spies.admin.bulkUpdateProducts).toHaveBeenCalled();
  });

  it('applyScheduleToSelected errors on request failure', () => {
    component.selected = new Set(['p1']);
    component.bulkPublishScheduledFor = '2030-01-01T10:00';
    spies.admin.bulkUpdateProducts.and.returnValue(throwError(() => new Error('x')));
    component.applyScheduleToSelected();
    expect(component.bulkError()).toBe('adminUi.products.bulk.error');
  });

  it('clearPublishScheduleForSelected succeeds and errors', () => {
    component.selected = new Set(['p1']);
    component.clearPublishScheduleForSelected();
    expect(spies.toast.success).toHaveBeenCalled();
    spies.admin.bulkUpdateProducts.and.returnValue(throwError(() => new Error('x')));
    component.clearPublishScheduleForSelected();
    expect(component.bulkError()).toBe('adminUi.products.bulk.error');
  });

  it('clearUnpublishScheduleForSelected succeeds and errors', () => {
    component.selected = new Set(['p1']);
    component.clearUnpublishScheduleForSelected();
    expect(spies.toast.success).toHaveBeenCalled();
    spies.admin.bulkUpdateProducts.and.returnValue(throwError(() => new Error('x')));
    component.clearUnpublishScheduleForSelected();
    expect(component.bulkError()).toBe('adminUi.products.bulk.error');
  });

  it('startInlineEdit seeds inline fields from a product', () => {
    component.startInlineEdit(
      listItem({
        id: 'p1',
        base_price: 12.5,
        stock_quantity: 3,
        sale_type: 'amount',
        sale_value: 2,
      }),
    );
    expect(component.inlineEditId).toBe('p1');
    expect(component.inlineBasePrice).toBe('12.50');
    expect(component.inlineSaleEnabled).toBeTrue();
    expect(component.inlineSaleType).toBe('amount');
  });

  it('startInlineEdit handles percent sale and non-numeric price', () => {
    component.startInlineEdit(
      listItem({ base_price: 'abc', sale_type: 'percent', sale_value: 15 }),
    );
    expect(component.inlineBasePrice).toBe('0.00');
    expect(component.inlineSaleType).toBe('percent');
    expect(component.inlineSaleValue).toBe('15');
  });

  it('startInlineEdit is a no-op while busy', () => {
    component.inlineBusy.set(true);
    component.startInlineEdit(listItem({ id: 'zzz' }));
    expect(component.inlineEditId).toBeNull();
  });

  it('cancelInlineEdit clears inline state', () => {
    component.inlineEditId = 'p1';
    component.inlineBasePrice = '5';
    component.cancelInlineEdit();
    expect(component.inlineEditId).toBeNull();
    expect(component.inlineBasePrice).toBe('');
  });

  it('onInlineBasePriceChange sets format hint when sanitized', () => {
    component.onInlineBasePriceChange('1a');
    expect(component.inlineBasePriceError).toBe('adminUi.products.form.priceFormatHint');
  });

  it('onInlineStockChange validates required and integer', () => {
    component.onInlineStockChange('  ');
    expect(component.inlineStockError).toBe('adminUi.products.inline.errors.stockRequired');
    component.onInlineStockChange('-1');
    expect(component.inlineStockError).toBe('adminUi.products.inline.errors.stockInvalid');
    component.onInlineStockChange('4');
    expect(component.inlineStockError).toBe('');
  });

  it('onInlineSaleEnabledChange clears when disabling', () => {
    component.inlineSaleEnabled = false;
    component.inlineSaleValue = '5';
    component.onInlineSaleEnabledChange();
    expect(component.inlineSaleValue).toBe('');
    component.inlineSaleEnabled = true;
    component.inlineSaleValue = '9';
    component.onInlineSaleEnabledChange();
    expect(component.inlineSaleValue).toBe('9');
  });

  it('onInlineSaleTypeChange resets the value', () => {
    component.inlineSaleValue = '9';
    component.onInlineSaleTypeChange();
    expect(component.inlineSaleValue).toBe('');
  });

  it('onInlineSaleValueChange validates percent and clears when disabled', () => {
    component.inlineSaleEnabled = false;
    component.onInlineSaleValueChange('5');
    expect(component.inlineSaleError).toBe('');
    component.inlineSaleEnabled = true;
    component.inlineSaleType = 'percent';
    component.onInlineSaleValueChange('150');
    expect(component.inlineSaleError).toBe('adminUi.products.sale.percentHint');
    component.onInlineSaleValueChange('1a0');
    expect(component.inlineSaleError).toBe('adminUi.products.sale.valueHint');
  });

  it('saveInlineEdit returns early without an id', () => {
    component.inlineEditId = null;
    component.saveInlineEdit();
    expect(spies.admin.bulkUpdateProducts).not.toHaveBeenCalled();
  });

  it('saveInlineEdit validates price, stock and sale', () => {
    component.inlineEditId = 'p1';
    component.inlineBasePrice = '';
    component.saveInlineEdit();
    expect(component.inlineError).toBe('adminUi.products.form.priceFormatHint');

    component.inlineBasePrice = '10';
    component.inlineStockQuantity = '  ';
    component.saveInlineEdit();
    expect(component.inlineStockError).toBe('adminUi.products.inline.errors.stockRequired');

    component.inlineStockQuantity = '-2';
    component.saveInlineEdit();
    expect(component.inlineStockError).toBe('adminUi.products.inline.errors.stockInvalid');
  });

  it('saveInlineEdit validates amount and percent sale values', () => {
    component.inlineEditId = 'p1';
    component.inlineBasePrice = '10';
    component.inlineStockQuantity = '3';
    component.inlineSaleEnabled = true;
    component.inlineSaleType = 'amount';
    component.inlineSaleValue = '';
    component.saveInlineEdit();
    expect(component.inlineSaleError).toBe('adminUi.products.sale.valueHint');

    component.inlineSaleType = 'percent';
    component.inlineSaleValue = '200';
    component.saveInlineEdit();
    expect(component.inlineSaleError).toBe('adminUi.products.sale.percentHint');
  });

  it('saveInlineEdit submits and reloads on success', () => {
    component.inlineEditId = 'p1';
    component.inlineBasePrice = '10';
    component.inlineStockQuantity = '3';
    component.inlineSaleEnabled = true;
    component.inlineSaleType = 'amount';
    component.inlineSaleValue = '2';
    component.saveInlineEdit();
    expect(spies.admin.bulkUpdateProducts).toHaveBeenCalled();
    expect(component.inlineEditId).toBeNull();
  });

  it('saveInlineEdit handles save error', () => {
    component.inlineEditId = 'p1';
    component.inlineBasePrice = '10';
    component.inlineStockQuantity = '3';
    spies.admin.bulkUpdateProducts.and.returnValue(throwError(() => new Error('x')));
    component.saveInlineEdit();
    expect(component.inlineError).toBe('adminUi.products.inline.errors.save');
  });

  it('onBulkPriceValueChange updates preview', () => {
    component.products.set([listItem({ id: 'p1', base_price: 10 })]);
    component.selected = new Set(['p1']);
    component.bulkPriceValue = '';
    component.onBulkPriceValueChange('10');
    expect(component.bulkPricePreview).not.toBeNull();
  });

  it('applyPriceAdjustmentToSelected validates and applies percent', () => {
    component.applyPriceAdjustmentToSelected();
    expect(spies.admin.bulkUpdateProducts).not.toHaveBeenCalled();

    component.products.set([listItem({ id: 'p1', base_price: 10 })]);
    component.selected = new Set(['p1']);
    component.bulkPriceValue = '0';
    component.applyPriceAdjustmentToSelected();
    expect(component.bulkError()).toBe('adminUi.products.bulk.priceAdjust.valueRequired');

    component.bulkPriceMode = 'percent';
    component.bulkPriceValue = '10';
    component.applyPriceAdjustmentToSelected();
    expect(spies.admin.bulkUpdateProducts).toHaveBeenCalled();
  });

  it('applyPriceAdjustmentToSelected guards against negative result and errors', () => {
    component.products.set([listItem({ id: 'p1', base_price: 10 })]);
    component.selected = new Set(['p1']);
    component.bulkPriceMode = 'amount';
    component.bulkPriceDirection = 'decrease';
    component.bulkPriceValue = '50';
    component.applyPriceAdjustmentToSelected();
    expect(component.bulkError()).toBe('adminUi.products.bulk.priceAdjust.negative');

    component.bulkPriceDirection = 'increase';
    component.bulkPriceValue = '5';
    spies.admin.bulkUpdateProducts.and.returnValue(throwError(() => new Error('x')));
    component.applyPriceAdjustmentToSelected();
    expect(component.bulkError()).toBe('adminUi.products.bulk.error');
  });

  it('updateBulkPricePreview clears when no valid input', () => {
    component.products.set([listItem({ id: 'p1', base_price: 10 })]);
    component.selected = new Set(['p1']);
    component.bulkPriceValue = '0';
    component.updateBulkPricePreview();
    expect(component.bulkPricePreview).toBeNull();
  });

  it('updateBulkPricePreview computes amount preview with currency fallback', () => {
    component.products.set([
      listItem({ id: 'p1', base_price: 10, currency: '' }),
      listItem({ id: 'p2', base_price: 'bad' }),
    ]);
    component.selected = new Set(['p1', 'p2']);
    component.bulkPriceMode = 'amount';
    component.bulkPriceValue = '5';
    component.updateBulkPricePreview();
    expect(component.bulkPricePreview?.currency).toBe('RON');
  });

  it('updateBulkPricePreview returns when no finite prices', () => {
    component.products.set([listItem({ id: 'p1', base_price: 'bad' })]);
    component.selected = new Set(['p1']);
    component.bulkPriceValue = '5';
    component.updateBulkPricePreview();
    expect(component.bulkPricePreview).toBeNull();
  });

  it('exportProductsCsv downloads and handles error', () => {
    const dl = spyOn<any>(component, 'downloadBlob');
    component.exportProductsCsv();
    expect(dl).toHaveBeenCalled();
    spies.admin.exportProductsCsv.and.returnValue(throwError(() => new Error('x')));
    component.exportProductsCsv();
    expect(spies.toast.error).toHaveBeenCalled();
  });

  it('downloadCategoriesCsv handles template and error', () => {
    const dl = spyOn<any>(component, 'downloadBlob');
    component.downloadCategoriesCsv(true);
    expect(dl).toHaveBeenCalledWith(jasmine.any(Blob), 'categories-template.csv');
    component.downloadCategoriesCsv(false);
    spies.admin.exportCategoriesCsv.and.returnValue(throwError(() => new Error('x')));
    component.downloadCategoriesCsv(false);
    expect(spies.toast.error).toHaveBeenCalled();
  });

  it('csv import modal open/close and file change', () => {
    component.openCsvImport();
    expect(component.csvImportOpen()).toBeTrue();
    const file = new File(['a'], 'p.csv');
    component.onCsvImportFileChange(evt({ files: [file] as any }));
    expect(component.csvImportFile()).toBe(file);
    component.onCsvImportFileChange(evt({ files: [] as any }));
    expect(component.csvImportFile()).toBeNull();
    component.closeCsvImport();
    expect(component.csvImportOpen()).toBeFalse();
  });

  it('csvImportCanApply requires a file and a clean result', () => {
    expect(component.csvImportCanApply()).toBeFalse();
    component.csvImportFile.set(new File(['a'], 'p.csv'));
    component.csvImportResult.set({ errors: [] } as any);
    expect(component.csvImportCanApply()).toBeTrue();
  });

  it('runCsvImport requires a file', () => {
    component.csvImportFile.set(null);
    component.runCsvImport(true);
    expect(component.csvImportError()).toBe('adminUi.products.csv.errors.noFile');
  });

  it('runCsvImport dry run keeps result without reload', () => {
    component.csvImportFile.set(new File(['a'], 'p.csv'));
    component.runCsvImport(true);
    expect(component.csvImportResult()).toBeTruthy();
    expect(spies.toast.success).not.toHaveBeenCalled();
  });

  it('runCsvImport real import reloads on clean result', () => {
    component.csvImportFile.set(new File(['a'], 'p.csv'));
    component.runCsvImport(false);
    expect(spies.toast.success).toHaveBeenCalled();
  });

  it('runCsvImport surfaces error', () => {
    component.csvImportFile.set(new File(['a'], 'p.csv'));
    spies.admin.importProductsCsv.and.returnValue(throwError(() => new Error('x')));
    component.runCsvImport(false);
    expect(component.csvImportError()).toBe('adminUi.products.csv.errors.import');
  });

  it('toggleDescriptionPreview and onDescriptionChange refresh markdown', () => {
    component.toggleDescriptionPreview();
    expect(component.descriptionPreviewOpen()).toBeTrue();
    expect(spies.markdown.renderWithSanitizationReport).toHaveBeenCalled();
    component.onDescriptionChange();
    component.toggleDescriptionPreview();
    expect(component.descriptionPreviewOpen()).toBeFalse();
    component.onDescriptionChange();
  });

  it('toggleTranslationPreview and onTranslationDescriptionChange', () => {
    component.toggleTranslationPreview('en');
    expect(component.translationPreviewOpen.en).toBeTrue();
    component.onTranslationDescriptionChange('en');
    component.toggleTranslationPreview('en');
    expect(component.translationPreviewOpen.en).toBeFalse();
    component.onTranslationDescriptionChange('ro');
  });
});

describe('AdminProductsComponent editor, save and wizard', () => {
  let component: AnyComponent;
  let spies: Spies;

  beforeEach(() => {
    const created = setup();
    component = created.component;
    spies = created.spies;
  });

  it('startCreateWizard opens editor in create mode', () => {
    component.startCreateWizard();
    expect(component.editorOpen()).toBeTrue();
    expect(component.wizardKind()).toBe('create');
  });

  it('startNew seeds first admin category', () => {
    component.adminCategories.set([{ id: 'cat-x', name: 'X' }]);
    component.startNew();
    expect(component.form.category_id).toBe('cat-x');
    expect(component.editorOpen()).toBeTrue();
  });

  it('startPublishWizard requires an open editor with a slug', () => {
    component.startPublishWizard();
    expect(component.wizardKind()).toBeNull();
    component.editorOpen.set(true);
    component.editingSlug.set('s1');
    component.startPublishWizard();
    expect(component.wizardKind()).toBe('publish');
  });

  it('wizardSteps returns the relevant step set', () => {
    expect(component.wizardSteps()).toEqual([]);
    component.wizardKind.set('create');
    expect(component.wizardSteps().length).toBe(5);
    component.wizardKind.set('publish');
    expect(component.wizardSteps().length).toBe(3);
  });

  it('wizard title/description/next labels reflect state', () => {
    component.wizardKind.set('publish');
    expect(component.wizardTitleKey()).toBe('adminUi.products.wizard.publishTitle');
    component.wizardKind.set('create');
    expect(component.wizardTitleKey()).toBe('adminUi.products.wizard.createTitle');
    expect(typeof component.wizardStepDescriptionKey()).toBe('string');
    expect(component.wizardNextLabelKey()).toBe('adminUi.actions.next');
    component.wizardKind.set(null);
    expect(component.wizardNextLabelKey()).toBe('adminUi.actions.next');
    expect(component.wizardStepDescriptionKey()).toBe('adminUi.products.wizard.desc.basics');
  });

  it('wizardNextLabelKey shows done on last step', () => {
    component.wizardKind.set('publish');
    component.wizardStep.set(2);
    expect(component.wizardNextLabelKey()).toBe('adminUi.actions.done');
  });

  it('wizardCanNext gates on save step', () => {
    expect(component.wizardCanNext()).toBeFalse();
    component.wizardKind.set('create');
    component.wizardStep.set(2); // save step
    component.editingSlug.set(null);
    expect(component.wizardCanNext()).toBeFalse();
    component.editingSlug.set('s1');
    expect(component.wizardCanNext()).toBeTrue();
    component.wizardStep.set(4);
    expect(component.wizardCanNext()).toBeTrue();
  });

  it('wizardPrev decrements and clamps', () => {
    component.wizardKind.set('create');
    component.wizardStep.set(0);
    component.wizardPrev();
    expect(component.wizardStep()).toBe(0);
    component.wizardStep.set(2);
    component.wizardPrev();
    expect(component.wizardStep()).toBe(1);
  });

  it('wizardNext advances, exits at end, and blocks without save', () => {
    component.wizardNext();
    expect(component.wizardStep()).toBe(0);

    component.wizardKind.set('publish');
    component.wizardStep.set(2);
    component.wizardNext();
    expect(component.wizardKind()).toBeNull();

    component.wizardKind.set('create');
    component.wizardStep.set(2);
    component.editingSlug.set(null);
    component.wizardNext();
    expect(spies.toast.error).toHaveBeenCalled();
    expect(component.wizardStep()).toBe(2);

    component.editingSlug.set('s1');
    component.wizardNext();
    expect(component.wizardStep()).toBe(3);
  });

  it('goToWizardStep validates bounds and create save gate', () => {
    component.goToWizardStep(0);
    expect(component.wizardStep()).toBe(0);
    component.wizardKind.set('create');
    component.goToWizardStep(-1);
    component.goToWizardStep(99);
    component.editingSlug.set(null);
    component.goToWizardStep(3);
    expect(component.wizardStep()).toBe(2);
    component.editingSlug.set('s1');
    component.goToWizardStep(3);
    expect(component.wizardStep()).toBe(3);
  });

  it('wizardSave and wizardPublishNow drive save', () => {
    const saveSpy = spyOn(component, 'save');
    component.wizardSave();
    expect((component as any).wizardAdvanceAfterSave).toBeTrue();
    component.wizardPublishNow();
    expect(component.form.status).toBe('published');
    expect((component as any).wizardExitAfterPublish).toBeTrue();
    expect(saveSpy).toHaveBeenCalledTimes(2);
  });

  it('wizardForcesAdvancedOpen reflects publish step', () => {
    expect(component.wizardForcesAdvancedOpen()).toBeFalse();
    component.wizardKind.set('publish');
    component.wizardStep.set(2);
    expect(component.wizardForcesAdvancedOpen()).toBeTrue();
  });

  it('markEditorDirty and markEditorDirtyFromEvent set dirty state', () => {
    component.markEditorDirty();
    expect(component.editorDirty()).toBeFalse();
    component.editorOpen.set(true);
    component.markEditorDirty();
    expect(component.editorDirty()).toBeTrue();
    // already dirty -> early return path
    component.markEditorDirty();
    component.editorSaving.set(true);
    component.editorDirty.set(false);
    component.markEditorDirty();
    expect(component.editorDirty()).toBeFalse();
  });

  it('markEditorDirtyFromEvent ignores elements marked data-ignore-dirty', () => {
    component.editorOpen.set(true);
    const ignored = document.createElement('div');
    ignored.setAttribute('data-ignore-dirty', '');
    const child = document.createElement('span');
    ignored.appendChild(child);
    component.markEditorDirtyFromEvent({ target: child } as any);
    expect(component.editorDirty()).toBeFalse();
    const plain = document.createElement('span');
    component.markEditorDirtyFromEvent({ target: plain } as any);
    expect(component.editorDirty()).toBeTrue();
  });

  it('closeEditor confirms discard when dirty', () => {
    component.editorOpen.set(true);
    component.editorDirty.set(true);
    spyOn(window, 'confirm').and.returnValue(false);
    component.closeEditor();
    expect(component.editorOpen()).toBeTrue();
    (window.confirm as jasmine.Spy).and.returnValue(true);
    component.closeEditor();
    expect(component.editorOpen()).toBeFalse();
  });

  it('closeEditor is blocked while saving', () => {
    component.editorOpen.set(true);
    component.editorSaving.set(true);
    component.closeEditor();
    expect(component.editorOpen()).toBeTrue();
  });

  it('hasUnsavedChanges and discardUnsavedChanges', () => {
    component.editorOpen.set(true);
    component.editorDirty.set(true);
    expect(component.hasUnsavedChanges()).toBeTrue();
    component.discardUnsavedChanges();
    expect(component.editorDirty()).toBeFalse();
  });

  it('edit loads a full product into the form', fakeAsync(() => {
    spies.admin.getProduct.and.returnValue(
      of({
        id: 'p9',
        slug: 'prod-9',
        name: 'Prod 9',
        currency: 'EUR',
        base_price: 20,
        weight_grams: 100,
        width_cm: 5,
        height_cm: 6,
        depth_cm: 7,
        shipping_class: 'bulky',
        shipping_allow_locker: false,
        shipping_disallowed_couriers: ['sameday', 'fan_courier'],
        sale_type: 'amount',
        sale_value: 3,
        sale_price: 17,
        sale_start_at: '2030-01-01T00:00:00Z',
        sale_end_at: '2030-02-01T00:00:00Z',
        sale_auto_publish: true,
        stock_quantity: 9,
        low_stock_threshold: 2,
        status: 'published',
        is_active: true,
        is_featured: true,
        sku: 'SKU9',
        short_description: 'short',
        long_description: 'long',
        publish_at: '2030-03-01T00:00:00Z',
        tags: ['bestseller', { slug: 'sale' }],
        badges: [
          { badge: 'new', start_at: '2030-01-01T00:00:00Z', end_at: '2030-02-01T00:00:00Z' },
          { badge: 'bogus' },
        ],
        images: [
          { id: 'i2', url: 'u2', sort_order: 2 },
          { id: 'i1', url: 'u1', sort_order: 1 },
        ],
        variants: [{ id: 'v1', name: 'V', additional_price_delta: 1, stock_quantity: 4 }],
      } as any),
    );
    component.editingProductId.set('p9');
    component.edit('prod-9');
    flush();
    expect(component.form.name).toBe('Prod 9');
    expect(component.form.shipping_class).toBe('bulky');
    expect(component.form.is_bestseller).toBeTrue();
    expect(component.images()[0].id).toBe('i1');
    expect(spies.recent.add).toHaveBeenCalled();
  }));

  it('edit handles minimal product and load error', fakeAsync(() => {
    spies.admin.getProduct.and.returnValue(of({ slug: 'prod-x' } as any));
    component.edit('prod-x');
    flush();
    expect(component.form.shipping_class).toBe('standard');

    spies.admin.getProduct.and.returnValue(throwError(() => new Error('x')));
    component.edit('prod-y');
    flush();
    expect(component.editorError()).toBe('adminUi.products.errors.load');
  }));

  it('restoreProduct restores and reloads', () => {
    component.restoreProduct(listItem({ id: '' }));
    expect(spies.productsApi.restore).not.toHaveBeenCalled();
    component.restoreProduct(listItem({ id: 'p1' }));
    expect(spies.toast.success).toHaveBeenCalled();
    spies.productsApi.restore.and.returnValue(throwError(() => new Error('x')));
    component.restoreProduct(listItem({ id: 'p1' }));
    expect(spies.toast.error).toHaveBeenCalled();
  });

  it('refreshAudit reloads when a slug exists', () => {
    component.refreshAudit();
    expect(spies.admin.getProductAudit).not.toHaveBeenCalled();
    component.editingSlug.set('s1');
    component.refreshAudit();
    expect(spies.admin.getProductAudit).toHaveBeenCalledWith('s1', 50);
  });

  it('onNameChange and onSkuChange schedule duplicate checks', fakeAsync(() => {
    component.editorOpen.set(true);
    component.onNameChange('Name');
    expect(component.form.name).toBe('Name');
    component.onSkuChange('SKU');
    expect(component.form.sku).toBe('SKU');
    tick(450);
    flush();
    expect(spies.productsApi.duplicateCheck).toHaveBeenCalled();
  }));

  it('predictedSlug uses editing slug or suggested slug', () => {
    component.editingSlug.set('current');
    expect(component.predictedSlug()).toBe('current');
    component.editingSlug.set(null);
    component.duplicateCheck.set({ suggested_slug: 'sugg' } as any);
    expect(component.predictedSlug()).toBe('sugg');
    component.duplicateCheck.set({ suggested_slug: '   ' } as any);
    expect(component.predictedSlug()).toBeNull();
  });

  it('duplicateHasWarnings detects slug/sku/name matches', () => {
    expect(component.duplicateHasWarnings()).toBeFalse();
    component.duplicateCheck.set({ slug_base: 'a', suggested_slug: 'b' } as any);
    expect(component.duplicateHasWarnings()).toBeTrue();
    component.duplicateCheck.set({ sku_matches: [1], name_matches: [] } as any);
    expect(component.duplicateHasWarnings()).toBeTrue();
  });

  it('scheduleDuplicateCheck clears when no name or sku', fakeAsync(() => {
    component.editorOpen.set(true);
    component.form.name = '';
    component.form.sku = '';
    (component as any).scheduleDuplicateCheck();
    expect(component.duplicateCheck()).toBeNull();
    flush();
  }));

  it('scheduleDuplicateCheck no-ops when editor closed', () => {
    component.editorOpen.set(false);
    (component as any).scheduleDuplicateCheck();
    expect(spies.productsApi.duplicateCheck).not.toHaveBeenCalled();
  });

  it('runDuplicateCheck handles success, stale and error', fakeAsync(() => {
    component.editorOpen.set(true);
    component.form.name = 'N';
    spies.productsApi.duplicateCheck.and.returnValue(of({ suggested_slug: 'n' } as any));
    (component as any).runDuplicateCheck();
    flush();
    expect(component.duplicateCheck()).toEqual({ suggested_slug: 'n' } as any);

    spies.productsApi.duplicateCheck.and.returnValue(throwError(() => new Error('x')));
    (component as any).runDuplicateCheck();
    flush();
    expect(component.duplicateCheck()).toBeNull();
  }));

  it('runDuplicateCheck clears when name and sku empty', () => {
    component.form.name = '';
    component.form.sku = '';
    (component as any).runDuplicateCheck();
    expect(spies.productsApi.duplicateCheck).not.toHaveBeenCalled();
  });

  it('seo preview helpers produce display strings', () => {
    component.images.set([{ id: 'i', url: ' http://x ' } as any]);
    expect(component.seoPreviewImageUrl()).toBe(' http://x ');
    component.images.set([{ id: 'i', url: '' } as any]);
    expect(component.seoPreviewImageUrl()).toBeNull();

    component.form.name = 'Base';
    expect(component.seoPreviewName('en')).toBe('Base');
    component.translations.en.name = 'Translated';
    expect(component.seoPreviewName('en')).toBe('Translated');
    expect(component.seoPreviewTitle('en')).toBe('Translated | momentstudio');
    component.form.name = '';
    component.translations.en.name = '';
    expect(component.seoPreviewName('en')).toBe('—');
    expect(component.seoPreviewTitle('en')).toBe('—');

    expect(component.seoPreviewUrl()).toContain('/products/');
  });

  it('seoPreviewDescription truncates and falls back', () => {
    component.form.short_description = '';
    component.form.long_description = '';
    expect(component.seoPreviewDescription('en')).toBe('—');
    component.form.short_description = 'a'.repeat(200);
    expect(component.seoPreviewDescription('en').endsWith('…')).toBeTrue();
    component.form.short_description = 'brief';
    expect(component.seoPreviewDescription('en')).toBe('brief');
  });

  it('previewBasePrice and previewSalePrice compute values', () => {
    component.form.base_price = '100';
    expect(component.previewBasePrice()).toBe(100);
    component.form.sale_enabled = false;
    expect(component.previewSalePrice()).toBeNull();
    component.form.sale_enabled = true;
    component.form.sale_type = 'amount';
    component.form.sale_value = '20';
    expect(component.previewSalePrice()).toBe(80);
    component.form.sale_value = '200';
    expect(component.previewSalePrice()).toBeNull();
    component.form.sale_type = 'percent';
    component.form.sale_value = '10';
    expect(component.previewSalePrice()).toBe(90);
    component.form.sale_value = '150';
    expect(component.previewSalePrice()).toBeNull();
    component.form.sale_value = '';
    expect(component.previewSalePrice()).toBeNull();
    component.form.base_price = '0';
    component.form.sale_value = '10';
    expect(component.previewSalePrice()).toBeNull();
  });

  it('salePreviewInfo returns sale metrics or null', () => {
    component.form.base_price = '100';
    component.form.sale_enabled = true;
    component.form.sale_type = 'percent';
    component.form.sale_value = '10';
    expect(component.salePreviewInfo()).toEqual({ sale: 90, saved: 10, percent: 10 });
    component.form.sale_enabled = false;
    expect(component.salePreviewInfo()).toBeNull();
  });

  it('onBasePriceChange revalidates the sale value', () => {
    component.form.sale_enabled = true;
    component.form.sale_type = 'amount';
    component.form.sale_value = '5';
    component.onBasePriceChange('1a0');
    expect(component.basePriceError).toBe('adminUi.products.form.priceFormatHint');
  });

  it('onSaleEnabledChange/onSaleTypeChange reset sale fields', () => {
    component.form.sale_enabled = false;
    component.form.sale_value = '5';
    component.onSaleEnabledChange();
    expect(component.form.sale_value).toBe('');
    component.form.sale_value = '5';
    component.onSaleTypeChange();
    expect(component.form.sale_value).toBe('');
  });

  it('onSaleValueChange validates all branches', () => {
    component.form.sale_enabled = false;
    component.onSaleValueChange('5');
    expect(component.saleValueError).toBe('');
    component.form.sale_enabled = true;
    component.onSaleValueChange('');
    expect(component.saleValueError).toBe('');
    component.onSaleValueChange('0');
    expect(component.saleValueError).toBe('adminUi.products.sale.positiveHint');
    component.form.sale_type = 'percent';
    component.onSaleValueChange('150');
    expect(component.saleValueError).toBe('adminUi.products.sale.percentHint');
    component.form.sale_type = 'amount';
    component.form.base_price = '10';
    component.onSaleValueChange('50');
    expect(component.saleValueError).toBe('adminUi.products.sale.amountTooHighHint');
    component.onSaleValueChange('5');
    expect(component.saleValueError).toBe('');
  });

  it('status confirm modal opens, closes and confirms', () => {
    component.lastSavedState.set({ status: 'draft', isActive: true });
    component.form.status = 'published';
    (component as any).openStatusConfirm();
    expect(component.statusConfirmOpen()).toBeTrue();
    const saveSpy = spyOn(component, 'save').and.callFake((opts: any) => opts?.done?.(true));
    component.confirmStatusChange();
    expect(saveSpy).toHaveBeenCalled();
    component.closeStatusConfirm();
    expect(component.statusConfirmOpen()).toBeFalse();
  });

  it('confirmStatusChange returns early without target or while busy', () => {
    component.statusConfirmTarget.set(null);
    component.confirmStatusChange();
    expect(component.statusConfirmBusy()).toBeFalse();
    component.form.status = 'published';
    component.statusConfirmTarget.set({ status: 'draft', isActive: true });
    component.statusConfirmBusy.set(true);
    component.confirmStatusChange();
    // Busy guard means the target status is never applied to the form.
    expect(component.form.status).toBe('published');
  });

  it('openStatusConfirm returns when no last saved state', () => {
    component.lastSavedState.set(null);
    (component as any).openStatusConfirm();
    expect(component.statusConfirmOpen()).toBeFalse();
  });

  it('save prompts status confirm when status changed', () => {
    component.lastSavedState.set({ status: 'draft', isActive: true });
    component.form.status = 'published';
    const done = jasmine.createSpy('done');
    component.save({ done });
    expect(component.statusConfirmOpen()).toBeTrue();
    expect(done).toHaveBeenCalledWith(false);
  });

  it('save blocks while already saving', () => {
    component.editorSaving.set(true);
    const done = jasmine.createSpy('done');
    component.save({ skipStatusConfirm: true, done });
    expect(done).toHaveBeenCalledWith(false);
  });

  it('save validates base price', () => {
    component.form.base_price = '';
    component.save({ skipStatusConfirm: true });
    expect(component.editorError()).toBe('adminUi.products.form.priceFormatHint');
  });

  it('save validates amount sale value branches', () => {
    component.form.base_price = '10';
    component.form.sale_enabled = true;
    component.form.sale_type = 'amount';
    component.form.sale_value = '';
    component.save({ skipStatusConfirm: true });
    expect(component.editorError()).toBe('adminUi.products.sale.valueHint');
    component.form.sale_value = '0';
    component.save({ skipStatusConfirm: true });
    expect(component.editorError()).toBe('adminUi.products.sale.positiveHint');
    component.form.sale_value = '50';
    component.save({ skipStatusConfirm: true });
    expect(component.editorError()).toBe('adminUi.products.sale.amountTooHighHint');
  });

  it('save validates percent sale value', () => {
    component.form.base_price = '10';
    component.form.sale_enabled = true;
    component.form.sale_type = 'percent';
    component.form.sale_value = '150';
    component.save({ skipStatusConfirm: true });
    expect(component.editorError()).toBe('adminUi.products.sale.percentHint');
  });

  it('save validates auto-publish start, thresholds and dimensions', () => {
    component.form.base_price = '10';
    component.form.sale_enabled = true;
    component.form.sale_type = 'percent';
    component.form.sale_value = '10';
    component.form.sale_auto_publish = true;
    component.form.sale_start_at = '';
    component.save({ skipStatusConfirm: true });
    expect(component.editorError()).toBe('adminUi.products.sale.startRequired');

    component.form.sale_auto_publish = false;
    component.form.low_stock_threshold = '-1';
    component.save({ skipStatusConfirm: true });
    expect(component.editorError()).toBe('adminUi.lowStock.thresholdError');

    component.form.low_stock_threshold = '';
    component.form.weight_grams = '1.5';
    component.save({ skipStatusConfirm: true });
    expect(component.editorError()).toBe('adminUi.products.shipping.weightHint');

    component.form.weight_grams = '';
    component.form.width_cm = '-3';
    component.save({ skipStatusConfirm: true });
    expect(component.editorError()).toBe('adminUi.products.shipping.dimensionsHint');
  });

  it('save validates badge dates', () => {
    component.form.base_price = '10';
    component.form.badges.new = { enabled: true, start_at: 'bad', end_at: '' };
    component.save({ skipStatusConfirm: true });
    expect(component.editorError()).toBe('adminUi.products.badges.errors.invalidDate');

    component.form.badges.new = { enabled: true, start_at: '', end_at: 'bad' };
    component.save({ skipStatusConfirm: true });
    expect(component.editorError()).toBe('adminUi.products.badges.errors.invalidDate');

    component.form.badges.new = {
      enabled: true,
      start_at: '2030-02-01T00:00',
      end_at: '2030-01-01T00:00',
    };
    component.save({ skipStatusConfirm: true });
    expect(component.editorError()).toBe('adminUi.products.badges.errors.endBeforeStart');
  });

  it('save creates a product and advances the wizard', () => {
    component.form.base_price = '10';
    component.form.width_cm = '5';
    component.form.weight_grams = '100';
    component.form.badges.new = {
      enabled: true,
      start_at: '2030-01-01T00:00',
      end_at: '2030-02-01T00:00',
    };
    component.form.shipping_disallowed_couriers = { sameday: true, fan_courier: true };
    component.wizardKind.set('create');
    component.wizardStep.set(2);
    (component as any).wizardAdvanceAfterSave = true;
    spies.admin.createProduct.and.returnValue(
      of({
        id: 'np',
        slug: 'new-slug',
        status: 'published',
        is_active: true,
        images: [{ id: 'i', sort_order: 1 }],
        tags: [],
      } as any),
    );
    component.save({ skipStatusConfirm: true });
    expect(spies.admin.createProduct).toHaveBeenCalled();
    expect(component.editingSlug()).toBe('new-slug');
    expect(component.wizardStep()).toBe(3);
  });

  it('save updates an existing product and exits publish wizard', () => {
    component.editingSlug.set('existing');
    component.editingProductId.set('pid');
    component.form.base_price = '10';
    (component as any).wizardExitAfterPublish = true;
    component.wizardKind.set('publish');
    const done = jasmine.createSpy('done');
    component.save({ skipStatusConfirm: true, done });
    expect(spies.admin.updateProduct).toHaveBeenCalled();
    expect(done).toHaveBeenCalledWith(true);
    expect(component.wizardKind()).toBeNull();
  });

  it('save handles error', () => {
    component.form.base_price = '10';
    spies.admin.createProduct.and.returnValue(throwError(() => new Error('x')));
    const done = jasmine.createSpy('done');
    component.save({ skipStatusConfirm: true, done });
    expect(component.editorError()).toBe('adminUi.products.errors.save');
    expect(done).toHaveBeenCalledWith(false);
  });
});

describe('AdminProductsComponent variants, stock, relationships', () => {
  let component: AnyComponent;
  let spies: Spies;

  beforeEach(() => {
    const created = setup();
    component = created.component;
    spies = created.spies;
  });

  it('variantsWithIds filters persisted variants', () => {
    component.variants.set([{ id: 'v1', name: 'A' } as any, { name: 'B' } as any]);
    expect(component.variantsWithIds().length).toBe(1);
  });

  it('addVariantRow and removeVariantRow manage the list', () => {
    component.addVariantRow();
    expect(component.variants().length).toBe(1);
    const persisted = { id: 'v1', name: 'X', additional_price_delta: '0', stock_quantity: 0 };
    component.variants.set([persisted as any]);
    component.removeVariantRow(persisted as any);
    expect(component.variants().length).toBe(0);
    expect((component as any).pendingVariantDeletes.has('v1')).toBeTrue();
  });

  it('variant change handlers update rows', () => {
    component.variants.set([{ name: '', additional_price_delta: '0', stock_quantity: 0 } as any]);
    component.onVariantNameChange(0, 'Name');
    component.onVariantDeltaChange(0, '2.5');
    component.onVariantStockChange(0, '3');
    component.onVariantStockChange(0, '-1');
    expect(component.variants()[0].name).toBe('Name');
    expect(component.variants()[0].stock_quantity).toBe(0);
  });

  it('updateVariant ignores out-of-range index', () => {
    component.variants.set([]);
    (component as any).updateVariant(5, { name: 'x' });
    expect(component.variants()).toEqual([]);
  });

  it('variantComputedPrice combines base and delta', () => {
    component.form.base_price = '10';
    expect(component.variantComputedPrice('2.5')).toBe(12.5);
    expect(component.variantComputedPrice('-1')).toBe(9);
  });

  it('saveVariants requires a slug', () => {
    component.editingSlug.set(null);
    component.saveVariants();
    expect(spies.admin.updateProductVariants).not.toHaveBeenCalled();
  });

  it('saveVariants validates rows', () => {
    component.editingSlug.set('s1');
    component.variants.set([{ name: '', additional_price_delta: '0', stock_quantity: 0 } as any]);
    component.saveVariants();
    expect(component.variantsError()).toBe('adminUi.products.form.variantNameRequired');

    component.variants.set([{ name: 'A', additional_price_delta: 'x', stock_quantity: 0 } as any]);
    component.saveVariants();
    expect(component.variantsError()).toBe('adminUi.products.form.priceFormatHint');

    component.variants.set([{ name: 'A', additional_price_delta: '1', stock_quantity: -1 } as any]);
    component.saveVariants();
    expect(component.variantsError()).toBe('adminUi.products.inline.errors.stockInvalid');
  });

  it('saveVariants saves and reloads stock', () => {
    component.editingSlug.set('s1');
    component.editingProductId.set('pid');
    component.variants.set([{ name: 'A', additional_price_delta: '1', stock_quantity: 2 } as any]);
    spies.admin.updateProductVariants.and.returnValue(
      of([{ id: 'v1', name: 'A', additional_price_delta: 1, stock_quantity: 2 } as any]),
    );
    component.saveVariants();
    expect(component.variants()[0].id).toBe('v1');
    expect(spies.toast.success).toHaveBeenCalled();
  });

  it('saveVariants surfaces detail and fallback errors', () => {
    component.editingSlug.set('s1');
    component.variants.set([{ name: 'A', additional_price_delta: '1', stock_quantity: 2 } as any]);
    spies.admin.updateProductVariants.and.returnValue(
      throwError(() => ({ error: { detail: ' bad ' } })),
    );
    component.saveVariants();
    expect(component.variantsError()).toBe('bad');
    spies.admin.updateProductVariants.and.returnValue(throwError(() => ({})));
    component.saveVariants();
    expect(component.variantsError()).toBe('adminUi.products.form.variantsSaveError');
  });

  it('formatTimestamp formats and tolerates bad input', () => {
    expect(component.formatTimestamp('')).toBe('');
    expect(component.formatTimestamp('not-a-date')).toBe('not-a-date');
    expect(typeof component.formatTimestamp('2030-01-01T00:00:00Z')).toBe('string');
  });

  it('stockAdjustmentTargetLabel resolves variant or product', () => {
    component.variants.set([{ id: 'v1', name: 'Variant A' } as any]);
    expect(component.stockAdjustmentTargetLabel({ variant_id: 'v1' } as any)).toBe('Variant A');
    expect(component.stockAdjustmentTargetLabel({ variant_id: 'vX23456789' } as any)).toContain(
      'Variant',
    );
    expect(component.stockAdjustmentTargetLabel({ variant_id: null } as any)).toBe(
      'adminUi.products.form.stockLedgerTargetProduct',
    );
  });

  it('stockReasonLabel builds a translation key', () => {
    expect(component.stockReasonLabel('manual_correction')).toBe(
      'adminUi.products.form.stockReason.manual_correction',
    );
  });

  it('applyStockAdjustment requires a product id and valid delta', () => {
    component.editingProductId.set(null);
    component.applyStockAdjustment();
    expect(spies.admin.applyStockAdjustment).not.toHaveBeenCalled();
    component.editingProductId.set('pid');
    component.stockAdjustDelta = '0';
    component.applyStockAdjustment();
    expect(component.stockAdjustmentsError()).toBe('adminUi.products.form.stockLedgerDeltaInvalid');
  });

  it('applyStockAdjustment applies to product and variant', () => {
    component.editingProductId.set('pid');
    component.stockAdjustDelta = '5';
    component.applyStockAdjustment();
    expect(component.form.stock_quantity).toBe(7);

    component.variants.set([
      { id: 'v1', name: 'A', additional_price_delta: '0', stock_quantity: 1 } as any,
    ]);
    spies.admin.applyStockAdjustment.and.returnValue(
      of({ after_quantity: 9, variant_id: 'v1' } as any),
    );
    component.stockAdjustTarget = 'v1';
    component.stockAdjustDelta = '3';
    component.applyStockAdjustment();
    expect(component.variants()[0].stock_quantity).toBe(9);
  });

  it('applyStockAdjustment surfaces detail and fallback errors', () => {
    component.editingProductId.set('pid');
    component.stockAdjustDelta = '5';
    spies.admin.applyStockAdjustment.and.returnValue(
      throwError(() => ({ error: { detail: ' nope ' } })),
    );
    component.applyStockAdjustment();
    expect(component.stockAdjustmentsError()).toBe('nope');
    spies.admin.applyStockAdjustment.and.returnValue(throwError(() => ({})));
    component.applyStockAdjustment();
    expect(component.stockAdjustmentsError()).toBe('adminUi.products.form.stockLedgerApplyError');
  });

  it('loadStockAdjustments handles success and error', () => {
    (component as any).loadStockAdjustments('pid');
    expect(component.stockAdjustments()).toEqual([]);
    spies.admin.listStockAdjustments.and.returnValue(throwError(() => new Error('x')));
    (component as any).loadStockAdjustments('pid');
    expect(component.stockAdjustmentsError()).toBe('adminUi.products.form.stockLedgerLoadError');
  });

  it('exportStockLedgerCsv requires id and not already exporting', () => {
    component.editingProductId.set(null);
    component.exportStockLedgerCsv();
    expect(spies.admin.exportStockAdjustmentsCsv).not.toHaveBeenCalled();
    component.editingProductId.set('pid');
    component.stockLedgerExporting.set(true);
    component.exportStockLedgerCsv();
    expect(spies.admin.exportStockAdjustmentsCsv).not.toHaveBeenCalled();
  });

  it('exportStockLedgerCsv downloads with filters and handles error', () => {
    component.editingProductId.set('product-id-12345678');
    component.editingSlug.set('my-slug');
    component.stockLedgerExportFrom = '2030-01-01';
    component.stockLedgerExportTo = '2030-02-01';
    component.stockLedgerExportReason = 'manual_correction';
    const created = spyOn(URL, 'createObjectURL').and.returnValue('blob:x');
    const revoked = spyOn(URL, 'revokeObjectURL');
    const clickSpy = jasmine.createSpy('click');
    spyOn(document, 'createElement').and.returnValue({ click: clickSpy } as any);
    component.exportStockLedgerCsv();
    expect(created).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(revoked).toHaveBeenCalled();
    expect(spies.toast.success).toHaveBeenCalled();

    spies.admin.exportStockAdjustmentsCsv.and.returnValue(throwError(() => new Error('x')));
    component.exportStockLedgerCsv();
    expect(component.stockLedgerExportError()).toBe('adminUi.products.form.stockLedgerExportError');
  });

  it('exportStockLedgerCsv falls back to product id when no slug', () => {
    component.editingProductId.set('abcdefgh12345');
    component.editingSlug.set('');
    component.stockLedgerExportReason = 'all';
    spyOn(URL, 'createObjectURL').and.returnValue('blob:x');
    spyOn(URL, 'revokeObjectURL');
    spyOn(document, 'createElement').and.returnValue({ click: () => undefined } as any);
    component.exportStockLedgerCsv();
    expect(spies.admin.exportStockAdjustmentsCsv).toHaveBeenCalled();
  });

  it('relationship search debounces and filters', fakeAsync(() => {
    component.editingProductId.set('pid');
    component.onRelationshipSearchChange('a');
    expect(component.relationshipSearchResults()).toEqual([]);
    spies.productsApi.search.and.returnValue(
      of(searchResponse([listItem({ id: 'pid' }), listItem({ id: 'r1' })])),
    );
    component.onRelationshipSearchChange('abc');
    tick(250);
    flush();
    expect(component.relationshipSearchResults().map((p: any) => p.id)).toEqual(['r1']);
  }));

  it('runRelationshipSearch handles errors and stale responses', fakeAsync(() => {
    spies.productsApi.search.and.returnValue(throwError(() => new Error('x')));
    (component as any).runRelationshipSearch('abc');
    flush();
    expect(component.relationshipSearchResults()).toEqual([]);

    const subject = new Subject<any>();
    spies.productsApi.search.and.returnValue(subject.asObservable());
    (component as any).runRelationshipSearch('abc');
    (component as any).relationshipSearchRequestId += 5;
    subject.next(searchResponse([listItem({ id: 'z' })]));
    subject.complete();
    flush();
    expect(component.relationshipSearchResults()).toEqual([]);
  }));

  it('addRelationship and removeRelationship manage related and upsell', () => {
    component.editingProductId.set('pid');
    component.addRelationship(listItem({ id: '' }), 'related');
    expect(component.relationshipsRelatedIds()).toEqual([]);
    component.addRelationship(listItem({ id: 'pid' }), 'related');
    expect(component.relationshipsRelatedIds()).toEqual([]);
    component.relationshipSearchResults.set([listItem({ id: 'r1' })]);
    component.addRelationship(listItem({ id: 'r1' }), 'related');
    expect(component.relationshipsRelatedIds()).toEqual(['r1']);
    component.addRelationship(listItem({ id: 'r1' }), 'related');
    expect(component.relationshipsRelatedIds().length).toBe(1);
    component.addRelationship(listItem({ id: 'u1' }), 'upsell');
    expect(component.relationshipsUpsellIds()).toEqual(['u1']);
    component.removeRelationship('r1', 'related');
    expect(component.relationshipsRelatedIds()).toEqual([]);
    component.removeRelationship('u1', 'upsell');
    expect(component.relationshipsUpsellIds()).toEqual([]);
  });

  it('moveRelationship reorders entries', () => {
    component.relationshipsRelatedIds.set(['a', 'b']);
    component.relationshipsRelated.set([listItem({ id: 'a' }), listItem({ id: 'b' })]);
    component.moveRelationship('related', 0, 1);
    expect(component.relationshipsRelatedIds()).toEqual(['b', 'a']);
    component.moveRelationship('related', 0, -1);
    expect(component.relationshipsRelatedIds()).toEqual(['b', 'a']);
    component.relationshipsUpsellIds.set(['x', 'y']);
    component.relationshipsUpsells.set([listItem({ id: 'x' }), listItem({ id: 'y' })]);
    component.moveRelationship('upsell', 1, -1);
    expect(component.relationshipsUpsellIds()).toEqual(['y', 'x']);
    component.moveRelationship('related', 5, 1);
    expect(component.relationshipsRelatedIds()).toEqual(['b', 'a']);
  });

  it('loadRelationships loads ids and resolves products', () => {
    component.editingProductId.set('pid');
    spies.admin.getProductRelationships.and.returnValue(
      of({ related_product_ids: ['r1'], upsell_product_ids: ['r1', 'u1'] } as any),
    );
    spies.productsApi.byIds.and.returnValue(of([listItem({ id: 'r1' }), listItem({ id: 'u1' })]));
    (component as any).loadRelationships('s1');
    expect(component.relationshipsRelated().length).toBe(1);
    expect(component.relationshipsUpsells().map((p: any) => p.id)).toEqual(['u1']);
  });

  it('loadRelationships handles empty ids and errors', () => {
    (component as any).loadRelationships('');
    expect(spies.admin.getProductRelationships).not.toHaveBeenCalled();

    (component as any).loadRelationships('s1');
    expect(component.relationshipsRelated()).toEqual([]);

    spies.admin.getProductRelationships.and.returnValue(
      of({ related_product_ids: ['r1'], upsell_product_ids: [] } as any),
    );
    spies.productsApi.byIds.and.returnValue(throwError(() => new Error('x')));
    (component as any).loadRelationships('s1');
    expect(component.relationshipsError()).toBe('adminUi.products.relationships.errors.load');

    spies.admin.getProductRelationships.and.returnValue(throwError(() => new Error('x')));
    (component as any).loadRelationships('s1');
    expect(component.relationshipsError()).toBe('adminUi.products.relationships.errors.load');
  });

  it('saveRelationships requires a slug then saves', () => {
    component.editingSlug.set(null);
    component.saveRelationships();
    expect(spies.toast.error).toHaveBeenCalled();
    component.editingSlug.set('s1');
    component.saveRelationships();
    expect(spies.admin.updateProductRelationships).toHaveBeenCalled();
    // On success the component reloads relationships (which resets the transient
    // message), so we assert the success toast fired with the expected key.
    expect(spies.toast.success).toHaveBeenCalledWith('adminUi.products.relationships.success.save');
    spies.admin.updateProductRelationships.and.returnValue(throwError(() => new Error('x')));
    component.saveRelationships();
    expect(component.relationshipsError()).toBe('adminUi.products.relationships.errors.save');
  });

  it('translationDiffRows reports statuses for each field', () => {
    component.translations.ro = {
      name: 'Nume',
      short_description: '',
      long_description: 'Same',
    } as any;
    component.translations.en = {
      name: '',
      short_description: '',
      long_description: 'Same',
    } as any;
    const rows = component.translationDiffRows();
    expect(rows.find((r: any) => r.field === 'name').statusKey).toContain('missingEn');
    expect(rows.find((r: any) => r.field === 'short_description').statusKey).toContain(
      'missingBoth',
    );
    expect(rows.find((r: any) => r.field === 'long_description').statusKey).toContain('same');
    expect(component.trackByTranslationDiffRow(0, rows[0])).toBe('name');
  });

  it('translationDiffRows flags missing ro and different content', () => {
    component.translations.ro = { name: '', short_description: 'x', long_description: 'a' } as any;
    component.translations.en = {
      name: 'EN',
      short_description: 'y',
      long_description: 'b',
    } as any;
    const rows = component.translationDiffRows();
    expect(rows.find((r: any) => r.field === 'name').statusKey).toContain('missingRo');
    expect(rows.find((r: any) => r.field === 'long_description').statusKey).toContain('different');
  });

  it('saveTranslation requires slug and name', () => {
    component.editingSlug.set(null);
    component.saveTranslation('en');
    expect(spies.admin.upsertProductTranslation).not.toHaveBeenCalled();
    component.editingSlug.set('s1');
    component.translations.en.name = '';
    component.saveTranslation('en');
    expect(spies.toast.error).toHaveBeenCalled();
  });

  it('saveTranslation persists translation and handles error', () => {
    component.editingSlug.set('s1');
    component.translations.en = {
      name: 'Name',
      short_description: 'a'.repeat(300),
      long_description: 'long',
    } as any;
    component.saveTranslation('en');
    expect(component.translationExists.en).toBeTrue();
    spies.admin.upsertProductTranslation.and.returnValue(throwError(() => new Error('x')));
    component.saveTranslation('en');
    expect(component.translationError()).toBe('adminUi.products.translations.errors.save');
  });

  it('deleteTranslation requires slug then clears', () => {
    component.editingSlug.set(null);
    component.deleteTranslation('en');
    expect(spies.admin.deleteProductTranslation).not.toHaveBeenCalled();
    component.editingSlug.set('s1');
    component.translationExists.en = true;
    component.deleteTranslation('en');
    expect(component.translationExists.en).toBeFalse();
    spies.admin.deleteProductTranslation.and.returnValue(throwError(() => new Error('x')));
    component.deleteTranslation('en');
    expect(component.translationError()).toBe('adminUi.products.translations.errors.delete');
  });
});

describe('AdminProductsComponent images, audit, load and helpers', () => {
  let component: AnyComponent;
  let spies: Spies;

  beforeEach(() => {
    const created = setup();
    component = created.component;
    spies = created.spies;
  });

  it('retryImageUpload requeues a known file', () => {
    component.retryImageUpload('  ');
    component.retryImageUpload('missing');
    (component as any).imageUploadFiles.set('u1', new File(['a'], 'a.png'));
    component.imageUploads.set([
      { id: 'u1', fileName: 'a.png', bytes: 1, status: 'error', progress: 0, error: 'x' } as any,
    ]);
    component.editingSlug.set('s1');
    component.retryImageUpload('u1');
    expect(component.imageUploads()[0].status).not.toBe('error');
  });

  it('retryImageUpload skips the active upload', () => {
    (component as any).imageUploadActiveId = 'u1';
    (component as any).imageUploadFiles.set('u1', new File(['a'], 'a.png'));
    component.imageUploads.set([
      {
        id: 'u1',
        fileName: 'a.png',
        bytes: 1,
        status: 'uploading',
        progress: 0,
        error: null,
      } as any,
    ]);
    component.retryImageUpload('u1');
    expect(component.imageUploads()[0].status).toBe('uploading');
  });

  it('removeImageUpload removes a queued item but not the active one', () => {
    (component as any).imageUploadFiles.set('u1', new File(['a'], 'a.png'));
    component.imageUploads.set([
      { id: 'u1', fileName: 'a.png', bytes: 1, status: 'queued', progress: 0, error: null } as any,
    ]);
    component.removeImageUpload('  ');
    component.removeImageUpload('u1');
    expect(component.imageUploads()).toEqual([]);
    (component as any).imageUploadActiveId = 'u2';
    component.imageUploads.set([
      {
        id: 'u2',
        fileName: 'b.png',
        bytes: 1,
        status: 'uploading',
        progress: 0,
        error: null,
      } as any,
    ]);
    component.removeImageUpload('u2');
    expect(component.imageUploads().length).toBe(1);
  });

  it('onUpload requires a slug', () => {
    const value = { value: 'x' };
    component.editingSlug.set(null);
    component.onUpload(evt({ files: [new File(['a'], 'a.png')] as any, ...value } as any));
    expect(spies.toast.error).toHaveBeenCalled();
  });

  it('onUpload ignores empty file lists', () => {
    component.onUpload(evt({ files: [] as any }));
    expect(component.imageUploads()).toEqual([]);
  });

  it('onUpload queues files and starts upload', () => {
    component.editingSlug.set('s1');
    const target = { files: [new File(['a'], 'a.png')], value: 'x' };
    component.onUpload({ target } as any);
    expect(component.imageUploads().length).toBe(1);
    expect(spies.admin.uploadProductImageWithProgress).toHaveBeenCalled();
  });

  it('maybeStartImageUpload handles progress and response events', () => {
    component.editingSlug.set('s1');
    (component as any).imageUploadFiles.set('u1', new File(['a'], 'a.png'));
    component.imageUploads.set([
      {
        id: 'u1',
        fileName: 'a.png',
        bytes: 200,
        status: 'queued',
        progress: 0,
        error: null,
      } as any,
    ]);
    spies.admin.uploadProductImageWithProgress.and.returnValue(
      of(
        { type: HttpEventType.UploadProgress, loaded: 50, total: 100 } as any,
        {
          type: HttpEventType.Response,
          body: { images: [{ id: 'i1', sort_order: 1 }] },
        } as any,
      ),
    );
    (component as any).maybeStartImageUpload();
    expect(component.images().length).toBe(1);
    expect(component.imageUploads()[0].status).toBe('success');
  });

  it('maybeStartImageUpload uses item bytes when total missing', () => {
    component.editingSlug.set('s1');
    (component as any).imageUploadFiles.set('u1', new File(['a'], 'a.png'));
    component.imageUploads.set([
      {
        id: 'u1',
        fileName: 'a.png',
        bytes: 100,
        status: 'queued',
        progress: 0,
        error: null,
      } as any,
    ]);
    spies.admin.uploadProductImageWithProgress.and.returnValue(
      of({ type: HttpEventType.UploadProgress, loaded: 50, total: 0 } as any),
    );
    (component as any).maybeStartImageUpload();
    expect(component.imageUploads()[0].progress).toBeGreaterThan(0);
  });

  it('maybeStartImageUpload errors when the file is gone', () => {
    component.editingSlug.set('s1');
    component.imageUploads.set([
      { id: 'u1', fileName: 'a.png', bytes: 1, status: 'queued', progress: 0, error: null } as any,
    ]);
    (component as any).maybeStartImageUpload();
    expect(component.imageUploads()[0].status).toBe('error');
  });

  it('maybeStartImageUpload reports upload errors with a request id', () => {
    component.editingSlug.set('s1');
    (component as any).imageUploadFiles.set('u1', new File(['a'], 'a.png'));
    component.imageUploads.set([
      { id: 'u1', fileName: 'a.png', bytes: 1, status: 'queued', progress: 0, error: null } as any,
    ]);
    spies.admin.uploadProductImageWithProgress.and.returnValue(
      throwError(() => ({ headers: { get: () => 'req-123' } })),
    );
    (component as any).maybeStartImageUpload();
    expect(component.imageUploads()[0].status).toBe('error');
  });

  it('maybeStartImageUpload returns when busy or no slug or nothing queued', () => {
    (component as any).imageUploadSub = of(1).subscribe();
    (component as any).maybeStartImageUpload();
    (component as any).imageUploadSub = null;
    component.editingSlug.set(null);
    (component as any).maybeStartImageUpload();
    component.editingSlug.set('s1');
    component.imageUploads.set([]);
    (component as any).maybeStartImageUpload();
    expect(spies.admin.uploadProductImageWithProgress).not.toHaveBeenCalled();
  });

  it('newImageUploadId returns a string', () => {
    expect(typeof (component as any).newImageUploadId()).toBe('string');
  });

  it('makeImagePrimary reorders and persists', () => {
    component.editingSlug.set('s1');
    component.images.set([
      { id: 'i1', url: 'u1', sort_order: 1 },
      { id: 'i2', url: 'u2', sort_order: 2 },
    ]);
    component.makeImagePrimary('i2');
    expect(component.images()[0].id).toBe('i2');
    expect(spies.toast.success).toHaveBeenCalled();
  });

  it('makeImagePrimary guards on slug, index and busy', () => {
    component.editingSlug.set(null);
    component.makeImagePrimary('i2');
    expect(spies.admin.reorderProductImage).not.toHaveBeenCalled();
    component.editingSlug.set('s1');
    component.images.set([{ id: 'i1', url: 'u1', sort_order: 1 }]);
    component.makeImagePrimary('i1');
    expect(spies.admin.reorderProductImage).not.toHaveBeenCalled();
    component.images.set([
      { id: 'i1', url: 'u1', sort_order: 1 },
      { id: 'i2', url: 'u2', sort_order: 2 },
    ]);
    component.imageOrderBusy.set(true);
    component.makeImagePrimary('i2');
    expect(spies.admin.reorderProductImage).not.toHaveBeenCalled();
  });

  it('makeImagePrimary handles reorder error', () => {
    component.editingSlug.set('s1');
    component.images.set([
      { id: 'i1', url: 'u1', sort_order: 1 },
      { id: 'i2', url: 'u2', sort_order: 2 },
    ]);
    spies.admin.reorderProductImage.and.returnValue(throwError(() => new Error('x')));
    component.makeImagePrimary('i2');
    expect(component.imageOrderError()).toBe('adminUi.storefront.products.images.reorderError');
  });

  it('delete image confirm flow', () => {
    component.editingSlug.set('s1');
    component.images.set([{ id: 'i1', url: 'u1', alt_text: 'Alt' }]);
    component.openDeleteImageConfirm('missing');
    expect(component.deleteImageConfirmOpen()).toBeFalse();
    component.openDeleteImageConfirm('i1');
    expect(component.deleteImageConfirmOpen()).toBeTrue();
    component.confirmDeleteImage();
    expect(spies.admin.deleteProductImage).toHaveBeenCalled();
    component.closeDeleteImageConfirm();
    expect(component.deleteImageConfirmOpen()).toBeFalse();
  });

  it('openDeleteImageConfirm falls back to a default alt', () => {
    component.editingSlug.set('s1');
    component.images.set([{ id: 'i1', url: 'u1', alt_text: null }]);
    component.openDeleteImageConfirm('i1');
    expect(component.deleteImageConfirmTarget()?.alt).toBe('adminUi.products.form.image');
  });

  it('confirmDeleteImage guards on slug, target and busy', () => {
    component.editingSlug.set(null);
    component.confirmDeleteImage();
    expect(spies.admin.deleteProductImage).not.toHaveBeenCalled();
    component.editingSlug.set('s1');
    component.deleteImageConfirmTarget.set({ id: 'i1', url: 'u', alt: 'a' });
    component.deleteImageConfirmBusy.set(true);
    component.confirmDeleteImage();
    expect(spies.admin.deleteProductImage).not.toHaveBeenCalled();
  });

  it('deleteImage requires a slug', () => {
    const done = jasmine.createSpy('done');
    component.editingSlug.set(null);
    component.deleteImage('i1', { done });
    expect(done).toHaveBeenCalledWith(false);
  });

  it('deleteImage resets meta, refreshes deleted list and handles error', () => {
    component.editingSlug.set('s1');
    component.editingImageId.set('i1');
    component.deletedImagesOpen.set(true);
    spies.admin.deleteProductImage.and.returnValue(
      of({ images: [{ id: 'i2', sort_order: 1 }] } as any),
    );
    component.deleteImage('i1');
    expect(component.editingImageId()).toBeNull();
    expect(spies.admin.listDeletedProductImages).toHaveBeenCalled();

    spies.admin.deleteProductImage.and.returnValue(throwError(() => new Error('x')));
    const done = jasmine.createSpy('done');
    component.deleteImage('i1', { done });
    expect(done).toHaveBeenCalledWith(false);
  });

  it('toggleDeletedImages opens and closes', () => {
    component.editingSlug.set(null);
    component.toggleDeletedImages();
    expect(component.deletedImagesOpen()).toBeFalse();
    component.editingSlug.set('s1');
    component.toggleDeletedImages();
    expect(component.deletedImagesOpen()).toBeTrue();
    component.toggleDeletedImages();
    expect(component.deletedImagesOpen()).toBeFalse();
  });

  it('restoreDeletedImage restores and handles error', () => {
    component.editingSlug.set(null);
    component.restoreDeletedImage('i1');
    expect(spies.admin.restoreProductImage).not.toHaveBeenCalled();
    component.editingSlug.set('s1');
    component.restoreDeletedImage('i1');
    expect(spies.toast.success).toHaveBeenCalled();
    spies.admin.restoreProductImage.and.returnValue(throwError(() => new Error('x')));
    component.restoreDeletedImage('i1');
    expect(component.deletedImagesError()).toBe('adminUi.products.errors.restoreImage');
  });

  it('loadDeletedImages handles success and error', () => {
    (component as any).loadDeletedImages('s1');
    expect(component.deletedImages()).toEqual([]);
    spies.admin.listDeletedProductImages.and.returnValue(throwError(() => new Error('x')));
    (component as any).loadDeletedImages('s1');
    expect(component.deletedImagesError()).toBe('adminUi.products.errors.loadDeletedImages');
  });

  it('toggleImageMeta loads meta and toggles closed', () => {
    component.editingSlug.set(null);
    component.toggleImageMeta('i1');
    expect(spies.admin.getProductImageTranslations).not.toHaveBeenCalled();
    component.editingSlug.set('s1');
    component.toggleImageMeta('i1');
    expect(component.editingImageId()).toBe('i1');
    component.toggleImageMeta('i1');
    expect(component.editingImageId()).toBeNull();
  });

  it('loadImageMeta maps translations and stats, and errors', () => {
    component.editingSlug.set('s1');
    component.editingImageId.set('i1');
    spies.admin.getProductImageTranslations.and.returnValue(
      of([
        { lang: 'en', alt_text: 'Alt', caption: 'Cap' },
        { lang: 'fr', alt_text: 'X' },
      ] as any),
    );
    spies.admin.getProductImageStats.and.returnValue(of({ original_bytes: 1 } as any));
    (component as any).loadImageMeta('s1', 'i1');
    expect(component.imageMetaExists.en).toBeTrue();
    expect(component.imageMeta.en.alt_text).toBe('Alt');

    spies.admin.getProductImageTranslations.and.returnValue(throwError(() => new Error('x')));
    (component as any).loadImageMeta('s1', 'i1');
    expect(component.imageMetaError()).toBe('adminUi.products.form.imageMetaLoadError');
  });

  it('saveImageMeta requires slug and image', () => {
    component.editingSlug.set(null);
    component.editingImageId.set(null);
    component.saveImageMeta();
    expect(spies.admin.upsertProductImageTranslation).not.toHaveBeenCalled();
  });

  it('saveImageMeta upserts, deletes and handles no-op', () => {
    component.editingSlug.set('s1');
    component.editingImageId.set('i1');
    component.imageMeta = {
      en: { alt_text: 'Alt', caption: '' },
      ro: { alt_text: '', caption: '' },
    } as any;
    component.imageMetaExists = { en: false, ro: true } as any;
    component.saveImageMeta();
    expect(spies.admin.upsertProductImageTranslation).toHaveBeenCalled();
    expect(spies.admin.deleteProductImageTranslation).toHaveBeenCalled();

    component.imageMeta = {
      en: { alt_text: '', caption: '' },
      ro: { alt_text: '', caption: '' },
    } as any;
    component.imageMetaExists = { en: false, ro: false } as any;
    component.saveImageMeta();
    expect(component.imageMetaBusy()).toBeFalse();
  });

  it('saveImageMeta handles forkJoin error', () => {
    component.editingSlug.set('s1');
    component.editingImageId.set('i1');
    component.imageMeta = {
      en: { alt_text: 'Alt', caption: '' },
      ro: { alt_text: '', caption: '' },
    } as any;
    spies.admin.upsertProductImageTranslation.and.returnValue(throwError(() => new Error('x')));
    component.saveImageMeta();
    expect(component.imageMetaError()).toBe('adminUi.products.form.imageMetaSaveError');
  });

  it('reprocessImage requires slug and image and handles error', () => {
    component.editingSlug.set(null);
    component.editingImageId.set(null);
    component.reprocessImage();
    expect(spies.admin.reprocessProductImage).not.toHaveBeenCalled();
    component.editingSlug.set('s1');
    component.editingImageId.set('i1');
    spies.admin.reprocessProductImage.and.returnValue(of({ original_bytes: 5 } as any));
    component.reprocessImage();
    expect(component.imageStats).toEqual({ original_bytes: 5 } as any);
    spies.admin.reprocessProductImage.and.returnValue(throwError(() => new Error('x')));
    component.reprocessImage();
    expect(component.imageMetaError()).toBe('adminUi.products.form.imageReprocessError');
  });

  it('formatBytes scales units', () => {
    expect(component.formatBytes(null)).toBe('—');
    expect(component.formatBytes(512)).toBe('512 B');
    expect(component.formatBytes(2048)).toBe('2 KB');
    expect(component.formatBytes(5 * 1024 * 1024)).toContain('MB');
  });

  it('formatAuditValue stringifies values', () => {
    expect(component.formatAuditValue(null)).toBe('—');
    expect(component.formatAuditValue('s')).toBe('s');
    expect(component.formatAuditValue(5)).toBe('5');
    expect(component.formatAuditValue(true)).toBe('true');
    const d = new Date('2030-01-01T00:00:00Z');
    expect(component.formatAuditValue(d)).toBe(d.toISOString());
    expect(component.formatAuditValue({ a: 1 })).toContain('a');
    const circular: any = {};
    circular.self = circular;
    expect(component.formatAuditValue(circular)).toBe('—');
  });

  it('load populates products and handles error', () => {
    spies.productsApi.search.and.returnValue(of(searchResponse([listItem()])));
    (component as any).load();
    expect(component.products().length).toBe(1);
    expect(component.loading()).toBeFalse();
    spies.productsApi.search.and.returnValue(throwError(() => ({ headers: { get: () => 'rid' } })));
    component.q = ' query ';
    (component as any).load();
    expect(component.error()).toBe('adminUi.products.errors.loadList');
    component.retryLoad();
  });

  it('loadCategories handles success and error', () => {
    spies.catalog.listCategories.and.returnValue(of([{ id: 'c1' } as any]));
    (component as any).loadCategories();
    expect(component.categories().length).toBe(1);
    spies.catalog.listCategories.and.returnValue(throwError(() => new Error('x')));
    (component as any).loadCategories();
    expect(component.categories()).toEqual([]);
  });

  it('loadAdminCategories seeds form category and opens pending editor', () => {
    component.editorOpen.set(true);
    component.editingSlug.set(null);
    component.form.category_id = '';
    spies.admin.getCategories.and.returnValue(of([{ id: 'c1', name: 'C' } as any]));
    (component as any).loadAdminCategories();
    expect(component.form.category_id).toBe('c1');

    spies.admin.getCategories.and.returnValue(throwError(() => new Error('x')));
    (component as any).loadAdminCategories();
    expect(component.adminCategories()).toEqual([]);
  });

  it('openPendingEditor edits the pending slug or starts new', () => {
    const editSpy = spyOn(component, 'edit');
    (component as any).pendingEditProductSlug = 'pending';
    (component as any).openPendingEditor();
    expect(editSpy).toHaveBeenCalledWith('pending');
    const startSpy = spyOn(component, 'startNew');
    (component as any).autoStartNewProduct = true;
    (component as any).openPendingEditor();
    expect(startSpy).toHaveBeenCalled();
  });

  it('statusPillClass maps statuses', () => {
    expect(component.statusPillClass('published')).toContain('emerald');
    expect(component.statusPillClass('archived')).toContain('slate');
    expect(component.statusPillClass('draft')).toContain('amber');
  });

  it('loadAudit builds price history and handles error', () => {
    spies.admin.getProductAudit.and.returnValue(
      of([
        {
          created_at: '2030-01-02T00:00:00Z',
          user_email: 'a@b.c',
          payload: { changes: { base_price: { before: 10, after: 20 } } },
        },
        {
          created_at: '2030-01-01T00:00:00Z',
          payload: { changes: { base_price: { before: '5', after: '5' } } },
        },
        { created_at: '2030-01-03T00:00:00Z', payload: {} },
      ] as any),
    );
    (component as any).loadAudit('s1');
    expect(component.priceHistoryChanges().length).toBe(1);
    expect(component.priceHistoryChart()).not.toBeNull();

    spies.admin.getProductAudit.and.returnValue(throwError(() => new Error('x')));
    (component as any).loadAudit('s1');
    expect(component.auditError()).toBe('adminUi.products.audit.errors.load');
  });

  it('buildPriceHistoryChart handles empty changes with current price and sale window', () => {
    component.form.base_price = '15';
    component.form.sale_start_at = '2030-01-01T00:00';
    component.form.sale_end_at = '2030-02-01T00:00';
    const chart = (component as any).buildPriceHistoryChart([]);
    expect(chart).not.toBeNull();
    expect(chart.saleRect).not.toBeNull();
  });

  it('buildPriceHistoryChart returns null when no data', () => {
    component.form.base_price = '';
    expect((component as any).buildPriceHistoryChart([])).toBeNull();
  });

  it('parseAuditMoney parses numeric forms', () => {
    expect((component as any).parseAuditMoney(null)).toBeNull();
    expect((component as any).parseAuditMoney(10)).toBe(10);
    expect((component as any).parseAuditMoney('5.555')).toBe(5.56);
    expect((component as any).parseAuditMoney('bad')).toBeNull();
    expect((component as any).parseAuditMoney(BigInt(7))).toBe(7);
    expect((component as any).parseAuditMoney({})).toBeNull();
  });

  it('loadTranslations maps and refreshes open previews', () => {
    component.translationPreviewOpen = { en: true, ro: false };
    spies.admin.getProductTranslations.and.returnValue(
      of([
        { lang: 'en', name: 'EN', short_description: 's', long_description: 'l' },
        { lang: 'de', name: 'X' },
      ] as any),
    );
    (component as any).loadTranslations('s1');
    expect(component.translationExists.en).toBeTrue();
    expect(component.translations.en.name).toBe('EN');

    spies.admin.getProductTranslations.and.returnValue(throwError(() => new Error('x')));
    (component as any).loadTranslations('s1');
    expect(component.translationError()).toBe('adminUi.products.translations.errors.load');
  });

  it('parseTagSlugs dedupes and normalizes', () => {
    expect((component as any).parseTagSlugs('x')).toEqual([]);
    expect((component as any).parseTagSlugs(['A', { slug: 'a' }, '', { slug: 'B' }])).toEqual([
      'a',
      'b',
    ]);
  });

  it('buildTags toggles bestseller', () => {
    (component as any).loadedTagSlugs = ['sale'];
    component.form.is_bestseller = true;
    expect((component as any).buildTags()).toContain('bestseller');
    component.form.is_bestseller = false;
    expect((component as any).buildTags()).not.toContain('bestseller');
  });

  it('buildShortDescription uses short, then first long line, then null', () => {
    component.form.short_description = 'Hello';
    expect((component as any).buildShortDescription()).toBe('Hello');
    component.form.short_description = '';
    component.form.long_description = '\n  First line\nSecond';
    expect((component as any).buildShortDescription()).toBe('First line');
    component.form.long_description = '';
    expect((component as any).buildShortDescription()).toBeNull();
    component.form.long_description = '\n\n';
    expect((component as any).buildShortDescription()).toBeNull();
  });

  it('toLocalDateTime formats valid dates and blanks invalid', () => {
    expect((component as any).toLocalDateTime('bad')).toBe('');
    expect((component as any).toLocalDateTime('2030-01-01T00:00:00Z')).toContain('2030-01-01T');
  });

  it('parseSignedMoneyInput handles signs and blanks', () => {
    expect((component as any).parseSignedMoneyInput('')).toBeNull();
    expect((component as any).parseSignedMoneyInput('-')).toBeNull();
    expect((component as any).parseSignedMoneyInput('-2.5')).toBe(-2.5);
    expect((component as any).parseSignedMoneyInput('3')).toBe(3);
    expect((component as any).parseSignedMoneyInput('-abc')).toBeNull();
  });

  it('parseMoneyInput sanitizes and parses', () => {
    expect((component as any).parseMoneyInput('')).toBeNull();
    expect((component as any).parseMoneyInput('.5')).toBe(0.5);
    expect((component as any).parseMoneyInput('12.999')).toBe(12.99);
  });

  it('downloadBlob creates and revokes an object url', fakeAsync(() => {
    spyOn(URL, 'createObjectURL').and.returnValue('blob:y');
    const revoke = spyOn(URL, 'revokeObjectURL');
    const clickSpy = jasmine.createSpy('click');
    spyOn(document, 'createElement').and.returnValue({ click: clickSpy } as any);
    (component as any).downloadBlob(new Blob(['a']), 'f.csv');
    tick(0);
    expect(clickSpy).toHaveBeenCalled();
    expect(revoke).toHaveBeenCalled();
  }));
});

describe('AdminProductsComponent branch coverage', () => {
  let component: AnyComponent;
  let spies: Spies;

  beforeEach(() => {
    const created = setup();
    component = created.component;
    spies = created.spies;
  });

  // The `typeof document === 'undefined'` SSR guards in scrollToBulkActions,
  // setProductSearchActive and downloadBlob cannot be exercised in Karma: the
  // global `document` is a non-configurable property and cannot be undefined in
  // a browser. They carry the repo-standard `/* istanbul ignore next -- SSR
  // guard */` directive in the component, matching admin-ops/analytics.

  it('newImageUploadId falls back when randomUUID throws', () => {
    const orig = Object.getOwnPropertyDescriptor(crypto, 'randomUUID');
    Object.defineProperty(crypto, 'randomUUID', {
      configurable: true,
      value: () => {
        throw new Error('no');
      },
    });
    try {
      expect((component as any).newImageUploadId()).toContain('-');
    } finally {
      if (orig) Object.defineProperty(crypto, 'randomUUID', orig);
    }
  });

  it('scheduleProductFiltersApply clears an existing handle', fakeAsync(() => {
    (component as any).productFilterDebounceHandle = window.setTimeout(() => undefined, 1000);
    (component as any).scheduleProductFiltersApply();
    tick(250);
    flush();
    expect((component as any).productFilterDebounceHandle).toBeNull();
  }));

  it('moveProductSearchActive moves from a valid index', () => {
    component.productSearchResults.set([listItem({ id: 'a' }), listItem({ id: 'b' })]);
    component.productSearchActiveIndex.set(0);
    (component as any).moveProductSearchActive(1);
    expect(component.productSearchActiveIndex()).toBe(1);
  });

  it('resetDuplicateCheck clears a pending timeout', () => {
    (component as any).duplicateCheckTimeoutId = setTimeout(() => undefined, 1000);
    (component as any).resetDuplicateCheck();
    expect((component as any).duplicateCheckTimeoutId).toBeNull();
  });

  it('scheduleDuplicateCheck clears a pending timeout before rescheduling', fakeAsync(() => {
    component.editorOpen.set(true);
    component.form.name = 'Name';
    (component as any).duplicateCheckTimeoutId = setTimeout(() => undefined, 1000);
    (component as any).scheduleDuplicateCheck();
    expect((component as any).duplicateCheckTimeoutId).not.toBeNull();
    flush();
  }));

  it('resetRelationships clears a pending search timeout', () => {
    (component as any).relationshipSearchTimeout = setTimeout(() => undefined, 1000);
    (component as any).resetRelationships();
    expect((component as any).relationshipSearchTimeout).toBeNull();
  });

  it('onRelationshipSearchChange clears an existing timeout', () => {
    (component as any).relationshipSearchTimeout = setTimeout(() => undefined, 1000);
    component.onRelationshipSearchChange('a');
    expect(component.relationshipSearchResults()).toEqual([]);
  });

  it('categoryParentOptions sorts multiple options', () => {
    component.categories.set([
      { id: 'self', slug: 'self', name: 'Self', parent_id: null } as any,
      { id: 'b', slug: 'b', name: 'Bravo', parent_id: null } as any,
      { id: 'a', slug: 'a', name: 'Alpha', parent_id: null } as any,
    ]);
    const opts = component.categoryParentOptions({
      id: 'self',
      slug: 'self',
      name: 'Self',
      parent_id: null,
    } as any);
    expect(opts.map((c: any) => c.name)).toEqual(['Alpha', 'Bravo']);
  });

  it('categoryParentOptions tolerates missing names', () => {
    component.categories.set([
      { id: 'self', slug: 'self', name: 'Self', parent_id: null } as any,
      { id: 'a', slug: 'a', name: null, parent_id: null } as any,
      { id: 'b', slug: 'b', name: null, parent_id: null } as any,
    ]);
    expect(() =>
      component.categoryParentOptions({ id: 'self', slug: 'self', name: 'Self' } as any),
    ).not.toThrow();
  });

  it('categoryDescendantIds walks nested children', () => {
    component.categories.set([
      { id: 'root', slug: 'root', name: 'R', parent_id: null } as any,
      { id: 'a', slug: 'a', name: 'A', parent_id: 'root' } as any,
      { id: 'b', slug: 'b', name: 'B', parent_id: 'root' } as any,
      { id: 'c', slug: 'c', name: 'C', parent_id: 'a' } as any,
    ]);
    const ids = (component as any).categoryDescendantIds('root');
    expect(ids.has('a')).toBeTrue();
    expect(ids.has('c')).toBeTrue();
  });

  it('mergeTargetOptions sorts multiple siblings', () => {
    component.categories.set([
      { id: 'a', slug: 'a', name: 'Alpha', parent_id: 'root' } as any,
      { id: 'c', slug: 'c', name: 'Charlie', parent_id: 'root' } as any,
      { id: 'b', slug: 'b', name: 'Bravo', parent_id: 'root' } as any,
    ]);
    const opts = component.mergeTargetOptions({
      id: 'a',
      slug: 'a',
      name: 'Alpha',
      parent_id: 'root',
    } as any);
    expect(opts.map((c: any) => c.name)).toEqual(['Bravo', 'Charlie']);
  });

  it('saveInlineEdit submits a valid percent sale', () => {
    component.inlineEditId = 'p1';
    component.inlineBasePrice = '10';
    component.inlineStockQuantity = '3';
    component.inlineSaleEnabled = true;
    component.inlineSaleType = 'percent';
    component.inlineSaleValue = '15';
    component.saveInlineEdit();
    const payload = spies.admin.bulkUpdateProducts.calls.mostRecent().args[0][0];
    expect(payload.sale_type).toBe('percent');
    expect(payload.sale_value).toBe(15);
  });

  it('wizardCanNext allows a non-save step', () => {
    component.wizardKind.set('create');
    component.wizardStep.set(0);
    expect(component.wizardCanNext()).toBeTrue();
  });

  it('save submits a valid amount sale and low-stock threshold', () => {
    component.form.base_price = '100';
    component.form.low_stock_threshold = '5';
    component.form.weight_grams = '250';
    component.form.width_cm = '4';
    component.form.height_cm = '5';
    component.form.depth_cm = '6';
    component.form.sale_enabled = true;
    component.form.sale_type = 'amount';
    component.form.sale_value = '20';
    component.save({ skipStatusConfirm: true });
    const payload = spies.admin.createProduct.calls.mostRecent().args[0] as any;
    expect(payload.sale_value).toBe(20);
    expect(payload.low_stock_threshold).toBe(5);
    expect(payload.weight_grams).toBe(250);
  });

  it('save success outside a wizard resets advance flag', () => {
    component.form.base_price = '10';
    component.wizardKind.set(null);
    (component as any).wizardAdvanceAfterSave = true;
    spies.admin.createProduct.and.returnValue(
      of({
        id: 'np',
        slug: 's',
        status: 'draft',
        is_active: true,
        images: [
          { id: 'i2', sort_order: 2 },
          { id: 'i1', sort_order: 1 },
        ],
        tags: [],
      } as any),
    );
    component.save({ skipStatusConfirm: true });
    expect((component as any).wizardAdvanceAfterSave).toBeFalse();
    expect(component.images()[0].id).toBe('i1');
  });

  it('edit sorts images without sort_order and handles non-array images', fakeAsync(() => {
    spies.admin.getProduct.and.returnValue(
      of({
        slug: 'p',
        base_price: 5,
        images: [{ id: 'i2' }, { id: 'i1', sort_order: 1 }],
        variants: 'nope',
      } as any),
    );
    component.edit('p');
    flush();
    expect(component.images().length).toBe(2);
    expect(component.variants()).toEqual([]);
  }));

  it('formatTimestamp falls back when locale is invalid', () => {
    (spies.translate as any).currentLang = 'en_US';
    expect(typeof component.formatTimestamp('2030-01-01T00:00:00Z')).toBe('string');
  });

  it('translationDiffSnippet truncates long values', () => {
    component.translations.ro = {
      name: 'a'.repeat(120),
      short_description: '',
      long_description: '',
    } as any;
    component.translations.en = {
      name: 'b'.repeat(120),
      short_description: '',
      long_description: '',
    } as any;
    const rows = component.translationDiffRows();
    expect(rows[0].roSnippet.endsWith('…')).toBeTrue();
  });

  it('loadRelationships drops ids that no longer resolve', () => {
    component.editingProductId.set('pid');
    spies.admin.getProductRelationships.and.returnValue(
      of({ related_product_ids: ['r1', 'missing'], upsell_product_ids: ['u1', 'missing'] } as any),
    );
    spies.productsApi.byIds.and.returnValue(of([listItem({ id: 'r1' }), listItem({ id: 'u1' })]));
    (component as any).loadRelationships('s1');
    expect(component.relationshipsRelatedIds()).toEqual(['r1']);
    expect(component.relationshipsUpsellIds()).toEqual(['u1']);
  });

  it('maybeStartImageUpload sorts multiple response images', () => {
    component.editingSlug.set('s1');
    (component as any).imageUploadFiles.set('u1', new File(['a'], 'a.png'));
    component.imageUploads.set([
      { id: 'u1', fileName: 'a.png', bytes: 1, status: 'queued', progress: 0, error: null } as any,
    ]);
    spies.admin.uploadProductImageWithProgress.and.returnValue(
      of({
        type: HttpEventType.Response,
        body: {
          images: [
            { id: 'i2', sort_order: 2 },
            { id: 'i1', sort_order: 1 },
          ],
        },
      } as any),
    );
    (component as any).maybeStartImageUpload();
    expect(component.images()[0].id).toBe('i1');
  });

  it('deleteImage handles non-array images payload', () => {
    component.editingSlug.set('s1');
    spies.admin.deleteProductImage.and.returnValue(of({ images: null } as any));
    component.deleteImage('i1');
    expect(component.images()).toEqual([]);
  });

  it('restoreDeletedImage sorts multiple images', () => {
    component.editingSlug.set('s1');
    spies.admin.restoreProductImage.and.returnValue(
      of({
        images: [
          { id: 'i2', sort_order: 2 },
          { id: 'i1', sort_order: 1 },
        ],
      } as any),
    );
    component.restoreDeletedImage('i1');
    expect(component.images()[0].id).toBe('i1');
  });

  it('buildPriceHistoryChart covers past changes, user_id and skipped entries', () => {
    spies.admin.getProductAudit.and.returnValue(
      of([
        {
          created_at: '2020-01-02T00:00:00Z',
          user_id: 'u-99',
          payload: { changes: { base_price: { before: 10, after: 20 } } },
        },
        {
          created_at: '2020-01-01T00:00:00Z',
          payload: { changes: { base_price: { before: { bad: true }, after: 5 } } },
        },
        {
          created_at: '2020-01-03T00:00:00Z',
          payload: { changes: { base_price: { before: 20, after: 30 } } },
        },
      ] as any),
    );
    component.form.base_price = '30';
    component.form.sale_start_at = '2020-01-01T00:00';
    component.form.sale_end_at = '2020-01-05T00:00';
    (component as any).loadAudit('s1');
    const chart = component.priceHistoryChart();
    expect(chart).not.toBeNull();
    expect(component.priceHistoryChanges().length).toBe(2);
  });

  it('loadImageMeta covers stats fallback when stats is nullish', () => {
    component.editingSlug.set('s1');
    component.editingImageId.set('i1');
    spies.admin.getProductImageTranslations.and.returnValue(of([]));
    spies.admin.getProductImageStats.and.returnValue(of(null as any));
    (component as any).loadImageMeta('s1', 'i1');
    expect(component.imageStats).toBeNull();
  });
});

describe('AdminProductsComponent fallback branch coverage', () => {
  let component: AnyComponent;
  let spies: Spies;

  beforeEach(() => {
    const created = setup();
    component = created.component;
    spies = created.spies;
  });

  it('onProductSearchChange handles an empty query string', fakeAsync(() => {
    component.q = '';
    component.onProductSearchChange();
    flush();
    expect(component.productSearchResults()).toEqual([]);
  }));

  it('moveProductSearchActive starts from an unset index', () => {
    component.productSearchResults.set([listItem({ id: 'a' }), listItem({ id: 'b' })]);
    component.productSearchActiveIndex.set(-1);
    // From an unset index (-1) the move treats the start as 0, then applies delta.
    (component as any).moveProductSearchActive(1);
    expect(component.productSearchActiveIndex()).toBe(1);
  });

  it('maybeApplyFiltersFromState applies defaults for an empty filters object', () => {
    (component as any).maybeApplyFiltersFromState({
      adminFilterScope: 'products',
      adminFilters: {},
    });
    expect(component.q).toBe('');
    expect(component.status).toBe('all');
    expect(component.view).toBe('active');
  });

  it('confirmCreateCategory ignores a falsy name', () => {
    component.createCategoryName = '';
    component.confirmCreateCategory();
    expect(spies.admin.createCategory).not.toHaveBeenCalled();
  });

  it('onCategoryManagerSelect handles nullish slug and missing category', () => {
    component.onCategoryManagerSelect(null as any);
    expect(component.categoryManagerParentId).toBe('');
    component.onCategoryManagerSelect('nonexistent');
    expect(component.categoryManagerSelectedCategory()).toBeNull();
    expect(component.categoryManagerParentId).toBe('');
  });

  it('resetCategoryManagerParent handles no selection', () => {
    component.categoryManagerSlug = '';
    component.resetCategoryManagerParent();
    expect(component.categoryManagerParentId).toBe('');
  });

  it('saveCategoryManagerParent handles null updated parent', () => {
    component.categories.set([{ id: 'c1', slug: 'cat-1', name: 'Cat', parent_id: 'old' } as any]);
    component.categoryManagerSlug = 'cat-1';
    component.categoryManagerParentId = 'new';
    spies.admin.updateCategory.and.returnValue(of({ parent_id: null } as any));
    component.saveCategoryManagerParent();
    expect(component.categoryManagerParentId).toBe('');
  });

  it('saveCategoryManagerParent error without detail and null previous parent', () => {
    component.categories.set([{ id: 'c1', slug: 'cat-1', name: 'Cat', parent_id: null } as any]);
    component.categoryManagerSlug = 'cat-1';
    component.categoryManagerParentId = 'new';
    spies.admin.updateCategory.and.returnValue(throwError(() => ({})));
    component.saveCategoryManagerParent();
    expect(component.categoryManagerUpdateError()).toBe('adminUi.categories.errors.updateParent');
    expect(component.categoryManagerParentId).toBe('');
  });

  it('categoryDescendantIds dedupes diamond hierarchies', () => {
    component.categories.set([
      { id: 'root', slug: 'root', name: 'R', parent_id: null } as any,
      { id: 'a', slug: 'a', name: 'A', parent_id: 'root' } as any,
      { id: 'b', slug: 'b', name: 'B', parent_id: 'root' } as any,
      { id: 'c', slug: 'c', name: 'C', parent_id: 'a' } as any,
      { id: 'c', slug: 'c2', name: 'C2', parent_id: 'b' } as any,
    ]);
    const ids = (component as any).categoryDescendantIds('root');
    expect(ids.has('c')).toBeTrue();
  });

  it('mergeTargetOptions tolerates null parents and names', () => {
    component.categories.set([
      { id: 'a', slug: 'a', name: null, parent_id: null } as any,
      { id: 'b', slug: 'b', name: null, parent_id: null } as any,
      { id: 'c', slug: 'c', name: null, parent_id: null } as any,
    ]);
    const opts = component.mergeTargetOptions({ id: 'a', slug: 'a', name: null } as any);
    expect(opts.length).toBe(2);
  });

  it('mergeCategorySelected returns when no category selected', () => {
    component.categoryManagerSlug = '';
    component.mergeCategorySelected();
    expect(spies.admin.mergeCategory).not.toHaveBeenCalled();
  });

  it('mergeCategorySelected falls back to target slug for the name', () => {
    component.categories.set([{ id: 'c1', slug: 'cat-1', name: 'Cat' } as any]);
    component.categoryManagerSlug = 'cat-1';
    component.mergeTargetSlug = 'ghost';
    component.mergePreview.set({ can_merge: true, product_count: 1 } as any);
    spyOn(window, 'confirm').and.returnValue(true);
    component.mergeCategorySelected();
    expect(spies.admin.mergeCategory).toHaveBeenCalledWith('cat-1', 'ghost');
  });

  it('runCategoryImport handles a result without an errors field', () => {
    component.categoryImportFile = new File(['a'], 'c.csv');
    spies.admin.importCategoriesCsv.and.returnValue(of({} as any));
    component.runCategoryImport();
    expect(spies.toast.success).toHaveBeenCalled();
  });

  it('runCategoryImport error without a detail message', () => {
    component.categoryImportFile = new File(['a'], 'c.csv');
    spies.admin.importCategoriesCsv.and.returnValue(throwError(() => ({})));
    component.runCategoryImport();
    expect(component.categoryImportError()).toBe('adminUi.categories.csv.error');
  });

  it('quickSetStatus success falls back to slug for the toast name', () => {
    component.quickSetStatus(
      listItem({ id: 'p1', name: '', slug: 'slug-1', status: 'draft' }),
      'published',
    );
    expect(spies.toast.action).toHaveBeenCalled();
  });

  it('onBulkSaleValueChange tolerates null', () => {
    component.onBulkSaleValueChange(null as any);
    expect(component.bulkSaleValue).toBe('');
  });

  it('applyScheduleToSelected applies an unpublish-only schedule', () => {
    component.selected = new Set(['p1']);
    component.bulkPublishScheduledFor = '';
    component.bulkUnpublishScheduledFor = '2030-02-01T10:00';
    component.applyScheduleToSelected();
    expect(spies.admin.bulkUpdateProducts).toHaveBeenCalled();
  });

  it('startInlineEdit handles falsy numeric fields and no sale', () => {
    component.startInlineEdit(
      listItem({ id: 'p1', base_price: 0, stock_quantity: 0, sale_type: null, sale_value: 0 }),
    );
    expect(component.inlineSaleEnabled).toBeFalse();
    expect(component.inlineSaleValue).toBe('');
  });

  it('startInlineEdit handles string sale value', () => {
    component.startInlineEdit(
      listItem({ id: 'p1', base_price: 5, sale_type: 'percent', sale_value: '12' }),
    );
    expect(component.inlineSaleEnabled).toBeTrue();
  });

  it('inline change handlers tolerate null input', () => {
    component.onInlineBasePriceChange(null as any);
    component.onInlineStockChange(null as any);
    component.onInlineSaleValueChange(null as any);
    expect(component.inlineBasePrice).toBe('');
  });

  it('saveInlineEdit handles an empty stock string', () => {
    component.inlineEditId = 'p1';
    component.inlineBasePrice = '10';
    component.inlineStockQuantity = '';
    component.saveInlineEdit();
    expect(component.inlineStockError).toBe('adminUi.products.inline.errors.stockRequired');
  });

  it('onBulkPriceValueChange tolerates null', () => {
    component.onBulkPriceValueChange(null as any);
    expect(component.bulkPriceValue).toBe('');
  });

  it('applyPriceAdjustmentToSelected handles non-numeric base prices', () => {
    component.products.set([listItem({ id: 'p1', base_price: undefined })]);
    component.selected = new Set(['p1']);
    component.bulkPriceMode = 'amount';
    component.bulkPriceValue = '5';
    component.applyPriceAdjustmentToSelected();
    expect(spies.admin.bulkUpdateProducts).toHaveBeenCalled();
  });

  it('updateBulkPricePreview handles decrease direction and non-numeric base', () => {
    component.products.set([
      listItem({ id: 'p1', base_price: undefined }),
      listItem({ id: 'p2', base_price: 20 }),
    ]);
    component.selected = new Set(['p1', 'p2']);
    component.bulkPriceDirection = 'decrease';
    component.bulkPriceMode = 'percent';
    component.bulkPriceValue = '10';
    component.updateBulkPricePreview();
    expect(component.bulkPricePreview).not.toBeNull();
  });

  it('csvImportCanApply handles a result without errors', () => {
    component.csvImportFile.set(new File(['a'], 'p.csv'));
    component.csvImportResult.set({} as any);
    expect(component.csvImportCanApply()).toBeTrue();
  });

  it('wizardPrev tolerates an out-of-range current step', () => {
    component.wizardKind.set('create');
    component.wizardStep.set(100);
    expect(() => component.wizardPrev()).not.toThrow();
  });

  it('onNameChange and onSkuChange tolerate null', () => {
    component.onNameChange(null as any);
    component.onSkuChange(null as any);
    expect(component.form.name).toBe('');
    expect(component.form.sku).toBe('');
  });

  it('duplicateHasWarnings handles missing match arrays and name matches', () => {
    component.duplicateCheck.set({ slug_base: '', suggested_slug: '' } as any);
    expect(component.duplicateHasWarnings()).toBeFalse();
    component.duplicateCheck.set({ name_matches: [1] } as any);
    expect(component.duplicateHasWarnings()).toBeTrue();
  });

  it('runDuplicateCheck uses sku when name is empty', fakeAsync(() => {
    component.editorOpen.set(true);
    component.form.name = '';
    component.form.sku = 'SKU';
    (component as any).runDuplicateCheck();
    flush();
    const args = spies.productsApi.duplicateCheck.calls.mostRecent().args[0];
    expect(args.name).toBeUndefined();
    expect(args.sku).toBe('SKU');
  }));

  it('runDuplicateCheck ignores stale success and error responses', fakeAsync(() => {
    component.editorOpen.set(true);
    component.form.name = 'N';
    const subject = new Subject<any>();
    spies.productsApi.duplicateCheck.and.returnValue(subject.asObservable());
    (component as any).runDuplicateCheck();
    (component as any).duplicateCheckSeq += 5;
    subject.next({ suggested_slug: 'x' } as any);
    subject.complete();
    flush();
    expect(component.duplicateCheck()).toBeNull();

    const subject2 = new Subject<any>();
    spies.productsApi.duplicateCheck.and.returnValue(subject2.asObservable());
    (component as any).runDuplicateCheck();
    (component as any).duplicateCheckSeq += 5;
    subject2.error(new Error('x'));
    flush();
    // Stale error is ignored: the result stays null (the finalizer also bails on
    // the sequence mismatch, leaving busy untouched).
    expect(component.duplicateCheck()).toBeNull();
  }));

  it('previewBasePrice returns zero for empty input', () => {
    component.form.base_price = '';
    expect(component.previewBasePrice()).toBe(0);
  });

  it('previewSalePrice returns null when rounding cancels the discount', () => {
    component.form.base_price = '1';
    component.form.sale_enabled = true;
    component.form.sale_type = 'percent';
    component.form.sale_value = '0.01';
    expect(component.previewSalePrice()).toBeNull();
  });

  it('onBasePriceChange tolerates null', () => {
    component.onBasePriceChange(null as any);
    expect(component.form.base_price).toBe('');
  });

  it('onSaleEnabledChange returns early when sale is enabled', () => {
    component.form.sale_enabled = true;
    component.form.sale_value = '5';
    component.onSaleEnabledChange();
    expect(component.form.sale_value).toBe('5');
  });

  it('onSaleValueChange tolerates null', () => {
    component.form.sale_enabled = true;
    component.onSaleValueChange(null as any);
    expect(component.saleValueError).toBe('');
  });

  it('save proceeds without confirmation when there is no saved state', () => {
    component.lastSavedState.set(null);
    component.form.base_price = '10';
    component.save({});
    expect(spies.admin.createProduct).toHaveBeenCalled();
  });

  it('save serializes badges with empty dates and a publish date', () => {
    component.form.base_price = '10';
    component.form.publish_at = '2030-01-01T00:00';
    component.form.badges.new = { enabled: true, start_at: '', end_at: '' };
    component.save({ skipStatusConfirm: true });
    const payload = spies.admin.createProduct.calls.mostRecent().args[0] as any;
    expect(payload.badges[0].start_at).toBeNull();
    expect(payload.publish_at).not.toBeNull();
  });

  it('save handles a sale enabled with empty schedule dates', () => {
    component.form.base_price = '10';
    component.form.sale_enabled = true;
    component.form.sale_type = 'percent';
    component.form.sale_value = '10';
    component.form.sale_start_at = '';
    component.form.sale_end_at = '';
    component.save({ skipStatusConfirm: true });
    const payload = spies.admin.createProduct.calls.mostRecent().args[0] as any;
    expect(payload.sale_start_at).toBeNull();
  });

  it('save resolves a null new slug from the response', () => {
    component.form.base_price = '10';
    component.editingSlug.set(null);
    spies.admin.createProduct.and.returnValue(
      of({ id: 'np', status: 'draft', is_active: true } as any),
    );
    component.save({ skipStatusConfirm: true });
    expect(component.editingSlug()).toBeNull();
  });

  it('save sorts response images that lack sort_order', () => {
    component.form.base_price = '10';
    spies.admin.createProduct.and.returnValue(
      of({
        id: 'np',
        slug: 's',
        status: 'draft',
        is_active: true,
        images: [{ id: 'i2' }, { id: 'i1', sort_order: 1 }],
        tags: [],
      } as any),
    );
    component.save({ skipStatusConfirm: true });
    expect(component.images().length).toBe(2);
  });

  it('variant change handlers tolerate null and recompute zero base', () => {
    component.variants.set([{ name: 'x', additional_price_delta: '0', stock_quantity: 0 } as any]);
    component.onVariantNameChange(0, null as any);
    component.onVariantDeltaChange(0, null as any);
    component.onVariantStockChange(0, null as any);
    component.form.base_price = '';
    expect(component.variantComputedPrice('')).toBe(0);
  });

  it('saveVariants tolerates a null response and missing variant fields', () => {
    component.editingSlug.set('s1');
    component.variants.set([{ name: 'A', additional_price_delta: '1', stock_quantity: 2 } as any]);
    spies.admin.updateProductVariants.and.returnValue(of(null as any));
    component.saveVariants();
    expect(component.variants()).toEqual([]);
    component.variants.set([{ name: 'A', additional_price_delta: '1', stock_quantity: 2 } as any]);
    spies.admin.updateProductVariants.and.returnValue(of([{ id: 'v1' } as any]));
    component.saveVariants();
    expect(component.variants()[0].name).toBe('');
  });

  it('formatTimestamp uses default locale when currentLang is empty', () => {
    (spies.translate as any).currentLang = '';
    expect(typeof component.formatTimestamp('2030-01-01T00:00:00Z')).toBe('string');
  });

  it('applyStockAdjustment tolerates null delta', () => {
    component.editingProductId.set('pid');
    component.stockAdjustDelta = null as any;
    component.applyStockAdjustment();
    expect(component.stockAdjustmentsError()).toBe('adminUi.products.form.stockLedgerDeltaInvalid');
  });

  it('loadStockAdjustments tolerates a non-array response', () => {
    spies.admin.listStockAdjustments.and.returnValue(of(null as any));
    (component as any).loadStockAdjustments('pid');
    expect(component.stockAdjustments()).toEqual([]);
  });

  it('setVariantsFromProduct tolerates missing variant fields', fakeAsync(() => {
    spies.admin.getProduct.and.returnValue(
      of({ slug: 'p', base_price: 5, variants: [{ id: 'v1' }] } as any),
    );
    component.edit('p');
    flush();
    expect(component.variants()[0].name).toBe('');
  }));

  it('edit covers currency, courier, sale_price and missing-slug fallbacks', fakeAsync(() => {
    spies.admin.getProduct.and.returnValue(
      of({
        name: 'P',
        currency: '',
        base_price: 'bad',
        sale_price: 9,
        sale_value: '5',
        sale_type: 'amount',
        shipping_disallowed_couriers: [null, 'sameday'],
        badges: [null, { badge: 'new' }],
        images: [{ id: 'i2' }, { id: 'i1', sort_order: 1 }],
      } as any),
    );
    component.edit('the-slug');
    flush();
    expect(component.editingCurrency()).toBe('RON');
    expect(component.form.sale_enabled).toBeTrue();
    expect(spies.admin.getProductTranslations).toHaveBeenCalledWith('the-slug');
  }));

  it('loadRelationships tolerates a response without id arrays', () => {
    spies.admin.getProductRelationships.and.returnValue(of({} as any));
    (component as any).loadRelationships('s1');
    expect(component.relationshipsRelatedIds()).toEqual([]);
  });

  it('loadRelationships tolerates a non-array byIds response', () => {
    spies.admin.getProductRelationships.and.returnValue(
      of({ related_product_ids: ['r1'], upsell_product_ids: [] } as any),
    );
    spies.productsApi.byIds.and.returnValue(of(null as any));
    (component as any).loadRelationships('s1');
    expect(component.relationshipsRelated()).toEqual([]);
  });

  it('onRelationshipSearchChange tolerates null', () => {
    component.onRelationshipSearchChange(null as any);
    expect(component.relationshipSearch).toBe('');
  });

  it('runRelationshipSearch tolerates a non-array items response', fakeAsync(() => {
    spies.productsApi.search.and.returnValue(of({ items: null } as any));
    (component as any).runRelationshipSearch('abc');
    flush();
    expect(component.relationshipSearchResults()).toEqual([]);
  }));

  it('addRelationship tolerates a missing id', () => {
    component.editingProductId.set('pid');
    component.addRelationship({} as any, 'related');
    expect(component.relationshipsRelatedIds()).toEqual([]);
  });

  it('translationDiffRows tolerates null translation maps', () => {
    component.translations = { ro: null, en: null } as any;
    const rows = component.translationDiffRows();
    expect(rows.length).toBe(3);
  });

  it('saveTranslation falls back to the trimmed name when response name is empty', () => {
    component.editingSlug.set('s1');
    component.translations.en = {
      name: 'Name',
      short_description: '',
      long_description: '',
    } as any;
    spies.admin.upsertProductTranslation.and.returnValue(
      of({ name: '', short_description: '', long_description: '' } as any),
    );
    component.saveTranslation('en');
    expect(component.translations.en.name).toBe('Name');
  });

  it('retryImageUpload and removeImageUpload tolerate falsy ids', () => {
    component.retryImageUpload(null as any);
    component.removeImageUpload(null as any);
    expect(component.imageUploads()).toEqual([]);
  });

  it('updateImageUpload returns for empty id and skips non-matching items', () => {
    component.imageUploads.set([
      { id: 'u1', fileName: 'a', bytes: 1, status: 'queued', progress: 0, error: null } as any,
      { id: 'u2', fileName: 'b', bytes: 1, status: 'queued', progress: 0, error: null } as any,
    ]);
    (component as any).updateImageUpload('', { progress: 50 });
    expect(component.imageUploads()[0].progress).toBe(0);
    (component as any).updateImageUpload('u2', { progress: 50 });
    expect(component.imageUploads()[0].progress).toBe(0);
    expect(component.imageUploads()[1].progress).toBe(50);
  });

  it('onUpload tolerates a target without files', () => {
    component.editingSlug.set('s1');
    component.onUpload({ target: { value: '' } } as any);
    expect(component.imageUploads()).toEqual([]);
  });

  it('maybeStartImageUpload ignores events after the active upload changes', () => {
    component.editingSlug.set('s1');
    (component as any).imageUploadFiles.set('u1', new File(['a'], 'a.png'));
    component.imageUploads.set([
      { id: 'u1', fileName: 'a.png', bytes: 0, status: 'queued', progress: 0, error: null } as any,
    ]);
    const subject = new Subject<any>();
    spies.admin.uploadProductImageWithProgress.and.returnValue(subject.asObservable());
    (component as any).maybeStartImageUpload();
    (component as any).imageUploadActiveId = 'other';
    subject.next({ type: HttpEventType.UploadProgress, loaded: 1, total: 0 } as any);
    subject.next({ type: HttpEventType.Response, body: { images: [] } } as any);
    subject.error(new Error('x'));
    expect(component.imageUploads()[0].status).toBe('uploading');
  });

  it('maybeStartImageUpload computes zero progress when totals are missing', () => {
    component.editingSlug.set('s1');
    (component as any).imageUploadFiles.set('u1', new File(['a'], 'a.png'));
    component.imageUploads.set([
      { id: 'u1', fileName: 'a.png', bytes: 0, status: 'queued', progress: 0, error: null } as any,
    ]);
    spies.admin.uploadProductImageWithProgress.and.returnValue(
      of({ type: HttpEventType.UploadProgress, loaded: 5, total: 0 } as any),
    );
    (component as any).maybeStartImageUpload();
    expect(component.imageUploads()[0].progress).toBe(0);
  });

  it('makeImagePrimary ignores an empty image id', () => {
    component.editingSlug.set('s1');
    component.makeImagePrimary('   ');
    expect(spies.admin.reorderProductImage).not.toHaveBeenCalled();
  });

  it('deleteImage sorts the returned images', () => {
    component.editingSlug.set('s1');
    spies.admin.deleteProductImage.and.returnValue(
      of({
        images: [
          { id: 'i2', sort_order: 2 },
          { id: 'i1', sort_order: 1 },
        ],
      } as any),
    );
    component.deleteImage('i9');
    expect(component.images()[0].id).toBe('i1');
  });

  it('restoreDeletedImage tolerates a non-array images payload', () => {
    component.editingSlug.set('s1');
    spies.admin.restoreProductImage.and.returnValue(of({ images: null } as any));
    component.restoreDeletedImage('i1');
    expect(component.images()).toEqual([]);
  });

  it('saveImageMeta sends null alt when only caption is present', () => {
    component.editingSlug.set('s1');
    component.editingImageId.set('i1');
    component.imageMeta = {
      en: { alt_text: '', caption: 'Cap' },
      ro: { alt_text: '', caption: '' },
    } as any;
    component.saveImageMeta();
    const args = spies.admin.upsertProductImageTranslation.calls.mostRecent().args;
    expect(args[3].alt_text).toBeNull();
  });

  it('reprocessImage tolerates a null stats response', () => {
    component.editingSlug.set('s1');
    component.editingImageId.set('i1');
    spies.admin.reprocessProductImage.and.returnValue(of(null as any));
    component.reprocessImage();
    expect(component.imageStats).toBeNull();
  });

  it('load maps translation filters and tolerates missing response fields', () => {
    component.translationFilter = 'missing_any';
    spies.productsApi.search.and.returnValue(of({ items: null, meta: null } as any));
    (component as any).load();
    expect(component.products()).toEqual([]);
    expect(component.meta()).toBeNull();
    component.translationFilter = 'missing_ro';
    (component as any).load();
    expect(spies.productsApi.search.calls.mostRecent().args[0].missing_translation_lang).toBe('ro');
  });

  it('loadCategories and loadAdminCategories tolerate null responses', () => {
    spies.catalog.listCategories.and.returnValue(of(null as any));
    (component as any).loadCategories();
    expect(component.categories()).toEqual([]);
    spies.admin.getCategories.and.returnValue(of(null as any));
    (component as any).loadAdminCategories();
    expect(component.adminCategories()).toEqual([]);
  });

  it('loadDeletedImages tolerates a non-array response', () => {
    spies.admin.listDeletedProductImages.and.returnValue(of(null as any));
    (component as any).loadDeletedImages('s1');
    expect(component.deletedImages()).toEqual([]);
  });

  it('loadImageMeta tolerates null translations', () => {
    component.editingSlug.set('s1');
    component.editingImageId.set('i1');
    spies.admin.getProductImageTranslations.and.returnValue(of(null as any));
    (component as any).loadImageMeta('s1', 'i1');
    expect(component.imageMetaExists.en).toBeFalse();
  });

  it('loadAudit tolerates a non-array response', () => {
    spies.admin.getProductAudit.and.returnValue(of(null as any));
    (component as any).loadAudit('s1');
    expect(component.auditEntries()).toEqual([]);
  });

  it('loadTranslations tolerates null items and missing fields', () => {
    spies.admin.getProductTranslations.and.returnValue(of(null as any));
    (component as any).loadTranslations('s1');
    expect(component.translationExists.en).toBeFalse();
    spies.admin.getProductTranslations.and.returnValue(of([{ lang: 'en' }] as any));
    (component as any).loadTranslations('s1');
    expect(component.translations.en.name).toBe('');
  });

  it('buildShortDescription falls back to a blank-only long description', () => {
    component.form.short_description = '';
    component.form.long_description = '   ';
    expect((component as any).buildShortDescription()).toBeNull();
  });

  it('money parsing helpers tolerate null and edge inputs', () => {
    expect((component as any).parseMoneyInput(null)).toBeNull();
    expect((component as any).parseMoneyInput('5.')).toBe(5);
    expect((component as any).parseSignedMoneyInput(null)).toBeNull();
    expect((component as any).formatMoneyInput(NaN)).toBe('');
  });

  it('buildPriceHistoryChart tolerates invalid sale dates', () => {
    component.form.base_price = '15';
    component.form.sale_start_at = 'garbage';
    component.form.sale_end_at = 'garbage';
    expect((component as any).buildPriceHistoryChart([])).not.toBeNull();
  });
});

describe('AdminProductsComponent residual branch coverage', () => {
  let component: AnyComponent;
  let spies: Spies;

  beforeEach(() => {
    const created = setup();
    component = created.component;
    spies = created.spies;
  });

  it('startInlineEdit handles a non-numeric falsy base price and nullish sale value', () => {
    component.startInlineEdit(
      listItem({ id: 'p1', base_price: undefined, sale_type: 'percent', sale_value: undefined }),
    );
    expect(component.inlineBasePrice).toBe('0.00');
    expect(component.inlineSaleEnabled).toBeFalse();
  });

  it('onInlineSaleValueChange clears error when the value is unchanged', () => {
    component.inlineSaleEnabled = true;
    component.inlineSaleType = 'amount';
    component.onInlineSaleValueChange('10');
    expect(component.inlineSaleError).toBe('');
  });

  it('onSaleValueChange sets the value hint when sanitized', () => {
    component.form.base_price = '100';
    component.form.sale_enabled = true;
    component.form.sale_type = 'amount';
    component.onSaleValueChange('5a');
    expect(component.saleValueError).toBe('adminUi.products.sale.valueHint');
  });

  it('edit covers a non-numeric sale_price and the secondary sale gate', fakeAsync(() => {
    spies.admin.getProduct.and.returnValue(
      of({
        slug: 'p',
        base_price: 10,
        sale_price: NaN,
        sale_type: 'amount',
        sale_value: '5',
      } as any),
    );
    component.edit('p');
    flush();
    expect(component.form.sale_enabled).toBeTrue();
  }));

  it('edit covers a percent sale and images without sort order', fakeAsync(() => {
    spies.admin.getProduct.and.returnValue(
      of({
        slug: 'p',
        base_price: 10,
        sale_type: 'percent',
        sale_value: 15,
        images: [{ id: 'i2' }, { id: 'i1' }],
      } as any),
    );
    component.edit('p');
    flush();
    expect(component.form.sale_type).toBe('percent');
    expect(component.images().length).toBe(2);
  }));

  it('save serializes sale schedule dates and images without sort order', () => {
    component.form.base_price = '10';
    component.form.sale_enabled = true;
    component.form.sale_type = 'percent';
    component.form.sale_value = '10';
    component.form.sale_start_at = '2030-01-01T00:00';
    component.form.sale_end_at = '2030-02-01T00:00';
    spies.admin.createProduct.and.returnValue(
      of({
        id: 'np',
        slug: 's',
        status: 'draft',
        is_active: true,
        images: [{ id: 'i2' }, { id: 'i1' }],
        tags: [],
      } as any),
    );
    component.save({ skipStatusConfirm: true });
    const payload = spies.admin.createProduct.calls.mostRecent().args[0] as any;
    expect(payload.sale_start_at).not.toBeNull();
    expect(payload.sale_end_at).not.toBeNull();
    expect(component.images().length).toBe(2);
  });

  it('runRelationshipSearch ignores stale responses', fakeAsync(() => {
    const subject = new Subject<any>();
    spies.productsApi.search.and.returnValue(subject.asObservable());
    (component as any).runRelationshipSearch('abc');
    (component as any).relationshipSearchRequestId += 5;
    subject.next(searchResponse([listItem({ id: 'z' })]));
    subject.complete();
    flush();
    expect(component.relationshipSearchResults()).toEqual([]);
  }));

  it('maybeStartImageUpload handles a response without an images array', () => {
    component.editingSlug.set('s1');
    (component as any).imageUploadFiles.set('u1', new File(['a'], 'a.png'));
    component.imageUploads.set([
      { id: 'u1', fileName: 'a.png', bytes: 1, status: 'queued', progress: 0, error: null } as any,
    ]);
    spies.admin.uploadProductImageWithProgress.and.returnValue(
      of({ type: HttpEventType.Response, body: {} } as any),
    );
    (component as any).maybeStartImageUpload();
    expect(component.imageUploads()[0].status).toBe('success');
  });

  it('maybeStartImageUpload reports an error without a request id', () => {
    component.editingSlug.set('s1');
    (component as any).imageUploadFiles.set('u1', new File(['a'], 'a.png'));
    component.imageUploads.set([
      { id: 'u1', fileName: 'a.png', bytes: 1, status: 'queued', progress: 0, error: null } as any,
    ]);
    spies.admin.uploadProductImageWithProgress.and.returnValue(throwError(() => new Error('x')));
    (component as any).maybeStartImageUpload();
    expect(component.imageUploads()[0].error).toBe('adminUi.products.errors.image');
  });

  it('maybeStartImageUpload ignores a stale completion', () => {
    component.editingSlug.set('s1');
    (component as any).imageUploadFiles.set('u1', new File(['a'], 'a.png'));
    component.imageUploads.set([
      { id: 'u1', fileName: 'a.png', bytes: 1, status: 'queued', progress: 0, error: null } as any,
    ]);
    const subject = new Subject<any>();
    spies.admin.uploadProductImageWithProgress.and.returnValue(subject.asObservable());
    (component as any).maybeStartImageUpload();
    (component as any).imageUploadActiveId = 'other';
    subject.complete();
    expect((component as any).imageUploadSub).not.toBeNull();
  });

  it('makeImagePrimary ignores a falsy image id', () => {
    component.editingSlug.set('s1');
    component.images.set([
      { id: 'i1', url: 'u1', sort_order: 1 },
      { id: 'i2', url: 'u2', sort_order: 2 },
    ]);
    component.makeImagePrimary('');
    expect(spies.admin.reorderProductImage).not.toHaveBeenCalled();
  });

  it('deleteImage and restoreDeletedImage sort images lacking sort order', () => {
    component.editingSlug.set('s1');
    spies.admin.deleteProductImage.and.returnValue(
      of({ images: [{ id: 'i2' }, { id: 'i1' }] } as any),
    );
    component.deleteImage('x');
    expect(component.images().length).toBe(2);
    spies.admin.restoreProductImage.and.returnValue(
      of({ images: [{ id: 'i2' }, { id: 'i1' }] } as any),
    );
    component.restoreDeletedImage('y');
    expect(component.images().length).toBe(2);
  });

  it('parseAuditMoney rejects non-finite numbers and strings', () => {
    expect((component as any).parseAuditMoney(Infinity)).toBeNull();
    expect((component as any).parseAuditMoney('1e999')).toBeNull();
  });

  it('loadImageMeta tolerates translations with blank alt and caption', () => {
    component.editingSlug.set('s1');
    component.editingImageId.set('i1');
    spies.admin.getProductImageTranslations.and.returnValue(of([{ lang: 'en' }] as any));
    (component as any).loadImageMeta('s1', 'i1');
    expect(component.imageMeta.en.alt_text).toBe('');
  });

  it('parseTagSlugs tolerates tags without a slug', () => {
    expect((component as any).parseTagSlugs([{ other: 1 }, { slug: 'keep' }])).toEqual(['keep']);
  });

  it('buildTags tolerates nullish loaded tag slugs', () => {
    (component as any).loadedTagSlugs = [null, 'keep'];
    component.form.is_bestseller = false;
    expect((component as any).buildTags()).toEqual(['keep']);
  });

  it('mergeTargetOptions covers null source parent', () => {
    component.categories.set([
      { id: 'a', slug: 'a', name: 'A', parent_id: null } as any,
      { id: 'b', slug: 'b', name: 'B', parent_id: null } as any,
    ]);
    const opts = component.mergeTargetOptions({
      id: 'a',
      slug: 'a',
      name: 'A',
      parent_id: null,
    } as any);
    expect(opts.map((c: any) => c.slug)).toEqual(['b']);
  });
});

describe('AdminProductsComponent final branch coverage', () => {
  let component: AnyComponent;
  let spies: Spies;

  beforeEach(() => {
    const created = setup();
    component = created.component;
    spies = created.spies;
  });

  it('runRelationshipSearch ignores a stale error response', fakeAsync(() => {
    const subject = new Subject<any>();
    spies.productsApi.search.and.returnValue(subject.asObservable());
    (component as any).runRelationshipSearch('abc');
    (component as any).relationshipSearchRequestId += 5;
    subject.error(new Error('x'));
    flush();
    expect(component.relationshipSearchLoading()).toBeTrue();
  }));

  it('maybeStartImageUpload sorts response images that both lack sort order', () => {
    component.editingSlug.set('s1');
    (component as any).imageUploadFiles.set('u1', new File(['a'], 'a.png'));
    component.imageUploads.set([
      { id: 'u1', fileName: 'a.png', bytes: 1, status: 'queued', progress: 0, error: null } as any,
    ]);
    spies.admin.uploadProductImageWithProgress.and.returnValue(
      of({ type: HttpEventType.Response, body: { images: [{ id: 'i1' }, { id: 'i2' }] } } as any),
    );
    (component as any).maybeStartImageUpload();
    expect(component.images().length).toBe(2);
  });

  it('maybeStartImageUpload includes the request id in the error message', () => {
    component.editingSlug.set('s1');
    (component as any).imageUploadFiles.set('u1', new File(['a'], 'a.png'));
    component.imageUploads.set([
      { id: 'u1', fileName: 'a.png', bytes: 1, status: 'queued', progress: 0, error: null } as any,
    ]);
    const httpErr = new HttpErrorResponse({
      status: 500,
      headers: new HttpHeaders({ 'X-Request-ID': 'req-9' }),
    });
    spies.admin.uploadProductImageWithProgress.and.returnValue(throwError(() => httpErr));
    (component as any).maybeStartImageUpload();
    expect(component.imageUploads()[0].error).toContain('req-9');
  });

  it('parseAuditMoney rejects a non-finite bigint', () => {
    const huge = BigInt('1' + '0'.repeat(400));
    expect((component as any).parseAuditMoney(huge)).toBeNull();
  });
});
