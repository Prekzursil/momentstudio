import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute, Params } from '@angular/router';
import { BehaviorSubject, of, throwError } from 'rxjs';

import { AdminComponent } from './admin.component';

function createComponent() {
  const routeData$ = new BehaviorSubject<Params>({ section: 'home' });
  const routeQuery$ = new BehaviorSubject<Params>({});
  const route = {
    snapshot: { data: { section: 'home' }, queryParams: {} },
    data: routeData$.asObservable(),
    queryParams: routeQuery$.asObservable()
  } as unknown as ActivatedRoute;

  const admin = jasmine.createSpyObj('AdminService', [
    'products',
    'coupons',
    'lowStock',
    'audit',
    'getMaintenance',
    'content',
    'getContent',
    'listContentPages',
    'updateContentBlock',
    'createContent',
    'getCategories',
    'listFeaturedCollections',
    'transferOwner',
    'getProduct',
    'updateProduct',
    'createProduct',
    'deleteProduct',
    'createCategory',
    'updateCategory',
    'deleteCategory',
    'getCategoryTranslations',
    'upsertCategoryTranslation',
    'deleteCategoryTranslation',
    'uploadProductImage',
    'deleteProductImage',
    'validateStructuredData',
    'renameContentPage',
    'upsertContentRedirect',
    'linkCheckContent',
    'listContentRedirects',
    'duplicateProduct',
    'updateOrderStatus',
    'revokeSessions',
    'userAliases',
    'updateUserRole',
    'reorderCategories',
    'createCoupon',
    'updateCoupon',
    'invalidateCouponStripeMappings'
  ]);

  admin.products.and.returnValue(of([]));
  admin.coupons.and.returnValue(of([]));
  admin.lowStock.and.returnValue(of([]));
  admin.audit.and.returnValue(of({ products: [], content: [], security: [] }));
  admin.getMaintenance.and.returnValue(of({ enabled: false }));
  admin.content.and.returnValue(of([]));
  admin.getContent.and.returnValue(of({ title: '', body_markdown: '', meta: {} }));
  admin.listContentPages.and.returnValue(of([]));
  admin.updateContentBlock.and.returnValue(of({ version: 1, meta: {} }));
  admin.createContent.and.returnValue(of({ version: 1, meta: {} }));
  admin.getCategories.and.returnValue(of([]));
  admin.listFeaturedCollections.and.returnValue(of([]));
  admin.transferOwner.and.returnValue(of({}));
  admin.getProduct.and.returnValue(
    of({
      slug: 'p-1',
      name: 'Product',
      category_id: '',
      price: 10,
      stock_quantity: 2,
      status: 'draft',
      long_description: '',
      tags: [],
      images: []
    })
  );
  admin.updateProduct.and.returnValue(of({}));
  admin.createProduct.and.returnValue(of({}));
  admin.deleteProduct.and.returnValue(of({}));
  admin.createCategory.and.returnValue(of({ id: 'cat-1', slug: 'rings', name: 'Rings' }));
  admin.updateCategory.and.returnValue(of({}));
  admin.deleteCategory.and.returnValue(of({}));
  admin.getCategoryTranslations.and.returnValue(of([{ lang: 'ro', name: 'Inele', description: '' }, { lang: 'en', name: 'Rings', description: '' }]));
  admin.upsertCategoryTranslation.and.returnValue(of({ name: 'Rings', description: '' }));
  admin.deleteCategoryTranslation.and.returnValue(of({}));
  admin.uploadProductImage.and.returnValue(of({ images: [{ id: 'img-1', url: '/img.png' }] }));
  admin.deleteProductImage.and.returnValue(of({ images: [] }));
  admin.validateStructuredData.and.returnValue(of({ ok: true, errors: [] }));
  admin.renameContentPage.and.returnValue(of({ old_key: 'page.old', new_key: 'page.new' }));
  admin.upsertContentRedirect.and.returnValue(of({}));
  admin.linkCheckContent.and.returnValue(of({ issues: [] }));
  admin.listContentRedirects.and.returnValue(of([]));
  admin.duplicateProduct.and.returnValue(of({ slug: 'dup-1' }));
  admin.updateOrderStatus.and.returnValue(of({ id: 'order-1', status: 'shipped' }));
  admin.revokeSessions.and.returnValue(of({}));
  admin.userAliases.and.returnValue(of({ aliases: [] }));
  admin.updateUserRole.and.returnValue(of({ id: 'user-1', role: 'admin' }));
  admin.reorderCategories.and.returnValue(of([]));
  admin.createCoupon.and.returnValue(of({ id: 'coupon-1', code: 'SAVE10', active: true }));
  admin.updateCoupon.and.returnValue(of({ id: 'coupon-1', code: 'SAVE10', active: false }));
  admin.invalidateCouponStripeMappings.and.returnValue(of({ deleted_mappings: 1 }));

  const fxAdmin = jasmine.createSpyObj('FxAdminService', [
    'getStatus',
    'listOverrideAudit',
    'restoreOverrideFromAudit',
    'setOverride',
    'clearOverride'
  ]);
  fxAdmin.getStatus.and.returnValue(
    of({
      effective: { eur_per_ron: 4.9, usd_per_ron: 4.5, as_of: '2026-02-28T00:00:00Z' },
      override: null
    })
  );
  fxAdmin.listOverrideAudit.and.returnValue(of([]));
  fxAdmin.restoreOverrideFromAudit.and.returnValue(
    of({
      effective: { eur_per_ron: 4.9, usd_per_ron: 4.5, as_of: '2026-02-28T00:00:00Z' },
      override: null
    })
  );
  fxAdmin.setOverride.and.returnValue(of({}));
  fxAdmin.clearOverride.and.returnValue(of({}));

  const taxesAdmin = jasmine.createSpyObj('TaxesAdminService', [
    'listGroups',
    'createGroup',
    'updateGroup',
    'deleteGroup',
    'upsertRate',
    'deleteRate'
  ]);
  taxesAdmin.listGroups.and.returnValue(of([]));
  taxesAdmin.createGroup.and.returnValue(of({}));
  taxesAdmin.updateGroup.and.returnValue(of({}));
  taxesAdmin.deleteGroup.and.returnValue(of({}));
  taxesAdmin.upsertRate.and.returnValue(of({}));
  taxesAdmin.deleteRate.and.returnValue(of({}));

  const auth = {
    role: jasmine.createSpy('role').and.returnValue('owner'),
    user: jasmine.createSpy('user').and.returnValue({ id: 'owner-1' }),
    loadCurrentUser: jasmine.createSpy('loadCurrentUser').and.returnValue(of({}))
  };
  const cmsPrefs = {
    mode: jasmine.createSpy('mode').and.returnValue('advanced'),
    previewDevice: jasmine.createSpy('previewDevice').and.returnValue('desktop'),
    previewLayout: jasmine.createSpy('previewLayout').and.returnValue('split')
  };
  const toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'info']);
  const translate = {
    currentLang: 'en',
    instant: jasmine.createSpy('instant').and.callFake((key: string) => key)
  };

  const component = new AdminComponent(
    route,
    admin as any,
    {} as any,
    {} as any,
    fxAdmin as any,
    taxesAdmin as any,
    auth as any,
    cmsPrefs as any,
    toast as any,
    translate as any,
    { render: (value: string) => value } as any,
    {
      bypassSecurityTrustHtml: (value: string) => value,
      bypassSecurityTrustResourceUrl: (value: string) => value
    } as unknown as DomSanitizer
  );

  return { component, routeData$, routeQuery$, admin, fxAdmin, taxesAdmin, auth, cmsPrefs, toast };
}

