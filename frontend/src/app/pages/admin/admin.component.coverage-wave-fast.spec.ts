import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';

import { AdminComponent } from './admin.component';

type RouteStub = {
  snapshot: { data: Record<string, unknown>; queryParams: Record<string, unknown> };
  data: Subject<Record<string, unknown>>;
  queryParams: Subject<Record<string, unknown>>;
};

function createRouteStub(section: string, query: Record<string, unknown> = {}): RouteStub {
  return {
    snapshot: { data: { section }, queryParams: query },
    data: new Subject<Record<string, unknown>>(),
    queryParams: new Subject<Record<string, unknown>>(),
  };
}

function createAdminHarness(): AdminComponent {
  const routeStub = createRouteStub('home');
  return new AdminComponent(
    {
      snapshot: routeStub.snapshot,
      data: routeStub.data.asObservable(),
      queryParams: routeStub.queryParams.asObservable(),
    } as unknown as ActivatedRoute,
    {
      products: () => ({ subscribe: ({ next }: any) => next([]) }),
    } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { role: () => 'owner' } as any,
    {
      mode: () => 'advanced',
      previewDevice: () => 'desktop',
      previewLayout: () => 'split',
      previewLang: () => 'en',
      previewTheme: () => 'light',
      translationLayout: () => 'stacked',
    } as any,
    jasmine.createSpyObj('ToastService', ['success', 'error']) as any,
    { instant: (k: string) => k } as any,
    { render: (value: string) => value } as any,
    {
      bypassSecurityTrustHtml: (value: string) => value,
      bypassSecurityTrustResourceUrl: (value: string) => value,
    } as unknown as DomSanitizer
  );
}

function immediateResult<T>(value: T, emitError = false) {
  return {
    subscribe: (observer: any) => {
      if (emitError) {
        observer?.error?.({ error: { detail: 'boom' } });
      } else {
        observer?.next?.(value);
      }
      observer?.complete?.();
    },
  };
}


function attachTaxCategoryAndFxHarness(component: any) {
  const taxesAdmin = jasmine.createSpyObj('TaxesAdminService', [
    'listGroups',
    'createGroup',
    'updateGroup',
    'deleteGroup',
    'upsertRate',
    'deleteRate',
  ]);
  taxesAdmin.listGroups.and.returnValue(
    immediateResult([{ id: 'g1', code: 'STD', name: 'Standard', is_default: false, rates: [] }]),
  );
  taxesAdmin.createGroup.and.returnValue(immediateResult({}));
  taxesAdmin.updateGroup.and.returnValue(immediateResult({ low_stock_threshold: 3, tax_group_id: 'g1' }));
  taxesAdmin.deleteGroup.and.returnValue(immediateResult({}));
  taxesAdmin.upsertRate.and.returnValue(immediateResult({}));
  taxesAdmin.deleteRate.and.returnValue(immediateResult({}));
  component.taxesAdmin = taxesAdmin;

  const admin = jasmine.createSpyObj('AdminService', ['updateCategory', 'deleteCategory', 'updateProduct']);
  admin.updateCategory.and.returnValue(immediateResult({ low_stock_threshold: 3, tax_group_id: 'g2' }));
  admin.deleteCategory.and.returnValue(immediateResult({}));
  admin.updateProduct.and.returnValue(immediateResult({}));
  component.admin = admin;

  const fxAdmin = jasmine.createSpyObj('FxAdminService', ['clearOverride', 'setOverride']);
  fxAdmin.clearOverride.and.returnValue(immediateResult({}));
  fxAdmin.setOverride.and.returnValue(immediateResult({}));
  component.fxAdmin = fxAdmin;
  component.fxStatus = () => ({ override: { eur_per_ron: 4.95, usd_per_ron: 4.6 } });
  component.loadFxStatus = jasmine.createSpy('loadFxStatus');

  return { taxesAdmin, admin, fxAdmin };
}

const GLOBAL_CTX = globalThis as Window & typeof globalThis;

describe('AdminComponent fast coverage helpers', () => {
  it('normalizes valid and invalid content sections', () => {
    const component = createAdminHarness() as any;

    expect(component.normalizeSection('home')).toBe('home');
    expect(component.normalizeSection('pages')).toBe('pages');
    expect(component.normalizeSection('blog')).toBe('blog');
    expect(component.normalizeSection('settings')).toBe('settings');
    expect(component.normalizeSection('unknown')).toBe('home');
    expect(component.normalizeSection(null)).toBe('home');
  });

  it('applies same-section reload path without resetting section state', () => {
    const component = createAdminHarness() as any;
    component.section.set('home');
    spyOn(component, 'loadForSection').and.stub();
    spyOn(component, 'syncCmsDraftPoller').and.stub();
    spyOn(component, 'resetSectionState').and.stub();

    component.applySection('home');

    expect(component.loadForSection).toHaveBeenCalledWith('home');
    expect(component.syncCmsDraftPoller).toHaveBeenCalledWith('home');
    expect(component.resetSectionState).not.toHaveBeenCalled();
  });

  it('applies section switch path and updates breadcrumbs', () => {
    const component = createAdminHarness() as any;
    component.section.set('home');
    spyOn(component, 'loadForSection').and.stub();
    spyOn(component, 'syncCmsDraftPoller').and.stub();
    spyOn(component, 'resetSectionState').and.stub();

    component.applySection('blog');

    expect(component.section()).toBe('blog');
    expect(component.crumbs[1].label).toBe('adminUi.content.nav.blog');
    expect(component.resetSectionState).toHaveBeenCalledWith('blog');
    expect(component.loadForSection).toHaveBeenCalledWith('blog');
    expect(component.syncCmsDraftPoller).toHaveBeenCalledWith('blog');
  });
});

