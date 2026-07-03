import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';

import { AdminComponent } from './admin.component';

type AnySpy = jasmine.SpyObj<any>;

interface Mocks {
  route: {
    snapshot: { data: Record<string, unknown>; queryParams: Record<string, unknown> };
    data: Subject<Record<string, unknown>>;
    queryParams: Subject<Record<string, unknown>>;
  };
  admin: AnySpy;
  adminProducts: AnySpy;
  blog: AnySpy;
  fxAdmin: AnySpy;
  taxesAdmin: AnySpy;
  auth: AnySpy;
  cmsPrefs: AnySpy;
  toast: AnySpy;
  translate: { instant: (k: string, p?: unknown) => string };
  markdown: { render: (v: string) => string };
  sanitizer: AnySpy;
}

function spyObj(name: string, methods: string[], obsValue: unknown = undefined): AnySpy {
  const spy = jasmine.createSpyObj(name, methods);
  for (const m of methods) (spy[m] as jasmine.Spy).and.returnValue(of(obsValue));
  return spy;
}

function build(
  section = 'home',
  query: Record<string, unknown> = {},
): { c: AdminComponent } & Mocks {
  const route = {
    snapshot: { data: { section }, queryParams: query },
    data: new Subject<Record<string, unknown>>(),
    queryParams: new Subject<Record<string, unknown>>(),
  };

  const admin = spyObj('AdminService', [
    'products',
    'coupons',
    'lowStock',
    'audit',
    'content',
    'getMaintenance',
    'setMaintenance',
    'getCategories',
    'createCategory',
    'updateCategory',
    'deleteCategory',
    'reorderCategories',
    'getCategoryTranslations',
    'upsertCategoryTranslation',
    'deleteCategoryTranslation',
    'listFeaturedCollections',
    'createFeaturedCollection',
    'updateFeaturedCollection',
    'getProduct',
    'createProduct',
    'updateProduct',
    'deleteProduct',
    'duplicateProduct',
    'uploadProductImage',
    'deleteProductImage',
    'getContent',
    'createContent',
    'updateContentBlock',
    'deleteContent',
    'getContentVersion',
    'listContentVersions',
    'rollbackContentVersion',
    'updateContentTranslationStatus',
    'uploadContentImage',
    'updateContentImageFocalPoint',
    'listContentPages',
    'renameContentPage',
    'createPagePreviewToken',
    'createHomePreviewToken',
    'listContentRedirects',
    'deleteContentRedirect',
    'exportContentRedirects',
    'importContentRedirects',
    'upsertContentRedirect',
    'previewFindReplaceContent',
    'applyFindReplaceContent',
    'linkCheckContent',
    'linkCheckContentPreview',
    'getSitemapPreview',
    'validateStructuredData',
    'sendScheduledReport',
    'updateOrderStatus',
    'createCoupon',
    'updateCoupon',
    'invalidateCouponStripeMappings',
    'updateUserRole',
    'userAliases',
    'revokeSessions',
    'transferOwner',
    'fetchSocialThumbnail',
  ]);
  const adminProducts = spyObj('AdminProductsService', ['search'], []);
  const blog = spyObj(
    'BlogService',
    [
      'createPreviewToken',
      'deleteComment',
      'hideCommentAdmin',
      'listFlaggedComments',
      'resolveCommentFlagsAdmin',
      'unhideCommentAdmin',
    ],
    [],
  );
  const fxAdmin = spyObj(
    'FxAdminService',
    ['clearOverride', 'getStatus', 'listOverrideAudit', 'restoreOverrideFromAudit', 'setOverride'],
    [],
  );
  const taxesAdmin = spyObj(
    'TaxesAdminService',
    ['deleteGroup', 'deleteRate', 'listGroups', 'updateGroup', 'createGroup', 'upsertRate'],
    [],
  );

  const auth = jasmine.createSpyObj('AuthService', ['role', 'loadCurrentUser']);
  auth.role.and.returnValue('owner');
  auth.loadCurrentUser.and.returnValue(of(null));

  const cmsPrefs = jasmine.createSpyObj('CmsEditorPrefsService', [
    'mode',
    'previewDevice',
    'previewLang',
    'previewLayout',
    'previewTheme',
    'translationLayout',
  ]);
  cmsPrefs.mode.and.returnValue('basic');
  cmsPrefs.previewDevice.and.returnValue('desktop');
  cmsPrefs.previewLang.and.returnValue('en');
  cmsPrefs.previewLayout.and.returnValue('stacked');
  cmsPrefs.previewTheme.and.returnValue('light');
  cmsPrefs.translationLayout.and.returnValue('tabs');

  const toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'info']);
  const translate = { instant: (k: string) => k };
  const markdown = { render: (v: string) => `R:${v}` };
  const sanitizer = jasmine.createSpyObj('DomSanitizer', ['bypassSecurityTrustResourceUrl']);
  sanitizer.bypassSecurityTrustResourceUrl.and.callFake((v: string) => ({ safe: v }));

  const c = new AdminComponent(
    {
      snapshot: route.snapshot,
      data: route.data.asObservable(),
      queryParams: route.queryParams.asObservable(),
    } as unknown as ActivatedRoute,
    admin as any,
    adminProducts as any,
    blog as any,
    fxAdmin as any,
    taxesAdmin as any,
    auth as any,
    cmsPrefs as any,
    toast as any,
    translate as any,
    markdown as any,
    sanitizer as unknown as DomSanitizer,
  );

  return {
    c,
    route,
    admin,
    adminProducts,
    blog,
    fxAdmin,
    taxesAdmin,
    auth,
    cmsPrefs,
    toast,
    translate,
    markdown,
    sanitizer,
  };
}

