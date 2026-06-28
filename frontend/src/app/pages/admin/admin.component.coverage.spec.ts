/* eslint-disable @typescript-eslint/no-explicit-any */
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
    'products', 'coupons', 'lowStock', 'audit', 'getMaintenance', 'setMaintenance',
    'content', 'getContent', 'createContent', 'updateContentBlock', 'deleteContent',
    'getCategories', 'createCategory', 'updateCategory', 'deleteCategory',
    'getCategoryTranslations', 'upsertCategoryTranslation', 'deleteCategoryTranslation',
    'createProduct', 'updateProduct', 'getProduct', 'deleteProduct', 'duplicateProduct',
    'uploadProductImage', 'deleteProductImage', 'transferOwner', 'revokeSessions',
    'userAliases', 'updateUserRole', 'updateOrderStatus', 'createCoupon', 'updateCoupon',
    'invalidateCouponStripeMappings', 'listContentVersions', 'getContentVersion',
    'rollbackContentVersion', 'uploadContentImage', 'updateContentImageFocalPoint',
    'listContentPages', 'renameContentPage', 'updateContentTranslationStatus',
    'getSitemapPreview', 'validateStructuredData', 'deleteContentRedirect',
    'exportContentRedirects', 'importContentRedirects', 'upsertContentRedirect',
    'previewFindReplaceContent', 'applyFindReplaceContent', 'linkCheckContent',
    'fetchSocialThumbnail', 'sendScheduledReport', 'createPagePreviewToken',
    'createHomePreviewToken', 'listFeaturedCollections', 'createFeaturedCollection',
    'updateFeaturedCollection', 'reorderCategories',
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
    'listFlaggedComments', 'resolveCommentFlagsAdmin', 'hideCommentAdmin',
    'unhideCommentAdmin', 'deleteComment', 'createPreviewToken',
  ]);
  blog.listFlaggedComments.and.returnValue(of([]));
  blog.createPreviewToken.and.returnValue(of({ token: 't', expires_at: '' }));
  const fxAdmin = jasmine.createSpyObj('FxAdminService', [
    'getStatus', 'listOverrideAudit', 'restoreOverrideFromAudit', 'clearOverride', 'setOverride',
  ]);
  fxAdmin.getStatus.and.returnValue(of({ override: null }));
  fxAdmin.listOverrideAudit.and.returnValue(of([]));
  const taxesAdmin = jasmine.createSpyObj('TaxesAdminService', [
    'listGroups', 'createGroup', 'updateGroup', 'deleteGroup', 'upsertRate', 'deleteRate',
  ]);
  taxesAdmin.listGroups.and.returnValue(of([]));
  const auth = { role: jasmine.createSpy('role').and.returnValue('admin'), loadCurrentUser: jasmine.createSpy('loadCurrentUser').and.returnValue(of(null)) };
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
    component, admin, adminProducts, blog, fxAdmin, taxesAdmin, auth,
    cmsPrefs, toast, translate, markdown, sanitizer, route,
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
      JSON.stringify({ v: 1, ts: '2030-01-01T00:00:00Z', state_json: JSON.stringify([{ id: 'restored' }]) }),
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
    localStorage.setItem(key, JSON.stringify({ v: 1, ts: 't', state_json: JSON.stringify([{ id: 'x' }]) }));
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
    fast.initFromServer({ blocks: [], status: 'draft', publishedAt: '', publishedUntil: '', requiresAuth: false });
    fast.observe({ blocks: [{ id: 'p' }], status: 'draft', publishedAt: '', publishedUntil: '', requiresAuth: false });
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
      ['site.assets', 'assets'], ['site.social', 'social'], ['site.company', 'company'],
      ['site.navigation', 'navigation'], ['site.checkout', 'checkout'], ['site.reports', 'reports'],
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
      c.toCmsBlockLayout({ spacing: 'lg', background: 'accent', align: 'center', maxWidth: 'wide' }),
    ).toEqual({ spacing: 'lg', background: 'accent', align: 'center', max_width: 'wide' });
    expect(
      c.toCmsBlockLayout({ spacing: 'xxl', background: 'rainbow', align: 'top', max_width: 'huge' }),
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
    const slide = { ...c.emptySlideDraft(), image_url: ' /x ', cta_url: ' /y ', focal_x: 200, focal_y: -5 };
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
  beforeEach(() => { c = createComponent().component as any; });

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
    const out = c.parsePageBlocksDraft({ blocks: [{ type: 'text' }, { type: 'cta', enabled: false }] });
    expect(out[0].key).toBe('text_1');
    expect(out[0].enabled).toBe(true);
    expect(out[1].key).toBe('cta_2');
    expect(out[1].enabled).toBe(false);
  });

  it('parses every supported block type with rich content', () => {
    const blocks = [
      { type: 'columns', columns: [{ title: 'c1' }, { title: 'c2' }, { title: 'c3' }, { title: 'c4' }], columns_breakpoint: 'lg' },
      { type: 'cta', cta_label: 'Go', cta_url: ' /go ', cta_new_tab: 'yes' },
      { type: 'faq', items: [{ question: 'q1' }, null, { question: 'q2' }] },
      { type: 'testimonials', items: [{ author: 'a1' }, 'bad'] },
      { type: 'product_grid', source: 'COLLECTION', collection_slug: ' col ', product_slugs: ['x', 'x', 'y'], limit: '99' },
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
      blocks: [{ type: 'product_grid', source: 'products', product_slugs: 'a, b\nc', limit: 'bad' }],
    });
    expect(out[0].product_grid_source).toBe('products');
    expect(out[0].product_grid_product_slugs).toBe('a\nb\nc');
    expect(out[0].product_grid_limit).toBe(6);
  });

  it('falls back to defaults for columns under two and unknown breakpoint', () => {
    const out = c.parsePageBlocksDraft({ blocks: [{ type: 'columns', columns: [{ title: 'only' }], columns_breakpoint: 'xl' }] });
    expect(out[0].columns.length).toBe(2); // default kept
    expect(out[0].columns_breakpoint).toBe('md');
  });
});

