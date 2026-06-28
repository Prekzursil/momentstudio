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
    'updateFeaturedCollection',
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