describe('AdminComponent fast query and poller helpers', () => {
  it('applies content edit query for blog and pages with key normalization', () => {
    const component = createAdminHarness() as any;
    spyOn(component, 'loadBlogEditor').and.stub();
    spyOn(component, 'onPageBlocksKeyChange').and.stub();

    component.applyContentEditQuery('blog', { edit: 'hello-world' });
    expect(component.loadBlogEditor).toHaveBeenCalledWith('blog.hello-world');

    component.applyContentEditQuery('pages', { edit: 'faq' });
    expect(component.onPageBlocksKeyChange).toHaveBeenCalledWith('page.faq');

    component.onPageBlocksKeyChange.calls.reset();
    component.applyContentEditQuery('pages', { edit: 'page.' });
    expect(component.onPageBlocksKeyChange).not.toHaveBeenCalled();
  });

  it('skips content edit query work for empty payloads and duplicate keys', () => {
    const component = createAdminHarness() as any;
    component.selectedBlogKey = 'blog.same';
    component.pageBlocksKey = 'page.about';
    spyOn(component, 'loadBlogEditor').and.stub();
    spyOn(component, 'onPageBlocksKeyChange').and.stub();

    component.applyContentEditQuery('blog', { edit: 'same' });
    component.applyContentEditQuery('pages', { edit: 'about' });
    component.applyContentEditQuery('pages', { edit: '   ' });
    component.applyContentEditQuery('pages', { edit: 42 as any });

    expect(component.loadBlogEditor).not.toHaveBeenCalled();
    expect(component.onPageBlocksKeyChange).not.toHaveBeenCalled();
  });

  it('accepts global cms keys directly for page edit routing', () => {
    const component = createAdminHarness() as any;
    spyOn(component, 'onPageBlocksKeyChange').and.stub();

    component.applyContentEditQuery('pages', { edit: 'home.hero' });

    expect(component.onPageBlocksKeyChange).toHaveBeenCalledWith('page.home.hero');
  });
});

describe('AdminComponent fast poller and reset helpers', () => {
  it('starts and stops CMS draft poller based on section', () => {
    const component = createAdminHarness() as any;
    component.cmsDraftPoller = null;
    spyOn(component, 'observeCmsDrafts').and.stub();
    const setIntervalSpy = spyOn(GLOBAL_CTX, 'setInterval').and.returnValue(123 as any);
    const clearIntervalSpy = spyOn(GLOBAL_CTX, 'clearInterval').and.stub();

    component.syncCmsDraftPoller('home');
    expect(component.observeCmsDrafts).toHaveBeenCalled();
    expect(setIntervalSpy).toHaveBeenCalled();
    expect(component.cmsDraftPoller).toBe(123);

    component.syncCmsDraftPoller('settings');
    expect(clearIntervalSpy).toHaveBeenCalledWith(123);
    expect(component.cmsDraftPoller).toBeNull();
  });

  it('resets section state according to destination section', () => {
    const component = createAdminHarness() as any;
    component.selectedContent = { key: 'page.about' };
    component.showContentPreview = true;
    component.showBlogCreate = true;
    component.flaggedComments.set([{ id: 'x' }]);
    component.flaggedCommentsError = 'bad';
    spyOn(component, 'closeBlogEditor').and.stub();

    component.resetSectionState('settings');
    expect(component.closeBlogEditor).toHaveBeenCalled();
    expect(component.showBlogCreate).toBeFalse();
    expect(component.flaggedComments().length).toBe(0);
    expect(component.selectedContent).toEqual({ key: 'page.about' });

    component.resetSectionState('home');
    expect(component.selectedContent).toBeNull();
    expect(component.showContentPreview).toBeFalse();
  });

  it('does not create a second poller when one already exists', () => {
    const component = createAdminHarness() as any;
    component.cmsDraftPoller = 999;
    spyOn(component, 'observeCmsDrafts').and.stub();
    const setIntervalSpy = spyOn(GLOBAL_CTX, 'setInterval').and.callThrough();

    component.syncCmsDraftPoller('home');

    expect(component.observeCmsDrafts).not.toHaveBeenCalled();
    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(component.cmsDraftPoller).toBe(999);
  });

  it('loads section-specific resources for pages and blog branches', () => {
    const component = createAdminHarness() as any;
    component.loading.set(true);
    spyOn(component, 'loadInfo').and.stub();
    spyOn(component, 'loadLegalPage').and.stub();
    spyOn(component, 'loadCategories').and.stub();
    spyOn(component, 'loadCollections').and.stub();
    spyOn(component, 'loadContentPages').and.stub();
    spyOn(component, 'loadReusableBlocks').and.stub();
    spyOn(component, 'loadPageBlocks').and.stub();
    spyOn(component, 'loadContentRedirects').and.stub();
    spyOn(component, 'reloadContentBlocks').and.stub();
    spyOn(component, 'loadFlaggedComments').and.stub();

    component.loadForSection('pages');
    expect(component.loadInfo).toHaveBeenCalled();
    expect(component.loadLegalPage).toHaveBeenCalledWith(component.legalPageKey);
    expect(component.loadPageBlocks).toHaveBeenCalledWith(component.pageBlocksKey);
    expect(component.loadContentRedirects).toHaveBeenCalledWith(true);
    expect(component.loading()).toBeFalse();

    component.loadForSection('blog');
    expect(component.reloadContentBlocks).toHaveBeenCalled();
    expect(component.loadFlaggedComments).toHaveBeenCalled();
  });

  it('loads settings branch resources and handles admin streams', () => {
    const component = createAdminHarness() as any;
    component.admin = {
      coupons: () => immediateResult([{ code: 'A' }]),
      lowStock: () => immediateResult([{ sku: 'P1' }]),
      audit: () =>
        immediateResult({
          products: [{ id: 'p' }],
          content: [{ id: 'c' }],
          security: [{ id: 's' }],
        }),
      getMaintenance: () => immediateResult({ enabled: true }),
    };
    spyOn(component, 'reloadContentBlocks').and.stub();
    spyOn(component, 'loadCategories').and.stub();
    spyOn(component, 'loadTaxGroups').and.stub();
    spyOn(component, 'loadAssets').and.stub();
    spyOn(component, 'loadSocial').and.stub();
    spyOn(component, 'loadCompany').and.stub();
    spyOn(component, 'loadNavigation').and.stub();
    spyOn(component, 'loadCheckoutSettings').and.stub();
    spyOn(component, 'loadReportsSettings').and.stub();
    spyOn(component, 'loadSeo').and.stub();
    spyOn(component, 'loadFxStatus').and.stub();

    component.loadForSection('settings');

    expect(component.reloadContentBlocks).toHaveBeenCalled();
    expect(component.coupons.length).toBe(1);
    expect(component.lowStock.length).toBe(1);
    expect(component.productAudit.length).toBe(1);
    expect(component.contentAudit.length).toBe(1);
    expect(component.securityAudit.length).toBe(1);
    expect(component.maintenanceEnabled()).toBeTrue();
    expect(component.maintenanceEnabledValue).toBeTrue();
    expect(component.loading()).toBeFalse();
  });
});

