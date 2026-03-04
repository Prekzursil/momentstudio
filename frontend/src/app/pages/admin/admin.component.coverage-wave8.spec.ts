import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';

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
    queryParams: new Subject<Record<string, unknown>>()
  };
}

function createAdminSpy(): jasmine.SpyObj<any> {
  return jasmine.createSpyObj('AdminService', [
    'products',
    'coupons',
    'lowStock',
    'audit',
    'getMaintenance'
  ]);
}

function createHarness(): { component: AdminComponent; admin: jasmine.SpyObj<any>; toast: jasmine.SpyObj<any> } {
  const routeStub = createRouteStub('home');
  const admin = createAdminSpy();
  admin.products.and.returnValue(of([]));
  admin.coupons.and.returnValue(of([]));
  admin.lowStock.and.returnValue(of([]));
  admin.audit.and.returnValue(of({ products: [], content: [], security: [] }));
  admin.getMaintenance.and.returnValue(of({ enabled: false }));

  const toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'info']);

  const component = new AdminComponent(
    {
      snapshot: routeStub.snapshot,
      data: routeStub.data.asObservable(),
      queryParams: routeStub.queryParams.asObservable()
    } as unknown as ActivatedRoute,
    admin as any,
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
      previewTheme: () => 'light'
    } as any,
    toast as any,
    { instant: (key: string) => key } as any,
    { render: (value: string) => value } as any,
    {
      bypassSecurityTrustHtml: (value: string) => value,
      bypassSecurityTrustResourceUrl: (value: string) => value
    } as unknown as DomSanitizer
  );

  return { component, admin, toast };
}

const GLOBAL_CTX = globalThis as Window & typeof globalThis;