describe('AdminComponent', () => {
  beforeEach(() => {
    try {
      window.localStorage.clear();
    } catch {
      /* ignore */
    }
  });

  describe('route-driven initialization', () => {
    it('applies route snapshot section/edit query before reactive streams emit', () => {
      const env = build('blog', { edit: 'welcome-post' });
      const applySection = spyOn<any>(env.c, 'applySection').and.stub();
      const applyQuery = spyOn<any>(env.c, 'applyContentEditQuery').and.stub();
      const normalizeSection = spyOn<any>(env.c, 'normalizeSection').and.callThrough();

      env.c.ngOnInit();

      expect(normalizeSection).toHaveBeenCalledWith('blog');
      expect(applySection).toHaveBeenCalledWith('blog');
      expect(applyQuery).toHaveBeenCalledWith('blog', { edit: 'welcome-post' });

      env.route.data.next({ section: 'pages' });
      env.route.queryParams.next({ edit: 'about' });

      expect(applySection.calls.mostRecent().args[0]).toBe('pages');
      expect(applyQuery.calls.mostRecent().args).toEqual(['pages', { edit: 'about' }]);

      env.c.ngOnDestroy();
    });

    it('normalizes unknown sections to home and switches crumbs/state', () => {
      const env = build('home');
      spyOn<any>(env.c, 'loadForSection').and.stub();
      env.c.ngOnInit();
      expect(env.c.section()).toBe('home');

      env.route.data.next({ section: 'totally-bogus' });
      env.route.queryParams.next({});
      expect(env.c.section()).toBe('home');

      env.route.data.next({ section: 'pages' });
      env.route.queryParams.next({});
      expect(env.c.section()).toBe('pages');
      expect(env.c.crumbs[1].label).toBe('adminUi.content.nav.pages');
      env.c.ngOnDestroy();
    });

    it('falls back to empty queryParams when snapshot has none', () => {
      const env = build('home');
      spyOn<any>(env.c, 'loadForSection').and.stub();
      (env.c as any).route.snapshot.queryParams = undefined;
      expect(() => env.c.ngOnInit()).not.toThrow();
      env.c.ngOnDestroy();
    });
  });

  describe('applyContentEditQuery', () => {
    it('ignores blank edit values', () => {
      const env = build('blog');
      const loadBlogEditor = spyOn<any>(env.c, 'loadBlogEditor').and.stub();
      (env.c as any).applyContentEditQuery('blog', { edit: '   ' });
      expect(loadBlogEditor).not.toHaveBeenCalled();
    });

    it('prefixes a bare blog key and loads it once', () => {
      const env = build('blog');
      const loadBlogEditor = spyOn<any>(env.c, 'loadBlogEditor').and.stub();
      (env.c as any).applyContentEditQuery('blog', { edit: 'welcome' });
      expect(loadBlogEditor).toHaveBeenCalledWith('blog.welcome');
      env.c.selectedBlogKey = 'blog.welcome';
      (env.c as any).applyContentEditQuery('blog', { edit: 'blog.welcome' });
      expect(loadBlogEditor.calls.count()).toBe(1);
    });

    it('prefixes a bare page key and routes to page-block change', () => {
      const env = build('pages');
      const onPageKey = spyOn<any>(env.c, 'onPageBlocksKeyChange').and.stub();
      env.c.pageBlocksKey = 'page.contact';
      (env.c as any).applyContentEditQuery('pages', { edit: 'about' });
      expect(onPageKey).toHaveBeenCalledWith('page.about');
    });

    it('keeps a fully-qualified page key and skips no-op page changes', () => {
      const env = build('pages');
      const onPageKey = spyOn<any>(env.c, 'onPageBlocksKeyChange').and.stub();
      env.c.pageBlocksKey = 'page.contact';
      (env.c as any).applyContentEditQuery('pages', { edit: 'page.contact' });
      expect(onPageKey).not.toHaveBeenCalled();
    });
  });

  describe('loadForSection', () => {
    it('loads home data (products + sections + collections)', () => {
      const env = build('home');
      env.admin.products.and.returnValue(of([{ id: 'p1' }]));
      const loadSections = spyOn<any>(env.c, 'loadSections').and.stub();
      const loadCollections = spyOn<any>(env.c, 'loadCollections').and.stub();
      (env.c as any).loadForSection('home');
      expect(env.c.products).toEqual([{ id: 'p1' }] as any);
      expect(loadSections).toHaveBeenCalled();
      expect(loadCollections).toHaveBeenCalled();
      expect(env.c.loading()).toBeFalse();
    });

    it('resets products to [] when home products fail', () => {
      const env = build('home');
      env.admin.products.and.returnValue(throwError(() => new Error('x')));
      spyOn<any>(env.c, 'loadSections').and.stub();
      spyOn<any>(env.c, 'loadCollections').and.stub();
      (env.c as any).loadForSection('home');
      expect(env.c.products).toEqual([]);
    });

    it('loads the full pages workspace', () => {
      const env = build('pages');
      const spies = [
        'loadInfo',
        'loadLegalPage',
        'loadCategories',
        'loadCollections',
        'loadContentPages',
        'loadReusableBlocks',
        'loadPageBlocks',
        'loadContentRedirects',
      ].map((m) => spyOn<any>(env.c, m).and.stub());
      (env.c as any).loadForSection('pages');
      spies.forEach((s) => expect(s).toHaveBeenCalled());
      expect(env.c.loading()).toBeFalse();
    });

    it('loads blog data', () => {
      const env = build('blog');
      const reload = spyOn<any>(env.c, 'reloadContentBlocks').and.stub();
      const flagged = spyOn<any>(env.c, 'loadFlaggedComments').and.stub();
      (env.c as any).loadForSection('blog');
      expect(reload).toHaveBeenCalled();
      expect(flagged).toHaveBeenCalled();
    });

    it('loads the settings workspace and audit data', () => {
      const env = build('settings');
      spyOn<any>(env.c, 'reloadContentBlocks').and.stub();
      [
        'loadCategories',
        'loadTaxGroups',
        'loadNavigation',
        'loadReportsSettings',
        'loadSeo',
        'loadFxStatus',
      ].forEach((m) => spyOn<any>(env.c, m).and.stub());
      env.admin.coupons.and.returnValue(of([{ code: 'A' }]));
      env.admin.lowStock.and.returnValue(of([{ id: 'l1' }]));
      env.admin.audit.and.returnValue(of({ products: [1], content: [2], security: [3] }));
      env.admin.getMaintenance.and.returnValue(of({ enabled: true }));
      (env.c as any).loadForSection('settings');
      expect(env.c.coupons).toEqual([{ code: 'A' }] as any);
      expect(env.c.lowStock).toEqual([{ id: 'l1' }] as any);
      expect(env.c.productAudit).toEqual([1] as any);
      expect(env.c.securityAudit).toEqual([3] as any);
      expect(env.c.maintenanceEnabled()).toBeTrue();
      expect(env.c.maintenanceEnabledValue).toBeTrue();
    });

    it('handles settings load failures defensively', () => {
      const env = build('settings');
      spyOn<any>(env.c, 'reloadContentBlocks').and.stub();
      [
        'loadCategories',
        'loadTaxGroups',
        'loadNavigation',
        'loadReportsSettings',
        'loadSeo',
        'loadFxStatus',
      ].forEach((m) => spyOn<any>(env.c, m).and.stub());
      env.admin.coupons.and.returnValue(throwError(() => new Error('x')));
      env.admin.lowStock.and.returnValue(throwError(() => new Error('x')));
      env.admin.audit.and.returnValue(throwError(() => new Error('x')));
      env.admin.getMaintenance.and.returnValue(of({ enabled: false }));
      (env.c as any).loadForSection('settings');
      expect(env.c.coupons).toEqual([]);
      expect(env.c.lowStock).toEqual([]);
      expect(env.toast.error).toHaveBeenCalled();
    });

    it('uses [] security default when audit omits it', () => {
      const env = build('settings');
      env.admin.audit.and.returnValue(of({ products: [], content: [] }));
      env.c.loadAudit();
      expect(env.c.securityAudit).toEqual([]);
    });

    it('loadAudit reports a toast on failure', () => {
      const env = build('settings');
      env.admin.audit.and.returnValue(throwError(() => new Error('x')));
      env.c.loadAudit();
      expect(env.toast.error).toHaveBeenCalled();
    });
  });

  describe('loadAll / retry / discard', () => {
    it('loadAll + retryLoadAll delegate to the current section', () => {
      const env = build('home');
      const spy = spyOn<any>(env.c, 'loadForSection').and.stub();
      env.c.loadAll();
      env.c.retryLoadAll();
      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy.calls.mostRecent().args[0]).toBe('home');
    });

    it('discardUnsavedChanges discards ready home draft + page/blog drafts', () => {
      const env = build('home');
      (env.c as any).cmsHomeDraft.initFromServer([]);
      const homeDiscard = spyOn((env.c as any).cmsHomeDraft, 'discardAutosave').and.callThrough();
      const page = (env.c as any).ensurePageDraft('page.about');
      const pageDiscard = spyOn(page, 'discardAutosave').and.callThrough();
      env.c.discardUnsavedChanges();
      expect(homeDiscard).toHaveBeenCalled();
      expect(pageDiscard).toHaveBeenCalled();
    });

    it('hasUnsavedChanges reflects a dirty ready draft', () => {
      const env = build('home');
      expect(env.c.hasUnsavedChanges()).toBeFalse();
      const mgr = (env.c as any).cmsHomeDraft;
      mgr.initFromServer([{ key: 'a' }]);
      mgr.markServerSaved([{ key: 'a' }]);
      mgr.dirty = true;
      expect(env.c.hasUnsavedChanges()).toBeTrue();
    });
  });

  describe('CmsDraftManager via home draft helpers', () => {
    it('tracks ready/dirty/undo/redo lifecycle', () => {
      const env = build('home');
      const mgr = (env.c as any).cmsHomeDraft;
      expect(env.c.homeDraftReady()).toBeFalse();
      env.c.homeBlocks = [{ key: 'a' }] as any;
      mgr.initFromServer([{ key: 'a' }]);
      expect(env.c.homeDraftReady()).toBeTrue();
      expect(env.c.homeDraftDirty()).toBeFalse();
      expect(env.c.homeDraftCanUndo()).toBeFalse();

      env.c.homeBlocks = [{ key: 'a' }, { key: 'b' }] as any;
      expect(env.c.homeDraftCanUndo()).toBeTrue();
      env.c.undoHomeDraft();
      expect(env.c.homeBlocks).toEqual([{ key: 'a' }] as any);
      expect(env.c.homeDraftCanRedo()).toBeTrue();
      env.c.redoHomeDraft();
      expect(env.c.homeBlocks).toEqual([{ key: 'a' }, { key: 'b' }] as any);
      expect(env.c.homeDraftAutosaving()).toBeFalse();
      expect(typeof env.c.homeDraftLastAutosavedAt()).toBe('string');
    });

    it('restores and dismisses autosaved home drafts', () => {
      const env = build('home');
      window.localStorage.setItem(
        'adrianaart.cms.autosave.home.sections',
        JSON.stringify({
          v: 1,
          ts: '2026-01-01T00:00:00.000Z',
          state_json: JSON.stringify([{ key: 'restored' }]),
        }),
      );
      const mgr = (env.c as any).cmsHomeDraft;
      mgr.initFromServer([{ key: 'server' }]);
      expect(env.c.homeDraftHasRestore()).toBeTrue();
      expect(env.c.homeDraftRestoreAt()).toBe('2026-01-01T00:00:00.000Z');
      env.c.restoreHomeDraftAutosave();
      expect(env.c.homeBlocks).toEqual([{ key: 'restored' }] as any);
      env.c.dismissHomeDraftAutosave();
      expect(env.c.homeDraftHasRestore()).toBeFalse();
    });

    it('ignores a stored autosave identical to the server snapshot', () => {
      const env = build('home');
      const same = JSON.stringify([{ key: 'same' }]);
      window.localStorage.setItem(
        'adrianaart.cms.autosave.home.sections',
        JSON.stringify({ v: 1, ts: 't', state_json: same }),
      );
      (env.c as any).cmsHomeDraft.initFromServer([{ key: 'same' }]);
      expect(env.c.homeDraftHasRestore()).toBeFalse();
    });

    it('observe + commit debounce promotes pending state to dirty', () => {
      jasmine.clock().install();
      const env = build('home');
      const mgr = (env.c as any).cmsHomeDraft;
      mgr.initFromServer([{ key: 'a' }]);
      mgr.observe([{ key: 'a' }, { key: 'b' }]);
      expect(mgr.autosavePending).toBeTrue();
      jasmine.clock().tick(700);
      expect(mgr.autosavePending).toBeFalse();
      expect(mgr.dirty).toBeTrue();
      mgr.markServerSaved([{ key: 'a' }, { key: 'b' }]);
      expect(mgr.dirty).toBeFalse();
      jasmine.clock().uninstall();
    });
  });

  describe('page + blog draft helpers', () => {
    it('exposes page draft lifecycle accessors', () => {
      const env = build('pages');
      const key = 'page.about' as const;
      expect(env.c.pageDraftReady(key)).toBeFalse();
      const mgr = (env.c as any).ensurePageDraft(key);
      mgr.initFromServer((env.c as any).currentPageDraftState(key));
      expect(env.c.pageDraftReady(key)).toBeTrue();
      expect(env.c.pageDraftDirty(key)).toBeFalse();
      expect(env.c.pageDraftAutosaving(key)).toBeFalse();
      expect(env.c.pageDraftLastAutosavedAt(key)).toBeNull();
      expect(env.c.pageDraftHasRestore(key)).toBeFalse();
      expect(env.c.pageDraftRestoreAt(key)).toBeNull();
      expect(env.c.pageDraftCanUndo(key)).toBeFalse();
      expect(env.c.pageDraftCanRedo(key)).toBeFalse();
      env.c.dismissPageDraftAutosave(key);
    });

    it('undo/redo/restore page drafts apply state', () => {
      const env = build('pages');
      const key = 'page.about' as const;
      const mgr = (env.c as any).ensurePageDraft(key);
      mgr.initFromServer((env.c as any).currentPageDraftState(key));
      env.c.pageBlocks['page.about'] = [{ key: 'b1', type: 'text', layout: undefined }] as any;
      expect(env.c.pageDraftCanUndo(key)).toBeTrue();
      env.c.undoPageDraft(key);
      expect(env.c.pageBlocks['page.about']).toEqual([]);
      env.c.redoPageDraft(key);
      expect(env.c.pageBlocks['page.about'].length).toBe(1);
      env.c.restorePageDraftAutosave(key);
    });

    it('blog draft helpers gate on a selected key', () => {
      const env = build('blog');
      expect(env.c.blogDraftReady()).toBeFalse();
      expect(env.c.blogDraftDirty()).toBeFalse();
      expect(env.c.blogDraftAutosaving()).toBeFalse();
      expect(env.c.blogDraftLastAutosavedAt()).toBeNull();
      expect(env.c.blogDraftHasRestore()).toBeFalse();
      expect(env.c.blogDraftRestoreAt()).toBeNull();
      env.c.restoreBlogDraftAutosave();
      env.c.dismissBlogDraftAutosave();

      env.c.selectedBlogKey = 'blog.x';
      const mgr = (env.c as any).ensureBlogDraft('blog.x', 'en');
      mgr.initFromServer((env.c as any).currentBlogDraftState());
      expect(env.c.blogDraftReady()).toBeTrue();
      expect(env.c.blogDraftHasRestore()).toBeFalse();
      env.c.restoreBlogDraftAutosave();
      env.c.dismissBlogDraftAutosave();
    });
  });

  describe('revision title keys', () => {
    it('maps the pages revision key to legal/about/contact labels', () => {
      const env = build('pages');
      const cases: Array<[string, string | undefined]> = [
        ['page.about', 'adminUi.site.pages.aboutLabel'],
        ['page.contact', 'adminUi.site.pages.contactLabel'],
        ['page.terms', 'adminUi.site.pages.legal.documents.termsIndex'],
        ['page.terms-and-conditions', 'adminUi.site.pages.legal.documents.terms'],
        ['page.privacy-policy', 'adminUi.site.pages.legal.documents.privacy'],
        ['page.anpc', 'adminUi.site.pages.legal.documents.anpc'],
        ['page.unknown', undefined],
      ];
      for (const [key, expected] of cases) {
        env.c.pagesRevisionKey = key;
        expect(env.c.pagesRevisionTitleKey()).toBe(expected);
      }
    });

    it('maps the home revision key', () => {
      const env = build('home');
      env.c.homeRevisionKey = 'home.sections';
      expect(env.c.homeRevisionTitleKey()).toBe('adminUi.home.sections.title');
      env.c.homeRevisionKey = 'home.story';
      expect(env.c.homeRevisionTitleKey()).toBe('adminUi.home.story.title');
      env.c.homeRevisionKey = 'something.else';
      expect(env.c.homeRevisionTitleKey()).toBe('adminUi.content.revisions.title');
    });

    it('maps the settings revision key including seo prefix', () => {
      const env = build('settings');
      const cases: Array<[string, string]> = [
        ['seo.home', 'adminUi.site.seo.title'],
        ['site.assets', 'adminUi.site.assets.title'],
        ['site.social', 'adminUi.site.social.title'],
        ['site.company', 'adminUi.site.company.title'],
        ['site.navigation', 'adminUi.site.navigation.title'],
        ['site.checkout', 'adminUi.site.checkout.title'],
        ['site.reports', 'adminUi.reports.title'],
        ['mystery', 'adminUi.content.revisions.title'],
      ];
      for (const [key, expected] of cases) {
        env.c.settingsRevisionKey = key;
        expect(env.c.settingsRevisionTitleKey()).toBe(expected);
      }
    });
  });

  describe('cms preference helpers', () => {
    it('reflects owner role + advanced mode', () => {
      const env = build('home');
      expect(env.c.isOwner()).toBeTrue();
      env.auth.role.and.returnValue('admin');
      expect(env.c.isOwner()).toBeFalse();
      expect(env.c.cmsAdvanced()).toBeFalse();
      env.cmsPrefs.mode.and.returnValue('advanced');
      expect(env.c.cmsAdvanced()).toBeTrue();
    });

    it('maps preview device to width class + numeric viewport', () => {
      const env = build('home');
      env.cmsPrefs.previewDevice.and.returnValue('mobile');
      expect(env.c.cmsPreviewMaxWidthClass()).toBe('max-w-[390px]');
      expect(env.c.cmsPreviewViewportWidth()).toBe(390);
      env.cmsPrefs.previewDevice.and.returnValue('tablet');
      expect(env.c.cmsPreviewMaxWidthClass()).toBe('max-w-[768px]');
      expect(env.c.cmsPreviewViewportWidth()).toBe(768);
      env.cmsPrefs.previewDevice.and.returnValue('desktop');
      expect(env.c.cmsPreviewMaxWidthClass()).toBe('max-w-[1024px]');
      expect(env.c.cmsPreviewViewportWidth()).toBe(1024);
    });

    it('syncSplitScroll only mirrors scroll in split layout with scrollable panes', () => {
      const env = build('home');
      const source = { scrollHeight: 200, clientHeight: 100, scrollTop: 50 } as HTMLElement;
      const target = { scrollHeight: 400, clientHeight: 100, scrollTop: 0 } as HTMLElement;
      env.cmsPrefs.previewLayout.and.returnValue('stacked');
      env.c.syncSplitScroll(source, target);
      expect(target.scrollTop).toBe(0);

      env.cmsPrefs.previewLayout.and.returnValue('split');
      env.c.syncSplitScroll(source, target);
      expect(target.scrollTop).toBeGreaterThan(0);
    });

    it('syncSplitScroll bails out when panes are not scrollable', () => {
      const env = build('home');
      env.cmsPrefs.previewLayout.and.returnValue('split');
      const source = { scrollHeight: 100, clientHeight: 100, scrollTop: 0 } as HTMLElement;
      const target = { scrollHeight: 100, clientHeight: 100, scrollTop: 0 } as HTMLElement;
      env.c.syncSplitScroll(source, target);
      expect(target.scrollTop).toBe(0);
    });
  });

  describe('owner transfer', () => {
    it('requires owner role', () => {
      const env = build('settings');
      env.auth.role.and.returnValue('admin');
      env.c.submitOwnerTransfer();
      expect(env.admin.transferOwner).not.toHaveBeenCalled();
    });

    it('validates the identifier before prompting', () => {
      const env = build('settings');
      env.c.ownerTransferIdentifier = '   ';
      env.c.submitOwnerTransfer();
      expect(env.c.ownerTransferError).toBe('adminUi.ownerTransfer.errors.identifier');
    });

    it('aborts when the password prompt is empty', () => {
      const env = build('settings');
      env.c.ownerTransferIdentifier = 'new-owner';
      spyOn(window, 'prompt').and.returnValue('');
      env.c.submitOwnerTransfer();
      expect(env.c.ownerTransferError).toBe('adminUi.ownerTransfer.passwordRequired');
    });

    it('submits and resets on success', () => {
      const env = build('settings');
      env.c.ownerTransferIdentifier = 'new-owner';
      env.c.ownerTransferConfirm = 'yes';
      spyOn(window, 'prompt').and.returnValue('pw');
      env.admin.transferOwner.and.returnValue(of({}));
      const loadAudit = spyOn(env.c, 'loadAudit').and.stub();
      env.c.submitOwnerTransfer();
      expect(env.admin.transferOwner).toHaveBeenCalledWith({
        identifier: 'new-owner',
        confirm: 'yes',
        password: 'pw',
      });
      expect(env.c.ownerTransferIdentifier).toBe('');
      expect(env.toast.success).toHaveBeenCalled();
      expect(loadAudit).toHaveBeenCalled();
      expect(env.c.ownerTransferLoading).toBeFalse();
    });

    it('surfaces a server detail on failure', () => {
      const env = build('settings');
      env.c.ownerTransferIdentifier = 'new-owner';
      spyOn(window, 'prompt').and.returnValue('pw');
      env.admin.transferOwner.and.returnValue(throwError(() => ({ error: { detail: 'nope' } })));
      env.c.submitOwnerTransfer();
      expect(env.c.ownerTransferError).toBe('nope');
      expect(env.c.ownerTransferLoading).toBeFalse();
    });

    it('falls back to a generic error when detail is missing', () => {
      const env = build('settings');
      env.c.ownerTransferIdentifier = 'new-owner';
      spyOn(window, 'prompt').and.returnValue('pw');
      env.admin.transferOwner.and.returnValue(throwError(() => ({})));
      env.c.submitOwnerTransfer();
      expect(env.c.ownerTransferError).toBe('adminUi.ownerTransfer.errors.generic');
    });
  });

  describe('FX overrides', () => {
    it('loads status + audit and seeds the override form', () => {
      const env = build('settings');
      env.fxAdmin.getStatus.and.returnValue(
        of({
          override: { eur_per_ron: '0.2', usd_per_ron: '0.22', as_of: '2026-01-01' },
          effective: { eur_per_ron: '0.1', usd_per_ron: '0.11', as_of: '' },
        }),
      );
      env.fxAdmin.listOverrideAudit.and.returnValue(of([{ id: 'a1' }]));
      env.c.loadFxStatus();
      expect(env.c.fxOverrideForm.eur_per_ron).toBe(0.2);
      expect(env.c.fxAudit()).toEqual([{ id: 'a1' }] as any);
      expect(env.c.fxLoading()).toBeFalse();
    });

    it('uses effective rates when no override exists', () => {
      const env = build('settings');
      env.fxAdmin.getStatus.and.returnValue(
        of({
          effective: { eur_per_ron: '0.1', usd_per_ron: '0.11', as_of: '2025-12-31' },
        }),
      );
      env.c.loadFxStatus();
      expect(env.c.fxOverrideForm.usd_per_ron).toBe(0.11);
      expect(env.c.fxOverrideForm.as_of).toBe('2025-12-31');
    });

    it('records an error when status load fails', () => {
      const env = build('settings');
      env.fxAdmin.getStatus.and.returnValue(throwError(() => new Error('x')));
      env.c.loadFxStatus();
      expect(env.c.fxError()).toBe('adminUi.fx.errors.load');
    });

    it('handles fx audit failures and non-array payloads', () => {
      const env = build('settings');
      env.fxAdmin.listOverrideAudit.and.returnValue(of('not-array'));
      env.c.loadFxAudit();
      expect(env.c.fxAudit()).toEqual([]);
      env.fxAdmin.listOverrideAudit.and.returnValue(throwError(() => new Error('x')));
      env.c.loadFxAudit();
      expect(env.c.fxAuditError()).toBe('adminUi.fx.audit.errors.load');
    });

    it('fxAuditActionLabel returns the raw action when untranslated', () => {
      const env = build('settings');
      expect(env.c.fxAuditActionLabel('SET')).toBe('SET');
      env.translate.instant = (k: string) => (k.endsWith('.set') ? 'Set rate' : k);
      expect(env.c.fxAuditActionLabel('set')).toBe('Set rate');
    });

    it('restoreFxOverrideFromAudit guards id + confirm', () => {
      const env = build('settings');
      env.c.restoreFxOverrideFromAudit({ id: '' } as any);
      expect(env.fxAdmin.restoreOverrideFromAudit).not.toHaveBeenCalled();
      spyOn(window, 'confirm').and.returnValue(false);
      env.c.restoreFxOverrideFromAudit({ id: 'a1' } as any);
      expect(env.fxAdmin.restoreOverrideFromAudit).not.toHaveBeenCalled();
    });

    it('restoreFxOverrideFromAudit applies restored status on success', () => {
      const env = build('settings');
      spyOn(window, 'confirm').and.returnValue(true);
      env.fxAdmin.restoreOverrideFromAudit.and.returnValue(
        of({
          effective: { eur_per_ron: '0.3', usd_per_ron: '0.33', as_of: 'x' },
        }),
      );
      env.c.restoreFxOverrideFromAudit({ id: 'a1' } as any);
      expect(env.c.fxOverrideForm.eur_per_ron).toBe(0.3);
      expect(env.toast.success).toHaveBeenCalled();
      expect(env.c.fxAuditRestoring()).toBeNull();
    });

    it('restoreFxOverrideFromAudit toasts on failure', () => {
      const env = build('settings');
      spyOn(window, 'confirm').and.returnValue(true);
      env.fxAdmin.restoreOverrideFromAudit.and.returnValue(throwError(() => new Error('x')));
      env.c.restoreFxOverrideFromAudit({ id: 'a1' } as any);
      expect(env.toast.error).toHaveBeenCalled();
    });

    it('resetFxOverrideForm requires a loaded status', () => {
      const env = build('settings');
      env.c.fxStatus.set(null);
      env.c.resetFxOverrideForm();
      expect(env.c.fxOverrideForm.eur_per_ron).toBe(0);
      env.c.fxStatus.set({
        effective: { eur_per_ron: '0.5', usd_per_ron: '0.55', as_of: 'y' },
      } as any);
      env.c.resetFxOverrideForm();
      expect(env.c.fxOverrideForm.eur_per_ron).toBe(0.5);
    });

    it('saveFxOverride validates positive rates', () => {
      const env = build('settings');
      env.c.fxOverrideForm = { eur_per_ron: 0, usd_per_ron: 1, as_of: '' };
      env.c.saveFxOverride();
      expect(env.toast.error).toHaveBeenCalled();
      expect(env.fxAdmin.setOverride).not.toHaveBeenCalled();
    });

    it('saveFxOverride posts the override and reloads', () => {
      const env = build('settings');
      env.c.fxOverrideForm = { eur_per_ron: 0.2, usd_per_ron: 0.22, as_of: ' 2026-01-01 ' };
      env.fxAdmin.setOverride.and.returnValue(of({}));
      const reload = spyOn(env.c, 'loadFxStatus').and.stub();
      env.c.saveFxOverride();
      expect(env.fxAdmin.setOverride).toHaveBeenCalledWith({
        eur_per_ron: 0.2,
        usd_per_ron: 0.22,
        as_of: '2026-01-01',
      });
      expect(reload).toHaveBeenCalled();
    });

    it('saveFxOverride sends null as_of when blank and toasts on failure', () => {
      const env = build('settings');
      env.c.fxOverrideForm = { eur_per_ron: 0.2, usd_per_ron: 0.22, as_of: '' };
      env.fxAdmin.setOverride.and.returnValue(throwError(() => new Error('x')));
      env.c.saveFxOverride();
      expect(env.fxAdmin.setOverride).toHaveBeenCalledWith(
        jasmine.objectContaining({ as_of: null }),
      );
      expect(env.toast.error).toHaveBeenCalled();
    });

    it('clearFxOverride needs an active override + confirmation', () => {
      const env = build('settings');
      env.c.fxStatus.set({ override: null } as any);
      env.c.clearFxOverride();
      expect(env.fxAdmin.clearOverride).not.toHaveBeenCalled();
      env.c.fxStatus.set({ override: { eur_per_ron: '1' } } as any);
      spyOn(window, 'confirm').and.returnValue(true);
      env.fxAdmin.clearOverride.and.returnValue(of({}));
      const reload = spyOn(env.c, 'loadFxStatus').and.stub();
      env.c.clearFxOverride();
      expect(env.fxAdmin.clearOverride).toHaveBeenCalled();
      expect(reload).toHaveBeenCalled();
    });

    it('clearFxOverride toasts on failure', () => {
      const env = build('settings');
      env.c.fxStatus.set({ override: { eur_per_ron: '1' } } as any);
      spyOn(window, 'confirm').and.returnValue(true);
      env.fxAdmin.clearOverride.and.returnValue(throwError(() => new Error('x')));
      env.c.clearFxOverride();
      expect(env.toast.error).toHaveBeenCalled();
    });
  });

  describe('products', () => {
    it('startNewProduct resets the form using the first category id', () => {
      const env = build('settings');
      env.c.categories = [{ id: 'c1' }] as any;
      env.c.editingId = 'old';
      env.c.startNewProduct();
      expect(env.c.editingId).toBeNull();
      expect(env.c.form.category_id).toBe('c1');
      expect(env.c.form.price).toBe(0);
    });

    it('loadProduct hydrates the form from a detail payload', () => {
      const env = build('settings');
      env.admin.getProduct.and.returnValue(
        of({
          slug: 's1',
          name: 'N',
          category_id: 'c1',
          price: 10,
          stock_quantity: 5,
          status: 'active',
          sku: 'SKU',
          long_description: 'desc',
          publish_at: '2026-01-01T10:00:00Z',
          tags: ['bestseller'],
          images: [{ id: 'i1', url: 'u' }],
        }),
      );
      env.c.loadProduct('s1');
      expect(env.c.editingId).toBe('s1');
      expect(env.c.form.is_bestseller).toBeTrue();
      expect(env.c.productImages().length).toBe(1);
    });

    it('loadProduct toasts on failure', () => {
      const env = build('settings');
      env.admin.getProduct.and.returnValue(throwError(() => new Error('x')));
      env.c.loadProduct('s1');
      expect(env.toast.error).toHaveBeenCalled();
    });

    it('saveProduct creates when not editing and updates when editing', () => {
      const env = build('settings');
      env.admin.createProduct.and.returnValue(of({}));
      env.admin.updateProduct.and.returnValue(of({}));
      const loadAll = spyOn(env.c, 'loadAll').and.stub();
      env.c.editingId = null;
      env.c.saveProduct();
      expect(env.admin.createProduct).toHaveBeenCalled();
      env.c.editingId = 'edit-me';
      env.c.saveProduct();
      expect(env.admin.updateProduct).toHaveBeenCalled();
      expect(loadAll).toHaveBeenCalled();
    });

    it('saveProduct serializes publish_at + toasts on failure', () => {
      const env = build('settings');
      env.c.editingId = null;
      env.c.form.publish_at = '2026-01-01T10:00';
      env.admin.createProduct.and.returnValue(throwError(() => new Error('x')));
      env.c.saveProduct();
      const payload = env.admin.createProduct.calls.mostRecent().args[0];
      expect(payload.publish_at).toContain('2026-01-01');
      expect(env.toast.error).toHaveBeenCalled();
    });

    it('deleteSelected removes the first selected product', () => {
      const env = build('settings');
      env.c.products = [
        { id: 'p1', slug: 's1' },
        { id: 'p2', slug: 's2' },
      ] as any;
      env.c.selectedIds = new Set(['p1']);
      env.admin.deleteProduct.and.returnValue(of({}));
      env.c.deleteSelected();
      expect(env.admin.deleteProduct).toHaveBeenCalledWith('s1');
      expect(env.c.products.map((p) => p.id)).toEqual(['p2']);
    });

    it('deleteSelected exits when nothing is selected or target missing', () => {
      const env = build('settings');
      env.c.selectedIds = new Set();
      env.c.deleteSelected();
      env.c.selectedIds = new Set(['ghost']);
      env.c.products = [];
      env.c.deleteSelected();
      expect(env.admin.deleteProduct).not.toHaveBeenCalled();
    });

    it('deleteSelected toasts on failure', () => {
      const env = build('settings');
      env.c.products = [{ id: 'p1', slug: 's1' }] as any;
      env.c.selectedIds = new Set(['p1']);
      env.admin.deleteProduct.and.returnValue(throwError(() => new Error('x')));
      env.c.deleteSelected();
      expect(env.toast.error).toHaveBeenCalled();
    });

    it('duplicateProduct reloads and opens the new slug', () => {
      const env = build('settings');
      env.admin.duplicateProduct.and.returnValue(of({ slug: 'dup' }));
      env.admin.getProduct.and.returnValue(
        of({ slug: 'dup', name: '', price: 0, stock_quantity: 0, status: 'draft', tags: [] }),
      );
      spyOn(env.c, 'loadAll').and.stub();
      env.c.duplicateProduct('orig');
      expect(env.c.editingId).toBe('dup');
    });

    it('duplicateProduct toasts on failure', () => {
      const env = build('settings');
      env.admin.duplicateProduct.and.returnValue(throwError(() => new Error('x')));
      env.c.duplicateProduct('orig');
      expect(env.toast.error).toHaveBeenCalled();
    });

    it('setStock + saveStock persist edited stock', () => {
      const env = build('settings');
      const product = { id: 'p1', slug: 's1', stock_quantity: 1 } as any;
      env.c.setStock('p1', 9);
      expect(env.c.stockEdits['p1']).toBe(9);
      env.admin.updateProduct.and.returnValue(of({}));
      env.c.saveStock(product);
      expect(product.stock_quantity).toBe(9);
      expect(env.toast.success).toHaveBeenCalled();
    });

    it('saveStock falls back to current stock + toasts on failure', () => {
      const env = build('settings');
      const product = { id: 'p2', slug: 's2', stock_quantity: 4 } as any;
      env.admin.updateProduct.and.returnValue(throwError(() => new Error('x')));
      env.c.saveStock(product);
      expect(env.admin.updateProduct).toHaveBeenCalledWith('s2', { stock_quantity: 4 } as any);
      expect(env.toast.error).toHaveBeenCalled();
    });

    it('saveBulkStock applies the bulk value to every selected product', async () => {
      const env = build('settings');
      env.c.products = [
        { id: 'p1', slug: 's1', stock_quantity: 0 },
        { id: 'p2', slug: 's2', stock_quantity: 0 },
      ] as any;
      env.c.selectedIds = new Set(['p1', 'p2', 'ghost']);
      env.c.bulkStock = 7;
      env.admin.updateProduct.and.returnValue(of({}));
      await env.c.saveBulkStock();
      expect(env.c.products.every((p) => p.stock_quantity === 7)).toBeTrue();
      expect(env.toast.success).toHaveBeenCalled();
    });

    it('saveBulkStock exits early without a value or selection', async () => {
      const env = build('settings');
      env.c.bulkStock = null;
      await env.c.saveBulkStock();
      env.c.bulkStock = 1;
      env.c.selectedIds = new Set();
      await env.c.saveBulkStock();
      expect(env.admin.updateProduct).not.toHaveBeenCalled();
    });

    it('saveBulkStock toasts when an update rejects', async () => {
      const env = build('settings');
      env.c.products = [{ id: 'p1', slug: 's1', stock_quantity: 0 }] as any;
      env.c.selectedIds = new Set(['p1']);
      env.c.bulkStock = 7;
      env.admin.updateProduct.and.returnValue(throwError(() => new Error('x')));
      await env.c.saveBulkStock();
      expect(env.toast.error).toHaveBeenCalled();
    });

    it('buildTags merges bestseller flag with existing detail tags', () => {
      const env = build('settings');
      env.c.form.is_bestseller = true;
      env.c.productDetail = { tags: ['handmade', 'bestseller'] } as any;
      expect(env.c.buildTags().sort()).toEqual(['bestseller', 'handmade']);
    });

    it('upcomingProducts filters + sorts future publish dates', () => {
      const env = build('settings');
      const future1 = new Date(Date.now() + 86400000).toISOString();
      const future2 = new Date(Date.now() + 2 * 86400000).toISOString();
      const past = new Date(Date.now() - 86400000).toISOString();
      env.c.products = [
        { id: 'a', publish_at: future2 },
        { id: 'b', publish_at: past },
        { id: 'c', publish_at: future1 },
      ] as any;
      expect(env.c.upcomingProducts().map((p) => p.id)).toEqual(['c', 'a']);
    });

    it('toLocalDateTime trims an ISO string to minutes', () => {
      const env = build('settings');
      expect(env.c.toLocalDateTime('2026-01-01T10:00:00Z')).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/,
      );
    });
  });

  describe('category management', () => {
    it('runs the category wizard navigation', () => {
      const env = build('settings');
      env.c.startCategoryWizard();
      expect(env.c.categoryWizardOpen()).toBeTrue();
      expect(env.c.categoryWizardCanNext()).toBeFalse();
      expect(env.c.categoryWizardNextLabelKey()).toBe('adminUi.actions.next');
      env.c.categoryWizardNext();
      expect(env.toast.error).toHaveBeenCalled();
      env.c.categoryWizardSlug.set('slug-1');
      expect(env.c.categoryWizardCanNext()).toBeTrue();
      const openTr = spyOn(env.c, 'openCategoryWizardTranslations').and.stub();
      env.c.categoryWizardNext();
      expect(env.c.categoryWizardStep()).toBe(1);
      expect(openTr).toHaveBeenCalled();
      expect(env.c.categoryWizardNextLabelKey()).toBe('adminUi.actions.done');
      env.c.categoryWizardPrev();
      expect(env.c.categoryWizardStep()).toBe(0);
      env.c.categoryWizardPrev();
      expect(env.c.categoryWizardStep()).toBe(0);
      env.c.categoryWizardStep.set(1);
      env.c.categoryWizardNext();
      expect(env.c.categoryWizardOpen()).toBeFalse();
    });

    it('goToCategoryWizardStep validates bounds + slug', () => {
      const env = build('settings');
      env.c.goToCategoryWizardStep(0);
      expect(env.c.categoryWizardOpen()).toBeFalse();
      env.c.startCategoryWizard();
      env.c.goToCategoryWizardStep(-1);
      env.c.goToCategoryWizardStep(99);
      expect(env.c.categoryWizardStep()).toBe(0);
      env.c.goToCategoryWizardStep(1);
      expect(env.toast.error).toHaveBeenCalled();
      env.c.categoryWizardSlug.set('s');
      const openTr = spyOn(env.c, 'openCategoryWizardTranslations').and.stub();
      env.c.goToCategoryWizardStep(1);
      expect(openTr).toHaveBeenCalled();
    });

    it('categoryWizardDescriptionKey falls back to basics', () => {
      const env = build('settings');
      env.c.categoryWizardStep.set(99);
      expect(env.c.categoryWizardDescriptionKey()).toBe('adminUi.categories.wizard.desc.basics');
    });

    it('addCategory validates name then prepends the created category', () => {
      const env = build('settings');
      env.c.categoryName = '';
      env.c.addCategory();
      expect(env.toast.error).toHaveBeenCalled();
      env.c.categoryName = 'New';
      env.c.categories = [{ id: 'old' }] as any;
      env.admin.createCategory.and.returnValue(of({ id: 'new', slug: 'new-cat' }));
      env.c.addCategory();
      expect(env.c.categories[0]).toEqual({ id: 'new', slug: 'new-cat' } as any);
      expect(env.c.categoryName).toBe('');
    });

    it('addCategory advances the open wizard to translations', () => {
      const env = build('settings');
      env.c.startCategoryWizard();
      env.c.categoryName = 'New';
      env.admin.createCategory.and.returnValue(of({ id: 'new', slug: 'new-cat' }));
      const openTr = spyOn(env.c, 'openCategoryWizardTranslations').and.stub();
      env.c.addCategory();
      expect(env.c.categoryWizardSlug()).toBe('new-cat');
      expect(openTr).toHaveBeenCalled();
    });

    it('addCategory toasts on failure', () => {
      const env = build('settings');
      env.c.categoryName = 'New';
      env.admin.createCategory.and.returnValue(throwError(() => new Error('x')));
      env.c.addCategory();
      expect(env.toast.error).toHaveBeenCalled();
    });

    it('categoryParentLabel resolves parent names', () => {
      const env = build('settings');
      env.c.categories = [
        { id: 'p', name: 'Parent' },
        { id: 'c', name: 'Child', parent_id: 'p' },
      ] as any;
      expect(env.c.categoryParentLabel({ parent_id: '' } as any)).toBe(
        'adminUi.categories.parentNone',
      );
      expect(env.c.categoryParentLabel({ parent_id: 'p' } as any)).toBe('Parent');
      expect(env.c.categoryParentLabel({ parent_id: 'missing' } as any)).toBe(
        'adminUi.categories.parentNone',
      );
    });

    it('categoryParentOptions excludes self + descendants', () => {
      const env = build('settings');
      env.c.categories = [
        { id: 'root', name: 'Root' },
        { id: 'child', name: 'Child', parent_id: 'root' },
        { id: 'grand', name: 'Grand', parent_id: 'child' },
        { id: 'other', name: 'Other' },
      ] as any;
      const options = env.c.categoryParentOptions({ id: 'root' } as any).map((c) => c.id);
      expect(options).toEqual(['other']);
    });

    it('updateCategoryParent skips no-ops and persists changes', () => {
      const env = build('settings');
      const cat = { slug: 's', parent_id: 'p' } as any;
      env.c.updateCategoryParent(cat, 'p');
      expect(env.admin.updateCategory).not.toHaveBeenCalled();
      env.admin.updateCategory.and.returnValue(of({ parent_id: 'q' }));
      env.c.updateCategoryParent(cat, 'q');
      expect(cat.parent_id).toBe('q');
    });

    it('updateCategoryParent rolls back on failure', () => {
      const env = build('settings');
      const cat = { slug: 's', parent_id: 'p' } as any;
      env.admin.updateCategory.and.returnValue(throwError(() => new Error('x')));
      env.c.updateCategoryParent(cat, 'q');
      expect(cat.parent_id).toBe('p');
      expect(env.toast.error).toHaveBeenCalled();
    });

    it('updateCategoryLowStockThreshold validates + persists', () => {
      const env = build('settings');
      const cat = { slug: 's', low_stock_threshold: 5 } as any;
      env.c.updateCategoryLowStockThreshold(cat, '-1');
      expect(cat.low_stock_threshold).toBe(5);
      expect(env.toast.error).toHaveBeenCalled();
      env.c.updateCategoryLowStockThreshold(cat, '5');
      expect(env.admin.updateCategory).not.toHaveBeenCalled();
      env.admin.updateCategory.and.returnValue(of({ low_stock_threshold: 8 }));
      env.c.updateCategoryLowStockThreshold(cat, '8');
      expect(cat.low_stock_threshold).toBe(8);
    });

    it('updateCategoryLowStockThreshold rolls back on failure', () => {
      const env = build('settings');
      const cat = { slug: 's', low_stock_threshold: 5 } as any;
      env.admin.updateCategory.and.returnValue(throwError(() => new Error('x')));
      env.c.updateCategoryLowStockThreshold(cat, '8');
      expect(cat.low_stock_threshold).toBe(5);
    });

    it('updateCategoryTaxGroup persists + rolls back', () => {
      const env = build('settings');
      const cat = { slug: 's', tax_group_id: 'g1' } as any;
      env.c.updateCategoryTaxGroup(cat, 'g1');
      expect(env.admin.updateCategory).not.toHaveBeenCalled();
      env.admin.updateCategory.and.returnValue(of({ tax_group_id: 'g2' }));
      env.c.updateCategoryTaxGroup(cat, 'g2');
      expect(cat.tax_group_id).toBe('g2');
      env.admin.updateCategory.and.returnValue(throwError(() => new Error('x')));
      env.c.updateCategoryTaxGroup(cat, 'g3');
      expect(cat.tax_group_id).toBe('g2');
    });

    it('category delete confirm flow', () => {
      const env = build('settings');
      const cat = { slug: 's' } as any;
      env.c.openCategoryDeleteConfirm(cat);
      expect(env.c.categoryDeleteConfirmOpen()).toBeTrue();
      env.admin.deleteCategory.and.returnValue(of({}));
      env.c.categories = [{ slug: 's' }, { slug: 't' }] as any;
      env.c.confirmDeleteCategory();
      expect(env.c.categories.map((x) => x.slug)).toEqual(['t']);
      expect(env.c.categoryDeleteConfirmOpen()).toBeFalse();
    });

    it('confirmDeleteCategory guards on missing target + busy', () => {
      const env = build('settings');
      env.c.confirmDeleteCategory();
      expect(env.admin.deleteCategory).not.toHaveBeenCalled();
      env.c.categoryDeleteConfirmTarget.set({ slug: 's' } as any);
      env.c.categoryDeleteConfirmBusy.set(true);
      env.c.confirmDeleteCategory();
      expect(env.admin.deleteCategory).not.toHaveBeenCalled();
    });

    it('deleteCategory toasts + closes translations on failure/success', () => {
      const env = build('settings');
      env.c.categoryTranslationsSlug = 's';
      env.admin.deleteCategory.and.returnValue(of({}));
      env.c.categories = [{ slug: 's' }] as any;
      env.c.deleteCategory('s');
      expect(env.c.categoryTranslationsSlug).toBeNull();
      env.admin.deleteCategory.and.returnValue(throwError(() => new Error('x')));
      const done = jasmine.createSpy('done');
      env.c.deleteCategory('z', { done });
      expect(done).toHaveBeenCalledWith(false);
    });

    it('toggleCategoryTranslations opens + closes', () => {
      const env = build('settings');
      env.admin.getCategoryTranslations.and.returnValue(
        of([{ lang: 'en', name: 'N', description: 'D' }]),
      );
      env.c.toggleCategoryTranslations('s');
      expect(env.c.categoryTranslationsSlug).toBe('s');
      expect(env.c.categoryTranslationExists.en).toBeTrue();
      env.c.toggleCategoryTranslations('s');
      expect(env.c.categoryTranslationsSlug).toBeNull();
    });

    it('saveCategoryTranslation validates + persists', () => {
      const env = build('settings');
      env.c.saveCategoryTranslation('en');
      expect(env.admin.upsertCategoryTranslation).not.toHaveBeenCalled();
      env.c.categoryTranslationsSlug = 's';
      env.c.categoryTranslations.en = { name: '', description: '' };
      env.c.saveCategoryTranslation('en');
      expect(env.toast.error).toHaveBeenCalled();
      env.c.categoryTranslations.en = { name: 'Name', description: 'Desc' };
      env.admin.upsertCategoryTranslation.and.returnValue(
        of({ name: 'Name', description: 'Desc' }),
      );
      env.c.saveCategoryTranslation('en');
      expect(env.c.categoryTranslationExists.en).toBeTrue();
    });

    it('saveCategoryTranslation surfaces an error', () => {
      const env = build('settings');
      env.c.categoryTranslationsSlug = 's';
      env.c.categoryTranslations.ro = { name: 'Nume', description: '' };
      env.admin.upsertCategoryTranslation.and.returnValue(throwError(() => new Error('x')));
      env.c.saveCategoryTranslation('ro');
      expect(env.c.categoryTranslationsError()).toBe('adminUi.categories.translations.errors.save');
    });

    it('deleteCategoryTranslation persists + errors', () => {
      const env = build('settings');
      env.c.deleteCategoryTranslation('en');
      expect(env.admin.deleteCategoryTranslation).not.toHaveBeenCalled();
      env.c.categoryTranslationsSlug = 's';
      env.c.categoryTranslationExists.en = true;
      env.admin.deleteCategoryTranslation.and.returnValue(of({}));
      env.c.deleteCategoryTranslation('en');
      expect(env.c.categoryTranslationExists.en).toBeFalse();
      env.admin.deleteCategoryTranslation.and.returnValue(throwError(() => new Error('x')));
      env.c.deleteCategoryTranslation('ro');
      expect(env.c.categoryTranslationsError()).toBe(
        'adminUi.categories.translations.errors.delete',
      );
    });

    it('loadCategoryTranslations maps + errors', () => {
      const env = build('settings');
      env.admin.getCategoryTranslations.and.returnValue(
        of([
          { lang: 'en', name: 'EN', description: 'd' },
          { lang: 'fr', name: 'skip' },
        ]),
      );
      (env.c as any).loadCategoryTranslations('s');
      expect(env.c.categoryTranslationExists.en).toBeTrue();
      expect(env.c.categoryTranslationExists.ro).toBeFalse();
      env.admin.getCategoryTranslations.and.returnValue(throwError(() => new Error('x')));
      (env.c as any).loadCategoryTranslations('s');
      expect(env.c.categoryTranslationsError()).toBe('adminUi.categories.translations.errors.load');
    });
  });

  describe('tax groups', () => {
    it('loadTaxGroups normalizes + handles errors', () => {
      const env = build('settings');
      env.taxesAdmin.listGroups.and.returnValue(of([{ id: 'g1' }]));
      env.c.loadTaxGroups();
      expect(env.c.taxGroups).toEqual([{ id: 'g1' }] as any);
      expect(env.c.taxGroupsLoading).toBeFalse();
      env.taxesAdmin.listGroups.and.returnValue(throwError(() => ({ error: { detail: 'boom' } })));
      env.c.loadTaxGroups();
      expect(env.c.taxGroupsError).toBe('boom');
    });

    it('createTaxGroup validates + posts', () => {
      const env = build('settings');
      env.c.taxGroupCreate = { code: '', name: '', description: '', is_default: false };
      env.c.createTaxGroup();
      expect(env.toast.error).toHaveBeenCalled();
      env.c.taxGroupCreate = { code: 'C', name: 'N', description: ' d ', is_default: true };
      env.taxesAdmin.createGroup.and.returnValue(of({}));
      const reload = spyOn(env.c, 'loadTaxGroups').and.stub();
      env.c.createTaxGroup();
      expect(env.taxesAdmin.createGroup).toHaveBeenCalledWith(
        jasmine.objectContaining({ code: 'C', description: 'd', is_default: true }),
      );
      expect(reload).toHaveBeenCalled();
    });

    it('createTaxGroup surfaces server detail', () => {
      const env = build('settings');
      env.c.taxGroupCreate = { code: 'C', name: 'N', description: '', is_default: false };
      env.taxesAdmin.createGroup.and.returnValue(throwError(() => ({ error: { detail: 'dup' } })));
      env.c.createTaxGroup();
      expect(env.toast.error).toHaveBeenCalledWith('dup');
    });

    it('saveTaxGroup validates name + persists', () => {
      const env = build('settings');
      env.c.saveTaxGroup({ id: 'g', name: ' ' } as any);
      expect(env.toast.error).toHaveBeenCalled();
      env.taxesAdmin.updateGroup.and.returnValue(of({}));
      env.c.saveTaxGroup({ id: 'g', name: 'Std', description: '' } as any);
      expect(env.taxesAdmin.updateGroup).toHaveBeenCalled();
    });

    it('saveTaxGroup surfaces server detail', () => {
      const env = build('settings');
      env.taxesAdmin.updateGroup.and.returnValue(throwError(() => ({ error: { detail: 'bad' } })));
      env.c.saveTaxGroup({ id: 'g', name: 'Std' } as any);
      expect(env.toast.error).toHaveBeenCalledWith('bad');
    });

    it('setDefaultTaxGroup skips defaults + persists', () => {
      const env = build('settings');
      env.c.setDefaultTaxGroup({ id: 'g', is_default: true } as any);
      expect(env.taxesAdmin.updateGroup).not.toHaveBeenCalled();
      env.taxesAdmin.updateGroup.and.returnValue(of({}));
      env.c.setDefaultTaxGroup({ id: 'g', is_default: false } as any);
      expect(env.taxesAdmin.updateGroup).toHaveBeenCalledWith('g', { is_default: true });
      env.taxesAdmin.updateGroup.and.returnValue(throwError(() => ({})));
      env.c.setDefaultTaxGroup({ id: 'h', is_default: false } as any);
      expect(env.toast.error).toHaveBeenCalled();
    });

    it('deleteTaxGroup blocks default deletion + persists', () => {
      const env = build('settings');
      env.c.deleteTaxGroup({ id: 'g', is_default: true } as any);
      expect(env.taxesAdmin.deleteGroup).not.toHaveBeenCalled();
      env.taxesAdmin.deleteGroup.and.returnValue(of({}));
      env.c.deleteTaxGroup({ id: 'g', is_default: false } as any);
      expect(env.taxesAdmin.deleteGroup).toHaveBeenCalled();
      env.taxesAdmin.deleteGroup.and.returnValue(throwError(() => ({})));
      env.c.deleteTaxGroup({ id: 'h', is_default: false } as any);
      expect(env.toast.error).toHaveBeenCalled();
    });

    it('upsertTaxRate validates + persists', () => {
      const env = build('settings');
      env.c.taxRateCountry['g'] = '';
      env.c.upsertTaxRate({ id: 'g' } as any);
      expect(env.toast.error).toHaveBeenCalled();
      env.c.taxRateCountry['g'] = 'RO';
      env.c.taxRatePercent['g'] = '19';
      env.taxesAdmin.upsertRate.and.returnValue(of({}));
      env.c.upsertTaxRate({ id: 'g' } as any);
      expect(env.taxesAdmin.upsertRate).toHaveBeenCalledWith('g', {
        country_code: 'RO',
        vat_rate_percent: 19,
      });
      expect(env.c.taxRateCountry['g']).toBe('');
    });

    it('upsertTaxRate surfaces failures', () => {
      const env = build('settings');
      env.c.taxRateCountry['g'] = 'RO';
      env.c.taxRatePercent['g'] = '19';
      env.taxesAdmin.upsertRate.and.returnValue(throwError(() => ({})));
      env.c.upsertTaxRate({ id: 'g' } as any);
      expect(env.toast.error).toHaveBeenCalled();
    });

    it('deleteTaxRate validates code + persists', () => {
      const env = build('settings');
      env.c.deleteTaxRate({ id: 'g' } as any, '  ');
      expect(env.taxesAdmin.deleteRate).not.toHaveBeenCalled();
      env.taxesAdmin.deleteRate.and.returnValue(of({}));
      env.c.deleteTaxRate({ id: 'g' } as any, 'RO');
      expect(env.taxesAdmin.deleteRate).toHaveBeenCalledWith('g', 'RO');
      env.taxesAdmin.deleteRate.and.returnValue(throwError(() => ({})));
      env.c.deleteTaxRate({ id: 'g' } as any, 'RO');
      expect(env.toast.error).toHaveBeenCalled();
    });
  });

  describe('category reorder + drag', () => {
    it('moveCategory swaps sort order and persists', () => {
      const env = build('settings');
      env.c.categories = [
        { slug: 'a', sort_order: 0 },
        { slug: 'b', sort_order: 1 },
      ] as any;
      env.admin.reorderCategories.and.returnValue(
        of([
          { slug: 'b', sort_order: 0 },
          { slug: 'a', sort_order: 1 },
        ]),
      );
      env.c.moveCategory({ slug: 'a' } as any, 1);
      expect(env.admin.reorderCategories).toHaveBeenCalled();
      expect(env.c.categories[0].slug).toBe('b');
    });

    it('moveCategory ignores out-of-range swaps', () => {
      const env = build('settings');
      env.c.categories = [{ slug: 'a', sort_order: 0 }] as any;
      env.c.moveCategory({ slug: 'a' } as any, -1);
      expect(env.admin.reorderCategories).not.toHaveBeenCalled();
    });

    it('moveCategory toasts on failure', () => {
      const env = build('settings');
      env.c.categories = [
        { slug: 'a', sort_order: 0 },
        { slug: 'b', sort_order: 1 },
      ] as any;
      env.admin.reorderCategories.and.returnValue(throwError(() => new Error('x')));
      env.c.moveCategory({ slug: 'a' } as any, 1);
      expect(env.toast.error).toHaveBeenCalled();
    });

    it('drag start/over/drop reorders categories', () => {
      const env = build('settings');
      env.c.categories = [
        { slug: 'a', sort_order: 0 },
        { slug: 'b', sort_order: 1 },
      ] as any;
      env.c.onCategoryDragStart('a');
      expect(env.c.draggingSlug).toBe('a');
      const evt = { preventDefault: jasmine.createSpy('pd') } as any;
      env.c.onCategoryDragOver(evt);
      expect(evt.preventDefault).toHaveBeenCalled();
      env.admin.reorderCategories.and.returnValue(
        of([
          { slug: 'b', sort_order: 0 },
          { slug: 'a', sort_order: 1 },
        ]),
      );
      env.c.onCategoryDrop('b');
      expect(env.admin.reorderCategories).toHaveBeenCalled();
      expect(env.c.draggingSlug).toBeNull();
    });

    it('onCategoryDrop short-circuits same/missing targets', () => {
      const env = build('settings');
      env.c.onCategoryDrop('x');
      env.c.draggingSlug = 'a';
      env.c.onCategoryDrop('a');
      expect(env.c.draggingSlug).toBeNull();
      env.c.categories = [{ slug: 'a' }] as any;
      env.c.draggingSlug = 'a';
      env.c.onCategoryDrop('ghost');
      expect(env.c.draggingSlug).toBeNull();
      expect(env.admin.reorderCategories).not.toHaveBeenCalled();
    });
  });

  describe('orders', () => {
    it('selectOrder clones the order', () => {
      const env = build('settings');
      const order = { id: 'o1', status: 'paid' } as any;
      env.c.selectOrder(order);
      expect(env.c.activeOrder).toEqual(order);
      expect(env.c.activeOrder).not.toBe(order);
    });

    it('filteredOrders honours the active filter', () => {
      const env = build('settings');
      env.c.orders = [
        { id: 'o1', status: 'paid' },
        { id: 'o2', status: 'shipped' },
      ] as any;
      expect(env.c.filteredOrders().length).toBe(2);
      env.c.orderFilter = 'paid';
      expect(env.c.filteredOrders().map((o) => o.id)).toEqual(['o1']);
    });

    it('changeOrderStatus updates the active + list order', () => {
      const env = build('settings');
      env.c.activeOrder = { id: 'o1', status: 'paid' } as any;
      env.c.orders = [{ id: 'o1', status: 'paid' }] as any;
      env.admin.updateOrderStatus.and.returnValue(of({ id: 'o1', status: 'shipped' }));
      env.c.changeOrderStatus('shipped');
      expect(env.c.activeOrder!.status).toBe('shipped');
      expect(env.c.orders[0].status).toBe('shipped');
    });

    it('changeOrderStatus exits without an active order + toasts on failure', () => {
      const env = build('settings');
      env.c.activeOrder = null;
      env.c.changeOrderStatus('shipped');
      expect(env.admin.updateOrderStatus).not.toHaveBeenCalled();
      env.c.activeOrder = { id: 'o1' } as any;
      env.admin.updateOrderStatus.and.returnValue(throwError(() => new Error('x')));
      env.c.changeOrderStatus('shipped');
      expect(env.toast.error).toHaveBeenCalled();
    });
  });

  describe('selection toggles', () => {
    it('toggleAll selects/clears all products', () => {
      const env = build('settings');
      env.c.products = [{ id: 'p1' }, { id: 'p2' }] as any;
      env.c.toggleAll({ target: { checked: true } } as any);
      expect(env.c.selectedIds.size).toBe(2);
      env.c.toggleAll({ target: { checked: false } } as any);
      expect(env.c.selectedIds.size).toBe(0);
    });

    it('toggleSelect adds/removes a single id and recomputes allSelected', () => {
      const env = build('settings');
      env.c.products = [{ id: 'p1' }] as any;
      env.c.toggleSelect('p1', { target: { checked: true } } as any);
      expect(env.c.allSelected).toBeTrue();
      env.c.toggleSelect('p1', { target: { checked: false } } as any);
      expect(env.c.allSelected).toBeFalse();
    });
  });

  describe('users', () => {
    it('forceLogout revokes sessions for the selected user', () => {
      const env = build('settings');
      env.c.forceLogout();
      expect(env.admin.revokeSessions).not.toHaveBeenCalled();
      env.c.selectedUserId = 'u1';
      env.admin.revokeSessions.and.returnValue(of({}));
      env.c.forceLogout();
      expect(env.admin.revokeSessions).toHaveBeenCalledWith('u1');
      env.admin.revokeSessions.and.returnValue(throwError(() => new Error('x')));
      env.c.forceLogout();
      expect(env.toast.error).toHaveBeenCalled();
    });

    it('selectUser + onSelectedUserIdChange load aliases', () => {
      const env = build('settings');
      env.admin.userAliases.and.returnValue(of({ aliases: [] }));
      env.c.selectUser('u1', 'admin');
      expect(env.c.selectedUserRole).toBe('admin');
      expect(env.c.userAliases).toEqual({ aliases: [] } as any);
      env.c.users = [{ id: 'u2', role: 'owner' }] as any;
      env.c.onSelectedUserIdChange('u2');
      expect(env.c.selectedUserRole).toBe('owner');
    });

    it('loadUserAliases guards empty ids + records errors', () => {
      const env = build('settings');
      env.c.loadUserAliases('');
      expect(env.admin.userAliases).not.toHaveBeenCalled();
      env.admin.userAliases.and.returnValue(throwError(() => new Error('x')));
      env.c.loadUserAliases('u1');
      expect(env.c.userAliasesError).toBe('Could not load alias history.');
      expect(env.c.userAliases).toBeNull();
    });

    it('userIdentity + commentAuthorLabel format identities', () => {
      const env = build('settings');
      expect(typeof env.c.userIdentity({ id: 'u', email: 'a@b.com' } as any)).toBe('string');
      expect(typeof env.c.commentAuthorLabel({ id: 'c1' })).toBe('string');
    });

    it('updateRole prompts for a password before persisting', () => {
      const env = build('settings');
      env.c.updateRole();
      expect(env.admin.updateUserRole).not.toHaveBeenCalled();
      env.c.selectedUserId = 'u1';
      env.c.selectedUserRole = 'admin';
      spyOn(window, 'prompt').and.returnValue('');
      env.c.updateRole();
      expect(env.toast.error).toHaveBeenCalled();
    });

    it('updateRole persists the new role + toasts on failure', () => {
      const env = build('settings');
      env.c.selectedUserId = 'u1';
      env.c.selectedUserRole = 'admin';
      env.c.users = [{ id: 'u1', role: 'member' }] as any;
      spyOn(window, 'prompt').and.returnValue('pw');
      env.admin.updateUserRole.and.returnValue(of({ id: 'u1', role: 'admin' }));
      env.c.updateRole();
      expect(env.c.users[0].role).toBe('admin');
      env.admin.updateUserRole.and.returnValue(throwError(() => new Error('x')));
      env.c.updateRole();
      expect(env.toast.error).toHaveBeenCalled();
    });
  });

  describe('coupons', () => {
    it('createCoupon validates code + prepends new coupon', () => {
      const env = build('settings');
      env.c.newCoupon = { code: '' };
      env.c.createCoupon();
      expect(env.toast.error).toHaveBeenCalled();
      env.c.newCoupon = { code: 'SAVE10' };
      env.c.coupons = [{ id: 'c0' }] as any;
      env.admin.createCoupon.and.returnValue(of({ id: 'c1' }));
      env.c.createCoupon();
      expect(env.c.coupons[0]).toEqual({ id: 'c1' } as any);
    });

    it('createCoupon toasts on failure', () => {
      const env = build('settings');
      env.c.newCoupon = { code: 'X' };
      env.admin.createCoupon.and.returnValue(throwError(() => new Error('x')));
      env.c.createCoupon();
      expect(env.toast.error).toHaveBeenCalled();
    });

    it('toggleCoupon flips active state', () => {
      const env = build('settings');
      env.c.coupons = [{ id: 'c1', active: true }] as any;
      env.admin.updateCoupon.and.returnValue(of({ id: 'c1', active: false }));
      env.c.toggleCoupon({ id: 'c1', active: true } as any);
      expect(env.admin.updateCoupon).toHaveBeenCalledWith('c1', { active: false });
      expect(env.c.coupons[0].active).toBeFalse();
      env.admin.updateCoupon.and.returnValue(throwError(() => new Error('x')));
      env.c.toggleCoupon({ id: 'c1', active: false } as any);
      expect(env.toast.error).toHaveBeenCalled();
    });

    it('invalidateCouponStripe reports deleted mapping count', () => {
      const env = build('settings');
      env.admin.invalidateCouponStripeMappings.and.returnValue(of({ deleted_mappings: 3 }));
      env.c.invalidateCouponStripe({ id: 'c1' } as any);
      expect(env.toast.success).toHaveBeenCalled();
      env.admin.invalidateCouponStripeMappings.and.returnValue(throwError(() => new Error('x')));
      env.c.invalidateCouponStripe({ id: 'c1' } as any);
      expect(env.toast.error).toHaveBeenCalled();
    });
  });

  describe('content blocks', () => {
    it('selectContent hydrates the form from a content block', () => {
      const env = build('settings');
      env.admin.getContent.and.returnValue(
        of({
          key: 'site.about',
          title: 'About',
          body_markdown: 'Body',
          status: 'published',
          version: 3,
        }),
      );
      env.c.selectContent({ key: 'site.about', title: 'About' } as any);
      expect(env.c.contentForm.body_markdown).toBe('Body');
      expect(env.c.contentForm.status).toBe('published');
    });

    it('selectContent toasts on failure', () => {
      const env = build('settings');
      env.admin.getContent.and.returnValue(throwError(() => new Error('x')));
      env.c.selectContent({ key: 'site.about', title: 'About' } as any);
      expect(env.toast.error).toHaveBeenCalled();
    });

    it('saveContent persists with the expected version', () => {
      const env = build('settings');
      env.c.selectedContent = { key: 'site.about' } as any;
      env.c.contentForm = { title: 'T', body_markdown: 'B', status: 'draft' };
      const reload = spyOn<any>(env.c, 'reloadContentBlocks').and.stub();
      env.admin.updateContentBlock.and.returnValue(of({ key: 'site.about', version: 4 }));
      env.c.saveContent();
      expect(env.admin.updateContentBlock).toHaveBeenCalled();
      expect(reload).toHaveBeenCalled();
      expect(env.c.selectedContent).toBeNull();
    });

    it('saveContent reloads on a 409 conflict', () => {
      const env = build('settings');
      env.c.selectedContent = { key: 'site.about' } as any;
      spyOn<any>(env.c, 'reloadContentBlocks').and.stub();
      env.admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 409 })));
      env.admin.getContent.and.returnValue(
        of({ key: 'site.about', title: 'A', body_markdown: '', status: 'draft' }),
      );
      env.c.saveContent();
      expect(env.toast.error).toHaveBeenCalled();
    });

    it('saveContent toasts on a non-conflict error', () => {
      const env = build('settings');
      env.c.selectedContent = { key: 'site.about' } as any;
      env.admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 500 })));
      env.c.saveContent();
      expect(env.toast.error).toHaveBeenCalledWith('adminUi.content.errors.update');
    });

    it('cancelContent clears the selection', () => {
      const env = build('settings');
      env.c.selectedContent = { key: 'k' } as any;
      env.c.cancelContent();
      expect(env.c.selectedContent).toBeNull();
    });

    it('reloadContentBlocks clones the fetched array', () => {
      const env = build('settings');
      const source = [{ key: 'blog.a' }] as any[];
      env.admin.content.and.returnValue(of(source));
      (env.c as any).reloadContentBlocks();
      expect(env.c.contentBlocks).toEqual(source as any);
      expect(env.c.contentBlocks).not.toBe(source as any);
    });
  });

  describe('blog posts + pins', () => {
    it('blogPosts filters blog-prefixed content', () => {
      const env = build('blog');
      env.c.contentBlocks = [{ key: 'blog.a' }, { key: 'site.x' }] as any;
      expect(env.c.blogPosts().map((p) => p.key)).toEqual(['blog.a']);
    });

    it('blogPinnedSlot reads pin metadata across types', () => {
      const env = build('blog');
      expect(env.c.blogPinnedSlot({ meta: null } as any)).toBeNull();
      expect(env.c.blogPinnedSlot({ meta: { pinned: false } } as any)).toBeNull();
      expect(env.c.blogPinnedSlot({ meta: { pinned: true, pin_order: 2 } } as any)).toBe(2);
      expect(env.c.blogPinnedSlot({ meta: { pinned: 1, pin_order: '3' } } as any)).toBe(3);
      expect(env.c.blogPinnedSlot({ meta: { pinned: 'yes' } } as any)).toBe(1);
    });

    it('blogPinnedPosts sorts by slot then recency', () => {
      const env = build('blog');
      env.c.contentBlocks = [
        { key: 'blog.a', meta: { pinned: true, pin_order: 2 }, published_at: '2026-01-01' },
        { key: 'blog.b', meta: { pinned: true, pin_order: 1 }, published_at: '2026-01-02' },
        { key: 'blog.c', meta: { pinned: false } },
      ] as any;
      expect(env.c.blogPinnedPosts().map((p) => p.key)).toEqual(['blog.b', 'blog.a']);
    });

    it('blog pin drag start/over set state', () => {
      const env = build('blog');
      env.c.onBlogPinDragStart('  blog.a  ');
      expect(env.c.draggingBlogPinKey).toBe('blog.a');
      const evt = { preventDefault: jasmine.createSpy('pd') } as any;
      env.c.onBlogPinDragOver(evt);
      expect(evt.preventDefault).toHaveBeenCalled();
    });

    it('onBlogPinDrop reorders pinned posts and persists', async () => {
      const env = build('blog');
      env.c.contentBlocks = [
        { key: 'blog.a', meta: { pinned: true, pin_order: 1 } },
        { key: 'blog.b', meta: { pinned: true, pin_order: 2 } },
      ] as any;
      env.c.draggingBlogPinKey = 'blog.b';
      spyOn<any>(env.c, 'reloadContentBlocks').and.stub();
      env.admin.updateContentBlock.and.returnValue(of({ key: 'blog.b', version: 2 }));
      await env.c.onBlogPinDrop('blog.a');
      expect(env.admin.updateContentBlock).toHaveBeenCalled();
      expect(env.c.blogPinsSaving).toBeFalse();
    });

    it('onBlogPinDrop exits on identical/empty keys', async () => {
      const env = build('blog');
      env.c.draggingBlogPinKey = 'blog.a';
      await env.c.onBlogPinDrop('blog.a');
      expect(env.admin.updateContentBlock).not.toHaveBeenCalled();
    });

    it('onBlogPinDrop toasts on persistence failure', async () => {
      const env = build('blog');
      env.c.contentBlocks = [
        { key: 'blog.a', meta: { pinned: true, pin_order: 1 } },
        { key: 'blog.b', meta: { pinned: true, pin_order: 2 } },
      ] as any;
      env.c.draggingBlogPinKey = 'blog.b';
      spyOn<any>(env.c, 'reloadContentBlocks').and.stub();
      env.admin.updateContentBlock.and.returnValue(throwError(() => new Error('x')));
      await env.c.onBlogPinDrop('blog.a');
      expect(env.toast.error).toHaveBeenCalled();
    });
  });

  describe('blog bulk selection', () => {
    it('toggles individual + all selection', () => {
      const env = build('blog');
      env.c.contentBlocks = [{ key: 'blog.a' }, { key: 'blog.b' }] as any;
      expect(env.c.isBlogSelected('blog.a')).toBeFalse();
      env.c.toggleBlogSelection('blog.a', { target: { checked: true } } as any);
      expect(env.c.isBlogSelected('blog.a')).toBeTrue();
      env.c.toggleBlogSelection('blog.a', { target: { checked: false } } as any);
      expect(env.c.isBlogSelected('blog.a')).toBeFalse();
      expect(env.c.areAllBlogSelected()).toBeFalse();
      env.c.toggleSelectAllBlogs({ target: { checked: true } } as any);
      expect(env.c.areAllBlogSelected()).toBeTrue();
      env.c.toggleSelectAllBlogs({ target: { checked: false } } as any);
      expect(env.c.blogBulkSelection.size).toBe(0);
      env.c.toggleBlogSelection('blog.a', { target: { checked: true } } as any);
      env.c.clearBlogBulkSelection();
      expect(env.c.blogBulkSelection.size).toBe(0);
    });

    it('areAllBlogSelected is false with no posts', () => {
      const env = build('blog');
      env.c.contentBlocks = [];
      expect(env.c.areAllBlogSelected()).toBeFalse();
    });

    it('canApplyBlogBulk validates per action', () => {
      const env = build('blog');
      env.c.blogBulkAction = 'publish';
      expect(env.c.canApplyBlogBulk()).toBeFalse();
      env.c.blogBulkSelection.add('blog.a');
      expect(env.c.canApplyBlogBulk()).toBeTrue();
      env.c.blogBulkAction = 'schedule';
      env.c.blogBulkPublishAt = '';
      expect(env.c.canApplyBlogBulk()).toBeFalse();
      env.c.blogBulkPublishAt = '2026-01-01T10:00';
      expect(env.c.canApplyBlogBulk()).toBeTrue();
      env.c.blogBulkUnpublishAt = '2026-01-01T09:00';
      expect(env.c.canApplyBlogBulk()).toBeFalse();
      env.c.blogBulkUnpublishAt = '2026-01-02T10:00';
      expect(env.c.canApplyBlogBulk()).toBeTrue();
      env.c.blogBulkAction = 'tags_add';
      env.c.blogBulkTags = '';
      expect(env.c.canApplyBlogBulk()).toBeFalse();
      env.c.blogBulkTags = 'sale, new';
      expect(env.c.canApplyBlogBulk()).toBeTrue();
    });

    it('blogBulkPreview renders per action', () => {
      const env = build('blog');
      expect(env.c.blogBulkPreview()).toBe('adminUi.blog.bulk.previewEmpty');
      env.c.blogBulkSelection.add('blog.a');
      env.c.blogBulkAction = 'publish';
      expect(env.c.blogBulkPreview()).toBe('adminUi.blog.bulk.previewPublish');
      env.c.blogBulkAction = 'unpublish';
      expect(env.c.blogBulkPreview()).toBe('adminUi.blog.bulk.previewUnpublish');
      env.c.blogBulkAction = 'schedule';
      env.c.blogBulkPublishAt = '2026-01-01T10:00';
      expect(env.c.blogBulkPreview()).toBe('adminUi.blog.bulk.previewSchedule');
      env.c.blogBulkAction = 'tags_add';
      env.c.blogBulkTags = 'a';
      expect(env.c.blogBulkPreview()).toBe('adminUi.blog.bulk.previewTagsAdd');
      env.c.blogBulkAction = 'tags_remove';
      expect(env.c.blogBulkPreview()).toBe('adminUi.blog.bulk.previewTagsRemove');
    });

    it('applyBlogBulkAction publishes the selected posts', () => {
      const env = build('blog');
      env.c.blogBulkAction = 'publish';
      env.c.blogBulkSelection.add('blog.a');
      spyOn<any>(env.c, 'reloadContentBlocks').and.stub();
      env.admin.getContent.and.returnValue(of({ key: 'blog.a', meta: {}, version: 1 }));
      env.admin.updateContentBlock.and.returnValue(of({ key: 'blog.a', version: 2 }));
      env.c.applyBlogBulkAction();
      expect(env.admin.updateContentBlock).toHaveBeenCalled();
      expect(env.c.blogBulkSaving).toBeFalse();
    });

    it('applyBlogBulkAction reports no-change when payloads are empty', () => {
      const env = build('blog');
      env.c.blogBulkAction = 'tags_add';
      env.c.blogBulkTags = 'x';
      env.c.blogBulkSelection.add('blog.a');
      env.admin.getContent.and.returnValue(of(null));
      env.c.applyBlogBulkAction();
      expect(env.c.blogBulkError).toBe('adminUi.blog.bulk.noChanges');
    });

    it('extractBlogSlug + currentBlogSlug strip the blog prefix', () => {
      const env = build('blog');
      expect(env.c.extractBlogSlug('blog.welcome')).toBe('welcome');
      expect(env.c.extractBlogSlug('welcome')).toBe('welcome');
      expect(env.c.currentBlogSlug()).toBe('');
      env.c.selectedBlogKey = 'blog.welcome';
      expect(env.c.currentBlogSlug()).toBe('welcome');
    });

    it('blogCreateSlug normalizes diacritics + whitespace', () => {
      const env = build('blog');
      env.c.blogCreate.title = '  Ănță Test Post!  ';
      expect(env.c.blogCreateSlug()).toBe('anta-test-post');
    });
  });

  describe('value normalizers', () => {
    it('safePageRecordKey rejects malformed/prototype keys', () => {
      const env = build('pages');
      const s = (k: string) => (env.c as any).safePageRecordKey(k);
      expect(s('page.about')).toBe('page.about');
      expect(s('not-a-page')).toBe('page.about');
      expect(s('page.__proto__')).toBe('page.about');
      expect(s('page.x.constructor')).toBe('page.about');
    });

    it('safeRecordKey falls back for unsafe keys', () => {
      const env = build('pages');
      const s = (k: string) => (env.c as any).safeRecordKey(k);
      expect(s('site.assets')).toBe('site.assets');
      expect(s('has space')).toBe('unknown');
      expect(s('__proto__')).toBe('unknown');
      expect(s('a.prototype')).toBe('unknown');
    });

    it('deleteRecordValue removes the safe key', () => {
      const env = build('pages');
      const rec: Record<string, unknown> = { 'site.assets': 1 };
      (env.c as any).deleteRecordValue(rec, 'site.assets');
      expect(rec['site.assets']).toBeUndefined();
    });

    it('toLocalizedText handles strings, objects, and junk', () => {
      const env = build('pages');
      const t = (v: unknown) => (env.c as any).toLocalizedText(v);
      expect(t('  hi ')).toEqual({ en: 'hi', ro: 'hi' });
      expect(t({ en: ' a ', ro: 5 })).toEqual({ en: 'a', ro: '' });
      expect(t(null)).toEqual({ en: '', ro: '' });
    });

    it('toFocalValue clamps to 0..100', () => {
      const env = build('pages');
      const f = (v: unknown) => (env.c as any).toFocalValue(v);
      expect(f('abc')).toBe(50);
      expect(f(-10)).toBe(0);
      expect(f(150)).toBe(100);
      expect(f(33.4)).toBe(33);
    });

    it('toBooleanValue parses truthy/falsey/fallback', () => {
      const env = build('pages');
      const b = (v: unknown, fb?: boolean) => (env.c as any).toBooleanValue(v, fb);
      expect(b(true)).toBeTrue();
      expect(b(1)).toBeTrue();
      expect(b('yes')).toBeTrue();
      expect(b('off')).toBeFalse();
      expect(b('maybe', true)).toBeTrue();
    });

    it('toCmsBlockLayout coerces known + unknown values', () => {
      const env = build('pages');
      const l = (v: unknown) => (env.c as any).toCmsBlockLayout(v);
      expect(
        l({ spacing: 'md', background: 'accent', align: 'center', max_width: 'prose' }),
      ).toEqual({ spacing: 'md', background: 'accent', align: 'center', max_width: 'prose' });
      expect(l({ spacing: 'huge', maxWidth: 'wide' })).toEqual({
        spacing: 'none',
        background: 'none',
        align: 'left',
        max_width: 'wide',
      });
      expect(l(null)).toEqual({
        spacing: 'none',
        background: 'none',
        align: 'left',
        max_width: 'full',
      });
    });

    it('focalPosition builds a CSS position string', () => {
      const env = build('pages');
      expect(env.c.focalPosition(20, 80)).toBe('20% 80%');
    });

    it('toSlideDraft hydrates from a partial record', () => {
      const env = build('home');
      const draft = (env.c as any).toSlideDraft({
        image: 'u.png',
        variant: 'full',
        size: 'S',
        text_style: 'light',
        focal_x: 10,
      });
      expect(draft.image_url).toBe('u.png');
      expect(draft.variant).toBe('full');
      expect(draft.size).toBe('S');
      expect(draft.text_style).toBe('light');
      expect(draft.focal_x).toBe(10);
      expect((env.c as any).toSlideDraft(null).variant).toBe('split');
    });

    it('toCarouselSettingsDraft applies defaults + overrides', () => {
      const env = build('home');
      const d = (env.c as any).toCarouselSettingsDraft({
        autoplay: true,
        interval_ms: 3000,
        show_dots: false,
      });
      expect(d.autoplay).toBeTrue();
      expect(d.interval_ms).toBe(3000);
      expect(d.show_dots).toBeFalse();
      expect(d.show_arrows).toBeTrue();
      const def = (env.c as any).toCarouselSettingsDraft('bad');
      expect(def.interval_ms).toBe(5000);
    });

    it('serializeSlideDraft trims + clamps', () => {
      const env = build('home');
      const slide = {
        ...(env.c as any).emptySlideDraft(),
        image_url: ' x ',
        cta_url: ' y ',
        focal_x: 200,
      };
      const out = (env.c as any).serializeSlideDraft(slide);
      expect(out['image_url']).toBe('x');
      expect(out['cta_url']).toBe('y');
      expect(out['focal_x']).toBe(100);
    });

    it('toPreviewSlide prefers active lang then falls back', () => {
      const env = build('home');
      const slide = {
        ...(env.c as any).emptySlideDraft(),
        headline: { en: 'Hello', ro: '' },
        image_url: 'u',
      };
      expect(env.c.toPreviewSlide(slide, 'ro').headline).toBe('Hello');
      expect(env.c.toPreviewSlide(slide, 'en').headline).toBe('Hello');
      expect(env.c.toPreviewSlides([slide], 'en').length).toBe(1);
    });

    it('normalizeHomeSectionId maps aliases', () => {
      const env = build('home');
      const n = (v: unknown) => (env.c as any).normalizeHomeSectionId(v);
      expect(n('featured_products')).toBe('featured_products');
      expect(n('collections')).toBe('featured_collections');
      expect(n('Sales')).toBe('sale_products');
      expect(n('new')).toBe('new_arrivals');
      expect(n('recent')).toBe('recently_viewed');
      expect(n('totally-unknown')).toBeNull();
      expect(n(123)).toBeNull();
      expect(n('  ')).toBeNull();
    });

    it('defaultHomeSections + ensureAllDefaultHomeBlocks fill gaps', () => {
      const env = build('home');
      expect((env.c as any).defaultHomeSections().length).toBe(7);
      const filled = (env.c as any).ensureAllDefaultHomeBlocks([
        (env.c as any).makeHomeBlockDraft('story', 'story', true),
      ]);
      const types = filled.map((b: any) => b.type);
      expect(types).toContain('featured_products');
      expect(types.filter((t: string) => t === 'story').length).toBe(1);
    });

    it('isCustomHomeBlock distinguishes custom vs section blocks', () => {
      const env = build('home');
      expect(env.c.isCustomHomeBlock({ type: 'text' } as any)).toBeTrue();
      expect(env.c.isCustomHomeBlock({ type: 'story' } as any)).toBeFalse();
    });

    it('homeBlockLabel translates or falls back to type', () => {
      const env = build('home');
      expect(env.c.homeBlockLabel({ type: 'text' } as any)).toBe('text');
      env.translate.instant = (k: string) => (k.endsWith('.cta') ? 'Call to action' : k);
      expect(env.c.homeBlockLabel({ type: 'cta' } as any)).toBe('Call to action');
    });

    it('toggleHomeBlockEnabled + moveHomeBlock mutate immutably', () => {
      const env = build('home');
      env.c.homeBlocks = [
        (env.c as any).makeHomeBlockDraft('a', 'text', true),
        (env.c as any).makeHomeBlockDraft('b', 'cta', true),
      ];
      env.c.toggleHomeBlockEnabled(env.c.homeBlocks[0], { target: { checked: false } } as any);
      expect(env.c.homeBlocks[0].enabled).toBeFalse();
      env.c.moveHomeBlock('a', 1);
      expect(env.c.homeBlocks.map((b) => b.key)).toEqual(['b', 'a']);
      env.c.moveHomeBlock('ghost', 1);
      env.c.moveHomeBlock('a', 5);
      expect(env.c.homeBlocks.map((b) => b.key)).toEqual(['b', 'a']);
      env.c.setHomeInsertDragActive(true);
      expect(env.c.homeInsertDragActive).toBeTrue();
    });
  });

  describe('site settings load/save', () => {
    it('loadReportsSettings parses recipients + falls back', () => {
      const env = build('settings');
      env.admin.getContent.and.returnValue(
        of({
          version: 1,
          meta: {
            reports_weekly_enabled: true,
            reports_weekly_weekday: 9,
            reports_monthly_day: 40,
            reports_recipients: 'a@b.com, c@d.com',
            reports_weekly_last_error: 'boom',
          },
        }),
      );
      env.c.loadReportsSettings();
      expect(env.c.reportsSettingsForm.weekly_enabled).toBeTrue();
      expect(env.c.reportsSettingsForm.weekly_weekday).toBe(6);
      expect(env.c.reportsSettingsForm.recipients).toBe('a@b.com, c@d.com');
      expect(env.c.reportsWeeklyLastError).toBe('boom');
      env.admin.getContent.and.returnValue(throwError(() => new Error('x')));
      env.c.loadReportsSettings();
      expect(env.c.reportsSettingsForm.recipients).toBe('');
    });

    it('saveReportsSettings filters invalid emails + create fallback', () => {
      const env = build('settings');
      env.c.reportsSettingsForm.recipients = 'a@b.com, not-an-email, a@b.com';
      env.admin.updateContentBlock.and.returnValue(
        of({ version: 2, meta: { reports_recipients: ['a@b.com'] } }),
      );
      env.c.saveReportsSettings();
      const payload = env.admin.updateContentBlock.calls.mostRecent().args[1];
      expect(payload.meta.reports_recipients).toEqual(['a@b.com']);
      env.admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 404 })));
      env.admin.createContent.and.returnValue(of({ version: 1 }));
      env.c.saveReportsSettings();
      expect(env.admin.createContent).toHaveBeenCalled();
    });

    it('sendReportNow guards re-entry + reports skipped/sent', () => {
      const env = build('settings');
      env.admin.sendScheduledReport.and.returnValue(of({ skipped: true }));
      spyOn(env.c, 'loadReportsSettings').and.stub();
      env.c.sendReportNow('weekly');
      expect(env.c.reportsSettingsMessage).toBe('adminUi.reports.success.skipped');
      env.admin.sendScheduledReport.and.returnValue(of({ skipped: false }));
      env.c.sendReportNow('monthly', true);
      expect(env.c.reportsSettingsMessage).toBe('adminUi.reports.success.sent');
      env.admin.sendScheduledReport.and.returnValue(throwError(() => new Error('x')));
      env.c.sendReportNow('weekly');
      expect(env.c.reportsSettingsError).toBe('adminUi.reports.errors.send');
    });
  });

  describe('navigation', () => {
    it('loadNavigation parses links + falls back to defaults', () => {
      const env = build('settings');
      env.admin.getContent.and.returnValue(
        of({
          version: 1,
          meta: {
            header_links: [
              { id: 'h1', url: '/', label: { en: 'Home', ro: 'Acasa' } },
              { url: '', label: {} },
            ],
          },
        }),
      );
      env.c.loadNavigation();
      expect(env.c.navigationForm.header_links.length).toBe(1);
      env.admin.getContent.and.returnValue(throwError(() => new Error('x')));
      env.c.loadNavigation();
      expect(env.c.navigationForm.header_links.length).toBeGreaterThan(1);
    });

    it('add/remove/move navigation links across lists', () => {
      const env = build('settings');
      env.c.navigationForm = (env.c as any).defaultNavigationForm();
      env.c.addNavigationLink('header');
      env.c.addNavigationLink('footer_handcrafted');
      env.c.addNavigationLink('footer_legal');
      const headerLast = env.c.navigationForm.header_links.slice(-1)[0].id;
      env.c.removeNavigationLink('header', headerLast);
      expect(env.c.navigationForm.header_links.find((l) => l.id === headerLast)).toBeUndefined();
      env.c.removeNavigationLink('header', '');
      const first = env.c.navigationForm.header_links[0].id;
      env.c.moveNavigationLink('header', first, 1);
      expect(env.c.navigationForm.header_links[1].id).toBe(first);
      env.c.moveNavigationLink('header', first, 99);
      env.c.moveNavigationLink('header', '', 1);
      env.c.removeNavigationLink(
        'footer_handcrafted',
        env.c.navigationForm.footer_handcrafted_links.slice(-1)[0].id,
      );
      env.c.removeNavigationLink(
        'footer_legal',
        env.c.navigationForm.footer_legal_links.slice(-1)[0].id,
      );
      env.c.moveNavigationLink(
        'footer_handcrafted',
        env.c.navigationForm.footer_handcrafted_links[0].id,
        1,
      );
      env.c.moveNavigationLink('footer_legal', env.c.navigationForm.footer_legal_links[0].id, 1);
    });

    it('resetNavigationDefaults requires confirmation', () => {
      const env = build('settings');
      const confirmSpy = spyOn(window, 'confirm').and.returnValue(false);
      env.c.navigationForm = {
        header_links: [],
        footer_handcrafted_links: [],
        footer_legal_links: [],
      };
      env.c.resetNavigationDefaults();
      expect(env.c.navigationForm.header_links.length).toBe(0);
      confirmSpy.and.returnValue(true);
      env.c.resetNavigationDefaults();
      expect(env.c.navigationForm.header_links.length).toBeGreaterThan(0);
    });

    it('navigation drag start/over/drop reorders within a list', () => {
      const env = build('settings');
      env.c.navigationForm = (env.c as any).defaultNavigationForm();
      const a = env.c.navigationForm.header_links[0].id;
      const b = env.c.navigationForm.header_links[1].id;
      const evt = { preventDefault: jasmine.createSpy('pd') } as any;
      env.c.onNavigationDragOver(evt);
      expect(evt.preventDefault).toHaveBeenCalled();
      env.c.onNavigationDragStart('header', a);
      env.c.onNavigationDrop('header', b);
      expect(env.c.navigationForm.header_links[1].id).toBe(a);
      env.c.onNavigationDragStart('header', a);
      env.c.onNavigationDrop('header', a);
      env.c.onNavigationDragStart('footer_legal', 'ghost');
      env.c.onNavigationDrop('footer_legal', env.c.navigationForm.footer_legal_links[0].id);
    });

    it('saveNavigation validates + persists', () => {
      const env = build('settings');
      env.c.navigationForm = {
        header_links: [{ id: 'h1', url: '/x', label: { en: 'X', ro: '' } }],
        footer_handcrafted_links: [],
        footer_legal_links: [],
      };
      env.c.saveNavigation();
      expect(env.c.navigationError).toBe('adminUi.site.navigation.errors.invalid');
      env.c.navigationForm = {
        header_links: [
          { id: 'h1', url: '/x', label: { en: 'X', ro: 'X' } },
          { id: 'blank', url: '', label: { en: '', ro: '' } },
        ],
        footer_handcrafted_links: [],
        footer_legal_links: [],
      };
      env.admin.updateContentBlock.and.returnValue(of({ version: 2 }));
      env.c.saveNavigation();
      expect(env.c.navigationMessage).toBe('adminUi.site.navigation.success.save');
      env.admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 404 })));
      env.admin.createContent.and.returnValue(of({ version: 1 }));
      env.c.saveNavigation();
      expect(env.admin.createContent).toHaveBeenCalled();
    });
  });

  describe('seo + sitemap + structured data', () => {
    it('selectSeoLang + loadSeo hydrate the form', () => {
      const env = build('settings');
      env.admin.getContent.and.returnValue(
        of({ title: 'T', meta: { description: 'D' }, version: 1 }),
      );
      env.c.selectSeoLang('ro');
      expect(env.c.seoLang).toBe('ro');
      expect(env.c.seoForm.title).toBe('T');
      env.admin.getContent.and.returnValue(throwError(() => new Error('x')));
      env.c.loadSeo();
      expect(env.c.seoForm.title).toBe('');
    });

    it('saveSeo persists + create fallback', () => {
      const env = build('settings');
      env.admin.updateContentBlock.and.returnValue(of({ version: 2 }));
      env.c.saveSeo();
      expect(env.c.seoMessage).toBe('adminUi.site.seo.success.save');
      env.admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 404 })));
      env.admin.createContent.and.returnValue(of({ version: 1 }));
      env.c.saveSeo();
      expect(env.admin.createContent).toHaveBeenCalled();
      env.admin.createContent.and.returnValue(throwError(() => new Error('x')));
      env.c.saveSeo();
      expect(env.c.seoError).toBe('adminUi.site.seo.errors.save');
    });

    it('loadSitemapPreview maps by_lang + handles errors', () => {
      const env = build('settings');
      env.admin.getSitemapPreview.and.returnValue(of({ by_lang: { en: ['/'] } }));
      env.c.loadSitemapPreview();
      expect(env.c.sitemapPreviewByLang).toEqual({ en: ['/'] });
      env.admin.getSitemapPreview.and.returnValue(
        throwError(() => ({ error: { detail: 'down' } })),
      );
      env.c.loadSitemapPreview();
      expect(env.c.sitemapPreviewError).toBe('down');
    });

    it('structuredDataIssueUrl maps entity types', () => {
      const env = build('settings');
      expect(env.c.structuredDataIssueUrl({ entity_type: 'product', entity_key: 'mug' })).toBe(
        '/products/mug',
      );
      expect(env.c.structuredDataIssueUrl({ entity_type: 'page', entity_key: 'page.about' })).toBe(
        '/about',
      );
      expect(
        env.c.structuredDataIssueUrl({ entity_type: 'page', entity_key: 'page.contact' }),
      ).toBe('/contact');
      expect(env.c.structuredDataIssueUrl({ entity_type: 'page', entity_key: 'page.faq' })).toBe(
        '/pages/faq',
      );
      expect(env.c.structuredDataIssueUrl({ entity_type: 'page', entity_key: 'page.' })).toBe(
        '/pages',
      );
      expect(env.c.structuredDataIssueUrl({ entity_type: 'other', entity_key: 'x' })).toBe('/');
    });

    it('runStructuredDataValidation stores results + errors', () => {
      const env = build('settings');
      env.admin.validateStructuredData.and.returnValue(of({ ok: true }));
      env.c.runStructuredDataValidation();
      expect(env.c.structuredDataResult).toEqual({ ok: true } as any);
      env.admin.validateStructuredData.and.returnValue(
        throwError(() => ({ error: { detail: 'invalid' } })),
      );
      env.c.runStructuredDataValidation();
      expect(env.c.structuredDataError).toBe('invalid');
    });

    it('selectInfoLang sets the active language', () => {
      const env = build('pages');
      env.c.selectInfoLang('ro');
      expect(env.c.infoLang).toBe('ro');
    });
  });

  describe('page builder', () => {
    const allTypesMeta = {
      blocks: [
        { key: 'b_text', type: 'text', body_markdown: { en: 'Hi', ro: 'Salut' } },
        {
          type: 'columns',
          columns: [{ title: 'A' }, { title: 'B' }, { title: 'C' }, { title: 'D' }],
          columns_breakpoint: 'lg',
        },
        { type: 'cta', cta_url: '/go', cta_new_tab: 'yes' },
        { type: 'faq', items: [{ question: 'Q' }] },
        { type: 'testimonials', items: [{ author: 'Jo' }] },
        { type: 'product_grid', source: 'products', product_slugs: 'a, b, b', limit: 100 },
        { type: 'form', form_type: 'newsletter', topic: 'support' },
        { type: 'image', url: 'i.png', link_url: '/l', focal_x: 10, focal_y: 90 },
        { type: 'gallery', images: [{ url: 'g.png' }, { noturl: true }] },
        { type: 'banner', slide: { image_url: 's.png' } },
        { type: 'carousel', slides: [{ image_url: 'c.png' }], settings: { autoplay: true } },
        { type: 'unknown-type' },
        'not-an-object',
        { type: 'text', key: 'b_text' },
      ],
    };

    function pageWithAllBlocks(env: ReturnType<typeof build>) {
      env.c.pageBlocks['page.about'] = (env.c as any).parsePageBlocksDraft(allTypesMeta);
      return env.c.pageBlocks['page.about'];
    }

    it('parsePageBlocksDraft parses every block type', () => {
      const env = build('pages');
      const blocks = pageWithAllBlocks(env);
      const types = blocks.map((b) => b.type);
      expect(types).toEqual([
        'text',
        'columns',
        'cta',
        'faq',
        'testimonials',
        'product_grid',
        'form',
        'image',
        'gallery',
        'banner',
        'carousel',
      ]);
      const grid = blocks.find((b) => b.type === 'product_grid')!;
      expect(grid.product_grid_source).toBe('products');
      expect(grid.product_grid_limit).toBe(24);
      expect(grid.product_grid_product_slugs).toBe('a\nb');
      expect(blocks.find((b) => b.type === 'cta')!.cta_new_tab).toBeTrue();
      expect(blocks.find((b) => b.type === 'columns')!.columns.length).toBe(3);
    });

    it('parsePageBlocksDraft returns [] for empty/missing blocks', () => {
      const env = build('pages');
      expect((env.c as any).parsePageBlocksDraft(null)).toEqual([]);
      expect((env.c as any).parsePageBlocksDraft({ blocks: [] })).toEqual([]);
    });

    it('loadPageBlocks hydrates from server meta', () => {
      const env = build('pages');
      env.admin.getContent.and.returnValue(
        of({
          status: 'published',
          published_at: '2026-01-01T10:00:00Z',
          version: 1,
          needs_translation_en: true,
          meta: { requires_auth: true, ...allTypesMeta },
        }),
      );
      env.c.loadPageBlocks('page.about');
      expect(env.c.pageBlocks['page.about'].length).toBe(11);
      expect(env.c.pageBlocksStatus['page.about']).toBe('published');
      expect(env.c.pageBlocksRequiresAuth['page.about']).toBeTrue();
    });

    it('loadPageBlocks treats 404 as an empty draft', () => {
      const env = build('pages');
      env.admin.getContent.and.returnValue(throwError(() => ({ status: 404 })));
      env.c.loadPageBlocks('page.about');
      expect(env.c.pageBlocks['page.about']).toEqual([]);
      expect(env.c.pageBlocksStatus['page.about']).toBe('draft');
    });

    it('loadPageBlocks records a generic load error', () => {
      const env = build('pages');
      env.admin.getContent.and.returnValue(throwError(() => ({ status: 500 })));
      env.c.loadPageBlocks('page.about');
      expect(env.c.pageBlocksError['page.about']).toBe('adminUi.site.pages.builder.errors.load');
    });

    it('add/remove/move/toggle page blocks', () => {
      const env = build('pages');
      pageWithAllBlocks(env);
      const before = env.c.pageBlocks['page.about'].length;
      env.c.newPageBlockType = 'text';
      env.c.addPageBlock('page.about');
      expect(env.c.pageBlocks['page.about'].length).toBe(before + 1);
      const lastKey = env.c.pageBlocks['page.about'].slice(-1)[0].key;
      env.c.removePageBlock('page.about', lastKey);
      expect(env.c.pageBlocks['page.about'].length).toBe(before);
      env.c.togglePageBlockEnabled('page.about', 'b_text', { target: { checked: false } } as any);
      expect(env.c.pageBlocks['page.about'].find((b) => b.key === 'b_text')!.enabled).toBeFalse();
      expect(env.c.pageBlockLabel({ type: 'text' } as any)).toBe('text');
      const firstKey = env.c.pageBlocks['page.about'][0].key;
      env.c.movePageBlock('page.about', firstKey, 1);
      expect(env.c.pageBlocks['page.about'][1].key).toBe(firstKey);
      env.c.movePageBlock('page.about', 'ghost', 1);
      env.c.movePageBlock('page.about', firstKey, 99);
      env.c.setPageInsertDragActive(true);
      expect(env.c.pageInsertDragActive).toBeTrue();
    });

    it('page block drag reorder via drop zone + drop target', () => {
      const env = build('pages');
      pageWithAllBlocks(env);
      const keys = env.c.pageBlocks['page.about'].map((b) => b.key);
      env.c.onPageBlockDragStart('page.about', keys[0]);
      expect(env.c.draggingPageBlockKey).toBe(keys[0]);
      const evt = { preventDefault: jasmine.createSpy('pd'), dataTransfer: null } as any;
      env.c.onPageBlockDragOver(evt);
      expect(evt.preventDefault).toHaveBeenCalled();
      env.c.onPageBlockDropZone(evt, 'page.about', 2);
      expect(env.c.pageBlocks['page.about'][1].key).toBe(keys[0]);
      env.c.onPageBlockDragStart('page.about', keys[1]);
      env.c.onPageBlockDrop(evt, 'page.about', keys[3]);
      env.c.onPageBlockDragEnd();
      expect(env.c.draggingPageBlockKey).toBeNull();
    });

    it('carousel slide manipulators', () => {
      const env = build('pages');
      pageWithAllBlocks(env);
      const block = env.c.pageBlocks['page.about'].find((b) => b.type === 'carousel')!;
      env.c.addPageCarouselSlide('page.about', block.key);
      let cur = env.c.pageBlocks['page.about'].find((b) => b.type === 'carousel')!;
      expect(cur.slides.length).toBe(2);
      env.c.movePageCarouselSlide('page.about', block.key, 0, 1);
      env.c.movePageCarouselSlide('page.about', block.key, 0, 99);
      env.c.setPageCarouselSlideImage('page.about', block.key, 0, {
        url: 'new.png',
        focal_x: 1,
        focal_y: 2,
      } as any);
      cur = env.c.pageBlocks['page.about'].find((b) => b.type === 'carousel')!;
      expect(cur.slides[0].image_url).toBe('new.png');
      env.c.removePageCarouselSlide('page.about', block.key, 0);
      env.c.setPageBannerSlideImage(
        'page.about',
        env.c.pageBlocks['page.about'].find((b) => b.type === 'banner')!.key,
        { url: 'b.png' } as any,
      );
    });

    it('gallery + columns + faq + testimonial manipulators', () => {
      const env = build('pages');
      pageWithAllBlocks(env);
      const gallery = env.c.pageBlocks['page.about'].find((b) => b.type === 'gallery')!;
      env.c.addPageGalleryImage('page.about', gallery.key);
      env.c.addPageGalleryImageFromAsset('page.about', gallery.key, {
        url: 'a.png',
        focal_x: 1,
        focal_y: 2,
      } as any);
      const cur = env.c.pageBlocks['page.about'].find((b) => b.type === 'gallery')!;
      expect(cur.images.length).toBeGreaterThanOrEqual(3);
      env.c.removePageGalleryImage('page.about', gallery.key, 0);
      env.c.setPageImageBlockUrl(
        'page.about',
        env.c.pageBlocks['page.about'].find((b) => b.type === 'image')!.key,
        { url: 'x.png', focal_x: 5, focal_y: 6 } as any,
      );

      const columns = env.c.pageBlocks['page.about'].find((b) => b.type === 'columns')!;
      env.c.addPageColumnsColumn('page.about', columns.key);
      env.c.removePageColumnsColumn('page.about', columns.key, 0);

      const faq = env.c.pageBlocks['page.about'].find((b) => b.type === 'faq')!;
      env.c.addPageFaqItem('page.about', faq.key);
      env.c.removePageFaqItem('page.about', faq.key, 0);

      const test = env.c.pageBlocks['page.about'].find((b) => b.type === 'testimonials')!;
      env.c.addPageTestimonial('page.about', test.key);
      env.c.removePageTestimonial('page.about', test.key, 0);
    });

    it('product grid slug helpers', () => {
      const env = build('pages');
      const block = { product_grid_product_slugs: 'a\nb' };
      expect(env.c.productGridSelectedSlugs(block)).toEqual(['a', 'b']);
      env.c.addProductGridProductSlug(block, 'c');
      expect(block.product_grid_product_slugs).toBe('a\nb\nc');
      env.c.addProductGridProductSlug(block, 'c');
      env.c.addProductGridProductSlug(block, '  ');
      env.c.removeProductGridProductSlug(block, 'a');
      expect(block.product_grid_product_slugs).toBe('b\nc');
      env.c.removeProductGridProductSlug(block, '  ');
    });

    it('searchProductGridProducts queries + handles errors', () => {
      const env = build('pages');
      env.c.searchProductGridProducts('blk');
      expect(env.c.productGridProductSearchLoading['blk']).toBeFalse();
      env.c.productGridProductSearchQuery['blk'] = 'mug';
      env.adminProducts.search.and.returnValue(of({ items: [{ slug: 'mug' }] }));
      env.c.searchProductGridProducts('blk');
      expect(env.c.productGridProductSearchResults['blk'].length).toBe(1);
      env.adminProducts.search.and.returnValue(throwError(() => new Error('x')));
      env.c.searchProductGridProducts('blk');
      expect(env.c.productGridProductSearchError['blk']).toBe(
        'adminUi.home.sections.errors.searchProducts',
      );
    });

    it('queueProductGridProductSearch debounces + clears', () => {
      jasmine.clock().install();
      const env = build('pages');
      env.c.productGridProductSearchQuery['blk'] = 'old';
      env.c.queueProductGridProductSearch('blk', '');
      expect(env.c.productGridProductSearchResults['blk']).toEqual([]);
      env.adminProducts.search.and.returnValue(of({ items: [] }));
      env.c.queueProductGridProductSearch('blk', 'mug');
      jasmine.clock().tick(300);
      expect(env.adminProducts.search).toHaveBeenCalled();
      jasmine.clock().uninstall();
    });

    it('createCustomPage validates title + reserved slugs', () => {
      const env = build('pages');
      env.c.newCustomPageTitle = '';
      env.c.createCustomPage();
      expect(env.admin.createContent).not.toHaveBeenCalled();
      env.c.newCustomPageTitle = 'About';
      env.c.createCustomPage();
      expect(env.toast.error).toHaveBeenCalled();
    });

    it('createCustomPage creates a unique custom page', () => {
      const env = build('pages');
      env.c.newCustomPageTitle = 'My New Page';
      env.c.contentPages = [{ slug: 'my-new-page', key: 'page.my-new-page' }] as any;
      env.admin.createContent.and.returnValue(of({ version: 1 }));
      spyOn(env.c, 'loadContentPages').and.stub();
      spyOn(env.c, 'loadPageBlocks').and.stub();
      env.c.createCustomPage();
      expect(env.admin.createContent).toHaveBeenCalled();
      expect(env.c.creatingCustomPage).toBeFalse();
    });

    it('createCustomPage surfaces a server error', () => {
      const env = build('pages');
      env.c.newCustomPageTitle = 'Brand New';
      env.admin.createContent.and.returnValue(throwError(() => ({ error: { detail: 'taken' } })));
      env.c.createCustomPage();
      expect(env.toast.error).toHaveBeenCalledWith('taken');
    });
  });
});