describe('AdminComponent fast info and structured-data branches', () => {
  it('runs structured-data validation success and error branches', () => {
    const component = createAdminHarness() as any;
    component.admin = {
      validateStructuredData: jasmine
        .createSpy('validateStructuredData')
        .and.returnValues(of({ issues: [] }), throwError(() => ({ error: { detail: 'schema-invalid' } }))),
    };

    component.runStructuredDataValidation();
    expect(component.structuredDataLoading).toBeFalse();
    expect(component.structuredDataResult).toEqual({ issues: [] });
    expect(component.structuredDataError).toBeNull();

    component.runStructuredDataValidation();
    expect(component.structuredDataLoading).toBeFalse();
    expect(component.structuredDataResult).toBeNull();
    expect(component.structuredDataError).toContain('schema-invalid');
  });

  it('loads info blocks and handles missing-language fallback', async () => {
    const component = createAdminHarness() as any;
    component.infoForm = {
      about: { en: '', ro: '' },
      faq: { en: '', ro: '' },
      shipping: { en: '', ro: '' },
      contact: { en: '', ro: '' },
    };
    component.rememberContentVersion = jasmine.createSpy('rememberContentVersion');
    component.admin = {
      getContent: jasmine.createSpy('getContent').and.callFake((key: string, lang?: string) => {
        if (key === 'page.faq' && lang === 'ro') return throwError(() => new Error('ro-faq-missing'));
        return of({ body_markdown: `${key}-${lang || 'en'}` });
      }),
    };

    component.loadInfo();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(component.infoForm.about.en).toContain('page.about-en');
    expect(component.infoForm.about.ro).toContain('page.about-ro');
    expect(component.infoForm.faq.en).toContain('page.faq-en');
    expect(component.infoForm.faq.ro).toBe('');
    expect(component.rememberContentVersion).toHaveBeenCalled();
  });

  it('routes saveInfoUi to side-by-side and single-language branches', () => {
    const component = createAdminHarness() as any;
    component.infoLang = 'ro';
    component.cmsPrefs = { translationLayout: () => 'sideBySide' };
    component.saveInfoBoth = jasmine.createSpy('saveInfoBoth');
    component.saveInfo = jasmine.createSpy('saveInfo');
    const body = { en: 'Hello', ro: 'Salut' };

    component.saveInfoUi('page.about', body);
    expect(component.saveInfoBoth).toHaveBeenCalledWith('page.about', body);

    component.cmsPrefs = { translationLayout: () => 'stacked' };
    component.saveInfoUi('page.about', body);
    expect(component.saveInfo).toHaveBeenCalledWith('page.about', 'Salut', 'ro');
  });
});

describe('AdminComponent fast page/link/legal helpers', () => {
  it('loads link-check data and maps error state', () => {
    const component = createAdminHarness() as any;
    component.admin = {
      linkCheckContent: jasmine
        .createSpy('linkCheckContent')
        .and.returnValues(of({ issues: [{ id: 'i1' }] }), throwError(() => ({ error: { detail: 'load-failed' } }))),
    };

    component.runLinkCheck('page.about');
    expect(component.linkCheckIssues.length).toBe(1);
    expect(component.linkCheckLoading).toBeFalse();
    expect(component.linkCheckError).toBeNull();

    component.runLinkCheck('page.about');
    expect(component.linkCheckIssues.length).toBe(0);
    expect(component.linkCheckError).toContain('load-failed');
    expect(component.linkCheckLoading).toBeFalse();
  });

  it('maps redirect URLs, labels, reserved slugs, and rename guards', () => {
    const component = createAdminHarness() as any;

    expect(component.redirectKeyToUrl('page.about')).toBe('/pages/about');
    expect(component.redirectKeyToUrl('/account')).toBe('/account');
    expect(component.pageKeySupportsRequiresAuth('page.custom')).toBeTrue();
    expect(component.pageKeySupportsRequiresAuth('blog.custom')).toBeFalse();
    expect(component.pageBlockTypeLabelKey('image')).toContain('image');
    expect(component.pageBlockTypeLabelKey('carousel')).toContain('carousel');
    expect(component.pageBlockTypeLabelKey('text')).toContain('text');
    expect(component.canRenamePageKey('page.custom')).toBeTrue();
    expect(component.canRenamePageKey('page.about')).toBeFalse();
    expect(component.canRenamePageKey('blog.custom')).toBeFalse();
    expect(component.slugifyPageSlug(' Șlug Custom URL ')).toBe('slug-custom-url');
    expect(component.isReservedPageSlug('checkout')).toBeTrue();
    expect(component.isReservedPageSlug('custom-page')).toBeFalse();
    expect(component.pagePublicUrlForKey('page.contact')).toBe('/contact');
    expect(component.pagePublicUrlForKey('page.custom')).toBe('/pages/custom');
    expect(component.pagePublicUrlForKey('')).toBe('/pages');
  });

  it('handles renameCustomPageUrl success/redirect and update failure branches', () => {
    const component = createAdminHarness() as any;
    const toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    component.toast = toast;
    component.pageBlocksKey = 'page.old-path';
    component.loadContentPages = jasmine.createSpy('loadContentPages');
    component.loadPageBlocks = jasmine.createSpy('loadPageBlocks');
    component.loadContentRedirects = jasmine.createSpy('loadContentRedirects');
    component.admin = {
      renameContentPage: jasmine.createSpy('renameContentPage').and.returnValue(of({ old_key: 'page.old-path', new_key: 'page.new-path' })),
      upsertContentRedirect: jasmine.createSpy('upsertContentRedirect').and.returnValue(of({ ok: true })),
    };
    const promptSpy = spyOn(globalThis, 'prompt').and.returnValue('new-path');
    const confirmSpy = spyOn(globalThis, 'confirm').and.returnValues(true, true);

    component.renameCustomPageUrl();
    expect(promptSpy).toHaveBeenCalled();
    expect(confirmSpy).toHaveBeenCalled();
    expect(component.admin.renameContentPage).toHaveBeenCalledWith('old-path', 'new-path');
    expect(component.admin.upsertContentRedirect).toHaveBeenCalled();
    expect(component.pageBlocksKey).toBe('page.new-path');
    expect(component.loadContentRedirects).toHaveBeenCalledWith(true);
    expect(toast.success).toHaveBeenCalled();

    component.admin.renameContentPage.and.returnValue(throwError(() => ({ error: { detail: 'rename-failed' } })));
    component.renameCustomPageUrl();
    expect(toast.error).toHaveBeenCalled();
  });

  it('loads and saves legal-page metadata branches', () => {
    const component = createAdminHarness() as any;
    component.legalPageKey = 'page.terms';
    component.infoLang = 'en';
    component.legalPageForm = { en: '', ro: '' };
    component.rememberContentVersion = jasmine.createSpy('rememberContentVersion');
    component.savePageMarkdownInternal = jasmine.createSpy('savePageMarkdownInternal').and.callFake(
      (_key: string, _body: string, _lang: string, onSuccess: () => void) => onSuccess()
    );
    component.admin = {
      getContent: jasmine
        .createSpy('getContent')
        .and.returnValues(
          of({ body_markdown: 'terms-en', meta: { last_updated: '2026-03-01' } }),
          of({ body_markdown: 'terms-ro', meta: { last_updated: '2026-03-01' } })
        ),
      updateContentBlock: jasmine.createSpy('updateContentBlock').and.returnValue(
        of({ meta: { last_updated: '2026-03-02' } })
      ),
    };

    component.loadLegalPage('page.terms');
    expect(component.legalPageLoading).toBeFalse();
    expect(component.legalPageForm.en).toBe('terms-en');
    expect(component.legalPageForm.ro).toBe('terms-ro');
    expect(component.legalPageLastUpdated).toBe('2026-03-01');

    component.legalPageLastUpdated = '2026-03-02';
    component.saveLegalPageUi();
    expect(component.admin.updateContentBlock).toHaveBeenCalled();
    expect(component.savePageMarkdownInternal).toHaveBeenCalled();
    expect(component.legalPageMessage).toContain('adminUi.site.pages.success.save');
  });
});