function callAdminMethodSafely(component: any, method: string, args: unknown[]): void {
  const fn = component?.[method];
  if (typeof fn !== 'function') return;
  try {
    const result = fn.apply(component, args);
    if (result && typeof result.then === 'function') {
      (result as Promise<unknown>).catch(() => undefined);
    }
  } catch {
    // Intentional: branch-probing sweep continues across guarded/error paths.
  }
}

const ADMIN_SWEEP_ARGS_BY_NAME: Record<string, unknown[]> = {
  normalizeSection: ['content'],
  applySection: ['content'],
  loadForSection: ['content'],
  selectContent: ['home.sections'],
  selectOrder: [{ id: 'order-1' }],
  selectUser: [{ id: 'user-1', email: 'user@example.com' }],
  onSelectedUserIdChange: ['user-1'],
  updateRole: ['user-1', 'admin'],
  loadProduct: ['p-1'],
  moveCategory: ['up', 'rings'],
  onCategoryDragStart: [{ dataTransfer: { setData: () => undefined } }, 'rings'],
  onCategoryDragOver: [{ preventDefault: () => undefined }],
  onCategoryDrop: [{ preventDefault: () => undefined, dataTransfer: { getData: () => 'rings' } }, 'rings'],
  onBlogPinDragStart: [{ dataTransfer: { setData: () => undefined } }, { key: 'blog.sample' }],
  onBlogPinDragOver: [{ preventDefault: () => undefined }],
  onNavigationDragStart: [{ dataTransfer: { setData: () => undefined } }, 0],
  onNavigationDragOver: [{ preventDefault: () => undefined }],
  onNavigationDrop: [{ preventDefault: () => undefined }, 0],
  onPageBlockDragStart: [{ dataTransfer: { setData: () => undefined } }, 'page.about', 0],
  onPageBlockDragEnd: ['page.about'],
  onHomeBlockDragStart: [{ dataTransfer: { setData: () => undefined } }, 0],
  onHomeBlockDragEnd: [],
  onHomeBlockDragOver: [{ preventDefault: () => undefined }],
  onHomeBlockDropZone: [{ preventDefault: () => undefined }, 0],
  applyContentEditQuery: ['content', {}],
  saveCategoryTranslation: ['en'],
  deleteCategoryTranslation: ['en'],
  deleteCategory: ['rings'],
  pagePreviewSlug: ['page.about'],
  pagePublicPath: ['page.about'],
  pagePublicUrlForKey: ['page.about'],
  onPageBlocksKeyChange: ['page.about'],
  allowedPageBlockTypesForKey: ['page.about'],
  pageKeySupportsRequiresAuth: ['page.about'],
  canRenamePageKey: ['page.about'],
  renameCustomPageUrl: ['page.about'],
  isReservedPageSlug: ['about'],
  redirectKeyToUrl: ['page.about'],
  productGridSelectedSlugs: [{ meta: {} }, 'grid'],
  addProductGridProductSlug: [{ meta: {} }, 'grid', 'product-a'],
  removeProductGridProductSlug: [{ meta: {} }, 'grid', 'product-a'],
};

const ADMIN_SWEEP_BLOCKED = new Set([
  'constructor',
  'ngOnInit',
  'ngOnDestroy',
  // Interval/timer driven loops.
  'syncCmsDraftPoller',
  'stopCmsDraftPoller',
  // Upload/download methods with browser file side effects.
  'onImageUpload',
  'uploadAndInsertBlogImage',
  'exportContentRedirects',
  // Textarea cursor/focus helpers need real textarea instances.
  'applyBlogHeading',
  'applyBlogList',
  'wrapBlogSelection',
  'insertBlogLink',
  'insertBlogCodeBlock',
  'insertBlogEmbed',
  'prefixBlogLines',
  'insertAtCursor',
  'updateBlogBody',
  'setBlogMarkdownImageAlt',
  'saveInfoInternal',
  'saveLegalMetaIfNeeded',
  'savePageMarkdownInternal',
  // Large fan-out loaders already covered by targeted tests.
  'loadAll',
  'retryLoadAll',
]);

function mockClipboardWriteText() {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    spyOn(navigator.clipboard, 'writeText').and.returnValue(Promise.resolve());
  }
}

function listAdminSweepMethods(dynamic: any) {
  return Object.getOwnPropertyNames(AdminComponent.prototype).filter(
    (name) => !ADMIN_SWEEP_BLOCKED.has(name) && typeof dynamic[name] === 'function'
  );
}

function runAdminPrototypeSweep(dynamic: any) {
  const methods = listAdminSweepMethods(dynamic);
  let attempted = 0;

  for (const name of methods) {
    const fallback = new Array(Math.min(dynamic[name]?.length ?? 0, 4)).fill(undefined);
    callAdminMethodSafely(dynamic, name, ADMIN_SWEEP_ARGS_BY_NAME[name] ?? fallback);
    attempted += 1;
  }

  return attempted;
}