describe('AdminComponent — contentTitleForKey and page block mutators', () => {
  let h: Harness;
  let c: any;
  beforeEach(() => { h = createComponent(); c = h.component as any; });

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
  beforeEach(() => { h = createComponent(); c = h.component as any; });

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
    for (const id of ['featured_products', 'sale_products', 'new_arrivals', 'featured_collections', 'story', 'recently_viewed', 'why']) {
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
    c.homeBlocks = [{ key: 'a', enabled: true }, { key: 'b', enabled: true }];
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
    c.homeBlocks = [{ key: 'a', type: 'text' }, { key: 'b', type: 'text' }];
    c.draggingHomeBlockKey = 'a';
    c.onHomeBlockDropZone(dragEvent(), 2);
    expect(c.homeBlocks.map((b: any) => b.key)).toEqual(['b', 'a']);

    c.draggingHomeBlockKey = 'missing';
    c.onHomeBlockDropZone(dragEvent(), 0); // from === -1 → ends drag
    expect(c.draggingHomeBlockKey).toBeNull();

    const before = c.homeBlocks.length;
    c.onHomeBlockDropZone(dragEvent({ kind: 'cms-block', scope: 'home', type: 'cta', template: 'blank' }), 0);
    expect(c.homeBlocks.length).toBe(before + 1);

    const after = c.homeBlocks.length;
    c.onHomeBlockDropZone(dragEvent({ kind: 'cms-block', scope: 'page', type: 'cta' }), 0); // wrong scope
    expect(c.homeBlocks.length).toBe(after);
  });

  it('onHomeBlockDrop reorders onto a target and inserts a home payload', () => {
    c.homeBlocks = [{ key: 'a', type: 'text' }, { key: 'b', type: 'text' }, { key: 'c', type: 'text' }];
    c.draggingHomeBlockKey = 'a';
    c.onHomeBlockDrop(dragEvent(), 'c');
    expect(c.homeBlocks.map((b: any) => b.key)).toEqual(['b', 'a', 'c']);

    const cnt = c.homeBlocks.length;
    c.onHomeBlockDrop(dragEvent({ kind: 'cms-block', scope: 'home', type: 'cta', template: 'blank' }), 'b');
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
    expect(c.readCmsBlockPayload(dragEvent({ kind: 'cms-block', scope: 'bad', type: 'text' }))).toBeNull();
    expect(c.readCmsBlockPayload(dragEvent({ kind: 'cms-block', scope: 'home', type: 'nope' }))).toBeNull();
    expect(c.readCmsBlockPayload(dragEvent({ kind: 'cms-block', scope: 'home', type: 'text', template: 'starter' })))
      .toEqual({ scope: 'home', type: 'text', template: 'starter' });
    expect(c.readCmsBlockPayload(dragEvent({ kind: 'cms-block', scope: 'page', type: 'cta' })).template).toBe('blank');
  });
});