describe('AdminComponent fast preview/blog seo/page-visibility branches', () => {
  it('covers page/home preview token generation and clipboard result branches', async () => {
    const component = createAdminHarness() as any;
    component.cmsPrefs = {
      previewLang: () => 'en',
      previewTheme: () => 'light',
    };
    component.t = (key: string) => key;
    component.toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'info']);
    component.copyToClipboard = jasmine
      .createSpy('copyToClipboard')
      .and.returnValues(Promise.resolve(true), Promise.resolve(false), Promise.resolve(false));
    component.admin = {
      createPagePreviewToken: jasmine.createSpy('createPagePreviewToken').and.returnValue(
        of({ token: 'page-preview', expires_at: '2026-03-10T12:00:00Z', origin: 'https://preview.example' })
      ),
      createHomePreviewToken: jasmine.createSpy('createHomePreviewToken').and.returnValue(
        of({ token: 'home-preview', expires_at: '2026-03-10T12:00:00Z', origin: 'https://preview.example' })
      ),
    };

    component.generatePagePreviewLink('page.about');
    expect(component.pagePreviewToken).toBe('page-preview');
    expect(component.pagePreviewForSlug).toBe('page.about');
    expect(component.pagePreviewShareUrl('page.about')).toContain('preview=');

    component.generateHomePreviewLink();
    expect(component.homePreviewToken).toBe('home-preview');
    expect(component.homePreviewShareUrl()).toContain('preview=');
    expect(component.homePreviewIframeSrc()).toBeTruthy();
    component.copyPreviewLink('https://preview.example/pages/about');
    await Promise.resolve();
    await Promise.resolve();
    expect(component.toast.success).toHaveBeenCalled();
    expect(component.toast.info).toHaveBeenCalled();
    expect(component.toast.error).toHaveBeenCalled();
  });

  it('covers blog SEO helpers and copy-text success/error branches', async () => {
    const component = createAdminHarness() as any;
    component.selectedBlogKey = 'blog.coverage-wave';
    component.blogEditLang = 'en';
    component.blogForm = { title: 'SEO Title', body_markdown: 'Body **markdown** with [link](https://example.com)', status: 'draft' };
    component.blogMeta = { summary: { en: 'Summary text' } };
    component.blogSeoSnapshots = { en: null, ro: { title: 'Titlu', body_markdown: 'Descriere ro' } };
    component.blogPreviewToken = null;
    component.t = (key: string) => key;
    component.copyToClipboard = jasmine.createSpy('copyToClipboard').and.returnValues(Promise.resolve(true), Promise.resolve(false));
    component.toast = jasmine.createSpyObj('ToastService', ['info', 'error']);

    expect(component.blogSeoHasContent('en')).toBeTrue();
    expect(component.blogSeoHasContent('ro')).toBeTrue();
    expect(component.blogSeoTitlePreview('en').length).toBeGreaterThan(0);
    expect(component.blogSeoDescriptionPreview('en').length).toBeGreaterThan(0);
    expect(component.blogSeoIssues('en').length).toBeGreaterThan(0);
    expect(component.blogPublishedOgImageUrl('en')).toContain('/blog/posts/');
    expect(component.blogPreviewOgImageUrl('en')).toBeNull();

    component.blogPreviewToken = 'preview-token';
    expect(component.blogPreviewOgImageUrl('en')).toContain('token=');

    component.copyText(' https://momentstudio.example/blog/post ');
    component.copyText('another value');
    await Promise.resolve();
    await Promise.resolve();
    expect(component.toast.info).toHaveBeenCalled();
    expect(component.toast.error).toHaveBeenCalled();
  });

  it('covers saveInfoInternal fallback/create path and page visibility update error rollback', () => {
    const component = createAdminHarness() as any;
    component.rememberContentVersion = jasmine.createSpy('rememberContentVersion');
    component.loadContentPages = jasmine.createSpy('loadContentPages');
    component.toRecord = (value: unknown) => (value && typeof value === 'object' ? { ...(value as Record<string, unknown>) } : {});
    component.withExpectedVersion = (_key: string, payload: unknown) => payload;
    component.handleContentConflict = jasmine.createSpy('handleContentConflict').and.returnValue(false);
    component.toast = jasmine.createSpyObj('ToastService', ['success', 'error']);

    const onSuccess = jasmine.createSpy('onSuccess');
    const onError = jasmine.createSpy('onError');
    component.admin = {
      updateContentBlock: jasmine.createSpy('updateContentBlock').and.returnValues(
        throwError(() => ({ error: { detail: 'exists' } })),
        throwError(() => ({ error: { detail: 'save-failed' } }))
      ),
      createContent: jasmine.createSpy('createContent').and.returnValue(
        of({ key: 'page.about', body_markdown: 'saved', meta: { hidden: false } })
      ),
      getContent: jasmine.createSpy('getContent').and.returnValue(of({ meta: { hidden: false } })),
    };

    component['saveInfoInternal']('page.about', 'About body', 'en', onSuccess, onError);
    expect(component.admin.createContent).toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalled();

    component.contentPages = [{ key: 'page.custom', hidden: false }];
    component.showHiddenPages = false;
    component.ensureSelectedPageIsVisible = jasmine.createSpy('ensureSelectedPageIsVisible');
    component['setPageHidden']('page.custom', true);
    expect(component.toast.error).toHaveBeenCalled();
    expect(component.contentPages[0].hidden).toBeFalse();
  });
});