describe('AdminComponent coverage wave 8 branch matrix', () => {
  it('covers additional revision key and viewport-width switch branches', () => {
    const { component } = createHarness();

    component.pagesRevisionKey = 'page.terms';
    expect(component.pagesRevisionTitleKey()).toBe('adminUi.site.pages.legal.documents.termsIndex');
    component.pagesRevisionKey = 'page.terms-and-conditions';
    expect(component.pagesRevisionTitleKey()).toBe('adminUi.site.pages.legal.documents.terms');
    component.pagesRevisionKey = 'page.anpc';
    expect(component.pagesRevisionTitleKey()).toBe('adminUi.site.pages.legal.documents.anpc');

    component.homeRevisionKey = 'home.story';
    expect(component.homeRevisionTitleKey()).toBe('adminUi.home.story.title');

    component.settingsRevisionKey = 'site.company';
    expect(component.settingsRevisionTitleKey()).toBe('adminUi.site.company.title');
    component.settingsRevisionKey = 'site.navigation';
    expect(component.settingsRevisionTitleKey()).toBe('adminUi.site.navigation.title');
    component.settingsRevisionKey = 'site.checkout';
    expect(component.settingsRevisionTitleKey()).toBe('adminUi.site.checkout.title');
    component.settingsRevisionKey = 'site.reports';
    expect(component.settingsRevisionTitleKey()).toBe('adminUi.reports.title');

    (component as any).cmsPrefs.previewDevice = () => 'mobile';
    expect(component.cmsPreviewViewportWidth()).toBe(390);
    (component as any).cmsPrefs.previewDevice = () => 'tablet';
    expect(component.cmsPreviewViewportWidth()).toBe(768);
    (component as any).cmsPrefs.previewDevice = () => 'desktop';
    expect(component.cmsPreviewViewportWidth()).toBe(1024);
  });

  it('covers applySection/applyContentEditQuery and init-destroy lifecycle paths', () => {
    const { component } = createHarness();
    const loadForSectionSpy = spyOn(component as any, 'loadForSection').and.stub();
    const syncPollerSpy = spyOn(component as any, 'syncCmsDraftPoller').and.stub();
    const loadBlogEditorSpy = spyOn(component as any, 'loadBlogEditor').and.stub();
    const onPageBlocksKeyChangeSpy = spyOn(component, 'onPageBlocksKeyChange').and.stub();

    component.section.set('home');
    (component as any).applySection('home');
    (component as any).applySection('pages');
    expect(loadForSectionSpy).toHaveBeenCalledTimes(2);
    expect(syncPollerSpy).toHaveBeenCalledTimes(2);

    (component as any).applyContentEditQuery('blog', { edit: 'post-demo' });
    expect(loadBlogEditorSpy).toHaveBeenCalledWith('blog.post-demo');
    (component as any).applyContentEditQuery('pages', { edit: 'contact' });
    expect(onPageBlocksKeyChangeSpy).toHaveBeenCalledWith('page.contact');

    component.ngOnInit();
    component.ngOnDestroy();
  });

  it('covers observeCmsDrafts and poller start-stop branches', () => {
    const { component } = createHarness();
    const setIntervalSpy = spyOn(GLOBAL_CTX, 'setInterval').and.returnValue(77 as any);
    const clearIntervalSpy = spyOn(GLOBAL_CTX, 'clearInterval').and.stub();

    component.homeBlocks = [{ key: 'home.hero', type: 'hero', enabled: true }] as any;
    component['cmsHomeDraft'].initFromServer(component.homeBlocks as any);

    component.pageBlocksKey = 'page.contact' as any;
    component.pageBlocks = { 'page.contact': [{ key: 'p-1', type: 'text', enabled: true }] } as any;
    const pageDraft = component['ensurePageDraft']('page.contact');
    pageDraft.initFromServer(component['currentPageDraftState']('page.contact'));

    component.selectedBlogKey = 'blog.sample';
    component.blogEditLang = 'en';
    const blogDraft = component['ensureBlogDraft']('blog.sample', 'en');
    blogDraft.initFromServer(component['currentBlogDraftState']());

    (component as any).observeCmsDrafts();
    expect(component.homeDraftReady()).toBeTrue();
    expect(component.pageDraftReady('page.contact')).toBeTrue();
    expect(component.blogDraftReady()).toBeTrue();

    (component as any).syncCmsDraftPoller('home');
    expect(setIntervalSpy).toHaveBeenCalled();
    (component as any).stopCmsDraftPoller();
    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  it('covers loadForSection fan-out with success/error audit branches', () => {
    const { component, admin, toast } = createHarness();
    const pagesSpies = [
      spyOn(component as any, 'loadInfo').and.stub(),
      spyOn(component as any, 'loadLegalPage').and.stub(),
      spyOn(component as any, 'loadCategories').and.stub(),
      spyOn(component as any, 'loadCollections').and.stub(),
      spyOn(component as any, 'loadContentPages').and.stub(),
      spyOn(component as any, 'loadReusableBlocks').and.stub(),
      spyOn(component as any, 'loadPageBlocks').and.stub(),
      spyOn(component as any, 'loadContentRedirects').and.stub()
    ];
    const blogSpies = [
      spyOn(component as any, 'reloadContentBlocks').and.stub(),
      spyOn(component as any, 'loadFlaggedComments').and.stub()
    ];
    const settingsSpies = [
      spyOn(component as any, 'loadTaxGroups').and.stub(),
      spyOn(component as any, 'loadAssets').and.stub(),
      spyOn(component as any, 'loadSocial').and.stub(),
      spyOn(component as any, 'loadCompany').and.stub(),
      spyOn(component as any, 'loadNavigation').and.stub(),
      spyOn(component as any, 'loadCheckoutSettings').and.stub(),
      spyOn(component as any, 'loadReportsSettings').and.stub(),
      spyOn(component as any, 'loadSeo').and.stub(),
      spyOn(component as any, 'loadFxStatus').and.stub()
    ];

    (component as any).loadForSection('pages');
    expect(pagesSpies.every((spyRef) => spyRef.calls.count() > 0)).toBeTrue();
    expect((pagesSpies[7] as any).calls.mostRecent().args[0]).toBe(true);

    (component as any).loadForSection('blog');
    expect(blogSpies.every((spyRef) => spyRef.calls.count() > 0)).toBeTrue();

    admin.audit.and.returnValue(of({ products: [1], content: [2], security: [3] }));
    (component as any).loadForSection('settings');
    expect(component.productAudit).toEqual([1] as any);
    expect(component.contentAudit).toEqual([2] as any);
    expect(component.securityAudit).toEqual([3] as any);
    expect(settingsSpies.every((spyRef) => spyRef.calls.count() > 0)).toBeTrue();

    admin.audit.and.returnValue(throwError(() => new Error('audit-fail')));
    (component as any).loadForSection('settings');
    expect(toast.error).toHaveBeenCalledWith('adminUi.audit.errors.loadTitle', 'adminUi.audit.errors.loadCopy');
  });
});