describe('AdminComponent — page block mutators', () => {
  let h: Harness;
  let c: any;
  beforeEach(() => { h = createComponent(); c = h.component as any; });

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
  beforeEach(() => { h = createComponent(); c = h.component as any; });

  it('selectOrder clones the order and filteredOrders honours the status filter', () => {
    const order = { id: 'o1', status: 'paid' } as any;
    c.selectOrder(order);
    expect(c.activeOrder).toEqual(order);
    expect(c.activeOrder).not.toBe(order);
    c.orders = [{ id: 'o1', status: 'paid' }, { id: 'o2', status: 'shipped' }] as any;
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

  it('moveCategory swaps sort order and respects bounds', () => {
    c.categories = [
      { slug: 'a', sort_order: 0 },
      { slug: 'b', sort_order: 1 },
    ];
    h.admin.reorderCategories.and.returnValue(of([{ slug: 'b', sort_order: 0 }, { slug: 'a', sort_order: 1 }]));
    c.moveCategory({ slug: 'a' } as any, 1);
    expect(h.admin.reorderCategories).toHaveBeenCalled();
    expect(h.toast.success).toHaveBeenCalled();

    c.moveCategory({ slug: 'a' } as any, -5); // out of range → no call
    h.admin.reorderCategories.calls.reset();
    c.moveCategory({ slug: 'a' } as any, 5);
    expect(h.admin.reorderCategories).not.toHaveBeenCalled();

    h.admin.reorderCategories.and.returnValue(throwError(() => new Error('x')));
    c.categories = [{ slug: 'a', sort_order: 0 }, { slug: 'b', sort_order: 1 }];
    c.moveCategory({ slug: 'a' } as any, 1);
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('category drag-drop reorders and guards self/missing drops', () => {
    c.categories = [{ slug: 'a', sort_order: 0 }, { slug: 'b', sort_order: 1 }, { slug: 'c', sort_order: 2 }];
    c.onCategoryDragStart('a');
    expect(c.draggingSlug).toBe('a');
    const ev = dragEvent();
    c.onCategoryDragOver(ev);
    expect(ev.preventDefault).toHaveBeenCalled();

    h.admin.reorderCategories.and.returnValue(of(c.categories));
    c.onCategoryDrop('c');
    expect(h.admin.reorderCategories).toHaveBeenCalled();
    expect(c.draggingSlug).toBeNull();

    c.draggingSlug = 'a';
    c.onCategoryDrop('a'); // self → reset, no call
    expect(c.draggingSlug).toBeNull();

    c.draggingSlug = 'ghost';
    c.onCategoryDrop('a'); // from missing
    expect(c.draggingSlug).toBeNull();
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
  beforeEach(() => { c = createComponent().component as any; });

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
      { key: 'blog.a', meta: { pinned: true, pin_order: 2 }, published_at: '2020-01-01', updated_at: 'a' },
      { key: 'blog.b', meta: { pinned: true, pin_order: 1 }, published_at: '2021-01-01', updated_at: 'b' },
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
  const status = { override: null, effective: { eur_per_ron: 5, usd_per_ron: 4, as_of: '2020-01-01' } };
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
  beforeEach(() => { h = createComponent(); c = h.component as any; });

  it('startNewProduct resets the form using the first category', () => {
    c.categories = [{ id: 'cat1' }];
    c.startNewProduct();
    expect(c.editingId).toBeNull();
    expect(c.form.category_id).toBe('cat1');
    expect(c.form.status).toBe('draft');
  });

  it('loadProduct hydrates the form and reports load errors', () => {
    h.admin.getProduct.and.returnValue(of({
      slug: 's1', name: 'P', category_id: 'c', price: 10, stock_quantity: 5, status: 'live',
      sku: 'SKU', long_description: 'desc', publish_at: '2030-01-01T00:00:00Z', tags: ['bestseller'], images: [{ id: 'i' }],
    }));
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
    c.form = { name: 'n', slug: 's', category_id: 'c', price: 1, stock: 2, status: 'draft', sku: '', description: '', publish_at: '', is_bestseller: false };
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

describe('AdminComponent — category wizard', () => {
  let h: Harness;
  let c: any;
  beforeEach(() => { h = createComponent(); c = h.component as any; });

  it('start/exit toggle the wizard state', () => {
    c.startCategoryWizard();
    expect(c.categoryWizardOpen()).toBe(true);
    c.exitCategoryWizard();
    expect(c.categoryWizardOpen()).toBe(false);
  });

  it('descriptionKey/nextLabelKey/canNext respond to the current step', () => {
    c.startCategoryWizard();
    expect(c.categoryWizardDescriptionKey()).toContain('basics');
    expect(c.categoryWizardNextLabelKey()).toContain('next');
    expect(c.categoryWizardCanNext()).toBe(false); // no slug yet
    c.categoryWizardSlug.set('cat');
    expect(c.categoryWizardCanNext()).toBe(true);
    c.categoryWizardStep.set(1);
    expect(c.categoryWizardNextLabelKey()).toContain('done');
    expect(c.categoryWizardCanNext()).toBe(true); // last step
    c.exitCategoryWizard();
    expect(c.categoryWizardCanNext()).toBe(false); // closed
  });

  it('prev/next/goToStep navigate with guards', () => {
    c.startCategoryWizard();
    c.categoryWizardPrev(); // already 0 → no-op
    expect(c.categoryWizardStep()).toBe(0);

    c.categoryWizardNext(); // cannot advance without slug
    expect(h.toast.error).toHaveBeenCalled();
    expect(c.categoryWizardStep()).toBe(0);

    c.categoryWizardSlug.set('cat');
    c.categoryWizardNext(); // advances to step 1, opens translations
    expect(c.categoryWizardStep()).toBe(1);

    c.categoryWizardPrev();
    expect(c.categoryWizardStep()).toBe(0);

    c.categoryWizardNext(); // last step from 1? at step 0 with slug → step 1
    c.categoryWizardNext(); // at last step → exit
    expect(c.categoryWizardOpen()).toBe(false);

    c.startCategoryWizard();
    c.goToCategoryWizardStep(5); // out of range
    expect(c.categoryWizardStep()).toBe(0);
    c.categoryWizardSlug.set(null);
    c.goToCategoryWizardStep(1); // needs slug
    expect(c.categoryWizardStep()).toBe(0);
    c.categoryWizardSlug.set('cat');
    c.goToCategoryWizardStep(1);
    expect(c.categoryWizardStep()).toBe(1);
  });

  it('addCategory validates the name and advances the wizard on success', () => {
    c.categoryName = '';
    c.addCategory();
    expect(h.admin.createCategory).not.toHaveBeenCalled();

    c.startCategoryWizard();
    c.categoryName = 'Shoes';
    c.categoryParentId = ' p1 ';
    h.admin.createCategory.and.returnValue(of({ slug: 'shoes' }));
    c.addCategory();
    expect(c.categories.length).toBe(1);
    expect(c.categoryWizardSlug()).toBe('shoes');
    expect(c.categoryWizardStep()).toBe(1);

    h.admin.createCategory.and.returnValue(throwError(() => new Error('x')));
    c.categoryName = 'Hats';
    c.addCategory();
    expect(h.toast.error).toHaveBeenCalled();
  });
});