describe('AdminComponent fast tax/category/fx/product branches', () => {
  it('loads tax groups through success and error branches', () => {
    const component = createAdminHarness() as any;
    const { taxesAdmin } = attachTaxCategoryAndFxHarness(component);

    component.loadTaxGroups();
    expect(component.taxGroups.length).toBe(1);
    expect(component.taxGroupsLoading).toBeFalse();
    expect(component.taxGroupsError).toBeNull();

    taxesAdmin.listGroups.and.returnValue(immediateResult([], true));
    component.loadTaxGroups();
    expect(component.taxGroups).toEqual([]);
    expect(component.taxGroupsLoading).toBeFalse();
    expect(component.taxGroupsError).toContain('boom');
  });

  it('covers tax group create/update/default/delete and rate upsert/delete guards', () => {
    const component = createAdminHarness() as any;
    const { taxesAdmin } = attachTaxCategoryAndFxHarness(component);
    component.toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    component.loadTaxGroups = jasmine.createSpy('loadTaxGroups');
    component.taxGroupCreate = { code: ' ', name: ' ', description: '', is_default: false };

    component.createTaxGroup();
    expect(component.toast.error).toHaveBeenCalled();
    expect(taxesAdmin.createGroup).not.toHaveBeenCalled();

    component.taxGroupCreate = { code: 'STD', name: 'Standard', description: 'Desc', is_default: true };
    component.createTaxGroup();
    expect(taxesAdmin.createGroup).toHaveBeenCalled();
    expect(component.loadTaxGroups).toHaveBeenCalled();

    const group = { id: 'g1', name: '', description: '', is_default: false } as any;
    component.saveTaxGroup(group);
    expect(component.toast.error).toHaveBeenCalled();

    group.name = 'Updated';
    component.saveTaxGroup(group);
    expect(taxesAdmin.updateGroup).toHaveBeenCalledWith('g1', jasmine.objectContaining({ name: 'Updated' }));

    component.setDefaultTaxGroup({ id: 'g1', is_default: true } as any);
    component.setDefaultTaxGroup({ id: 'g2', is_default: false } as any);
    expect(taxesAdmin.updateGroup).toHaveBeenCalledWith('g2', { is_default: true });

    component.deleteTaxGroup({ id: 'g1', is_default: true } as any);
    component.deleteTaxGroup({ id: 'g2', is_default: false } as any);
    expect(taxesAdmin.deleteGroup).toHaveBeenCalledWith('g2');

    component.taxRateCountry = { g2: '' };
    component.taxRatePercent = { g2: '' };
    component.upsertTaxRate({ id: 'g2' } as any);
    expect(component.toast.error).toHaveBeenCalled();

    component.taxRateCountry.g2 = 'RO';
    component.taxRatePercent.g2 = '19';
    component.upsertTaxRate({ id: 'g2' } as any);
    expect(taxesAdmin.upsertRate).toHaveBeenCalledWith('g2', { country_code: 'RO', vat_rate_percent: 19 });

    component.deleteTaxRate({ id: 'g2' } as any, '   ');
    component.deleteTaxRate({ id: 'g2' } as any, 'RO');
    expect(taxesAdmin.deleteRate).toHaveBeenCalledWith('g2', 'RO');
  });

  it('covers category parent/threshold/tax-group/delete-confirm branches', () => {
    const component = createAdminHarness() as any;
    const { admin } = attachTaxCategoryAndFxHarness(component);
    component.toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    component.categories = [
      { id: 'root', slug: 'root', name: 'Root', parent_id: null },
      { id: 'child', slug: 'child', name: 'Child', parent_id: 'root' },
      { id: 'leaf', slug: 'leaf', name: 'Leaf', parent_id: 'child' },
    ];
    const cat = { id: 'child', slug: 'child', parent_id: 'root', low_stock_threshold: null, tax_group_id: null } as any;

    expect(component.categoryParentLabel(cat)).toBe('Root');
    const options = component.categoryParentOptions(cat);
    expect(options.some((row: any) => row.id === 'leaf')).toBeFalse();

    component.updateCategoryLowStockThreshold(cat, 'bad');
    expect(component.toast.error).toHaveBeenCalled();
    const previousThreshold = cat.low_stock_threshold;
    component.updateCategoryLowStockThreshold(cat, '5');
    expect(admin.updateCategory).toHaveBeenCalledWith('child', { low_stock_threshold: 5 });
    expect(cat.low_stock_threshold).not.toBe(previousThreshold);

    component.updateCategoryTaxGroup(cat, '');
    component.updateCategoryTaxGroup(cat, 'g2');
    expect(admin.updateCategory).toHaveBeenCalledWith('child', { tax_group_id: 'g2' });

    component.openCategoryDeleteConfirm(cat);
    expect(component.categoryDeleteConfirmOpen()).toBeTrue();
    component.confirmDeleteCategory();
    expect(admin.deleteCategory).toHaveBeenCalledWith('child');

    const done = jasmine.createSpy('done');
    component.deleteCategory('child', { done });
    expect(done).toHaveBeenCalledWith(true);
  });

  it('covers fx override clear branches and bulk stock save success/error', async () => {
    const component = createAdminHarness() as any;
    const { admin, fxAdmin } = attachTaxCategoryAndFxHarness(component);
    component.toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    spyOn(globalThis, 'confirm').and.returnValues(false, true);

    component.clearFxOverride();
    expect(fxAdmin.clearOverride).not.toHaveBeenCalled();

    component.clearFxOverride();
    expect(fxAdmin.clearOverride).toHaveBeenCalled();
    expect(component.loadFxStatus).toHaveBeenCalled();

    component.bulkStock = 7;
    component.selectedIds = new Set(['p-1']);
    component.products = [{ id: 'p-1', slug: 'slug-1', stock_quantity: 1 }];
    await component.saveBulkStock();
    expect(admin.updateProduct).toHaveBeenCalledWith('slug-1', { stock_quantity: 7 });
    expect(component.products[0].stock_quantity).toBe(7);

    admin.updateProduct.and.returnValue(throwError(() => new Error('bulk-fail')));
    component.products[0].stock_quantity = 2;
    await component.saveBulkStock();
    expect(component.toast.error).toHaveBeenCalled();
  });
});

