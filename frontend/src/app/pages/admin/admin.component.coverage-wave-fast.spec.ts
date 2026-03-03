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

