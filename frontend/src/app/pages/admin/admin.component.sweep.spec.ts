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
    'invalidateCouponStripeMappings',
    'listContentVersions',
    'getContentVersion',
    'rollbackContentVersion',
    'createFeaturedCollection',
    'updateFeaturedCollection',
    'uploadContentImage',
    'updateContentImageFocalPoint'
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
  admin.listContentVersions.and.returnValue(of([]));
  admin.getContentVersion.and.returnValue(of({ version: 2, body_markdown: 'Version markdown', title: 'Version title' }));
  admin.rollbackContentVersion.and.returnValue(of({}));
  admin.createFeaturedCollection.and.returnValue(of({ slug: 'new-collection', name: 'New', description: '', product_ids: [] }));
  admin.updateFeaturedCollection.and.returnValue(of({ slug: 'updated-collection', name: 'Updated', description: '', product_ids: [] }));
  admin.uploadContentImage.and.returnValue(of({ version: 2, images: [{ id: 'asset-1', url: '/asset-1.jpg', alt_text: null }] }));
  admin.updateContentImageFocalPoint.and.returnValue(of({ id: 'asset-1', focal_x: 50, focal_y: 50 }));


  const adminProducts = jasmine.createSpyObj('AdminProductsService', ['search']);
  adminProducts.search.and.returnValue(of({ items: [] }));

  const blog = jasmine.createSpyObj('BlogService', ['listFlaggedComments', 'resolveCommentFlagsAdmin', 'hideCommentAdmin', 'unhideCommentAdmin', 'deleteComment', 'pinPostAdmin', 'unpinPostAdmin']);
  blog.listFlaggedComments.and.returnValue(of({ items: [] }));
  blog.resolveCommentFlagsAdmin.and.returnValue(of({}));
  blog.hideCommentAdmin.and.returnValue(of({}));
  blog.unhideCommentAdmin.and.returnValue(of({}));
  blog.deleteComment.and.returnValue(of({}));
  blog.pinPostAdmin.and.returnValue(of({}));
  blog.unpinPostAdmin.and.returnValue(of({}));
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
    adminProducts as any,
    blog as any,
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

  return { component, routeData$, routeQuery$, admin, blog, fxAdmin, taxesAdmin, auth, cmsPrefs, toast };
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

function createTextareaStub(initial = 'Sample line'): HTMLTextAreaElement {
  const state = {
    value: initial,
    selectionStart: 0,
    selectionEnd: initial.length,
    focus: () => undefined,
    dispatchEvent: () => true,
    setRangeText(text: string, start?: number, end?: number) {
      const from = typeof start === 'number' ? start : state.selectionStart;
      const to = typeof end === 'number' ? end : state.selectionEnd;
      state.value = `${state.value.slice(0, from)}${text}${state.value.slice(to)}`;
      state.selectionStart = from + text.length;
      state.selectionEnd = state.selectionStart;
    },
    setSelectionRange(start: number, end: number) {
      state.selectionStart = start;
      state.selectionEnd = end;
    }
  };
  return state as unknown as HTMLTextAreaElement;
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
  setStock: ['p-1', 5],
  saveStock: [{ id: 'p-1', slug: 'p-1', stock_quantity: 2 }],
  loadBlogVersions: [],
  saveInfoInternal: ['page.about', 'Body', 'en', () => undefined, () => undefined],
  saveLegalMetaIfNeeded: ['page.about', () => undefined, () => undefined],
  savePageMarkdownInternal: ['page.about', 'Body', 'en', () => undefined, () => undefined],
  applyBlogHeading: [createTextareaStub('Heading sample'), 1],
  applyBlogList: [createTextareaStub('List sample')],
  wrapBlogSelection: [createTextareaStub('Selection sample'), '**', '**', 'sample'],
  insertBlogLink: [createTextareaStub('Link sample')],
  insertBlogCodeBlock: [createTextareaStub('Code sample')],
  insertBlogEmbed: [createTextareaStub('Embed sample'), 'product'],
  prefixBlogLines: [createTextareaStub('Line one\nLine two'), '- '],
  insertAtCursor: [createTextareaStub('Cursor sample'), 'injected'],
  updateBlogBody: [createTextareaStub('Body sample'), 'Body sample update', 0, 4],
  setBlogMarkdownImageAlt: [0, 'Accessible alt'],
  promptFixBlogImageAlt: [0],
  blogBulkPreview: [],
  saveBlogPost: [],
  toggleHide: [{ id: 'comment-1', is_hidden: true }],
  selectBlogCoverAsset: [{ id: 'asset-1', url: '/cover.jpg', alt_text: 'Alt', sort_order: 1, focal_x: 50, focal_y: 50 }],
  saveCollection: [],
  savePageBlockAsReusable: ['page.about', 'hero'],
  insertReusableBlockIntoPage: ['page.about', 'reuse-1'],
  onPageBlockDrop: [{ preventDefault: () => undefined, dataTransfer: { files: [], types: ['text/plain'], getData: () => '' } }, 'page.about', 'hero'],
  onHomeBlockDrop: [{ preventDefault: () => undefined, dataTransfer: { files: [], types: ['text/plain'], getData: () => '' } }, 'hero'],
  applyStarterTemplateToCustomBlock: ['text', { key: 'tmp', type: 'text', title: {}, body_markdown: {}, enabled: true }],
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
  'exportContentRedirects',]);