type BlogHarness = {
  admin: jasmine.SpyObj<any>;
  blog: jasmine.SpyObj<any>;
  toast: jasmine.SpyObj<any>;
  draft: { initFromServer: jasmine.Spy; markServerSaved: jasmine.Spy };
};

function attachBlogHarness(component: any): BlogHarness {
  const admin = jasmine.createSpyObj('AdminService', ['createContent', 'updateContentBlock', 'deleteContent', 'getContent']);
  admin.createContent.and.returnValue(of({ key: 'blog.hello', version: 1 }));
  admin.updateContentBlock.and.returnValue(of({ key: 'blog.hello', version: 2, title: 'Saved', body_markdown: 'Body', status: 'draft' }));
  admin.deleteContent.and.returnValue(immediateResult({}));
  admin.getContent.and.returnValue(
    of({ title: 'Loaded', body_markdown: 'Loaded body', status: 'draft', published_at: null, published_until: null, meta: {} })
  );
  const blog = jasmine.createSpyObj('BlogService', ['createPreviewToken']);
  blog.createPreviewToken.and.returnValue(
    of({ url: 'https://preview.example/blog/hello', token: 'preview-token', expires_at: '2026-03-10T12:00:00Z' })
  );
  const toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'info']);
  const draft = {
    initFromServer: jasmine.createSpy('initFromServer'),
    markServerSaved: jasmine.createSpy('markServerSaved'),
  };

  component.admin = admin;
  component.blog = blog;
  component.toast = toast;
  component.t = (key: string) => key;
  component.blogMeta = {};
  component.blogForm = { title: '', body_markdown: '', status: 'draft', published_at: '', published_until: '' };
  component.blogCreate = {
    title: 'Hello world',
    body_markdown: 'Body text',
    status: 'draft',
    baseLang: 'en',
    includeTranslation: true,
    translationTitle: 'Salut',
    translationBody: 'Continut',
    tags: 'news, featured',
    summary: 'Summary',
    series: 'Series',
    cover_image_url: 'https://cdn.example/image.jpg',
    reading_time_minutes: '4',
    pinned: true,
    pin_order: '2',
    published_at: '2026-03-01T10:00',
    published_until: '2026-03-05T12:00',
  };

  spyOn(component, 'rememberContentVersion').and.stub();
  spyOn(component, 'reloadContentBlocks').and.stub();
  spyOn(component, 'loadBlogEditor').and.stub();
  spyOn(component, 'setBlogSeoSnapshot').and.stub();
  spyOn(component, 'currentBlogDraftState').and.returnValue({} as any);
  spyOn(component, 'ensureBlogDraft').and.returnValue(draft as any);
  spyOn(component, 'withExpectedVersion').and.callFake((_key: string, payload: unknown) => payload);
  return { admin, blog, toast, draft };
}

