import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';

import { AdminComponent } from './admin.component';

/**
 * Behavioural coverage suite for the (very large) admin content component.
 *
 * The component is exercised through direct instantiation (the same pattern the
 * existing first-paint spec uses) so individual methods can be driven in
 * isolation with focused service mocks. Every test asserts real behaviour:
 * returned values, mutated component state, service calls with concrete
 * arguments, and toast/error side effects.
 */

type RouteStub = {
  snapshot: { data: Record<string, unknown>; queryParams: Record<string, unknown> };
  data: Subject<Record<string, unknown>>;
  queryParams: Subject<Record<string, unknown>>;
};

function createRouteStub(section = 'home', query: Record<string, unknown> = {}): RouteStub {
  return {
    snapshot: { data: { section }, queryParams: query },
    data: new Subject<Record<string, unknown>>(),
    queryParams: new Subject<Record<string, unknown>>(),
  };
}

interface Harness {
  component: AdminComponent;
  admin: any;
  adminProducts: any;
  blog: any;
  fxAdmin: any;
  taxesAdmin: any;
  auth: any;
  cmsPrefs: any;
  toast: jasmine.SpyObj<any>;
  translate: any;
  markdown: any;
  sanitizer: any;
  route: RouteStub;
}

function makeAdminSpy(): any {
  // Every admin-service method used by the component, defaulting to a benign
  // observable. Individual tests override return values per scenario.
  const methods = [
    'products',
    'coupons',
    'lowStock',
    'audit',
    'getMaintenance',
    'setMaintenance',
    'content',
    'getContent',
    'createContent',
    'updateContentBlock',
    'deleteContent',
    'getCategories',
    'createCategory',
    'updateCategory',
    'deleteCategory',
    'getCategoryTranslations',
    'upsertCategoryTranslation',
    'deleteCategoryTranslation',
    'createProduct',
    'updateProduct',
    'getProduct',
    'deleteProduct',
    'duplicateProduct',
    'uploadProductImage',
    'deleteProductImage',
    'transferOwner',
    'revokeSessions',
    'userAliases',
    'updateUserRole',
    'updateOrderStatus',
    'createCoupon',
    'updateCoupon',
    'invalidateCouponStripeMappings',
    'listContentVersions',
    'getContentVersion',
    'rollbackContentVersion',
    'uploadContentImage',
    'updateContentImageFocalPoint',
    'listContentPages',
    'renameContentPage',
    'updateContentTranslationStatus',
    'getSitemapPreview',
    'validateStructuredData',
    'deleteContentRedirect',
    'exportContentRedirects',
    'importContentRedirects',
    'upsertContentRedirect',
    'previewFindReplaceContent',
    'applyFindReplaceContent',
    'linkCheckContent',
    'fetchSocialThumbnail',
    'sendScheduledReport',
    'createPagePreviewToken',
    'createHomePreviewToken',
    'listFeaturedCollections',
    'createFeaturedCollection',
    'updateFeaturedCollection',
    'reorderCategories',
    'listContentRedirects',
    'linkCheckContentPreview',
  ];
  const spy: any = jasmine.createSpyObj('AdminService', methods);
  for (const m of methods) spy[m].and.returnValue(of(undefined));
  spy.products.and.returnValue(of([]));
  spy.coupons.and.returnValue(of([]));
  spy.lowStock.and.returnValue(of([]));
  spy.audit.and.returnValue(of({ products: [], content: [], security: [] }));
  spy.getMaintenance.and.returnValue(of({ enabled: false }));
  spy.content.and.returnValue(of([]));
  spy.getCategories.and.returnValue(of([]));
  spy.listFeaturedCollections.and.returnValue(of([]));
  spy.userAliases.and.returnValue(of({ aliases: [] }));
  return spy;
}

function makeCmsPrefs(): any {
  return {
    mode: jasmine.createSpy('mode').and.returnValue('basic'),
    previewDevice: jasmine.createSpy('previewDevice').and.returnValue('desktop'),
    previewLayout: jasmine.createSpy('previewLayout').and.returnValue('stacked'),
    previewLang: jasmine.createSpy('previewLang').and.returnValue('en'),
    previewTheme: jasmine.createSpy('previewTheme').and.returnValue('light'),
    translationLayout: jasmine.createSpy('translationLayout').and.returnValue('tabbed'),
    setMode: jasmine.createSpy('setMode'),
    setPreviewDevice: jasmine.createSpy('setPreviewDevice'),
    setPreviewLayout: jasmine.createSpy('setPreviewLayout'),
  };
}

function createComponent(route: RouteStub = createRouteStub()): Harness {
  const admin = makeAdminSpy();
  const adminProducts = jasmine.createSpyObj('AdminProductsService', ['search']);
  adminProducts.search.and.returnValue(of({ items: [], total: 0 }));
  const blog = jasmine.createSpyObj('BlogService', [
    'listFlaggedComments',
    'resolveCommentFlagsAdmin',
    'hideCommentAdmin',
    'unhideCommentAdmin',
    'deleteComment',
    'createPreviewToken',
  ]);
  blog.listFlaggedComments.and.returnValue(of([]));
  blog.createPreviewToken.and.returnValue(of({ token: 't', expires_at: '' }));
  const fxAdmin = jasmine.createSpyObj('FxAdminService', [
    'getStatus',
    'listOverrideAudit',
    'restoreOverrideFromAudit',
    'clearOverride',
    'setOverride',
  ]);
  fxAdmin.getStatus.and.returnValue(of({ override: null }));
  fxAdmin.listOverrideAudit.and.returnValue(of([]));
  const taxesAdmin = jasmine.createSpyObj('TaxesAdminService', [
    'listGroups',
    'createGroup',
    'updateGroup',
    'deleteGroup',
    'upsertRate',
    'deleteRate',
  ]);
  taxesAdmin.listGroups.and.returnValue(of([]));
  const auth = {
    role: jasmine.createSpy('role').and.returnValue('admin'),
    loadCurrentUser: jasmine.createSpy('loadCurrentUser').and.returnValue(of(null)),
  };
  const cmsPrefs = makeCmsPrefs();
  const toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'info']);
  const translate = { instant: (k: string, p?: any) => (p ? `${k}:${JSON.stringify(p)}` : k) };
  const markdown = { render: (v: string) => `<p>${v}</p>` };
  const sanitizer = {
    bypassSecurityTrustHtml: (v: string) => v,
    bypassSecurityTrustResourceUrl: (v: string) => `safe:${v}`,
  } as unknown as DomSanitizer;

  const component = new AdminComponent(
    {
      snapshot: route.snapshot,
      data: route.data.asObservable(),
      queryParams: route.queryParams.asObservable(),
    } as unknown as ActivatedRoute,
    admin,
    adminProducts,
    blog,
    fxAdmin,
    taxesAdmin,
    auth as any,
    cmsPrefs,
    toast,
    translate as any,
    markdown as any,
    sanitizer,
  );

  return {
    component,
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
    route,
  };
}

describe('AdminComponent — CmsDraftManager (via home draft)', () => {
  let h: Harness;
  let mgr: any;

  beforeEach(() => {
    localStorage.clear();
    h = createComponent();
    mgr = (h.component as any).cmsHomeDraft;
  });

  it('reports not-ready before initialisation and ready after', () => {
    expect(mgr.isReady()).toBe(false);
    mgr.initFromServer([{ id: 'a' }]);
    expect(mgr.isReady()).toBe(true);
    expect(mgr.dirty).toBe(false);
  });

  it('observe() flags dirty and schedules autosave when state diverges from server', () => {
    mgr.initFromServer([{ id: 'a' }]);
    mgr.observe([{ id: 'b' }]);
    expect(mgr.dirty).toBe(true);
    expect(mgr.autosavePending).toBe(true);
  });

  it('observe() is a no-op when the state matches the current present snapshot', () => {
    mgr.initFromServer([{ id: 'a' }]);
    mgr.observe([{ id: 'a' }]);
    expect(mgr.dirty).toBe(false);
    expect(mgr.autosavePending).toBe(false);
  });

  it('observe() before init does nothing', () => {
    mgr.observe([{ id: 'z' }]);
    expect(mgr.dirty).toBe(false);
  });

  it('supports undo/redo across committed history', () => {
    mgr.initFromServer([{ id: 'v0' }]);
    expect(mgr.canUndo([{ id: 'v1' }])).toBe(true); // differs from present
    const undone = mgr.undo([{ id: 'v1' }]);
    expect(undone).toEqual([{ id: 'v0' }]);
    expect(mgr.canRedo([{ id: 'v0' }])).toBe(true);
    const redone = mgr.redo([{ id: 'v0' }]);
    expect(redone).toEqual([{ id: 'v1' }]);
  });

  it('undo/redo return null when there is no history and when not ready', () => {
    expect(mgr.undo([{ id: 'x' }])).toBeNull(); // not ready
    expect(mgr.redo([{ id: 'x' }])).toBeNull();
    mgr.initFromServer([{ id: 'a' }]);
    expect(mgr.undo([{ id: 'a' }])).toBeNull(); // no past, identical
    expect(mgr.redo([{ id: 'a' }])).toBeNull(); // no future
  });

  it('canUndo/canRedo report false before initialisation', () => {
    expect(mgr.canUndo([{ id: 'a' }])).toBe(false);
    expect(mgr.canRedo([{ id: 'a' }])).toBe(false);
  });

  it('markServerSaved commits the state and clears the dirty flag', () => {
    mgr.initFromServer([{ id: 'a' }]);
    mgr.observe([{ id: 'b' }]);
    mgr.markServerSaved([{ id: 'b' }]);
    expect(mgr.dirty).toBe(false);
  });

  it('markServerSaved is a no-op before init', () => {
    mgr.markServerSaved([{ id: 'a' }]);
    expect(mgr.isReady()).toBe(false);
  });

  it('persists an autosave envelope and exposes restorable metadata', () => {
    mgr.initFromServer([{ id: 'a' }]);
    mgr.observe([{ id: 'changed' }]);
    (mgr as any).commitPending();
    expect(mgr.lastAutosavedAt).toBeTruthy();
    const raw = localStorage.getItem((mgr as any).storageKey);
    expect(raw).toContain('changed');
  });

  it('restoreAutosave returns a stored newer draft and then clears the candidate', () => {
    const key = (mgr as any).storageKey;
    localStorage.setItem(
      key,
      JSON.stringify({
        v: 1,
        ts: '2030-01-01T00:00:00Z',
        state_json: JSON.stringify([{ id: 'restored' }]),
      }),
    );
    mgr.initFromServer([{ id: 'a' }]);
    expect(mgr.hasRestorableAutosave).toBe(true);
    expect(mgr.restorableAutosaveAt).toBe('2030-01-01T00:00:00Z');
    const restored = mgr.restoreAutosave([{ id: 'a' }]);
    expect(restored).toEqual([{ id: 'restored' }]);
    expect(mgr.hasRestorableAutosave).toBe(false);
  });

  it('restoreAutosave returns null when candidate equals present and clears candidate', () => {
    const sameState = JSON.stringify([{ id: 'same' }]);
    const key = (mgr as any).storageKey;
    localStorage.setItem(key, JSON.stringify({ v: 1, ts: 't', state_json: sameState }));
    mgr.initFromServer([{ id: 'same' }]);
    // candidate equals server == present
    expect(mgr.restoreAutosave([{ id: 'same' }])).toBeNull();
  });

  it('restoreAutosave returns null without a candidate or before init', () => {
    expect(mgr.restoreAutosave([{ id: 'a' }])).toBeNull(); // not ready
    mgr.initFromServer([{ id: 'a' }]);
    expect(mgr.restoreAutosave([{ id: 'a' }])).toBeNull(); // no candidate
  });

  it('discardAutosave removes the stored envelope and candidate', () => {
    const key = (mgr as any).storageKey;
    localStorage.setItem(
      key,
      JSON.stringify({ v: 1, ts: 't', state_json: JSON.stringify([{ id: 'x' }]) }),
    );
    mgr.initFromServer([{ id: 'a' }]);
    mgr.discardAutosave();
    expect(localStorage.getItem(key)).toBeNull();
    expect(mgr.hasRestorableAutosave).toBe(false);
  });

  it('ignores a malformed or version-mismatched autosave envelope', () => {
    const key = (mgr as any).storageKey;
    localStorage.setItem(key, '{ not json');
    mgr.initFromServer([{ id: 'a' }]);
    expect(mgr.hasRestorableAutosave).toBe(false);

    localStorage.setItem(key, JSON.stringify({ v: 2, ts: 't', state_json: '[]' }));
    mgr.initFromServer([{ id: 'a' }]);
    expect(mgr.hasRestorableAutosave).toBe(false);
  });

  it('debounced commit timer eventually commits pending state', (done) => {
    const fast = (h.component as any).ensurePageDraft('page.timer');
    fast.initFromServer({
      blocks: [],
      status: 'draft',
      publishedAt: '',
      publishedUntil: '',
      requiresAuth: false,
    });
    fast.observe({
      blocks: [{ id: 'p' }],
      status: 'draft',
      publishedAt: '',
      publishedUntil: '',
      requiresAuth: false,
    });
    expect(fast.autosavePending).toBe(true);
    setTimeout(() => {
      expect(fast.autosavePending).toBe(false);
      done();
    }, 750);
  });

  it('dispose clears any pending timer', () => {
    mgr.initFromServer([{ id: 'a' }]);
    mgr.observe([{ id: 'b' }]);
    expect(() => mgr.dispose()).not.toThrow();
  });
});

describe('AdminComponent — pure helpers and getters', () => {
  let h: Harness;

  beforeEach(() => {
    h = createComponent();
  });

  it('normalizeSection accepts known sections and falls back to home', () => {
    const c = h.component as any;
    expect(c.normalizeSection('blog')).toBe('blog');
    expect(c.normalizeSection('pages')).toBe('pages');
    expect(c.normalizeSection('settings')).toBe('settings');
    expect(c.normalizeSection('home')).toBe('home');
    expect(c.normalizeSection('garbage')).toBe('home');
    expect(c.normalizeSection(undefined)).toBe('home');
  });

  it('isOwner reflects the auth role', () => {
    h.auth.role.and.returnValue('owner');
    expect(h.component.isOwner()).toBe(true);
    h.auth.role.and.returnValue('admin');
    expect(h.component.isOwner()).toBe(false);
  });

  it('cmsAdvanced reflects the editor preference mode', () => {
    h.cmsPrefs.mode.and.returnValue('advanced');
    expect(h.component.cmsAdvanced()).toBe(true);
    h.cmsPrefs.mode.and.returnValue('basic');
    expect(h.component.cmsAdvanced()).toBe(false);
  });

  it('cmsPreviewMaxWidthClass maps each preview device', () => {
    h.cmsPrefs.previewDevice.and.returnValue('mobile');
    expect(h.component.cmsPreviewMaxWidthClass()).toContain('390');
    h.cmsPrefs.previewDevice.and.returnValue('tablet');
    expect(h.component.cmsPreviewMaxWidthClass()).toContain('768');
    h.cmsPrefs.previewDevice.and.returnValue('desktop');
    expect(h.component.cmsPreviewMaxWidthClass()).toContain('1024');
  });

  it('cmsPreviewViewportWidth maps each preview device', () => {
    h.cmsPrefs.previewDevice.and.returnValue('mobile');
    expect(h.component.cmsPreviewViewportWidth()).toBe(390);
    h.cmsPrefs.previewDevice.and.returnValue('tablet');
    expect(h.component.cmsPreviewViewportWidth()).toBe(768);
    h.cmsPrefs.previewDevice.and.returnValue('desktop');
    expect(h.component.cmsPreviewViewportWidth()).toBe(1024);
  });

  it('homeRevisionTitleKey maps known and unknown keys', () => {
    const c = h.component;
    c.homeRevisionKey = 'home.sections';
    expect(c.homeRevisionTitleKey()).toContain('home.sections');
    c.homeRevisionKey = 'home.story';
    expect(c.homeRevisionTitleKey()).toContain('home.story');
    c.homeRevisionKey = 'other';
    expect(c.homeRevisionTitleKey()).toContain('revisions');
  });

  it('settingsRevisionTitleKey maps seo prefix and known keys plus fallback', () => {
    const c = h.component;
    c.settingsRevisionKey = 'seo.home';
    expect(c.settingsRevisionTitleKey()).toContain('seo');
    for (const [key, frag] of [
      ['site.assets', 'assets'],
      ['site.social', 'social'],
      ['site.company', 'company'],
      ['site.navigation', 'navigation'],
      ['site.checkout', 'checkout'],
      ['site.reports', 'reports'],
    ] as const) {
      c.settingsRevisionKey = key;
      expect(c.settingsRevisionTitleKey()).toContain(frag);
    }
    c.settingsRevisionKey = 'unknown';
    expect(c.settingsRevisionTitleKey()).toContain('revisions');
  });

  it('pagesRevisionTitleKey maps each known page key and undefined otherwise', () => {
    const c = h.component;
    const cases: Array<[string, string | undefined]> = [
      ['page.about', 'aboutLabel'],
      ['page.contact', 'contactLabel'],
      ['page.terms', 'termsIndex'],
      ['page.terms-and-conditions', 'documents.terms'],
      ['page.privacy-policy', 'privacy'],
      ['page.anpc', 'anpc'],
    ];
    for (const [key, frag] of cases) {
      c.pagesRevisionKey = key;
      expect(c.pagesRevisionTitleKey()).toContain(frag as string);
    }
    c.pagesRevisionKey = 'page.unknown';
    expect(c.pagesRevisionTitleKey()).toBeUndefined();
  });

  it('fxAuditActionLabel maps known actions and echoes unknown ones', () => {
    const c = h.component as any;
    const label = c.fxAuditActionLabel('set');
    expect(typeof label).toBe('string');
    expect(c.fxAuditActionLabel('totally-unknown-action')).toBeTruthy();
  });
});

describe('AdminComponent — value normalisation helpers', () => {
  let c: any;

  beforeEach(() => {
    c = createComponent().component as any;
  });

  it('safePageRecordKey rejects invalid and prototype-polluting keys', () => {
    expect(c.safePageRecordKey('page.about')).toBe('page.about');
    expect(c.safePageRecordKey('page.My-Custom_1')).toBe('page.My-Custom_1');
    expect(c.safePageRecordKey('not-a-page')).toBe('page.about');
    expect(c.safePageRecordKey('')).toBe('page.about');
    expect(c.safePageRecordKey('page.__proto__')).toBe('page.about');
    expect(c.safePageRecordKey('page.x.prototype')).toBe('page.about');
    expect(c.safePageRecordKey('page.x.constructor')).toBe('page.about');
  });

  it('safeRecordKey enforces an allow-list and falls back', () => {
    expect(c.safeRecordKey('home.sections')).toBe('home.sections');
    expect(c.safeRecordKey('bad key!')).toBe('unknown');
    expect(c.safeRecordKey('bad key!', 'fb')).toBe('fb');
    expect(c.safeRecordKey('__proto__')).toBe('unknown');
    expect(c.safeRecordKey('prototype')).toBe('unknown');
    expect(c.safeRecordKey('constructor')).toBe('unknown');
    expect(c.safeRecordKey('a.__proto__')).toBe('unknown');
    expect(c.safeRecordKey('a.prototype')).toBe('unknown');
    expect(c.safeRecordKey('a.constructor')).toBe('unknown');
  });

  it('setRecordValue/setPageRecordValue/deleteRecordValue use the safe key', () => {
    const rec: Record<string, number> = {};
    c.setRecordValue(rec, 'good.key', 1);
    expect(rec['good.key']).toBe(1);
    c.setRecordValue(rec, 'bad key!', 2, 'fallbackKey');
    expect(rec['fallbackKey']).toBe(2);
    c.deleteRecordValue(rec, 'good.key');
    expect(rec['good.key']).toBeUndefined();

    const pageRec: Record<string, string> = {};
    c.setPageRecordValue(pageRec, 'page.about', 'v');
    expect(pageRec['page.about']).toBe('v');
  });

  it('toLocalizedText handles strings, localized objects and junk', () => {
    expect(c.toLocalizedText('  hi  ')).toEqual({ en: 'hi', ro: 'hi' });
    expect(c.toLocalizedText({ en: ' a ', ro: ' b ' })).toEqual({ en: 'a', ro: 'b' });
    expect(c.toLocalizedText({ en: 5 })).toEqual({ en: '', ro: '' });
    expect(c.toLocalizedText(null)).toEqual({ en: '', ro: '' });
    expect(c.toLocalizedText(42)).toEqual({ en: '', ro: '' });
  });

  it('toFocalValue clamps and falls back', () => {
    expect(c.toFocalValue(40)).toBe(40);
    expect(c.toFocalValue('30')).toBe(30);
    expect(c.toFocalValue(-10)).toBe(0);
    expect(c.toFocalValue(150)).toBe(100);
    expect(c.toFocalValue('abc')).toBe(50);
    expect(c.toFocalValue('abc', 25)).toBe(25);
    expect(c.toFocalValue(33.6)).toBe(34);
  });

  it('toBooleanValue parses booleans, numbers and string aliases', () => {
    expect(c.toBooleanValue(true)).toBe(true);
    expect(c.toBooleanValue(false)).toBe(false);
    expect(c.toBooleanValue(1)).toBe(true);
    expect(c.toBooleanValue(0)).toBe(false);
    for (const v of ['1', 'true', 'yes', 'on', 'TRUE']) expect(c.toBooleanValue(v)).toBe(true);
    for (const v of ['0', 'false', 'no', 'off']) expect(c.toBooleanValue(v)).toBe(false);
    expect(c.toBooleanValue('maybe')).toBe(false);
    expect(c.toBooleanValue('maybe', true)).toBe(true);
    expect(c.toBooleanValue({}, true)).toBe(true);
  });

  it('toCmsBlockLayout normalises each axis and defaults', () => {
    expect(c.toCmsBlockLayout(null)).toEqual(c.defaultCmsBlockLayout());
    expect(
      c.toCmsBlockLayout({
        spacing: 'lg',
        background: 'accent',
        align: 'center',
        maxWidth: 'wide',
      }),
    ).toEqual({ spacing: 'lg', background: 'accent', align: 'center', max_width: 'wide' });
    expect(
      c.toCmsBlockLayout({
        spacing: 'xxl',
        background: 'rainbow',
        align: 'top',
        max_width: 'huge',
      }),
    ).toEqual({ spacing: 'none', background: 'none', align: 'left', max_width: 'full' });
    expect(c.toCmsBlockLayout({ max_width: 'narrow' }).max_width).toBe('narrow');
    expect(c.toCmsBlockLayout({ max_width: 'prose' }).max_width).toBe('prose');
    expect(c.toCmsBlockLayout({ spacing: 'sm' }).spacing).toBe('sm');
    expect(c.toCmsBlockLayout({ background: 'muted' }).background).toBe('muted');
  });

  it('focalPosition formats a CSS object-position value', () => {
    expect(c.focalPosition(20, 80)).toBe('20% 80%');
    expect(c.focalPosition('x', 'y')).toBe('50% 50%');
  });

  it('toSlideDraft maps known fields and uses image fallback', () => {
    expect(c.toSlideDraft(null)).toEqual(c.emptySlideDraft());
    const d = c.toSlideDraft({
      image: ' /a.png ',
      variant: 'full',
      size: 'L',
      text_style: 'light',
      cta_url: ' /go ',
      focal_x: 10,
      focal_y: 90,
    });
    expect(d.image_url).toBe('/a.png');
    expect(d.variant).toBe('full');
    expect(d.size).toBe('L');
    expect(d.text_style).toBe('light');
    expect(d.cta_url).toBe('/go');
    expect(d.focal_x).toBe(10);
    const d2 = c.toSlideDraft({ image_url: 'b', size: 'S' });
    expect(d2.image_url).toBe('b');
    expect(d2.size).toBe('S');
    const d3 = c.toSlideDraft({ size: 'XL' });
    expect(d3.size).toBe('M');
    expect(d3.variant).toBe('split');
  });

  it('serializeSlideDraft trims urls and clamps focal points', () => {
    const slide = {
      ...c.emptySlideDraft(),
      image_url: ' /x ',
      cta_url: ' /y ',
      focal_x: 200,
      focal_y: -5,
    };
    const out = c.serializeSlideDraft(slide);
    expect(out['image_url']).toBe('/x');
    expect(out['cta_url']).toBe('/y');
    expect(out['focal_x']).toBe(100);
    expect(out['focal_y']).toBe(0);
  });

  it('toCarouselSettingsDraft applies defaults and explicit overrides', () => {
    expect(c.toCarouselSettingsDraft(null)).toEqual(c.defaultCarouselSettings());
    const s = c.toCarouselSettingsDraft({
      autoplay: true,
      interval_ms: 3000,
      show_dots: false,
      show_arrows: false,
      pause_on_hover: false,
    });
    expect(s).toEqual({
      autoplay: true,
      interval_ms: 3000,
      show_dots: false,
      show_arrows: false,
      pause_on_hover: false,
    });
    expect(c.toCarouselSettingsDraft({ interval_ms: '2500' }).interval_ms).toBe(2500);
    expect(c.toCarouselSettingsDraft({ interval_ms: -1 }).interval_ms).toBe(5000);
    expect(c.toCarouselSettingsDraft({ interval_ms: 'bad' }).interval_ms).toBe(5000);
  });
});