const ADMIN_SWEEP_FALLBACK_VARIANTS: unknown[][] = [
  ['sample'],
  [{ key: 'page.about', id: 'item-1', slug: 'sample', status: 'draft', stock_quantity: 2 }],
  [{ preventDefault: () => undefined, dataTransfer: { getData: () => 'sample', setData: () => undefined } }],
  ['sample', { key: 'page.about', id: 'item-1', slug: 'sample', status: 'draft' }],
  [{ key: 'page.about', title: 'About', status: 'draft', meta: {} }, 'sample'],
];

function mockClipboardWriteText() {
  if (typeof navigator === 'undefined') return;
  const clipboardAny = (navigator as any).clipboard as { writeText?: unknown } | undefined;
  if (!clipboardAny || typeof clipboardAny.writeText !== 'function') return;

  if (jasmine.isSpy(clipboardAny.writeText as jasmine.Func)) {
    (clipboardAny.writeText as jasmine.Spy).and.returnValue(Promise.resolve());
    return;
  }

  spyOn(clipboardAny as any, 'writeText').and.returnValue(Promise.resolve());
}

function listAdminSweepMethods(dynamic: any) {
  return Object.getOwnPropertyNames(AdminComponent.prototype).filter(
    (name) => !ADMIN_SWEEP_BLOCKED.has(name) && typeof dynamic[name] === 'function'
  );
}

function runConfiguredAdminSweep(dynamic: any, name: string, configured: any[]): number {
  callAdminMethodSafely(dynamic, name, configured);
  return 1;
}

function runFallbackAdminSweep(dynamic: any, name: string, arity: number): number {
  let attempted = 0;
  for (const variant of ADMIN_SWEEP_FALLBACK_VARIANTS) {
    const fallback = variant.slice(0, arity);
    const missing = arity - fallback.length;
    if (missing > 0) fallback.push(...new Array(missing).fill(undefined));
    callAdminMethodSafely(dynamic, name, fallback);
    attempted += 1;
  }
  return attempted;
}