describe('AdminComponent fast blog editor branches', () => {
  it('validates createBlogPost required fields before submit', async () => {
    const component = createAdminHarness() as any;
    attachBlogHarness(component);

    spyOn(component, 'blogCreateSlug').and.returnValue('');
    await component.createBlogPost();
    expect(component.toast.error).toHaveBeenCalled();

    component.blogCreate.title = '   ';
    component.blogCreate.body_markdown = '   ';
    component.blogCreateSlug.and.returnValue('hello-world');
    await component.createBlogPost();
    expect(component.toast.error).toHaveBeenCalled();
  });

  it('covers createBlogPost retry, translation update and success flow', async () => {
    const component = createAdminHarness() as any;
    const { admin, toast } = attachBlogHarness(component);

    spyOn(component, 'blogCreateSlug').and.returnValue('hello-world');
    spyOn(component, 'parseTags').and.returnValue(['news', 'featured']);
    spyOn(component, 'nextBlogPinOrder').and.returnValue(8);

    admin.createContent.and.returnValues(
      throwError(() => ({ error: { detail: 'Content key exists' } })),
      of({ key: 'blog.hello-world-2', version: 2 })
    );

    await component.createBlogPost();

    expect(admin.createContent).toHaveBeenCalledTimes(2);
    expect(admin.createContent.calls.argsFor(1)[0]).toBe('blog.hello-world-2');
    expect(admin.updateContentBlock).toHaveBeenCalled();
    expect(component.loadBlogEditor).toHaveBeenCalledWith('blog.hello-world-2');
    expect(toast.success).toHaveBeenCalled();
  });

  it('covers createBlogPost error branch after submit failure', async () => {
    const component = createAdminHarness() as any;
    const { admin, toast } = attachBlogHarness(component);

    spyOn(component, 'blogCreateSlug').and.returnValue('hello-world');
    admin.createContent.and.returnValue(throwError(() => ({ error: { detail: 'fatal' } })));

    await component.createBlogPost();

    expect(toast.error).toHaveBeenCalled();
  });

  it('covers deleteBlogPost confirm, success and error branches', () => {
    const component = createAdminHarness() as any;
    const { admin, toast } = attachBlogHarness(component);
    component.selectedBlogKey = 'blog.hello';
    spyOn(component, 'closeBlogEditor').and.stub();
    spyOn(globalThis, 'confirm').and.returnValues(false, true, true);

    component.deleteBlogPost({ key: 'blog.hello', title: 'Hello' } as any);
    expect(admin.deleteContent).not.toHaveBeenCalled();

    component.deleteBlogPost({ key: 'blog.hello', title: 'Hello' } as any);
    expect(admin.deleteContent).toHaveBeenCalledWith('blog.hello');
    expect(component.closeBlogEditor).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();

    admin.deleteContent.and.returnValue(throwError(() => ({ error: { detail: 'boom' } })));
    component.deleteBlogPost({ key: 'blog.other', title: 'Other' } as any);
    expect(toast.error).toHaveBeenCalled();
  });

  it('covers setBlogEditLang success and error branches', () => {
    const component = createAdminHarness() as any;
    const { admin, draft, toast } = attachBlogHarness(component);

    component.selectedBlogKey = 'blog.hello';
    component.blogBaseLang = 'en';
    component.setBlogEditLang('ro');
    expect(admin.getContent).toHaveBeenCalledWith('blog.hello', 'ro');
    expect(draft.initFromServer).toHaveBeenCalled();

    admin.getContent.and.returnValue(throwError(() => ({ error: { detail: 'load-failed' } })));
    component.setBlogEditLang('en');
    expect(toast.error).toHaveBeenCalled();
  });

  it('covers saveBlogPost base and translation update branches', () => {
    const component = createAdminHarness() as any;
    const { admin, draft, toast } = attachBlogHarness(component);

    component.selectedBlogKey = 'blog.hello';
    component.blogBaseLang = 'en';
    component.blogEditLang = 'en';
    component.blogForm = { title: 'Updated', body_markdown: 'Updated body', status: 'draft', published_at: '', published_until: '' };
    component.blogMeta = {};
    spyOn(component, 'buildBlogMeta').and.returnValues({ summary: { en: 'S1' } }, { summary: { ro: 'S2' } });
    spyOn(component, 'blogA11yIssues').and.returnValue([]);
    spyOn(component, 'handleContentConflict').and.returnValue(false);
    spyOn(component, 'setBlogEditLang').and.stub();

    component.saveBlogPost();
    expect(admin.updateContentBlock).toHaveBeenCalled();
    expect(draft.markServerSaved).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();

    admin.updateContentBlock.calls.reset();
    admin.updateContentBlock.and.returnValues(
      of({ key: 'blog.hello', version: 3, title: 'Updated', body_markdown: 'Updated body', status: 'draft' }),
      throwError(() => ({ error: { detail: 'meta-failed' } }))
    );
    component.blogEditLang = 'ro';
    component.saveBlogPost();
    expect(admin.updateContentBlock).toHaveBeenCalledTimes(2);
    expect(toast.error).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
  });

  it('covers blog preview generation and copy branches', async () => {
    const component = createAdminHarness() as any;
    const { blog, toast } = attachBlogHarness(component);

    component.selectedBlogKey = 'blog.hello';
    spyOn(component, 'currentBlogSlug').and.returnValue('hello');
    component.copyToClipboard = jasmine.createSpy('copyToClipboard').and.returnValues(Promise.resolve(true), Promise.resolve(false));

    component.generateBlogPreviewLink();
    await Promise.resolve();
    await Promise.resolve();
    expect(blog.createPreviewToken).toHaveBeenCalled();
    expect(component.blogPreviewUrl).toContain('preview.example');

    component.copyBlogPreviewLink();
    await Promise.resolve();
    await Promise.resolve();
    expect(toast.info).toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });
});