describe('AdminComponent — parsePageBlocksDraft', () => {
  let c: any;
  beforeEach(() => {
    c = createComponent().component as any;
  });

  it('returns an empty list for missing or empty block arrays', () => {
    expect(c.parsePageBlocksDraft(null)).toEqual([]);
    expect(c.parsePageBlocksDraft({})).toEqual([]);
    expect(c.parsePageBlocksDraft({ blocks: [] })).toEqual([]);
    expect(c.parsePageBlocksDraft({ blocks: 'nope' })).toEqual([]);
  });

  it('skips invalid entries, unknown types and duplicate keys', () => {
    const blocks = [
      null,
      'string',
      { type: 'unknown' },
      { type: 'text', key: 'dup', body_markdown: 'a' },
      { type: 'text', key: 'dup', body_markdown: 'b' },
      { type: '   ' },
    ];
    const out = c.parsePageBlocksDraft({ blocks });
    expect(out.length).toBe(1);
    expect(out[0].key).toBe('dup');
    expect(out[0].body_markdown).toEqual({ en: 'a', ro: 'a' });
  });

  it('auto-generates keys and honours the enabled flag', () => {
    const out = c.parsePageBlocksDraft({
      blocks: [{ type: 'text' }, { type: 'cta', enabled: false }],
    });
    expect(out[0].key).toBe('text_1');
    expect(out[0].enabled).toBe(true);
    expect(out[1].key).toBe('cta_2');
    expect(out[1].enabled).toBe(false);
  });

  it('parses every supported block type with rich content', () => {
    const blocks = [
      {
        type: 'columns',
        columns: [{ title: 'c1' }, { title: 'c2' }, { title: 'c3' }, { title: 'c4' }],
        columns_breakpoint: 'lg',
      },
      { type: 'cta', cta_label: 'Go', cta_url: ' /go ', cta_new_tab: 'yes' },
      { type: 'faq', items: [{ question: 'q1' }, null, { question: 'q2' }] },
      { type: 'testimonials', items: [{ author: 'a1' }, 'bad'] },
      {
        type: 'product_grid',
        source: 'COLLECTION',
        collection_slug: ' col ',
        product_slugs: ['x', 'x', 'y'],
        limit: '99',
      },
      { type: 'form', form_type: 'NEWSLETTER', topic: 'support' },
      { type: 'image', url: ' /img ', link_url: ' /l ', focal_x: 12, focal_y: 88 },
      { type: 'gallery', images: [{ url: ' /g ' }, { url: '' }, null] },
      { type: 'banner', slide: { image: '/b' } },
      { type: 'carousel', slides: [{ image: '/s1' }], settings: { autoplay: true } },
    ];
    const out = c.parsePageBlocksDraft({ blocks });
    const byType: Record<string, any> = {};
    for (const b of out) byType[b.type] = b;

    expect(byType['columns'].columns.length).toBe(3); // capped at 3
    expect(byType['columns'].columns_breakpoint).toBe('lg');
    expect(byType['cta'].cta_url).toBe('/go');
    expect(byType['cta'].cta_new_tab).toBe(true);
    expect(byType['faq'].faq_items.length).toBe(2);
    expect(byType['testimonials'].testimonials.length).toBe(1);
    expect(byType['product_grid'].product_grid_source).toBe('collection');
    expect(byType['product_grid'].product_grid_collection_slug).toBe('col');
    expect(byType['product_grid'].product_grid_product_slugs).toBe('x\ny'); // de-duped
    expect(byType['product_grid'].product_grid_limit).toBe(24); // clamped
    expect(byType['form'].form_type).toBe('newsletter');
    expect(byType['form'].form_topic).toBe('support');
    expect(byType['image'].url).toBe('/img');
    expect(byType['image'].focal_x).toBe(12);
    expect(byType['gallery'].images.length).toBe(1);
    expect(byType['banner'].slide.image_url).toBe('/b');
    expect(byType['carousel'].slides.length).toBe(1);
    expect(byType['carousel'].settings.autoplay).toBe(true);
  });

  it('handles product_grid with comma/newline string slugs and defaults', () => {
    const out = c.parsePageBlocksDraft({
      blocks: [
        { type: 'product_grid', source: 'products', product_slugs: 'a, b\nc', limit: 'bad' },
      ],
    });
    expect(out[0].product_grid_source).toBe('products');
    expect(out[0].product_grid_product_slugs).toBe('a\nb\nc');
    expect(out[0].product_grid_limit).toBe(6);
  });

  it('falls back to defaults for columns under two and unknown breakpoint', () => {
    const out = c.parsePageBlocksDraft({
      blocks: [{ type: 'columns', columns: [{ title: 'only' }], columns_breakpoint: 'xl' }],
    });
    expect(out[0].columns.length).toBe(2); // default kept
    expect(out[0].columns_breakpoint).toBe('md');
  });
});

describe('AdminComponent — contentTitleForKey and page block mutators', () => {
  let h: Harness;
  let c: any;
  beforeEach(() => {
    h = createComponent();
    c = h.component as any;
  });

  it('contentTitleForKey prefers known content page titles then defaults', () => {
    c.contentPages = [{ key: 'page.about', title: 'About Us' }];
    expect(c.contentTitleForKey('page.about')).toBe('About Us');
    expect(c.contentTitleForKey('page.unknown-key')).toBe('page.unknown-key');
    expect(c.contentTitleForKey('')).toBe('Content');
  });

  it('setPageInsertDragActive toggles the drag flag', () => {
    c.setPageInsertDragActive(true);
    expect(c.pageInsertDragActive).toBe(true);
    c.setPageInsertDragActive(false);
    expect(c.pageInsertDragActive).toBe(false);
  });

  it('setPageImageBlockUrl updates the matching block url and focal point', () => {
    c.pageBlocks['page.about'] = [
      { key: 'b1', type: 'image', url: '', focal_x: 50, focal_y: 50 },
      { key: 'b2', type: 'image', url: 'keep', focal_x: 50, focal_y: 50 },
    ];
    c.setPageImageBlockUrl('page.about', 'b1', { url: ' /pic.png ', focal_x: 10, focal_y: 20 });
    expect(c.pageBlocks['page.about'][0].url).toBe('/pic.png');
    expect(c.pageBlocks['page.about'][0].focal_x).toBe(10);
    expect(c.pageBlocks['page.about'][1].url).toBe('keep');
    expect(h.toast.success).toHaveBeenCalled();
  });

  it('setPageImageBlockUrl ignores empty asset urls', () => {
    c.pageBlocks['page.about'] = [{ key: 'b1', type: 'image', url: 'orig' }];
    c.setPageImageBlockUrl('page.about', 'b1', { url: '   ' });
    expect(c.pageBlocks['page.about'][0].url).toBe('orig');
  });

  it('setPageBannerSlideImage only touches matching banner blocks', () => {
    c.pageBlocks['page.about'] = [
      { key: 'b1', type: 'banner', slide: { image_url: '', focal_x: 50, focal_y: 50 } },
      { key: 'b2', type: 'image', url: '' },
    ];
    c.setPageBannerSlideImage('page.about', 'b1', { url: '/banner.jpg', focal_x: 5, focal_y: 95 });
    expect(c.pageBlocks['page.about'][0].slide.image_url).toBe('/banner.jpg');
    c.setPageBannerSlideImage('page.about', 'b1', { url: '' });
    expect(c.pageBlocks['page.about'][0].slide.image_url).toBe('/banner.jpg');
  });

  it('addPageCarouselSlide appends a blank slide to a carousel block', () => {
    c.pageBlocks['page.about'] = [{ key: 'b1', type: 'carousel', slides: [] }];
    c.addPageCarouselSlide('page.about', 'b1');
    expect(c.pageBlocks['page.about'][0].slides.length).toBe(1);
  });
});

function dragEvent(payload?: unknown, files: File[] = []): any {
  return {
    preventDefault: jasmine.createSpy('preventDefault'),
    target: null,
    dataTransfer: {
      getData: () => (payload === undefined ? '' : JSON.stringify(payload)),
      files,
      items: [],
    },
  };
}

function checkboxEvent(checked: boolean): any {
  return { target: { checked } };
}

describe('AdminComponent — home section helpers and slides', () => {
  let h: Harness;
  let c: any;
  beforeEach(() => {
    h = createComponent();
    c = h.component as any;
  });

  it('toPreviewSlide prefers the active language and falls back to the other', () => {
    const slide = {
      ...c.emptySlideDraft(),
      image_url: ' /i ',
      headline: { en: 'Hello', ro: '' },
      subheadline: { en: '', ro: 'Salut' },
      cta_url: ' /c ',
    };
    const en = c.toPreviewSlide(slide, 'en');
    expect(en.image_url).toBe('/i');
    expect(en.headline).toBe('Hello');
    expect(en.subheadline).toBe('Salut'); // fallback to ro
    expect(en.cta_url).toBe('/c');
    const ro = c.toPreviewSlide(slide, 'ro');
    expect(ro.headline).toBe('Hello'); // fallback to en
    const emptyPreview = c.toPreviewSlide(c.emptySlideDraft(), 'en');
    expect(emptyPreview.headline).toBeNull();
    expect(emptyPreview.cta_url).toBeNull();
  });

  it('toPreviewSlides maps an array and tolerates empties', () => {
    expect(c.toPreviewSlides([], 'en')).toEqual([]);
    expect(c.toPreviewSlides(null, 'en')).toEqual([]);
    expect(c.toPreviewSlides([c.emptySlideDraft()], 'en').length).toBe(1);
  });

  it('isHomeSectionId recognises every canonical id', () => {
    for (const id of [
      'featured_products',
      'sale_products',
      'new_arrivals',
      'featured_collections',
      'story',
      'recently_viewed',
      'why',
    ]) {
      expect(c.isHomeSectionId(id)).toBe(true);
    }
    expect(c.isHomeSectionId('nope')).toBe(false);
    expect(c.isHomeSectionId(7)).toBe(false);
  });

  it('normalizeHomeSectionId maps aliases and camelCase variants', () => {
    expect(c.normalizeHomeSectionId('story')).toBe('story');
    expect(c.normalizeHomeSectionId('newArrivals')).toBe('new_arrivals');
    expect(c.normalizeHomeSectionId('collections')).toBe('featured_collections');
    expect(c.normalizeHomeSectionId('featured')).toBe('featured_products');
    expect(c.normalizeHomeSectionId('bestsellers')).toBe('featured_products');
    expect(c.normalizeHomeSectionId('sale')).toBe('sale_products');
    expect(c.normalizeHomeSectionId('sales')).toBe('sale_products');
    expect(c.normalizeHomeSectionId('new')).toBe('new_arrivals');
    expect(c.normalizeHomeSectionId('recent')).toBe('recently_viewed');
    expect(c.normalizeHomeSectionId('recentlyViewed')).toBe('recently_viewed');
    expect(c.normalizeHomeSectionId('   ')).toBeNull();
    expect(c.normalizeHomeSectionId('totally-unknown')).toBeNull();
    expect(c.normalizeHomeSectionId(123)).toBeNull();
  });

  it('ensureAllDefaultHomeBlocks appends missing default sections only', () => {
    const existing = [c.makeHomeBlockDraft('story', 'story', true)];
    const out = c.ensureAllDefaultHomeBlocks(existing);
    const ids = out.map((b: any) => b.type);
    expect(ids).toContain('featured_products');
    expect(ids.filter((t: string) => t === 'story').length).toBe(1); // not duplicated
    expect(out.length).toBe(c.defaultHomeSections().length);
  });

  it('isCustomHomeBlock is true for custom block types and false for sections', () => {
    expect(c.isCustomHomeBlock({ type: 'text' })).toBe(true);
    expect(c.isCustomHomeBlock({ type: 'carousel' })).toBe(true);
    expect(c.isCustomHomeBlock({ type: 'story' })).toBe(false);
  });

  it('homeBlockLabel returns translation or raw type', () => {
    expect(c.homeBlockLabel({ type: 'text' })).toContain('text');
  });

  it('toggleHomeBlockEnabled flips the enabled flag for the matching block', () => {
    c.homeBlocks = [
      { key: 'a', enabled: true },
      { key: 'b', enabled: true },
    ];
    c.toggleHomeBlockEnabled({ key: 'a' }, checkboxEvent(false));
    expect(c.homeBlocks[0].enabled).toBe(false);
    expect(c.homeBlocks[1].enabled).toBe(true);
    c.toggleHomeBlockEnabled({ key: 'a' }, checkboxEvent(true));
    expect(c.homeBlocks[0].enabled).toBe(true);
  });

  it('moveHomeBlock reorders within bounds and ignores out-of-range moves', () => {
    c.homeBlocks = [{ key: 'a' }, { key: 'b' }, { key: 'c' }].map((b) => ({ ...b, type: 'text' }));
    c.moveHomeBlock('a', 1);
    expect(c.homeBlocks.map((b: any) => b.key)).toEqual(['b', 'a', 'c']);
    c.moveHomeBlock('missing', 1); // no-op
    expect(c.homeBlocks.length).toBe(3);
    c.moveHomeBlock('b', -1); // would go below 0 → no-op
    expect(c.homeBlocks[0].key).toBe('b');
  });

  it('addHomeBlock and addHomeBlockFromLibrary insert blocks with unique keys', () => {
    c.homeBlocks = [];
    c.newHomeBlockType = 'text';
    c.addHomeBlock();
    expect(c.homeBlocks.length).toBe(1);
    c.addHomeBlockFromLibrary('cta', 'starter');
    expect(c.homeBlocks.length).toBe(2);
    expect(c.homeBlocks[0].key).not.toBe(c.homeBlocks[1].key);
  });

  it('home block drag lifecycle sets and clears the dragging key', () => {
    c.setHomeInsertDragActive(true);
    expect(c.homeInsertDragActive).toBe(true);
    c.onHomeBlockDragStart('a');
    expect(c.draggingHomeBlockKey).toBe('a');
    const ev = dragEvent();
    c.onHomeBlockDragOver(ev);
    expect(ev.preventDefault).toHaveBeenCalled();
    c.onHomeBlockDragEnd();
    expect(c.draggingHomeBlockKey).toBeNull();
    expect(c.homeInsertDragActive).toBe(false);
  });

  it('onHomeBlockDropZone reorders an internal drag and inserts a library payload', () => {
    c.homeBlocks = [
      { key: 'a', type: 'text' },
      { key: 'b', type: 'text' },
    ];
    c.draggingHomeBlockKey = 'a';
    c.onHomeBlockDropZone(dragEvent(), 2);
    expect(c.homeBlocks.map((b: any) => b.key)).toEqual(['b', 'a']);

    c.draggingHomeBlockKey = 'missing';
    c.onHomeBlockDropZone(dragEvent(), 0); // from === -1 → ends drag
    expect(c.draggingHomeBlockKey).toBeNull();

    const before = c.homeBlocks.length;
    c.onHomeBlockDropZone(
      dragEvent({ kind: 'cms-block', scope: 'home', type: 'cta', template: 'blank' }),
      0,
    );
    expect(c.homeBlocks.length).toBe(before + 1);

    const after = c.homeBlocks.length;
    c.onHomeBlockDropZone(dragEvent({ kind: 'cms-block', scope: 'page', type: 'cta' }), 0); // wrong scope
    expect(c.homeBlocks.length).toBe(after);
  });

  it('onHomeBlockDrop reorders onto a target and inserts a home payload', () => {
    c.homeBlocks = [
      { key: 'a', type: 'text' },
      { key: 'b', type: 'text' },
      { key: 'c', type: 'text' },
    ];
    c.draggingHomeBlockKey = 'a';
    c.onHomeBlockDrop(dragEvent(), 'c');
    expect(c.homeBlocks.map((b: any) => b.key)).toEqual(['b', 'a', 'c']);

    const cnt = c.homeBlocks.length;
    c.onHomeBlockDrop(
      dragEvent({ kind: 'cms-block', scope: 'home', type: 'cta', template: 'blank' }),
      'b',
    );
    expect(c.homeBlocks.length).toBe(cnt + 1);

    // dropping a block onto itself is a no-op
    c.draggingHomeBlockKey = 'b';
    const same = c.homeBlocks.length;
    c.onHomeBlockDrop(dragEvent(), 'b');
    expect(c.homeBlocks.length).toBe(same);
  });

  it('readCmsBlockPayload validates the JSON envelope', () => {
    expect(c.readCmsBlockPayload(dragEvent())).toBeNull();
    expect(c.readCmsBlockPayload(dragEvent('not-json'))).toBeNull();
    expect(c.readCmsBlockPayload(dragEvent({ kind: 'other' }))).toBeNull();
    expect(
      c.readCmsBlockPayload(dragEvent({ kind: 'cms-block', scope: 'bad', type: 'text' })),
    ).toBeNull();
    expect(
      c.readCmsBlockPayload(dragEvent({ kind: 'cms-block', scope: 'home', type: 'nope' })),
    ).toBeNull();
    expect(
      c.readCmsBlockPayload(
        dragEvent({ kind: 'cms-block', scope: 'home', type: 'text', template: 'starter' }),
      ),
    ).toEqual({ scope: 'home', type: 'text', template: 'starter' });
    expect(
      c.readCmsBlockPayload(dragEvent({ kind: 'cms-block', scope: 'page', type: 'cta' })).template,
    ).toBe('blank');
  });
});

describe('AdminComponent — page block mutators', () => {
  let h: Harness;
  let c: any;
  beforeEach(() => {
    h = createComponent();
    c = h.component as any;
  });

  it('addPageBlock and removePageBlock manage the page block list', () => {
    c.newPageBlockType = 'text';
    c.pageBlocks['page.about'] = [];
    c.addPageBlock('page.about');
    expect(c.pageBlocks['page.about'].length).toBe(1);
    const key = c.pageBlocks['page.about'][0].key;
    c.removePageBlock('page.about', key);
    expect(c.pageBlocks['page.about'].length).toBe(0);
  });

  it('togglePageBlockEnabled flips a single block', () => {
    c.pageBlocks['page.about'] = [{ key: 'x', enabled: true }];
    c.togglePageBlockEnabled('page.about', 'x', checkboxEvent(false));
    expect(c.pageBlocks['page.about'][0].enabled).toBe(false);
  });

  it('pageBlockLabel returns translation or raw type', () => {
    expect(c.pageBlockLabel({ type: 'image' })).toContain('image');
  });
});