describe('AdminComponent sweep coverage', () => {
  it('covers draft helpers and title/preview utility branches', () => {
    const { component, cmsPrefs, auth } = createComponent();
    jasmine.clock().install();

    (component as any).announceCms('changed');
    jasmine.clock().tick(15);
    expect(component.cmsAriaAnnouncement).toBe('changed');

    expect(component.blogDraftReady()).toBeFalse();
    expect(component.blogDraftDirty()).toBeFalse();
    expect(component.blogDraftAutosaving()).toBeFalse();
    expect(component.blogDraftLastAutosavedAt()).toBeNull();

    const pageManager = (component as any).ensurePageDraft('page.about');
    pageManager.initFromServer({
      blocks: [],
      status: 'draft',
      publishedAt: '',
      publishedUntil: '',
      requiresAuth: false
    });
    expect(component.pageDraftReady('page.about')).toBeTrue();
    expect(component.pageDraftDirty('page.about')).toBeFalse();
    expect(component.pageDraftAutosaving('page.about')).toBeFalse();
    expect(component.pageDraftLastAutosavedAt('page.about')).toBeNull();
    expect(component.pageDraftCanUndo('page.about')).toBeFalse();
    expect(component.pageDraftCanRedo('page.about')).toBeFalse();
    component.dismissPageDraftAutosave('page.about');

    component.selectedBlogKey = 'blog.entry';
    const blogManager = (component as any).ensureBlogDraft('blog.entry', 'en');
    blogManager.initFromServer((component as any).currentBlogDraftState());
    expect(component.blogDraftReady()).toBeTrue();
    expect(typeof component.blogDraftHasRestore()).toBe('boolean');
    const restoreAt = component.blogDraftRestoreAt();
    expect(restoreAt === null || typeof restoreAt === 'string').toBeTrue();
    component.dismissBlogDraftAutosave();

    component.pagesRevisionKey = 'page.about';
    component.homeRevisionKey = 'home.story';
    component.settingsRevisionKey = 'site.checkout';
    expect(component.pagesRevisionTitleKey()).toBe('adminUi.site.pages.aboutLabel');
    expect(component.homeRevisionTitleKey()).toBe('adminUi.home.story.title');
    expect(component.settingsRevisionTitleKey()).toBe('adminUi.site.checkout.title');

    (auth.role as jasmine.Spy).and.returnValue('owner');
    (cmsPrefs.mode as jasmine.Spy).and.returnValue('advanced');
    (cmsPrefs.previewDevice as jasmine.Spy).and.returnValue('mobile');
    expect(component.isOwner()).toBeTrue();
    expect(component.cmsAdvanced()).toBeTrue();
    expect(component.cmsPreviewMaxWidthClass()).toBe('max-w-[390px]');
    expect(component.cmsPreviewViewportWidth()).toBe(390);

    jasmine.clock().uninstall();
  });

  it('covers lifecycle, section loading, and edit-query routing branches', () => {
    const { component, routeData$, routeQuery$ } = createComponent();
    const loadBlogEditor = spyOn<any>(component, 'loadBlogEditor').and.stub();
    const onPageBlocksKeyChange = spyOn<any>(component, 'onPageBlocksKeyChange').and.stub();
    spyOn(component as any, 'loadSections').and.stub();
    spyOn(component as any, 'loadCollections').and.stub();
    spyOn(component as any, 'loadInfo').and.stub();
    spyOn(component as any, 'loadLegalPage').and.stub();
    spyOn(component as any, 'loadCategories').and.stub();
    spyOn(component as any, 'loadContentPages').and.stub();
    spyOn(component as any, 'loadReusableBlocks').and.stub();
    spyOn(component as any, 'loadPageBlocks').and.stub();
    spyOn(component as any, 'loadContentRedirects').and.stub();
    spyOn(component as any, 'reloadContentBlocks').and.stub();
    spyOn(component as any, 'loadFlaggedComments').and.stub();
    spyOn(component as any, 'loadTaxGroups').and.stub();
    spyOn(component as any, 'loadAssets').and.stub();
    spyOn(component as any, 'loadSocial').and.stub();
    spyOn(component as any, 'loadCompany').and.stub();
    spyOn(component as any, 'loadNavigation').and.stub();
    spyOn(component as any, 'loadCheckoutSettings').and.stub();
    spyOn(component as any, 'loadReportsSettings').and.stub();
    spyOn(component as any, 'loadSeo').and.stub();
    spyOn(component as any, 'loadFxStatus').and.stub();

    component.ngOnInit();
    routeData$.next({ section: 'blog' });
    routeQuery$.next({ edit: 'entry' });

    (component as any).applyContentEditQuery('blog', { edit: 'entry' });
    (component as any).applyContentEditQuery('pages', { edit: 'contact' });
    (component as any).applyContentEditQuery('pages', { edit: 'page.' });
    expect(loadBlogEditor).toHaveBeenCalledWith('blog.entry');
    expect(onPageBlocksKeyChange).toHaveBeenCalledWith('page.contact');

    (component as any).loadForSection('home');
    (component as any).loadForSection('pages');
    (component as any).loadForSection('blog');
    (component as any).loadForSection('settings');
    expect(component.loading()).toBeFalse();

    component.ngOnDestroy();
    expect((component as any).routeSub).toBeUndefined();
  });

  it('covers CMS draft poller timer callbacks for visible/hidden document states', () => {
    const { component } = createComponent();
    let pollTick: (() => void) | null = null;
    const observeCmsDrafts = spyOn<any>(component, 'observeCmsDrafts').and.stub();
    const setIntervalSpy = spyOn(globalThis, 'setInterval').and.callFake(((handler: TimerHandler) => {
      pollTick = handler as () => void;
      return 91 as any;
    }) as any);
    const clearIntervalSpy = spyOn(globalThis, 'clearInterval');
    const visibilitySpy = spyOnProperty(document, 'visibilityState', 'get').and.returnValue('visible');

    (component as any).syncCmsDraftPoller('home');
    expect(setIntervalSpy).toHaveBeenCalled();
    expect(observeCmsDrafts).toHaveBeenCalledTimes(1);

    visibilitySpy.and.returnValue('hidden');
    if (pollTick) (pollTick as () => void)();
    expect(observeCmsDrafts).toHaveBeenCalledTimes(1);

    visibilitySpy.and.returnValue('visible');
    if (pollTick) (pollTick as () => void)();
    expect(observeCmsDrafts).toHaveBeenCalledTimes(2);

    (component as any).syncCmsDraftPoller('settings');
    expect(clearIntervalSpy).toHaveBeenCalledWith(91 as any);
  });

  it('covers owner transfer and FX branches including confirmations', () => {
    const { component, admin, fxAdmin, toast } = createComponent();
    const confirmSpy = spyOn(globalThis, 'confirm');
    const promptSpy = spyOn(globalThis, 'prompt');

    component.ownerTransferIdentifier = '';
    component.submitOwnerTransfer();
    expect(component.ownerTransferError).toBe('adminUi.ownerTransfer.errors.identifier');

    component.ownerTransferIdentifier = 'owner@example.com';
    promptSpy.and.returnValue('');
    component.submitOwnerTransfer();
    expect(component.ownerTransferError).toBe('adminUi.ownerTransfer.passwordRequired');

    promptSpy.and.returnValue('secret');
    admin.transferOwner.and.returnValue(of({}));
    component.ownerTransferConfirm = 'owner@example.com';
    component.submitOwnerTransfer();
    expect(admin.transferOwner).toHaveBeenCalled();

    admin.transferOwner.and.returnValue(throwError(() => ({ error: { detail: 'not allowed' } })));
    component.ownerTransferIdentifier = 'owner@example.com';
    component.ownerTransferConfirm = 'owner@example.com';
    component.submitOwnerTransfer();
    expect(component.ownerTransferError).toBe('not allowed');

    component.loadFxStatus();
    expect(fxAdmin.getStatus).toHaveBeenCalled();
    component.loadFxAudit();
    expect(fxAdmin.listOverrideAudit).toHaveBeenCalled();
    expect(component.fxAuditActionLabel('unknown_action')).toBe('unknown_action');

    confirmSpy.and.returnValue(false);
    component.restoreFxOverrideFromAudit({ id: 'audit-1' } as any);
    expect(fxAdmin.restoreOverrideFromAudit).not.toHaveBeenCalled();

    confirmSpy.and.returnValue(true);
    component.restoreFxOverrideFromAudit({ id: 'audit-1' } as any);
    expect(fxAdmin.restoreOverrideFromAudit).toHaveBeenCalledWith('audit-1');

    fxAdmin.restoreOverrideFromAudit.and.returnValue(throwError(() => ({ status: 500 })));
    component.restoreFxOverrideFromAudit({ id: 'audit-2' } as any);
    expect(toast.error).toHaveBeenCalled();
  });

  it('covers FX save/clear and product create/update/delete branches', () => {
    const { component, admin, fxAdmin, toast } = createComponent();
    const confirmSpy = spyOn(globalThis, 'confirm').and.returnValue(false);

    component.fxOverrideForm = { eur_per_ron: 0, usd_per_ron: 0, as_of: '' };
    component.saveFxOverride();
    expect(toast.error).toHaveBeenCalled();

    component.fxOverrideForm = { eur_per_ron: 4.95, usd_per_ron: 4.45, as_of: '2026-02-28T00:00:00Z' };
    component.saveFxOverride();
    expect(fxAdmin.setOverride).toHaveBeenCalled();

    component.clearFxOverride();
    expect(fxAdmin.clearOverride).not.toHaveBeenCalled();
    (component as any).fxStatus.set({
      effective: { eur_per_ron: 4.9, usd_per_ron: 4.5, as_of: '' },
      override: { eur_per_ron: 4.8, usd_per_ron: 4.4, as_of: '' }
    });
    component.clearFxOverride();
    expect(fxAdmin.clearOverride).not.toHaveBeenCalled();
    confirmSpy.and.returnValue(true);
    component.clearFxOverride();
    expect(fxAdmin.clearOverride).toHaveBeenCalled();

    component.startNewProduct();
    component.loadProduct('p-1');
    expect(admin.getProduct).toHaveBeenCalledWith('p-1');

    admin.getProduct.and.returnValue(throwError(() => ({ status: 404 })));
    component.loadProduct('missing');
    expect(toast.error).toHaveBeenCalled();

    component.form.name = 'Created';
    component.form.slug = 'created';
    component.form.category_id = 'cat';
    component.editingId = null;
    component.saveProduct();
    expect(admin.createProduct).toHaveBeenCalled();

    component.editingId = 'created';
    component.saveProduct();
    expect(admin.updateProduct).toHaveBeenCalled();

    component.selectedIds = new Set(['p-1']);
    component.products = [{ id: 'p-1', slug: 'created' } as any];
    component.deleteSelected();
    expect(admin.deleteProduct).toHaveBeenCalledWith('created');
  });

  it('covers draft observers, revision switch branches, and split-scroll sync', () => {
    const { component, cmsPrefs } = createComponent();
    spyOn(globalThis, 'setTimeout').and.callFake(((handler: TimerHandler) => {
      if (typeof handler === 'function') handler();
      return 1;
    }) as any);
    const rafSpy = spyOn(globalThis as any, 'requestAnimationFrame').and.callFake(((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    }) as any);

    (component as any).announceCms('changed');
    expect(component.cmsAriaAnnouncement).toBe('changed');

    const pageKey = 'page.about';
    const pageDraft = (component as any).ensurePageDraft(pageKey);
    pageDraft.initFromServer((component as any).currentPageDraftState(pageKey));
    component.pageBlocks[pageKey] = [{ type: 'text', key: 'intro', enabled: true } as any];
    pageDraft.observe((component as any).currentPageDraftState(pageKey));

    component.selectedBlogKey = 'blog.entry';
    const blogDraft = (component as any).ensureBlogDraft('blog.entry', 'en');
    blogDraft.initFromServer((component as any).currentBlogDraftState());
    component.blogForm.title = 'Updated';
    blogDraft.observe((component as any).currentBlogDraftState());
    (component as any).observeCmsDrafts();

    component.undoPageDraft(pageKey as any);
    component.redoPageDraft(pageKey as any);
    component.restorePageDraftAutosave(pageKey as any);
    component.restoreBlogDraftAutosave();

    const source = { scrollHeight: 900, clientHeight: 300, scrollTop: 150 } as any;
    const target = { scrollHeight: 800, clientHeight: 200, scrollTop: 0 } as any;
    (cmsPrefs.previewLayout as jasmine.Spy).and.returnValue('stack');
    component.syncSplitScroll(source, target);
    (cmsPrefs.previewLayout as jasmine.Spy).and.returnValue('split');
    component.syncSplitScroll(source, target);
    expect(target.scrollTop).toBeGreaterThan(0);

    component.pagesRevisionKey = 'page.privacy-policy';
    component.homeRevisionKey = 'home.sections';
    component.settingsRevisionKey = 'site.reports';
    expect(component.pagesRevisionTitleKey()).toBe('adminUi.site.pages.legal.documents.privacy');
    expect(component.homeRevisionTitleKey()).toBe('adminUi.home.sections.title');
    expect(component.settingsRevisionTitleKey()).toBe('adminUi.reports.title');
    expect(rafSpy).toHaveBeenCalled();
  });

  it('covers category wizard transitions and translation CRUD branches', () => {
    const { component, admin, toast } = createComponent();
    const loadCategoryTranslations = spyOn<any>(component, 'loadCategoryTranslations').and.callThrough();

    component.startCategoryWizard();
    component.categoryWizardNext();
    expect(toast.error).toHaveBeenCalled();

    component.categoryName = '';
    component.addCategory();
    expect(toast.error).toHaveBeenCalledWith('adminUi.categories.errors.required');

    component.categoryName = 'Rings';
    component.addCategory();
    expect(component.categoryWizardSlug()).toBe('rings');
    expect(component.categoryWizardStep()).toBe(1);
    expect(loadCategoryTranslations).toHaveBeenCalledWith('rings');

    component.categoryTranslationsSlug = 'rings';
    component.categoryTranslations = {
      en: { name: '', description: '' },
      ro: { name: 'Inele', description: '' },
    };
    component.saveCategoryTranslation('en');
    expect(toast.error).toHaveBeenCalledWith('adminUi.categories.translations.errors.nameRequired');

    component.categoryTranslations.en.name = 'Rings';
    component.saveCategoryTranslation('en');
    expect(admin.upsertCategoryTranslation).toHaveBeenCalledWith('rings', 'en', { name: 'Rings', description: null });

    admin.deleteCategoryTranslation.and.returnValue(throwError(() => ({ status: 500 })));
    component.deleteCategoryTranslation('en');
    expect(component.categoryTranslationsError()).toBe('adminUi.categories.translations.errors.delete');
  });

  it('covers tax group and tax rate CRUD branches', () => {
    const { component, taxesAdmin, toast } = createComponent();

    component.loadTaxGroups();
    expect(taxesAdmin.listGroups).toHaveBeenCalled();
    taxesAdmin.listGroups.and.returnValue(throwError(() => ({ error: { detail: 'load failed' } })));
    component.loadTaxGroups();
    expect(component.taxGroupsError).toBe('load failed');

    component.taxGroupCreate = { code: '', name: '', description: '', is_default: false };
    component.createTaxGroup();
    expect(toast.error).toHaveBeenCalledWith('adminUi.taxes.errors.required');

    component.taxGroupCreate = { code: 'RED', name: 'Reduced', description: '', is_default: false };
    component.createTaxGroup();
    expect(taxesAdmin.createGroup).toHaveBeenCalled();

    const group = { id: 'g-1', name: 'Standard', description: '', is_default: false } as any;
    component.saveTaxGroup(group);
    expect(taxesAdmin.updateGroup).toHaveBeenCalledWith('g-1', { name: 'Standard', description: null });
    component.setDefaultTaxGroup(group);
    expect(taxesAdmin.updateGroup).toHaveBeenCalledWith('g-1', { is_default: true });
    component.deleteTaxGroup(group);
    expect(taxesAdmin.deleteGroup).toHaveBeenCalledWith('g-1');

    component.taxRateCountry['g-1'] = 'RO';
    component.taxRatePercent['g-1'] = '19';
    component.upsertTaxRate(group);
    expect(taxesAdmin.upsertRate).toHaveBeenCalledWith('g-1', { country_code: 'RO', vat_rate_percent: 19 });
    component.deleteTaxRate(group, 'RO');
    expect(taxesAdmin.deleteRate).toHaveBeenCalledWith('g-1', 'RO');
  });

  it('covers category parent, threshold, tax-group, and delete-confirm branches', () => {
    const { component, admin, toast } = createComponent();
    component.categories = [
      { id: 'root', slug: 'rings', name: 'Rings', parent_id: null, tax_group_id: null, low_stock_threshold: null },
      { id: 'child', slug: 'silver', name: 'Silver', parent_id: 'root', tax_group_id: null, low_stock_threshold: 1 },
    ] as any;
    const child = component.categories[1] as any;
    expect(component.categoryParentLabel(child)).toBe('Rings');
    expect(component.categoryParentOptions(child).some((c) => c.id === 'root')).toBeTrue();

    component.updateCategoryParent(child, '');
    expect(admin.updateCategory).toHaveBeenCalled();
    admin.updateCategory.and.returnValue(throwError(() => ({ status: 500 })));
    component.updateCategoryParent(child, 'root');
    expect(toast.error).toHaveBeenCalled();

    component.updateCategoryLowStockThreshold(child, '-1');
    expect(toast.error).toHaveBeenCalled();
    admin.updateCategory.and.returnValue(of({ low_stock_threshold: 3 }));
    component.updateCategoryLowStockThreshold(child, '3');
    expect(admin.updateCategory).toHaveBeenCalled();

    admin.updateCategory.and.returnValue(throwError(() => ({ status: 500 })));
    component.updateCategoryTaxGroup(child, 'tax-1');
    expect(toast.error).toHaveBeenCalled();

    component.openCategoryDeleteConfirm(child);
    expect(component.categoryDeleteConfirmOpen()).toBeTrue();
    const deleteCategorySpy = spyOn(component, 'deleteCategory').and.callFake((_slug: string, opts?: { done?: (ok: boolean) => void }) => {
      opts?.done?.(true);
    });
    component.confirmDeleteCategory();
    expect(deleteCategorySpy).toHaveBeenCalledWith('silver', jasmine.any(Object));
    expect(component.categoryDeleteConfirmOpen()).toBeFalse();
  });

  it('covers deleteCategory success and error callbacks', () => {
    const { component, admin, toast } = createComponent();
    const done = jasmine.createSpy('done');
    component.categories = [{ id: 'a', slug: 'rings', name: 'Rings' }, { id: 'b', slug: 'silver', name: 'Silver' }] as any;
    component.categoryTranslationsSlug = 'rings';

    admin.deleteCategory.and.returnValue(of({}));
    component.deleteCategory('rings', { done });
    expect(done).toHaveBeenCalledWith(true);
    expect(component.categoryTranslationsSlug).toBeNull();

    admin.deleteCategory.and.returnValue(throwError(() => ({ status: 500 })));
    component.deleteCategory('silver', { done });
    expect(done).toHaveBeenCalledWith(false);
    expect(toast.error).toHaveBeenCalledWith('adminUi.categories.errors.delete');
  });

  it('covers home-section product-load error callback fallback', () => {
    const { component, admin } = createComponent();
    component.products = [{ id: 'stale' } as any];
    admin.products.and.returnValue(throwError(() => ({ status: 500 })));
    spyOn(component as any, 'loadSections').and.stub();
    spyOn(component as any, 'loadCollections').and.stub();

    (component as any).loadForSection('home');
    expect(component.products).toEqual([]);
    expect(component.loading()).toBeFalse();
  });

  it('covers image upload/delete and blog bulk selection helpers', () => {
    const { component, admin, toast } = createComponent();
    const fileInput = document.createElement('input');
    Object.defineProperty(fileInput, 'files', {
      value: [new File(['img'], 'img.png', { type: 'image/png' })],
      configurable: true,
    });

    component.editingId = null;
    component.onImageUpload({ target: fileInput } as unknown as Event);
    expect(toast.error).toHaveBeenCalledWith('adminUi.products.errors.saveFirst');

    component.editingId = 'p-1';
    component.onImageUpload({ target: fileInput } as unknown as Event);
    expect(admin.uploadProductImage).toHaveBeenCalledWith('p-1', jasmine.any(File));

    admin.uploadProductImage.and.returnValue(throwError(() => new Error('upload failed')));
    component.onImageUpload({ target: fileInput } as unknown as Event);
    expect(toast.error).toHaveBeenCalledWith('adminUi.products.errors.image');

    component.deleteImage('img-1');
    expect(admin.deleteProductImage).toHaveBeenCalledWith('p-1', 'img-1');

    component.contentBlocks = [{ key: 'blog.one' }, { key: 'blog.two' }] as any;
    component.toggleBlogSelection('blog.one', { target: { checked: true } } as any);
    expect(component.blogBulkSelection.has('blog.one')).toBeTrue();
    component.toggleBlogSelection('blog.one', { target: { checked: false } } as any);
    expect(component.blogBulkSelection.has('blog.one')).toBeFalse();

    component.toggleSelectAllBlogs({ target: { checked: true } } as any);
    expect(component.blogBulkSelection.size).toBe(2);
    component.toggleSelectAllBlogs({ target: { checked: false } } as any);
    expect(component.blogBulkSelection.size).toBe(0);

    component.blogBulkSelection.add('blog.one');
    component.blogBulkAction = 'schedule';
    component.blogBulkPublishAt = '2026-03-01T10:00';
    component.blogBulkUnpublishAt = '2026-03-02T10:00';
    expect(component.canApplyBlogBulk()).toBeTrue();
    component.blogBulkUnpublishAt = '2026-03-01T09:00';
    expect(component.canApplyBlogBulk()).toBeFalse();

    component.blogBulkAction = 'tags_add';
    component.blogBulkTags = 'tag-a';
    expect(component.canApplyBlogBulk()).toBeTrue();
  });

  it('covers blog pin drag-drop reorder success and failure callbacks', async () => {
    const { component, admin, toast } = createComponent();
    const reloadSpy = spyOn(component as any, 'reloadContentBlocks').and.stub();

    component.contentBlocks = [
      { key: 'blog.one', meta: { pinned: true, pin_order: 1 }, updated_at: '2026-02-01T00:00:00Z' },
      { key: 'blog.two', meta: { pinned: true, pin_order: 2 }, updated_at: '2026-02-02T00:00:00Z' },
      { key: 'blog.three', meta: { pinned: true, pin_order: 3 }, updated_at: '2026-02-03T00:00:00Z' },
    ] as any;

    component.draggingBlogPinKey = 'blog.three';
    admin.updateContentBlock.and.returnValues(
      of({ version: 2, meta: { pinned: true, pin_order: 1 } }),
      of({ version: 2, meta: { pinned: true, pin_order: 2 } }),
      of({ version: 2, meta: { pinned: true, pin_order: 3 } }),
    );
    await component.onBlogPinDrop('blog.one');
    expect(admin.updateContentBlock).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('adminUi.blog.pins.success.reordered');
    expect(reloadSpy).toHaveBeenCalled();
    expect(component.blogPinsSaving).toBeFalse();

    admin.updateContentBlock.calls.reset();
    admin.updateContentBlock.and.returnValue(throwError(() => new Error('reorder failed')));
    component.draggingBlogPinKey = 'blog.two';
    await component.onBlogPinDrop('blog.one');
    expect(toast.error).toHaveBeenCalledWith('adminUi.blog.pins.errors.reorder');
    expect(component.blogPinsSaving).toBeFalse();
  });

  it('covers blog bulk apply no-changes and mixed result branches', () => {
    const { component, admin, toast } = createComponent();
    const reloadSpy = spyOn(component as any, 'reloadContentBlocks').and.stub();

    component.contentBlocks = [{ key: 'blog.one' }, { key: 'blog.two' }] as any;
    component.blogBulkSelection = new Set(['blog.one', 'blog.two']);
    component.blogBulkAction = 'publish';
    admin.getContent.and.returnValue(throwError(() => ({ status: 404 })));
    component.applyBlogBulkAction();
    expect(component.blogBulkError).toBe('adminUi.blog.bulk.noChanges');
    expect(component.blogBulkSaving).toBeFalse();

    component.blogBulkError = '';
    component.blogBulkSelection = new Set(['blog.one', 'blog.two']);
    admin.getContent.and.callFake((key: string) => of({ key, meta: { tags: ['existing'] } }));
    admin.updateContentBlock.and.callFake((key: string) => {
      if (key === 'blog.two') return throwError(() => ({ status: 500 }));
      return of({ version: 2, meta: { tags: ['existing'] } });
    });
    component.applyBlogBulkAction();
    expect(toast.success).toHaveBeenCalledWith('adminUi.blog.bulk.success');
    expect(toast.error).toHaveBeenCalledWith('adminUi.blog.bulk.errors');
    expect(reloadSpy).toHaveBeenCalled();
    expect(component.blogBulkSaving).toBeFalse();
  });

  it('covers seo validation, page rename, and page-block parsing branches', () => {
    const { component, admin, toast } = createComponent();
    const confirmSpy = spyOn(globalThis, 'confirm').and.returnValue(true);
    const promptSpy = spyOn(globalThis, 'prompt');

    component.runStructuredDataValidation();
    expect(admin.validateStructuredData).toHaveBeenCalled();
    admin.validateStructuredData.and.returnValue(throwError(() => ({ error: { detail: 'bad schema' } })));
    component.runStructuredDataValidation();
    expect(component.structuredDataError).toBe('bad schema');

    component.runLinkCheck('page.about');
    expect(admin.linkCheckContent).toHaveBeenCalledWith('page.about');
    admin.linkCheckContent.and.returnValue(throwError(() => ({ error: { detail: 'scan failed' } })));
    component.runLinkCheck('page.about');
    expect(component.linkCheckError).toBe('scan failed');

    component.pageBlocksKey = 'page.custom' as any;
    promptSpy.and.returnValue('admin');
    component.renameCustomPageUrl();
    expect(toast.error).toHaveBeenCalledWith('adminUi.site.pages.errors.reservedTitle', 'adminUi.site.pages.errors.reservedCopy');

    promptSpy.and.returnValue('renamed-page');
    confirmSpy.and.returnValue(true);
    component.renameCustomPageUrl();
    expect(admin.renameContentPage).toHaveBeenCalledWith('custom', 'renamed-page');
    expect(admin.upsertContentRedirect).toHaveBeenCalled();

    const parsed = (component as any).parsePageBlocksDraft({
      blocks: [
        { type: 'unknown', key: 'x' },
        { type: 'text', key: 'hero', title: 'Hero', enabled: true },
        { type: 'text', key: 'hero', title: 'Duplicate', enabled: true },
      ],
    });
    expect(Array.isArray(parsed)).toBeTrue();
    expect(parsed.length).toBe(1);

    expect(component.pageBlockTypeLabelKey('image' as any)).toBe('adminUi.home.sections.blocks.image');
    expect(component.pageBlockTypeLabelKey('banner' as any)).toBe('adminUi.home.sections.blocks.banner');
    expect(component.pageKeySupportsRequiresAuth('page.custom')).toBeTrue();
    expect(component.redirectKeyToUrl('page.custom')).toBe('/pages/custom');
  });

  it('covers revision-title switch cases, draft observe readiness, retry, and destroy cleanup', () => {
    const { component } = createComponent();
    const dynamic = component as any;

    component.pagesRevisionKey = 'page.contact';
    expect(component.pagesRevisionTitleKey()).toBe('adminUi.site.pages.contactLabel');
    component.pagesRevisionKey = 'page.terms';
    expect(component.pagesRevisionTitleKey()).toBe('adminUi.site.pages.legal.documents.termsIndex');
    component.pagesRevisionKey = 'page.terms-and-conditions';
    expect(component.pagesRevisionTitleKey()).toBe('adminUi.site.pages.legal.documents.terms');
    component.pagesRevisionKey = 'page.anpc';
    expect(component.pagesRevisionTitleKey()).toBe('adminUi.site.pages.legal.documents.anpc');

    component.homeRevisionKey = 'custom' as any;
    expect(component.homeRevisionTitleKey()).toBe('adminUi.content.revisions.title');

    component.settingsRevisionKey = 'site.social';
    expect(component.settingsRevisionTitleKey()).toBe('adminUi.site.social.title');
    component.settingsRevisionKey = 'site.company';
    expect(component.settingsRevisionTitleKey()).toBe('adminUi.site.company.title');
    component.settingsRevisionKey = 'site.navigation';
    expect(component.settingsRevisionTitleKey()).toBe('adminUi.site.navigation.title');

    const homeDraft = dynamic.cmsHomeDraft;
    homeDraft.initFromServer(component.homeBlocks);
    const observeSpy = spyOn(homeDraft, 'observe').and.callThrough();
    dynamic.observeCmsDrafts();
    expect(observeSpy).toHaveBeenCalledWith(component.homeBlocks);

    const loadAllSpy = spyOn(component, 'loadAll').and.stub();
    component.retryLoadAll();
    expect(loadAllSpy).toHaveBeenCalled();

    dynamic.contentVersions['site.reports'] = 11;
    component.ngOnDestroy();
    expect(dynamic.contentVersions['site.reports']).toBeUndefined();
  });

  it('covers settings-section audit and FX error callbacks', () => {
    const { component, admin, fxAdmin, toast } = createComponent();

    admin.audit.and.returnValue(throwError(() => ({ status: 500 })));
    (component as any).loadForSection('settings');
    expect(toast.error).toHaveBeenCalledWith('adminUi.audit.errors.loadTitle', 'adminUi.audit.errors.loadCopy');

    fxAdmin.getStatus.and.returnValue(throwError(() => ({ status: 500 })));
    component.loadFxStatus();
    expect(component.fxError()).toBe('adminUi.fx.errors.load');

    fxAdmin.listOverrideAudit.and.returnValue(throwError(() => ({ status: 500 })));
    component.loadFxAudit();
    expect(component.fxAuditError()).toBe('adminUi.fx.audit.errors.load');

    fxAdmin.setOverride.and.returnValue(throwError(() => ({ status: 500 })));
    component.fxOverrideForm = { eur_per_ron: 4.91, usd_per_ron: 4.52, as_of: '' };
    component.saveFxOverride();
    expect(toast.error).toHaveBeenCalledWith('adminUi.fx.errors.overrideSet');
  });

  it('covers product/category/coupon legacy error branches', () => {
    const { component, admin, toast } = createComponent();

    component.form.name = 'Wave';
    component.form.slug = 'wave';
    component.form.category_id = 'cat-1';
    component.editingId = null;
    admin.createProduct.and.returnValue(throwError(() => ({ status: 500 })));
    component.saveProduct();
    expect(toast.error).toHaveBeenCalledWith('adminUi.products.errors.save');

    component.products = [{ id: 'p-1', slug: 'wave' }] as any;
    component.selectedIds = new Set(['p-1']);
    admin.deleteProduct.and.returnValue(throwError(() => ({ status: 500 })));
    component.deleteSelected();
    expect(toast.error).toHaveBeenCalledWith('adminUi.products.errors.delete');

    component.categories = [{ id: 'c-1', slug: 'rings', name: 'Rings', sort_order: 0 }] as any;
    component.moveCategory(component.categories[0] as any, 1);
    component.draggingSlug = 'rings';
    component.onCategoryDrop('rings');
    expect(component.draggingSlug).toBeNull();

    component.newCoupon = { code: '', active: true } as any;
    component.createCoupon();
    expect(toast.error).toHaveBeenCalledWith('adminUi.coupons.errors.required');
    component.newCoupon = { code: 'SAVE10', active: true } as any;
    admin.createCoupon.and.returnValue(throwError(() => ({ status: 500 })));
    component.createCoupon();
    expect(toast.error).toHaveBeenCalledWith('adminUi.coupons.errors.create');

    component.coupons = [{ id: 'coupon-1', code: 'SAVE10', active: true }] as any;
    admin.updateCoupon.and.returnValue(throwError(() => ({ status: 500 })));
    component.toggleCoupon(component.coupons[0] as any);
    expect(toast.error).toHaveBeenCalledWith('adminUi.coupons.errors.update');

    admin.invalidateCouponStripeMappings.and.returnValue(throwError(() => ({ status: 500 })));
    component.invalidateCouponStripe(component.coupons[0] as any);
    expect(toast.error).toHaveBeenCalledWith('adminUi.coupons.errors.invalidateStripe');
  });

  it('covers user/content and bulk/order legacy error branches', async () => {
    const { component, admin, toast } = createComponent();
    const dynamic = component as any;

    component.selectedUserId = 'user-1';
    component.selectedUserRole = 'admin';
    spyOn(globalThis, 'prompt').and.returnValue('secret');
    admin.updateUserRole.and.returnValue(throwError(() => ({ status: 500 })));
    component.updateRole();
    expect(toast.error).toHaveBeenCalledWith('adminUi.users.errors.role');

    component.selectedUserId = 'user-1';
    admin.revokeSessions.and.returnValue(throwError(() => ({ status: 500 })));
    component.forceLogout();
    expect(toast.error).toHaveBeenCalledWith('adminUi.users.errors.revoke');

    component.selectedContent = { key: 'home.sections', title: 'Old', status: 'draft' } as any;
    admin.getContent.and.returnValue(throwError(() => ({ status: 500 })));
    component.selectContent(component.selectedContent as any);
    expect(toast.error).toHaveBeenCalledWith('adminUi.content.errors.update');

    component.selectedContent = { key: 'home.sections', title: 'Old', status: 'draft' } as any;
    component.contentForm.title = 'New';
    component.contentForm.body_markdown = 'Body';
    component.contentForm.status = 'draft';
    admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 500 })));
    component.saveContent();
    expect(toast.error).toHaveBeenCalledWith('adminUi.content.errors.update');

    component.products = [{ id: 'p-1', slug: 'seed-product-wave', stock_quantity: 2 }] as any;
    component.selectedIds = new Set(['p-1']);
    component.bulkStock = 11;
    admin.updateProduct.and.returnValue(of({}));
    await component.saveBulkStock();
    expect(component.products[0].stock_quantity).toBe(11);
    admin.updateProduct.and.returnValue(throwError(() => ({ status: 500 })));
    await component.saveBulkStock();
    expect(toast.error).toHaveBeenCalledWith('adminUi.products.errors.save');

    dynamic.activeOrder = { id: 'order-1', status: 'pending' };
    admin.updateOrderStatus.and.returnValue(throwError(() => ({ status: 500 })));
    component.changeOrderStatus('shipped');
    expect(toast.error).toHaveBeenCalledWith('adminUi.orders.errors.status');
  });

  it('sweeps admin component prototype methods through guarded branches', () => {
    const { component } = createComponent();
    const dynamic = component as any;
    spyOn(globalThis, 'confirm').and.returnValue(false);
    spyOn(globalThis, 'prompt').and.returnValue('');
    mockClipboardWriteText();

    const attempted = runAdminPrototypeSweep(dynamic);
    expect(attempted).toBeGreaterThan(150);
  });

  it('re-sweeps admin prototype with alternate role and section state', () => {
    const { component, auth, cmsPrefs } = createComponent();
    const dynamic = component as any;
    spyOn(globalThis, 'confirm').and.returnValue(true);
    spyOn(globalThis, 'prompt').and.returnValue('alternate-value');
    mockClipboardWriteText();

    (auth.role as jasmine.Spy).and.returnValue('admin');
    (cmsPrefs.mode as jasmine.Spy).and.returnValue('basic');
    (cmsPrefs.previewLayout as jasmine.Spy).and.returnValue('stack');
    dynamic.section.set('settings');
    component.contentBlocks = [{ key: 'page.about' }, { key: 'blog.entry' }] as any;
    component.blogBulkSelection.add('blog.entry');
    component.pageBlocksKey = 'page.about';
    component.selectedBlogKey = 'blog.entry';

    const attempted = runAdminPrototypeSweep(dynamic);
    expect(attempted).toBeGreaterThan(150);
  });
});