describe('AdminComponent fast blog moderation and residual branch closures', () => {
  it('covers blog version list/detail load and error paths', () => {
    const component = createAdminHarness() as any;
    const { admin, toast } = attachBlogHarness(component);

    admin.listContentVersions = jasmine
      .createSpy('listContentVersions')
      .and.returnValues(of([{ version: 2 }]), throwError(() => ({ error: { detail: 'version-load-failed' } })));
    admin.getContentVersion = jasmine
      .createSpy('getContentVersion')
      .and.returnValues(of({ version: 2, body_markdown: 'old body' }), throwError(() => ({ error: { detail: 'detail-failed' } })));

    component.selectedBlogKey = 'blog.hello';
    component.blogForm.body_markdown = 'new body';

    component.loadBlogVersions();
    expect(component.blogVersions.length).toBe(1);

    component.loadBlogVersions();
    expect(toast.error).toHaveBeenCalled();

    component.selectBlogVersion(2);
    expect(component.blogVersionDetail?.version).toBe(2);

    component.selectBlogVersion(3);
    expect(toast.error).toHaveBeenCalled();
  });

  it('covers rollbackBlogVersion confirm, success, and error branches', () => {
    const component = createAdminHarness() as any;
    const { admin, toast } = attachBlogHarness(component);

    admin.rollbackContentVersion = jasmine
      .createSpy('rollbackContentVersion')
      .and.returnValues(of({}), throwError(() => ({ error: { detail: 'rollback-failed' } })));
    component.selectedBlogKey = 'blog.hello';
    spyOn(component, 'loadBlogVersions').and.stub();
    spyOn(globalThis, 'confirm').and.returnValues(false, true, true);

    component.rollbackBlogVersion(4);
    expect(admin.rollbackContentVersion).not.toHaveBeenCalled();

    component.rollbackBlogVersion(5);
    expect(admin.rollbackContentVersion).toHaveBeenCalledWith('blog.hello', 5);
    expect(component.reloadContentBlocks).toHaveBeenCalled();
    expect(component.loadBlogEditor).toHaveBeenCalledWith('blog.hello');

    component.rollbackBlogVersion(6);
    expect(toast.error).toHaveBeenCalled();
  });

  it('covers flagged-comment moderation branches', () => {
    const component = createAdminHarness() as any;
    const { toast } = attachBlogHarness(component);
    const blog = jasmine.createSpyObj('BlogService', [
      'listFlaggedComments',
      'resolveCommentFlagsAdmin',
      'hideCommentAdmin',
      'unhideCommentAdmin',
      'deleteComment',
    ]);
    blog.listFlaggedComments.and.returnValues(
      of({ items: [{ id: 'c1', is_hidden: false }] }),
      throwError(() => ({ error: { detail: 'load-failed' } }))
    );
    blog.resolveCommentFlagsAdmin.and.returnValue(of({}));
    blog.hideCommentAdmin.and.returnValues(of({}), throwError(() => ({ error: { detail: 'hide-failed' } })));
    blog.unhideCommentAdmin.and.returnValue(of({}));
    blog.deleteComment.and.returnValues(of({}), throwError(() => ({ error: { detail: 'delete-failed' } })));
    component.blog = blog;

    component.loadFlaggedComments();
    expect(component.flaggedComments().length).toBe(1);

    component.loadFlaggedComments();
    expect(component.flaggedCommentsError).toContain('errors.load');

    const comment = { id: 'c1', is_hidden: false } as any;
    spyOn(globalThis, 'prompt').and.returnValues(null, '  reason  ', 'again');
    spyOn(globalThis, 'confirm').and.returnValues(false, true, true);
    spyOn(component, 'loadFlaggedComments').and.stub();

    component.resolveFlags(comment);
    expect(blog.resolveCommentFlagsAdmin).toHaveBeenCalledWith('c1');

    component.toggleHide(comment);
    expect(blog.hideCommentAdmin).not.toHaveBeenCalled();

    component.toggleHide(comment);
    expect(blog.hideCommentAdmin).toHaveBeenCalledWith('c1', { reason: 'reason' });

    component.toggleHide(comment);
    expect(toast.error).toHaveBeenCalled();

    component.toggleHide({ id: 'c2', is_hidden: true } as any);
    expect(blog.unhideCommentAdmin).toHaveBeenCalledWith('c2');

    component.adminDeleteComment(comment);
    expect(blog.deleteComment).not.toHaveBeenCalledWith('c1');

    component.adminDeleteComment(comment);
    expect(blog.deleteComment).toHaveBeenCalledWith('c1');

    component.adminDeleteComment(comment);
    expect(toast.error).toHaveBeenCalled();
  });

  it('covers blog image drag/drop and embed insertion branches', async () => {
    const component = createAdminHarness() as any;
    const { admin, toast } = attachBlogHarness(component);

    const target = { insertMarkdown: jasmine.createSpy('insertMarkdown') } as any;
    const image = new File(['img'], 'hero.png', { type: 'image/png' });
    const dragEvent = {
      dataTransfer: { types: ['Files'], files: [image], dropEffect: 'none' },
      preventDefault: jasmine.createSpy('preventDefault'),
      stopPropagation: jasmine.createSpy('stopPropagation'),
    } as any;

    component.selectedBlogKey = 'blog.hello';
    component.blogImageLayout = 'full';
    spyOn(globalThis, 'prompt').and.returnValue('hero-slug');
    admin.uploadContentImage = jasmine
      .createSpy('uploadContentImage')
      .and.returnValues(
        of({ images: [{ id: 'i1', url: 'https://cdn/img.jpg', sort_order: 1, focal_x: 50, focal_y: 50 }] }),
        throwError(() => ({ error: { detail: 'upload-failed' } }))
      );

    component.insertBlogEmbed(target, 'product');
    component.onBlogImageDragOver(dragEvent as DragEvent);
    expect(dragEvent.preventDefault).toHaveBeenCalled();

    await component.onBlogImageDrop(target, dragEvent as DragEvent);
    expect(target.insertMarkdown).toHaveBeenCalled();

    await component.onBlogImageDrop(target, dragEvent as DragEvent);
    expect(toast.error).toHaveBeenCalled();
  });

  it('covers blog bulk payload and meta sync helper branches', () => {
    const component = createAdminHarness() as any;

    component.blogBulkAction = 'schedule';
    component.blogBulkPublishAt = '2026-03-05T10:00';
    component.blogBulkUnpublishAt = '2026-03-04T10:00';
    expect(component['buildBlogBulkPayload']({ meta: {} })).toBeNull();

    component.blogBulkUnpublishAt = '2026-03-06T10:00';
    const scheduled = component['buildBlogBulkPayload']({ meta: {} });
    expect((scheduled as any).status).toBe('published');

    component.blogBulkAction = 'tags_add';
    component.blogBulkTags = 'new, featured';
    const tagged = component['buildBlogBulkPayload']({ meta: { tags: ['old'] } }) as any;
    expect(tagged.meta.tags.length).toBe(3);

    component.blogBulkAction = 'tags_remove';
    component.blogBulkTags = 'old';
    const removed = component['buildBlogBulkPayload']({ meta: { tags: ['old', 'fresh'] } }) as any;
    expect(removed.meta.tags).toEqual(['fresh']);

    component.blogMeta = {
      summary: { en: 'Summary EN', ro: 'Rezumat RO' },
      tags: ['tag1', 'tag2'],
      series: 'Series',
      cover_image_url: 'https://cdn/cover.jpg',
      cover_fit: 'contain',
      reading_time_minutes: 7,
      pinned: true,
      pin_order: 4,
    };
    component.blogForm = { summary: '', tags: '', series: '', cover_image_url: '', cover_fit: 'cover', reading_time_minutes: '', pinned: false, pin_order: '' };

    component['syncBlogMetaToForm']('ro');
    expect(component.blogForm.summary).toBe('Rezumat RO');

    const meta = component.buildBlogMeta('en');
    expect((meta as any).summary.en).toBeTruthy();
    expect((meta as any).pin_order).toBeGreaterThan(0);
  });
});