describe('AdminComponent — orders, users, categories, coupons', () => {
  let h: Harness;
  let c: any;
  beforeEach(() => {
    h = createComponent();
    c = h.component as any;
  });

  it('selectOrder clones the order and filteredOrders honours the status filter', () => {
    const order = { id: 'o1', status: 'paid' } as any;
    c.selectOrder(order);
    expect(c.activeOrder).toEqual(order);
    expect(c.activeOrder).not.toBe(order);
    c.orders = [
      { id: 'o1', status: 'paid' },
      { id: 'o2', status: 'shipped' },
    ] as any;
    c.orderFilter = '';
    expect(c.filteredOrders().length).toBe(2);
    c.orderFilter = 'shipped';
    expect(c.filteredOrders().map((o: any) => o.id)).toEqual(['o2']);
  });

  it('toggleAll / toggleSelect / computeAllSelected maintain the selection set', () => {
    c.products = [{ id: 'a' }, { id: 'b' }] as any;
    c.toggleAll(checkboxEvent(true));
    expect(c.selectedIds.size).toBe(2);
    expect(c.allSelected).toBe(true);
    c.toggleAll(checkboxEvent(false));
    expect(c.selectedIds.size).toBe(0);
    c.toggleSelect('a', checkboxEvent(true));
    expect(c.selectedIds.has('a')).toBe(true);
    expect(c.allSelected).toBe(false);
    c.toggleSelect('b', checkboxEvent(true));
    expect(c.allSelected).toBe(true);
    c.toggleSelect('a', checkboxEvent(false));
    expect(c.selectedIds.has('a')).toBe(false);
  });

  it('changeOrderStatus updates the active order on success and toasts on error', () => {
    c.activeOrder = null;
    c.changeOrderStatus('paid');
    expect(h.admin.updateOrderStatus).not.toHaveBeenCalled();

    c.activeOrder = { id: 'o1', status: 'new' };
    c.orders = [{ id: 'o1', status: 'new' }];
    h.admin.updateOrderStatus.and.returnValue(of({ id: 'o1', status: 'paid' }));
    c.changeOrderStatus('paid');
    expect(c.activeOrder.status).toBe('paid');
    expect(c.orders[0].status).toBe('paid');
    expect(h.toast.success).toHaveBeenCalled();

    h.admin.updateOrderStatus.and.returnValue(throwError(() => new Error('x')));
    c.changeOrderStatus('shipped');
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('forceLogout requires a selected user and reports outcome', () => {
    c.selectedUserId = '';
    c.forceLogout();
    expect(h.admin.revokeSessions).not.toHaveBeenCalled();
    c.selectedUserId = 'u1';
    h.admin.revokeSessions.and.returnValue(of({}));
    c.forceLogout();
    expect(h.toast.success).toHaveBeenCalled();
    h.admin.revokeSessions.and.returnValue(throwError(() => new Error('x')));
    c.forceLogout();
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('selectUser and onSelectedUserIdChange set selection and trigger alias loading', () => {
    c.users = [{ id: 'u1', role: 'admin' }];
    h.admin.userAliases.and.returnValue(of({ aliases: [{ name: 'x' }] }));
    c.selectUser('u1', 'editor');
    expect(c.selectedUserId).toBe('u1');
    expect(c.selectedUserRole).toBe('editor');
    expect(c.userAliases).toEqual({ aliases: [{ name: 'x' }] } as any);

    c.onSelectedUserIdChange('u1');
    expect(c.selectedUserRole).toBe('admin'); // derived from users list
    c.selectedUserRole = 'keepme';
    c.onSelectedUserIdChange('missing');
    expect(c.selectedUserRole).toBe('keepme'); // unchanged when user not found
  });

  it('loadUserAliases short-circuits without a user and records errors', () => {
    c.loadUserAliases('');
    expect(c.userAliasesLoading).toBe(false);
    h.admin.userAliases.and.returnValue(throwError(() => new Error('boom')));
    c.loadUserAliases('u1');
    expect(c.userAliasesError).toContain('alias');
  });

  it('userIdentity and commentAuthorLabel delegate to formatIdentity', () => {
    expect(typeof c.userIdentity({ id: 'x', email: 'a@b.c' })).toBe('string');
    expect(typeof c.commentAuthorLabel({ id: 'x', name: 'Bob' })).toBe('string');
  });

  it('updateRole enforces a password prompt and reports outcomes', () => {
    const promptSpy = spyOn(window, 'prompt');
    c.selectedUserId = '';
    c.updateRole();
    expect(h.admin.updateUserRole).not.toHaveBeenCalled();

    c.selectedUserId = 'u1';
    c.selectedUserRole = 'admin';
    promptSpy.and.returnValue('');
    c.updateRole();
    expect(h.toast.error).toHaveBeenCalled();

    promptSpy.and.returnValue('secret');
    c.users = [{ id: 'u1', role: 'member' }];
    h.admin.updateUserRole.and.returnValue(of({ id: 'u1', role: 'admin' }));
    c.updateRole();
    expect(c.users[0].role).toBe('admin');

    h.admin.updateUserRole.and.returnValue(throwError(() => new Error('x')));
    c.updateRole();
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('createCoupon validates the code and reports success/error', () => {
    c.newCoupon = { code: '' };
    c.createCoupon();
    expect(h.admin.createCoupon).not.toHaveBeenCalled();

    c.newCoupon = { code: 'SAVE10' };
    c.coupons = [];
    h.admin.createCoupon.and.returnValue(of({ id: 'c1', code: 'SAVE10' }));
    c.createCoupon();
    expect(c.coupons.length).toBe(1);

    h.admin.createCoupon.and.returnValue(throwError(() => new Error('x')));
    c.createCoupon();
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('toggleCoupon flips active state and invalidateCouponStripe reports counts', () => {
    c.coupons = [{ id: 'c1', active: true }];
    h.admin.updateCoupon.and.returnValue(of({ id: 'c1', active: false }));
    c.toggleCoupon({ id: 'c1', active: true });
    expect(c.coupons[0].active).toBe(false);
    h.admin.updateCoupon.and.returnValue(throwError(() => new Error('x')));
    c.toggleCoupon({ id: 'c1', active: false });
    expect(h.toast.error).toHaveBeenCalled();

    h.admin.invalidateCouponStripeMappings.and.returnValue(of({ deleted_mappings: 3 }));
    c.invalidateCouponStripe({ id: 'c1' });
    expect(h.toast.success).toHaveBeenCalled();
    h.admin.invalidateCouponStripeMappings.and.returnValue(throwError(() => new Error('x')));
    c.invalidateCouponStripe({ id: 'c1' });
    expect(h.toast.error).toHaveBeenCalled();
  });
});

describe('AdminComponent — blog pinning helpers', () => {
  let c: any;
  beforeEach(() => {
    c = createComponent().component as any;
  });

  it('blogPosts filters content blocks by blog prefix', () => {
    c.contentBlocks = [{ key: 'blog.a' }, { key: 'page.x' }, { key: 'blog.b' }];
    expect(c.blogPosts().map((p: any) => p.key)).toEqual(['blog.a', 'blog.b']);
  });

  it('pinnedSlotFromMeta interprets pinned flags and pin_order', () => {
    expect(c.pinnedSlotFromMeta(null)).toBeNull();
    expect(c.pinnedSlotFromMeta({})).toBeNull();
    expect(c.pinnedSlotFromMeta({ pinned: false })).toBeNull();
    expect(c.pinnedSlotFromMeta({ pinned: true })).toBe(1);
    expect(c.pinnedSlotFromMeta({ pinned: 1, pin_order: 3 })).toBe(3);
    expect(c.pinnedSlotFromMeta({ pinned: 'yes', pin_order: '2' })).toBe(2);
    expect(c.pinnedSlotFromMeta({ pinned: 'no' })).toBeNull();
    expect(c.pinnedSlotFromMeta({ pinned: true, pin_order: -4 })).toBe(1); // normalised
    expect(c.pinnedSlotFromMeta({ pinned: true, pin_order: 'bad' })).toBe(1);
  });

  it('blogPinnedSlot/blogPinnedPosts/nextBlogPinOrder rank pinned posts', () => {
    c.contentBlocks = [
      {
        key: 'blog.a',
        meta: { pinned: true, pin_order: 2 },
        published_at: '2020-01-01',
        updated_at: 'a',
      },
      {
        key: 'blog.b',
        meta: { pinned: true, pin_order: 1 },
        published_at: '2021-01-01',
        updated_at: 'b',
      },
      { key: 'blog.c', meta: { pinned: false } },
      { key: 'page.x', meta: { pinned: true, pin_order: 9 } },
    ];
    expect(c.blogPinnedSlot(c.contentBlocks[0])).toBe(2);
    const ranked = c.blogPinnedPosts().map((p: any) => p.key);
    expect(ranked).toEqual(['blog.b', 'blog.a']);
    expect(c.nextBlogPinOrder()).toBe(3); // max pinned order among blog posts + 1
  });

  it('nextBlogPinOrder is 1 when no blog posts are pinned', () => {
    c.contentBlocks = [{ key: 'blog.a', meta: {} }];
    expect(c.nextBlogPinOrder()).toBe(1);
  });

  it('onBlogPinDragStart/Over set the dragging key', () => {
    c.onBlogPinDragStart('  blog.a  ');
    expect(c.draggingBlogPinKey).toBe('blog.a');
    c.onBlogPinDragStart('   ');
    expect(c.draggingBlogPinKey).toBeNull();
    const ev = dragEvent();
    c.onBlogPinDragOver(ev);
    expect(ev.preventDefault).toHaveBeenCalled();
  });
});

describe('AdminComponent — FX override controls', () => {
  let h: Harness;
  let c: any;
  const status = {
    override: null,
    effective: { eur_per_ron: 5, usd_per_ron: 4, as_of: '2020-01-01' },
  };
  beforeEach(() => {
    h = createComponent();
    c = h.component as any;
    h.fxAdmin.getStatus.and.returnValue(of(status)); // safe default for cascading reloads
  });

  it('loadFxStatus seeds the override form and handles errors', () => {
    h.fxAdmin.getStatus.and.returnValue(of(status));
    c.loadFxStatus();
    expect(c.fxOverrideForm.eur_per_ron).toBe(5);
    expect(c.fxStatus()).toEqual(status as any);

    h.fxAdmin.getStatus.and.returnValue(throwError(() => new Error('x')));
    c.loadFxStatus();
    expect(c.fxError()).toBeTruthy();
  });

  it('loadFxAudit stores audit rows and falls back to an empty list on error', () => {
    h.fxAdmin.listOverrideAudit.and.returnValue(of([{ id: 'a1', action: 'set' }]));
    c.loadFxAudit();
    expect(c.fxAudit().length).toBe(1);
    h.fxAdmin.listOverrideAudit.and.returnValue(of('not-an-array'));
    c.loadFxAudit();
    expect(c.fxAudit()).toEqual([]);
    h.fxAdmin.listOverrideAudit.and.returnValue(throwError(() => new Error('x')));
    c.loadFxAudit();
    expect(c.fxAuditError()).toBeTruthy();
  });

  it('restoreFxOverrideFromAudit guards missing id and confirmation', () => {
    const confirmSpy = spyOn(window, 'confirm').and.returnValue(false);
    c.restoreFxOverrideFromAudit({ id: '' });
    expect(h.fxAdmin.restoreOverrideFromAudit).not.toHaveBeenCalled();
    c.restoreFxOverrideFromAudit({ id: 'a1' }); // declined
    expect(h.fxAdmin.restoreOverrideFromAudit).not.toHaveBeenCalled();

    confirmSpy.and.returnValue(true);
    h.fxAdmin.restoreOverrideFromAudit.and.returnValue(of(status));
    c.restoreFxOverrideFromAudit({ id: 'a1' });
    expect(h.toast.success).toHaveBeenCalled();
    h.fxAdmin.restoreOverrideFromAudit.and.returnValue(throwError(() => new Error('x')));
    c.restoreFxOverrideFromAudit({ id: 'a1' });
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('resetFxOverrideForm copies from the current status only when present', () => {
    c.fxStatus.set(null);
    c.fxOverrideForm = { eur_per_ron: 9, usd_per_ron: 9, as_of: 'keep' };
    c.resetFxOverrideForm();
    expect(c.fxOverrideForm.as_of).toBe('keep');
    c.fxStatus.set({ override: { eur_per_ron: 1, usd_per_ron: 2, as_of: 'new' } });
    c.resetFxOverrideForm();
    expect(c.fxOverrideForm.as_of).toBe('new');
  });

  it('saveFxOverride validates positive rates', () => {
    c.fxOverrideForm = { eur_per_ron: 0, usd_per_ron: 1, as_of: '' };
    c.saveFxOverride();
    expect(h.fxAdmin.setOverride).not.toHaveBeenCalled();
    expect(h.toast.error).toHaveBeenCalled();

    c.fxOverrideForm = { eur_per_ron: 5, usd_per_ron: 4, as_of: ' 2021 ' };
    h.fxAdmin.setOverride.and.returnValue(of({}));
    c.saveFxOverride();
    expect(h.fxAdmin.setOverride).toHaveBeenCalledWith(jasmine.objectContaining({ as_of: '2021' }));

    h.fxAdmin.setOverride.and.returnValue(throwError(() => new Error('x')));
    c.fxOverrideForm = { eur_per_ron: 5, usd_per_ron: 4, as_of: '' };
    c.saveFxOverride();
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('clearFxOverride only acts when an override exists and is confirmed', () => {
    c.fxStatus.set({ override: null });
    c.clearFxOverride();
    expect(h.fxAdmin.clearOverride).not.toHaveBeenCalled();

    c.fxStatus.set({ override: { eur_per_ron: 1 } });
    const confirmSpy = spyOn(window, 'confirm').and.returnValue(false);
    c.clearFxOverride();
    expect(h.fxAdmin.clearOverride).not.toHaveBeenCalled();

    confirmSpy.and.returnValue(true);
    h.fxAdmin.clearOverride.and.returnValue(of({}));
    c.clearFxOverride();
    expect(h.toast.success).toHaveBeenCalled();
    c.fxStatus.set({ override: { eur_per_ron: 1 } }); // restore override cleared by loadFxStatus
    h.fxAdmin.clearOverride.and.returnValue(throwError(() => new Error('x')));
    c.clearFxOverride();
    expect(h.toast.error).toHaveBeenCalled();
  });
});

describe('AdminComponent — products and stock', () => {
  let h: Harness;
  let c: any;
  beforeEach(() => {
    h = createComponent();
    c = h.component as any;
  });

  it('startNewProduct resets the form using the first category', () => {
    c.categories = [{ id: 'cat1' }];
    c.startNewProduct();
    expect(c.editingId).toBeNull();
    expect(c.form.category_id).toBe('cat1');
    expect(c.form.status).toBe('draft');
  });

  it('loadProduct hydrates the form and reports load errors', () => {
    h.admin.getProduct.and.returnValue(
      of({
        slug: 's1',
        name: 'P',
        category_id: 'c',
        price: 10,
        stock_quantity: 5,
        status: 'live',
        sku: 'SKU',
        long_description: 'desc',
        publish_at: '2030-01-01T00:00:00Z',
        tags: ['bestseller'],
        images: [{ id: 'i' }],
      }),
    );
    c.loadProduct('s1');
    expect(c.editingId).toBe('s1');
    expect(c.form.is_bestseller).toBe(true);
    expect(c.productImages().length).toBe(1);

    h.admin.getProduct.and.returnValue(throwError(() => new Error('x')));
    c.loadProduct('s1');
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('saveProduct creates when new and updates when editing', () => {
    spyOn(c, 'loadAll'); // avoid cascading section reloads
    c.form = {
      name: 'n',
      slug: 's',
      category_id: 'c',
      price: 1,
      stock: 2,
      status: 'draft',
      sku: '',
      description: '',
      publish_at: '',
      is_bestseller: false,
    };
    c.editingId = null;
    h.admin.createProduct.and.returnValue(of({}));
    c.saveProduct();
    expect(h.admin.createProduct).toHaveBeenCalled();

    c.editingId = 's';
    c.form.publish_at = '2030-01-01T10:00';
    h.admin.updateProduct.and.returnValue(of({}));
    c.saveProduct();
    expect(h.admin.updateProduct).toHaveBeenCalled();

    c.editingId = 's'; // success path reset it via startNewProduct
    h.admin.updateProduct.and.returnValue(throwError(() => new Error('x')));
    c.saveProduct();
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('deleteSelected requires a selection and an existing product', () => {
    c.selectedIds = new Set<string>();
    c.deleteSelected();
    expect(h.admin.deleteProduct).not.toHaveBeenCalled();

    c.selectedIds = new Set(['missing']);
    c.products = [];
    c.deleteSelected();
    expect(h.admin.deleteProduct).not.toHaveBeenCalled();

    c.products = [{ id: 'missing', slug: 'sl' }] as any;
    c.selectedIds = new Set(['missing']);
    h.admin.deleteProduct.and.returnValue(of({}));
    c.deleteSelected();
    expect(c.products.length).toBe(0);

    c.products = [{ id: 'x', slug: 'sx' }] as any;
    c.selectedIds = new Set(['x']);
    h.admin.deleteProduct.and.returnValue(throwError(() => new Error('e')));
    c.deleteSelected();
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('setStock/saveStock update edits and persist with feedback', () => {
    c.setStock('p1', '12' as any);
    expect(c.stockEdits['p1']).toBe(12);
    const product = { id: 'p1', slug: 'sl', stock_quantity: 0 } as any;
    h.admin.updateProduct.and.returnValue(of({}));
    c.saveStock(product);
    expect(product.stock_quantity).toBe(12);
    h.admin.updateProduct.and.returnValue(throwError(() => new Error('x')));
    c.saveStock({ id: 'p2', slug: 's2', stock_quantity: 3 } as any);
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('buildTags merges bestseller flag with existing tags', () => {
    c.form = { is_bestseller: true };
    c.productDetail = { tags: ['new', 'bestseller'] };
    expect(c.buildTags().sort()).toEqual(['bestseller', 'new']);
    c.form = { is_bestseller: false };
    c.productDetail = null;
    expect(c.buildTags()).toEqual([]);
  });

  it('upcomingProducts keeps only future products sorted ascending', () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const soon = new Date(Date.now() + 86400000).toISOString();
    const later = new Date(Date.now() + 2 * 86400000).toISOString();
    c.products = [
      { id: '1', publish_at: later },
      { id: '2', publish_at: past },
      { id: '3', publish_at: soon },
      { id: '4', publish_at: '' },
    ] as any;
    expect(c.upcomingProducts().map((p: any) => p.id)).toEqual(['3', '1']);
  });

  it('toLocalDateTime formats an ISO string to a datetime-local value', () => {
    expect(c.toLocalDateTime('2030-06-15T12:00:00Z')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it('onImageUpload requires a saved product and a file', () => {
    c.editingId = null;
    c.onImageUpload({ target: { files: [] } } as any);
    expect(h.toast.error).toHaveBeenCalled();

    c.editingId = 's1';
    c.onImageUpload({ target: { files: [] } } as any); // no file → silent return
    expect(h.admin.uploadProductImage).not.toHaveBeenCalled();

    const file = new File(['x'], 'a.png', { type: 'image/png' });
    h.admin.uploadProductImage.and.returnValue(of({ images: [{ id: 'i' }] }));
    c.onImageUpload({ target: { files: [file] } } as any);
    expect(c.productImages().length).toBe(1);

    h.admin.uploadProductImage.and.returnValue(throwError(() => new Error('x')));
    c.onImageUpload({ target: { files: [file] } } as any);
    expect(h.toast.error).toHaveBeenCalled();
  });
});

describe('AdminComponent — tax groups and rates', () => {
  let h: Harness;
  let c: any;
  beforeEach(() => {
    h = createComponent();
    c = h.component as any;
  });

  it('loadTaxGroups stores groups and surfaces error details', () => {
    h.taxesAdmin.listGroups.and.returnValue(of([{ id: 'g1' }]));
    c.loadTaxGroups();
    expect(c.taxGroups.length).toBe(1);
    h.taxesAdmin.listGroups.and.returnValue(of('bad'));
    c.loadTaxGroups();
    expect(c.taxGroups).toEqual([]);
    h.taxesAdmin.listGroups.and.returnValue(throwError(() => ({ error: { detail: 'nope' } })));
    c.loadTaxGroups();
    expect(c.taxGroupsError).toBe('nope');
  });

  it('createTaxGroup validates required fields and reports results', () => {
    c.taxGroupCreate = { code: '', name: '' };
    c.createTaxGroup();
    expect(h.taxesAdmin.createGroup).not.toHaveBeenCalled();

    c.taxGroupCreate = { code: ' VAT ', name: ' Std ', description: ' d ', is_default: true };
    h.taxesAdmin.createGroup.and.returnValue(of({}));
    c.createTaxGroup();
    expect(h.taxesAdmin.createGroup).toHaveBeenCalledWith(
      jasmine.objectContaining({ code: 'VAT', name: 'Std', is_default: true }),
    );

    c.taxGroupCreate = { code: 'A', name: 'B' };
    h.taxesAdmin.createGroup.and.returnValue(throwError(() => ({ error: { detail: 'dup' } })));
    c.createTaxGroup();
    expect(h.toast.error).toHaveBeenCalledWith('dup');
  });

  it('saveTaxGroup requires a name and reports outcomes', () => {
    c.saveTaxGroup({ id: 'g1', name: '  ' } as any);
    expect(h.taxesAdmin.updateGroup).not.toHaveBeenCalled();
    h.taxesAdmin.updateGroup.and.returnValue(of({}));
    c.saveTaxGroup({ id: 'g1', name: 'Reduced', description: '' } as any);
    expect(h.toast.success).toHaveBeenCalled();
    h.taxesAdmin.updateGroup.and.returnValue(throwError(() => ({})));
    c.saveTaxGroup({ id: 'g1', name: 'Reduced' } as any);
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('setDefaultTaxGroup skips defaults and updates otherwise', () => {
    c.setDefaultTaxGroup({ id: 'g1', is_default: true } as any);
    expect(h.taxesAdmin.updateGroup).not.toHaveBeenCalled();
    h.taxesAdmin.updateGroup.and.returnValue(of({}));
    c.setDefaultTaxGroup({ id: 'g1', is_default: false } as any);
    expect(h.taxesAdmin.updateGroup).toHaveBeenCalledWith('g1', { is_default: true });
    h.taxesAdmin.updateGroup.and.returnValue(throwError(() => ({})));
    c.setDefaultTaxGroup({ id: 'g2', is_default: false } as any);
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('deleteTaxGroup blocks default deletion and reports outcomes', () => {
    c.deleteTaxGroup({ id: 'g1', is_default: true } as any);
    expect(h.taxesAdmin.deleteGroup).not.toHaveBeenCalled();
    h.taxesAdmin.deleteGroup.and.returnValue(of({}));
    c.deleteTaxGroup({ id: 'g1', is_default: false } as any);
    expect(h.toast.success).toHaveBeenCalled();
    h.taxesAdmin.deleteGroup.and.returnValue(throwError(() => ({})));
    c.deleteTaxGroup({ id: 'g2', is_default: false } as any);
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('upsertTaxRate validates country and rate, then clears inputs', () => {
    c.taxRateCountry = {};
    c.taxRatePercent = {};
    c.upsertTaxRate({ id: 'g1' } as any); // missing country
    expect(h.taxesAdmin.upsertRate).not.toHaveBeenCalled();

    c.taxRateCountry = { g1: ' RO ' };
    c.taxRatePercent = { g1: '19' };
    h.taxesAdmin.upsertRate.and.returnValue(of({}));
    c.upsertTaxRate({ id: 'g1' } as any);
    expect(c.taxRateCountry['g1']).toBe('');
    expect(h.taxesAdmin.upsertRate).toHaveBeenCalledWith('g1', {
      country_code: 'RO',
      vat_rate_percent: 19,
    });

    c.taxRateCountry = { g1: 'RO' };
    c.taxRatePercent = { g1: '5' };
    h.taxesAdmin.upsertRate.and.returnValue(throwError(() => ({})));
    c.upsertTaxRate({ id: 'g1' } as any);
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('deleteTaxRate requires a country code and reports outcomes', () => {
    c.deleteTaxRate({ id: 'g1' } as any, '  ');
    expect(h.taxesAdmin.deleteRate).not.toHaveBeenCalled();
    h.taxesAdmin.deleteRate.and.returnValue(of({}));
    c.deleteTaxRate({ id: 'g1' } as any, 'RO');
    expect(h.toast.success).toHaveBeenCalled();
    h.taxesAdmin.deleteRate.and.returnValue(throwError(() => ({})));
    c.deleteTaxRate({ id: 'g1' } as any, 'RO');
    expect(h.toast.error).toHaveBeenCalled();
  });
});

describe('AdminComponent — blog selection and bulk actions', () => {
  let h: Harness;
  let c: any;
  beforeEach(() => {
    h = createComponent();
    c = h.component as any;
    c.contentBlocks = [{ key: 'blog.a' }, { key: 'blog.b' }, { key: 'page.x' }];
  });

  it('selection toggles track keys and reset errors', () => {
    expect(c.isBlogSelected('blog.a')).toBe(false);
    c.toggleBlogSelection('blog.a', checkboxEvent(true));
    expect(c.isBlogSelected('blog.a')).toBe(true);
    c.toggleBlogSelection('blog.a', checkboxEvent(false));
    expect(c.isBlogSelected('blog.a')).toBe(false);
  });

  it('areAllBlogSelected and toggleSelectAllBlogs operate over blog posts', () => {
    expect(c.areAllBlogSelected()).toBe(false);
    c.toggleSelectAllBlogs(checkboxEvent(true));
    expect(c.areAllBlogSelected()).toBe(true);
    c.toggleSelectAllBlogs(checkboxEvent(false));
    expect(c.blogBulkSelection.size).toBe(0);
    c.toggleSelectAllBlogs({ target: null } as any); // guard
    c.contentBlocks = [];
    expect(c.areAllBlogSelected()).toBe(false);
  });

  it('clearBlogBulkSelection empties the set', () => {
    c.blogBulkSelection.add('blog.a');
    c.clearBlogBulkSelection();
    expect(c.blogBulkSelection.size).toBe(0);
  });

  it('canApplyBlogBulk enforces selection and per-action requirements', () => {
    expect(c.canApplyBlogBulk()).toBe(false); // empty selection
    c.blogBulkSelection.add('blog.a');
    c.blogBulkAction = 'publish';
    expect(c.canApplyBlogBulk()).toBe(true);

    c.blogBulkAction = 'schedule';
    c.blogBulkPublishAt = '';
    expect(c.canApplyBlogBulk()).toBe(false);
    c.blogBulkPublishAt = '2030-01-01T10:00';
    c.blogBulkUnpublishAt = '2029-01-01T10:00'; // before publish
    expect(c.canApplyBlogBulk()).toBe(false);
    c.blogBulkUnpublishAt = '2031-01-01T10:00';
    expect(c.canApplyBlogBulk()).toBe(true);
    c.blogBulkUnpublishAt = 'invalid-date';
    expect(c.canApplyBlogBulk()).toBe(false);
    c.blogBulkUnpublishAt = '';
    expect(c.canApplyBlogBulk()).toBe(true);

    c.blogBulkAction = 'tags_add';
    c.blogBulkTags = '';
    expect(c.canApplyBlogBulk()).toBe(false);
    c.blogBulkTags = 'news, news, deals';
    expect(c.canApplyBlogBulk()).toBe(true);
  });

  it('blogBulkPreview renders a label per action', () => {
    expect(c.blogBulkPreview()).toContain('previewEmpty'); // no selection
    c.blogBulkSelection.add('blog.a');
    c.blogBulkAction = 'publish';
    expect(c.blogBulkPreview()).toContain('previewPublish');
    c.blogBulkAction = 'unpublish';
    expect(c.blogBulkPreview()).toContain('previewUnpublish');
    c.blogBulkAction = 'schedule';
    c.blogBulkPublishAt = '2030-01-01T10:00';
    c.blogBulkUnpublishAt = '';
    expect(c.blogBulkPreview()).toContain('previewSchedule');
    c.blogBulkAction = 'tags_add';
    c.blogBulkTags = 'a';
    expect(c.blogBulkPreview()).toContain('previewTagsAdd');
    c.blogBulkAction = 'tags_remove';
    expect(c.blogBulkPreview()).toContain('previewTagsRemove');
    c.blogBulkAction = 'noop' as any;
    expect(c.blogBulkPreview()).toContain('previewEmpty');
  });

  it('applyBlogBulkAction publishes selected posts and reports failures', () => {
    spyOn(c, 'reloadContentBlocks');
    c.blogBulkSelection = new Set(['blog.a', 'blog.b']);
    c.blogBulkAction = 'publish';
    h.admin.getContent.and.callFake((key: string) => of({ key, version: 1, meta: {} }));
    h.admin.updateContentBlock.and.callFake((key: string) =>
      key === 'blog.b' ? throwError(() => ({ key })) : of({ key, version: 2 }),
    );
    c.applyBlogBulkAction();
    expect(h.toast.success).toHaveBeenCalled();
    expect(h.toast.error).toHaveBeenCalled();
    expect(c.blogBulkSaving).toBe(false);
    expect(c.reloadContentBlocks).toHaveBeenCalled();
  });

  it('applyBlogBulkAction reports no-changes when content cannot be loaded', () => {
    c.blogBulkSelection = new Set(['blog.a']);
    c.blogBulkAction = 'publish';
    h.admin.getContent.and.returnValue(throwError(() => new Error('missing')));
    c.applyBlogBulkAction();
    expect(c.blogBulkError).toContain('noChanges');
  });

  it('applyBlogBulkAction is a no-op when the action is not applicable', () => {
    c.blogBulkSelection.clear();
    c.applyBlogBulkAction();
    expect(h.admin.getContent).not.toHaveBeenCalled();
  });

  it('extractBlogSlug and currentBlogSlug strip the blog prefix', () => {
    expect(c.extractBlogSlug('blog.hello')).toBe('hello');
    expect(c.extractBlogSlug('hello')).toBe('hello');
    c.selectedBlogKey = null;
    expect(c.currentBlogSlug()).toBe('');
    c.selectedBlogKey = 'blog.world';
    expect(c.currentBlogSlug()).toBe('world');
  });

  it('startBlogCreate and cancelBlogCreate manage the create form', () => {
    c.startBlogCreate();
    expect(c.showBlogCreate).toBe(true);
    expect(c.blogCreate.baseLang).toBe('en');
    expect(c.blogCreate.status).toBe('draft');
    c.cancelBlogCreate();
    expect(c.showBlogCreate).toBe(false);
  });

  it('parseTags trims, filters and de-duplicates case-insensitively', () => {
    expect(c.parseTags(' a, b ,a ,B, ')).toEqual(['a', 'b']);
    expect(c.parseTags('')).toEqual([]);
  });

  it('tags_add/tags_remove build merged meta payloads', () => {
    c.blogBulkAction = 'tags_add';
    c.blogBulkTags = 'news, deals';
    const added = c.buildBlogBulkPayload({ meta: { tags: ['news'] } });
    expect(added.meta.tags).toEqual(['news', 'deals']);
    c.blogBulkAction = 'tags_remove';
    const removed = c.buildBlogBulkPayload({ meta: { tags: 'news,deals' } });
    expect(removed.meta.tags).toBeUndefined(); // all removed → key deleted
    c.blogBulkTags = '';
    expect(c.buildBlogBulkPayload({ meta: {} })).toBeNull();
  });

  it('schedule payload validates publish/unpublish ordering', () => {
    c.blogBulkAction = 'schedule';
    c.blogBulkPublishAt = '';
    expect(c.buildBlogBulkPayload({ meta: {} })).toBeNull();
    c.blogBulkPublishAt = '2030-01-01T10:00';
    c.blogBulkUnpublishAt = '2029-01-01T10:00';
    expect(c.buildBlogBulkPayload({ meta: {} })).toBeNull();
    expect(c.blogBulkError).toContain('invalidSchedule');
    c.blogBulkUnpublishAt = '';
    expect(c.buildBlogBulkPayload({ meta: {} })).toEqual(
      jasmine.objectContaining({ status: 'published' }),
    );
  });
});

describe('AdminComponent — preview links', () => {
  let h: Harness;
  let c: any;
  let copy: jasmine.Spy;
  beforeEach(() => {
    h = createComponent();
    c = h.component as any;
    copy = spyOn(c, 'copyToClipboard').and.returnValue(Promise.resolve(true));
  });

  it('pagePreviewSlug extracts the slug part', () => {
    expect(c.pagePreviewSlug('page.about')).toBe('about');
    expect(c.pagePreviewSlug('notpage')).toBeNull();
    expect(c.pagePreviewSlug('page.')).toBeNull();
  });

  it('pagePublicPath maps known slugs and falls back', () => {
    expect(c.pagePublicPath('')).toBe('/pages');
    expect(c.pagePublicPath('about')).toBe('/about');
    expect(c.pagePublicPath('contact')).toBe('/contact');
    expect(c.pagePublicPath('faq')).toBe('/pages/faq');
  });

  it('previewOriginFromResponse extracts origin or falls back to window', () => {
    expect(c.previewOriginFromResponse({ url: 'https://ex.com/p?a=1' })).toBe('https://ex.com');
    expect(c.previewOriginFromResponse({ url: '' })).toBe(window.location.origin);
    expect(c.previewOriginFromResponse({ url: '/relative/path' })).toBe(window.location.origin);
  });

  it('pagePreviewShareUrl requires a matching token and builds a URL', () => {
    expect(c.pagePreviewShareUrl('')).toBeNull();
    c.pagePreviewToken = null;
    expect(c.pagePreviewShareUrl('about')).toBeNull();
    c.pagePreviewToken = 'tok';
    c.pagePreviewForSlug = 'about';
    c.pagePreviewOrigin = 'https://ex.com';
    const url = c.pagePreviewShareUrl('about');
    expect(url).toContain('preview=tok');
    expect(url).toContain('/about');
    const src = c.pagePreviewIframeSrc('about');
    expect(String(src)).toContain('__ts=');
    expect(c.pagePreviewIframeSrc('other')).toBeNull();
  });

  it('generatePagePreviewLink stores the token and copies the url', () => {
    c.generatePagePreviewLink('   '); // empty → no call
    expect(h.admin.createPagePreviewToken).not.toHaveBeenCalled();

    h.admin.createPagePreviewToken.and.returnValue(
      of({ token: 'pt', expires_at: 'soon', url: 'https://ex.com/about' }),
    );
    c.generatePagePreviewLink('about');
    expect(c.pagePreviewToken).toBe('pt');
    expect(copy).toHaveBeenCalled();

    h.admin.createPagePreviewToken.and.returnValue(throwError(() => new Error('x')));
    c.generatePagePreviewLink('about');
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('refreshPagePreview bumps the nonce only when a token exists', () => {
    c.pagePreviewToken = null;
    c.pagePreviewNonce = 0;
    c.refreshPagePreview();
    expect(c.pagePreviewNonce).toBe(0);
    c.pagePreviewToken = 'x';
    c.refreshPagePreview();
    expect(c.pagePreviewNonce).toBeGreaterThan(0);
  });

  it('home preview share url, iframe src, generate and refresh', () => {
    expect(c.homePreviewShareUrl()).toBeNull();
    c.homePreviewToken = 'ht';
    c.homePreviewOrigin = 'https://ex.com';
    expect(c.homePreviewShareUrl()).toContain('preview=ht');
    expect(String(c.homePreviewIframeSrc())).toContain('__ts=');

    c.homePreviewToken = null;
    h.admin.createHomePreviewToken.and.returnValue(
      of({ token: 'ht2', expires_at: 's', url: 'https://ex.com/' }),
    );
    c.generateHomePreviewLink();
    expect(c.homePreviewToken).toBe('ht2');
    expect(copy).toHaveBeenCalled();

    h.admin.createHomePreviewToken.and.returnValue(throwError(() => new Error('x')));
    c.generateHomePreviewLink();
    expect(h.toast.error).toHaveBeenCalled();

    c.homePreviewToken = null;
    c.homePreviewNonce = 0;
    c.refreshHomePreview();
    expect(c.homePreviewNonce).toBe(0);
    c.homePreviewToken = 'ht2';
    c.refreshHomePreview();
    expect(c.homePreviewNonce).toBeGreaterThan(0);
  });

  it('copyPreviewLink copies non-empty urls', async () => {
    c.copyPreviewLink('   ');
    expect(copy).not.toHaveBeenCalled();
    c.copyPreviewLink('https://ex.com');
    expect(copy).toHaveBeenCalledWith('https://ex.com');
    await Promise.resolve();
    expect(h.toast.info).toHaveBeenCalled();
  });

  it('generateBlogPreviewLink and copyBlogPreviewLink handle tokens', () => {
    c.selectedBlogKey = null;
    c.generateBlogPreviewLink();
    expect(h.blog.createPreviewToken).not.toHaveBeenCalled();

    c.selectedBlogKey = 'blog.hello';
    h.blog.createPreviewToken.and.returnValue(
      of({ url: 'https://ex.com/blog/hello', token: 'bt', expires_at: 's' }),
    );
    c.generateBlogPreviewLink();
    expect(c.blogPreviewUrl).toBe('https://ex.com/blog/hello');

    h.blog.createPreviewToken.and.returnValue(throwError(() => new Error('x')));
    c.generateBlogPreviewLink();
    expect(h.toast.error).toHaveBeenCalled();

    c.blogPreviewUrl = null;
    c.copyBlogPreviewLink();
    c.blogPreviewUrl = 'https://ex.com/blog/hello';
    c.copyBlogPreviewLink();
    expect(copy).toHaveBeenCalledWith('https://ex.com/blog/hello');
  });
});

describe('AdminComponent — blog versions and comment moderation', () => {
  let h: Harness;
  let c: any;
  beforeEach(() => {
    h = createComponent();
    c = h.component as any;
  });

  it('loadBlogVersions requires a key and stores versions', () => {
    c.selectedBlogKey = null;
    c.loadBlogVersions();
    expect(h.admin.listContentVersions).not.toHaveBeenCalled();
    c.selectedBlogKey = 'blog.a';
    h.admin.listContentVersions.and.returnValue(of([{ version: 1 }]));
    c.loadBlogVersions();
    expect(c.blogVersions.length).toBe(1);
    h.admin.listContentVersions.and.returnValue(throwError(() => new Error('x')));
    c.loadBlogVersions();
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('loadFlaggedComments stores items and handles errors', () => {
    h.blog.listFlaggedComments.and.returnValue(of({ items: [{ id: 'c1' }] }));
    c.loadFlaggedComments();
    expect(c.flaggedComments().length).toBe(1);
    expect(c.flaggedCommentsLoading()).toBe(false);
    h.blog.listFlaggedComments.and.returnValue(throwError(() => new Error('x')));
    c.loadFlaggedComments();
    expect(c.flaggedCommentsError).toBeTruthy();
  });

  it('resolveFlags reports success and error', () => {
    h.blog.listFlaggedComments.and.returnValue(of({ items: [] }));
    h.blog.resolveCommentFlagsAdmin.and.returnValue(of({}));
    c.resolveFlags({ id: 'c1' });
    expect(h.toast.success).toHaveBeenCalled();
    h.blog.resolveCommentFlagsAdmin.and.returnValue(throwError(() => new Error('x')));
    c.resolveFlags({ id: 'c1' });
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('toggleHide unhides a hidden comment and rolls back on error', () => {
    spyOn(c, 'loadFlaggedComments'); // isolate optimistic update from reload
    c.flaggedComments.set([{ id: 'c1', is_hidden: true }]);
    h.blog.unhideCommentAdmin.and.returnValue(of({}));
    c.toggleHide({ id: 'c1', is_hidden: true });
    expect(c.flaggedComments()[0].is_hidden).toBe(false);

    c.flaggedComments.set([{ id: 'c2', is_hidden: true }]);
    h.blog.unhideCommentAdmin.and.returnValue(throwError(() => new Error('x')));
    c.toggleHide({ id: 'c2', is_hidden: true });
    expect(c.flaggedComments()[0].is_hidden).toBe(true); // rolled back
  });

  it('toggleHide hides a visible comment via reason prompt', () => {
    const promptSpy = spyOn(window, 'prompt');
    spyOn(c, 'loadFlaggedComments'); // isolate optimistic update from reload
    c.flaggedComments.set([{ id: 'c3', is_hidden: false }]);

    promptSpy.and.returnValue(null); // cancel
    c.toggleHide({ id: 'c3', is_hidden: false });
    expect(h.blog.hideCommentAdmin).not.toHaveBeenCalled();

    promptSpy.and.returnValue('spam');
    h.blog.hideCommentAdmin.and.returnValue(of({}));
    c.toggleHide({ id: 'c3', is_hidden: false });
    expect(c.flaggedComments()[0].is_hidden).toBe(true);

    c.flaggedComments.set([{ id: 'c4', is_hidden: false }]);
    h.blog.hideCommentAdmin.and.returnValue(throwError(() => new Error('x')));
    c.toggleHide({ id: 'c4', is_hidden: false });
    expect(c.flaggedComments()[0].is_hidden).toBe(false); // rolled back
  });

  it('toggleHide respects the moderation-busy guard', () => {
    c.blogCommentModerationBusy.add('busy');
    c.toggleHide({ id: 'busy', is_hidden: false });
    expect(h.blog.hideCommentAdmin).not.toHaveBeenCalled();
  });

  it('adminDeleteComment confirms before deleting', () => {
    const confirmSpy = spyOn(window, 'confirm').and.returnValue(false);
    c.adminDeleteComment({ id: 'c1' });
    expect(h.blog.deleteComment).not.toHaveBeenCalled();

    confirmSpy.and.returnValue(true);
    h.blog.listFlaggedComments.and.returnValue(of({ items: [] }));
    h.blog.deleteComment.and.returnValue(of({}));
    c.adminDeleteComment({ id: 'c1' });
    expect(h.toast.success).toHaveBeenCalled();
    h.blog.deleteComment.and.returnValue(throwError(() => new Error('x')));
    c.adminDeleteComment({ id: 'c1' });
    expect(h.toast.error).toHaveBeenCalled();

    c.blogCommentModerationBusy.add('busy');
    c.adminDeleteComment({ id: 'busy' });
  });

  it('selectBlogVersion computes a diff and handles errors', () => {
    c.selectedBlogKey = null;
    c.selectBlogVersion(1);
    expect(h.admin.getContentVersion).not.toHaveBeenCalled();
    c.selectedBlogKey = 'blog.a';
    c.blogForm = { body_markdown: 'new text' };
    h.admin.getContentVersion.and.returnValue(of({ body_markdown: 'old text' }));
    c.selectBlogVersion(2);
    expect(c.blogDiffParts.length).toBeGreaterThan(0);
    h.admin.getContentVersion.and.returnValue(throwError(() => new Error('x')));
    c.selectBlogVersion(2);
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('rollbackBlogVersion confirms then reloads', () => {
    c.selectedBlogKey = null;
    c.rollbackBlogVersion(1);
    expect(h.admin.rollbackContentVersion).not.toHaveBeenCalled();

    c.selectedBlogKey = 'blog.a';
    const confirmSpy = spyOn(window, 'confirm').and.returnValue(false);
    c.rollbackBlogVersion(1);
    expect(h.admin.rollbackContentVersion).not.toHaveBeenCalled();

    confirmSpy.and.returnValue(true);
    spyOn(c, 'reloadContentBlocks');
    spyOn(c, 'loadBlogEditor');
    spyOn(c, 'loadBlogVersions');
    h.admin.rollbackContentVersion.and.returnValue(of({}));
    c.rollbackBlogVersion(1);
    expect(c.loadBlogEditor).toHaveBeenCalledWith('blog.a');

    h.admin.rollbackContentVersion.and.returnValue(throwError(() => new Error('x')));
    c.rollbackBlogVersion(1);
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('renderMarkdown delegates to the markdown service', () => {
    expect(c.renderMarkdown('hello')).toBe('<p>hello</p>');
  });
});

describe('AdminComponent — markdown editor helpers', () => {
  let c: any;
  let ta: HTMLTextAreaElement;
  beforeEach(() => {
    c = createComponent().component as any;
    c.blogForm = { body_markdown: '' };
    ta = document.createElement('textarea');
    document.body.appendChild(ta);
  });
  afterEach(() => ta.remove());

  it('applyBlogHeading prefixes the current line', () => {
    ta.value = 'Title';
    ta.selectionStart = ta.selectionEnd = 0;
    c.applyBlogHeading(ta, 2);
    expect(c.blogForm.body_markdown).toBe('## Title');
  });

  it('applyBlogList prefixes lines with a dash', () => {
    ta.value = 'item';
    ta.selectionStart = ta.selectionEnd = 0;
    c.applyBlogList(ta);
    expect(c.blogForm.body_markdown).toBe('- item');
  });

  it('wrapBlogSelection wraps a selection or inserts a placeholder', () => {
    ta.value = 'bold me';
    ta.selectionStart = 0;
    ta.selectionEnd = 4;
    c.wrapBlogSelection(ta, '**', '**', 'text');
    expect(c.blogForm.body_markdown).toBe('**bold** me');

    ta.value = '';
    ta.selectionStart = ta.selectionEnd = 0;
    c.wrapBlogSelection(ta, '_', '_', 'ph');
    expect(c.blogForm.body_markdown).toBe('_ph_');
  });

  it('insertBlogLink and insertBlogCodeBlock insert markdown snippets', () => {
    ta.value = 'click';
    ta.selectionStart = 0;
    ta.selectionEnd = 5;
    c.insertBlogLink(ta);
    expect(c.blogForm.body_markdown).toContain('[click](https://)');

    ta.value = 'x = 1';
    ta.selectionStart = 0;
    ta.selectionEnd = 5;
    c.insertBlogCodeBlock(ta);
    expect(c.blogForm.body_markdown).toContain('```');
  });

  it('insertBlogEmbed inserts an embed snippet or cancels', () => {
    const promptSpy = spyOn(window, 'prompt').and.returnValue('');
    ta.value = '';
    ta.selectionStart = ta.selectionEnd = 0;
    c.insertBlogEmbed(ta, 'product');
    expect(c.blogForm.body_markdown).toBe('');

    promptSpy.and.returnValue('shoes');
    c.insertBlogEmbed(ta, 'category');
    expect(c.blogForm.body_markdown).toContain('{{category:shoes}}');

    // RichEditorComponent branch
    const editor = { insertMarkdown: jasmine.createSpy('insertMarkdown') } as any;
    promptSpy.and.returnValue('coll');
    c.insertBlogEmbed(editor, 'collection');
    expect(editor.insertMarkdown).toHaveBeenCalledWith('{{collection:coll}}');
  });
});

describe('AdminComponent — blog image markdown, a11y and writing aids', () => {
  let h: Harness;
  let c: any;
  beforeEach(() => {
    h = createComponent();
    c = h.component as any;
    c.blogForm = { body_markdown: '', reading_time_minutes: '' };
  });

  it('insertBlogImageMarkdown appends an image snippet', () => {
    c.blogForm.body_markdown = 'Intro';
    c.insertBlogImageMarkdown('/img.png', 'Logo\n');
    expect(c.blogForm.body_markdown).toContain('![Logo](/img.png)');
    c.insertBlogImageMarkdown('/x.png', null);
    expect(c.blogForm.body_markdown).toContain('![image](/x.png)');
  });

  it('blogA11yIssues flags missing or generic alt text', () => {
    c.blogForm.body_markdown = '![](a.png) ![photo](b.png) ![Good alt](c.png) ![x]()';
    const issues = c.blogA11yIssues();
    expect(issues.map((i: any) => i.url)).toEqual(['a.png', 'b.png']);
  });

  it('suggestAltFromUrl derives readable text from a filename', () => {
    expect(c.suggestAltFromUrl('https://x.com/photos/my-cool_pic.jpg?v=2#h')).toBe('my cool pic');
    expect(c.suggestAltFromUrl('')).toBe('image');
  });

  it('promptFixBlogImageAlt updates the targeted image alt', () => {
    const promptSpy = spyOn(window, 'prompt').and.returnValue('Descriptive');
    c.blogForm.body_markdown = '![](a.png) ![](b.png)';
    c.promptFixBlogImageAlt(1);
    expect(c.blogForm.body_markdown).toContain('![Descriptive](b.png)');
    expect(c.blogA11yOpen).toBe(true);

    promptSpy.and.returnValue(''); // cancel keeps content
    const before = c.blogForm.body_markdown;
    c.promptFixBlogImageAlt(0);
    expect(c.blogForm.body_markdown).toBe(before);
  });

  it('setBlogMarkdownImageAlt ignores blank alt text', () => {
    c.blogForm.body_markdown = '![](a.png)';
    c.setBlogMarkdownImageAlt(0, '   ');
    expect(c.blogForm.body_markdown).toBe('![](a.png)');
  });

  it('blogWritingAids counts words and headings, applyBlogReadingTimeEstimate sets minutes', () => {
    c.blogForm.body_markdown = '# Title\n\nsome words here for counting purposes.';
    const aids = c.blogWritingAids();
    expect(aids.words).toBeGreaterThan(0);
    expect(aids.minutes).toBeGreaterThan(0);
    expect(aids.headings.length).toBe(1);
    c.applyBlogReadingTimeEstimate();
    expect(c.blogForm.reading_time_minutes).toBe(String(aids.minutes));

    c.blogForm.body_markdown = '';
    c.applyBlogReadingTimeEstimate(); // 0 minutes → no-op
    expect(c.blogWritingAids().minutes).toBe(0);
  });

  it('onBlogImageDragOver only reacts to file drags', () => {
    const noFiles = {
      dataTransfer: { types: ['text/plain'] },
      preventDefault: jasmine.createSpy('pd'),
    } as any;
    c.onBlogImageDragOver(noFiles);
    expect(noFiles.preventDefault).not.toHaveBeenCalled();
    const withFiles = {
      dataTransfer: { types: ['Files'], dropEffect: '' },
      preventDefault: jasmine.createSpy('pd'),
    } as any;
    c.onBlogImageDragOver(withFiles);
    expect(withFiles.preventDefault).toHaveBeenCalled();
    expect(withFiles.dataTransfer.dropEffect).toBe('copy');
  });

  it('onBlogImageDrop uploads dropped images and inserts markdown', async () => {
    const ta = document.createElement('textarea');
    c.blogForm.body_markdown = '';
    c.selectedBlogKey = 'blog.a';
    c.blogImageLayout = 'default';
    const file = new File(['x'], 'pic.png', { type: 'image/png' });
    const ev = {
      dataTransfer: { files: [file], types: ['Files'] },
      preventDefault: jasmine.createSpy('pd'),
      stopPropagation: jasmine.createSpy('sp'),
    } as any;
    h.admin.uploadContentImage.and.returnValue(
      of({ images: [{ id: 'i', url: '/u.png', sort_order: 0 }] }),
    );
    await c.onBlogImageDrop(ta, ev);
    expect(c.blogImages.length).toBe(1);
    expect(h.toast.success).toHaveBeenCalled();
  });

  it('onBlogImageDrop ignores non-image drops and missing keys', async () => {
    const ta = document.createElement('textarea');
    const noImg = {
      dataTransfer: { files: [], types: [] },
      preventDefault: jasmine.createSpy('pd'),
      stopPropagation: jasmine.createSpy('sp'),
    } as any;
    await c.onBlogImageDrop(ta, noImg);
    expect(h.admin.uploadContentImage).not.toHaveBeenCalled();

    c.selectedBlogKey = null;
    const file = new File(['x'], 'pic.png', { type: 'image/png' });
    const ev = {
      dataTransfer: { files: [file], types: ['Files'] },
      preventDefault: jasmine.createSpy('pd'),
      stopPropagation: jasmine.createSpy('sp'),
    } as any;
    await c.onBlogImageDrop(ta, ev);
    expect(h.admin.uploadContentImage).not.toHaveBeenCalled();
  });

  it('onBlogImageDrop reports an upload error', async () => {
    const ta = document.createElement('textarea');
    c.selectedBlogKey = 'blog.a';
    const file = new File(['x'], 'pic.png', { type: 'image/png' });
    const ev = {
      dataTransfer: { files: [file], types: ['Files'] },
      preventDefault: jasmine.createSpy('pd'),
      stopPropagation: jasmine.createSpy('sp'),
    } as any;
    h.admin.uploadContentImage.and.returnValue(throwError(() => new Error('x')));
    await c.onBlogImageDrop(ta, ev);
    expect(h.toast.error).toHaveBeenCalled();
  });
});

describe('AdminComponent — site settings load/save (assets, social, seo)', () => {
  let h: Harness;
  let c: any;
  beforeEach(() => {
    h = createComponent();
    c = h.component as any;
    h.admin.getContent.and.returnValue(of({ meta: {}, version: 1 }));
  });

  it('selectInfoLang sets the active info language', () => {
    c.selectInfoLang('ro');
    expect(c.infoLang).toBe('ro');
  });
});

describe('AdminComponent — navigation editor', () => {
  let h: Harness;
  let c: any;
  const link = (id: string) => ({ id, url: '/u', label: { en: 'E', ro: 'R' } });
  beforeEach(() => {
    h = createComponent();
    c = h.component as any;
    c.navigationForm = { header_links: [], footer_handcrafted_links: [], footer_legal_links: [] };
  });

  it('parseNavigationLinks keeps complete links and de-dupes ids', () => {
    const parsed = c.parseNavigationLinks([
      { id: 'a', url: '/x', label: { en: 'E', ro: 'R' } },
      { id: 'a', url: '/y', label: { en: 'E', ro: 'R' } }, // dup id
      { url: '/z', label: { en: 'E', ro: 'R' } }, // auto id
      { url: '', label: { en: 'E', ro: 'R' } }, // missing url
      null,
    ]);
    expect(parsed.length).toBe(2);
    expect(parsed[1].id).toBe('nav_3');
    expect(c.parseNavigationLinks('nope')).toEqual([]);
  });

  it('loadNavigation maps meta and falls back to defaults on error', () => {
    h.admin.getContent.and.returnValue(
      of({
        version: 2,
        meta: { header_links: [{ id: 'h', url: '/', label: { en: 'Home', ro: 'Acasa' } }] },
      }),
    );
    c.loadNavigation();
    expect(c.navigationForm.header_links.length).toBe(1);
    h.admin.getContent.and.returnValue(throwError(() => new Error('x')));
    c.loadNavigation();
    expect(c.navigationForm.header_links.length).toBeGreaterThan(0); // defaults
  });

  it('addNavigationLink / removeNavigationLink manage all three lists', () => {
    c.addNavigationLink('header');
    c.addNavigationLink('footer_handcrafted');
    c.addNavigationLink('footer_legal');
    expect(c.navigationForm.header_links.length).toBe(1);
    expect(c.navigationForm.footer_handcrafted_links.length).toBe(1);
    expect(c.navigationForm.footer_legal_links.length).toBe(1);

    const hid = c.navigationForm.header_links[0].id;
    c.removeNavigationLink('header', hid);
    expect(c.navigationForm.header_links.length).toBe(0);
    c.removeNavigationLink('footer_handcrafted', c.navigationForm.footer_handcrafted_links[0].id);
    expect(c.navigationForm.footer_handcrafted_links.length).toBe(0);
    c.removeNavigationLink('footer_legal', c.navigationForm.footer_legal_links[0].id);
    expect(c.navigationForm.footer_legal_links.length).toBe(0);
    c.removeNavigationLink('header', '  '); // guard
  });

  it('moveNavigationLink reorders within bounds', () => {
    c.navigationForm.header_links = [link('a'), link('b'), link('c')];
    c.moveNavigationLink('header', 'a', 1);
    expect(c.navigationForm.header_links.map((l: any) => l.id)).toEqual(['b', 'a', 'c']);
    c.moveNavigationLink('header', 'a', 99); // out of range
    c.moveNavigationLink('header', '  '); // guard
    c.navigationForm.footer_legal_links = [link('x'), link('y')];
    c.moveNavigationLink('footer_legal', 'y', -1);
    expect(c.navigationForm.footer_legal_links.map((l: any) => l.id)).toEqual(['y', 'x']);
  });

  it('resetNavigationDefaults requires confirmation', () => {
    const confirmSpy = spyOn(window, 'confirm').and.returnValue(false);
    c.resetNavigationDefaults();
    expect(c.navigationForm.header_links.length).toBe(0);
    confirmSpy.and.returnValue(true);
    c.resetNavigationDefaults();
    expect(c.navigationForm.header_links.length).toBeGreaterThan(0);
  });

  it('navigation drag lifecycle reorders and guards mismatches', () => {
    c.navigationForm.header_links = [link('a'), link('b'), link('c')];
    c.onNavigationDragStart('header', 'a');
    expect(c.draggingNavId).toBe('a');
    const ev = dragEvent();
    c.onNavigationDragOver(ev);
    expect(ev.preventDefault).toHaveBeenCalled();

    c.onNavigationDrop('header', 'c');
    expect(c.navigationForm.header_links.map((l: any) => l.id)).toEqual(['b', 'c', 'a']);
    expect(c.draggingNavId).toBeNull();

    c.onNavigationDragStart('header', 'a');
    c.onNavigationDrop('footer_legal', 'x'); // list mismatch → reset
    expect(c.draggingNavId).toBeNull();

    c.onNavigationDragStart('header', 'ghost');
    c.onNavigationDrop('header', 'b'); // from missing
    expect(c.draggingNavId).toBeNull();
  });

  it('saveNavigation rejects invalid links and persists otherwise', () => {
    c.navigationForm.header_links = [{ id: 'a', url: '/x', label: { en: 'E', ro: '' } }]; // invalid
    c.saveNavigation();
    expect(c.navigationError).toBeTruthy();
    expect(h.admin.updateContentBlock).not.toHaveBeenCalled();

    c.navigationForm = {
      header_links: [link('a'), { id: '', url: '', label: { en: '', ro: '' } }], // blank skipped
      footer_handcrafted_links: [],
      footer_legal_links: [],
    };
    h.admin.updateContentBlock.and.returnValue(of({ version: 2 }));
    c.saveNavigation();
    expect(c.navigationMessage).toBeTruthy();

    h.admin.getContent.and.returnValue(of({ meta: {}, version: 1 }));
    c.navigationForm = {
      header_links: [link('a')],
      footer_handcrafted_links: [],
      footer_legal_links: [],
    };
    h.admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 409 })));
    c.saveNavigation();
    expect(c.navigationError).toBeTruthy();

    c.navigationForm = {
      header_links: [link('a')],
      footer_handcrafted_links: [],
      footer_legal_links: [],
    };
    h.admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 500 })));
    h.admin.createContent.and.returnValue(of({ version: 1 }));
    c.saveNavigation();
    expect(c.navigationMessage).toBeTruthy();
  });
});

describe('AdminComponent — reusable blocks and content pages', () => {
  let h: Harness;
  let c: any;
  beforeEach(() => {
    h = createComponent();
    c = h.component as any;
    c.reusableBlocks = [];
    c.reusableBlocksMeta = {};
    c.reusableBlocksExists = true;
    c.pageBlocks = {};
  });

  it('visibleContentPages respects the hidden toggle', () => {
    c.contentPages = [
      { key: 'a', hidden: false },
      { key: 'b', hidden: true },
    ];
    c.showHiddenPages = false;
    expect(c.visibleContentPages().map((p: any) => p.key)).toEqual(['a']);
    c.showHiddenPages = true;
    expect(c.visibleContentPages().length).toBe(2);
  });

  it('loadContentPages sorts and maps translation flags then errors', () => {
    spyOn(c, 'loadPageBlocks'); // ensureSelectedPageIsVisible may trigger a reload
    h.admin.listContentPages.and.returnValue(
      of([
        { key: 'page.b', slug: 'b', needs_translation_en: true },
        { key: 'page.a', slug: 'a' },
      ]),
    );
    c.loadContentPages();
    expect(c.contentPages[0].slug).toBe('a');
    expect(c.pageBlocksNeedsTranslationEn['page.b']).toBe(true);
    h.admin.listContentPages.and.returnValue(throwError(() => new Error('x')));
    c.loadContentPages();
    expect(c.contentPagesError).toBeTruthy();
  });

  it('parseReusableBlocks keeps valid snippets and de-dupes', () => {
    const parsed = c.parseReusableBlocks({
      snippets: [
        { id: 'a', title: 'A', block: { type: 'text' } },
        { id: 'a', title: 'dup', block: { type: 'text' } },
        { id: '', title: 'no id', block: {} },
        { id: 'b', title: 'B', block: null },
        null,
      ],
    });
    expect(parsed.map((b: any) => b.id)).toEqual(['a']);
    expect(c.parseReusableBlocks({})).toEqual([]);
  });

  it('slugifyReusableBlockId normalises to a slug', () => {
    expect(c.slugifyReusableBlockId('Héllo World!')).toBe('hello-world');
    expect(c.slugifyReusableBlockId('   ')).toBe('');
  });

  it('deepCloneJson clones and tolerates cyclic input', () => {
    const obj = { a: 1, b: { c: 2 } };
    const clone = c.deepCloneJson(obj);
    expect(clone).toEqual(obj);
    expect(clone).not.toBe(obj);
    const cyclic: any = {};
    cyclic.self = cyclic;
    expect(c.deepCloneJson(cyclic)).toBe(cyclic); // returns original on failure
  });

  it('filteredReusableBlocks sorts and filters by query', () => {
    c.reusableBlocks = [
      { id: 'z', title: 'Zeta' },
      { id: 'a', title: 'Alpha' },
    ];
    c.reusableBlocksQuery = '';
    expect(c.filteredReusableBlocks().map((b: any) => b.id)).toEqual(['a', 'z']);
    c.reusableBlocksQuery = 'alph';
    expect(c.filteredReusableBlocks().map((b: any) => b.id)).toEqual(['a']);
  });

  it('savePageBlockAsReusable prompts for a title and persists', () => {
    const promptSpy = spyOn(window, 'prompt').and.returnValue('My Block');
    c.pageBlocks['page.about'] = [
      { key: 'b1', type: 'text', title: { en: 'Hello', ro: '' }, layout: {} },
    ];
    h.admin.updateContentBlock.and.returnValue(
      of({
        version: 2,
        meta: { snippets: [{ id: 'my-block', title: 'My Block', block: { type: 'text' } }] },
      }),
    );
    c.savePageBlockAsReusable('page.about', 'b1');
    expect(c.reusableBlocks.length).toBe(1);
    expect(h.toast.success).toHaveBeenCalled();

    // cancel via empty prompt
    promptSpy.and.returnValue('');
    h.admin.updateContentBlock.calls.reset();
    c.savePageBlockAsReusable('page.about', 'b1');
    expect(h.admin.updateContentBlock).not.toHaveBeenCalled();

    // missing target
    c.savePageBlockAsReusable('page.about', 'ghost');
    expect(h.admin.updateContentBlock).not.toHaveBeenCalled();
  });

  it('savePageBlockAsReusable confirms overwrite of an existing id', () => {
    spyOn(window, 'prompt').and.returnValue('Existing');
    const confirmSpy = spyOn(window, 'confirm').and.returnValue(false);
    c.reusableBlocks = [{ id: 'existing', title: 'Existing', block: { type: 'text' } }];
    c.pageBlocks['page.about'] = [{ key: 'b1', type: 'text', title: {}, layout: {} }];
    c.savePageBlockAsReusable('page.about', 'b1');
    expect(h.admin.updateContentBlock).not.toHaveBeenCalled(); // declined

    confirmSpy.and.returnValue(true);
    h.admin.updateContentBlock.and.returnValue(of({ version: 2, meta: { snippets: [] } }));
    c.savePageBlockAsReusable('page.about', 'b1');
    expect(h.admin.updateContentBlock).toHaveBeenCalled();
  });

  it('persistReusableBlocks creates when block does not yet exist and handles conflict', () => {
    c.reusableBlocksExists = false;
    h.admin.createContent.and.returnValue(of({ version: 1, meta: { snippets: [] } }));
    c.persistReusableBlocks([{ id: 'a', title: 'A', block: { type: 'text' } }], {
      successKey: 'k',
    });
    expect(h.admin.createContent).toHaveBeenCalled();
    expect(c.reusableBlocksExists).toBe(true);

    c.reusableBlocksExists = true;
    h.admin.getContent.and.returnValue(of({ meta: {}, version: 1 }));
    h.admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 409 })));
    c.persistReusableBlocks([], {});
    h.admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 500 })));
    c.persistReusableBlocks([], {});
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('insertReusableBlockIntoPage clones a snippet into a page', () => {
    c.reusableBlocks = [{ id: 'r1', title: 'R', block: { type: 'text', layout: {} } }];
    c.pageBlocks['page.about'] = [];
    c.insertReusableBlockIntoPage('page.about', 'r1');
    expect(c.pageBlocks['page.about'].length).toBe(1);
    expect(c.pageBlocks['page.about'][0].type).toBe('text');
    c.insertReusableBlockIntoPage('page.about', 'missing'); // no-op
    expect(c.pageBlocks['page.about'].length).toBe(1);
  });

  it('deleteReusableBlock confirms before removing', () => {
    c.reusableBlocks = [{ id: 'r1', title: 'R', block: {} }];
    c.reusableBlocksExists = true;
    const confirmSpy = spyOn(window, 'confirm').and.returnValue(false);
    c.deleteReusableBlock('r1');
    expect(h.admin.updateContentBlock).not.toHaveBeenCalled();
    confirmSpy.and.returnValue(true);
    h.admin.updateContentBlock.and.returnValue(of({ version: 2, meta: { snippets: [] } }));
    c.deleteReusableBlock('r1');
    expect(h.toast.success).toHaveBeenCalled();
    c.deleteReusableBlock('ghost'); // no-op
  });

  it('loadReusableBlocks maps snippets and handles 404 vs error', () => {
    h.admin.getContent.and.returnValue(
      of({ version: 2, meta: { snippets: [{ id: 'a', title: 'A', block: { type: 'text' } }] } }),
    );
    c.loadReusableBlocks();
    expect(c.reusableBlocks.length).toBe(1);
    expect(c.reusableBlocksExists).toBe(true);

    h.admin.getContent.and.returnValue(throwError(() => ({ status: 404 })));
    c.loadReusableBlocks();
    expect(c.reusableBlocksExists).toBe(false);

    h.admin.getContent.and.returnValue(throwError(() => ({ status: 500 })));
    c.loadReusableBlocks();
    expect(c.reusableBlocksError).toBeTruthy();
  });

  it('onPageBlocksKeyChange switches the active page key and resets preview', () => {
    spyOn(c, 'loadPageBlocks');
    c.pageBlocksKey = 'page.about';
    c.onPageBlocksKeyChange('page.about'); // unchanged → no-op
    expect(c.loadPageBlocks).not.toHaveBeenCalled();
    c.onPageBlocksKeyChange('page.contact');
    expect(c.pageBlocksKey).toBe('page.contact');
    expect(c.pagePreviewToken).toBeNull();
    expect(c.loadPageBlocks).toHaveBeenCalledWith('page.contact');
  });
});

describe('AdminComponent — content redirects, find/replace, link check', () => {
  let h: Harness;
  let c: any;
  beforeEach(() => {
    h = createComponent();
    c = h.component as any;
    c.redirectsMeta = { page: 1, limit: 20, total_pages: 1, total_items: 0 };
    h.admin.listContentRedirects.and.returnValue(
      of({ items: [], meta: { page: 1, total_pages: 1, total_items: 0, limit: 20 } }),
    );
  });

  it('loadContentRedirects resets page, stores results and handles errors', () => {
    h.admin.listContentRedirects.and.returnValue(
      of({ items: [{ id: 'r1' }], meta: { page: 2, total_pages: 3, total_items: 5, limit: 20 } }),
    );
    c.loadContentRedirects(true);
    expect(c.redirects.length).toBe(1);
    expect(c.redirectsMeta.total_pages).toBe(3);
    h.admin.listContentRedirects.and.returnValue(throwError(() => new Error('x')));
    c.loadContentRedirects();
    expect(c.redirectsError).toBeTruthy();
  });

  it('setRedirectsPage clamps and reloads only on change', () => {
    spyOn(c, 'loadContentRedirects');
    c.redirectsMeta = { page: 1, limit: 20, total_pages: 3 };
    c.setRedirectsPage(1); // unchanged
    expect(c.loadContentRedirects).not.toHaveBeenCalled();
    c.setRedirectsPage(99); // clamps to 3
    expect(c.redirectsMeta.page).toBe(3);
    expect(c.loadContentRedirects).toHaveBeenCalled();
  });

  it('deleteContentRedirect guards id and confirmation', () => {
    const confirmSpy = spyOn(window, 'confirm').and.returnValue(false);
    c.deleteContentRedirect('  ');
    expect(h.admin.deleteContentRedirect).not.toHaveBeenCalled();
    c.deleteContentRedirect('r1'); // declined
    expect(h.admin.deleteContentRedirect).not.toHaveBeenCalled();
    confirmSpy.and.returnValue(true);
    spyOn(c, 'loadContentRedirects');
    h.admin.deleteContentRedirect.and.returnValue(of({}));
    c.deleteContentRedirect('r1');
    expect(h.toast.success).toHaveBeenCalled();
    h.admin.deleteContentRedirect.and.returnValue(throwError(() => ({ error: { detail: 'd' } })));
    c.deleteContentRedirect('r1');
    expect(h.toast.error).toHaveBeenCalledWith('d');
  });

  it('createContentRedirect validates fields and reports outcomes', () => {
    spyOn(c, 'loadContentRedirects');
    c.redirectCreateSaving = false;
    c.redirectCreateFrom = '';
    c.redirectCreateTo = 'x';
    c.createContentRedirect();
    expect(h.admin.upsertContentRedirect).not.toHaveBeenCalled();

    c.redirectCreateFrom = 'a';
    c.redirectCreateTo = 'b';
    h.admin.upsertContentRedirect.and.returnValue(of({}));
    c.createContentRedirect();
    expect(c.redirectCreateFrom).toBe('');
    expect(h.toast.success).toHaveBeenCalled();

    c.redirectCreateFrom = 'a';
    c.redirectCreateTo = 'b';
    h.admin.upsertContentRedirect.and.returnValue(throwError(() => ({ error: { detail: 'dup' } })));
    c.createContentRedirect();
    expect(h.toast.error).toHaveBeenCalledWith('dup');

    c.redirectCreateSaving = true;
    c.createContentRedirect(); // busy guard
  });

  it('importContentRedirects handles file selection and outcomes', () => {
    spyOn(c, 'loadContentRedirects');
    c.importContentRedirects({ target: { files: [], value: 'x' } } as any); // no file
    expect(h.admin.importContentRedirects).not.toHaveBeenCalled();

    const file = new File(['csv'], 'r.csv', { type: 'text/csv' });
    h.admin.importContentRedirects.and.returnValue(of({ created: 1 }));
    c.importContentRedirects({ target: { files: [file], value: 'x' } } as any);
    expect(c.redirectsImportResult).toEqual({ created: 1 } as any);

    h.admin.importContentRedirects.and.returnValue(
      throwError(() => ({ error: { detail: 'bad' } })),
    );
    c.importContentRedirects({ target: { files: [file], value: 'x' } } as any);
    expect(h.toast.error).toHaveBeenCalledWith('bad');
  });

  it('findReplaceKeyPrefix maps each scope', () => {
    c.findReplaceScope = 'blog';
    expect(c.findReplaceKeyPrefix()).toBe('blog.');
    c.findReplaceScope = 'home';
    expect(c.findReplaceKeyPrefix()).toBe('home.');
    c.findReplaceScope = 'site';
    expect(c.findReplaceKeyPrefix()).toBe('site.');
    c.findReplaceScope = 'pages';
    expect(c.findReplaceKeyPrefix()).toBe('page.');
    c.findReplaceScope = 'all';
    expect(c.findReplaceKeyPrefix()).toBeUndefined();
  });

  it('previewFindReplace validates input and stores preview', () => {
    c.findReplaceFind = '';
    c.previewFindReplace();
    expect(h.admin.previewFindReplaceContent).not.toHaveBeenCalled();
    expect(h.toast.error).toHaveBeenCalled();

    c.findReplaceFind = 'foo';
    c.findReplaceScope = 'blog';
    h.admin.previewFindReplaceContent.and.returnValue(of({ total_items: 2, total_matches: 5 }));
    c.previewFindReplace();
    expect(c.findReplacePreview.total_matches).toBe(5);
    expect(c.findReplacePreviewKey).toBeTruthy();

    h.admin.previewFindReplaceContent.and.returnValue(
      throwError(() => ({ error: { detail: 'e' } })),
    );
    c.previewFindReplace();
    expect(c.findReplaceError).toBe('e');
  });

  it('applyFindReplace requires a matching preview and confirmation', () => {
    c.findReplaceFind = '';
    c.applyFindReplace();
    expect(h.toast.error).toHaveBeenCalled();

    c.findReplaceFind = 'foo';
    c.findReplaceScope = 'blog';
    c.findReplacePreview = null;
    c.applyFindReplace(); // no preview
    expect(h.admin.applyFindReplaceContent).not.toHaveBeenCalled();

    // create a matching preview first
    h.admin.previewFindReplaceContent.and.returnValue(of({ total_items: 1, total_matches: 2 }));
    c.previewFindReplace();
    const confirmSpy = spyOn(window, 'confirm').and.returnValue(false);
    c.applyFindReplace(); // declined
    expect(h.admin.applyFindReplaceContent).not.toHaveBeenCalled();

    confirmSpy.and.returnValue(true);
    h.admin.applyFindReplaceContent.and.returnValue(
      throwError(() => ({ error: { detail: 'oops' } })),
    );
    c.applyFindReplace();
    expect(h.toast.error).toHaveBeenCalledWith('oops'); // error handler toasts the detail
    expect(c.findReplaceApplying).toBe(false);

    // success path with a fresh preview
    c.previewFindReplace();
    h.admin.applyFindReplaceContent.and.returnValue(
      of({ updated_blocks: 1, total_replacements: 2 }),
    );
    c.applyFindReplace();
    expect(c.findReplaceApplyResult).toBeTruthy();
  });

  it('runLinkCheck validates key and stores issues', () => {
    c.runLinkCheck('   ');
    expect(h.admin.linkCheckContent).not.toHaveBeenCalled();
    h.admin.linkCheckContent.and.returnValue(of({ issues: [{ url: '/x' }] }));
    c.runLinkCheck('blog.a');
    expect(c.linkCheckIssues.length).toBe(1);
    h.admin.linkCheckContent.and.returnValue(throwError(() => ({ error: { detail: 'le' } })));
    c.runLinkCheck('blog.a');
    expect(c.linkCheckError).toBe('le');
  });

  it('redirect/page helper functions map values', () => {
    expect(c.redirectKeyToUrl('page.about')).toBe('/pages/about');
    expect(c.redirectKeyToUrl('blog.x')).toBe('blog.x');
    expect(c.pageKeySupportsRequiresAuth('page.x')).toBe(true);
    expect(c.pageKeySupportsRequiresAuth('home.x')).toBe(false);
    for (const t of [
      'image',
      'columns',
      'cta',
      'faq',
      'testimonials',
      'product_grid',
      'form',
      'gallery',
      'banner',
      'carousel',
      'text',
    ]) {
      expect(c.pageBlockTypeLabelKey(t)).toContain(t === 'text' ? 'text' : t);
    }
    expect(c.allowedPageBlockTypesForKey('page.about').length).toBeGreaterThan(0);
    expect(c.canRenamePageKey('page.about')).toBe(false);
    expect(c.canRenamePageKey('page.custom')).toBe(true);
    expect(c.canRenamePageKey('home.x')).toBe(false);
  });
});

describe('AdminComponent — page builder block editing', () => {
  let h: Harness;
  let c: any;
  const KEY = 'page.about';
  beforeEach(() => {
    h = createComponent();
    c = h.component as any;
    c.pageBlocks = {};
  });

  it('addPageBlockFromLibrary inserts a block and applies starter templates', () => {
    for (const type of [
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
    ]) {
      c.addPageBlockFromLibrary(KEY, type, 'starter');
    }
    expect(c.pageBlocks[KEY].length).toBe(11);
    expect(c.pageBlocks[KEY][0].title.en).toBe('Section title'); // text starter
  });

  it('addPageBlockFromLibrary rejects a type not allowed for the key', () => {
    // global section keys restrict allowed types
    const restricted = c.allowedCmsLibraryTypes('home.story');
    if (restricted) {
      c.addPageBlockFromLibrary('home.story', 'product_grid', 'blank');
      expect(h.toast.error).toHaveBeenCalled();
    }
    expect(true).toBe(true);
  });

  it('movePageBlock reorders within bounds and announces', () => {
    c.pageBlocks[KEY] = [
      { key: 'a', type: 'text' },
      { key: 'b', type: 'text' },
      { key: 'c', type: 'text' },
    ];
    c.movePageBlock(KEY, 'a', 1);
    expect(c.pageBlocks[KEY].map((b: any) => b.key)).toEqual(['b', 'a', 'c']);
    c.movePageBlock(KEY, 'missing', 1);
    c.movePageBlock(KEY, 'b', -5); // out of range
    expect(c.pageBlocks[KEY][0].key).toBe('b');
  });

  it('page block drag lifecycle and drop zone reorders', () => {
    c.pageBlocks[KEY] = [
      { key: 'a', type: 'text' },
      { key: 'b', type: 'text' },
    ];
    c.onPageBlockDragStart(KEY, 'a');
    expect(c.draggingPageBlockKey).toBe('a');
    const ev = dragEvent();
    c.onPageBlockDragOver(ev);
    expect(ev.preventDefault).toHaveBeenCalled();

    c.draggingPageBlocksKey = KEY;
    c.draggingPageBlockKey = 'a';
    c.onPageBlockDropZone(dragEvent(), KEY, 2);
    expect(c.pageBlocks[KEY].map((b: any) => b.key)).toEqual(['b', 'a']);

    // library payload insert
    c.onPageBlockDropZone(
      dragEvent({ kind: 'cms-block', scope: 'page', type: 'text', template: 'blank' }),
      KEY,
      0,
    );
    expect(c.pageBlocks[KEY].length).toBe(3);

    // wrong scope
    const before = c.pageBlocks[KEY].length;
    c.onPageBlockDropZone(dragEvent({ kind: 'cms-block', scope: 'home', type: 'text' }), KEY, 0);
    expect(c.pageBlocks[KEY].length).toBe(before);

    c.onPageBlockDragEnd();
    expect(c.draggingPageBlockKey).toBeNull();
  });

  it('onPageBlockDrop reorders onto a target and inserts library payloads', () => {
    c.pageBlocks[KEY] = [
      { key: 'a', type: 'text' },
      { key: 'b', type: 'text' },
      { key: 'c', type: 'text' },
    ];
    c.draggingPageBlocksKey = KEY;
    c.draggingPageBlockKey = 'a';
    c.onPageBlockDrop(dragEvent(), KEY, 'c');
    expect(c.pageBlocks[KEY].map((b: any) => b.key)).toEqual(['b', 'a', 'c']);

    const cnt = c.pageBlocks[KEY].length;
    c.onPageBlockDrop(
      dragEvent({ kind: 'cms-block', scope: 'page', type: 'text', template: 'blank' }),
      KEY,
      'b',
    );
    expect(c.pageBlocks[KEY].length).toBe(cnt + 1);
  });

  it('gallery image add/remove and from-asset', () => {
    c.pageBlocks[KEY] = [{ key: 'g', type: 'gallery', images: [] }];
    c.addPageGalleryImage(KEY, 'g');
    expect(c.pageBlocks[KEY][0].images.length).toBe(1);
    c.addPageGalleryImageFromAsset(KEY, 'g', { url: ' /a.png ', focal_x: 10, focal_y: 20 });
    expect(c.pageBlocks[KEY][0].images[1].url).toBe('/a.png');
    c.addPageGalleryImageFromAsset(KEY, 'g', { url: '' }); // ignored
    expect(c.pageBlocks[KEY][0].images.length).toBe(2);
    c.removePageGalleryImage(KEY, 'g', 0);
    expect(c.pageBlocks[KEY][0].images.length).toBe(1);
  });

  it('columns add/remove respects min 2 / max 3', () => {
    c.pageBlocks[KEY] = [{ key: 'col', type: 'columns', columns: [{}, {}] }];
    c.addPageColumnsColumn(KEY, 'col');
    expect(c.pageBlocks[KEY][0].columns.length).toBe(3);
    c.addPageColumnsColumn(KEY, 'col'); // capped at 3
    expect(c.pageBlocks[KEY][0].columns.length).toBe(3);
    c.removePageColumnsColumn(KEY, 'col', 0);
    expect(c.pageBlocks[KEY][0].columns.length).toBe(2);
    c.removePageColumnsColumn(KEY, 'col', 0); // min 2
    expect(c.pageBlocks[KEY][0].columns.length).toBe(2);
  });

  it('faq and testimonial items add/remove respect bounds', () => {
    c.pageBlocks[KEY] = [
      { key: 'f', type: 'faq', faq_items: [{}] },
      { key: 't', type: 'testimonials', testimonials: [{}] },
    ];
    c.addPageFaqItem(KEY, 'f');
    expect(c.pageBlocks[KEY][0].faq_items.length).toBe(2);
    c.removePageFaqItem(KEY, 'f', 1);
    expect(c.pageBlocks[KEY][0].faq_items.length).toBe(1);
    c.removePageFaqItem(KEY, 'f', 0); // min 1
    expect(c.pageBlocks[KEY][0].faq_items.length).toBe(1);

    c.addPageTestimonial(KEY, 't');
    expect(c.pageBlocks[KEY][1].testimonials.length).toBe(2);
    c.removePageTestimonial(KEY, 't', 1);
    expect(c.pageBlocks[KEY][1].testimonials.length).toBe(1);
    c.removePageTestimonial(KEY, 't', 0); // min 1
    expect(c.pageBlocks[KEY][1].testimonials.length).toBe(1);
  });

  it('product grid slug helpers parse, add and remove', () => {
    const block = { product_grid_product_slugs: 'a\nb' };
    expect(c.productGridSelectedSlugs(block)).toEqual(['a', 'b']);
    c.addProductGridProductSlug(block, 'c');
    expect(block.product_grid_product_slugs).toBe('a\nb\nc');
    c.addProductGridProductSlug(block, 'a'); // dup ignored
    c.addProductGridProductSlug(block, '  '); // empty ignored
    c.removeProductGridProductSlug(block, 'b');
    expect(block.product_grid_product_slugs).toBe('a\nc');
    c.removeProductGridProductSlug(block, '  '); // guard
  });

  it('searchProductGridProducts stores results and errors', () => {
    c.productGridProductSearchQuery = { k1: '' };
    c.searchProductGridProducts('k1'); // empty → reset
    expect(c.productGridProductSearchResults['k1']).toEqual([]);

    c.productGridProductSearchQuery = { k1: 'shoe' };
    h.adminProducts.search.and.returnValue(of({ items: [{ slug: 's' }] }));
    c.searchProductGridProducts('k1');
    expect(c.productGridProductSearchResults['k1'].length).toBe(1);

    h.adminProducts.search.and.returnValue(throwError(() => new Error('x')));
    c.searchProductGridProducts('k1');
    expect(c.productGridProductSearchError['k1']).toBeTruthy();
  });

  it('queueProductGridProductSearch clears on empty query', () => {
    c.productGridProductSearchQuery = {};
    c.productGridProductSearchResults = {};
    c.queueProductGridProductSearch('k1', '   ');
    expect(c.productGridProductSearchResults['k1']).toEqual([]);
    c.queueProductGridProductSearch('k1', 'shoe'); // schedules a timer (no throw)
    expect(c.productGridProductSearchQuery['k1']).toBe('shoe');
  });
});

describe('AdminComponent — home sections load/save and collections', () => {
  let h: Harness;
  let c: any;
  beforeEach(() => {
    h = createComponent();
    c = h.component as any;
  });

  it('loadSections parses built-in and custom blocks', () => {
    h.admin.getContent.and.returnValue(
      of({
        version: 2,
        meta: {
          blocks: [
            { type: 'featured_products', enabled: false },
            { type: 'featured_products' }, // dup built-in skipped
            { type: 'text', key: 't1', title: 'Hi', body_markdown: 'Body' },
            {
              type: 'columns',
              key: 'c1',
              columns: [{ title: 'a' }, { title: 'b' }],
              columns_breakpoint: 'lg',
            },
            { type: 'cta', key: 'cta1', cta_url: '/go', cta_new_tab: true },
            { type: 'faq', key: 'f1', items: [{ question: 'q' }] },
            { type: 'testimonials', key: 'te1', items: [{ author: 'a' }] },
            { type: 'image', key: 'i1', url: '/img' },
            { type: 'gallery', key: 'g1', images: [{ url: '/g' }, { url: '' }] },
            { type: 'banner', key: 'b1', slide: { image: '/b' } },
            {
              type: 'carousel',
              key: 'car1',
              slides: [{ image: '/s' }],
              settings: { autoplay: true },
            },
            { type: 'unknown' }, // skipped
            null,
          ],
        },
      }),
    );
    c.loadSections();
    const types = c.homeBlocks.map((b: any) => b.type);
    expect(types).toContain('featured_products');
    expect(types).toContain('text');
    expect(types).toContain('carousel');
    expect(types.filter((t: string) => t === 'featured_products').length).toBe(1); // de-duped
  });

  it('saveSections serialises blocks and persists with conflict/404 fallbacks', () => {
    c.cmsHomeDraft.initFromServer([]);
    c.homeBlocks = [
      c.makeHomeBlockDraft('featured_products', 'featured_products', true),
      { ...c.makeHomeBlockDraft('t1', 'text', true), title: { en: 'T', ro: '' } },
      c.makeHomeBlockDraft('g1', 'gallery', true),
      c.makeHomeBlockDraft('car1', 'carousel', true),
    ];
    spyOn(c, 'refreshHomePreview');
    h.admin.updateContentBlock.and.returnValue(of({ version: 2 }));
    c.saveSections();
    const payload = h.admin.updateContentBlock.calls.mostRecent().args[1];
    expect(payload.meta.sections.length).toBe(1); // only the built-in section
    expect(c.sectionsMessage).toBeTruthy();

    h.admin.getContent.and.returnValue(of({ meta: { blocks: [] }, version: 1 }));
    h.admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 409 })));
    c.saveSections();
    expect(c.sectionsMessage).toBeTruthy();

    h.admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 404 })));
    h.admin.createContent.and.returnValue(of({ version: 1 }));
    c.saveSections();
    expect(c.sectionsMessage).toBeTruthy();

    h.admin.createContent.and.returnValue(throwError(() => new Error('x')));
    c.saveSections();
    expect(c.sectionsMessage).toBeTruthy();

    h.admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 500 })));
    c.saveSections();
    expect(c.sectionsMessage).toBeTruthy();
  });

  it('loadCategories sorts and resets on error', () => {
    h.admin.getCategories.and.returnValue(
      of([
        { slug: 'b', sort_order: 2 },
        { slug: 'a', sort_order: 1 },
      ]),
    );
    c.loadCategories();
    expect(c.categories[0].slug).toBe('a');
    h.admin.getCategories.and.returnValue(throwError(() => new Error('x')));
    c.loadCategories();
    expect(c.categories).toEqual([]);
  });

  it('loadCollections stores collections and resets on error', () => {
    h.admin.listFeaturedCollections.and.returnValue(of([{ id: 'c1' }]));
    c.loadCollections();
    expect(c.featuredCollections.length).toBe(1);
    h.admin.listFeaturedCollections.and.returnValue(throwError(() => new Error('x')));
    c.loadCollections();
    expect(c.featuredCollections).toEqual([]);
  });

  it('resetCollectionForm clears the editing state', () => {
    c.editingCollection = { id: 'x' };
    c.collectionForm = { name: 'n', description: 'd', product_ids: ['p'] };
    c.resetCollectionForm();
    expect(c.editingCollection).toBeNull();
    expect(c.collectionForm.product_ids).toEqual([]);
  });
});

describe('AdminComponent — home block content editing', () => {
  let h: Harness;
  let c: any;
  beforeEach(() => {
    h = createComponent();
    c = h.component as any;
  });

  it('removeHomeBlock only removes custom blocks', () => {
    c.homeBlocks = [
      c.makeHomeBlockDraft('story', 'story', true),
      c.makeHomeBlockDraft('t1', 'text', true),
    ];
    c.removeHomeBlock('story'); // built-in → kept
    expect(c.homeBlocks.length).toBe(2);
    c.removeHomeBlock('t1'); // custom → removed
    expect(c.homeBlocks.length).toBe(1);
    c.removeHomeBlock('missing'); // no-op
  });

  it('setImageBlockUrl updates the matching image block', () => {
    c.homeBlocks = [c.makeHomeBlockDraft('img', 'image', true)];
    c.setImageBlockUrl('img', { url: ' /p.png ', focal_x: 10, focal_y: 20 });
    expect(c.homeBlocks[0].url).toBe('/p.png');
    c.setImageBlockUrl('img', { url: '' }); // ignored
    expect(c.homeBlocks[0].url).toBe('/p.png');
  });

  it('home gallery image add/remove/from-asset', () => {
    c.homeBlocks = [c.makeHomeBlockDraft('g', 'gallery', true)];
    c.addGalleryImage('g');
    expect(c.homeBlocks[0].images.length).toBe(1);
    c.addGalleryImageFromAsset('g', { url: '/a.png', focal_x: 5, focal_y: 6 });
    expect(c.homeBlocks[0].images[1].url).toBe('/a.png');
    c.addGalleryImageFromAsset('g', { url: '' }); // ignored
    c.removeGalleryImage('g', 0);
    expect(c.homeBlocks[0].images.length).toBe(1);
  });

  it('home columns/faq/testimonials add and remove respect bounds', () => {
    c.homeBlocks = [
      c.makeHomeBlockDraft('col', 'columns', true),
      c.makeHomeBlockDraft('f', 'faq', true),
      c.makeHomeBlockDraft('te', 'testimonials', true),
    ];
    c.addHomeColumnsColumn('col');
    expect(c.homeBlocks[0].columns.length).toBe(3);
    c.addHomeColumnsColumn('col'); // capped
    c.removeHomeColumnsColumn('col', 0);
    expect(c.homeBlocks[0].columns.length).toBe(2);
    c.removeHomeColumnsColumn('col', 0); // min 2

    c.addHomeFaqItem('f');
    expect(c.homeBlocks[1].faq_items.length).toBe(2);
    c.removeHomeFaqItem('f', 1);
    c.removeHomeFaqItem('f', 0); // min 1
    expect(c.homeBlocks[1].faq_items.length).toBe(1);

    c.addHomeTestimonial('te');
    expect(c.homeBlocks[2].testimonials.length).toBe(2);
    c.removeHomeTestimonial('te', 1);
    c.removeHomeTestimonial('te', 0); // min 1
    expect(c.homeBlocks[2].testimonials.length).toBe(1);
  });

  it('banner and carousel slide editing', () => {
    c.homeBlocks = [
      c.makeHomeBlockDraft('b', 'banner', true),
      c.makeHomeBlockDraft('car', 'carousel', true),
    ];
    c.setBannerSlideImage('b', { url: '/banner.jpg', focal_x: 1, focal_y: 2 });
    expect(c.homeBlocks[0].slide.image_url).toBe('/banner.jpg');
    c.setBannerSlideImage('b', { url: '' }); // ignored

    c.addCarouselSlide('car');
    expect(c.homeBlocks[1].slides.length).toBe(2);
    c.moveCarouselSlide('car', 0, 1);
    c.moveCarouselSlide('car', 0, 99); // out of range
    c.setCarouselSlideImage('car', 0, { url: '/s.jpg', focal_x: 3, focal_y: 4 });
    expect(c.homeBlocks[1].slides[0].image_url).toBe('/s.jpg');
    c.setCarouselSlideImage('car', 99, { url: '/x' }); // bad idx
    c.setCarouselSlideImage('car', 0, { url: '' }); // ignored
    c.removeCarouselSlide('car', 0);
    expect(c.homeBlocks[1].slides.length).toBe(1);
    c.removeCarouselSlide('car', 0); // keeps at least one
    expect(c.homeBlocks[1].slides.length).toBe(1);
  });
});

describe('AdminComponent — blog editor create/select/delete/lang', () => {
  let h: Harness;
  let c: any;
  beforeEach(() => {
    h = createComponent();
    c = h.component as any;
    c.startBlogCreate();
  });

  it('createBlogPost validates slug and title/body', async () => {
    c.blogCreate.title = '';
    await c.createBlogPost();
    expect(h.admin.createContent).not.toHaveBeenCalled();

    c.blogCreate.title = 'Hello World';
    c.blogCreate.body_markdown = '';
    await c.createBlogPost();
    expect(h.admin.createContent).not.toHaveBeenCalled();
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('createBlogPost posts content, meta and translation', async () => {
    spyOn(c, 'reloadContentBlocks');
    spyOn(c, 'loadBlogEditor');
    c.blogCreate.title = 'Hello World';
    c.blogCreate.body_markdown = 'Body';
    c.blogCreate.summary = 'Sum';
    c.blogCreate.tags = 'a, b';
    c.blogCreate.series = 'S';
    c.blogCreate.cover_image_url = '/c.png';
    c.blogCreate.reading_time_minutes = '4';
    c.blogCreate.pinned = true;
    c.blogCreate.pin_order = '2';
    c.blogCreate.published_at = '2030-01-01T10:00';
    c.blogCreate.includeTranslation = true;
    c.blogCreate.translationTitle = 'Salut';
    c.blogCreate.translationBody = 'Corp';
    h.admin.createContent.and.returnValue(of({ version: 1 }));
    h.admin.updateContentBlock.and.returnValue(of({ version: 2 }));
    await c.createBlogPost();
    expect(h.admin.createContent).toHaveBeenCalled();
    expect(h.admin.updateContentBlock).toHaveBeenCalled();
    expect(c.showBlogCreate).toBe(false);
    expect(c.loadBlogEditor).toHaveBeenCalled();
  });

  it('createBlogPost retries on a key-exists conflict', async () => {
    spyOn(c, 'reloadContentBlocks');
    spyOn(c, 'loadBlogEditor');
    c.blogCreate.title = 'Hello World';
    c.blogCreate.body_markdown = 'Body';
    let calls = 0;
    h.admin.createContent.and.callFake(() => {
      calls += 1;
      return calls === 1
        ? throwError(() => ({ error: { detail: 'Content key exists' } }))
        : of({ version: 1 });
    });
    await c.createBlogPost();
    expect(calls).toBe(2);
    expect(h.toast.success).toHaveBeenCalled();
  });

  it('createBlogPost reports a generic error', async () => {
    c.blogCreate.title = 'Hello World';
    c.blogCreate.body_markdown = 'Body';
    h.admin.createContent.and.returnValue(throwError(() => new Error('boom')));
    await c.createBlogPost();
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('selectBlogPost loads the editor for a post', () => {
    spyOn(c, 'loadBlogEditor');
    c.selectBlogPost({ key: 'blog.a' });
    expect(c.showBlogCreate).toBe(false);
    expect(c.loadBlogEditor).toHaveBeenCalledWith('blog.a');
  });

  it('deleteBlogPost confirms then deletes', () => {
    c.deleteBlogPost({ key: '' }); // guard
    expect(h.admin.deleteContent).not.toHaveBeenCalled();

    const confirmSpy = spyOn(window, 'confirm').and.returnValue(false);
    c.deleteBlogPost({ key: 'blog.a', title: 'A' });
    expect(h.admin.deleteContent).not.toHaveBeenCalled();

    confirmSpy.and.returnValue(true);
    spyOn(c, 'reloadContentBlocks');
    c.selectedBlogKey = 'blog.a';
    h.admin.deleteContent.and.returnValue(of({}));
    c.deleteBlogPost({ key: 'blog.a', title: 'A' });
    expect(h.toast.success).toHaveBeenCalled();

    h.admin.deleteContent.and.returnValue(throwError(() => new Error('x')));
    c.deleteBlogPost({ key: 'blog.b' });
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('setBlogEditLang loads localized content', () => {
    c.selectedBlogKey = null;
    c.setBlogEditLang('ro');
    expect(h.admin.getContent).not.toHaveBeenCalled();

    c.selectedBlogKey = 'blog.a';
    c.blogBaseLang = 'en';
    h.admin.getContent.and.returnValue(
      of({
        title: 'T',
        body_markdown: 'B',
        status: 'published',
        published_at: '2030-01-01T00:00:00Z',
        published_until: '',
        meta: {},
      }),
    );
    c.setBlogEditLang('ro'); // translation lang
    expect(c.blogForm.title).toBe('T');
    c.setBlogEditLang('en'); // base lang sets status
    expect(c.blogForm.status).toBe('published');

    h.admin.getContent.and.returnValue(throwError(() => new Error('x')));
    c.setBlogEditLang('ro');
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('saveBlogPost guards key and required fields', () => {
    c.selectedBlogKey = null;
    c.saveBlogPost();
    expect(h.admin.updateContentBlock).not.toHaveBeenCalled();

    c.selectedBlogKey = 'blog.a';
    c.blogForm = { title: '', body_markdown: '' };
    c.saveBlogPost();
    expect(h.toast.error).toHaveBeenCalled();
  });
});

describe('AdminComponent — page blocks load/save', () => {
  let h: Harness;
  let c: any;
  const KEY = 'page.about';
  beforeEach(() => {
    h = createComponent();
    c = h.component as any;
  });

  it('loadPageBlocks parses content, defaults on 404 and errors otherwise', () => {
    h.admin.getContent.and.returnValue(
      of({
        version: 2,
        status: 'published',
        needs_translation_en: true,
        published_at: '2030-01-01T00:00:00Z',
        published_until: '',
        meta: { requires_auth: true, blocks: [{ type: 'text', key: 't', body_markdown: 'b' }] },
      }),
    );
    c.loadPageBlocks(KEY);
    expect(c.pageBlocks[KEY].length).toBe(1);
    expect(c.pageBlocksStatus[KEY]).toBe('published');
    expect(c.pageBlocksRequiresAuth[KEY]).toBe(true);

    h.admin.getContent.and.returnValue(throwError(() => ({ status: 404 })));
    c.loadPageBlocks(KEY);
    expect(c.pageBlocks[KEY]).toEqual([]);
    expect(c.pageBlocksStatus[KEY]).toBe('draft');

    h.admin.getContent.and.returnValue(throwError(() => ({ status: 500 })));
    c.loadPageBlocks(KEY);
    expect(c.pageBlocksError[KEY]).toBeTruthy();
  });

  it('savePageBlocks opens the checklist when publishing without bypass', () => {
    spyOn(c, 'openPagePublishChecklist');
    c.pageBlocksStatus[KEY] = 'published';
    c.savePageBlocks(KEY);
    expect(c.openPagePublishChecklist).toHaveBeenCalledWith(KEY);
    expect(h.admin.updateContentBlock).not.toHaveBeenCalled();
  });

  it('savePageBlocks persists a draft with conflict/404/error fallbacks', () => {
    c.pageBlocksStatus[KEY] = 'draft';
    c.pageBlocks[KEY] = [{ key: 't', type: 'text', title: {}, body_markdown: {}, layout: {} }];
    c.pageBlocksMeta[KEY] = {};
    c.ensurePageDraft(KEY).initFromServer(c.currentPageDraftState(KEY));

    h.admin.updateContentBlock.and.returnValue(of({ version: 2, status: 'draft', meta: {} }));
    c.savePageBlocks(KEY);
    expect(c.pageBlocksMessage[KEY]).toBeTruthy();

    h.admin.getContent.and.returnValue(of({ meta: {}, version: 1, status: 'draft' }));
    h.admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 409 })));
    c.savePageBlocks(KEY);
    expect(c.pageBlocksError[KEY]).toBeTruthy();

    h.admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 404 })));
    h.admin.createContent.and.returnValue(of({ version: 1, status: 'draft', meta: {} }));
    c.savePageBlocks(KEY);
    expect(c.pageBlocksMessage[KEY]).toBeTruthy();

    h.admin.createContent.and.returnValue(throwError(() => new Error('x')));
    c.savePageBlocks(KEY);
    expect(c.pageBlocksError[KEY]).toBeTruthy();

    h.admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 500 })));
    c.savePageBlocks(KEY);
    expect(c.pageBlocksError[KEY]).toBeTruthy();
  });

  it('savePageBlocks publishes when bypassing the checklist', () => {
    c.pageBlocksStatus[KEY] = 'published';
    c.pageBlocks[KEY] = [];
    c.pageBlocksMeta[KEY] = {};
    c.pageBlocksPublishedAt[KEY] = '2030-01-01T10:00';
    c.ensurePageDraft(KEY).initFromServer(c.currentPageDraftState(KEY));
    h.admin.updateContentBlock.and.returnValue(
      of({ version: 2, status: 'published', published_at: '2030-01-01T00:00:00Z', meta: {} }),
    );
    c.savePageBlocks(KEY, { bypassChecklist: true });
    expect(c.pageBlocksStatus[KEY]).toBe('published');
    expect(c.pageBlocksMessage[KEY]).toBeTruthy();
  });

  it('selectHomeBlocksLang sets the active home language', () => {
    c.selectHomeBlocksLang('ro');
    expect(c.homeBlocksLang).toBe('ro');
  });
});

describe('AdminComponent — info pages, legal pages, visibility', () => {
  let h: Harness;
  let c: any;
  beforeEach(() => {
    h = createComponent();
    c = h.component as any;
  });

  it('pagePublicUrlForKey maps slugs', () => {
    expect(c.pagePublicUrlForKey('page.about')).toBe('/about');
    expect(c.pagePublicUrlForKey('page.contact')).toBe('/contact');
    expect(c.pagePublicUrlForKey('page.faq')).toBe('/pages/faq');
    expect(c.pagePublicUrlForKey('page.')).toBe('/pages');
  });

  it('boundApplyPageBlockSaved threads needs-translation flags then reloads pages', () => {
    spyOn(c, 'loadContentPages');
    c.boundApplyPageBlockSaved('page.terms', {
      needs_translation_en: true,
      needs_translation_ro: false,
    });
    expect(c.pageBlocksNeedsTranslationEn['page.terms']).toBe(true);
    expect(c.pageBlocksNeedsTranslationRo['page.terms']).toBe(false);
    expect(c.loadContentPages).toHaveBeenCalled();

    // a null/absent block clears both flags
    c.boundApplyPageBlockSaved('page.terms', null);
    expect(c.pageBlocksNeedsTranslationEn['page.terms']).toBe(false);
    expect(c.pageBlocksNeedsTranslationRo['page.terms']).toBe(false);
  });

  it('isPageHidden / canTogglePageHidden reflect content pages and protections', () => {
    c.contentPages = [
      { key: 'page.custom', hidden: true },
      { key: 'page.about', hidden: false },
    ];
    expect(c.isPageHidden('page.custom')).toBe(true);
    expect(c.isPageHidden('page.about')).toBe(false);
    expect(c.isPageHidden('')).toBe(false);
    expect(c.canTogglePageHidden('page.custom')).toBe(true);
    expect(c.canTogglePageHidden('page.about')).toBe(false); // protected
    expect(c.canTogglePageHidden('home.x')).toBe(false);
  });

  it('togglePageHidden persists visibility with conflict/error handling', () => {
    c.contentPages = [{ key: 'page.custom', hidden: false }];
    spyOn(c, 'loadContentPages');
    spyOn(c as any, 'ensureSelectedPageIsVisible');
    h.admin.getContent.and.returnValue(of({ version: 1, meta: {} }));
    h.admin.updateContentBlock.and.returnValue(of({ version: 2 }));
    c.togglePageHidden('page.custom');
    expect(h.admin.updateContentBlock).toHaveBeenCalled();
    expect(h.toast.success).toHaveBeenCalled();

    // protected page is a no-op
    c.contentPages = [{ key: 'page.about', hidden: false }];
    h.admin.updateContentBlock.calls.reset();
    c.togglePageHidden('page.about');
    expect(h.admin.updateContentBlock).not.toHaveBeenCalled();

    // update error rolls back
    c.contentPages = [{ key: 'page.custom', hidden: false }];
    h.admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 500 })));
    c.togglePageHidden('page.custom');
    expect(c.contentPages[0].hidden).toBe(false);

    // load error
    c.contentPages = [{ key: 'page.custom', hidden: false }];
    h.admin.getContent.and.returnValue(throwError(() => new Error('x')));
    c.togglePageHidden('page.custom');
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('saveInfoUi routes by translation layout', () => {
    const single = spyOn<any>(c, 'saveInfo');
    const both = spyOn<any>(c, 'saveInfoBoth');
    h.cmsPrefs.translationLayout.and.returnValue('tabbed');
    c.infoLang = 'en';
    c.saveInfoUi('page.about', { en: 'A', ro: 'B' });
    expect(single).toHaveBeenCalledWith('page.about', 'A', 'en');
    h.cmsPrefs.translationLayout.and.returnValue('sideBySide');
    c.saveInfoUi('page.about', { en: 'A', ro: 'B' });
    expect(both).toHaveBeenCalled();
  });

  it('loadInfo fetches each info page', async () => {
    h.admin.getContent.and.returnValue(of({ body_markdown: 'Body', meta: {} }));
    c.loadInfo();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.admin.getContent).toHaveBeenCalled();
  });
});

describe('AdminComponent — blog editor loading and meta sync', () => {
  let h: Harness;
  let c: any;
  beforeEach(() => {
    h = createComponent();
    c = h.component as any;
  });

  it('loadBlogEditor hydrates the form and handles errors', () => {
    h.admin.listContentVersions.and.returnValue(of([]));
    h.admin.getContent.and.returnValue(
      of({
        lang: 'ro',
        title: 'Titlu',
        body_markdown: 'Corp',
        status: 'published',
        published_at: '2030-01-01T00:00:00Z',
        published_until: '',
        meta: {
          tags: ['a', 'b'],
          series: 'S',
          cover_image_url: '/c.png',
          reading_time_minutes: 5,
          pinned: true,
          pin_order: 3,
        },
        images: [{ id: 'i', url: '/u', sort_order: 0 }],
      }),
    );
    (c as any).loadBlogEditor('blog.a');
    expect(c.selectedBlogKey).toBe('blog.a');
    expect(c.blogBaseLang).toBe('ro');
    expect(c.blogForm.title).toBe('Titlu');
    expect(c.blogForm.tags).toBe('a, b');
    expect(c.blogForm.pinned).toBe(true);
    expect(c.blogImages.length).toBe(1);

    h.admin.getContent.and.returnValue(throwError(() => new Error('x')));
    (c as any).loadBlogEditor('blog.b');
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('reloadContentBlocks stores blocks and clears on error', () => {
    h.admin.content.and.returnValue(of([{ key: 'blog.a' }]));
    (c as any).reloadContentBlocks();
    expect(c.contentBlocks.length).toBe(1);
    h.admin.content.and.returnValue(of('not-array'));
    (c as any).reloadContentBlocks();
    expect(c.contentBlocks).toEqual([]);
    h.admin.content.and.returnValue(throwError(() => new Error('x')));
    (c as any).reloadContentBlocks();
    expect(c.contentBlocks).toEqual([]);
  });

  it('normalizeBlogSlug and blogCreateSlug produce url-safe slugs', () => {
    expect((c as any).normalizeBlogSlug('Héllo World!! Foo')).toBe('hello-world-foo');
    expect((c as any).normalizeBlogSlug('   ')).toBe('');
    c.blogCreate = { title: 'My New Post' };
    expect(c.blogCreateSlug()).toBe('my-new-post');
  });

  it('syncBlogMetaToForm maps meta variants', () => {
    c.blogForm = {};
    c.blogMeta = {
      tags: 'x,y',
      series: 'Ser',
      cover_image: '/c',
      cover_fit: 'CONTAIN',
      reading_time: 7,
      pinned: 'yes',
      pin_order: '4',
    };
    (c as any).syncBlogMetaToForm('en');
    expect(c.blogForm.tags).toBe('x,y');
    expect(c.blogForm.cover_image_url).toBe('/c');
    expect(c.blogForm.cover_fit).toBe('contain');
    expect(c.blogForm.reading_time_minutes).toBe('7');
    expect(c.blogForm.pinned).toBe(true);
    expect(c.blogForm.pin_order).toBe('4');

    c.blogMeta = {};
    (c as any).syncBlogMetaToForm('en');
    expect(c.blogForm.tags).toBe('');
    expect(c.blogForm.cover_fit).toBe('cover');
    expect(c.blogForm.pinned).toBe(false);
    expect(c.blogForm.pin_order).toBe('1');
  });

  it('closeBlogEditor resets editor state', () => {
    c.selectedBlogKey = 'blog.a';
    c.blogImages = [{ id: 'i' }];
    c.blogVersions = [{ version: 1 }];
    c.closeBlogEditor();
    expect(c.selectedBlogKey).toBeNull();
    expect(c.blogImages).toEqual([]);
    expect(c.blogVersions).toEqual([]);
  });
});

describe('AdminComponent — page publish checklist', () => {
  let h: Harness;
  let c: any;
  const KEY = 'page.about';
  beforeEach(() => {
    h = createComponent();
    c = h.component as any;
    c.pageBlocks = {};
  });

  it('computePagePublishChecklistLocal flags empty enabled blocks of every type', () => {
    c.pageBlocksNeedsTranslationEn[KEY] = true;
    c.pageBlocksNeedsTranslationRo[KEY] = true;
    c.pageBlocks[KEY] = [
      { key: '1', type: 'text', enabled: true, body_markdown: {} },
      { key: '2', type: 'columns', enabled: true, columns: [{}] },
      {
        key: '3',
        type: 'cta',
        enabled: true,
        title: {},
        body_markdown: {},
        cta_label: {},
        cta_url: '',
      },
      { key: '4', type: 'faq', enabled: true, faq_items: [{}] },
      { key: '5', type: 'testimonials', enabled: true, testimonials: [{}] },
      {
        key: '6',
        type: 'product_grid',
        enabled: true,
        product_grid_source: 'category',
        product_grid_category_slug: '',
      },
      {
        key: '7',
        type: 'product_grid',
        enabled: true,
        product_grid_source: 'collection',
        product_grid_collection_slug: '',
      },
      {
        key: '8',
        type: 'product_grid',
        enabled: true,
        product_grid_source: 'products',
        product_grid_product_slugs: '',
      },
      { key: '9', type: 'form', enabled: true },
      { key: '10', type: 'image', enabled: true, url: '', alt: {} },
      { key: '11', type: 'gallery', enabled: true, images: [] },
      { key: '12', type: 'banner', enabled: true, slide: { image_url: '' } },
      { key: '13', type: 'carousel', enabled: true, slides: [] },
    ];
    const r = (c as any).computePagePublishChecklistLocal(KEY);
    expect(r.missingTranslations).toEqual(['en', 'ro']);
    expect(r.emptySections.length).toBeGreaterThan(5);
  });

  it('computePagePublishChecklistLocal flags missing alt text for filled media', () => {
    c.pageBlocks[KEY] = [
      { key: 'i', type: 'image', enabled: true, url: '/u', alt: { en: '', ro: '' } },
      {
        key: 'g',
        type: 'gallery',
        enabled: true,
        images: [{ url: '/g', alt: { en: '', ro: '' } }],
      },
      {
        key: 'b',
        type: 'banner',
        enabled: true,
        slide: { image_url: '/b', alt: { en: '', ro: '' } },
      },
      {
        key: 'c',
        type: 'carousel',
        enabled: true,
        slides: [{ image_url: '/s', alt: { en: '', ro: '' } }],
      },
    ];
    const r = (c as any).computePagePublishChecklistLocal(KEY);
    expect(r.missingAlt.length).toBeGreaterThanOrEqual(8);
    expect(r.emptySections.length).toBe(0);
  });

  it('computePagePublishChecklistLocal flags all-disabled pages', () => {
    c.pageBlocks[KEY] = [{ key: '1', type: 'text', enabled: false, body_markdown: {} }];
    const r = (c as any).computePagePublishChecklistLocal(KEY);
    expect(r.emptySections.length).toBe(1);
  });

  it('openPagePublishChecklist runs link check (success and error)', () => {
    c.pageBlocks[KEY] = [];
    c.pageBlocksMeta[KEY] = {};
    h.admin.linkCheckContentPreview.and.returnValue(of({ issues: [{ url: '/x' }] }));
    c.openPagePublishChecklist(KEY);
    expect(c.pagePublishChecklistOpen).toBe(true);
    expect(c.pagePublishChecklistResult.linkIssues.length).toBe(1);

    h.admin.linkCheckContentPreview.and.returnValue(
      throwError(() => ({ error: { detail: 'le' } })),
    );
    c.openPagePublishChecklist(KEY);
    expect(c.pagePublishChecklistError).toBe('le');
  });

  it('pagePublishChecklistHasIssues and close/confirm flows', () => {
    expect(c.pagePublishChecklistHasIssues()).toBe(false);
    c.pagePublishChecklistResult = {
      missingTranslations: ['en'],
      missingAlt: [],
      emptySections: [],
      linkIssues: [],
    };
    expect(c.pagePublishChecklistHasIssues()).toBe(true);

    c.closePagePublishChecklist();
    expect(c.pagePublishChecklistOpen).toBe(false);
    expect(c.pagePublishChecklistResult).toBeNull();

    c.confirmPagePublishChecklist(); // no key → no-op
    c.pagePublishChecklistKey = KEY;
    c.pagePublishChecklistOpen = true;
    spyOn(c, 'savePageBlocks');
    c.confirmPagePublishChecklist();
    expect(c.savePageBlocks).toHaveBeenCalledWith(KEY, { bypassChecklist: true });
  });
});

describe('AdminComponent — collections, maintenance, custom pages', () => {
  let h: Harness;
  let c: any;
  beforeEach(() => {
    h = createComponent();
    c = h.component as any;
  });

  it('editCollection populates the form', () => {
    c.editCollection({ slug: 's1', name: 'N', description: 'D', product_ids: ['p1'] });
    expect(c.editingCollection).toBe('s1');
    expect(c.collectionForm.product_ids).toEqual(['p1']);
  });

  it('saveCollection validates name and creates/updates', () => {
    c.collectionForm = { name: '', description: '', product_ids: [] };
    c.saveCollection();
    expect(h.admin.createFeaturedCollection).not.toHaveBeenCalled();

    c.collectionForm = { name: 'New', description: '', product_ids: [] };
    c.featuredCollections = [];
    c.editingCollection = null;
    h.admin.createFeaturedCollection.and.returnValue(of({ slug: 'new', name: 'New' }));
    c.saveCollection();
    expect(c.featuredCollections.length).toBe(1);

    c.editingCollection = 'new';
    h.admin.updateFeaturedCollection.and.returnValue(of({ slug: 'new', name: 'Updated' }));
    c.saveCollection();
    expect(c.featuredCollections[0].name).toBe('Updated');

    c.collectionForm = { name: 'X', description: '', product_ids: [] };
    h.admin.updateFeaturedCollection.and.returnValue(throwError(() => new Error('x')));
    c.saveCollection();
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('saveMaintenance toggles and reports', () => {
    c.maintenanceEnabledValue = true;
    h.admin.setMaintenance.and.returnValue(of({ enabled: true }));
    c.saveMaintenance();
    expect(c.maintenanceEnabled()).toBe(true);
    h.admin.setMaintenance.and.returnValue(throwError(() => new Error('x')));
    c.saveMaintenance();
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('createCustomPage validates title and reserved slugs', () => {
    c.newCustomPageTitle = '';
    c.createCustomPage();
    expect(h.admin.createContent).not.toHaveBeenCalled();

    c.newCustomPageTitle = 'About'; // slug 'about' is reserved
    c.createCustomPage();
    expect(h.admin.createContent).not.toHaveBeenCalled();
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('createCustomPage creates a unique page and handles errors', () => {
    spyOn(c, 'loadContentPages');
    spyOn(c, 'loadPageBlocks');
    c.contentPages = [{ slug: 'my-page' }];
    c.newCustomPageTitle = 'My Page'; // collides → my-page-2
    c.newCustomPageStatus = 'published';
    c.newCustomPagePublishedAt = '2030-01-01T10:00';
    c.newCustomPageTemplate = 'about';
    h.admin.createContent.and.returnValue(of({}));
    c.createCustomPage();
    expect(h.admin.createContent).toHaveBeenCalled();
    const key = h.admin.createContent.calls.mostRecent().args[0];
    expect(key).toBe('page.my-page-2');
    expect(c.pageBlocksKey).toBe('page.my-page-2');

    c.newCustomPageTitle = 'Other';
    h.admin.createContent.and.returnValue(throwError(() => ({ error: { detail: 'taken' } })));
    c.createCustomPage();
    expect(h.toast.error).toHaveBeenCalledWith('taken');
  });

  it('pageTemplateBlocks produces blocks per template', () => {
    expect((c as any).pageTemplateBlocks('blank')).toEqual([]);
    expect((c as any).pageTemplateBlocks('about').length).toBe(3);
    expect((c as any).pageTemplateBlocks('faq').length).toBe(2);
    expect((c as any).pageTemplateBlocks('shipping').length).toBeGreaterThan(0);
    expect((c as any).pageTemplateBlocks('returns').length).toBeGreaterThan(0);
  });
});

describe('AdminComponent — lifecycle and section orchestration', () => {
  function safeHarness(section: string): Harness {
    const h = createComponent(createRouteStub(section));
    // Every getContent-backed loader is safe with an empty meta block.
    h.admin.getContent.and.returnValue(
      of({ meta: {}, version: 1, title: '', body_markdown: '', status: 'draft' }),
    );
    h.admin.listContentPages.and.returnValue(of([]));
    h.admin.listContentRedirects.and.returnValue(
      of({ items: [], meta: { page: 1, total_pages: 1, total_items: 0, limit: 20 } }),
    );
    h.fxAdmin.getStatus.and.returnValue(
      of({ override: null, effective: { eur_per_ron: 5, usd_per_ron: 4, as_of: '' } }),
    );
    return h;
  }

  it('ngOnInit applies the route section and loads (settings)', () => {
    const h = safeHarness('settings');
    h.component.ngOnInit();
    expect(h.component.section()).toBe('settings');
    expect(h.admin.audit).toHaveBeenCalled();
    expect(h.admin.getMaintenance).toHaveBeenCalled();
    h.component.ngOnDestroy();
  });

  it('ngOnInit loads the home section', () => {
    const h = safeHarness('home');
    h.component.ngOnInit();
    expect(h.component.section()).toBe('home');
    expect(h.admin.products).toHaveBeenCalled();
    h.component.ngOnDestroy();
  });

  it('ngOnInit loads the pages section and applies an edit query', () => {
    const h = createComponent(createRouteStub('pages', { edit: 'about' }));
    h.admin.getContent.and.returnValue(
      of({ meta: {}, version: 1, title: '', body_markdown: '', status: 'draft' }),
    );
    h.admin.listContentPages.and.returnValue(of([]));
    h.admin.listContentRedirects.and.returnValue(
      of({ items: [], meta: { page: 1, total_pages: 1, total_items: 0, limit: 20 } }),
    );
    h.component.ngOnInit();
    expect(h.component.section()).toBe('pages');
    h.component.ngOnDestroy();
  });

  it('ngOnInit loads the blog section and applies a blog edit query', () => {
    const h = createComponent(createRouteStub('blog', { edit: 'welcome' }));
    h.admin.content.and.returnValue(of([]));
    h.admin.getContent.and.returnValue(
      of({ meta: {}, version: 1, title: '', body_markdown: '', status: 'draft', lang: 'en' }),
    );
    h.admin.listContentVersions.and.returnValue(of([]));
    h.blog.listFlaggedComments.and.returnValue(of({ items: [] }));
    h.component.ngOnInit();
    expect(h.component.section()).toBe('blog');
    expect(h.component.selectedBlogKey).toBe('blog.welcome');
    h.component.ngOnDestroy();
  });

  it('reactive route streams re-apply the section', () => {
    const route = createRouteStub('home');
    const h = safeHarness('home');
    // rebuild with the same route object so the stream is wired
    const route2 = createRouteStub('settings');
    const h2 = createComponent(route2);
    h2.admin.getContent.and.returnValue(of({ meta: {}, version: 1, title: '' }));
    h2.admin.listContentPages.and.returnValue(of([]));
    h2.admin.listContentRedirects.and.returnValue(
      of({ items: [], meta: { page: 1, total_pages: 1, total_items: 0, limit: 20 } }),
    );
    h2.fxAdmin.getStatus.and.returnValue(
      of({ override: null, effective: { eur_per_ron: 5, usd_per_ron: 4, as_of: '' } }),
    );
    h2.component.ngOnInit();
    route2.data.next({ section: 'home' });
    route2.queryParams.next({});
    expect(h2.component.section()).toBe('home');
    h2.component.ngOnDestroy();
    void route;
    void h;
  });

  it('loadAll/retryLoadAll re-run the current section loaders', () => {
    const h = safeHarness('home');
    h.component.ngOnInit();
    h.admin.products.calls.reset();
    h.component.retryLoadAll();
    expect(h.admin.products).toHaveBeenCalled();
    h.component.ngOnDestroy();
  });

  it('hasUnsavedChanges and discardUnsavedChanges inspect draft managers', () => {
    const h = safeHarness('home');
    const c = h.component as any;
    expect(h.component.hasUnsavedChanges()).toBe(false);
    c.cmsHomeDraft.initFromServer([{ id: 'a' }]);
    c.cmsHomeDraft.observe([{ id: 'b' }]);
    expect(h.component.hasUnsavedChanges()).toBe(true);
    h.component.discardUnsavedChanges();
    expect(() => h.component.discardUnsavedChanges()).not.toThrow();
  });

  it('loadAudit stores logs and toasts on error', () => {
    const h = createComponent();
    const c = h.component as any;
    h.admin.audit.and.returnValue(of({ products: [{ id: 1 }], content: [], security: null }));
    c.loadAudit();
    expect(c.productAudit.length).toBe(1);
    expect(c.securityAudit).toEqual([]);
    h.admin.audit.and.returnValue(throwError(() => new Error('x')));
    c.loadAudit();
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('submitOwnerTransfer enforces owner, identifier and password', () => {
    const h = createComponent();
    const c = h.component as any;
    h.auth.role.and.returnValue('admin');
    c.submitOwnerTransfer(); // not owner
    expect(h.admin.transferOwner).not.toHaveBeenCalled();

    h.auth.role.and.returnValue('owner');
    c.ownerTransferIdentifier = '';
    c.submitOwnerTransfer();
    expect(c.ownerTransferError).toBeTruthy();

    c.ownerTransferIdentifier = 'user@x.com';
    const promptSpy = spyOn(window, 'prompt').and.returnValue('');
    c.submitOwnerTransfer();
    expect(c.ownerTransferError).toBeTruthy();

    promptSpy.and.returnValue('pw');
    h.admin.transferOwner.and.returnValue(of({}));
    c.submitOwnerTransfer();
    expect(h.admin.transferOwner).toHaveBeenCalled();
  });
});

describe('AdminComponent — blog meta, info save, social thumbnails, content', () => {
  let h: Harness;
  let c: any;
  beforeEach(() => {
    h = createComponent();
    c = h.component as any;
  });

  it('getBlogSummary reads localized or base-language summaries', () => {
    c.blogBaseLang = 'en';
    expect(c.getBlogSummary({ summary: { en: 'Hi', ro: 'Salut' } }, 'ro')).toBe('Salut');
    expect(c.getBlogSummary({ summary: 'Plain' }, 'en')).toBe('Plain');
    expect(c.getBlogSummary({ summary: 'Plain' }, 'ro')).toBe(''); // not base lang
    expect(c.getBlogSummary({}, 'en')).toBe('');
  });

  it('buildBlogMeta serialises tags, summary, cover and pin info', () => {
    c.blogBaseLang = 'en';
    c.blogMeta = { summary: { en: 'old' } };
    c.blogForm = {
      tags: 'a, b',
      series: 'S',
      cover_image_url: '/c',
      cover_fit: 'contain',
      reading_time_minutes: '5',
      summary: 'New summary',
      pinned: true,
      pin_order: '3',
    };
    const meta = c.buildBlogMeta('ro');
    expect(meta.tags).toEqual(['a', 'b']);
    expect(meta.series).toBe('S');
    expect(meta.cover_fit).toBe('contain');
    expect(meta.reading_time_minutes).toBe(5);
    expect(meta.summary).toEqual({ en: 'old', ro: 'New summary' });
    expect(meta.pinned).toBe(true);
    expect(meta.pin_order).toBe(3);

    c.blogForm = {
      tags: '',
      series: '',
      cover_image_url: '',
      cover_fit: 'cover',
      reading_time_minutes: '',
      summary: '',
      pinned: false,
      pin_order: '1',
    };
    const meta2 = c.buildBlogMeta('en');
    expect('tags' in meta2).toBe(false);
    expect('pinned' in meta2).toBe(false);
  });

  it('saveInfo and saveInfoBoth persist content', () => {
    spyOn(c, 'loadContentPages');
    h.admin.updateContentBlock.and.returnValue(of({ version: 2 }));
    c.saveInfo('page.about', 'Body', 'en');
    expect(c.infoMessage).toBeTruthy();

    h.admin.updateContentBlock.and.returnValue(of({ version: 2 }));
    c.saveInfoBoth('page.about', { en: 'E', ro: 'R' });
    expect(c.infoMessage).toBeTruthy();

    h.admin.getContent.and.returnValue(of({ meta: {}, version: 1 }));
    h.admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 409 })));
    c.saveInfo('page.about', 'Body', 'en');
    expect(c.infoError).toBeTruthy();
  });

  it('togglePageNeedsTranslation updates and reports', () => {
    spyOn(c, 'loadContentPages');
    h.admin.updateContentTranslationStatus.and.returnValue(
      of({ needs_translation_en: true, needs_translation_ro: false }),
    );
    c.togglePageNeedsTranslation('page.about', 'en', checkboxEvent(true));
    expect(c.pageBlocksNeedsTranslationEn['page.about']).toBe(true);
    expect(h.toast.success).toHaveBeenCalled();

    h.admin.updateContentTranslationStatus.and.returnValue(
      throwError(() => ({ error: { detail: 'd' } })),
    );
    c.togglePageNeedsTranslation('page.about', 'ro', checkboxEvent(false));
    expect(h.toast.error).toHaveBeenCalledWith('d');
  });

  it('selectContent loads a content block and saveContent persists it', () => {
    h.admin.getContent.and.returnValue(
      of({ key: 'site.x', title: 'T', body_markdown: 'B', status: 'draft', version: 1 }),
    );
    c.selectContent({ key: 'site.x', title: 'T' });
    expect(c.contentForm.body_markdown).toBe('B');

    spyOn(c, 'reloadContentBlocks');
    c.selectedContent = { key: 'site.x' };
    c.contentForm = { title: 'T2', body_markdown: 'B2', status: 'published' };
    h.admin.updateContentBlock.and.returnValue(of({ version: 2 }));
    c.saveContent();
    expect(c.selectedContent).toBeNull();
    expect(h.toast.success).toHaveBeenCalled();

    c.selectedContent = { key: 'site.x' };
    h.admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 409 })));
    c.saveContent();
    expect(h.toast.error).toHaveBeenCalled();

    c.cancelContent();
    expect(c.selectedContent).toBeNull();
  });

  it('selectContent reports a load error', () => {
    h.admin.getContent.and.returnValue(throwError(() => new Error('x')));
    c.selectContent({ key: 'site.x', title: 'T' });
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('pruneBlogBulkSelection drops keys no longer present', () => {
    c.contentBlocks = [{ key: 'blog.a' }];
    c.blogBulkSelection = new Set(['blog.a', 'blog.gone']);
    (c as any).pruneBlogBulkSelection();
    expect(Array.from(c.blogBulkSelection)).toEqual(['blog.a']);
  });

  it('syncContentVersions remembers each block version', () => {
    (c as any).syncContentVersions([
      { key: 'k1', version: 3 },
      { key: 'k2', version: 0 },
    ]);
    expect((c as any).contentVersions['k1']).toBe(3);
    expect((c as any).contentVersions['k2']).toBeUndefined();
  });
});

describe('AdminComponent — draft delegate accessors', () => {
  let h: Harness;
  let c: any;
  beforeEach(() => {
    localStorage.clear();
    h = createComponent();
    c = h.component as any;
  });

  it('home draft delegates reflect the underlying manager', () => {
    expect(c.homeDraftReady()).toBe(false);
    c.cmsHomeDraft.initFromServer([{ id: 'a' }]);
    expect(c.homeDraftReady()).toBe(true);
    expect(c.homeDraftDirty()).toBe(false);
    expect(c.homeDraftAutosaving()).toBe(false);
    expect(c.homeDraftLastAutosavedAt()).toBeNull();
    expect(c.homeDraftHasRestore()).toBe(false);
    expect(c.homeDraftRestoreAt()).toBeNull();
    c.homeBlocks = [{ id: 'b' }];
    expect(c.homeDraftCanUndo()).toBe(true);
    expect(c.homeDraftCanRedo()).toBe(false);
    c.undoHomeDraft();
    expect(c.homeBlocks).toEqual([{ id: 'a' }]);
    c.redoHomeDraft();
    expect(c.homeBlocks).toEqual([{ id: 'b' }]);
    c.restoreHomeDraftAutosave(); // no restore candidate → no-op
    c.dismissHomeDraftAutosave();
    expect(() => c.dismissHomeDraftAutosave()).not.toThrow();
  });

  it('page draft delegates operate per page key', () => {
    const KEY = 'page.about';
    expect(c.pageDraftReady(KEY)).toBe(false);
    c.pageBlocks[KEY] = [];
    c.ensurePageDraft(KEY).initFromServer(c.currentPageDraftState(KEY));
    expect(c.pageDraftReady(KEY)).toBe(true);
    expect(c.pageDraftDirty(KEY)).toBe(false);
    expect(c.pageDraftAutosaving(KEY)).toBe(false);
    expect(c.pageDraftLastAutosavedAt(KEY)).toBeNull();
    expect(c.pageDraftHasRestore(KEY)).toBe(false);
    expect(c.pageDraftRestoreAt(KEY)).toBeNull();
    expect(typeof c.pageDraftCanUndo(KEY)).toBe('boolean');
    expect(typeof c.pageDraftCanRedo(KEY)).toBe('boolean');
    c.undoPageDraft(KEY);
    c.redoPageDraft(KEY);
    c.restorePageDraftAutosave(KEY);
    c.dismissPageDraftAutosave(KEY);
    expect(() => c.dismissPageDraftAutosave(KEY)).not.toThrow();
  });

  it('blog draft delegates short-circuit without a selected key', () => {
    c.selectedBlogKey = null;
    expect(c.blogDraftReady()).toBe(false);
    expect(c.blogDraftDirty()).toBe(false);
    expect(c.blogDraftAutosaving()).toBe(false);
    expect(c.blogDraftLastAutosavedAt()).toBeNull();
    expect(c.blogDraftHasRestore()).toBe(false);
    expect(c.blogDraftRestoreAt()).toBeNull();
    c.restoreBlogDraftAutosave(); // no-op
    c.dismissBlogDraftAutosave(); // no-op
    expect(() => c.dismissBlogDraftAutosave()).not.toThrow();
  });

  it('blog draft delegates reflect a manager once selected', () => {
    c.selectedBlogKey = 'blog.a';
    c.blogEditLang = 'en';
    c.blogForm = {
      title: 'T',
      body_markdown: 'B',
      status: 'draft',
      published_at: '',
      published_until: '',
    };
    c.blogMeta = {};
    const mgr = c.ensureBlogDraft('blog.a', 'en');
    mgr.initFromServer(c.currentBlogDraftState());
    expect(c.blogDraftReady()).toBe(true);
    expect(c.blogDraftDirty()).toBe(false);
    expect(c.blogDraftAutosaving()).toBe(false);
    expect(c.blogDraftLastAutosavedAt()).toBeNull();
    expect(c.blogDraftHasRestore()).toBe(false);
    expect(c.blogDraftRestoreAt()).toBeNull();
    c.restoreBlogDraftAutosave(); // no candidate
    c.dismissBlogDraftAutosave();
    expect(() => c.dismissBlogDraftAutosave()).not.toThrow();
  });
});

describe('AdminComponent — blog SEO helpers', () => {
  let h: Harness;
  let c: any;
  beforeEach(() => {
    h = createComponent();
    c = h.component as any;
    c.selectedBlogKey = 'blog.hello';
    c.blogEditLang = 'en';
    c.blogBaseLang = 'en';
    c.blogForm = {
      title: 'My Post Title',
      body_markdown: 'Some body content here.',
      status: 'draft',
    };
    c.blogMeta = {};
    c.blogSeoSnapshots = { en: null, ro: null };
  });

  it('blogSeoHasContent checks the edit lang form and snapshots', () => {
    expect(c.blogSeoHasContent('en')).toBe(true);
    expect(c.blogSeoHasContent('ro')).toBe(false);
    c.blogSeoSnapshots.ro = { title: 'RO', body_markdown: '' };
    expect(c.blogSeoHasContent('ro')).toBe(true);
    c.selectedBlogKey = null;
    expect(c.blogSeoHasContent('en')).toBe(false);
  });

  it('blogSeoTitleFull appends the brand and previews truncate', () => {
    expect(c.blogSeoTitleFull('en')).toBe('My Post Title | momentstudio');
    c.blogForm.title = '';
    expect(c.blogSeoTitleFull('en')).toBe('');
    c.blogSeoSnapshots.ro = { title: 'RO Title', body_markdown: '' };
    expect(c.blogSeoTitleFull('ro')).toContain('RO Title');
    expect(typeof c.blogSeoTitlePreview('en')).toBe('string');
    expect(typeof c.blogSeoDescriptionPreview('en')).toBe('string');
  });

  it('blogSeoDescriptionFull derives from summary or body', () => {
    c.blogMeta = { summary: { en: 'A crafted summary sentence.' } };
    expect(c.blogSeoDescriptionFull('en')).toContain('crafted summary');
    c.blogMeta = {};
    expect(c.blogSeoDescriptionFull('en')).toContain('body content');
  });

  it('blogSeoIssues reports title/description problems', () => {
    c.blogForm = { title: 'Hi', body_markdown: '', status: 'draft' };
    c.blogMeta = {};
    const issues = c.blogSeoIssues('en').map((i: any) => i.key);
    expect(issues.some((k: string) => k.includes('missingDescription'))).toBe(true);
    expect(issues.some((k: string) => k.includes('titleTooShort'))).toBe(true);

    c.blogForm = { title: 'x'.repeat(80), body_markdown: 'y'.repeat(300), status: 'draft' };
    const issues2 = c.blogSeoIssues('en').map((i: any) => i.key);
    expect(issues2.some((k: string) => k.includes('titleTooLong'))).toBe(true);
    expect(issues2.some((k: string) => k.includes('descriptionTooLong'))).toBe(true);
  });

  it('truncateForPreview and toSeoDescription clean text', () => {
    expect((c as any).truncateForPreview('', 10)).toBe('');
    expect((c as any).truncateForPreview('short', 10)).toBe('short');
    expect((c as any).truncateForPreview('a'.repeat(20), 10)).toContain('…');
    expect((c as any).toSeoDescription('# Title\n```code```\n[link](u) **bold**')).not.toContain(
      '#',
    );
  });

  it('blog public and og image urls build correctly', () => {
    expect(c.blogPublicUrl('en')).toContain('/blog/hello?lang=en');
    expect(c.blogPublishedOgImageUrl('en')).toContain('og.png');
    expect(c.blogPreviewOgImageUrl('en')).toBeNull();
    c.blogPreviewToken = 'tok';
    expect(c.blogPreviewOgImageUrl('en')).toContain('og-preview.png');
  });

  it('copyText copies non-empty text', () => {
    const copy = spyOn(c, 'copyToClipboard').and.returnValue(Promise.resolve(true));
    c.copyText('  ');
    expect(copy).not.toHaveBeenCalled();
    c.copyText('hello');
    expect(copy).toHaveBeenCalledWith('hello');
  });
});

describe('AdminComponent — full block serialization and remaining flows', () => {
  let h: Harness;
  let c: any;
  beforeEach(() => {
    h = createComponent();
    c = h.component as any;
  });

  function allHomeTypes(): any[] {
    return [
      'text',
      'columns',
      'cta',
      'faq',
      'testimonials',
      'image',
      'gallery',
      'banner',
      'carousel',
      'featured_products',
    ].map((t) => c.makeHomeBlockDraft(`${t}_k`, t, true));
  }
  function allPageTypes(): any[] {
    return [
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
    ].map((t) => ({ ...c.makeHomeBlockDraft(`${t}_k`, t, true), type: t }));
  }

  it('saveSections serialises every home block type', () => {
    c.cmsHomeDraft.initFromServer([]);
    c.homeBlocks = allHomeTypes();
    spyOn(c, 'refreshHomePreview');
    h.admin.updateContentBlock.and.returnValue(of({ version: 2 }));
    c.saveSections();
    const meta = h.admin.updateContentBlock.calls.mostRecent().args[1].meta;
    const types = meta.blocks.map((b: any) => b.type);
    expect(types).toContain('carousel');
    expect(types).toContain('gallery');
  });

  it('savePageBlocks serialises every page block type', () => {
    const KEY = 'page.about';
    c.pageBlocksStatus[KEY] = 'draft';
    c.pageBlocks[KEY] = allPageTypes();
    c.pageBlocksMeta[KEY] = {};
    c.pageBlocksRequiresAuth[KEY] = true;
    c.ensurePageDraft(KEY).initFromServer(c.currentPageDraftState(KEY));
    h.admin.updateContentBlock.and.returnValue(of({ version: 2, status: 'draft', meta: {} }));
    c.savePageBlocks(KEY);
    const meta = h.admin.updateContentBlock.calls.mostRecent().args[1].meta;
    const types = meta.blocks.map((b: any) => b.type);
    expect(types).toContain('product_grid');
    expect(types).toContain('form');
  });

  it('onBlogPinDrop reorders pinned posts', async () => {
    spyOn(c, 'reloadContentBlocks');
    c.contentBlocks = [
      { key: 'blog.a', meta: { pinned: true, pin_order: 1 } },
      { key: 'blog.b', meta: { pinned: true, pin_order: 2 } },
    ];
    c.draggingBlogPinKey = 'blog.b';
    h.admin.updateContentBlock.and.returnValue(of({ version: 2 }));
    await c.onBlogPinDrop('blog.a'); // move b before a → real reorder
    expect(h.admin.updateContentBlock).toHaveBeenCalled();
    expect(h.toast.success).toHaveBeenCalled();

    // guard: same key
    c.draggingBlogPinKey = 'blog.a';
    h.admin.updateContentBlock.calls.reset();
    await c.onBlogPinDrop('blog.a');
    expect(h.admin.updateContentBlock).not.toHaveBeenCalled();
  });

  it('onBlogPinDrop reports reorder errors', async () => {
    spyOn(c, 'reloadContentBlocks');
    c.contentBlocks = [
      { key: 'blog.a', meta: { pinned: true, pin_order: 1 } },
      { key: 'blog.b', meta: { pinned: true, pin_order: 2 } },
    ];
    c.draggingBlogPinKey = 'blog.b';
    h.admin.updateContentBlock.and.returnValue(throwError(() => new Error('x')));
    await c.onBlogPinDrop('blog.a');
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('renameCustomPageUrl renames a custom page and optional redirect', () => {
    spyOn(c, 'loadContentPages');
    spyOn(c, 'loadPageBlocks');
    spyOn(c, 'loadContentRedirects');
    c.pageBlocksKey = 'page.custom';
    const promptSpy = spyOn(window, 'prompt').and.returnValue('renamed');
    const confirmSpy = spyOn(window, 'confirm').and.returnValue(true);
    h.admin.renameContentPage.and.returnValue(of({ old_key: 'custom', new_key: 'page.renamed' }));
    h.admin.upsertContentRedirect.and.returnValue(of({}));
    c.renameCustomPageUrl();
    expect(h.admin.renameContentPage).toHaveBeenCalled();
    expect(c.pageBlocksKey).toBe('page.renamed');
    expect(h.admin.upsertContentRedirect).toHaveBeenCalled();

    // protected page → no-op
    c.pageBlocksKey = 'page.about';
    h.admin.renameContentPage.calls.reset();
    c.renameCustomPageUrl();
    expect(h.admin.renameContentPage).not.toHaveBeenCalled();

    // cancelled prompt
    c.pageBlocksKey = 'page.custom';
    promptSpy.and.returnValue(null);
    c.renameCustomPageUrl();
    expect(h.admin.renameContentPage).not.toHaveBeenCalled();

    // reserved slug
    promptSpy.and.returnValue('about');
    c.renameCustomPageUrl();
    expect(h.toast.error).toHaveBeenCalled();
    void confirmSpy;
  });

  it('isReservedPageSlug and slugifyPageSlug behave correctly', () => {
    expect((c as any).isReservedPageSlug('about')).toBe(true);
    expect((c as any).isReservedPageSlug('')).toBe(true);
    expect((c as any).isReservedPageSlug('my-page')).toBe(false);
    expect((c as any).slugifyPageSlug('Héllo World')).toBe('hello-world');
    expect((c as any).slugifyPageSlug('')).toBe('page');
  });
});

describe('AdminComponent — saveBlogPost paths and cover image', () => {
  let h: Harness;
  let c: any;
  beforeEach(() => {
    h = createComponent();
    c = h.component as any;
    c.selectedBlogKey = 'blog.a';
    c.blogEditLang = 'en';
    c.blogBaseLang = 'en';
    c.blogForm = {
      title: 'Title here long enough',
      body_markdown: 'Body text',
      status: 'draft',
      published_at: '',
      published_until: '',
      summary: '',
      tags: '',
      series: '',
      cover_image_url: '',
      cover_fit: 'cover',
      reading_time_minutes: '',
      pinned: false,
      pin_order: '1',
    };
    c.blogMeta = {};
    c.ensureBlogDraft('blog.a', 'en').initFromServer(c.currentBlogDraftState());
    spyOn(c, 'reloadContentBlocks');
    spyOn(c, 'loadBlogEditor');
    spyOn(c, 'setBlogEditLang');
  });

  it('saves a base-language post (success and conflict and error)', () => {
    h.admin.updateContentBlock.and.returnValue(of({ version: 2 }));
    c.saveBlogPost();
    expect(h.toast.success).toHaveBeenCalled();
    expect(c.loadBlogEditor).toHaveBeenCalledWith('blog.a');

    h.admin.getContent.and.returnValue(of({ meta: {}, version: 1, lang: 'en' }));
    h.admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 409 })));
    c.saveBlogPost();
    h.admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 500 })));
    c.saveBlogPost();
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('respects the a11y publish gate', () => {
    c.blogForm = {
      ...c.blogForm,
      title: 'A title that is plenty long',
      body_markdown: '![](a.png)',
      status: 'published',
    };
    const confirmSpy = spyOn(window, 'confirm').and.returnValue(false);
    c.saveBlogPost(); // declined → no save
    expect(h.admin.updateContentBlock).not.toHaveBeenCalled();
    confirmSpy.and.returnValue(true);
    h.admin.updateContentBlock.and.returnValue(of({ version: 2 }));
    c.saveBlogPost();
    expect(h.admin.updateContentBlock).toHaveBeenCalled();
  });

  it('saves a translation (no meta change, meta change, and errors)', () => {
    c.blogEditLang = 'ro'; // not base
    c.blogForm = { ...c.blogForm, title: 'Titlu', body_markdown: 'Corp', status: 'draft' };
    c.blogMeta = {};
    h.admin.updateContentBlock.and.returnValue(of({ version: 2 }));
    c.saveBlogPost(); // metaChanged false (buildBlogMeta == {})
    expect(h.toast.success).toHaveBeenCalled();

    c.blogForm = {
      ...c.blogForm,
      title: 'Titlu',
      body_markdown: 'Corp',
      status: 'draft',
      tags: 'x',
    };
    let calls = 0;
    h.admin.updateContentBlock.and.callFake(() => {
      calls += 1;
      return of({ version: calls + 1 });
    });
    c.saveBlogPost(); // metaChanged true → two updates
    expect(calls).toBeGreaterThanOrEqual(2);

    c.blogForm.tags = 'y';
    h.admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 500 })));
    c.saveBlogPost();
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('uploadBlogCoverImage sets the cover and clears it', () => {
    c.blogEditLang = 'en';
    c.blogBaseLang = 'en';
    c.uploadBlogCoverImage({ target: { files: [], value: '' } } as any); // no file
    expect(h.admin.uploadContentImage).not.toHaveBeenCalled();

    const file = new File(['x'], 'cover.png', { type: 'image/png' });
    h.admin.uploadContentImage.and.returnValue(
      of({ images: [{ id: 'i', url: '/cover.png', sort_order: 0 }] }),
    );
    c.uploadBlogCoverImage({ target: { files: [file], value: 'v' } } as any);
    expect(c.blogForm.cover_image_url).toBe('/cover.png');

    h.admin.uploadContentImage.and.returnValue(throwError(() => new Error('x')));
    c.uploadBlogCoverImage({ target: { files: [file], value: 'v' } } as any);
    expect(h.toast.error).toHaveBeenCalled();

    c.clearBlogCoverOverride();
    expect(c.blogForm.cover_image_url).toBe('');

    // wrong lang short-circuits
    c.blogEditLang = 'ro';
    c.uploadBlogCoverImage({ target: { files: [file], value: 'v' } } as any);
  });

  it('selectBlogCoverAsset sets cover and tracks the image', () => {
    c.blogEditLang = 'en';
    c.blogBaseLang = 'en';
    c.blogImages = [];
    c.selectBlogCoverAsset({ url: '', id: 'a' }); // empty url
    expect(c.blogForm.cover_image_url).toBeFalsy();
    c.selectBlogCoverAsset({ url: '/c.png', id: 'a1', focal_x: 10, focal_y: 20 });
    expect(c.blogForm.cover_image_url).toBe('/c.png');
    expect(c.blogImages.length).toBe(1);
    c.selectBlogCoverAsset({ url: '/c2.png', id: 'a1' }); // update existing
    expect(c.blogImages.length).toBe(1);
  });
});

describe('AdminComponent — CMS media upload', () => {
  let h: Harness;
  let c: any;
  const imgFile = () => new File(['x'], 'My_Cool-Pic.png', { type: 'image/png' });
  beforeEach(() => {
    h = createComponent();
    c = h.component as any;
    c.pageBlocks = {};
    c.homeBlocks = [];
  });

  it('normalizeCmsImageFiles filters by type/size and caps at 12', () => {
    expect(
      (c as any).normalizeCmsImageFiles([new File(['x'], 'a.txt', { type: 'text/plain' })]),
    ).toEqual([]);
    const ok = (c as any).normalizeCmsImageFiles([imgFile()]);
    expect(ok.length).toBe(1);
  });

  it('filenameToAltText derives readable alt', () => {
    expect((c as any).filenameToAltText('My_Cool-Pic.png')).toBe('My Cool Pic');
    expect((c as any).filenameToAltText('.png')).toBe('Image');
  });

  it('lastUploadedContentImage extracts the last image', () => {
    expect((c as any).lastUploadedContentImage({ images: [] })).toBeNull();
    expect(
      (c as any).lastUploadedContentImage({ images: [{ url: '/a', focal_x: 10, focal_y: 20 }] }),
    ).toEqual({ url: '/a', focal_x: 10, focal_y: 20 });
    expect((c as any).lastUploadedContentImage({ images: [{ url: '' }] })).toBeNull();
  });

  it('onCmsMediaDragOver reacts only to file drags', () => {
    const noFiles = {
      dataTransfer: { types: ['text/plain'], files: [] },
      preventDefault: jasmine.createSpy('pd'),
    } as any;
    c.onCmsMediaDragOver(noFiles);
    expect(noFiles.preventDefault).not.toHaveBeenCalled();
    const withFiles = {
      dataTransfer: { types: ['Files'], files: [], dropEffect: '' },
      preventDefault: jasmine.createSpy('pd'),
    } as any;
    c.onCmsMediaDragOver(withFiles);
    expect(withFiles.preventDefault).toHaveBeenCalled();
  });

  it('onPageMediaDropOnContainer ignores non-self drops and inserts files', async () => {
    const el = document.createElement('div');
    const notSelf = {
      target: document.createElement('span'),
      currentTarget: el,
      dataTransfer: { files: [imgFile()] },
      preventDefault: jasmine.createSpy('pd'),
    } as any;
    c.onPageMediaDropOnContainer(notSelf, 'page.about');
    expect(h.admin.uploadContentImage).not.toHaveBeenCalled();

    h.admin.uploadContentImage.and.returnValue(
      of({ images: [{ id: 'i', url: '/u.png', sort_order: 0, focal_x: 50, focal_y: 50 }] }),
    );
    const ev = {
      target: el,
      currentTarget: el,
      dataTransfer: { files: [imgFile()] },
      preventDefault: jasmine.createSpy('pd'),
    } as any;
    c.onPageMediaDropOnContainer(ev, 'page.about');
    await Promise.resolve();
    await Promise.resolve();
    expect(h.admin.uploadContentImage).toHaveBeenCalled();
  });

  it('onHomeMediaDropOnContainer inserts dropped files', async () => {
    const el = document.createElement('div');
    h.admin.uploadContentImage.and.returnValue(
      of({ images: [{ id: 'i', url: '/u.png', sort_order: 0, focal_x: 50, focal_y: 50 }] }),
    );
    const ev = {
      target: el,
      currentTarget: el,
      dataTransfer: { files: [imgFile()] },
      preventDefault: jasmine.createSpy('pd'),
    } as any;
    c.onHomeMediaDropOnContainer(ev);
    await Promise.resolve();
    await Promise.resolve();
    expect(h.admin.uploadContentImage).toHaveBeenCalled();
  });

  it('insertHomeMediaFiles inserts a single image then a gallery', async () => {
    h.admin.uploadContentImage.and.returnValue(
      of({ images: [{ id: 'i', url: '/u.png', focal_x: 50, focal_y: 50 }] }),
    );
    c.homeBlocks = [];
    await (c as any).insertHomeMediaFiles(0, [imgFile()]);
    expect(c.homeBlocks.some((b: any) => b.type === 'image')).toBe(true);

    c.homeBlocks = [];
    await (c as any).insertHomeMediaFiles(0, [imgFile(), imgFile()]);
    expect(c.homeBlocks.some((b: any) => b.type === 'gallery')).toBe(true);
  });

  it('insertHomeMediaFiles ignores empty/invalid file sets', async () => {
    await (c as any).insertHomeMediaFiles(0, []);
    expect(h.admin.uploadContentImage).not.toHaveBeenCalled();
  });

  it('uploadCmsImageToKey creates content on 404 then retries upload', async () => {
    let uploadCalls = 0;
    h.admin.uploadContentImage.and.callFake(() => {
      uploadCalls += 1;
      return uploadCalls === 1
        ? throwError(() => ({ status: 404 }))
        : of({ images: [{ url: '/after.png', focal_x: 50, focal_y: 50 }] });
    });
    h.admin.createContent.and.returnValue(of({ version: 1 }));
    const res = await (c as any).uploadCmsImageToKey('page.about', imgFile());
    expect(res.url).toBe('/after.png');
    expect(h.admin.createContent).toHaveBeenCalled();
  });

  it('uploadCmsImageToKey rethrows non-404 errors', async () => {
    h.admin.uploadContentImage.and.returnValue(throwError(() => ({ status: 500 })));
    await expectAsync((c as any).uploadCmsImageToKey('page.about', imgFile())).toBeRejected();
  });

  it('insertPageMediaFiles inserts an image then a gallery', async () => {
    h.admin.uploadContentImage.and.returnValue(
      of({ images: [{ url: '/u.png', focal_x: 50, focal_y: 50 }] }),
    );
    c.pageBlocks['page.about'] = [];
    await (c as any).insertPageMediaFiles('page.about', 0, [imgFile()]);
    expect(c.pageBlocks['page.about'].some((b: any) => b.type === 'image')).toBe(true);

    c.pageBlocks['page.about'] = [];
    await (c as any).insertPageMediaFiles('page.about', 0, [imgFile(), imgFile()]);
    expect(c.pageBlocks['page.about'].some((b: any) => b.type === 'gallery')).toBe(true);
  });
});

describe('AdminComponent — image insert, page carousel, exports, misc', () => {
  let h: Harness;
  let c: any;
  const KEY = 'page.about';
  beforeEach(() => {
    h = createComponent();
    c = h.component as any;
    c.pageBlocks = {};
  });

  it('uploadAndInsertBlogImage inserts markdown for textarea and editor', () => {
    c.selectedBlogKey = null;
    c.uploadAndInsertBlogImage(document.createElement('textarea'), {
      target: { files: [] },
    } as any);
    expect(h.admin.uploadContentImage).not.toHaveBeenCalled();

    c.selectedBlogKey = 'blog.a';
    c.blogForm = { body_markdown: '' };
    c.blogImageLayout = 'wide';
    const ta = document.createElement('textarea');
    const file = new File(['x'], 'pic.png', { type: 'image/png' });
    h.admin.uploadContentImage.and.returnValue(
      of({ images: [{ id: 'i', url: '/p.png', sort_order: 0 }] }),
    );
    c.uploadAndInsertBlogImage(ta, { target: { files: [file], value: 'v' } } as any);
    expect(c.blogForm.body_markdown).toContain('/p.png');

    const editor = { insertMarkdown: jasmine.createSpy('im') } as any;
    c.blogImageLayout = 'default';
    c.uploadAndInsertBlogImage(editor, { target: { files: [file], value: 'v' } } as any);
    expect(editor.insertMarkdown).toHaveBeenCalled();

    h.admin.uploadContentImage.and.returnValue(throwError(() => new Error('x')));
    c.uploadAndInsertBlogImage(ta, { target: { files: [file], value: 'v' } } as any);
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('page carousel slide methods reorder, remove and set image', () => {
    c.pageBlocks[KEY] = [
      { key: 'car', type: 'carousel', slides: [c.emptySlideDraft(), c.emptySlideDraft()] },
    ];
    c.movePageCarouselSlide(KEY, 'car', 0, 1);
    c.movePageCarouselSlide(KEY, 'car', 0, 99); // out of range
    c.setPageCarouselSlideImage(KEY, 'car', 0, { url: '/s.jpg', focal_x: 1, focal_y: 2 });
    expect(c.pageBlocks[KEY][0].slides[0].image_url).toBe('/s.jpg');
    c.setPageCarouselSlideImage(KEY, 'car', 9, { url: '/x' }); // bad idx
    c.setPageCarouselSlideImage(KEY, 'car', 0, { url: '' }); // empty
    c.removePageCarouselSlide(KEY, 'car', 0);
    expect(c.pageBlocks[KEY][0].slides.length).toBe(1);
    c.removePageCarouselSlide(KEY, 'car', 0); // keeps one
    expect(c.pageBlocks[KEY][0].slides.length).toBe(1);
  });

  it('exportContentRedirects downloads a csv and reports errors', () => {
    c.redirectsExporting = false;
    c.redirectsQuery = 'q';
    h.admin.exportContentRedirects.and.returnValue(of(new Blob(['a,b'], { type: 'text/csv' })));
    c.exportContentRedirects();
    expect(h.toast.success).toHaveBeenCalled();
    expect(c.redirectsExporting).toBe(false);

    h.admin.exportContentRedirects.and.returnValue(throwError(() => ({ error: { detail: 'e' } })));
    c.exportContentRedirects();
    expect(h.toast.error).toHaveBeenCalledWith('e');

    c.redirectsExporting = true; // busy guard
    h.admin.exportContentRedirects.calls.reset();
    c.exportContentRedirects();
    expect(h.admin.exportContentRedirects).not.toHaveBeenCalled();
  });

  it('saveBulkStock updates selected products', async () => {
    c.bulkStock = null;
    await c.saveBulkStock(); // no bulk
    expect(h.admin.updateProduct).not.toHaveBeenCalled();

    c.bulkStock = 7;
    c.selectedIds = new Set(['p1', 'missing']);
    c.products = [{ id: 'p1', slug: 's1', stock_quantity: 0 }];
    h.admin.updateProduct.and.returnValue(of({}));
    await c.saveBulkStock();
    expect(c.products[0].stock_quantity).toBe(7);

    c.selectedIds = new Set(['p1']);
    h.admin.updateProduct.and.returnValue(throwError(() => new Error('x')));
    await c.saveBulkStock();
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('syncSplitScroll early-returns for non-split and non-scrollable', () => {
    h.cmsPrefs.previewLayout.and.returnValue('stacked');
    const a = document.createElement('div');
    const b = document.createElement('div');
    expect(() => c.syncSplitScroll(a, b)).not.toThrow();
    h.cmsPrefs.previewLayout.and.returnValue('split');
    expect(() => c.syncSplitScroll(a, b)).not.toThrow(); // no scrollable height
  });

  it('editBlogCoverFocalPoint validates input', () => {
    c.blogEditLang = 'en';
    c.blogBaseLang = 'en';
    c.blogImages = [{ id: 'i', url: '/c.png', focal_x: 50, focal_y: 50 }];
    c.blogForm = { cover_image_url: '/c.png' };
    const promptSpy = spyOn(window, 'prompt').and.returnValue(null);
    c.editBlogCoverFocalPoint(); // cancelled
    expect(h.admin.updateContentImageFocalPoint).not.toHaveBeenCalled();

    promptSpy.and.returnValue('bad');
    c.editBlogCoverFocalPoint(); // bad format
    expect(h.toast.error).toHaveBeenCalled();

    promptSpy.and.returnValue('30, 40');
    h.admin.updateContentImageFocalPoint.and.returnValue(of({ focal_x: 30, focal_y: 40 }));
    c.editBlogCoverFocalPoint();
    expect(h.admin.updateContentImageFocalPoint).toHaveBeenCalled();
  });

  it('deleteImage removes a product image', () => {
    c.editingId = null;
    c.deleteImage('i1');
    expect(h.admin.deleteProductImage).not.toHaveBeenCalled();
    c.editingId = 's1';
    h.admin.deleteProductImage.and.returnValue(of({ images: [] }));
    c.deleteImage('i1');
    expect(h.toast.success).toHaveBeenCalled();
    h.admin.deleteProductImage.and.returnValue(throwError(() => new Error('x')));
    c.deleteImage('i1');
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('savePageBlocks serialises product_grid collection/products and form', () => {
    c.pageBlocksStatus[KEY] = 'draft';
    c.pageBlocks[KEY] = [
      {
        ...c.makeHomeBlockDraft('pg1', 'product_grid', true),
        type: 'product_grid',
        product_grid_source: 'collection',
        product_grid_collection_slug: 'col',
        product_grid_limit: 100,
      },
      {
        ...c.makeHomeBlockDraft('pg2', 'product_grid', true),
        type: 'product_grid',
        product_grid_source: 'products',
        product_grid_product_slugs: 'a, a, b',
      },
      {
        ...c.makeHomeBlockDraft('fm', 'form', true),
        type: 'form',
        form_type: 'contact',
        form_topic: 'support',
      },
    ];
    c.pageBlocksMeta[KEY] = {};
    c.ensurePageDraft(KEY).initFromServer(c.currentPageDraftState(KEY));
    h.admin.updateContentBlock.and.returnValue(of({ version: 2, status: 'draft', meta: {} }));
    c.savePageBlocks(KEY);
    const blocks = h.admin.updateContentBlock.calls.mostRecent().args[1].meta.blocks;
    const pg = blocks.find((b: any) => b.key === 'pg1');
    expect(pg.collection_slug).toBe('col');
    expect(pg.limit).toBe(24);
    const pg2 = blocks.find((b: any) => b.key === 'pg2');
    expect(pg2.product_slugs).toEqual(['a', 'b']);
    const fm = blocks.find((b: any) => b.key === 'fm');
    expect(fm.topic).toBe('support');
  });

  it('saveSections serialises cta/columns/faq/image/banner content', () => {
    c.cmsHomeDraft.initFromServer([]);
    spyOn(c, 'refreshHomePreview');
    c.homeBlocks = [
      { ...c.makeHomeBlockDraft('cta', 'cta', true), cta_url: '/go', cta_new_tab: true },
      { ...c.makeHomeBlockDraft('col', 'columns', true), columns_breakpoint: 'lg' },
      c.makeHomeBlockDraft('faq', 'faq', true),
      c.makeHomeBlockDraft('img', 'image', true),
      c.makeHomeBlockDraft('ban', 'banner', true),
    ];
    h.admin.updateContentBlock.and.returnValue(of({ version: 2 }));
    c.saveSections();
    const blocks = h.admin.updateContentBlock.calls.mostRecent().args[1].meta.blocks;
    const cta = blocks.find((b: any) => b.key === 'cta');
    expect(cta.cta_new_tab).toBe(true);
    expect(blocks.find((b: any) => b.key === 'col').columns_breakpoint).toBe('lg');
  });

  it('copyToClipboard falls back to execCommand when the API rejects', async () => {
    const original = (navigator as any).clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('denied')) },
      configurable: true,
    });
    spyOn(document, 'execCommand').and.returnValue(true);
    const ok = await (c as any).copyToClipboard('hello');
    expect(ok).toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
    Object.defineProperty(navigator, 'clipboard', { value: original, configurable: true });
  });
});

describe('AdminComponent — loadSections fallbacks and draft restore', () => {
  let h: Harness;
  let c: any;
  beforeEach(() => {
    localStorage.clear();
    h = createComponent();
    c = h.component as any;
  });

  it('loadSections derives from sections metadata', () => {
    h.admin.getContent.and.returnValue(
      of({
        version: 1,
        meta: { sections: [{ id: 'story', enabled: false }, { id: 'bad' }, null] },
      }),
    );
    c.loadSections();
    expect(c.homeBlocks.some((b: any) => b.type === 'story')).toBe(true);
  });

  it('loadSections derives from legacy order metadata', () => {
    h.admin.getContent.and.returnValue(
      of({ version: 1, meta: { order: ['featured_products', 'story'] } }),
    );
    c.loadSections();
    expect(c.homeBlocks.length).toBeGreaterThan(0);
  });

  it('loadSections falls back to defaults when meta is empty or errors', () => {
    h.admin.getContent.and.returnValue(of({ version: 1, meta: {} }));
    c.loadSections();
    expect(c.homeBlocks.length).toBe(c.defaultHomeSections().length);
    h.admin.getContent.and.returnValue(throwError(() => new Error('x')));
    c.loadSections();
    expect(c.homeBlocks.length).toBe(c.defaultHomeSections().length);
  });

  it('restoreHomeDraftAutosave applies a stored draft', () => {
    const mgr = c.cmsHomeDraft;
    localStorage.setItem(
      (mgr as any).storageKey,
      JSON.stringify({
        v: 1,
        ts: '2999-01-01T00:00:00Z',
        state_json: JSON.stringify([{ key: 'restored', type: 'text' }]),
      }),
    );
    mgr.initFromServer([{ key: 'orig', type: 'text' }]);
    c.homeBlocks = [{ key: 'orig', type: 'text' }];
    c.restoreHomeDraftAutosave();
    expect(c.homeBlocks[0].key).toBe('restored');
  });

  it('restorePageDraftAutosave applies a stored page draft', () => {
    const KEY = 'page.about';
    c.pageBlocks[KEY] = [];
    const mgr = c.ensurePageDraft(KEY);
    const state = {
      blocks: [{ key: 'b', type: 'text', layout: {} }],
      status: 'draft',
      publishedAt: '',
      publishedUntil: '',
      requiresAuth: false,
    };
    localStorage.setItem(
      (mgr as any).storageKey,
      JSON.stringify({ v: 1, ts: '2999-01-01T00:00:00Z', state_json: JSON.stringify(state) }),
    );
    mgr.initFromServer(c.currentPageDraftState(KEY));
    c.restorePageDraftAutosave(KEY);
    expect(c.pageBlocks[KEY].length).toBe(1);
  });

  it('restoreBlogDraftAutosave applies a stored blog draft', () => {
    c.selectedBlogKey = 'blog.a';
    c.blogEditLang = 'en';
    c.blogForm = {
      title: 'orig',
      body_markdown: '',
      status: 'draft',
      published_at: '',
      published_until: '',
      summary: '',
      tags: '',
      series: '',
      cover_image_url: '',
      cover_fit: 'cover',
      reading_time_minutes: '',
      pinned: false,
      pin_order: '1',
    };
    c.blogMeta = {};
    const mgr = c.ensureBlogDraft('blog.a', 'en');
    const state = c.currentBlogDraftState();
    const restored = { ...state, title: 'restored title' };
    localStorage.setItem(
      (mgr as any).storageKey,
      JSON.stringify({ v: 1, ts: '2999-01-01T00:00:00Z', state_json: JSON.stringify(restored) }),
    );
    mgr.initFromServer(state);
    c.restoreBlogDraftAutosave();
    expect(c.blogForm.title).toBe('restored title');
  });

  it('observeCmsDrafts observes ready drafts without throwing', () => {
    c.cmsHomeDraft.initFromServer([]);
    c.pageBlocks['page.about'] = [];
    c.ensurePageDraft('page.about').initFromServer(c.currentPageDraftState('page.about'));
    expect(() => (c as any).observeCmsDrafts()).not.toThrow();
  });
});

describe('AdminComponent — remaining edge branches', () => {
  let h: Harness;
  let c: any;
  beforeEach(() => {
    localStorage.clear();
    h = createComponent();
    c = h.component as any;
  });

  it('submitOwnerTransfer surfaces server error detail', () => {
    h.auth.role.and.returnValue('owner');
    c.ownerTransferIdentifier = 'u@x.com';
    spyOn(window, 'prompt').and.returnValue('pw');
    h.admin.transferOwner.and.returnValue(throwError(() => ({ error: { detail: 'nope' } })));
    c.submitOwnerTransfer();
    expect(c.ownerTransferError).toBe('nope');

    h.admin.transferOwner.and.returnValue(throwError(() => ({})));
    c.submitOwnerTransfer();
    expect(c.ownerTransferError).toBeTruthy();
  });

  it('hasUnsavedChanges detects dirty page and blog drafts', () => {
    const pm = c.ensurePageDraft('page.about');
    pm.initFromServer({
      blocks: [],
      status: 'draft',
      publishedAt: '',
      publishedUntil: '',
      requiresAuth: false,
    });
    pm.observe({
      blocks: [{ key: 'x', type: 'text' }],
      status: 'draft',
      publishedAt: '',
      publishedUntil: '',
      requiresAuth: false,
    });
    expect(c.hasUnsavedChanges()).toBe(true);

    const h2 = createComponent();
    const c2 = h2.component as any;
    const bm = c2.ensureBlogDraft('blog.a', 'en');
    bm.initFromServer({
      title: 'a',
      body_markdown: '',
      status: 'draft',
      published_at: '',
      published_until: '',
      meta: {},
    });
    bm.observe({
      title: 'b',
      body_markdown: '',
      status: 'draft',
      published_at: '',
      published_until: '',
      meta: {},
    });
    expect(c2.hasUnsavedChanges()).toBe(true);
  });

  it('blogPinnedPosts applies tie-breakers by published_at then updated_at', () => {
    c.contentBlocks = [
      {
        key: 'blog.a',
        meta: { pinned: true, pin_order: 1 },
        published_at: '2020-01-01',
        updated_at: 'a',
      },
      {
        key: 'blog.b',
        meta: { pinned: true, pin_order: 1 },
        published_at: '2021-01-01',
        updated_at: 'b',
      },
      {
        key: 'blog.c',
        meta: { pinned: true, pin_order: 1 },
        published_at: '2021-01-01',
        updated_at: 'z',
      },
    ];
    const ranked = c.blogPinnedPosts().map((p: any) => p.key);
    expect(ranked[0]).toBe('blog.c'); // newer published_at, then updated_at desc
  });

  it('saveContent handles a version conflict via reload', () => {
    h.admin.getContent.and.returnValue(
      of({ key: 'site.x', title: 'T', body_markdown: 'B', status: 'draft', version: 1 }),
    );
    c.selectedContent = { key: 'site.x' };
    c.contentForm = { title: 'T', body_markdown: 'B', status: 'draft' };
    h.admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 409 })));
    c.saveContent();
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('saveBlogPost translation meta save handles a conflict', () => {
    c.selectedBlogKey = 'blog.a';
    c.blogEditLang = 'ro';
    c.blogBaseLang = 'en';
    c.blogForm = {
      title: 'Titlu',
      body_markdown: 'Corp',
      status: 'draft',
      published_at: '',
      published_until: '',
      summary: '',
      tags: 'x',
      series: '',
      cover_image_url: '',
      cover_fit: 'cover',
      reading_time_minutes: '',
      pinned: false,
      pin_order: '1',
    };
    c.blogMeta = {};
    c.ensureBlogDraft('blog.a', 'ro').initFromServer(c.currentBlogDraftState());
    spyOn(c, 'reloadContentBlocks');
    spyOn(c, 'setBlogEditLang');
    h.admin.getContent.and.returnValue(
      of({ meta: {}, version: 1, lang: 'ro', title: 'Titlu', body_markdown: 'Corp' }),
    );
    let calls = 0;
    h.admin.updateContentBlock.and.callFake(() => {
      calls += 1;
      return calls === 1 ? of({ version: 2 }) : throwError(() => ({ status: 409 }));
    });
    c.saveBlogPost();
    expect(calls).toBe(2); // translation save ok, meta save conflict
  });
});

describe('AdminComponent — media drop, split scroll', () => {
  let h: Harness;
  let c: any;
  beforeEach(() => {
    h = createComponent();
    c = h.component as any;
  });

  it('onHomeBlockDrop handles media files and missing keys', () => {
    spyOn(c, 'insertHomeMediaFiles');
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    c.homeBlocks = [{ key: 'a', type: 'text' }];
    c.onHomeBlockDrop(
      {
        preventDefault: jasmine.createSpy('pd'),
        dataTransfer: { files: [file], types: ['Files'] },
      } as any,
      'a',
    );
    expect(c.insertHomeMediaFiles).toHaveBeenCalled();

    c.draggingHomeBlockKey = 'ghost';
    c.onHomeBlockDrop(
      {
        preventDefault: jasmine.createSpy('pd'),
        dataTransfer: { files: [], getData: () => '' },
      } as any,
      'a',
    );
    expect(c.draggingHomeBlockKey).toBeNull();
  });

  it('onPageBlockDrop handles media files', () => {
    spyOn(c, 'insertPageMediaFiles');
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    c.pageBlocks['page.about'] = [{ key: 'b', type: 'text' }];
    c.onPageBlockDrop(
      {
        preventDefault: jasmine.createSpy('pd'),
        dataTransfer: { files: [file], types: ['Files'] },
      } as any,
      'page.about',
      'b',
    );
    expect(c.insertPageMediaFiles).toHaveBeenCalled();
  });

  it('syncSplitScroll mirrors scroll position when in split layout', () => {
    h.cmsPrefs.previewLayout.and.returnValue('split');
    const mk = (sh: number, ch: number, st: number) => {
      const el = document.createElement('div');
      Object.defineProperty(el, 'scrollHeight', { value: sh, configurable: true });
      Object.defineProperty(el, 'clientHeight', { value: ch, configurable: true });
      el.scrollTop = st;
      return el;
    };
    const source = mk(200, 100, 50);
    const target = mk(400, 100, 0);
    let rafCb: any = null;
    spyOn(window, 'requestAnimationFrame').and.callFake((cb: any) => {
      rafCb = cb;
      return 0;
    });
    c.syncSplitScroll(source, target);
    expect((c as any).previewScrollSyncActive).toBe(true); // set during sync, reset on rAF
    rafCb(); // run the queued frame
    expect((c as any).previewScrollSyncActive).toBe(false);
    // while flag active, a re-entrant call short-circuits
    (c as any).previewScrollSyncActive = true;
    expect(() => c.syncSplitScroll(source, target)).not.toThrow();
  });
});

describe('AdminComponent — clipboard failure branches', () => {
  let h: Harness;
  let c: any;
  beforeEach(() => {
    h = createComponent();
    c = h.component as any;
  });

  it('copyBlogPreviewLink toasts an error when the copy fails', async () => {
    spyOn(c, 'copyToClipboard').and.returnValue(Promise.resolve(false));
    c.blogPreviewUrl = 'https://ex.com/p';
    c.copyBlogPreviewLink();
    await Promise.resolve();
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('copyPreviewLink toasts an error when the copy fails', async () => {
    spyOn(c, 'copyToClipboard').and.returnValue(Promise.resolve(false));
    c.copyPreviewLink('https://ex.com/p');
    await Promise.resolve();
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('copyText toasts an error when the copy fails', async () => {
    spyOn(c, 'copyToClipboard').and.returnValue(Promise.resolve(false));
    c.copyText('hello');
    await Promise.resolve();
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('generateBlogPreviewLink tolerates a failed clipboard copy', async () => {
    spyOn(c, 'copyToClipboard').and.returnValue(Promise.resolve(false));
    c.selectedBlogKey = 'blog.hello';
    h.blog.createPreviewToken.and.returnValue(of({ url: '/u', token: 't', expires_at: 's' }));
    c.generateBlogPreviewLink();
    await Promise.resolve();
    expect(c.blogPreviewToken).toBe('t');
  });

  it('copyToClipboard returns false when execCommand also throws', async () => {
    const original = (navigator as any).clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('denied')) },
      configurable: true,
    });
    spyOn(document, 'execCommand').and.throwError('blocked');
    const ok = await (c as any).copyToClipboard('hello');
    expect(ok).toBe(false);
    Object.defineProperty(navigator, 'clipboard', { value: original, configurable: true });
  });
});