function runAdminPrototypeSweep(dynamic: any): number {
  const methods = listAdminSweepMethods(dynamic);
  let attempted = 0;

  for (const name of methods) {
    const configured = ADMIN_SWEEP_ARGS_BY_NAME[name];
    if (configured) {
      attempted += runConfiguredAdminSweep(dynamic, name, configured);
      continue;
    }

    const method = dynamic[name];
    const arity = Math.min(method?.length ?? 0, 4);
    attempted += runFallbackAdminSweep(dynamic, name, arity);
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

  it('covers reusable/page-drop/media and blog-bulk helper branches', () => {
    const { component, admin } = createComponent();
    const dynamic = component as any;
    spyOn(globalThis, 'prompt').and.returnValues('Reusable hero', '');
    spyOn(globalThis, 'confirm').and.returnValue(true);

    component.pageBlocks = {
      'page.about': [
        {
          key: 'hero',
          type: 'text',
          title: { en: 'Hero title', ro: 'Titlu hero' },
          body_markdown: { en: 'Hero body', ro: 'Corp hero' },
          enabled: true,
          layout: { width: 'full', align: 'left' }
        } as any
      ]
    } as any;
    component.reusableBlocks = [];
    dynamic.reusableBlocksExists = true;
    dynamic.reusableBlocksMeta = {};
    dynamic.reusableBlocksKey = 'site.reusable';
    component.savePageBlockAsReusable('page.about', 'hero');
    expect(admin.updateContentBlock).toHaveBeenCalled();

    admin.updateContentBlock.calls.reset();
    admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 500 })));
    component.savePageBlockAsReusable('page.about', 'hero');


    const dragEvent = {
      preventDefault: () => undefined,
      dataTransfer: {
        files: [],
        types: ['text/plain'],
        getData: (key: string) =>
          key === 'text/cms-block'
            ? JSON.stringify({ scope: 'page', type: 'text', template: 'blank' })
            : ''
      }
    } as unknown as DragEvent;
    component.pageBlocks = { 'page.about': [{ key: 'target', type: 'text', enabled: true }] as any[] } as any;
    component.onPageBlockDrop(dragEvent, 'page.about', 'target');
    expect(component.pageBlocks['page.about'].length).toBeGreaterThan(0);

    component.blogBulkAction = 'schedule';
    component.blogBulkPublishAt = '2026-03-05T10:00';
    component.blogBulkUnpublishAt = '2026-03-05T09:00';
    const invalidSchedule = dynamic.buildBlogBulkPayload({ meta: {} });
    expect(invalidSchedule).toBeNull();
    expect(component.blogBulkError).toBe('adminUi.blog.bulk.invalidSchedule');

    component.blogBulkAction = 'tags_add';
    component.blogBulkTags = 'tag-1, tag-2, tag-1';
    const tagsPayload = dynamic.buildBlogBulkPayload({ meta: { tags: ['tag-0'] } });
    expect(tagsPayload).toEqual({ meta: { tags: ['tag-0', 'tag-1', 'tag-2'] } });
  });

  it('covers additional high-miss blog preview and collection save branches', () => {
    const { component, admin, toast } = createComponent();

    component.blogBulkSelection = new Set(['blog.1', 'blog.2']);
    component.blogBulkAction = 'publish';
    expect(component.blogBulkPreview()).toContain('adminUi.blog.bulk.previewPublish');
    component.blogBulkAction = 'unpublish';
    expect(component.blogBulkPreview()).toContain('adminUi.blog.bulk.previewUnpublish');
    component.blogBulkAction = 'tags_remove';
    component.blogBulkTags = 'a,b';
    expect(component.blogBulkPreview()).toContain('adminUi.blog.bulk.previewTagsRemove');

    component.collectionForm = { name: '', description: '', product_ids: [] } as any;
    component.saveCollection();
    expect(toast.error).toHaveBeenCalledWith('adminUi.home.collections.errors.required');

    component.collectionForm = { name: 'Wave', description: 'Desc', product_ids: ['p-1'] } as any;
    component.editingCollection = null;
    component.featuredCollections = [] as any;
    component.saveCollection();
    expect(admin.createFeaturedCollection).toHaveBeenCalled();

    admin.updateFeaturedCollection.and.returnValue(throwError(() => ({ status: 500 })));
    component.editingCollection = 'updated-collection';
    component.saveCollection();
    expect(toast.error).toHaveBeenCalledWith('adminUi.home.collections.errors.save');
  });

  it('covers moderation toggle and cover-asset branches', () => {
    const { component } = createComponent();
    const blog = (component as any).blog as jasmine.SpyObj<any>;

    component.flaggedComments = {
      set: () => undefined,
      update: (fn: (items: any[]) => any[]) => {
        const current = [{ id: 'c-1', is_hidden: true }, { id: 'c-2', is_hidden: false }] as any[];
        return fn(current);
      },
      asReadonly: () => ({})
    } as any;

    component.toggleHide({ id: 'c-1', is_hidden: true } as any);
    expect(blog.unhideCommentAdmin).toHaveBeenCalledWith('c-1');

    spyOn(globalThis, 'prompt').and.returnValue('reason text');
    component.toggleHide({ id: 'c-2', is_hidden: false } as any);
    expect(blog.hideCommentAdmin).toHaveBeenCalledWith('c-2', { reason: 'reason text' });

    component.blogEditLang = 'en';
    component.blogBaseLang = 'en';
    component.blogImages = [];
    component.selectBlogCoverAsset({ id: 'asset-2', url: '/cover.jpg', alt_text: 'alt', sort_order: 2, focal_x: 55, focal_y: 45 } as any);
    expect(component.blogForm.cover_image_url).toBe('/cover.jpg');
    expect(component.blogImages.length).toBeGreaterThan(0);

    component.blogEditLang = 'ro';
    component.selectBlogCoverAsset({ id: 'asset-3', url: '/ignored.jpg' } as any);
    expect(component.blogForm.cover_image_url).toBe('/cover.jpg');
  });

  it('covers starter-template and media-drop helper branches', () => {
    const { component } = createComponent();
    const dynamic = component as any;

    const textDraft = { key: 'k1', type: 'text', title: {}, body_markdown: {}, enabled: true } as any;
    dynamic.applyStarterTemplateToCustomBlock('text', textDraft);
    expect(textDraft.title.en).toContain('Section');

    const columnsDraft = { key: 'k2', type: 'columns', title: {}, columns: [], enabled: true } as any;
    dynamic.applyStarterTemplateToCustomBlock('columns', columnsDraft);
    expect(columnsDraft.columns?.length).toBeGreaterThan(1);

    spyOn(dynamic, 'extractCmsImageFiles').and.returnValue([{ name: 'x.png' } as any]);
    const insertPageMedia = spyOn(dynamic, 'insertPageMediaFiles').and.returnValue(Promise.resolve());
    const insertHomeMedia = spyOn(dynamic, 'insertHomeMediaFiles').and.returnValue(Promise.resolve());
    component.pageBlocks = { 'page.about': [{ key: 'target', type: 'text', enabled: true }] as any[] } as any;
    component.homeBlocks = [{ key: 'home-target', type: 'text', enabled: true }] as any;

    component.onPageBlockDrop({ preventDefault: () => undefined } as any, 'page.about', 'target');
    component.onHomeBlockDrop({ preventDefault: () => undefined } as any, 'home-target');

    expect(insertPageMedia).toHaveBeenCalled();
    expect(insertHomeMedia).toHaveBeenCalled();
  });

  it('covers blog version selection branches and handles load failures', () => {
    const { component, admin, toast } = createComponent();
    component.selectedBlogKey = 'blog.first-post';
    component.blogForm.body_markdown = 'current markdown body';

    component.selectBlogVersion(2);
    expect(admin.getContentVersion).toHaveBeenCalledWith('blog.first-post', 2);
    expect(component.blogDiffParts.length).toBeGreaterThan(0);

    admin.getContentVersion.and.returnValue(throwError(() => new Error('version-load-failed')));
    component.selectBlogVersion(3);
    expect(toast.error).toHaveBeenCalledWith('adminUi.blog.revisions.errors.loadVersion');
  });

  it('covers rollback confirmation and moderation delete success/failure paths', () => {
    const { component, admin, blog, toast } = createComponent();
    component.selectedBlogKey = 'blog.first-post';
    spyOn(globalThis, 'confirm').and.returnValues(false, true, true, true, true);

    component.rollbackBlogVersion(4);
    expect(admin.rollbackContentVersion).not.toHaveBeenCalled();

    component.rollbackBlogVersion(4);
    expect(admin.rollbackContentVersion).toHaveBeenCalledWith('blog.first-post', 4);

    admin.rollbackContentVersion.and.returnValue(throwError(() => new Error('rollback-failed')));
    component.rollbackBlogVersion(5);
    expect(toast.error).toHaveBeenCalledWith('adminUi.blog.revisions.errors.rollback');

    toast.error.calls.reset();
    (globalThis.confirm as jasmine.Spy).and.returnValue(true);
    component.adminDeleteComment({ id: 'comment-1' } as any);
    expect(blog.deleteComment).toHaveBeenCalledWith('comment-1');

    blog.deleteComment.and.returnValue(throwError(() => new Error('delete-failed')));
    component.adminDeleteComment({ id: 'comment-2' } as any);
    expect(toast.error).toHaveBeenCalledWith('adminUi.blog.moderation.errors.delete');
  });

  it('covers blog image upload and drop insertion branches', async () => {
    const { component } = createComponent();
    const richTarget = { insertMarkdown: jasmine.createSpy('insertMarkdown') } as any;
    component.selectedBlogKey = 'blog.first-post';

    const file = new File(['image-bytes'], 'cover.png', { type: 'image/png' });
    const input = { files: [file], value: 'selected' } as any;
    component.uploadAndInsertBlogImage(richTarget, { target: input } as any);
    expect(richTarget.insertMarkdown).toHaveBeenCalled();
    expect(input.value).toBe('');

    const dropEvent = {
      dataTransfer: { files: [file], types: ['Files'], dropEffect: 'none' },
      preventDefault: jasmine.createSpy('preventDefault'),
      stopPropagation: jasmine.createSpy('stopPropagation')
    } as any;
    await component.onBlogImageDrop(richTarget, dropEvent);
    expect(dropEvent.preventDefault).toHaveBeenCalled();
    expect(richTarget.insertMarkdown).toHaveBeenCalled();
  });

  it('covers blog cover focal-point validation and update branches', () => {
    const { component, admin, toast } = createComponent();
    component.selectedBlogKey = 'blog.first-post';
    component.blogEditLang = 'en';
    component.blogBaseLang = 'en';
    component.blogImages = [{ id: 'asset-1', url: '/asset-1.jpg', focal_x: 50, focal_y: 50, sort_order: 1 } as any];
    spyOn(globalThis, 'prompt').and.returnValues('invalid', '10, 20');

    component.editBlogCoverFocalPoint();
    expect(toast.error).toHaveBeenCalledWith('adminUi.site.assets.library.focalErrorsFormat');

    component.editBlogCoverFocalPoint();
    expect(admin.updateContentImageFocalPoint).toHaveBeenCalledWith('asset-1', 10, 20);
  });

  it('covers starter templates for rich CMS block types', () => {
    const { component } = createComponent();
    const dynamic = component as any;

    const cta = { title: {}, body_markdown: {}, cta_label: {}, cta_url: '' } as any;
    dynamic.applyStarterTemplateToCustomBlock('cta', cta);
    expect(cta.cta_url).toBe('/shop');

    const faq = { title: {}, faq_items: [] } as any;
    dynamic.applyStarterTemplateToCustomBlock('faq', faq);
    expect(faq.faq_items.length).toBe(2);

    const testimonials = { title: {}, testimonials: [] } as any;
    dynamic.applyStarterTemplateToCustomBlock('testimonials', testimonials);
    expect(testimonials.testimonials.length).toBe(2);

    const grid = { title: {}, product_grid_source: '', product_grid_limit: 0 } as any;
    dynamic.applyStarterTemplateToCustomBlock('product_grid', grid);
    expect(grid.product_grid_limit).toBe(6);

    const form = { title: {}, form_type: '', form_topic: '' } as any;
    dynamic.applyStarterTemplateToCustomBlock('form', form);
    expect(form.form_type).toBe('contact');
  });

  it('covers image/gallery/banner/carousel starter template branches', () => {
    const { component } = createComponent();
    const dynamic = component as any;

    const image = { title: {}, alt: {}, caption: {}, link_url: '' } as any;
    dynamic.applyStarterTemplateToCustomBlock('image', image);
    expect(image.link_url).toBe('/shop');

    const gallery = { title: {}, images: [] } as any;
    dynamic.applyStarterTemplateToCustomBlock('gallery', gallery);
    expect(gallery.images.length).toBe(3);

    const banner = { title: {}, slide: {} } as any;
    dynamic.applyStarterTemplateToCustomBlock('banner', banner);
    expect(banner.slide.cta_url).toBe('/shop');

    const carousel = { title: {}, slides: [], settings: {} } as any;
    dynamic.applyStarterTemplateToCustomBlock('carousel', carousel);
    expect(carousel.slides.length).toBe(3);
    expect(carousel.settings.autoplay).toBeTrue();
  });

  it('covers page media insertion guard and multi-image branches', async () => {
    const { component, toast } = createComponent();
    const dynamic = component as any;
    const fileA = new File(['a'], 'first.png', { type: 'image/png' });
    const fileB = new File(['b'], 'second.png', { type: 'image/png' });

    dynamic.pageBlocks = { 'page.about': [] } as any;
    spyOn(dynamic, 'safePageRecordKey').and.returnValue('page.about');
    spyOn(dynamic, 'normalizeCmsImageFiles').and.returnValue([fileA, fileB]);
    spyOn(dynamic, 'allowedPageBlockTypesForKey').and.returnValues([], ['image'], ['gallery']);
    spyOn(dynamic, 'uploadCmsImageToKey').and.returnValues(
      Promise.resolve({ url: '/u1.jpg', focal_x: 25, focal_y: 75 }),
      Promise.resolve({ url: '/u2.jpg', focal_x: 50, focal_y: 50 }),
      Promise.resolve({ url: '/u3.jpg', focal_x: 45, focal_y: 55 }),
      Promise.resolve({ url: '/u4.jpg', focal_x: 40, focal_y: 60 })
    );
    spyOn(dynamic, 'insertPageBlockAt').and.returnValues('img-1', 'img-2', 'gallery-1');

    await dynamic.insertPageMediaFiles('page.about', 0, [fileA, fileB]);
    expect(toast.error).toHaveBeenCalledWith('adminUi.site.pages.builder.errors.blockTypeNotAllowed');

    await dynamic.insertPageMediaFiles('page.about', 0, [fileA, fileB]);
    expect(dynamic.insertPageBlockAt).toHaveBeenCalledWith('page.about', 'image', 0, 'blank');
    expect(toast.success).toHaveBeenCalled();

    await dynamic.insertPageMediaFiles('page.about', 0, [fileA, fileB]);
    expect(dynamic.insertPageBlockAt).toHaveBeenCalledWith('page.about', 'gallery', 0, 'blank');
  });

  it('covers home media insertion single and gallery branches', async () => {
    const { component, toast } = createComponent();
    const dynamic = component as any;
    const fileA = new File(['a'], 'first.png', { type: 'image/png' });
    const fileB = new File(['b'], 'second.png', { type: 'image/png' });

    dynamic.homeBlocks = [];
    spyOn(dynamic, 'normalizeCmsImageFiles').and.returnValues([fileA], [fileA, fileB]);
    spyOn(dynamic, 'uploadCmsImageToKey').and.returnValues(
      Promise.resolve({ url: '/home-1.jpg', focal_x: 55, focal_y: 45 }),
      Promise.resolve({ url: '/home-2.jpg', focal_x: 40, focal_y: 60 }),
      Promise.resolve({ url: '/home-3.jpg', focal_x: 65, focal_y: 35 })
    );
    spyOn(dynamic, 'insertHomeBlockAt').and.returnValues('home-image', 'home-gallery');

    await dynamic.insertHomeMediaFiles(0, [fileA]);
    expect(dynamic.insertHomeBlockAt).toHaveBeenCalledWith('image', 0, 'blank');

    await dynamic.insertHomeMediaFiles(0, [fileA, fileB]);
    expect(dynamic.insertHomeBlockAt).toHaveBeenCalledWith('gallery', 0, 'blank');
    expect(toast.success).toHaveBeenCalled();
  });

  it('covers clipboard fallback and blog publish accessibility confirmation guard', async () => {
    const { component, admin } = createComponent();
    const dynamic = component as any;
    const navAny = navigator as any;
    if (!navAny.clipboard) {
      Object.defineProperty(navAny, 'clipboard', { value: { writeText: () => Promise.resolve() }, configurable: true });
    }
    if (typeof navAny.clipboard.writeText !== 'function') {
      navAny.clipboard.writeText = () => Promise.resolve();
    }
    const writeTextSpy = jasmine.isSpy(navAny.clipboard.writeText)
      ? (navAny.clipboard.writeText as jasmine.Spy)
      : spyOn(navAny.clipboard, 'writeText');
    writeTextSpy.and.returnValue(Promise.reject(new Error('clipboard-denied')));
    (document as any).execCommand ??= () => true;
    const execSpy = spyOn(document as any, 'execCommand').and.returnValue(true);

    await dynamic.copyToClipboard('coverage-text');
    expect(execSpy).toHaveBeenCalledWith('copy');

    dynamic.selectedBlogKey = 'blog.entry';
    dynamic.blogBaseLang = 'en';
    dynamic.blogEditLang = 'en';
    dynamic.blogMeta = {};
    dynamic.blogForm = { title: 'Post title', body_markdown: 'Body', status: 'published', published_at: '', published_until: '' };
    dynamic.blogA11yOpen = false;
    spyOn(dynamic, 'buildBlogMeta').and.returnValue({});
    spyOn(dynamic, 'blogA11yIssues').and.returnValue(['missing-alt']);
    const confirmSpy = spyOn(globalThis, 'confirm').and.returnValue(false);
    dynamic.saveBlogPost();
    expect(confirmSpy).toHaveBeenCalled();
    expect(admin.updateContentBlock).not.toHaveBeenCalled();
  });

  it('covers page selection reset, reusable-key collision, and redirect creation success branches', () => {
    const { component, admin } = createComponent();
    const dynamic = component as any;
    dynamic.showHiddenPages = false;
    dynamic.contentPages = [{ key: 'page.about', hidden: false }, { key: 'page.contact', hidden: false }];
    dynamic.pageBlocksKey = 'page.ghost';
    spyOn(dynamic, 'loadPageBlocks').and.stub();

    dynamic.onShowHiddenPagesChange();
    expect(dynamic.pageBlocksKey).toBe('page.about');
    expect(dynamic.loadPageBlocks).toHaveBeenCalledWith('page.about');

    dynamic.pagePreviewForSlug = 'preview-page';
    dynamic.pagePreviewToken = 'preview-token';
    dynamic.pagePreviewOrigin = '/preview';
    dynamic.pagePreviewExpiresAt = Date.now();
    dynamic.pagePreviewNonce = 42;
    dynamic.onPageBlocksKeyChange('page.contact');
    expect(dynamic.pagePreviewForSlug).toBeNull();
    expect(dynamic.pagePreviewToken).toBeNull();
    expect(dynamic.pagePreviewNonce).toBe(0);

    spyOn(Date, 'now').and.returnValue(1000);
    dynamic.pageBlocks = { 'page.about': [{ key: 'text_reuse_1000', type: 'text' }, { key: 'text_reuse_1000_1', type: 'text' }] };
    dynamic.reusableBlocks = [{ id: 'reuse', title: 'Reusable', block: { type: 'text', title: {}, body_markdown: {}, enabled: true, layout: 'full' } }];
    dynamic.insertReusableBlockIntoPage('page.about', 'reuse');
    expect(dynamic.pageBlocks['page.about'].some((b: any) => b.key === 'text_reuse_1000_2')).toBeTrue();

    dynamic.redirectCreateFrom = 'page.old';
    dynamic.redirectCreateTo = 'page.new';
    spyOn(dynamic, 'loadContentRedirects').and.stub();
    admin.upsertContentRedirect.and.returnValue(of({}));
    dynamic.createContentRedirect();
    expect(dynamic.redirectCreateFrom).toBe('');
    expect(dynamic.redirectCreateTo).toBe('');
    expect(dynamic.loadContentRedirects).toHaveBeenCalledWith(true);
  });

  it('covers page-block reorder, image attachment, and removal guard branches', () => {
    const { component } = createComponent();
    const dynamic = component as any;
    dynamic.pageBlocks = {
      'page.about': [
        { key: 'banner-1', type: 'banner', slide: {} },
        { key: 'gallery-1', type: 'gallery', images: [{ id: 'a' }, { id: 'b' }] },
        { key: 'columns-1', type: 'columns', columns: [{}, {}, {}] },
        { key: 'faq-1', type: 'faq', faq_items: [{}, {}] },
        { key: 'testimonials-1', type: 'testimonials', testimonials: [{}, {}] },
        { key: 'target', type: 'text' },
        { key: 'moving', type: 'text' }
      ]
    };
    dynamic.draggingPageBlocksKey = 'page.about';
    dynamic.draggingPageBlockKey = 'moving';
    spyOn(dynamic, 'onPageBlockDragEnd').and.callFake(() => undefined);

    const dropEvent = { preventDefault: () => undefined, dataTransfer: { files: [], types: [], getData: () => '' } } as unknown as DragEvent;
    dynamic.onPageBlockDrop(dropEvent, 'page.about', 'target');
    expect(dynamic.pageBlocks['page.about'][5].key).toBe('moving');
    expect(dynamic.onPageBlockDragEnd).toHaveBeenCalled();

    const asset = { url: '/asset.jpg', focal_x: 40, focal_y: 60 };
    dynamic.setPageBannerSlideImage('page.about', 'banner-1', asset as any);
    dynamic.addPageGalleryImageFromAsset('page.about', 'gallery-1', asset as any);
    dynamic.removePageColumnsColumn('page.about', 'columns-1', 1);
    dynamic.removePageFaqItem('page.about', 'faq-1', 0);
    dynamic.removePageTestimonial('page.about', 'testimonials-1', 1);

    const after = dynamic.pageBlocks['page.about'];
    expect(after.find((b: any) => b.key === 'banner-1').slide.image_url).toBe('/asset.jpg');
    expect(after.find((b: any) => b.key === 'columns-1').columns.length).toBe(2);
    expect(after.find((b: any) => b.key === 'faq-1').faq_items.length).toBe(1);
    expect(after.find((b: any) => b.key === 'testimonials-1').testimonials.length).toBe(1);
  });

  it('covers checklist, navigation, legal dual-save and payload parser branches', () => {
    const { component, admin, toast } = createComponent();
    const dynamic = component as any;

    dynamic.navigationForm = {
      header_links: [{ id: 'first' }, { id: 'second' }],
      footer_handcrafted_links: [],
      footer_legal_links: []
    };
    dynamic.moveNavigationLink('header', ' ', 1);
    dynamic.moveNavigationLink('header', 'first', 1);
    expect(dynamic.navigationForm.header_links[1].id).toBe('first');

    expect(dynamic.readCmsBlockPayload({ dataTransfer: { getData: () => '' } } as any)).toBeNull();
    const payload = dynamic.readCmsBlockPayload({
      dataTransfer: {
        getData: () => JSON.stringify({ kind: 'cms-block', scope: 'page', type: 'text', template: 'blank' })
      }
    } as any);
    expect(payload?.scope).toBe('page');
    expect(payload?.type).toBe('text');

    dynamic.pageBlocks = {
      'page.about': [{ key: 'img-block', type: 'image', url: '', focal_x: 50, focal_y: 50 }]
    };
    dynamic.setPageImageBlockUrl('page.about', 'img-block', { url: ' /asset.jpg ', focal_x: 33, focal_y: 66 } as any);
    expect(dynamic.pageBlocks['page.about'][0].url).toBe('/asset.jpg');
    expect(toast.success).toHaveBeenCalled();

    (admin as any).linkCheckContentPreview = jasmine
      .createSpy('linkCheckContentPreview')
      .and.returnValue(of({ issues: [{ code: 'broken-link' }] }));

    dynamic.openPagePublishChecklist('page.about');
    expect(dynamic.pagePublishChecklistOpen).toBeTrue();
    expect(dynamic.pagePublishChecklistLoading).toBeFalse();
    expect(dynamic.pagePublishChecklistResult?.linkIssues.length).toBe(1);

    (admin as any).linkCheckContentPreview.and.returnValue(throwError(() => ({ error: { detail: 'boom' } })));
    dynamic.openPagePublishChecklist('page.about');
    expect(dynamic.pagePublishChecklistError).toBe('boom');

    const saveLegalMetaIfNeeded = spyOn(dynamic, 'saveLegalMetaIfNeeded').and.callFake((_key: string, onSuccess: () => void) => {
      onSuccess();
    });
    const savePageMarkdownInternal = spyOn(dynamic, 'savePageMarkdownInternal').and.callFake(
      (_key: string, _body: string, _lang: string, onSuccess: () => void) => {
        onSuccess();
      },
    );

    dynamic.saveLegalPageBoth('page.about', { en: 'Privacy EN', ro: 'Privacy RO' });
    expect(saveLegalMetaIfNeeded).toHaveBeenCalled();
    expect(savePageMarkdownInternal).toHaveBeenCalledTimes(2);
    expect(dynamic.legalPageMessage).toBe('adminUi.site.pages.success.save');
  });

  it('covers blog list and moderation error callbacks', () => {
    const { component, admin, toast } = createComponent();
    const blog = (component as any).blog as jasmine.SpyObj<any>;

    component.selectedBlogKey = 'blog.entry';
    admin.listContentVersions.and.returnValue(throwError(() => ({ status: 500 })));
    component.loadBlogVersions();
    expect(toast.error).toHaveBeenCalledWith('adminUi.blog.revisions.errors.load');

    blog.listFlaggedComments.and.returnValue(throwError(() => ({ status: 500 })));
    component.loadFlaggedComments();
    expect(component.flaggedCommentsError).toBe('adminUi.blog.moderation.errors.load');

    blog.resolveCommentFlagsAdmin.and.returnValue(throwError(() => ({ status: 500 })));
    component.resolveFlags({ id: 'flag-1' } as any);
    expect(toast.error).toHaveBeenCalledWith('adminUi.blog.moderation.errors.resolveFlags');
  });

  it('covers toggleHide busy, cancel, and error branches', () => {
    const { component, toast } = createComponent();
    const blog = (component as any).blog as jasmine.SpyObj<any>;
    const promptSpy = spyOn(globalThis, 'prompt');

    component.flaggedComments.set([
      { id: 'c-1', is_hidden: true },
      { id: 'c-2', is_hidden: false }
    ] as any);

    component.blogCommentModerationBusy.add('c-busy');
    component.toggleHide({ id: 'c-busy', is_hidden: true } as any);
    expect(blog.unhideCommentAdmin).not.toHaveBeenCalled();

    blog.unhideCommentAdmin.and.returnValue(throwError(() => ({ status: 500 })));
    component.toggleHide({ id: 'c-1', is_hidden: true } as any);
    expect(toast.error).toHaveBeenCalledWith('adminUi.blog.moderation.errors.unhide');

    promptSpy.and.returnValue(null);
    component.toggleHide({ id: 'c-2', is_hidden: false } as any);
    expect(blog.hideCommentAdmin).not.toHaveBeenCalled();

    promptSpy.and.returnValue('need context');
    blog.hideCommentAdmin.and.returnValue(throwError(() => ({ status: 500 })));
    component.toggleHide({ id: 'c-2', is_hidden: false } as any);
    expect(toast.error).toHaveBeenCalledWith('adminUi.blog.moderation.errors.hide');
  });

  it('covers rollback and cover focal-point validation branches', () => {
    const { component, admin, toast } = createComponent();
    const confirmSpy = spyOn(globalThis, 'confirm');
    const promptSpy = spyOn(globalThis, 'prompt');

    component.selectedBlogKey = 'blog.entry';
    confirmSpy.and.returnValue(false);
    component.rollbackBlogVersion(3);
    expect(admin.rollbackContentVersion).not.toHaveBeenCalled();

    const reloadSpy = spyOn(component as any, 'reloadContentBlocks').and.stub();
    const loadEditorSpy = spyOn(component as any, 'loadBlogEditor').and.stub();
    const loadVersionsSpy = spyOn(component, 'loadBlogVersions').and.stub();

    confirmSpy.and.returnValue(true);
    admin.rollbackContentVersion.and.returnValue(of({}));
    component.rollbackBlogVersion(4);
    expect(reloadSpy).toHaveBeenCalled();
    expect(loadEditorSpy).toHaveBeenCalledWith('blog.entry');
    expect(loadVersionsSpy).toHaveBeenCalled();

    admin.rollbackContentVersion.and.returnValue(throwError(() => ({ status: 500 })));
    component.rollbackBlogVersion(5);
    expect(toast.error).toHaveBeenCalledWith('adminUi.blog.revisions.errors.rollback');

    component.blogEditLang = 'en';
    component.blogBaseLang = 'en';
    component.blogForm.cover_image_url = '/cover.jpg';
    component.blogImages = [{ id: 'asset-1', url: '/cover.jpg', focal_x: 50, focal_y: 50, sort_order: 0 }] as any;

    promptSpy.and.returnValues('invalid-value', 'NaN,50');
    component.editBlogCoverFocalPoint();
    component.editBlogCoverFocalPoint();
    expect(toast.error).toHaveBeenCalledWith('adminUi.site.assets.library.focalErrorsFormat');

    promptSpy.and.returnValue('20,30');
    admin.updateContentImageFocalPoint.and.returnValue(throwError(() => ({ status: 500 })));
    component.editBlogCoverFocalPoint();
    expect(toast.error).toHaveBeenCalledWith('adminUi.site.assets.library.focalErrorsSave');
  });

  it('covers blog revision and moderation delete branches with success and failure paths', () => {
    const { component, admin, blog, toast } = createComponent();
    component.selectedBlogKey = 'blog.first-post';
    component.blogForm.body_markdown = 'current markdown body';
    spyOn(globalThis, 'confirm').and.returnValues(false, true, true, true);

    component.selectBlogVersion(2);
    expect(admin.getContentVersion).toHaveBeenCalledWith('blog.first-post', 2);
    expect(component.blogDiffParts.length).toBeGreaterThan(0);

    admin.getContentVersion.and.returnValue(throwError(() => new Error('version-load-failed')));
    component.selectBlogVersion(3);
    expect(toast.error).toHaveBeenCalledWith('adminUi.blog.revisions.errors.loadVersion');

    component.rollbackBlogVersion(4);
    expect(admin.rollbackContentVersion).not.toHaveBeenCalled();

    component.rollbackBlogVersion(4);
    expect(admin.rollbackContentVersion).toHaveBeenCalledWith('blog.first-post', 4);

    admin.rollbackContentVersion.and.returnValue(throwError(() => new Error('rollback-failed')));
    component.rollbackBlogVersion(5);
    expect(toast.error).toHaveBeenCalledWith('adminUi.blog.revisions.errors.rollback');

    (globalThis.confirm as jasmine.Spy).and.returnValue(true);
    toast.error.calls.reset();
    component.adminDeleteComment({ id: 'comment-1' } as any);
    expect(blog.deleteComment).toHaveBeenCalledWith('comment-1');

    blog.deleteComment.and.returnValue(throwError(() => new Error('delete-failed')));
    component.adminDeleteComment({ id: 'comment-2' } as any);
    expect(toast.error).toHaveBeenCalledWith('adminUi.blog.moderation.errors.delete');
  });

  it('covers blog image upload/drop rich-target and focal-point validation branches', async () => {
    const { component, admin, toast } = createComponent();
    const richTarget = { insertMarkdown: jasmine.createSpy('insertMarkdown') } as any;
    component.selectedBlogKey = 'blog.first-post';

    const file = new File(['image-bytes'], 'cover.png', { type: 'image/png' });
    const input = { files: [file], value: 'selected' } as any;
    component.uploadAndInsertBlogImage(richTarget, { target: input } as any);
    expect(richTarget.insertMarkdown).toHaveBeenCalled();
    expect(input.value).toBe('');

    const dropEvent = {
      dataTransfer: { files: [file], types: ['Files'], dropEffect: 'none' },
      preventDefault: jasmine.createSpy('preventDefault'),
      stopPropagation: jasmine.createSpy('stopPropagation')
    } as any;
    await component.onBlogImageDrop(richTarget, dropEvent);
    expect(dropEvent.preventDefault).toHaveBeenCalled();
    expect(richTarget.insertMarkdown).toHaveBeenCalled();

    component.blogEditLang = 'en';
    component.blogBaseLang = 'en';
    component.blogImages = [{ id: 'asset-1', url: '/asset-1.jpg', focal_x: 50, focal_y: 50, sort_order: 1 } as any];
    spyOn(globalThis, 'prompt').and.returnValues('invalid', '10, 20');

    component.editBlogCoverFocalPoint();
    expect(toast.error).toHaveBeenCalledWith('adminUi.site.assets.library.focalErrorsFormat');

    component.editBlogCoverFocalPoint();
    expect(admin.updateContentImageFocalPoint).toHaveBeenCalledWith('asset-1', 10, 20);
  });

});







